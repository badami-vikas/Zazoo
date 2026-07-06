/**
 * PackageStore — the port a persistent (Drizzle) implementation binds
 * against, mirroring capability/ports.ts's `CapabilityStore` shape 1:1 (same
 * create/get/list + upsert-state pattern). In-memory implementation here lets
 * @bridge/core run + be tested with no database.
 */
import type { PackageInstallationRow, PackageVersionState } from "./types.js";

export interface PackageStore {
  create(row: Omit<PackageInstallationRow, "id" | "createdAt">): Promise<PackageInstallationRow>;
  get(id: string): Promise<PackageInstallationRow | null>;
  list(workspaceId: string, opts: { limit: number; offset: number }): Promise<{ items: PackageInstallationRow[]; total: number }>;
  /** All installation rows for one (workspaceId, packageName) — the population
   * promote/rollback reason over (to find the currently-`available` row). */
  listVersions(workspaceId: string, packageName: string): Promise<PackageInstallationRow[]>;
  getAvailable(workspaceId: string, packageName: string): Promise<PackageInstallationRow | null>;
  setState(id: string, state: PackageVersionState): Promise<PackageInstallationRow>;
  setStatus(id: string, status: PackageInstallationRow["status"]): Promise<PackageInstallationRow>;
}

/** In-memory `PackageStore` — dev/test default, mirrors InMemoryCapabilityStore's shape. */
export class InMemoryPackageStore implements PackageStore {
  readonly rows = new Map<string, PackageInstallationRow>();
  #idCounter = 0;

  async create(row: Omit<PackageInstallationRow, "id" | "createdAt">): Promise<PackageInstallationRow> {
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

  async getAvailable(workspaceId: string, packageName: string): Promise<PackageInstallationRow | null> {
    const versions = await this.listVersions(workspaceId, packageName);
    return versions.find((r) => r.state === "available") ?? null;
  }

  async setState(id: string, state: PackageVersionState): Promise<PackageInstallationRow> {
    const existing = this.rows.get(id);
    if (!existing) throw new Error(`package_installations: unknown id ${id}`);
    const updated: PackageInstallationRow = { ...existing, state };
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
