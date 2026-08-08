/**
 * Task dependency Relations (ADR-204).
 *
 * The plan specified `depends_on`/`blocked_by` since TM0 and the schema never
 * had them; every slice since ADR-196 recorded the same residual. What these
 * assertions defend is the shape of the answer, not just its presence:
 *  - ONE edge kind, so the two directions cannot disagree;
 *  - a cycle is refused at write time, because it is unsatisfiable rather
 *    than merely unwise;
 *  - a blocker that is done, abandoned or GONE no longer blocks;
 *  - "unblocked" means "had dependencies and no longer has an open one", not
 *    "has no dependencies".
 */
import assert from "node:assert/strict";
import test from "node:test";
import {
  assertNoDependencyCycle,
  blockedTasks,
  dependencyBlockedTaskIds,
  proposeQueueSequence,
  TaskDependencyCycleError,
  unblockedTasks,
  type TaskDependency,
  type TaskRecord,
} from "../src/index.js";

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

function edge(taskId: string, dependsOnTaskId: string): TaskDependency {
  return { id: `${taskId}->${dependsOnTaskId}`, organizationId: "org-1", taskId, dependsOnTaskId, createdAt: NOW };
}

test("a Task with an open blocker is blocked, and the report names every blocker", () => {
  const tasks = [task("1"), task("2"), task("3", { status: "done" })];
  const blocked = blockedTasks(tasks, [edge("1", "2"), edge("1", "3")]);
  assert.equal(blocked.length, 1);
  assert.equal(blocked[0]?.taskId, "1");
  // Only the OPEN blocker is listed: a done one is satisfied, and reporting it
  // would make the wait look longer than it is.
  assert.deepEqual(blocked[0]?.blockedBy.map((b) => b.taskId), ["2"]);
});

test("a blocker that is abandoned or deleted no longer blocks", () => {
  // An abandoned blocker is nobody's plan any more. Leaving the dependent
  // Task waiting on it forever is the failure mode the edge exists to expose.
  assert.deepEqual(blockedTasks([task("1"), task("2", { status: "abandoned" })], [edge("1", "2")]), []);
  // A blocker row that is gone cannot be acted on, so an edge pointing at it
  // is stale rather than binding.
  assert.deepEqual(blockedTasks([task("1")], [edge("1", "missing")]), []);
});

test("\"unblocked\" means the wait ended, not that there never was one", () => {
  const tasks = [task("1"), task("2", { status: "done" }), task("3")];
  const findings = unblockedTasks(tasks, [edge("1", "2")]);
  assert.deepEqual(findings.map((finding) => finding.taskId), ["1"]);
  // Task 3 has no dependencies at all. Reporting it as newly startable would
  // bury the one row that actually changed.
  assert.equal(findings[0]?.clearedBy[0]?.taskId, "2", "the notice names what cleared, so it is checkable");
});

test("a cycle is refused at write time, including the transitive case", () => {
  assert.throws(() => assertNoDependencyCycle([], { taskId: "1", dependsOnTaskId: "1" }), TaskDependencyCycleError);
  // 1 → 2 → 3 exists; adding 3 → 1 closes the loop and would make all three
  // wait forever.
  assert.throws(
    () => assertNoDependencyCycle([edge("1", "2"), edge("2", "3")], { taskId: "3", dependsOnTaskId: "1" }),
    TaskDependencyCycleError,
  );
  // A diamond is not a cycle: 1 and 2 may both wait on 3.
  assert.doesNotThrow(() => assertNoDependencyCycle([edge("1", "3")], { taskId: "2", dependsOnTaskId: "3" }));
});

test("sequencing sinks a Task whose blocker is open, whatever its own status says", () => {
  const tasks = [
    task("1", { status: "pending", priority: "P0" }),
    task("2", { status: "pending", priority: "P2" }),
  ];
  // Without edges, P0 leads on priority alone.
  const plain = proposeQueueSequence({ queue: tasks });
  assert.equal(plain.proposed[0]?.taskId, "1");

  // With 1 waiting on 2, the P0 Task is not ready — and nobody had to remember
  // to set its status to `blocked`. That is the difference the edge buys:
  // a status records that someone BELIEVED a Task was blocked, an edge records
  // what by, so the queue can sink it and float it again on its own.
  const aware = proposeQueueSequence({
    queue: tasks,
    dependencyBlockedTaskIds: dependencyBlockedTaskIds(tasks, [edge("1", "2")]),
  });
  assert.equal(aware.proposed[0]?.taskId, "2");
  assert.equal(aware.proposed[1]?.taskId, "1");
});
