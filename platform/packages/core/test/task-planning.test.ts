/**
 * TM3 planning intelligence (task-reconciliation, queue-sequencing,
 * impact-fit-analysis) — the Skills whose ids were registered but whose logic
 * was never bound, leaving `draftTaskCreate` to raise an impact_fit proposal
 * carrying only `requiresResequenceReview: true`.
 *
 * The load-bearing assertions here are the plan's own TM3 exit criteria:
 *  - reconciliation catches a deliberately duplicated outcome at intake and
 *    reports it instead of silently creating a twin (and NEVER auto-merges);
 *  - creating a Task against a populated queue produces a real placement +
 *    resequence finding before it settles, not a boolean flag.
 */
import assert from "node:assert/strict";
import test from "node:test";
import {
  analyzeTaskImpactFit,
  compareTaskPaths,
  draftTaskCreate,
  findDuplicateTasks,
  proposeQueueSequence,
  type CreateTaskRecordInput,
  type TaskRecord,
} from "../src/index.js";

const NOW = "2026-08-08T00:00:00.000Z";

function input(id: string, title: string, extra: Partial<CreateTaskRecordInput> = {}): CreateTaskRecordInput {
  return {
    id,
    organizationId: "org-1",
    title,
    ownerType: "human",
    ownerId: "human-1",
    ...extra,
  };
}

function seedQueue(): TaskRecord[] {
  const root = draftTaskCreate(
    {
      ...input("root", "Migrate billing invoices to Stripe"),
      isGoal: true,
      outcomes: [
        { id: "o1", title: "Invoices migrated", measure: "percent", target: "100", indicatorKind: "lagging" },
      ],
    },
    [],
    NOW,
    "p0",
  ).task;
  const queue: TaskRecord[] = [root];
  const child = draftTaskCreate(
    {
      ...input("child", "Write onboarding documentation", { parentTaskId: "root", exitTest: "docs reviewed" }),
    },
    queue,
    NOW,
    "p1",
  ).task;
  queue.push(child);
  return queue;
}

test("reconciliation reports a duplicated outcome at intake and never merges it", () => {
  const queue = seedQueue();

  // Same work, different words in the title — the outcome and exit test carry
  // the overlap, which is exactly what the plan says to reconcile on.
  const findings = findDuplicateTasks({
    title: "Migrate billing invoices to Stripe",
    outcomes: [{ title: "Invoices migrated", measure: "percent", target: "100" }],
    queue,
  });

  assert.equal(findings.length, 1, "the duplicated Task must be reported");
  assert.equal(findings[0]?.taskId, "root");
  assert.match(findings[0]?.reason ?? "", /shares/i, "the finding must name the shared terms");
  assert.ok((findings[0]?.score ?? 0) >= 0.6, "duplicate findings clear the higher duplicate bar");

  // Unrelated work must NOT be flagged — a false duplicate argues against work
  // the user just decided to do.
  const unrelated = findDuplicateTasks({ title: "Renew the office lease", queue });
  assert.deepEqual(unrelated, [], "unrelated work is not a duplicate");
});

test("duplicate search excludes the Task being created and finds closed twins", () => {
  const queue = seedQueue();
  const self = findDuplicateTasks({
    title: "Migrate billing invoices to Stripe",
    outcomes: [{ title: "Invoices migrated", measure: "percent", target: "100" }],
    excludeTaskId: "root",
    queue,
  });
  assert.deepEqual(self, [], "a Task is never its own duplicate");

  const closed: TaskRecord[] = queue.map((task) =>
    task.id === "root" ? { ...task, status: "done" as const } : task,
  );
  const againstClosed = findDuplicateTasks({
    title: "Migrate billing invoices to Stripe",
    outcomes: [{ title: "Invoices migrated", measure: "percent", target: "100" }],
    queue: closed,
  });
  assert.equal(againstClosed.length, 1, "already-finished work is the most useful duplicate answer");
  assert.match(againstClosed[0]?.reason ?? "", /already done/i);
});

test("queue sequencing puts in-progress first, ranks blocked below ready, and is numeric-path stable", () => {
  assert.ok(compareTaskPaths("1.9", "1.10") < 0, "dot-paths compare numerically, not lexically");

  const base = seedQueue();
  const queue: TaskRecord[] = [
    { ...base[0]!, id: "a", path: "1", priority: "P2", status: "pending" },
    { ...base[0]!, id: "b", path: "2", priority: "P0", status: "pending" },
    { ...base[0]!, id: "c", path: "3", priority: "P1", status: "in_progress" },
    { ...base[0]!, id: "d", path: "4", priority: "P0", status: "blocked" },
    { ...base[0]!, id: "e", path: "5", priority: "P1", status: "done" },
  ];

  const result = proposeQueueSequence({ queue });
  assert.deepEqual(
    result.proposed.map((entry) => entry.taskId),
    ["c", "b", "a", "d"],
    "in-progress head, then priority, then path; blocked sinks; done leaves the queue",
  );
  assert.equal(result.changed, true, "this order differs from canonical path order");
  assert.match(result.proposed[0]?.reason ?? "", /queue head/i);

  // An already-correct queue must report no change rather than churn.
  const settled = proposeQueueSequence({
    queue: [
      { ...base[0]!, id: "x", path: "1", priority: "P0", status: "pending" },
      { ...base[0]!, id: "y", path: "2", priority: "P1", status: "pending" },
    ],
  });
  assert.equal(settled.changed, false);
});

test("impact-fit analysis carries real placement, duplicates, and resequence findings", () => {
  const queue = seedQueue();
  const analysis = analyzeTaskImpactFit({
    taskId: "new",
    title: "Migrate billing invoices to Stripe",
    outcomes: [{ title: "Invoices migrated", measure: "percent", target: "100" }],
    queue,
  });

  assert.equal(analysis.duplicateVerdict, "review_duplicates");
  assert.equal(analysis.duplicates[0]?.taskId, "root");
  assert.ok(
    analysis.queueFindings.some((finding) => /duplicate/i.test(finding)),
    "the reviewer is told duplicates exist",
  );
  assert.ok(analysis.placement.reason.length > 0, "placement always explains itself");
  assert.ok(Array.isArray(analysis.resequence.proposed));

  // An explicit parent suppresses suggestion — the requester already decided.
  const explicit = analyzeTaskImpactFit({
    taskId: "new",
    title: "Renew the office lease",
    parentTaskId: "root",
    queue,
  });
  assert.equal(explicit.placement.proposedParentTaskId, "root");
  assert.match(explicit.placement.reason, /requester/i);
  assert.deepEqual(explicit.placement.alternatives, []);
  assert.equal(explicit.duplicateVerdict, "no_duplicates_found");
});

test("draftTaskCreate's impact_fit proposal carries the analysis, not a bare flag", () => {
  const queue = seedQueue();
  const draft = draftTaskCreate(
    {
      ...input("dup", "Migrate billing invoices to Stripe"),
      outcomes: [
        { id: "o9", title: "Invoices migrated", measure: "percent", target: "100", indicatorKind: "lagging" },
      ],
    },
    queue,
    NOW,
    "p2",
  );

  const payload = draft.impactFitProposal?.payload as Record<string, unknown> | undefined;
  assert.ok(payload, "a populated queue still raises an impact_fit proposal");

  // The regression this whole slice exists to close: the payload used to be a
  // boolean. It must now carry findings a reviewer can act on.
  const duplicates = payload?.["duplicates"] as unknown[] | undefined;
  assert.ok(Array.isArray(duplicates) && duplicates.length > 0, "duplicates must reach the proposal");
  assert.equal(payload?.["duplicateVerdict"], "review_duplicates");
  assert.ok(payload?.["placement"], "placement reasoning must reach the proposal");
  assert.ok(payload?.["resequence"], "a real resequence proposal must reach the proposal");
  assert.ok(Array.isArray(payload?.["queueFindings"]));

  // The new Task still lands as a candidate — nothing auto-commits.
  assert.equal(draft.task.status, "candidate");
});
