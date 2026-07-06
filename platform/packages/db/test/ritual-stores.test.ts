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
  skill: "dummy_send_note",
  action: "write" as const,
  resourceType: "touchpoint" as const,
};

async function seedWorkspace(db: Awaited<ReturnType<typeof createLocalDb>>["db"]) {
  const [ws] = await db
    .insert(schema.workspaces)
    .values({ name: "dummy_ws_ritual_validation" })
    .returning({ id: schema.workspaces.id });
  assert.ok(ws);
  return ws.id;
}

test("ritual store: write-time — saveSteps throws on a malformed step instead of persisting it", async () => {
  const { db, close } = await createLocalDb();
  try {
    const workspaceId = await seedWorkspace(db);
    const [ritual] = await db
      .insert(schema.rituals)
      .values({
        workspaceId,
        name: "dummy_ritual_write_reject",
        trigger: {},
        skillPipeline: [],
      })
      .returning({ id: schema.rituals.id });
    assert.ok(ritual);

    const registry = new DrizzleRitualRegistry(db);

    // Missing required `action` field — must throw, never silently no-op.
    await assert.rejects(
      () => registry.saveSteps(workspaceId, ritual.id, [{ skill: "dummy_bad_step", resourceType: "touchpoint" }]),
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
        name: "dummy_ritual_write_ok",
        trigger: {},
        skillPipeline: [],
      })
      .returning({ id: schema.rituals.id });
    assert.ok(ritual);

    const registry = new DrizzleRitualRegistry(db);
    await registry.saveSteps(workspaceId, ritual.id, [validStep]);

    const loaded = await registry.load(workspaceId, ritual.id);
    assert.equal(loaded?.steps.length, 1);
    assert.equal(loaded?.steps[0]?.skill, "dummy_send_note");
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
        name: "dummy_ritual_already_bad",
        trigger: {},
        skillPipeline: [{ skill: "dummy_bad", action: "not-a-real-action", resourceType: "touchpoint" }],
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
        name: "dummy_tool_write_reject",
        surface: "dummy_surface",
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
        name: "dummy_tool_already_bad",
        surface: "dummy_surface",
        // Bypasses DrizzleToolRegistry.saveSteps entirely.
        composition: { steps: [{ skill: "dummy_bad", resourceType: "touchpoint" }] }, // missing `action`
      })
      .returning({ id: schema.tools.id });
    assert.ok(tool);

    const registry = new DrizzleToolRegistry(db);
    await assert.rejects(() => registry.load(workspaceId, tool.id), /Invalid tool composition jsonb/);
  } finally {
    await close();
  }
});
