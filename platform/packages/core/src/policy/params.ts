/**
 * `policy_params` — the typed, per-workspace TUNABLE SPACE (undefined-elements
 * §4 "Variance Adjuster" + agent-quality-eval-model §5 "Thresholds as
 * policy_params"). Every number the pipeline reads that is NOT a hard invariant
 * lives here so it can be adjusted from real feedback (the Variance Adjuster,
 * variance-adjuster.ts) rather than hard-coded in logic. Two consumers this
 * batch:
 *  - EVAL-3 (eval/comparison.ts) reads `aqv.gates` — the two-gate promotion
 *    thresholds (quality AND routing) — instead of inlining .85/.80 constants.
 *  - VAR-1 (variance-adjuster.ts) nudges `variance.params[*]` (starting with
 *    `tone_threshold`), each clamped to its own `[floor, ceil]`.
 *
 * HARD CEILINGS ARE NOT IN THIS SPACE. The agent-floor DENY, the External-band
 * human floor, and the lethal-trifecta escalation are structural invariants in
 * agent-floor.ts / approvals.ts / risk.ts — the adjuster physically cannot
 * relax them because they are not representable here. A `TunableParam`'s own
 * `ceil` is a per-parameter soft bound (e.g. tone can go fully formal but no
 * further), NOT one of those hard ceilings.
 *
 * Pure/zero-deps, matching the rest of @bridge/core — a store PORT is defined
 * here with an in-memory adapter; the Drizzle binding to the `policy_params`
 * table lives in @bridge/db (a follow-up — nothing persists user overrides yet;
 * defaults-only until a governed nudge is approved).
 */

/** One tunable scalar with its soft bounds. The adjuster may only move `value`
 * within `[floor, ceil]`; it can never widen the bounds themselves. */
export interface TunableParam {
  value: number;
  floor: number;
  ceil: number;
}

/** The two-gate promotion thresholds (agent-quality §2.3/§2.4/§4.2). Gate A =
 * output quality; Gate B = routing precision/recall. A candidate must beat the
 * baseline on BOTH, at `minCases` with a `ci`-level confidence margin, without
 * regressing correction. */
export interface AqvGates {
  /** Gate A — minimum output-quality axis. */
  qualityMin: number;
  /** Gate B — minimum routing precision. */
  routePMin: number;
  /** Gate B — minimum routing recall. */
  routeRMin: number;
  /** Correction rate the candidate must not exceed (lower = better). */
  correctionMax: number;
  /** Minimum held-out case count before a comparison verdict is trusted. */
  minCases: number;
  /** Confidence level for the significance check (e.g. 0.95). */
  ci: number;
}

export interface PolicyParams {
  aqv: {
    /** Rolling scoring window in days (agent-quality §2.1). */
    windowDays: number;
    gates: AqvGates;
  };
  variance: {
    /** Default nudge step the adjuster applies per qualifying veto batch
     * (agent-quality §5: `±δ` default 0.02). */
    delta: number;
    /** The nudgeable parameter map. Keyed by `param_key`; `tone_threshold` is
     * the canonical instance (undefined-elements §4). */
    params: Record<string, TunableParam>;
  };
}

/** Starting proxies (agent-quality §5). Every number here is a Variance-
 * Adjuster target, never a hard-coded constant in gating logic. */
export const DEFAULT_POLICY_PARAMS: PolicyParams = {
  aqv: {
    windowDays: 30,
    gates: {
      qualityMin: 0.85,
      routePMin: 0.85,
      routeRMin: 0.8,
      correctionMax: 0.2,
      minCases: 20,
      ci: 0.95,
    },
  },
  variance: {
    delta: 0.02,
    params: {
      // Canonical instance: 0 = fully casual, 1 = fully formal. "Too casual"
      // vetoes nudge this UP toward formal; "too formal" nudge it DOWN.
      tone_threshold: { value: 0.5, floor: 0, ceil: 1 },
    },
  },
};

/** Deep-clone the defaults so callers/stores never share mutable nested state
 * with the exported constant. */
export function cloneDefaultPolicyParams(): PolicyParams {
  return {
    aqv: { windowDays: DEFAULT_POLICY_PARAMS.aqv.windowDays, gates: { ...DEFAULT_POLICY_PARAMS.aqv.gates } },
    variance: {
      delta: DEFAULT_POLICY_PARAMS.variance.delta,
      params: Object.fromEntries(
        Object.entries(DEFAULT_POLICY_PARAMS.variance.params).map(([k, v]) => [k, { ...v }]),
      ),
    },
  };
}

/** A partial override document (what a workspace stores on top of the defaults). */
export interface PolicyParamsOverride {
  aqv?: { windowDays?: number; gates?: Partial<AqvGates> };
  variance?: { delta?: number; params?: Record<string, Partial<TunableParam>> };
}

/** Merge a workspace override over the defaults. Unspecified fields fall back
 * to `DEFAULT_POLICY_PARAMS`; a tunable param present in the override replaces
 * only the fields it names (value/floor/ceil), keeping the default bounds when
 * the override sets only `value`. */
export function mergePolicyParams(override: PolicyParamsOverride | undefined): PolicyParams {
  const base = cloneDefaultPolicyParams();
  if (!override) return base;

  if (override.aqv) {
    if (typeof override.aqv.windowDays === "number") base.aqv.windowDays = override.aqv.windowDays;
    if (override.aqv.gates) base.aqv.gates = { ...base.aqv.gates, ...stripUndefined(override.aqv.gates) };
  }
  if (override.variance) {
    if (typeof override.variance.delta === "number") base.variance.delta = override.variance.delta;
    if (override.variance.params) {
      for (const [key, partial] of Object.entries(override.variance.params)) {
        const existing = base.variance.params[key] ?? { value: 0, floor: 0, ceil: 1 };
        base.variance.params[key] = { ...existing, ...stripUndefined(partial) };
      }
    }
  }
  return base;
}

function stripUndefined<T extends Record<string, unknown>>(obj: T): Partial<T> {
  return Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined)) as Partial<T>;
}

/** Read the promotion gates for a resolved params doc — the accessor EVAL-3
 * uses so callers never inline gate constants. */
export function resolveGates(params: PolicyParams): AqvGates {
  return params.aqv.gates;
}

/** Look up a tunable parameter by key (undefined when the workspace has no such
 * knob — the adjuster then proposes nothing rather than inventing one). */
export function getTunable(params: PolicyParams, key: string): TunableParam | undefined {
  return params.variance.params[key];
}

/** Clamp a proposed value into a param's soft `[floor, ceil]` bounds — the
 * mechanism that makes "ceilings can't be crossed" literal. */
export function clampToBounds(value: number, param: Pick<TunableParam, "floor" | "ceil">): number {
  return Math.max(param.floor, Math.min(param.ceil, value));
}

/**
 * PolicyParamStore — reads the resolved `PolicyParams` for a workspace
 * (defaults merged with any stored overrides). The port stays minimal so both
 * this in-memory adapter and a future Drizzle-backed one (mapping to
 * `policy_params` rows) satisfy it trivially, mirroring the budget/kill-switch
 * ports in capability/approvals.ts.
 */
export interface PolicyParamStore {
  get(workspaceId: string): Promise<PolicyParams>;
}

/** In-memory `PolicyParamStore` — dev/test default. Holds per-workspace partial
 * overrides; `get` merges them over the defaults. A workspace with no stored
 * override resolves to `DEFAULT_POLICY_PARAMS`. */
export class InMemoryPolicyParamStore implements PolicyParamStore {
  readonly overrides = new Map<string, PolicyParamsOverride>();

  async get(workspaceId: string): Promise<PolicyParams> {
    return mergePolicyParams(this.overrides.get(workspaceId));
  }

  /** Replace a workspace's whole override document. */
  setOverride(workspaceId: string, override: PolicyParamsOverride): void {
    this.overrides.set(workspaceId, override);
  }

  /** Set (or replace) a single tunable param for a workspace — the write a
   * governed Variance-Adjuster nudge performs once a human approves it. */
  setTunable(workspaceId: string, key: string, param: TunableParam): void {
    const current = this.overrides.get(workspaceId) ?? {};
    const variance = current.variance ?? {};
    const params = { ...(variance.params ?? {}) };
    params[key] = param;
    this.overrides.set(workspaceId, { ...current, variance: { ...variance, params } });
  }
}
