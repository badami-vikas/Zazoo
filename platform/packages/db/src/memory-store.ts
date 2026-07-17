/**
 * DrizzleMemoryStore — binds the core `MemoryStore` port (@bridge/core's
 * memory/memory-store.ts) to the `memories` table (schema.ts). The pglite/
 * Postgres default adapter; a Mem0 adapter can bind the same port behind a flag.
 *
 * Authority scoping is pushed into the SQL WHERE (NOT post-filtered): retrieve/
 * get build the visibility predicate — public/workspace visible to any member,
 * team/private/restricted visible only to the owner — so a caller never receives
 * a row it may not read. This mirrors @bridge/core's `memoryVisible` predicate
 * and the DB's own `app_private.visible_relationship_row` (migrations/0008),
 * with RLS (migrations/0009) as the defense-in-depth floor beneath it.
 *
 * `confidence` is a numeric column (Drizzle surfaces it as a string): unpack
 * Number()-izes on read, `#insert` stringifies on write.
 */
import { and, desc, eq, inArray, or, sql, type SQL } from "drizzle-orm";
import type {
  MemoryAuthScope,
  MemoryClassification,
  MemoryEntry,
  MemoryQuery,
  MemorySourceRefType,
  MemoryStore,
  MemoryType,
  MemoryWrite,
  Plane,
  TrustOrigin,
} from "@bridge/core";
import type { Database } from "./client.js";
import { memories } from "./schema.js";

const OPEN_SCOPES = ["public", "workspace"] as const;
const OWNER_SCOPES = ["team", "private", "restricted"] as const;

function unpack(row: typeof memories.$inferSelect): MemoryEntry {
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    type: row.type as MemoryType,
    ...(row.subjectElementId ? { subjectElementId: row.subjectElementId } : {}),
    scope: row.scope as MemoryClassification,
    content: row.content,
    ...(row.sourceRefType ? { sourceRefType: row.sourceRefType as MemorySourceRefType } : {}),
    ...(row.sourceRefId ? { sourceRefId: row.sourceRefId } : {}),
    confidence: Number(row.confidence),
    ...(row.supersedesId ? { supersedesId: row.supersedesId } : {}),
    trustOrigin: row.trustOrigin as TrustOrigin,
    plane: row.plane as Plane,
    createdBy: row.createdBy,
    ...(row.ownerUserId ? { ownerUserId: row.ownerUserId } : {}),
    createdAt: row.createdAt.toISOString(),
  };
}

/** The read-visibility predicate, pushed into SQL. Tenant match always; then the
 * classification gate (mirrors core's memoryVisible / the DB visibility fn). */
function visibilityWhere(authScope: MemoryAuthScope): SQL {
  const tenant = eq(memories.workspaceId, authScope.workspaceId);
  const open = inArray(memories.scope, [...OPEN_SCOPES]);
  if (authScope.userId == null) return and(tenant, open) as SQL;
  const owned = and(inArray(memories.scope, [...OWNER_SCOPES]), eq(memories.ownerUserId, authScope.userId));
  return and(tenant, or(open, owned)) as SQL;
}

export class DrizzleMemoryStore implements MemoryStore {
  #db: Database;
  constructor(db: Database) {
    this.#db = db;
  }

  async write(entry: MemoryWrite): Promise<MemoryEntry> {
    return this.#insert(entry, null);
  }

  async supersede(id: string, next: MemoryWrite): Promise<MemoryEntry> {
    const current = await this.#db
      .select({ workspaceId: memories.workspaceId, ownerUserId: memories.ownerUserId })
      .from(memories)
      .where(eq(memories.id, id))
      .limit(1);
    if (current.length === 0) throw new Error(`memory store: cannot supersede unknown id ${id}`);
    if (current[0]!.workspaceId !== next.workspaceId || current[0]!.ownerUserId !== (next.ownerUserId ?? null)) {
      throw new Error("memory store: a correction cannot change workspace or owner");
    }
    return this.#insert(next, id);
  }

  async get(id: string, authScope: MemoryAuthScope): Promise<MemoryEntry | null> {
    const rows = await this.#db
      .select()
      .from(memories)
      .where(and(eq(memories.id, id), visibilityWhere(authScope)))
      .limit(1);
    const row = rows[0];
    return row ? unpack(row) : null;
  }

  async retrieve(query: MemoryQuery, authScope: MemoryAuthScope): Promise<MemoryEntry[]> {
    const conds: SQL[] = [visibilityWhere(authScope)];
    if (!query.includeSuperseded) {
      conds.push(sql`NOT EXISTS (SELECT 1 FROM ${memories} AS m2 WHERE m2.supersedes_id = ${memories.id})`);
    }
    if (query.type) conds.push(eq(memories.type, query.type));
    if (query.subjectElementId) conds.push(eq(memories.subjectElementId, query.subjectElementId));
    if (query.sourceRefType) conds.push(eq(memories.sourceRefType, query.sourceRefType));
    let q = this.#db
      .select()
      .from(memories)
      .where(and(...conds))
      .orderBy(desc(memories.createdAt))
      .$dynamic();
    if (query.limit != null) q = q.limit(query.limit);
    if (query.offset != null) q = q.offset(query.offset);
    const rows = await q;
    return rows.map(unpack);
  }

  async forget(id: string, authScope: MemoryAuthScope): Promise<boolean> {
    const target = await this.get(id, authScope);
    if (!target) return false;
    await this.#db.execute(sql`
      WITH RECURSIVE lineage(id, supersedes_id, owner_user_id) AS (
        SELECT id, supersedes_id, owner_user_id FROM memories WHERE id = ${id}
        UNION
        SELECT m.id, m.supersedes_id, m.owner_user_id
        FROM memories m
        JOIN lineage l ON m.id = l.supersedes_id OR m.supersedes_id = l.id
        WHERE m.workspace_id = ${authScope.workspaceId}
          AND m.owner_user_id IS NOT DISTINCT FROM ${target.ownerUserId ?? null}
      )
      DELETE FROM memories WHERE id IN (SELECT id FROM lineage)
    `);
    return true;
  }

  async currentForLineage(workspaceId: string, ownerUserId: string, lineageKey: string): Promise<MemoryEntry | null> {
    return this.#currentForLineageTx(this.#db, workspaceId, ownerUserId, lineageKey);
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
    workspaceId: string;
    ownerUserId: string;
    lineageKey: string;
    expectedCurrentId: string | null;
    next: MemoryWrite;
  }): Promise<MemoryEntry | null> {
    if (params.next.workspaceId !== params.workspaceId || (params.next.ownerUserId ?? null) !== params.ownerUserId) {
      throw new Error("memory store: casSupersede next.workspaceId/ownerUserId must match the lineage's own");
    }
    if (params.next.subjectElementId !== params.lineageKey) {
      throw new Error("memory store: casSupersede next.subjectElementId must equal lineageKey (adapter contract)");
    }
    try {
      return await this.#db.transaction(
        async (tx) => {
          const current = await this.#currentForLineageTx(tx, params.workspaceId, params.ownerUserId, params.lineageKey);
          if ((current?.id ?? null) !== params.expectedCurrentId) return null;
          return this.#insert(params.next, params.expectedCurrentId, tx);
        },
        { isolationLevel: "serializable" },
      );
    } catch (err) {
      if (isSerializationFailure(err)) return null;
      throw err;
    }
  }

  async #currentForLineageTx(db: DbLike, workspaceId: string, ownerUserId: string, lineageKey: string): Promise<MemoryEntry | null> {
    const rows = await db
      .select()
      .from(memories)
      .where(
        and(
          eq(memories.workspaceId, workspaceId),
          eq(memories.ownerUserId, ownerUserId),
          eq(memories.subjectElementId, lineageKey),
          sql`NOT EXISTS (SELECT 1 FROM ${memories} AS m2 WHERE m2.supersedes_id = ${memories.id})`,
        ),
      )
      .orderBy(desc(memories.createdAt))
      .limit(1);
    const row = rows[0];
    return row ? unpack(row) : null;
  }

  async #insert(entry: MemoryWrite, supersedesId: string | null, db: DbLike = this.#db): Promise<MemoryEntry> {
    const [inserted] = await db
      .insert(memories)
      .values({
        id: entry.id,
        workspaceId: entry.workspaceId,
        type: entry.type,
        subjectElementId: entry.subjectElementId ?? null,
        scope: entry.scope,
        content: entry.content,
        sourceRefType: entry.sourceRefType ?? null,
        sourceRefId: entry.sourceRefId ?? null,
        confidence: entry.confidence.toString(),
        supersedesId,
        trustOrigin: entry.trustOrigin,
        plane: entry.plane,
        createdBy: entry.createdBy,
        ownerUserId: entry.ownerUserId ?? null,
        ...(entry.createdAt ? { createdAt: new Date(entry.createdAt) } : {}),
      })
      .returning();
    if (!inserted) throw new Error("memory store: insert returned no row");
    return unpack(inserted);
  }
}

/** Structural subset of `Database` a transaction callback's `tx` handle also
 * satisfies — lets `#insert`/`#currentForLineageTx` run against either the
 * top-level `Database` or a `casSupersede` transaction's `tx` uniformly. */
type DbLike = Pick<Database, "select" | "insert">;

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
/** Exported (only from this module, not the package barrel) so a unit test
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
