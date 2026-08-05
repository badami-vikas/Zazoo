import { strict as assert } from "node:assert";
import { test } from "node:test";

import {
  computeAqv,
  computeEfficiency,
  computeReliability,
  episodesFromLedger,
  LedgerAqvSource,
  scoreCapabilityFromLedger,
  type AqvLedgerReader,
} from "../src/index.js";
import type { ExecutionSnapshot, LedgerEntry } from "../src/types.js";

const ORG = "11111111-1111-4111-8111-111111111111";

const CLEAN: ExecutionSnapshot = {
  terminalState: "completed",
  error: false,
  timedOut: false,
  fallbackUsed: false,
  chainDepthExceeded: false,
  violationCount: 0,
  startedAt: "2026-08-01T00:00:00.000Z",
  finishedAt: "2026-08-01T00:00:01.000Z",
};

function row(overrides: Partial<LedgerEntry> & { id: string }): LedgerEntry {
  return {
    organizationId: ORG,
    actorType: "human",
    actorId: "22222222-2222-4222-8222-222222222222",
    action: "create",
    resourceType: "record",
    inputs: {},
    userDecision: null,
    policyResults: [],
    createdAt: "2026-08-01T00:00:00.000Z",
    ...overrides,
  } as LedgerEntry;
}

function reader(items: LedgerEntry[]): AqvLedgerReader {
  return {
    async listHistory(_org, opts) {
      return {
        items: items.slice(opts.offset, opts.offset + opts.limit),
        total: items.length,
      };
    },
  };
}

test("attributes ledger rows to a capability by skill, ignoring other capabilities", () => {
  const episodes = episodesFromLedger(
    [
      row({ id: "a", skill: "web-research", userDecision: "auto" }),
      row({ id: "b", skill: "draft-communication", userDecision: "auto" }),
      row({ id: "c", skill: "web-research", userDecision: "approve" }),
    ],
    "web-research",
  );
  assert.equal(episodes.length, 2);
  assert.deepEqual(episodes.map((e) => e.id).sort(), ["a", "c"]);
});

test("excludes pre-migration rows that carry no attribution rather than guessing", () => {
  const episodes = episodesFromLedger(
    [row({ id: "legacy", userDecision: "approve" }), row({ id: "new", skill: "web-research", userDecision: "approve" })],
    "web-research",
  );
  assert.deepEqual(episodes.map((e) => e.id), ["new"]);
});

test("counts a reviewed propose→decide pair as ONE episode, not two", () => {
  const episodes = episodesFromLedger(
    [
      row({ id: "p1", skill: "web-research", userDecision: null, executionSnapshot: CLEAN }),
      row({ id: "d1", skill: "web-research", userDecision: "approve", refLedgerId: "p1" }),
    ],
    "web-research",
  );
  assert.equal(episodes.length, 1, "the proposal row must be superseded by its decision row");
  const [episode] = episodes;
  assert.equal(episode?.id, "p1");
  assert.equal(episode?.userDecision, "approve", "the verdict comes from the decision row");
  assert.deepEqual(episode?.executionSnapshot, CLEAN, "the snapshot is inherited from the proposal");
});

test("an episode is windowed by when the Skill ran, not when a human got to the inbox", () => {
  const episodes = episodesFromLedger(
    [
      row({ id: "p1", skill: "web-research", createdAt: "2026-07-01T00:00:00.000Z" }),
      row({
        id: "d1",
        skill: "web-research",
        userDecision: "approve",
        refLedgerId: "p1",
        createdAt: "2026-07-20T00:00:00.000Z",
      }),
    ],
    "web-research",
  );
  assert.equal(episodes[0]?.createdAt, "2026-07-01T00:00:00.000Z");
});

test("reliability is null when nothing was instrumented, not zero", () => {
  const uninstrumented = episodesFromLedger(
    [row({ id: "a", skill: "web-research", userDecision: "approve" })],
    "web-research",
  );
  assert.equal(computeReliability(uninstrumented), null, "unmeasured must not read as failing");

  const instrumented = episodesFromLedger(
    [row({ id: "b", skill: "web-research", userDecision: "approve", executionSnapshot: CLEAN })],
    "web-research",
  );
  assert.equal(computeReliability(instrumented), 1);

  const failed = episodesFromLedger(
    [
      row({
        id: "c",
        skill: "web-research",
        userDecision: "approve",
        executionSnapshot: { ...CLEAN, terminalState: "error", error: true },
      }),
    ],
    "web-research",
  );
  assert.equal(computeReliability(failed), 0, "a real failed run still scores 0");
});

test("efficiency is null while no baseline cost producer exists", () => {
  const episodes = episodesFromLedger(
    [row({ id: "a", skill: "web-research", userDecision: "approve", executionSnapshot: CLEAN })],
    "web-research",
  );
  assert.equal(computeEfficiency(episodes), null);
});

test("scores a capability end to end from ledger rows", async () => {
  const aqv = await scoreCapabilityFromLedger(
    reader([
      row({ id: "p1", skill: "web-research", executionSnapshot: CLEAN }),
      row({ id: "d1", skill: "web-research", userDecision: "approve", refLedgerId: "p1" }),
      row({ id: "p2", skill: "web-research", executionSnapshot: CLEAN }),
      row({ id: "d2", skill: "web-research", userDecision: "edit", refLedgerId: "p2" }),
      row({ id: "other", skill: "draft-communication", userDecision: "veto" }),
    ]),
    ORG,
    "web-research",
  );
  assert.equal(aqv.episodeCount, 2);
  assert.equal(aqv.success, 0.75, "one approve (1.0) + one edit (0.5) over two episodes");
  assert.equal(aqv.correction, 0.5);
  assert.equal(aqv.reliability, 1);
  assert.equal(aqv.safety, 1);
});

test("the safety axis vetoes on evidence supplied alongside the ledger", async () => {
  const source = new LedgerAqvSource(
    reader([row({ id: "a", skill: "web-research", userDecision: "approve", executionSnapshot: CLEAN })]),
    ORG,
    { async evidenceFor() { return { violationCount: 3 }; } },
  );
  const { records, evidence } = await source.listAqvRecords("web-research", {});
  const aqv = computeAqv(records, {}, evidence ?? {});
  assert.equal(aqv.safety, 0, "a recorded violation is a hard veto regardless of success rate");
  assert.equal(aqv.success, 1);
});

test("paging stops once history predates the requested window", async () => {
  const items: LedgerEntry[] = [];
  for (let i = 0; i < 500; i += 1) {
    const day = String(28 - Math.floor(i / 20)).padStart(2, "0");
    items.push(row({ id: `r${i}`, skill: "web-research", userDecision: "approve", createdAt: `2026-07-${day}T00:00:00.000Z` }));
  }
  let pages = 0;
  const counting: AqvLedgerReader = {
    async listHistory(org, opts) {
      pages += 1;
      return reader(items).listHistory(org, opts);
    },
  };
  const source = new LedgerAqvSource(counting, ORG, undefined, { pageSize: 50 });
  await source.listAqvRecords("web-research", { from: "2026-07-27T00:00:00.000Z" });
  assert.ok(pages <= 3, `expected an early stop, walked ${pages} pages`);
});
