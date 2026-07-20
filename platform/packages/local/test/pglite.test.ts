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
      organizationId: "ws-1",
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
      organizationId: "ws-1",
      source: "gmail",
      sourceRecordId: "thread_1",
      dataScope: "private",
      content: { subject: "hi", messages: [{ bodyText: "secret" }] },
      capturedAt: "2026-06-20T00:00:00.000Z",
    });
    const body = await plane.bodies.get("ws-1", "gmail", "thread_1");
    assert.equal((body?.content as { subject?: string }).subject, "hi");

    // Person match + derived entity + idempotency.
    await plane.graph.upsertPerson({ id: "p1", organizationId: "ws-1", fullName: "Priya", emails: ["priya@x.example"] });
    const matches = await plane.graph.findPeopleByEmail("ws-1", "PRIYA@x.example");
    assert.equal(matches.length, 1, "email match is case-insensitive");

    await plane.graph.commitEntity({
      id: "tp1",
      organizationId: "ws-1",
      kind: "event",
      personId: "p1",
      payload: { eventKind: "email" },
      source: "gmail",
      sourceRecordId: "thread_1",
      createdAt: "2026-06-20T00:00:00.000Z",
    });
    assert.equal((await plane.graph.listEntities("ws-1", "event")).length, 1);

    await plane.graph.recordExternal({ organizationId: "ws-1", source: "gmail", sourceRecordId: "thread_1", entityType: "event", entityId: "tp1", createdAt: "2026-06-20T00:00:00.000Z" });
    assert.equal(await plane.graph.hasExternal("ws-1", "gmail", "thread_1"), true);
    await plane.graph.recordExternal({ organizationId: "ws-1", source: "gmail", sourceRecordId: "thread_1", entityType: "event", entityId: "tp1", createdAt: "2026-06-20T00:00:00.000Z" });
    assert.equal((await plane.graph.listEntities("ws-1", "event")).length, 1, "idempotent: no double-commit");

    // commitEntity itself must be idempotent (retry-the-whole-dual-write safety):
    // calling it again with the SAME id is a silent no-op, not a PK violation.
    await plane.graph.commitEntity({
      id: "tp1",
      organizationId: "ws-1",
      kind: "event",
      personId: "p1",
      payload: { eventKind: "email" },
      source: "gmail",
      sourceRecordId: "thread_1",
      createdAt: "2026-06-20T00:00:00.000Z",
    });
    assert.equal((await plane.graph.listEntities("ws-1", "event")).length, 1, "commitEntity retry is a no-op");

    // Sync cursor.
    await plane.graph.setSyncCursor("integ-1", "gmail", "cursor-abc");
    assert.equal(await plane.graph.getSyncCursor("integ-1", "gmail"), "cursor-abc");
  } finally {
    await plane.close();
  }
});

test("pglite local plane upgrades legacy tenant columns without losing data", async () => {
  const client = new PGlite();
  let plane: Awaited<ReturnType<typeof createPgliteLocalPlane>> | undefined;
  try {
    await client.exec(`
      CREATE TABLE oauth_tokens (
        integration_id text PRIMARY KEY,
        workspace_id text NOT NULL,
        provider text NOT NULL,
        access_token text NOT NULL,
        refresh_token text,
        scope text NOT NULL DEFAULT '',
        token_type text NOT NULL DEFAULT 'Bearer',
        expiry_date bigint,
        updated_at text NOT NULL
      );
      INSERT INTO oauth_tokens (
        integration_id, workspace_id, provider, access_token, scope, token_type, updated_at
      ) VALUES (
        'legacy-integration',
        'legacy-organization',
        'google',
        'legacy-access-token',
        'gmail.readonly',
        'Bearer',
        '2026-07-19T00:00:00.000Z'
      );
      CREATE TABLE message_bodies (
        workspace_id text NOT NULL,
        source text NOT NULL,
        source_record_id text NOT NULL,
        data_scope text NOT NULL DEFAULT 'private',
        content jsonb NOT NULL,
        captured_at text NOT NULL,
        PRIMARY KEY (workspace_id, source, source_record_id)
      );
      INSERT INTO message_bodies (
        workspace_id, source, source_record_id, content, captured_at
      ) VALUES (
        'legacy-organization',
        'gmail',
        'legacy-thread',
        '{"subject":"preserved"}',
        '2026-07-19T00:00:00.000Z'
      );
    `);

    plane = await createPgliteLocalPlane({ client });
    assert.equal(
      (await plane.secrets.getToken("legacy-integration"))?.organizationId,
      "legacy-organization",
    );
    const body = await plane.bodies.get(
      "legacy-organization",
      "gmail",
      "legacy-thread",
    );
    assert.equal(
      (body?.content as { subject?: string }).subject,
      "preserved",
    );
    const columns = await client.query<{ column_name: string }>(`
      SELECT column_name
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name IN ('oauth_tokens', 'message_bodies')
        AND column_name IN ('workspace_id', 'organization_id')
      ORDER BY table_name, column_name
    `);
    assert.deepEqual(columns.rows, [
      { column_name: "organization_id" },
      { column_name: "organization_id" },
    ]);

    await plane.close();
    plane = await createPgliteLocalPlane({ client });
    assert.equal(
      (await plane.secrets.getToken("legacy-integration"))?.accessToken,
      "legacy-access-token",
    );
  } finally {
    await plane?.close();
    await client.close();
  }
});

test("pglite local plane refuses ambiguous tenant columns", async () => {
  const client = new PGlite();
  try {
    await client.exec(`
      CREATE TABLE oauth_tokens (
        integration_id text PRIMARY KEY,
        workspace_id text NOT NULL,
        organization_id text NOT NULL,
        provider text NOT NULL,
        access_token text NOT NULL,
        scope text NOT NULL DEFAULT '',
        token_type text NOT NULL DEFAULT 'Bearer',
        updated_at text NOT NULL
      )
    `);
    await assert.rejects(
      () => createPgliteLocalPlane({ client }),
      /contains both workspace_id and organization_id/,
    );
    const columns = await client.query<{ column_name: string }>(`
      SELECT column_name
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'oauth_tokens'
        AND column_name IN ('workspace_id', 'organization_id')
      ORDER BY column_name
    `);
    assert.deepEqual(columns.rows, [
      { column_name: "organization_id" },
      { column_name: "workspace_id" },
    ]);
  } finally {
    await client.close();
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
          organization_id text NOT NULL,
          source text NOT NULL,
          source_record_id text NOT NULL,
          entity_type text NOT NULL,
          entity_id text NOT NULL,
          created_at text NOT NULL,
          UNIQUE(organization_id, source, source_record_id)
        );
        INSERT INTO external_records
          (organization_id, source, source_record_id, entity_type, entity_id, created_at)
        VALUES
          ('test_fixture_organization', 'test_fixture_source', 'test_fixture_record',
           'test_fixture_event', 'test_fixture_entity', '2026-07-18T00:00:00.000Z');
      `);
    } finally {
      await legacyDb.close();
    }

    plane = await createPgliteLocalPlane({ dataDir });
    assert.equal(
      await plane.graph.hasExternal(
        "test_fixture_organization",
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

test("pglite local plane preserves an unsupported legacy external record table", async () => {
  const dataDir = await mkdtemp(join(tmpdir(), "bridge-local-plane-unsupported-"));
  try {
    const seed = new PGlite(dataDir);
    try {
      await seed.exec(`
        CREATE TABLE external_records (
          organization_id text NOT NULL,
          source text NOT NULL,
          source_record_id text NOT NULL,
          entity_type text NOT NULL,
          entity_id text NOT NULL,
          created_at text NOT NULL,
          unrecognized_payload text NOT NULL,
          UNIQUE(organization_id, source, source_record_id)
        );
        INSERT INTO external_records
          (organization_id, source, source_record_id, entity_type, entity_id, created_at, unrecognized_payload)
        VALUES
          ('test_fixture_organization', 'test_fixture_source', 'test_fixture_record',
           'test_fixture_event', 'test_fixture_entity', '2026-07-18T00:00:00.000Z',
           'must remain');
      `);
    } finally {
      await seed.close();
    }

    await assert.rejects(
      () => createPgliteLocalPlane({ dataDir }),
      /external_records exists with an unsupported schema/,
    );

    const preserved = new PGlite(dataDir);
    try {
      const result = await preserved.query<{ unrecognized_payload: string }>(
        "SELECT unrecognized_payload FROM external_records",
      );
      assert.equal(result.rows[0]?.unrecognized_payload, "must remain");
    } finally {
      await preserved.close();
    }
  } finally {
    await rm(dataDir, { recursive: true, force: true });
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

test("pglite local state survives close/reopen and isolates organizations", async () => {
  const root = await mkdtemp(join(tmpdir(), "bridge-local-state-"));
  const dataDir = join(root, "pglite");
  try {
    const first = await createPgliteLocalPlane({ dataDir });
    await first.state.update("organization-a", "module-state", { count: 0 }, (current) => {
      const state = current as { count: number };
      return { state: { count: state.count + 1 }, result: undefined };
    });
    await first.close();

    const reopened = await createPgliteLocalPlane({ dataDir });
    assert.deepEqual(await reopened.state.read("organization-a", "module-state"), { count: 1 });
    assert.equal(await reopened.state.read("organization-b", "module-state"), null);
    await reopened.state.update("organization-b", "module-state", { count: 0 }, () => ({
      state: { count: 7 },
      result: undefined,
    }));
    assert.deepEqual(await reopened.state.read("organization-a", "module-state"), { count: 1 });
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
        organization_id text NOT NULL,
        source text NOT NULL,
        source_record_id text NOT NULL,
        entity_type text NOT NULL,
        entity_id text NOT NULL,
        created_at text NOT NULL,
        PRIMARY KEY (organization_id, source, source_record_id)
      );
      INSERT INTO external_records
        (organization_id, source, source_record_id, entity_type, entity_id, created_at)
      VALUES
        ('organization-a', 'gmail', 'provider-message-a', 'event', 'provider-entity-a', '2026-07-18T00:00:00.000Z');
      ALTER TABLE external_records RENAME TO local_external_records_legacy;
    `);
    const plane = await createPgliteLocalPlane({ client });
    try {
      assert.equal(
        await plane.graph.hasExternal(
          "organization-a",
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
        organizationId: "organization-a",
        source: "calendar",
        sourceRecordId: "provider-event-a",
        entityType: "event",
        entityId: "provider-entity-b",
        createdAt: "2026-07-18T00:00:00.000Z",
      });
      assert.equal(
        await plane.graph.hasExternal(
          "organization-a",
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
        plane.state.update("organization-a", "counter", { count: 0 }, (current) => {
          const state = current as { count: number };
          return { state: { count: state.count + 1 }, result: state.count + 1 };
        }),
      ),
    );
    assert.deepEqual(await plane.state.read("organization-a", "counter"), { count: 100 });
    await assert.rejects(
      plane.state.update("organization-a", "counter", { count: 0 }, () => {
        throw new Error("test reducer failure");
      }),
      /test reducer failure/,
    );
    assert.deepEqual(await plane.state.read("organization-a", "counter"), { count: 100 });
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
