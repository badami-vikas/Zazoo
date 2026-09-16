/**
 * K6 over the real `buildWiring()` composition root (AI Harness K6,
 * TASK-050) — the contract:
 *
 *  - a commitment stated in the owner's own chat prose is detected and
 *    surfaced as a suggestion; NOTHING materializes without acceptance;
 *  - acceptance (a Human act) materializes a Commitment through the SAME
 *    governed relationship mutation the manual surface uses, linked to the
 *    person the HUMAN chose;
 *  - rejection materializes nothing, and the sentence is never re-proposed;
 *  - the annoyance cap limits suggestion volume per run — over-cap
 *    candidates are deferred, not dropped;
 *  - with the learning flight OFF the send path detects nothing at all;
 *  - the morning brief renders the three commitment buckets, suggestion
 *    counts, approvals nudges, and next actions from REAL store reads.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { TRPCError } from "@trpc/server";
import {
  listCommitmentSuggestions,
  MAX_COMMITMENT_SUGGESTIONS_PER_RUN,
  SeededRng,
  SystemClock,
  UuidGen,
  type ModelCompletionRequest,
  type ModelProvider,
  type ModelTier,
  type RunCtx,
} from "@bridge/core";
import { appRouter } from "../src/router.js";
import { buildWiring, PILOT_ORGANIZATION, PILOT_USER, type Wiring } from "../src/wiring.js";
import { makeCaller } from "./caller.js";

const ORG = PILOT_ORGANIZATION;

class LocalChatModel implements ModelProvider {
  readonly id = "k6-local-chat";
  readonly plane = "local" as const;
  readonly tiers = ["cheap", "default"] as const satisfies readonly ModelTier[];
  readonly models = { cheap: "k6-v1", default: "k6-v1" } as const;

  routingHealth() {
    return "healthy" as const;
  }

  async complete(request: ModelCompletionRequest) {
    return {
      text: JSON.stringify({ kind: "answer", text: "Noted." }),
      model: "k6-v1",
      tier: request.tier,
      usage: { inputTokens: 8, outputTokens: 2, cacheCreationInputTokens: 0, cacheReadInputTokens: 0, source: "provider" as const },
      ...(request.taintLabel ? { taintLabel: request.taintLabel } : {}),
    };
  }
}

async function sendChatTurn(caller: ReturnType<typeof makeCaller>, clientRequestId: string, message: string) {
  const { thread } = await caller.chat.thread.create({
    organizationId: ORG,
    plane: "local",
    clientRequestId: `${clientRequestId}-thread`,
  });
  await caller.chat.turn.send({
    organizationId: ORG,
    threadId: thread.id,
    clientRequestId,
    message,
  });
}

/** Create an owner Person through the governed surface; approve if staged. */
async function createPerson(caller: ReturnType<typeof makeCaller>, displayName: string): Promise<string> {
  const result = await caller.relationship.createPerson({
    organizationId: ORG,
    values: { displayName, visibility: "private" },
  });
  if (result.materialization.status === "pending_approval") {
    await caller.action.decide({ proposalId: result.proposal.id, decision: "approve" });
  }
  const people = await caller.relationship.listPeople({ organizationId: ORG });
  const person = people.items.find((item: { displayName: string | null }) => item.displayName === displayName);
  assert.ok(person, `person ${displayName} exists after the governed create`);
  return person.id as string;
}

async function ensureApplied(
  caller: ReturnType<typeof makeCaller>,
  result: { proposal: { id: string }; materialization: { status: string } },
) {
  if (result.materialization.status === "pending_approval") {
    await caller.action.decide({ proposalId: result.proposal.id, decision: "approve" });
  }
}

test("flight OFF: the send path detects nothing; the suggestion surface fails closed", async () => {
  const wiring = await buildWiring({ modelProviders: [new LocalChatModel()], learningObservationEnabled: false });
  try {
    const caller = makeCaller(wiring);
    await sendChatTurn(caller, "k6-off-turn", "I'll send Priya the revised deck by Friday.");
    const rows = await listCommitmentSuggestions(
      wiring.memoryStore, { organizationId: ORG, userId: PILOT_USER },
    );
    assert.equal(rows.length, 0, "no learning flight, no detection — ever");
    await assert.rejects(
      () => caller.learning.commitments.suggestions({ organizationId: ORG }),
      (error: unknown) => error instanceof TRPCError && error.code === "PRECONDITION_FAILED",
    );
  } finally {
    await wiring.close();
  }
});

test("prose → suggestion → Human accept → a governed Commitment on the person the HUMAN chose", async () => {
  const wiring = await buildWiring({ learningObservationEnabled: true, modelProviders: [new LocalChatModel()] });
  try {
    const caller = makeCaller(wiring);
    const personId = await createPerson(caller, "Priya Sharma");

    await sendChatTurn(caller, "k6-accept-turn", "Sounds good. I'll send Priya the revised deck by Friday.");
    const { suggestions } = await caller.learning.commitments.suggestions({ organizationId: ORG });
    assert.equal(suggestions.length, 1, "the commitment sentence became one suggestion");
    const suggestion = suggestions[0]!;
    assert.equal(suggestion.candidate.text, "I'll send Priya the revised deck by Friday.");
    assert.equal(suggestion.candidate.counterpartyHint, "Priya");
    assert.ok(suggestion.candidate.dueAt, "the due phrase resolved");

    // Nothing materialized yet — suggested-then-accepted.
    const before = await caller.relationship.commitments({ organizationId: ORG, personId });
    assert.equal(before.total, 0, "detection alone never writes a Commitment");

    const accepted = await caller.learning.commitments.accept({
      organizationId: ORG,
      suggestionMemoryId: suggestion.memoryId,
      personId,
    });
    await ensureApplied(caller, accepted);

    const after = await caller.relationship.commitments({ organizationId: ORG, personId });
    assert.equal(after.total, 1, "acceptance materialized exactly one Commitment");
    assert.equal(after.items[0]!.text, "I'll send Priya the revised deck by Friday.");
    assert.equal(after.items[0]!.status, "pending");
    assert.ok(after.items[0]!.dueAt, "the resolved due date rode into the Commitment");

    // A second accept of the same suggestion cannot mint a second Commitment:
    // by the stale (pre-accept) memory id the lineage-head check refuses it;
    // by the current id the status check refuses it. Either way, one click,
    // one Commitment.
    await assert.rejects(
      () => caller.learning.commitments.accept({
        organizationId: ORG, suggestionMemoryId: suggestion.memoryId, personId,
      }),
      /superseded|already accepted/,
    );
    const stillOne = await caller.relationship.commitments({ organizationId: ORG, personId });
    assert.equal(stillOne.total, 1, "the refused re-accept minted nothing");
  } finally {
    await wiring.close();
  }
});

test("reject: nothing materializes and the sentence is never re-proposed", async () => {
  const wiring = await buildWiring({ learningObservationEnabled: true, modelProviders: [new LocalChatModel()] });
  try {
    const caller = makeCaller(wiring);
    const personId = await createPerson(caller, "Rahul Mehta");
    await sendChatTurn(caller, "k6-reject-turn", "I'll call Rahul tomorrow.");
    const { suggestions } = await caller.learning.commitments.suggestions({ organizationId: ORG });
    assert.equal(suggestions.length, 1);
    await caller.learning.commitments.reject({
      organizationId: ORG, suggestionMemoryId: suggestions[0]!.memoryId,
    });
    // Re-sending the same sentence proposes nothing — the lineage is held.
    await sendChatTurn(caller, "k6-reject-turn-2", "I'll call Rahul tomorrow.");
    const after = await caller.learning.commitments.suggestions({ organizationId: ORG });
    assert.equal(after.suggestions.length, 0, "a rejected sentence never re-proposes");
    const commitments = await caller.relationship.commitments({ organizationId: ORG, personId });
    assert.equal(commitments.total, 0, "rejection materializes nothing");
  } finally {
    await wiring.close();
  }
});

test("the annoyance cap binds over the API: over-cap candidates defer to a later turn", async () => {
  const wiring = await buildWiring({ learningObservationEnabled: true, modelProviders: [new LocalChatModel()] });
  try {
    const caller = makeCaller(wiring);
    await sendChatTurn(
      caller,
      "k6-cap-turn",
      "I'll send Ana the summary today. I'll call Ben tomorrow. I'll review the budget by Friday.",
    );
    const first = await caller.learning.commitments.suggestions({ organizationId: ORG });
    assert.equal(
      first.suggestions.length,
      MAX_COMMITMENT_SUGGESTIONS_PER_RUN,
      "one turn proposes at most the per-run cap",
    );
    // The deferred sentence proposes when the prose recurs on a later turn.
    await sendChatTurn(
      caller,
      "k6-cap-turn-2",
      "I'll send Ana the summary today. I'll call Ben tomorrow. I'll review the budget by Friday.",
    );
    const second = await caller.learning.commitments.suggestions({ organizationId: ORG });
    assert.equal(second.suggestions.length, 3, "the deferred candidate was deferred, not dropped");
  } finally {
    await wiring.close();
  }
});

test("the morning brief renders the three commitment buckets, suggestions, nudges, and next actions from real reads", async () => {
  const wiring = await buildWiring({ learningObservationEnabled: true, modelProviders: [new LocalChatModel()] });
  try {
    const caller = makeCaller(wiring);
    const personId = await createPerson(caller, "Dana Whitfield");

    // Fixed, TZ-safe instants: snapshot at midday UTC, due dates days apart.
    const snapshotAt = "2027-01-15T12:00:00.000Z";
    const mk = async (text: string, dueAt: string | null) => {
      const result = await caller.relationship.createCommitment({
        organizationId: ORG, personId, text, dueAt,
      });
      await ensureApplied(caller, result);
    };
    await mk("Overdue diligence notes", "2027-01-13T12:00:00.000Z");
    await mk("Same-day standup recap", "2027-01-15T13:00:00.000Z");
    await mk("Next-week roadmap draft", "2027-01-22T12:00:00.000Z");
    await mk("Someday: intro deck", null);

    // A pending suggestion for the nudge sections.
    await sendChatTurn(caller, "k6-brief-turn", "I'll send Dana the onboarding plan by Friday.");

    const brief = await caller.brief.morning({ organizationId: ORG, snapshotAt });
    assert.equal(brief.learningEnabled, true);
    assert.deepEqual(
      {
        overdue: brief.commitments.overdue.map((item) => item.text),
        dueToday: brief.commitments.dueToday.map((item) => item.text),
        upcoming: brief.commitments.upcoming.map((item) => item.text).sort(),
      },
      {
        overdue: ["Overdue diligence notes"],
        dueToday: ["Same-day standup recap"],
        upcoming: ["Next-week roadmap draft", "Someday: intro deck"].sort(),
      },
      "the three buckets are real data, bucketed by calendar day",
    );
    assert.equal(brief.commitments.overdue[0]!.personName, "Dana Whitfield");
    assert.equal(brief.suggestions.commitments.length, 1, "the pending suggestion surfaces in the brief");
    assert.ok(
      brief.nextActions.some((line) => line.includes("overdue")),
      "next actions derive from the buckets",
    );
    assert.ok(
      brief.nextActions.some((line) => line.includes("commitment suggestion")),
      "next actions nudge the suggestion review",
    );
    assert.ok(Array.isArray(brief.recentActivity));
    assert.equal(typeof brief.approvals.total, "number");
  } finally {
    await wiring.close();
  }
});
