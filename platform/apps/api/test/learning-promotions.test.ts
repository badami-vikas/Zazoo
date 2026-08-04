/**
 * learning.promotions.* over the real `buildWiring()` composition root.
 *
 * Contract under test:
 *  - flight OFF fails every promotions procedure closed;
 *  - repeated decisions below the promotion threshold propose nothing even
 *    though the preference digest would fire;
 *  - crossing the threshold proposes; accept saves a status:"draft"
 *    Automation that the registry refuses to load and the EXECUTOR therefore
 *    cannot start (fail closed, proven through the real executor);
 *  - reject suppresses re-proposal; double-accept is a typed CONFLICT.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { TRPCError } from "@trpc/server";
import {
  PROMOTION_MIN_REPETITIONS,
  SeededRng,
  SystemClock,
  UuidGen,
  type InMemoryAutomationRegistry,
  type RunCtx,
} from "@bridge/core";
import { appRouter } from "../src/router.js";
import { buildWiring, PILOT_ORGANIZATION, PILOT_USER, type Wiring } from "../src/wiring.js";

function makeRun(): RunCtx {
  const clock = new SystemClock();
  const rng = new SeededRng(47);
  return { clock, rng, ids: new UuidGen(clock, rng) };
}

function makeCaller(wiring: Wiring) {
  return appRouter.createCaller({
    wiring,
    run: makeRun(),
    identity: { type: "user" as const, id: PILOT_USER },
    authenticated: true,
    verifying: false,
  });
}

const ORG = PILOT_ORGANIZATION;

async function recordDismissals(caller: ReturnType<typeof makeCaller>, count: number, offset = 0) {
  for (let i = 0; i < count; i += 1) {
    await caller.learning.recordDealDecision({
      organizationId: ORG,
      dealRecordId: `deal-promo-${offset + i}`,
      action: "dismiss",
      profile: { industry: "restaurants" },
    });
  }
}

test("flight OFF: every promotions procedure fails closed", async () => {
  const wiring = await buildWiring();
  try {
    const caller = makeCaller(wiring);
    for (const call of [
      () => caller.learning.promotions.propose({ organizationId: ORG }),
      () => caller.learning.promotions.list({ organizationId: ORG }),
      () => caller.learning.promotions.accept({ organizationId: ORG, suggestionMemoryId: "x" }),
      () => caller.learning.promotions.reject({ organizationId: ORG, suggestionMemoryId: "x" }),
    ]) {
      await assert.rejects(call, (error: unknown) => error instanceof TRPCError && error.code === "PRECONDITION_FAILED");
    }
  } finally {
    await wiring.close();
  }
});

test("threshold → propose → accept saves an executor-proof draft; reject suppresses", async () => {
  const wiring = await buildWiring({ learningObservationEnabled: true });
  try {
    const caller = makeCaller(wiring);

    // Below the promotion threshold: preference digest territory, no drafts.
    await recordDismissals(caller, PROMOTION_MIN_REPETITIONS - 1);
    const below = await caller.learning.promotions.propose({ organizationId: ORG });
    assert.equal(below.suggestions.length, 0);

    // Crossing the threshold proposes exactly one (industry pattern).
    await recordDismissals(caller, 1, PROMOTION_MIN_REPETITIONS - 1);
    const proposed = await caller.learning.promotions.propose({ organizationId: ORG });
    const suggestion = proposed.suggestions.find((s) => s.pattern.attributeKey === "industry");
    assert.ok(suggestion, "expected an industry promotion proposal");
    assert.match(suggestion.suggestedText, /never runs/);

    // Accept: draft Automation saved, registry load returns NULL, and the
    // real executor cannot start it.
    const accepted = await caller.learning.promotions.accept({
      organizationId: ORG,
      suggestionMemoryId: suggestion.memoryId,
    });
    assert.equal(accepted.status, "draft");
    const registry = wiring.automationRegistry as InMemoryAutomationRegistry;
    const stored = registry.automations.get(`${ORG}:${accepted.automationId}`);
    assert.ok(stored, "draft row must exist in the registry store");
    assert.equal(stored.status, "draft");
    assert.deepEqual(stored.steps, []);
    assert.equal(await wiring.automationRegistry.load(ORG, accepted.automationId), null);
    await assert.rejects(
      () => wiring.automationExecutor.runById({ organizationId: ORG, automationId: accepted.automationId }, makeRun()),
      /not found/,
    );

    // Double-accept = typed CONFLICT.
    await assert.rejects(
      () => caller.learning.promotions.accept({ organizationId: ORG, suggestionMemoryId: suggestion.memoryId }),
      (error: unknown) => error instanceof TRPCError && error.code === "CONFLICT",
    );

    // List reflects the accepted head.
    const listed = await caller.learning.promotions.list({ organizationId: ORG, status: "accepted" });
    assert.equal(listed.suggestions.length, 1);

    // A second pattern: reject it, then more repetitions never re-propose.
    for (let i = 0; i < PROMOTION_MIN_REPETITIONS; i += 1) {
      await caller.learning.recordDealDecision({
        organizationId: ORG,
        dealRecordId: `deal-geo-${i}`,
        action: "pursue",
        profile: { geo: "Texas" },
      });
    }
    const second = await caller.learning.promotions.propose({ organizationId: ORG });
    const geoSuggestion = second.suggestions.find((s) => s.pattern.attributeKey === "geo");
    assert.ok(geoSuggestion);
    await caller.learning.promotions.reject({ organizationId: ORG, suggestionMemoryId: geoSuggestion.memoryId });
    for (let i = 0; i < 4; i += 1) {
      await caller.learning.recordDealDecision({
        organizationId: ORG,
        dealRecordId: `deal-geo-more-${i}`,
        action: "pursue",
        profile: { geo: "Texas" },
      });
    }
    const after = await caller.learning.promotions.propose({ organizationId: ORG });
    assert.ok(!after.suggestions.some((s) => s.pattern.attributeKey === "geo"), "rejected pattern must stay suppressed");
  } finally {
    await wiring.close();
  }
});

test("draft lifecycle: list → empty-steps activation refused → update with a real skill → activate → executor-visible", async () => {
  const wiring = await buildWiring({ learningObservationEnabled: true });
  try {
    const caller = makeCaller(wiring);
    await recordDismissals(caller, PROMOTION_MIN_REPETITIONS);
    const proposed = await caller.learning.promotions.propose({ organizationId: ORG });
    const suggestion = proposed.suggestions.find((s) => s.pattern.attributeKey === "industry");
    assert.ok(suggestion);
    const accepted = await caller.learning.promotions.accept({
      organizationId: ORG,
      suggestionMemoryId: suggestion.memoryId,
    });

    // The draft surfaces on the review list (and ONLY there — load is null).
    const listed = await caller.learning.promotions.drafts.list({ organizationId: ORG });
    const draft = listed.drafts.find((d) => d.id === accepted.automationId);
    assert.ok(draft, "accepted draft must appear on the drafts list");
    assert.equal(draft.status, "draft");
    assert.deepEqual(draft.steps, []);

    // Governance gate 1: an empty draft cannot activate.
    await assert.rejects(
      () => caller.learning.promotions.drafts.activate({ organizationId: ORG, automationId: accepted.automationId }),
      (error: unknown) =>
        error instanceof TRPCError && error.code === "PRECONDITION_FAILED" && /no steps/.test(error.message),
    );

    // Governance gate 2: steps naming an unregistered skill are refused.
    await assert.rejects(
      () =>
        caller.learning.promotions.drafts.update({
          organizationId: ORG,
          automationId: accepted.automationId,
          steps: [{ skill: "no.such.skill", action: "write", resourceType: "signal" }],
        }),
      (error: unknown) => error instanceof TRPCError && error.code === "BAD_REQUEST" && /unknown skill/.test(error.message),
    );

    // A real registered governed skill (the observation digest, present
    // while the learning flight is on) makes the draft completable.
    const updated = await caller.learning.promotions.drafts.update({
      organizationId: ORG,
      automationId: accepted.automationId,
      steps: [{ skill: "learning.observationDigest", action: "write", resourceType: "signal", dataScope: "all" }],
    });
    assert.equal(updated.steps, 1);
    assert.equal(updated.status, "draft");
    // Still a draft — still invisible to the executor's seam.
    assert.equal(await wiring.automationRegistry.load(ORG, accepted.automationId), null);

    // Activation flips the one bit that makes it startable.
    const activated = await caller.learning.promotions.drafts.activate({
      organizationId: ORG,
      automationId: accepted.automationId,
    });
    assert.equal(activated.status, "active");
    const loaded = await wiring.automationRegistry.load(ORG, accepted.automationId);
    assert.ok(loaded, "an activated Automation must be loadable (executor-startable seam)");
    assert.equal(loaded.steps.length, 1);
    assert.equal((await caller.learning.promotions.drafts.list({ organizationId: ORG })).drafts.length, 0);
  } finally {
    await wiring.close();
  }
});
