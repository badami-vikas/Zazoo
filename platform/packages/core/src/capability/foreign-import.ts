/**
 * Foreign capability import (docs/wiki/vision.md "Integration over custom
 * development" + ADR-018 module format) — the shape a capability arriving
 * from OUTSIDE the organization's own authoring (a Pi-extension module, an MCP
 * server, an Activepieces piece, or an open-source-based fallback build)
 * takes on its way into the Capability Trust Model. This module is
 * READ-ONLY against ./types.ts and ../module/types.ts — it builds ON TOP of
 * CapabilityManifest/RiskBand/ModuleManifest, never redefines them, per
 * this module's existing "extend, never fork" discipline (see
 * module/types.ts's own header comment).
 *
 * Every import is `origin: "community"` (capability/types.ts's
 * CapabilityOrigin) — a foreign import is by definition not built_in/
 * template/ai_generated/user_code. `auditRequired` is pinned to the literal
 * `true` at the type level: an unaudited foreign import is not a valid
 * ForeignCapabilityImport at all, mirroring how PROMOTION_DEFAULTS/lifecycle.ts
 * refuse to let risk state advance without evidence.
 */
import type { CapabilityManifest, RiskBand } from "./types.js";
import type { ModuleManifest } from "../module/types.js";

/** Where a foreign capability is imported from — the Learning Agent's
 * "integration over custom development" sources (CLAUDE.md), plus the
 * open-source-based fallback path when no existing integration covers the
 * need. */
export type ForeignCapabilitySource = "pi-module" | "mcp-server" | "activepieces-piece" | "oss-integration";

/** Bridge's own audit conclusion on where a foreign-declared permission risk
 * lands, prior to computeRisk()'s pass — this is the record of WHAT was
 * checked, not a substitute for the computed RiskBand itself. */
export interface ForeignImportSandboxPolicy {
  /** Whether the imported capability runs inside an isolated sandbox
   * (process/container/VM boundary) rather than in-process. */
  isolation: "none" | "process" | "container" | "vm";
  /** Network egress the sandbox permits — mirrors CapabilityPermission's
   * `egress` boolean but scoped to the sandbox boundary rather than a single
   * declared permission. */
  networkEgress: boolean;
  /** Filesystem paths (or path globs) the sandbox exposes, if any — empty
   * means no filesystem access granted. */
  filesystemAccess: string[];
}

/**
 * A foreign capability's import record — the artifact the Capability Trust
 * Model reviews BEFORE a translated manifest is allowed to enter the normal
 * draft -> validated -> approved lifecycle (lifecycle.ts). This is the
 * "translation receipt": it proves where the capability came from, what
 * permissions/sandbox it was declared under at the source, and what the
 * kernel's own translated CapabilityManifest looks like as a result.
 */
export interface ForeignCapabilityImport {
  /** Which foreign ecosystem this capability was sourced from. */
  source: ForeignCapabilitySource;
  /** Source-specific locator — e.g. a Pi-module registry id, an MCP server
   * URL/name, an Activepieces piece slug, or an OSS repo ref. Opaque to the
   * kernel; only meaningful to the source-specific importer that produced
   * this record. */
  sourceRef: string;
  /** Exact-pinned version at the source — no ranges, mirroring
   * ModuleDependency's version discipline (module/types.ts). */
  versionPin: string;
  /** The permissions the foreign source itself declares it needs, in its own
   * native shape — kept verbatim (not yet translated) so the audit trail
   * shows what was actually asked for at the source, independent of how
   * `translatedManifest.permissions` ends up expressing it in Bridge's own
   * CapabilityPermission shape. */
  permissionDeclarations: Array<{ resourceType: string; action: string; scope: string }>;
  sandboxPolicy: ForeignImportSandboxPolicy;
  /** Risk label assigned by the import-time audit — an input the Capability
   * Trust Model's computeRisk() considers alongside the translated
   * manifest's own permissions (composite risk = max over both), never a
   * self-declared substitute for it. */
  riskLabel: RiskBand;
  /** A foreign import MUST be audited before entering the trust lifecycle —
   * pinned to the literal `true` so an un-audited import cannot even be
   * constructed as a valid ForeignCapabilityImport. */
  auditRequired: true;
  /** Reference to a rollback plan/snapshot this import can revert to — the
   * foreign-import analogue of CapabilityManifest's own optional `rollback`
   * field, required here (not optional) because an externally-sourced
   * capability carries strictly higher rollback risk than a user_code one. */
  rollbackRef: string;
  /** The kernel-native CapabilityManifest this foreign capability translates
   * to, and (when the source shipped a full capability module rather than a
   * single capability) the enclosing ModuleManifest it was translated into.
   * `origin` on the translated manifest is always "community" — a foreign
   * import is never built_in/template/ai_generated/user_code. */
  translatedManifest: CapabilityManifest & { origin: "community" };
  /** Present when the foreign source shipped a whole module.yaml-shaped
   * bundle (ADR-018) rather than a single capability — reuses ModuleManifest
   * verbatim rather than forking a parallel "foreign module" shape. */
  translatedModule?: ModuleManifest;
}
