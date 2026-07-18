/**
 * The pglite LOCAL plane is a real embedded Postgres bound to the same ports as the
 * in-memory adapters. Proves tokens + private bodies + derived entities persist
 * locally and round-trip — the residency fix (no Supabase in the path).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { createPgliteLocalPlane } from "../src/index.js";
import { closePgliteResources } from "../src/stores/pglite.js";

test("pglite local plane: tokens, bodies, entities round-trip", async () => {
  const plane = await createPgliteLocalPlane(); // in-memory pglite (no dataDir)
  try {
    // Tokens (local secret store).
    const initialToken = {
      integrationId: "integ-1",
      workspaceId: "ws-1",
      provider: "google",
      accessToken: "access",
      refreshToken: "refresh",
      scope: "scope",
      tokenType: "Bearer",
      expiryDate: 1893456000000,
      updatedAt: "2026-06-20T00:00:00.000Z",
    };
    await plane.secrets.putToken(initialToken);
    const tok = await plane.secrets.getToken("integ-1");
    assert.equal(tok?.refreshToken, "refresh");
    assert.equal(tok?.expiryDate, 1893456000000);
    const replacementToken = {
      ...initialToken,
      accessToken: "replacement-access",
      updatedAt: "2026-06-21T00:00:00.000Z",
    };
    assert.equal(
      await plane.secrets.compareAndSwapToken(
        "integ-1",
        { ...initialToken, accessToken: "stale-access" },
        replacementToken,
      ),
      false,
    );
    assert.equal(
      await plane.secrets.compareAndSwapToken(
        "integ-1",
        initialToken,
        replacementToken,
      ),
      true,
    );
    assert.deepEqual(
      await plane.secrets.getToken("integ-1"),
      replacementToken,
    );
    let authorizationChecks = 0;
    let markPostWriteReached = (): void => {};
    let releasePostWrite = (): void => {};
    const postWriteReached = new Promise<void>((resolve) => {
      markPostWriteReached = resolve;
    });
    const continuePostWrite = new Promise<void>((resolve) => {
      releasePostWrite = resolve;
    });
    const deniedFinalization = plane.secrets.finalizeToken(
      {
        ...replacementToken,
        accessToken: "provisional-access",
        updatedAt: "2026-06-22T00:00:00.000Z",
      },
      async () => {
        authorizationChecks += 1;
        if (authorizationChecks === 2) {
          markPostWriteReached();
          await continuePostWrite;
          return false;
        }
        return true;
      },
    );
    await postWriteReached;
    let readSettled = false;
    const blockedRead = plane.secrets.getToken("integ-1").then((token) => {
      readSettled = true;
      return token;
    });
    await new Promise((resolve) => setTimeout(resolve, 25));
    assert.equal(
      readSettled,
      false,
      "readers must wait until provisional finalization rolls back",
    );
    releasePostWrite();
    assert.equal(await deniedFinalization, false);
    assert.deepEqual(await blockedRead, replacementToken);

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

test("pglite ownership is retained when client close fails", async () => {
  let releases = 0;
  await assert.rejects(
    closePgliteResources(
      async () => {
        throw new Error("test_fixture_close_failed");
      },
      async () => {
        releases += 1;
      },
    ),
    /test_fixture_close_failed/,
  );
  assert.equal(releases, 0);
});

test("pglite local state survives close/reopen and isolates workspaces", async () => {
  const root = await mkdtemp(join(tmpdir(), "bridge-local-state-"));
  const dataDir = join(root, "pglite");
  try {
    const first = await createPgliteLocalPlane({ dataDir });
    await first.state.update("workspace-a", "module-state", { count: 0 }, (current) => {
      const state = current as { count: number };
      return { state: { count: state.count + 1 }, result: undefined };
    });
    await first.close();

    const reopened = await createPgliteLocalPlane({ dataDir });
    assert.deepEqual(await reopened.state.read("workspace-a", "module-state"), { count: 1 });
    assert.equal(await reopened.state.read("workspace-b", "module-state"), null);
    await reopened.state.update("workspace-b", "module-state", { count: 0 }, () => ({
      state: { count: 7 },
      result: undefined,
    }));
    assert.deepEqual(await reopened.state.read("workspace-a", "module-state"), { count: 1 });
    await reopened.close();
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("pglite local plane imports and removes the pre-Drizzle external-record backup", async () => {
  const client = new PGlite();
  try {
    await client.exec(`
      CREATE TABLE external_records (
        workspace_id text NOT NULL,
        source text NOT NULL,
        source_record_id text NOT NULL,
        entity_type text NOT NULL,
        entity_id text NOT NULL,
        created_at text NOT NULL,
        PRIMARY KEY (workspace_id, source, source_record_id)
      );
      INSERT INTO external_records
        (workspace_id, source, source_record_id, entity_type, entity_id, created_at)
      VALUES
        ('workspace-a', 'gmail', 'provider-message-a', 'touchpoint', 'provider-entity-a', '2026-07-18T00:00:00.000Z');
      ALTER TABLE external_records RENAME TO local_external_records_legacy;
    `);
    const plane = await createPgliteLocalPlane({ client });
    try {
      assert.equal(
        await plane.graph.hasExternal(
          "workspace-a",
          "gmail",
          "provider-message-a",
        ),
        true,
      );
      const legacy = await client.query<{ name: string | null }>(
        `SELECT to_regclass('public.local_external_records_legacy')::text AS name`,
      );
      assert.equal(legacy.rows[0]?.name, null);
      await plane.graph.recordExternal({
        workspaceId: "workspace-a",
        source: "calendar",
        sourceRecordId: "provider-event-a",
        entityType: "event",
        entityId: "provider-entity-b",
        createdAt: "2026-07-18T00:00:00.000Z",
      });
      assert.equal(
        await plane.graph.hasExternal(
          "workspace-a",
          "calendar",
          "provider-event-a",
        ),
        true,
      );
    } finally {
      await plane.close();
    }
  } finally {
    await client.close();
  }
});

test("pglite local state serializes concurrent updates and rolls back reducer failures", async () => {
  const plane = await createPgliteLocalPlane();
  try {
    await Promise.all(
      Array.from({ length: 100 }, () =>
        plane.state.update("workspace-a", "counter", { count: 0 }, (current) => {
          const state = current as { count: number };
          return { state: { count: state.count + 1 }, result: state.count + 1 };
        }),
      ),
    );
    assert.deepEqual(await plane.state.read("workspace-a", "counter"), { count: 100 });
    await assert.rejects(
      plane.state.update("workspace-a", "counter", { count: 0 }, () => {
        throw new Error("test reducer failure");
      }),
      /test reducer failure/,
    );
    assert.deepEqual(await plane.state.read("workspace-a", "counter"), { count: 100 });
  } finally {
    await plane.close();
  }
});

test("pglite local plane refuses concurrent ownership of one directory", async () => {
  const root = await mkdtemp(join(tmpdir(), "bridge-local-contention-"));
  const dataDir = join(root, "pglite");
  let first: Awaited<ReturnType<typeof createPgliteLocalPlane>> | undefined;
  try {
    first = await createPgliteLocalPlane({ dataDir });
    await assert.rejects(
      () => createPgliteLocalPlane({ dataDir }),
      /another process owns it/,
    );
    await assert.rejects(
      () => createPgliteLocalPlane({ dataDir: `${dataDir}/` }),
      /another process owns it/,
    );
    const alias = join(root, "pglite-alias");
    await symlink(dataDir, alias, process.platform === "win32" ? "junction" : "dir");
    await assert.rejects(
      () => createPgliteLocalPlane({ dataDir: alias }),
      /another process owns it/,
    );
    await first.close();
    first = undefined;

    const reopened = await createPgliteLocalPlane({ dataDir });
    await reopened.close();
  } finally {
    await first?.close();
    await rm(root, { recursive: true, force: true });
  }
});
