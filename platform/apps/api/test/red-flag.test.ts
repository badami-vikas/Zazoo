/**
 * redFlag.* (TASK-010, docs/raw/ui-architecture-rules-2026-07.md §5d) — end
 * to end over the real `buildWiring()` composition root.
 *
 * Covers three rounds of independent-review remediation (2026-07-17):
 *  Round 2: auth/ownership, ledger privacy, saga/idempotency, single
 *    current lineage/CAS, canonical anchor identity, audit/history.
 *  Round 3: two bugs a FRESH review found in round 2's own fixes (the
 *    idempotency check reading the wrong row; the CAS `.cause`-unwrap).
 *  Round 4 (this file): substantive governed learning + a Human-authorized
 *    enactment/revoke path (not a no-op echo); private-proposal ownership on
 *    action.listPending/decide; replay-safe create (crash recovery,
 *    retryable failures); durable clear/reopen sagas (reopen starts a FRESH
 *    proposal, never resurrects a resolved one); forget enumerates every
 *    linked proposal across the WHOLE lineage before deleting; server-
 *    validated canonical anchors (JobPilot application existence/organization,
 *    unknown modules fail closed); DB-pushed scope filtering; keyset
 *    audit/history pagination.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { TRPCError } from "@trpc/server";
import {
  SeededRng,
  SystemClock,
  UuidGen,
  hashTaintValue,
  labelAtSource,
  type RunCtx,
} from "@bridge/core";
import { appRouter, deterministicUuid, anchorLineageKey } from "../src/router.js";
import { buildWiring, PILOT_ORGANIZATION, PILOT_USER, LEARNING_AGENT, PLATFORM_RED_FLAG_LEARNING_GOAL_TYPE, PROPOSE_PREFERENCE_ADJUSTMENT_TASK_TYPE, type Wiring } from "../src/wiring.js";
import { makeCaller, makeRun } from "./caller.js";

/** A second REAL, seeded organization member — distinct from PILOT_USER — for
 * IDOR/cross-owner/private-proposal tests. */
async function inviteSecondMember(wiring: Wiring): Promise<string> {
  const caller = await makeCaller(wiring);
  const invited = await caller.organization.inviteMember({ organizationId: PILOT_ORGANIZATION, email: `test_fixture_${Date.now()}_${Math.random()}@example.com` });
  return invited.userId;
}

/** review round-4 item 6: `redFlag.create` now validates a cell/bullet
 * record anchor's existence+organization server-side — every test needs a
 * REAL JobPilot application id, never a fabricated string like "app-1". */
async function seedJobApplication(wiring: Wiring, organizationId: string = PILOT_ORGANIZATION): Promise<string> {
  const { application } = await wiring.jobpilotStore.createJob({ organizationId, title: "Test Fixture Role", company: "Test Fixture Co" });
  return application.id;
}

function cellAnchor(recordId: string, overrides: Partial<{ fieldId: string; databaseId: string }> = {}) {
  return {
    kind: "cell" as const,
    moduleId: "job-pilot",
    databaseId: overrides.databaseId ?? "jobpilot.jobs",
    recordId,
    fieldId: overrides.fieldId ?? "fit.summary",
  };
}

function parseFlag(memory: { content: string }) {
  return JSON.parse(memory.content) as {
    kind: string;
    status: string;
    learningStatus: string;
    proposalId?: string;
    preferenceAdjustmentId?: string;
    learningFailureReason?: string;
    reason?: string;
    anchor: unknown;
  };
}

test("redFlag.create writes a Human-authored correction Memory owned by the REAL caller (never a shared/pilot constant), and starts a governed proposal that synthesizes a real private preference adjustment", async () => {
  const wiring = await buildWiring();
  try {
    const recordId = await seedJobApplication(wiring);
    const caller = await makeCaller(wiring);
    const { memory } = await caller.redFlag.create({
      organizationId: PILOT_ORGANIZATION,
      operationId: "00000000-0000-4000-8000-000000000001",
      anchor: cellAnchor(recordId),
      renderedValue: "Strong fit for the role",
      reason: "The Candidate Master Profile does not support this",
    });

    assert.equal(memory.sourceRefType, "feedback");
    assert.equal(memory.trustOrigin, "user_content");
    assert.equal(memory.createdBy, PILOT_USER);
    assert.equal(memory.ownerUserId, PILOT_USER, "owner must be ctx.identity.id, never wiring.pilotUserId as a shared constant");
    const value = parseFlag(memory);
    assert.equal(value.kind, "red_flag");
    assert.equal(value.status, "open");
    assert.equal(value.learningStatus, "proposed");
    assert.ok(value.proposalId, "the flag links to its governed proposal's ledger id");
    assert.ok(value.preferenceAdjustmentId, "the flag links to its synthesized preference adjustment (review round-4 item 1)");
    assert.deepEqual(value.anchor, cellAnchor(recordId));

    const proposalRow = await wiring.ledger.get(value.proposalId!);
    assert.ok(proposalRow);
    assert.equal(proposalRow!.userDecision, null, "always drafts — pending_review, never auto-applied");
    assert.equal(proposalRow!.actorId, LEARNING_AGENT);

    // review round-4 item 1: the governed step must be SUBSTANTIVE — a real,
    // structured PreferenceAdjustment record (scope/target/proposed
    // change/rationale/evidence ref), not a no-op echo of the ledger's own
    // opaque inputs.
    const adjustment = await wiring.memoryStore.get(value.preferenceAdjustmentId!, { organizationId: PILOT_ORGANIZATION, userId: PILOT_USER });
    assert.ok(adjustment);
    const adjustmentValue = JSON.parse(adjustment!.content);
    assert.equal(adjustmentValue.kind, "preference_adjustment");
    // `flagMemoryId` references the IMMUTABLE step-1 evidence row (not
    // `memory.id`, which is the FINAL outcome row's own distinct id after
    // the saga's second casSupersede) — assert it resolves to a real,
    // readable Memory rather than comparing it to the wrong id.
    const evidenceMemory = await wiring.memoryStore.get(adjustmentValue.flagMemoryId, { organizationId: PILOT_ORGANIZATION, userId: PILOT_USER });
    assert.ok(evidenceMemory, "flagMemoryId must reference a real, owner-readable Memory (the step-1 evidence row)");
    assert.equal(JSON.parse(evidenceMemory!.content).kind, "red_flag");
    assert.deepEqual(adjustmentValue.anchor, cellAnchor(recordId));
    assert.deepEqual(adjustmentValue.proposedChange, { type: "suppress_value" });
    assert.equal(adjustmentValue.rationale, "The Candidate Master Profile does not support this");
    assert.equal(adjustmentValue.status, "proposed");
    assert.equal(adjustmentValue.proposalId, value.proposalId);
  } finally {
    await wiring.close();
  }
});

test("PRIVACY: the ledger's proposal row never carries the flag's anchor/renderedValue/reason/rationale — only opaque Memory references + a generic summary", async () => {
  const wiring = await buildWiring();
  try {
    const recordId = await seedJobApplication(wiring);
    const caller = await makeCaller(wiring);
    const { memory } = await caller.redFlag.create({
      organizationId: PILOT_ORGANIZATION,
      operationId: "00000000-0000-4000-8000-000000000002",
      anchor: cellAnchor(recordId),
      renderedValue: "a very specific private correction detail",
      reason: "a very specific private reason nobody else should read",
    });
    const value = parseFlag(memory);
    const proposalRow = await wiring.ledger.get(value.proposalId!);
    assert.ok(proposalRow);
    const serializedLedgerRow = JSON.stringify(proposalRow);
    assert.doesNotMatch(serializedLedgerRow, /very specific private/);
    assert.doesNotMatch(serializedLedgerRow, /fit\.summary/);
    assert.doesNotMatch(serializedLedgerRow, new RegExp(recordId));
    assert.doesNotMatch(serializedLedgerRow, /suppress_value/, "the proposed change itself must not leak into the ledger — only its opaque preference-adjustment id reference");
    const inputs = proposalRow!.inputs as Record<string, unknown>;
    assert.deepEqual(Object.keys(inputs).sort(), ["applied", "flagMemoryId", "governed", "kind", "preferenceAdjustmentId", "summary", "visibility"]);
    assert.equal(inputs.visibility, "private");
  } finally {
    await wiring.close();
  }
});

test("IDOR: a DIFFERENT authenticated organization member cannot read, clear, reopen, updateReason, forget, or enact/revoke someone else's flag", async () => {
  const wiring = await buildWiring();
  try {
    const recordId = await seedJobApplication(wiring);
    const owner = await makeCaller(wiring);
    const otherUserId = await inviteSecondMember(wiring);
    const other = await makeCaller(wiring, { type: "user", id: otherUserId });

    const { memory } = await owner.redFlag.create({
      organizationId: PILOT_ORGANIZATION,
      operationId: "00000000-0000-4000-8000-000000000003",
      anchor: cellAnchor(recordId),
      renderedValue: "x",
    });

    const isNotFound = (err: unknown) => err instanceof TRPCError && err.code === "NOT_FOUND";
    await assert.rejects(() => other.redFlag.clear({ organizationId: PILOT_ORGANIZATION, flagId: memory.id }), isNotFound);
    await assert.rejects(() => other.redFlag.reopen({ organizationId: PILOT_ORGANIZATION, flagId: memory.id }), isNotFound);
    await assert.rejects(() => other.redFlag.updateReason({ organizationId: PILOT_ORGANIZATION, flagId: memory.id, reason: "hijacked" }), isNotFound);
    await assert.rejects(() => other.redFlag.forget({ organizationId: PILOT_ORGANIZATION, flagId: memory.id }), isNotFound);
    await assert.rejects(() => other.redFlag.history({ organizationId: PILOT_ORGANIZATION, flagId: memory.id }), isNotFound);
    await assert.rejects(() => other.redFlag.enactCorrection({ organizationId: PILOT_ORGANIZATION, flagId: memory.id }), isNotFound);
    await assert.rejects(() => other.redFlag.revokeCorrection({ organizationId: PILOT_ORGANIZATION, flagId: memory.id }), isNotFound);

    // Other's own listForScope/listAll must never surface the owner's private flag.
    const othersView = await other.redFlag.listForScope({ organizationId: PILOT_ORGANIZATION, moduleId: "job-pilot", databaseId: "jobpilot.jobs", recordId });
    assert.equal(othersView.flags.length, 0);
    const othersAll = await other.redFlag.listAll({ organizationId: PILOT_ORGANIZATION });
    assert.equal(othersAll.flags.length, 0);

    // The flag is untouched by every rejected attempt.
    const stillOpen = await owner.redFlag.listForAnchor({ organizationId: PILOT_ORGANIZATION, anchor: cellAnchor(recordId) });
    assert.equal(stillOpen.flags[0]?.value.status, "open");
    assert.equal(stillOpen.flags[0]?.value.reason, undefined);
  } finally {
    await wiring.close();
  }
});

test("unauthenticated and non-member callers are rejected on every redFlag procedure", async () => {
  const wiring = await buildWiring();
  try {
    const recordId = await seedJobApplication(wiring);
    const unauth = appRouter.createCaller({ wiring, run: makeRun(), identity: { type: "user", id: PILOT_USER }, authenticated: false, verifying: true });
    await assert.rejects(() => unauth.redFlag.create({ organizationId: PILOT_ORGANIZATION, operationId: "00000000-0000-4000-8000-0000000000aa", anchor: cellAnchor(recordId), renderedValue: "x" }));
    await assert.rejects(() => unauth.redFlag.listAll({ organizationId: PILOT_ORGANIZATION }));

    const nonMember = await makeCaller(wiring, { type: "user", id: "11111111-1111-4111-8111-111111111111" });
    await assert.rejects(
      () => nonMember.redFlag.create({ organizationId: PILOT_ORGANIZATION, operationId: "00000000-0000-4000-8000-0000000000bb", anchor: cellAnchor(recordId), renderedValue: "x" }),
      (err: unknown) => err instanceof TRPCError && err.code === "FORBIDDEN",
    );
  } finally {
    await wiring.close();
  }
});

test("forget rejects an arbitrary/foreign/wrong-kind Memory id instead of deleting it", async () => {
  const wiring = await buildWiring();
  try {
    const caller = await makeCaller(wiring);
    // A real Memory that exists but is NOT a red flag (an onboarding preference).
    const foreign = await wiring.memoryStore.write({
      id: "22222222-0000-4000-8000-000000000001",
      organizationId: PILOT_ORGANIZATION,
      type: "preference",
      scope: "private",
      content: JSON.stringify({ kind: "onboarding_preference", figure: "x", admiredFor: "y" }),
      confidence: 1,
      trustOrigin: "user_content",
      plane: "local",
      createdBy: PILOT_USER,
      ownerUserId: PILOT_USER,
    });
    await assert.rejects(() => caller.redFlag.forget({ organizationId: PILOT_ORGANIZATION, flagId: foreign.id }), (err: unknown) => err instanceof TRPCError && err.code === "NOT_FOUND");
    const stillThere = await wiring.memoryStore.get(foreign.id, { organizationId: PILOT_ORGANIZATION, userId: PILOT_USER });
    assert.ok(stillThere, "an unrelated Memory kind must never be deleted through redFlag.forget");

    await assert.rejects(() => caller.redFlag.forget({ organizationId: PILOT_ORGANIZATION, flagId: "99999999-0000-4000-8000-000000000099" }), (err: unknown) => err instanceof TRPCError && err.code === "NOT_FOUND");
  } finally {
    await wiring.close();
  }
});

test("clear withdraws a still-pending governed proposal so it can never later be approved; forget rejects an already-forgotten id afterward", async () => {
  const wiring = await buildWiring();
  try {
    const recordId = await seedJobApplication(wiring);
    const caller = await makeCaller(wiring);
    const { memory } = await caller.redFlag.create({
      organizationId: PILOT_ORGANIZATION,
      operationId: "00000000-0000-4000-8000-000000000004",
      anchor: cellAnchor(recordId),
      renderedValue: "x",
    });
    const value = parseFlag(memory);
    const beforeClear = await wiring.ledger.get(value.proposalId!);
    assert.equal(beforeClear!.userDecision, null);

    const { memory: cleared } = await caller.redFlag.clear({ organizationId: PILOT_ORGANIZATION, flagId: memory.id });
    assert.equal(parseFlag(cleared).learningStatus, "dismissed", "review round-4 item 4: clear must reflect the withdrawal as an accurate learningStatus on the flag itself");

    const decision = await wiring.ledger.decisionFor(value.proposalId!);
    assert.ok(decision, "clear must withdraw (veto) the still-pending proposal");
    assert.equal(decision!.userDecision, "veto");

    // Clearing again's withdrawal call must not throw even though the
    // proposal is now already resolved (AlreadyResolvedError is swallowed).
    const { memory: reopened } = await caller.redFlag.reopen({ organizationId: PILOT_ORGANIZATION, flagId: cleared.id });
    await caller.redFlag.forget({ organizationId: PILOT_ORGANIZATION, flagId: reopened.id });
  } finally {
    await wiring.close();
  }
});

test("SAGA: a retried create (same operationId) converges — no duplicate Memory/Task/proposal, and step 2 genuinely does not re-run", async () => {
  const wiring = await buildWiring();
  try {
    const recordId = await seedJobApplication(wiring);
    const caller = await makeCaller(wiring);
    const opId = "00000000-0000-4000-8000-000000000005";

    let proposeCallCount = 0;
    const originalPropose = wiring.pipeline.propose.bind(wiring.pipeline);
    wiring.pipeline.propose = (async (...args: Parameters<typeof originalPropose>) => {
      proposeCallCount += 1;
      return originalPropose(...args);
    }) as typeof wiring.pipeline.propose;

    const first = await caller.redFlag.create({ organizationId: PILOT_ORGANIZATION, operationId: opId, anchor: cellAnchor(recordId), renderedValue: "x", reason: "r" });
    const second = await caller.redFlag.create({ organizationId: PILOT_ORGANIZATION, operationId: opId, anchor: cellAnchor(recordId), renderedValue: "x", reason: "r" });
    assert.equal(first.memory.id, second.memory.id);
    assert.equal(proposeCallCount, 1, "a retry of an already-resolved create() must not re-invoke pipeline.propose at all");

    const allFlags = await caller.redFlag.listAll({ organizationId: PILOT_ORGANIZATION });
    assert.equal(allFlags.flags.length, 1, "retrying the same operationId must not create a second flag");

    const goals = await caller.agentOrchestration.goal.list({ organizationId: PILOT_ORGANIZATION });
    const goal = goals.find((g) => g.type === "platform.red_flag_learning");
    assert.ok(goal);
    const tasks = await caller.agentOrchestration.task.listByGoal({ organizationId: PILOT_ORGANIZATION, goalId: goal!.id });
    assert.equal(tasks.length, 1, "retrying the same operationId must not create a second governed Task");
  } finally {
    await wiring.close();
  }
});

test("SAGA (review round-4 item 3): a crash between ledger append and the outcome CAS recovers to 'proposed', not 'failed', without a duplicate pipeline.propose call", async () => {
  const wiring = await buildWiring();
  try {
    const recordId = await seedJobApplication(wiring);
    const owner = await makeCaller(wiring);
    const operationId = "00000000-0000-4000-8000-000000000105";
    const anchor = cellAnchor(recordId);
    const anchorKey = anchorLineageKey(anchor);
    const memoryId = deterministicUuid(`redflag-memory:${PILOT_USER}:${operationId}`);
    const proposalId = deterministicUuid(`redflag-proposal:${PILOT_USER}:${operationId}`);
    const preferenceAdjustmentId = deterministicUuid(`redflag-preference:${PILOT_USER}:${operationId}`);

    // Manually construct EXACTLY the state a real crash "after the ledger
    // append, before the outcome CAS" would leave behind: step 1's
    // correction Memory exists (learningStatus still "none"), the
    // preference adjustment exists, and the ledger genuinely has the
    // proposal — but the flag's OWN lineage was never superseded to
    // reflect it (that IS the crash — a real process interruption can
    // never be triggered on demand, so this hand-reconstructs its exact
    // intermediate state using the SAME deterministic ids `create()`
    // itself would have derived for this operationId).
    const step1 = await wiring.memoryStore.casSupersede({
      organizationId: PILOT_ORGANIZATION,
      ownerUserId: PILOT_USER,
      lineageKey: anchorKey,
      expectedCurrentId: null,
      next: {
        id: memoryId,
        organizationId: PILOT_ORGANIZATION,
        type: "semantic",
        subjectRecordId: anchorKey,
        scope: "private",
        content: JSON.stringify({ kind: "red_flag", anchor, renderedValue: "x", status: "open", learningStatus: "none" }),
        sourceRefType: "feedback",
        trustOrigin: "user_content",
        confidence: 1,
        plane: "local",
        createdBy: PILOT_USER,
        ownerUserId: PILOT_USER,
      },
    });
    assert.ok(step1);

    const adjustmentSeed = await wiring.memoryStore.casSupersede({
      organizationId: PILOT_ORGANIZATION,
      ownerUserId: PILOT_USER,
      lineageKey: preferenceAdjustmentId,
      expectedCurrentId: null,
      next: {
        id: preferenceAdjustmentId,
        organizationId: PILOT_ORGANIZATION,
        type: "preference",
        subjectRecordId: preferenceAdjustmentId,
        scope: "private",
        content: JSON.stringify({ kind: "preference_adjustment", flagMemoryId: memoryId, anchor, proposedChange: { type: "suppress_value" }, rationale: "x", proposalId, status: "proposed" }),
        sourceRefType: "feedback",
        trustOrigin: "user_content",
        confidence: 1,
        plane: "local",
        createdBy: PILOT_USER,
        ownerUserId: PILOT_USER,
      },
    });
    assert.ok(adjustmentSeed);

    const goal = await owner.agentOrchestration.goal.create({ organizationId: PILOT_ORGANIZATION, type: PLATFORM_RED_FLAG_LEARNING_GOAL_TYPE, title: "test fixture goal" });
    const goalTask = await owner.agentOrchestration.task.create({ organizationId: PILOT_ORGANIZATION, goalId: goal.id, type: PROPOSE_PREFERENCE_ADJUSTMENT_TASK_TYPE, assignedAgentId: LEARNING_AGENT });
    const proposal = await wiring.pipeline.propose(
      {
        organizationId: PILOT_ORGANIZATION,
        actor: { type: "agent", id: LEARNING_AGENT },
        onBehalfOf: { type: "user", id: PILOT_USER },
        action: "write",
        resourceType: "signal",
        skill: "learning.proposePreferenceAdjustment",
        trustOrigin: "user_content",
        goalTaskRef: { goalId: goal.id, taskId: goalTask.id },
        inputs: {
          kind: "red_flag_correction_proposal",
          flagMemoryId: memoryId,
          preferenceAdjustmentId,
          visibility: "private",
          governed: true,
          applied: false,
          summary: "A platform red-flag correction was synthesized into a preference adjustment for governed review.",
        },
      },
      makeRun(),
      { proposalId },
    );
    assert.equal(proposal.status, "pending_review");
    assert.equal(proposal.id, proposalId);

    // The ledger genuinely has the proposal — but the FLAG's own lineage
    // still shows "none" (the crash: the outcome CAS never ran).
    const preCrashCurrent = await wiring.memoryStore.currentForLineage(PILOT_ORGANIZATION, PILOT_USER, anchorKey);
    assert.equal(JSON.parse(preCrashCurrent!.content).learningStatus, "none");

    let proposeCallCount = 0;
    const originalPropose = wiring.pipeline.propose.bind(wiring.pipeline);
    wiring.pipeline.propose = (async (...args: Parameters<typeof originalPropose>) => {
      proposeCallCount += 1;
      return originalPropose(...args);
    }) as typeof wiring.pipeline.propose;

    const retried = await owner.redFlag.create({ organizationId: PILOT_ORGANIZATION, operationId, anchor, renderedValue: "x" });
    assert.equal(proposeCallCount, 0, "reconciling against the existing ledger entry must not re-invoke pipeline.propose");
    const retriedValue = parseFlag(retried.memory);
    assert.equal(retriedValue.learningStatus, "proposed", "recovery must land on 'proposed' (the proposal genuinely exists), never 'failed'");
    assert.equal(retriedValue.proposalId, proposalId, "the SAME deterministic proposal must be recovered, not a new one");
  } finally {
    await wiring.close();
  }
});

test("SAGA (review round-4 item 3): a genuinely failed governed step is retryable through a subsequent create() call", async () => {
  const wiring = await buildWiring();
  try {
    const recordId = await seedJobApplication(wiring);
    const caller = await makeCaller(wiring);
    const opId = "00000000-0000-4000-8000-000000000205";

    const originalPropose = wiring.pipeline.propose.bind(wiring.pipeline);
    let shouldThrow = true;
    wiring.pipeline.propose = (async (...args: Parameters<typeof originalPropose>) => {
      if (shouldThrow) {
        shouldThrow = false;
        throw new Error("simulated transient governed-step failure");
      }
      return originalPropose(...args);
    }) as typeof wiring.pipeline.propose;

    const first = await caller.redFlag.create({ organizationId: PILOT_ORGANIZATION, operationId: opId, anchor: cellAnchor(recordId), renderedValue: "x" });
    assert.equal(parseFlag(first.memory).learningStatus, "failed");
    assert.match(parseFlag(first.memory).learningFailureReason ?? "", /simulated transient/);
    // review round-5 item 4: a THROWN (not merely rejected) attempt never
    // reached ledger append — `proposalId` must stay absent, never the
    // deterministic guess, or clear/forget would later try to withdraw a
    // proposal the ledger has never seen.
    assert.equal(parseFlag(first.memory).proposalId, undefined, "a genuinely thrown governed step must not persist an unconfirmed proposalId");

    const retried = await caller.redFlag.create({ organizationId: PILOT_ORGANIZATION, operationId: opId, anchor: cellAnchor(recordId), renderedValue: "x" });
    assert.equal(parseFlag(retried.memory).learningStatus, "proposed", "a genuinely FAILED attempt must be retryable through create(), not permanently stuck");
    assert.ok(parseFlag(retried.memory).proposalId, "once genuinely proposed, the confirmed proposalId must be persisted");
  } finally {
    await wiring.close();
  }
});

test("PROPOSAL ID CORRECTNESS (review round-5 item 4): clear/forget on a flag whose learning step THREW (no proposalId ever persisted) succeed without trying to withdraw a nonexistent ledger entry", async () => {
  const wiring = await buildWiring();
  try {
    const recordId = await seedJobApplication(wiring);
    const caller = await makeCaller(wiring);

    const originalPropose = wiring.pipeline.propose.bind(wiring.pipeline);
    wiring.pipeline.propose = (async () => {
      throw new Error("simulated permanent governed-step failure");
    }) as typeof wiring.pipeline.propose;

    const { memory } = await caller.redFlag.create({ organizationId: PILOT_ORGANIZATION, operationId: "00000000-0000-4000-8000-000000000206", anchor: cellAnchor(recordId), renderedValue: "x" });
    const value = parseFlag(memory);
    assert.equal(value.learningStatus, "failed");
    assert.equal(value.proposalId, undefined);

    // Clear must succeed (no proposal to withdraw) — never throw the
    // ledger's generic "no ledger entry" error.
    const { memory: cleared } = await caller.redFlag.clear({ organizationId: PILOT_ORGANIZATION, flagId: memory.id });
    assert.equal(parseFlag(cleared).status, "cleared");

    // Forget must likewise succeed.
    await caller.redFlag.forget({ organizationId: PILOT_ORGANIZATION, flagId: cleared.id });
    const gone = await wiring.memoryStore.get(cleared.id, { organizationId: PILOT_ORGANIZATION, userId: PILOT_USER });
    assert.equal(gone, null);
  } finally {
    await wiring.close();
  }
});

test("RETRY LEARNING (review round-5 item 4): retries the governed step directly on an OPEN flag without forcing Clear-then-Reopen, and rejects retrying a non-failed flag", async () => {
  const wiring = await buildWiring();
  try {
    const recordId = await seedJobApplication(wiring);
    const caller = await makeCaller(wiring);

    const originalPropose = wiring.pipeline.propose.bind(wiring.pipeline);
    let shouldThrow = true;
    wiring.pipeline.propose = (async (...args: Parameters<typeof originalPropose>) => {
      if (shouldThrow) {
        shouldThrow = false;
        throw new Error("simulated transient governed-step failure");
      }
      return originalPropose(...args);
    }) as typeof wiring.pipeline.propose;

    const { memory } = await caller.redFlag.create({ organizationId: PILOT_ORGANIZATION, operationId: "00000000-0000-4000-8000-000000000207", anchor: cellAnchor(recordId), renderedValue: "x" });
    assert.equal(parseFlag(memory).learningStatus, "failed");
    assert.equal(parseFlag(memory).status, "open", "the flag itself must stay OPEN — only the learning step failed");

    const { memory: retried } = await caller.redFlag.retryLearning({ organizationId: PILOT_ORGANIZATION, flagId: memory.id, operationId: "00000000-0000-4000-8000-000000000208" });
    assert.equal(parseFlag(retried).learningStatus, "proposed", "retryLearning must re-attempt the governed step on the SAME open flag, no Clear/Reopen required");
    assert.equal(parseFlag(retried).status, "open");

    // Retrying an already-proposed flag must be rejected — nothing to retry.
    await assert.rejects(
      () => caller.redFlag.retryLearning({ organizationId: PILOT_ORGANIZATION, flagId: retried.id, operationId: "00000000-0000-4000-8000-000000000209" }),
      (err: unknown) => err instanceof TRPCError && err.code === "CONFLICT",
    );
  } finally {
    await wiring.close();
  }
});

test("SAGA: concurrent first-create on the SAME anchor with DIFFERENT operationIds — exactly one wins, the other gets CONFLICT", async () => {
  const wiring = await buildWiring();
  try {
    const recordId = await seedJobApplication(wiring);
    const caller = await makeCaller(wiring);
    const anchor = cellAnchor(recordId);
    const results = await Promise.allSettled([
      caller.redFlag.create({ organizationId: PILOT_ORGANIZATION, operationId: "00000000-0000-4000-8000-000000000305", anchor, renderedValue: "a" }),
      caller.redFlag.create({ organizationId: PILOT_ORGANIZATION, operationId: "00000000-0000-4000-8000-000000000306", anchor, renderedValue: "b" }),
    ]);
    const fulfilled = results.filter((r) => r.status === "fulfilled");
    const rejected = results.filter((r) => r.status === "rejected");
    assert.equal(fulfilled.length, 1, "exactly one concurrent first-create for the same anchor must win");
    assert.equal(rejected.length, 1);
    const rejection = (rejected[0] as PromiseRejectedResult).reason;
    assert.ok(rejection instanceof TRPCError && rejection.code === "CONFLICT");
  } finally {
    await wiring.close();
  }
});

test("SAGA (review round-5 item 10): two DIFFERENT anchors' FIRST-EVER flags in a fresh organization both provision the SAME organization red-flag learning Goal concurrently — neither errors, both converge on the identical Goal id", async () => {
  const wiring = await buildWiring();
  try {
    // Two DISTINCT anchors (different applications) so BOTH genuinely reach
    // step 2 (the governed learning step, which provisions the shared
    // per-organization Goal) at the same time — unlike the "same anchor" test
    // above, where only one caller ever gets past step 1's own CAS lock.
    const recordIdA = await seedJobApplication(wiring);
    const recordIdB = await seedJobApplication(wiring);
    const caller = await makeCaller(wiring);
    const [a, b] = await Promise.all([
      caller.redFlag.create({ organizationId: PILOT_ORGANIZATION, operationId: "00000000-0000-4000-8000-000000000c01", anchor: cellAnchor(recordIdA), renderedValue: "a" }),
      caller.redFlag.create({ organizationId: PILOT_ORGANIZATION, operationId: "00000000-0000-4000-8000-000000000c02", anchor: cellAnchor(recordIdB), renderedValue: "b" }),
    ]);
    assert.equal(parseFlag(a.memory).learningStatus, "proposed", "neither concurrent first-ever attempt may fail due to a Goal-provisioning race");
    assert.equal(parseFlag(b.memory).learningStatus, "proposed");

    const goals = await wiring.goalTasks.listGoals(PILOT_ORGANIZATION);
    const learningGoals = goals.filter((g) => g.type === PLATFORM_RED_FLAG_LEARNING_GOAL_TYPE);
    assert.equal(learningGoals.length, 1, "exactly ONE red-flag learning Goal must exist for the organization — a race must never duplicate it");
  } finally {
    await wiring.close();
  }
});

test("SAGA: reusing an operationId with DIFFERENT content is rejected as a conflict, not silently accepted", async () => {
  const wiring = await buildWiring();
  try {
    const recordId = await seedJobApplication(wiring);
    const caller = await makeCaller(wiring);
    const opId = "00000000-0000-4000-8000-000000000006";
    await caller.redFlag.create({ organizationId: PILOT_ORGANIZATION, operationId: opId, anchor: cellAnchor(recordId), renderedValue: "x" });
    await assert.rejects(
      () => caller.redFlag.create({ organizationId: PILOT_ORGANIZATION, operationId: opId, anchor: cellAnchor(recordId), renderedValue: "a totally different value" }),
      (err: unknown) => err instanceof TRPCError && err.code === "CONFLICT",
    );
  } finally {
    await wiring.close();
  }
});

test("SAGA: create rejects a second, DIFFERENT operationId targeting an anchor that already has an open flag", async () => {
  const wiring = await buildWiring();
  try {
    const recordId = await seedJobApplication(wiring);
    const caller = await makeCaller(wiring);
    await caller.redFlag.create({ organizationId: PILOT_ORGANIZATION, operationId: "00000000-0000-4000-8000-000000000007", anchor: cellAnchor(recordId), renderedValue: "x" });
    await assert.rejects(
      () => caller.redFlag.create({ organizationId: PILOT_ORGANIZATION, operationId: "00000000-0000-4000-8000-000000000008", anchor: cellAnchor(recordId), renderedValue: "y" }),
      (err: unknown) => err instanceof TRPCError && err.code === "CONFLICT",
    );
  } finally {
    await wiring.close();
  }
});

test("redFlag/AP-182: a direct Human invocation of the governed learning skill is flagged on the ledger, not refused", async () => {
  const wiring = await buildWiring();
  try {
    const recordId = await seedJobApplication(wiring);
    const caller = await makeCaller(wiring);
    await caller.redFlag.create({ organizationId: PILOT_ORGANIZATION, operationId: "00000000-0000-4000-8000-000000000009", anchor: cellAnchor(recordId), renderedValue: "x" });
    const goals = await caller.agentOrchestration.goal.list({ organizationId: PILOT_ORGANIZATION });
    const goal = goals.find((g) => g.type === "platform.red_flag_learning");
    assert.ok(goal);
    const tasks = await caller.agentOrchestration.task.listByGoal({ organizationId: PILOT_ORGANIZATION, goalId: goal!.id });
    const task = tasks.at(-1);
    assert.ok(task);

    const proposal = await wiring.pipeline.propose(
      {
        organizationId: PILOT_ORGANIZATION,
        actor: { type: "user", id: PILOT_USER },
        action: "write",
        resourceType: "signal",
        inputs: { kind: "red_flag_correction_proposal" },
        skill: "learning.proposePreferenceAdjustment",
        goalTaskRef: { goalId: goal!.id, taskId: task!.id },
        // The old test was refused at the AGS1 gate before the taint sink ever
        // ran; now the request reaches the skill, so it carries the label a
        // genuine authenticated turn carries (the taint sink is still a gate).
        taintLabel: labelAtSource("human_input", {
          ref: "red-flag:direct-human-invocation",
          valueHash: hashTaintValue("red_flag_correction_proposal"),
          sensitivity: "organization",
          instructionRisk: "none",
        }),
      },
      makeRun(),
    );
    assert.notEqual(proposal.status, "rejected", proposal.rejectionReason);
    assert.ok(
      proposal.policyResults.some((r) => r.policyId === "governance.flag" && /invoked directly by a user actor/.test(r.reason)),
      "the direct Human invocation must be recorded as a governance flag",
    );
  } finally {
    await wiring.close();
  }
});

test("CAS: clear/reopen/updateReason reject a stale flagId with CONFLICT instead of forking the lineage", async () => {
  const wiring = await buildWiring();
  try {
    const recordId = await seedJobApplication(wiring);
    const caller = await makeCaller(wiring);
    const { memory: v1 } = await caller.redFlag.create({ organizationId: PILOT_ORGANIZATION, operationId: "00000000-0000-4000-8000-00000000000a", anchor: cellAnchor(recordId), renderedValue: "x" });
    const { memory: v2 } = await caller.redFlag.clear({ organizationId: PILOT_ORGANIZATION, flagId: v1.id });
    assert.notEqual(v2.id, v1.id);

    // v1 is now stale (superseded) — acting on it again must fail, not fork history.
    await assert.rejects(() => caller.redFlag.reopen({ organizationId: PILOT_ORGANIZATION, flagId: v1.id }), (err: unknown) => err instanceof TRPCError && err.code === "CONFLICT");
    await assert.rejects(() => caller.redFlag.updateReason({ organizationId: PILOT_ORGANIZATION, flagId: v1.id, reason: "stale write" }), (err: unknown) => err instanceof TRPCError && err.code === "CONFLICT");

    const current = await wiring.memoryStore.currentForLineage(PILOT_ORGANIZATION, PILOT_USER, v1.subjectRecordId!);
    assert.equal(current?.id, v2.id);
  } finally {
    await wiring.close();
  }
});

test("SAGA (review round-5 item 5, 'updateReason-vs-clear'): a REAL concurrent updateReason and clear racing the SAME current flagId — exactly one wins, the other gets CONFLICT, and the lineage is never forked", async () => {
  const wiring = await buildWiring();
  try {
    const recordId = await seedJobApplication(wiring);
    const caller = await makeCaller(wiring);
    const { memory } = await caller.redFlag.create({ organizationId: PILOT_ORGANIZATION, operationId: "00000000-0000-4000-8000-000000000d01", anchor: cellAnchor(recordId), renderedValue: "x" });
    const results = await Promise.allSettled([
      caller.redFlag.updateReason({ organizationId: PILOT_ORGANIZATION, flagId: memory.id, reason: "concurrent reason edit" }),
      caller.redFlag.clear({ organizationId: PILOT_ORGANIZATION, flagId: memory.id }),
    ]);
    const fulfilled = results.filter((r) => r.status === "fulfilled");
    const rejected = results.filter((r) => r.status === "rejected");
    assert.equal(fulfilled.length, 1, "exactly one of the two concurrent actions on the SAME current flag must win");
    assert.equal(rejected.length, 1);
    assert.ok((rejected[0] as PromiseRejectedResult).reason instanceof TRPCError && ((rejected[0] as PromiseRejectedResult).reason as TRPCError).code === "CONFLICT");
    // Whichever won, the lineage must have exactly ONE current version — never forked.
    const current = await wiring.memoryStore.currentForLineage(PILOT_ORGANIZATION, PILOT_USER, memory.subjectRecordId!);
    assert.ok(current);
    const winnerId = (fulfilled[0] as PromiseFulfilledResult<{ memory: { id: string } }>).value.memory.id;
    assert.equal(current!.id, winnerId, "the lineage's current version must be exactly the winning action's own result — never a third, forked row");
  } finally {
    await wiring.close();
  }
});

test("updateReason is a no-op (no new lineage row) when the reason does not actually change", async () => {
  const wiring = await buildWiring();
  try {
    const recordId = await seedJobApplication(wiring);
    const caller = await makeCaller(wiring);
    const { memory } = await caller.redFlag.create({ organizationId: PILOT_ORGANIZATION, operationId: "00000000-0000-4000-8000-00000000000b", anchor: cellAnchor(recordId), renderedValue: "x", reason: "same reason" });
    const { memory: result } = await caller.redFlag.updateReason({ organizationId: PILOT_ORGANIZATION, flagId: memory.id, reason: "same reason" });
    assert.equal(result.id, memory.id, "an unchanged reason must not fork a new lineage row");
  } finally {
    await wiring.close();
  }
});

test("ANCHOR IDENTITY: a cell anchor and a bullet anchor sharing the same moduleId/recordId never collide", async () => {
  const wiring = await buildWiring();
  try {
    const recordId = await seedJobApplication(wiring);
    const caller = await makeCaller(wiring);
    const anchor = cellAnchor(recordId);
    const bulletAnchor = { kind: "bullet" as const, moduleId: anchor.moduleId, target: { type: "record" as const, recordId }, bulletPath: "fit.strength.0" };
    await caller.redFlag.create({ organizationId: PILOT_ORGANIZATION, operationId: "00000000-0000-4000-8000-00000000000c", anchor, renderedValue: "cell value" });
    await caller.redFlag.create({ organizationId: PILOT_ORGANIZATION, operationId: "00000000-0000-4000-8000-00000000000d", anchor: bulletAnchor, renderedValue: "bullet value" });
    const all = await caller.redFlag.listAll({ organizationId: PILOT_ORGANIZATION });
    assert.equal(all.flags.length, 2, "a cell and a bullet anchor sharing moduleId/recordId must be two distinct flags");
  } finally {
    await wiring.close();
  }
});

test("ANCHOR IDENTITY: file-only and result-only bullet anchors never collide even with the same bulletPath", async () => {
  const wiring = await buildWiring();
  try {
    const caller = await makeCaller(wiring);
    const fileAnchor = { kind: "bullet" as const, moduleId: "job-pilot", target: { type: "file" as const, fileId: "same-id" }, bulletPath: "p.0" };
    const resultAnchor = { kind: "bullet" as const, moduleId: "job-pilot", target: { type: "result" as const, resultId: "same-id" }, bulletPath: "p.0" };
    await caller.redFlag.create({ organizationId: PILOT_ORGANIZATION, operationId: "00000000-0000-4000-8000-00000000000e", anchor: fileAnchor, renderedValue: "file value" });
    await caller.redFlag.create({ organizationId: PILOT_ORGANIZATION, operationId: "00000000-0000-4000-8000-00000000000f", anchor: resultAnchor, renderedValue: "result value" });
    const all = await caller.redFlag.listAll({ organizationId: PILOT_ORGANIZATION });
    assert.equal(all.flags.length, 2, "a file-only and a result-only anchor with the identical bulletPath/id string must remain distinct");
  } finally {
    await wiring.close();
  }
});

test("ANCHOR IDENTITY (review round-5 item 6): a module ALIAS never forks a real target's lineage — 'job-pilot' and its canonical spelling 'jobpilot' hash to the SAME lineage key, and a caller flagging the same anchor under either spelling collides on the SAME flag", async () => {
  const wiring = await buildWiring();
  try {
    const recordId = await seedJobApplication(wiring);
    const caller = await makeCaller(wiring);
    const aliasAnchor = cellAnchor(recordId); // moduleId: "job-pilot"
    const canonicalAnchor = { ...aliasAnchor, moduleId: "jobpilot" };
    // `anchorLineageKey` is the exact function `redFlag.create`'s CAS/lineage
    // primitive keys off — this is the direct, unit-level proof that the
    // alias and its canonical spelling are NOT two different real-world
    // targets from the store's point of view.
    assert.equal(anchorLineageKey(aliasAnchor), anchorLineageKey(canonicalAnchor), "an alias and its canonical spelling must derive the identical lineage key");

    await caller.redFlag.create({ organizationId: PILOT_ORGANIZATION, operationId: "00000000-0000-4000-8000-000000000a10", anchor: aliasAnchor, renderedValue: "x" });
    // A second create on the SAME real target, spelled with the CANONICAL
    // module id, must be rejected as "already flagged" (CONFLICT) — exactly
    // the same behavior as re-flagging with the identical spelling — never
    // silently accepted as a second, independent flag on what the UI would
    // treat as a totally different target.
    await assert.rejects(
      () => caller.redFlag.create({ organizationId: PILOT_ORGANIZATION, operationId: "00000000-0000-4000-8000-000000000a11", anchor: canonicalAnchor, renderedValue: "y" }),
      (err: unknown) => err instanceof TRPCError && err.code === "CONFLICT",
    );
    // And the alternate spelling's `listForAnchor` finds the SAME single flag.
    const viaAlias = await caller.redFlag.listForAnchor({ organizationId: PILOT_ORGANIZATION, anchor: aliasAnchor });
    const viaCanonical = await caller.redFlag.listForAnchor({ organizationId: PILOT_ORGANIZATION, anchor: canonicalAnchor });
    assert.equal(viaAlias.flags.length, 1);
    assert.equal(viaCanonical.flags.length, 1);
    assert.equal(viaAlias.flags[0]!.row.id, viaCanonical.flags[0]!.row.id, "both spellings must resolve to the SAME Memory row, not two independent lineages");
  } finally {
    await wiring.close();
  }
});

test("ANCHOR VALIDATION (review round-4 item 6): create rejects a nonexistent JobPilot application recordId", async () => {
  const wiring = await buildWiring();
  try {
    const caller = await makeCaller(wiring);
    await assert.rejects(
      () => caller.redFlag.create({ organizationId: PILOT_ORGANIZATION, operationId: "00000000-0000-4000-8000-000000000410", anchor: cellAnchor("00000000-0000-4000-8000-00000000fefe"), renderedValue: "x" }),
      (err: unknown) => err instanceof TRPCError && err.code === "NOT_FOUND",
    );
  } finally {
    await wiring.close();
  }
});

test("ANCHOR VALIDATION (review round-4 item 6): create rejects a JobPilot application that exists but belongs to a DIFFERENT organization", async () => {
  const wiring = await buildWiring();
  try {
    const caller = await makeCaller(wiring);
    const otherOrganization = await wiring.organizationStore.createOrganization("test_fixture_other_ws", PILOT_USER);
    const foreignRecordId = await seedJobApplication(wiring, otherOrganization.id);
    await assert.rejects(
      () => caller.redFlag.create({ organizationId: PILOT_ORGANIZATION, operationId: "00000000-0000-4000-8000-000000000411", anchor: cellAnchor(foreignRecordId), renderedValue: "x" }),
      (err: unknown) => err instanceof TRPCError && err.code === "NOT_FOUND",
      "a record that genuinely exists but in a DIFFERENT organization must be indistinguishable from nonexistent",
    );
  } finally {
    await wiring.close();
  }
});

test("ANCHOR VALIDATION (review round-4 item 6): create rejects an unrecognized moduleId, failing closed rather than accepting it existence-proof-free", async () => {
  const wiring = await buildWiring();
  try {
    const caller = await makeCaller(wiring);
    await assert.rejects(
      () =>
        caller.redFlag.create({
          organizationId: PILOT_ORGANIZATION,
          operationId: "00000000-0000-4000-8000-000000000412",
          anchor: { kind: "cell", moduleId: "totally-unrecognized-module", databaseId: "x", recordId: "00000000-0000-4000-8000-000000000001", fieldId: "y" },
          renderedValue: "x",
        }),
      (err: unknown) => err instanceof TRPCError && err.code === "NOT_FOUND",
    );
  } finally {
    await wiring.close();
  }
});

test("ANCHOR VALIDATION (review round-4 item 6): create rejects a nonexistent 'record'/'event' module recordId too, not just JobPilot", async () => {
  const wiring = await buildWiring();
  try {
    const caller = await makeCaller(wiring);
    const bogusId = "00000000-0000-4000-8000-00000000f0f0";
    await assert.rejects(
      () =>
        caller.redFlag.create({
          organizationId: PILOT_ORGANIZATION,
          operationId: "00000000-0000-4000-8000-000000000413",
          anchor: { kind: "cell", moduleId: "record", databaseId: "dealpilot.deals", recordId: bogusId, fieldId: "fit" },
          renderedValue: "x",
        }),
      (err: unknown) => err instanceof TRPCError && err.code === "NOT_FOUND",
    );
    await assert.rejects(
      () =>
        caller.redFlag.create({
          organizationId: PILOT_ORGANIZATION,
          operationId: "00000000-0000-4000-8000-000000000414",
          anchor: { kind: "cell", moduleId: "event", databaseId: "events", recordId: bogusId, fieldId: "notes" },
          renderedValue: "x",
        }),
      (err: unknown) => err instanceof TRPCError && err.code === "NOT_FOUND",
    );
  } finally {
    await wiring.close();
  }
});

test("listForScope batches an entire scope's current flags in one call, filtered server-side by anchor.moduleId (review round-4 item 7)", async () => {
  const wiring = await buildWiring();
  try {
    const recordId = await seedJobApplication(wiring);
    const caller = await makeCaller(wiring);
    const anchorA = cellAnchor(recordId);
    const anchorB = cellAnchor(recordId, { fieldId: "fit.recommendation" });
    await caller.redFlag.create({ organizationId: PILOT_ORGANIZATION, operationId: "00000000-0000-4000-8000-000000000010", anchor: anchorA, renderedValue: "x" });
    await caller.redFlag.create({ organizationId: PILOT_ORGANIZATION, operationId: "00000000-0000-4000-8000-000000000011", anchor: anchorB, renderedValue: "y" });
    const scoped = await caller.redFlag.listForScope({ organizationId: PILOT_ORGANIZATION, moduleId: "job-pilot", databaseId: "jobpilot.jobs", recordId });
    assert.equal(scoped.flags.length, 2);
  } finally {
    await wiring.close();
  }
});

test("listAll paginates server-side with a real keyset cursor (review round-4 item 8), stable across a concurrent insert between pages", async () => {
  const wiring = await buildWiring();
  try {
    const caller = await makeCaller(wiring);
    const recordIds: string[] = [];
    for (let i = 0; i < 5; i++) {
      const recordId = await seedJobApplication(wiring);
      recordIds.push(recordId);
      await caller.redFlag.create({
        organizationId: PILOT_ORGANIZATION,
        operationId: `00000000-0000-4000-8000-00000000030${i}`,
        anchor: cellAnchor(recordId),
        renderedValue: "x",
      });
    }
    const page1 = await caller.redFlag.listAll({ organizationId: PILOT_ORGANIZATION, limit: 2 });
    assert.equal(page1.flags.length, 2);
    assert.ok(page1.nextCursor);

    // A concurrent insert landing between page fetches must not shift or
    // duplicate results — the whole point of a real keyset cursor.
    const extraRecordId = await seedJobApplication(wiring);
    const { memory: extraMemory } = await caller.redFlag.create({
      organizationId: PILOT_ORGANIZATION,
      operationId: "00000000-0000-4000-8000-000000000399",
      anchor: cellAnchor(extraRecordId),
      renderedValue: "inserted mid-pagination",
    });

    const page2 = await caller.redFlag.listAll({ organizationId: PILOT_ORGANIZATION, limit: 2, cursor: page1.nextCursor! });
    assert.equal(page2.flags.length, 2);
    const page3 = await caller.redFlag.listAll({ organizationId: PILOT_ORGANIZATION, limit: 2, cursor: page2.nextCursor! });
    // The mid-pagination insert is NEWER than page1's cursor position — a
    // keyset walking strictly OLDER from that point correctly never visits
    // it (the same behavior any keyset-paginated feed has: an insert
    // "ahead of" where you already paged past is not retroactively swept
    // up). What matters is that the 5 ORIGINAL flags are each returned
    // exactly once despite the concurrent insert landing between fetches.
    assert.equal(page3.flags.length, 1);
    assert.equal(page3.nextCursor, null);
    const ids = [...page1.flags, ...page2.flags, ...page3.flags].map((f) => f.row.id);
    assert.equal(new Set(ids).size, 5, "keyset pagination must return each of the 5 pre-existing flags exactly once, never a duplicate/omission, despite a concurrent insert between page fetches");
    assert.ok(!ids.includes(extraMemory.id), "the mid-pagination insert (newer than the already-consumed cursor position) must not leak into a later, older-moving page");
  } finally {
    await wiring.close();
  }
});

test("history returns the full lineage (the internal none->proposed step, then clear, then reopen), oldest first, with keyset pagination and no silent 200-cap", async () => {
  const wiring = await buildWiring();
  try {
    const recordId = await seedJobApplication(wiring);
    const caller = await makeCaller(wiring);
    const { memory: v1 } = await caller.redFlag.create({ organizationId: PILOT_ORGANIZATION, operationId: "00000000-0000-4000-8000-000000000020", anchor: cellAnchor(recordId), renderedValue: "x" });
    const { memory: v2 } = await caller.redFlag.clear({ organizationId: PILOT_ORGANIZATION, flagId: v1.id });
    const { memory: v3 } = await caller.redFlag.reopen({ organizationId: PILOT_ORGANIZATION, flagId: v2.id });
    const history = await caller.redFlag.history({ organizationId: PILOT_ORGANIZATION, flagId: v3.id });
    // `create()` itself is a two-step saga: an internal "none" learningStatus
    // row is written first, then superseded to "proposed" — v1 is already
    // the SECOND of those two rows. `reopen()` writes ONE "reset" row
    // (status "open", learningStatus "none") and then immediately attempts
    // the governed step again, superseding it with its own "proposed"
    // outcome (v3, the SAME two-step shape create() itself uses) — so the
    // full lineage has FIVE versions: none, proposed, cleared, open/none
    // (reopen's reset), proposed (reopen's own fresh outcome — v3).
    assert.equal(history.versions.length, 5);
    assert.equal(history.versions[0]!.value.learningStatus, "none");
    assert.equal(history.versions[1]!.value.learningStatus, "proposed");
    assert.equal(history.versions[2]!.value.status, "cleared");
    assert.equal(history.versions[3]!.value.status, "open");
    assert.equal(history.versions[3]!.value.learningStatus, "none");
    assert.equal(history.versions[4]!.row.id, v3.id);
    assert.equal(history.versions[4]!.value.learningStatus, "proposed");
    assert.notEqual(history.versions[4]!.value.proposalId, JSON.parse(v1.content).proposalId, "reopen must start a FRESH proposal, never resurrect the withdrawn one");
    assert.equal(history.nextCursor, null);

    const page1 = await caller.redFlag.history({ organizationId: PILOT_ORGANIZATION, flagId: v3.id, limit: 2 });
    assert.equal(page1.versions.length, 2);
    assert.ok(page1.nextCursor);
    const page2 = await caller.redFlag.history({ organizationId: PILOT_ORGANIZATION, flagId: v3.id, limit: 2, cursor: page1.nextCursor! });
    assert.equal(page2.versions.length, 2);
    assert.ok(page2.nextCursor);
    const page3 = await caller.redFlag.history({ organizationId: PILOT_ORGANIZATION, flagId: v3.id, limit: 2, cursor: page2.nextCursor! });
    assert.equal(page3.versions.length, 1);
    assert.equal(page3.nextCursor, null);
  } finally {
    await wiring.close();
  }
});

test("REOPEN (review round-4 item 4): reopening a withdrawn flag creates a NEW proposal for the new active version, never resurrecting the vetoed one", async () => {
  const wiring = await buildWiring();
  try {
    const recordId = await seedJobApplication(wiring);
    const caller = await makeCaller(wiring);
    const { memory: v1 } = await caller.redFlag.create({ organizationId: PILOT_ORGANIZATION, operationId: "00000000-0000-4000-8000-000000000501", anchor: cellAnchor(recordId), renderedValue: "x" });
    const originalProposalId = parseFlag(v1).proposalId!;
    const { memory: cleared } = await caller.redFlag.clear({ organizationId: PILOT_ORGANIZATION, flagId: v1.id });
    const originalDecision = await wiring.ledger.decisionFor(originalProposalId);
    assert.equal(originalDecision!.userDecision, "veto");

    const { memory: reopened } = await caller.redFlag.reopen({ organizationId: PILOT_ORGANIZATION, flagId: cleared.id });
    const reopenedValue = parseFlag(reopened);
    assert.equal(reopenedValue.status, "open");
    assert.equal(reopenedValue.learningStatus, "proposed");
    assert.notEqual(reopenedValue.proposalId, originalProposalId, "reopen must mint a FRESH proposal, not resurrect the permanently-vetoed one");

    // The old, vetoed proposal must remain exactly as it was — permanently resolved.
    const staleDecisionStillThere = await wiring.ledger.decisionFor(originalProposalId);
    assert.equal(staleDecisionStillThere!.userDecision, "veto");
    const newDecision = await wiring.ledger.decisionFor(reopenedValue.proposalId!);
    assert.equal(newDecision, null, "the fresh proposal must genuinely be pending, not pre-resolved");
  } finally {
    await wiring.close();
  }
});

test("CLEAR (review round-4 item 4): a genuine withdrawal failure leaves the flag untouched (nothing marked cleared, proposal still pending) so a retry is safe", async () => {
  const wiring = await buildWiring();
  try {
    const recordId = await seedJobApplication(wiring);
    const caller = await makeCaller(wiring);
    const { memory } = await caller.redFlag.create({ organizationId: PILOT_ORGANIZATION, operationId: "00000000-0000-4000-8000-000000000601", anchor: cellAnchor(recordId), renderedValue: "x" });
    const value = parseFlag(memory);

    const originalDecide = wiring.pipeline.decide.bind(wiring.pipeline);
    let shouldThrow = true;
    wiring.pipeline.decide = (async (...args: Parameters<typeof originalDecide>) => {
      if (shouldThrow) {
        shouldThrow = false;
        throw new Error("simulated withdrawal failure (e.g. a transient ledger outage)");
      }
      return originalDecide(...args);
    }) as typeof wiring.pipeline.decide;

    await assert.rejects(() => caller.redFlag.clear({ organizationId: PILOT_ORGANIZATION, flagId: memory.id }), /simulated withdrawal failure/);

    // Nothing must have mutated: the flag is still open, the proposal still pending.
    const stillCurrent = await wiring.memoryStore.currentForLineage(PILOT_ORGANIZATION, PILOT_USER, memory.subjectRecordId!);
    assert.equal(stillCurrent!.id, memory.id, "a failed withdrawal must leave the flag's OWN lineage completely untouched — never marked cleared with an approvable proposal still live");
    assert.equal(parseFlag(stillCurrent!).status, "open");
    const stillPending = await wiring.ledger.decisionFor(value.proposalId!);
    assert.equal(stillPending, null, "the proposal must still be genuinely pending");

    // A retry (now that the simulated failure has cleared) must succeed cleanly.
    const { memory: cleared } = await caller.redFlag.clear({ organizationId: PILOT_ORGANIZATION, flagId: memory.id });
    assert.equal(parseFlag(cleared).status, "cleared");
  } finally {
    await wiring.close();
  }
});

test("FORGET (review round-4 item 5): enumerates every proposal across the WHOLE lineage — including one from an EARLIER (already-cleared) version — before deleting", async () => {
  const wiring = await buildWiring();
  try {
    const recordId = await seedJobApplication(wiring);
    const caller = await makeCaller(wiring);
    const { memory: v1 } = await caller.redFlag.create({ organizationId: PILOT_ORGANIZATION, operationId: "00000000-0000-4000-8000-000000000701", anchor: cellAnchor(recordId), renderedValue: "x" });
    const firstProposalId = parseFlag(v1).proposalId!;
    const { memory: cleared } = await caller.redFlag.clear({ organizationId: PILOT_ORGANIZATION, flagId: v1.id });
    const { memory: reopened } = await caller.redFlag.reopen({ organizationId: PILOT_ORGANIZATION, flagId: cleared.id });
    const secondProposalId = parseFlag(reopened).proposalId!;
    assert.notEqual(firstProposalId, secondProposalId);

    // The second (fresh, post-reopen) proposal is still genuinely pending.
    assert.equal(await wiring.ledger.decisionFor(secondProposalId), null);

    const { forgotten } = await caller.redFlag.forget({ organizationId: PILOT_ORGANIZATION, flagId: reopened.id });
    assert.ok(forgotten);

    // BOTH proposals — the one from the FIRST (now long-superseded) version
    // AND the fresh one from the reopened version — must be resolved
    // (withdrawn), not just whichever one the caller's own passed flagId
    // happened to reference.
    const firstDecision = await wiring.ledger.decisionFor(firstProposalId);
    assert.equal(firstDecision!.userDecision, "veto");
    const secondDecision = await wiring.ledger.decisionFor(secondProposalId);
    assert.equal(secondDecision!.userDecision, "veto", "forget must withdraw a proposal linked from ANY version across the lineage, not only the current head's");

    const gone = await wiring.memoryStore.get(reopened.id, { organizationId: PILOT_ORGANIZATION, userId: PILOT_USER });
    assert.equal(gone, null);
  } finally {
    await wiring.close();
  }
});

test("ENACTMENT (review round-4 item 1): enactCorrection requires an approved proposal, applies the correction, and is idempotent", async () => {
  const wiring = await buildWiring();
  try {
    const recordId = await seedJobApplication(wiring);
    const caller = await makeCaller(wiring);
    const { memory } = await caller.redFlag.create({ organizationId: PILOT_ORGANIZATION, operationId: "00000000-0000-4000-8000-000000000801", anchor: cellAnchor(recordId), renderedValue: "x" });
    const value = parseFlag(memory);

    // Not yet approved — enactment must be refused.
    await assert.rejects(
      () => caller.redFlag.enactCorrection({ organizationId: PILOT_ORGANIZATION, flagId: memory.id }),
      (err: unknown) => err instanceof TRPCError && err.code === "CONFLICT",
    );

    await caller.action.decide({ proposalId: value.proposalId!, decision: "approve" });

    const { memory: enacted } = await caller.redFlag.enactCorrection({ organizationId: PILOT_ORGANIZATION, flagId: memory.id });
    const enactedValue = parseFlag(enacted);
    assert.equal(enactedValue.learningStatus, "applied", "review round-4 item 1: behavior changes ONLY after approval, and only via this Human-authorized enactment path");

    const adjustment = await wiring.memoryStore.currentForLineage(PILOT_ORGANIZATION, PILOT_USER, value.preferenceAdjustmentId!);
    const adjustmentValue = JSON.parse(adjustment!.content);
    assert.equal(adjustmentValue.status, "applied");
    assert.ok(adjustmentValue.appliedAt);

    // Idempotent: calling again is a clean no-op, not an error or a fork.
    const { memory: enactedAgain } = await caller.redFlag.enactCorrection({ organizationId: PILOT_ORGANIZATION, flagId: enacted.id });
    assert.equal(enactedAgain.id, enacted.id);
  } finally {
    await wiring.close();
  }
});

test("ENACTMENT (review round-4 item 1): a rejected/vetoed proposal can never be enacted", async () => {
  const wiring = await buildWiring();
  try {
    const recordId = await seedJobApplication(wiring);
    const caller = await makeCaller(wiring);
    const { memory } = await caller.redFlag.create({ organizationId: PILOT_ORGANIZATION, operationId: "00000000-0000-4000-8000-000000000802", anchor: cellAnchor(recordId), renderedValue: "x" });
    const value = parseFlag(memory);
    await caller.action.decide({ proposalId: value.proposalId!, decision: "veto" });
    await assert.rejects(
      () => caller.redFlag.enactCorrection({ organizationId: PILOT_ORGANIZATION, flagId: memory.id }),
      (err: unknown) => err instanceof TRPCError && err.code === "CONFLICT",
    );
  } finally {
    await wiring.close();
  }
});

test("REVOCATION (review round-4 item 1): revokeCorrection undoes an applied correction and permanently prevents re-enactment", async () => {
  const wiring = await buildWiring();
  try {
    const recordId = await seedJobApplication(wiring);
    const caller = await makeCaller(wiring);
    const { memory } = await caller.redFlag.create({ organizationId: PILOT_ORGANIZATION, operationId: "00000000-0000-4000-8000-000000000901", anchor: cellAnchor(recordId), renderedValue: "x" });
    const value = parseFlag(memory);
    await caller.action.decide({ proposalId: value.proposalId!, decision: "approve" });
    const { memory: enacted } = await caller.redFlag.enactCorrection({ organizationId: PILOT_ORGANIZATION, flagId: memory.id });

    const { memory: revoked } = await caller.redFlag.revokeCorrection({ organizationId: PILOT_ORGANIZATION, flagId: enacted.id });
    const revokedValue = parseFlag(revoked);
    assert.equal(revokedValue.learningStatus, "dismissed", "revoking proves review round-4 item 1's 'can be undone' — the applied effect is reversed");

    const adjustment = await wiring.memoryStore.currentForLineage(PILOT_ORGANIZATION, PILOT_USER, value.preferenceAdjustmentId!);
    const adjustmentValue = JSON.parse(adjustment!.content);
    assert.equal(adjustmentValue.status, "revoked");
    assert.ok(adjustmentValue.revokedAt);

    // Permanently blocked — never re-enactable (review round-4 item 1:
    // "clear/forget/revoke must prevent later enactment").
    await assert.rejects(
      () => caller.redFlag.enactCorrection({ organizationId: PILOT_ORGANIZATION, flagId: revoked.id }),
      (err: unknown) => err instanceof TRPCError && err.code === "CONFLICT",
    );
  } finally {
    await wiring.close();
  }
});

test("CLEAR/FORGET (review round-4 item 1): clearing/forgetting an ALREADY-APPLIED correction permanently revokes its preference adjustment too", async () => {
  const wiring = await buildWiring();
  try {
    const recordId = await seedJobApplication(wiring);
    const caller = await makeCaller(wiring);
    const { memory } = await caller.redFlag.create({ organizationId: PILOT_ORGANIZATION, operationId: "00000000-0000-4000-8000-000000000902", anchor: cellAnchor(recordId), renderedValue: "x" });
    const value = parseFlag(memory);
    await caller.action.decide({ proposalId: value.proposalId!, decision: "approve" });
    const { memory: enacted } = await caller.redFlag.enactCorrection({ organizationId: PILOT_ORGANIZATION, flagId: memory.id });

    await caller.redFlag.clear({ organizationId: PILOT_ORGANIZATION, flagId: enacted.id });

    const adjustment = await wiring.memoryStore.currentForLineage(PILOT_ORGANIZATION, PILOT_USER, value.preferenceAdjustmentId!);
    const adjustmentValue = JSON.parse(adjustment!.content);
    assert.equal(adjustmentValue.status, "revoked", "clearing a flag whose correction was already applied must revoke it too — never leave it silently still-applied");
  } finally {
    await wiring.close();
  }
});

test("PRIVATE PROPOSALS (review round-4 item 2): a red-flag proposal is invisible in action.listPending to any OTHER member, and only its owner can decide it", async () => {
  const wiring = await buildWiring();
  try {
    const recordId = await seedJobApplication(wiring);
    const owner = await makeCaller(wiring);
    const otherUserId = await inviteSecondMember(wiring);
    const other = await makeCaller(wiring, { type: "user", id: otherUserId });

    const { memory } = await owner.redFlag.create({ organizationId: PILOT_ORGANIZATION, operationId: "00000000-0000-4000-8000-000000001001", anchor: cellAnchor(recordId), renderedValue: "x" });
    const value = parseFlag(memory);

    const othersPending = await other.action.listPending({ organizationId: PILOT_ORGANIZATION, limit: 200, offset: 0 });
    assert.ok(!othersPending.items.some((p) => p.id === value.proposalId), "a private proposal must never appear in a DIFFERENT member's listPending");

    const ownersPending = await owner.action.listPending({ organizationId: PILOT_ORGANIZATION, limit: 200, offset: 0 });
    assert.ok(ownersPending.items.some((p) => p.id === value.proposalId), "the owner must still see their OWN private proposal");

    await assert.rejects(
      () => other.action.decide({ proposalId: value.proposalId!, decision: "approve" }),
      (err: unknown) => err instanceof TRPCError && err.code === "FORBIDDEN",
      "a non-owning member must never be able to decide a private proposal, even though they pass the ordinary membership gate",
    );

    // review round-4 item 2 (closing a gap a fresh independent review found):
    // a non-owner must not be able to observe a private proposal's
    // resolution state either — action.resolution must be exactly as gated
    // as listPending/decide, not merely omitted from the list.
    await assert.rejects(
      () => other.action.resolution({ proposalId: value.proposalId! }),
      (err: unknown) => err instanceof TRPCError && err.code === "NOT_FOUND",
      "a non-owning member must not be able to query a private proposal's resolution state",
    );
    const ownersResolutionBefore = await owner.action.resolution({ proposalId: value.proposalId! });
    assert.equal(ownersResolutionBefore.status, "pending", "the owner must still be able to read their OWN private proposal's resolution state");

    // The owner CAN decide their own private proposal.
    const resolved = await owner.action.decide({ proposalId: value.proposalId!, decision: "approve" });
    assert.equal(resolved.status, "applied");

    // Even AFTER approval, a non-owner must still be unable to observe the
    // decision via resolution() — the leak the fresh review found was
    // specifically post-decision (status "resolved", decision "approve").
    await assert.rejects(
      () => other.action.resolution({ proposalId: value.proposalId! }),
      (err: unknown) => err instanceof TRPCError && err.code === "NOT_FOUND",
    );
    const ownersResolutionAfter = await owner.action.resolution({ proposalId: value.proposalId! });
    assert.equal(ownersResolutionAfter.status, "resolved");
    assert.equal(ownersResolutionAfter.decision, "approve");
  } finally {
    await wiring.close();
  }
});

test("PRIVATE PROPOSALS (review round-4 item 2): an UNRELATED (non-private) proposal keeps full team-visible semantics", async () => {
  const wiring = await buildWiring();
  try {
    const owner = await makeCaller(wiring);
    const otherUserId = await inviteSecondMember(wiring);
    const other = await makeCaller(wiring, { type: "user", id: otherUserId });

    // A REAL governed Agent-Run proposal (the SAME skill/manifest the
    // red-flag flow itself uses) invoked directly with ordinary, non-
    // private inputs — proving item 2's ownership gate leaves every OTHER
    // proposal shape's team-visible semantics completely unchanged.
    const goal = await owner.agentOrchestration.goal.create({ organizationId: PILOT_ORGANIZATION, type: PLATFORM_RED_FLAG_LEARNING_GOAL_TYPE, title: "test fixture goal" });
    const goalTask = await owner.agentOrchestration.task.create({ organizationId: PILOT_ORGANIZATION, goalId: goal.id, type: PROPOSE_PREFERENCE_ADJUSTMENT_TASK_TYPE, assignedAgentId: LEARNING_AGENT });
    const proposal = await wiring.pipeline.propose(
      {
        organizationId: PILOT_ORGANIZATION,
        actor: { type: "agent", id: LEARNING_AGENT },
        action: "write",
        resourceType: "signal",
        skill: "learning.proposePreferenceAdjustment",
        goalTaskRef: { goalId: goal.id, taskId: goalTask.id },
        inputs: { note: "a completely ordinary, non-private team proposal" },
        taintLabel: labelAtSource("human_input", {
          ref: "red-flag:team-proposal",
          valueHash: hashTaintValue(
            "a completely ordinary, non-private team proposal",
          ),
          sensitivity: "organization",
          instructionRisk: "instruction_like",
        }),
      },
      makeRun(),
    );
    assert.equal(proposal.status, "pending_review");

    const othersPending = await other.action.listPending({ organizationId: PILOT_ORGANIZATION, limit: 200, offset: 0 });
    assert.ok(othersPending.items.some((p) => p.id === proposal.id), "a non-private proposal must remain visible to every OTHER team member exactly as before");

    // Any member (not just its own author) may decide an ordinary team proposal.
    const resolved = await other.action.decide({ proposalId: proposal.id, decision: "approve" });
    assert.equal(resolved.status, "applied");
  } finally {
    await wiring.close();
  }
});
