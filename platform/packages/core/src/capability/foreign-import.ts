/**
 * Foreign-capability import — shared types (docs/raw/execution-plan-2026-07.md
 * Track F3, "Integration over custom development"). Bridge's Learning Agent
 * checks installed software/browser apps and proposes an integration before
 * building from scratch; when that integration is a foreign artifact (a Pi
 * package, an MCP server descriptor, an Activepieces piece, or a generic OSS
 * integration) this is the shape it arrives in BEFORE translation into a
 * Bridge `CapabilityManifest` (capability/types.ts). The translator
 * (importer.ts) consumes this type; it never redefines CapabilityManifest.
 */
import type { CapabilityOrigin, RiskBand } from "./types.js";

/** The four foreign-source shapes the importer knows how to translate. */
export type ForeignCapabilitySource = "pi-package" | "mcp-server" | "activepieces-piece" | "oss-integration";

/** Exact-pinned upstream version reference — mirrors the package format's
 * "no ranges" discipline (package/types.ts PackageDependency): a foreign
 * import is pinned to one upstream version, never a range, so a re-import at
 * a new upstream version is a new proposal reviewed through the same trust
 * flow as a fresh install. */
export interface ForeignVersionPin {
  /** Upstream identifier — package name, MCP server id, piece name, repo url. */
  ref: string;
  /** Upstream's own version string (may not be semver — passed through as-is). */
  version: string;
}

/** A single permission the foreign artifact's own descriptor claims it needs,
 * BEFORE Bridge's permission model normalizes it. Distinct from
 * `CapabilityPermission` (capability/types.ts) — that's the POST-translation
 * shape; this is the raw upstream declaration the translator reads. */
export interface ForeignPermissionDeclaration {
  /** Upstream's own name for the resource/scope (e.g. an MCP resource URI
   * pattern, an OAuth scope string, a Pi extension's declared permission). */
  resource: string;
  action: "read" | "write" | "send";
  /** True if the upstream artifact can be told exactly what data scope it
   * touches; false means the translator must fall back to the most
   * conservative dataScope ("all") when mapping it forward. */
  scoped: boolean;
}

/** Sandbox execution policy — REQUIRED on any executable foreign import
 * (activepieces pieces are always executable; some Pi extensions are).
 * Deliberately opaque beyond `kind` here — the runtime sandbox implementation
 * (container/wasm/subprocess) is an execution-layer concern outside
 * @bridge/core; this module only records that a policy was declared. */
export interface SandboxPolicy {
  kind: "container" | "subprocess" | "wasm" | "none";
  networkEgress: boolean;
  filesystemAccess: boolean;
}

/**
 * The pre-translation envelope for a single foreign capability import. One
 * `ForeignCapabilityImport` -> one `CapabilityManifest` via
 * `translateForeignCapability` (importer.ts).
 */
export interface ForeignCapabilityImport {
  source: ForeignCapabilitySource;
  /** Upstream identifier + pinned version. */
  versionPin: ForeignVersionPin;
  /** Upstream's own permission declarations — translated into
   * `CapabilityPermission[]` by source-specific mapping logic. */
  permissionDeclarations: ForeignPermissionDeclaration[];
  /** Required when the foreign artifact is executable (activepieces pieces
   * always; pi extensions/oss integrations sometimes) — absent otherwise. */
  sandboxPolicy?: SandboxPolicy;
  /** Risk label the upstream source or import pipeline suggests — advisory
   * input only. The Capability Trust Model still COMPUTES risk from the
   * translated manifest's permissions/connectors (risk.ts); this field is
   * carried through for audit/display, never substituted for computeRisk(). */
  riskLabel?: RiskBand;
  /** Every foreign import requires a human-auditable trail — true always,
   * enforced by the translator, not left to the caller to remember. */
  auditRequired: boolean;
  /** Reference to how to undo this import (upstream removal instructions,
   * a package-store rollback ref, etc.) — opaque to this layer. */
  rollbackRef?: string;
  /**
   * Raw upstream descriptor payload the source-specific translator reads to
   * fill in manifest fields the top-level envelope doesn't carry (e.g. a Pi
   * package's `primitives[]`, an MCP server's `tools`/`resources`, an
   * Activepieces piece's `actions`/`triggers`). Left as `unknown` here
   * deliberately — @bridge/core does not depend on any of these SDKs; the
   * translator only reads the minimal shape it needs via narrow, defensive
   * property access.
   */
  descriptor: unknown;
  /** Human-facing name/id for the resulting capability — the translator uses
   * this as the CapabilityManifest.id/name seed. */
  targetId: string;
  targetName: string;
}

/** Foreign imports always enter as community origin (Capability Trust Model
 * origin axis, capability/types.ts CapabilityOrigin) — never built_in/
 * template/ai_generated/user_code, regardless of source type. */
export const FOREIGN_IMPORT_ORIGIN: CapabilityOrigin = "community";
