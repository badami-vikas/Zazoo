import { parseToolManifest, type ToolManifest } from "./manifest.js";

export class ToolRegistryError extends Error {}

export interface ToolRegistry {
  all(): ToolManifest[];
  get(id: string): ToolManifest | undefined;
  internal(): ToolManifest[];
  external(): ToolManifest[];
}

// Builds the registry FROM manifests — this is the "registry derives from manifests" rule.
// tools.ts (or its successor) must call this rather than hand-listing tools; a tool that has
// no manifest cannot appear here and therefore cannot render or run.
export function buildToolRegistry(rawManifests: unknown[]): ToolRegistry {
  const manifests = rawManifests.map((m) => parseToolManifest(m));

  const byId = new Map<string, ToolManifest>();
  for (const m of manifests) {
    if (byId.has(m.id)) {
      throw new ToolRegistryError(`duplicate tool id: ${m.id}`);
    }
    byId.set(m.id, m);
  }

  // Compose, don't copy: every `composes` reference must resolve to a real registered tool.
  for (const m of manifests) {
    if (m.kind !== "external") continue;
    for (const dep of m.composes) {
      if (!byId.has(dep)) {
        throw new ToolRegistryError(`tool "${m.id}" composes unknown tool "${dep}"`);
      }
    }
  }

  return {
    all: () => manifests,
    get: (id) => byId.get(id),
    internal: () => manifests.filter((m) => m.kind === "internal"),
    external: () => manifests.filter((m) => m.kind === "external"),
  };
}
