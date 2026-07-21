/**
 * DrizzleMemoryStore — binds the core `MemoryStore` port (@bridge/core's
 * memory/memory-store.ts) to the `memories` table (schema.ts). The pglite/
 * Postgres default adapter; a Mem0 adapter can bind the same port behind a flag.
 *
 * Authority scoping is pushed into the SQL WHERE (NOT post-filtered): retrieve/
 * get build the visibility predicate — public/organization visible to any member,
 * team/private/restricted visible only to the owner — so a caller never receives
 * a row it may not read. This mirrors @bridge/core's `memoryVisible` predicate
 * and the DB's own `app_private.visible_relationship_row` (migrations/0008),
 * with RLS (migrations/0009) as the defense-in-depth floor beneath it.
 *
 * `confidence` is a numeric column (Drizzle surfaces it as a string): unpack
 * Number()-izes on read, `#insert` stringifies on write.
 */
import { and, asc, desc, eq, inArray, lte, or, sql, type SQL } from "drizzle-orm";
import {
  MemoryConflictError,
  type MemoryAuthScope,
  type MemoryClassification,
  type MemoryEntry,
  type MemoryQuery,
  type MemorySourceRefType,
  type MemoryStore,
  type MemoryType,
  type MemoryWrite,
  type Plane,
  type TrustOrigin,
  labelFromLegacyTrustOrigin,
  storedTaintLabelOrUnknown,
} from "@bridge/core";
import type { Database } from "./client.js";
import { memories } from "./schema.js";

/** TASK-010 review round-6 — sets the SAME `app.organization_id`/`app.user_id`
 * session GUCs `graph-store.ts`/`relation-materialization-store.ts` already
 * set for `edges`/`relation_materialization_effects` (and
 * `ledger-store.ts`'s `#withOrganization` already sets for `app.organization_id`
 * alone) — required for `app_private.visible_memory_row`'s
 * `current_user_id()` check to resolve correctly under a REAL, request-
 * scoped (non-superuser-bypass) Postgres role, which `client.ts`'s own doc
 * comment states is the intended production posture ("app requests should
 * run under the member JWT path... or a request-scoped role — service-role
 * bypass is reserved for the derivation pipeline, never the app surface").
 * `SET LOCAL`-equivalent (`is_local = true`) config only takes effect for
 * the remainder of the CURRENT transaction, so every caller below wraps its
 * query in `#db.transaction(...)` (mirroring `DrizzleLedgerStore`'s
 * `#withOrganization`) rather than calling `set_config` as a bare, separate
 * auto-commit statement, which would reset before the following query ever
 * saw it. `userId` is optional — some callers (e.g. a public/organization-scope
 * read with no specific owner in play) have none to set. */
async function withMemoryRlsContext<T>(db: DbLike, organizationId: string, userId: string | null | undefined, operation: (tx: DbLike) => Promise<T>): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`SELECT set_config('app.organization_id', ${organizationId}, true)`);
    if (userId) {
      await tx.execute(sql`SELECT set_config('app.user_id', ${userId}, true)`);
    }
    return operation(tx);
  });
}

const OPEN_SCOPES = ["public", "organization"] as const;
const OWNER_SCOPES = ["team", "private", "restricted"] as const;

function unpack(row: typeof memories.$inferSelect): MemoryEntry {
  return {
    id: row.id,
    organizationId: row.organizationId,
    type: row.type as MemoryType,
    ...(row.subjectRecordId ? { subjectRecordId: row.subjectRecordId } : {}),
    scope: row.scope as MemoryClassification,
    content: row.content,
    ...(row.sourceRefType ? { sourceRefType: row.sourceRefType as MemorySourceRefType } : {}),
    ...(row.sourceRefId ? { sourceRefId: row.sourceRefId } : {}),
    confidence: Number(row.confidence),
    ...(row.supersedesId ? { supersedesId: row.supersedesId } : {}),
    trustOrigin: row.trustOrigin as TrustOrigin,
    taintLabel: storedTaintLabelOrUnknown(row.taintLabel).label,
    plane: row.plane as Plane,
    createdBy: row.createdBy,
    ...(row.ownerUserId ? { ownerUserId: row.ownerUserId } : {}),
    createdAt: row.createdAt.toISOString(),
    ...(row.lineageRevision != null ? { lineageRevision: row.lineageRevision } : {}),
  };
}

/** The read-visibility predicate, pushed into SQL. Tenant match always; then the
 * classification gate (mirrors core's memoryVisible / the DB visibility fn). */
function visibilityWhere(authScope: MemoryAuthScope): SQL {
  const tenant = eq(memories.organizationId, authScope.organizationId);
  const open = inArray(memories.scope, [...OPEN_SCOPES]);
  if (authScope.userId == null) return and(tenant, open) as SQL;
  const owned = and(inArray(memories.scope, [...OWNER_SCOPES]), eq(memories.ownerUserId, authScope.userId));
  return and(tenant, or(open, owned)) as SQL;
}

/** Postgres `text[]` literal for a validated JSON path — used only for
 * `contentPathEquals` (see MemoryQuery's doc comment: paths are always
 * supplied by trusted server code, never a raw client string, but this
 * still fails loudly on anything outside a safe identifier shape rather
 * than trusting that invariant silently). */
function pgTextArrayLiteral(parts: string[]): string {
  const escaped = parts.map((p) => {
    if (!/^[A-Za-z0-9_]+$/.test(p)) {
      throw new Error(`memory store: unsafe contentPathEquals path segment "${p}"`);
    }
    return p;
  });
  return `{${escaped.join(",")}}`;
}

export class DrizzleMemoryStore implements MemoryStore {
  #db: Database;
  constructor(db: Database) {
    this.#db = db;
  }

  async write(entry: MemoryWrite): Promise<MemoryEntry> {
    return withMemoryRlsContext(this.#db, entry.organizationId, entry.ownerUserId, (tx) => this.#insert(entry, null, tx));
  }

  async supersede(id: string, next: MemoryWrite): Promise<MemoryEntry> {
    return withMemoryRlsContext(this.#db, next.organizationId, next.ownerUserId, async (tx) => {
      await tx.execute(
        sql`SELECT pg_advisory_xact_lock(hashtextextended(${id}, 0::bigint))`,
      );
      const current = await tx
        .select({
          organizationId: memories.organizationId,
          ownerUserId: memories.ownerUserId,
        })
        .from(memories)
        .where(eq(memories.id, id))
        .for("update", { of: memories })
        .limit(1);
      if (current.length === 0) {
        throw new Error(`memory store: cannot supersede unknown id ${id}`);
      }
      if (
        current[0]!.organizationId !== next.organizationId ||
        current[0]!.ownerUserId !== (next.ownerUserId ?? null)
      ) {
        throw new Error(
          "memory store: a correction cannot change organization or owner",
        );
      }
      const existingSuccessors = await tx
        .select()
        .from(memories)
        .where(eq(memories.supersedesId, id))
        .orderBy(memories.id)
        .limit(2);
      const existing = existingSuccessors[0];
      if (existing) {
        const sameReplay =
          existingSuccessors.length === 1 &&
          existing.id === next.id &&
          existing.organizationId === next.organizationId &&
          existing.type === next.type &&
          existing.subjectRecordId === (next.subjectRecordId ?? null) &&
          existing.scope === next.scope &&
          existing.content === next.content &&
          existing.sourceRefType === (next.sourceRefType ?? null) &&
          existing.sourceRefId === (next.sourceRefId ?? null) &&
          Number(existing.confidence) === next.confidence &&
          existing.trustOrigin === next.trustOrigin &&
          existing.plane === next.plane &&
          existing.createdBy === next.createdBy &&
          existing.ownerUserId === (next.ownerUserId ?? null) &&
          (
            next.createdAt === undefined ||
            existing.createdAt.toISOString() ===
              new Date(next.createdAt).toISOString()
          );
        if (sameReplay) return unpack(existing);
        throw new Error(
          "memory store: a Memory can have only one current correction",
        );
      }
      return this.#insert(next, id, tx);
    });
  }

  /**
   * Cross-instance-safe compare-and-supersede — TASK-011 remediation
   * (2026-07-19 coordinator distributed-defects review, issue 1). `supersede()`
   * above has NO protection against two concurrent writers (in this process
   * OR, critically, in a DIFFERENT API instance sharing the same Postgres/
   * pglite database) both superseding the SAME `id` — both would succeed,
   * producing two "current" rows for one lineage. This method closes that
   * gap with a REAL cross-instance mutex: `pg_advisory_xact_lock` is a
   * server-side Postgres primitive (pglite is real embedded Postgres, so it
   * works identically there) that serializes EVERY transaction — from any
   * process, not just this one — that requests the same lock key, and is
   * automatically released on commit/rollback. No schema migration is
   * required (this is the deliberate reason to use an advisory lock instead
   * of e.g. a new UNIQUE index — RM4 owns migration 0015; TASK-010 has
   * since landed its own `casSupersede`/`currentForLineage` durable CAS
   * contract below, which this method's callers should prefer for any NEW
   * lineage-tracked write path — this method remains for existing callers
   * keyed by row id rather than a `(organizationId, ownerUserId, lineageKey)`
   * triple).
   */
  async compareAndSupersede(id: string, next: MemoryWrite): Promise<MemoryEntry> {
    return withMemoryRlsContext(this.#db, next.organizationId, next.ownerUserId, async (tx) => {
      // TASK-011 remediation (2026-07-19 coordinator distributed-defects
      // RE-review, issue 9) — canonicalize the UUID INSIDE SQL (`::uuid::text`)
      // BEFORE deriving the lock key. Postgres UUID text input is
      // case-insensitive (and tolerant of some formatting variants), but
      // `hashtext()` operates on the RAW TEXT — two callers referencing the
      // identical row via a differently-cased alias of the SAME UUID (e.g.
      // uppercase vs lowercase hex) would otherwise hash to DIFFERENT lock
      // keys and acquire DIFFERENT advisory locks, silently defeating the
      // mutual exclusion this method exists to provide. Casting through
      // `::uuid` first normalizes to Postgres's own canonical (lowercase,
      // hyphenated) text form, so every alias of the same UUID always
      // derives the identical lock key.
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext((${id}::uuid)::text))`);
      const current = await tx
        .select({ organizationId: memories.organizationId, ownerUserId: memories.ownerUserId })
        .from(memories)
        .where(eq(memories.id, id))
        .limit(1);
      if (current.length === 0) throw new Error(`memory store: cannot supersede unknown id ${id}`);
      if (current[0]!.organizationId !== next.organizationId || current[0]!.ownerUserId !== (next.ownerUserId ?? null)) {
        throw new Error("memory store: a correction cannot change organization or owner");
      }
      const alreadySuperseded = await tx
        .select({ id: memories.id })
        .from(memories)
        .where(eq(memories.supersedesId, id))
        .limit(1);
      if (alreadySuperseded.length > 0) {
        throw new MemoryConflictError(id);
      }
      return this.#insert(next, id, tx);
    });
  }

  /**
   * Cross-instance-safe first-insert-wins write, keyed by
   * `(organizationId, subjectRecordId)` — TASK-011 remediation (2026-07-19
   * coordinator distributed-defects RE-review). `compareAndSupersede` above
   * only guards races against an EXISTING known row id; it cannot close the
   * "two callers both creating the FIRST row for a not-yet-existing key"
   * race (an independent reviewer found this exact gap in
   * `DurableCultureFetchStore.create`/`DurableCultureSynthesisPointerStore.recordProposal`).
   * Locks on `hashtext(organizationId || ':' || subjectRecordId)` (each UUID
   * component individually canonicalized via `::uuid::text` first — issue 9,
   * same alias-collision rationale as `compareAndSupersede` above) — a
   * DIFFERENT lock namespace/key shape than `compareAndSupersede`'s
   * `hashtext(id)` (keyed by row id, not subject key), so the two methods'
   * locks never collide with each other for the same logical entity.
   */
  async writeIfAbsent(entry: MemoryWrite): Promise<MemoryEntry> {
    const subjectRecordId = entry.subjectRecordId;
    if (!subjectRecordId) {
      throw new Error("memory store: writeIfAbsent requires entry.subjectRecordId as its dedup key");
    }
    const organizationId = entry.organizationId;
    return withMemoryRlsContext(this.#db, organizationId, entry.ownerUserId, async (tx) => {
      await tx.execute(
        sql`SELECT pg_advisory_xact_lock(hashtext((${organizationId}::uuid)::text || ':' || (${subjectRecordId}::uuid)::text))`,
      );
      const existingRows = await tx
        .select()
        .from(memories)
        .where(
          and(
            eq(memories.organizationId, entry.organizationId),
            eq(memories.subjectRecordId, subjectRecordId),
            sql`NOT EXISTS (SELECT 1 FROM ${memories} AS m2 WHERE m2.supersedes_id = ${memories.id})`,
          ),
        )
        .orderBy(desc(memories.createdAt))
        .limit(1);
      const existing = existingRows[0];
      if (existing) return unpack(existing);
      return this.#insert(entry, null, tx);
    });
  }


  async get(id: string, authScope: MemoryAuthScope): Promise<MemoryEntry | null> {
    return withMemoryRlsContext(this.#db, authScope.organizationId, authScope.userId, async (tx) => {
      const rows = await tx
        .select()
        .from(memories)
        .where(and(eq(memories.id, id), visibilityWhere(authScope)))
        .limit(1);
      const row = rows[0];
      return row ? unpack(row) : null;
    });
  }

  async retrieve(query: MemoryQuery, authScope: MemoryAuthScope): Promise<MemoryEntry[]> {
    return withMemoryRlsContext(this.#db, authScope.organizationId, authScope.userId, async (tx) => {
    const conds: SQL[] = [visibilityWhere(authScope)];
    if (!query.includeSuperseded) {
      conds.push(sql`NOT EXISTS (
        SELECT 1
        FROM ${memories} AS m2
        WHERE m2.supersedes_id = ${memories.id}
          ${query.snapshotAt
            ? sql`AND m2.created_at <= ${new Date(query.snapshotAt)}`
            : sql``}
      )`);
    }
    if (query.type) conds.push(eq(memories.type, query.type));
    if (query.subjectRecordId) conds.push(eq(memories.subjectRecordId, query.subjectRecordId));
    if (query.snapshotAt) {
      conds.push(lte(memories.createdAt, new Date(query.snapshotAt)));
    }
    if (query.sourceRefType) conds.push(eq(memories.sourceRefType, query.sourceRefType));
    // review round-4 item 7 / round-5 item 8: push structured JSON
    // predicates into the SQL WHERE (no schema migration) rather than
    // scanning an unbounded/capped page app-side — but NEVER cast arbitrary
    // `content` to `jsonb` unconditionally: `memories.content` is a plain
    // `text` column shared by every Memory kind app-wide, so a row from an
    // unrelated write path with genuinely non-JSON content anywhere in the
    // table would throw a cast error for the WHOLE query — Postgres does
    // NOT guarantee left-to-right evaluation of AND-combined conditions (a
    // real, reproduced failure during development: 50 non-JSON
    // `sourceRefType: "feedback"` rows alongside one real red-flag row
    // broke the query even though `sourceRefType = 'feedback'` was ALSO
    // one of the AND'd conditions). `CASE WHEN content IS JSON THEN ... ELSE
    // NULL END` is the fix: `IS JSON` (native SQL/Postgres 16+) is a
    // boolean test, never throws, and CASE — unlike AND/OR — has a
    // SQL-standard-guaranteed sequential evaluation order, so the `::jsonb`
    // cast is provably never reached for non-JSON content regardless of
    // query plan. `path` always comes from trusted server code (see
    // MemoryQuery's doc comment) — the array itself is still a bound
    // parameter, never string-concatenated. This is the app-layer interim;
    // the durable fix (a real, validated JSONB/structured column) is
    // deferred to the post-RM4 migration per the review that flagged this.
    for (const predicate of query.contentPathEquals ?? []) {
      const pathLiteral = pgTextArrayLiteral(predicate.path.split("."));
      conds.push(
        sql`(CASE WHEN ${memories.content} IS JSON THEN (${memories.content}::jsonb #>> ${sql.raw(`'${pathLiteral}'`)}::text[]) ELSE NULL END) = ${predicate.equals}`,
      );
    }
    const order = query.order ?? "desc";
    const useLineageRevision = query.orderBy === "lineageRevision";
    if (query.cursor) {
      if (useLineageRevision) {
        // review round-7: `lineage_revision` cursor comparison — a bare SQL
        // tuple comparison `(lineage_revision, id) > (NULL, cursorId)`
        // evaluates to SQL NULL (never true), which would silently drop
        // every non-null-revision row from the next page whenever the
        // cursor itself was a legacy null-revision row. Handled explicitly
        // instead of relying on tuple comparison across a nullable column
        // (the SAME class of three-valued-logic bug this file's
        // `contentPathEquals` `IS JSON` fix and the RLS predicates'
        // `coalesce` fix both already guard against). `null` always sorts
        // OLDEST regardless of direction (MemoryQuery.orderBy's doc).
        const cursorRevision = query.cursor.lineageRevision ?? null;
        if (cursorRevision === null) {
          conds.push(
            order === "asc"
              ? sql`((${memories.lineageRevision} IS NULL AND ${memories.id} > ${query.cursor.id}) OR ${memories.lineageRevision} IS NOT NULL)`
              : sql`(${memories.lineageRevision} IS NULL AND ${memories.id} < ${query.cursor.id})`,
          );
        } else {
          conds.push(
            order === "asc"
              ? sql`(${memories.lineageRevision} IS NOT NULL AND (${memories.lineageRevision}, ${memories.id}) > (${cursorRevision}, ${query.cursor.id}))`
              : sql`(${memories.lineageRevision} IS NULL OR (${memories.lineageRevision}, ${memories.id}) < (${cursorRevision}, ${query.cursor.id}))`,
          );
        }
      } else {
        // Keyset (review item 8): strictly beyond the cursor's (createdAt, id)
        // position in the requested order — stable under concurrent insert/
        // supersede between page fetches, unlike offset (never re-derives a
        // row's position from a count that can shift underneath it).
        const cursorCreatedAt = new Date(query.cursor.createdAt);
        conds.push(
          order === "asc"
            ? sql`(${memories.createdAt}, ${memories.id}) > (${cursorCreatedAt}, ${query.cursor.id})`
            : sql`(${memories.createdAt}, ${memories.id}) < (${cursorCreatedAt}, ${query.cursor.id})`,
        );
      }
    }
    let q = tx
      .select()
      .from(memories)
      .where(and(...conds))
      .orderBy(
        ...(useLineageRevision
          ? order === "asc"
            ? [sql`${memories.lineageRevision} ASC NULLS FIRST`, asc(memories.id)]
            : [sql`${memories.lineageRevision} DESC NULLS LAST`, desc(memories.id)]
          : order === "asc"
            ? [asc(memories.createdAt), asc(memories.id)]
            : [desc(memories.createdAt), desc(memories.id)]),
      )
      .$dynamic();
    if (query.limit != null) q = q.limit(query.limit);
    // A cursor supersedes offset — offset only remains meaningful for the
    // (shrinking) set of callers that fetch one bounded page and never
    // paginate further (MemoryQuery's `offset` doc comment).
    if (query.offset != null && !query.cursor) q = q.offset(query.offset);
    const rows = await q;
    return rows.map(unpack);
    });
  }

  async forget(id: string, authScope: MemoryAuthScope): Promise<boolean> {
    return withMemoryRlsContext(this.#db, authScope.organizationId, authScope.userId, async (tx) => {
      const rows = await tx
        .select()
        .from(memories)
        .where(and(eq(memories.id, id), visibilityWhere(authScope)))
        .limit(1);
      const target = rows[0] ? unpack(rows[0]) : null;
      if (!target) return false;
      await tx.execute(sql`
        WITH RECURSIVE lineage(id, supersedes_id, owner_user_id) AS (
          SELECT id, supersedes_id, owner_user_id FROM memories WHERE id = ${id}
          UNION
          SELECT m.id, m.supersedes_id, m.owner_user_id
          FROM memories m
          JOIN lineage l ON m.id = l.supersedes_id OR m.supersedes_id = l.id
          WHERE m.organization_id = ${authScope.organizationId}
            AND m.owner_user_id IS NOT DISTINCT FROM ${target.ownerUserId ?? null}
        )
        DELETE FROM memories WHERE id IN (SELECT id FROM lineage)
      `);
      return true;
    });
  }

  async currentForLineage(organizationId: string, ownerUserId: string, lineageKey: string): Promise<MemoryEntry | null> {
    return withMemoryRlsContext(this.#db, organizationId, ownerUserId, (tx) => this.#currentForLineageTx(tx, organizationId, ownerUserId, lineageKey));
  }

  /**
   * SERIALIZABLE isolation is the atomicity primitive (a real database
   * concurrency-control mechanism, never a process-local lock, so this is
   * correct across any number of app server processes/connections):
   * PostgreSQL's serializable-snapshot-isolation detects the exact
   * write-skew this needs to reject — two concurrent transactions both
   * observing "row X has no child yet" and both then inserting a row whose
   * `supersedes_id = X` — and aborts one with a `40001` serialization
   * failure, which is caught below and reported as a CAS-failure `null`
   * (never silently forking the lineage). pglite (used by every test here)
   * implements the same real Postgres transaction machinery, so this is
   * exercised for real in tests, not simulated.
   */
  async casSupersede(params: {
    organizationId: string;
    ownerUserId: string;
    lineageKey: string;
    expectedCurrentId: string | null;
    next: MemoryWrite;
  }): Promise<MemoryEntry | null> {
    if (params.next.organizationId !== params.organizationId || (params.next.ownerUserId ?? null) !== params.ownerUserId) {
      throw new Error("memory store: casSupersede next.organizationId/ownerUserId must match the lineage's own");
    }
    if (params.next.subjectRecordId !== params.lineageKey) {
      throw new Error("memory store: casSupersede next.subjectRecordId must equal lineageKey (adapter contract)");
    }
    try {
      return await this.#db.transaction(
        async (tx) => {
          // TASK-010 review round-6: sets the SAME app.organization_id/app.user_id
          // GUCs withMemoryRlsContext sets elsewhere — inlined here (rather than
          // nesting a SEPARATE withMemoryRlsContext transaction inside this one)
          // because the SERIALIZABLE isolation level below must apply to the
          // one transaction that does the compare-and-insert, not an outer
          // (necessarily lower-isolation) wrapper transaction.
          await tx.execute(sql`SELECT set_config('app.organization_id', ${params.organizationId}, true)`);
          await tx.execute(sql`SELECT set_config('app.user_id', ${params.ownerUserId}, true)`);
          const current = await this.#currentForLineageTx(tx, params.organizationId, params.ownerUserId, params.lineageKey);
          if ((current?.id ?? null) !== params.expectedCurrentId) return null;
          // review round-7: allocated from the SAME `current` row this
          // transaction already read under SERIALIZABLE isolation — a
          // concurrent racer observing the same "current" and computing the
          // same next revision is exactly the write-skew this isolation
          // level detects and aborts (one loses with a `40001`, caught
          // below), so no separate `MAX(lineage_revision)` query is needed.
          const nextRevision = (current?.lineageRevision ?? 0) + 1;
          return this.#insert(params.next, params.expectedCurrentId, tx, nextRevision);
        },
        { isolationLevel: "serializable" },
      );
    } catch (err) {
      if (isSerializationFailure(err) || isMemoryIdUniqueViolation(err)) return null;
      throw err;
    }
  }

  async #currentForLineageTx(db: DbLike, organizationId: string, ownerUserId: string, lineageKey: string): Promise<MemoryEntry | null> {
    const rows = await db
      .select()
      .from(memories)
      .where(
        and(
          eq(memories.organizationId, organizationId),
          eq(memories.ownerUserId, ownerUserId),
          eq(memories.subjectRecordId, lineageKey),
          sql`NOT EXISTS (SELECT 1 FROM ${memories} AS m2 WHERE m2.supersedes_id = ${memories.id})`,
        ),
      )
      .orderBy(desc(memories.createdAt))
      .limit(1);
    const row = rows[0];
    return row ? unpack(row) : null;
  }

  /**
   * TASK-011 remediation (coordinator central-merge review, issue 2) — see
   * the `MemoryStore.redactLineageContent` port doc comment for the full
   * rationale. Reuses the SAME bidirectional lineage-discovery shape
   * `forget()` above already uses (ancestors AND descendants of `id`,
   * scoped to the same organization + owner — never a broad, unrelated-Memory
   * purge), but SELECTs the lineage's row ids rather than deleting them,
   * then rewrites ONLY the `content` column of whichever rows `redact()`
   * says to change — every other column (id, `supersedesId`, timestamps,
   * scope, `sourceRefType`/`sourceRefId`, confidence, `trustOrigin`,
   * `plane`, `createdBy`, `ownerUserId`) is left completely untouched. Runs
   * inside the SAME `withMemoryRlsContext` transaction so the lineage read
   * and the content rewrites are consistent with each other; deliberately
   * does NOT take an advisory lock (unlike `compareAndSupersede`/
   * `writeIfAbsent`, which decide WHICH of several racing writers wins) —
   * `redact` is required to be a pure, idempotent function of its input, so
   * two concurrent callers performing the identical redaction converge on
   * the same correct final state regardless of interleaving; there is no
   * "winner" to arbitrate.
   */
  async redactLineageContent(
    id: string,
    authScope: MemoryAuthScope,
    redact: (entry: MemoryEntry) => string | null,
  ): Promise<number> {
    const target = await this.get(id, authScope);
    if (!target) return 0;
    return withMemoryRlsContext(this.#db, authScope.organizationId, authScope.userId, async (tx) => {
      const lineageResult = await tx.execute(sql`
        WITH RECURSIVE lineage(id, supersedes_id, owner_user_id) AS (
          SELECT id, supersedes_id, owner_user_id FROM memories WHERE id = ${id}
          UNION
          SELECT m.id, m.supersedes_id, m.owner_user_id
          FROM memories m
          JOIN lineage l ON m.id = l.supersedes_id OR m.supersedes_id = l.id
          WHERE m.organization_id = ${authScope.organizationId}
            AND m.owner_user_id IS NOT DISTINCT FROM ${target.ownerUserId ?? null}
        )
        SELECT id FROM lineage
      `);
      const lineageRows = (
        Array.isArray(lineageResult) ? lineageResult : (lineageResult as { rows?: unknown[] }).rows ?? []
      ) as Array<{ id: string }>;
      const lineageIds = lineageRows.map((r) => r.id);
      if (lineageIds.length === 0) return 0;
      const currentRows = await tx.select().from(memories).where(inArray(memories.id, lineageIds));
      let redactedCount = 0;
      for (const row of currentRows) {
        const entry = unpack(row);
        const redactedContent = redact(entry);
        if (redactedContent == null || redactedContent === entry.content) continue;
        await tx.update(memories).set({ content: redactedContent }).where(eq(memories.id, entry.id));
        redactedCount += 1;
      }
      return redactedCount;
    });
  }

  async #insert(entry: MemoryWrite, supersedesId: string | null, db: DbLike = this.#db, lineageRevision: number | null = null): Promise<MemoryEntry> {
    const [inserted] = await db
      .insert(memories)
      .values({
        id: entry.id,
        organizationId: entry.organizationId,
        type: entry.type,
        subjectRecordId: entry.subjectRecordId ?? null,
        scope: entry.scope,
        content: entry.content,
        sourceRefType: entry.sourceRefType ?? null,
        sourceRefId: entry.sourceRefId ?? null,
        confidence: entry.confidence.toString(),
        supersedesId,
        trustOrigin: entry.trustOrigin,
        taintLabel:
          entry.taintLabel ??
          labelFromLegacyTrustOrigin(entry.trustOrigin, `memory:${entry.id}`),
        plane: entry.plane,
        createdBy: entry.createdBy,
        ownerUserId: entry.ownerUserId ?? null,
        ...(lineageRevision != null ? { lineageRevision } : {}),
        ...(entry.createdAt ? { createdAt: new Date(entry.createdAt) } : {}),
      })
      .returning();
    if (!inserted) throw new Error("memory store: insert returned no row");
    return unpack(inserted);
  }
}

/** Structural subset of `Database` a transaction callback's `tx` handle also
 * satisfies — lets `#insert`/`#currentForLineageTx` run against either the
 * top-level `Database` or a `casSupersede` transaction's `tx` uniformly.
 * Widened (round-6) to include `execute`/`transaction` so `withMemoryRlsContext`
 * can set the RLS session GUCs and nest `casSupersede`'s own transaction
 * inside it uniformly, whether called against the top-level `Database` or
 * an already-open `tx`. */
type DbLike = Pick<Database, "select" | "insert" | "update" | "execute" | "transaction">;

/** Postgres SQLSTATE `40001` ("serialization_failure") — thrown by a
 * SERIALIZABLE transaction that lost a concurrency race.
 *
 * drizzle-orm ≥0.45 wraps every query failure in a `DrizzleQueryError` and
 * hangs the real Postgres error (which carries `.code`) on `.cause` — it
 * does NOT surface `.code` at the top level. This mirrors
 * `ledger-store.ts`'s `isRefLedgerUniqueViolation` exactly (same drizzle
 * version, same wrapping behavior): walk the cause chain so a genuine
 * `40001` is recognized on both postgres-js and pglite instead of
 * re-throwing as an unhandled `DrizzleQueryError` — which would silently
 * defeat this whole CAS primitive's concurrency guarantee under real
 * contention (confirmed missing in an earlier version of this function by
 * an independent review; `casSupersede`'s own concurrency test alone did
 * NOT catch it because pglite's single-connection execution model didn't
 * happen to produce a real 40001 in that specific test).
 */
const SERIALIZATION_FAILURE = "40001";
/** Exported (only from this module, not the module barrel) so a unit test
 * can verify the `.cause`-chain unwrap directly against a REAL
 * `DrizzleQueryError` — pglite's single-connection execution model does not
 * reliably produce a genuine overlapping-transaction `40001` under
 * `Promise.all` (confirmed by an independent review), so exercising this
 * function in isolation with a constructed wrapped error is the reliable
 * regression test for the unwrap logic itself, independent of whether a
 * real race can be forced in a given test environment. */
export function isSerializationFailure(err: unknown): boolean {
  for (let e: unknown = err, depth = 0; e && typeof e === "object" && depth < 6; depth++) {
    const pg = e as { code?: unknown; cause?: unknown };
    if (pg.code === SERIALIZATION_FAILURE) return true;
    e = pg.cause;
  }
  return false;
}

/** Postgres SQLSTATE `23505` ("unique_violation") — scoped specifically to
 * the `memories` table's own primary key (`memories_pkey`), mirroring
 * `ledger-store.ts`'s `isRefLedgerUniqueViolation` pattern exactly (same
 * `.cause`-chain unwrap for the same drizzle-orm wrapping behavior).
 *
 * TASK-010 review round-5 item 10 — a deterministic Memory id (e.g. a
 * red-flag correction's `deterministicUuid(...)`-derived memoryId/
 * preferenceAdjustmentId) means two genuinely CONCURRENT callers across
 * DIFFERENT processes/connections can both pass `casSupersede`'s own
 * `current === expectedCurrentId` compare (each inside its OWN serializable
 * transaction, each seeing "no current row yet") and then both attempt to
 * INSERT the identical row id — Postgres's unique index on `memories.id`
 * catches this as a genuine `23505`, not the `40001` serialization failure
 * `isSerializationFailure` already handles (a duplicate-PK insert and a
 * write-skew abort are different failure modes at the database level, even
 * though both mean the same thing to this CAS primitive's caller: "someone
 * else already resolved this, re-read"). Scoped to `memories_pkey`
 * specifically so a DIFFERENT unique constraint on this table (should one
 * ever exist) is never silently swallowed as a false CAS loss. */
const MEMORY_ID_UNIQUE_INDEX = "memories_pkey";
export function isMemoryIdUniqueViolation(err: unknown): boolean {
  for (let e: unknown = err, depth = 0; e && typeof e === "object" && depth < 6; depth++) {
    const pg = e as { code?: unknown; message?: unknown; constraint?: unknown; cause?: unknown };
    if (pg.code === "23505") {
      const text = `${String(pg.constraint ?? "")} ${String(pg.message ?? "")}`;
      if (text.includes(MEMORY_ID_UNIQUE_INDEX)) return true;
    }
    e = pg.cause;
  }
  return false;
}
