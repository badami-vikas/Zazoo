/**
 * `MemoryStore.casSupersede`/`currentForLineage` (TASK-010 review remediation
 * item 4 — "Single current lineage / CAS"). Proves the in-memory adapter's
 * optimistic-concurrency contract: at most one non-superseded row per
 * (workspaceId, ownerUserId, lineageKey), a stale `expectedCurrentId` is
 * rejected (never forks history), and two "concurrent" callers racing the
 * same lineage never both succeed.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { InMemoryMemoryStore } from "../src/memory/memory-store.js";
import type { MemoryWrite } from "../src/memory/memory-store.js";

const WS = "10000000-0000-4000-8000-000000000001";
const OWNER = "20000000-0000-4000-8000-000000000002";
const LINEAGE_KEY = "test_fixture_lineage_key";

function draft(id: string, overrides: Partial<MemoryWrite> = {}): MemoryWrite {
  return {
    id,
    workspaceId: WS,
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

test("casSupersede: first create succeeds when expectedCurrentId is null and no row exists yet", async () => {
  const store = new InMemoryMemoryStore();
  const created = await store.casSupersede({
    workspaceId: WS,
    ownerUserId: OWNER,
    lineageKey: LINEAGE_KEY,
    expectedCurrentId: null,
    next: draft("00000000-0000-4000-8000-000000000001"),
  });
  assert.ok(created);
  assert.equal(created!.id, "00000000-0000-4000-8000-000000000001");
  const current = await store.currentForLineage(WS, OWNER, LINEAGE_KEY);
  assert.equal(current?.id, created!.id);
});

test("casSupersede: a second create (expectedCurrentId: null) fails once a row already exists — never forks", async () => {
  const store = new InMemoryMemoryStore();
  const first = await store.casSupersede({
    workspaceId: WS, ownerUserId: OWNER, lineageKey: LINEAGE_KEY, expectedCurrentId: null,
    next: draft("00000000-0000-4000-8000-000000000001"),
  });
  assert.ok(first);
  const second = await store.casSupersede({
    workspaceId: WS, ownerUserId: OWNER, lineageKey: LINEAGE_KEY, expectedCurrentId: null,
    next: draft("00000000-0000-4000-8000-000000000002"),
  });
  assert.equal(second, null);
  assert.equal(store.entries.length, 1, "the lost racer's row must never be written");
});

test("casSupersede: a stale expectedCurrentId (already superseded) is rejected", async () => {
  const store = new InMemoryMemoryStore();
  const v1 = await store.casSupersede({
    workspaceId: WS, ownerUserId: OWNER, lineageKey: LINEAGE_KEY, expectedCurrentId: null,
    next: draft("00000000-0000-4000-8000-000000000001"),
  });
  const v2 = await store.casSupersede({
    workspaceId: WS, ownerUserId: OWNER, lineageKey: LINEAGE_KEY, expectedCurrentId: v1!.id,
    next: draft("00000000-0000-4000-8000-000000000002"),
  });
  assert.ok(v2);
  // Someone still holding v1's id (stale) tries to supersede it again.
  const staleAttempt = await store.casSupersede({
    workspaceId: WS, ownerUserId: OWNER, lineageKey: LINEAGE_KEY, expectedCurrentId: v1!.id,
    next: draft("00000000-0000-4000-8000-000000000003"),
  });
  assert.equal(staleAttempt, null);
  assert.equal(store.entries.length, 2, "the stale racer's row must never be written");
  const current = await store.currentForLineage(WS, OWNER, LINEAGE_KEY);
  assert.equal(current?.id, v2!.id);
});

test("casSupersede: two 'concurrent' callers racing the same expected-current id — exactly one wins", async () => {
  const store = new InMemoryMemoryStore();
  const v1 = await store.casSupersede({
    workspaceId: WS, ownerUserId: OWNER, lineageKey: LINEAGE_KEY, expectedCurrentId: null,
    next: draft("00000000-0000-4000-8000-000000000001"),
  });
  const [a, b] = await Promise.all([
    store.casSupersede({
      workspaceId: WS, ownerUserId: OWNER, lineageKey: LINEAGE_KEY, expectedCurrentId: v1!.id,
      next: draft("00000000-0000-4000-8000-0000000000a1"),
    }),
    store.casSupersede({
      workspaceId: WS, ownerUserId: OWNER, lineageKey: LINEAGE_KEY, expectedCurrentId: v1!.id,
      next: draft("00000000-0000-4000-8000-0000000000b1"),
    }),
  ]);
  const winners = [a, b].filter((r) => r !== null);
  assert.equal(winners.length, 1, "exactly one of the two racers must win — the lineage must never fork");
  assert.equal(store.entries.length, 2, "v1 plus exactly one winner — the loser's row must never be written");
});

test("casSupersede (review round-7 'durable lineage ordering'): allocates lineageRevision 1, 2, 3... atomically per lineage, never per a caller-supplied value", async () => {
  const store = new InMemoryMemoryStore();
  const v1 = await store.casSupersede({
    workspaceId: WS, ownerUserId: OWNER, lineageKey: LINEAGE_KEY, expectedCurrentId: null,
    next: draft("00000000-0000-4000-8000-000000000001"),
  });
  const v2 = await store.casSupersede({
    workspaceId: WS, ownerUserId: OWNER, lineageKey: LINEAGE_KEY, expectedCurrentId: v1!.id,
    next: draft("00000000-0000-4000-8000-000000000002"),
  });
  const v3 = await store.casSupersede({
    workspaceId: WS, ownerUserId: OWNER, lineageKey: LINEAGE_KEY, expectedCurrentId: v2!.id,
    next: draft("00000000-0000-4000-8000-000000000003"),
  });
  assert.equal(v1!.lineageRevision, 1);
  assert.equal(v2!.lineageRevision, 2);
  assert.equal(v3!.lineageRevision, 3);
  // A DIFFERENT lineage's revisions start over at 1 — revision is per-lineage,
  // never a global counter (MemoryQuery.orderBy's doc: comparing revisions
  // ACROSS lineages is meaningless).
  const otherLineage = await store.casSupersede({
    workspaceId: WS, ownerUserId: OWNER, lineageKey: "test_fixture_other_lineage_key", expectedCurrentId: null,
    next: draft("00000000-0000-4000-8000-0000000000aa", { subjectElementId: "test_fixture_other_lineage_key" }),
  });
  assert.equal(otherLineage!.lineageRevision, 1);
  // A racer that loses the CAS must never have consumed/skipped a revision —
  // the winner's next call still gets the very next integer.
  const [winner, loser] = await Promise.all([
    store.casSupersede({
      workspaceId: WS, ownerUserId: OWNER, lineageKey: LINEAGE_KEY, expectedCurrentId: v3!.id,
      next: draft("00000000-0000-4000-8000-0000000000c1"),
    }),
    store.casSupersede({
      workspaceId: WS, ownerUserId: OWNER, lineageKey: LINEAGE_KEY, expectedCurrentId: v3!.id,
      next: draft("00000000-0000-4000-8000-0000000000c2"),
    }),
  ]);
  const won = winner ?? loser;
  assert.equal(loser === null || winner === null, true, "exactly one of the two racers must win");
  assert.equal(won!.lineageRevision, 4, "the winner must get revision 4, whichever racer it was");
});

test("retrieve with orderBy:'lineageRevision' (review round-7): a legacy write() row with no revision sorts OLDEST regardless of direction, and keyset pagination is stable across the null/allocated boundary", async () => {
  const store = new InMemoryMemoryStore();
  // A pre-migration-style row: written via write() (never casSupersede), so
  // it carries no lineageRevision at all — must still sort oldest.
  const legacy = await store.write(draft("00000000-0000-4000-8000-000000000000"));
  const v1 = await store.casSupersede({
    workspaceId: WS, ownerUserId: OWNER, lineageKey: LINEAGE_KEY, expectedCurrentId: legacy.id,
    next: draft("00000000-0000-4000-8000-000000000001"),
  });
  const v2 = await store.casSupersede({
    workspaceId: WS, ownerUserId: OWNER, lineageKey: LINEAGE_KEY, expectedCurrentId: v1!.id,
    next: draft("00000000-0000-4000-8000-000000000002"),
  });
  const auth = { workspaceId: WS, userId: OWNER };
  const all = await store.retrieve(
    { subjectElementId: LINEAGE_KEY, includeSuperseded: true, order: "asc", orderBy: "lineageRevision" },
    auth,
  );
  assert.deepEqual(all.map((e) => e.id), [legacy.id, v1!.id, v2!.id], "the null-revision legacy row must sort oldest");

  // Keyset pagination across the null -> allocated boundary must be stable
  // (no duplicate/omission) — the exact failure mode a bare SQL tuple
  // comparison against a nullable column would hit.
  const page1 = await store.retrieve(
    { subjectElementId: LINEAGE_KEY, includeSuperseded: true, order: "asc", orderBy: "lineageRevision", limit: 1 },
    auth,
  );
  assert.deepEqual(page1.map((e) => e.id), [legacy.id]);
  const page2 = await store.retrieve(
    {
      subjectElementId: LINEAGE_KEY, includeSuperseded: true, order: "asc", orderBy: "lineageRevision", limit: 2,
      cursor: { createdAt: page1[0]!.createdAt, id: page1[0]!.id, lineageRevision: page1[0]!.lineageRevision ?? null },
    },
    auth,
  );
  assert.deepEqual(page2.map((e) => e.id), [v1!.id, v2!.id], "page 2 must pick up exactly where page 1 left off — no dupe, no gap");
});

test("currentForLineage scopes strictly by workspaceId + ownerUserId + lineageKey — no cross-tenant/owner bleed", async () => {
  const store = new InMemoryMemoryStore();
  await store.casSupersede({
    workspaceId: WS, ownerUserId: OWNER, lineageKey: LINEAGE_KEY, expectedCurrentId: null,
    next: draft("00000000-0000-4000-8000-000000000001"),
  });
  const otherWorkspace = await store.currentForLineage("99999999-0000-4000-8000-000000000009", OWNER, LINEAGE_KEY);
  const otherOwner = await store.currentForLineage(WS, "99999999-0000-4000-8000-000000000009", LINEAGE_KEY);
  const otherKey = await store.currentForLineage(WS, OWNER, "different_lineage_key");
  assert.equal(otherWorkspace, null);
  assert.equal(otherOwner, null);
  assert.equal(otherKey, null);
});
