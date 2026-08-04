/**
 * learning.archetypes.* (roadmap-v2 Phase 4) over the real `buildWiring()`
 * composition root, with an in-memory CommonsRegistry swapped onto the wiring
 * (same pattern as commons.test.ts).
 *
 * Contract under test:
 *  - both flights required — either off fails closed with PRECONDITION_FAILED;
 *  - preview derives candidates locally and publishes nothing;
 *  - contribute publishes ONLY generalized fields (asserted against the
 *    same organization-data gate the Commons server runs) and only the
 *    names the Human approved;
 *  - a SECOND organization seeding from the Commons receives the pattern as a
 *    PROPOSED suggestion (never a preference) — "every new organization starts
 *    smarter" while suggested-then-accepted holds;
 *  - a registry without archetype support fails closed with a typed error.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { TRPCError } from "@trpc/server";
import {
  SeededRng,
  SystemClock,
  UuidGen,
  findOrganizationDataPaths,
  type CapabilityArchetype,
  type CommonsArchetypeEntry,
  type CommonsRegistry,
  type RunCtx,
} from "@bridge/core";
import { appRouter } from "../src/router.js";
import { buildWiring, PILOT_ORGANIZATION, PILOT_USER, type Wiring } from "../src/wiring.js";

function makeRun(seed: number): RunCtx {
  const clock = new SystemClock();
  const rng = new SeededRng(seed);
  return { clock, rng, ids: new UuidGen(clock, rng) };
}

function makeCaller(wiring: Wiring, seed = 41) {
  return appRouter.createCaller({
    wiring,
    run: makeRun(seed),
    identity: { type: "user" as const, id: PILOT_USER },
    authenticated: true,
    verifying: false,
  });
}

/** In-memory archetype-capable registry double. Module methods are unused by
 * these procedures and fail loudly if reached. */
class ArchetypeRegistryDouble implements CommonsRegistry {
  readonly entries = new Map<string, CommonsArchetypeEntry>();
  readonly publishedPayloads: CapabilityArchetype[] = [];

  async listAvailable(): Promise<never> {
    throw new Error("not used by archetype tests");
  }
  async get(): Promise<never> {
    throw new Error("not used by archetype tests");
  }
  async getVersion(): Promise<never> {
    throw new Error("not used by archetype tests");
  }
  async publish(): Promise<never> {
    throw new Error("not used by archetype tests");
  }

  async listArchetypes(query: { domain?: string } = {}) {
    const archetypes = [...this.entries.values()].filter(
      (entry) => !query.domain || entry.archetype.domain === query.domain,
    );
    return { archetypes, total: archetypes.length };
  }

  async publishArchetype(archetype: CapabilityArchetype) {
    this.publishedPayloads.push(archetype);
    const existing = this.entries.get(archetype.name);
    if (existing) return { name: archetype.name, contentHash: existing.integrity.value };
    const entry: CommonsArchetypeEntry = {
      archetype,
      tags: [archetype.domain],
      integrity: { algorithm: "sha256", value: `sha256:${"0".repeat(64)}` },
      publishedAt: new Date().toISOString(),
    };
    this.entries.set(archetype.name, entry);
    return { name: archetype.name, contentHash: entry.integrity.value };
  }
}

function swapRegistry(wiring: Wiring, registry: CommonsRegistry): void {
  (wiring as { commonsRegistry: CommonsRegistry }).commonsRegistry = registry;
}

const ORG = PILOT_ORGANIZATION;

async function acceptOneDismissPattern(caller: ReturnType<typeof makeCaller>) {
  for (let i = 0; i < 4; i += 1) {
    await caller.learning.recordDealDecision({
      organizationId: ORG,
      dealRecordId: `deal-arch-${i}`,
      action: "dismiss",
      profile: { industry: "Restaurants", sde: 300_000 },
    });
  }
  const digested = await caller.learning.digest({ organizationId: ORG });
  const suggestion = digested.suggestions.find((s) => s.pattern.attributeKey === "industry");
  assert.ok(suggestion, "expected an industry suggestion");
  await caller.learning.suggestions.accept({ organizationId: ORG, suggestionMemoryId: suggestion.memoryId });
}

test("either flight off fails closed for every archetype procedure", async () => {
  const learningOnly = await buildWiring({ learningObservationEnabled: true });
  try {
    const caller = makeCaller(learningOnly);
    for (const call of [
      () => caller.learning.archetypes.preview({ organizationId: ORG }),
      () => caller.learning.archetypes.contribute({ organizationId: ORG, names: ["x"] }),
      () => caller.learning.archetypes.seed({ organizationId: ORG }),
    ]) {
      await assert.rejects(call, (error: unknown) => error instanceof TRPCError && error.code === "PRECONDITION_FAILED");
    }
  } finally {
    await learningOnly.close();
  }
  const archetypesOnly = await buildWiring({ commonsArchetypesEnabled: true });
  try {
    const caller = makeCaller(archetypesOnly);
    await assert.rejects(
      () => caller.learning.archetypes.preview({ organizationId: ORG }),
      (error: unknown) => error instanceof TRPCError && error.code === "PRECONDITION_FAILED",
    );
  } finally {
    await archetypesOnly.close();
  }
});

test("contribute publishes generalized-only payloads; a fresh organization seeds them as proposals", async () => {
  const registry = new ArchetypeRegistryDouble();

  // Organization A: observe → digest → Human accepts → preview → contribute.
  const organizationA = await buildWiring({ learningObservationEnabled: true, commonsArchetypesEnabled: true });
  try {
    swapRegistry(organizationA, registry);
    const caller = makeCaller(organizationA, 42);
    await acceptOneDismissPattern(caller);

    const preview = await caller.learning.archetypes.preview({ organizationId: ORG });
    assert.ok(preview.candidates.length >= 1);
    const industry = preview.candidates.find((c) => c.attributeKey === "industry");
    assert.ok(industry);
    assert.equal(industry.name, "preference.dealpilot.dismiss.industry.restaurants");
    // Preview alone publishes nothing.
    assert.equal(registry.publishedPayloads.length, 0);

    const contributed = await caller.learning.archetypes.contribute({
      organizationId: ORG,
      names: [industry.name],
    });
    assert.equal(contributed.published.length, 1);
    // Only the approved name was published, and the payload is generalized
    // fields only — the Commons privacy gate would find nothing.
    assert.equal(registry.publishedPayloads.length, 1);
    const payload = registry.publishedPayloads[0]!;
    assert.deepEqual(findOrganizationDataPaths(payload), []);
    const json = JSON.stringify(payload);
    assert.doesNotMatch(json, /deal-arch|evidenceSignalIds|memoryId/);
    assert.ok(!json.includes(PILOT_USER) && !json.includes(ORG));
  } finally {
    await organizationA.close();
  }

  // Organization B: brand new, zero signals — seeding proposes, never mints.
  const organizationB = await buildWiring({ learningObservationEnabled: true, commonsArchetypesEnabled: true });
  try {
    swapRegistry(organizationB, registry);
    const caller = makeCaller(organizationB, 43);
    const seeded = await caller.learning.archetypes.seed({ organizationId: ORG });
    assert.equal(seeded.seeded.length, 1);
    assert.match(seeded.seeded[0]!.suggestedText, /Organizations like yours/);

    const listed = await caller.learning.suggestions.list({ organizationId: ORG, status: "proposed" });
    assert.ok(listed.suggestions.some((s) => s.memoryId === seeded.seeded[0]!.memoryId));
    assert.equal((await caller.learning.preferences.list({ organizationId: ORG })).preferences.length, 0);

    // Re-seed is idempotent (same lineage), and accepting mints exactly one
    // preference worded without a fabricated observation count.
    assert.equal((await caller.learning.archetypes.seed({ organizationId: ORG })).seeded.length, 0);
    await caller.learning.suggestions.accept({
      organizationId: ORG,
      suggestionMemoryId: seeded.seeded[0]!.memoryId,
    });
    const preferences = (await caller.learning.preferences.list({ organizationId: ORG })).preferences;
    assert.equal(preferences.length, 1);
    assert.doesNotMatch(preferences[0]!.statement, /seen 0 times/);
  } finally {
    await organizationB.close();
  }
});

test("a Commons deployment without archetype support fails closed with a typed error", async () => {
  const wiring = await buildWiring({ learningObservationEnabled: true, commonsArchetypesEnabled: true });
  try {
    const bare: CommonsRegistry = {
      listAvailable: async () => ({ items: [], total: 0, limit: 50, offset: 0 }),
      get: async () => null,
      getVersion: async () => null,
      publish: async () => ({ name: "n", version: "1.0.0", contentHash: "sha256:x" }),
    };
    swapRegistry(wiring, bare);
    const caller = makeCaller(wiring);
    await assert.rejects(
      () => caller.learning.archetypes.seed({ organizationId: ORG }),
      (error: unknown) =>
        error instanceof TRPCError &&
        error.code === "PRECONDITION_FAILED" &&
        error.message.includes("does not support archetypes"),
    );
  } finally {
    await wiring.close();
  }
});
