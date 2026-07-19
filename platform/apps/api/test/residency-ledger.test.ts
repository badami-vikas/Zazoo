import assert from "node:assert/strict";
import test from "node:test";
import { InMemoryLedger, type LedgerEntry } from "@bridge/core";
import { ResidencyRoutingLedgerStore } from "../src/residency-ledger.js";

const workspaceId = "10000000-0000-4000-8000-000000000101";

function entry(
  id: string,
  input: Partial<LedgerEntry> = {},
): LedgerEntry {
  return {
    id,
    workspaceId,
    actorType: "user",
    actorId: "20000000-0000-4000-8000-000000000101",
    action: "write",
    resourceType: "signal",
    inputs: {},
    userDecision: null,
    policyResults: [],
    createdAt: "2026-07-19T00:00:00.000Z",
    ...input,
  };
}

test("residency ledger sends only explicitly public roots to Cloud Plane", async () => {
  const local = new InMemoryLedger();
  const cloud = new InMemoryLedger();
  const routed = new ResidencyRoutingLedgerStore(local, cloud);
  const privateProposal = entry(
    "10000000-0000-4000-8000-000000000201",
    { dataScope: "private" },
  );
  const publicProposal = entry(
    "10000000-0000-4000-8000-000000000202",
    { dataScope: "public" },
  );
  const allScopeProposal = entry(
    "10000000-0000-4000-8000-000000000204",
    { dataScope: "all" },
  );
  const legacyUnscopedProposal = entry(
    "10000000-0000-4000-8000-000000000205",
  );

  await routed.append(privateProposal);
  await routed.append(publicProposal);
  await routed.append(allScopeProposal);
  await routed.append(legacyUnscopedProposal);
  await routed.append(
    entry("10000000-0000-4000-8000-000000000203", {
      refLedgerId: privateProposal.id,
      userDecision: "approve",
    }),
  );
  await routed.append(
    entry("10000000-0000-4000-8000-000000000206", {
      refLedgerId: publicProposal.id,
      userDecision: "approve",
    }),
  );

  assert.ok(await local.get(privateProposal.id));
  assert.equal(await cloud.get(privateProposal.id), null);
  assert.ok(await cloud.get(publicProposal.id));
  assert.equal(await local.get(publicProposal.id), null);
  assert.ok(await local.get(allScopeProposal.id));
  assert.equal(await cloud.get(allScopeProposal.id), null);
  assert.ok(await local.get(legacyUnscopedProposal.id));
  assert.equal(await cloud.get(legacyUnscopedProposal.id), null);
  assert.ok(await local.decisionFor(privateProposal.id));
  assert.equal(await cloud.decisionFor(privateProposal.id), null);
  assert.ok(await cloud.decisionFor(publicProposal.id));
  assert.equal(await local.decisionFor(publicProposal.id), null);
});

test("residency ledger merges Local and Cloud Plane history without exposing split storage", async () => {
  const local = new InMemoryLedger();
  const cloud = new InMemoryLedger();
  const routed = new ResidencyRoutingLedgerStore(local, cloud);
  await routed.append(
    entry("10000000-0000-4000-8000-000000000211", {
      dataScope: "private",
      createdAt: "2026-07-19T00:00:00.000Z",
    }),
  );
  await routed.append(
    entry("10000000-0000-4000-8000-000000000212", {
      dataScope: "public",
      createdAt: "2026-07-19T00:01:00.000Z",
    }),
  );

  const history = await routed.listHistory(workspaceId, {
    limit: 10,
    offset: 0,
    privateOwnerUserId: "20000000-0000-4000-8000-000000000101",
  });
  assert.equal(history.total, 2);
  assert.deepEqual(
    history.items.map((item) => item.id),
    [
      "10000000-0000-4000-8000-000000000212",
      "10000000-0000-4000-8000-000000000211",
    ],
  );
});
