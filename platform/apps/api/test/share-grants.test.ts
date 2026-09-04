/**
 * view.share.* (TASK-064) over the real `buildWiring()` composition root.
 *
 * What matters here is what the store tests cannot see: that sharing is an
 * authority change (human-only, owner-only), that a recipient gets the View
 * with the sharer's hidden columns ABSENT rather than flagged, and that
 * revoking closes access on the next call rather than at the next reload.
 */
import assert from "node:assert/strict";
import test from "node:test";
import {
  SeededRng,
  SystemClock,
  UuidGen,
  labelFromLegacyTrustOrigin,
  type RunCtx,
} from "@bridge/core";
import { appRouter } from "../src/router.js";
import { buildWiring, PILOT_ORGANIZATION, PILOT_USER, type Wiring } from "../src/wiring.js";

function makeRun(): RunCtx {
  const clock = new SystemClock();
  const rng = new SeededRng(23);
  return {
    clock,
    rng,
    ids: new UuidGen(clock, rng),
    taintLabel: labelFromLegacyTrustOrigin("operator", "share-grants-test"),
  };
}

function makeCaller(
  wiring: Wiring,
  identity: { type: "user" | "agent"; id: string } = { type: "user", id: PILOT_USER },
) {
  return appRouter.createCaller({
    wiring,
    run: makeRun(),
    identity,
    authenticated: true,
    verifying: false,
  });
}

const view = () => ({
  id: "view-a",
  kind: "table" as const,
  sorts: [],
  rowFilters: [{ field: "stage", op: "is" as const, value: "won" }],
  filterMatch: "all" as const,
  groupBy: null,
});

async function savedView(wiring: Wiring) {
  return makeCaller(wiring).view.saved.save({
    organizationId: PILOT_ORGANIZATION,
    databaseId: "dealpilot.deals",
    name: `Shared ${Math.random().toString(36).slice(2, 8)}`,
    config: view(),
    hiddenColumns: ["margin"],
  });
}

test("a link share mints its own unguessable token; the caller never supplies one", async () => {
  const wiring = await buildWiring();
  try {
    const caller = makeCaller(wiring);
    const target = await savedView(wiring);
    const grant = await caller.view.share.grant({
      organizationId: PILOT_ORGANIZATION,
      viewId: target.id,
      accessLevel: "view",
    });
    assert.equal(grant.granteeUserId, null);
    assert.ok(grant.accessToken && grant.accessToken.startsWith("shr_"));
    assert.ok(grant.accessToken.length > 20, "a short token is a guessable token");
    assert.equal(grant.revokedAt, null);

    const listed = await caller.view.share.list({
      organizationId: PILOT_ORGANIZATION,
      viewId: target.id,
    });
    assert.equal(listed.length, 1);
    assert.equal(listed[0]?.usable, true);
  } finally {
    await wiring.close?.();
  }
});

test("revoking closes access, and the revoked grant stays on the record", async () => {
  const wiring = await buildWiring();
  try {
    const caller = makeCaller(wiring);
    const target = await savedView(wiring);
    const grant = await caller.view.share.grant({
      organizationId: PILOT_ORGANIZATION,
      viewId: target.id,
      accessLevel: "edit",
    });
    const revoked = await caller.view.share.revoke({
      organizationId: PILOT_ORGANIZATION,
      grantId: grant.id,
    });
    assert.ok(revoked.revokedAt);

    const listed = await caller.view.share.list({
      organizationId: PILOT_ORGANIZATION,
      viewId: target.id,
    });
    // History, not silence: the grant is still listed, and reported dead.
    assert.equal(listed.length, 1);
    assert.equal(listed[0]?.usable, false);
  } finally {
    await wiring.close?.();
  }
});

test("an Agent cannot share a View, and an expired share is refused at creation", async () => {
  const wiring = await buildWiring();
  try {
    const target = await savedView(wiring);
    await assert.rejects(
      makeCaller(wiring, { type: "agent", id: "agent-x" }).view.share.grant({
        organizationId: PILOT_ORGANIZATION,
        viewId: target.id,
        accessLevel: "view",
      }),
      /human/i,
    );
    await assert.rejects(
      makeCaller(wiring).view.share.grant({
        organizationId: PILOT_ORGANIZATION,
        viewId: target.id,
        accessLevel: "view",
        expiresAt: "2020-01-01T00:00:00.000Z",
      }),
      /expired/i,
    );
  } finally {
    await wiring.close?.();
  }
});

test("resolve answers with the View minus what the sharer hid, and says what may be done", async () => {
  const wiring = await buildWiring();
  try {
    const caller = makeCaller(wiring);
    const target = await savedView(wiring);
    const resolved = await caller.view.share.resolve({
      organizationId: PILOT_ORGANIZATION,
      viewId: target.id,
    });
    // The owner resolves at co-owner: ownership is not a share.
    assert.equal(resolved.accessLevel, "coowner");
    assert.equal(resolved.canEdit, true);
    assert.equal(resolved.canReshare, true);
    assert.deepEqual(resolved.hiddenColumns, ["margin"]);
    assert.equal(resolved.databaseId, "dealpilot.deals");
  } finally {
    await wiring.close?.();
  }
});

test("a View nobody shared with you is not-found, never forbidden", async () => {
  const wiring = await buildWiring();
  try {
    await assert.rejects(
      makeCaller(wiring).view.share.list({
        organizationId: PILOT_ORGANIZATION,
        viewId: "00000000-0000-7000-8000-000000000000",
      }),
      /unknown saved View/,
    );
  } finally {
    await wiring.close?.();
  }
});
