/**
 * Promotion machinery v1 (repeated behavior → Automation drafts) — contract:
 * detection needs the HIGHER promotion threshold and proposes only;
 * acceptance yields a status:"draft" spec with EMPTY steps (no fabricated
 * behavior) and a draft saved to a registry is invisible to `load` (the
 * executor cannot start it — fail closed); rejection suppresses the pattern;
 * promotion rows classify as learning machinery (never reach a prompt).
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { InMemoryMemoryStore, type MemoryAuthScope } from "../src/memory/memory-store.js";
import { InMemoryAutomationRegistry } from "../src/memory/stores.js";
import { isLearningObservationEntry, recordSignal } from "../src/learning/observation.js";
import {
  PROMOTION_MIN_REPETITIONS,
  acceptAutomationDraft,
  detectAutomationDraftCandidates,
  listPromotionSuggestions,
  rejectAutomationDraft,
} from "../src/learning/promotion.js";

const ORG = "org-1";
const USER = "user-1";
const SCOPE: MemoryAuthScope = { organizationId: ORG, userId: USER };

let idCounter = 0;
const nextId = () => `gen-${++idCounter}`;

async function seedDismissals(store: InMemoryMemoryStore, count: number, industry = "restaurants") {
  for (let i = 0; i < count; i += 1) {
    await recordSignal(store, {
      id: `sig-${industry}-${++idCounter}`,
      organizationId: ORG,
      ownerUserId: USER,
      moduleId: "dealpilot",
      recordKind: "deal",
      recordId: `deal-${industry}-${i}`,
      action: "dismiss",
      attributes: { industry },
    });
  }
}

test("detection requires the promotion threshold and proposes only", async () => {
  const store = new InMemoryMemoryStore();
  // Below promotion threshold (but above the preference digest's 3): nothing.
  await seedDismissals(store, PROMOTION_MIN_REPETITIONS - 1);
  const below = await detectAutomationDraftCandidates(store, {
    organizationId: ORG, ownerUserId: USER, moduleId: "dealpilot", nextId,
  });
  assert.equal(below.length, 0);

  // One more repetition crosses the threshold — exactly one proposal.
  await seedDismissals(store, 1);
  const proposed = await detectAutomationDraftCandidates(store, {
    organizationId: ORG, ownerUserId: USER, moduleId: "dealpilot", nextId,
  });
  assert.equal(proposed.length, 1);
  assert.equal(proposed[0]!.pattern.count, PROMOTION_MIN_REPETITIONS);
  assert.match(proposed[0]!.suggestedText, /never runs/);

  // Re-detection proposes nothing (lineage exists) — annoyance holds.
  const again = await detectAutomationDraftCandidates(store, {
    organizationId: ORG, ownerUserId: USER, moduleId: "dealpilot", nextId,
  });
  assert.equal(again.length, 0);
  const listed = await listPromotionSuggestions(store, SCOPE, "dealpilot", "proposed");
  assert.equal(listed.length, 1);
});

test("acceptance yields an inert draft; a registry draft is invisible to load", async () => {
  const store = new InMemoryMemoryStore();
  await seedDismissals(store, PROMOTION_MIN_REPETITIONS);
  const [proposal] = await detectAutomationDraftCandidates(store, {
    organizationId: ORG, ownerUserId: USER, moduleId: "dealpilot", nextId,
  });
  const { draft } = await acceptAutomationDraft(store, SCOPE, proposal!.memoryId, USER, nextId);
  assert.equal(draft.status, "draft");
  assert.deepEqual(draft.steps, []);
  assert.match(draft.description, /Inert until reviewed/);

  // Materialized into a registry, the draft is NOT loadable — which is the
  // exact seam the executor's runById goes through, so it cannot start.
  const registry = new InMemoryAutomationRegistry();
  await registry.save({
    id: "aaaaaaaa-0000-4000-8000-000000000d1f",
    organizationId: ORG,
    name: draft.name,
    agentId: "learning",
    agentPlane: "local",
    steps: draft.steps,
    status: draft.status,
  });
  assert.equal(registry.automations.size, 1);
  assert.equal(await registry.load(ORG, "aaaaaaaa-0000-4000-8000-000000000d1f"), null);

  // Double-accept fails typed.
  await assert.rejects(
    () => acceptAutomationDraft(store, SCOPE, proposal!.memoryId, USER, nextId),
    /already accepted/,
  );
});

test("rejection permanently suppresses the pattern", async () => {
  const store = new InMemoryMemoryStore();
  await seedDismissals(store, PROMOTION_MIN_REPETITIONS);
  const [proposal] = await detectAutomationDraftCandidates(store, {
    organizationId: ORG, ownerUserId: USER, moduleId: "dealpilot", nextId,
  });
  await rejectAutomationDraft(store, SCOPE, proposal!.memoryId, USER, nextId);
  await seedDismissals(store, 5);
  const after = await detectAutomationDraftCandidates(store, {
    organizationId: ORG, ownerUserId: USER, moduleId: "dealpilot", nextId,
  });
  assert.equal(after.length, 0);
});

test("promotion rows are learning machinery — excluded from prompt surfaces", async () => {
  const store = new InMemoryMemoryStore();
  await seedDismissals(store, PROMOTION_MIN_REPETITIONS);
  await detectAutomationDraftCandidates(store, {
    organizationId: ORG, ownerUserId: USER, moduleId: "dealpilot", nextId,
  });
  const rows = await store.retrieve({}, SCOPE);
  for (const row of rows) {
    assert.equal(isLearningObservationEntry(row), true, `expected machinery: ${row.content.slice(0, 60)}`);
  }
});

test("promotion and preference lineages are distinct — both can exist for one pattern", async () => {
  const store = new InMemoryMemoryStore();
  await seedDismissals(store, PROMOTION_MIN_REPETITIONS);
  const { digestSignals } = await import("../src/learning/observation.js");
  const preferences = await digestSignals(store, { organizationId: ORG, ownerUserId: USER, moduleId: "dealpilot", nextId });
  assert.equal(preferences.length, 1);
  const promotions = await detectAutomationDraftCandidates(store, {
    organizationId: ORG, ownerUserId: USER, moduleId: "dealpilot", nextId,
  });
  assert.equal(promotions.length, 1, "the preference suggestion must not suppress the promotion proposal");
});
