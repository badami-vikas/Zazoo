/**
 * Capability lifecycle — the state machine every capability (skill/workflow/
 * agent/tool/integration/view/dashboard) moves through (docs/wiki/vision.md
 * "Capability Trust Model" + "Promotion defaults"):
 *
 *   draft -> validated -> approved -> active -> trusted -> deprecated -> archived
 *
 * Guards:
 *  - Generation only EVER creates `draft` (the Capability Builder makes drafts,
 *    never activates — "Generation ≠ activation").
 *  - `trusted` requires evidence thresholds (PROMOTION_DEFAULTS.trusted) and sets
 *    `trustedUntil = now + trustedTtlDays` (90-day TTL).
 *  - A dependency change demotes `trusted` -> `validated` (trustedUntil cleared).
 *  - Failure -> SUSPEND immediately (no approval needed; safety never queues).
 *  - The demotion *decision* itself requires human approval if the original
 *    creation/promotion into that state did (mirrors the pipeline's
 *    draft-then-approve invariant — this module never bypasses it, it only
 *    decides whether a transition NEEDS to go through it).
 *
 * Thresholds are read from ONE exported constant (`PROMOTION_DEFAULTS`), shaped
 * for later `policy_params` storage (Variance-Adjuster-tunable) — never
 * scattered as magic numbers through the guard functions below.
 */
import type { CapabilityEvidence, CapabilityState } from "./types.js";

/** Promotion thresholds — shaped 1:1 for later `policy_params` rows (each top-
 * level key here is a candidate `param_key`). See docs/wiki/vision.md
 * "Promotion defaults" (raw §5 has the full table across workflow/skill/agent/
 * tool). This module only needs the `trusted` thresholds; the rest are kept
 * here too so callers (P1 onboarding, policy seeding) have one place to read
 * every promotion default from, not several.
 */
export const PROMOTION_DEFAULTS = {
  workflow: {
    draftMinReps: 5,
    draftWindowDays: 30,
    draftMinSimilarity: 0.8,
    activateMinApprovedRuns: 3,
    activateMaxCorrectionRate: 0.2,
  },
  skill: {
    minWorkflows: 2,
    minContexts: 2,
    minSuccessRate: 0.85,
  },
  agent: {
    minCapabilities: 3,
    minResponsibilityWeeks: 4,
    requiresOwner: true,
  },
  tool: {
    minSuccessRate: 0.9,
    minRuns: 20,
    stableIoDays: 14,
  },
  trusted: {
    minActiveRuns: 30,
    minSuccessRate: 0.95,
    maxViolations: 0,
    minAgeDays: 60,
    trustedTtlDays: 90,
  },
} as const;

/** Legal forward transitions. Demotion (trusted->validated) and suspend/resume
 * are handled by dedicated functions below, not this table — they're not a
 * simple "next state in sequence" step. */
const FORWARD_TRANSITIONS: Record<CapabilityState, CapabilityState | null> = {
  draft: "validated",
  validated: "approved",
  approved: "active",
  active: "trusted",
  trusted: "deprecated",
  deprecated: "archived",
  archived: null,
};

export class InvalidTransitionError extends Error {
  constructor(from: CapabilityState, to: CapabilityState) {
    super(`capability lifecycle: cannot transition ${from} -> ${to}`);
    this.name = "InvalidTransitionError";
  }
}

export class EvidenceThresholdError extends Error {
  constructor(reason: string) {
    super(`capability lifecycle: evidence threshold not met — ${reason}`);
    this.name = "EvidenceThresholdError";
  }
}

/** Generation only ever creates `draft` — the one entry point the Capability
 * Builder is allowed to call. */
export function newDraftState(): CapabilityState {
  return "draft";
}

/** Does this evidence meet the `trusted` promotion bar? Returns a reason
 * string when it does NOT (so callers can surface why), or null when it does. */
export function trustedThresholdFailure(evidence: CapabilityEvidence): string | null {
  const t = PROMOTION_DEFAULTS.trusted;
  if (evidence.activeRunCount < t.minActiveRuns) {
    return `activeRunCount ${evidence.activeRunCount} < required ${t.minActiveRuns}`;
  }
  if (evidence.successRate < t.minSuccessRate) {
    return `successRate ${evidence.successRate} < required ${t.minSuccessRate}`;
  }
  if (evidence.violationCount > t.maxViolations) {
    return `violationCount ${evidence.violationCount} > allowed ${t.maxViolations}`;
  }
  if (evidence.ageDays < t.minAgeDays) {
    return `ageDays ${evidence.ageDays} < required ${t.minAgeDays}`;
  }
  return null;
}

export interface TransitionResult {
  nextState: CapabilityState;
  /** Set only when entering `trusted` — now + trustedTtlDays. */
  trustedUntil?: string;
  /** True when this transition itself needs a human approval before it takes
   * effect (the caller/router still routes this through the pipeline; this
   * flag is what decide-vs-auto-apply logic reads). */
  requiresApproval: boolean;
}

/**
 * Advance a capability one step forward (draft->validated->...->trusted->
 * deprecated->archived). Throws `InvalidTransitionError` for anything not in
 * `FORWARD_TRANSITIONS`, and `EvidenceThresholdError` when advancing INTO
 * `trusted` without meeting `PROMOTION_DEFAULTS.trusted`.
 *
 * `nowISO` is caller-injected (determinism seam, matching the rest of
 * @bridge/core — no wall-clock reads here).
 */
export function advance(
  current: CapabilityState,
  evidence: CapabilityEvidence,
  nowISO: string,
  opts: { creationRequiredApproval: boolean },
): TransitionResult {
  const next = FORWARD_TRANSITIONS[current];
  if (!next) throw new InvalidTransitionError(current, current);

  if (next === "trusted") {
    const failure = trustedThresholdFailure(evidence);
    if (failure) throw new EvidenceThresholdError(failure);
    const trustedUntil = new Date(
      Date.parse(nowISO) + PROMOTION_DEFAULTS.trusted.trustedTtlDays * 24 * 60 * 60 * 1000,
    ).toISOString();
    return { nextState: next, trustedUntil, requiresApproval: opts.creationRequiredApproval };
  }

  return { nextState: next, requiresApproval: opts.creationRequiredApproval };
}

/**
 * A dependency of this capability changed — demote `trusted` back to
 * `validated` (trustedUntil cleared). No-op (returns the same state) for any
 * other current state: only a currently-`trusted` capability has anything to
 * lose from a dependency change. The demotion DECISION requires approval iff
 * the capability's creation did (mirrors the "demotion needs approval if
 * creation did" rule) — callers thread `creationRequiredApproval` through.
 */
export function demoteOnDependencyChange(
  current: CapabilityState,
  opts: { creationRequiredApproval: boolean },
): TransitionResult {
  if (current !== "trusted") {
    return { nextState: current, requiresApproval: false };
  }
  return { nextState: "validated", requiresApproval: opts.creationRequiredApproval };
}

export interface SuspendResult {
  suspended: true;
  reason: string;
  /** Suspend NEVER queues for approval — safety never queues. */
  requiresApproval: false;
}

/**
 * Failure -> auto-SUSPEND immediately. No approval needed, ever — "safety
 * never queues" (docs/wiki/vision.md). This does not change `state`; it sets
 * the orthogonal `suspended` flag (capability_states.suspended) so the prior
 * lifecycle state is preserved for when/if the capability is un-suspended.
 */
export function suspendOnFailure(reason: string): SuspendResult {
  return { suspended: true, reason, requiresApproval: false };
}

/** Resuming from suspension is a governed decision (unlike suspending) — it
 * always requires approval, regardless of what creation required, since it is
 * reinstating something that just failed. */
export function resumeFromSuspension(): { suspended: false; requiresApproval: true } {
  return { suspended: false, requiresApproval: true };
}
