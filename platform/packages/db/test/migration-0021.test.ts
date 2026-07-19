import assert from "node:assert/strict";
import {
  cpSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { migrate } from "drizzle-orm/pglite/migrator";
import { createLocalDb } from "../src/client-local.js";

interface Journal {
  entries: Array<{ idx: number; tag: string }>;
}

const here = dirname(fileURLToPath(import.meta.url));

function realMigrationsFolder(): string {
  for (const relative of ["../migrations", "../../migrations"]) {
    const candidate = resolve(here, relative);
    try {
      readFileSync(join(candidate, "meta/_journal.json"), "utf8");
      return candidate;
    } catch {
      // Try the source-tree path after the compiled-test path.
    }
  }
  throw new Error("database migrations folder not found");
}

function migrationsThrough(lastIdx: number): string {
  const dir = mkdtempSync(join(tmpdir(), `bridge-db-through-${lastIdx}-`));
  cpSync(realMigrationsFolder(), dir, { recursive: true });
  const journalPath = join(dir, "meta/_journal.json");
  const journal = JSON.parse(readFileSync(journalPath, "utf8")) as Journal;
  for (const entry of journal.entries.filter(({ idx }) => idx > lastIdx)) {
    rmSync(join(dir, `${entry.tag}.sql`), { force: true });
  }
  journal.entries = journal.entries.filter(({ idx }) => idx <= lastIdx);
  writeFileSync(journalPath, JSON.stringify(journal, null, 2));
  return dir;
}

function errorMessage(error: unknown): string {
  const candidate = error as { cause?: { message?: string }; message?: string };
  return candidate.cause?.message ?? candidate.message ?? String(error);
}

test("migration 0021 rolls back conflicts, preserves data and RLS, and retries safely", async () => {
  const preDir = migrationsThrough(20);
  const through0021Dir = migrationsThrough(21);
  const { db, client, close } = await createLocalDb({ migrationsFolder: preDir });
  const workspaceId = "10000000-0000-4000-8000-000000000031";
  const userId = "20000000-0000-4000-8000-000000000031";
  const personId = "30000000-0000-4000-8000-000000000031";
  const initiativeId = "40000000-0000-4000-8000-000000000031";
  const agentId = "50000000-0000-4000-8000-000000000031";
  const automationId = "60000000-0000-4000-8000-000000000031";
  const installationId = "70000000-0000-4000-8000-000000000031";
  const memoryId = "80000000-0000-4000-8000-000000000031";

  try {
    await client.exec(`
      INSERT INTO "users" ("id", "email")
      VALUES ('${userId}', 'vocab3@example.test');
      INSERT INTO "workspaces" ("id", "name")
      VALUES ('${workspaceId}', 'VOCAB3 fixture');
      INSERT INTO "workspace_settings" (
        "workspace_id", "default_visibility", "settings"
      ) VALUES (
        '${workspaceId}',
        'workspace',
        '{"workspaceId":"${workspaceId}"}'
      );
      INSERT INTO "workspace_members" ("workspace_id", "user_id")
      VALUES ('${workspaceId}', '${userId}');
      INSERT INTO "people" (
        "id", "workspace_id", "user_id", "visibility", "full_name_override"
      ) VALUES (
        '${personId}',
        '${workspaceId}',
        '${userId}',
        'workspace',
        'VOCAB3 Person'
      );
      INSERT INTO "initiatives" (
        "id", "workspace_id", "title", "status"
      ) VALUES (
        '${initiativeId}',
        '${workspaceId}',
        'VOCAB3 Initiative',
        'active'
      );
      INSERT INTO "initiative_participants" ("initiative_id", "person_id", "role")
      VALUES ('${initiativeId}', '${personId}', 'owner');
      INSERT INTO "agents" ("id", "workspace_id", "name")
      VALUES ('${agentId}', '${workspaceId}', 'VOCAB3 Agent');
      INSERT INTO "automations" (
        "id", "workspace_id", "name", "trigger", "agent_id", "agent_plane",
        "supports_initiative"
      ) VALUES (
        '${automationId}',
        '${workspaceId}',
        'VOCAB3 Automation',
        '{}',
        '${agentId}',
        'local',
        '${initiativeId}'
      );
      INSERT INTO "package_installations" (
        "id",
        "workspace_id",
        "package_name",
        "package_version",
        "manifest",
        "module_attachment"
      ) VALUES (
        '${installationId}',
        '${workspaceId}',
        'relationship',
        '1.0.0',
        '{
          "name":"relationship",
          "version":"1.0.0",
          "kind":"workspace_definition",
          "workspaceVocab":{"alignsToBridgeTheme":true,"domainTerms":{}},
          "organizationVocab":{"alignsToBridgeTheme":false,"domainTerms":{}},
          "blueprint":{"workspaceId":"${workspaceId}"},
          "capabilities":[]
        }',
        '{
          "source":"commons",
          "modulePackageName":"relationship",
          "agentId":"relationship-agent",
          "needId":"learning",
          "contentHash":"sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
        }'
      );
      INSERT INTO "memories" (
        "id",
        "workspace_id",
        "type",
        "subject_element_id",
        "scope",
        "content",
        "confidence",
        "trust_origin",
        "plane",
        "created_by",
        "owner_user_id"
      ) VALUES (
        '${memoryId}',
        '${workspaceId}',
        'semantic',
        '${initiativeId}',
        'workspace',
        'VOCAB3 Memory',
        1,
        'operator',
        'local',
        '${userId}',
        '${userId}'
      );
      INSERT INTO "events" (
        "workspace_id", "type", "entity_type", "entity_id", "payload"
      ) VALUES (
        '${workspaceId}',
        'initiative.created',
        'initiative',
        '${initiativeId}',
        '{
          "workspaceId":"${workspaceId}",
          "initiativeId":"${initiativeId}",
          "message":"workspace",
          "externalRef":"project:external"
        }'
      );
      INSERT INTO "ledger" (
        "workspace_id", "actor_type", "actor_id", "action", "resource_type", "context"
      ) VALUES (
        '${workspaceId}',
        'user',
        '${userId}',
        'read',
        'initiative',
        '{"type":"initiative","workspaceId":"${workspaceId}","initiativeId":"${initiativeId}"}'
      );
    `);

    await assert.rejects(
      () => migrate(db, { migrationsFolder: through0021Dir }),
      (error: unknown) =>
        errorMessage(error).includes("conflicting JSON keys into canonical key"),
    );

    const rolledBack = await client.query<{
      old_table: string | null;
      new_table: string | null;
      old_column: string | null;
    }>(`
      SELECT
        to_regclass('public.workspaces')::text AS old_table,
        to_regclass('public.organizations')::text AS new_table,
        (
          SELECT "column_name"
          FROM information_schema.columns
          WHERE "table_schema" = 'public'
            AND "table_name" = 'package_installations'
            AND "column_name" = 'workspace_id'
        ) AS old_column
    `);
    assert.deepEqual(rolledBack.rows, [{
      old_table: "workspaces",
      new_table: null,
      old_column: "workspace_id",
    }]);

    await client.exec(`
      UPDATE "package_installations"
      SET "manifest" = "manifest" - 'organizationVocab'
      WHERE "id" = '${installationId}'
    `);
    await migrate(db, { migrationsFolder: through0021Dir });

    const canonicalTables = await client.query<{
      organizations: string | null;
      modules: string | null;
      records: string | null;
      legacy_workspace: string | null;
    }>(`
      SELECT
        to_regclass('public.organizations')::text AS organizations,
        to_regclass('public.module_installations')::text AS modules,
        to_regclass('public.records')::text AS records,
        to_regclass('public.workspaces')::text AS legacy_workspace
    `);
    assert.deepEqual(canonicalTables.rows, [{
      organizations: "organizations",
      modules: "module_installations",
      records: "records",
      legacy_workspace: null,
    }]);

    const record = await client.query<{
      id: string;
      organization_id: string;
      title: string;
    }>(`
      SELECT "id", "organization_id", "title"
      FROM "records"
      WHERE "id" = '${initiativeId}'
    `);
    assert.deepEqual(record.rows, [{
      id: initiativeId,
      organization_id: workspaceId,
      title: "VOCAB3 Initiative",
    }]);

    const installation = await client.query<{
      organization_id: string;
      module_name: string;
      module_version: string;
      manifest: Record<string, unknown>;
      module_attachment: Record<string, unknown>;
    }>(`
      SELECT
        "organization_id",
        "module_name",
        "module_version",
        "manifest",
        "module_attachment"
      FROM "module_installations"
      WHERE "id" = '${installationId}'
    `);
    assert.equal(installation.rows[0]?.organization_id, workspaceId);
    assert.equal(installation.rows[0]?.module_name, "relationship");
    assert.equal(installation.rows[0]?.module_version, "1.0.0");
    assert.equal(installation.rows[0]?.manifest.kind, "organization_definition");
    assert.deepEqual(installation.rows[0]?.manifest.organizationVocab, {
      alignsToBridgeTheme: true,
      domainTerms: {},
    });
    assert.equal(
      (installation.rows[0]?.manifest.blueprint as { organizationId: string }).organizationId,
      workspaceId,
    );
    assert.equal(
      installation.rows[0]?.module_attachment.ownerModuleName,
      "relationship",
    );

    const canonicalData = await client.query<{
      memory_scope: string;
      subject_record_id: string;
      event_type: string;
      entity_type: string;
      event_payload: Record<string, unknown>;
      ledger_resource_type: string;
      ledger_context: Record<string, unknown>;
    }>(`
      SELECT
        memory."scope" AS memory_scope,
        memory."subject_record_id",
        event."type" AS event_type,
        event."entity_type",
        event."payload" AS event_payload,
        ledger_row."resource_type" AS ledger_resource_type,
        ledger_row."context" AS ledger_context
      FROM "memories" AS memory
      CROSS JOIN "events" AS event
      CROSS JOIN "ledger" AS ledger_row
      WHERE memory."id" = '${memoryId}'
        AND event."entity_id" = '${initiativeId}'
        AND ledger_row."resource_id" IS NULL
      LIMIT 1
    `);
    assert.deepEqual(canonicalData.rows, [{
      memory_scope: "organization",
      subject_record_id: initiativeId,
      event_type: "record.created",
      entity_type: "record",
      event_payload: {
        externalRef: "project:external",
        message: "workspace",
        organizationId: workspaceId,
        recordId: initiativeId,
      },
      ledger_resource_type: "record",
      ledger_context: {
        type: "record",
        organizationId: workspaceId,
        recordId: initiativeId,
      },
    }]);

    const rls = await client.query<{
      legacy_functions: number;
      canonical_functions: number;
      legacy_policies: number;
    }>(`
      SELECT
        (
          SELECT count(*)::int
          FROM pg_proc AS function_row
          JOIN pg_namespace AS namespace
            ON namespace.oid = function_row.pronamespace
          WHERE namespace.nspname = 'app_private'
            AND function_row.proname LIKE '%workspace%'
        ) AS legacy_functions,
        (
          SELECT count(*)::int
          FROM pg_proc AS function_row
          JOIN pg_namespace AS namespace
            ON namespace.oid = function_row.pronamespace
          WHERE namespace.nspname = 'app_private'
            AND function_row.proname IN (
              'current_organization_id',
              'same_organization',
              'visible_relationship_record',
              'visible_memory_record'
            )
        ) AS canonical_functions,
        (
          SELECT count(*)::int
          FROM pg_policies
          WHERE schemaname = 'public'
            AND (
              policyname ~ '(workspace|package|initiative)'
              OR tablename ~ '(workspace|package|initiative)'
              OR coalesce(qual, '') ~ 'workspace'
              OR coalesce(with_check, '') ~ 'workspace'
            )
        ) AS legacy_policies
    `);
    assert.deepEqual(rls.rows, [{
      legacy_functions: 0,
      canonical_functions: 4,
      legacy_policies: 0,
    }]);

    await client.exec(readFileSync(
      join(realMigrationsFolder(), "0021_vocab3_organization_module_record.sql"),
      "utf8",
    ));

    const afterRetry = await client.query<{ count: number }>(`
      SELECT count(*)::int AS count
      FROM "records"
      WHERE "id" = '${initiativeId}'
    `);
    assert.deepEqual(afterRetry.rows, [{ count: 1 }]);
  } finally {
    await close();
    rmSync(preDir, { recursive: true, force: true });
    rmSync(through0021Dir, { recursive: true, force: true });
  }
});
