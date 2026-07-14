/**
 * Capability Trust Model — shared types (docs/wiki/vision.md "Capability Trust
 * Model" + "Promotion defaults"). Generalizes @bridge/tool-kit's ToolManifest
 * (the tool-shaped special case) to every capability_type in
 * capability_manifests (skill/workflow/agent/tool/integration/view/dashboard).
 */

/** Risk axis — COMPUTED from the manifest, never self-declared by the generator. */
export type RiskBand = "informational" | "advisory" | "transformational" | "operational" | "external";

/** Origin axis. */
export type CapabilityOrigin = "built_in" | "template" | "community" | "ai_generated" | "user_code";

/** Audience raises effective approval requirements (informational × shared ≠ auto). */
export type Audience = "private" | "team" | "external_visible";

export type CapabilityType = "skill" | "workflow" | "agent" | "tool" | "integration" | "view" | "dashboard";

export type CapabilityState =
  | "draft"
  | "validated"
  | "approved"
  | "active"
  | "trusted"
  | "deprecated"
  | "archived";

/** A single permission the capability declares it needs — the input to risk
 * computation. Mirrors @bridge/tool-kit's `capability` manifest entry shape. */
export interface CapabilityPermission {
  resourceType: string;
  action: "read" | "write" | "send";
  dataScope: "public" | "private" | "all";
  /** Crosses the two-plane gate. Declaring egress does NOT grant it — the
   * Authority resolver still gates it; this is purely risk-computation input. */
  egress: boolean;
}

/** A connector the capability composes (e.g. an integration/tool it calls). */
export interface CapabilityConnector {
  id: string;
  /** True when this connector can send/share externally. */
  externalSend?: boolean;
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
