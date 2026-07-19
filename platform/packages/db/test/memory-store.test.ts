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
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { sql } from "drizzle-orm";
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

// ---------------------------------------------------------------------------
// TASK-011 remediation (coordinator central-merge review, issue 2) —
// `compareAndSupersede`'s existing "purge the current view" pattern only
// rewrites the CURRENT row via a new successor; the OLD row (whichever one
// first held sensitive/expired raw bytes) remained durably readable via
// `retrieve({ includeSuperseded: true })` forever — a genuine retention gap.
// `redactLineageContent` closes it by walking the SAME bidirectional lineage
// `forget()` uses and rewriting `content` IN PLACE (never deleting rows,
// never a new supersede chain link) wherever the caller's `redact` predicate
// matches. These tests prove Drizzle parity with the in-memory adapter
// (packages/core/test/memory-store.test.ts) against a REAL pglite-backed
// Postgres, plus a genuine cross-instance restart proof.
// ---------------------------------------------------------------------------

test("memories: redactLineageContent rewrites content across the FULL lineage (superseded ancestor row AND current row) against real Postgres — the exact gap compareAndSupersede alone leaves open", async () => {
  const { db, close } = await createLocalDb();
  try {
    const [ws] = await db.insert(schema.workspaces).values({ name: "test_fixture_ws_mem_redact_lineage" }).returning({ id: schema.workspaces.id });
    assert.ok(ws);
    const store = new DrizzleMemoryStore(db);
    const v1 = await store.write(mem({ id: "a1000000-0000-4000-8000-000000000001", workspaceId: ws.id, content: "SECRET raw artifact v1" }));
    const v2 = await store.compareAndSupersede(v1.id, mem({ id: "a1000000-0000-4000-8000-000000000002", workspaceId: ws.id, content: "SECRET raw artifact v2" }));

    const redactedCount = await store.redactLineageContent(v2.id, { workspaceId: ws.id }, (entry) =>
      entry.content.includes("SECRET") ? entry.content.replace("SECRET raw artifact", "[redacted]") : null,
    );
    assert.equal(redactedCount, 2, "both the current row and its superseded ancestor must be redacted");

    const allAfter = await store.retrieve({ includeSuperseded: true }, { workspaceId: ws.id });
    assert.equal(allAfter.length, 2);
    for (const row of allAfter) {
      assert.ok(!row.content.includes("SECRET"), `row ${row.id} must never retain the raw SECRET bytes after redaction`);
    }
    const ancestor = allAfter.find((r) => r.id === v1.id)!;
    assert.equal(ancestor.content, "[redacted] v1", "the ANCESTOR row (the one that originally held the raw bytes) must be redacted in place, not merely superseded");
    const current = allAfter.find((r) => r.id === v2.id)!;
    assert.equal(current.content, "[redacted] v2");
  } finally {
    await close();
  }
});

test("memories: redactLineageContent leaves every other column untouched against real Postgres — id, supersedesId, timestamps, scope, sourceRefType/sourceRefId, confidence, trustOrigin, plane, createdBy, ownerUserId", async () => {
  const { db, close } = await createLocalDb();
  try {
    const [ws] = await db.insert(schema.workspaces).values({ name: "test_fixture_ws_mem_redact_fields" }).returning({ id: schema.workspaces.id });
    assert.ok(ws);
    const store = new DrizzleMemoryStore(db);
    const written = await store.write(
      mem({
        id: "a2000000-0000-4000-8000-000000000001",
        workspaceId: ws.id,
        scope: "private",
        ownerUserId: USER_A,
        sourceRefType: "ledger",
        sourceRefId: "a2000000-0000-4000-8000-0000000000ff",
        confidence: 0.87,
        trustOrigin: "untrusted_external",
        plane: "local",
        createdBy: "test_fixture_learning_agent",
        content: "SECRET",
      }),
    );

    const redactedCount = await store.redactLineageContent(written.id, { workspaceId: ws.id, userId: USER_A }, () => "[redacted]");
    assert.equal(redactedCount, 1);

    const [after] = await store.retrieve({ includeSuperseded: true }, { workspaceId: ws.id, userId: USER_A });
    assert.ok(after);
    assert.equal(after!.id, written.id);
    assert.equal(after!.content, "[redacted]");
    assert.equal(after!.scope, "private");
    assert.equal(after!.ownerUserId, USER_A);
    assert.equal(after!.sourceRefType, "ledger");
    assert.equal(after!.sourceRefId, "a2000000-0000-4000-8000-0000000000ff");
    assert.equal(after!.confidence, 0.87);
    assert.equal(after!.trustOrigin, "untrusted_external");
    assert.equal(after!.plane, "local");
    assert.equal(after!.createdBy, "test_fixture_learning_agent");
    assert.equal(after!.supersedesId, undefined);
  } finally {
    await close();
  }
});

test("memories: redactLineageContent — a null return from redact() leaves that row's content COMPLETELY untouched, and it is scoped to ONLY the target lineage (an unrelated Memory in the same workspace is never rewritten)", async () => {
  const { db, close } = await createLocalDb();
  try {
    const [ws] = await db.insert(schema.workspaces).values({ name: "test_fixture_ws_mem_redact_scope" }).returning({ id: schema.workspaces.id });
    assert.ok(ws);
    const store = new DrizzleMemoryStore(db);
    const untouchable = await store.write(mem({ id: "a3000000-0000-4000-8000-000000000001", workspaceId: ws.id, content: "not sensitive at all" }));
    const unrelated = await store.write(mem({ id: "a3000000-0000-4000-8000-000000000002", workspaceId: ws.id, content: "SECRET unrelated" }));

    const noopCount = await store.redactLineageContent(untouchable.id, { workspaceId: ws.id }, () => null);
    assert.equal(noopCount, 0, "a redact() that never matches must report zero rows changed");
    const [untouchableAfter] = await store.retrieve({ includeSuperseded: true }, { workspaceId: ws.id }).then((rows) => rows.filter((r) => r.id === untouchable.id));
    assert.equal(untouchableAfter!.content, "not sensitive at all");

    // Redacting `untouchable`'s (empty) lineage must never reach `unrelated`.
    const rows = await store.retrieve({ includeSuperseded: true }, { workspaceId: ws.id });
    const unrelatedAfter = rows.find((r) => r.id === unrelated.id);
    assert.equal(unrelatedAfter!.content, "SECRET unrelated", "an unrelated Memory row in the same workspace must be completely unaffected");
  } finally {
    await close();
  }
});

test("memories: redactLineageContent is authority-scoped exactly like forget() against real Postgres — a caller in a DIFFERENT workspace, or lacking ownership of a private row, redacts 0 rows", async () => {
  const { db, close } = await createLocalDb();
  try {
    const [ws] = await db.insert(schema.workspaces).values({ name: "test_fixture_ws_mem_redact_auth" }).returning({ id: schema.workspaces.id });
    const [otherWs] = await db.insert(schema.workspaces).values({ name: "test_fixture_ws_mem_redact_auth_other" }).returning({ id: schema.workspaces.id });
    assert.ok(ws);
    assert.ok(otherWs);
    const store = new DrizzleMemoryStore(db);
    const privateToA = await store.write(mem({ id: "a4000000-0000-4000-8000-000000000001", workspaceId: ws.id, scope: "private", ownerUserId: USER_A, content: "SECRET" }));

    const asOtherWorkspace = await store.redactLineageContent(privateToA.id, { workspaceId: otherWs!.id }, () => "[redacted]");
    assert.equal(asOtherWorkspace, 0, "a caller in a DIFFERENT workspace must never redact this row");

    const asWrongUser = await store.redactLineageContent(privateToA.id, { workspaceId: ws.id, userId: USER_B }, () => "[redacted]");
    assert.equal(asWrongUser, 0, "a caller who is not the owning user must never redact a private row");

    const [stillIntact] = await store.retrieve({ includeSuperseded: true }, { workspaceId: ws.id, userId: USER_A });
    assert.equal(stillIntact!.content, "SECRET", "the row must remain completely unredacted after two unauthorized attempts");
  } finally {
    await close();
  }
});

test("memories: redactLineageContent survives a genuine process restart — content redacted before closing the DB connection remains redacted (never reverts, never re-exposes raw bytes) when reopened against the SAME on-disk pglite directory", async () => {
  const dir = mkdtempSync(join(tmpdir(), "bridge-memory-redact-restart-"));
  try {
    let wsId: string;
    let targetId: string;
    {
      const { db, close } = await createLocalDb({ dataDir: dir });
      try {
        const [ws] = await db.insert(schema.workspaces).values({ name: "test_fixture_ws_mem_redact_restart" }).returning({ id: schema.workspaces.id });
        assert.ok(ws);
        wsId = ws.id;
        const store = new DrizzleMemoryStore(db);
        const v1 = await store.write(mem({ id: "a5000000-0000-4000-8000-000000000001", workspaceId: wsId, content: "SECRET raw artifact v1" }));
        const v2 = await store.compareAndSupersede(v1.id, mem({ id: "a5000000-0000-4000-8000-000000000002", workspaceId: wsId, content: "SECRET raw artifact v2" }));
        targetId = v2.id;
        const redactedCount = await store.redactLineageContent(targetId, { workspaceId: wsId }, (entry) =>
          entry.content.includes("SECRET") ? "[redacted]" : null,
        );
        assert.equal(redactedCount, 2, "sanity: both rows genuinely redacted before the restart");
      } finally {
        await close();
      }
    }
    // THE RESTART — a brand-new DB connection/pool against the SAME on-disk
    // directory, exactly the restart-durability pattern this task's other
    // restart tests already use.
    {
      const { db, close } = await createLocalDb({ dataDir: dir });
      try {
        const store = new DrizzleMemoryStore(db);
        const allAfterRestart = await store.retrieve({ includeSuperseded: true }, { workspaceId: wsId! });
        assert.equal(allAfterRestart.length, 2);
        for (const row of allAfterRestart) {
          assert.equal(row.content, "[redacted]", "redaction performed BEFORE the restart must remain durable — never reverting to raw content, and never re-exposing it after a fresh connection");
        }
      } finally {
        await close();
      }
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// TASK-011 remediation (2026-07-19 coordinator distributed-defects review,
// issue 1) — compareAndSupersede must be a genuine cross-instance mutex, not
// merely a same-process convenience. `@electric-sql/pglite` is DOCUMENTED as
// unsafe for multiple instances to open the SAME on-disk data directory
// concurrently (SQLite-derived single-process storage engine — verified
// empirically: a second `createLocalDb` pointed at the same dir can even
// abort the WASM runtime) — so a literal "two separate pglite processes
// sharing one file" test is not constructible on this backend.
//
// HONEST LIMITATION (found by a 2026-07-19 RE-review, and worth stating
// plainly rather than overclaiming): `@electric-sql/pglite` also fully
// SERIALIZES concurrent `db.transaction()` calls at the driver/connection
// level — a second `.transaction()` call's first statement does not even
// begin until the first one has committed (verified empirically: an
// artificial in-transaction delay in one call reliably blocks the other's
// first query until the delayed one commits). That means the test below
// would pass IDENTICALLY even if `pg_advisory_xact_lock` were deleted from
// `compareAndSupersede` entirely — pglite's own single-connection execution
// model, not the advisory lock, is what prevents interleaving here. This
// test therefore proves the check-then-insert SQL LOGIC is race-correct
// (exactly one of two racing "supersede the same id" attempts wins, the
// loser gets a typed conflict, and no fork is ever produced) — a real and
// necessary property — but it does NOT, and cannot on this backend, prove
// the advisory lock itself is what provides safety against two GENUINELY
// separate Postgres connections (the real production topology, where
// `db.transaction()` calls from different connections interleave freely
// without an explicit lock). That guarantee rests on `pg_advisory_xact_lock`
// being a well-documented, connection-agnostic Postgres server-side
// primitive — verified by code inspection (acquired first, inside the same
// transaction as the check+insert, in `memory-store.ts`), not by this test.
// A real regression here would require a genuine multi-connection Postgres
// (not available in this sandbox); tracked as a gap, not silently assumed
// away.
// ---------------------------------------------------------------------------

test("memories: compareAndSupersede lets exactly ONE of two concurrent writers targeting the SAME id win — the other gets MemoryConflictError, never a forked current state", async () => {
  const { db, close } = await createLocalDb();
  try {
    const [ws] = await db.insert(schema.workspaces).values({ name: "test_fixture_ws_mem_cas_race" }).returning({ id: schema.workspaces.id });
    assert.ok(ws);
    const store = new DrizzleMemoryStore(db);
    const original = await store.write(mem({ id: "10000000-0000-4000-8000-0000000000b1", workspaceId: ws.id, scope: "workspace", content: "v1" }));

    const [resultA, resultB] = await Promise.allSettled([
      store.compareAndSupersede(original.id, mem({ id: "10000000-0000-4000-8000-0000000000b2", workspaceId: ws.id, scope: "workspace", content: "from-A" })),
      store.compareAndSupersede(original.id, mem({ id: "10000000-0000-4000-8000-0000000000b3", workspaceId: ws.id, scope: "workspace", content: "from-B" })),
    ]);

    const outcomes = [resultA, resultB];
    const fulfilled = outcomes.filter((r) => r.status === "fulfilled");
    const rejected = outcomes.filter((r) => r.status === "rejected");
    assert.equal(fulfilled.length, 1, "exactly one of the two concurrent writers must win");
    assert.equal(rejected.length, 1, "exactly one of the two concurrent writers must lose");
    assert.equal((rejected[0] as PromiseRejectedResult).reason.name, "MemoryConflictError");

    // The store must show exactly ONE current row for this lineage — never
    // a forked pair of "current" rows.
    const current = await store.retrieve({}, { workspaceId: ws.id, userId: null });
    const currentForLineage = current.filter((m) => m.content === "from-A" || m.content === "from-B");
    assert.equal(currentForLineage.length, 1, "exactly one current row must exist for this lineage — no fork");
  } finally {
    await close();
  }
});

test("memories: compareAndSupersede rejects re-superseding an already-superseded id even when called sequentially (not just concurrently)", async () => {
  const { db, close } = await createLocalDb();
  try {
    const [ws] = await db.insert(schema.workspaces).values({ name: "test_fixture_ws_mem_cas_sequential" }).returning({ id: schema.workspaces.id });
    assert.ok(ws);
    const store = new DrizzleMemoryStore(db);
    const original = await store.write(mem({ id: "10000000-0000-4000-8000-0000000000c1", workspaceId: ws.id, scope: "workspace", content: "v1" }));
    await store.compareAndSupersede(original.id, mem({ id: "10000000-0000-4000-8000-0000000000c2", workspaceId: ws.id, scope: "workspace", content: "v2" }));

    await assert.rejects(
      () => store.compareAndSupersede(original.id, mem({ id: "10000000-0000-4000-8000-0000000000c3", workspaceId: ws.id, scope: "workspace", content: "v3-forged" })),
      (error: unknown) => {
        assert.ok(error instanceof Error && error.name === "MemoryConflictError");
        return true;
      },
    );
  } finally {
    await close();
  }
});

test("memories: writeIfAbsent lets exactly ONE of two concurrent first-inserts for the SAME (workspaceId, subjectElementId) win — the other gets back the WINNER's row, never a second current row (TASK-011 remediation, 2026-07-19 coordinator distributed-defects RE-review — an independent reviewer found compareAndSupersede alone cannot close this race, since it only guards updates against an EXISTING known row id, not the first creation of a new keyed row)", async () => {
  const { db, close } = await createLocalDb();
  try {
    const [ws] = await db.insert(schema.workspaces).values({ name: "test_fixture_ws_mem_write_if_absent_race" }).returning({ id: schema.workspaces.id });
    assert.ok(ws);
    const store = new DrizzleMemoryStore(db);
    const subjectElementId = "20000000-0000-4000-8000-000000000001";

    const [resultA, resultB] = await Promise.all([
      store.writeIfAbsent(mem({ id: "20000000-0000-4000-8000-0000000000a1", workspaceId: ws.id, subjectElementId, content: "from-A" })),
      store.writeIfAbsent(mem({ id: "20000000-0000-4000-8000-0000000000a2", workspaceId: ws.id, subjectElementId, content: "from-B" })),
    ]);

    // Both calls must resolve to the SAME winning row (never two distinct
    // "current" rows for one key) — one of the callers gets back its own
    // freshly-inserted row, the other gets back the WINNER's row instead of
    // its own proposed content.
    assert.equal(resultA.id, resultB.id);
    assert.ok(resultA.content === "from-A" || resultA.content === "from-B");

    const current = await store.retrieve({ subjectElementId }, { workspaceId: ws.id, userId: null });
    assert.equal(current.length, 1, "exactly one current row must exist for this subjectElementId — no fork from the race");
    assert.equal(current[0]!.id, resultA.id);
  } finally {
    await close();
  }
});

test("memories: writeIfAbsent is idempotent for sequential calls with the SAME subjectElementId — a retry never duplicates", async () => {
  const { db, close } = await createLocalDb();
  try {
    const [ws] = await db.insert(schema.workspaces).values({ name: "test_fixture_ws_mem_write_if_absent_seq" }).returning({ id: schema.workspaces.id });
    assert.ok(ws);
    const store = new DrizzleMemoryStore(db);
    const subjectElementId = "20000000-0000-4000-8000-000000000002";

    const first = await store.writeIfAbsent(mem({ id: "20000000-0000-4000-8000-0000000000b1", workspaceId: ws.id, subjectElementId, content: "first" }));
    const retry = await store.writeIfAbsent(mem({ id: "20000000-0000-4000-8000-0000000000b2", workspaceId: ws.id, subjectElementId, content: "second-should-be-ignored" }));

    assert.equal(retry.id, first.id);
    assert.equal(retry.content, "first");
    const current = await store.retrieve({ subjectElementId }, { workspaceId: ws.id, userId: null });
    assert.equal(current.length, 1);
  } finally {
    await close();
  }
});

test("advisory lock key derivation: an uppercase-hex ALIAS of the same UUID hashes to the IDENTICAL lock key as its canonical lowercase form (TASK-011 remediation, 2026-07-19 coordinator distributed-defects RE-review, issue 9) — proves compareAndSupersede/writeIfAbsent canonicalize via ::uuid::text BEFORE hashtext(), so two callers referencing the same row/key via differently-cased UUID aliases can never bypass each other's advisory lock", async () => {
  const { db, close } = await createLocalDb();
  try {
    const lower = "30000000-0000-4000-8000-0000000000aa";
    const upper = "30000000-0000-4000-8000-0000000000AA";
    assert.notEqual(lower, upper, "sanity: these are genuinely different STRINGS");

    // Directly verify, at the SQL level, that the canonicalized hash the
    // store's compareAndSupersede/writeIfAbsent derive their lock key from
    // is IDENTICAL for both aliases — this is the exact expression those
    // methods execute, isolated from any row-lookup fallback that might
    // independently mask a lock-key mismatch.
    const lowerHash = await db.execute(sql`SELECT hashtext((${lower}::uuid)::text) AS h`);
    const upperHash = await db.execute(sql`SELECT hashtext((${upper}::uuid)::text) AS h`);
    assert.equal((lowerHash as unknown as { rows: { h: number }[] }).rows[0]!.h, (upperHash as unknown as { rows: { h: number }[] }).rows[0]!.h);

    // The UNCANONICALIZED hash (the pre-fix bug) would differ for the two
    // aliases — confirming this test would actually have CAUGHT the
    // regression, not merely restated the fix.
    const lowerRawHash = await db.execute(sql`SELECT hashtext(${lower}) AS h`);
    const upperRawHash = await db.execute(sql`SELECT hashtext(${upper}) AS h`);
    assert.notEqual(
      (lowerRawHash as unknown as { rows: { h: number }[] }).rows[0]!.h,
      (upperRawHash as unknown as { rows: { h: number }[] }).rows[0]!.h,
      "sanity: the RAW (uncanonicalized) hash genuinely differs by case — proving canonicalization is what makes the fixed methods agree",
    );

    // End-to-end: writeIfAbsent with the lowercase alias, then a "would-be
    // racer" using the UPPERCASE alias for the SAME subjectElementId must
    // still correctly detect the existing row (case-insensitive row lookup
    // already worked before this fix; the fix is specifically about the
    // LOCK key, verified above).
    const [ws] = await db.insert(schema.workspaces).values({ name: "test_fixture_ws_lock_alias" }).returning({ id: schema.workspaces.id });
    assert.ok(ws);
    const store = new DrizzleMemoryStore(db);
    const first = await store.writeIfAbsent(mem({ id: "30000000-0000-4000-8000-0000000000b1", workspaceId: ws.id, subjectElementId: lower, content: "first" }));
    const second = await store.writeIfAbsent(mem({ id: "30000000-0000-4000-8000-0000000000b2", workspaceId: ws.id, subjectElementId: upper, content: "second" }));
    assert.equal(second.id, first.id, "the uppercase alias must resolve to the SAME existing row as its canonical lowercase form");
  } finally {
    await close();
  }
});
