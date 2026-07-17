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
    CREATE SCHEMA "drizzle";
    CREATE TABLE "drizzle"."__drizzle_migrations" (
      "id" serial PRIMARY KEY,
      "hash" text NOT NULL,
      "created_at" bigint
    );
    CREATE TABLE "users" (
      "id" uuid PRIMARY KEY,
      "email" text NOT NULL
    );
    CREATE TABLE "workspaces" (
      "id" uuid PRIMARY KEY,
      "name" text NOT NULL
    );
    CREATE TABLE "node_types" (
      "type" text PRIMARY KEY,
      "plane" text NOT NULL
    );
    CREATE TABLE "ledger" (
      "id" uuid PRIMARY KEY,
      "workspace_id" uuid NOT NULL,
      "actor_type" text DEFAULT 'user' NOT NULL,
      "actor_id" uuid DEFAULT '20000000-0000-4000-8000-000000000001' NOT NULL,
      "on_behalf_of_type" text,
      "on_behalf_of_id" uuid,
      "delegation_id" uuid,
      "action" text DEFAULT 'write' NOT NULL,
      "resource_type" text DEFAULT 'relation' NOT NULL,
      "resource_id" uuid DEFAULT '30000000-0000-4000-8000-000000000001',
      "inputs" jsonb,
      "user_decision" text,
      "diff" jsonb,
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
    const secondWorkspaceId = "10000000-0000-4000-8000-000000000002";
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
    await db.query(
      `INSERT INTO "workspaces" ("id", "name")
       VALUES
         ($1, 'test_fixture_migration_relation_workspace'),
         ($2, 'test_fixture_migration_cross_workspace')`,
      [workspaceId, secondWorkspaceId],
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
        '2020-01-02T03:04:05.123789Z'
      )`,
      [workspaceId, eventId, personId],
    );
    await db.exec(`
      INSERT INTO "ledger" (
        "id", "workspace_id", "resource_type", "inputs", "user_decision", "created_at"
      ) VALUES
        (
          '6a000000-0000-4000-8000-0000000000a1',
          '${workspaceId}',
          'relation',
          '{"kind":"relationship_signal_evidence"}',
          NULL,
          '2026-07-05T00:00:00.000Z'
        ),
        (
          '60000000-0000-4000-8000-000000000002',
          '${workspaceId}',
          'relation',
          '{"proposal_id":"6a000000-0000-4000-8000-0000000000a1"}',
          'approve',
          '2026-07-05T00:01:00.000Z'
        ),
        (
          '6b000000-0000-4000-8000-0000000000b2',
          '${workspaceId}',
          'relation',
          '{"kind":"relationship_signal_evidence"}',
          NULL,
          '2020-01-02T03:04:05.100Z'
        ),
        (
          '61000000-0000-4000-8000-000000000001',
          '${workspaceId}',
          'relation',
          '{"proposalId":"6B000000-0000-4000-8000-0000000000B2"}',
          'approve',
          '2020-01-02T03:04:07.000Z'
        ),
        (
          '61000000-0000-4000-8000-000000000002',
          '${workspaceId}',
          'relation',
          '{"proposal_id":"6b000000-0000-4000-8000-0000000000b2"}',
          'veto',
          '2020-01-02T03:04:08.000Z'
        ),
        (
          '6c000000-0000-4000-8000-0000000000c3',
          '${workspaceId}',
          'relation',
          '{"kind":"relationship_signal_evidence"}',
          NULL,
          '2020-01-02T03:04:05.200Z'
        ),
        (
          '62000000-0000-4000-8000-000000000001',
          '${secondWorkspaceId}',
          'relation',
          '{"proposalId":"6c000000-0000-4000-8000-0000000000c3"}',
          'approve',
          '2020-01-02T03:04:09.000Z'
        ),
        (
          '62000000-0000-4000-8000-000000000002',
          '${workspaceId}',
          'person',
          '{"proposalId":"6c000000-0000-4000-8000-0000000000c3"}',
          'approve',
          '2020-01-02T03:04:10.000Z'
        ),
        (
          '62000000-0000-4000-8000-000000000004',
          '${workspaceId}',
          'relation',
          '{"proposalId":"6d000000-0000-4000-8000-0000000000d4"}',
          'approve',
          '2020-01-02T03:04:11.000Z'
        );
      INSERT INTO "ledger" (
        "id", "workspace_id", "resource_type", "inputs", "user_decision", "diff", "created_at"
      ) VALUES
        (
          '6e000000-0000-4000-8000-0000000000e5',
          '${workspaceId}',
          'relation',
          '{"kind":"relationship_signal_evidence"}',
          NULL,
          NULL,
          '2020-01-02T03:04:05.300Z'
        ),
        (
          '63000000-0000-4000-8000-000000000001',
          '${workspaceId}',
          'relation',
          '{"proposalId":"6e000000-0000-4000-8000-0000000000e5"}',
          'approve',
          '{"rejected":null}',
          '2020-01-02T03:04:12.000Z'
        ),
        (
          '6f000000-0000-4000-8000-0000000000f6',
          '${workspaceId}',
          'relation',
          '{"kind":"relationship_signal_evidence"}',
          NULL,
          NULL,
          '2020-01-02T03:04:05.400Z'
        ),
        (
          '63000000-0000-4000-8000-000000000002',
          '${workspaceId}',
          'relation',
          '{"proposalId":"6f000000-0000-4000-8000-0000000000f6"}',
          'approve',
          '{"rejected":""}',
          '2020-01-02T03:04:13.000Z'
        ),
        (
          '64000000-0000-4000-8000-000000000001',
          '${workspaceId}',
          'relation',
          '{"proposalId":"6c000000-0000-4000-8000-0000000000c3","proposal_id":"6c000000-0000-4000-8000-0000000000c3"}',
          'approve',
          NULL,
          '2020-01-02T03:04:14.000Z'
        ),
        (
          '64000000-0000-4000-8000-000000000002',
          '${workspaceId}',
          'relation',
          '{"proposalId":"6c000000-0000-4000-8000-0000000000c3","unexpected":"value"}',
          'approve',
          NULL,
          '2020-01-02T03:04:15.000Z'
        );
    `);
    await db.exec(`
      INSERT INTO "drizzle"."__drizzle_migrations" ("hash", "created_at")
      VALUES ('test_fixture_0003_hash', 1780342914819);
    `);
    await db.exec(`
      INSERT INTO "ledger" (
        "id", "workspace_id", "resource_type", "inputs", "user_decision", "created_at"
      ) VALUES (
        '62000000-0000-4000-8000-000000000003',
        '${workspaceId}',
        'relation',
        '{"proposalId":"6c000000-0000-4000-8000-0000000000c3"}',
        'approve',
        '2020-01-01T00:00:00.000Z'
      );
    `);
    const fixtureEra = await db.query<{
      id: string;
      predates_ref_column: boolean;
    }>(
      `SELECT candidate.id::text AS id,
              candidate.xmin::text::bigint < migration.xmin::text::bigint
                AS predates_ref_column
       FROM ledger AS candidate
       CROSS JOIN drizzle.__drizzle_migrations AS migration
       WHERE migration.created_at = 1780342914819
         AND candidate.id IN (
           '60000000-0000-4000-8000-000000000002',
           '62000000-0000-4000-8000-000000000003'
         )
       ORDER BY candidate.id`,
    );
    assert.deepEqual(fixtureEra.rows, [
      {
        id: "60000000-0000-4000-8000-000000000002",
        predates_ref_column: true,
      },
      {
        id: "62000000-0000-4000-8000-000000000003",
        predates_ref_column: false,
      },
    ]);
    const validLegacyEligibility = await db.query<{ count: number }>(
      `SELECT count(*)::int AS count
       FROM ledger AS decision
       CROSS JOIN drizzle.__drizzle_migrations AS migration
       JOIN ledger AS proposal
         ON proposal.id = lower(decision.inputs->>'proposal_id')::uuid
        AND proposal.workspace_id = decision.workspace_id
        AND proposal.user_decision IS NULL
        AND proposal.ref_ledger_id IS NULL
        AND proposal.xmin::text::bigint < migration.xmin::text::bigint
        AND proposal.xmin::text::bigint <= decision.xmin::text::bigint
        AND proposal.actor_type = decision.actor_type
        AND proposal.actor_id = decision.actor_id
        AND proposal.on_behalf_of_type IS NOT DISTINCT FROM decision.on_behalf_of_type
        AND proposal.on_behalf_of_id IS NOT DISTINCT FROM decision.on_behalf_of_id
        AND proposal.delegation_id IS NOT DISTINCT FROM decision.delegation_id
        AND proposal.action = decision.action
        AND proposal.resource_type = decision.resource_type
        AND proposal.resource_id IS NOT DISTINCT FROM decision.resource_id
        AND NOT COALESCE((proposal.diff ? 'rejected'), false)
       WHERE migration.created_at = 1780342914819
         AND decision.id = '60000000-0000-4000-8000-000000000002'
         AND decision.ref_ledger_id IS NULL
         AND decision.user_decision IN ('approve', 'veto', 'edit')
         AND decision.xmin::text::bigint < migration.xmin::text::bigint
         AND NOT COALESCE((decision.diff ? 'rejected'), false)
         AND jsonb_typeof(decision.inputs) = 'object'
         AND (decision.inputs ? 'proposalId') <> (decision.inputs ? 'proposal_id')
         AND jsonb_typeof(decision.inputs->'proposal_id') = 'string'
         AND (decision.inputs->>'proposal_id')
           ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'`,
    );
    assert.deepEqual(validLegacyEligibility.rows, [{ count: 1 }]);
    await db.exec(`
      ALTER TABLE "edges" FORCE ROW LEVEL SECURITY;
      ALTER TABLE "ledger" ENABLE ROW LEVEL SECURITY;
      ALTER TABLE "ledger" FORCE ROW LEVEL SECURITY;
      ALTER TABLE "edges" OWNER TO migration_owner;
      ALTER TABLE "ledger" OWNER TO migration_owner;
      ALTER TABLE "node_types" OWNER TO migration_owner;
      GRANT REFERENCES ON TABLE "users", "workspaces" TO migration_owner;
      GRANT USAGE, CREATE ON SCHEMA public TO migration_owner;
      GRANT USAGE ON SCHEMA app_private TO migration_owner;
      GRANT USAGE ON SCHEMA drizzle TO migration_owner;
      GRANT SELECT ON TABLE drizzle."__drizzle_migrations" TO migration_owner;
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
    const timestampPrecision = await db.query<{
      column_name: string;
      datetime_precision: number;
    }>(
      `SELECT column_name, datetime_precision
       FROM information_schema.columns
       WHERE table_schema = 'public'
         AND table_name = 'edges'
         AND column_name IN ('observed_at', 'created_at')
       ORDER BY column_name`,
    );
    assert.deepEqual(timestampPrecision.rows, [
      { column_name: "created_at", datetime_precision: 3 },
      { column_name: "observed_at", datetime_precision: 3 },
    ]);
    const effectColumns = await db.query<{ column_name: string }>(
      `SELECT column_name
       FROM information_schema.columns
       WHERE table_schema = 'public'
         AND table_name = 'relation_materialization_effects'`,
    );
    const effectColumnNames = new Set(
      effectColumns.rows.map((row) => row.column_name),
    );
    assert.ok(effectColumnNames.has("lease_token"));
    assert.ok(effectColumnNames.has("lease_expires_at"));
    assert.ok(effectColumnNames.has("lease_recovery_count"));
    assert.ok(effectColumnNames.has("max_lease_recoveries"));
    const outstandingIndex = await db.query<{ indexdef: string }>(
      `SELECT indexdef
       FROM pg_indexes
       WHERE indexname = 'relation_materialization_effects_outstanding_idx'`,
    );
    assert.equal(outstandingIndex.rows.length, 1);
    assert.match(
      outstandingIndex.rows[0]!.indexdef,
      /\(workspace_id, owner_user_id, id\)/,
    );
    assert.match(outstandingIndex.rows[0]!.indexdef, /WHERE/);
    assert.match(outstandingIndex.rows[0]!.indexdef, /pending/);
    assert.match(outstandingIndex.rows[0]!.indexdef, /failed/);

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
      effects_force_rls: boolean;
      ledger_append_sequences: string;
      ledger_append_sequence_nullable: string;
      legacy_decision_ref: string;
      ambiguous_legacy_unresolved: boolean;
      cross_workspace_unresolved: boolean;
      mismatched_shape_unresolved: boolean;
      post_migration_backdated_unresolved: boolean;
      missing_proposal_unresolved: boolean;
      rejected_null_unresolved: boolean;
      rejected_empty_unresolved: boolean;
      dual_key_unresolved: boolean;
      extra_key_unresolved: boolean;
    }>(
      `SELECT
              (SELECT relforcerowsecurity FROM pg_class
               WHERE oid = 'public.edges'::regclass) AS edges_force_rls,
              (SELECT relforcerowsecurity FROM pg_class
               WHERE oid = 'public.ledger'::regclass) AS ledger_force_rls,
              (SELECT relforcerowsecurity FROM pg_class
               WHERE oid = 'public.relation_materialization_effects'::regclass) AS effects_force_rls,
              (SELECT string_agg("append_sequence"::text, ',' ORDER BY "created_at", "id")
               FROM "ledger") AS ledger_append_sequences,
              (SELECT "is_nullable"
               FROM information_schema.columns
               WHERE table_schema = 'public'
                 AND table_name = 'ledger'
                 AND column_name = 'append_sequence') AS ledger_append_sequence_nullable,
              (SELECT "ref_ledger_id"::text FROM "ledger"
               WHERE "id" = '60000000-0000-4000-8000-000000000002') AS legacy_decision_ref,
              NOT EXISTS (
                SELECT 1 FROM "ledger"
                WHERE "id" IN (
                  '61000000-0000-4000-8000-000000000001',
                  '61000000-0000-4000-8000-000000000002'
                )
                  AND "ref_ledger_id" IS NOT NULL
              ) AS ambiguous_legacy_unresolved,
              (SELECT "ref_ledger_id" IS NULL FROM "ledger"
               WHERE "id" = '62000000-0000-4000-8000-000000000001') AS cross_workspace_unresolved,
              (SELECT "ref_ledger_id" IS NULL FROM "ledger"
               WHERE "id" = '62000000-0000-4000-8000-000000000002') AS mismatched_shape_unresolved,
              (SELECT "ref_ledger_id" IS NULL FROM "ledger"
               WHERE "id" = '62000000-0000-4000-8000-000000000003') AS post_migration_backdated_unresolved,
              (SELECT "ref_ledger_id" IS NULL FROM "ledger"
               WHERE "id" = '62000000-0000-4000-8000-000000000004') AS missing_proposal_unresolved,
              (SELECT "ref_ledger_id" IS NULL FROM "ledger"
               WHERE "id" = '63000000-0000-4000-8000-000000000001') AS rejected_null_unresolved,
              (SELECT "ref_ledger_id" IS NULL FROM "ledger"
               WHERE "id" = '63000000-0000-4000-8000-000000000002') AS rejected_empty_unresolved,
              (SELECT "ref_ledger_id" IS NULL FROM "ledger"
               WHERE "id" = '64000000-0000-4000-8000-000000000001') AS dual_key_unresolved,
              (SELECT "ref_ledger_id" IS NULL FROM "ledger"
               WHERE "id" = '64000000-0000-4000-8000-000000000002') AS extra_key_unresolved
      `,
    );
    assert.deepEqual(migrationPosture.rows, [
      {
        edges_force_rls: true,
        ledger_force_rls: true,
        effects_force_rls: true,
        ledger_append_sequences:
          "1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16",
        ledger_append_sequence_nullable: "NO",
        legacy_decision_ref: "6a000000-0000-4000-8000-0000000000a1",
        ambiguous_legacy_unresolved: true,
        cross_workspace_unresolved: true,
        mismatched_shape_unresolved: true,
        post_migration_backdated_unresolved: true,
        missing_proposal_unresolved: true,
        rejected_null_unresolved: true,
        rejected_empty_unresolved: true,
        dual_key_unresolved: true,
        extra_key_unresolved: true,
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
       CROSS JOIN unnest(ARRAY['edges', 'ledger', 'relation_materialization_effects']) AS tables(table_name)
       ORDER BY role_name, table_name`,
    );
    assert.equal(privileges.rows.length, 6);
    assert.deepEqual(
      new Set(privileges.rows.map((row) => row.table_name)),
      new Set(["edges", "ledger", "relation_materialization_effects"]),
    );
    assert.ok(
      privileges.rows.every(
        (row) =>
          !row.can_select &&
          !row.can_insert &&
          !row.can_update &&
          !row.can_delete,
      ),
    );
    const effectPolicies = await db.query<{ policyname: string }>(
      `SELECT policyname
       FROM pg_policies
       WHERE schemaname = 'public'
         AND tablename = 'relation_materialization_effects'
       ORDER BY policyname`,
    );
    assert.deepEqual(effectPolicies.rows, [
      { policyname: "relation_materialization_effects_tenant_insert" },
      { policyname: "relation_materialization_effects_tenant_select" },
      { policyname: "relation_materialization_effects_tenant_update" },
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
    assert.equal(nextAppend.rows[0]!.append_sequence, "17");
    await assert.doesNotReject(() =>
      db.query(
        `INSERT INTO "ledger" ("id", "workspace_id", "user_decision")
         VALUES ('60000000-0000-4000-8000-000000000005', $1, 'auto')`,
        [workspaceId],
      ),
    );

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
