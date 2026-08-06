/**
 * Capability Trust Model — shared types (docs/wiki/vision.md "Capability Trust
 * Model" + "Promotion defaults") for every capability_type in
 * capability_manifests (skill/automation/agent/integration/view/dashboard).
 */

/** Risk axis — COMPUTED from the manifest, never self-declared by the generator. */
export type RiskBand = "informational" | "advisory" | "transformational" | "operational" | "external";

/** Origin axis. */
export type CapabilityOrigin = "built_in" | "template" | "community" | "ai_generated" | "user_code";

/** Audience raises effective approval requirements (informational × shared ≠ auto). */
export type Audience = "private" | "team" | "external_visible";

/**
 * The governed unit. ADR-180 made two corrections here.
 *
 * `view` became `database`. The member was never a View: every capability that
 * carried it declared a Database and its record permissions — the built-in
 * manifests literally described them as "Deals database and views". A View
 * (table, board, calendar, form) is a UI ELEMENT the user picks at render time;
 * it holds no permissions and has no trust lifecycle, so it cannot be a
 * capability. The Database is the thing that is governed, and naming it that
 * makes the Page/Database relation legible: one Database, one Page.
 *
 * `dashboard` was removed. It was dead as a CapabilityType — the real dashboard
 * concept lives in `BlueprintViewKind`, which is a View kind, exactly where the
 * correction above says it belongs.
 */
export type CapabilityType = "skill" | "automation" | "agent" | "integration" | "database";

/**
 * Component Registry discriminator (REG-1, undefined-elements §2). The
 * Component Registry REUSES `capability_manifests` rather than forking a second
 * source of truth (the doc's recommended "same table, `kind` discriminator")
 * — `kind` is the finer, registry-oriented classification the overlap detector
 * (capability/registry.ts) keys on, broader than `CapabilityType` because it
 * also covers reusable sub-components that are not standalone capabilities
 * (a `prompt`, an `eval_set`, a `routing_rule`, a `policy`). Optional/nullable:
 * pre-REG-1 rows have no `kind`, and the detector falls back to
 * `capabilityType` when it is absent.
 */
export type ComponentKind =
  | "agent"
  | "skill"
  | "automation"
  | "prompt"
  | "eval_set"
  | "routing_rule"
  | "policy"
  | "integration"
  | "template";

export type CapabilityState =
  | "draft"
  | "validated"
  | "approved"
  | "active"
  | "trusted"
  | "deprecated"
  | "archived";

/** A single permission the capability declares it needs — the input to risk
 * computation. */
export interface CapabilityPermission {
  resourceType: string;
  action: "read" | "write" | "send";
  dataScope: "public" | "private" | "all";
  /** Crosses the two-plane gate. Declaring egress does NOT grant it — the
   * Authority resolver still gates it; this is purely risk-computation input. */
  egress: boolean;
}

/** A connector the capability composes (for example, an Integration it calls). */
export interface CapabilityConnector {
  id: string;
  /** True when this connector can send/share externally. */
  externalSend?: boolean;
}

/** How isolated an executable capability runs — the general-manifest analogue
 * of foreign-import.ts's `ForeignImportSandboxPolicy.isolation` (kept as the
 * same literal set so the two paths agree). "none" is NOT a valid isolation for
 * an executable capability (PKG-1: "require sandboxing for any executable
 * capability") — the sandbox gate (sandbox-policy.ts) rejects it. */
export type SandboxIsolationLevel = "none" | "process" | "container" | "vm";

/** The network/filesystem/env surface an executable capability's sandbox is
 * asked to GRANT it (PKG-1: the caps the lethal-trifecta union check gates
 * before Active). Empty/false everywhere = a fully-isolated executable (no
 * network, no filesystem, no env passthrough) — the safest shape. */
export interface SandboxCapabilityRequest {
  /** Network egress/ingress the sandbox permits — an egress AND an untrusted-
   * ingest leg of the lethal trifecta (sandbox-policy.ts's sandboxTrifectaLegs). */
  network: boolean;
  /** Filesystem path globs the sandbox exposes — a private-data read leg. Empty = none. */
  filesystem: string[];
  /** Env var names passed through into the sandbox — a private-data (secret)
   * read leg. Empty = none. */
  env: string[];
}

/** Declares that a capability RUNS CODE (an executable capability, PKG-1) and
 * the isolation + sandbox caps it needs. A capability WITHOUT this field is
 * DECLARATIVE (a view/prompt/routing_rule/dashboard) and is never subject to
 * the sandbox floor. `isolation` reuses SandboxIsolationLevel; the sandbox
 * gate requires it to be `!== "none"` (and container|vm when the caps include
 * network/filesystem) before an executable capability can reach Active. */
export interface CapabilityExecutionSpec {
  executable: true;
  isolation: SandboxIsolationLevel;
  sandbox: SandboxCapabilityRequest;
}

/** The generalized Capability Manifest — inputs/outputs/permissions/connectors/
 * evidence/rollback/evaluation, per vision.md. */
export interface CapabilityManifest {
  id: string;
  name: string;
  version: string;
  capabilityType: CapabilityType;
  origin: CapabilityOrigin;
  audience: Audience;
  permissions: CapabilityPermission[];
  connectors: CapabilityConnector[];
  /** Other manifests this one depends on/composes — the dependency closure
   * computeRisk() walks (composite risk = max over the closure). */
  dependencies: Array<{ manifestId: string; versionRange: string }>;
  /** Present ONLY when this capability runs code (PKG-1). Its presence makes
   * the capability "executable" — subject to the sandbox floor + sandbox-cap
   * trifecta gate (sandbox-policy.ts). Absent = a declarative capability. */
  execution?: CapabilityExecutionSpec;
  rollback?: unknown;
  evaluation?: unknown;
}

/** Evidence accumulated for a capability's current state — what lifecycle
 * guards (lifecycle.ts) and promotion thresholds (PROMOTION_DEFAULTS) read. */
export interface CapabilityEvidence {
  activeRunCount: number;
  successRate: number; // 0..1
  violationCount: number;
  ageDays: number;
  evalRuns?: Array<{
    runId: string;
    datasetId: string;
    aggregate: {
      success?: number;
      correction?: number;
      quality?: number;
      route_p?: number;
      route_r?: number;
      reliability?: number;
      safety?: number;
      efficiency?: number;
    };
    recordedAt: string;
  }>;
}

/** Resolves a dependency's manifest by id — the seam risk.ts and lifecycle.ts
 * use instead of reaching into a store directly, so both stay pure/testable. */
export type ResolveDependency = (manifestId: string) => CapabilityManifest | undefined;
