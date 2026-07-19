/**
 * Capability module format — shared types (docs/raw/capability-module-format.md,
 * ADR-018). A module is the SHIPPING UNIT one level above a single
 * `capability_manifests` row (packages/core/src/capability/): where the
 * capability module governs ONE capability's trust lifecycle, a module
 * BUNDLES one or more capability manifests plus a directory of implementation
 * (module.yaml + capabilities/ + scripts/ + references/ + assets/ +
 * migrations/ + tests/, per the format doc's §1).
 *
 * This module is read-only against packages/core/src/capability/ — it builds
 * ON TOP of CapabilityManifest/RiskBand/etc., never redefines them.
 */
import type { CapabilityManifest, RiskBand } from "../capability/types.js";
import type { OrganizationBlueprint } from "../blueprint.js";
import type { Plane } from "../types.js";

/** module.yaml's `kind` — one level broader than CapabilityType (a module
 * can itself be shaped like a whole organization_definition, not just one
 * capability_type). */
export type ModuleKind = "skill" | "automation" | "agent" | "module" | "view" | "integration_bundle" | "organization_definition";

/** An exact-pinned dependency on another module version — NEVER a range
 * (^, ~, >=). A dependency bump is a new module version proposal, reviewed
 * through the same install flow as a fresh install (format doc §3). */
export interface ModuleDependency {
  manifestId: string;
  /** Exact semver, e.g. "2.1.0" — no ranges. */
  version: string;
}

/** Sensor SPI / context-provider registry consumption a module declares
 * (docs/wiki/clients.md) — optional, desktop-only capability, never a kernel
 * dependency of the module format itself. */
export interface ModuleContextProvider {
  kind: string;
  required: boolean;
}

/** Domain-vocab alignment declaration (format doc §5 open question:
 * enforcement mechanism undecided — this is documentation-shaped intent
 * only, not yet compiler-enforced). */
export interface ModuleOrganizationVocab {
  alignsToBridgeTheme: boolean;
  domainTerms: Record<string, string>;
}

export interface ModulePageBinding {
  id: string;
  name: string;
  route: string;
  databaseId: string;
  capabilityId: string;
}

export interface ModuleAgentBinding {
  id: string;
  name: string;
  capabilityId: string;
  skillIds: string[];
  plane?: Plane;
}

export interface ModuleAutomationBinding {
  id: string;
  name: string;
  capabilityId: string;
  agentId: string;
  trigger: string;
  procedure: string;
  /** Persisted Automation definition backing the governed Agent Run. */
  automationId?: string;
  /** Context route used when the Automation requires a specific Record input. */
  runRoute?: string;
}

export interface ModuleCapabilityNeed {
  id: string;
  title: string;
  description: string;
  agentId: string;
  kind: ModuleKind;
  tags: string[];
}

/**
 * Compiler-owned Module Detail bindings. Capability definitions remain the
 * trust source of truth; these bindings provide the routable inventory and
 * explicit Agent→Skill/Automation ownership needed to render a Module.
 */
export interface ModuleSurfaceManifest {
  displayName: string;
  route: string;
  pages: ModulePageBinding[];
  agents: ModuleAgentBinding[];
  automations: ModuleAutomationBinding[];
  /** Source-backed capability gaps that may be satisfied from Commons. */
  commonsNeeds?: ModuleCapabilityNeed[];
}

/**
 * The module manifest — `module.yaml`'s parsed shape. `capabilities[]` is
 * the "module carries MULTIPLE capability manifests" requirement: each
 * entry is a full `CapabilityManifest` (types.ts), the same trust-model unit
 * risk.ts/lifecycle.ts/approvals.ts already operate on.
 */
export interface ModuleManifest {
  /** kebab-case, unique across the module registry. */
  name: string;
  /** Strict semver (MAJOR.MINOR.PATCH) — no ranges. */
  version: string;
  kind: ModuleKind;
  /** L1 — always loaded, agentskills.io progressive disclosure entry point. */
  summary: string;
  /** L1/L2 body — what+when, <=1024 chars per agentskills.io convention. */
  description: string;
  /** Chains to a `capability_manifests` row this version forked from — null for a v1 module. */
  lineageManifestId: string | null;
  dependencies: ModuleDependency[];
  /** >= 1 entries — a module with zero capabilities is not installable. */
  capabilities: CapabilityManifest[];
  contextProviders: ModuleContextProvider[];
  organizationVocab: ModuleOrganizationVocab;
  /** Required for installed Module navigation and Module Detail inventory. */
  module?: ModuleSurfaceManifest;
  /** Present ONLY for a `organization_definition` module (BLUEPRINT-1, Month-6):
   * the versioned, declarative OrganizationBlueprint this module publishes. A
   * organization_definition COMPOSES capabilities by reference (blueprint.
   * capabilities) rather than bundling them, so such a module's top-level
   * `capabilities[]` is empty and this field carries the real payload. Signed
   * as part of the manifest (PKG-2) — canonicalizeManifest includes it. */
  blueprint?: OrganizationBlueprint;
}

/** Single-live-version states (format doc §3, Zapier model). */
export type ModuleVersionState = "private" | "promoted" | "available" | "legacy" | "deprecating" | "deprecated";

export interface ModuleAttachment {
  source: "commons";
  ownerModuleName: string;
  agentId: string;
  needId: string;
  contentHash: string;
}

/** module_installations row shape (or the equivalent ModuleStore row) — one
 * per (organization, module name, version). */
export interface ModuleInstallationRow {
  id: string;
  organizationId: string;
  moduleName: string;
  moduleVersion: string;
  manifest: ModuleManifest;
  computedRisk: RiskBand;
  state: ModuleVersionState;
  status: "pending_review" | "installed" | "rejected";
  lineageManifestId: string | null;
  /** Installation-local ownership. The signed Commons artifact stays immutable. */
  moduleAttachment?: ModuleAttachment;
  createdAt: string;
}

/** Resolves a module dependency's manifest by (name, version) — the seam
 * computeModuleRisk() uses instead of reaching into a store directly, so it
 * stays pure/testable, mirroring `ResolveDependency` in capability/types.ts. */
export type ResolveModuleDependency = (manifestId: string, version: string) => ModuleManifest | undefined;
