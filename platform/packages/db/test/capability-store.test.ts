/**
 * DrizzleCapabilityStore — round-trip + jsonb-validation coverage against a
 * real pglite-backed Postgres, mirroring governance-stores.test.ts's shape
 * (write-time throws on malformed jsonb; read-time throws rather than
 * silently coercing a pre-existing malformed row).
 */
import assert from "node:assert/strict";
import test from "node:test";
import { createLocalDb, DrizzleCapabilityStore, parseDependencies, parseEvidence, schema } from "../src/index.js";

async function seedWorkspace(db: Awaited<ReturnType<typeof createLocalDb>>["db"]) {
  const [ws] = await db.insert(schema.workspaces).values({ name: "test_fixture_ws_capability" }).returning({ id: schema.workspaces.id });
  assert.ok(ws);
  return ws.id;
}

test("capability store: createManifest + getManifest round-trip, dependencies jsonb preserved", async () => {
  const { db, close } = await createLocalDb();
  try {
    const workspaceId = await seedWorkspace(db);
    const store = new DrizzleCapabilityStore(db);

    const created = await store.createManifest({
      id: "20000000-0000-4000-8000-000000000001",
      workspaceId,
      capabilityType: "skill",
      name: "test_fixture_skill_alpha",
      version: "1.0.0",
      origin: "user_code",
      audience: "private",
      manifest: { permissions: [] },
      computedRisk: "informational",
      dependencies: [{ manifestId: "20000000-0000-4000-8000-000000000002", versionRange: "^1.0.0" }],
    });
    assert.equal(created.name, "test_fixture_skill_alpha");

    const fetched = await store.getManifest(created.id);
    assert.ok(fetched);
    assert.deepEqual(fetched.dependencies, [
      { manifestId: "20000000-0000-4000-8000-000000000002", versionRange: "^1.0.0" },
    ]);
    assert.equal(fetched.computedRisk, "informational");
  } finally {
    await close();
  }
});

test("capability store: listManifests paginates within a workspace", async () => {
  const { db, close } = await createLocalDb();
  try {
    const workspaceId = await seedWorkspace(db);
    const store = new DrizzleCapabilityStore(db);
    for (let i = 0; i < 3; i++) {
      await store.createManifest({
        id: `30000000-0000-4000-8000-00000000000${i}`,
        workspaceId,
        capabilityType: "tool",
        name: `test_fixture_tool_${i}`,
        version: "1.0.0",
        origin: "built_in",
        audience: "private",
        manifest: {},
        computedRisk: "advisory",
        dependencies: [],
      });
    }
    const page = await store.listManifests(workspaceId, { limit: 2, offset: 0 });
    assert.equal(page.total, 3);
    assert.equal(page.items.length, 2);
  } finally {
    await close();
  }
});

test("capability store: getManifestByNameVersion finds an existing manifest by its (workspace, name, version) natural key, null when absent (ADR-024 idempotency lookup)", async () => {
  const { db, close } = await createLocalDb();
  try {
    const workspaceId = await seedWorkspace(db);
    const store = new DrizzleCapabilityStore(db);
    const created = await store.createManifest({
      id: "25000000-0000-4000-8000-000000000001",
      workspaceId,
      capabilityType: "skill",
      name: "test_fixture_shared_capability",
      version: "1.0.0",
      origin: "user_code",
      audience: "private",
      manifest: {},
      computedRisk: "informational",
      dependencies: [],
    });

    const found = await store.getManifestByNameVersion(workspaceId, "test_fixture_shared_capability", "1.0.0");
    assert.ok(found);
    assert.equal(found.id, created.id);

    const missingVersion = await store.getManifestByNameVersion(workspaceId, "test_fixture_shared_capability", "2.0.0");
    assert.equal(missingVersion, null);

    const missingName = await store.getManifestByNameVersion(workspaceId, "test_fixture_nonexistent", "1.0.0");
    assert.equal(missingName, null);
  } finally {
    await close();
  }
});

test("capability store: upsertState creates then updates the ONE current-state row per manifest (unique manifest_id)", async () => {
  const { db, close } = await createLocalDb();
  try {
    const workspaceId = await seedWorkspace(db);
    const store = new DrizzleCapabilityStore(db);
    const manifestRow = await store.createManifest({
      id: "40000000-0000-4000-8000-000000000001",
      workspaceId,
      capabilityType: "workflow",
      name: "test_fixture_workflow",
      version: "1.0.0",
      origin: "ai_generated",
      audience: "private",
      manifest: {},
      computedRisk: "transformational",
      dependencies: [],
    });

    const first = await store.upsertState({
      manifestId: manifestRow.id,
      workspaceId,
      state: "draft",
      suspended: false,
      evidence: {},
    });
    const second = await store.upsertState({
      manifestId: manifestRow.id,
      workspaceId,
      state: "trusted",
      trustedUntil: "2026-10-04T00:00:00.000Z",
      suspended: false,
      evidence: { activeRunCount: 30, successRate: 0.95, violationCount: 0, ageDays: 60 },
    });

    assert.equal(first.id, second.id, "same manifest_id must update the one existing row, not insert a second");
    const fetched = await store.getState(manifestRow.id);
    assert.equal(fetched?.state, "trusted");
    assert.equal(fetched?.trustedUntil, "2026-10-04T00:00:00.000Z");
    assert.equal(fetched?.evidence.activeRunCount, 30);
  } finally {
    await close();
  }
});

test("capability store: write-time — createManifest throws on malformed dependencies instead of persisting it", async () => {
  const { db, close } = await createLocalDb();
  try {
    const workspaceId = await seedWorkspace(db);
    const store = new DrizzleCapabilityStore(db);
    await assert.rejects(
      () =>
        store.createManifest({
          id: "50000000-0000-4000-8000-000000000001",
          workspaceId,
          capabilityType: "skill",
          name: "test_fixture_bad_deps",
          version: "1.0.0",
          origin: "user_code",
          audience: "private",
          manifest: {},
          computedRisk: "informational",
          // @ts-expect-error — intentionally malformed to prove write-time validation
          dependencies: [{ manifestId: 123 }],
        }),
      /Invalid capability_manifests.dependencies jsonb/,
    );
    assert.equal(await store.getManifest("50000000-0000-4000-8000-000000000001"), null);
  } finally {
    await close();
  }
});

test("capability store: read-time — getManifest throws on a dependencies shape already-malformed in the row", async () => {
  const { db, close } = await createLocalDb();
  try {
    const workspaceId = await seedWorkspace(db);
    // Insert directly, bypassing DrizzleCapabilityStore.createManifest entirely —
    // simulates a row written before this fix existed, or by a raw SQL path.
    await db.insert(schema.capabilityManifests).values({
      id: "60000000-0000-4000-8000-000000000001",
      workspaceId,
      capabilityType: "skill",
      name: "test_fixture_malformed_row",
      version: "1.0.0",
      origin: "user_code",
      audience: "private",
      manifest: {},
      computedRisk: "informational",
      dependencies: ["not-an-object"],
    });
    const store = new DrizzleCapabilityStore(db);
    await assert.rejects(() => store.getManifest("60000000-0000-4000-8000-000000000001"), /Invalid capability_manifests.dependencies jsonb/);
  } finally {
    await close();
  }
});

test("parseEvidence: throws loudly on an unknown/extra key rather than silently dropping it", () => {
  assert.throws(() => parseEvidence({ activeRunCount: 1, bogusKey: true }), /Invalid capability_states.evidence jsonb/);
});

test("parseDependencies: empty/undefined input normalizes to an empty array", () => {
  assert.deepEqual(parseDependencies(undefined), []);
  assert.deepEqual(parseDependencies([]), []);
});
