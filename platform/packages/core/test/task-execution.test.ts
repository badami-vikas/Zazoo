/**
 * The execution/review half of the Task Manager Skill catalog:
 * evidence-verification, progress-synthesis, habit-scaffolding, and
 * proactive-opportunity-scan. All four were registered Skill ids whose `run()`
 * echoed its inputs.
 *
 * The assertions that matter are the ones about NOT overstepping:
 *  - verification never signs itself off and never names a verifier;
 *  - habit scaffolding refuses an ordinary Task instead of inventing a rhythm;
 *  - the scan reports only findings traceable to a real row, and states that
 *    it read the queue rather than cross-Module Signals.
 */
import assert from "node:assert/strict";
import test from "node:test";
import {
  scaffoldHabits,
  scanForOpportunities,
  synthesizeProgress,
  verifyTaskEvidence,
  type TaskRecord,
} from "../src/index.js";

const NOW = "2026-08-08T00:00:00.000Z";

function task(id: string, overrides: Partial<TaskRecord> = {}): TaskRecord {
  return {
    id,
    organizationId: "org-1",
    path: id,
    level: 0,
    sortOrder: 1,
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

test("evidence verification blocks a done Task with no exit test and no evidence", () => {
  const report = verifyTaskEvidence({ task: task("1", { status: "done" }) });
  assert.equal(report.verdict, "blocked");
  assert.equal(report.blockers.length, 2, "both the missing test and the missing evidence are named");
  assert.equal(report.proposedVerification, undefined, "nothing signable is offered");
});

test("evidence verification proposes a signable record but never names the verifier", () => {
  const report = verifyTaskEvidence({
    task: task("1", { status: "done", exitTest: "A user completes the flow unaided", evidenceRefs: ["file:run-1"] }),
    additionalEvidenceRefs: ["file:run-1", " event:done "],
  });
  assert.equal(report.verdict, "verifiable");
  // De-duplicated and trimmed, the Task's own refs preserved.
  assert.deepEqual(report.evidenceRefs, ["event:done", "file:run-1"]);
  assert.equal(report.proposedVerification?.result, "passed");
  assert.equal(report.proposedVerification?.exitTest, "A user completes the flow unaided");
  // The only honest verifier is whoever accepts the proposal. A `verifiedBy`
  // here would let an Agent's name land on a verification record.
  assert.equal("verifiedBy" in (report.proposedVerification ?? {}), false);
});

test("an already-verified Task is reported as such rather than re-proposed", () => {
  const report = verifyTaskEvidence({
    task: task("1", {
      status: "done",
      exitTest: "checked",
      evidenceRefs: ["file:a"],
      verification: { verifiedAt: NOW, verifiedBy: "human-1", evidenceRefs: ["file:a"], result: "passed" },
    }),
  });
  assert.equal(report.verdict, "already_verified");
  assert.equal(report.proposedVerification, undefined);
});

test("a goal with no exit test is blocked with its own reason, not the ordinary one", () => {
  const report = verifyTaskEvidence({ task: task("1", { isGoal: true, evidenceRefs: ["file:a"] }) });
  assert.equal(report.verdict, "blocked");
  assert.match(report.blockers[0] ?? "", /goal with no exit test/);
});

test("progress synthesis separates what landed from what has gone quiet", () => {
  const brief = synthesizeProgress({
    tasks: [
      task("1", { status: "done", updatedAt: "2026-08-07T00:00:00.000Z" }),
      task("2", { status: "in_progress", updatedAt: "2026-08-07T12:00:00.000Z" }),
      task("3", { status: "blocked", updatedAt: "2026-08-06T12:00:00.000Z" }),
      // Open and untouched for the whole window — the queue's quiet failure.
      task("4", { status: "pending", updatedAt: "2026-06-01T00:00:00.000Z" }),
      // Closed before the window: neither landed nor stalled.
      task("5", { status: "done", updatedAt: "2026-05-01T00:00:00.000Z" }),
    ],
    since: "2026-08-06T00:00:00.000Z",
    until: NOW,
  });
  assert.deepEqual(brief.landed.map((entry) => entry.taskId), ["1"]);
  assert.deepEqual(brief.started.map((entry) => entry.taskId), ["2"]);
  assert.deepEqual(brief.blocked.map((entry) => entry.taskId), ["3"]);
  assert.deepEqual(brief.stalled.map((entry) => entry.taskId), ["4"]);
  assert.equal(brief.counts.open, 3);
  // The brief says what it is built from, so nobody reads Event-stream
  // accuracy into a row-based summary.
  assert.match(brief.basis, /not from the Event stream/);
});

test("progress synthesis rejects an inverted or unparseable window", () => {
  assert.throws(
    () => synthesizeProgress({ tasks: [], since: NOW, until: "2026-08-01T00:00:00.000Z" }),
    /window ends before it starts/,
  );
  assert.throws(() => synthesizeProgress({ tasks: [], since: "not-a-date", until: NOW }), /ISO-8601/);
});

test("habit scaffolding refuses an ordinary Task instead of inventing a rhythm", () => {
  const result = scaffoldHabits({ task: task("1") });
  assert.deepEqual(result.proposals, []);
  assert.match(result.note ?? "", /Not a goal/);
});

test("habit scaffolding derives cadence from indicator kind, and an explicit cadence wins", () => {
  const leading = scaffoldHabits({
    task: task("1", {
      isGoal: true,
      outcomes: [{ id: "a", title: "Signups", measure: "count", target: "50", indicatorKind: "leading" }],
    }),
  });
  assert.equal(leading.proposals[0]?.cadence, "weekly");

  const lagging = scaffoldHabits({
    task: task("2", {
      isGoal: true,
      outcomes: [{ id: "b", title: "Revenue", measure: "usd", target: "10000", indicatorKind: "lagging" }],
    }),
  });
  assert.equal(lagging.proposals[0]?.cadence, "monthly");

  const explicit = scaffoldHabits({
    task: task("3", {
      isGoal: true,
      reviewCadence: "quarterly",
      outcomes: [{ id: "c", title: "NPS", measure: "score", target: "40", indicatorKind: "leading" }],
    }),
  });
  assert.equal(explicit.proposals[0]?.cadence, "quarterly", "the goal's own cadence is not overridden");
});

test("habit scaffolding will not propose a review for a goal with nothing to check", () => {
  const result = scaffoldHabits({ task: task("1", { isGoal: true }) });
  assert.deepEqual(result.proposals, []);
  assert.match(result.note ?? "", /no outcomes/);
});

test("the opportunity scan reports only findings traceable to a real row", () => {
  const parent = task("1", { title: "Ship it", status: "in_progress", path: "1" });
  const scan = scanForOpportunities([
    parent,
    task("2", { path: "1.1", parentTaskId: "1", status: "done" }),
    task("3", { path: "1.2", parentTaskId: "1", status: "done" }),
    task("4", {
      path: "2",
      title: "Grow the pilot",
      isGoal: true,
      outcomes: [{ id: "a", title: "Pilots", measure: "count", target: "5", indicatorKind: "lagging" }],
    }),
    task("5", { path: "3", title: "Unstarted goal", isGoal: true }),
  ]);
  const kinds = scan.opportunities.map((entry) => `${entry.kind}:${entry.taskId}`);
  assert.ok(kinds.includes("parent_complete_but_open:1"), "a parent whose children all finished");
  assert.ok(kinds.includes("goal_without_children:4"), "a goal with outcomes but nowhere to start");
  assert.ok(kinds.includes("goal_without_outcomes:5"), "a goal with nothing to check against");
  // Every finding names the row it came from.
  for (const entry of scan.opportunities) {
    assert.ok(entry.taskId.length > 0 && entry.path.length > 0 && entry.reason.length > 0);
  }
  // The boundary is stated so a queue-only scan is never read as having
  // examined cross-Module Signals.
  assert.match(scan.scope, /Task queue only/);
});

test("the opportunity scan finds nothing in a healthy queue", () => {
  const scan = scanForOpportunities([
    task("1", { path: "1", status: "in_progress" }),
    task("2", { path: "2", status: "pending" }),
  ]);
  assert.deepEqual(scan.opportunities, []);
});
