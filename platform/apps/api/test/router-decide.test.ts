import assert from "node:assert/strict";
import test from "node:test";
import { TRPCError } from "@trpc/server";
import { InMemoryRoleStore, SeededRng, SystemClock, UuidGen, type Actor, type RunCtx } from "@bridge/core";
import { appRouter } from "../src/router.js";
import { buildWiring, PILOT_WORKSPACE, type Wiring } from "../src/wiring.js";

const TEST_USER_ID = "test_fixture_router_decide_user";

function makeRun(seed = 1): RunCtx {
  const clock = new SystemClock();
  const rng = new SeededRng(seed);
  return { clock, rng, ids: new UuidGen(clock, rng) };
}

function makeCaller(wiring: Wiring, identity: Actor = { type: "user", id: TEST_USER_ID }, seed = 1) {
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
  wiring.roles.direct.set(`user:${TEST_USER_ID}`, [
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
      actor: { type: "user", id: TEST_USER_ID },
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
      actor: { type: "user", id: TEST_USER_ID },
      action: "share",
      resourceType: "touchpoint",
      inputs: { note: "test_fixture_router_decide_note" },
      skill: "stageMutation",
    });
    assert.equal(proposed.status, "pending_review");

    const agentCaller = makeCaller(wiring, { type: "agent", id: "test_fixture_router_decide_agent" }, 2);
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
