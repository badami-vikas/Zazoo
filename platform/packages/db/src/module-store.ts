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
import { and, eq, count, isNull } from "drizzle-orm";
import { z } from "zod";
import {
  canonicalizeJson,
  canonicalizeManifest,
  parseModuleManifest,
  storedTaintLabelOrUnknown,
} from "@bridge/core";
import type {
  CommonsInstallationSource,
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
  taintLabel: z.unknown().optional(),
});

const commonsSourceSchema = z.object({
  contentHash: z.string().regex(/^sha256:[0-9a-f]{64}$/),
  manifestHash: z.string().regex(/^sha256:[0-9a-f]{64}$/),
  entry: z.unknown(),
  taintLabel: z.unknown().optional(),
});

const commonsEntrySchema = z.object({
  name: z.string().min(1),
  version: z.string().min(1),
  kind: z.enum([
    "skill",
    "automation",
    "agent",
    "module",
    "view",
    "integration_bundle",
    "organization_definition",
  ]),
  summary: z.string(),
  tags: z.array(z.string()),
  manifest: z.unknown(),
  provenance: z.object({
    sourceRepository: z.string(),
    sourceRef: z.string(),
    inspectedCommit: z.string(),
    repositoryLicense: z.string(),
    contentLicense: z.string(),
    licenseVerified: z.boolean(),
  }),
  securityScan: z.object({
    scanner: z.literal("bridge-commons-manifest"),
    scannerVersion: z.literal("1.0.0"),
    policyVersion: z.literal("CM1-2026-07"),
    status: z.enum(["passed", "failed"]),
    riskBand: z.enum([
      "informational",
      "advisory",
      "transformational",
      "operational",
      "external",
    ]),
    lethalTrifecta: z.boolean(),
    dependencyPins: z.array(z.object({
      name: z.string(),
      version: z.string(),
      contentHash: z.string(),
    })).optional(),
    checks: z.array(z.object({
      id: z.string(),
      status: z.enum(["pass", "warning", "fail"]),
      detail: z.string(),
    })),
  }),
  integrity: z.object({
    algorithm: z.literal("sha256"),
    value: z.string().regex(/^sha256:[0-9a-f]{64}$/),
  }),
  publishedAt: z.string(),
  signedSource: z.object({
    vocabularyVersion: z.union([z.literal(2), z.literal(3)]),
    canonicalContent: z.string(),
  }).optional(),
  signature: z.object({
    signature: z.string(),
    publicKey: z.string(),
    algorithm: z.literal("ed25519"),
    signedAt: z.string(),
  }).optional(),
});

function parseCommonsEntry(raw: unknown): CommonsInstallationSource["entry"] {
  const parsed = commonsEntrySchema.parse(raw);
  return {
    name: parsed.name,
    version: parsed.version,
    kind: parsed.kind,
    summary: parsed.summary,
    tags: parsed.tags,
    manifest: parseModuleManifestRow(parsed.manifest),
    provenance: parsed.provenance,
    securityScan: {
      scanner: parsed.securityScan.scanner,
      scannerVersion: parsed.securityScan.scannerVersion,
      policyVersion: parsed.securityScan.policyVersion,
      status: parsed.securityScan.status,
      riskBand: parsed.securityScan.riskBand,
      lethalTrifecta: parsed.securityScan.lethalTrifecta,
      checks: parsed.securityScan.checks,
      ...(parsed.securityScan.dependencyPins
        ? { dependencyPins: parsed.securityScan.dependencyPins }
        : {}),
    },
    integrity: parsed.integrity,
    publishedAt: parsed.publishedAt,
    ...(parsed.signedSource ? { signedSource: parsed.signedSource } : {}),
    ...(parsed.signature ? { signature: parsed.signature } : {}),
  };
}

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
  const parsedModuleAttachment = row.moduleAttachment === null
    ? undefined
    : moduleAttachmentSchema.parse(row.moduleAttachment);
  const moduleAttachment =
    parsedModuleAttachment === undefined
      ? undefined
      : {
          source: parsedModuleAttachment.source,
          ownerModuleName: parsedModuleAttachment.ownerModuleName,
          agentId: parsedModuleAttachment.agentId,
          needId: parsedModuleAttachment.needId,
          contentHash: parsedModuleAttachment.contentHash,
          taintLabel: storedTaintLabelOrUnknown(
            parsedModuleAttachment.taintLabel,
          ).label,
        };
  const parsedCommonsSource = row.commonsSource === null
    ? undefined
    : commonsSourceSchema.parse(row.commonsSource);
  const commonsSource: CommonsInstallationSource | undefined =
    parsedCommonsSource === undefined
      ? undefined
      : {
          contentHash: parsedCommonsSource.contentHash,
          manifestHash: parsedCommonsSource.manifestHash,
          entry: parseCommonsEntry(parsedCommonsSource.entry),
          taintLabel: storedTaintLabelOrUnknown(
            parsedCommonsSource.taintLabel,
          ).label,
        };
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
    displayNameOverride: row.displayNameOverride,
    ...(moduleAttachment ? { moduleAttachment } : {}),
    ...(commonsSource ? { commonsSource } : {}),
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
    !sameAttachment(existing.moduleAttachment, incoming.moduleAttachment) ||
    canonicalizeJson(existing.commonsSource ?? null) !== canonicalizeJson(incoming.commonsSource ?? null)
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
        ...(row.commonsSource ? { commonsSource: row.commonsSource } : {}),
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

  async list(
    organizationId: string,
    opts: {
      limit: number;
      offset: number;
      installedRootsOnly?: boolean;
    },
  ): Promise<{ items: ModuleInstallationRow[]; total: number }> {
    return withOrganizationOnly(this.#db, organizationId, async (tx) => {
    const where = opts.installedRootsOnly
      ? and(
          eq(moduleInstallations.organizationId, organizationId),
          eq(moduleInstallations.state, "available"),
          eq(moduleInstallations.status, "installed"),
          isNull(moduleInstallations.moduleAttachment),
        )
      : eq(moduleInstallations.organizationId, organizationId);
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

  async setCommonsSource(id: string, source: CommonsInstallationSource): Promise<ModuleInstallationRow> {
    return withDefaultOrganization(this.#db, this.#defaultOrganizationId, async (tx) => {
      const [current] = await tx.select().from(moduleInstallations)
        .where(eq(moduleInstallations.id, id))
        .for("update")
        .limit(1);
      if (!current) throw new Error(`module_installations: unknown id ${id}`);
      if (
        current.commonsSource !== null &&
        canonicalizeJson(current.commonsSource) !== canonicalizeJson(source)
      ) {
        throw new Error("module_installations: conflicting immutable Commons source");
      }

      const [updated] = await tx.update(moduleInstallations)
        .set({ commonsSource: source })
        .where(eq(moduleInstallations.id, id))
        .returning();
      if (!updated) throw new Error(`module_installations: unknown id ${id}`);
      return unpack(updated);
    });
  }

  async setDisplayNameOverride(
    organizationId: string,
    moduleName: string,
    displayNameOverride: string | null,
  ): Promise<ModuleInstallationRow[]> {
    return withDefaultOrganization(this.#db, this.#defaultOrganizationId, async (tx) => {
      const updated = await tx.update(moduleInstallations)
        .set({ displayNameOverride })
        .where(and(
          eq(moduleInstallations.organizationId, organizationId),
          eq(moduleInstallations.moduleName, moduleName),
        ))
        .returning();
      return updated.map(unpack);
    });
  }

  async setNormalizedManifest(id: string, manifest: ModuleManifest): Promise<ModuleInstallationRow> {
    return withDefaultOrganization(this.#db, this.#defaultOrganizationId, async (tx) => {
      const [current] = await tx.select().from(moduleInstallations)
        .where(eq(moduleInstallations.id, id))
        .for("update")
        .limit(1);
      if (!current) throw new Error(`module_installations: unknown id ${id}`);
      const normalizedExisting = parseModuleManifest({ module: parseModuleManifestRow(current.manifest) });
      const validatedIncoming = parseModuleManifestRow(manifest);
      if (canonicalizeManifest(normalizedExisting) !== canonicalizeManifest(validatedIncoming)) {
        throw new Error("module_installations: normalization would change immutable Module content");
      }
      const [updated] = await tx.update(moduleInstallations)
        .set({ manifest: validatedIncoming })
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
