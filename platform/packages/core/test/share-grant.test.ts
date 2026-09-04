/**
 * Share grants (TASK-064) — the rules a store cannot express.
 *
 * Every one of these is a way a share can be honoured after it should have
 * stopped, which is the only interesting failure mode of a sharing primitive.
 */
import assert from "node:assert/strict";
import test from "node:test";
import {
  InMemoryShareGrantStore,
  ShareGrantNotFoundError,
  atLeast,
  effectiveAccess,
  isGrantUsable,
  type ShareGrantRecord,
} from "../src/index.js";

function grant(overrides: Partial<ShareGrantRecord> = {}): ShareGrantRecord {
  return {
    id: "grant-1",
    organizationId: "org-1",
    targetKind: "view",
    targetId: "view-1",
    granteeUserId: "user-2",
    accessToken: null,
    accessLevel: "view",
    expiresAt: null,
    revokedAt: null,
    createdByUserId: "user-1",
    createdAt: "2026-09-01T00:00:00.000Z",
    ...overrides,
  };
}

test("the access ladder is total — every level includes the ones before it", () => {
  assert.equal(atLeast("coowner", "view"), true);
  assert.equal(atLeast("edit", "view"), true);
  assert.equal(atLeast("view", "edit"), false);
  assert.equal(atLeast("edit", "coowner"), false);
});

test("a revoked or expired grant is dead, and both are decided in one place", () => {
  const now = "2026-09-03T12:00:00.000Z";
  assert.equal(isGrantUsable(grant(), now), true);
  assert.equal(isGrantUsable(grant({ revokedAt: "2026-09-02T00:00:00.000Z" }), now), false);
  assert.equal(isGrantUsable(grant({ expiresAt: "2026-09-03T11:59:59.000Z" }), now), false);
  // The boundary instant is expiry, not grace.
  assert.equal(isGrantUsable(grant({ expiresAt: now }), now), false);
  assert.equal(isGrantUsable(grant({ expiresAt: "2026-09-03T12:00:01.000Z" }), now), true);
});

test("access is the strongest LIVE grant, and a dead one cannot raise it", () => {
  const now = "2026-09-03T12:00:00.000Z";
  const grants = [
    grant({ id: "a", accessLevel: "view" }),
    grant({ id: "b", accessLevel: "coowner", revokedAt: "2026-09-02T00:00:00.000Z" }),
  ];
  assert.equal(
    effectiveAccess(grants, { targetKind: "view", targetId: "view-1" }, { userId: "user-2" }, now),
    "view",
  );
  assert.equal(
    effectiveAccess(
      [...grants, grant({ id: "c", accessLevel: "edit" })],
      { targetKind: "view", targetId: "view-1" },
      { userId: "user-2" },
      now,
    ),
    "edit",
  );
  // A grant on a different target is not access to this one.
  assert.equal(
    effectiveAccess(grants, { targetKind: "view", targetId: "view-2" }, { userId: "user-2" }, now),
    null,
  );
  // Nor is someone else's grant.
  assert.equal(
    effectiveAccess(grants, { targetKind: "view", targetId: "view-1" }, { userId: "user-9" }, now),
    null,
  );
});

test("a link grant is reachable by its token and by nothing else", async () => {
  const store = new InMemoryShareGrantStore();
  const link = grant({ id: "link-1", granteeUserId: null, accessToken: "shr_abc" });
  await store.create(link);
  assert.equal((await store.findByToken("shr_abc"))?.id, "link-1");
  assert.equal(await store.findByToken("shr_wrong"), null);
  assert.equal(
    effectiveAccess([link], { targetKind: "view", targetId: "view-1" }, { userId: "user-2" }, "2026-09-03T12:00:00.000Z"),
    null,
    "a member id must not open a link grant",
  );
});

test("revocation is idempotent and keeps the instant access actually ended", async () => {
  const store = new InMemoryShareGrantStore();
  await store.create(grant());
  const first = await store.revoke("org-1", "user-1", "grant-1", "2026-09-03T10:00:00.000Z");
  const second = await store.revoke("org-1", "user-1", "grant-1", "2026-09-03T18:00:00.000Z");
  assert.equal(second.revokedAt, first.revokedAt);
  await assert.rejects(
    store.revoke("org-2", "user-1", "grant-1", "2026-09-03T18:00:00.000Z"),
    ShareGrantNotFoundError,
    "another Organization must not be able to touch this grant",
  );
});
