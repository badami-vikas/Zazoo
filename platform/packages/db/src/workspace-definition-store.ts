/**
 * DrizzleWorkspaceDefinitionStore — binds the core `WorkspaceDefinitionStore`
 * port (@bridge/core's workspace-definition.ts) to `workspace_definitions`
 * (schema.ts). Mirrors DrizzleCapabilityStore's shape (capability-store.ts): a
 * single class, `#db` private field, jsonb validated at the read/write boundary
 * with a colocated Zod schema (this package is where jsonb wire-shapes are
 * validated — @bridge/core stays zero-runtime-deps, no zod there).
 */
import { and, desc, eq } from "drizzle-orm";
import {
  parseWorkspaceBlueprint,
  type WorkspaceDefinitionRow,
  type WorkspaceDefinitionStatus,
  type WorkspaceDefinitionStore,
  type WorkspaceBlueprint,
} from "@bridge/core";
import type { Database } from "./client.js";
import { workspaceDefinitions } from "./schema.js";

/**
 * Validate `workspace_definitions.blueprint` jsonb. Throws loudly on a
 * malformed shape rather than silently defaulting to an empty blueprint — the
 * same reasoning as capability-store.ts's `parseDependencies`: a silently
 * emptied blueprint would compile to zero entities/views instead of surfacing
 * the corruption.
 */
export function parseBlueprint(raw: unknown): WorkspaceBlueprint {
  try {
    return parseWorkspaceBlueprint(raw);
  } catch (error) {
    throw new Error(`Invalid workspace_definitions.blueprint jsonb: ${String(error)}`);
  }
}

function unpack(row: typeof workspaceDefinitions.$inferSelect): WorkspaceDefinitionRow {
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    blueprint: parseBlueprint(row.blueprint),
    version: row.version,
    status: row.status as WorkspaceDefinitionStatus,
    createdBy: row.createdBy,
    createdAt: row.createdAt.toISOString(),
  };
}

export class DrizzleWorkspaceDefinitionStore implements WorkspaceDefinitionStore {
  #db: Database;
  constructor(db: Database) {
    this.#db = db;
  }

  async create(row: Omit<WorkspaceDefinitionRow, "createdAt">): Promise<WorkspaceDefinitionRow> {
    const validated = parseBlueprint(row.blueprint);
    const [inserted] = await this.#db
      .insert(workspaceDefinitions)
      .values({
        id: row.id,
        workspaceId: row.workspaceId,
        blueprint: validated,
        version: row.version,
        status: row.status,
        ...(row.createdBy ? { createdBy: row.createdBy } : {}),
      })
      .returning();
    if (!inserted) throw new Error("workspace_definitions: insert returned no row");
    return unpack(inserted);
  }

  async get(id: string): Promise<WorkspaceDefinitionRow | null> {
    const rows = await this.#db.select().from(workspaceDefinitions).where(eq(workspaceDefinitions.id, id)).limit(1);
    const row = rows[0];
    return row ? unpack(row) : null;
  }

  async getActive(workspaceId: string): Promise<WorkspaceDefinitionRow | null> {
    const rows = await this.#db
      .select()
      .from(workspaceDefinitions)
      .where(and(eq(workspaceDefinitions.workspaceId, workspaceId), eq(workspaceDefinitions.status, "active")))
      .orderBy(desc(workspaceDefinitions.version))
      .limit(1);
    const row = rows[0];
    return row ? unpack(row) : null;
  }

  async listDrafts(workspaceId: string): Promise<WorkspaceDefinitionRow[]> {
    const rows = await this.#db
      .select()
      .from(workspaceDefinitions)
      .where(and(eq(workspaceDefinitions.workspaceId, workspaceId), eq(workspaceDefinitions.status, "draft")))
      .orderBy(desc(workspaceDefinitions.createdAt));
    return rows.map(unpack);
  }

  async setStatus(id: string, status: WorkspaceDefinitionStatus): Promise<WorkspaceDefinitionRow> {
    const [updated] = await this.#db
      .update(workspaceDefinitions)
      .set({ status })
      .where(eq(workspaceDefinitions.id, id))
      .returning();
    if (!updated) throw new Error(`workspace_definitions: unknown id ${id}`);
    return unpack(updated);
  }
}
