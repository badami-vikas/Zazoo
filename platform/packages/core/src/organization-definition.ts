/**
 * OrganizationDefinitionStore — the port @bridge/db's DrizzleOrganizationDefinitionStore
 * binds against (organization_definitions: id/organization_id/blueprint/version/status/
 * created_by/created_at — packages/db/src/schema.ts). Mirrors CapabilityStore's
 * shape (capability/ports.ts): a plain CRUD-ish port, an in-memory implementation
 * here so @bridge/core runs + is tested with no database, and a Drizzle binding
 * in @bridge/db.
 *
 * Blueprint changes are GOVERNED PROPOSALS (docs/wiki/vision.md "Core principle":
 * everything is proposed, governed, continuously evolved) — this store only
 * persists rows; the propose/activate SEMANTICS (draft -> active, archiving the
 * prior active version, requiring a human decision via action.decide) live in
 * apps/api's organization.blueprint.* procedures, the same split CapabilityStore has
 * with capability.activate/approve.
 */
import type { OrganizationBlueprint } from "./blueprint.js";

export type OrganizationDefinitionStatus = "draft" | "active" | "archived";

export interface OrganizationDefinitionRow {
  id: string;
  organizationId: string;
  blueprint: OrganizationBlueprint;
  version: number;
  status: OrganizationDefinitionStatus;
  createdBy: string | null;
  createdAt: string;
}

export interface OrganizationDefinitionStore {
  create(row: Omit<OrganizationDefinitionRow, "createdAt">): Promise<OrganizationDefinitionRow>;
  get(id: string): Promise<OrganizationDefinitionRow | null>;
  /** The single current `active` row for a organization, or null if none has ever been activated. */
  getActive(organizationId: string): Promise<OrganizationDefinitionRow | null>;
  /** All draft rows for a organization (pending propose(), awaiting activation), newest first. */
  listDrafts(organizationId: string): Promise<OrganizationDefinitionRow[]>;
  /** Flip a row's status (draft -> active, active -> archived, etc). Does not
   * itself enforce "only one active row" — the caller (organization.blueprint.activate)
   * is responsible for archiving the prior active row in the same operation. */
  setStatus(id: string, status: OrganizationDefinitionStatus): Promise<OrganizationDefinitionRow>;
}

/** In-memory `OrganizationDefinitionStore` — dev/test default (mirrors InMemoryCapabilityStore's shape). */
export class InMemoryOrganizationDefinitionStore implements OrganizationDefinitionStore {
  readonly rows = new Map<string, OrganizationDefinitionRow>();

  async create(row: Omit<OrganizationDefinitionRow, "createdAt">): Promise<OrganizationDefinitionRow> {
    if (this.rows.has(row.id)) {
      throw new Error(`organization_definitions: duplicate id ${row.id}`);
    }
    const full: OrganizationDefinitionRow = { ...row, createdAt: new Date().toISOString() };
    this.rows.set(row.id, full);
    return full;
  }

  async get(id: string): Promise<OrganizationDefinitionRow | null> {
    return this.rows.get(id) ?? null;
  }

  async getActive(organizationId: string): Promise<OrganizationDefinitionRow | null> {
    const active = [...this.rows.values()]
      .filter((r) => r.organizationId === organizationId && r.status === "active")
      .sort((a, b) => b.version - a.version);
    return active[0] ?? null;
  }

  async listDrafts(organizationId: string): Promise<OrganizationDefinitionRow[]> {
    return [...this.rows.values()]
      .filter((r) => r.organizationId === organizationId && r.status === "draft")
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  async setStatus(id: string, status: OrganizationDefinitionStatus): Promise<OrganizationDefinitionRow> {
    const existing = this.rows.get(id);
    if (!existing) throw new Error(`organization_definitions: unknown id ${id}`);
    const updated: OrganizationDefinitionRow = { ...existing, status };
    this.rows.set(id, updated);
    return updated;
  }
}
