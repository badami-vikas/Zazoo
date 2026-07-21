/**
 * DrizzleGoalTaskStore — round-trip coverage against a real pglite-backed
 * Postgres (mirrors organization-definition-store.test.ts's shape). Proves Goal/
 * Task creation, lookup, listing, reassignment, and status transitions
 * survive a real Postgres-compatible engine — the restart-durable backing
 * TASK-007 closure requires for @bridge/core's in-memory `GoalTaskStore`
 * default.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { createLocalDb, DrizzleGoalTaskStore, schema } from "../src/index.js";

async function seedOrganizationAndAgent(db: Awaited<ReturnType<typeof createLocalDb>>["db"]) {
  const [ws] = await db.insert(schema.organizations).values({ name: "test_fixture_ws_goal_task" }).returning({ id: schema.organizations.id });
  assert.ok(ws);
  const [agent] = await db
    .insert(schema.agents)
    .values({ organizationId: ws!.id, name: "test_fixture_agent" })
    .returning({ id: schema.agents.id });
  assert.ok(agent);
  return { organizationId: ws!.id, agentId: agent!.id };
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
    const { organizationId } = await seedOrganizationAndAgent(db);
    const store = new DrizzleGoalTaskStore(db);
    const seam = testSeam();

    const created = await store.createGoal({ organizationId, type: "relationship.learning", title: "Learn from feedback" }, seam);
    assert.equal(created.organizationId, organizationId);
    assert.equal(created.type, "relationship.learning");

    const fetched = await store.getGoal(organizationId, created.id);
    assert.ok(fetched);
    assert.equal(fetched.title, "Learn from feedback");
  } finally {
    await close();
  }
});

test("goal-task store: listGoals scopes strictly to organization", async () => {
  const { db, close } = await createLocalDb();
  try {
    const { organizationId } = await seedOrganizationAndAgent(db);
    const { organizationId: otherOrganizationId } = await seedOrganizationAndAgent(db);
    const store = new DrizzleGoalTaskStore(db);
    const seam = testSeam();

    await store.createGoal({ organizationId, type: "relationship.learning", title: "A" }, seam);
    await store.createGoal({ organizationId: otherOrganizationId, type: "relationship.learning", title: "B" }, seam);

    const goals = await store.listGoals(organizationId);
    assert.equal(goals.length, 1);
    assert.equal(goals[0]?.title, "A");
  } finally {
    await close();
  }
});

test("goal-task store: create Task, reassign, and update status round-trip; listTasksByGoal scopes to goal", async () => {
  const { db, close } = await createLocalDb();
  try {
    const { organizationId, agentId } = await seedOrganizationAndAgent(db);
    const [otherAgent] = await db.insert(schema.agents).values({ organizationId, name: "test_fixture_agent_2" }).returning({ id: schema.agents.id });
    assert.ok(otherAgent);
    const store = new DrizzleGoalTaskStore(db);
    const seam = testSeam();

    const goal = await store.createGoal({ organizationId, type: "relationship.learning", title: "Learn" }, seam);
    const task = await store.createTask({
      organizationId,
      goalId: goal.id,
      type: "relationship.learning.recommend",
      assignedAgentId: agentId,
      exitTest: "stored Task reaches in_progress",
    }, seam);
    assert.equal(task.status, "open");
    assert.equal(task.assignedAgentId, agentId);

    const fetched = await store.getTask(organizationId, task.id);
    assert.ok(fetched);
    assert.equal(fetched.goalId, goal.id);

    const reassigned = await store.reassignTask(organizationId, task.id, otherAgent!.id);
    assert.equal(reassigned.assignedAgentId, otherAgent!.id);

    const updated = await store.updateTaskStatus(organizationId, task.id, "in_progress");
    assert.equal(updated.status, "in_progress");
    const blocked = await store.updateTaskStatus(organizationId, task.id, "blocked");
    assert.equal(blocked.status, "blocked");

    const listed = await store.listTasksByGoal(organizationId, goal.id);
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

test("goal-task store: database constraints reject cross-organization Goal and Agent references", async () => {
  const { db, close } = await createLocalDb();
  try {
    const first = await seedOrganizationAndAgent(db);
    const second = await seedOrganizationAndAgent(db);
    const store = new DrizzleGoalTaskStore(db);
    const goal = await store.createGoal(
      { organizationId: first.organizationId, type: "test.goal", title: "First organization" },
      testSeam(),
    );
    await assert.rejects(
      () =>
        store.createTask(
          {
            organizationId: second.organizationId,
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
