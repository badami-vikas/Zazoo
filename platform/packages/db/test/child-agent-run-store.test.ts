/**
 * DrizzleChildAgentRunStore — round-trip coverage against a real
 * pglite-backed Postgres. Proves child Agent Run create/get/list/status
 * transitions survive a real Postgres-compatible engine, and that every
 * inherited ceiling (authorityScope, droppedScope, eligibleSkills, budget,
 * dataScope, plane, reviewMode, taint, depth) round-trips intact — not only
 * the id/status a shallower test might check.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { createLocalDb, DrizzleChildAgentRunStore, schema } from "../src/index.js";
import type { ChildAgentRun } from "@bridge/core";

async function seedWorkspaceGoalTaskAgent(db: Awaited<ReturnType<typeof createLocalDb>>["db"]) {
  const [ws] = await db.insert(schema.workspaces).values({ name: "test_fixture_ws_child_run" }).returning({ id: schema.workspaces.id });
  assert.ok(ws);
  const [agent] = await db.insert(schema.agents).values({ workspaceId: ws!.id, name: "test_fixture_parent_agent" }).returning({ id: schema.agents.id });
  assert.ok(agent);
  const [goal] = await db
    .insert(schema.goals)
    .values({ workspaceId: ws!.id, type: "relationship.learning", title: "test fixture goal" })
    .returning({ id: schema.goals.id });
  assert.ok(goal);
  const [task] = await db
    .insert(schema.tasks)
    .values({ workspaceId: ws!.id, goalId: goal!.id, type: "relationship.learning.recommend", assignedAgentId: agent!.id })
    .returning({ id: schema.tasks.id });
  assert.ok(task);
  return { workspaceId: ws!.id, agentId: agent!.id, goalId: goal!.id, taskId: task!.id };
}

function fixtureRun(overrides: Partial<ChildAgentRun>, ids: { workspaceId: string; agentId: string; goalId: string; taskId: string }): ChildAgentRun {
  return {
    id: crypto.randomUUID(),
    parentRunId: crypto.randomUUID(),
    parentAgentId: ids.agentId,
    workspaceId: ids.workspaceId,
    goalId: ids.goalId,
    taskId: ids.taskId,
    depth: 1,
    authorityScope: ["signal:write"],
    droppedScope: [],
    eligibleSkills: ["test.fixture.skill"],
    dataScope: "private",
    plane: "cloud",
    budget: { maxCalls: 10, maxCost: 5 },
    deadline: "2026-08-01T00:00:00.000Z",
    stopCondition: "budget exhausted",
    reviewMode: "approve",
    status: "running",
    createdAt: "2026-07-01T00:00:00.000Z",
    ...overrides,
  };
}

test("child agent run store: create + get round-trips every inherited ceiling", async () => {
  const { db, close } = await createLocalDb();
  try {
    const ids = await seedWorkspaceGoalTaskAgent(db);
    const store = new DrizzleChildAgentRunStore(db);

    const created = await store.create(fixtureRun({ taint: "user_content", droppedScope: ["policy:write"] }, ids));
    assert.equal(created.depth, 1);
    assert.deepEqual(created.authorityScope, ["signal:write"]);
    assert.deepEqual(created.droppedScope, ["policy:write"]);
    assert.deepEqual(created.eligibleSkills, ["test.fixture.skill"]);
    assert.equal(created.budget.maxCalls, 10);
    assert.equal(created.taint, "user_content");

    const fetched = await store.get(created.id);
    assert.ok(fetched);
    assert.deepEqual(fetched, created);
  } finally {
    await close();
  }
});

test("child agent run store: listByParentRun scopes strictly to the parent run id", async () => {
  const { db, close } = await createLocalDb();
  try {
    const ids = await seedWorkspaceGoalTaskAgent(db);
    const store = new DrizzleChildAgentRunStore(db);
    const parentRunId = crypto.randomUUID();

    const a = await store.create(fixtureRun({ parentRunId }, ids));
    await store.create(fixtureRun({ parentRunId: crypto.randomUUID() }, ids)); // different parent

    const listed = await store.listByParentRun(parentRunId);
    assert.equal(listed.length, 1);
    assert.equal(listed[0]?.id, a.id);
  } finally {
    await close();
  }
});

test("child agent run store: updateStatus transitions running -> cancelled and persists", async () => {
  const { db, close } = await createLocalDb();
  try {
    const ids = await seedWorkspaceGoalTaskAgent(db);
    const store = new DrizzleChildAgentRunStore(db);

    const created = await store.create(fixtureRun({}, ids));
    const updated = await store.updateStatus(created.id, "cancelled");
    assert.equal(updated.status, "cancelled");

    const fetched = await store.get(created.id);
    assert.equal(fetched?.status, "cancelled");
  } finally {
    await close();
  }
});

test("child agent run store: updateStatus on an unknown id throws rather than silently no-op", async () => {
  const { db, close } = await createLocalDb();
  try {
    const store = new DrizzleChildAgentRunStore(db);
    await assert.rejects(() => store.updateStatus("00000000-0000-4000-8000-000000000000", "completed"), /unknown run/);
  } finally {
    await close();
  }
});

test("child agent run store: get on an unknown id returns null rather than throwing", async () => {
  const { db, close } = await createLocalDb();
  try {
    const store = new DrizzleChildAgentRunStore(db);
    assert.equal(await store.get("00000000-0000-4000-8000-000000000000"), null);
  } finally {
    await close();
  }
});
