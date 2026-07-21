/**
 * createModelRouter — resolves an executable manifest `modelBinding` (the
 * declarative slot every tool manifest already carries) to a live
 * ModelProvider, honoring the binding's `planeDefault`:
 *
 *  - planeDefault "local"  → ONLY a local-plane provider may satisfy it.
 *    CLAUDE.md: "capture/sensor plane = local models default" — a
 *    local-default binding never silently falls through to a cloud provider;
 *    if no local provider is registered the resolution FAILS (loud) rather
 *    than leaking capture-plane content to a cloud model.
 *  - planeDefault "cloud"  → prefers a tier-capable cloud provider, and MAY fall back to a
 *    local one (falling toward MORE privacy is always safe; the reverse never
 *    is — that asymmetry is the whole point of this router).
 *
 * Provider preference within a plane: only providers declaring the requested
 * cost/capability tier are eligible. The binding's `providers` hints
 * (`providers.local` id / `providers.cloud` id list) are honored first, then
 * a stable health-then-id order.
 */
import {
  MODEL_PROVIDER_HEALTH,
  MODEL_TIERS,
  type ModelProvider,
  type ModelProviderHealth,
  type ModelTier,
} from "@bridge/core";
import type { ModelBinding } from "@bridge/capability-kit";

export interface ModelRouter {
  /** All registered providers, by id. */
  providers(): ReadonlyMap<string, ModelProvider>;
  /** Resolve a manifest modelBinding to a provider. Throws when the binding's
   * plane rules cannot be satisfied by what is registered. */
  resolve(binding: ModelBinding, tier: ModelTier): ModelProvider;
}

export function createModelRouter(providerList: ModelProvider[]): ModelRouter {
  const byId = new Map<string, ModelProvider>();
  for (const p of providerList) {
    if (!p.id || p.id !== p.id.trim()) {
      throw new Error("createModelRouter: provider id must be non-empty and normalized");
    }
    if (byId.has(p.id)) throw new Error(`createModelRouter: duplicate provider id ${p.id}`);
    if (p.tiers.length === 0) throw new Error(`createModelRouter: provider ${p.id} declares no completion tiers`);
    for (const tier of p.tiers) {
      if (!MODEL_TIERS.includes(tier)) {
        throw new Error(`createModelRouter: provider ${p.id} declares unknown tier ${String(tier)}`);
      }
      const model = p.models[tier];
      if (model === undefined || model.length === 0 || model !== model.trim() || model.length > 256) {
        throw new Error(`createModelRouter: provider ${p.id} declares an invalid model id for ${tier}`);
      }
    }
    byId.set(p.id, p);
  }

  const healthRank: Readonly<Record<ModelProviderHealth, number>> = {
    healthy: 0,
    unknown: 1,
    degraded: 2,
    unavailable: 3,
  };

  function routingHealth(provider: ModelProvider): ModelProviderHealth {
    const health = provider.routingHealth();
    if (!MODEL_PROVIDER_HEALTH.includes(health)) {
      throw new Error(`model router: provider ${provider.id} returned invalid routing health`);
    }
    return health;
  }

  function firstOnPlane(
    plane: "local" | "cloud",
    tier: ModelTier,
    preferredIds: string[],
  ): ModelProvider | undefined {
    const eligible = [...byId.values()]
      .filter((provider) => provider.plane === plane && provider.tiers.includes(tier))
      .map((provider) => ({ provider, health: routingHealth(provider) }))
      .filter(({ health }) => health !== "unavailable");
    for (const id of preferredIds) {
      const p = byId.get(id);
      const hinted = eligible.find(({ provider }) => provider === p);
      if (hinted) return hinted.provider;
    }
    eligible.sort(
      (a, b) =>
        healthRank[a.health] - healthRank[b.health] ||
        a.provider.id.localeCompare(b.provider.id),
    );
    return eligible[0]?.provider;
  }

  return {
    providers() {
      return byId;
    },
    resolve(binding: ModelBinding, tier: ModelTier): ModelProvider {
      const localHints = binding.providers?.local ? [binding.providers.local] : [];
      const cloudHints = binding.providers?.cloud ?? [];

      if (binding.planeDefault === "local") {
        const local = firstOnPlane("local", tier, localHints);
        if (!local) {
          throw new Error(
            `model router: binding (use=${binding.use}, tier=${tier}) requires a LOCAL-plane provider ` +
              `(capture/sensor plane never falls back to cloud) but none is registered`,
          );
        }
        return local;
      }

      // planeDefault === "cloud": prefer cloud, fall back local (privacy-safe direction).
      const cloud = firstOnPlane("cloud", tier, cloudHints);
      if (cloud) return cloud;
      const local = firstOnPlane("local", tier, localHints);
      if (local) return local;
      throw new Error(`model router: no provider registered for binding (use=${binding.use}, tier=${tier})`);
    },
  };
}
