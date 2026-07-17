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
import type { MemoryWrite } from "@bridge/core";
import { createLocalDb, DrizzleMemoryStore, schema } from "../src/index.js";

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
