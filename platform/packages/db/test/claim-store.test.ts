/**
 * K3 (TASK-047) — DrizzleClaimStore over the 0040 tables.
 *
 * Invariants under test:
 *  - a contradicting claim supersedes its predecessor by lineage in one
 *    transaction (`supersededBy` + `validTo` + `invalidatedAt`) and NEVER
 *    deletes it — history keeps both rows;
 *  - live reads exclude superseded/invalidated rows;
 *  - owner scoping: another owner's claims are invisible on every read;
 *  - `deleteClaim` (the forget path) is the only true delete and clears
 *    inbound lineage pointers rather than dangling them;
 *  - entity upsert is idempotent per (org, owner, kind, normalized name).
 */
import assert from "node:assert/strict";
import test from "node:test";
import type { ClaimProposal } from "@bridge/core";
import { createLocalDb, DrizzleClaimStore, schema } from "../src/index.js";

const organizationId = "10000000-0000-4000-8000-000000000140";
const ownerUserId = "20000000-0000-4000-8000-000000000140";
const otherUserId = "20000000-0000-4000-8000-000000000141";
const decisionA = "60000000-0000-4000-8000-000000000140";
const decisionB = "60000000-0000-4000-8000-000000000141";

function claim(overrides: Partial<ClaimProposal> = {}): ClaimProposal {
  return {
    entity: { kind: "person", name: "Priya Sharma" },
    field: "timezone",
    value: "CET",
    claimClass: "stated_fact",
    sensitivity: "private",
    evidence: [{ kind: "memory", id: "70000000-0000-4000-8000-000000000140" }],
    ...overrides,
  };
}

async function harness() {
  const { db, close } = await createLocalDb();
  await db.insert(schema.users).values([
    { id: ownerUserId, email: "claims-owner@example.test" },
    { id: otherUserId, email: "claims-other@example.test" },
  ]);
  await db.insert(schema.organizations).values([{ id: organizationId, name: "Claims org" }]);
  return { store: new DrizzleClaimStore(db), close };
}

test("materialize → contradict: supersedence lineage, never deletion", async () => {
  const { store, close } = await harness();
  try {
    const first = await store.materializeClaim({
      organizationId,
      ownerUserId,
      claim: claim(),
      decisionRef: decisionA,
      createdBy: ownerUserId,
    });
    assert.equal(first.supersededClaimId, null);
    assert.equal(first.claim.value, "CET");
    assert.equal(first.claim.decisionRef, decisionA);

    const second = await store.materializeClaim({
      organizationId,
      ownerUserId,
      claim: claim({ value: "IST" }),
      decisionRef: decisionB,
      createdBy: ownerUserId,
    });
    assert.equal(second.supersededClaimId, first.claim.id, "contradiction supersedes the live claim");

    const live = await store.liveClaims(organizationId, ownerUserId);
    assert.equal(live.length, 1, "exactly one live claim per (entity, field)");
    assert.equal(live[0]!.value, "IST");

    const history = await store.claimHistory(
      organizationId, ownerUserId, second.claim.entityId, "timezone",
    );
    assert.equal(history.length, 2, "history keeps the superseded row");
    const superseded = history.find((row) => row.id === first.claim.id);
    assert.ok(superseded);
    assert.equal(superseded.supersededBy, second.claim.id);
    assert.ok(superseded.validTo, "bi-temporal validTo closed");
    assert.ok(superseded.invalidatedAt, "system-side invalidatedAt closed");
  } finally {
    await close();
  }
});

test("owner scoping: another owner's claims are invisible", async () => {
  const { store, close } = await harness();
  try {
    await store.materializeClaim({
      organizationId, ownerUserId, claim: claim(),
      decisionRef: decisionA, createdBy: ownerUserId,
    });
    assert.equal((await store.liveClaims(organizationId, otherUserId)).length, 0);
    assert.equal((await store.listEntities(organizationId, otherUserId)).length, 0);
    const entities = await store.listEntities(organizationId, ownerUserId);
    assert.equal(entities.length, 1);
    assert.equal(entities[0]!.liveClaimCount, 1);
  } finally {
    await close();
  }
});

test("forget path deletes for real and clears inbound lineage pointers", async () => {
  const { store, close } = await harness();
  try {
    const first = await store.materializeClaim({
      organizationId, ownerUserId, claim: claim(),
      decisionRef: decisionA, createdBy: ownerUserId,
    });
    const second = await store.materializeClaim({
      organizationId, ownerUserId, claim: claim({ value: "IST" }),
      decisionRef: decisionB, createdBy: ownerUserId,
    });
    // Forget the NEW head: the superseded predecessor's pointer must clear.
    const deleted = await store.deleteClaim(organizationId, ownerUserId, second.claim.id);
    assert.equal(deleted, true);
    const history = await store.claimHistory(
      organizationId, ownerUserId, second.claim.entityId, "timezone",
    );
    assert.equal(history.length, 1);
    assert.equal(history[0]!.id, first.claim.id);
    assert.equal(history[0]!.supersededBy, null, "no dangling lineage pointer");
    // Wrong owner cannot forget someone else's claim.
    assert.equal(await store.deleteClaim(organizationId, otherUserId, first.claim.id), false);
  } finally {
    await close();
  }
});

test("entity upsert is idempotent per normalized name", async () => {
  const { store, close } = await harness();
  try {
    const a = await store.ensureEntity({
      organizationId, ownerUserId, kind: "topic", name: "  Bridge   roadmap ",
    });
    const b = await store.ensureEntity({
      organizationId, ownerUserId, kind: "topic", name: "Bridge roadmap",
    });
    assert.equal(a.id, b.id);
    assert.equal(b.name, "Bridge roadmap");
  } finally {
    await close();
  }
});
