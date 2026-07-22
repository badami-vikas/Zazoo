import assert from "node:assert/strict";
import test from "node:test";
import { TRPCError } from "@trpc/server";
import {
  InMemoryRoleStore,
  SeededRng,
  SystemClock,
  UuidGen,
  hashTaintValue,
  type Actor,
  type RunCtx,
} from "@bridge/core";
import { appRouter } from "../src/router.js";
import {
  buildWiring,
  OUTREACH_AGENT,
  PILOT_USER,
  PILOT_ORGANIZATION,
  type Wiring,
} from "../src/wiring.js";

const NON_MEMBER_USER_ID = "c0000000-0000-4000-a000-000000000099";

function makeRun(seed = 1): RunCtx {
  const clock = new SystemClock();
  const rng = new SeededRng(seed);
  return { clock, rng, ids: new UuidGen(clock, rng) };
}

function makeCaller(wiring: Wiring, identity: Actor = { type: "user", id: PILOT_USER }, seed = 1) {
  return appRouter.createCaller({
    wiring,
    run: makeRun(seed),
    identity,
    authenticated: true,
    verifying: false,
  });
}

function grantShareEvent(wiring: Wiring) {
  assert.ok(wiring.roles instanceof InMemoryRoleStore, "buildWiring test harness should use in-memory roles");
  wiring.roles.direct.set(`user:${PILOT_USER}`, [
    { resourceType: "event", resourceId: null, action: "share", effect: "allow" },
    { resourceType: "external:send", resourceId: null, action: "share", effect: "allow" },
    { resourceType: "module", resourceId: null, action: "share", effect: "allow" },
  ]);
}

test("action.decide: a user can veto a pending share proposal through the router", async () => {
  const wiring = await buildWiring();
  try {
    grantShareEvent(wiring);
    const caller = makeCaller(wiring);
    const proposed = await caller.action.propose({
      organizationId: PILOT_ORGANIZATION,
      actor: { type: "user", id: PILOT_USER },
      action: "share",
      resourceType: "event",
      inputs: { note: "test_fixture_router_decide_note" },
      skill: "stageMutation",
    });

    assert.equal(proposed.status, "pending_review");
    assert.deepEqual(await caller.action.resolution({ proposalId: proposed.id }), {
      status: "pending",
      decision: null,
    });

    const resolved = await caller.action.decide({
      proposalId: proposed.id,
      decision: "veto",
      reason: "Bad timing",
    });
    assert.equal(resolved.status, "rejected");
    assert.notEqual(resolved.status, "pending_review");
    assert.deepEqual(resolved.effects, { materialized: false, sent: false });
    assert.equal(resolved.effectsStatus, "confirmed");
    assert.deepEqual((await wiring.ledger.decisionFor(proposed.id))?.diff, {
      to: { note: "test_fixture_router_decide_note" },
      reviewReason: "Bad timing",
    });
    assert.deepEqual(await caller.action.resolution({ proposalId: proposed.id }), {
      status: "resolved",
      decision: "veto",
    });
  } finally {
    await wiring.close();
  }
});

test("action taint trace is prompt-free and Human declassification is immutable", async () => {
  const wiring = await buildWiring();
  try {
    grantShareEvent(wiring);
    const caller = makeCaller(wiring);
    const proposed = await caller.action.propose({
      organizationId: PILOT_ORGANIZATION,
      actor: { type: "user", id: PILOT_USER },
      action: "share",
      resourceType: "module",
      inputs: { note: "test_fixture_taint_trace" },
      skill: "stageMutation",
    });
    assert.equal(proposed.status, "pending_review");

    const before = await caller.action.taintTrace({
      proposalId: proposed.id,
    });
    assert.equal(before.label.version, 1);
    assert.equal(before.label.trust, "authenticated_human");
    assert.equal(before.sinkTraces.length, 1);
    assert.equal(before.sinkTraces[0]?.sink, "external_send");
    assert.equal(JSON.stringify(before).includes("test_fixture_taint_trace"), false);

    await caller.action.decide({
      proposalId: proposed.id,
      decision: "approve",
    });
    const declassified = await caller.action.declassifyInstructionRisk({
      proposalId: proposed.id,
      reason: "Human reviewed the exact proposal as inert data",
      evidenceHash: hashTaintValue("reviewed exact proposal"),
    });
    assert.equal(declassified.before.instructionRisk, "instruction_like");
    assert.equal(declassified.after.instructionRisk, "data");
    assert.equal(declassified.actor.type, "user");

    const after = await caller.action.taintTrace({
      proposalId: proposed.id,
    });
    assert.equal(after.declassifications.length, 1);
    assert.equal(after.declassifications[0]?.id, declassified.id);

    const otherMember = await wiring.organizationStore.inviteMember(
      PILOT_ORGANIZATION,
      "taint-reviewer@example.test",
    );
    const otherMemberCaller = makeCaller(
      wiring,
      { type: "user", id: otherMember.userId },
      10,
    );
    await assert.rejects(
      () =>
        otherMemberCaller.action.declassifyInstructionRisk({
          proposalId: proposed.id,
          reason: "Different member attempt",
          evidenceHash: hashTaintValue("different-member"),
        }),
      (error: unknown) =>
        error instanceof TRPCError && error.code === "FORBIDDEN",
    );

    const agentCaller = makeCaller(
      wiring,
      { type: "agent", id: OUTREACH_AGENT },
      11,
    );
    await assert.rejects(
      () =>
        agentCaller.action.declassifyInstructionRisk({
          proposalId: proposed.id,
          reason: "Agent attempt",
          evidenceHash: hashTaintValue("agent"),
        }),
      (error: unknown) =>
        error instanceof TRPCError && error.code === "FORBIDDEN",
    );
  } finally {
    await wiring.close();
  }
});

test("action.decide: an agent identity is rejected with FORBIDDEN at the review gate", async () => {
  const wiring = await buildWiring();
  try {
    grantShareEvent(wiring);
    const userCaller = makeCaller(wiring);
    const proposed = await userCaller.action.propose({
      organizationId: PILOT_ORGANIZATION,
      actor: { type: "user", id: PILOT_USER },
      action: "share",
      resourceType: "event",
      inputs: { note: "test_fixture_router_decide_note" },
      skill: "stageMutation",
    });
    assert.equal(proposed.status, "pending_review");

    const agentCaller = makeCaller(wiring, { type: "agent", id: "c0000000-0000-4000-a000-000000000098" }, 2);
    await assert.rejects(
      () => agentCaller.action.decide({ proposalId: proposed.id, decision: "approve" }),
      (err: unknown) => {
        assert.ok(err instanceof TRPCError, "expected a TRPCError");
        assert.equal((err as TRPCError).code, "FORBIDDEN");
        return true;
      },
    );
  } finally {
    await wiring.close();
  }
});

test("action approvals reject authenticated users outside the proposal organization", async () => {
  const wiring = await buildWiring();
  try {
    grantShareEvent(wiring);
    const memberCaller = makeCaller(wiring);
    const proposed = await memberCaller.action.propose({
      organizationId: PILOT_ORGANIZATION,
      actor: { type: "user", id: PILOT_USER },
      action: "share",
      resourceType: "event",
      inputs: { note: "test_fixture_private_pending_proposal" },
      skill: "stageMutation",
    });
    assert.equal(proposed.status, "pending_review");

    const nonMemberCaller = makeCaller(wiring, { type: "user", id: NON_MEMBER_USER_ID }, 3);
    await assert.rejects(
      () =>
        nonMemberCaller.action.propose({
          organizationId: PILOT_ORGANIZATION,
          actor: { type: "user", id: NON_MEMBER_USER_ID },
          action: "write",
          resourceType: "event",
          inputs: { note: "test_fixture_forged_proposal" },
          skill: "stageMutation",
        }),
      (err: unknown) => err instanceof TRPCError && err.code === "FORBIDDEN",
    );
    await assert.rejects(
      () => nonMemberCaller.action.listPending({ organizationId: PILOT_ORGANIZATION, limit: 50, offset: 0 }),
      (err: unknown) => err instanceof TRPCError && err.code === "FORBIDDEN",
    );
    await assert.rejects(
      () => nonMemberCaller.action.listHistory({ organizationId: PILOT_ORGANIZATION, limit: 50, offset: 0 }),
      (err: unknown) => err instanceof TRPCError && err.code === "FORBIDDEN",
    );
    await assert.rejects(
      () => nonMemberCaller.action.decide({ proposalId: proposed.id, decision: "approve" }),
      (err: unknown) => err instanceof TRPCError && err.code === "FORBIDDEN",
    );
    await assert.rejects(
      () => nonMemberCaller.action.resolution({ proposalId: proposed.id }),
      (err: unknown) => err instanceof TRPCError && err.code === "FORBIDDEN",
    );
  } finally {
    await wiring.close();
  }
});

test("action.propose rejects browser-selected Agent identities", async () => {
  const wiring = await buildWiring();
  try {
    const caller = makeCaller(wiring);
    await assert.rejects(
      () =>
        caller.action.propose({
          organizationId: PILOT_ORGANIZATION,
          actor: { type: "agent", id: "b0000000-0000-4000-a000-0000000000d1" },
          action: "write",
          resourceType: "event",
          inputs: { note: "test_fixture_forged_agent_proposal" },
          skill: "stageMutation",
        }),
      (err: unknown) => err instanceof TRPCError && err.code === "FORBIDDEN",
    );
  } finally {
    await wiring.close();
  }
});

test("rejection audit rows never enter Approvals or become approvable", async () => {
  const wiring = await buildWiring();
  try {
    const caller = makeCaller(wiring);
    const rejected = await caller.action.propose({
      organizationId: PILOT_ORGANIZATION,
      actor: { type: "user", id: PILOT_USER },
      action: "write",
      resourceType: "policy",
      inputs: { note: "test_fixture_unauthorized_policy_write" },
      skill: "stageMutation",
    });
    assert.equal(rejected.status, "rejected");
    assert.equal(
      (await caller.action.listPending({ organizationId: PILOT_ORGANIZATION, limit: 50, offset: 0 })).total,
      0,
    );
    assert.deepEqual(await caller.action.resolution({ proposalId: rejected.id }), {
      status: "terminal",
      decision: null,
    });
    await assert.rejects(
      () => caller.action.decide({ proposalId: rejected.id, decision: "approve" }),
      (err: unknown) => err instanceof TRPCError && err.code === "BAD_REQUEST",
    );
  } finally {
    await wiring.close();
  }
});

test("action.decide reports post-decision effect failures without losing the recorded decision", async () => {
  const wiring = await buildWiring();
  try {
    grantShareEvent(wiring);
    wiring.google.onApproved = async () => {
      throw new Error("test_fixture_provider_unavailable");
    };
    const caller = makeCaller(wiring);
    const proposed = await caller.action.propose({
      organizationId: PILOT_ORGANIZATION,
      actor: { type: "user", id: PILOT_USER },
      action: "share",
      resourceType: "event",
      inputs: { note: "test_fixture_effect_failure" },
      skill: "stageMutation",
    });
    assert.equal(proposed.status, "pending_review");

    const resolved = await caller.action.decide({
      proposalId: proposed.id,
      decision: "approve",
    });
    assert.equal(resolved.status, "applied");
    assert.equal(resolved.effectsStatus, "failed");
    assert.match(resolved.effectsError, /provider_unavailable/);
    assert.equal((await wiring.ledger.decisionFor(proposed.id))?.userDecision, "approve");
    assert.ok(resolved.effectsAuditId);
    assert.deepEqual((await wiring.ledger.get(resolved.effectsAuditId))?.diff, {
      executionFailed: "test_fixture_provider_unavailable",
    });
  } finally {
    await wiring.close();
  }
});

/**
 * D8 (BUGS.md "approved external effects have no durable retry executor",
 * OPEN 2026-07-16) — verifies the GAP the bug described (a non-Relationship,
 * non-Module-install proposal whose post-decision effect fails could never be
 * retried — `action.decide` called again just reports CONFLICT) and that
 * `action.reconcileApproved` closes it: it replays ONLY the post-decision
 * effect, reusing the already-persisted approval/decision, and never creates
 * a second review decision.
 */
test("action.reconcileApproved durably retries a failed post-decision effect without a second review decision", async () => {
  const wiring = await buildWiring();
  try {
    grantShareEvent(wiring);
    let onApprovedCalls = 0;
    let failNextCall = true;
    const originalOnApproved = wiring.google.onApproved.bind(wiring.google);
    wiring.google.onApproved = async (...args: Parameters<typeof originalOnApproved>) => {
      onApprovedCalls += 1;
      if (failNextCall) {
        failNextCall = false;
        throw new Error("test_fixture_reconcile_provider_unavailable");
      }
      return originalOnApproved(...args);
    };
    const caller = makeCaller(wiring);
    const proposed = await caller.action.propose({
      organizationId: PILOT_ORGANIZATION,
      actor: { type: "user", id: PILOT_USER },
      action: "share",
      resourceType: "event",
      inputs: { note: "test_fixture_reconcile_effect" },
      skill: "stageMutation",
    });
    assert.equal(proposed.status, "pending_review");

    const decided = await caller.action.decide({
      proposalId: proposed.id,
      decision: "approve",
    });
    assert.equal(decided.status, "applied");
    assert.equal(decided.effectsStatus, "failed");
    assert.match(decided.effectsError, /reconcile_provider_unavailable/);
    assert.equal(onApprovedCalls, 1);
    const originalDecision = await wiring.ledger.decisionFor(proposed.id);
    assert.equal(originalDecision?.userDecision, "approve");

    // The exact pre-existing gap: this proposal is neither a Relationship
    // nor a capture-intake proposal, so `action.decide` cannot replay it —
    // calling it again on an already-resolved proposal just reports CONFLICT.
    await assert.rejects(
      () => caller.action.decide({ proposalId: proposed.id, decision: "approve" }),
      (error: unknown) => error instanceof TRPCError && error.code === "CONFLICT",
    );

    const reconciled = await caller.action.reconcileApproved({ proposalId: proposed.id });
    assert.equal(reconciled.effectsStatus, "confirmed");
    assert.equal(onApprovedCalls, 2);

    // No second review decision was created: same original decision row.
    const decisionAfterReconcile = await wiring.ledger.decisionFor(proposed.id);
    assert.equal(decisionAfterReconcile?.id, originalDecision?.id);
    assert.equal(decisionAfterReconcile?.userDecision, "approve");
    assert.deepEqual(
      await caller.action.resolution({ proposalId: proposed.id }),
      { status: "resolved", decision: "approve" },
    );

    // Idempotent: reconciling again after it already succeeded safely replays.
    const reconciledAgain = await caller.action.reconcileApproved({ proposalId: proposed.id });
    assert.equal(reconciledAgain.effectsStatus, "confirmed");
    assert.equal(onApprovedCalls, 3);
  } finally {
    await wiring.close();
  }
});

test("action.reconcileApproved rejects a non-approved decision and an unknown proposal", async () => {
  const wiring = await buildWiring();
  try {
    grantShareEvent(wiring);
    const caller = makeCaller(wiring);
    const vetoed = await caller.action.propose({
      organizationId: PILOT_ORGANIZATION,
      actor: { type: "user", id: PILOT_USER },
      action: "share",
      resourceType: "event",
      inputs: { note: "test_fixture_reconcile_vetoed" },
      skill: "stageMutation",
    });
    assert.equal(vetoed.status, "pending_review");
    await caller.action.decide({ proposalId: vetoed.id, decision: "veto" });

    await assert.rejects(
      () => caller.action.reconcileApproved({ proposalId: vetoed.id }),
      (error: unknown) => error instanceof TRPCError && error.code === "BAD_REQUEST",
    );
    await assert.rejects(
      () => caller.action.reconcileApproved({ proposalId: "00000000-0000-4000-8000-000000000099" }),
      (error: unknown) => error instanceof TRPCError && error.code === "NOT_FOUND",
    );
  } finally {
    await wiring.close();
  }
});

test("action.proposeOutreachDraft binds the server-owned Agent to the authenticated user", async () => {
  const wiring = await buildWiring();
  try {
    const caller = makeCaller(wiring);
    const input = {
      organizationId: PILOT_ORGANIZATION,
      sourceId: "test_fixture_signal_server_owned_agent",
      label: "Draft follow-up",
      resource: "Test Person",
      proposed: "Hello from the governed draft.",
      channel: "Email",
      trace: {
        signals: ["test_fixture_signal"],
        context: "Test context",
        reasoning: "Test reasoning",
      },
    };
    const [proposed, duplicate] = await Promise.all([
      caller.action.proposeOutreachDraft(input),
      caller.action.proposeOutreachDraft(input),
    ]);
    assert.equal(proposed.status, "pending_review");
    assert.equal(duplicate.id, proposed.id);
    assert.equal(
      (await caller.action.listPending({ organizationId: PILOT_ORGANIZATION, limit: 50, offset: 0 })).total,
      1,
    );

    const ledgerEntry = await wiring.ledger.get(proposed.id);
    assert.equal(ledgerEntry?.actorType, "agent");
    assert.equal(ledgerEntry?.actorId, OUTREACH_AGENT);
    assert.equal(ledgerEntry?.onBehalfOfType, "user");
    assert.equal(ledgerEntry?.onBehalfOfId, PILOT_USER);
    assert.equal(ledgerEntry?.resourceType, "event");
    assert.equal(ledgerEntry?.action, "write");

    await caller.action.decide({ proposalId: proposed.id, decision: "veto" });
    const retried = await caller.action.proposeOutreachDraft(input);
    assert.deepEqual(retried, {
      id: proposed.id,
      status: "already_resolved",
      decision: "veto",
    });
  } finally {
    await wiring.close();
  }
});
