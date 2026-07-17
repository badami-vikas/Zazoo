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
import type { ChildRunPolicy } from "./skill-manifest.js";

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

/**
 * Typed "this run is already terminal" race — TASK-011 remediation
 * (2026-07-18 coordinator final review, issue 4). Distinct from a generic
 * `Error` so callers that WANT to treat "already cancelled/completed/failed"
 * as a benign, expected race (e.g. two concurrent transition attempts on the
 * SAME child Run) can catch specifically this type and swallow ONLY it —
 * every other failure (unknown run id, ledger append failure, etc.) must
 * still surface/audit. Never swallow `Error` broadly at a
 * `recordChildAgentRunTransition` call site; check `instanceof` this class.
 */
export class ChildRunAlreadyTerminalError extends Error {
  constructor(
    public readonly runId: string,
    public readonly currentStatus: ChildAgentRunStatus,
  ) {
    super(`child-agent-run: run ${runId} is already "${currentStatus}"`);
    this.name = "ChildRunAlreadyTerminalError";
  }
}

export class ChildRunBudgetExceededError extends Error {
  constructor(public readonly reasonDetail: string) {
    super(`child-agent-run: ${reasonDetail}`);
    this.name = "ChildRunBudgetExceededError";
  }
}

/** The parent Run's current bounds — everything a child Run inherits FROM.
 * Built only by trusted server runtime from the parent Agent's actual
 * authority; apps/api deliberately exposes no public child-create route. */
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
  /** The parent Skill must explicitly opt in to child delegation. */
  childRunPolicy: ChildRunPolicy;
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

export type ChildAgentRunStatus = "running" | "completed" | "cancelled" | "failed";

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
  callsUsed: number;
  costUsed: number;
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
  if (
    !Number.isInteger(parent.budgetRemaining.calls) ||
    parent.budgetRemaining.calls < 0 ||
    !Number.isFinite(parent.budgetRemaining.cost) ||
    parent.budgetRemaining.cost < 0 ||
    !Number.isInteger(req.budget.maxCalls) ||
    req.budget.maxCalls <= 0 ||
    !Number.isFinite(req.budget.maxCost) ||
    req.budget.maxCost < 0
  ) {
    throw new ChildRunAuthorityExceededError("budgets must contain finite non-negative cost and positive integer calls");
  }
  const depth = parent.delegationDepth + 1;
  if (depth > MAX_CHILD_RUN_DEPTH) {
    throw new ChildRunDepthExceededError(depth);
  }
  if (parent.childRunPolicy !== "allowed") {
    throw new ChildRunAuthorityExceededError("the parent Skill forbids child Agent Runs");
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
  if (authorityScope.length === 0) {
    throw new ChildRunAuthorityExceededError("delegated authority has an empty intersection with the parent");
  }

  const eligibleSkills = req.selectedSkills.filter((s) => parent.eligibleSkills.includes(s));
  if (eligibleSkills.length === 0) {
    throw new ChildRunAuthorityExceededError("selected Skills have an empty intersection with the parent");
  }

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
  const createdAt = clock.nowISO();
  const deadlineMs = Date.parse(req.deadline);
  if (!Number.isFinite(deadlineMs) || deadlineMs <= Date.parse(createdAt)) {
    throw new ChildRunAuthorityExceededError("deadline must be a valid timestamp after child Run creation");
  }
  if (req.stopCondition.trim().length === 0) {
    throw new ChildRunAuthorityExceededError("stop condition must not be empty");
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
    callsUsed: 0,
    costUsed: 0,
    deadline: req.deadline,
    stopCondition: req.stopCondition,
    reviewMode,
    ...(taint ? { taint } : {}),
    status: "running",
    createdAt,
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
  get(workspaceId: string, id: string): Promise<ChildAgentRun | null>;
  listByParentRun(workspaceId: string, parentRunId: string): Promise<ChildAgentRun[]>;
  updateStatus(
    workspaceId: string,
    id: string,
    expectedStatus: ChildAgentRunStatus,
    status: ChildAgentRunStatus,
  ): Promise<ChildAgentRun>;
  consumeBudget(workspaceId: string, id: string, cost: number, nowISO: string): Promise<ChildAgentRun>;
}

export class InMemoryChildAgentRunStore implements ChildAgentRunStore {
  readonly runs = new Map<string, ChildAgentRun>();

  async create(run: ChildAgentRun): Promise<ChildAgentRun> {
    if (this.runs.has(run.id)) throw new Error(`child-agent-run: duplicate run ${run.id}`);
    this.runs.set(run.id, run);
    return run;
  }

  async get(workspaceId: string, id: string): Promise<ChildAgentRun | null> {
    const run = this.runs.get(id);
    return run?.workspaceId === workspaceId ? run : null;
  }

  async listByParentRun(workspaceId: string, parentRunId: string): Promise<ChildAgentRun[]> {
    return [...this.runs.values()].filter(
      (r) => r.workspaceId === workspaceId && r.parentRunId === parentRunId,
    );
  }

  async updateStatus(
    workspaceId: string,
    id: string,
    expectedStatus: ChildAgentRunStatus,
    status: ChildAgentRunStatus,
  ): Promise<ChildAgentRun> {
    const existing = this.runs.get(id);
    if (!existing || existing.workspaceId !== workspaceId) {
      throw new Error(`child-agent-run: unknown run ${id}`);
    }
    if (existing.status !== expectedStatus) {
      // TASK-011 remediation (2026-07-18 fresh review) — throw the TYPED
      // error here too (this IS the real atomic compare-and-set boundary;
      // `recordChildAgentRunTransition`'s own earlier `get()`-based check is
      // a fast-path optimization, not the actual race guard). Two genuinely
      // concurrent transitions on the SAME run both read "running" before
      // either writes; the LOSER's mismatch is detected HERE, not in the
      // caller's pre-check — so this is the branch that must throw
      // `ChildRunAlreadyTerminalError` for every `instanceof` check
      // throughout apps/api to actually swallow the expected race instead of
      // incorrectly rethrowing a generic Error.
      throw new ChildRunAlreadyTerminalError(id, existing.status);
    }
    const updated: ChildAgentRun = { ...existing, status };
    this.runs.set(id, updated);
    return updated;
  }

  async consumeBudget(workspaceId: string, id: string, cost: number, nowISO: string): Promise<ChildAgentRun> {
    // TASK-011 remediation (2026-07-17 security review) — this MUST read
    // synchronously (`this.runs.get`, never `await this.get(...)`). `await`ing
    // a distinct async call — even one with no internal `await` of its own —
    // still yields a microtask tick before the result is observed, opening a
    // check-then-act race: two concurrent `consumeBudget` calls for the SAME
    // run can both read the pre-write budget snapshot before either writes,
    // and both pass validation, double-spending a `maxCalls: 1` budget.
    // `updateStatus` above already reads synchronously for exactly this
    // reason; this function previously did not, and was the one place that
    // race was reachable (`reserveChildRunAction`'s atomicity claim depends
    // on this). An `async` function with no internal `await` runs its whole
    // body to completion before yielding to any other queued microtask, which
    // is what makes this synchronous read-check-write a genuine atomic
    // section in single-process JS.
    const existing = this.runs.get(id);
    if (!existing || existing.workspaceId !== workspaceId) throw new Error(`child-agent-run: unknown run ${id}`);
    if (
      existing.status !== "running" ||
      Date.parse(nowISO) >= Date.parse(existing.deadline) ||
      existing.callsUsed >= existing.budget.maxCalls ||
      !Number.isFinite(cost) ||
      cost < 0 ||
      existing.costUsed + cost > existing.budget.maxCost
    ) {
      throw new ChildRunBudgetExceededError(`run ${id} has no budget or time remaining`);
    }
    const updated = {
      ...existing,
      callsUsed: existing.callsUsed + 1,
      costUsed: existing.costUsed + cost,
    };
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
  workspaceId: string,
  id: string,
  status: ChildAgentRunStatus,
  event: string,
  actor: Actor,
  ctx: RunCtx,
): Promise<ChildAgentRun> {
  if (status === "running") {
    throw new Error("child-agent-run: a terminal transition cannot target running");
  }
  const before = await deps.store.get(workspaceId, id);
  if (!before) throw new Error(`child-agent-run: unknown run ${id}`);
  if (before.status !== "running") {
    throw new ChildRunAlreadyTerminalError(id, before.status);
  }
  // TASK-011 remediation (2026-07-19 coordinator distributed-defects
  // review, issue 4; hardened again 2026-07-19 coordinator RE-review) —
  // TWO-PHASE audit, not a single append that projects the target status
  // before it is confirmed. An independent re-review correctly found the
  // single-append design left a FALSE terminal-shaped audit row for a
  // losing racer: BOTH concurrent attempts appended `proposedOutput.status
  // = <their own target>` before the CAS ever ran, so a reader of the
  // ledger ALONE (without cross-referencing `store.get()`) could not tell
  // which attempt actually won — the loser's row looked identical to a
  // real confirmed completion.
  //
  // Phase 1 (BEFORE the CAS): append an ATTEMPT entry that records intent
  // ONLY — `proposedOutput.status` stays `before.status` ("running"), never
  // the target — plus `inputs.attemptedStatus` naming what is being
  // attempted. This preserves the original crash-safety guarantee (if the
  // process dies before the CAS ever runs, there is still a durable record
  // that an attempt was made) WITHOUT ever claiming an outcome that may not
  // have happened.
  const attemptId = ctx.ids.next();
  await deps.ledger.append({
    id: attemptId,
    workspaceId: before.workspaceId,
    actorType: actor.type,
    actorId: actor.id,
    action: "archive",
    resourceType: "agent",
    resourceId: before.parentAgentId,
    inputs: { childRunId: id, event: `${event}:attempt`, attemptedStatus: status },
    proposedOutput: { ...before }, // still "running" — an ATTEMPT, not a claimed outcome
    userDecision: "auto",
    policyResults: [],
    context: { type: "child_agent_run", id, runId: before.parentRunId },
    ...(before.taint ? { trustOrigin: before.taint } : {}),
    createdAt: ctx.clock.nowISO(),
  });
  // Phase 2: the actual, authoritative CAS, followed by an OUTCOME audit
  // entry that reflects what REALLY happened — `completed` (this attempt's
  // status projection, now CONFIRMED) on success, or a distinct
  // `transition_attempt_failed` entry (never claiming the target status)
  // when a concurrent transition already won. Exactly one child-Run
  // transition attempt across any number of concurrent racers ends up with
  // a "confirmed" outcome entry; every loser's outcome entry is explicitly
  // and unambiguously a failure record, never terminal-shaped.
  try {
    const updated = await deps.store.updateStatus(workspaceId, id, "running", status);
    await deps.ledger.append({
      id: ctx.ids.next(),
      workspaceId: before.workspaceId,
      actorType: actor.type,
      actorId: actor.id,
      action: "archive",
      resourceType: "agent",
      resourceId: before.parentAgentId,
      inputs: { childRunId: id, event, attemptRef: attemptId },
      proposedOutput: { ...updated },
      userDecision: "auto",
      policyResults: [],
      context: { type: "child_agent_run", id, runId: before.parentRunId },
      ...(before.taint ? { trustOrigin: before.taint } : {}),
      createdAt: ctx.clock.nowISO(),
    });
    return updated;
  } catch (e) {
    if (e instanceof ChildRunAlreadyTerminalError) {
      await deps.ledger.append({
        id: ctx.ids.next(),
        workspaceId: before.workspaceId,
        actorType: actor.type,
        actorId: actor.id,
        action: "archive",
        resourceType: "agent",
        resourceId: before.parentAgentId,
        inputs: { childRunId: id, event: "transition_attempt_failed", attemptedStatus: status, attemptRef: attemptId, lostToStatus: e.currentStatus },
        // Explicitly NEVER `status: status` here — this row must never be
        // mistaken for a confirmed terminal outcome. It reflects the run's
        // real current status (whatever the winner set), which this
        // attempt did NOT cause.
        proposedOutput: { ...before, status: e.currentStatus },
        userDecision: "auto",
        policyResults: [],
        context: { type: "child_agent_run", id, runId: before.parentRunId },
        ...(before.taint ? { trustOrigin: before.taint } : {}),
        createdAt: ctx.clock.nowISO(),
      });
    }
    throw e;
  }
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
  workspaceId: string,
  id: string,
  actor: Actor,
  ctx: RunCtx,
): Promise<ChildAgentRun> {
  return recordChildAgentRunTransition(deps, workspaceId, id, "cancelled", "cancel", actor, ctx);
}

/** A child Run's parent Agent (or an executor acting on its behalf) records
 * the run as completed once its bounded work is done — same auditable-
 * transition guarantee as `cancelChildAgentRun`. */
export function completeChildAgentRun(
  deps: { store: ChildAgentRunStore; ledger: LedgerStore },
  workspaceId: string,
  id: string,
  actor: Actor,
  ctx: RunCtx,
): Promise<ChildAgentRun> {
  return recordChildAgentRunTransition(deps, workspaceId, id, "completed", "complete", actor, ctx);
}

/** A child Run's parent Agent (or an executor) records the run as failed
 * (e.g. every step exhausted its budget/authority) — same auditable-
 * transition guarantee as `cancelChildAgentRun`. */
export function failChildAgentRun(
  deps: { store: ChildAgentRunStore; ledger: LedgerStore },
  workspaceId: string,
  id: string,
  actor: Actor,
  ctx: RunCtx,
): Promise<ChildAgentRun> {
  return recordChildAgentRunTransition(deps, workspaceId, id, "failed", "fail", actor, ctx);
}

/** One proposed action's shape, as far as this validator needs it — a subset
 * of `ActionRequest` (types.ts) so this module stays decoupled from the
 * pipeline import graph. */
export interface ChildRunActionCheck {
  action: string;
  resourceType: string;
  skill: string;
  dataScope: DataScope;
}

export type ChildRunViolationReason =
  | "run-not-active"
  | "outside-child-authority"
  | "outside-child-skills"
  | "exceeds-child-data-scope"
  | "deadline-exceeded"
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
 *
 * TASK-011 remediation (2026-07-19 coordinator distributed-defects
 * RE-review, issue 2) — `options.reusingExistingReservation` lets a caller
 * that already legitimately consumed this exact action's budget in an
 * EARLIER (possibly crashed) attempt skip the budget-exhaustion check when
 * re-validating a RECLAIMED attempt of the SAME logical action: budget was
 * deliberately and correctly consumed once already, and `callsUsed >=
 * maxCalls` is the EXPECTED, correct state at that point — it must not be
 * misread as "no budget left for this retry". Every OTHER check (run
 * active, authority/skill/data-scope, deadline) still applies unchanged;
 * this flag narrows ONLY the budget-exhaustion condition. Default (unset)
 * preserves the original, strict pre-reservation semantics for every
 * existing caller.
 */
export function validateActionWithinChildRun(
  check: ChildRunActionCheck,
  run: ChildAgentRun,
  nowISO: string,
  estimatedCost = 0,
  options?: { reusingExistingReservation?: boolean },
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
  if (!run.eligibleSkills.includes(check.skill)) {
    return {
      reason: "outside-child-skills",
      detail: `child run ${run.id} eligible skills [${run.eligibleSkills.join(", ")}] do not include "${check.skill}"`,
    };
  }
  if (run.dataScope !== "all" && check.dataScope !== run.dataScope) {
    return {
      reason: "exceeds-child-data-scope",
      detail: `requested data scope "${check.dataScope}" exceeds child run's "${run.dataScope}"`,
    };
  }
  if (Date.parse(nowISO) >= Date.parse(run.deadline)) {
    return {
      reason: "deadline-exceeded",
      detail: `child run ${run.id} deadline ${run.deadline} has passed`,
    };
  }
  if (
    !options?.reusingExistingReservation &&
    (estimatedCost < 0 ||
      run.callsUsed >= run.budget.maxCalls ||
      run.costUsed + estimatedCost > run.budget.maxCost)
  ) {
    return {
      reason: "budget-exhausted",
      detail: `child run ${run.id} budget exhausted (${run.callsUsed}/${run.budget.maxCalls} calls, ${run.costUsed}/${run.budget.maxCost} cost)`,
    };
  }
  return null;
}

/**
 * Validate immutable scope ceilings, then atomically consume one call/cost unit
 * in the backing store. Callers must reserve before invoking the pipeline.
 */
export async function reserveChildRunAction(
  store: ChildAgentRunStore,
  workspaceId: string,
  childRunId: string,
  check: ChildRunActionCheck,
  estimatedCost: number,
  nowISO: string,
): Promise<ChildRunViolation | null> {
  const run = await store.get(workspaceId, childRunId);
  if (!run) {
    return { reason: "run-not-active", detail: `child run ${childRunId} does not exist in this workspace` };
  }
  const violation = validateActionWithinChildRun(check, run, nowISO, estimatedCost);
  if (violation) return violation;
  try {
    await store.consumeBudget(workspaceId, childRunId, estimatedCost, nowISO);
    return null;
  } catch (error) {
    if (error instanceof ChildRunBudgetExceededError) {
      return { reason: "budget-exhausted", detail: error.message };
    }
    throw error;
  }
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
      childRunId: run.id,
      goalId: req.goalId,
      taskId: req.taskId,
      delegatedScope: req.delegatedScope,
      selectedSkills: req.selectedSkills,
      budget: req.budget,
      deadline: req.deadline,
      stopCondition: req.stopCondition,
    },
    proposedOutput: run,
    userDecision: "auto",
    policyResults: [],
    context: { type: "child_agent_run", id: run.id, runId: parent.runId },
    ...(run.taint ? { trustOrigin: run.taint } : {}),
    createdAt: ctx.clock.nowISO(),
  };
  await deps.ledger.append(auditEntry);
  return deps.store.create(run);
}
