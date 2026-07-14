/**
 * SEC-6 — workspace membership checks. A workspace-scoped procedure must refuse a
 * caller who is not a MEMBER of the workspace, not merely check the pilot-workspace
 * id. Exercises the membership surface (workspace.listMembers / workspace.inviteMember):
 * the seeded pilot member is allowed; a non-member is rejected with FORBIDDEN.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { TRPCError } from "@trpc/server";
import { SeededRng, SystemClock, UuidGen, type Actor, type RunCtx } from "@bridge/core";
import { appRouter } from "../src/router.js";
import { buildWiring, PILOT_USER, PILOT_WORKSPACE, type Wiring } from "../src/wiring.js";

function makeRun(seed = 1): RunCtx {
  const clock = new SystemClock();
  const rng = new SeededRng(seed);
  return { clock, rng, ids: new UuidGen(clock, rng) };
}

function makeCaller(wiring: Wiring, identity: Actor) {
  return appRouter.createCaller({
    wiring,
    run: makeRun(),
    identity,
    authenticated: true,
    verifying: false,
  });
}

// A well-formed but unseeded user UUID: real auth identities are always UUIDs, so
// isMember() finds no membership row and returns false (rather than a malformed-id error).
const NON_MEMBER: Actor = { type: "user", id: "11111111-1111-4111-8111-111111111111" };

test("workspace.listMembers: the seeded pilot member is allowed and sees itself in the list", async () => {
  const wiring = await buildWiring();
  try {
    const caller = makeCaller(wiring, { type: "user", id: PILOT_USER });
    const members = await caller.workspace.listMembers({ workspaceId: PILOT_WORKSPACE });
    assert.ok(
      members.some((m) => m.userId === PILOT_USER),
      "bootstrapPilotIdentities should seed the pilot user as a member of the pilot workspace",
    );
  } finally {
    await wiring.close();
  }
});

test("workspace.listMembers: a non-member is refused with FORBIDDEN", async () => {
  const wiring = await buildWiring();
  try {
    const caller = makeCaller(wiring, NON_MEMBER);
    await assert.rejects(
      () => caller.workspace.listMembers({ workspaceId: PILOT_WORKSPACE }),
      (err: unknown) => err instanceof TRPCError && err.code === "FORBIDDEN",
    );
  } finally {
    await wiring.close();
  }
});

test("workspace.inviteMember: a non-member cannot invite into a workspace they don't belong to", async () => {
  const wiring = await buildWiring();
  try {
    const caller = makeCaller(wiring, NON_MEMBER);
    await assert.rejects(
      () =>
        caller.workspace.inviteMember({
          workspaceId: PILOT_WORKSPACE,
          email: "test_fixture_intruder@example.com",
        }),
      (err: unknown) => err instanceof TRPCError && err.code === "FORBIDDEN",
    );
  } finally {
    await wiring.close();
  }
});
