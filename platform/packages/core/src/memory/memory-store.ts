/**
 * MemoryStore — the home for "learns how you work" (MEM-1, roadmap
 * undefined-element #3). A thin, derived, CLASSIFIED layer of confirmed/
 * superseded learned facts that sits ALONGSIDE `timeline_entries` (the raw
 * capture log) — it does NOT fork it. A capture lands as a timeline entry
 * (CaptureLedger) and, when wired, a derived Memory candidate is written here
 * referencing that entry via `sourceRef`.
 *
 * WHY a separate table and not timeline_entries:
 *  - timeline_entries is an append-only episodic log of everything captured;
 *    a Memory is a DISTILLED, classified, supersede-able fact derived from one
 *    or more captures/ledger rows/feedback. Different lifecycle (facts get
 *    superseded; log entries never change), different read model (authority-
 *    scoped by classification, not just tenant).
 *
 * Retrieval is AUTHORITY-SCOPED AT THE STORE BOUNDARY (not post-filtered): the
 * store itself applies the classification predicate so a caller can never read
 * a row it is not entitled to. The predicate mirrors the database's own
 * `app_private.visible_relationship_row` (migrations/0008) exactly:
 * public/organization → any member; team/private/restricted → owner-only (finer
 * team membership + restricted grants land with the governance schema pass).
 *
 * The in-memory adapter here is the dev/test default (mirrors
 * InMemoryCapabilityStore / InMemoryCaptureLedger); @bridge/db binds a
 * Drizzle-backed adapter over the `memories` table, and a Mem0 adapter can bind
 * the same port behind a flag without touching callers.
 */
import type { ContextDataScope } from "../context-provider.js";
import type { Plane, TrustOrigin } from "../types.js";

/** Cognitive kind of a Memory (undefined-elements-definitions-2026-07 §Memory). */
export type MemoryType = "episodic" | "semantic" | "procedural" | "preference";

/** What a Memory was derived from — the provenance back-link. */
export type MemorySourceRefType = "timeline_entry" | "ledger" | "feedback";

/**
 * Classification governs who may read a Memory. Reuses the kernel's canonical
 * `ContextDataScope` union (public|organization|team|private|restricted) so Memory
 * scoping never drifts from context-capture scoping.
 */
export type MemoryClassification = ContextDataScope;

/** The input shape for writing a Memory. `createdAt` is assigned by the store
 * when omitted; `supersedesId` is set only via `supersede()`, never `write()`. */
export interface MemoryWrite {
  id: string;
  organizationId: string;
  type: MemoryType;
  /** The element (Person/Community/Record…) this fact is about, if any. */
  subjectRecordId?: string | null;
  scope: MemoryClassification;
  content: string;
  sourceRefType?: MemorySourceRefType | null;
  sourceRefId?: string | null;
  /** The writer's own confidence in the fact, 0..1. */
  confidence: number;
  /** Provenance / trust origin of the content this Memory was derived from
   * (PI-1). Untrusted-by-default for anything not user/kernel authored. */
  trustOrigin: TrustOrigin;
  plane: Plane;
  /** Provenance actor: the provider/agent/user id that produced this Memory. */
  createdBy: string;
  /** Owner for authority-scoping team/private/restricted reads. */
  ownerUserId?: string | null;
  createdAt?: string;
}

/** A persisted Memory row. */
export interface MemoryEntry extends MemoryWrite {
  /** Set when this row supersedes an earlier Memory (append-only correction). */
  supersedesId?: string | null;
  createdAt: string;
  /** TASK-010 review round-5/6/7 — durable, DB-backed per-lineage ordering.
   * Allocated ATOMICALLY by `casSupersede` (never by a caller — absent from
   * `MemoryWrite`, only ever set by the store itself): `(current?.lineageRevision
   * ?? 0) + 1` for the SAME (organizationId, ownerUserId, subjectRecordId) triple
   * `currentForLineage`/`casSupersede` already key a lineage on, computed
   * inside the same transaction/turn that already establishes the lineage's
   * current head — correct across any number of processes/restarts, unlike a
   * process-local counter. `null`/`undefined` on any row NOT written through
   * `casSupersede` (most Memory writes aren't lineage-tracked) or written
   * before this column existed — ALWAYS treated as "older than any allocated
   * revision" by `compareLineageRevisionOrder`, so within one lineage's own
   * history a legacy un-revisioned row still sorts oldest-first correctly. */
  lineageRevision?: number | null;
}

export interface MemoryQuery {
  type?: MemoryType;
  subjectRecordId?: string;
  /** Filter to rows derived from one MemorySourceRefType — e.g. `"feedback"`
   * to push a "kind of correction" filter into the store's own query instead
   * of fetching an unbounded page and scanning `content` app-side (TASK-010
   * review item 6: "dedicated server-side red-flag filtering before
   * limiting"). */
  sourceRefType?: MemorySourceRefType;
  /**
   * Structured-content equality predicates pushed into the store's OWN
   * query rather than scanned app-side over an unbounded/artificially
   * capped page (TASK-010 review round-4 item 7: "extend Memory query
   * support for structured red-flag metadata (JSON predicates acceptable
   * without migration)"). Each entry is a dot-path into the Memory's opaque
   * JSON `content` (e.g. `{ path: "anchor.moduleId", equals: "record" }`)
   * — every predicate must match (AND). No schema migration needed:
   * `content` stays free-form text; the persistent adapter casts it to
   * `jsonb` at query time (`content::jsonb #>> '{a,b}'`), the in-memory
   * adapter walks the parsed object. Path segments are always supplied by
   * TRUSTED SERVER CODE (never a raw client string), so no injection
   * surface exists even though the persistent adapter embeds the path in
   * the query text.
   */
  contentPathEquals?: Array<{ path: string; equals: string }>;
  /** Include rows that have been superseded by a newer row. Default false —
   * retrieval returns only the CURRENT set of facts. */
  includeSuperseded?: boolean;
  /** Inclusive read watermark used to keep offset pages stable while newer rows arrive. */
  snapshotAt?: string;
  /** Sort order for `createdAt` (ties broken by `id`) — default `"desc"`
   * (newest first, the pre-existing behavior every caller before TASK-010
   * review round-4 relied on). `"asc"` (oldest first) is what a full,
   * paginated lineage `history` needs (review item 8). */
  order?: "asc" | "desc";
  /**
   * Keyset cursor (review item 8): return only rows strictly BEYOND this
   * `(createdAt, id)` position in the requested `order` — i.e. strictly
   * older than the cursor for `"desc"`, strictly newer for `"asc"`. Stable
   * under concurrent insert/supersede between page fetches, unlike
   * `offset`, which can duplicate or omit rows when the underlying set
   * changes mid-pagination. Takes precedence over `offset` when both are
   * supplied (a caller should pass one or the other, not both).
   */
  cursor?: { createdAt: string; id: string; lineageRevision?: number | null };
  limit?: number;
  /** @deprecated prefer `cursor` (keyset) for anything paginated across
   * multiple requests — offset pagination is still supported for the few
   * remaining internal callers that fetch a single bounded page and never
   * paginate further. */
  offset?: number;
  /**
   * TASK-010 review round-7 ("durable lineage ordering"): which key
   * `order`/`cursor` sorts and paginates by. `"createdAt"` (default) is the
   * GLOBAL total order used for cross-lineage listings (e.g. the red-flag
   * audit list) — always valid, never ambiguous. `"lineageRevision"` is
   * ONLY meaningful for a query already scoped to ONE lineage (i.e. a
   * `subjectRecordId` filter identifying a single (organizationId,
   * ownerUserId, subjectRecordId) lineage) — `lineage_revision` values are
   * allocated per-lineage (every lineage's first row is revision 1), so
   * comparing them ACROSS different lineages would be meaningless. Callers
   * MUST NOT set `orderBy: "lineageRevision"` on a query spanning more than
   * one lineage. Both adapters treat a `null` revision (a legacy row
   * written before this column existed, or any non-lineage-tracked write)
   * as older than any allocated revision.
   */
  orderBy?: "createdAt" | "lineageRevision";
}

/** Total order used for keyset pagination: `createdAt` first, `id` as a
 * stable tiebreaker (two rows can share a `createdAt` timestamp, especially
 * in fast test suites). Shared by both adapters so their pagination
 * semantics agree exactly. */
function compareMemoryOrder(a: { createdAt: string; id: string }, b: { createdAt: string; id: string }): number {
  const c = a.createdAt.localeCompare(b.createdAt);
  return c !== 0 ? c : a.id.localeCompare(b.id);
}

/** Per-lineage total order (review round-7): `lineage_revision` first (a
 * `null`/`undefined` revision always sorts OLDER than any allocated one,
 * regardless of requested direction — both adapters' `order === "asc"`/
 * `"desc"` negate this SAME comparator rather than re-deriving the
 * null-handling twice), `id` as the stable tiebreaker. Only valid for a
 * query already scoped to one lineage — see `MemoryQuery.orderBy`'s doc. */
function compareLineageRevisionOrder(
  a: { lineageRevision?: number | null; id: string },
  b: { lineageRevision?: number | null; id: string },
): number {
  const ra = a.lineageRevision ?? null;
  const rb = b.lineageRevision ?? null;
  if (ra === null && rb === null) return a.id.localeCompare(b.id);
  if (ra === null) return -1;
  if (rb === null) return 1;
  return ra !== rb ? ra - rb : a.id.localeCompare(b.id);
}

/** Safe (no `eval`, no prototype-pollution) dot-path walk of a JSON-parsed
 * value — mirrors what the persistent adapter's `#>>` path extraction does
 * against `content::jsonb`. Returns `undefined` for a missing/non-object
 * intermediate path segment (never throws). */
function getJsonPath(value: unknown, path: string): unknown {
  let cursor: unknown = value;
  for (const segment of path.split(".")) {
    if (cursor === null || typeof cursor !== "object") return undefined;
    cursor = (cursor as Record<string, unknown>)[segment];
  }
  return cursor;
}

/** Shared by both adapters: does this Memory's parsed `content` satisfy
 * every `contentPathEquals` predicate? A row whose `content` isn't valid
 * JSON never matches any predicate (fails closed, never throws). */
export function matchesContentPathEquals(content: string, predicates: Array<{ path: string; equals: string }> | undefined): boolean {
  if (!predicates || predicates.length === 0) return true;
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    return false;
  }
  return predicates.every((p) => getJsonPath(parsed, p.path) === p.equals);
}

/**
 * The authority a caller reads Memory under. `userId` absent = a system/no-user
 * context, which may read only public/organization-classified Memories.
 */
export interface MemoryAuthScope {
  organizationId: string;
  userId?: string | null;
}

/**
 * Thrown by `compareAndSupersede` when a CONCURRENT writer — in this process
 * OR, for the Drizzle-backed adapter, a genuinely different process/instance
 * sharing the same Postgres/pglite database — already superseded `id` first.
 * Distinct from the plain `Error` `supersede()` throws for "unknown id" or
 * "organization/owner mismatch", so callers can distinguish "lost a real race"
 * (retry/reconcile) from "this call was simply malformed" (bug).
 */
export class MemoryConflictError extends Error {
  constructor(public readonly id: string) {
    super(`memory store: id ${id} was already superseded by a concurrent writer`);
    this.name = "MemoryConflictError";
  }
}

export interface MemoryStore {
  /** Write a new Memory (candidate or confirmed). */
  write(entry: MemoryWrite): Promise<MemoryEntry>;
  /** Append a correcting Memory that supersedes `id` (append-only: the prior
   * row is retained, tagged as superseded by the returned row). NOT
   * cross-instance-safe on its own — two concurrent callers can both
   * supersede the same `id` (see `compareAndSupersede` for the guarded
   * variant). Kept for single-writer call sites that don't need the
   * cross-instance guarantee. */
  supersede(id: string, next: MemoryWrite): Promise<MemoryEntry>;
  /**
   * Cross-instance-safe compare-and-supersede (TASK-011 remediation,
   * 2026-07-19 distributed-defects review) — atomically verifies `id` is
   * still the CURRENT (non-superseded) row before writing `next` as its
   * successor, and throws `MemoryConflictError` (never silently produces two
   * "current" rows for one lineage) if a concurrent writer — in this
   * process or, for the Drizzle adapter, a genuinely different API instance
   * sharing the same database — already won. Any durable state machine that
   * must stay correct across multiple API instances (not just multiple
   * concurrent calls within one process) MUST use this, not `supersede`.
   */
  compareAndSupersede(id: string, next: MemoryWrite): Promise<MemoryEntry>;
  /**
   * Cross-instance-safe FIRST-INSERT-WINS write, keyed by `entry.subjectRecordId`
   * (TASK-011 remediation, 2026-07-19 coordinator distributed-defects
   * re-review — a genuine TOCTOU `compareAndSupersede` cannot close, since it
   * only guards updates to an EXISTING known row, not "is this the first
   * writer for a not-yet-existing key"). Atomically checks whether a current
   * (non-superseded) row already exists for `(entry.organizationId,
   * entry.subjectRecordId)`; if so, returns that EXISTING row unchanged
   * (idempotent create — never a second "current" row for the same key). If
   * not, inserts `entry` and returns it. Two callers racing to create the
   * FIRST row for the same key can never both win — exactly one insert
   * happens, mirroring `compareAndSupersede`'s guarantee but for the
   * creation case rather than the transition case.
   */
  writeIfAbsent(entry: MemoryWrite): Promise<MemoryEntry>;
  /** Fetch one Memory, authority-scoped — returns null if the caller may not
   * read it (indistinguishable from "not found", by design). */
  get(id: string, authScope: MemoryAuthScope): Promise<MemoryEntry | null>;
  /** List current Memories the caller is authorized to read, newest first. */
  retrieve(query: MemoryQuery, authScope: MemoryAuthScope): Promise<MemoryEntry[]>;
  /** Permanently forget a Memory the caller may read. Personal-data deletion is
   * the deliberate exception to append-only correction history. */
  forget(id: string, authScope: MemoryAuthScope): Promise<boolean>;
  /**
   * Redacts, IN PLACE (never via a new `supersede`/`compareAndSupersede`
   * row), the `content` of every row in `id`'s FULL correction lineage —
   * TASK-011 remediation (coordinator central-merge review, issue 2).
   * `compareAndSupersede`'s normal "purge the current view" pattern only
   * ever rewrites the CURRENT row by inserting a new successor; every
   * ANCESTOR row in the lineage (in particular whichever row first held
   * sensitive/expired raw bytes, e.g. a fetched external artifact) remains
   * completely unredacted and durably readable via
   * `retrieve({ includeSuperseded: true })` — a genuine retention/privacy
   * gap for anything whose raw content must not outlive its retention
   * window. This method walks the SAME bidirectional lineage `forget()`
   * uses (ancestors AND descendants of `id`, scoped to the SAME organization
   * + owner as `id`'s own row — never a broad, unrelated-Memory purge) and,
   * for each row, calls `redact(entry)`: a `null` return leaves that row's
   * content completely untouched (the caller's chosen retention rule did
   * not apply to it — e.g. content already redacted, or a different record
   * kind entirely happens to share this lineage's key space); a non-null,
   * different string REPLACES that row's `content` in place, preserving
   * every other field (id, timestamps, `supersedesId` chain, scope,
   * `sourceRefType`/`sourceRefId`, confidence, `trustOrigin`, `plane`,
   * `createdBy`, `ownerUserId`) so citations/audit/history remain fully
   * intact — only the sensitive bytes are gone, permanently, from every
   * physical row that ever held them. `redact` MUST be a pure, idempotent
   * function of its input (the same entry always produces the same
   * redacted content, or the same `null`) — this is what makes concurrent/
   * repeated calls from multiple instances safe without an additional
   * cross-instance lock: every caller converges on the identical final
   * state regardless of interleaving. Returns the number of rows actually
   * modified (0 if `id` is unknown/unauthorized, or every lineage row's
   * `redact` result was `null`/unchanged).
   */
  redactLineageContent(
    id: string,
    authScope: MemoryAuthScope,
    redact: (entry: MemoryEntry) => string | null,
  ): Promise<number>;
  /** The current (non-superseded) row for one (organizationId, ownerUserId,
   * lineageKey) lineage, or null if none exists yet. Internal/server-side
   * lookup backing `casSupersede`'s own compare step — deliberately takes no
   * `MemoryAuthScope` and is not a general read path; callers needing an
   * authority-scoped read still go through `get()`/`retrieve()`. CONTRACT:
   * every `MemoryWrite` passed through `casSupersede` for this lineage MUST
   * set `subjectRecordId` to the SAME `lineageKey` — adapters locate the
   * lineage by (organizationId, ownerUserId, subjectRecordId), so a caller
   * that omits or changes it breaks its own lineage's CAS guarantee. */
  currentForLineage(organizationId: string, ownerUserId: string, lineageKey: string): Promise<MemoryEntry | null>;
  /**
   * Atomic optimistic-concurrency create-or-supersede over one lineage
   * (organizationId, ownerUserId, lineageKey). At most one non-superseded row
   * may exist per lineage at a time — this is the ONLY sanctioned way to
   * mutate a lineage-tracked Memory when more than one caller could race
   * (e.g. a red flag's create/clear/reopen/update). Pass
   * `expectedCurrentId: null` to create the FIRST row for the lineage
   * (fails/returns null if one already exists); pass the id last read via
   * `currentForLineage()`/the prior call's result to supersede it
   * (fails/returns null if someone else already moved the lineage forward
   * in between — the id is stale). Returns `null` on CAS failure instead of
   * forking history; the caller must re-read and retry, never blindly force
   * the write. Implementations MUST provide this atomically via real
   * database-level concurrency control (a transaction/serializable
   * isolation, a unique constraint, etc.) — NEVER a process-local lock,
   * since multiple server processes/connections can race concurrently.
   */
  casSupersede(params: {
    organizationId: string;
    ownerUserId: string;
    lineageKey: string;
    expectedCurrentId: string | null;
    next: MemoryWrite;
  }): Promise<MemoryEntry | null>;
}

/**
 * Authority predicate — the single source of truth for Memory read visibility,
 * shared by every adapter so in-memory and Drizzle agree. Mirrors the DB's
 * `app_private.visible_relationship_row` (migrations/0008_rls_as_code.sql):
 * tenant match always required; public/organization visible to any member;
 * team/private/restricted visible only to the owner.
 */
export function memoryVisible(entry: MemoryEntry, authScope: MemoryAuthScope): boolean {
  if (entry.organizationId !== authScope.organizationId) return false;
  switch (entry.scope) {
    case "public":
    case "organization":
      return true;
    case "team":
    case "private":
    case "restricted":
      return authScope.userId != null && entry.ownerUserId === authScope.userId;
    default:
      return false;
  }
}

/** In-memory `MemoryStore` — dev/test default (mirrors InMemoryCapabilityStore). */
export class InMemoryMemoryStore implements MemoryStore {
  readonly entries: MemoryEntry[] = [];

  async write(entry: MemoryWrite): Promise<MemoryEntry> {
    return this.#insert(entry, null);
  }

  async supersede(id: string, next: MemoryWrite): Promise<MemoryEntry> {
    const current = this.entries.find((e) => e.id === id);
    if (!current) {
      throw new Error(`memory store: cannot supersede unknown id ${id}`);
    }
    if (current.organizationId !== next.organizationId || current.ownerUserId !== next.ownerUserId) {
      throw new Error("memory store: a correction cannot change organization or owner");
    }
    const successor = this.entries.find((entry) => entry.supersedesId === id);
    if (successor) {
      if (
        successor.id === next.id &&
        successor.organizationId === next.organizationId &&
        successor.type === next.type &&
        successor.subjectRecordId === next.subjectRecordId &&
        successor.scope === next.scope &&
        successor.content === next.content &&
        successor.sourceRefType === next.sourceRefType &&
        successor.sourceRefId === next.sourceRefId &&
        successor.confidence === next.confidence &&
        successor.trustOrigin === next.trustOrigin &&
        successor.plane === next.plane &&
        successor.createdBy === next.createdBy &&
        successor.ownerUserId === next.ownerUserId &&
        successor.createdAt === (next.createdAt ?? successor.createdAt)
      ) {
        return { ...successor };
      }
      throw new Error(`memory store: ${id} already has a different successor`);
    }
    return this.#insert(next, id);
  }

  async compareAndSupersede(id: string, next: MemoryWrite): Promise<MemoryEntry> {
    // Synchronous read-check-write (no `await` between them) is what makes
    // this atomic within a single process — matches the same pattern used
    // elsewhere in this codebase (e.g. InMemoryChildAgentRunStore.consumeBudget)
    // to close a check-then-act race. This adapter is dev/test-only and never
    // shared across real separate processes, so this is the correct (and
    // sufficient) guarantee for it; the Drizzle adapter provides the actual
    // cross-instance guarantee via a Postgres advisory lock.
    const current = this.entries.find((e) => e.id === id);
    if (!current) {
      throw new Error(`memory store: cannot supersede unknown id ${id}`);
    }
    if (current.organizationId !== next.organizationId || current.ownerUserId !== next.ownerUserId) {
      throw new Error("memory store: a correction cannot change organization or owner");
    }
    const alreadySuperseded = this.entries.some((e) => e.supersedesId === id);
    if (alreadySuperseded) {
      throw new MemoryConflictError(id);
    }
    return this.#insert(next, id);
  }

  async writeIfAbsent(entry: MemoryWrite): Promise<MemoryEntry> {
    // Same synchronous check-then-write guarantee as `compareAndSupersede`
    // above (no `await` between the "does a current row already exist"
    // check and the insert) — sufficient for this process-only adapter.
    const superseded = new Set(
      this.entries.map((e) => e.supersedesId).filter((v): v is string => v != null),
    );
    const existing = this.entries.find(
      (e) => e.organizationId === entry.organizationId && e.subjectRecordId === entry.subjectRecordId && !superseded.has(e.id),
    );
    if (existing) return { ...existing };
    return this.#insert(entry, null);
  }

  async get(id: string, authScope: MemoryAuthScope): Promise<MemoryEntry | null> {
    const row = this.entries.find((e) => e.id === id);
    if (!row || !memoryVisible(row, authScope)) return null;
    return { ...row };
  }

  async retrieve(query: MemoryQuery, authScope: MemoryAuthScope): Promise<MemoryEntry[]> {
    const snapshotEntries = query.snapshotAt
      ? this.entries.filter((entry) => entry.createdAt <= query.snapshotAt!)
      : this.entries;
    const superseded = new Set(
      snapshotEntries.map((e) => e.supersedesId).filter((v): v is string => v != null),
    );
    let rows = snapshotEntries.filter((e) => memoryVisible(e, authScope));
    if (!query.includeSuperseded) rows = rows.filter((e) => !superseded.has(e.id));
    if (query.type) rows = rows.filter((e) => e.type === query.type);
    if (query.subjectRecordId) rows = rows.filter((e) => e.subjectRecordId === query.subjectRecordId);
    if (query.sourceRefType) rows = rows.filter((e) => e.sourceRefType === query.sourceRefType);
    if (query.contentPathEquals) rows = rows.filter((e) => matchesContentPathEquals(e.content, query.contentPathEquals));
    const order = query.order ?? "desc";
    const cmp = query.orderBy === "lineageRevision" ? compareLineageRevisionOrder : compareMemoryOrder;
    rows = rows.sort((a, b) => (order === "asc" ? cmp(a, b) : cmp(b, a)));
    if (query.cursor) {
      // Keyset: keep only rows strictly BEYOND the cursor in the requested
      // order (review item 8) — stable under concurrent insert/supersede
      // between page fetches, unlike an offset (which shifts once the
      // underlying set changes size).
      const cursor = query.cursor;
      rows = rows.filter((e) => {
        const c = cmp(e, cursor);
        return order === "asc" ? c > 0 : c < 0;
      });
    }
    const offset = query.cursor ? 0 : (query.offset ?? 0);
    const limit = query.limit ?? rows.length;
    return rows.slice(offset, offset + limit).map((e) => ({ ...e }));
  }

  /** Shared bidirectional lineage walk (ancestors AND descendants of `id`,
   * scoped to the same organization + owner) — factored out so `forget()`
   * (full deletion) and `redactLineageContent()` (in-place content
   * redaction) can never silently diverge on WHICH rows count as "this
   * lineage." Returns `null` if `id` is unknown or not visible to
   * `authScope` (mirrors `forget()`'s prior inline behavior exactly). */
  #lineageIds(id: string, authScope: MemoryAuthScope): Set<string> | null {
    const target = this.entries.find((e) => e.id === id && memoryVisible(e, authScope));
    if (!target) return null;
    const lineage = new Set([id]);
    let changed = true;
    while (changed) {
      changed = false;
      for (const entry of this.entries) {
        if (lineage.has(entry.id) || !memoryVisible(entry, authScope) || entry.ownerUserId !== target.ownerUserId) continue;
        if ((entry.supersedesId && lineage.has(entry.supersedesId)) ||
            [...lineage].some((lineageId) => this.entries.find((candidate) => candidate.id === lineageId)?.supersedesId === entry.id)) {
          lineage.add(entry.id);
          changed = true;
        }
      }
    }
    return lineage;
  }

  async forget(id: string, authScope: MemoryAuthScope): Promise<boolean> {
    const lineage = this.#lineageIds(id, authScope);
    if (!lineage) return false;
    for (let index = this.entries.length - 1; index >= 0; index -= 1) {
      if (lineage.has(this.entries[index]!.id)) this.entries.splice(index, 1);
    }
    return true;
  }

  async redactLineageContent(
    id: string,
    authScope: MemoryAuthScope,
    redact: (entry: MemoryEntry) => string | null,
  ): Promise<number> {
    const lineage = this.#lineageIds(id, authScope);
    if (!lineage) return 0;
    let redactedCount = 0;
    for (const entry of this.entries) {
      if (!lineage.has(entry.id)) continue;
      const redacted = redact({ ...entry });
      if (redacted == null || redacted === entry.content) continue;
      // In-place mutation of the SAME row object — never a new `entries`
      // element, never touching `supersedesId`/timestamps/scope/etc. `entries`
      // itself is a `readonly` ARRAY reference (cannot be reassigned), not a
      // deep-frozen structure — its elements remain genuinely mutable, which
      // is exactly what this method needs (an in-place rewrite, not a new
      // lineage member).
      entry.content = redacted;
      redactedCount += 1;
    }
    return redactedCount;
  }

  /** Computed the same way `retrieve()`'s superseded-set/emptiness logic
   * already works: the CONTRACT (documented on the `MemoryStore` interface)
   * is that a lineage-tracked write always sets `next.subjectRecordId` to
   * the lineage key, so both this in-memory adapter and the Drizzle
   * adapter (which has no separate lineage column) can locate "the current
   * row" the same way — by (organizationId, ownerUserId, subjectRecordId)
   * plus "nothing else supersedes it." */
  async currentForLineage(organizationId: string, ownerUserId: string, lineageKey: string): Promise<MemoryEntry | null> {
    return this.#currentForLineageSync(organizationId, ownerUserId, lineageKey);
  }

  #currentForLineageSync(organizationId: string, ownerUserId: string, lineageKey: string): MemoryEntry | null {
    const superseded = new Set(this.entries.map((e) => e.supersedesId).filter((v): v is string => v != null));
    const row = this.entries.find(
      (e) =>
        e.organizationId === organizationId &&
        e.ownerUserId === ownerUserId &&
        e.subjectRecordId === lineageKey &&
        !superseded.has(e.id),
    );
    return row ? { ...row } : null;
  }

  /**
   * No `await` occurs ANYWHERE in this method's body — deliberately, and
   * critically: `currentForLineage()` (the public, async-signatured method)
   * is NOT called here, because `await`ing even an already-resolved Promise
   * still yields to the microtask queue, which would let a second
   * "concurrent" caller's own read interleave BEFORE the first caller's
   * write (confirmed by a failing test during development — two
   * `Promise.all`-raced calls both read stale state and both "won"). Using
   * the synchronous `#currentForLineageSync` twin instead closes that gap:
   * exactly the same TOCTOU-closing technique `InMemoryLedger.append()`
   * already uses (see its doc comment) — two "concurrent" callers each get
   * their own microtask when this async method first suspends (at its own
   * call boundary), but since NOTHING inside this method's body yields
   * control between the compare and the mutate, whichever caller's turn
   * runs first completes its entire read+write atomically before the
   * second caller's turn begins, so the in-memory adapter's single JS
   * event loop gives this the same atomicity a real database transaction
   * gives the persistent adapter.
   */
  async casSupersede(params: {
    organizationId: string;
    ownerUserId: string;
    lineageKey: string;
    expectedCurrentId: string | null;
    next: MemoryWrite;
  }): Promise<MemoryEntry | null> {
    const current = this.#currentForLineageSync(params.organizationId, params.ownerUserId, params.lineageKey);
    if ((current?.id ?? null) !== params.expectedCurrentId) return null;
    // review round-7: atomically allocate the next per-lineage revision in
    // the SAME synchronous turn as the compare above (no `await` between
    // read and write here — see this method's own doc comment) — the exact
    // same TOCTOU-closing technique already used for the CAS compare itself.
    const nextRevision = (current?.lineageRevision ?? 0) + 1;
    return this.#insert(params.next, params.expectedCurrentId, nextRevision);
  }

  #insert(entry: MemoryWrite, supersedesId: string | null, lineageRevision: number | null = null): MemoryEntry {
    if (this.entries.some((e) => e.id === entry.id)) {
      throw new Error(`memory store: duplicate id ${entry.id} (append-only violation)`);
    }
    const full: MemoryEntry = {
      ...entry,
      supersedesId,
      createdAt: entry.createdAt ?? new Date().toISOString(),
      ...(lineageRevision != null ? { lineageRevision } : {}),
    };
    this.entries.push(full);
    return { ...full };
  }
}
