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
    // Integrity is enforced by the self-FK (supersedes_id → memories.id): a
    // supersede of an unknown id fails at the DB rather than silently orphaning.
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

  async #insert(entry: MemoryWrite, supersedesId: string | null): Promise<MemoryEntry> {
    const [inserted] = await this.#db
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
