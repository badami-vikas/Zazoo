/**
 * Shared shape and pure builders for built-in Module catalog entries.
 *
 * Each packaged Module owns its own entry (`modules/<x>/src/module.ts`) and
 * `@bridge/module-manifests` assembles the catalog from them. This file is
 * browser-safe by discipline: it imports nothing from `node:`.
 */
import type { CapabilityManifest, RiskBand } from "../capability/types.js";
import type { CommonsProvenance } from "./commons.js";
import type { ModuleManifest, ModuleSurfaceManifest } from "./types.js";

/**
 * Persisted runtime identities for a Module's declared Agents and
 * Automations, keyed by manifest Agent id / `automationId`. The UUIDs are
 * rows in the agents/automations tables — changing one orphans them.
 */
export type ModuleRuntimeIds = {
  automations: Readonly<Record<string, string>>;
  agents: Readonly<Record<string, string>>;
};

export type BuiltInModule = {
  manifest: ModuleManifest;
  computedRisk: RiskBand;
};

/** A built-in Module that declares a `module` surface (every organization_definition does). */
export type BuiltInModuleWithSurface = BuiltInModule & {
  manifest: ModuleManifest & { module: ModuleSurfaceManifest };
};

export type CommonsBuiltInModule = BuiltInModule & {
  commons: {
    provenance: CommonsProvenance;
    tags: string[];
  };
};

export const SOURCE_REPOSITORY = "https://github.com/badami-vikas/relationship-os";
export const INSPECTED_COMMIT = "689fca0ca742cfa01eae8e3785b00c50c5e3ca5b";
export const BUILT_IN_SOURCE_REFS: Readonly<Record<string, string>> = {
  "deal-pilot": "platform/modules/dealpilot/src/manifest.ts",
  "job-pilot": "platform/modules/jobpilot/src/manifest.ts",
  relationship: "platform/apps/web/src/app/pages/RelationshipPage.tsx",
  academics: "platform/apps/web/src/app/pages/AcademicsPage.tsx",
  events: "platform/apps/web/src/app/pages/EventsPage.tsx",
  "task-manager": "platform/packages/core/src/task-manager.ts",
  whatsapp: "platform/modules/whatsapp/src/index.ts",
  devpilot: "platform/modules/devpilot/src/index.ts",
  // Imported Modules (ADR-246). The source ref points at the domain layer that
  // came across in the subtree merge, not at the donor repository: the donors
  // are read-only sources and are not modified by the merge, so this repo is
  // where the inspected code actually lives.
  accounting: "platform/modules/accounting/src/index.ts",
  d2c: "platform/modules/d2c/src/index.ts",
  "d2c-research": "platform/modules/d2c/src/index.ts",
  "d2c-notes": "platform/modules/d2c/src/index.ts",
};

export function builtInSourceRef(moduleName: string): string {
  const sourceRef = BUILT_IN_SOURCE_REFS[moduleName];
  if (!sourceRef) throw new Error(`No inspected source reference declared for ${moduleName}`);
  return sourceRef;
}

export function provenance(sourceRef: string): CommonsProvenance {
  return {
    sourceRepository: SOURCE_REPOSITORY,
    sourceRef,
    inspectedCommit: INSPECTED_COMMIT,
    repositoryLicense: "NOASSERTION",
    contentLicense: "LicenseRef-Bridge-Internal",
    licenseVerified: true,
  };
}

export const readAll = (resourceType: string) => ({
  resourceType,
  action: "read" as const,
  dataScope: "all" as const,
  egress: false,
});

export const writeAll = (resourceType: string) => ({
  resourceType,
  action: "write" as const,
  dataScope: "all" as const,
  egress: false,
});

export const readPrivate = (resourceType: string) => ({
  resourceType,
  action: "read" as const,
  dataScope: "private" as const,
  egress: false,
});

export const readPublic = (resourceType: string) => ({
  resourceType,
  action: "read" as const,
  dataScope: "public" as const,
  egress: true,
});

export const writePrivate = (resourceType: string) => ({
  resourceType,
  action: "write" as const,
  dataScope: "private" as const,
  egress: false,
});

export function capability(
  id: string,
  name: string,
  capabilityType: CapabilityManifest["capabilityType"],
  permissions: CapabilityManifest["permissions"],
  connectors: CapabilityManifest["connectors"] = [],
  dependencies: CapabilityManifest["dependencies"] = [],
): CapabilityManifest {
  return {
    id,
    name,
    version: "0.2.0",
    capabilityType,
    origin: "built_in",
    audience: "team",
    permissions,
    connectors,
    dependencies,
  };
}
