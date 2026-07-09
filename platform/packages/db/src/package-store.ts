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
 * `create()` treats (workspaceId, packageName, packageVersion) as a logical
 * key — a second `create()` call with the SAME name+version returns the
 * EXISTING row unchanged rather than inserting a duplicate or throwing a
 * unique-constraint error. This mirrors how `capability.register` re-running
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
import type { PackageInstallationRow, PackageManifest, PackageStore, PackageVersionState } from "@bridge/core";
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
    createdAt: row.createdAt.toISOString(),
  };
}

export class DrizzlePackageStore implements PackageStore {
  #db: Database;
  constructor(db: Database) {
    this.#db = db;
  }

  /**
   * Idempotent on (workspaceId, packageName, packageVersion): a re-register
   * of the SAME name+version returns the existing row unchanged instead of
   * inserting a duplicate (see module doc comment). A genuinely new version
   * always inserts a fresh row.
   */
  async create(row: Omit<PackageInstallationRow, "id" | "createdAt">): Promise<PackageInstallationRow> {
    const validatedManifest = parsePackageManifestRow(row.manifest);
    const existing = await this.#db
      .select()
      .from(packageInstallations)
      .where(
        and(
          eq(packageInstallations.workspaceId, row.workspaceId),
          eq(packageInstallations.packageName, row.packageName),
          eq(packageInstallations.packageVersion, row.packageVersion),
        ),
      )
      .limit(1);
    if (existing[0]) {
      return unpack(existing[0]);
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
      })
      .returning();
    if (!inserted) throw new Error("package_installations: insert returned no row");
    return unpack(inserted);
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

  async getAvailable(workspaceId: string, packageName: string): Promise<PackageInstallationRow | null> {
    const rows = await this.#db
      .select()
      .from(packageInstallations)
      .where(
        and(
          eq(packageInstallations.workspaceId, workspaceId),
          eq(packageInstallations.packageName, packageName),
          eq(packageInstallations.state, "available"),
        ),
      )
      .limit(1);
    const row = rows[0];
    return row ? unpack(row) : null;
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
