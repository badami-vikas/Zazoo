/**
 * WorkspaceDefinitionStore — the port @bridge/db's DrizzleWorkspaceDefinitionStore
 * binds against (workspace_definitions: id/workspace_id/blueprint/version/status/
 * created_by/created_at — packages/db/src/schema.ts). Mirrors CapabilityStore's
 * shape (capability/ports.ts): a plain CRUD-ish port, an in-memory implementation
 * here so @bridge/core runs + is tested with no database, and a Drizzle binding
 * in @bridge/db.
 *
 * Blueprint changes are GOVERNED PROPOSALS (docs/wiki/vision.md "Core principle":
 * everything is proposed, governed, continuously evolved) — this store only
 * persists rows; the propose/activate SEMANTICS (draft -> active, archiving the
 * prior active version, requiring a human decision via action.decide) live in
 * apps/api's workspace.blueprint.* procedures, the same split CapabilityStore has
 * with capability.activate/approve.
 */
import type { WorkspaceBlueprint } from "./blueprint.js";

export type WorkspaceDefinitionStatus = "draft" | "active" | "archived";

export interface WorkspaceDefinitionRow {
  id: string;
  workspaceId: string;
  blueprint: WorkspaceBlueprint;
  version: number;
  status: WorkspaceDefinitionStatus;
  createdBy: string | null;
  createdAt: string;
}

export interface WorkspaceDefinitionStore {
  create(row: Omit<WorkspaceDefinitionRow, "createdAt">): Promise<WorkspaceDefinitionRow>;
  get(id: string): Promise<WorkspaceDefinitionRow | null>;
  /** The single current `active` row for a workspace, or null if none has ever been activated. */
  getActive(workspaceId: string): Promise<WorkspaceDefinitionRow | null>;
  /** All draft rows for a workspace (pending propose(), awaiting activation), newest first. */
  listDrafts(workspaceId: string): Promise<WorkspaceDefinitionRow[]>;
  /** Flip a row's status (draft -> active, active -> archived, etc). Does not
   * itself enforce "only one active row" — the caller (workspace.blueprint.activate)
   * is responsible for archiving the prior active row in the same operation. */
  setStatus(id: string, status: WorkspaceDefinitionStatus): Promise<WorkspaceDefinitionRow>;
}

/** In-memory `WorkspaceDefinitionStore` — dev/test default (mirrors InMemoryCapabilityStore's shape). */
export class InMemoryWorkspaceDefinitionStore implements WorkspaceDefinitionStore {
  readonly rows = new Map<string, WorkspaceDefinitionRow>();

  async create(row: Omit<WorkspaceDefinitionRow, "createdAt">): Promise<WorkspaceDefinitionRow> {
    if (this.rows.has(row.id)) {
      throw new Error(`workspace_definitions: duplicate id ${row.id}`);
    }
    const full: WorkspaceDefinitionRow = { ...row, createdAt: new Date().toISOString() };
    this.rows.set(row.id, full);
    return full;
  }

  async get(id: string): Promise<WorkspaceDefinitionRow | null> {
    return this.rows.get(id) ?? null;
  }

  async getActive(workspaceId: string): Promise<WorkspaceDefinitionRow | null> {
    const active = [...this.rows.values()]
      .filter((r) => r.workspaceId === workspaceId && r.status === "active")
      .sort((a, b) => b.version - a.version);
    return active[0] ?? null;
  }

  async listDrafts(workspaceId: string): Promise<WorkspaceDefinitionRow[]> {
    return [...this.rows.values()]
      .filter((r) => r.workspaceId === workspaceId && r.status === "draft")
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  async setStatus(id: string, status: WorkspaceDefinitionStatus): Promise<WorkspaceDefinitionRow> {
    const existing = this.rows.get(id);
    if (!existing) throw new Error(`workspace_definitions: unknown id ${id}`);
    const updated: WorkspaceDefinitionRow = { ...existing, status };
    this.rows.set(id, updated);
    return updated;
  }
}
