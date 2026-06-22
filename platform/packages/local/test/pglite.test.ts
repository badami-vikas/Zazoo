/**
 * The pglite LOCAL plane is a real embedded Postgres bound to the same ports as the
 * in-memory adapters. Proves tokens + private bodies + derived entities persist
 * locally and round-trip — the residency fix (no Supabase in the path).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createPgliteLocalPlane } from "../src/index.js";

test("pglite local plane: tokens, bodies, entities round-trip", async () => {
  const plane = await createPgliteLocalPlane(); // in-memory pglite (no dataDir)
  try {
    // Tokens (local secret store).
    await plane.secrets.putToken({
      integrationId: "integ-1",
      workspaceId: "ws-1",
      provider: "google",
      accessToken: "access",
      refreshToken: "refresh",
      scope: "scope",
      tokenType: "Bearer",
      expiryDate: 1893456000000,
      updatedAt: "2026-06-20T00:00:00.000Z",
    });
    const tok = await plane.secrets.getToken("integ-1");
    assert.equal(tok?.refreshToken, "refresh");
    assert.equal(tok?.expiryDate, 1893456000000);

    // Private body (never leaves local).
    await plane.bodies.put({
      workspaceId: "ws-1",
      source: "gmail",
      sourceRecordId: "thread_1",
      dataScope: "private",
      content: { subject: "hi", messages: [{ bodyText: "secret" }] },
      capturedAt: "2026-06-20T00:00:00.000Z",
    });
    const body = await plane.bodies.get("ws-1", "gmail", "thread_1");
    assert.equal((body?.content as { subject?: string }).subject, "hi");

    // Person match + derived entity + idempotency.
    await plane.graph.upsertPerson({ id: "p1", workspaceId: "ws-1", fullName: "Priya", emails: ["priya@x.example"] });
    const matches = await plane.graph.findPeopleByEmail("ws-1", "PRIYA@x.example");
    assert.equal(matches.length, 1, "email match is case-insensitive");

    await plane.graph.commitEntity({
      id: "tp1",
      workspaceId: "ws-1",
      kind: "touchpoint",
      personId: "p1",
      payload: { touchpointKind: "email" },
      source: "gmail",
      sourceRecordId: "thread_1",
      createdAt: "2026-06-20T00:00:00.000Z",
    });
    assert.equal((await plane.graph.listEntities("ws-1", "touchpoint")).length, 1);

    await plane.graph.recordExternal({ workspaceId: "ws-1", source: "gmail", sourceRecordId: "thread_1", entityType: "touchpoint", entityId: "tp1", createdAt: "2026-06-20T00:00:00.000Z" });
    assert.equal(await plane.graph.hasExternal("ws-1", "gmail", "thread_1"), true);
    await plane.graph.recordExternal({ workspaceId: "ws-1", source: "gmail", sourceRecordId: "thread_1", entityType: "touchpoint", entityId: "tp1", createdAt: "2026-06-20T00:00:00.000Z" });
    assert.equal((await plane.graph.listEntities("ws-1", "touchpoint")).length, 1, "idempotent: no double-commit");

    // Sync cursor.
    await plane.graph.setSyncCursor("integ-1", "gmail", "cursor-abc");
    assert.equal(await plane.graph.getSyncCursor("integ-1", "gmail"), "cursor-abc");
  } finally {
    await plane.close();
  }
});
