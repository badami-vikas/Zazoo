/**
 * Saved Views (TASK-062) — the lifecycle rules that make a View durable
 * WITHOUT making it everyone's: ownership, the personal/organization split,
 * per-Database isolation, and the one-name rule the List dropdown depends on.
 */
import assert from "node:assert/strict";
import test from "node:test";
import {
  InMemoryViewConfigStore,
  SavedViewNameTakenError,
  SavedViewNotFoundError,
  type SavedViewRecord,
} from "../src/index.js";

const ORG = "org-1";
const OWNER = "user-owner";
const OTHER = "user-other";

function record(overrides: Partial<SavedViewRecord> = {}): SavedViewRecord {
  return {
    id: "view-1",
    organizationId: ORG,
    ownerUserId: OWNER,
    databaseId: "deals",
    name: "Hot deals",
    scope: "personal",
    config: { id: "v", kind: "table", sorts: [], rowFilters: [], filterMatch: "all", groupBy: null },
    hiddenColumns: ["notes"],
    createdAt: "2026-09-03T00:00:00.000Z",
    updatedAt: "2026-09-03T00:00:00.000Z",
    ...overrides,
  };
}

test("a saved View survives as configuration — both halves of it", async () => {
  const store = new InMemoryViewConfigStore();
  await store.create(record());
  const [saved] = await store.list(ORG, OWNER, "deals");
  assert.equal(saved?.name, "Hot deals");
  assert.equal(saved?.config.kind, "table");
  // Column visibility is the shell's state and is saved beside the config; a
  // View that restored filters but not hidden columns is not the View.
  assert.deepEqual(saved?.hiddenColumns, ["notes"]);
});

test("a personal View is invisible to everyone else; an organization one is readable and still not writable", async () => {
  const store = new InMemoryViewConfigStore();
  await store.create(record({ id: "personal-1", name: "Mine", scope: "personal" }));
  await store.create(record({ id: "shared-1", name: "Ours", scope: "organization" }));

  const mine = await store.list(ORG, OWNER, "deals");
  assert.deepEqual(mine.map((view) => view.name), ["Mine", "Ours"]);

  const theirs = await store.list(ORG, OTHER, "deals");
  assert.deepEqual(theirs.map((view) => view.name), ["Ours"]);

  // Readable is not writable — a shared View anyone could rewrite is not a
  // share, and the failure reports as not-found rather than as forbidden.
  await assert.rejects(
    () => store.update(ORG, OTHER, "shared-1", { name: "Hijacked" }, "2026-09-03T01:00:00.000Z"),
    SavedViewNotFoundError,
  );
  await assert.rejects(() => store.remove(ORG, OTHER, "shared-1"), SavedViewNotFoundError);
});

test("Views never cross Databases, and never cross Organizations", async () => {
  const store = new InMemoryViewConfigStore();
  await store.create(record({ id: "deals-1", databaseId: "deals", name: "Deals view" }));
  await store.create(record({ id: "people-1", databaseId: "people", name: "People view" }));
  await store.create(record({ id: "other-org", organizationId: "org-2", name: "Elsewhere" }));

  assert.deepEqual(
    (await store.list(ORG, OWNER, "deals")).map((view) => view.name),
    ["Deals view"],
  );
  assert.deepEqual(
    (await store.list(ORG, OWNER, "people")).map((view) => view.name),
    ["People view"],
  );
  assert.deepEqual(await store.list("org-3", OWNER, "deals"), []);
});

test("one name per Database per owner — on create and on rename", async () => {
  const store = new InMemoryViewConfigStore();
  await store.create(record({ id: "a", name: "Hot deals" }));
  await assert.rejects(
    () => store.create(record({ id: "b", name: "  hot DEALS " })),
    SavedViewNameTakenError,
    "case and surrounding space do not make a different name in a dropdown",
  );
  // A different owner may reuse the name — the collision is per person.
  await store.create(record({ id: "c", ownerUserId: OTHER, name: "Hot deals" }));
  // And renaming into a taken name is refused the same way creating one is.
  await store.create(record({ id: "d", name: "Cold deals" }));
  await assert.rejects(
    () => store.update(ORG, OWNER, "d", { name: "Hot deals" }, "2026-09-03T02:00:00.000Z"),
    SavedViewNameTakenError,
  );
});

test("updating rewrites the configuration and stamps the time; deleting removes it", async () => {
  const store = new InMemoryViewConfigStore();
  await store.create(record());
  const updated = await store.update(
    ORG,
    OWNER,
    "view-1",
    {
      config: { id: "v", kind: "board", sorts: [], rowFilters: [], filterMatch: "all", groupBy: "stage" },
      hiddenColumns: [],
      scope: "organization",
    },
    "2026-09-03T03:00:00.000Z",
  );
  assert.equal(updated.config.kind, "board");
  assert.equal(updated.scope, "organization");
  assert.deepEqual(updated.hiddenColumns, []);
  assert.equal(updated.updatedAt, "2026-09-03T03:00:00.000Z");
  assert.equal(updated.createdAt, "2026-09-03T00:00:00.000Z", "creation time is not rewritten");

  await store.remove(ORG, OWNER, "view-1");
  assert.deepEqual(await store.list(ORG, OWNER, "deals"), []);
  await assert.rejects(() => store.remove(ORG, OWNER, "view-1"), SavedViewNotFoundError);
});
