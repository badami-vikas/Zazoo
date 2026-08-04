/**
 * Capability archetypes (roadmap-v2 Phase 4) — contract:
 * generalization emits ONLY generalized fields and drops anything
 * personal-shaped (the Commons privacy gate applied at the source);
 * archetype seeding proposes on the SAME lineage as a local digest
 * (no duplicates, rejection suppresses both) and never mints a preference;
 * accepting a seeded suggestion mints a preference worded without a
 * fabricated observation count.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { InMemoryMemoryStore, type MemoryAuthScope } from "../src/memory/memory-store.js";
import {
  acceptSuggestion,
  digestSignals,
  listSuggestions,
  recordSignal,
  rejectSuggestion,
  retrieveLearnedPreferences,
} from "../src/learning/observation.js";
import {
  archetypeName,
  generalizeLearnedPreferences,
  seedSuggestionsFromArchetypes,
  supportBandForCount,
  type CapabilityArchetype,
} from "../src/learning/archetype.js";

const ORG = "org-1";
const USER = "user-1";
const SCOPE: MemoryAuthScope = { organizationId: ORG, userId: USER };

let idCounter = 0;
const nextId = () => `gen-${++idCounter}`;

function preference(action: string, key: string, value: string, count = 4) {
  return {
    memoryId: `mem-${++idCounter}`,
    moduleId: "dealpilot",
    statement: `Prefers "${action}" when ${key} is "${value}".`,
    pattern: { action, attributeKey: key, attributeValue: value, count, evidenceSignalIds: ["sig-1", "sig-2"] },
    provenance: { suggestionId: "sug-1", evidenceSignalIds: ["sig-1", "sig-2"] },
  };
}

function archetype(action: string, key: string, value: string): CapabilityArchetype {
  return {
    schemaVersion: 1,
    name: archetypeName("dealpilot", { action, attributeKey: key, attributeValue: value }),
    domain: "dealpilot",
    kind: "preference_pattern",
    action,
    attributeKey: key,
    attributeValue: value,
    supportBand: "3-5",
  };
}

test("generalization emits generalized fields only, banded support, deterministic names", () => {
  const candidates = generalizeLearnedPreferences(
    [preference("dismiss", "industry", "restaurants", 4), preference("pursue", "sde_band", "sde_250k_500k", 12)],
    "dealpilot",
  );
  assert.equal(candidates.length, 2);
  const [first, second] = candidates;
  assert.equal(first!.name, "preference.dealpilot.dismiss.industry.restaurants");
  assert.equal(first!.supportBand, "3-5");
  assert.equal(second!.supportBand, "11+");
  // No identifying fields anywhere in the payload.
  const json = JSON.stringify(candidates);
  assert.doesNotMatch(json, /mem-|sig-|sug-|org-1|user-1/);
  assert.ok(!json.includes("evidenceSignalIds"));
  assert.ok(!json.includes("memoryId"));
  // Deterministic: same input, same names.
  assert.deepEqual(
    generalizeLearnedPreferences([preference("dismiss", "industry", "restaurants", 4)], "dealpilot")[0]!.name,
    first!.name,
  );
  assert.equal(supportBandForCount(7), "6-10");
});

test("generalization drops personal-shaped values and duplicate patterns", () => {
  const candidates = generalizeLearnedPreferences(
    [
      preference("dismiss", "industry", "restaurants"),
      preference("dismiss", "industry", "restaurants"), // duplicate name
      preference("dismiss", "contact_email", "owner@example.com"), // email value
      preference("dismiss", "seller", "aaaaaaaa-0000-4000-8000-000000000001"), // uuid value
    ],
    "dealpilot",
  );
  assert.equal(candidates.length, 1);
  assert.equal(candidates[0]!.attributeValue, "restaurants");
});

test("seeding proposes on the digest's lineage, never mints, and respects the cap", async () => {
  const store = new InMemoryMemoryStore();
  const seeded = await seedSuggestionsFromArchetypes(store, {
    organizationId: ORG,
    ownerUserId: USER,
    moduleId: "dealpilot",
    archetypes: [
      archetype("dismiss", "industry", "restaurants"),
      archetype("pursue", "industry", "hvac"),
      archetype("dismiss", "geo", "out-of-state"),
      archetype("pursue", "sde_band", "sde_500k_1m"),
    ],
    nextId,
  });
  // Annoyance cap (default 3) bounds one seed run.
  assert.equal(seeded.length, 3);
  // Proposals only — zero preferences minted.
  assert.equal((await retrieveLearnedPreferences(store, SCOPE, "dealpilot")).length, 0);
  const listed = await listSuggestions(store, SCOPE, "dealpilot", "proposed");
  assert.equal(listed.length, 3);

  // Re-seeding proposes nothing new for existing lineages; the fourth
  // archetype now fits under the cap.
  const second = await seedSuggestionsFromArchetypes(store, {
    organizationId: ORG,
    ownerUserId: USER,
    moduleId: "dealpilot",
    archetypes: [
      archetype("dismiss", "industry", "restaurants"),
      archetype("pursue", "sde_band", "sde_500k_1m"),
    ],
    nextId,
  });
  assert.equal(second.length, 1);
  assert.equal(second[0]!.pattern.attributeValue, "sde_500k_1m");
});

test("a local digest and an archetype seed of the same pattern share one lineage", async () => {
  const store = new InMemoryMemoryStore();
  // 3 local dismissals digest into a local suggestion first.
  for (let i = 0; i < 3; i += 1) {
    await recordSignal(store, {
      id: `sig-local-${++idCounter}`,
      organizationId: ORG,
      ownerUserId: USER,
      moduleId: "dealpilot",
      recordKind: "deal",
      recordId: `deal-${i}`,
      action: "dismiss",
      attributes: { industry: "restaurants" },
    });
  }
  const digested = await digestSignals(store, { organizationId: ORG, ownerUserId: USER, moduleId: "dealpilot", nextId });
  assert.equal(digested.length, 1);
  // Seeding the same pattern proposes NOTHING — one lineage, no duplicate.
  const seeded = await seedSuggestionsFromArchetypes(store, {
    organizationId: ORG,
    ownerUserId: USER,
    moduleId: "dealpilot",
    archetypes: [archetype("dismiss", "industry", "restaurants")],
    nextId,
  });
  assert.equal(seeded.length, 0);

  // And a REJECTED seeded pattern suppresses a later local digest of it.
  const seededOther = await seedSuggestionsFromArchetypes(store, {
    organizationId: ORG,
    ownerUserId: USER,
    moduleId: "dealpilot",
    archetypes: [archetype("pursue", "industry", "hvac")],
    nextId,
  });
  await rejectSuggestion(store, SCOPE, seededOther[0]!.memoryId, USER, nextId);
  for (let i = 0; i < 3; i += 1) {
    await recordSignal(store, {
      id: `sig-hvac-${++idCounter}`,
      organizationId: ORG,
      ownerUserId: USER,
      moduleId: "dealpilot",
      recordKind: "deal",
      recordId: `deal-hvac-${i}`,
      action: "pursue",
      attributes: { industry: "hvac" },
    });
  }
  const redigested = await digestSignals(store, { organizationId: ORG, ownerUserId: USER, moduleId: "dealpilot", nextId });
  assert.ok(!redigested.some((s) => s.pattern.attributeValue === "hvac"), "rejected seeded pattern must stay suppressed");
});

test("accepting a seeded suggestion mints a preference without a fabricated count", async () => {
  const store = new InMemoryMemoryStore();
  const [seeded] = await seedSuggestionsFromArchetypes(store, {
    organizationId: ORG,
    ownerUserId: USER,
    moduleId: "dealpilot",
    archetypes: [archetype("dismiss", "industry", "restaurants")],
    nextId,
  });
  const { preference: minted } = await acceptSuggestion(store, SCOPE, seeded!.memoryId, USER, nextId);
  const preferences = await retrieveLearnedPreferences(store, SCOPE, "dealpilot");
  assert.equal(preferences.length, 1);
  assert.equal(preferences[0]!.memoryId, minted.id);
  assert.match(preferences[0]!.statement, /Prefers "dismiss" when industry is "restaurants"\./);
  assert.doesNotMatch(preferences[0]!.statement, /seen 0 times/);
});
