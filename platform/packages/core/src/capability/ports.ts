/**
 * CapabilityStore — the port @bridge/db's DrizzleCapabilityStore binds against
 * (capability_manifests + capability_states), mirroring how LedgerStore (in
 * ports.ts) is defined in core and bound by DrizzleLedgerStore in @bridge/db.
 * The in-memory implementation here lets @bridge/core run + be tested with no
 * database, same as every other port in this package.
 */
import type { Audience, CapabilityOrigin, CapabilityState, CapabilityType, RiskBand } from "./types.js";

export interface CapabilityManifestRow {
  id: string;
  workspaceId: string;
  capabilityType: CapabilityType;
  name: string;
  version: string;
  origin: CapabilityOrigin;
  audience: Audience;
  manifest: unknown;
  computedRisk: RiskBand;
  dependencies: Array<{ manifestId: string; versionRange: string }>;
  lineageManifestId?: string | null;
  ownerUserId?: string | null;
  createdAt: string;
  archivedAt?: string | null;
}

export interface CapabilityStateRow {
  id: string;
  manifestId: string;
  workspaceId: string;
  state: CapabilityState;
  trustedUntil?: string | null;
  suspended: boolean;
  suspendReason?: string | null;
  evidence: {
    activeRunCount?: number | undefined;
    successRate?: number | undefined;
    violationCount?: number | undefined;
    ageDays?: number | undefined;
  };
  updatedAt: string;
}

export interface CapabilityStore {
  createManifest(row: Omit<CapabilityManifestRow, "createdAt">): Promise<CapabilityManifestRow>;
  getManifest(id: string): Promise<CapabilityManifestRow | null>;
  listManifests(workspaceId: string, opts: { limit: number; offset: number }): Promise<{ items: CapabilityManifestRow[]; total: number }>;

  /** Insert-or-update the ONE current-state row for a manifest (unique manifest_id). */
  upsertState(row: Omit<CapabilityStateRow, "id" | "updatedAt">): Promise<CapabilityStateRow>;
  getState(manifestId: string): Promise<CapabilityStateRow | null>;
}

/** In-memory `CapabilityStore` — dev/test default (mirrors InMemoryLedger's shape). */
export class InMemoryCapabilityStore implements CapabilityStore {
  readonly manifests = new Map<string, CapabilityManifestRow>();
  readonly states = new Map<string, CapabilityStateRow>(); // keyed by manifestId
  #idCounter = 0;

  async createManifest(row: Omit<CapabilityManifestRow, "createdAt">): Promise<CapabilityManifestRow> {
    if (this.manifests.has(row.id)) {
      throw new Error(`capability manifest: duplicate id ${row.id}`);
    }
    const full: CapabilityManifestRow = { ...row, createdAt: new Date().toISOString() };
    this.manifests.set(row.id, full);
    return full;
  }

  async getManifest(id: string): Promise<CapabilityManifestRow | null> {
    return this.manifests.get(id) ?? null;
  }

  async listManifests(
    workspaceId: string,
    opts: { limit: number; offset: number },
  ): Promise<{ items: CapabilityManifestRow[]; total: number }> {
    const all = [...this.manifests.values()]
      .filter((m) => m.workspaceId === workspaceId)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    return { items: all.slice(opts.offset, opts.offset + opts.limit), total: all.length };
  }

  async upsertState(row: Omit<CapabilityStateRow, "id" | "updatedAt">): Promise<CapabilityStateRow> {
    const existing = this.states.get(row.manifestId);
    const full: CapabilityStateRow = {
      id: existing?.id ?? `cst_${++this.#idCounter}`,
      ...row,
      updatedAt: new Date().toISOString(),
    };
    this.states.set(row.manifestId, full);
    return full;
  }

  async getState(manifestId: string): Promise<CapabilityStateRow | null> {
    return this.states.get(manifestId) ?? null;
  }
}
