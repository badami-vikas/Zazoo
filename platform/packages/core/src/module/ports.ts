/**
 * ModuleStore — the port a persistent (Drizzle) implementation binds
 * against, mirroring capability/ports.ts's `CapabilityStore` shape 1:1 (same
 * create/get/list + upsert-state pattern). In-memory implementation here lets
 * @bridge/core run + be tested with no database.
 */
import type {
  CommonsInstallationSource,
  ModuleAttachment,
  ModuleInstallationRow,
  ModuleVersionState,
} from "./types.js";
import { canonicalizeJson, canonicalizeManifest } from "./signing.js";
import { parseModuleManifest } from "./manifest.js";

export type ModuleAttachmentTarget = Pick<ModuleAttachment, "ownerModuleName" | "agentId" | "needId">;

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

function assertSameImmutableContent(
  existing: ModuleInstallationRow,
  incoming: Omit<ModuleInstallationRow, "id" | "createdAt">,
): void {
  if (
    canonicalizeManifest(existing.manifest) !== canonicalizeManifest(incoming.manifest) ||
    existing.lineageManifestId !== incoming.lineageManifestId ||
    !sameAttachment(existing.moduleAttachment, incoming.moduleAttachment) ||
    canonicalizeJson(existing.commonsSource ?? null) !== canonicalizeJson(incoming.commonsSource ?? null)
  ) {
    throw new Error("module_installations: conflicting immutable content for attachment identity");
  }
}

export interface ModuleStore {
  create(row: Omit<ModuleInstallationRow, "id" | "createdAt">): Promise<ModuleInstallationRow>;
  get(id: string): Promise<ModuleInstallationRow | null>;
  list(
    organizationId: string,
    opts: {
      limit: number;
      offset: number;
      installedRootsOnly?: boolean;
    },
  ): Promise<{ items: ModuleInstallationRow[]; total: number }>;
  /** All installation rows for one (organizationId, moduleName) — the population
   * promote/rollback reason over (to find the currently-`available` row). */
  listVersions(organizationId: string, moduleName: string): Promise<ModuleInstallationRow[]>;
  getAvailable(
    organizationId: string,
    moduleName: string,
    attachmentTarget?: ModuleAttachmentTarget,
  ): Promise<ModuleInstallationRow | null>;
  setComputedRisk(id: string, risk: ModuleInstallationRow["computedRisk"]): Promise<ModuleInstallationRow>;
  setState(id: string, state: ModuleVersionState): Promise<ModuleInstallationRow>;
  setStatus(id: string, status: ModuleInstallationRow["status"]): Promise<ModuleInstallationRow>;
  setCommonsSource(id: string, source: CommonsInstallationSource): Promise<ModuleInstallationRow>;
  setNormalizedManifest(id: string, manifest: ModuleInstallationRow["manifest"]): Promise<ModuleInstallationRow>;
}

/** In-memory `ModuleStore` — dev/test default, mirrors InMemoryCapabilityStore's shape. */
export class InMemoryModuleStore implements ModuleStore {
  readonly rows = new Map<string, ModuleInstallationRow>();
  #idCounter = 0;

  async create(row: Omit<ModuleInstallationRow, "id" | "createdAt">): Promise<ModuleInstallationRow> {
    const existing = [...this.rows.values()].find(
      (candidate) =>
        candidate.organizationId === row.organizationId &&
        candidate.moduleName === row.moduleName &&
        candidate.moduleVersion === row.moduleVersion &&
        matchesAttachmentTarget(candidate, row.moduleAttachment),
    );
    if (existing) {
      assertSameImmutableContent(existing, row);
      return existing;
    }
    const id = `pkginst_${++this.#idCounter}`;
    const full: ModuleInstallationRow = { ...row, id, createdAt: new Date().toISOString() };
    this.rows.set(id, full);
    return full;
  }

  async get(id: string): Promise<ModuleInstallationRow | null> {
    return this.rows.get(id) ?? null;
  }

  async list(
    organizationId: string,
    opts: {
      limit: number;
      offset: number;
      installedRootsOnly?: boolean;
    },
  ): Promise<{ items: ModuleInstallationRow[]; total: number }> {
    const all = [...this.rows.values()]
      .filter((r) => r.organizationId === organizationId)
      .filter(
        (r) =>
          !opts.installedRootsOnly ||
          (
            r.state === "available" &&
            r.status === "installed" &&
            r.moduleAttachment === undefined
          ),
      )
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    return { items: all.slice(opts.offset, opts.offset + opts.limit), total: all.length };
  }

  async listVersions(organizationId: string, moduleName: string): Promise<ModuleInstallationRow[]> {
    return [...this.rows.values()]
      .filter((r) => r.organizationId === organizationId && r.moduleName === moduleName)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }

  async getAvailable(
    organizationId: string,
    moduleName: string,
    attachmentTarget?: ModuleAttachmentTarget,
  ): Promise<ModuleInstallationRow | null> {
    const versions = await this.listVersions(organizationId, moduleName);
    return versions.find((r) => r.state === "available" && matchesAttachmentTarget(r, attachmentTarget)) ?? null;
  }

  async setState(id: string, state: ModuleVersionState): Promise<ModuleInstallationRow> {
    const existing = this.rows.get(id);
    if (!existing) throw new Error(`module_installations: unknown id ${id}`);
    const updated: ModuleInstallationRow = { ...existing, state };
    this.rows.set(id, updated);
    return updated;
  }

  async setComputedRisk(id: string, risk: ModuleInstallationRow["computedRisk"]): Promise<ModuleInstallationRow> {
    const existing = this.rows.get(id);
    if (!existing) throw new Error(`module_installations: unknown id ${id}`);
    const updated: ModuleInstallationRow = { ...existing, computedRisk: risk };
    this.rows.set(id, updated);
    return updated;
  }

  async setStatus(id: string, status: ModuleInstallationRow["status"]): Promise<ModuleInstallationRow> {
    const existing = this.rows.get(id);
    if (!existing) throw new Error(`module_installations: unknown id ${id}`);
    const updated: ModuleInstallationRow = { ...existing, status };
    this.rows.set(id, updated);
    return updated;
  }

  async setCommonsSource(id: string, source: CommonsInstallationSource): Promise<ModuleInstallationRow> {
    const existing = this.rows.get(id);
    if (!existing) throw new Error(`module_installations: unknown id ${id}`);
    if (
      existing.commonsSource &&
      canonicalizeJson(existing.commonsSource) !== canonicalizeJson(source)
    ) {
      throw new Error("module_installations: conflicting immutable Commons source");
    }
    const updated: ModuleInstallationRow = { ...existing, commonsSource: source };
    this.rows.set(id, updated);
    return updated;
  }

  async setNormalizedManifest(id: string, manifest: ModuleInstallationRow["manifest"]): Promise<ModuleInstallationRow> {
    const existing = this.rows.get(id);
    if (!existing) throw new Error(`module_installations: unknown id ${id}`);
    const normalizedExisting = parseModuleManifest({ module: existing.manifest });
    if (canonicalizeManifest(normalizedExisting) !== canonicalizeManifest(manifest)) {
      throw new Error("module_installations: normalization would change immutable Module content");
    }
    const updated: ModuleInstallationRow = { ...existing, manifest };
    this.rows.set(id, updated);
    return updated;
  }
}
