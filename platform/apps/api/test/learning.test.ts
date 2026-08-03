/**
 * learning.* (TASK-032) — the observation-loop flight over the real
 * `buildWiring()` composition root.
 *
 * Contract under test:
 *  - flight OFF (default): `learning.status` reports disabled; every other
 *    `learning.*` procedure fails closed with `PRECONDITION_FAILED`;
 *  - flight ON: record decisions → digest proposes (never writes a
 *    preference) → accept mints exactly one preference with provenance →
 *    reject suppresses re-proposal → double-accept is a typed CONFLICT →
 *    another member's private rows are NOT_FOUND to this caller.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { TRPCError } from "@trpc/server";
import { SeededRng, SystemClock, UuidGen, hashTaintValue, labelAtSource, type RunCtx } from "@bridge/core";
import { appRouter } from "../src/router.js";
import {
  buildWiring,
  LEARNING_AGENT,
  LEARNING_DIGEST_AUTOMATION_ID,
  OBSERVATION_DIGEST_SKILL_ID,
  PILOT_ORGANIZATION,
  PILOT_USER,
  type Wiring,
} from "../src/wiring.js";

function makeRun(): RunCtx {
  const clock = new SystemClock();
  const rng = new SeededRng(29);
  return { clock, rng, ids: new UuidGen(clock, rng) };
}

async function makeCaller(wiring: Wiring, identity: { type: "user" | "team"; id: string } = { type: "user", id: PILOT_USER }) {
  return appRouter.createCaller({ wiring, run: makeRun(), identity, authenticated: true, verifying: false });
}

const ORG = PILOT_ORGANIZATION;

async function recordDismissals(caller: Awaited<ReturnType<typeof makeCaller>>, count: number, industry = "restaurants") {
  for (let i = 0; i < count; i += 1) {
    await caller.learning.recordDealDecision({
      organizationId: ORG,
      dealRecordId: `deal-${industry}-${i}`,
      action: "dismiss",
      profile: { industry, sde: 300_000 },
    });
  }
}

test("flight OFF: status reports disabled and every other procedure fails closed", async () => {
  const wiring = await buildWiring(); // default: flight off
  try {
    const caller = await makeCaller(wiring);
    assert.deepEqual(await caller.learning.status({ organizationId: ORG }), { enabled: false });
    await assert.rejects(
      () => caller.learning.recordDealDecision({ organizationId: ORG, dealRecordId: "deal-1", action: "dismiss", profile: {} }),
      (error: unknown) => error instanceof TRPCError && error.code === "PRECONDITION_FAILED",
    );
    await assert.rejects(
      () => caller.learning.digest({ organizationId: ORG }),
      (error: unknown) => error instanceof TRPCError && error.code === "PRECONDITION_FAILED",
    );
    await assert.rejects(
      () => caller.learning.suggestions.list({ organizationId: ORG }),
      (error: unknown) => error instanceof TRPCError && error.code === "PRECONDITION_FAILED",
    );
    await assert.rejects(
      () => caller.learning.preferences.list({ organizationId: ORG }),
      (error: unknown) => error instanceof TRPCError && error.code === "PRECONDITION_FAILED",
    );
  } finally {
    await wiring.close();
  }
});

test("flight ON: record → digest → accept mints one preference; reject suppresses; conflicts typed", async () => {
  const wiring = await buildWiring({ learningObservationEnabled: true });
  try {
    const caller = await makeCaller(wiring);
    assert.deepEqual(await caller.learning.status({ organizationId: ORG }), { enabled: true });

    // Record: attributes come back generalized (industry lowercased, SDE banded).
    const recorded = await caller.learning.recordDealDecision({
      organizationId: ORG,
      dealRecordId: "deal-restaurants-seed",
      action: "dismiss",
      profile: { industry: "Restaurants", sde: 300_000 },
      reason: "not interested in food service",
    });
    assert.equal(recorded.attributes["industry"], "restaurants");
    assert.equal(recorded.attributes["sde_band"], "sde_250k_500k");
    await recordDismissals(caller, 2);

    // Digest proposes (3+ same-industry dismissals) and writes NO preference.
    const digested = await caller.learning.digest({ organizationId: ORG });
    assert.ok(digested.suggestions.length >= 1);
    const suggestion = digested.suggestions.find((s) => s.pattern.attributeKey === "industry");
    assert.ok(suggestion, "expected an industry-pattern suggestion");
    assert.equal((await caller.learning.preferences.list({ organizationId: ORG })).preferences.length, 0);

    // Listed as proposed; accept mints exactly one preference with provenance.
    const listed = await caller.learning.suggestions.list({ organizationId: ORG, status: "proposed" });
    assert.ok(listed.suggestions.some((s) => s.memoryId === suggestion.memoryId));
    const accepted = await caller.learning.suggestions.accept({ organizationId: ORG, suggestionMemoryId: suggestion.memoryId });
    const preferences = (await caller.learning.preferences.list({ organizationId: ORG })).preferences;
    assert.equal(preferences.length, 1);
    assert.equal(preferences[0]!.memoryId, accepted.preferenceMemoryId);
    assert.equal(preferences[0]!.provenance.suggestionId, accepted.suggestionMemoryId);
    assert.ok(preferences[0]!.provenance.evidenceSignalIds.length >= 3);

    // Double-accept is a typed CONFLICT, and no second preference appears.
    await assert.rejects(
      () => caller.learning.suggestions.accept({ organizationId: ORG, suggestionMemoryId: suggestion.memoryId }),
      (error: unknown) => error instanceof TRPCError && error.code === "CONFLICT",
    );
    assert.equal((await caller.learning.preferences.list({ organizationId: ORG })).preferences.length, 1);

    // A second repeated pattern: reject it, then confirm more signals never
    // re-propose it and no preference was written for it.
    await recordDismissals(caller, 3, "logging");
    const second = await caller.learning.digest({ organizationId: ORG });
    const loggingSuggestion = second.suggestions.find((s) => s.pattern.attributeValue === "logging");
    assert.ok(loggingSuggestion, "expected a logging-pattern suggestion");
    await caller.learning.suggestions.reject({ organizationId: ORG, suggestionMemoryId: loggingSuggestion.memoryId });
    await recordDismissals(caller, 3, "logging");
    const third = await caller.learning.digest({ organizationId: ORG });
    assert.equal(third.suggestions.filter((s) => s.pattern.attributeValue === "logging").length, 0);
    assert.equal((await caller.learning.preferences.list({ organizationId: ORG })).preferences.length, 1);
  } finally {
    await wiring.close();
  }
});

test("flight OFF: the digest Automation does not exist — nothing to trigger", async () => {
  const wiring = await buildWiring();
  try {
    assert.equal(await wiring.automationRegistry.load(PILOT_ORGANIZATION, LEARNING_DIGEST_AUTOMATION_ID), null);
  } finally {
    await wiring.close();
  }
});

test("flight ON: the digest Automation is registered to the Learning Agent and runs the loop end to end", async () => {
  const wiring = await buildWiring({ learningObservationEnabled: true });
  try {
    // Registered: Learning Agent is the sole actor, one advisory Local step.
    const definition = await wiring.automationRegistry.load(PILOT_ORGANIZATION, LEARNING_DIGEST_AUTOMATION_ID);
    assert.ok(definition, "digest Automation must be registered while the flight is on");
    assert.equal(definition.agentId, LEARNING_AGENT);
    assert.equal(definition.agentPlane, "local");
    assert.equal(definition.steps.length, 1);
    assert.equal(definition.steps[0]!.skill, OBSERVATION_DIGEST_SKILL_ID);
    assert.ok(definition.steps[0]!.goalTaskRef, "the step must bind the Learning Agent's Goal/Task");

    // End to end: repeated dismissals → Automation run → proposed suggestion,
    // and STILL no preference (suggested-then-accepted survives the Automation path).
    const caller = await makeCaller(wiring);
    await recordDismissals(caller, 3, "trucking");
    // Same labeled RunCtx shape the server's scheduled trigger uses — the
    // taint sink gate fails closed on an UNKNOWN label by design.
    const result = await wiring.automationExecutor.runById(
      { organizationId: PILOT_ORGANIZATION, automationId: LEARNING_DIGEST_AUTOMATION_ID },
      {
        ...makeRun(),
        taintLabel: labelAtSource("system_generated", {
          ref: `schedule:${LEARNING_DIGEST_AUTOMATION_ID}`,
          valueHash: hashTaintValue({ automationId: LEARNING_DIGEST_AUTOMATION_ID }),
          sensitivity: "organization",
          instructionRisk: "data",
        }),
      },
    );
    assert.equal(result.status, "completed");
    const proposed = await caller.learning.suggestions.list({ organizationId: PILOT_ORGANIZATION, status: "proposed" });
    assert.ok(
      proposed.suggestions.some((s) => s.pattern.attributeValue === "trucking"),
      "the Automation-run digest must have proposed the trucking pattern",
    );
    assert.equal((await caller.learning.preferences.list({ organizationId: PILOT_ORGANIZATION })).preferences.length, 0);

    // Attributable Run record exists for the Automation.
    const runs = await wiring.automationRunRecorder.list(PILOT_ORGANIZATION, [LEARNING_DIGEST_AUTOMATION_ID], { limit: 5 });
    assert.ok(runs.length >= 1);
    assert.equal(runs[0]!.agentId, LEARNING_AGENT);
  } finally {
    await wiring.close();
  }
});

test("flight ON: another member cannot see or act on the owner's private learning rows", async () => {
  const wiring = await buildWiring({ learningObservationEnabled: true });
  try {
    const owner = await makeCaller(wiring);
    await recordDismissals(owner, 3);
    const [suggestion] = (await owner.learning.digest({ organizationId: ORG })).suggestions;
    assert.ok(suggestion);

    const invited = await owner.organization.inviteMember({
      organizationId: ORG,
      email: `test_fixture_learning_${Date.now()}@example.com`,
    });
    const other = await makeCaller(wiring, { type: "user", id: invited.userId });
    assert.equal((await other.learning.suggestions.list({ organizationId: ORG })).suggestions.length, 0);
    assert.equal((await other.learning.preferences.list({ organizationId: ORG })).preferences.length, 0);
    await assert.rejects(
      () => other.learning.suggestions.accept({ organizationId: ORG, suggestionMemoryId: suggestion.memoryId }),
      (error: unknown) => error instanceof TRPCError && error.code === "NOT_FOUND",
    );
  } finally {
    await wiring.close();
  }
});
