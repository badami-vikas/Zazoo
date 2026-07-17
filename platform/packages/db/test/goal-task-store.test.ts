/**
 * DrizzleGoalTaskStore — round-trip coverage against a real pglite-backed
 * Postgres (mirrors workspace-definition-store.test.ts's shape). Proves Goal/
 * Task creation, lookup, listing, reassignment, and status transitions
 * survive a real Postgres-compatible engine — the restart-durable backing
 * TASK-007 closure requires for @bridge/core's in-memory `GoalTaskStore`
 * default.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { createLocalDb, DrizzleGoalTaskStore, schema } from "../src/index.js";

async function seedWorkspaceAndAgent(db: Awaited<ReturnType<typeof createLocalDb>>["db"]) {
  const [ws] = await db.insert(schema.workspaces).values({ name: "test_fixture_ws_goal_task" }).returning({ id: schema.workspaces.id });
  assert.ok(ws);
  const [agent] = await db
    .insert(schema.agents)
    .values({ workspaceId: ws!.id, name: "test_fixture_agent" })
    .returning({ id: schema.agents.id });
  assert.ok(agent);
  return { workspaceId: ws!.id, agentId: agent!.id };
}

/** Deterministic id/clock seam (mirrors @bridge/core's own IdGen/Clock ports
 * without importing pipeline-level determinism seams into a DB-layer test). */
function testSeam() {
  return {
    nextId: () => crypto.randomUUID(),
    nowISO: () => "2026-07-01T00:00:00.000Z",
  };
}

test("goal-task store: create + get Goal round-trip", async () => {
  const { db, close } = await createLocalDb();
  try {
    const { workspaceId } = await seedWorkspaceAndAgent(db);
    const store = new DrizzleGoalTaskStore(db);
    const seam = testSeam();

    const created = await store.createGoal({ workspaceId, type: "relationship.learning", title: "Learn from feedback" }, seam);
    assert.equal(created.workspaceId, workspaceId);
    assert.equal(created.type, "relationship.learning");

    const fetched = await store.getGoal(workspaceId, created.id);
    assert.ok(fetched);
    assert.equal(fetched.title, "Learn from feedback");
  } finally {
    await close();
  }
});

test("goal-task store: listGoals scopes strictly to workspace", async () => {
  const { db, close } = await createLocalDb();
  try {
    const { workspaceId } = await seedWorkspaceAndAgent(db);
    const { workspaceId: otherWorkspaceId } = await seedWorkspaceAndAgent(db);
    const store = new DrizzleGoalTaskStore(db);
    const seam = testSeam();

    await store.createGoal({ workspaceId, type: "relationship.learning", title: "A" }, seam);
    await store.createGoal({ workspaceId: otherWorkspaceId, type: "relationship.learning", title: "B" }, seam);

    const goals = await store.listGoals(workspaceId);
    assert.equal(goals.length, 1);
    assert.equal(goals[0]?.title, "A");
  } finally {
    await close();
  }
});

test("goal-task store: create Task, reassign, and update status round-trip; listTasksByGoal scopes to goal", async () => {
  const { db, close } = await createLocalDb();
  try {
    const { workspaceId, agentId } = await seedWorkspaceAndAgent(db);
    const [otherAgent] = await db.insert(schema.agents).values({ workspaceId, name: "test_fixture_agent_2" }).returning({ id: schema.agents.id });
    assert.ok(otherAgent);
    const store = new DrizzleGoalTaskStore(db);
    const seam = testSeam();

    const goal = await store.createGoal({ workspaceId, type: "relationship.learning", title: "Learn" }, seam);
    const task = await store.createTask({ workspaceId, goalId: goal.id, type: "relationship.learning.recommend", assignedAgentId: agentId }, seam);
    assert.equal(task.status, "open");
    assert.equal(task.assignedAgentId, agentId);

    const fetched = await store.getTask(workspaceId, task.id);
    assert.ok(fetched);
    assert.equal(fetched.goalId, goal.id);

    const reassigned = await store.reassignTask(workspaceId, task.id, otherAgent!.id);
    assert.equal(reassigned.assignedAgentId, otherAgent!.id);

    const updated = await store.updateTaskStatus(workspaceId, task.id, "in_progress");
    assert.equal(updated.status, "in_progress");
    const blocked = await store.updateTaskStatus(workspaceId, task.id, "blocked");
    assert.equal(blocked.status, "blocked");

    const listed = await store.listTasksByGoal(workspaceId, goal.id);
    assert.equal(listed.length, 1);
    assert.equal(listed[0]?.id, task.id);
  } finally {
    await close();
  }
});

test("goal-task store: getGoal/getTask return null for unknown ids rather than throwing", async () => {
  const { db, close } = await createLocalDb();
  try {
    const store = new DrizzleGoalTaskStore(db);
    assert.equal(
      await store.getGoal(
        "00000000-0000-4000-8000-000000000001",
        "00000000-0000-4000-8000-000000000000",
      ),
      null,
    );
    assert.equal(
      await store.getTask(
        "00000000-0000-4000-8000-000000000001",
        "00000000-0000-4000-8000-000000000000",
      ),
      null,
    );
  } finally {
    await close();
  }
});

test("goal-task store: database constraints reject cross-workspace Goal and Agent references", async () => {
  const { db, close } = await createLocalDb();
  try {
    const first = await seedWorkspaceAndAgent(db);
    const second = await seedWorkspaceAndAgent(db);
    const store = new DrizzleGoalTaskStore(db);
    const goal = await store.createGoal(
      { workspaceId: first.workspaceId, type: "test.goal", title: "First workspace" },
      testSeam(),
    );
    await assert.rejects(
      () =>
        store.createTask(
          {
            workspaceId: second.workspaceId,
            goalId: goal.id,
            type: "test.task",
            assignedAgentId: second.agentId,
          },
          testSeam(),
        ),
      (error: unknown) =>
        error instanceof Error &&
        /foreign key|violates/i.test(
          `${error.message} ${error.cause instanceof Error ? error.cause.message : ""}`,
        ),
    );
  } finally {
    await close();
  }
});
