/**
 * The resolved structure of a Module's surface (UI Rulebook §2/§3d, TASK-100):
 * Module → sub-modules (collapsible nav children) → Pages (header toggles, one
 * per Database) → Sections per Database → the Record detail page.
 *
 * ONE resolver for the shell and the api, so the rail, the Module Page, the
 * Record page and `moduleRecords.structure` cannot disagree about which Page
 * is a root toggle, which is a sub-module's, or which Sections a Database
 * shows. Pure: it reads the manifest and applies the defaults a manifest that
 * predates these fields never wrote (everything at root, all Sections on).
 */
import type {
  ModuleDatabaseSections,
  ModuleManifest,
  ModulePageBinding,
  ModuleSubModuleBinding,
} from "./types.js";

export interface ModuleStructure {
  /** Pages no sub-module claims — the root Module's header toggles. */
  rootPages: ModulePageBinding[];
  subModules: (Omit<ModuleSubModuleBinding, "pages"> & { pages: ModulePageBinding[] })[];
  /** Sections for one Database; an undeclared id answers the default. */
  sections: (databaseId: string) => ModuleDatabaseSections;
  /** The sub-module a Page belongs to, or null for a root Page. */
  scopeOf: (pageId: string) => ModuleStructure["subModules"][number] | null;
}

export const DEFAULT_DATABASE_SECTIONS: Readonly<ModuleDatabaseSections> = {
  notes: true,
  intelligence: true,
  governance: true,
};

export function moduleStructure(manifest: Pick<ModuleManifest, "module">): ModuleStructure {
  const surface = manifest.module;
  const pages = surface?.pages ?? [];
  const byId = new Map(pages.map((page) => [page.id, page]));
  const claimed = new Set<string>();
  const subModules = (surface?.subModules ?? []).map((sub) => {
    for (const id of sub.pages) claimed.add(id);
    return {
      id: sub.id,
      name: sub.name,
      // The parser refused unknown ids, so every lookup resolves; the filter
      // only guards a code-built manifest that skipped it.
      pages: sub.pages.map((id) => byId.get(id)).filter((page): page is ModulePageBinding => !!page),
    };
  });
  const sectionsById = new Map(
    (surface?.databases ?? []).map((database) => [database.id, database.sections ?? DEFAULT_DATABASE_SECTIONS]),
  );
  return {
    rootPages: pages.filter((page) => !claimed.has(page.id)),
    subModules,
    sections: (databaseId) => ({ ...(sectionsById.get(databaseId) ?? DEFAULT_DATABASE_SECTIONS) }),
    scopeOf: (pageId) => subModules.find((sub) => sub.pages.some((page) => page.id === pageId)) ?? null,
  };
}
