/**
 * Research Run records (TASK-028) — the in-memory store's lifecycle guards:
 * owner scoping, newest-first listing, the raise-only stop flag,
 * complete-exactly-once, and append-only steps refused after terminal.
 */
import assert from "node:assert/strict";
import test from "node:test";
import {
  InMemoryResearchRunStore,
  ResearchRunAlreadyTerminalError,
  ResearchRunNotFoundError,
  type ResearchRunRecord,
  type ResearchStepRecord,
} from "../src/research-run.js";

const organizationId = "org-research";
const ownerUserId = "user-owner";

function makeRun(id: string, startedAt: string): ResearchRunRecord {
  return {
    id,
    organizationId,
    ownerUserId,
    objective: `objective ${id}`,
    status: "running",
    stopRequested: false,
    parentRunId: `parent-${id}`,
    goalId: "goal-1",
    taskId: "task-1",
    stopReason: null,
    brief: null,
    citations: [],
    blockedActions: [],
    injectionReports: [],
    stepsTaken: 0,
    startedAt,
    endedAt: null,
  };
}

function makeStep(runId: string, stepIndex: number): ResearchStepRecord {
  return {
    id: `step-${runId}-${stepIndex}`,
    runId,
    organizationId,
    ownerUserId,
    stepIndex,
    tool: "read",
    summary: `step ${stepIndex}`,
    sourceUrl: "https://example.com",
    childRunId: null,
    quarantinedText: null,
    quarantinedSourceUrl: null,
    createdAt: new Date().toISOString(),
  };
}

test("runs are owner-scoped and listed newest first", async () => {
  const store = new InMemoryResearchRunStore();
  await store.create(makeRun("run-a", "2026-07-30T10:00:00.000Z"));
  await store.create(makeRun("run-b", "2026-07-31T10:00:00.000Z"));

  const listed = await store.list(organizationId, ownerUserId, 10);
  assert.deepEqual(
    listed.map((run) => run.id),
    ["run-b", "run-a"],
  );
  assert.equal(await store.get(organizationId, "someone-else", "run-a"), null);
  assert.deepEqual(await store.list(organizationId, "someone-else", 10), []);
  assert.deepEqual(await store.listSteps(organizationId, "someone-else", "run-a"), []);
  await assert.rejects(
    store.requestStop(organizationId, "someone-else", "run-a"),
    ResearchRunNotFoundError,
  );
});

test("stop is raise-only and complete happens exactly once", async () => {
  const store = new InMemoryResearchRunStore();
  await store.create(makeRun("run-once", "2026-07-31T10:00:00.000Z"));

  const flagged = await store.requestStop(organizationId, ownerUserId, "run-once");
  assert.equal(flagged.stopRequested, true);

  const outcome = {
    status: "completed" as const,
    stopReason: "planner_finished" as const,
    brief: "the brief",
    citations: ["https://example.com"],
    blockedActions: [],
    injectionReports: [],
    stepsTaken: 2,
  };
  const done = await store.complete(
    organizationId,
    ownerUserId,
    "run-once",
    outcome,
    "2026-07-31T10:05:00.000Z",
  );
  assert.equal(done.status, "completed");
  assert.equal(done.endedAt, "2026-07-31T10:05:00.000Z");

  await assert.rejects(
    store.complete(
      organizationId,
      ownerUserId,
      "run-once",
      { ...outcome, brief: "rewritten" },
      "2026-07-31T10:06:00.000Z",
    ),
    ResearchRunAlreadyTerminalError,
  );
  await assert.rejects(
    store.appendStep(makeStep("run-once", 0)),
    ResearchRunAlreadyTerminalError,
  );
});

test("steps append in order and list sorted by stepIndex", async () => {
  const store = new InMemoryResearchRunStore();
  await store.create(makeRun("run-steps", "2026-07-31T10:00:00.000Z"));
  await store.appendStep(makeStep("run-steps", 1));
  await store.appendStep(makeStep("run-steps", 0));

  const steps = await store.listSteps(organizationId, ownerUserId, "run-steps");
  assert.deepEqual(
    steps.map((step) => step.stepIndex),
    [0, 1],
  );
});
