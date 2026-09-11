/**
 * Approval routing for capability activation — docs/wiki/vision.md "Capability
 * Trust Model": "Approvals by band: Info/Advisory auto · Transformational
 * user-pref · Operational governance · External explicit. External + agent-
 * floor = hard floor at launch."
 *
 * This mirrors the agent-floor style in @bridge/core's agent-floor.ts: the
 * External hard floor is NOT a configuration value and cannot be widened by
 * any trust grant, kill switch, or budget — it is checked FIRST and returns
 * unconditionally, the same non-removable-floor shape `isAgentFloorDenied`
 * uses. Everything else (auto-activation budgets, the kill switch) only ever
 * NARROWS what auto-activates; nothing here can loosen the external floor.
 */
import type { Audience, CapabilityOrigin, RiskBand } from "./types.js";

export type ApprovalRequirement = "auto" | "user_pref" | "governance" | "explicit_human";

/**
 * Origin trust tiers (PKG-2 supply-chain trust). Higher = more trusted. The
 * load-bearing pin: `community` is EQUAL to `user_code` — the least-trusted
 * tier — so an externally-authored (Commons/MCP/foreign) manifest is never
 * auto-trusted at a higher tier than unreviewed local code ("treat community-
 * origin manifests as untrusted as user_code, never auto-trust at a higher
 * tier"). Ordering only; the numbers are not stored anywhere.
 */
const ORIGIN_TRUST_TIER: Record<CapabilityOrigin, 0 | 1 | 2 | 3> = {
  user_code: 0,
  community: 0, // PKG-2 pin — never above user_code
  ai_generated: 1,
  template: 2,
  built_in: 3,
};

/** True for the least-trusted origins (community/user_code) — the ones that
 * must never receive trust-grant auto-activation (PKG-2). */
export function isUntrustedOrigin(origin: CapabilityOrigin): boolean {
  return ORIGIN_TRUST_TIER[origin] === 0;
}

/**
 * PKG-2 community-origin floor: strip auto-activation trust grants for an
 * untrusted origin (community/user_code) so such a capability can never
 * auto-trust above the base risk/audience requirement. A trusted origin's
 * grants pass through unchanged. Applied at the install/approve seam BEFORE
 * requiredApproval, so `community` gets exactly the `user_code` treatment.
 */
export function trustGrantsForOrigin(origin: CapabilityOrigin, grants: TrustGrantView[]): TrustGrantView[] {
  return isUntrustedOrigin(origin) ? [] : grants;
}

/** A trust grant record, as read from `trust_grants` — the subset approvals.ts
 * needs (not the full DB row shape, to keep this module store-agnostic). */
export interface TrustGrantView {
  capabilityClass: string;
  riskBand: RiskBand;
  autoActivate: boolean;
  revokedAt?: string | null;
}

/** Base approval requirement for a risk band alone (before audience/grants). */
function baseRequirement(riskBand: RiskBand): ApprovalRequirement {
  switch (riskBand) {
    case "informational":
    case "advisory":
      return "auto";
    case "transformational":
      return "user_pref";
    case "operational":
      return "governance";
    case "external":
      return "explicit_human";
  }
}

/** Audience RAISES the requirement — "Informational × shared ≠ auto": once a
 * capability is team/external-visible, even an auto-band risk needs at least
 * a user preference check, never silent auto-activation. Audience can only
 * make approval MORE strict, never less. */
function raiseForAudience(requirement: ApprovalRequirement, audience: Audience): ApprovalRequirement {
  if (audience === "private") return requirement;
  if (requirement === "auto") return "user_pref";
  return requirement;
}

/**
 * Required approval for activating a capability at this risk band/audience,
 * given the trust grants in force. `external` is a HARD FLOOR: no trust grant,
 * matched or not, can ever bring it below `explicit_human` — checked and
 * returned before anything else runs, mirroring agent-floor.ts's
 * non-removable-deny pattern.
 */
export function requiredApproval(
  riskBand: RiskBand,
  audience: Audience,
  trustGrants: TrustGrantView[],
): ApprovalRequirement {
  // Hard floor — non-removable, checked first, no grant/budget/kill-switch can move it.
  if (riskBand === "external") return "explicit_human";

  // A trust grant can only LOWER the requirement toward "auto", and only for
  // non-external bands (already excluded above) with an active, matching,
  // auto-activate grant. It can never raise it — trust grants are strictly
  // permissive relative to the base computation. Audience is then re-applied
  // on top (it can only raise, never lower — "informational x shared != auto"
  // holds even when a trust grant would otherwise auto-activate).
  const grantsAuto = trustGrants.some((g) => g.riskBand === riskBand && g.autoActivate && !g.revokedAt);
  const base = grantsAuto ? "auto" : baseRequirement(riskBand);
  return raiseForAudience(base, audience);
}

/** Auto-activation budgets — vision.md: "Auto-activation budgets (20 info /
 * 10 advisory per day)". One organization's budget for one calendar day (UTC),
 * shaped for later `policy_params` storage as constants, not scattered magic
 * numbers (mirrors PROMOTION_DEFAULTS's shape in lifecycle.ts). */
export const AUTO_ACTIVATION_BUDGETS = {
  informational: 20,
  advisory: 10,
} as const;

export type BudgetedRiskBand = keyof typeof AUTO_ACTIVATION_BUDGETS;

export function isBudgetedBand(band: RiskBand): band is BudgetedRiskBand {
  return band === "informational" || band === "advisory";
}

/** A read/increment port for today's auto-activation counts — kept minimal
 * (count-only) so both an in-memory dev implementation and a future
 * Postgres-backed one (e.g. a rolling counter keyed by organization+band+day)
 * satisfy it trivially. */
export interface AutoActivationBudgetStore {
  /** Count of auto-activations already recorded today for this organization+band. */
  countToday(organizationId: string, band: BudgetedRiskBand, todayKey: string): Promise<number>;
  /** Record one more auto-activation for today. */
  recordAutoActivation(organizationId: string, band: BudgetedRiskBand, todayKey: string): Promise<void>;
}

/** In-memory implementation — dev/test default, mirrors the in-memory-port
 * style in memory/stores.ts (a Map keyed by "organizationId:band:day"). */
export class InMemoryAutoActivationBudgetStore implements AutoActivationBudgetStore {
  readonly counts = new Map<string, number>();

  #key(organizationId: string, band: BudgetedRiskBand, todayKey: string): string {
    return `${organizationId}:${band}:${todayKey}`;
  }

  async countToday(organizationId: string, band: BudgetedRiskBand, todayKey: string): Promise<number> {
    return this.counts.get(this.#key(organizationId, band, todayKey)) ?? 0;
  }

  async recordAutoActivation(organizationId: string, band: BudgetedRiskBand, todayKey: string): Promise<void> {
    const key = this.#key(organizationId, band, todayKey);
    this.counts.set(key, (this.counts.get(key) ?? 0) + 1);
  }
}

/** The kill switch — a organization-level flag (backed by `organization_settings` in
 * prod, or this in-memory port in dev/tests) that forces EVERY activation to
 * explicit approval regardless of risk band, audience, or trust grants. */
export interface KillSwitchPort {
  isEngaged(organizationId: string): Promise<boolean>;
}

export class InMemoryKillSwitch implements KillSwitchPort {
  readonly engaged = new Set<string>();
  async isEngaged(organizationId: string): Promise<boolean> {
    return this.engaged.has(organizationId);
  }
  engage(organizationId: string): void {
    this.engaged.add(organizationId);
  }
  disengage(organizationId: string): void {
    this.engaged.delete(organizationId);
  }
}

export interface ActivationDecision {
  requirement: ApprovalRequirement;
  /** True when this specific activation would consume a daily auto-activation
   * budget slot (only meaningful when requirement resolves to "auto"). */
  budgeted: boolean;
  /** Human-readable reason the requirement escalated above the base band
   * mapping (kill switch / budget exhausted / audience), for audit purposes. */
  reason: string;
}

/**
 * Full activation gate: risk/audience/trust-grant base requirement, then the
 * kill switch (forces explicit_human, wins over everything) and the daily
 * budget (an exhausted budget escalates an otherwise-"auto" informational/
 * advisory activation to "user_pref" rather than silently over-spending the
 * budget).
 */
export async function resolveActivationApproval(args: {
  organizationId: string;
  riskBand: RiskBand;
  audience: Audience;
  trustGrants: TrustGrantView[];
  killSwitch: KillSwitchPort;
  budgets: AutoActivationBudgetStore;
  /** Calendar-day key (e.g. "2026-07-06"), caller-injected — no wall-clock read here. */
  todayKey: string;
}): Promise<ActivationDecision> {
  const base = requiredApproval(args.riskBand, args.audience, args.trustGrants);

  if (await args.killSwitch.isEngaged(args.organizationId)) {
    return { requirement: "explicit_human", budgeted: false, reason: "kill switch engaged" };
  }

  if (base !== "auto") {
    return { requirement: base, budgeted: false, reason: "base requirement (risk/audience/grants)" };
  }

  if (!isBudgetedBand(args.riskBand)) {
    // Should not happen (external is never "auto"), but stay safe: no budget
    // concept for a band outside the two budgeted ones.
    return { requirement: "auto", budgeted: false, reason: "auto (unbudgeted band)" };
  }

  const used = await args.budgets.countToday(args.organizationId, args.riskBand, args.todayKey);
  const limit = AUTO_ACTIVATION_BUDGETS[args.riskBand];
  if (used >= limit) {
    return {
      requirement: "user_pref",
      budgeted: false,
      reason: `daily auto-activation budget exhausted (${used}/${limit} for ${args.riskBand})`,
    };
  }

  return { requirement: "auto", budgeted: true, reason: "within daily auto-activation budget" };
}

/** Minimal atomic key/value state port — structurally identical to
 * `LocalStateStore` in @bridge/local (pglite-backed) and the private copies in
 * apps/api; declared here so core stays free of a @bridge/local dependency. */
export interface AtomicStatePort {
  read(organizationId: string, namespace: string): Promise<unknown | null>;
  update<T>(
    organizationId: string,
    namespace: string,
    initialState: unknown,
    reduce: (current: unknown) => { state: unknown; result: T },
  ): Promise<T>;
}

const BUDGET_NAMESPACE = "capability:auto-activation-budget";
interface BudgetState {
  version: 1;
  /** keyed "band:day" — only today's keys are kept (pruned on write). */
  counts: Record<string, number>;
}
function budgetState(value: unknown): BudgetState {
  if (value && typeof value === "object" && (value as BudgetState).version === 1) return value as BudgetState;
  return { version: 1, counts: {} };
}

/** Budget counters persisted through an atomic state port — survive process restart. */
export class StateBackedAutoActivationBudgetStore implements AutoActivationBudgetStore {
  constructor(private readonly state: AtomicStatePort) {}

  async countToday(organizationId: string, band: BudgetedRiskBand, todayKey: string): Promise<number> {
    return budgetState(await this.state.read(organizationId, BUDGET_NAMESPACE)).counts[`${band}:${todayKey}`] ?? 0;
  }

  async recordAutoActivation(organizationId: string, band: BudgetedRiskBand, todayKey: string): Promise<void> {
    await this.state.update(organizationId, BUDGET_NAMESPACE, { version: 1, counts: {} }, (current) => {
      const key = `${band}:${todayKey}`;
      const counts: Record<string, number> = {};
      for (const [k, v] of Object.entries(budgetState(current).counts)) {
        if (k.endsWith(`:${todayKey}`)) counts[k] = v;
      }
      counts[key] = (counts[key] ?? 0) + 1;
      return { state: { version: 1, counts } satisfies BudgetState, result: undefined };
    });
  }
}

const KILL_SWITCH_NAMESPACE = "capability:kill-switch";

/** Kill switch persisted through an atomic state port — a restart never silently disengages it. */
export class StateBackedKillSwitch implements KillSwitchPort {
  constructor(private readonly state: AtomicStatePort) {}

  async isEngaged(organizationId: string): Promise<boolean> {
    const value = await this.state.read(organizationId, KILL_SWITCH_NAMESPACE);
    return Boolean(value && typeof value === "object" && (value as { engaged?: unknown }).engaged === true);
  }
  async engage(organizationId: string): Promise<void> {
    await this.#set(organizationId, true);
  }
  async disengage(organizationId: string): Promise<void> {
    await this.#set(organizationId, false);
  }
  async #set(organizationId: string, engaged: boolean): Promise<void> {
    await this.state.update(organizationId, KILL_SWITCH_NAMESPACE, { version: 1, engaged: false }, () => ({
      state: { version: 1, engaged },
      result: undefined,
    }));
  }
}
