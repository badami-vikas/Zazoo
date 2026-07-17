/**
 * `DrizzleMemoryStore.retrieve`'s TASK-010 review round-4 item 7/8 additions
 * against a real pglite-backed Postgres: `contentPathEquals` (a JSON
 * predicate pushed into the SQL WHERE via `content::jsonb #>>`, no schema
 * migration) and keyset `cursor`/`order` pagination (stable under
 * concurrent insert between page fetches, unlike offset).
 */
import assert from "node:assert/strict";
import test from "node:test";
import type { MemoryWrite } from "@bridge/core";
import { createLocalDb, DrizzleMemoryStore, schema } from "../src/index.js";

const OWNER = "aaaaaaaa-0000-4000-8000-000000000002";

function draft(id: string, workspaceId: string, content: unknown, overrides: Partial<MemoryWrite> = {}): MemoryWrite {
  return {
    id,
    workspaceId,
    type: "semantic",
    scope: "private",
    content: JSON.stringify(content),
    sourceRefType: "feedback",
    confidence: 1,
    trustOrigin: "user_content",
    plane: "local",
    createdBy: OWNER,
    ownerUserId: OWNER,
    ...overrides,
  };
}

async function seedWorkspace(db: Awaited<ReturnType<typeof createLocalDb>>["db"]): Promise<string> {
  const [ws] = await db.insert(schema.workspaces).values({ name: "test_fixture_ws_query" }).returning({ id: schema.workspaces.id });
  assert.ok(ws);
  return ws.id;
}

test("retrieve: contentPathEquals pushes a dot-path JSON predicate into the SQL WHERE", async () => {
  const { db, close } = await createLocalDb();
  try {
    const workspaceId = await seedWorkspace(db);
    const store = new DrizzleMemoryStore(db);
    await store.write(draft("00000000-0000-4000-8000-000000000101", workspaceId, { anchor: { moduleId: "initiative" }, kind: "red_flag" }));
    await store.write(draft("00000000-0000-4000-8000-000000000102", workspaceId, { anchor: { moduleId: "touchpoint" }, kind: "red_flag" }));
    await store.write(draft("00000000-0000-4000-8000-000000000103", workspaceId, { anchor: { moduleId: "initiative" }, kind: "red_flag" }));

    const rows = await store.retrieve(
      { sourceRefType: "feedback", contentPathEquals: [{ path: "anchor.moduleId", equals: "initiative" }] },
      { workspaceId, userId: OWNER },
    );
    assert.equal(rows.length, 2);
    assert.ok(rows.every((r) => JSON.parse(r.content).anchor.moduleId === "initiative"));
  } finally {
    await close();
  }
});

test("retrieve: contentPathEquals with multiple predicates ANDs them together", async () => {
  const { db, close } = await createLocalDb();
  try {
    const workspaceId = await seedWorkspace(db);
    const store = new DrizzleMemoryStore(db);
    await store.write(draft("00000000-0000-4000-8000-000000000201", workspaceId, { anchor: { moduleId: "initiative", recordId: "r1" } }));
    await store.write(draft("00000000-0000-4000-8000-000000000202", workspaceId, { anchor: { moduleId: "initiative", recordId: "r2" } }));

    const rows = await store.retrieve(
      {
        sourceRefType: "feedback",
        contentPathEquals: [
          { path: "anchor.moduleId", equals: "initiative" },
          { path: "anchor.recordId", equals: "r2" },
        ],
      },
      { workspaceId, userId: OWNER },
    );
    assert.equal(rows.length, 1);
    assert.equal(rows[0]!.id, "00000000-0000-4000-8000-000000000202");
  } finally {
    await close();
  }
});

test("retrieve: order 'asc' + cursor keyset pagination returns every row exactly once, oldest first", async () => {
  const { db, close } = await createLocalDb();
  try {
    const workspaceId = await seedWorkspace(db);
    const store = new DrizzleMemoryStore(db);
    const ids = Array.from({ length: 5 }, (_, i) => `00000000-0000-4000-8000-00000000030${i}`);
    for (const id of ids) {
      await store.write(draft(id, workspaceId, { seq: id }));
    }

    const seen: string[] = [];
    let cursor: { createdAt: string; id: string } | undefined;
    for (let page = 0; page < 10; page += 1) {
      const rows = await store.retrieve({ sourceRefType: "feedback", order: "asc", limit: 2, ...(cursor ? { cursor } : {}) }, { workspaceId, userId: OWNER });
      if (rows.length === 0) break;
      seen.push(...rows.map((r) => r.id));
      const last = rows[rows.length - 1]!;
      cursor = { createdAt: last.createdAt, id: last.id };
    }
    assert.deepEqual(seen, ids, "keyset pagination must return every row exactly once, in ascending order, with no duplicate/omission");
  } finally {
    await close();
  }
});

test("retrieve: a row inserted between keyset pages is never duplicated or omitted", async () => {
  const { db, close } = await createLocalDb();
  try {
    const workspaceId = await seedWorkspace(db);
    const store = new DrizzleMemoryStore(db);
    await store.write(draft("00000000-0000-4000-8000-000000000401", workspaceId, { seq: 1 }));
    await store.write(draft("00000000-0000-4000-8000-000000000402", workspaceId, { seq: 2 }));

    const page1 = await store.retrieve({ sourceRefType: "feedback", order: "asc", limit: 1 }, { workspaceId, userId: OWNER });
    assert.equal(page1.length, 1);
    assert.equal(page1[0]!.id, "00000000-0000-4000-8000-000000000401");

    // Simulate a concurrent insert landing between the two page fetches —
    // with offset pagination this could shift page 2's results; keyset
    // pagination is immune since it anchors on the last-seen row's own
    // (createdAt, id), not a row count.
    await store.write(draft("00000000-0000-4000-8000-000000000399", workspaceId, { seq: 0 }));

    const cursor = { createdAt: page1[0]!.createdAt, id: page1[0]!.id };
    const page2 = await store.retrieve({ sourceRefType: "feedback", order: "asc", limit: 10, cursor }, { workspaceId, userId: OWNER });
    const ids = page2.map((r) => r.id);
    assert.ok(!ids.includes("00000000-0000-4000-8000-000000000401"), "must not re-return a row already seen in page 1");
    assert.ok(ids.includes("00000000-0000-4000-8000-000000000402"), "must still return the row after the cursor");
  } finally {
    await close();
  }
});
