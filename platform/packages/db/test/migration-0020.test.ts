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

test("migration 0020 fails closed, rolls back cleanly, then preserves canonical Agent attribution and RLS", async () => {
  const preDir = migrationsThrough(19);
  const through0020Dir = migrationsThrough(20);
  const { db, client, close } = await createLocalDb({ migrationsFolder: preDir });
  const workspaceId = "10000000-0000-4000-8000-000000000021";
  const automationId = "20000000-0000-4000-8000-000000000021";
  const runId = "30000000-0000-4000-8000-000000000021";
  const agentId = "40000000-0000-4000-8000-000000000021";
  const otherAgentId = "40000000-0000-4000-8000-000000000022";

  try {
    await client.exec(`
      INSERT INTO "workspaces" ("id", "name")
      VALUES ('${workspaceId}', 'test_fixture_vocab2');
      INSERT INTO "agents" ("id", "workspace_id", "name")
      VALUES
        ('${agentId}', '${workspaceId}', 'test_fixture_owner'),
        ('${otherAgentId}', '${workspaceId}', 'test_fixture_non_owner');
      INSERT INTO "rituals" (
        "id", "workspace_id", "name", "trigger", "agent_ids",
        "skill_pipeline", "agent_id", "agent_plane"
      ) VALUES (
        '${automationId}',
        '${workspaceId}',
        'test_fixture_automation',
        '{}',
        ARRAY['${agentId}']::uuid[],
        '[{"skill":"test_fixture","action":"write","resourceType":"ritual"}]',
        NULL,
        NULL
      );
    `);

    await assert.rejects(
      () => migrate(db, { migrationsFolder: through0020Dir }),
      (error: unknown) => errorMessage(error).includes("unresolved Ritual ownership"),
    );
    const rolledBack = await client.query<{ old_table: string | null; new_table: string | null }>(`
      SELECT
        to_regclass('public.rituals')::text AS old_table,
        to_regclass('public.automations')::text AS new_table
    `);
    assert.equal(rolledBack.rows[0]?.old_table, "rituals");
    assert.equal(rolledBack.rows[0]?.new_table, null);

    await client.exec(`
      UPDATE "rituals"
      SET "agent_id" = '${agentId}', "agent_plane" = 'local'
      WHERE "id" = '${automationId}';
      INSERT INTO "ritual_runs" (
        "id", "workspace_id", "ritual_id", "run_id", "status"
      ) VALUES (
        '${runId}', '${workspaceId}', '${automationId}', '${runId}', 'completed'
      );
    `);

    await assert.rejects(
      () => migrate(db, { migrationsFolder: through0020Dir }),
      (error: unknown) => errorMessage(error).includes("unattributable or non-owner Ritual Run"),
    );
    const runColumnsAfterRollback = await client.query<{ column_name: string }>(`
      SELECT "column_name"
      FROM information_schema.columns
      WHERE "table_schema" = 'public'
        AND "table_name" = 'ritual_runs'
        AND "column_name" = 'agent_id'
    `);
    assert.equal(runColumnsAfterRollback.rows.length, 0);

    await client.exec(`
      INSERT INTO "ledger" (
        "id", "workspace_id", "actor_type", "actor_id", "action",
        "resource_type", "context"
      ) VALUES (
        gen_random_uuid(),
        '${workspaceId}',
        'agent',
        '${agentId}',
        'write',
        'ritual',
        '{"type":"ritual","id":"${automationId}","runId":"${runId}"}'
      );
      INSERT INTO "tools" (
        "id", "workspace_id", "name", "surface", "composition"
      ) VALUES (
        gen_random_uuid(),
        '${workspaceId}',
        'test_fixture_unclassified_tool',
        'page',
        '{}'
      );
      UPDATE "agents"
      SET "allowed_tools" = ARRAY[gen_random_uuid()]
      WHERE "id" = '${agentId}';
    `);

    await assert.rejects(
      () => migrate(db, { migrationsFolder: through0020Dir }),
      (error: unknown) => errorMessage(error).includes("cannot classify populated legacy Tools"),
    );
    await client.exec(`DELETE FROM "tools";`);
    await assert.rejects(
      () => migrate(db, { migrationsFolder: through0020Dir }),
      (error: unknown) => errorMessage(error).includes("cannot classify Agent allowed_tools entries"),
    );

    await client.exec(`
      UPDATE "agents"
      SET "allowed_tools" = '{}'
      WHERE "id" = '${agentId}';
      INSERT INTO "capability_manifests" (
        "id", "workspace_id", "capability_type", "kind", "name", "manifest"
      ) VALUES
        (
          gen_random_uuid(),
          '${workspaceId}',
          'workflow',
          'workflow',
          'test_fixture_vocab2_capability',
          '{"capabilityType":"workflow","ritualId":"${automationId}","permissions":[{"resourceType":"ritual"}]}'
        ),
        (
          gen_random_uuid(),
          '${workspaceId}',
          'tool',
          'tool',
          'test_fixture_vocab2_skill',
          '{"capabilityType":"tool","toolId":"legacy-skill","permissions":[{"resourceType":"tool"}]}'
        );
      INSERT INTO "package_installations" (
        "id", "workspace_id", "package_name", "package_version", "manifest"
      ) VALUES
        (
          gen_random_uuid(),
          '${workspaceId}',
          'test_fixture_vocab2_package',
          '1.0.0',
          '{"kind":"workflow","module":{"automations":[{"ritual_id":"${automationId}"}]}}'
        ),
        (
          gen_random_uuid(),
          '${workspaceId}',
          'test_fixture_vocab2_module_package',
          '1.0.0',
          '{"kind":"tool","capabilities":[{"capabilityType":"tool","toolId":"legacy-skill"}]}'
        );
      INSERT INTO "events" (
        "id", "workspace_id", "type", "entity_type", "entity_id", "payload"
      ) VALUES (
        gen_random_uuid(),
        '${workspaceId}',
        'ritual.completed',
        'ritual',
        '${automationId}',
        '{"ritualId":"${automationId}"}'
      );
    `);

    await migrate(db, { migrationsFolder: through0020Dir });

    const automation = await client.query<{
      agent_id: string;
      agent_plane: string;
      skill_pipeline: Array<{ resourceType: string }>;
    }>(`
      SELECT "agent_id", "agent_plane", "skill_pipeline"
      FROM "automations"
      WHERE "id" = '${automationId}'
    `);
    assert.deepEqual(automation.rows, [{
      agent_id: agentId,
      agent_plane: "local",
      skill_pipeline: [{ skill: "test_fixture", action: "write", resourceType: "automation" }],
    }]);

    const run = await client.query<{ agent_id: string; automation_id: string }>(`
      SELECT "agent_id", "automation_id"
      FROM "automation_runs"
      WHERE "id" = '${runId}'
    `);
    assert.deepEqual(run.rows, [{ agent_id: agentId, automation_id: automationId }]);

    const transformed = await client.query<{
      capability_type: string;
      kind: string;
      manifest: Record<string, unknown>;
    }>(`
      SELECT "capability_type", "kind", "manifest"
      FROM "capability_manifests"
      WHERE "name" = 'test_fixture_vocab2_capability'
    `);
    assert.equal(transformed.rows[0]?.capability_type, "automation");
    assert.equal(transformed.rows[0]?.kind, "automation");
    assert.deepEqual(transformed.rows[0]?.manifest, {
      capabilityType: "automation",
      automationId,
      permissions: [{ resourceType: "automation" }],
    });

    const transformedSkill = await client.query<{
      capability_type: string;
      kind: string;
      manifest: Record<string, unknown>;
    }>(`
      SELECT "capability_type", "kind", "manifest"
      FROM "capability_manifests"
      WHERE "name" = 'test_fixture_vocab2_skill'
    `);
    assert.deepEqual(transformedSkill.rows, [{
      capability_type: "skill",
      kind: "skill",
      manifest: {
        capabilityType: "skill",
        skillId: "legacy-skill",
        permissions: [{ resourceType: "module" }],
      },
    }]);

    const packageManifest = await client.query<{ manifest: Record<string, unknown> }>(`
      SELECT "manifest"
      FROM "package_installations"
      WHERE "package_name" = 'test_fixture_vocab2_package'
    `);
    assert.deepEqual(packageManifest.rows[0]?.manifest, {
      kind: "automation",
      module: { automations: [{ automation_id: automationId }] },
    });

    const modulePackageManifest = await client.query<{ manifest: Record<string, unknown> }>(`
      SELECT "manifest"
      FROM "package_installations"
      WHERE "package_name" = 'test_fixture_vocab2_module_package'
    `);
    assert.deepEqual(modulePackageManifest.rows[0]?.manifest, {
      kind: "module",
      capabilities: [{
        capabilityType: "skill",
        skillId: "legacy-skill",
      }],
    });

    const retiredStorage = await client.query<{
      tools_table: string | null;
      allowed_tools_column: string | null;
      module_node_type: string | null;
    }>(`
      SELECT
        to_regclass('public.tools')::text AS "tools_table",
        (
          SELECT "column_name"
          FROM information_schema.columns
          WHERE "table_schema" = 'public'
            AND "table_name" = 'agents'
            AND "column_name" = 'allowed_tools'
        ) AS "allowed_tools_column",
        (
          SELECT "type"
          FROM "node_types"
          WHERE "type" = 'module'
        ) AS "module_node_type"
    `);
    assert.deepEqual(retiredStorage.rows, [{
      tools_table: null,
      allowed_tools_column: null,
      module_node_type: "module",
    }]);

    const event = await client.query<{
      type: string;
      entity_type: string;
      payload: Record<string, unknown>;
    }>(`
      SELECT "type", "entity_type", "payload"
      FROM "events"
      WHERE "entity_id" = '${automationId}'
    `);
    assert.deepEqual(event.rows, [{
      type: "automation.completed",
      entity_type: "automation",
      payload: { automationId },
    }]);

    const audit = await client.query<{
      resource_type: string;
      context: { type: string; id: string; runId: string };
    }>(`
      SELECT "resource_type", "context"
      FROM "ledger"
      WHERE "context"->>'runId' = '${runId}'
    `);
    assert.equal(audit.rows[0]?.resource_type, "automation");
    assert.equal(audit.rows[0]?.context.type, "automation");

    const rls = await client.query<{
      relname: string;
      relrowsecurity: boolean;
      relforcerowsecurity: boolean;
    }>(`
      SELECT "relname", "relrowsecurity", "relforcerowsecurity"
      FROM pg_class
      WHERE "oid" IN (
        'public.automations'::regclass,
        'public.automation_runs'::regclass
      )
      ORDER BY "relname"
    `);
    assert.deepEqual(rls.rows, [
      { relname: "automation_runs", relrowsecurity: true, relforcerowsecurity: true },
      { relname: "automations", relrowsecurity: true, relforcerowsecurity: true },
    ]);
    const policies = await client.query<{ tablename: string; policyname: string }>(`
      SELECT "tablename", "policyname"
      FROM pg_policies
      WHERE "tablename" IN ('automations', 'automation_runs')
      ORDER BY "tablename", "policyname"
    `);
    assert.equal(policies.rows.length, 8);
    assert.equal(
      policies.rows.every(
        ({ tablename, policyname }) =>
          policyname.startsWith(`${tablename}_tenant_`) &&
          !policyname.includes("ritual"),
      ),
      true,
    );

    await assert.rejects(
      () =>
        client.exec(`
          INSERT INTO "automation_runs" (
            "id", "workspace_id", "automation_id", "agent_id", "status"
          ) VALUES (
            gen_random_uuid(),
            '${workspaceId}',
            '${automationId}',
            '${otherAgentId}',
            'running'
          )
        `),
      (error: unknown) =>
        errorMessage(error).includes("automation_runs_workspace_automation_owner_fk"),
    );
  } finally {
    await close();
    rmSync(preDir, { recursive: true, force: true });
    rmSync(through0020Dir, { recursive: true, force: true });
  }
});
