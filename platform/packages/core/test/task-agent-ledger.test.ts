/**
 * The agent-facing ledger: the projection's dependency line, and the per-repo
 * template that tells an external coding agent how to work it (ADR-209, TM6).
 *
 * The projection's `Dependencies:` field was HARDCODED to "none" from TM0. That
 * was true while the schema had no edges; once ADR-204 shipped them it became a
 * lie told to the one reader this file exists for. These assertions fail if it
 * ever goes back to asserting a fact it did not check.
 */
import assert from "node:assert/strict";
import test from "node:test";
import {
  AGENT_LEDGER_TEMPLATE_FILE,
  emitAgentLedgerTemplate,
  emitTasksMarkdown,
  TASK_PROJECTION_COMPLETED_CAP,
  TASK_RECORD_STATUSES,
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
  return {
    id: `edge-${taskId}-${dependsOnTaskId}`,
    organizationId: "org-1",
    taskId,
    dependsOnTaskId,
    createdAt: NOW,
  };
}

test("the projection names what a Task is waiting on, instead of claiming nothing is", () => {
  const waiting = task("1", { title: "Ship the review surface" });
  const blocker = task("2", { title: "Land the migration first" });
  const projection = emitTasksMarkdown([waiting, blocker], 10, [edge("1", "2")]);
  assert.match(
    projection.content,
    /- Dependencies: waiting on 2 \(Land the migration first\)/,
    "the blocker is named by path and title, not merely counted",
  );
  assert.match(projection.content, /## 2 — Land the migration first[\s\S]*?- Dependencies: none/);
});

test("edges that were never loaded read 'not read', never 'none'", () => {
  // A caller that did not query the edges has not established that a Task
  // waits on nothing. Reporting the absence of a query as the absence of a
  // dependency is the same lie in a quieter voice.
  const projection = emitTasksMarkdown([task("1")]);
  assert.match(projection.content, /- Dependencies: not read/);
  assert.doesNotMatch(projection.content, /- Dependencies: none/);
});

test("a done blocker stops blocking, and the cleared count is still reported", () => {
  // "Nothing is in the way now" and "nothing was ever in the way" are
  // different facts about a Task, and an agent picking work up deserves both.
  const waiting = task("1");
  const landed = task("2", { status: "done" });
  const projection = emitTasksMarkdown([waiting, landed], 10, [edge("1", "2")]);
  assert.match(projection.content, /## 1 — Task 1[\s\S]*?- Dependencies: none \(1 cleared\)/);
});

test("an abandoned blocker stops blocking too", () => {
  // ADR-204's rule: leaving a dependent waiting on work nobody will do is the
  // rot the edge exists to expose.
  const projection = emitTasksMarkdown(
    [task("1"), task("2", { status: "abandoned" })],
    10,
    [edge("1", "2")],
  );
  assert.match(projection.content, /## 1 — Task 1[\s\S]*?- Dependencies: none \(1 cleared\)/);
});

test("live and cleared blockers are reported together, not collapsed", () => {
  const projection = emitTasksMarkdown(
    [task("1"), task("2", { status: "done" }), task("3", { title: "Still open" })],
    10,
    [edge("1", "2"), edge("1", "3")],
  );
  assert.match(projection.content, /- Dependencies: waiting on 3 \(Still open\); 1 cleared/);
});

test("adding a dependency changes the projection hash, so drift detection sees it", () => {
  // The edges are projected CONTENT now. If the hash ignored them, an added
  // blocker would be invisible to reconciliation.
  const tasks = [task("1"), task("2")];
  assert.notEqual(
    emitTasksMarkdown(tasks, 10, []).contentHash,
    emitTasksMarkdown(tasks, 10, [edge("1", "2")]).contentHash,
  );
});

test("the agent-ledger template derives its facts from the kernel, not from prose", () => {
  const template = emitAgentLedgerTemplate({
    moduleDisplayName: "TaskManager",
    organizationName: "Pilot Organization",
    projectionFileName: "tasks.md",
    completedCap: TASK_PROJECTION_COMPLETED_CAP,
    statuses: TASK_RECORD_STATUSES,
  });
  // Every status the kernel has, so the template cannot describe a set the
  // system does not have.
  for (const status of TASK_RECORD_STATUSES) {
    assert.ok(template.includes(status), `template omits the ${status} status`);
  }
  assert.ok(template.includes(String(TASK_PROJECTION_COMPLETED_CAP)));
  assert.ok(template.includes("~/Documents/Bridge/Pilot Organization/TaskManager/"));
  assert.equal(AGENT_LEDGER_TEMPLATE_FILE, "AGENTS.md");
});

test("the template states the rule that makes an external edit safe", () => {
  const template = emitAgentLedgerTemplate({
    moduleDisplayName: "TaskManager",
    organizationName: "Pilot Organization",
    projectionFileName: "tasks.md",
    completedCap: TASK_PROJECTION_COMPLETED_CAP,
    statuses: TASK_RECORD_STATUSES,
  });
  // The load-bearing sentences. An agent that misses any of these does the
  // wrong thing confidently: overwrites the Database, marks work done without
  // evidence, or reads an aged-out Task as deleted.
  assert.match(template, /Database is authoritative/i);
  assert.match(template, /Nothing you\s*\n?write takes effect until a Human approves it/);
  assert.match(template, /evidence/i);
  assert.match(template, /aged out of the projection/);
  assert.match(template, /`not read` means the edges were not loaded/);
});

test("the template is deterministic", () => {
  // It is a generated Module File, content-hashed like any other. A template
  // that varied between emissions would report drift against itself.
  const input = {
    moduleDisplayName: "TaskManager",
    organizationName: "Pilot Organization",
    projectionFileName: "tasks.md",
    completedCap: TASK_PROJECTION_COMPLETED_CAP,
    statuses: TASK_RECORD_STATUSES,
  };
  assert.equal(emitAgentLedgerTemplate(input), emitAgentLedgerTemplate(input));
});
