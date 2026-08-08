/**
 * What an approved planning proposal does to the queue.
 *
 * ADR-198 recorded the gap plainly: approval materialized nothing — a reviewer
 * could approve a decomposition and no child Tasks appeared. These assertions
 * cover the third step of draft-then-approve, and especially its limits:
 *  - generated Tasks land as `candidate`, never as live work;
 *  - dot-paths are RECOMPUTED against the current queue, never taken from the
 *    payload, so a queue that moved between draft and approval cannot end up
 *    with two Tasks at one address;
 *  - an approved pre-mortem writes nothing, on purpose;
 *  - a proposal whose subject Task is gone fails loudly instead of creating
 *    orphan roots.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { applyApprovedPlanningProposal, type TaskRecord } from "../src/index.js";

const NOW = "2026-08-09T00:00:00.000Z";

function task(id: string, overrides: Partial<TaskRecord> = {}): TaskRecord {
  return {
    id,
    organizationId: "org-1",
    path: id,
    level: 0,
    sortOrder: Number(id) || 1,
    title: `Task ${id}`,
    taskType: "task",
    isGoal: false,
    outcomes: [],
    anchor: false,
    status: "pending",
    priority: "P2",
    ownerType: "human",
    ownerId: "human-1",
    evidenceRefs: [],
    visibility: "organization",
    version: 1,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

function ids(): () => string {
  let n = 0;
  return () => `gen-${++n}`;
}

const base = { organizationId: "org-1", ownerId: "human-approver", now: NOW };

test("an approved decomposition creates child Tasks as candidates, not live work", () => {
  const parent = task("1", { path: "1", priority: "P0" });
  const result = applyApprovedPlanningProposal({
    ...base,
    tasks: [parent],
    taskId: "1",
    nextId: ids(),
    payload: {
      kind: "task_decomposition",
      children: [
        { title: "Draft the schema", exitTest: "Migration applies on a clean database" },
        { title: "Wire the endpoint", exitTest: "A request returns a stored row" },
      ],
    },
  });

  assert.equal(result.createdTaskIds.length, 2);
  const children = result.tasks.filter((t) => t.parentTaskId === "1");
  assert.deepEqual(children.map((c) => c.path), ["1.1", "1.2"]);
  assert.deepEqual(children.map((c) => c.level), [1, 1]);
  // Approved means "worth having in the tree", not "start these".
  assert.ok(children.every((c) => c.status === "candidate"));
  // The APPROVER owns them, never the Agent that drafted them.
  assert.ok(children.every((c) => c.ownerId === "human-approver" && c.ownerType === "human"));
  assert.ok(children.every((c) => c.isGoal === false));
  assert.equal(children[0]?.exitTest, "Migration applies on a clean database");
  // Priority is inherited from the parent rather than invented.
  assert.ok(children.every((c) => c.priority === "P0"));
});

test("paths are recomputed against the current queue, not taken from the payload", () => {
  // The Skill drafted 1.1 and 1.2, but by approval another Task already holds
  // 1.1. Trusting the drafted path would put two Tasks at one address.
  const parent = task("1", { path: "1" });
  const existing = task("2", { path: "1.1", level: 1, sortOrder: 1, parentTaskId: "1" });
  const result = applyApprovedPlanningProposal({
    ...base,
    tasks: [parent, existing],
    taskId: "1",
    nextId: ids(),
    payload: {
      kind: "task_decomposition",
      children: [
        { title: "Stale draft path", exitTest: "x", path: "1.1", level: 1 },
        { title: "Also stale", exitTest: "y", path: "1.2", level: 1 },
      ],
    },
  });
  const created = result.tasks.filter((t) => result.createdTaskIds.includes(t.id));
  assert.deepEqual(created.map((c) => c.path), ["1.2", "1.3"]);
  // The pre-existing Task keeps its address untouched.
  assert.equal(result.tasks.find((t) => t.id === "2")?.path, "1.1");
});

test("an approved goal framing appends outcomes and never promotes one to north star", () => {
  const goal = task("1", { isGoal: true });
  const result = applyApprovedPlanningProposal({
    ...base,
    tasks: [goal],
    taskId: "1",
    nextId: ids(),
    payload: {
      kind: "goal_outcome_framing",
      outcomes: [
        { title: "Active pilots", measure: "count", target: "5", indicatorKind: "lagging", northStar: true },
        { title: "Weekly sessions", measure: "count", target: "20", indicatorKind: "leading", northStar: false },
        // Dropped: unmeasurable is exactly what this Playbook prevents.
        { title: "Feels better", measure: "", target: "" },
      ],
    },
  });
  const updated = result.tasks.find((t) => t.id === "1")!;
  assert.equal(updated.outcomes.length, 2);
  assert.equal(updated.outcomes[0]?.indicatorKind, "lagging");
  // Promoting an outcome to the north star is a separate deliberate edit — an
  // approved draft cannot do it on the way in.
  assert.ok(updated.outcomes.every((o) => o.northStar !== true));
  assert.ok(updated.version > goal.version);
  assert.deepEqual(result.createdTaskIds, []);
  assert.deepEqual(result.updatedTaskIds, ["1"]);
});

test("an approved exit test is written to the subject Task", () => {
  const subject = task("1", { exitTest: "vague" });
  const result = applyApprovedPlanningProposal({
    ...base,
    tasks: [subject],
    taskId: "1",
    nextId: ids(),
    payload: {
      kind: "exit_test_authoring",
      candidates: [
        { exitTest: "Ask five pilot users to finish unaided; two or more stall", evidence: "session recordings" },
        { exitTest: "A slower alternative", evidence: "survey" },
      ],
    },
  });
  const updated = result.tasks.find((t) => t.id === "1")!;
  // The first entry is the approved choice — the Skill orders them
  // cheapest-first and a reviewer reorders before approving.
  assert.equal(updated.exitTest, "Ask five pilot users to finish unaided; two or more stall");
  assert.equal(updated.version, 2);
});

test("an approved scan puts each candidate under the Task the finding came from", () => {
  const a = task("1", { path: "1" });
  const b = task("2", { path: "2" });
  const result = applyApprovedPlanningProposal({
    ...base,
    tasks: [a, b],
    taskId: "1",
    nextId: ids(),
    payload: {
      kind: "opportunity_scan",
      opportunities: [
        { kind: "goal_without_children", taskId: "2", proposedTitle: "Break down Task 2" },
        // Dropped: its whole justification was a row that no longer exists.
        { kind: "goal_without_children", taskId: "missing", proposedTitle: "Orphan" },
      ],
    },
  });
  assert.equal(result.createdTaskIds.length, 1);
  const created = result.tasks.find((t) => t.id === result.createdTaskIds[0])!;
  assert.equal(created.parentTaskId, "2", "the candidate lands under its own source, not the subject");
  assert.equal(created.path, "2.1");
  assert.equal(created.status, "candidate");
});

test("an approved pre-mortem writes nothing, and says so", () => {
  const subject = task("1");
  const result = applyApprovedPlanningProposal({
    ...base,
    tasks: [subject],
    taskId: "1",
    nextId: ids(),
    payload: {
      kind: "premortem_scenario",
      failureModes: [{ cause: "Scope grew", earlySignal: "Third must-have", mitigation: "Freeze Friday" }],
    },
  });
  assert.deepEqual(result.createdTaskIds, []);
  assert.deepEqual(result.updatedTaskIds, []);
  assert.deepEqual(result.tasks, [subject]);
  assert.match(result.note, /Nothing was written to the queue/);
});

test("a proposal whose subject Task is gone fails loudly instead of creating orphans", () => {
  assert.throws(
    () => applyApprovedPlanningProposal({
      ...base,
      tasks: [task("1")],
      taskId: "vanished",
      nextId: ids(),
      payload: { kind: "task_decomposition", children: [{ title: "x", exitTest: "y" }] },
    }),
    /unknown Task vanished/,
  );
});

test("an unknown payload kind is refused rather than silently doing nothing", () => {
  assert.throws(
    () => applyApprovedPlanningProposal({
      ...base,
      tasks: [task("1")],
      taskId: "1",
      nextId: ids(),
      payload: { kind: "something_new" },
    }),
    /unknown kind/,
  );
});

test("an edited payload is re-validated: caps hold and unusable entries are dropped", () => {
  const parent = task("1", { path: "1" });
  const result = applyApprovedPlanningProposal({
    ...base,
    tasks: [parent],
    taskId: "1",
    nextId: ids(),
    payload: {
      kind: "task_decomposition",
      // A human edited this before approving, so it is text, not validated
      // Skill output: 12 entries with two unusable ones.
      children: [
        ...Array.from({ length: 12 }, (_, i) => ({ title: `Child ${i}`, exitTest: "x" })),
        { title: "", exitTest: "x" },
        { notATask: true },
      ],
    },
  });
  assert.equal(result.createdTaskIds.length, 9, "the drafting cap is re-applied to edited payloads");
});
