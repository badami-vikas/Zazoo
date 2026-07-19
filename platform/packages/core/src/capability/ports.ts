/**
 * CapabilityStore — the port @bridge/db's DrizzleCapabilityStore binds against
 * (capability_manifests + capability_states), mirroring how LedgerStore (in
 * ports.ts) is defined in core and bound by DrizzleLedgerStore in @bridge/db.
 * The in-memory implementation here lets @bridge/core run + be tested with no
 * database, same as every other port in this module.
 */
import type { Audience, CapabilityEvidence, CapabilityOrigin, CapabilityState, CapabilityType, ComponentKind, RiskBand } from "./types.js";

export interface CapabilityManifestRow {
  id: string;
  organizationId: string;
  capabilityType: CapabilityType;
  /** REG-1 Component Registry discriminator (undefined-elements §2) — the
   * finer registry classification overlap detection keys on. Null/absent on
   * pre-REG-1 rows; the detector falls back to `capabilityType`. */
  kind?: ComponentKind | null;
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
  organizationId: string;
  state: CapabilityState;
  trustedUntil?: string | null;
  suspended: boolean;
  suspendReason?: string | null;
  evidence: Partial<CapabilityEvidence>;
  updatedAt: string;
}

export interface CapabilityStore {
  createManifest(row: Omit<CapabilityManifestRow, "createdAt">): Promise<CapabilityManifestRow>;
  getManifest(id: string): Promise<CapabilityManifestRow | null>;
  /** Look up an existing manifest by its (organization_id, name, version) natural
   * key — the same triple `capability_manifests_uq` enforces at the DB. Lets a
   * caller (e.g. `modules.install`, ADR-023) check-before-insert instead of
   * colliding with the unique constraint when re-registering a bundled
   * capability whose (name, version) hasn't changed across a module
   * re-install. Returns null when no such row exists yet. */
  getManifestByNameVersion(organizationId: string, name: string, version: string): Promise<CapabilityManifestRow | null>;
  listManifests(organizationId: string, opts: { limit: number; offset: number }): Promise<{ items: CapabilityManifestRow[]; total: number }>;

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

  async getManifestByNameVersion(organizationId: string, name: string, version: string): Promise<CapabilityManifestRow | null> {
    for (const m of this.manifests.values()) {
      if (m.organizationId === organizationId && m.name === name && m.version === version) return m;
    }
    return null;
  }

  async listManifests(
    organizationId: string,
    opts: { limit: number; offset: number },
  ): Promise<{ items: CapabilityManifestRow[]; total: number }> {
    const all = [...this.manifests.values()]
      .filter((m) => m.organizationId === organizationId)
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
