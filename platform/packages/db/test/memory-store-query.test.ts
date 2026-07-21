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

function draft(id: string, organizationId: string, content: unknown, overrides: Partial<MemoryWrite> = {}): MemoryWrite {
  return {
    id,
    organizationId,
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

async function seedOrganization(db: Awaited<ReturnType<typeof createLocalDb>>["db"]): Promise<string> {
  const [ws] = await db.insert(schema.organizations).values({ name: "test_fixture_ws_query" }).returning({ id: schema.organizations.id });
  assert.ok(ws);
  return ws.id;
}

test("retrieve: contentPathEquals pushes a dot-path JSON predicate into the SQL WHERE", async () => {
  const { db, close } = await createLocalDb();
  try {
    const organizationId = await seedOrganization(db);
    const store = new DrizzleMemoryStore(db);
    await store.write(draft("00000000-0000-4000-8000-000000000101", organizationId, { anchor: { moduleId: "record" }, kind: "red_flag" }));
    await store.write(draft("00000000-0000-4000-8000-000000000102", organizationId, { anchor: { moduleId: "event" }, kind: "red_flag" }));
    await store.write(draft("00000000-0000-4000-8000-000000000103", organizationId, { anchor: { moduleId: "record" }, kind: "red_flag" }));

    const rows = await store.retrieve(
      { sourceRefType: "feedback", contentPathEquals: [{ path: "anchor.moduleId", equals: "record" }] },
      { organizationId, userId: OWNER },
    );
    assert.equal(rows.length, 2);
    assert.ok(rows.every((r) => JSON.parse(r.content).anchor.moduleId === "record"));
  } finally {
    await close();
  }
});

test("retrieve: contentPathEquals never throws on a non-JSON content row anywhere in the queried set (review round-5 item 8)", async () => {
  const { db, close } = await createLocalDb();
  try {
    const organizationId = await seedOrganization(db);
    const store = new DrizzleMemoryStore(db);
    // A large batch of non-JSON, sourceRefType:"feedback" content — plain
    // text, NOT JSON.stringify'd — simulating a hypothetical unrelated
    // write path that also happens to classify its content this way.
    // Reproduced a REAL query failure during development: Postgres does
    // NOT guarantee left-to-right evaluation of AND-combined conditions,
    // so a naive unconditional `content::jsonb` cast broke the WHOLE query
    // once enough non-JSON rows existed for the planner to evaluate the
    // cast before the sourceRefType filter narrowed anything.
    for (let i = 0; i < 60; i += 1) {
      await store.write(
        draft(`00000000-0000-4000-8000-0000000002${String(i).padStart(2, "0")}`, organizationId, null, {
          content: `plain text, not JSON at all #${i} {{{`,
        }),
      );
    }
    await store.write(draft("00000000-0000-4000-8000-000000000299", organizationId, { kind: "red_flag", anchor: { moduleId: "record" } }));

    const rows = await store.retrieve(
      { sourceRefType: "feedback", contentPathEquals: [{ path: "kind", equals: "red_flag" }] },
      { organizationId, userId: OWNER },
    );
    assert.equal(rows.length, 1);
    assert.equal(rows[0]!.id, "00000000-0000-4000-8000-000000000299");
  } finally {
    await close();
  }
});

test("retrieve: contentPathEquals with multiple predicates ANDs them together", async () => {
  const { db, close } = await createLocalDb();
  try {
    const organizationId = await seedOrganization(db);
    const store = new DrizzleMemoryStore(db);
    await store.write(draft("00000000-0000-4000-8000-000000000201", organizationId, { anchor: { moduleId: "record", recordId: "r1" } }));
    await store.write(draft("00000000-0000-4000-8000-000000000202", organizationId, { anchor: { moduleId: "record", recordId: "r2" } }));

    const rows = await store.retrieve(
      {
        sourceRefType: "feedback",
        contentPathEquals: [
          { path: "anchor.moduleId", equals: "record" },
          { path: "anchor.recordId", equals: "r2" },
        ],
      },
      { organizationId, userId: OWNER },
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
    const organizationId = await seedOrganization(db);
    const store = new DrizzleMemoryStore(db);
    const ids = Array.from({ length: 5 }, (_, i) => `00000000-0000-4000-8000-00000000030${i}`);
    for (const id of ids) {
      await store.write(draft(id, organizationId, { seq: id }));
    }

    const seen: string[] = [];
    let cursor: { createdAt: string; id: string } | undefined;
    for (let page = 0; page < 10; page += 1) {
      const rows = await store.retrieve({ sourceRefType: "feedback", order: "asc", limit: 2, ...(cursor ? { cursor } : {}) }, { organizationId, userId: OWNER });
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
    const organizationId = await seedOrganization(db);
    const store = new DrizzleMemoryStore(db);
    await store.write(draft("00000000-0000-4000-8000-000000000401", organizationId, { seq: 1 }));
    await store.write(draft("00000000-0000-4000-8000-000000000402", organizationId, { seq: 2 }));

    const page1 = await store.retrieve({ sourceRefType: "feedback", order: "asc", limit: 1 }, { organizationId, userId: OWNER });
    assert.equal(page1.length, 1);
    assert.equal(page1[0]!.id, "00000000-0000-4000-8000-000000000401");

    // Simulate a concurrent insert landing between the two page fetches —
    // with offset pagination this could shift page 2's results; keyset
    // pagination is immune since it anchors on the last-seen row's own
    // (createdAt, id), not a row count.
    await store.write(draft("00000000-0000-4000-8000-000000000399", organizationId, { seq: 0 }));

    const cursor = { createdAt: page1[0]!.createdAt, id: page1[0]!.id };
    const page2 = await store.retrieve({ sourceRefType: "feedback", order: "asc", limit: 10, cursor }, { organizationId, userId: OWNER });
    const ids = page2.map((r) => r.id);
    assert.ok(!ids.includes("00000000-0000-4000-8000-000000000401"), "must not re-return a row already seen in page 1");
    assert.ok(ids.includes("00000000-0000-4000-8000-000000000402"), "must still return the row after the cursor");
  } finally {
    await close();
  }
});
