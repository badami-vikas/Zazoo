/**
 * PackageStore — the port a persistent (Drizzle) implementation binds
 * against, mirroring capability/ports.ts's `CapabilityStore` shape 1:1 (same
 * create/get/list + upsert-state pattern). In-memory implementation here lets
 * @bridge/core run + be tested with no database.
 */
import type { PackageInstallationRow, PackageModuleAttachment, PackageVersionState } from "./types.js";

export type PackageAttachmentTarget = Pick<PackageModuleAttachment, "modulePackageName" | "agentId" | "needId">;

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

export interface PackageStore {
  create(row: Omit<PackageInstallationRow, "id" | "createdAt">): Promise<PackageInstallationRow>;
  get(id: string): Promise<PackageInstallationRow | null>;
  list(workspaceId: string, opts: { limit: number; offset: number }): Promise<{ items: PackageInstallationRow[]; total: number }>;
  /** All installation rows for one (workspaceId, packageName) — the population
   * promote/rollback reason over (to find the currently-`available` row). */
  listVersions(workspaceId: string, packageName: string): Promise<PackageInstallationRow[]>;
  getAvailable(
    workspaceId: string,
    packageName: string,
    attachmentTarget?: PackageAttachmentTarget,
  ): Promise<PackageInstallationRow | null>;
  setComputedRisk(id: string, risk: PackageInstallationRow["computedRisk"]): Promise<PackageInstallationRow>;
  setState(id: string, state: PackageVersionState): Promise<PackageInstallationRow>;
  setStatus(id: string, status: PackageInstallationRow["status"]): Promise<PackageInstallationRow>;
}

/** In-memory `PackageStore` — dev/test default, mirrors InMemoryCapabilityStore's shape. */
export class InMemoryPackageStore implements PackageStore {
  readonly rows = new Map<string, PackageInstallationRow>();
  #idCounter = 0;

  async create(row: Omit<PackageInstallationRow, "id" | "createdAt">): Promise<PackageInstallationRow> {
    const existing = [...this.rows.values()].find(
      (candidate) =>
        candidate.workspaceId === row.workspaceId &&
        candidate.packageName === row.packageName &&
        candidate.packageVersion === row.packageVersion &&
        sameAttachment(candidate.moduleAttachment, row.moduleAttachment),
    );
    if (existing) return existing;
    const id = `pkginst_${++this.#idCounter}`;
    const full: PackageInstallationRow = { ...row, id, createdAt: new Date().toISOString() };
    this.rows.set(id, full);
    return full;
  }

  async get(id: string): Promise<PackageInstallationRow | null> {
    return this.rows.get(id) ?? null;
  }

  async list(workspaceId: string, opts: { limit: number; offset: number }): Promise<{ items: PackageInstallationRow[]; total: number }> {
    const all = [...this.rows.values()]
      .filter((r) => r.workspaceId === workspaceId)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    return { items: all.slice(opts.offset, opts.offset + opts.limit), total: all.length };
  }

  async listVersions(workspaceId: string, packageName: string): Promise<PackageInstallationRow[]> {
    return [...this.rows.values()]
      .filter((r) => r.workspaceId === workspaceId && r.packageName === packageName)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }

  async getAvailable(
    workspaceId: string,
    packageName: string,
    attachmentTarget?: PackageAttachmentTarget,
  ): Promise<PackageInstallationRow | null> {
    const versions = await this.listVersions(workspaceId, packageName);
    return versions.find((r) => r.state === "available" && matchesAttachmentTarget(r, attachmentTarget)) ?? null;
  }

  async setState(id: string, state: PackageVersionState): Promise<PackageInstallationRow> {
    const existing = this.rows.get(id);
    if (!existing) throw new Error(`package_installations: unknown id ${id}`);
    const updated: PackageInstallationRow = { ...existing, state };
    this.rows.set(id, updated);
    return updated;
  }

  async setComputedRisk(id: string, risk: PackageInstallationRow["computedRisk"]): Promise<PackageInstallationRow> {
    const existing = this.rows.get(id);
    if (!existing) throw new Error(`package_installations: unknown id ${id}`);
    const updated: PackageInstallationRow = { ...existing, computedRisk: risk };
    this.rows.set(id, updated);
    return updated;
  }

  async setStatus(id: string, status: PackageInstallationRow["status"]): Promise<PackageInstallationRow> {
    const existing = this.rows.get(id);
    if (!existing) throw new Error(`package_installations: unknown id ${id}`);
    const updated: PackageInstallationRow = { ...existing, status };
    this.rows.set(id, updated);
    return updated;
  }
}
