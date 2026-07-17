/**
 * DrizzlePackageStore — binds the core `PackageStore` port
 * (@bridge/core's package/ports.ts) to `package_installations`
 * (schema.ts's LAYER 8 addition, ADR-023). Mirrors DrizzleCapabilityStore's
 * shape (capability-store.ts): a single class, `#db` private field, an
 * `unpack` helper translating the Drizzle row into the port's plain-object
 * shape, jsonb validated at the read/write boundary with a colocated Zod
 * schema (this package is where jsonb wire-shapes are validated —
 * @bridge/core stays zero-runtime-deps, no zod there).
 *
 * Idempotency (ADR-023, docs/BUGS.md "capability re-registration idempotency"):
 * `create()` treats workspace/package/version plus Module-Agent-need attachment
 * as a logical key — a retry returns the EXISTING row unchanged rather than
 * inserting a duplicate or throwing a unique-constraint error. This mirrors
 * how `capability.register` re-running
 * bundled-capability registration during a package's `install` step would
 * otherwise collide with `capability_manifests_uq` (workspace_id, name,
 * version) on every re-install of the SAME version — see the paired fix in
 * router.ts's `packages.install` (capability-level idempotency) and the new
 * `install v1 -> install v2 -> rollback` test. A genuinely NEW version
 * (different packageVersion) always inserts a new row with
 * `lineageManifestId` chained back to the version it forked from, per
 * package/lifecycle.ts's append-only rollback invariant.
 */
import { and, eq, count } from "drizzle-orm";
import { z } from "zod";
import { canonicalizeManifest } from "@bridge/core";
import type {
  PackageAttachmentTarget,
  PackageInstallationRow,
  PackageManifest,
  PackageStore,
  PackageVersionState,
} from "@bridge/core";
import type { Database } from "./client.js";
import { packageInstallations } from "./schema.js";

/** Structural mirror of PackageManifest's jsonb shape — validated at the
 * read/write boundary the same way workspace-definition-store.ts validates
 * `blueprint`. Deliberately permissive on `capabilities[]` (`z.array(z.any())`
 * plus a shape check for the fields this store itself reads) since the full
 * CapabilityManifest shape is @bridge/core's to own; this schema only
 * guards the PackageManifest envelope fields the store/router actually touch.
 */
const packageManifestSchema = z
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
    workspaceVocab: z.object({
      alignsToBridgeTheme: z.boolean(),
      domainTerms: z.record(z.string(), z.string()),
    }),
  })
  .passthrough();

const moduleAttachmentSchema = z.object({
  source: z.literal("commons"),
  modulePackageName: z.string().min(1),
  agentId: z.string().min(1),
  needId: z.string().min(1),
  contentHash: z.string().startsWith("sha256:"),
});

/**
 * Validate `package_installations.manifest` jsonb. Throws loudly on a
 * malformed shape rather than silently treating a corrupted manifest as
 * empty — same reasoning as capability-store.ts's `parseDependencies`: a
 * silently-emptied manifest would under-count risk / lose the capability
 * bundle entirely instead of surfacing the corruption.
 */
export function parsePackageManifestRow(raw: unknown): PackageManifest {
  const result = packageManifestSchema.safeParse(raw);
  if (!result.success) {
    throw new Error(`Invalid package_installations.manifest jsonb: ${result.error.message}`);
  }
  return result.data as unknown as PackageManifest;
}

function unpack(row: typeof packageInstallations.$inferSelect): PackageInstallationRow {
  const moduleAttachment = row.moduleAttachment === null
    ? undefined
    : moduleAttachmentSchema.parse(row.moduleAttachment);
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    packageName: row.packageName,
    packageVersion: row.packageVersion,
    manifest: parsePackageManifestRow(row.manifest),
    computedRisk: row.computedRisk as PackageInstallationRow["computedRisk"],
    state: row.state as PackageVersionState,
    status: row.status as PackageInstallationRow["status"],
    lineageManifestId: row.lineageManifestId,
    ...(moduleAttachment ? { moduleAttachment } : {}),
    createdAt: row.createdAt.toISOString(),
  };
}

function sameAttachment(
  left: PackageInstallationRow["moduleAttachment"],
  right: PackageInstallationRow["moduleAttachment"],
): boolean {
  if (!left || !right) return left === right;
  return (
    left.source === right.source &&
    left.modulePackageName === right.modulePackageName &&
    left.agentId === right.agentId &&
    left.needId === right.needId &&
    left.contentHash === right.contentHash
  );
}

function matchesAttachmentTarget(
  row: PackageInstallationRow,
  target: PackageAttachmentTarget | undefined,
): boolean {
  if (!target) return row.moduleAttachment === undefined;
  return Boolean(
    row.moduleAttachment &&
      row.moduleAttachment.modulePackageName === target.modulePackageName &&
      row.moduleAttachment.agentId === target.agentId &&
      row.moduleAttachment.needId === target.needId,
  );
}

function assertSameImmutableContent(
  existing: PackageInstallationRow,
  incoming: Omit<PackageInstallationRow, "id" | "createdAt">,
  validatedManifest: PackageManifest,
): void {
  if (
    canonicalizeManifest(existing.manifest) !== canonicalizeManifest(validatedManifest) ||
    existing.lineageManifestId !== incoming.lineageManifestId ||
    !sameAttachment(existing.moduleAttachment, incoming.moduleAttachment)
  ) {
    throw new Error("package_installations: conflicting immutable content for attachment identity");
  }
}

export class DrizzlePackageStore implements PackageStore {
  #db: Database;
  constructor(db: Database) {
    this.#db = db;
  }

  /**
   * Idempotent on workspace/package/version plus attachment identity. A
   * re-register returns the existing row unchanged; a new version or distinct
   * declared Module-Agent-need attachment inserts a fresh row.
   */
  async create(row: Omit<PackageInstallationRow, "id" | "createdAt">): Promise<PackageInstallationRow> {
    const validatedManifest = parsePackageManifestRow(row.manifest);
    const existingRows = await this.#db
      .select()
      .from(packageInstallations)
      .where(
        and(
          eq(packageInstallations.workspaceId, row.workspaceId),
          eq(packageInstallations.packageName, row.packageName),
          eq(packageInstallations.packageVersion, row.packageVersion),
        ),
      );
    const existing = existingRows
      .map(unpack)
      .find((candidate) => matchesAttachmentTarget(candidate, row.moduleAttachment));
    if (existing) {
      assertSameImmutableContent(existing, row, validatedManifest);
      return existing;
    }

    const [inserted] = await this.#db
      .insert(packageInstallations)
      .values({
        workspaceId: row.workspaceId,
        packageName: row.packageName,
        packageVersion: row.packageVersion,
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

    const racedRows = await this.#db
      .select()
      .from(packageInstallations)
      .where(
        and(
          eq(packageInstallations.workspaceId, row.workspaceId),
          eq(packageInstallations.packageName, row.packageName),
          eq(packageInstallations.packageVersion, row.packageVersion),
        ),
      );
    const raced = racedRows
      .map(unpack)
      .find((candidate) => matchesAttachmentTarget(candidate, row.moduleAttachment));
    if (!raced) throw new Error("package_installations: conflicting insert did not match the attachment identity");
    assertSameImmutableContent(raced, row, validatedManifest);
    return raced;
  }

  async get(id: string): Promise<PackageInstallationRow | null> {
    const rows = await this.#db.select().from(packageInstallations).where(eq(packageInstallations.id, id)).limit(1);
    const row = rows[0];
    return row ? unpack(row) : null;
  }

  async list(workspaceId: string, opts: { limit: number; offset: number }): Promise<{ items: PackageInstallationRow[]; total: number }> {
    const where = eq(packageInstallations.workspaceId, workspaceId);
    const [rows, totalRows] = await Promise.all([
      this.#db
        .select()
        .from(packageInstallations)
        .where(where)
        .orderBy(packageInstallations.createdAt)
        .limit(opts.limit)
        .offset(opts.offset),
      this.#db.select({ value: count() }).from(packageInstallations).where(where),
    ]);
    return { items: rows.map(unpack), total: Number(totalRows[0]?.value ?? 0) };
  }

  async listVersions(workspaceId: string, packageName: string): Promise<PackageInstallationRow[]> {
    const rows = await this.#db
      .select()
      .from(packageInstallations)
      .where(and(eq(packageInstallations.workspaceId, workspaceId), eq(packageInstallations.packageName, packageName)))
      .orderBy(packageInstallations.createdAt);
    return rows.map(unpack);
  }

  async getAvailable(
    workspaceId: string,
    packageName: string,
    attachmentTarget?: PackageAttachmentTarget,
  ): Promise<PackageInstallationRow | null> {
    const rows = await this.#db
      .select()
      .from(packageInstallations)
      .where(
        and(
          eq(packageInstallations.workspaceId, workspaceId),
          eq(packageInstallations.packageName, packageName),
          eq(packageInstallations.state, "available"),
        ),
      );
    return rows.map(unpack).find((row) => matchesAttachmentTarget(row, attachmentTarget)) ?? null;
  }

  async setState(id: string, state: PackageVersionState): Promise<PackageInstallationRow> {
    const [updated] = await this.#db
      .update(packageInstallations)
      .set({ state })
      .where(eq(packageInstallations.id, id))
      .returning();
    if (!updated) throw new Error(`package_installations: unknown id ${id}`);
    return unpack(updated);
  }

  async setComputedRisk(id: string, risk: PackageInstallationRow["computedRisk"]): Promise<PackageInstallationRow> {
    const [updated] = await this.#db
      .update(packageInstallations)
      .set({ computedRisk: risk })
      .where(eq(packageInstallations.id, id))
      .returning();
    if (!updated) throw new Error(`package_installations: unknown id ${id}`);
    return unpack(updated);
  }

  async setStatus(id: string, status: PackageInstallationRow["status"]): Promise<PackageInstallationRow> {
    const [updated] = await this.#db
      .update(packageInstallations)
      .set({ status })
      .where(eq(packageInstallations.id, id))
      .returning();
    if (!updated) throw new Error(`package_installations: unknown id ${id}`);
    return unpack(updated);
  }
}
