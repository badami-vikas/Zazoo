/**
 * The pglite LOCAL plane is a real embedded Postgres bound to the same ports as the
 * in-memory adapters. Proves tokens + private bodies + derived entities persist
 * locally and round-trip — the residency fix (no Supabase in the path).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
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

    // commitEntity itself must be idempotent (retry-the-whole-dual-write safety):
    // calling it again with the SAME id is a silent no-op, not a PK violation.
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
    assert.equal((await plane.graph.listEntities("ws-1", "touchpoint")).length, 1, "commitEntity retry is a no-op");

    // Sync cursor.
    await plane.graph.setSyncCursor("integ-1", "gmail", "cursor-abc");
    assert.equal(await plane.graph.getSyncCursor("integ-1", "gmail"), "cursor-abc");
  } finally {
    await plane.close();
  }
});

test("pglite local plane migrates its recognized legacy external record table", async () => {
  const dataDir = await mkdtemp(join(tmpdir(), "bridge-local-plane-legacy-"));
  let plane: Awaited<ReturnType<typeof createPgliteLocalPlane>> | undefined;
  try {
    const legacyDb = new PGlite(dataDir);
    try {
      await legacyDb.exec(`
        CREATE TABLE external_records (
          workspace_id text NOT NULL,
          source text NOT NULL,
          source_record_id text NOT NULL,
          entity_type text NOT NULL,
          entity_id text NOT NULL,
          created_at text NOT NULL,
          UNIQUE(workspace_id, source, source_record_id)
        );
        INSERT INTO external_records
          (workspace_id, source, source_record_id, entity_type, entity_id, created_at)
        VALUES
          ('test_fixture_workspace', 'test_fixture_source', 'test_fixture_record',
           'test_fixture_event', 'test_fixture_entity', '2026-07-18T00:00:00.000Z');
      `);
    } finally {
      await legacyDb.close();
    }

    plane = await createPgliteLocalPlane({ dataDir });
    assert.equal(
      await plane.graph.hasExternal(
        "test_fixture_workspace",
        "test_fixture_source",
        "test_fixture_record",
      ),
      true,
    );
  } finally {
    await plane?.close();
    await rm(dataDir, { recursive: true, force: true });
  }
});
