/**
 * DrizzleRitualRegistry / DrizzleToolRegistry — jsonb validation coverage.
 *
 * Before this fix, `asStep()` filtered malformed steps to `null` on READ,
 * meaning a ritual "ran successfully" while silently doing less than what was
 * configured. Now: WRITE validates and throws before a bad row is persisted
 * (`saveSteps`), and READ throws if a row is already malformed (a pre-fix row,
 * or one written by a raw insert bypassing `saveSteps`) instead of quietly
 * dropping the step.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { createLocalDb, DrizzleRitualRegistry, DrizzleToolRegistry, schema } from "../src/index.js";

const validStep = {
  skill: "test_fixture_send_note",
  action: "write" as const,
  resourceType: "touchpoint" as const,
};

async function seedWorkspace(db: Awaited<ReturnType<typeof createLocalDb>>["db"]) {
  const [ws] = await db
    .insert(schema.workspaces)
    .values({ name: "test_fixture_ws_ritual_validation" })
    .returning({ id: schema.workspaces.id });
  assert.ok(ws);
  return ws.id;
}

async function seedAgent(
  db: Awaited<ReturnType<typeof createLocalDb>>["db"],
  workspaceId: string,
) {
  const [agent] = await db
    .insert(schema.agents)
    .values({ workspaceId, name: "test_fixture_ritual_owner" })
    .returning({ id: schema.agents.id });
  assert.ok(agent);
  return agent.id;
}

test("ritual store: write-time — saveSteps throws on a malformed step instead of persisting it", async () => {
  const { db, close } = await createLocalDb();
  try {
    const workspaceId = await seedWorkspace(db);
    const [ritual] = await db
      .insert(schema.rituals)
      .values({
        workspaceId,
        name: "test_fixture_ritual_write_reject",
        trigger: {},
        skillPipeline: [],
      })
      .returning({ id: schema.rituals.id });
    assert.ok(ritual);

    const registry = new DrizzleRitualRegistry(db);

    // Missing required `action` field — must throw, never silently no-op.
    await assert.rejects(
      () => registry.saveSteps(workspaceId, ritual.id, [{ skill: "test_fixture_bad_step", resourceType: "touchpoint" }]),
      /Invalid ritual skill_pipeline jsonb/,
    );

    // Confirm nothing was persisted — the row's pipeline is still empty.
    const loaded = await registry.load(workspaceId, ritual.id);
    assert.deepEqual(loaded?.steps, []);
  } finally {
    await close();
  }
});

test("ritual store: write-time — saveSteps persists and load() round-trips a valid step", async () => {
  const { db, close } = await createLocalDb();
  try {
    const workspaceId = await seedWorkspace(db);
    const [ritual] = await db
      .insert(schema.rituals)
      .values({
        workspaceId,
        name: "test_fixture_ritual_write_ok",
        trigger: {},
        skillPipeline: [],
      })
      .returning({ id: schema.rituals.id });
    assert.ok(ritual);

    const registry = new DrizzleRitualRegistry(db);
    await registry.saveSteps(workspaceId, ritual.id, [validStep]);

    const loaded = await registry.load(workspaceId, ritual.id);
    assert.equal(loaded?.steps.length, 1);
    assert.equal(loaded?.steps[0]?.skill, "test_fixture_send_note");
  } finally {
    await close();
  }
});

test("ritual store: save and load round-trip the singular owning Agent", async () => {
  const { db, close } = await createLocalDb();
  try {
    const workspaceId = await seedWorkspace(db);
    const agentId = await seedAgent(db, workspaceId);
    const registry = new DrizzleRitualRegistry(db);
    const ritualId = "b0000000-0000-4000-a000-0000000000f1";

    await registry.save({
      id: ritualId,
      workspaceId,
      name: "test_fixture_owned_ritual",
      agentId,
      agentPlane: "cloud",
      steps: [validStep],
    });

    const loaded = await registry.load(workspaceId, ritualId);
    assert.equal(loaded?.agentId, agentId);
    assert.equal(loaded?.agentPlane, "cloud");
    assert.deepEqual(loaded?.steps, [validStep]);
  } finally {
    await close();
  }
});

test("ritual store: one legacy agent_ids owner is readable but ambiguous ownership stays unbound", async () => {
  const { db, close } = await createLocalDb();
  try {
    const workspaceId = await seedWorkspace(db);
    const firstAgentId = await seedAgent(db, workspaceId);
    const secondAgentId = await seedAgent(db, workspaceId);
    const inserted = await db
      .insert(schema.rituals)
      .values([
        {
          workspaceId,
          name: "test_fixture_legacy_single_owner",
          trigger: {},
          agentIds: [firstAgentId],
          skillPipeline: [validStep],
        },
        {
          workspaceId,
          name: "test_fixture_legacy_ambiguous_owner",
          trigger: {},
          agentIds: [firstAgentId, secondAgentId],
          skillPipeline: [validStep],
        },
      ])
      .returning({ id: schema.rituals.id });
    const registry = new DrizzleRitualRegistry(db);

    assert.equal((await registry.load(workspaceId, inserted[0]!.id))?.agentId, firstAgentId);
    assert.equal((await registry.load(workspaceId, inserted[1]!.id))?.agentId, undefined);
  } finally {
    await close();
  }
});

test("ritual store: read-time — load() throws (not silently drops) a step already-malformed in the row", async () => {
  const { db, close } = await createLocalDb();
  try {
    const workspaceId = await seedWorkspace(db);
    // Insert directly via the lower-level Drizzle client, bypassing
    // DrizzleRitualRegistry.saveSteps entirely — simulates a row written
    // before this fix existed, or by another process/raw SQL path.
    const [ritual] = await db
      .insert(schema.rituals)
      .values({
        workspaceId,
        name: "test_fixture_ritual_already_bad",
        trigger: {},
        skillPipeline: [{ skill: "test_fixture_bad", action: "not-a-real-action", resourceType: "touchpoint" }],
      })
      .returning({ id: schema.rituals.id });
    assert.ok(ritual);

    const registry = new DrizzleRitualRegistry(db);
    await assert.rejects(() => registry.load(workspaceId, ritual.id), /Invalid ritual skill_pipeline jsonb/);
  } finally {
    await close();
  }
});

test("tool store: write-time — saveSteps throws on a malformed composition instead of persisting it", async () => {
  const { db, close } = await createLocalDb();
  try {
    const workspaceId = await seedWorkspace(db);
    const [tool] = await db
      .insert(schema.tools)
      .values({
        workspaceId,
        name: "test_fixture_tool_write_reject",
        surface: "test_fixture_surface",
        composition: { steps: [] },
      })
      .returning({ id: schema.tools.id });
    assert.ok(tool);

    const registry = new DrizzleToolRegistry(db);
    await assert.rejects(
      () => registry.saveSteps(workspaceId, tool.id, [{ skill: 123, action: "write", resourceType: "touchpoint" }]),
      /Invalid tool composition jsonb/,
    );

    const loaded = await registry.load(workspaceId, tool.id);
    assert.deepEqual(loaded?.steps, []);
  } finally {
    await close();
  }
});

test("tool store: read-time — load() throws (not silently drops) a step already-malformed in the row", async () => {
  const { db, close } = await createLocalDb();
  try {
    const workspaceId = await seedWorkspace(db);
    const [tool] = await db
      .insert(schema.tools)
      .values({
        workspaceId,
        name: "test_fixture_tool_already_bad",
        surface: "test_fixture_surface",
        // Bypasses DrizzleToolRegistry.saveSteps entirely.
        composition: { steps: [{ skill: "test_fixture_bad", resourceType: "touchpoint" }] }, // missing `action`
      })
      .returning({ id: schema.tools.id });
    assert.ok(tool);

    const registry = new DrizzleToolRegistry(db);
    await assert.rejects(() => registry.load(workspaceId, tool.id), /Invalid tool composition jsonb/);
  } finally {
    await close();
  }
});
