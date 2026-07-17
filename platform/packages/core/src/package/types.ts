/**
 * Capability package format — shared types (docs/raw/capability-package-format.md,
 * ADR-018). A package is the SHIPPING UNIT one level above a single
 * `capability_manifests` row (packages/core/src/capability/): where the
 * capability module governs ONE capability's trust lifecycle, a package
 * BUNDLES one or more capability manifests plus a directory of implementation
 * (package.yaml + capabilities/ + scripts/ + references/ + assets/ +
 * migrations/ + tests/, per the format doc's §1).
 *
 * This module is read-only against packages/core/src/capability/ — it builds
 * ON TOP of CapabilityManifest/RiskBand/etc., never redefines them.
 */
import type { CapabilityManifest, RiskBand } from "../capability/types.js";
import type { WorkspaceBlueprint } from "../blueprint.js";
import type { Plane } from "../types.js";

/** package.yaml's `kind` — one level broader than CapabilityType (a package
 * can itself be shaped like a whole workspace_definition, not just one
 * capability_type). */
export type PackageKind = "skill" | "workflow" | "agent" | "tool" | "view" | "integration_bundle" | "workspace_definition";

/** An exact-pinned dependency on another package version — NEVER a range
 * (^, ~, >=). A dependency bump is a new package version proposal, reviewed
 * through the same install flow as a fresh install (format doc §3). */
export interface PackageDependency {
  manifestId: string;
  /** Exact semver, e.g. "2.1.0" — no ranges. */
  version: string;
}

/** Sensor SPI / context-provider registry consumption a package declares
 * (docs/wiki/clients.md) — optional, desktop-only capability, never a kernel
 * dependency of the package format itself. */
export interface PackageContextProvider {
  kind: string;
  required: boolean;
}

/** Domain-vocab alignment declaration (format doc §5 open question:
 * enforcement mechanism undecided — this is documentation-shaped intent
 * only, not yet compiler-enforced). */
export interface PackageWorkspaceVocab {
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
  /** Persisted Ritual definition backing the governed Run action. */
  ritualId?: string;
  /** Context route used when the Automation requires a specific Record input. */
  runRoute?: string;
}

export interface ModuleCapabilityNeed {
  id: string;
  title: string;
  description: string;
  agentId: string;
  kind: PackageKind;
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
 * The package manifest — `package.yaml`'s parsed shape. `capabilities[]` is
 * the "package carries MULTIPLE capability manifests" requirement: each
 * entry is a full `CapabilityManifest` (types.ts), the same trust-model unit
 * risk.ts/lifecycle.ts/approvals.ts already operate on.
 */
export interface PackageManifest {
  /** kebab-case, unique across the package registry. */
  name: string;
  /** Strict semver (MAJOR.MINOR.PATCH) — no ranges. */
  version: string;
  kind: PackageKind;
  /** L1 — always loaded, agentskills.io progressive disclosure entry point. */
  summary: string;
  /** L1/L2 body — what+when, <=1024 chars per agentskills.io convention. */
  description: string;
  /** Chains to a `capability_manifests` row this version forked from — null for a v1 package. */
  lineageManifestId: string | null;
  dependencies: PackageDependency[];
  /** >= 1 entries — a package with zero capabilities is not installable. */
  capabilities: CapabilityManifest[];
  contextProviders: PackageContextProvider[];
  workspaceVocab: PackageWorkspaceVocab;
  /** Required for installed Module navigation and Module Detail inventory. */
  module?: ModuleSurfaceManifest;
  /** Present ONLY for a `workspace_definition` package (BLUEPRINT-1, Month-6):
   * the versioned, declarative WorkspaceBlueprint this package publishes. A
   * workspace_definition COMPOSES capabilities by reference (blueprint.
   * capabilities) rather than bundling them, so such a package's top-level
   * `capabilities[]` is empty and this field carries the real payload. Signed
   * as part of the manifest (PKG-2) — canonicalizeManifest includes it. */
  blueprint?: WorkspaceBlueprint;
}

/** Single-live-version states (format doc §3, Zapier model). */
export type PackageVersionState = "private" | "promoted" | "available" | "legacy" | "deprecating" | "deprecated";

export interface PackageModuleAttachment {
  source: "commons";
  modulePackageName: string;
  agentId: string;
  needId: string;
  contentHash: string;
}

/** package_installations row shape (or the equivalent PackageStore row) — one
 * per (workspace, package name, version). */
export interface PackageInstallationRow {
  id: string;
  workspaceId: string;
  packageName: string;
  packageVersion: string;
  manifest: PackageManifest;
  computedRisk: RiskBand;
  state: PackageVersionState;
  status: "pending_review" | "installed" | "rejected";
  lineageManifestId: string | null;
  /** Installation-local ownership. The signed Commons artifact stays immutable. */
  moduleAttachment?: PackageModuleAttachment;
  createdAt: string;
}

/** Resolves a package dependency's manifest by (name, version) — the seam
 * computePackageRisk() uses instead of reaching into a store directly, so it
 * stays pure/testable, mirroring `ResolveDependency` in capability/types.ts. */
export type ResolvePackageDependency = (manifestId: string, version: string) => PackageManifest | undefined;
