/**
 * Generic ledger→signal miner (AI Harness K1) — the contract:
 * a Human decision row (approve/veto/edit) becomes a generic ObservedSignal
 * attributed by skill; auto/undecided/skill-less rows never do; payload
 * fields never leak into a signal; re-mining is idempotent; mined signals
 * feed the EXISTING digest with zero module-specific code.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { InMemoryMemoryStore } from "../src/memory/memory-store.js";
import {
  mineLedgerSignals,
  moduleIdForSkill,
  signalFromDecision,
  type LedgerHistoryReader,
} from "../src/learning/ledger-miner.js";
import { digestSignals } from "../src/learning/observation.js";
import type { LedgerEntry } from "../src/types.js";

const ORG = "org-1";
const OWNER = "user-1";
const SIGNAL_ID_FOR = (ledgerId: string) => `signal:${ledgerId}`;

let ledgerSeq = 0;
function decisionRow(overrides: Partial<LedgerEntry> = {}): LedgerEntry {
  ledgerSeq += 1;
  return {
    id: `ledger-decision-${ledgerSeq}`,
    organizationId: ORG,
    actorType: "agent",
    actorId: "internal_strategist",
    action: "execute",
    resourceType: "skill",
    inputs: { note: "test_fixture_private_payload_do_not_learn" },
    proposedOutput: { drafted: "test_fixture_private_output" },
    userDecision: "approve",
    policyResults: [],
    refLedgerId: `ledger-proposal-${ledgerSeq}`,
    skill: "task-manager.assign",
    createdAt: "2026-08-09T10:00:00.000Z",
    ...overrides,
  };
}

function readerOf(items: LedgerEntry[]): LedgerHistoryReader {
  return {
    async listHistory() {
      return { items, total: items.length };
    },
  };
}

function mineOptions() {
  return { organizationId: ORG, ownerUserId: OWNER, signalIdFor: SIGNAL_ID_FOR };
}

test("K1: a human approve/veto/edit decision becomes a generic signal attributed by skill", async () => {
  const store = new InMemoryMemoryStore();
  const rows = [
    decisionRow({ userDecision: "approve", skill: "task-manager.assign" }),
    decisionRow({ userDecision: "veto", skill: "whatsapp.send" }),
    decisionRow({ userDecision: "edit", skill: "task-manager.reconcile-projection" }),
  ];
  const result = await mineLedgerSignals(store, readerOf(rows), mineOptions());
  assert.equal(result.mined.length, 3);
  assert.deepEqual(
    result.mined.map((s) => [s.action, s.attributes["skill"], s.moduleId]),
    [
      ["approve", "task-manager.assign", "task-manager"],
      ["veto", "whatsapp.send", "whatsapp"],
      ["edit", "task-manager.reconcile-projection", "task-manager"],
    ],
  );
  assert.deepEqual(result.moduleIds.sort(), ["task-manager", "whatsapp"]);
});

test("K1: auto decisions, undecided proposals, and skill-less rows are never mined", async () => {
  const store = new InMemoryMemoryStore();
  const auto = decisionRow({ userDecision: "auto" });
  const undecided = decisionRow({ userDecision: null });
  const skillLess = decisionRow();
  delete (skillLess as { skill?: string }).skill;
  const noRef = decisionRow();
  delete (noRef as { refLedgerId?: string }).refLedgerId;
  const result = await mineLedgerSignals(store, readerOf([auto, undecided, skillLess, noRef]), mineOptions());
  assert.equal(result.mined.length, 0);
  // The pure mapper agrees row by row — the exclusions are the mapper's, not
  // an artifact of the scan loop.
  for (const row of [auto, undecided, skillLess, noRef]) {
    assert.equal(signalFromDecision(row, mineOptions()), null);
  }
});

test("K1 privacy: nothing from inputs/proposedOutput/diff reaches the stored signal", async () => {
  const store = new InMemoryMemoryStore();
  const row = decisionRow({
    inputs: { secret: "test_fixture_secret_string_XYZZY" },
    proposedOutput: { body: "test_fixture_output_PLUGH" },
    diff: { to: "test_fixture_diff_Y2" },
  });
  await mineLedgerSignals(store, readerOf([row]), mineOptions());
  const rows = await store.retrieve({ type: "episodic" }, { organizationId: ORG, userId: OWNER });
  assert.equal(rows.length, 1);
  for (const leaked of ["XYZZY", "PLUGH", "Y2\"", "test_fixture_secret", "test_fixture_output", "test_fixture_diff"]) {
    assert.ok(!rows[0]!.content.includes(leaked), `signal content must not carry payload fragment ${leaked}`);
  }
});

test("K1 idempotency: re-mining the same window writes nothing new", async () => {
  const store = new InMemoryMemoryStore();
  const rows = [decisionRow(), decisionRow(), decisionRow()];
  const first = await mineLedgerSignals(store, readerOf(rows), mineOptions());
  assert.equal(first.mined.length, 3);
  const second = await mineLedgerSignals(store, readerOf(rows), mineOptions());
  assert.equal(second.mined.length, 0);
  assert.equal(second.alreadyMined, 3);
  // The fan-out set survives idempotency: a pattern crossing the repetition
  // threshold AFTER its signals were mined must still reach the digest.
  assert.deepEqual(second.moduleIds, ["task-manager"]);
  const stored = await store.retrieve({ type: "episodic" }, { organizationId: ORG, userId: OWNER });
  assert.equal(stored.length, 3);
});

test("K1 exit shape: mined signals feed the EXISTING digest with zero module-specific code", async () => {
  const store = new InMemoryMemoryStore();
  const rows = [decisionRow(), decisionRow(), decisionRow()];
  const { moduleIds } = await mineLedgerSignals(store, readerOf(rows), mineOptions());
  assert.deepEqual(moduleIds, ["task-manager"]);
  let n = 0;
  const created = await digestSignals(store, {
    organizationId: ORG,
    ownerUserId: OWNER,
    moduleId: "task-manager",
    nextId: () => `suggestion-${(n += 1)}`,
  });
  assert.equal(created.length, 1);
  assert.equal(created[0]!.pattern.action, "approve");
  assert.equal(created[0]!.pattern.attributeKey, "skill");
  assert.equal(created[0]!.pattern.attributeValue, "task-manager.assign");
  assert.equal(created[0]!.pattern.count, 3);
});

test("K1: module attribution is the capability family; a dotless skill is platform machinery", () => {
  assert.equal(moduleIdForSkill("task-manager.assign"), "task-manager");
  assert.equal(moduleIdForSkill("dealpilot.commitDeals"), "dealpilot");
  assert.equal(moduleIdForSkill("stageMutation"), "platform");
  assert.equal(moduleIdForSkill(".weird"), "platform");
});
