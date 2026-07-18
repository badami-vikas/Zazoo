/**
 * DrizzleMemoryStore + ledger.trust_origin (Batch 4: MEM-1 + PI-1) against a real
 * pglite-backed Postgres. Proves:
 *  - migration 0009 applies (memories table + ledger.trust_origin column exist);
 *  - PI-1: a ledger row's trust_origin round-trips through the store;
 *  - MEM-1: retrieval is authority-scoped AT THE STORE BOUNDARY by classification
 *    (public/workspace → any member; private → owner only) and tenant-isolated;
 *  - MEM-1: supersede is append-only (prior row retained, excluded by default).
 */
import assert from "node:assert/strict";
import test from "node:test";
import { InMemoryMemoryStore, type LedgerEntry, type MemoryWrite } from "@bridge/core";
import { createLocalDb, DrizzleLedgerStore, DrizzleMemoryStore, schema } from "../src/index.js";

const USER_A = "aaaaaaaa-0000-4000-8000-000000000001";
const USER_B = "bbbbbbbb-0000-4000-8000-000000000002";
const NIL_ACTOR = "00000000-0000-0000-0000-00000000dead";

function mem(overrides: Partial<MemoryWrite> & { id: string; workspaceId: string }): MemoryWrite {
  return {
    type: "episodic",
    scope: "workspace",
    content: "test_fixture_memory",
    confidence: 0.5,
    trustOrigin: "untrusted_external",
    plane: "local",
    createdBy: "test_fixture_provider",
    ...overrides,
  };
}

test("in-memory memories enforce one replay-idempotent successor", async () => {
  const store = new InMemoryMemoryStore();
  const workspaceId = "10000000-0000-4000-8000-000000000001";
  const original = await store.write(mem({
    id: "10000000-0000-4000-8000-000000000002",
    workspaceId,
    scope: "private",
    ownerUserId: USER_A,
    createdAt: "2026-07-18T00:00:00.000Z",
  }));
  const first = mem({
    id: "10000000-0000-4000-8000-000000000003",
    workspaceId,
    scope: "private",
    ownerUserId: USER_A,
    content: "first correction",
    createdAt: "2026-07-18T00:01:00.000Z",
  });
  const second = mem({
    id: "10000000-0000-4000-8000-000000000004",
    workspaceId,
    scope: "private",
    ownerUserId: USER_A,
    content: "competing correction",
    createdAt: "2026-07-18T00:02:00.000Z",
  });
  const results = await Promise.allSettled([
    store.supersede(original.id, first),
    store.supersede(original.id, second),
  ]);
  assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
  assert.equal(results.filter((result) => result.status === "rejected").length, 1);
  const winner = results.find(
    (result): result is PromiseFulfilledResult<Awaited<ReturnType<typeof store.supersede>>> =>
      result.status === "fulfilled",
  )!.value;
  assert.deepEqual(
    await store.supersede(original.id, winner.id === first.id ? first : second),
    winner,
  );
});

test("memory snapshot watermark keeps offset pages stable across later writes", async () => {
  const store = new InMemoryMemoryStore();
  const workspaceId = "10000000-0000-4000-8000-000000000011";
  const oldest = await store.write(mem({
    id: "10000000-0000-4000-8000-000000000012",
    workspaceId,
    createdAt: "2026-07-18T00:00:00.000Z",
  }));
  const newestAtSnapshot = await store.write(mem({
    id: "10000000-0000-4000-8000-000000000013",
    workspaceId,
    createdAt: "2026-07-18T00:01:00.000Z",
  }));
  const snapshotAt = "2026-07-18T00:01:30.000Z";
  assert.deepEqual(
    (await store.retrieve(
      { snapshotAt, limit: 1, offset: 0 },
      { workspaceId, userId: USER_A },
    )).map((entry) => entry.id),
    [newestAtSnapshot.id],
  );
  await store.write(mem({
    id: "10000000-0000-4000-8000-000000000014",
    workspaceId,
    createdAt: "2026-07-18T00:02:00.000Z",
  }));
  await store.supersede(oldest.id, mem({
    id: "10000000-0000-4000-8000-000000000015",
    workspaceId,
    content: "later correction",
    createdAt: "2026-07-18T00:03:00.000Z",
  }));
  assert.deepEqual(
    (await store.retrieve(
      { snapshotAt, limit: 1, offset: 1 },
      { workspaceId, userId: USER_A },
    )).map((entry) => entry.id),
    [oldest.id],
  );
});

test("ledger: trust_origin round-trips through DrizzleLedgerStore (PI-1)", async () => {
  const { db, close } = await createLocalDb();
  try {
    const [ws] = await db
      .insert(schema.workspaces)
      .values({ name: "test_fixture_ws_trust_origin" })
      .returning({ id: schema.workspaces.id });
    assert.ok(ws);
    const store = new DrizzleLedgerStore(db);

    const entry: LedgerEntry = {
      id: "10000000-0000-4000-8000-0000000000a1",
      workspaceId: ws.id,
      actorType: "agent",
      actorId: NIL_ACTOR,
      action: "write",
      resourceType: "person",
      inputs: { note: "from an ingested email" },
      userDecision: null,
      policyResults: [],
      trustOrigin: "untrusted_external",
      createdAt: "2026-07-14T00:00:00.000Z",
    };
    await store.append(entry);
    const got = await store.get(entry.id);
    assert.equal(got?.trustOrigin, "untrusted_external");
  } finally {
    await close();
  }
});

test("memories: retrieval is authority-scoped by classification at the store boundary (MEM-1)", async () => {
  const { db, close } = await createLocalDb();
  try {
    const [ws] = await db
      .insert(schema.workspaces)
      .values({ name: "test_fixture_ws_mem_scope" })
      .returning({ id: schema.workspaces.id });
    assert.ok(ws);
    const store = new DrizzleMemoryStore(db);

    await store.write(mem({ id: "c0000000-0000-4000-8000-000000000001", workspaceId: ws.id, scope: "public", content: "pub" }));
    await store.write(mem({ id: "c0000000-0000-4000-8000-000000000002", workspaceId: ws.id, scope: "workspace", content: "ws" }));
    await store.write(mem({ id: "c0000000-0000-4000-8000-000000000003", workspaceId: ws.id, scope: "private", ownerUserId: USER_A, content: "privA" }));
    await store.write(mem({ id: "c0000000-0000-4000-8000-000000000004", workspaceId: ws.id, scope: "private", ownerUserId: USER_B, content: "privB" }));

    // User A sees public + workspace + their own private; NOT user B's private.
    const asA = await store.retrieve({}, { workspaceId: ws.id, userId: USER_A });
    const contentsA = asA.map((m) => m.content).sort();
    assert.deepEqual(contentsA, ["privA", "pub", "ws"]);

    // No-user (system) context sees only public + workspace.
    const asSystem = await store.retrieve({}, { workspaceId: ws.id, userId: null });
    assert.deepEqual(asSystem.map((m) => m.content).sort(), ["pub", "ws"]);

    // get() is authority-scoped too: A cannot fetch B's private memory.
    const bPrivateForA = await store.get("c0000000-0000-4000-8000-000000000004", { workspaceId: ws.id, userId: USER_A });
    assert.equal(bPrivateForA, null);

    // confidence round-trips as a number.
    assert.equal(asSystem[0]?.confidence, 0.5);
  } finally {
    await close();
  }
});

test("memories: tenant isolation — a memory in another workspace is never returned (MEM-1)", async () => {
  const { db, close } = await createLocalDb();
  try {
    const [ws1] = await db.insert(schema.workspaces).values({ name: "test_fixture_ws_mem_t1" }).returning({ id: schema.workspaces.id });
    const [ws2] = await db.insert(schema.workspaces).values({ name: "test_fixture_ws_mem_t2" }).returning({ id: schema.workspaces.id });
    assert.ok(ws1 && ws2);
    const store = new DrizzleMemoryStore(db);

    await store.write(mem({ id: "d0000000-0000-4000-8000-000000000001", workspaceId: ws2.id, scope: "public", content: "other_ws" }));
    const got = await store.retrieve({}, { workspaceId: ws1.id, userId: USER_A });
    assert.equal(got.length, 0);
  } finally {
    await close();
  }
});

test("memories: supersede is append-only — prior row retained, excluded by default (MEM-1)", async () => {
  const { db, close } = await createLocalDb();
  try {
    const [ws] = await db.insert(schema.workspaces).values({ name: "test_fixture_ws_mem_supersede" }).returning({ id: schema.workspaces.id });
    assert.ok(ws);
    const store = new DrizzleMemoryStore(db);

    const original = await store.write(mem({ id: "e0000000-0000-4000-8000-000000000001", workspaceId: ws.id, scope: "workspace", content: "v1" }));
    await store.supersede(original.id, mem({ id: "e0000000-0000-4000-8000-000000000002", workspaceId: ws.id, scope: "workspace", content: "v2" }));

    const current = await store.retrieve({}, { workspaceId: ws.id, userId: USER_A });
    assert.deepEqual(current.map((m) => m.content), ["v2"]);

    const withHistory = await store.retrieve({ includeSuperseded: true }, { workspaceId: ws.id, userId: USER_A });
    assert.equal(withHistory.length, 2);
    const superseder = withHistory.find((m) => m.content === "v2");
    assert.equal(superseder?.supersedesId, original.id);
    await assert.rejects(
      store.supersede(original.id, mem({
        id: "e0000000-0000-4000-8000-000000000003",
        workspaceId: ws.id,
        scope: "private",
        ownerUserId: USER_B,
      })),
      /cannot change workspace or owner/,
    );
  } finally {
    await close();
  }
});

test("memories: concurrent corrections converge on one idempotent successor", async () => {
  const { db, close } = await createLocalDb();
  try {
    const [ws] = await db
      .insert(schema.workspaces)
      .values({ name: "test_fixture_ws_mem_concurrent_correction" })
      .returning({ id: schema.workspaces.id });
    assert.ok(ws);
    const store = new DrizzleMemoryStore(db);
    const original = await store.write(
      mem({
        id: "e1000000-0000-4000-8000-000000000001",
        workspaceId: ws.id,
        scope: "private",
        ownerUserId: USER_A,
        content: "v1",
      }),
    );
    const firstCorrection = mem({
      id: "e1000000-0000-4000-8000-000000000002",
      workspaceId: ws.id,
      scope: "private",
      ownerUserId: USER_A,
      content: "v2-a",
    });
    const secondCorrection = mem({
      id: "e1000000-0000-4000-8000-000000000003",
      workspaceId: ws.id,
      scope: "private",
      ownerUserId: USER_A,
      content: "v2-b",
    });
    const raced = await Promise.allSettled([
      store.supersede(original.id, firstCorrection),
      store.supersede(original.id, secondCorrection),
    ]);
    assert.equal(
      raced.filter((result) => result.status === "fulfilled").length,
      1,
    );
    assert.equal(
      raced.filter((result) => result.status === "rejected").length,
      1,
    );
    const current = await store.retrieve(
      {},
      { workspaceId: ws.id, userId: USER_A },
    );
    assert.equal(current.length, 1);
    assert.ok(["v2-a", "v2-b"].includes(current[0]!.content));

    const winner =
      raced.find(
        (result): result is PromiseFulfilledResult<
          Awaited<ReturnType<typeof store.supersede>>
        > => result.status === "fulfilled",
      )!.value;
    const replayInput =
      winner.id === firstCorrection.id ? firstCorrection : secondCorrection;
    assert.equal(
      (await store.supersede(original.id, replayInput)).id,
      winner.id,
      "an identical correction replay returns the existing successor",
    );
  } finally {
    await close();
  }
});

test("memories: forget removes the complete correction lineage", async () => {
  const { db, close } = await createLocalDb();
  try {
    const [ws] = await db.insert(schema.workspaces).values({ name: "test_fixture_ws_mem_forget" }).returning({ id: schema.workspaces.id });
    assert.ok(ws);
    const store = new DrizzleMemoryStore(db);
    const first = await store.write(mem({ id: "f0000000-0000-4000-8000-000000000001", workspaceId: ws.id, scope: "private", ownerUserId: USER_A, content: "first" }));
    const corrected = await store.supersede(first.id, mem({ id: "f0000000-0000-4000-8000-000000000002", workspaceId: ws.id, scope: "private", ownerUserId: USER_A, content: "corrected" }));

    assert.equal(await store.forget(corrected.id, { workspaceId: ws.id, userId: USER_A }), true);
    assert.deepEqual(await store.retrieve({ includeSuperseded: true }, { workspaceId: ws.id, userId: USER_A }), []);
  } finally {
    await close();
  }
});
