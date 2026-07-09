/**
 * createModelRouter — resolves a @bridge/tool-kit `modelBinding` (the
 * declarative slot every tool manifest already carries) to a live
 * ModelProvider, honoring the binding's `planeDefault`:
 *
 *  - planeDefault "local"  → ONLY a local-plane provider may satisfy it.
 *    CLAUDE.md: "capture/sensor plane = local models default" — a
 *    local-default binding never silently falls through to a cloud provider;
 *    if no local provider is registered the resolution FAILS (loud) rather
 *    than leaking capture-plane content to a cloud model.
 *  - planeDefault "cloud"  → prefers a cloud provider, and MAY fall back to a
 *    local one (falling toward MORE privacy is always safe; the reverse never
 *    is — that asymmetry is the whole point of this router).
 *
 * Provider preference within a plane: the binding's `providers` hints
 * (`providers.local` id / `providers.cloud` id list) are honored first, then
 * registration order.
 */
import type { ModelProvider } from "@bridge/core";
import type { ModelBinding } from "@bridge/tool-kit";

export interface ModelRouter {
  /** All registered providers, by id. */
  providers(): ReadonlyMap<string, ModelProvider>;
  /** Resolve a manifest modelBinding to a provider. Throws when the binding's
   * plane rules cannot be satisfied by what is registered. */
  resolve(binding: ModelBinding): ModelProvider;
}

export function createModelRouter(providerList: ModelProvider[]): ModelRouter {
  const byId = new Map<string, ModelProvider>();
  for (const p of providerList) {
    if (byId.has(p.id)) throw new Error(`createModelRouter: duplicate provider id ${p.id}`);
    byId.set(p.id, p);
  }

  function firstOnPlane(plane: "local" | "cloud", preferredIds: string[]): ModelProvider | undefined {
    for (const id of preferredIds) {
      const p = byId.get(id);
      if (p && p.plane === plane) return p;
    }
    for (const p of byId.values()) {
      if (p.plane === plane) return p;
    }
    return undefined;
  }

  return {
    providers() {
      return byId;
    },
    resolve(binding: ModelBinding): ModelProvider {
      const localHints = binding.providers?.local ? [binding.providers.local] : [];
      const cloudHints = binding.providers?.cloud ?? [];

      if (binding.planeDefault === "local") {
        const local = firstOnPlane("local", localHints);
        if (!local) {
          throw new Error(
            `model router: binding (use=${binding.use}) requires a LOCAL-plane provider ` +
              `(capture/sensor plane never falls back to cloud) but none is registered`,
          );
        }
        return local;
      }

      // planeDefault === "cloud": prefer cloud, fall back local (privacy-safe direction).
      const cloud = firstOnPlane("cloud", cloudHints);
      if (cloud) return cloud;
      const local = firstOnPlane("local", localHints);
      if (local) return local;
      throw new Error(`model router: no provider registered for binding (use=${binding.use})`);
    },
  };
}
