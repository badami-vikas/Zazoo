/**
 * DrizzleAgentStore — jsonb validation coverage for `agents.capability_scope`
 * and `agents.allowed_skills`.
 *
 * Before this fix, a malformed `capability_scope` silently fell back to an
 * empty scope / 'all' dataScope instead of surfacing the corruption — a
 * governance hole (a corrupted row could silently run as unrestricted). Now:
 * WRITE validates and throws before a bad row is persisted (`saveCapabilityScope`
 * / `saveAllowedSkills`), and READ throws if a row is already malformed (a
 * pre-fix row, or one written by a raw insert bypassing the save methods)
 * instead of silently coercing it.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { createLocalDb, DrizzleAgentStore, schema } from "../src/index.js";

async function seedWorkspaceAndAgent(
  db: Awaited<ReturnType<typeof createLocalDb>>["db"],
  overrides: { capabilityScope?: unknown } = {},
) {
  const [ws] = await db
    .insert(schema.workspaces)
    .values({ name: "test_fixture_ws_agent_scope" })
    .returning({ id: schema.workspaces.id });
  assert.ok(ws);
  const [agent] = await db
    .insert(schema.agents)
    .values({
      workspaceId: ws.id,
      name: "test_fixture_agent",
      capabilityScope: overrides.capabilityScope ?? {},
    })
    .returning({ id: schema.agents.id });
  assert.ok(agent);
  return { workspaceId: ws.id, agentId: agent.id };
}

test("agent store: write-time — saveCapabilityScope throws on a malformed scope instead of persisting it", async () => {
  const { db, close } = await createLocalDb();
  try {
    const { agentId } = await seedWorkspaceAndAgent(db);
    const store = new DrizzleAgentStore(db);

    // `resources` must be an array of strings — a number in the array is invalid.
    await assert.rejects(
      () => store.saveCapabilityScope(agentId, { resources: [123] }),
      /Invalid agents.capability_scope jsonb/,
    );

    // Confirm nothing was persisted — the row's scope is still the seeded empty default.
    assert.deepEqual(await store.capabilityScope(agentId), []);
  } finally {
    await close();
  }
});

test("agent store: write-time — saveCapabilityScope persists and capabilityScope()/dataScope() round-trip", async () => {
  const { db, close } = await createLocalDb();
  try {
    const { agentId } = await seedWorkspaceAndAgent(db);
    const store = new DrizzleAgentStore(db);

    await store.saveCapabilityScope(agentId, {
      resources: ["person:read", "touchpoint:write"],
      dataScope: "private",
    });

    assert.deepEqual(await store.capabilityScope(agentId), ["person:read", "touchpoint:write"]);
    assert.equal(await store.dataScope(agentId), "private");
  } finally {
    await close();
  }
});

test("agent store: read-time — capabilityScope() throws (not silently falls back) on a scope already-malformed in the row", async () => {
  const { db, close } = await createLocalDb();
  try {
    // Insert directly with a bad capability_scope shape, bypassing
    // DrizzleAgentStore.saveCapabilityScope entirely — simulates a row
    // written before this fix existed, or by another process/raw SQL path.
    const { agentId } = await seedWorkspaceAndAgent(db, {
      capabilityScope: { resources: "not-an-array" },
    });
    const store = new DrizzleAgentStore(db);

    await assert.rejects(() => store.capabilityScope(agentId), /Invalid agents.capability_scope jsonb/);
    await assert.rejects(() => store.dataScope(agentId), /Invalid agents.capability_scope jsonb/);
  } finally {
    await close();
  }
});

test("agent store: write-time — saveAllowedSkills throws on a malformed list instead of persisting it", async () => {
  const { db, close } = await createLocalDb();
  try {
    const { agentId } = await seedWorkspaceAndAgent(db);
    const store = new DrizzleAgentStore(db);

    await assert.rejects(
      () => store.saveAllowedSkills(agentId, ["test_fixture_skill_ok", 42]),
      /Invalid agents.allowed_skills jsonb/,
    );

    assert.deepEqual(await store.allowedSkills(agentId), []);
  } finally {
    await close();
  }
});
