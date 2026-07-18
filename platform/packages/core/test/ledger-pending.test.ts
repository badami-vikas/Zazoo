import assert from "node:assert/strict";
import test from "node:test";
import { InMemoryLedger, type LedgerEntry } from "../src/index.js";

function row(overrides: Partial<LedgerEntry> & { id: string }): LedgerEntry {
  return {
    workspaceId: "test_fixture_workspace",
    actorType: "agent",
    actorId: "test_fixture_actor",
    action: "write",
    resourceType: "signal",
    inputs: {},
    userDecision: null,
    policyResults: [],
    createdAt: "2026-07-16T00:00:00.000Z",
    ...overrides,
  };
}

test("in-memory ledger lists only unresolved root proposals", async () => {
  const ledger = new InMemoryLedger();
  const proposal = await ledger.append(row({ id: "test_fixture_proposal" }));
  const deniedAudit = await ledger.append(
    row({
      id: "test_fixture_denied_audit",
      refLedgerId: proposal.id,
      action: "approve",
      resourceType: "ledger",
      diff: { rejected: "agent floor" },
    }),
  );
  assert.equal(proposal.appendSequence, 1);
  assert.equal(deniedAudit.appendSequence, 2);
  await ledger.append(
    row({
      id: "test_fixture_rejected_audit",
      diff: { rejected: "authority denied" },
    }),
  );

  assert.deepEqual(await ledger.listPending(proposal.workspaceId, { limit: 50, offset: 0 }), {
    items: [proposal],
    total: 1,
  });

  await ledger.append(
    row({
      id: "test_fixture_decision",
      refLedgerId: proposal.id,
      action: "approve",
      resourceType: "ledger",
      userDecision: "approve",
    }),
  );
  assert.deepEqual(await ledger.listPending(proposal.workspaceId, { limit: 50, offset: 0 }), {
    items: [],
    total: 0,
  });
});

test("in-memory ledger resumes append order and owner-filters Relation history", async () => {
  const ledger = new InMemoryLedger(40);
  const ownRelation = await ledger.append(
    row({
      id: "test_fixture_own_relation",
      actorType: "user",
      actorId: "test_fixture_owner",
      resourceType: "relation",
    }),
  );
  await ledger.append(
    row({
      id: "test_fixture_other_relation",
      actorType: "user",
      actorId: "test_fixture_other_owner",
      resourceType: "relation",
    }),
  );
  const ownTouchpoint = await ledger.append(
    row({
      id: "test_fixture_own_touchpoint",
      actorType: "user",
      actorId: "test_fixture_owner",
      resourceType: "touchpoint",
    }),
  );
  await ledger.append(
    row({
      id: "test_fixture_other_touchpoint",
      actorType: "user",
      actorId: "test_fixture_other_owner",
      resourceType: "touchpoint",
    }),
  );
  const sharedSignal = await ledger.append(row({ id: "test_fixture_shared_signal" }));
  const ownPrivateSignal = await ledger.append(
    row({
      id: "test_fixture_own_private_signal",
      actorType: "user",
      actorId: "test_fixture_owner",
      dataScope: "private",
    }),
  );
  await ledger.append(
    row({
      id: "test_fixture_other_private_signal",
      actorType: "user",
      actorId: "test_fixture_other_owner",
      dataScope: "private",
    }),
  );

  assert.equal(ownRelation.appendSequence, 41);
  assert.equal(ownTouchpoint.appendSequence, 43);
  assert.equal(sharedSignal.appendSequence, 45);
  assert.equal(ownPrivateSignal.appendSequence, 46);
  const history = await ledger.listHistory("test_fixture_workspace", {
    limit: 10,
    offset: 0,
    privateOwnerUserId: "test_fixture_owner",
  });
  assert.equal(history.total, 4);
  assert.deepEqual(
    history.items.map((entry) => entry.id),
    [
      "test_fixture_own_private_signal",
      "test_fixture_shared_signal",
      "test_fixture_own_touchpoint",
      "test_fixture_own_relation",
    ],
  );
});
