import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";

const here = dirname(fileURLToPath(import.meta.url));

function migrationSql(): string {
  for (const relative of [
    "../migrations/0015_task008_relation_contract.sql",
    "../../migrations/0015_task008_relation_contract.sql",
  ]) {
    const candidate = resolve(here, relative);
    if (existsSync(candidate)) return readFileSync(candidate, "utf8");
  }
  throw new Error("0015 migration not found");
}

async function legacyDatabase(): Promise<PGlite> {
  const db = new PGlite();
  await db.exec(`
    CREATE ROLE anon;
    CREATE ROLE authenticated;
    CREATE ROLE migration_owner;
    CREATE TABLE "users" (
      "id" uuid PRIMARY KEY,
      "email" text NOT NULL
    );
    CREATE TABLE "node_types" (
      "type" text PRIMARY KEY,
      "plane" text NOT NULL
    );
    CREATE TABLE "ledger" (
      "id" uuid PRIMARY KEY,
      "workspace_id" uuid NOT NULL,
      "inputs" jsonb,
      "user_decision" text,
      "ref_ledger_id" uuid,
      "created_at" timestamp with time zone DEFAULT now() NOT NULL
    );
    CREATE TABLE "edges" (
      "id" uuid PRIMARY KEY,
      "workspace_id" uuid NOT NULL,
      "src_type" text NOT NULL,
      "src_id" uuid NOT NULL,
      "dst_type" text NOT NULL,
      "dst_id" uuid NOT NULL,
      "edge_type" text NOT NULL,
      "properties" jsonb DEFAULT '{}'::jsonb NOT NULL,
      "created_at" timestamp with time zone DEFAULT now() NOT NULL
    );
    CREATE INDEX "edges_src_idx" ON "edges" ("workspace_id", "src_type", "src_id");
    CREATE INDEX "edges_dst_idx" ON "edges" ("workspace_id", "dst_type", "dst_id");
    CREATE SCHEMA app_private;
    CREATE FUNCTION app_private.current_workspace_id()
    RETURNS uuid LANGUAGE sql STABLE
    AS $$ SELECT NULLIF(current_setting('app.workspace_id', true), '')::uuid $$;
    CREATE FUNCTION app_private.current_user_id()
    RETURNS uuid LANGUAGE sql STABLE
    AS $$ SELECT NULLIF(current_setting('app.user_id', true), '')::uuid $$;
    CREATE FUNCTION app_private.same_workspace(row_workspace_id uuid)
    RETURNS boolean LANGUAGE sql STABLE
    AS $$ SELECT row_workspace_id = app_private.current_workspace_id() $$;
    ALTER TABLE "edges" ENABLE ROW LEVEL SECURITY;
    CREATE POLICY "edges_tenant_select" ON "edges" FOR SELECT
      USING (app_private.same_workspace("workspace_id"));
    CREATE POLICY "edges_tenant_insert" ON "edges" FOR INSERT
      WITH CHECK (app_private.same_workspace("workspace_id"));
    CREATE POLICY "edges_tenant_update" ON "edges" FOR UPDATE
      USING (app_private.same_workspace("workspace_id"))
      WITH CHECK (app_private.same_workspace("workspace_id"));
    CREATE POLICY "edges_tenant_delete" ON "edges" FOR DELETE
      USING (app_private.same_workspace("workspace_id"));
    GRANT SELECT, INSERT, UPDATE, DELETE ON "edges" TO anon, authenticated;
    GRANT SELECT, INSERT, UPDATE, DELETE ON "ledger" TO anon, authenticated;
  `);
  return db;
}

test("migration 0015 preserves legacy edges and installs the owner-scoped Relation contract", async () => {
  const db = await legacyDatabase();
  try {
    const workspaceId = "10000000-0000-4000-8000-000000000001";
    const ownerId = "20000000-0000-4000-8000-000000000001";
    const secondOwnerId = "20000000-0000-4000-8000-000000000002";
    const eventId = "30000000-0000-4000-8000-000000000001";
    const personId = "40000000-0000-4000-8000-000000000001";
    await db.query(
      `INSERT INTO "users" ("id", "email") VALUES
        ($1, 'test_fixture_migration_relation_owner@example.com'),
        ($2, 'test_fixture_migration_relation_second_owner@example.com')`,
      [ownerId, secondOwnerId],
    );
    await db.exec(`
      INSERT INTO "node_types" ("type", "plane") VALUES
        ('person', 'mirror'),
        ('community', 'mirror'),
        ('signal', 'operational'),
        ('initiative', 'operational');
    `);
    await db.query(
      `INSERT INTO "edges" (
        "id", "workspace_id", "src_type", "src_id", "dst_type", "dst_id", "edge_type", "properties", "created_at"
      ) VALUES (
        '50000000-0000-4000-8000-000000000001', $1, 'event', $2, 'person', $3, 'participant', '{"legacy":true}',
        '2020-01-02T03:04:05.000Z'
      )`,
      [workspaceId, eventId, personId],
    );
    await db.exec(`
      INSERT INTO "ledger" (
        "id", "workspace_id", "inputs", "user_decision", "created_at"
      ) VALUES
        (
          '6a000000-0000-4000-8000-0000000000a1',
          '${workspaceId}',
          '{"kind":"relationship_signal_evidence"}',
          NULL,
          '2020-01-02T03:04:05.000Z'
        ),
        (
          '60000000-0000-4000-8000-000000000002',
          '${workspaceId}',
          '{"proposal_id":"6a000000-0000-4000-8000-0000000000a1"}',
          'approve',
          '2020-01-02T03:04:06.000Z'
        ),
        (
          '60000000-0000-4000-8000-000000000003',
          '${workspaceId}',
          '{"proposalId":"6A000000-0000-4000-8000-0000000000A1"}',
          'approve',
          '2020-01-02T03:04:07.000Z'
        );
      ALTER TABLE "edges" FORCE ROW LEVEL SECURITY;
      ALTER TABLE "ledger" ENABLE ROW LEVEL SECURITY;
      ALTER TABLE "ledger" FORCE ROW LEVEL SECURITY;
      ALTER TABLE "edges" OWNER TO migration_owner;
      ALTER TABLE "ledger" OWNER TO migration_owner;
      ALTER TABLE "node_types" OWNER TO migration_owner;
      GRANT REFERENCES ON TABLE "users" TO migration_owner;
      GRANT USAGE, CREATE ON SCHEMA public TO migration_owner;
      GRANT USAGE ON SCHEMA app_private TO migration_owner;
      SET ROLE migration_owner;
      ALTER DEFAULT PRIVILEGES GRANT ALL ON SEQUENCES TO anon, authenticated;
    `);

    try {
      await db.exec(migrationSql());
    } finally {
      await db.exec("RESET ROLE");
    }

    const columns = await db.query<{ column_name: string }>(
      `SELECT "column_name"
       FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = 'edges'`,
    );
    const names = new Set(columns.rows.map((row) => row.column_name));
    for (const expected of [
      "evidence_refs",
      "confidence",
      "observed_at",
      "valid_from",
      "valid_to",
      "user_confirmed",
      "visibility",
      "source",
      "source_module",
      "owner_user_id",
      "decision_ledger_id",
      "decision_sequence",
      "decision_at",
    ]) {
      assert.ok(names.has(expected), `Relation column ${expected} must exist`);
    }

    const legacy = await db.query<{
      evidence_refs: unknown[];
      confidence: string;
      visibility: string;
      source: string;
      source_module: string;
      owner_user_id: string | null;
      decision_ledger_id: string | null;
      decision_sequence: string | null;
      decision_at: string | null;
      observed_matches_created: boolean;
    }>(
      `SELECT "evidence_refs", "confidence", "visibility", "source", "source_module", "owner_user_id",
              "decision_ledger_id", "decision_sequence", "decision_at",
              "observed_at" = "created_at" AS "observed_matches_created"
       FROM "edges"
       WHERE "id" = '50000000-0000-4000-8000-000000000001'`,
    );
    assert.deepEqual(legacy.rows, [
      {
        evidence_refs: [],
        confidence: "1.0000",
        visibility: "workspace",
        source: "user",
        source_module: "legacy",
        owner_user_id: null,
        decision_ledger_id: null,
        decision_sequence: null,
        decision_at: null,
        observed_matches_created: true,
      },
    ]);
    const migrationPosture = await db.query<{
      edges_force_rls: boolean;
      ledger_force_rls: boolean;
      ledger_append_sequence: string | null;
      legacy_decision_ref: string;
      duplicate_legacy_decision_ref: string | null;
    }>(
      `SELECT
              (SELECT relforcerowsecurity FROM pg_class
               WHERE oid = 'public.edges'::regclass) AS edges_force_rls,
              (SELECT relforcerowsecurity FROM pg_class
               WHERE oid = 'public.ledger'::regclass) AS ledger_force_rls,
              (SELECT "append_sequence"::text FROM "ledger"
               WHERE "id" = '6a000000-0000-4000-8000-0000000000a1') AS ledger_append_sequence,
              (SELECT "ref_ledger_id"::text FROM "ledger"
               WHERE "id" = '60000000-0000-4000-8000-000000000002') AS legacy_decision_ref,
              (SELECT "ref_ledger_id"::text FROM "ledger"
               WHERE "id" = '60000000-0000-4000-8000-000000000003') AS duplicate_legacy_decision_ref
      `,
    );
    assert.deepEqual(migrationPosture.rows, [
      {
        edges_force_rls: true,
        ledger_force_rls: true,
        ledger_append_sequence: null,
        legacy_decision_ref: "6a000000-0000-4000-8000-0000000000a1",
        duplicate_legacy_decision_ref: null,
      },
    ]);

    const owners = await db.query<{ type: string; owning_module: string | null; plane: string }>(
      `SELECT "type", "owning_module", "plane"
       FROM "node_types"
       WHERE "type" IN ('person', 'community', 'signal', 'event', 'initiative')
       ORDER BY "type"`,
    );
    assert.deepEqual(owners.rows, [
      { type: "community", owning_module: "relationship", plane: "mirror" },
      { type: "event", owning_module: "relationship", plane: "operational" },
      { type: "initiative", owning_module: null, plane: "operational" },
      { type: "person", owning_module: "relationship", plane: "mirror" },
      { type: "signal", owning_module: "relationship", plane: "operational" },
    ]);

    const insertRelation = (relationOwnerId: string) =>
      db.query(
        `INSERT INTO "edges" (
          "id", "workspace_id", "src_type", "src_id", "dst_type", "dst_id", "edge_type",
          "properties", "evidence_refs", "confidence", "observed_at", "valid_from", "valid_to",
          "user_confirmed", "visibility", "source", "source_module", "owner_user_id",
          "decision_ledger_id", "decision_sequence", "decision_at"
        ) VALUES (
          gen_random_uuid(), $1, 'event', $2, 'person', $3, 'participant',
          '{"role":"attendee"}', $4::jsonb, 0.9, now(), now(), now() + interval '1 day',
          true, 'private', 'calendar', 'relationship', $5, gen_random_uuid(), 1, now()
        )`,
        [
          workspaceId,
          eventId,
          personId,
          JSON.stringify([{ entityType: "event", entityId: eventId, source: "calendar" }]),
          relationOwnerId,
        ],
      );
    await insertRelation(ownerId);
    await assert.rejects(() => insertRelation(ownerId), /duplicate key|unique constraint/i);
    await assert.doesNotReject(() => insertRelation(secondOwnerId));
    const privileges = await db.query<{
      role_name: string;
      table_name: string;
      can_select: boolean;
      can_insert: boolean;
      can_update: boolean;
      can_delete: boolean;
    }>(
      `SELECT role_name, table_name,
              has_table_privilege(role_name, 'public.' || table_name, 'SELECT') AS can_select,
              has_table_privilege(role_name, 'public.' || table_name, 'INSERT') AS can_insert,
              has_table_privilege(role_name, 'public.' || table_name, 'UPDATE') AS can_update,
              has_table_privilege(role_name, 'public.' || table_name, 'DELETE') AS can_delete
       FROM unnest(ARRAY['anon', 'authenticated']) AS roles(role_name)
       CROSS JOIN unnest(ARRAY['edges', 'ledger']) AS tables(table_name)
       ORDER BY role_name, table_name`,
    );
    assert.deepEqual(privileges.rows, [
      {
        role_name: "anon",
        table_name: "edges",
        can_select: false,
        can_insert: false,
        can_update: false,
        can_delete: false,
      },
      {
        role_name: "anon",
        table_name: "ledger",
        can_select: false,
        can_insert: false,
        can_update: false,
        can_delete: false,
      },
      {
        role_name: "authenticated",
        table_name: "edges",
        can_select: false,
        can_insert: false,
        can_update: false,
        can_delete: false,
      },
      {
        role_name: "authenticated",
        table_name: "ledger",
        can_select: false,
        can_insert: false,
        can_update: false,
        can_delete: false,
      },
    ]);
    const sequencePrivileges = await db.query<{
      role_name: string;
      can_usage: boolean;
      can_select: boolean;
      can_update: boolean;
    }>(
      `SELECT role_name,
              has_sequence_privilege(role_name, 'public.ledger_append_sequence_seq', 'USAGE') AS can_usage,
              has_sequence_privilege(role_name, 'public.ledger_append_sequence_seq', 'SELECT') AS can_select,
              has_sequence_privilege(role_name, 'public.ledger_append_sequence_seq', 'UPDATE') AS can_update
       FROM unnest(ARRAY['anon', 'authenticated']) AS roles(role_name)
       ORDER BY role_name`,
    );
    assert.deepEqual(sequencePrivileges.rows, [
      { role_name: "anon", can_usage: false, can_select: false, can_update: false },
      { role_name: "authenticated", can_usage: false, can_select: false, can_update: false },
    ]);
    const nextAppend = await db.query<{ append_sequence: string }>(
      `INSERT INTO "ledger" ("id", "workspace_id")
       VALUES ('60000000-0000-4000-8000-000000000004', $1)
       RETURNING "append_sequence"::text`,
      [workspaceId],
    );
    const legacyWatermark =
      BigInt(Date.parse("2020-01-02T03:04:07.000Z")) * 1024n + 1023n;
    assert.ok(BigInt(nextAppend.rows[0]!.append_sequence) > legacyWatermark);

    await assert.rejects(
      () =>
        db.query(
          `INSERT INTO "edges" (
            "id", "workspace_id", "src_type", "src_id", "dst_type", "dst_id", "edge_type",
            "confidence", "valid_from", "valid_to", "source_module"
          ) VALUES (
            gen_random_uuid(), $1, 'event', gen_random_uuid(), 'person', gen_random_uuid(),
            'invalid_confidence', 1.1, now(), now() - interval '1 day', 'relationship'
          )`,
          [workspaceId],
        ),
      /edges_confidence_check|check constraint/i,
    );
    await assert.rejects(
      () =>
        db.query(
          `INSERT INTO "edges" (
            "id", "workspace_id", "src_type", "src_id", "dst_type", "dst_id", "edge_type",
            "valid_from", "valid_to", "source_module"
          ) VALUES (
            gen_random_uuid(), $1, 'event', gen_random_uuid(), 'person', gen_random_uuid(),
            'invalid_validity', now(), now() - interval '1 day', 'relationship'
          )`,
          [workspaceId],
        ),
      /edges_valid_range_check|check constraint/i,
    );
    await assert.rejects(
      () =>
        db.query(
          `INSERT INTO "edges" (
            "id", "workspace_id", "src_type", "src_id", "dst_type", "dst_id", "edge_type",
            "source_module", "decision_ledger_id"
          ) VALUES (
            gen_random_uuid(), $1, 'event', gen_random_uuid(), 'person', gen_random_uuid(),
            'invalid_decision_provenance', 'relationship', gen_random_uuid()
          )`,
          [workspaceId],
        ),
      /edges_decision_provenance_check|check constraint/i,
    );
  } finally {
    await db.close();
  }
});
