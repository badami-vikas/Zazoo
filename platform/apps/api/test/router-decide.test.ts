import assert from "node:assert/strict";
import test from "node:test";
import { TRPCError } from "@trpc/server";
import { InMemoryRoleStore, SeededRng, SystemClock, UuidGen, type Actor, type RunCtx } from "@bridge/core";
import { appRouter } from "../src/router.js";
import {
  buildWiring,
  OUTREACH_AGENT,
  PILOT_USER,
  PILOT_WORKSPACE,
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

function grantShareTouchpoint(wiring: Wiring) {
  assert.ok(wiring.roles instanceof InMemoryRoleStore, "buildWiring test harness should use in-memory roles");
  wiring.roles.direct.set(`user:${PILOT_USER}`, [
    { resourceType: "touchpoint", resourceId: null, action: "share", effect: "allow" },
  ]);
}

test("action.decide: a user can veto a pending share proposal through the router", async () => {
  const wiring = await buildWiring();
  try {
    grantShareTouchpoint(wiring);
    const caller = makeCaller(wiring);
    const proposed = await caller.action.propose({
      workspaceId: PILOT_WORKSPACE,
      actor: { type: "user", id: PILOT_USER },
      action: "share",
      resourceType: "touchpoint",
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

test("action.decide: an agent identity is rejected with FORBIDDEN at the review gate", async () => {
  const wiring = await buildWiring();
  try {
    grantShareTouchpoint(wiring);
    const userCaller = makeCaller(wiring);
    const proposed = await userCaller.action.propose({
      workspaceId: PILOT_WORKSPACE,
      actor: { type: "user", id: PILOT_USER },
      action: "share",
      resourceType: "touchpoint",
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

test("action approvals reject authenticated users outside the proposal workspace", async () => {
  const wiring = await buildWiring();
  try {
    grantShareTouchpoint(wiring);
    const memberCaller = makeCaller(wiring);
    const proposed = await memberCaller.action.propose({
      workspaceId: PILOT_WORKSPACE,
      actor: { type: "user", id: PILOT_USER },
      action: "share",
      resourceType: "touchpoint",
      inputs: { note: "test_fixture_private_pending_proposal" },
      skill: "stageMutation",
    });
    assert.equal(proposed.status, "pending_review");

    const nonMemberCaller = makeCaller(wiring, { type: "user", id: NON_MEMBER_USER_ID }, 3);
    await assert.rejects(
      () =>
        nonMemberCaller.action.propose({
          workspaceId: PILOT_WORKSPACE,
          actor: { type: "user", id: NON_MEMBER_USER_ID },
          action: "write",
          resourceType: "touchpoint",
          inputs: { note: "test_fixture_forged_proposal" },
          skill: "stageMutation",
        }),
      (err: unknown) => err instanceof TRPCError && err.code === "FORBIDDEN",
    );
    await assert.rejects(
      () => nonMemberCaller.action.listPending({ workspaceId: PILOT_WORKSPACE, limit: 50, offset: 0 }),
      (err: unknown) => err instanceof TRPCError && err.code === "FORBIDDEN",
    );
    await assert.rejects(
      () => nonMemberCaller.action.listHistory({ workspaceId: PILOT_WORKSPACE, limit: 50, offset: 0 }),
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
          workspaceId: PILOT_WORKSPACE,
          actor: { type: "agent", id: "b0000000-0000-4000-a000-0000000000d1" },
          action: "write",
          resourceType: "touchpoint",
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
      workspaceId: PILOT_WORKSPACE,
      actor: { type: "user", id: PILOT_USER },
      action: "write",
      resourceType: "policy",
      inputs: { note: "test_fixture_unauthorized_policy_write" },
      skill: "stageMutation",
    });
    assert.equal(rejected.status, "rejected");
    assert.equal(
      (await caller.action.listPending({ workspaceId: PILOT_WORKSPACE, limit: 50, offset: 0 })).total,
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
    grantShareTouchpoint(wiring);
    wiring.google.onApproved = async () => {
      throw new Error("test_fixture_provider_unavailable");
    };
    const caller = makeCaller(wiring);
    const proposed = await caller.action.propose({
      workspaceId: PILOT_WORKSPACE,
      actor: { type: "user", id: PILOT_USER },
      action: "share",
      resourceType: "touchpoint",
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

test("action.proposeOutreachDraft binds the server-owned Agent to the authenticated user", async () => {
  const wiring = await buildWiring();
  try {
    const caller = makeCaller(wiring);
    const input = {
      workspaceId: PILOT_WORKSPACE,
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
      (await caller.action.listPending({ workspaceId: PILOT_WORKSPACE, limit: 50, offset: 0 })).total,
      1,
    );

    const ledgerEntry = await wiring.ledger.get(proposed.id);
    assert.equal(ledgerEntry?.actorType, "agent");
    assert.equal(ledgerEntry?.actorId, OUTREACH_AGENT);
    assert.equal(ledgerEntry?.onBehalfOfType, "user");
    assert.equal(ledgerEntry?.onBehalfOfId, PILOT_USER);
    assert.equal(ledgerEntry?.resourceType, "touchpoint");
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
