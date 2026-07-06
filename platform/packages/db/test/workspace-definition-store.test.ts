/**
 * DrizzleWorkspaceDefinitionStore — round-trip + jsonb-validation coverage
 * against a real pglite-backed Postgres, mirroring capability-store.test.ts's
 * shape (write-time throws on malformed jsonb; getActive/listDrafts scoping).
 */
import assert from "node:assert/strict";
import test from "node:test";
import { createLocalDb, DrizzleWorkspaceDefinitionStore, parseBlueprint, schema } from "../src/index.js";
import type { WorkspaceBlueprint } from "@bridge/core";

async function seedWorkspace(db: Awaited<ReturnType<typeof createLocalDb>>["db"]) {
  const [ws] = await db.insert(schema.workspaces).values({ name: "dummy_ws_blueprint" }).returning({ id: schema.workspaces.id });
  assert.ok(ws);
  return ws.id;
}

function blueprint(overrides: Partial<WorkspaceBlueprint> = {}): WorkspaceBlueprint {
  return {
    vocabulary: {},
    entities: [{ nodeType: "initiative", label: "Initiative", fields: [{ id: "name", label: "Name", kind: "text" }] }],
    views: [{ entity: "initiative", kind: "table" }],
    capabilities: [],
    ...overrides,
  };
}

test("workspace definition store: create + get round-trip, blueprint jsonb preserved", async () => {
  const { db, close } = await createLocalDb();
  try {
    const workspaceId = await seedWorkspace(db);
    const store = new DrizzleWorkspaceDefinitionStore(db);

    const created = await store.create({
      id: "50000000-0000-4000-8000-000000000001",
      workspaceId,
      blueprint: blueprint(),
      version: 1,
      status: "draft",
      createdBy: null,
    });
    assert.equal(created.status, "draft");

    const fetched = await store.get(created.id);
    assert.ok(fetched);
    assert.deepEqual(fetched.blueprint.entities[0]?.nodeType, "initiative");
  } finally {
    await close();
  }
});

test("workspace definition store: getActive returns only the active row, highest version", async () => {
  const { db, close } = await createLocalDb();
  try {
    const workspaceId = await seedWorkspace(db);
    const store = new DrizzleWorkspaceDefinitionStore(db);

    await store.create({
      id: "50000000-0000-4000-8000-000000000002",
      workspaceId,
      blueprint: blueprint(),
      version: 1,
      status: "archived",
      createdBy: null,
    });
    const activeRow = await store.create({
      id: "50000000-0000-4000-8000-000000000003",
      workspaceId,
      blueprint: blueprint({ vocabulary: { Initiative: "Deal" } }),
      version: 2,
      status: "active",
      createdBy: null,
    });

    const active = await store.getActive(workspaceId);
    assert.equal(active?.id, activeRow.id);
    assert.equal(active?.blueprint.vocabulary["Initiative"], "Deal");
  } finally {
    await close();
  }
});

test("workspace definition store: listDrafts scopes to workspace + draft status", async () => {
  const { db, close } = await createLocalDb();
  try {
    const workspaceId = await seedWorkspace(db);
    const otherWorkspaceId = await seedWorkspace(db);
    const store = new DrizzleWorkspaceDefinitionStore(db);

    await store.create({ id: "50000000-0000-4000-8000-000000000004", workspaceId, blueprint: blueprint(), version: 1, status: "draft", createdBy: null });
    await store.create({ id: "50000000-0000-4000-8000-000000000005", workspaceId, blueprint: blueprint(), version: 1, status: "active", createdBy: null });
    await store.create({ id: "50000000-0000-4000-8000-000000000006", workspaceId: otherWorkspaceId, blueprint: blueprint(), version: 1, status: "draft", createdBy: null });

    const drafts = await store.listDrafts(workspaceId);
    assert.equal(drafts.length, 1);
    assert.equal(drafts[0]?.id, "50000000-0000-4000-8000-000000000004");
  } finally {
    await close();
  }
});

test("workspace definition store: setStatus transitions draft -> active", async () => {
  const { db, close } = await createLocalDb();
  try {
    const workspaceId = await seedWorkspace(db);
    const store = new DrizzleWorkspaceDefinitionStore(db);
    const created = await store.create({
      id: "50000000-0000-4000-8000-000000000007",
      workspaceId,
      blueprint: blueprint(),
      version: 1,
      status: "draft",
      createdBy: null,
    });
    const updated = await store.setStatus(created.id, "active");
    assert.equal(updated.status, "active");
  } finally {
    await close();
  }
});

test("workspace definition store: write-time — create throws on malformed blueprint instead of persisting it", async () => {
  const { db, close } = await createLocalDb();
  try {
    const workspaceId = await seedWorkspace(db);
    const store = new DrizzleWorkspaceDefinitionStore(db);
    await assert.rejects(
      () =>
        store.create({
          id: "50000000-0000-4000-8000-000000000008",
          workspaceId,
          // @ts-expect-error deliberately malformed for the test
          blueprint: { entities: "not-an-array" },
          version: 1,
          status: "draft",
          createdBy: null,
        }),
      /Invalid workspace_definitions.blueprint jsonb/,
    );
  } finally {
    await close();
  }
});

test("parseBlueprint: throws on malformed shape rather than silently defaulting", () => {
  assert.throws(() => parseBlueprint({ entities: "nope" }), /Invalid workspace_definitions.blueprint jsonb/);
});
