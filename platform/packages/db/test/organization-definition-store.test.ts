/**
 * DrizzleOrganizationDefinitionStore — round-trip + jsonb-validation coverage
 * against a real pglite-backed Postgres, mirroring capability-store.test.ts's
 * shape (write-time throws on malformed jsonb; getActive/listDrafts scoping).
 */
import assert from "node:assert/strict";
import test from "node:test";
import { createLocalDb, DrizzleOrganizationDefinitionStore, parseBlueprint, schema } from "../src/index.js";
import type { OrganizationBlueprint } from "@bridge/core";

async function seedOrganization(db: Awaited<ReturnType<typeof createLocalDb>>["db"]) {
  const [ws] = await db.insert(schema.organizations).values({ name: "test_fixture_ws_blueprint" }).returning({ id: schema.organizations.id });
  assert.ok(ws);
  return ws.id;
}

function blueprint(overrides: Partial<OrganizationBlueprint> = {}): OrganizationBlueprint {
  return {
    vocabulary: {},
    entities: [{ nodeType: "record", label: "Record", fields: [{ id: "name", label: "Name", kind: "text" }] }],
    views: [{ entity: "record", kind: "table" }],
    capabilities: [],
    ...overrides,
  };
}

test("organization definition store: create + get round-trip, blueprint jsonb preserved", async () => {
  const { db, close } = await createLocalDb();
  try {
    const organizationId = await seedOrganization(db);
    const store = new DrizzleOrganizationDefinitionStore(db);

    const created = await store.create({
      id: "50000000-0000-4000-8000-000000000001",
      organizationId,
      blueprint: blueprint({
        entities: [{
          nodeType: "record",
          label: "Record",
          fields: [
            { id: "name", label: "Name", kind: "text" },
            { id: "where", label: "Where", kind: "location" },
          ],
        }],
        views: [{
          entity: "record",
          kind: "map",
          config: { locationBy: "where" },
        }],
      }),
      version: 1,
      status: "draft",
      createdBy: null,
    });
    assert.equal(created.status, "draft");

    const fetched = await store.get(created.id);
    assert.ok(fetched);
    assert.equal(fetched.blueprint.entities[0]?.fields[1]?.kind, "location");
    assert.equal(fetched.blueprint.views[0]?.config?.locationBy, "where");
  } finally {
    await close();
  }
});

test("organization definition store: getActive returns only the active row, highest version", async () => {
  const { db, close } = await createLocalDb();
  try {
    const organizationId = await seedOrganization(db);
    const store = new DrizzleOrganizationDefinitionStore(db);

    await store.create({
      id: "50000000-0000-4000-8000-000000000002",
      organizationId,
      blueprint: blueprint(),
      version: 1,
      status: "archived",
      createdBy: null,
    });
    const activeRow = await store.create({
      id: "50000000-0000-4000-8000-000000000003",
      organizationId,
      blueprint: blueprint({ vocabulary: { Record: "Deal" } }),
      version: 2,
      status: "active",
      createdBy: null,
    });

    const active = await store.getActive(organizationId);
    assert.equal(active?.id, activeRow.id);
    assert.equal(active?.blueprint.vocabulary["Record"], "Deal");
  } finally {
    await close();
  }
});

test("organization definition store: listDrafts scopes to organization + draft status", async () => {
  const { db, close } = await createLocalDb();
  try {
    const organizationId = await seedOrganization(db);
    const otherOrganizationId = await seedOrganization(db);
    const store = new DrizzleOrganizationDefinitionStore(db);

    await store.create({ id: "50000000-0000-4000-8000-000000000004", organizationId, blueprint: blueprint(), version: 1, status: "draft", createdBy: null });
    await store.create({ id: "50000000-0000-4000-8000-000000000005", organizationId, blueprint: blueprint(), version: 1, status: "active", createdBy: null });
    await store.create({ id: "50000000-0000-4000-8000-000000000006", organizationId: otherOrganizationId, blueprint: blueprint(), version: 1, status: "draft", createdBy: null });

    const drafts = await store.listDrafts(organizationId);
    assert.equal(drafts.length, 1);
    assert.equal(drafts[0]?.id, "50000000-0000-4000-8000-000000000004");
  } finally {
    await close();
  }
});

test("organization definition store: setStatus transitions draft -> active", async () => {
  const { db, close } = await createLocalDb();
  try {
    const organizationId = await seedOrganization(db);
    const store = new DrizzleOrganizationDefinitionStore(db);
    const created = await store.create({
      id: "50000000-0000-4000-8000-000000000007",
      organizationId,
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

test("organization definition store: write-time — create throws on malformed blueprint instead of persisting it", async () => {
  const { db, close } = await createLocalDb();
  try {
    const organizationId = await seedOrganization(db);
    const store = new DrizzleOrganizationDefinitionStore(db);
    await assert.rejects(
      () =>
        store.create({
          id: "50000000-0000-4000-8000-000000000008",
          organizationId,
          // @ts-expect-error deliberately malformed for the test
          blueprint: { entities: "not-an-array" },
          version: 1,
          status: "draft",
          createdBy: null,
        }),
      /Invalid organization_definitions.blueprint jsonb/,
    );
  } finally {
    await close();
  }
});

test("parseBlueprint: throws on malformed shape rather than silently defaulting", () => {
  assert.throws(() => parseBlueprint({ entities: "nope" }), /Invalid organization_definitions.blueprint jsonb/);
});

test("parseBlueprint: persists canonical View Grammar metadata and migrates version-1 aliases", () => {
  const parsed = parseBlueprint({
    schemaVersion: 1,
    vocabulary: {},
    entities: [{
      nodeType: "place",
      label: "Place",
      fields: [
        { id: "name", label: "Name", kind: "text", required: true },
        { id: "stage", label: "Stage", kind: "select", options: ["open"] },
        { id: "where", label: "Where", kind: "location" },
        { id: "parent", label: "Parent", kind: "relation", relationTarget: "place", relationParent: true },
        { id: "related", label: "Related", kind: "relation", relationTarget: "person" },
      ],
    }],
    views: [
      { entity: "place", kind: "kanban", config: { groupBy: "stage" } },
      { entity: "place", kind: "network", config: { relationBy: "related", graphScope: "full" } },
      { entity: "place", kind: "form" },
      { entity: "place", kind: "map", config: { locationBy: "where" } },
      { entity: "place", kind: "tree", config: { parentBy: "parent" } },
    ],
    capabilities: [],
  });
  assert.equal(parsed.schemaVersion, 2);
  assert.deepEqual(parsed.views.map((view) => view.kind), ["board", "graph", "form", "map", "tree"]);
  assert.equal(parsed.views[1]?.config?.graphScope, "full");
  assert.equal(parsed.entities[0]?.fields[2]?.kind, "location");
});
