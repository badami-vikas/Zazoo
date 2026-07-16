/**
 * Bounded child Agent Runs (AGS2, docs/raw/agent-goal-skill-orchestration-plan-2026-07.md
 * §"Child Agent Runs"). A child Agent Run is NOT a new permanent Agent — it is a
 * bounded, depth-limited delegation a parent Agent Run creates for one Goal/Task,
 * whose authority, Skills, data scope, budget, review requirement, taint, and
 * delegation depth can never exceed the parent (`deriveChildAgentRun` only ever
 * INTERSECTS/narrows; it never unions or grants). The parent Agent's identity is
 * reused for the child's own subsequent pipeline actions — attribution comes from
 * threading `context: { type: "child_agent_run", id, runId }` (types.ts's
 * `RunContext`) onto those actions, not from minting a second Agent identity.
 *
 * This module is pure logic + an in-memory store, mirroring every other
 * primitive in @bridge/core (RitualExecutor, agent-scope.ts's
 * `validateRitualWithinAgents`). It does NOT itself call the pipeline — a
 * caller (apps/api's router, or a future `ChildRunExecutor` mirroring
 * `InProcessRitualExecutor`) is expected to call `validateActionWithinChildRun`
 * before proposing each of the child run's actions through the SAME governed
 * pipeline every other mutation uses; nothing here bypasses `propose`/`decide`.
 */
import type { DataScope } from "./data-scope.js";
import type { Actor, Plane, TrustOrigin } from "./types.js";
import type { LedgerEntry } from "./types.js";
import type { LedgerStore, RunCtx } from "./ports.js";

/** Computed handling requirement (docs/glossary.md "Review Mode"). Ordered from
 * least to most strict — `stricterReviewMode` never moves left. */
export type ReviewMode = "auto" | "notify" | "approve" | "quorum";

const REVIEW_MODE_ORDER: readonly ReviewMode[] = ["auto", "notify", "approve", "quorum"];

/** The stricter (never-lower) of two review modes — AGS2 inheritance rule
 * "risk: never lower review requirement than parent." */
export function stricterReviewMode(a: ReviewMode, b: ReviewMode): ReviewMode {
  return REVIEW_MODE_ORDER.indexOf(a) >= REVIEW_MODE_ORDER.indexOf(b) ? a : b;
}

const TAINT_ORDER: readonly TrustOrigin[] = ["operator", "user_content", "untrusted_external"];

/** The more-tainted (never-cleaner) of two taints — AGS2 inheritance rule
 * "runtime_taint: monotonic; inherited and propagated." Absent = untainted
 * (the safe/clean end), so `undefined` only wins when BOTH sides are absent. */
export function stricterTaint(a: TrustOrigin | undefined, b: TrustOrigin | undefined): TrustOrigin | undefined {
  if (!a) return b;
  if (!b) return a;
  return TAINT_ORDER.indexOf(a) >= TAINT_ORDER.indexOf(b) ? a : b;
}

/** Hard delegation-depth cap (AGS2 prohibition: "no recursive delegation beyond
 * configured depth"). Named constant, mirrors chief-of-staff.ts's MAX_CHAIN_DEPTH
 * pattern so a future policy_params binding can override it without touching
 * call sites. */
export const MAX_CHILD_RUN_DEPTH = 3;

export class ChildRunDepthExceededError extends Error {
  constructor(public readonly depth: number) {
    super(`child-agent-run: depth ${depth} would exceed the hard cap of ${MAX_CHILD_RUN_DEPTH} — no further delegation`);
    this.name = "ChildRunDepthExceededError";
  }
}

export class ChildRunAuthorityExceededError extends Error {
  constructor(public readonly reasonDetail: string) {
    super(`child-agent-run: ${reasonDetail}`);
    this.name = "ChildRunAuthorityExceededError";
  }
}

/** The parent Run's current bounds — everything a child Run inherits FROM.
 * Built by the caller from the parent Agent's actual authority (never
 * client-asserted at the API boundary — see apps/api's childAgentRun router). */
export interface ParentRunEnvelope {
  runId: string;
  agentId: string;
  workspaceId: string;
  authorityScope: readonly string[];
  eligibleSkills: readonly string[];
  dataScope: DataScope;
  plane: Plane;
  budgetRemaining: { calls: number; cost: number };
  reviewMode: ReviewMode;
  taint?: TrustOrigin;
  /** 0 for a top-level (non-child) Run. */
  delegationDepth: number;
  /** The principal (Human/Team) the parent Run is itself acting on behalf of,
   * if any — inherited unchanged onto the child Run's audit row so the full
   * attribution chain (principal → parent Agent → child Run) stays intact,
   * never re-derived by inference. */
  onBehalfOf?: { type: "user" | "team"; id: string };
}

export interface ChildAgentRunRequest {
  goalId: string;
  taskId: string;
  /** Capability-scope tokens requested for the child — narrowed to
   * `∩ parent.authorityScope`, never unioned. */
  delegatedScope: readonly string[];
  /** Skill ids requested for the child — narrowed to `∩ parent.eligibleSkills`. */
  selectedSkills: readonly string[];
  budget: { maxCalls: number; maxCost: number };
  deadline: string;
  stopCondition: string;
  requestedDataScope?: DataScope;
  requestedReviewMode?: ReviewMode;
  requestedTaint?: TrustOrigin;
  /** Set when the child Run's purpose touches an "external" risk-band Skill —
   * forces reviewMode to at least "approve" regardless of parent/requested
   * (AGS2 prohibition: "no consequential external Action without Human approval"). */
  touchesExternalRisk?: boolean;
}

export type ChildAgentRunStatus = "running" | "completed" | "cancelled" | "failed" | "stopped";

export interface ChildAgentRun {
  id: string;
  parentRunId: string;
  parentAgentId: string;
  workspaceId: string;
  goalId: string;
  taskId: string;
  depth: number;
  authorityScope: readonly string[];
  /** Requested tokens the parent did not hold, dropped rather than granted —
   * mirrors `agent-scope.ts`'s `BuiltAgentCapability.dropped` transparency pattern. */
  droppedScope: readonly string[];
  eligibleSkills: readonly string[];
  dataScope: DataScope;
  plane: Plane;
  budget: { maxCalls: number; maxCost: number };
  deadline: string;
  stopCondition: string;
  reviewMode: ReviewMode;
  taint?: TrustOrigin;
  status: ChildAgentRunStatus;
  createdAt: string;
}

/**
 * Derive a bounded child Agent Run from its parent's envelope + the requested
 * delegation. Throws `ChildRunDepthExceededError` past the depth cap, and
 * `ChildRunAuthorityExceededError` when the intersection leaves nothing
 * usable (a zero/negative budget, or a data scope that doesn't intersect the
 * parent's at all) — a child Run that could do NOTHING is not a valid
 * delegation, it is a caller bug, so this fails loud rather than silently
 * persisting an inert row.
 */
export function deriveChildAgentRun(
  parent: ParentRunEnvelope,
  req: ChildAgentRunRequest,
  ids: { next(): string },
  clock: { nowISO(): string },
): ChildAgentRun {
  const depth = parent.delegationDepth + 1;
  if (depth > MAX_CHILD_RUN_DEPTH) {
    throw new ChildRunDepthExceededError(depth);
  }

  const parentHasWildcard = parent.authorityScope.includes("*");
  const authorityScope: string[] = [];
  const droppedScope: string[] = [];
  for (const token of req.delegatedScope) {
    if (parentHasWildcard || parent.authorityScope.includes(token)) {
      authorityScope.push(token);
    } else {
      droppedScope.push(token);
    }
  }

  const eligibleSkills = req.selectedSkills.filter((s) => parent.eligibleSkills.includes(s));

  const dataScope = intersectRunDataScope(parent.dataScope, req.requestedDataScope ?? parent.dataScope);
  if (dataScope === "none") {
    throw new ChildRunAuthorityExceededError(
      `requested data scope "${req.requestedDataScope ?? parent.dataScope}" does not intersect parent's "${parent.dataScope}"`,
    );
  }

  // Plane never escalates — crossing planes is a governed sourcing request
  // (authority.ts's planeGate), not something a child Run can silently do.
  const plane = parent.plane;

  const budget = {
    maxCalls: Math.min(req.budget.maxCalls, parent.budgetRemaining.calls),
    maxCost: Math.min(req.budget.maxCost, parent.budgetRemaining.cost),
  };
  if (budget.maxCalls <= 0) {
    throw new ChildRunAuthorityExceededError("no call budget remains to delegate to a child run");
  }
  if (budget.maxCost < 0) {
    throw new ChildRunAuthorityExceededError("no cost budget remains to delegate to a child run");
  }

  let reviewMode = stricterReviewMode(parent.reviewMode, req.requestedReviewMode ?? parent.reviewMode);
  if (req.touchesExternalRisk) {
    reviewMode = stricterReviewMode(reviewMode, "approve");
  }

  const taint = stricterTaint(parent.taint, req.requestedTaint);

  return {
    id: ids.next(),
    parentRunId: parent.runId,
    parentAgentId: parent.agentId,
    workspaceId: parent.workspaceId,
    goalId: req.goalId,
    taskId: req.taskId,
    depth,
    authorityScope,
    droppedScope,
    eligibleSkills,
    dataScope,
    plane,
    budget,
    deadline: req.deadline,
    stopCondition: req.stopCondition,
    reviewMode,
    ...(taint ? { taint } : {}),
    status: "running",
    createdAt: clock.nowISO(),
  };
}

/** Minimal 3-value intersection for `DataScope` ("all" | "public" | "private")
 * local to this module — mirrors `data-scope.ts`'s `intersectDataScope` without
 * importing its `EffectiveDataScope`-typed signature (child-run data scope is
 * always a concrete `DataScope`, never the "none" sentinel on either input). */
function intersectRunDataScope(a: DataScope, b: DataScope): DataScope | "none" {
  if (a === b) return a;
  if (a === "all") return b;
  if (b === "all") return a;
  return "none"; // "public" vs "private" never intersect
}

export interface ChildAgentRunStore {
  create(run: ChildAgentRun): Promise<ChildAgentRun>;
  get(id: string): Promise<ChildAgentRun | null>;
  listByParentRun(parentRunId: string): Promise<ChildAgentRun[]>;
  updateStatus(id: string, status: ChildAgentRunStatus): Promise<ChildAgentRun>;
}

export class InMemoryChildAgentRunStore implements ChildAgentRunStore {
  readonly runs = new Map<string, ChildAgentRun>();

  async create(run: ChildAgentRun): Promise<ChildAgentRun> {
    this.runs.set(run.id, run);
    return run;
  }

  async get(id: string): Promise<ChildAgentRun | null> {
    return this.runs.get(id) ?? null;
  }

  async listByParentRun(parentRunId: string): Promise<ChildAgentRun[]> {
    return [...this.runs.values()].filter((r) => r.parentRunId === parentRunId);
  }

  async updateStatus(id: string, status: ChildAgentRunStatus): Promise<ChildAgentRun> {
    const existing = this.runs.get(id);
    if (!existing) throw new Error(`child-agent-run: unknown run ${id}`);
    const updated: ChildAgentRun = { ...existing, status };
    this.runs.set(id, updated);
    return updated;
  }
}

/**
 * Shared append-only audit for ANY child Run lifecycle transition (cancel,
 * complete, fail, stop — every `ChildAgentRunStatus` past "running"). TASK-007
 * closure requires the FULL lifecycle, not only the actions a child Run later
 * emits, to be independently auditable: this appends a ledger row carrying
 * `parentRunId`, the actor recording the transition, and the run's inherited
 * authority/budget/taint/depth ceilings AS THEY STOOD at the transition
 * (`proposedOutput`) — never something a reader has to reconstruct by
 * inference from other rows.
 */
async function recordChildAgentRunTransition(
  deps: { store: ChildAgentRunStore; ledger: LedgerStore },
  id: string,
  status: ChildAgentRunStatus,
  event: string,
  actor: Actor,
  ctx: RunCtx,
): Promise<ChildAgentRun> {
  const before = await deps.store.get(id);
  if (!before) throw new Error(`child-agent-run: unknown run ${id}`);
  const updated = await deps.store.updateStatus(id, status);
  await deps.ledger.append({
    id: ctx.ids.next(),
    workspaceId: updated.workspaceId,
    actorType: actor.type,
    actorId: actor.id,
    action: "archive",
    resourceType: "agent",
    resourceId: updated.parentAgentId,
    inputs: { childRunId: id, event },
    proposedOutput: updated,
    userDecision: "auto",
    policyResults: [],
    context: { type: "child_agent_run", id, runId: updated.parentRunId },
    ...(updated.taint ? { trustOrigin: updated.taint } : {}),
    createdAt: ctx.clock.nowISO(),
  });
  return updated;
}

/**
 * Governance (or a Human) may inspect or stop any child Run within policy
 * (AGS2 accountability). See `recordChildAgentRunTransition`'s doc comment —
 * this only prevents the run from being used for further actions
 * (`validateActionWithinChildRun` checks `status === "running"`); the child
 * Run's own already-proposed/committed pipeline actions are unaffected
 * (append-only ledger).
 */
export function cancelChildAgentRun(
  deps: { store: ChildAgentRunStore; ledger: LedgerStore },
  id: string,
  actor: Actor,
  ctx: RunCtx,
): Promise<ChildAgentRun> {
  return recordChildAgentRunTransition(deps, id, "cancelled", "cancel", actor, ctx);
}

/** A child Run's parent Agent (or an executor acting on its behalf) records
 * the run as completed once its bounded work is done — same auditable-
 * transition guarantee as `cancelChildAgentRun`. */
export function completeChildAgentRun(
  deps: { store: ChildAgentRunStore; ledger: LedgerStore },
  id: string,
  actor: Actor,
  ctx: RunCtx,
): Promise<ChildAgentRun> {
  return recordChildAgentRunTransition(deps, id, "completed", "complete", actor, ctx);
}

/** A child Run's parent Agent (or an executor) records the run as failed
 * (e.g. every step exhausted its budget/authority) — same auditable-
 * transition guarantee as `cancelChildAgentRun`. */
export function failChildAgentRun(
  deps: { store: ChildAgentRunStore; ledger: LedgerStore },
  id: string,
  actor: Actor,
  ctx: RunCtx,
): Promise<ChildAgentRun> {
  return recordChildAgentRunTransition(deps, id, "failed", "fail", actor, ctx);
}

/** One proposed action's shape, as far as this validator needs it — a subset
 * of `ActionRequest` (types.ts) so this module stays decoupled from the
 * pipeline import graph. */
export interface ChildRunActionCheck {
  action: string;
  resourceType: string;
  skill?: string;
  dataScope?: DataScope;
}

export type ChildRunViolationReason =
  | "run-not-active"
  | "outside-child-authority"
  | "outside-child-skills"
  | "exceeds-child-data-scope"
  | "budget-exhausted";

export interface ChildRunViolation {
  reason: ChildRunViolationReason;
  detail: string;
}

function scopeCoversActionToken(scope: readonly string[], action: string, resourceType: string): boolean {
  const set = new Set(scope);
  if (set.has("*") || set.has(`${resourceType}:${action}`)) return true;
  if (set.has(`${resourceType}:*`) || set.has(`*:${action}`)) return true;
  return false;
}

/**
 * Local, pre-pipeline check — mirrors `agent-scope.ts`'s `validateRitualWithinAgents`
 * shape (a ritual step ⊆ agent check performed BEFORE the step ever reaches the
 * pipeline). A caller orchestrating a child Run's steps (a future
 * `ChildRunExecutor`, mirroring `InProcessRitualExecutor`) calls this before each
 * `pipeline.propose` — an out-of-bounds step never reaches the pipeline/ledger at
 * all, matching how out-of-scope ritual steps are rejected locally today. Returns
 * `null` when the action is within bounds, else the specific violation.
 */
export function validateActionWithinChildRun(
  check: ChildRunActionCheck,
  run: ChildAgentRun,
  callsUsedSoFar: number,
): ChildRunViolation | null {
  if (run.status !== "running") {
    return { reason: "run-not-active", detail: `child run ${run.id} is "${run.status}", not "running"` };
  }
  if (!scopeCoversActionToken(run.authorityScope, check.action, check.resourceType)) {
    return {
      reason: "outside-child-authority",
      detail: `child run ${run.id} authority [${run.authorityScope.join(", ")}] does not cover ${check.resourceType}:${check.action}`,
    };
  }
  if (check.skill && run.eligibleSkills.length > 0 && !run.eligibleSkills.includes(check.skill)) {
    return {
      reason: "outside-child-skills",
      detail: `child run ${run.id} eligible skills [${run.eligibleSkills.join(", ")}] do not include "${check.skill}"`,
    };
  }
  if (check.dataScope && intersectRunDataScope(check.dataScope, run.dataScope) === "none") {
    return {
      reason: "exceeds-child-data-scope",
      detail: `requested data scope "${check.dataScope}" does not intersect child run's "${run.dataScope}"`,
    };
  }
  if (callsUsedSoFar >= run.budget.maxCalls) {
    return {
      reason: "budget-exhausted",
      detail: `child run ${run.id} call budget exhausted (${callsUsedSoFar}/${run.budget.maxCalls})`,
    };
  }
  return null;
}

/**
 * Orchestrates derive + persist + audit in one call — the entry point
 * apps/api's router uses. Audits the CREATE as an append-only ledger row
 * (actor = the parent Agent's own identity, never a second minted identity;
 * `context: { type: "child_agent_run", id: childRun.id, runId: parent.runId }`
 * is what makes it attributable) WITHOUT routing through
 * `pipeline.propose`/`decide` — spawning a bounded child Run is the parent
 * Agent's own delegation of work it is already authorized for (every
 * consequential action the child Run goes on to take is still individually
 * proposed through the governed pipeline and still hits the existing
 * agent-always-drafts/human-always-approves floor there); gating the SPAWN
 * itself behind a human approval on every call would defeat AGS2's stated
 * purpose ("parallelize or specialize work") without adding a safety
 * guarantee the per-action pipeline gate doesn't already provide.
 */
export async function createChildAgentRun(
  deps: { store: ChildAgentRunStore; ledger: LedgerStore },
  parent: ParentRunEnvelope,
  req: ChildAgentRunRequest,
  ctx: RunCtx,
): Promise<ChildAgentRun> {
  const run = deriveChildAgentRun(parent, req, ctx.ids, ctx.clock);
  const persisted = await deps.store.create(run);

  const auditEntry: LedgerEntry = {
    id: ctx.ids.next(),
    workspaceId: parent.workspaceId,
    actorType: "agent",
    actorId: parent.agentId,
    ...(parent.onBehalfOf ? { onBehalfOfType: parent.onBehalfOf.type, onBehalfOfId: parent.onBehalfOf.id } : {}),
    action: "execute",
    resourceType: "agent",
    resourceId: parent.agentId,
    inputs: {
      childRunId: persisted.id,
      goalId: req.goalId,
      taskId: req.taskId,
      delegatedScope: req.delegatedScope,
      selectedSkills: req.selectedSkills,
      budget: req.budget,
      deadline: req.deadline,
      stopCondition: req.stopCondition,
    },
    proposedOutput: persisted,
    userDecision: "auto",
    policyResults: [],
    context: { type: "child_agent_run", id: persisted.id, runId: parent.runId },
    ...(run.taint ? { trustOrigin: run.taint } : {}),
    createdAt: ctx.clock.nowISO(),
  };
  await deps.ledger.append(auditEntry);

  return persisted;
}
