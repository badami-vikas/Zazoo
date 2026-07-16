import assert from "node:assert/strict";
import test from "node:test";
import { TRPCError } from "@trpc/server";
import { InMemoryRoleStore, SeededRng, SystemClock, UuidGen, type Actor, type RunCtx } from "@bridge/core";
import { appRouter } from "../src/router.js";
import { buildWiring, PILOT_USER, PILOT_WORKSPACE, type Wiring } from "../src/wiring.js";

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

    const resolved = await caller.action.decide({ proposalId: proposed.id, decision: "veto" });
    assert.equal(resolved.status, "rejected");
    assert.notEqual(resolved.status, "pending_review");
    assert.deepEqual(resolved.effects, { materialized: false, sent: false });
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
      () => nonMemberCaller.action.listPending({ workspaceId: PILOT_WORKSPACE, limit: 50, offset: 0 }),
      (err: unknown) => err instanceof TRPCError && err.code === "FORBIDDEN",
    );
    await assert.rejects(
      () => nonMemberCaller.action.decide({ proposalId: proposed.id, decision: "approve" }),
      (err: unknown) => err instanceof TRPCError && err.code === "FORBIDDEN",
    );
  } finally {
    await wiring.close();
  }
});
