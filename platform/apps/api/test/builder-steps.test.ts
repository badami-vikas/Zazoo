/**
 * K9 rung 3 over the real `buildWiring()` composition root (AI Harness K9,
 * TASK-053) — the Builder drafts automation STEPS from a promotion pattern
 * plus its REAL ledger episodes:
 *
 *  - the full path: ledger decision rows → mined-shape signals → promotion
 *    proposal → Human accept (empty draft) → proposeSteps derives the ONE
 *    step the episodes demonstrate, validated by the canonical step parser,
 *    saved on the still-draft row;
 *  - an out-of-registry skill is REFUSED with a structured reason, the
 *    draft stays empty, and the empty draft still cannot activate (the
 *    existing activation gates bind unchanged);
 *  - a behavior rhythm (K7-style appName pattern) has no skill to bind —
 *    structured refusal, not an error;
 *  - Human-only; flight-off fails closed.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { TRPCError } from "@trpc/server";
import {
  SeededRng,
  SystemClock,
  UuidGen,
  recordSignal,
  type LedgerEntry,
  type ObservedSignal,
  type RunCtx,
} from "@bridge/core";
import { appRouter } from "../src/router.js";
import {
  buildWiring,
  OBSERVATION_DIGEST_SKILL_ID,
  PILOT_ORGANIZATION,
  PILOT_USER,
  type Wiring,
} from "../src/wiring.js";
import { makeCaller, makeRun } from "./caller.js";

const ORG = PILOT_ORGANIZATION;

/** Append one PROPOSAL + one affirming DECISION row for a skill — the real
 * two-row shape the pipeline writes, which `episodesForSkill` narrows to
 * decision rows. */
async function appendEpisode(wiring: Wiring, run: RunCtx, skill: string, n: number) {
  const proposalId = run.ids.next();
  const base = {
    organizationId: ORG,
    actorType: "user" as const,
    actorId: PILOT_USER,
    action: "execute" as const,
    skill,
    resourceType: "record" as const,
    resourceId: `record-${n}`,
    inputs: { note: `episode ${n} — content the Builder must never see` },
    policyResults: [],
    dataScope: "private" as const,
  };
  await wiring.ledger.append({ ...base, id: proposalId, userDecision: null } as unknown as LedgerEntry);
  await wiring.ledger.append({
    ...base,
    id: run.ids.next(),
    userDecision: "approve",
    refLedgerId: proposalId,
  } as unknown as LedgerEntry);
}

/** Write one mined-shape observed signal (what K1's miner derives from a
 * decision row) so the promotion detector can cross its threshold. The
 * miner itself is covered by its own suite — this test's REAL evidence path
 * is the ledger episodes proposeSteps reads back. */
async function writeMinedSignal(wiring: Wiring, run: RunCtx, moduleId: string, skillOrAttrs: Record<string, string>, action: string) {
  const signal: ObservedSignal = {
    id: run.ids.next(),
    organizationId: ORG,
    ownerUserId: PILOT_USER,
    moduleId,
    recordKind: "record",
    recordId: run.ids.next(),
    action,
    attributes: skillOrAttrs,
    observedAt: new Date().toISOString(),
  };
  await recordSignal(wiring.memoryStore, signal);
}

test("full rung-3 path: episodes → pattern → accept → proposeSteps derives the demonstrated step onto the still-draft row", async () => {
  const wiring = await buildWiring({ learningObservationEnabled: true });
  const run = makeRun();
  try {
    const caller = makeCaller(wiring);
    for (let n = 0; n < 6; n += 1) {
      await appendEpisode(wiring, run, OBSERVATION_DIGEST_SKILL_ID, n);
      await writeMinedSignal(wiring, run, "learning", { skill: OBSERVATION_DIGEST_SKILL_ID }, "approve");
    }

    await caller.learning.promotions.propose({ organizationId: ORG, moduleId: "learning" });
    const { suggestions } = await caller.learning.promotions.list({
      organizationId: ORG,
      moduleId: "learning",
      status: "proposed",
    });
    assert.equal(suggestions.length, 1);
    const accepted = await caller.learning.promotions.accept({
      organizationId: ORG,
      suggestionMemoryId: suggestions[0]!.memoryId,
    });

    const proposed = await caller.learning.promotions.drafts.proposeSteps({
      organizationId: ORG,
      automationId: accepted.automationId,
    });
    assert.ok(proposed.proposed, JSON.stringify(proposed));
    assert.deepEqual(proposed.steps, [
      {
        skill: OBSERVATION_DIGEST_SKILL_ID,
        action: "execute",
        resourceType: "record",
        dataScope: "private",
      },
    ]);
    assert.equal(proposed.evidence.episodeCount, 6);
    assert.equal(proposed.evidence.distinctShapes, 1);

    // The steps landed on the draft — and it is STILL a draft.
    const { drafts } = await caller.learning.promotions.drafts.list({ organizationId: ORG });
    const draft = drafts.find((definition) => definition.id === accepted.automationId);
    assert.ok(draft);
    assert.equal(draft.steps.length, 1);
    assert.equal(draft.steps[0]!.skill, OBSERVATION_DIGEST_SKILL_ID);
    // Payload content from the episodes never reaches the draft.
    assert.ok(!JSON.stringify(draft).includes("content the Builder must never see"));
  } finally {
    await wiring.close();
  }
});

test("out-of-registry skill: structured refusal, draft stays empty, empty draft still cannot activate", async () => {
  const wiring = await buildWiring({ learningObservationEnabled: true });
  const run = makeRun();
  try {
    const caller = makeCaller(wiring);
    const GHOST = "ghostmodule.vanishedSkill";
    for (let n = 0; n < 6; n += 1) {
      await appendEpisode(wiring, run, GHOST, n);
      await writeMinedSignal(wiring, run, "ghostmodule", { skill: GHOST }, "approve");
    }
    await caller.learning.promotions.propose({ organizationId: ORG, moduleId: "ghostmodule" });
    const { suggestions } = await caller.learning.promotions.list({
      organizationId: ORG,
      moduleId: "ghostmodule",
      status: "proposed",
    });
    const accepted = await caller.learning.promotions.accept({
      organizationId: ORG,
      suggestionMemoryId: suggestions[0]!.memoryId,
    });

    const refused = await caller.learning.promotions.drafts.proposeSteps({
      organizationId: ORG,
      automationId: accepted.automationId,
    });
    assert.equal(refused.proposed, false);
    assert.ok(!refused.proposed && refused.reason === "skill_not_registered");
    assert.match(!refused.proposed ? refused.detail : "", /not in the skill registry/);

    const { drafts } = await caller.learning.promotions.drafts.list({ organizationId: ORG });
    const draft = drafts.find((definition) => definition.id === accepted.automationId);
    assert.equal(draft?.steps.length, 0, "a refusal writes nothing onto the draft");
    await assert.rejects(
      caller.learning.promotions.drafts.activate({ organizationId: ORG, automationId: accepted.automationId }),
      (error: unknown) => error instanceof TRPCError && error.code === "PRECONDITION_FAILED",
    );
  } finally {
    await wiring.close();
  }
});

test("a K7-style behavior rhythm has no skill to bind: structured refusal, never an error", async () => {
  const wiring = await buildWiring({ learningObservationEnabled: true });
  const run = makeRun();
  try {
    const caller = makeCaller(wiring);
    for (let n = 0; n < 6; n += 1) {
      await writeMinedSignal(wiring, run, "apps", { appName: "Xcode" }, "focus");
    }
    await caller.learning.promotions.propose({ organizationId: ORG, moduleId: "apps" });
    const { suggestions } = await caller.learning.promotions.list({
      organizationId: ORG,
      moduleId: "apps",
      status: "proposed",
    });
    const accepted = await caller.learning.promotions.accept({
      organizationId: ORG,
      suggestionMemoryId: suggestions[0]!.memoryId,
    });
    const refused = await caller.learning.promotions.drafts.proposeSteps({
      organizationId: ORG,
      automationId: accepted.automationId,
    });
    assert.ok(!refused.proposed && refused.reason === "pattern_not_skill_shaped");
    assert.match(refused.detail, /behavior rhythm/);
  } finally {
    await wiring.close();
  }
});

test("Human-only and flight-off fail closed", async () => {
  const wiring = await buildWiring({ learningObservationEnabled: true });
  try {
    const agent = makeCaller(wiring, { type: "agent", id: PILOT_USER });
    await assert.rejects(
      agent.learning.promotions.drafts.proposeSteps({ organizationId: ORG, automationId: "00000000-0000-4000-8000-000000000001" }),
      (error: unknown) => error instanceof TRPCError && error.code === "FORBIDDEN",
    );
  } finally {
    await wiring.close();
  }

  const flightOff = await buildWiring({ learningObservationEnabled: false });
  try {
    const caller = makeCaller(flightOff);
    await assert.rejects(
      caller.learning.promotions.drafts.proposeSteps({ organizationId: ORG, automationId: "00000000-0000-4000-8000-000000000001" }),
      (error: unknown) => error instanceof TRPCError && error.code === "PRECONDITION_FAILED",
    );
  } finally {
    await flightOff.close();
  }
});
