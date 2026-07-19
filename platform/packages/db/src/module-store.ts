/**
 * DrizzleModuleStore — binds the core `ModuleStore` port
 * (@bridge/core's module/ports.ts) to `module_installations`
 * (schema.ts's LAYER 8 addition, ADR-023). Mirrors DrizzleCapabilityStore's
 * shape (capability-store.ts): a single class, `#db` private field, an
 * `unpack` helper translating the Drizzle row into the port's plain-object
 * shape, jsonb validated at the read/write boundary with a colocated Zod
 * schema (this module is where jsonb wire-shapes are validated —
 * @bridge/core stays zero-runtime-deps, no zod there).
 *
 * Idempotency (ADR-023, docs/BUGS.md "capability re-registration idempotency"):
 * `create()` treats organization/module/version plus Module-Agent-need attachment
 * as a logical key — a retry returns the EXISTING row unchanged rather than
 * inserting a duplicate or throwing a unique-constraint error. This mirrors
 * how `capability.register` re-running
 * bundled-capability registration during a module's `install` step would
 * otherwise collide with `capability_manifests_uq` (organization_id, name,
 * version) on every re-install of the SAME version — see the paired fix in
 * router.ts's `modules.install` (capability-level idempotency) and the new
 * `install v1 -> install v2 -> rollback` test. A genuinely NEW version
 * (different moduleVersion) always inserts a new row with
 * `lineageManifestId` chained back to the version it forked from, per
 * module/lifecycle.ts's append-only rollback invariant.
 */
import { and, eq, count } from "drizzle-orm";
import { z } from "zod";
import { canonicalizeManifest } from "@bridge/core";
import type {
  ModuleAttachmentTarget,
  ModuleInstallationRow,
  ModuleManifest,
  ModuleStore,
  ModuleVersionState,
} from "@bridge/core";
import type { Database } from "./client.js";
import { moduleInstallations } from "./schema.js";
import {
  withDefaultOrganization,
  withOrganizationOnly,
} from "./organization-context.js";

/** Structural mirror of ModuleManifest's jsonb shape — validated at the
 * read/write boundary the same way organization-definition-store.ts validates
 * `blueprint`. Deliberately permissive on `capabilities[]` (`z.array(z.any())`
 * plus a shape check for the fields this store itself reads) since the full
 * CapabilityManifest shape is @bridge/core's to own; this schema only
 * guards the ModuleManifest envelope fields the store/router actually touch.
 */
const moduleManifestSchema = z
  .object({
    name: z.string().min(1),
    version: z.string().min(1),
    kind: z.string().min(1),
    summary: z.string(),
    description: z.string(),
    lineageManifestId: z.string().nullable(),
    dependencies: z.array(z.object({ manifestId: z.string().min(1), version: z.string().min(1) })),
    capabilities: z.array(z.record(z.string(), z.unknown())).min(1),
    contextProviders: z.array(z.object({ kind: z.string(), required: z.boolean() })),
    organizationVocab: z.object({
      alignsToBridgeTheme: z.boolean(),
      domainTerms: z.record(z.string(), z.string()),
    }),
  })
  .passthrough();

const moduleAttachmentSchema = z.object({
  source: z.literal("commons"),
  ownerModuleName: z.string().min(1),
  agentId: z.string().min(1),
  needId: z.string().min(1),
  contentHash: z.string().startsWith("sha256:"),
});

/**
 * Validate `module_installations.manifest` jsonb. Throws loudly on a
 * malformed shape rather than silently treating a corrupted manifest as
 * empty — same reasoning as capability-store.ts's `parseDependencies`: a
 * silently-emptied manifest would under-count risk / lose the capability
 * bundle entirely instead of surfacing the corruption.
 */
export function parseModuleManifestRow(raw: unknown): ModuleManifest {
  const result = moduleManifestSchema.safeParse(raw);
  if (!result.success) {
    throw new Error(`Invalid module_installations.manifest jsonb: ${result.error.message}`);
  }
  return result.data as unknown as ModuleManifest;
}

function unpack(row: typeof moduleInstallations.$inferSelect): ModuleInstallationRow {
  const moduleAttachment = row.moduleAttachment === null
    ? undefined
    : moduleAttachmentSchema.parse(row.moduleAttachment);
  return {
    id: row.id,
    organizationId: row.organizationId,
    moduleName: row.moduleName,
    moduleVersion: row.moduleVersion,
    manifest: parseModuleManifestRow(row.manifest),
    computedRisk: row.computedRisk as ModuleInstallationRow["computedRisk"],
    state: row.state as ModuleVersionState,
    status: row.status as ModuleInstallationRow["status"],
    lineageManifestId: row.lineageManifestId,
    ...(moduleAttachment ? { moduleAttachment } : {}),
    createdAt: row.createdAt.toISOString(),
  };
}

function sameAttachment(
  left: ModuleInstallationRow["moduleAttachment"],
  right: ModuleInstallationRow["moduleAttachment"],
): boolean {
  if (!left || !right) return left === right;
  return (
    left.source === right.source &&
    left.ownerModuleName === right.ownerModuleName &&
    left.agentId === right.agentId &&
    left.needId === right.needId &&
    left.contentHash === right.contentHash
  );
}

function matchesAttachmentTarget(
  row: ModuleInstallationRow,
  target: ModuleAttachmentTarget | undefined,
): boolean {
  if (!target) return row.moduleAttachment === undefined;
  return Boolean(
    row.moduleAttachment &&
      row.moduleAttachment.ownerModuleName === target.ownerModuleName &&
      row.moduleAttachment.agentId === target.agentId &&
      row.moduleAttachment.needId === target.needId,
  );
}

function assertSameImmutableContent(
  existing: ModuleInstallationRow,
  incoming: Omit<ModuleInstallationRow, "id" | "createdAt">,
  validatedManifest: ModuleManifest,
): void {
  if (
    canonicalizeManifest(existing.manifest) !== canonicalizeManifest(validatedManifest) ||
    existing.lineageManifestId !== incoming.lineageManifestId ||
    !sameAttachment(existing.moduleAttachment, incoming.moduleAttachment)
  ) {
    throw new Error("module_installations: conflicting immutable content for attachment identity");
  }
}

export class DrizzleModuleStore implements ModuleStore {
  #db: Database;
  #defaultOrganizationId: string | undefined;
  constructor(db: Database, defaultOrganizationId?: string) {
    this.#db = db;
    this.#defaultOrganizationId = defaultOrganizationId;
  }

  /**
   * Idempotent on organization/module/version plus attachment identity. A
   * re-register returns the existing row unchanged; a new version or distinct
   * declared Module-Agent-need attachment inserts a fresh row.
   */
  async create(row: Omit<ModuleInstallationRow, "id" | "createdAt">): Promise<ModuleInstallationRow> {
    return withOrganizationOnly(this.#db, row.organizationId, async (tx) => {
    const validatedManifest = parseModuleManifestRow(row.manifest);
    const existingRows = await tx
      .select()
      .from(moduleInstallations)
      .where(
        and(
          eq(moduleInstallations.organizationId, row.organizationId),
          eq(moduleInstallations.moduleName, row.moduleName),
          eq(moduleInstallations.moduleVersion, row.moduleVersion),
        ),
      );
    const existing = existingRows
      .map(unpack)
      .find((candidate) => matchesAttachmentTarget(candidate, row.moduleAttachment));
    if (existing) {
      assertSameImmutableContent(existing, row, validatedManifest);
      return existing;
    }

    const [inserted] = await tx
      .insert(moduleInstallations)
      .values({
        organizationId: row.organizationId,
        moduleName: row.moduleName,
        moduleVersion: row.moduleVersion,
        manifest: validatedManifest,
        computedRisk: row.computedRisk,
        state: row.state,
        status: row.status,
        ...(row.lineageManifestId ? { lineageManifestId: row.lineageManifestId } : {}),
        ...(row.moduleAttachment ? { moduleAttachment: row.moduleAttachment } : {}),
      })
      .onConflictDoNothing()
      .returning();
    if (inserted) return unpack(inserted);

    const racedRows = await tx
      .select()
      .from(moduleInstallations)
      .where(
        and(
          eq(moduleInstallations.organizationId, row.organizationId),
          eq(moduleInstallations.moduleName, row.moduleName),
          eq(moduleInstallations.moduleVersion, row.moduleVersion),
        ),
      );
    const raced = racedRows
      .map(unpack)
      .find((candidate) => matchesAttachmentTarget(candidate, row.moduleAttachment));
    if (!raced) throw new Error("module_installations: conflicting insert did not match the attachment identity");
    assertSameImmutableContent(raced, row, validatedManifest);
    return raced;
    });
  }

  async get(id: string): Promise<ModuleInstallationRow | null> {
    return withDefaultOrganization(this.#db, this.#defaultOrganizationId, async (tx) => {
    const rows = await tx.select().from(moduleInstallations).where(eq(moduleInstallations.id, id)).limit(1);
    const row = rows[0];
    return row ? unpack(row) : null;
    });
  }

  async list(organizationId: string, opts: { limit: number; offset: number }): Promise<{ items: ModuleInstallationRow[]; total: number }> {
    return withOrganizationOnly(this.#db, organizationId, async (tx) => {
    const where = eq(moduleInstallations.organizationId, organizationId);
    const [rows, totalRows] = await Promise.all([
      tx
        .select()
        .from(moduleInstallations)
        .where(where)
        .orderBy(moduleInstallations.createdAt)
        .limit(opts.limit)
        .offset(opts.offset),
      tx.select({ value: count() }).from(moduleInstallations).where(where),
    ]);
    return { items: rows.map(unpack), total: Number(totalRows[0]?.value ?? 0) };
    });
  }

  async listVersions(organizationId: string, moduleName: string): Promise<ModuleInstallationRow[]> {
    return withOrganizationOnly(this.#db, organizationId, async (tx) => {
    const rows = await tx
      .select()
      .from(moduleInstallations)
      .where(and(eq(moduleInstallations.organizationId, organizationId), eq(moduleInstallations.moduleName, moduleName)))
      .orderBy(moduleInstallations.createdAt);
    return rows.map(unpack);
    });
  }

  async getAvailable(
    organizationId: string,
    moduleName: string,
    attachmentTarget?: ModuleAttachmentTarget,
  ): Promise<ModuleInstallationRow | null> {
    return withOrganizationOnly(this.#db, organizationId, async (tx) => {
    const rows = await tx
      .select()
      .from(moduleInstallations)
      .where(
        and(
          eq(moduleInstallations.organizationId, organizationId),
          eq(moduleInstallations.moduleName, moduleName),
          eq(moduleInstallations.state, "available"),
        ),
      );
    return rows.map(unpack).find((row) => matchesAttachmentTarget(row, attachmentTarget)) ?? null;
    });
  }

  async setState(id: string, state: ModuleVersionState): Promise<ModuleInstallationRow> {
    return withDefaultOrganization(this.#db, this.#defaultOrganizationId, async (tx) => {
    const [updated] = await tx
      .update(moduleInstallations)
      .set({ state })
      .where(eq(moduleInstallations.id, id))
      .returning();
    if (!updated) throw new Error(`module_installations: unknown id ${id}`);
    return unpack(updated);
    });
  }

  async setComputedRisk(id: string, risk: ModuleInstallationRow["computedRisk"]): Promise<ModuleInstallationRow> {
    return withDefaultOrganization(this.#db, this.#defaultOrganizationId, async (tx) => {
    const [updated] = await tx
      .update(moduleInstallations)
      .set({ computedRisk: risk })
      .where(eq(moduleInstallations.id, id))
      .returning();
    if (!updated) throw new Error(`module_installations: unknown id ${id}`);
    return unpack(updated);
    });
  }

  async setStatus(id: string, status: ModuleInstallationRow["status"]): Promise<ModuleInstallationRow> {
    return withDefaultOrganization(this.#db, this.#defaultOrganizationId, async (tx) => {
    const [updated] = await tx
      .update(moduleInstallations)
      .set({ status })
      .where(eq(moduleInstallations.id, id))
      .returning();
    if (!updated) throw new Error(`module_installations: unknown id ${id}`);
    return unpack(updated);
    });
  }
}
