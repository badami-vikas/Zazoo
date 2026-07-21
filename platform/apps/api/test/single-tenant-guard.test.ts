/**
 * Interim single-tenant safety fix (All fixes.md Phase 3 item 11a): the platform is
 * single-tenant by construction (PILOT_ORGANIZATION baked into buildWiring()), but
 * several organization-scoped procedures either silently ignored a client-supplied
 * `organizationId` or never validated one. Every such procedure now runs through
 * `assertPilotOrganization` (router.ts), which throws a typed `NonPilotOrganizationError`
 * translated to `TRPCError({code:"FORBIDDEN"})` by the `withPilotOrganizationGuard`
 * middleware — turning a silent cross-tenant leak into a loud, typed 403.
 *
 * These tests prove: (1) a non-pilot organizationId is rejected with FORBIDDEN for
 * `dealpilot.list` (which is where the tracker's audit originally flagged the
 * silent-ignore bug) and for `action.propose` (a second, differently-shaped
 * procedure, to prove the guard isn't special-cased to one call site); (2) the
 * pilot organization's own id still works normally end-to-end.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { TRPCError } from "@trpc/server";
import { SeededRng, SystemClock, UuidGen, type RunCtx } from "@bridge/core";
import { appRouter } from "../src/router.js";
import { buildWiring, PILOT_USER, PILOT_ORGANIZATION, type Wiring } from "../src/wiring.js";

const NON_PILOT_ORGANIZATION = "d0000000-0000-4000-a000-00000000dead"; // test_fixture_ — deliberately not PILOT_ORGANIZATION

function makeRun(): RunCtx {
  const clock = new SystemClock();
  const rng = new SeededRng(1);
  return { clock, rng, ids: new UuidGen(clock, rng) };
}

async function makeCaller(wiring: Wiring) {
  return appRouter.createCaller({
    wiring,
    run: makeRun(),
    identity: { type: "user", id: PILOT_USER },
    authenticated: true, // SEC-1: in-process test caller is a trusted, authenticated actor
    verifying: false,
  });
}

test("dealpilot.list: a non-pilot organizationId is rejected with FORBIDDEN, not silently ignored", async () => {
  const wiring = await buildWiring();
  try {
    const caller = await makeCaller(wiring);
    await assert.rejects(
      () => caller.dealpilot.list({ organizationId: NON_PILOT_ORGANIZATION, limit: 10, offset: 0 }),
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

test("dealpilot.list: the pilot organization's own id still works normally", async () => {
  const wiring = await buildWiring();
  try {
    const caller = await makeCaller(wiring);
    const page = await caller.dealpilot.list({ organizationId: PILOT_ORGANIZATION, limit: 10, offset: 0 });
    assert.equal(page.total, 0); // no candidates seeded — just proves the call succeeds
  } finally {
    await wiring.close();
  }
});

test("dealpilot.list: omitting organizationId entirely still works (no caller sends it today)", async () => {
  const wiring = await buildWiring();
  try {
    const caller = await makeCaller(wiring);
    const page = await caller.dealpilot.list({ limit: 10, offset: 0 });
    assert.equal(page.total, 0);
  } finally {
    await wiring.close();
  }
});

test("action.propose: a non-pilot organizationId is rejected with FORBIDDEN (guard applies beyond dealpilot.list)", async () => {
  const wiring = await buildWiring();
  try {
    const caller = await makeCaller(wiring);
    await assert.rejects(
      () =>
        caller.action.propose({
          organizationId: NON_PILOT_ORGANIZATION,
          actor: { type: "user", id: PILOT_USER },
          action: "write",
          resourceType: "event",
          inputs: { note: "test_fixture_note" },
          skill: "stageMutation",
        }),
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

test("action.propose: the pilot organization's own id still works normally", async () => {
  const wiring = await buildWiring();
  try {
    const caller = await makeCaller(wiring);
    const result = await caller.action.propose({
      organizationId: PILOT_ORGANIZATION,
      actor: { type: "user", id: PILOT_USER },
      action: "write",
      resourceType: "event",
      inputs: { note: "test_fixture_note" },
      skill: "stageMutation",
    });
    assert.ok(result.id, "propose should succeed and return a proposal id for the pilot organization");
  } finally {
    await wiring.close();
  }
});
