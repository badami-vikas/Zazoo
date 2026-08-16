/**
 * Learning observation loop v1 (LA2 slice) — end-to-end contract:
 * signals → digest → suggestion → accept/reject → preference → run-context
 * snippet. Also proves the canon invariants: suggested-then-accepted (digest
 * never writes a preference), annoyance cap, rejected patterns never
 * re-proposed, and authority scoping (another user cannot read or act on a
 * private suggestion).
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  InMemoryMemoryStore,
  type MemoryAuthScope,
} from "../src/memory/memory-store.js";
import {
  acceptSuggestion,
  digestSignals,
  isLearningObservationEntry,
  listSuggestions,
  preferencesToMemorySnippets,
  recordSignal,
  rejectSuggestion,
  retrieveLearnedPreferences,
  type ObservedSignal,
} from "../src/learning/observation.js";
import { assembleRunContext, projectToSystemPrompt } from "../src/run-context.js";
import { FixedClock, UuidGen } from "../src/determinism.js";
import type { RunCtx } from "../src/ports.js";

const ORG = "org-1";
const USER = "user-1";
const SCOPE: MemoryAuthScope = { organizationId: ORG, userId: USER };

let idCounter = 0;
const nextId = () => `gen-${++idCounter}`;

function dismissSignal(n: number, attributes: Record<string, string>): ObservedSignal {
  return {
    id: `sig-${++idCounter}`,
    organizationId: ORG,
    ownerUserId: USER,
    moduleId: "dealpilot",
    recordKind: "deal",
    recordId: `deal-${n}`,
    action: "dismiss",
    attributes,
  };
}

async function seedRepeatedDismissals(store: InMemoryMemoryStore, count: number) {
  for (let i = 0; i < count; i += 1) {
    await recordSignal(store, dismissSignal(i, { industry: "restaurants", geo: `city-${i}` }));
  }
}

test("recordSignal persists optional content, and omits the key when absent", async () => {
  // Task #80 / AP-157: the input lane distils redacted typed text and needs a
  // durable home for it. `content` is OPTIONAL and every other lane leaves it
  // unset — so a signal without it must serialize with no `content` key at
  // all, not `"content": null`. A null would read as "we looked and there was
  // nothing", which is a different claim from "this lane does not carry text".
  const store = new InMemoryMemoryStore();

  const withText = await recordSignal(store, {
    ...dismissSignal(1, { industry: "hvac" }),
    content: "buy milk and call the plumber",
  });
  const parsedWith = JSON.parse(withText.content) as Record<string, unknown>;
  assert.equal(parsedWith["content"], "buy milk and call the plumber");

  const withoutText = await recordSignal(store, dismissSignal(2, { industry: "hvac" }));
  const parsedWithout = JSON.parse(withoutText.content) as Record<string, unknown>;
  assert.equal(Object.prototype.hasOwnProperty.call(parsedWithout, "content"), false);

  // And it survives a round-trip through the store, not just the write call.
  const reread = await store.get(withText.id, SCOPE);
  assert.ok(reread);
  assert.equal((JSON.parse(reread.content) as Record<string, unknown>)["content"], "buy milk and call the plumber");

  // THE guard that keeps captured text out of model prompts. Retrieval fusion
  // (`retrieval-fusion.ts`, `retrieval-eval.ts`, and the router's memory
  // search) all filter with `!isLearningObservationEntry(entry)` — learning
  // machinery rows are EXCLUDED from what reaches a prompt. Adding `content`
  // gave these rows a prose body for the first time, so that exclusion is now
  // load-bearing for privacy and not merely for relevance: a content-carrying
  // signal row must still classify as machinery.
  assert.equal(isLearningObservationEntry(reread), true);
});

test("digest proposes a suggestion for a repeated pattern and writes NO preference", async () => {
  const store = new InMemoryMemoryStore();
  await seedRepeatedDismissals(store, 3);

  const created = await digestSignals(store, { organizationId: ORG, ownerUserId: USER, moduleId: "dealpilot", nextId });
  assert.equal(created.length, 1);
  assert.equal(created[0]!.status, "proposed");
  assert.equal(created[0]!.pattern.action, "dismiss");
  assert.equal(created[0]!.pattern.attributeKey, "industry");
  assert.equal(created[0]!.pattern.attributeValue, "restaurants");
  assert.equal(created[0]!.pattern.count, 3);
  assert.equal(created[0]!.pattern.evidenceSignalIds.length, 3);

  // Suggested-then-accepted: no preference exists until a Human accepts.
  const preferences = await retrieveLearnedPreferences(store, SCOPE, "dealpilot");
  assert.equal(preferences.length, 0);
});

test("below-threshold patterns and re-digest of an existing lineage propose nothing", async () => {
  const store = new InMemoryMemoryStore();
  await seedRepeatedDismissals(store, 2); // below default minRepetitions=3
  assert.equal((await digestSignals(store, { organizationId: ORG, ownerUserId: USER, moduleId: "dealpilot", nextId })).length, 0);

  await seedRepeatedDismissals(store, 3);
  assert.equal((await digestSignals(store, { organizationId: ORG, ownerUserId: USER, moduleId: "dealpilot", nextId })).length, 1);
  // Second digest over the same signals: the lineage already exists — no dupe.
  assert.equal((await digestSignals(store, { organizationId: ORG, ownerUserId: USER, moduleId: "dealpilot", nextId })).length, 0);
});

test("annoyance cap bounds new suggestions per digest run", async () => {
  const store = new InMemoryMemoryStore();
  // 5 distinct repeated patterns (5 industries × 3 dismissals each).
  for (const industry of ["a", "b", "c", "d", "e"]) {
    for (let i = 0; i < 3; i += 1) {
      await recordSignal(store, dismissSignal(idCounter, { industry }));
    }
  }
  const created = await digestSignals(store, {
    organizationId: ORG,
    ownerUserId: USER,
    moduleId: "dealpilot",
    maxSuggestions: 2,
    nextId,
  });
  assert.equal(created.length, 2);
});

test("accept mints a preference with provenance and it reaches the system prompt", async () => {
  const store = new InMemoryMemoryStore();
  await seedRepeatedDismissals(store, 4);
  const [suggestion] = await digestSignals(store, { organizationId: ORG, ownerUserId: USER, moduleId: "dealpilot", nextId });

  const { preference } = await acceptSuggestion(store, SCOPE, suggestion!.memoryId, USER, nextId);
  const preferences = await retrieveLearnedPreferences(store, SCOPE, "dealpilot");
  assert.equal(preferences.length, 1);
  assert.equal(preferences[0]!.memoryId, preference.id);
  assert.match(preferences[0]!.statement, /dismiss/);
  assert.match(preferences[0]!.statement, /restaurants/);
  assert.equal(preferences[0]!.provenance.evidenceSignalIds.length, 4);
  // Provenance chain: preference → accepted suggestion row.
  assert.ok(preferences[0]!.provenance.suggestionId);

  // LA1 exit criterion: the accepted Memory demonstrably changes agent output.
  const snippets = preferencesToMemorySnippets(preferences);
  const clock = new FixedClock("2026-08-01T12:00:00.000Z");
  const runCtx: RunCtx = {
    clock,
    rng: { next: () => 0.5 },
    ids: new UuidGen(clock, { next: () => 0.5 }),
  };
  const context = assembleRunContext(
    {
      persona: {
        id: "internal_strategist",
        name: "Internal Strategist",
        role: "You analyze deal fit and triage.",
        actorType: "agent",
        actorId: "internal_strategist",
      },
      request: "Triage the new deals.",
      governance: { approvalRequirement: "auto", trustGrants: [] },
      memory: snippets,
      outputContract: { description: "ranked triage list" },
    },
    runCtx,
  );
  const prompt = projectToSystemPrompt(context);
  assert.match(prompt, /Retrieved memory/);
  assert.match(prompt, /restaurants/);
});

test("reject writes no preference and permanently suppresses re-proposal", async () => {
  const store = new InMemoryMemoryStore();
  await seedRepeatedDismissals(store, 3);
  const [suggestion] = await digestSignals(store, { organizationId: ORG, ownerUserId: USER, moduleId: "dealpilot", nextId });
  await rejectSuggestion(store, SCOPE, suggestion!.memoryId, USER, nextId);

  assert.equal((await retrieveLearnedPreferences(store, SCOPE, "dealpilot")).length, 0);
  // More matching signals arrive; the rejected pattern must NOT come back.
  await seedRepeatedDismissals(store, 3);
  assert.equal((await digestSignals(store, { organizationId: ORG, ownerUserId: USER, moduleId: "dealpilot", nextId })).length, 0);
  const rejected = await listSuggestions(store, SCOPE, "dealpilot", "rejected");
  assert.equal(rejected.length, 1);
});

test("a second accept of the same suggestion fails (no double preference)", async () => {
  const store = new InMemoryMemoryStore();
  await seedRepeatedDismissals(store, 3);
  const [suggestion] = await digestSignals(store, { organizationId: ORG, ownerUserId: USER, moduleId: "dealpilot", nextId });
  await acceptSuggestion(store, SCOPE, suggestion!.memoryId, USER, nextId);
  await assert.rejects(() => acceptSuggestion(store, SCOPE, suggestion!.memoryId, USER, nextId), /already/);
  assert.equal((await retrieveLearnedPreferences(store, SCOPE, "dealpilot")).length, 1);
});

test("authority scoping: another user cannot read or act on private learning rows", async () => {
  const store = new InMemoryMemoryStore();
  await seedRepeatedDismissals(store, 3);
  const [suggestion] = await digestSignals(store, { organizationId: ORG, ownerUserId: USER, moduleId: "dealpilot", nextId });

  const otherScope: MemoryAuthScope = { organizationId: ORG, userId: "user-2" };
  assert.equal((await listSuggestions(store, otherScope, "dealpilot")).length, 0);
  await assert.rejects(() => acceptSuggestion(store, otherScope, suggestion!.memoryId, "user-2", nextId), /unknown or unauthorized/);
  assert.equal((await retrieveLearnedPreferences(store, otherScope, "dealpilot")).length, 0);
});

test("user can inspect and delete everything the loop stored", async () => {
  const store = new InMemoryMemoryStore();
  await seedRepeatedDismissals(store, 3);
  const [suggestion] = await digestSignals(store, { organizationId: ORG, ownerUserId: USER, moduleId: "dealpilot", nextId });
  const { preference } = await acceptSuggestion(store, SCOPE, suggestion!.memoryId, USER, nextId);

  // Inspect: every stored row is readable by its owner.
  assert.ok(await store.get(preference.id, SCOPE));
  // Delete: forget removes the preference (personal-data deletion exception).
  assert.equal(await store.forget(preference.id, SCOPE), true);
  assert.equal((await retrieveLearnedPreferences(store, SCOPE, "dealpilot")).length, 0);
});

test("module-less retrieval spans Modules and machinery rows are classifiable", async () => {
  const store = new InMemoryMemoryStore();
  // Two Modules each accumulate a repeated pattern and an acceptance.
  await seedRepeatedDismissals(store, 3);
  for (let i = 0; i < 3; i += 1) {
    await recordSignal(store, {
      id: `sig-job-${++idCounter}`,
      organizationId: ORG,
      ownerUserId: USER,
      moduleId: "jobpilot",
      recordKind: "job",
      recordId: `job-${i}`,
      action: "pursue",
      attributes: { seniority: "staff" },
    });
  }
  const [dealSuggestion] = await digestSignals(store, { organizationId: ORG, ownerUserId: USER, moduleId: "dealpilot", nextId });
  const [jobSuggestion] = await digestSignals(store, { organizationId: ORG, ownerUserId: USER, moduleId: "jobpilot", nextId });
  await acceptSuggestion(store, SCOPE, dealSuggestion!.memoryId, USER, nextId);
  await acceptSuggestion(store, SCOPE, jobSuggestion!.memoryId, USER, nextId);

  // Omitting moduleId returns BOTH Modules' preferences (the generic-surface
  // shape: chat may not know which Modules exist), each tagged with its own
  // moduleId parsed from the stored row.
  const all = await retrieveLearnedPreferences(store, SCOPE);
  assert.equal(all.length, 2);
  assert.deepEqual(new Set(all.map((p) => p.moduleId)), new Set(["dealpilot", "jobpilot"]));
  // A module filter still narrows.
  assert.equal((await retrieveLearnedPreferences(store, SCOPE, "jobpilot")).length, 1);

  // Every row the loop stored classifies as learning machinery; a plain
  // prose Memory and malformed content do not.
  const rows = await store.retrieve({}, SCOPE);
  assert.ok(rows.length >= 8);
  for (const row of rows) {
    assert.equal(isLearningObservationEntry(row), true, `expected machinery: ${row.content.slice(0, 60)}`);
  }
  assert.equal(isLearningObservationEntry({ content: "Prefers direct answers." }), false);
  assert.equal(isLearningObservationEntry({ content: JSON.stringify({ anchor: { kind: "red_flag" } }) }), false);
});
