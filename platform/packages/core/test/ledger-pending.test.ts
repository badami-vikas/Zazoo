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
  await ledger.append(
    row({
      id: "test_fixture_denied_audit",
      refLedgerId: proposal.id,
      action: "approve",
      resourceType: "ledger",
      diff: { rejected: "agent floor" },
    }),
  );
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
