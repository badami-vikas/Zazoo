import { test } from "node:test";
import assert from "node:assert/strict";

import { FixedClock, UuidGen, SeededRng, InMemoryGoalTaskStore } from "../src/index.js";

function seam() {
  const clock = new FixedClock("2026-07-16T00:00:00.000Z");
  const rng = new SeededRng(7);
  const ids = new UuidGen(clock, rng);
  return { nextId: () => ids.next(), nowISO: () => clock.nowISO() };
}

test("InMemoryGoalTaskStore: creates a Goal and a Task assigned to a non-default Agent", async () => {
  const store = new InMemoryGoalTaskStore();
  const s = seam();
  const goal = await store.createGoal(
    { organizationId: "ws-1", type: "relationship.learning", title: "Improve follow-up quality" },
    s,
  );
  assert.ok(goal.id);
  assert.equal(goal.type, "relationship.learning");

  const task = await store.createTask(
    {
      organizationId: "ws-1",
      goalId: goal.id,
      type: "synthesize_recommendation",
      assignedAgentId: "internal_strategist",
    },
    s,
  );
  assert.equal(task.assignedAgentId, "internal_strategist");
  assert.equal(task.status, "open");
  assert.equal(task.goalId, goal.id);

  const fetched = await store.getTask("ws-1", task.id);
  assert.deepEqual(fetched, task);

  const byGoal = await store.listTasksByGoal("ws-1", goal.id);
  assert.equal(byGoal.length, 1);
});

test("InMemoryGoalTaskStore: reassignTask changes the assigned Agent, nothing else", async () => {
  const store = new InMemoryGoalTaskStore();
  const s = seam();
  const goal = await store.createGoal({ organizationId: "ws-1", type: "g", title: "t" }, s);
  const task = await store.createTask(
    { organizationId: "ws-1", goalId: goal.id, type: "tt", assignedAgentId: "learning" },
    s,
  );
  const reassigned = await store.reassignTask("ws-1", task.id, "internal_strategist");
  assert.equal(reassigned.assignedAgentId, "internal_strategist");
  assert.equal(reassigned.id, task.id);
  assert.equal(reassigned.type, task.type);
});

test("InMemoryGoalTaskStore: updateTaskStatus transitions status", async () => {
  const store = new InMemoryGoalTaskStore();
  const s = seam();
  const goal = await store.createGoal({ organizationId: "ws-1", type: "g", title: "t" }, s);
  const task = await store.createTask(
    { organizationId: "ws-1", goalId: goal.id, type: "tt", assignedAgentId: "learning" },
    s,
  );
  const updated = await store.updateTaskStatus("ws-1", task.id, "done");
  assert.equal(updated.status, "done");
});

test("InMemoryGoalTaskStore: getGoal/getTask return null for unknown ids", async () => {
  const store = new InMemoryGoalTaskStore();
  assert.equal(await store.getGoal("ws-1", "nope"), null);
  assert.equal(await store.getTask("ws-1", "nope"), null);
});
