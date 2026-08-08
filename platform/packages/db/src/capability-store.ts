/**
 * DrizzleCapabilityStore — binds the core `CapabilityStore` port
 * (@bridge/core's capability/ports.ts) to `capability_manifests` +
 * `capability_states` (schema.ts's LAYER 8). Mirrors DrizzleLedgerStore's
 * shape (ledger-store.ts): a single class, `#db` private field, an `unpack`
 * helper translating the Drizzle row into the port's plain-object shape.
 *
 * `capability_manifests.manifest`/`dependencies` are jsonb — validated at the
 * read/write boundary with a colocated Zod schema, same reasoning as
 * governance-stores.ts's `agentCapabilityScopeSchema`: @bridge/core is a
 * zero-runtime-dependency module (no zod), so the jsonb wire-shape schema
 * lives here, the only place that touches the raw column.
 */
import { and, eq, count } from "drizzle-orm";
import { z } from "zod";
import type { CapabilityManifestRow, CapabilityStateRow, CapabilityStore, ComponentKind, TrustGrantView } from "@bridge/core";
import type { Database } from "./client.js";
import { capabilityManifests, capabilityStates, trustGrants } from "./schema.js";
import {
  withDefaultOrganization,
  withOrganizationOnly,
} from "./organization-context.js";

const dependencyEntrySchema = z.object({ manifestId: z.string().min(1), versionRange: z.string().min(1) });
export const dependenciesSchema = z.array(dependencyEntrySchema);

/**
 * Validate `capability_manifests.dependencies` jsonb. Throws loudly on a
 * malformed shape rather than silently treating a corrupted dependency list
 * as empty — an empty dependency closure would silently UNDER-count risk
 * (computeRisk's "composite risk = max over dependency closure" depends on
 * this list being complete), the same governance-hole shape
 * parseAgentCapabilityScope's doc comment warns about.
 */
export function parseDependencies(raw: unknown): Array<{ manifestId: string; versionRange: string }> {
  const result = dependenciesSchema.safeParse(raw ?? []);
  if (!result.success) {
    throw new Error(`Invalid capability_manifests.dependencies jsonb: ${result.error.message}`);
  }
  return result.data;
}

const evidenceSchema = z
  .object({
    activeRunCount: z.number().nonnegative().optional(),
    successRate: z.number().min(0).max(1).optional(),
    violationCount: z.number().nonnegative().optional(),
    ageDays: z.number().nonnegative().optional(),
  })
  .strict();

/** Validate `capability_states.evidence` jsonb — same throw-loudly reasoning. */
export function parseEvidence(raw: unknown): CapabilityStateRow["evidence"] {
  const result = evidenceSchema.safeParse(raw ?? {});
  if (!result.success) {
    throw new Error(`Invalid capability_states.evidence jsonb: ${result.error.message}`);
  }
  return Object.fromEntries(Object.entries(result.data).filter(([, value]) => value !== undefined));
}

function unpackManifest(row: typeof capabilityManifests.$inferSelect): CapabilityManifestRow {
  return {
    id: row.id,
    organizationId: row.organizationId,
    capabilityType: row.capabilityType as CapabilityManifestRow["capabilityType"],
    kind: row.kind as ComponentKind | null,
    name: row.name,
    version: row.version,
    origin: row.origin as CapabilityManifestRow["origin"],
    audience: row.audience as CapabilityManifestRow["audience"],
    manifest: row.manifest,
    computedRisk: row.computedRisk as CapabilityManifestRow["computedRisk"],
    dependencies: parseDependencies(row.dependencies),
    lineageManifestId: row.lineageManifestId,
    ownerUserId: row.ownerUserId,
    createdAt: row.createdAt.toISOString(),
    archivedAt: row.archivedAt ? row.archivedAt.toISOString() : null,
  };
}

function unpackState(row: typeof capabilityStates.$inferSelect): CapabilityStateRow {
  return {
    id: row.id,
    manifestId: row.manifestId,
    organizationId: row.organizationId,
    state: row.state as CapabilityStateRow["state"],
    trustedUntil: row.trustedUntil ? row.trustedUntil.toISOString() : null,
    suspended: row.suspended,
    suspendReason: row.suspendReason,
    evidence: parseEvidence(row.evidence),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export class DrizzleCapabilityStore implements CapabilityStore {
  #db: Database;
  #defaultOrganizationId: string | undefined;
  constructor(db: Database, defaultOrganizationId?: string) {
    this.#db = db;
    this.#defaultOrganizationId = defaultOrganizationId;
  }

  async createManifest(row: Omit<CapabilityManifestRow, "createdAt">): Promise<CapabilityManifestRow> {
    return withOrganizationOnly(this.#db, row.organizationId, async (tx) => {
    const validatedDeps = parseDependencies(row.dependencies);
    const [inserted] = await tx
      .insert(capabilityManifests)
      .values({
        id: row.id,
        organizationId: row.organizationId,
        capabilityType: row.capabilityType,
        ...(row.kind ? { kind: row.kind } : {}),
        name: row.name,
        version: row.version,
        origin: row.origin,
        audience: row.audience,
        manifest: row.manifest ?? {},
        computedRisk: row.computedRisk,
        dependencies: validatedDeps,
        ...(row.lineageManifestId ? { lineageManifestId: row.lineageManifestId } : {}),
        ...(row.ownerUserId ? { ownerUserId: row.ownerUserId } : {}),
      })
      .returning();
    if (!inserted) throw new Error("capability_manifests: insert returned no row");
    return unpackManifest(inserted);
    });
  }

  async getManifest(id: string): Promise<CapabilityManifestRow | null> {
    return withDefaultOrganization(this.#db, this.#defaultOrganizationId, async (tx) => {
    const rows = await tx.select().from(capabilityManifests).where(eq(capabilityManifests.id, id)).limit(1);
    const row = rows[0];
    return row ? unpackManifest(row) : null;
    });
  }

  /** Idempotency lookup (ADR-023): the (organization_id, name, version) natural
   * key `capability_manifests_uq` enforces at the DB — lets a caller check
   * before insert instead of colliding with the unique constraint. */
  async getManifestByNameVersion(organizationId: string, name: string, version: string): Promise<CapabilityManifestRow | null> {
    return withOrganizationOnly(this.#db, organizationId, async (tx) => {
    const rows = await tx
      .select()
      .from(capabilityManifests)
      .where(
        and(
          eq(capabilityManifests.organizationId, organizationId),
          eq(capabilityManifests.name, name),
          eq(capabilityManifests.version, version),
        ),
      )
      .limit(1);
    const row = rows[0];
    return row ? unpackManifest(row) : null;
    });
  }

  async listManifests(
    organizationId: string,
    opts: { limit: number; offset: number },
  ): Promise<{ items: CapabilityManifestRow[]; total: number }> {
    return withOrganizationOnly(this.#db, organizationId, async (tx) => {
    const where = eq(capabilityManifests.organizationId, organizationId);
    const [rows, totalRows] = await Promise.all([
      tx
        .select()
        .from(capabilityManifests)
        .where(where)
        .orderBy(capabilityManifests.createdAt)
        .limit(opts.limit)
        .offset(opts.offset),
      tx.select({ value: count() }).from(capabilityManifests).where(where),
    ]);
    return { items: rows.map(unpackManifest), total: Number(totalRows[0]?.value ?? 0) };
    });
  }

  async upsertState(row: Omit<CapabilityStateRow, "id" | "updatedAt">): Promise<CapabilityStateRow> {
    return withOrganizationOnly(this.#db, row.organizationId, async (tx) => {
    const validatedEvidence = parseEvidence(row.evidence);
    const existing = await tx
      .select({ id: capabilityStates.id })
      .from(capabilityStates)
      .where(eq(capabilityStates.manifestId, row.manifestId))
      .limit(1);

    if (existing[0]) {
      const [updated] = await tx
        .update(capabilityStates)
        .set({
          state: row.state,
          trustedUntil: row.trustedUntil ? new Date(row.trustedUntil) : null,
          suspended: row.suspended,
          suspendReason: row.suspendReason ?? null,
          evidence: validatedEvidence,
          updatedAt: new Date(),
        })
        .where(eq(capabilityStates.manifestId, row.manifestId))
        .returning();
      if (!updated) throw new Error("capability_states: update returned no row");
      return unpackState(updated);
    }

    const [inserted] = await tx
      .insert(capabilityStates)
      .values({
        manifestId: row.manifestId,
        organizationId: row.organizationId,
        state: row.state,
        trustedUntil: row.trustedUntil ? new Date(row.trustedUntil) : null,
        suspended: row.suspended,
        suspendReason: row.suspendReason ?? null,
        evidence: validatedEvidence,
      })
      .returning();
    if (!inserted) throw new Error("capability_states: insert returned no row");
    return unpackState(inserted);
    });
  }

  async getState(manifestId: string): Promise<CapabilityStateRow | null> {
    return withDefaultOrganization(this.#db, this.#defaultOrganizationId, async (tx) => {
    const rows = await tx
      .select()
      .from(capabilityStates)
      .where(and(eq(capabilityStates.manifestId, manifestId)))
      .limit(1);
    const row = rows[0];
    return row ? unpackState(row) : null;
    });
  }

  async listTrustGrants(organizationId: string): Promise<TrustGrantView[]> {
    return withOrganizationOnly(this.#db, organizationId, async (tx) => {
      const rows = await tx
        .select({
          capabilityClass: trustGrants.capabilityClass,
          riskBand: trustGrants.riskBand,
          autoActivate: trustGrants.autoActivate,
          revokedAt: trustGrants.revokedAt,
        })
        .from(trustGrants)
        .where(eq(trustGrants.organizationId, organizationId));
      return rows.map((r) => ({
        capabilityClass: r.capabilityClass,
        riskBand: r.riskBand as TrustGrantView["riskBand"],
        autoActivate: r.autoActivate,
        revokedAt: r.revokedAt ? r.revokedAt.toISOString() : null,
      }));
    });
  }
}
