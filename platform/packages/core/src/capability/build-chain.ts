/**
 * The governed capability-build chain (ADR-181) — Internal Strategist decides
 * WHAT to build, Capability Builder drafts it, Governance reviews it, and a
 * Human approves it. Four actors, three machine junctions, and no way to skip
 * one.
 *
 * WHY THIS EXISTS. All four agents were already declared (agents.ts) and all
 * four had governance rows (wiring.ts), but the wiring stopped at identity:
 * Capability Builder held ZERO Skills, its only output was a prose chat reply
 * staged through the kernel passthrough, Internal Strategist had no way to say
 * "this should be built", and Governance was never consulted before a draft
 * reached a human. The Capability Trust Model (types.ts/risk.ts/approvals.ts/
 * sandbox-policy.ts) was fully built and simply never called on the build path.
 * This module is the missing seam — it does not re-implement any of that, it
 * SEQUENCES it.
 *
 * WHAT MAKES IT NON-BYPASSABLE. The same discipline `AgentInvocationResult`
 * uses (agents.ts: no "executed" variant, so the type cannot express an
 * ungoverned write) and `RoutingDecision` uses (chief-of-staff.ts: no `peers`
 * field, so the type cannot express a peer handoff):
 *
 *  - `draftCapability` accepts ONLY a `RecommendedState`. There is no overload
 *    taking a bare intent, so the Builder cannot build something nobody asked
 *    for — a build always traces to a named recommendation.
 *  - `reviewDraft` accepts ONLY a `DraftedState`, and it COMPUTES the verdict
 *    from `computeRisk`/`moduleHasLethalTrifecta`/`evaluateSandboxRequirement`.
 *    A verdict is never a parameter, so Governance cannot be talked into a
 *    lower band — its "opinion" is not an input anywhere in this file.
 *  - There is NO `approved` phase and no `approve()` function. The chain ENDS
 *    at `reviewed`. Activation stays where it already lives (the human-only
 *    `capability.approve` procedure), so no arrangement of these functions can
 *    produce an active capability.
 *  - Every junction takes the acting `FoundationalAgentId` and throws if it is
 *    the wrong one. Governance cannot draft; the Builder cannot self-review;
 *    the Strategist cannot build. "Right junction" is a runtime check, not a
 *    comment.
 *
 * Star topology is preserved (roadmap.md: "Chief of Staff sole router, NO peer
 * handoffs"). Nothing here calls another agent. Each function takes a state and
 * returns a state; the CALLER (apps/api) is the one that walks the chain, the
 * same way `invokeAgent` returns a draft the caller must still propose. An
 * agent handing work to another agent would be a peer handoff — an Engine
 * sequencing three governed steps is not.
 *
 * Pure and I/O-free, like the rest of @bridge/core: no clock, no ids, no store.
 * Ids and timestamps are caller-supplied so a chain replays identically.
 */
import { moduleHasLethalTrifecta } from "../module/risk.js";
import type { BuilderPrimitiveToken } from "./builder-primitives.js";
import { classifyBuilderPrimitiveRisk } from "./builder-primitives.js";
import { requiredApproval, trustGrantsForOrigin, type ApprovalRequirement, type TrustGrantView } from "./approvals.js";
import { computeRisk } from "./risk.js";
import { evaluateSandboxRequirement } from "./sandbox-policy.js";
import type { CapabilityManifest, CapabilityType, ResolveDependency, RiskBand } from "./types.js";
import type { FoundationalAgentId } from "../agents.js";

/**
 * Why this build was recommended. `proactive` = the Strategist spotted the gap
 * before anyone hit it; `retrospective` = something already failed, was done by
 * hand, or was worked around. The distinction is not cosmetic: a retrospective
 * recommendation is a claim ABOUT SOMETHING THAT HAPPENED, so it must cite it
 * (see `EVIDENCE_REQUIRED_BLOCKER`), while a proactive one is openly a
 * hypothesis and is allowed to say so.
 */
export type BuildOrigin = "proactive" | "retrospective";

/** Internal Strategist's output. Names what to build and why — never how. */
export interface BuildRecommendation {
  id: string;
  origin: BuildOrigin;
  /** Which of the five governed Capability types (ADR-180) this asks for. */
  capabilityType: CapabilityType;
  title: string;
  rationale: string;
  /**
   * Citations backing the recommendation. Empty is a REAL, representable state
   * — the Strategist's standing boundary is "missing evidence stays explicit,
   * never invented" (agents.ts responsibilities + its seed eval dataset), so an
   * empty array must be expressible. What it may not do is pass unnoticed: an
   * empty array on a retrospective recommendation becomes a Governance blocker
   * rather than being quietly accepted.
   */
  evidence: readonly string[];
  recommendedBy: Extract<FoundationalAgentId, "internal_strategist">;
}

/** Capability Builder's output: a real manifest, not prose. */
export interface CapabilityBuildDraft {
  /** Back-reference to the recommendation this answers — the audit spine. */
  recommendationId: string;
  manifest: CapabilityManifest;
  /**
   * Which governed builder primitives (builder-primitives.ts) the Builder used
   * or intends to use. DECLARED, not granted — the primitives have their own
   * scope check and the Builder holds no grant for them today. Declaring
   * `shell:execute` here without a sandbox that can contain it is a blocker.
   */
  primitivesUsed: readonly BuilderPrimitiveToken[];
  notes: string;
  /**
   * Whether the manifest came from a model or from the deterministic skeleton
   * the offline path builds. Surfaced to the approver rather than hidden: "a
   * model wrote this" and "the Engine filled in a shape" are different things
   * to be asked to approve.
   */
  source: "model" | "offline_skeleton";
  draftedBy: Extract<FoundationalAgentId, "capability_builder">;
}

/**
 * Governance's output. Every field is COMPUTED from the draft by functions that
 * already existed — this type deliberately has no free-text "assessment" field,
 * because a field the model could fill is a field the model could soften.
 */
export interface GovernanceVerdict {
  recommendationId: string;
  /** `computeRisk` over the manifest's dependency closure. */
  compositeRisk: RiskBand;
  /** `moduleHasLethalTrifecta` over this one manifest. */
  trifectaEscalated: boolean;
  /** `external` when the trifecta fires, otherwise the composite band. */
  effectiveRisk: RiskBand;
  /** `requiredApproval` — the floor, which is never below the human for `external`. */
  approvalRequirement: ApprovalRequirement;
  /** Non-empty means this draft must not reach a human approver as-is. */
  blockers: readonly string[];
  /**
   * Always the literal `true`. Not a computed boolean — a pinned type. There is
   * no value of this interface in which an agent-built capability skips the
   * human, and no branch anywhere can set it to false, because `false` is not
   * assignable to it.
   */
  humanApprovalRequired: true;
  reviewedBy: Extract<FoundationalAgentId, "governance">;
}

export interface RecommendedState {
  phase: "recommended";
  recommendation: BuildRecommendation;
}
export interface DraftedState {
  phase: "drafted";
  recommendation: BuildRecommendation;
  draft: CapabilityBuildDraft;
}
export interface ReviewedState {
  phase: "reviewed";
  recommendation: BuildRecommendation;
  draft: CapabilityBuildDraft;
  verdict: GovernanceVerdict;
}
export interface BlockedState {
  phase: "blocked";
  recommendation: BuildRecommendation;
  draft: CapabilityBuildDraft;
  verdict: GovernanceVerdict;
}

/**
 * Note what is absent: there is no `approved` or `active` phase. The chain's
 * terminal machine state is `reviewed` — "ready to ASK a human", not "allowed".
 */
export type BuildChainState = RecommendedState | DraftedState | ReviewedState | BlockedState;

export class BuildChainError extends Error {
  constructor(message: string) {
    super(`capability build chain: ${message}`);
    this.name = "BuildChainError";
  }
}

/** Throws when an agent reaches for a junction that is not its own. */
function assertActor(actual: FoundationalAgentId, expected: FoundationalAgentId, junction: string): void {
  if (actual !== expected) {
    throw new BuildChainError(
      `only ${expected} may ${junction} — ${actual} attempted it. Roles at a junction are fixed; an agent cannot borrow another's authority by calling its function.`,
    );
  }
}

export const EVIDENCE_REQUIRED_BLOCKER =
  "retrospective recommendation cites no evidence — a claim that something already went wrong must name what did, or it is an invented finding";

export interface RecommendBuildArgs {
  actor: FoundationalAgentId;
  id: string;
  origin: BuildOrigin;
  capabilityType: CapabilityType;
  title: string;
  rationale: string;
  evidence?: readonly string[];
}

/**
 * Junction 1 — Internal Strategist decides something should exist. Produces no
 * manifest, touches no filesystem, and holds no path to activation; the only
 * thing it can do with this state is hand it to `draftCapability`.
 */
export function recommendBuild(args: RecommendBuildArgs): RecommendedState {
  assertActor(args.actor, "internal_strategist", "recommend a build");
  if (args.title.trim().length === 0) {
    throw new BuildChainError("a recommendation needs a title — an unnamed build cannot be reviewed or refused");
  }
  return {
    phase: "recommended",
    recommendation: {
      id: args.id,
      origin: args.origin,
      capabilityType: args.capabilityType,
      title: args.title,
      rationale: args.rationale,
      evidence: [...(args.evidence ?? [])],
      recommendedBy: "internal_strategist",
    },
  };
}

export interface DraftCapabilityArgs {
  actor: FoundationalAgentId;
  /** The ONLY way in. There is no entry point that takes a bare intent. */
  state: RecommendedState;
  manifest: CapabilityManifest;
  primitivesUsed?: readonly BuilderPrimitiveToken[];
  notes?: string;
  source: "model" | "offline_skeleton";
}

/**
 * Junction 2 — Capability Builder turns a recommendation into a manifest. This
 * is the function that makes "the Builder can build capabilities" true rather
 * than aspirational, and its signature is also what keeps it bounded: a
 * `RecommendedState` is required, so every capability the Builder has ever
 * produced traces back to a recommendation somebody can read.
 *
 * The manifest is NOT validated for risk here. That is Junction 3's job, and
 * splitting it matters: if the Builder could reject its own drafts it would be
 * deciding what Governance never sees.
 */
export function draftCapability(args: DraftCapabilityArgs): DraftedState {
  assertActor(args.actor, "capability_builder", "draft a capability");
  return {
    phase: "drafted",
    recommendation: args.state.recommendation,
    draft: {
      recommendationId: args.state.recommendation.id,
      manifest: args.manifest,
      primitivesUsed: [...(args.primitivesUsed ?? [])],
      notes: args.notes ?? "",
      source: args.source,
      draftedBy: "capability_builder",
    },
  };
}

export interface ReviewDraftArgs {
  actor: FoundationalAgentId;
  /** The ONLY way in — an unbuilt recommendation has nothing to review. */
  state: DraftedState;
  /** Dependency-closure resolver for `computeRisk` (registry seam, as elsewhere). */
  resolveDependency: ResolveDependency;
  /** Trust grants in force. Filtered by origin before use, never trusted raw. */
  trustGrants?: readonly TrustGrantView[];
}

/**
 * Junction 3 — Governance reviews. Every number it returns comes from a
 * function that already governed this codebase before this chain existed; the
 * contribution here is that they are now CALLED on the build path, in one
 * place, before a human is ever asked.
 *
 * Returns `blocked` when the draft must not go further. Blocking is not
 * rejection — the state keeps the recommendation, the draft, and the reasons,
 * so the Builder can be asked to try again against a specific list rather than
 * regenerate blind.
 */
export function reviewDraft(args: ReviewDraftArgs): ReviewedState | BlockedState {
  assertActor(args.actor, "governance", "review a draft");
  const { recommendation, draft } = args.state;
  const manifest = draft.manifest;

  const compositeRisk = computeRisk(manifest, args.resolveDependency);
  // The union check runs over this one manifest. A single capability CAN hold
  // all three legs by itself, and the module-level function is the same union —
  // reusing it keeps one trifecta definition instead of a second, drifting one.
  const trifectaEscalated = moduleHasLethalTrifecta([manifest]);
  const effectiveRisk: RiskBand = trifectaEscalated ? "external" : compositeRisk;

  const grants = trustGrantsForOrigin(manifest.origin, [...(args.trustGrants ?? [])]);
  const approvalRequirement = requiredApproval(effectiveRisk, manifest.audience, grants);

  const blockers: string[] = [];

  if (manifest.capabilityType !== recommendation.capabilityType) {
    blockers.push(
      `the draft is a ${manifest.capabilityType} but the recommendation asked for a ${recommendation.capabilityType} — a substituted Capability type is a different decision than the one that was made`,
    );
  }

  // Provenance. A machine-written manifest claiming `built_in` or `template`
  // would inherit a trust tier it did not earn (approvals.ts's ORIGIN_TRUST_TIER),
  // which is exactly the kind of quiet escalation the trust model exists to stop.
  if (manifest.origin !== "ai_generated") {
    blockers.push(
      `the draft declares origin "${manifest.origin}" but was written by the Capability Builder — an agent-authored manifest is ai_generated, and claiming a higher-trust origin misattributes provenance`,
    );
  }

  const sandbox = evaluateSandboxRequirement(manifest);
  if (!sandbox.satisfied) {
    blockers.push(`sandbox floor not satisfied (${sandbox.reason}) — an executable capability cannot reach a human approver without containment`);
  }

  // A declared `shell:execute` needs a manifest that can actually contain it.
  // The primitive's own classification is the authority on that, not this file.
  for (const token of draft.primitivesUsed) {
    const classification = classifyBuilderPrimitiveRisk(token);
    if (classification.sandboxMandatory && !sandbox.requiresSandbox) {
      blockers.push(
        `the draft uses "${token}", which is sandbox-mandatory, but declares no execution spec — arbitrary code execution cannot be a declarative capability`,
      );
    }
  }

  if (recommendation.origin === "retrospective" && recommendation.evidence.length === 0) {
    blockers.push(EVIDENCE_REQUIRED_BLOCKER);
  }

  const verdict: GovernanceVerdict = {
    recommendationId: recommendation.id,
    compositeRisk,
    trifectaEscalated,
    effectiveRisk,
    approvalRequirement,
    blockers,
    humanApprovalRequired: true,
    reviewedBy: "governance",
  };

  if (blockers.length > 0) {
    return { phase: "blocked", recommendation, draft, verdict };
  }
  return { phase: "reviewed", recommendation, draft, verdict };
}

/**
 * True only for a reviewed, unblocked chain. The one thing a caller may use to
 * decide whether to raise a human approval — and note what it still is NOT:
 * permission to activate. It means "this is fit to ASK about".
 */
export function readyForHumanApproval(state: BuildChainState): state is ReviewedState {
  return state.phase === "reviewed";
}

/**
 * A one-line, human-readable trail of who did what, for the Approvals card and
 * the ledger. Deliberately reconstructed from the STATE rather than accumulated
 * as the chain runs: a log an agent appends to is a log an agent can shape.
 */
export function describeChain(state: BuildChainState): string {
  const parts = [
    `Internal Strategist recommended "${state.recommendation.title}" (${state.recommendation.origin}, ${state.recommendation.evidence.length} citation(s))`,
  ];
  if (state.phase !== "recommended") {
    parts.push(`Capability Builder drafted a ${state.draft.manifest.capabilityType} manifest (${state.draft.source})`);
  }
  if (state.phase === "reviewed" || state.phase === "blocked") {
    parts.push(
      `Governance computed ${state.verdict.effectiveRisk}${state.verdict.trifectaEscalated ? " (lethal-trifecta escalated)" : ""}, approval ${state.verdict.approvalRequirement}`,
    );
    parts.push(
      state.phase === "blocked"
        ? `BLOCKED on ${state.verdict.blockers.length} item(s) — not sent to a human`
        : "awaiting Human approval — no capability is active until a person approves it",
    );
  }
  return parts.join(" → ");
}
