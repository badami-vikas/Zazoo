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
  reserveChildRunAction,
  validateActionWithinChildRun,
  stricterReviewMode,
  stricterTaint,
  MAX_CHILD_RUN_DEPTH,
  ChildRunDepthExceededError,
  ChildRunAuthorityExceededError,
  ChildRunAlreadyTerminalError,
  InMemoryChildAgentRunStore,
  type Actor,
  type ParentRunEnvelope,
  type ChildAgentRun,
  type ChildAgentRunRequest,
  type ChildRunActionCheck,
  type LedgerStore,
} from "../src/index.js";

function ctx(seed = 1) {
  const clock = new FixedClock("2026-07-16T00:00:00.000Z");
  const rng = new SeededRng(seed);
  const ids = new UuidGen(clock, rng);
  return { clock, rng, ids };
}

function parent(overrides: Partial<ParentRunEnvelope> = {}): ParentRunEnvelope {
  const base: ParentRunEnvelope = {
    runId: "run-parent-1",
    agentId: "internal_strategist",
    workspaceId: "ws-1",
    authorityScope: ["signal:write", "person:read"],
    eligibleSkills: ["stageStrategicRecommendation"],
    dataScope: "all",
    plane: "local",
    budgetRemaining: { calls: 10, cost: 10 },
    reviewMode: "approve",
    childRunPolicy: "allowed",
    delegationDepth: 0,
  };
  return Object.assign(base, overrides);
}

function childReq(overrides: Partial<ChildAgentRunRequest> = {}): ChildAgentRunRequest {
  const base: ChildAgentRunRequest = {
    goalId: "g1",
    taskId: "t1",
    delegatedScope: ["signal:write", "person:read", "ledger:write"], // ledger:write is NOT in parent scope
    selectedSkills: ["stageStrategicRecommendation", "notEligibleSkill"],
    budget: { maxCalls: 5, maxCost: 5 },
    deadline: "2026-07-17T00:00:00.000Z",
    stopCondition: "goal complete or deadline reached",
  };
  return Object.assign(base, overrides);
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

test("deriveChildAgentRun: rejects forbidden delegation and empty authority/Skill intersections", () => {
  const c = ctx();
  assert.throws(
    () => deriveChildAgentRun(parent({ childRunPolicy: "forbidden" }), childReq(), c.ids, c.clock),
    /forbids child Agent Runs/,
  );
  assert.throws(
    () => deriveChildAgentRun(parent(), childReq({ delegatedScope: ["ledger:write"] }), c.ids, c.clock),
    /empty intersection/,
  );
  assert.throws(
    () => deriveChildAgentRun(parent(), childReq({ selectedSkills: ["unknown"] }), c.ids, c.clock),
    /empty intersection/,
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

  const stored = await store.get("ws-1", run.id);
  assert.deepEqual(stored, run);

  assert.equal(ledger.entries.length, 1);
  const entry = ledger.entries[0]!;
  assert.equal(entry.actorType, "agent");
  assert.equal(entry.actorId, "internal_strategist"); // parent's OWN identity, not a new one
  assert.equal(entry.userDecision, "auto");
  assert.deepEqual(entry.context, { type: "child_agent_run", id: run.id, runId: "run-parent-1" });
});

test("createChildAgentRun: an audit failure cannot leave unaudited state", async () => {
  class FailingLedger extends InMemoryLedger {
    override async append(): Promise<never> {
      throw new Error("test_fixture audit unavailable");
    }
  }
  const c = ctx();
  const store = new InMemoryChildAgentRunStore();
  await assert.rejects(
    () => createChildAgentRun({ store, ledger: new FailingLedger() }, parent(), childReq(), c),
    /audit unavailable/,
  );
  assert.equal((await store.listByParentRun("ws-1", "run-parent-1")).length, 0);
});

test("cancelChildAgentRun: Governance/Human can stop a running child Run", async () => {
  const c = ctx();
  const store = new InMemoryChildAgentRunStore();
  const ledger = new InMemoryLedger();
  const run = await store.create(deriveChildAgentRun(parent(), childReq(), c.ids, c.clock));
  const cancelled = await cancelChildAgentRun({ store, ledger }, "ws-1", run.id, { type: "user", id: "governance-human-1" }, c);
  assert.equal(cancelled.status, "cancelled");
});

test("cancelChildAgentRun: appends its OWN append-only ledger row carrying parentRunId, the acting actor, and the run's inherited ceilings", async () => {
  const c = ctx();
  const store = new InMemoryChildAgentRunStore();
  const ledger = new InMemoryLedger();
  const run = await store.create(deriveChildAgentRun(parent(), childReq(), c.ids, c.clock));
  await cancelChildAgentRun({ store, ledger }, "ws-1", run.id, { type: "user", id: "governance-human-1" }, c);

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
    () => cancelChildAgentRun({ store, ledger }, "ws-1", "no-such-run", { type: "user", id: "governance-human-1" }, c),
    /unknown run/,
  );
});

test("terminal child Run transitions are running-only, and throw the TYPED ChildRunAlreadyTerminalError (TASK-011 remediation, 2026-07-18 final review, issue 4) — not a generic Error — so callers can swallow exactly this expected race and surface everything else", async () => {
  const c = ctx();
  const store = new InMemoryChildAgentRunStore();
  const ledger = new InMemoryLedger();
  const run = await store.create(deriveChildAgentRun(parent(), childReq(), c.ids, c.clock));
  await cancelChildAgentRun(
    { store, ledger },
    "ws-1",
    run.id,
    { type: "user", id: "governance-human-1" },
    c,
  );
  await assert.rejects(
    () =>
      completeChildAgentRun(
        { store, ledger },
        "ws-1",
        run.id,
        { type: "user", id: "governance-human-1" },
        c,
      ),
    (error: unknown) => {
      assert.ok(error instanceof ChildRunAlreadyTerminalError, "must throw the typed error, not a generic Error");
      assert.equal(error.runId, run.id);
      assert.equal(error.currentStatus, "cancelled");
      assert.match(error.message, /already "cancelled"/);
      return true;
    },
  );
  assert.equal(ledger.entries.length, 1);
});

test("concurrent terminal transitions: exactly one CAS wins, but BOTH attempts are durably audited (TASK-011 remediation, 2026-07-19 coordinator distributed-defects review, issue 4) — the audit entry is appended BEFORE the status CAS runs, so a losing attempt still leaves a truthful record of what was tried, and the winning entry's projected status matches the run's real final status", async () => {
  const c = ctx();
  const store = new InMemoryChildAgentRunStore();
  const ledger = new InMemoryLedger();
  const run = await store.create(deriveChildAgentRun(parent(), childReq(), c.ids, c.clock));
  const actor: Actor = { type: "agent", id: "internal_strategist" };

  const outcomes = await Promise.allSettled([
    completeChildAgentRun({ store, ledger }, "ws-1", run.id, actor, c),
    failChildAgentRun({ store, ledger }, "ws-1", run.id, actor, c),
  ]);

  assert.equal(outcomes.filter((outcome) => outcome.status === "fulfilled").length, 1);
  assert.equal(outcomes.filter((outcome) => outcome.status === "rejected").length, 1);
  // Both the winning AND the losing attempt are durably logged — the ledger
  // is a truthful record of every ATTEMPT, not only confirmed state changes.
  assert.equal(ledger.entries.length, 2);
  const finalStatus = (await store.get("ws-1", run.id))?.status;
  // Exactly one entry's projected status matches the run's real final
  // status (the winner); the other recorded an attempt that never took
  // effect (the loser) — never both, never neither.
  const matching = ledger.entries.filter((e) => (e.proposedOutput as ChildAgentRun).status === finalStatus);
  assert.equal(matching.length, 1);
});

test("child-run terminal transition: if the audit ledger append fails, the run's status is NEVER exposed as terminal — no caller can observe terminal then see it revert (TASK-011 remediation, 2026-07-19 coordinator distributed-defects review, issue 4)", async () => {
  const c = ctx();
  const store = new InMemoryChildAgentRunStore();
  const failingLedger: LedgerStore = {
    append: async () => {
      throw new Error("simulated durable-audit failure");
    },
    get: async () => null,
    decisionFor: async () => null,
    listPending: async () => ({ items: [], total: 0 }),
  };
  const run = await store.create(deriveChildAgentRun(parent(), childReq(), c.ids, c.clock));
  const actor: Actor = { type: "agent", id: "internal_strategist" };

  await assert.rejects(
    () => cancelChildAgentRun({ store, ledger: failingLedger }, "ws-1", run.id, actor, c),
    /simulated durable-audit failure/,
  );
  // The audit append happens BEFORE the status CAS — since it threw, the
  // CAS never ran at all, so the run's real status is untouched. There is
  // no "expose terminal, then roll back" window for any concurrent reader
  // to observe.
  const after = await store.get("ws-1", run.id);
  assert.equal(after?.status, "running", "a failed audit append must leave the run's status completely untouched, never terminal");
});

test("consumeBudget: concurrent reservations against a maxCalls:1 budget — only ONE may succeed (TASK-011 remediation, 2026-07-17 security review)", async () => {
  const c = ctx();
  const store = new InMemoryChildAgentRunStore();
  const run = await store.create(
    deriveChildAgentRun(parent(), childReq({ budget: { maxCalls: 1, maxCost: 1 } }), c.ids, c.clock),
  );

  const outcomes = await Promise.allSettled([
    store.consumeBudget("ws-1", run.id, 1, c.clock.nowISO()),
    store.consumeBudget("ws-1", run.id, 1, c.clock.nowISO()),
  ]);

  assert.equal(outcomes.filter((o) => o.status === "fulfilled").length, 1, "exactly one reservation should succeed");
  assert.equal(outcomes.filter((o) => o.status === "rejected").length, 1, "the other must be rejected as budget-exhausted");
  const final = await store.get("ws-1", run.id);
  assert.equal(final?.callsUsed, 1, "the budget must reflect exactly one consumed call, never double-spent");
});

test("consumeBudget: many concurrent reservations against a maxCalls:1 budget — never more than one wins, regardless of count", async () => {
  const c = ctx();
  const store = new InMemoryChildAgentRunStore();
  const run = await store.create(
    deriveChildAgentRun(parent(), childReq({ budget: { maxCalls: 1, maxCost: 1 } }), c.ids, c.clock),
  );

  const outcomes = await Promise.allSettled(
    Array.from({ length: 10 }, () => store.consumeBudget("ws-1", run.id, 1, c.clock.nowISO())),
  );

  assert.equal(outcomes.filter((o) => o.status === "fulfilled").length, 1);
  const final = await store.get("ws-1", run.id);
  assert.equal(final?.callsUsed, 1);
});

test("a lifecycle audit failure means the transition never happens at all (TASK-011 remediation, 2026-07-19 — audit-then-transition ordering means there is no 'rollback', since the status CAS never runs until after the audit durably succeeds)", async () => {
  class FailingLedger extends InMemoryLedger {
    override async append(): Promise<never> {
      throw new Error("test_fixture audit unavailable");
    }
  }
  const c = ctx();
  const store = new InMemoryChildAgentRunStore();
  const run = await store.create(deriveChildAgentRun(parent(), childReq(), c.ids, c.clock));

  await assert.rejects(
    () =>
      completeChildAgentRun(
        { store, ledger: new FailingLedger() },
        "ws-1",
        run.id,
        { type: "agent", id: "internal_strategist" },
        c,
      ),
    /audit unavailable/,
  );
  assert.equal((await store.get("ws-1", run.id))?.status, "running");
});

test("completeChildAgentRun/failChildAgentRun: every lifecycle transition is its own auditable ledger row, not only actions emitted later", async () => {
  const c = ctx();
  const store = new InMemoryChildAgentRunStore();
  const ledger = new InMemoryLedger();
  const parentAgent: Actor = { type: "agent", id: "internal_strategist" };

  const run1 = await store.create(deriveChildAgentRun(parent(), childReq(), c.ids, c.clock));
  const completed = await completeChildAgentRun({ store, ledger }, "ws-1", run1.id, parentAgent, c);
  assert.equal(completed.status, "completed");

  const run2 = await store.create(deriveChildAgentRun(parent(), childReq(), c.ids, c.clock));
  const failed = await failChildAgentRun({ store, ledger }, "ws-1", run2.id, parentAgent, c);
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
  const violation = validateActionWithinChildRun(
    { action: "write", resourceType: "ledger", skill: "stageStrategicRecommendation", dataScope: "all" },
    run,
    c.clock.nowISO(),
  );
  assert.equal(violation?.reason, "outside-child-authority");
});

test("validateActionWithinChildRun: rejects a skill outside the child's eligible set", () => {
  const c = ctx();
  const run = deriveChildAgentRun(parent(), childReq(), c.ids, c.clock);
  const violation = validateActionWithinChildRun(
    { action: "write", resourceType: "signal", skill: "someUnlistedSkill", dataScope: "all" },
    run,
    c.clock.nowISO(),
  );
  assert.equal(violation?.reason, "outside-child-skills");
});

test("validateActionWithinChildRun: rejects once the child's call budget is exhausted", () => {
  const c = ctx();
  const run = deriveChildAgentRun(parent(), childReq({ budget: { maxCalls: 1, maxCost: 1 } }), c.ids, c.clock);
  assert.equal(
    validateActionWithinChildRun(
      { action: "write", resourceType: "signal", skill: "stageStrategicRecommendation", dataScope: "all" },
      run,
      c.clock.nowISO(),
    ),
    null,
  );
  const violation = validateActionWithinChildRun(
    { action: "write", resourceType: "signal", skill: "stageStrategicRecommendation", dataScope: "all" },
    { ...run, callsUsed: 1 },
    c.clock.nowISO(),
  );
  assert.equal(violation?.reason, "budget-exhausted");
});

test("validateActionWithinChildRun: a cancelled run rejects every further action", () => {
  const c = ctx();
  const run = deriveChildAgentRun(parent(), childReq(), c.ids, c.clock);
  const violation = validateActionWithinChildRun(
    { action: "write", resourceType: "signal", skill: "stageStrategicRecommendation", dataScope: "all" },
    { ...run, status: "cancelled" },
    c.clock.nowISO(),
  );
  assert.equal(violation?.reason, "run-not-active");
});

test("reserveChildRunAction: atomically consumes call/cost budget and fails closed at the ceiling", async () => {
  const c = ctx();
  const store = new InMemoryChildAgentRunStore();
  const run = await store.create(
    deriveChildAgentRun(
      parent(),
      childReq({ budget: { maxCalls: 1, maxCost: 0.5 } }),
      c.ids,
      c.clock,
    ),
  );
  const check: ChildRunActionCheck = {
    action: "write",
    resourceType: "signal",
    skill: "stageStrategicRecommendation",
    dataScope: "all",
  };
  assert.equal(
    await reserveChildRunAction(store, "ws-1", run.id, check, 0.5, c.clock.nowISO()),
    null,
  );
  const exhausted = await reserveChildRunAction(
    store,
    "ws-1",
    run.id,
    check,
    0,
    c.clock.nowISO(),
  );
  assert.equal(exhausted?.reason, "budget-exhausted");
});

test("validateActionWithinChildRun: enforces deadline and data-scope containment", () => {
  const c = ctx();
  const run = deriveChildAgentRun(
    parent({ dataScope: "public" }),
    childReq({ requestedDataScope: "public" }),
    c.ids,
    c.clock,
  );
  const tooBroad = validateActionWithinChildRun(
    {
      action: "write",
      resourceType: "signal",
      skill: "stageStrategicRecommendation",
      dataScope: "all",
    },
    run,
    c.clock.nowISO(),
  );
  assert.equal(tooBroad?.reason, "exceeds-child-data-scope");
  const expired = validateActionWithinChildRun(
    {
      action: "write",
      resourceType: "signal",
      skill: "stageStrategicRecommendation",
      dataScope: "public",
    },
    run,
    run.deadline,
  );
  assert.equal(expired?.reason, "deadline-exceeded");
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
      childRunPolicy: current.childRunPolicy,
      ...(run.taint ? { taint: run.taint } : {}),
      delegationDepth: run.depth,
    };
  }
  assert.throws(() => deriveChildAgentRun(current, childReq(), c.ids, c.clock), ChildRunDepthExceededError);
});
