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
