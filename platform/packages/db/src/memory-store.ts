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
    return this.#insert(this.#db, entry, null);
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
    return this.#insert(this.#db, next, id);
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
   * of e.g. a new UNIQUE index — RM4 owns migration 0015; TASK-010 is
   * expected to land its own durable CAS contract this method is written to
   * be compatible with / supersede-able by once merged).
   */
  async compareAndSupersede(id: string, next: MemoryWrite): Promise<MemoryEntry> {
    return this.#db.transaction(async (tx) => {
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
        .select({ workspaceId: memories.workspaceId, ownerUserId: memories.ownerUserId })
        .from(memories)
        .where(eq(memories.id, id))
        .limit(1);
      if (current.length === 0) throw new Error(`memory store: cannot supersede unknown id ${id}`);
      if (current[0]!.workspaceId !== next.workspaceId || current[0]!.ownerUserId !== (next.ownerUserId ?? null)) {
        throw new Error("memory store: a correction cannot change workspace or owner");
      }
      const alreadySuperseded = await tx
        .select({ id: memories.id })
        .from(memories)
        .where(eq(memories.supersedesId, id))
        .limit(1);
      if (alreadySuperseded.length > 0) {
        throw new MemoryConflictError(id);
      }
      return this.#insert(tx, next, id);
    });
  }

  /**
   * Cross-instance-safe first-insert-wins write, keyed by
   * `(workspaceId, subjectElementId)` — TASK-011 remediation (2026-07-19
   * coordinator distributed-defects RE-review). `compareAndSupersede` above
   * only guards races against an EXISTING known row id; it cannot close the
   * "two callers both creating the FIRST row for a not-yet-existing key"
   * race (an independent reviewer found this exact gap in
   * `DurableCultureFetchStore.create`/`DurableCultureSynthesisPointerStore.recordProposal`).
   * Locks on `hashtext(workspaceId || ':' || subjectElementId)` (each UUID
   * component individually canonicalized via `::uuid::text` first — issue 9,
   * same alias-collision rationale as `compareAndSupersede` above) — a
   * DIFFERENT lock namespace/key shape than `compareAndSupersede`'s
   * `hashtext(id)` (keyed by row id, not subject key), so the two methods'
   * locks never collide with each other for the same logical entity.
   */
  async writeIfAbsent(entry: MemoryWrite): Promise<MemoryEntry> {
    const subjectElementId = entry.subjectElementId;
    if (!subjectElementId) {
      throw new Error("memory store: writeIfAbsent requires entry.subjectElementId as its dedup key");
    }
    const workspaceId = entry.workspaceId;
    return this.#db.transaction(async (tx) => {
      await tx.execute(
        sql`SELECT pg_advisory_xact_lock(hashtext((${workspaceId}::uuid)::text || ':' || (${subjectElementId}::uuid)::text))`,
      );
      const existingRows = await tx
        .select()
        .from(memories)
        .where(
          and(
            eq(memories.workspaceId, entry.workspaceId),
            eq(memories.subjectElementId, subjectElementId),
            sql`NOT EXISTS (SELECT 1 FROM ${memories} AS m2 WHERE m2.supersedes_id = ${memories.id})`,
          ),
        )
        .orderBy(desc(memories.createdAt))
        .limit(1);
      const existing = existingRows[0];
      if (existing) return unpack(existing);
      return this.#insert(tx, entry, null);
    });
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

  async #insert(
    executor: Pick<Database, "insert">,
    entry: MemoryWrite,
    supersedesId: string | null,
  ): Promise<MemoryEntry> {
    const [inserted] = await executor
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
