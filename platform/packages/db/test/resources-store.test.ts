/**
 * DrizzleResourcesStore against a real pglite-backed Postgres. Proves the
 * governed organization-scoped Resources CRUD (frontend-migration-scoping.md gap
 * #4): create round-trips all fields (and omits optional ones), list paginates
 * with a correct total, and reads are tenant-isolated by organization.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { createLocalDb, DrizzleResourcesStore, schema } from "../src/index.js";

test("resources: create (full + minimal) + list paginate + tenant isolation", async () => {
  const { db, close } = await createLocalDb();
  try {
    const [ws] = await db
      .insert(schema.organizations)
      .values({ name: "test_fixture_ws_resources" })
      .returning({ id: schema.organizations.id });
    const [ws2] = await db
      .insert(schema.organizations)
      .values({ name: "test_fixture_ws_resources_other" })
      .returning({ id: schema.organizations.id });
    assert.ok(ws && ws2);
    const store = new DrizzleResourcesStore(db);

    const full = await store.create({
      organizationId: ws.id,
      title: "Deep Work",
      kind: "book",
      url: "https://example.com/deep-work",
      notes: "on focus",
      tags: ["productivity", "focus"],
    });
    assert.ok(full.id);
    assert.equal(full.title, "Deep Work");
    assert.equal(full.kind, "book");
    assert.equal(full.url, "https://example.com/deep-work");
    assert.equal(full.notes, "on focus");
    assert.deepEqual(full.tags, ["productivity", "focus"]);

    // Optional fields omitted → NULL url/notes, empty tags default.
    const minimal = await store.create({ organizationId: ws.id, title: "Some Podcast", kind: "podcast" });
    assert.equal(minimal.url, null);
    assert.equal(minimal.notes, null);
    assert.deepEqual(minimal.tags, []);

    await store.create({ organizationId: ws.id, title: "A Vlog", kind: "vlog" });
    await store.create({ organizationId: ws2.id, title: "Other Organization Book", kind: "book" });

    const page1 = await store.list(ws.id, { limit: 2, offset: 0 });
    assert.equal(page1.total, 3);
    assert.equal(page1.items.length, 2);

    const page2 = await store.list(ws.id, { limit: 2, offset: 2 });
    assert.equal(page2.total, 3);
    assert.equal(page2.items.length, 1);

    // Tenant isolation: ws2's list never sees ws's rows.
    const other = await store.list(ws2.id, { limit: 10, offset: 0 });
    assert.equal(other.total, 1);
    assert.equal(other.items[0]?.title, "Other Organization Book");
  } finally {
    await close();
  }
});
