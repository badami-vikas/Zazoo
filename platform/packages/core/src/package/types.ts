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
}

/** Single-live-version states (format doc §3, Zapier model). */
export type PackageVersionState = "private" | "promoted" | "available" | "legacy" | "deprecating" | "deprecated";

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
  createdAt: string;
}

/** Resolves a package dependency's manifest by (name, version) — the seam
 * computePackageRisk() uses instead of reaching into a store directly, so it
 * stays pure/testable, mirroring `ResolveDependency` in capability/types.ts. */
export type ResolvePackageDependency = (manifestId: string, version: string) => PackageManifest | undefined;
