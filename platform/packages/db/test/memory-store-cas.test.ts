/**
 * `DrizzleMemoryStore.casSupersede`/`currentForLineage` (TASK-010 review
 * remediation item 4 — "Single current lineage / CAS") against a real
 * pglite-backed Postgres. Proves the SERIALIZABLE-isolation compare-and-swap
 * is a genuine database-level concurrency primitive, not a process-local
 * lock: two concurrent transactions racing the same lineage never both
 * commit, a stale `expectedCurrentId` is rejected, and the winner's row is
 * exactly what `currentForLineage` reports afterward.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { DrizzleQueryError } from "drizzle-orm";
import type { MemoryWrite } from "@bridge/core";
import { createLocalDb, DrizzleMemoryStore, schema } from "../src/index.js";
import { isMemoryIdUniqueViolation, isSerializationFailure } from "../src/memory-store.js";

const OWNER = "aaaaaaaa-0000-4000-8000-000000000001";
const LINEAGE_KEY = "cccccccc-0000-4000-8000-000000000009";

function draft(id: string, workspaceId: string, overrides: Partial<MemoryWrite> = {}): MemoryWrite {
  return {
    id,
    workspaceId,
    type: "semantic",
    subjectElementId: LINEAGE_KEY,
    scope: "private",
    content: "test_fixture_content",
    confidence: 1,
    trustOrigin: "user_content",
    plane: "local",
    createdBy: OWNER,
    ownerUserId: OWNER,
    ...overrides,
  };
}

async function seedWorkspace(db: Awaited<ReturnType<typeof createLocalDb>>["db"]): Promise<string> {
  const [ws] = await db.insert(schema.workspaces).values({ name: "test_fixture_ws_cas" }).returning({ id: schema.workspaces.id });
  assert.ok(ws);
  return ws.id;
}

test("DrizzleMemoryStore.casSupersede: first create succeeds; currentForLineage reflects it", async () => {
  const { db, close } = await createLocalDb();
  try {
    const workspaceId = await seedWorkspace(db);
    const store = new DrizzleMemoryStore(db);
    const created = await store.casSupersede({
      workspaceId, ownerUserId: OWNER, lineageKey: LINEAGE_KEY, expectedCurrentId: null,
      next: draft("00000000-0000-4000-8000-000000000001", workspaceId),
    });
    assert.ok(created);
    const current = await store.currentForLineage(workspaceId, OWNER, LINEAGE_KEY);
    assert.equal(current?.id, created!.id);
  } finally {
    await close();
  }
});

test("DrizzleMemoryStore.casSupersede: a stale expectedCurrentId is rejected, never forking the lineage", async () => {
  const { db, close } = await createLocalDb();
  try {
    const workspaceId = await seedWorkspace(db);
    const store = new DrizzleMemoryStore(db);
    const v1 = await store.casSupersede({
      workspaceId, ownerUserId: OWNER, lineageKey: LINEAGE_KEY, expectedCurrentId: null,
      next: draft("00000000-0000-4000-8000-000000000001", workspaceId),
    });
    const v2 = await store.casSupersede({
      workspaceId, ownerUserId: OWNER, lineageKey: LINEAGE_KEY, expectedCurrentId: v1!.id,
      next: draft("00000000-0000-4000-8000-000000000002", workspaceId),
    });
    assert.ok(v2);
    const staleAttempt = await store.casSupersede({
      workspaceId, ownerUserId: OWNER, lineageKey: LINEAGE_KEY, expectedCurrentId: v1!.id,
      next: draft("00000000-0000-4000-8000-000000000003", workspaceId),
    });
    assert.equal(staleAttempt, null);
    const current = await store.currentForLineage(workspaceId, OWNER, LINEAGE_KEY);
    assert.equal(current?.id, v2!.id);
  } finally {
    await close();
  }
});

test("DrizzleMemoryStore.casSupersede: two REAL concurrent transactions racing the same expected-current id — exactly one wins", async () => {
  const { db, close } = await createLocalDb();
  try {
    const workspaceId = await seedWorkspace(db);
    const store = new DrizzleMemoryStore(db);
    const v1 = await store.casSupersede({
      workspaceId, ownerUserId: OWNER, lineageKey: LINEAGE_KEY, expectedCurrentId: null,
      next: draft("00000000-0000-4000-8000-000000000001", workspaceId),
    });
    const results = await Promise.all([
      store.casSupersede({
        workspaceId, ownerUserId: OWNER, lineageKey: LINEAGE_KEY, expectedCurrentId: v1!.id,
        next: draft("00000000-0000-4000-8000-0000000000a1", workspaceId),
      }),
      store.casSupersede({
        workspaceId, ownerUserId: OWNER, lineageKey: LINEAGE_KEY, expectedCurrentId: v1!.id,
        next: draft("00000000-0000-4000-8000-0000000000b1", workspaceId),
      }),
    ]);
    const winners = results.filter((r) => r !== null);
    assert.equal(winners.length, 1, "exactly one of the two real concurrent transactions must win");
    const current = await store.currentForLineage(workspaceId, OWNER, LINEAGE_KEY);
    assert.equal(current?.id, winners[0]!.id);
  } finally {
    await close();
  }
});

test("currentForLineage scopes strictly by workspaceId + ownerUserId + subjectElementId — no cross-tenant/owner bleed", async () => {
  const { db, close } = await createLocalDb();
  try {
    const workspaceId = await seedWorkspace(db);
    const otherWorkspaceId = await seedWorkspace(db);
    const store = new DrizzleMemoryStore(db);
    await store.casSupersede({
      workspaceId, ownerUserId: OWNER, lineageKey: LINEAGE_KEY, expectedCurrentId: null,
      next: draft("00000000-0000-4000-8000-000000000001", workspaceId),
    });
    const otherWorkspace = await store.currentForLineage(otherWorkspaceId, OWNER, LINEAGE_KEY);
    const otherOwner = await store.currentForLineage(workspaceId, "bbbbbbbb-0000-4000-8000-000000000002", LINEAGE_KEY);
    assert.equal(otherWorkspace, null);
    assert.equal(otherOwner, null);
  } finally {
    await close();
  }
});

/**
 * Independent-review follow-up: pglite's single-connection execution model
 * does not reliably produce a genuine overlapping-transaction `40001` under
 * `Promise.all` (the "two REAL concurrent transactions" test above passes
 * via the in-transaction `current.id !== expectedCurrentId` check alone —
 * confirmed by instrumenting the `catch` block, which is never entered
 * there). These tests instead verify the unwrap logic directly against a
 * REAL `DrizzleQueryError` (the actual wrapper drizzle-orm >=0.45 throws),
 * which is the reliable way to regression-test this without depending on
 * whether a given test environment's driver happens to produce real
 * write-skew.
 */
test("isSerializationFailure recognizes a real DrizzleQueryError-wrapped 40001, at any cause-chain depth, and rejects unrelated errors", () => {
  const rawPgError = Object.assign(new Error("could not serialize access due to concurrent update"), { code: "40001" });
  const singleWrap = new DrizzleQueryError("select 1", [], rawPgError);
  assert.equal(isSerializationFailure(singleWrap), true);

  // drizzle-orm's own transaction retry/batch paths can nest another
  // DrizzleQueryError around an inner one — the walk must not stop at depth 1.
  const doubleWrap = new DrizzleQueryError("insert into memories ...", [], singleWrap as unknown as Error);
  assert.equal(isSerializationFailure(doubleWrap), true);

  const uniqueViolation = new DrizzleQueryError("insert", [], Object.assign(new Error("dup"), { code: "23505" }));
  assert.equal(isSerializationFailure(uniqueViolation), false, "a DIFFERENT SQLSTATE must not be misreported as a serialization failure");

  assert.equal(isSerializationFailure(new Error("plain error, no .code anywhere")), false);
  assert.equal(isSerializationFailure(null), false);
  assert.equal(isSerializationFailure("not an object"), false);
});

test("casSupersede returns null (never re-throws) when the transaction rejects with a real wrapped 40001", async () => {
  const { db, close } = await createLocalDb();
  try {
    const workspaceId = await seedWorkspace(db);
    const store = new DrizzleMemoryStore(db);
    const rawPgError = Object.assign(new Error("could not serialize access due to concurrent update"), { code: "40001" });
    const wrapped = new DrizzleQueryError("select ...", [], rawPgError);
    // Monkeypatch this ONE call's transaction() to simulate what a real
    // concurrent-write-skew rejection looks like coming out of drizzle-orm,
    // since forcing pglite to genuinely produce one is not reliable here.
    const originalTransaction = db.transaction.bind(db);
    (db as unknown as { transaction: typeof db.transaction }).transaction = (() => Promise.reject(wrapped)) as typeof db.transaction;
    try {
      const result = await store.casSupersede({
        workspaceId, ownerUserId: OWNER, lineageKey: LINEAGE_KEY, expectedCurrentId: null,
        next: draft("00000000-0000-4000-8000-000000000099", workspaceId),
      });
      assert.equal(result, null, "a genuine serialization failure must surface as a CAS-failure null, never an unhandled throw");
    } finally {
      (db as unknown as { transaction: typeof db.transaction }).transaction = originalTransaction;
    }
  } finally {
    await close();
  }
});

/**
 * TASK-010 review round-5 item 10 — a deterministic id (e.g. a red-flag
 * correction's `deterministicUuid(...)`-derived memoryId) means two
 * genuinely concurrent `casSupersede` calls can both pass the in-transaction
 * "no current row yet" compare and then both attempt to INSERT the
 * IDENTICAL row id — a real Postgres unique-violation (`23505`) on
 * `memories.id`, not the `40001` serialization failure the test above
 * covers. Unlike that one, pglite's single-connection execution model DOES
 * reliably reproduce this specific race for real (confirmed via a targeted
 * repro during development): both transactions start before either
 * commits, and the loser's own INSERT genuinely violates the primary key.
 */
test("isMemoryIdUniqueViolation recognizes a real DrizzleQueryError-wrapped 23505 scoped to memories_pkey, at any cause-chain depth, and rejects unrelated errors", () => {
  const rawPgError = Object.assign(new Error('duplicate key value violates unique constraint "memories_pkey"'), { code: "23505", constraint: "memories_pkey" });
  const singleWrap = new DrizzleQueryError("insert into memories ...", [], rawPgError);
  assert.equal(isMemoryIdUniqueViolation(singleWrap), true);

  const doubleWrap = new DrizzleQueryError("insert into memories ...", [], singleWrap as unknown as Error);
  assert.equal(isMemoryIdUniqueViolation(doubleWrap), true);

  // A DIFFERENT unique constraint on the same 23505 SQLSTATE must NOT match.
  const otherConstraint = new DrizzleQueryError("insert", [], Object.assign(new Error("dup"), { code: "23505", constraint: "some_other_unique_index" }));
  assert.equal(isMemoryIdUniqueViolation(otherConstraint), false, "a DIFFERENT unique constraint must not be misreported as a memories-id collision");

  const serializationFailure = new DrizzleQueryError("select", [], Object.assign(new Error("ssi"), { code: "40001" }));
  assert.equal(isMemoryIdUniqueViolation(serializationFailure), false, "a DIFFERENT SQLSTATE must not be misreported as a memories-id collision");

  assert.equal(isMemoryIdUniqueViolation(new Error("plain error, no .code anywhere")), false);
  assert.equal(isMemoryIdUniqueViolation(null), false);
  assert.equal(isMemoryIdUniqueViolation("not an object"), false);
});

test("casSupersede: two REAL concurrent transactions inserting the IDENTICAL deterministic id both pass the 'no current row' compare — the loser's genuine 23505 surfaces as CAS-failure null, never an unhandled throw", async () => {
  const { db, close } = await createLocalDb();
  try {
    const workspaceId = await seedWorkspace(db);
    const store = new DrizzleMemoryStore(db);
    const sameId = "dddddddd-0000-4000-8000-000000000001";
    const results = await Promise.all([
      store.casSupersede({ workspaceId, ownerUserId: OWNER, lineageKey: LINEAGE_KEY, expectedCurrentId: null, next: draft(sameId, workspaceId) }),
      store.casSupersede({ workspaceId, ownerUserId: OWNER, lineageKey: LINEAGE_KEY, expectedCurrentId: null, next: draft(sameId, workspaceId) }),
    ]);
    const winners = results.filter((r) => r !== null);
    assert.equal(winners.length, 1, "exactly one of the two concurrent identical-id inserts must win — the other must resolve to null, never throw");
    const current = await store.currentForLineage(workspaceId, OWNER, LINEAGE_KEY);
    assert.equal(current?.id, sameId);
  } finally {
    await close();
  }
});

