/**
 * K6 commitment detection + suggestion lifecycle (AI Harness K6) — the
 * contract: detection is deterministic, first-person, precision-biased
 * (negations and questions never match); due phrases resolve against the
 * supplied clock only; the annoyance cap DEFERS over-cap candidates without
 * writing their lineage (re-proposable later) while a rejected suggestion
 * holds its lineage forever; acceptance returns the candidate for governed
 * materialization and never writes a Commitment itself.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  InMemoryMemoryStore,
  acceptCommitmentSuggestion,
  commitmentSuggestionLineageKey,
  detectCommitmentCandidates,
  listCommitmentSuggestions,
  MAX_COMMITMENT_SUGGESTIONS_PER_RUN,
  MAX_OUTSTANDING_COMMITMENT_SUGGESTIONS,
  proposeCommitmentSuggestions,
  rejectCommitmentSuggestion,
  resolveDuePhrase,
} from "../src/index.js";

const SCOPE = { organizationId: "org-1", userId: "user-1" };
// A Monday, mid-morning.
const NOW = "2026-08-10T09:30:00.000Z";

function idCounter() {
  let n = 0;
  return () => `00000000-0000-4000-8000-${String(++n).padStart(12, "0")}`;
}

test("detection: a first-person promise with a due phrase and a counterparty is one candidate", () => {
  const candidates = detectCommitmentCandidates(
    "Thanks for the call. I'll send Priya the revised deck by Friday. Talk soon.",
    NOW,
  );
  assert.equal(candidates.length, 1);
  const candidate = candidates[0]!;
  assert.equal(candidate.text, "I'll send Priya the revised deck by Friday.");
  assert.equal(candidate.counterpartyHint, "Priya");
  assert.equal(candidate.dueHint, "Friday");
  assert.ok(candidate.dueAt, "the due phrase resolves against the supplied clock");
});

test("detection is precision-biased: negations, questions, and second-person prose never match", () => {
  for (const text of [
    "I'll never agree to those terms.",
    "I will not send that today.",
    "Will you send me the deck by Friday?",
    "You should send Priya the deck.",
    "He said he'll send it tomorrow… we'll see.",
    "Shall I'll", // degenerate fragment stays unmatched (single-word remainder)
  ]) {
    assert.equal(detectCommitmentCandidates(text, NOW).length, 0, `must not match: ${text}`);
  }
});

test("detection handles multiple commitment sentences and variant openers", () => {
  const candidates = detectCommitmentCandidates(
    "I will call Rahul Mehta tomorrow. Unrelated sentence here. I promise to review the contract by 2026-08-20.",
    NOW,
  );
  assert.equal(candidates.length, 2);
  assert.equal(candidates[0]!.counterpartyHint, "Rahul Mehta");
  assert.equal(candidates[0]!.dueHint, "tomorrow");
  assert.equal(candidates[1]!.dueHint, "2026-08-20");
  assert.ok(candidates[1]!.dueAt!.startsWith("2026-08-20"));
});

test("resolveDuePhrase: the whole vocabulary resolves deterministically from the supplied clock", () => {
  // NOW is a Monday.
  assert.ok(resolveDuePhrase("today", NOW)!.startsWith("2026-08-10"));
  assert.ok(resolveDuePhrase("tomorrow", NOW)!.startsWith("2026-08-11"));
  assert.ok(resolveDuePhrase("friday", NOW)!.startsWith("2026-08-14"));
  // The coming occurrence of the same weekday is TODAY, not next week.
  assert.ok(resolveDuePhrase("monday", NOW)!.startsWith("2026-08-10"));
  assert.ok(resolveDuePhrase("next week", NOW)!.startsWith("2026-08-17"));
  assert.ok(resolveDuePhrase("end of the week", NOW)!.startsWith("2026-08-14"));
  assert.ok(resolveDuePhrase("2026-09-01", NOW)!.startsWith("2026-09-01"));
  assert.equal(resolveDuePhrase("someday", NOW), null);
  assert.equal(resolveDuePhrase("today", "not-a-date"), null);
});

test("propose: within budget writes lineage rows; the same sentence never proposes twice", async () => {
  const store = new InMemoryMemoryStore();
  const nextId = idCounter();
  const candidates = detectCommitmentCandidates("I'll email Sam the notes by Friday.", NOW);
  const first = await proposeCommitmentSuggestions(store, {
    ...{ organizationId: SCOPE.organizationId, ownerUserId: SCOPE.userId },
    candidates, nextId,
  });
  assert.equal(first.proposed.length, 1);
  assert.equal(first.deferred, 0);
  assert.equal(first.proposed[0]!.status, "proposed");
  assert.match(first.proposed[0]!.suggestedText, /Track this commitment\?/);

  const again = await proposeCommitmentSuggestions(store, {
    ...{ organizationId: SCOPE.organizationId, ownerUserId: SCOPE.userId },
    candidates, nextId,
  });
  assert.equal(again.proposed.length, 0, "a duplicate sentence is skipped, not re-proposed");
  assert.equal(again.deferred, 0, "a duplicate is not 'deferred' — its lineage already exists");
});

test("annoyance cap: over-cap candidates are DEFERRED without lineage, and propose later", async () => {
  const store = new InMemoryMemoryStore();
  const nextId = idCounter();
  const prose =
    "I'll send Ana the summary today. I'll call Ben tomorrow. I'll review the budget by Friday.";
  const candidates = detectCommitmentCandidates(prose, NOW);
  assert.equal(candidates.length, 3);

  const run = await proposeCommitmentSuggestions(store, {
    organizationId: SCOPE.organizationId, ownerUserId: SCOPE.userId, candidates, nextId,
  });
  assert.equal(run.proposed.length, MAX_COMMITMENT_SUGGESTIONS_PER_RUN);
  assert.equal(run.deferred, 1, "the third candidate is deferred, not dropped");

  // The deferred sentence has NO lineage row, so a later run proposes it.
  const later = await proposeCommitmentSuggestions(store, {
    organizationId: SCOPE.organizationId, ownerUserId: SCOPE.userId, candidates, nextId,
  });
  assert.equal(later.proposed.length, 1, "the deferred candidate proposes once the run budget resets");
  assert.equal(later.proposed[0]!.candidate.text, candidates[2]!.text);
});

test("annoyance cap: a full outstanding queue silences proposing entirely", async () => {
  const store = new InMemoryMemoryStore();
  const nextId = idCounter();
  // Fill the queue to the outstanding cap.
  const filler: string[] = [];
  for (let i = 0; i < MAX_OUTSTANDING_COMMITMENT_SUGGESTIONS; i += 1) {
    filler.push(`I'll finish milestone ${["one", "two", "three", "four", "five"][i]} by Friday.`);
  }
  for (const sentence of filler) {
    const result = await proposeCommitmentSuggestions(store, {
      organizationId: SCOPE.organizationId, ownerUserId: SCOPE.userId,
      candidates: detectCommitmentCandidates(sentence, NOW), nextId,
    });
    assert.equal(result.proposed.length, 1);
  }
  const outstanding = await listCommitmentSuggestions(store, SCOPE, "proposed");
  assert.equal(outstanding.length, MAX_OUTSTANDING_COMMITMENT_SUGGESTIONS);

  const over = await proposeCommitmentSuggestions(store, {
    organizationId: SCOPE.organizationId, ownerUserId: SCOPE.userId,
    candidates: detectCommitmentCandidates("I'll draft the proposal tomorrow.", NOW), nextId,
  });
  assert.equal(over.proposed.length, 0, "a full queue proposes nothing");
  assert.equal(over.deferred, 1);

  // Deciding one frees a slot for the deferred sentence.
  await rejectCommitmentSuggestion(store, SCOPE, outstanding[0]!.memoryId, SCOPE.userId, nextId);
  const freed = await proposeCommitmentSuggestions(store, {
    organizationId: SCOPE.organizationId, ownerUserId: SCOPE.userId,
    candidates: detectCommitmentCandidates("I'll draft the proposal tomorrow.", NOW), nextId,
  });
  assert.equal(freed.proposed.length, 1);
});

test("accept returns the candidate for governed materialization; reject holds the lineage forever", async () => {
  const store = new InMemoryMemoryStore();
  const nextId = idCounter();
  const candidates = detectCommitmentCandidates(
    "I'll share with Dana the onboarding plan by Wednesday.",
    NOW,
  );
  const { proposed } = await proposeCommitmentSuggestions(store, {
    organizationId: SCOPE.organizationId, ownerUserId: SCOPE.userId, candidates, nextId,
  });
  const accepted = await acceptCommitmentSuggestion(
    store, SCOPE, proposed[0]!.memoryId, SCOPE.userId, nextId,
  );
  assert.equal(accepted.suggestion.status, "accepted");
  assert.equal(accepted.candidate.text, candidates[0]!.text);
  assert.equal(accepted.candidate.counterpartyHint, "Dana");
  // Accepting flips the lineage; the same sentence never re-proposes.
  const after = await proposeCommitmentSuggestions(store, {
    organizationId: SCOPE.organizationId, ownerUserId: SCOPE.userId, candidates, nextId,
  });
  assert.equal(after.proposed.length, 0);

  // A decided suggestion cannot transition twice.
  await assert.rejects(
    () => acceptCommitmentSuggestion(store, SCOPE, accepted.suggestion.memoryId, SCOPE.userId, nextId),
    /already accepted/,
  );

  // Reject path: its sentence is never re-proposed either.
  const rejectRun = await proposeCommitmentSuggestions(store, {
    organizationId: SCOPE.organizationId, ownerUserId: SCOPE.userId,
    candidates: detectCommitmentCandidates("I'll book the venue by Thursday.", NOW), nextId,
  });
  const rejected = await rejectCommitmentSuggestion(
    store, SCOPE, rejectRun.proposed[0]!.memoryId, SCOPE.userId, nextId,
  );
  assert.equal(rejected.status, "rejected");
  const rejectAgain = await proposeCommitmentSuggestions(store, {
    organizationId: SCOPE.organizationId, ownerUserId: SCOPE.userId,
    candidates: detectCommitmentCandidates("I'll book the venue by Thursday.", NOW), nextId,
  });
  assert.equal(rejectAgain.proposed.length, 0, "a rejected sentence is never re-proposed");
});

test("lineage key normalizes whitespace and case, nothing else", () => {
  assert.equal(
    commitmentSuggestionLineageKey("  I'll   Send THE deck  by Friday. "),
    "learning:commitment:i'll send the deck by friday.",
  );
});
