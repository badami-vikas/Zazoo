/**
 * DrizzleOrganizationDefinitionStore — binds the core `OrganizationDefinitionStore`
 * port (@bridge/core's organization-definition.ts) to `organization_definitions`
 * (schema.ts). Mirrors DrizzleCapabilityStore's shape (capability-store.ts): a
 * single class, `#db` private field, jsonb validated at the read/write boundary
 * with a colocated Zod schema (this module is where jsonb wire-shapes are
 * validated — @bridge/core stays zero-runtime-deps, no zod there).
 */
import { and, desc, eq } from "drizzle-orm";
import {
  parseOrganizationBlueprint,
  type OrganizationDefinitionRow,
  type OrganizationDefinitionStatus,
  type OrganizationDefinitionStore,
  type OrganizationBlueprint,
} from "@bridge/core";
import type { Database } from "./client.js";
import { organizationDefinitions } from "./schema.js";
import {
  withDefaultOrganization,
  withOrganizationOnly,
} from "./organization-context.js";
import { parseDatabaseUuid } from "./uuid.js";

/**
 * Validate `organization_definitions.blueprint` jsonb. Throws loudly on a
 * malformed shape rather than silently defaulting to an empty blueprint — the
 * same reasoning as capability-store.ts's `parseDependencies`: a silently
 * emptied blueprint would compile to zero entities/views instead of surfacing
 * the corruption.
 */
export function parseBlueprint(raw: unknown): OrganizationBlueprint {
  try {
    return parseOrganizationBlueprint(raw);
  } catch (error) {
    throw new Error(`Invalid organization_definitions.blueprint jsonb: ${String(error)}`);
  }
}

function unpack(row: typeof organizationDefinitions.$inferSelect): OrganizationDefinitionRow {
  return {
    id: row.id,
    organizationId: row.organizationId,
    blueprint: parseBlueprint(row.blueprint),
    version: row.version,
    status: row.status as OrganizationDefinitionStatus,
    createdBy: row.createdBy,
    createdAt: row.createdAt.toISOString(),
  };
}

export class DrizzleOrganizationDefinitionStore implements OrganizationDefinitionStore {
  #db: Database;
  #defaultOrganizationId: string | undefined;
  constructor(db: Database, defaultOrganizationId?: string) {
    this.#db = db;
    this.#defaultOrganizationId = defaultOrganizationId;
  }

  async create(row: Omit<OrganizationDefinitionRow, "createdAt">): Promise<OrganizationDefinitionRow> {
    parseDatabaseUuid(row.id, "definitionId");
    return withOrganizationOnly(this.#db, row.organizationId, async (tx) => {
    const validated = parseBlueprint(row.blueprint);
    const [inserted] = await tx
      .insert(organizationDefinitions)
      .values({
        id: row.id,
        organizationId: row.organizationId,
        blueprint: validated,
        version: row.version,
        status: row.status,
        ...(row.createdBy ? { createdBy: row.createdBy } : {}),
      })
      .returning();
    if (!inserted) throw new Error("organization_definitions: insert returned no row");
    return unpack(inserted);
    });
  }

  async get(id: string): Promise<OrganizationDefinitionRow | null> {
    const definitionId = parseDatabaseUuid(id, "definitionId");
    return withDefaultOrganization(this.#db, this.#defaultOrganizationId, async (tx) => {
    const rows = await tx.select().from(organizationDefinitions).where(eq(organizationDefinitions.id, definitionId)).limit(1);
    const row = rows[0];
    return row ? unpack(row) : null;
    });
  }

  async getActive(organizationId: string): Promise<OrganizationDefinitionRow | null> {
    return withOrganizationOnly(this.#db, organizationId, async (tx) => {
    const rows = await tx
      .select()
      .from(organizationDefinitions)
      .where(and(eq(organizationDefinitions.organizationId, organizationId), eq(organizationDefinitions.status, "active")))
      .orderBy(desc(organizationDefinitions.version))
      .limit(1);
    const row = rows[0];
    return row ? unpack(row) : null;
    });
  }

  async listDrafts(organizationId: string): Promise<OrganizationDefinitionRow[]> {
    return withOrganizationOnly(this.#db, organizationId, async (tx) => {
    const rows = await tx
      .select()
      .from(organizationDefinitions)
      .where(and(eq(organizationDefinitions.organizationId, organizationId), eq(organizationDefinitions.status, "draft")))
      .orderBy(desc(organizationDefinitions.createdAt));
    return rows.map(unpack);
    });
  }

  async setStatus(id: string, status: OrganizationDefinitionStatus): Promise<OrganizationDefinitionRow> {
    const definitionId = parseDatabaseUuid(id, "definitionId");
    return withDefaultOrganization(this.#db, this.#defaultOrganizationId, async (tx) => {
    const [updated] = await tx
      .update(organizationDefinitions)
      .set({ status })
      .where(eq(organizationDefinitions.id, definitionId))
      .returning();
    if (!updated) throw new Error(`organization_definitions: unknown id ${definitionId}`);
    return unpack(updated);
    });
  }
}
