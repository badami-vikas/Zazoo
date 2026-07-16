import { test } from "node:test";
import assert from "node:assert/strict";

import {
  FixedClock,
  UuidGen,
  SeededRng,
  InMemoryLedger,
  deriveChildAgentRun,
  createChildAgentRun,
  cancelChildAgentRun,
  completeChildAgentRun,
  failChildAgentRun,
  validateActionWithinChildRun,
  stricterReviewMode,
  stricterTaint,
  MAX_CHILD_RUN_DEPTH,
  ChildRunDepthExceededError,
  ChildRunAuthorityExceededError,
  InMemoryChildAgentRunStore,
  type Actor,
  type ParentRunEnvelope,
  type ChildAgentRunRequest,
} from "../src/index.js";

function ctx(seed = 1) {
  const clock = new FixedClock("2026-07-16T00:00:00.000Z");
  const rng = new SeededRng(seed);
  const ids = new UuidGen(clock, rng);
  return { clock, rng, ids };
}

function parent(overrides: Partial<ParentRunEnvelope> = {}): ParentRunEnvelope {
  return {
    runId: "run-parent-1",
    agentId: "internal_strategist",
    workspaceId: "ws-1",
    authorityScope: ["signal:write", "person:read"],
    eligibleSkills: ["stageStrategicRecommendation"],
    dataScope: "all",
    plane: "local",
    budgetRemaining: { calls: 10, cost: 10 },
    reviewMode: "approve",
    delegationDepth: 0,
    ...overrides,
  };
}

function childReq(overrides: Partial<ChildAgentRunRequest> = {}): ChildAgentRunRequest {
  return {
    goalId: "g1",
    taskId: "t1",
    delegatedScope: ["signal:write", "person:read", "ledger:write"], // ledger:write is NOT in parent scope
    selectedSkills: ["stageStrategicRecommendation", "notEligibleSkill"],
    budget: { maxCalls: 5, maxCost: 5 },
    deadline: "2026-07-17T00:00:00.000Z",
    stopCondition: "goal complete or deadline reached",
    ...overrides,
  };
}

test("deriveChildAgentRun: authority/skills narrow to the intersection with the parent, never exceed it", () => {
  const c = ctx();
  const run = deriveChildAgentRun(parent(), childReq(), c.ids, c.clock);
  assert.deepEqual(run.authorityScope, ["signal:write", "person:read"]);
  assert.deepEqual(run.droppedScope, ["ledger:write"]);
  assert.deepEqual(run.eligibleSkills, ["stageStrategicRecommendation"]);
  assert.equal(run.depth, 1);
  assert.equal(run.status, "running");
});

test("deriveChildAgentRun: budget narrows to min(requested, parent remaining)", () => {
  const c = ctx();
  const run = deriveChildAgentRun(
    parent({ budgetRemaining: { calls: 2, cost: 100 } }),
    childReq({ budget: { maxCalls: 5, maxCost: 3 } }),
    c.ids,
    c.clock,
  );
  assert.equal(run.budget.maxCalls, 2); // parent ceiling wins
  assert.equal(run.budget.maxCost, 3); // requested wins (below parent ceiling)
});

test("deriveChildAgentRun: review mode never drops below the parent's, and external risk forces at least 'approve'", () => {
  const c = ctx();
  const stricterRun = deriveChildAgentRun(
    parent({ reviewMode: "quorum" }),
    childReq({ requestedReviewMode: "auto" }),
    c.ids,
    c.clock,
  );
  assert.equal(stricterRun.reviewMode, "quorum"); // parent's stricter mode wins

  const externalRun = deriveChildAgentRun(
    parent({ reviewMode: "auto" }),
    childReq({ touchesExternalRisk: true }),
    c.ids,
    c.clock,
  );
  assert.equal(externalRun.reviewMode, "approve");
});

test("deriveChildAgentRun: taint is monotonic — never cleaner than the parent's", () => {
  const c = ctx();
  const run = deriveChildAgentRun(
    parent({ taint: "untrusted_external" }),
    childReq({ requestedTaint: "operator" }),
    c.ids,
    c.clock,
  );
  assert.equal(run.taint, "untrusted_external");
});

test("deriveChildAgentRun: throws ChildRunDepthExceededError at the depth cap", () => {
  const c = ctx();
  assert.throws(
    () => deriveChildAgentRun(parent({ delegationDepth: MAX_CHILD_RUN_DEPTH }), childReq(), c.ids, c.clock),
    ChildRunDepthExceededError,
  );
});

test("deriveChildAgentRun: throws ChildRunAuthorityExceededError when data scope does not intersect", () => {
  const c = ctx();
  assert.throws(
    () =>
      deriveChildAgentRun(
        parent({ dataScope: "public" }),
        childReq({ requestedDataScope: "private" }),
        c.ids,
        c.clock,
      ),
    ChildRunAuthorityExceededError,
  );
});

test("deriveChildAgentRun: throws ChildRunAuthorityExceededError when no budget remains", () => {
  const c = ctx();
  assert.throws(
    () => deriveChildAgentRun(parent({ budgetRemaining: { calls: 0, cost: 5 } }), childReq(), c.ids, c.clock),
    ChildRunAuthorityExceededError,
  );
});

test("stricterReviewMode/stricterTaint: pure ordering helpers", () => {
  assert.equal(stricterReviewMode("auto", "quorum"), "quorum");
  assert.equal(stricterReviewMode("approve", "notify"), "approve");
  assert.equal(stricterTaint(undefined, "user_content"), "user_content");
  assert.equal(stricterTaint("untrusted_external", undefined), "untrusted_external");
  assert.equal(stricterTaint("operator", "user_content"), "user_content");
});

test("createChildAgentRun: persists the run AND appends an attributable, audited ledger row", async () => {
  const c = ctx();
  const store = new InMemoryChildAgentRunStore();
  const ledger = new InMemoryLedger();
  const run = await createChildAgentRun({ store, ledger }, parent(), childReq(), c);

  const stored = await store.get(run.id);
  assert.deepEqual(stored, run);

  assert.equal(ledger.entries.length, 1);
  const entry = ledger.entries[0]!;
  assert.equal(entry.actorType, "agent");
  assert.equal(entry.actorId, "internal_strategist"); // parent's OWN identity, not a new one
  assert.equal(entry.userDecision, "auto");
  assert.deepEqual(entry.context, { type: "child_agent_run", id: run.id, runId: "run-parent-1" });
});

test("cancelChildAgentRun: Governance/Human can stop a running child Run", async () => {
  const c = ctx();
  const store = new InMemoryChildAgentRunStore();
  const ledger = new InMemoryLedger();
  const run = await store.create(deriveChildAgentRun(parent(), childReq(), c.ids, c.clock));
  const cancelled = await cancelChildAgentRun({ store, ledger }, run.id, { type: "user", id: "governance-human-1" }, c);
  assert.equal(cancelled.status, "cancelled");
});

test("cancelChildAgentRun: appends its OWN append-only ledger row carrying parentRunId, the acting actor, and the run's inherited ceilings", async () => {
  const c = ctx();
  const store = new InMemoryChildAgentRunStore();
  const ledger = new InMemoryLedger();
  const run = await store.create(deriveChildAgentRun(parent(), childReq(), c.ids, c.clock));
  await cancelChildAgentRun({ store, ledger }, run.id, { type: "user", id: "governance-human-1" }, c);

  assert.equal(ledger.entries.length, 1);
  const entry = ledger.entries[0]!;
  assert.equal(entry.actorType, "user");
  assert.equal(entry.actorId, "governance-human-1");
  assert.equal(entry.action, "archive");
  assert.deepEqual(entry.context, { type: "child_agent_run", id: run.id, runId: "run-parent-1" });
  const snapshot = entry.proposedOutput as typeof run;
  assert.equal(snapshot.status, "cancelled");
  assert.deepEqual(snapshot.authorityScope, run.authorityScope);
  assert.deepEqual(snapshot.budget, run.budget);
  assert.equal(snapshot.depth, run.depth);
});

test("cancelChildAgentRun: throws on an unknown child run id rather than silently no-oping", async () => {
  const c = ctx();
  const store = new InMemoryChildAgentRunStore();
  const ledger = new InMemoryLedger();
  await assert.rejects(
    () => cancelChildAgentRun({ store, ledger }, "no-such-run", { type: "user", id: "governance-human-1" }, c),
    /unknown run/,
  );
});

test("completeChildAgentRun/failChildAgentRun: every lifecycle transition is its own auditable ledger row, not only actions emitted later", async () => {
  const c = ctx();
  const store = new InMemoryChildAgentRunStore();
  const ledger = new InMemoryLedger();
  const parentAgent: Actor = { type: "agent", id: "internal_strategist" };

  const run1 = await store.create(deriveChildAgentRun(parent(), childReq(), c.ids, c.clock));
  const completed = await completeChildAgentRun({ store, ledger }, run1.id, parentAgent, c);
  assert.equal(completed.status, "completed");

  const run2 = await store.create(deriveChildAgentRun(parent(), childReq(), c.ids, c.clock));
  const failed = await failChildAgentRun({ store, ledger }, run2.id, parentAgent, c);
  assert.equal(failed.status, "failed");

  assert.equal(ledger.entries.length, 2);
  assert.equal((ledger.entries[0]!.inputs as { event: string }).event, "complete");
  assert.equal((ledger.entries[1]!.inputs as { event: string }).event, "fail");
  // Both rows are independently attributable and auditable — not derived from
  // any later action the child Run might or might not go on to take.
  for (const entry of ledger.entries) {
    assert.equal(entry.actorType, "agent");
    assert.equal(entry.actorId, "internal_strategist");
    assert.equal(entry.userDecision, "auto");
  }
});

test("validateActionWithinChildRun: rejects an action outside the child's narrowed authority", () => {
  const c = ctx();
  const run = deriveChildAgentRun(parent(), childReq(), c.ids, c.clock);
  const violation = validateActionWithinChildRun({ action: "write", resourceType: "ledger" }, run, 0);
  assert.equal(violation?.reason, "outside-child-authority");
});

test("validateActionWithinChildRun: rejects a skill outside the child's eligible set", () => {
  const c = ctx();
  const run = deriveChildAgentRun(parent(), childReq(), c.ids, c.clock);
  const violation = validateActionWithinChildRun(
    { action: "write", resourceType: "signal", skill: "someUnlistedSkill" },
    run,
    0,
  );
  assert.equal(violation?.reason, "outside-child-skills");
});

test("validateActionWithinChildRun: rejects once the child's call budget is exhausted", () => {
  const c = ctx();
  const run = deriveChildAgentRun(parent(), childReq({ budget: { maxCalls: 1, maxCost: 1 } }), c.ids, c.clock);
  assert.equal(validateActionWithinChildRun({ action: "write", resourceType: "signal" }, run, 0), null);
  const violation = validateActionWithinChildRun({ action: "write", resourceType: "signal" }, run, 1);
  assert.equal(violation?.reason, "budget-exhausted");
});

test("validateActionWithinChildRun: a cancelled run rejects every further action", () => {
  const c = ctx();
  const run = deriveChildAgentRun(parent(), childReq(), c.ids, c.clock);
  const violation = validateActionWithinChildRun(
    { action: "write", resourceType: "signal" },
    { ...run, status: "cancelled" },
    0,
  );
  assert.equal(violation?.reason, "run-not-active");
});

test("nested child Runs: depth increments and eventually hits the cap through real derivation chaining", () => {
  const c = ctx();
  let current = parent();
  for (let i = 0; i < MAX_CHILD_RUN_DEPTH; i++) {
    const run = deriveChildAgentRun(current, childReq(), c.ids, c.clock);
    assert.equal(run.depth, i + 1);
    current = {
      runId: run.id,
      agentId: current.agentId,
      workspaceId: current.workspaceId,
      authorityScope: run.authorityScope,
      eligibleSkills: run.eligibleSkills,
      dataScope: run.dataScope,
      plane: run.plane,
      budgetRemaining: { calls: run.budget.maxCalls, cost: run.budget.maxCost },
      reviewMode: run.reviewMode,
      ...(run.taint ? { taint: run.taint } : {}),
      delegationDepth: run.depth,
    };
  }
  assert.throws(() => deriveChildAgentRun(current, childReq(), c.ids, c.clock), ChildRunDepthExceededError);
});
