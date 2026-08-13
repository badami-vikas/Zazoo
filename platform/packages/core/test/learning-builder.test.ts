/**
 * Capability Builder rung 3 (AI Harness K9, TASK-053) — the contract:
 * steps are DERIVED from ledger episodes, never fabricated; the pattern
 * must name a REGISTERED skill; refusals are structured and specific; the
 * episode extractor sees decision rows only and its envelope cannot carry
 * payload content.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  draftStepsFromEpisodes,
  episodesForSkill,
  type BuilderEpisode,
} from "../src/learning/builder.js";
import type { LedgerEntry } from "../src/types.js";

const SKILL = "dealpilot.evaluateSource";
const PATTERN = { action: "approve", attributeKey: "skill", attributeValue: SKILL };
const IN_REGISTRY = (id: string) => id === SKILL || id === "taskmanager.summarize";

function episode(overrides: Partial<BuilderEpisode> = {}): BuilderEpisode {
  return {
    ledgerId: `led-${Math.random().toString(36).slice(2, 8)}`,
    skill: SKILL,
    action: "execute",
    resourceType: "record",
    dataScope: "private",
    ...overrides,
  };
}

test("uniform episodes → exactly one step carrying the demonstrated governed shape", () => {
  const episodes = [episode({ ledgerId: "a" }), episode({ ledgerId: "b" }), episode({ ledgerId: "c" })];
  const result = draftStepsFromEpisodes(PATTERN, episodes, IN_REGISTRY);
  assert.ok(result.proposed);
  assert.equal(result.steps.length, 1, "repeated behavior is ONE governed action — one step");
  assert.deepEqual(result.steps[0], {
    skill: SKILL,
    action: "execute",
    resourceType: "record",
    dataScope: "private",
  });
  assert.deepEqual(result.evidence, {
    episodeCount: 3,
    distinctShapes: 1,
    episodeLedgerIds: ["a", "b", "c"],
  });
});

test("mixed shapes → the MODAL shape wins and distinctShapes says so", () => {
  const episodes = [
    episode({ ledgerId: "a" }),
    episode({ ledgerId: "b" }),
    episode({ ledgerId: "odd", action: "write", resourceType: "signal" }),
  ];
  const result = draftStepsFromEpisodes(PATTERN, episodes, IN_REGISTRY);
  assert.ok(result.proposed);
  assert.equal(result.steps[0]!.action, "execute");
  assert.equal(result.evidence.distinctShapes, 2, "the human must see the evidence was not uniform");
  assert.deepEqual(result.evidence.episodeLedgerIds, ["a", "b"], "only the drafted shape's episodes");
});

test("out-of-registry skill is REFUSED — the prototype test's core", () => {
  const gone = { ...PATTERN, attributeValue: "retiredmodule.oldSkill" };
  const result = draftStepsFromEpisodes(gone, [episode({ skill: "retiredmodule.oldSkill" })], IN_REGISTRY);
  assert.equal(result.proposed, false);
  assert.ok(!result.proposed && result.reason === "skill_not_registered");
  assert.match(!result.proposed ? result.detail : "", /not in the skill registry/);
});

test("a behavior pattern with no skill attribution is not automatable", () => {
  // Exactly what K7/K8 rhythms look like: appName / domain attributes.
  const rhythm = { action: "focus", attributeKey: "appName", attributeValue: "Xcode" };
  const result = draftStepsFromEpisodes(rhythm, [], IN_REGISTRY);
  assert.ok(!result.proposed && result.reason === "pattern_not_skill_shaped");
  assert.match(result.detail, /behavior rhythm/);
});

test("zero episodes → refusal, never a fabricated step", () => {
  const result = draftStepsFromEpisodes(PATTERN, [], IN_REGISTRY);
  assert.ok(!result.proposed && result.reason === "no_episodes");
  assert.match(result.detail, /fabricated without evidence would be a lie/);
});

test("episodesForSkill keeps only affirming HUMAN decision rows for the named skill", () => {
  const base: LedgerEntry = {
    id: "row-1",
    organizationId: "org-1",
    actorType: "agent",
    actorId: "agent-1",
    action: "execute",
    skill: SKILL,
    resourceType: "record",
    inputs: { SECRET: "payload text that must never reach an episode" },
    proposedOutput: { alsoSecret: true },
    userDecision: "approve",
    refLedgerId: "proposal-1",
    policyResults: [],
    dataScope: "private",
  } as unknown as LedgerEntry;

  const rows: LedgerEntry[] = [
    base,
    { ...base, id: "row-2", userDecision: "veto" }, // veto = evidence AGAINST
    { ...base, id: "row-3", userDecision: null }, // proposal row, not a decision
    (({ refLedgerId: _dropped, ...rest }) => ({ ...rest, id: "row-4" }))(base) as LedgerEntry, // not a decision row
    { ...base, id: "row-5", skill: "othermodule.skill" }, // different skill
    { ...base, id: "row-6", userDecision: "edit" }, // affirming
  ];
  const episodes = episodesForSkill(rows, SKILL);
  assert.deepEqual(episodes.map((e) => e.ledgerId), ["row-1", "row-6"]);
  // Envelope narrowing: payload content is structurally absent.
  for (const entry of episodes) {
    assert.deepEqual(Object.keys(entry).sort(), ["action", "dataScope", "ledgerId", "resourceType", "skill"]);
    assert.ok(!JSON.stringify(entry).includes("payload text"));
  }
});
