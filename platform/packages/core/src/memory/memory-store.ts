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
 * public/workspace → any member; team/private/restricted → owner-only (finer
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
 * `ContextDataScope` union (public|workspace|team|private|restricted) so Memory
 * scoping never drifts from context-capture scoping.
 */
export type MemoryClassification = ContextDataScope;

/** The input shape for writing a Memory. `createdAt` is assigned by the store
 * when omitted; `supersedesId` is set only via `supersede()`, never `write()`. */
export interface MemoryWrite {
  id: string;
  workspaceId: string;
  type: MemoryType;
  /** The element (Person/Community/Initiative…) this fact is about, if any. */
  subjectElementId?: string | null;
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
   * ?? 0) + 1` for the SAME (workspaceId, ownerUserId, subjectElementId) triple
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
  subjectElementId?: string;
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
   * JSON `content` (e.g. `{ path: "anchor.moduleId", equals: "initiative" }`)
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
   * `subjectElementId` filter identifying a single (workspaceId,
   * ownerUserId, subjectElementId) lineage) — `lineage_revision` values are
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
 * context, which may read only public/workspace-classified Memories.
 */
export interface MemoryAuthScope {
  workspaceId: string;
  userId?: string | null;
}

export interface MemoryStore {
  /** Write a new Memory (candidate or confirmed). */
  write(entry: MemoryWrite): Promise<MemoryEntry>;
  /** Append a correcting Memory that supersedes `id` (append-only: the prior
   * row is retained, tagged as superseded by the returned row). */
  supersede(id: string, next: MemoryWrite): Promise<MemoryEntry>;
  /** Fetch one Memory, authority-scoped — returns null if the caller may not
   * read it (indistinguishable from "not found", by design). */
  get(id: string, authScope: MemoryAuthScope): Promise<MemoryEntry | null>;
  /** List current Memories the caller is authorized to read, newest first. */
  retrieve(query: MemoryQuery, authScope: MemoryAuthScope): Promise<MemoryEntry[]>;
  /** Permanently forget a Memory the caller may read. Personal-data deletion is
   * the deliberate exception to append-only correction history. */
  forget(id: string, authScope: MemoryAuthScope): Promise<boolean>;
  /** The current (non-superseded) row for one (workspaceId, ownerUserId,
   * lineageKey) lineage, or null if none exists yet. Internal/server-side
   * lookup backing `casSupersede`'s own compare step — deliberately takes no
   * `MemoryAuthScope` and is not a general read path; callers needing an
   * authority-scoped read still go through `get()`/`retrieve()`. CONTRACT:
   * every `MemoryWrite` passed through `casSupersede` for this lineage MUST
   * set `subjectElementId` to the SAME `lineageKey` — adapters locate the
   * lineage by (workspaceId, ownerUserId, subjectElementId), so a caller
   * that omits or changes it breaks its own lineage's CAS guarantee. */
  currentForLineage(workspaceId: string, ownerUserId: string, lineageKey: string): Promise<MemoryEntry | null>;
  /**
   * Atomic optimistic-concurrency create-or-supersede over one lineage
   * (workspaceId, ownerUserId, lineageKey). At most one non-superseded row
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
    workspaceId: string;
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
 * tenant match always required; public/workspace visible to any member;
 * team/private/restricted visible only to the owner.
 */
export function memoryVisible(entry: MemoryEntry, authScope: MemoryAuthScope): boolean {
  if (entry.workspaceId !== authScope.workspaceId) return false;
  switch (entry.scope) {
    case "public":
    case "workspace":
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
    if (current.workspaceId !== next.workspaceId || current.ownerUserId !== next.ownerUserId) {
      throw new Error("memory store: a correction cannot change workspace or owner");
    }
    const successor = this.entries.find((entry) => entry.supersedesId === id);
    if (successor) {
      if (
        successor.id === next.id &&
        successor.workspaceId === next.workspaceId &&
        successor.type === next.type &&
        successor.subjectElementId === next.subjectElementId &&
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
    if (query.subjectElementId) rows = rows.filter((e) => e.subjectElementId === query.subjectElementId);
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

  async forget(id: string, authScope: MemoryAuthScope): Promise<boolean> {
    const target = this.entries.find((e) => e.id === id && memoryVisible(e, authScope));
    if (!target) return false;
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
    for (let index = this.entries.length - 1; index >= 0; index -= 1) {
      if (lineage.has(this.entries[index]!.id)) this.entries.splice(index, 1);
    }
    return true;
  }

  /** Computed the same way `retrieve()`'s superseded-set/emptiness logic
   * already works: the CONTRACT (documented on the `MemoryStore` interface)
   * is that a lineage-tracked write always sets `next.subjectElementId` to
   * the lineage key, so both this in-memory adapter and the Drizzle
   * adapter (which has no separate lineage column) can locate "the current
   * row" the same way — by (workspaceId, ownerUserId, subjectElementId)
   * plus "nothing else supersedes it." */
  async currentForLineage(workspaceId: string, ownerUserId: string, lineageKey: string): Promise<MemoryEntry | null> {
    return this.#currentForLineageSync(workspaceId, ownerUserId, lineageKey);
  }

  #currentForLineageSync(workspaceId: string, ownerUserId: string, lineageKey: string): MemoryEntry | null {
    const superseded = new Set(this.entries.map((e) => e.supersedesId).filter((v): v is string => v != null));
    const row = this.entries.find(
      (e) =>
        e.workspaceId === workspaceId &&
        e.ownerUserId === ownerUserId &&
        e.subjectElementId === lineageKey &&
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
    workspaceId: string;
    ownerUserId: string;
    lineageKey: string;
    expectedCurrentId: string | null;
    next: MemoryWrite;
  }): Promise<MemoryEntry | null> {
    const current = this.#currentForLineageSync(params.workspaceId, params.ownerUserId, params.lineageKey);
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
