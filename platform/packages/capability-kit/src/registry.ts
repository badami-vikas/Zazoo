import { parseExecutableManifest, type ExecutableManifest } from "./manifest.js";

export class ExecutableRegistryError extends Error {}

export interface ExecutableRegistry {
  all(): ExecutableManifest[];
  get(id: string): ExecutableManifest | undefined;
  skills(): ExecutableManifest[];
  modules(): ExecutableManifest[];
}

export function buildExecutableRegistry(rawManifests: unknown[]): ExecutableRegistry {
  const manifests = rawManifests.map((manifest) => parseExecutableManifest(manifest));

  const byId = new Map<string, ExecutableManifest>();
  for (const manifest of manifests) {
    if (byId.has(manifest.id)) {
      throw new ExecutableRegistryError(`duplicate executable id: ${manifest.id}`);
    }
    byId.set(manifest.id, manifest);
  }

  for (const manifest of manifests) {
    if (manifest.kind !== "module") continue;
    for (const dependency of manifest.skillDependencies) {
      const target = byId.get(dependency);
      if (!target || target.kind !== "skill") {
        throw new ExecutableRegistryError(
          `Module "${manifest.id}" references unknown Skill "${dependency}"`,
        );
      }
    }
  }

  return {
    all: () => manifests,
    get: (id) => byId.get(id),
    skills: () => manifests.filter((manifest) => manifest.kind === "skill"),
    modules: () => manifests.filter((manifest) => manifest.kind === "module"),
  };
}
