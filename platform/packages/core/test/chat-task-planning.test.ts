import assert from "node:assert/strict";
import test from "node:test";
import {
  planChatTaskNode,
  resolveChatThreadTaskAnchor,
  suggestTaskParent,
  type ParentCandidateTask,
} from "../src/chat-task-planning.js";

const PRICING: ParentCandidateTask = {
  taskId: "task-pricing",
  title: "Ship the pricing page",
  outcome: "The pricing page is live for signed-out visitors.",
  status: "in_progress",
};

const HIRING: ParentCandidateTask = {
  taskId: "task-hiring",
  title: "Hire a designer",
  outcome: "An offer is signed.",
  status: "committed",
};

test("the thread's Task node is the earliest ACCEPTED proposal in it", () => {
  assert.equal(resolveChatThreadTaskAnchor([]), null);
  assert.equal(
    resolveChatThreadTaskAnchor([
      { turnId: "t1", sequence: 2, taskId: "a", accepted: false },
      { turnId: "t2", sequence: 4, taskId: "b", accepted: false },
    ]),
    null,
    "a pending or vetoed proposal never owns the thread's node",
  );
  assert.deepEqual(
    resolveChatThreadTaskAnchor([
      { turnId: "t3", sequence: 6, taskId: "c", accepted: true },
      { turnId: "t1", sequence: 2, taskId: "a", accepted: true },
      { turnId: "t2", sequence: 4, taskId: "b", accepted: false },
    ]),
    { turnId: "t1", taskId: "a" },
  );
});

test("parent matching is term overlap over OPEN Tasks, with its reason", () => {
  const matched = suggestTaskParent({
    title: "Ship the pricing page copy",
    outcome: "The pricing copy is reviewed.",
    candidates: [PRICING, HIRING],
  });
  assert.equal(matched.suggestion?.taskId, "task-pricing");
  assert.match(matched.suggestion?.reason ?? "", /^Shares .*"pricing"/);
  assert.ok((matched.suggestion?.score ?? 0) > 0.33);
  assert.deepEqual(matched.candidates.map((c) => c.taskId), ["task-pricing"]);
});

test("an unrelated Task is never suggested as a parent", () => {
  const matched = suggestTaskParent({
    title: "Book a dentist appointment",
    outcome: "The appointment is on the calendar.",
    candidates: [PRICING, HIRING],
  });
  assert.equal(matched.suggestion, null);
  assert.deepEqual(matched.candidates, []);
});

test("one shared term is not enough to claim a parent", () => {
  const matched = suggestTaskParent({
    title: "Refresh the pricing spreadsheet formulas quarterly",
    outcome: "Formulas recalculate correctly each quarter.",
    candidates: [PRICING],
  });
  assert.equal(matched.suggestion, null);
});

test("closed Tasks are filtered out, but thread lineage still wins", () => {
  const done: ParentCandidateTask = { ...PRICING, status: "done" };
  assert.equal(
    suggestTaskParent({
      title: "Ship the pricing page copy",
      outcome: "The pricing copy is reviewed.",
      candidates: [done],
    }).suggestion,
    null,
  );
  const lineage = suggestTaskParent({
    title: "Something else entirely",
    outcome: "Unrelated work.",
    candidates: [done],
    lineageTaskId: done.taskId,
  });
  assert.equal(lineage.suggestion?.taskId, done.taskId);
  assert.equal(lineage.suggestion?.score, 1);
  assert.match(lineage.suggestion?.reason ?? "", /same Chat thread/);
});

test("a Task is never suggested as its own parent", () => {
  const matched = suggestTaskParent({
    title: PRICING.title,
    outcome: PRICING.outcome ?? "",
    candidates: [PRICING],
    excludeTaskId: PRICING.taskId,
  });
  assert.equal(matched.suggestion, null);
});

test("an open thread node is appended to, a closed one becomes the parent", () => {
  assert.deepEqual(
    planChatTaskNode({
      title: "Ship the pricing page copy",
      outcome: "The copy is reviewed.",
      anchor: { taskId: PRICING.taskId, status: "in_progress" },
      candidates: [PRICING, HIRING],
      newTaskId: "task-new",
    }),
    { mode: "append", taskId: PRICING.taskId },
  );

  const afterClose = planChatTaskNode({
    title: "Ship the pricing page copy",
    outcome: "The copy is reviewed.",
    anchor: { taskId: PRICING.taskId, status: "done" },
    candidates: [{ ...PRICING, status: "done" }, HIRING],
    newTaskId: "task-new",
  });
  assert.equal(afterClose.mode, "create");
  assert.equal(
    afterClose.mode === "create" ? afterClose.parent?.taskId : null,
    PRICING.taskId,
  );
});

test("with no thread node and no match, a new top-level node is planned", () => {
  const plan = planChatTaskNode({
    title: "Book a dentist appointment",
    outcome: "The appointment is on the calendar.",
    candidates: [PRICING, HIRING],
    newTaskId: "task-new",
  });
  assert.deepEqual(plan, { mode: "create", parent: null, parentCandidates: [] });
});
