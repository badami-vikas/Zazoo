/**
 * K3 (TASK-047) — knowledge substrate, pure half.
 *
 * Invariants under test:
 *  - red claim classes are disjoint from the proposable union (invariant 15);
 *  - sensitivity is raise-only and `unknown` never lowers to a named tier;
 *  - one suggestion lineage per (entity, field, value): a rejected value is
 *    never re-proposed, a new value is a new lineage;
 *  - accept/reject transition exactly once and survive CAS races by erroring,
 *    never by double-writing;
 *  - acceptance returns the claim payload but WRITES NO TABLE — this module
 *    has no handle to one;
 *  - snippets projection carries the claim text verbatim and nothing else.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  acceptClaimSuggestion,
  claimSuggestionLineageKey,
  claimsToMemorySnippets,
  InMemoryMemoryStore,
  CLAIM_SUGGESTION_KIND,
  listClaimSuggestions,
  PROPOSABLE_CLAIM_CLASSES,
  proposeClaimSuggestion,
  raiseSensitivity,
  RED_CLAIM_CLASSES,
  rejectClaimSuggestion,
  type ClaimProposal,
} from "../src/index.js";

const ORG = "org-1";
const OWNER = "user-1";
const scope = { organizationId: ORG, userId: OWNER };

let seq = 0;
const nextId = () => `mem-${++seq}`;

function proposal(overrides: Partial<ClaimProposal> = {}): ClaimProposal {
  return {
    entity: { kind: "person", name: "Priya Sharma" },
    field: "timezone",
    value: "CET",
    claimClass: "stated_fact",
    sensitivity: "private",
    evidence: [{ kind: "memory", id: "ev-1" }],
    ...overrides,
  };
}

test("red claim classes are disjoint from the proposable union", () => {
  for (const red of RED_CLAIM_CLASSES) {
    assert.ok(
      !(PROPOSABLE_CLAIM_CLASSES as readonly string[]).includes(red),
      `red class "${red}" must not be proposable`,
    );
  }
});

test("sensitivity raise-only: joins upward, unknown resolves to restricted, never lowers", () => {
  assert.equal(raiseSensitivity("public", "private"), "private");
  assert.equal(raiseSensitivity("restricted", "public"), "restricted");
  assert.equal(raiseSensitivity("organization", "unknown"), "restricted");
  assert.equal(raiseSensitivity("private"), "private");
});

test("propose → list → accept: one lineage, claim payload returned, no re-proposal", async () => {
  const store = new InMemoryMemoryStore();
  const suggested = await proposeClaimSuggestion(store, {
    organizationId: ORG,
    ownerUserId: OWNER,
    claim: proposal(),
    nextId,
  });
  assert.ok(suggested, "first proposal creates a suggestion");
  assert.equal(suggested.status, "proposed");
  assert.match(suggested.suggestedText, /Priya Sharma/);

  // The same (entity, field, value) proposes exactly once.
  const duplicate = await proposeClaimSuggestion(store, {
    organizationId: ORG,
    ownerUserId: OWNER,
    claim: proposal(),
    nextId,
  });
  assert.equal(duplicate, null, "duplicate proposal is refused at the lineage head");

  const pending = await listClaimSuggestions(store, scope, "proposed");
  assert.equal(pending.length, 1);

  const { claim } = await acceptClaimSuggestion(store, scope, suggested.memoryId, OWNER, nextId);
  assert.equal(claim.field, "timezone");
  assert.equal(claim.value, "CET");
  const accepted = await listClaimSuggestions(store, scope, "accepted");
  assert.equal(accepted.length, 1);
  // Acceptance is once-only: the superseded row can no longer transition.
  await assert.rejects(
    acceptClaimSuggestion(store, scope, suggested.memoryId, OWNER, nextId),
    /superseded|already/,
  );
});

test("a rejected value never re-proposes; a different value is a new lineage", async () => {
  const store = new InMemoryMemoryStore();
  const first = await proposeClaimSuggestion(store, {
    organizationId: ORG, ownerUserId: OWNER, claim: proposal(), nextId,
  });
  assert.ok(first);
  const rejected = await rejectClaimSuggestion(store, scope, first.memoryId, OWNER, nextId);
  assert.equal(rejected.status, "rejected");

  const again = await proposeClaimSuggestion(store, {
    organizationId: ORG, ownerUserId: OWNER, claim: proposal(), nextId,
  });
  assert.equal(again, null, "rejected (entity, field, value) stays rejected");

  const newValue = await proposeClaimSuggestion(store, {
    organizationId: ORG, ownerUserId: OWNER, claim: proposal({ value: "IST" }), nextId,
  });
  assert.ok(newValue, "a new value is a new proposal");
  assert.notEqual(
    claimSuggestionLineageKey(proposal()),
    claimSuggestionLineageKey(proposal({ value: "IST" })),
  );
});

test("proposal sensitivity is raised to the taint label's, never lowered", async () => {
  const store = new InMemoryMemoryStore();
  const suggested = await proposeClaimSuggestion(store, {
    organizationId: ORG,
    ownerUserId: OWNER,
    claim: proposal({
      sensitivity: "organization",
      taintLabel: {
        version: 1,
        trust: "user_content",
        sensitivity: "restricted",
        instructionRisk: "data",
        origins: [{ source: "chat", ref: "chat:t1" }],
      } as never,
    }),
    nextId,
  });
  assert.ok(suggested);
  assert.equal(suggested.claim.sensitivity, "restricted");
});

test("suggestion rows carry the anchor kind and never any table write", async () => {
  const store = new InMemoryMemoryStore();
  await proposeClaimSuggestion(store, {
    organizationId: ORG, ownerUserId: OWNER, claim: proposal(), nextId,
  });
  const rows = await store.retrieve({ type: "semantic" }, scope);
  assert.equal(rows.length, 1);
  const content = JSON.parse(rows[0]!.content) as { anchor: { kind: string } };
  assert.equal(content.anchor.kind, CLAIM_SUGGESTION_KIND);
});

test("claimsToMemorySnippets renders claim text with a claim source", () => {
  const snippets = claimsToMemorySnippets([
    { id: "c1", field: "timezone", value: "CET", entityName: "Priya Sharma" },
  ]);
  assert.equal(snippets.length, 1);
  assert.equal(snippets[0]!.source, "claim:c1");
  assert.match(snippets[0]!.text, /Priya Sharma: timezone is CET/);
  assert.equal(snippets[0]!.trustOrigin, "user_content");
});

// ── K10 E3+E4 (TASK-043): the content-tier and evidence gates ───────────────

test("K10 E3: red CONTENT is refused under a proposable class — one fixture per never-propose family", async () => {
  const { InMemoryMemoryStore } = await import("../src/memory/memory-store.js");
  const { proposeClaimSuggestion, ClaimGateError, listClaimSuggestions } = await import("../src/learning/claims.js");
  const store = new InMemoryMemoryStore();
  const fixtures: Array<{ value: string; family: string }> = [
    { value: "was diagnosed with cancer last spring", family: "health" },
    { value: "is Muslim and votes for the opposition", family: "protected_characteristic" },
    { value: "is a toxic narcissist and a difficult person", family: "psychological_conclusion" },
    { value: "is basically bankrupt and behind on rent", family: "financial_distress" },
  ];
  for (const fixture of fixtures) {
    await assert.rejects(
      proposeClaimSuggestion(store, {
        organizationId: ORG,
        ownerUserId: OWNER,
        claim: proposal({ field: "note", value: fixture.value }),
        nextId,
      }),
      (error: unknown) =>
        error instanceof ClaimGateError &&
        error.reason === "red_content" &&
        error.matchedClass === fixture.family,
      `"${fixture.value}" must refuse as ${fixture.family}`,
    );
  }
  // NOTHING landed: red fixtures never reach a proposal row.
  assert.equal((await listClaimSuggestions(store, scope)).length, 0);
});

test("K10 E3: amber content lands as an OBSERVED fact with evidence shown; green keeps plain framing; raise-only join holds", async () => {
  const { InMemoryMemoryStore } = await import("../src/memory/memory-store.js");
  const { proposeClaimSuggestion, classifyClaimContent, raiseContentTier } = await import("../src/learning/claims.js");
  const store = new InMemoryMemoryStore();

  const amber = await proposeClaimSuggestion(store, {
    organizationId: ORG,
    ownerUserId: OWNER,
    claim: proposal({ field: "meeting style", value: "dislikes early meetings" }),
    nextId,
  });
  assert.ok(amber);
  assert.match(amber.suggestedText, /^Observed about/);
  assert.match(amber.suggestedText, /never as a conclusion/);
  assert.match(amber.suggestedText, /1 evidence reference/);

  const green = await proposeClaimSuggestion(store, {
    organizationId: ORG,
    ownerUserId: OWNER,
    claim: proposal({ field: "timezone", value: "IST" }),
    nextId,
  });
  assert.ok(green);
  assert.match(green.suggestedText, /^Remember about/);

  assert.equal(classifyClaimContent("note", "plays tennis on Sundays").tier, "green");
  // Raise-only: a later scorer can raise, never lower.
  assert.equal(raiseContentTier("green", "amber"), "amber");
  assert.equal(raiseContentTier("amber", "red"), "red");
  assert.equal(raiseContentTier("red", "green"), "red");
});

test("K10 E4: no evidence → refused; compound clauses → refused; noun-phrase 'and' survives", async () => {
  const { InMemoryMemoryStore } = await import("../src/memory/memory-store.js");
  const { proposeClaimSuggestion, ClaimGateError, splitStatementClauses } = await import("../src/learning/claims.js");
  const store = new InMemoryMemoryStore();

  await assert.rejects(
    proposeClaimSuggestion(store, {
      organizationId: ORG,
      ownerUserId: OWNER,
      claim: proposal({ evidence: [] }),
      nextId,
    }),
    (error: unknown) => error instanceof ClaimGateError && error.reason === "no_evidence",
  );

  await assert.rejects(
    proposeClaimSuggestion(store, {
      organizationId: ORG,
      ownerUserId: OWNER,
      claim: proposal({ field: "role", value: "leads the platform team; owns hiring, and runs the on-call rotation" }),
      nextId,
    }),
    (error: unknown) => error instanceof ClaimGateError && error.reason === "compound_statement",
  );

  // Clause splitting is deliberately narrow: a noun phrase stays ONE clause.
  assert.deepEqual(splitStatementClauses("Head of Research and Development"), [
    "Head of Research and Development",
  ]);
  assert.equal(splitStatementClauses("owns hiring; runs on-call, and mentors juniors").length, 3);
});
