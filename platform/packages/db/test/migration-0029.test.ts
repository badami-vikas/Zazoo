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
import { UNKNOWN_LABEL } from "@bridge/core";
import { createLocalDb } from "../src/client-local.js";
import { DrizzleLedgerStore } from "../src/ledger-store.js";

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

test("migration 0029 upgrades legacy taint without data loss and replays", async () => {
  const through0028 = migrationsThrough(28);
  const through0029 = migrationsThrough(29);
  const { db, client, close } = await createLocalDb({
    migrationsFolder: through0028,
  });
  const organizationId = "10000000-0000-4000-8000-000000000029";
  const userId = "20000000-0000-4000-8000-000000000029";
  const ledgerUnknownId = "30000000-0000-4000-8000-000000000029";
  const ledgerUntrustedId = "40000000-0000-4000-8000-000000000029";
  const memoryId = "50000000-0000-4000-8000-000000000029";
  const eventId = "60000000-0000-4000-8000-000000000029";
  const fileId = "70000000-0000-4000-8000-000000000029";

  try {
    await client.exec(`
      INSERT INTO "users" ("id", "email")
      VALUES ('${userId}', 'task015@example.test');
      INSERT INTO "organizations" ("id", "name")
      VALUES ('${organizationId}', 'TASK-015 fixture');
      INSERT INTO "organization_members" ("organization_id", "user_id")
      VALUES ('${organizationId}', '${userId}');
      INSERT INTO "ledger" (
        "id", "organization_id", "actor_type", "actor_id", "action",
        "resource_type", "inputs", "user_decision", "policy_results", "trust_origin"
      ) VALUES
      (
        '${ledgerUnknownId}', '${organizationId}', 'user', '${userId}', 'read',
        'record', '{"preserve":"unknown"}', 'auto', '[]', NULL
      ),
      (
        '${ledgerUntrustedId}', '${organizationId}', 'agent', '${userId}', 'read',
        'external:fetch', '{"preserve":"untrusted"}', 'auto', '[]', 'untrusted_external'
      );
      INSERT INTO "memories" (
        "id", "organization_id", "type", "scope", "content", "confidence",
        "trust_origin", "plane", "created_by", "owner_user_id"
      ) VALUES (
        '${memoryId}', '${organizationId}', 'semantic', 'private',
        'preserved memory', 1, 'operator', 'local', '${userId}', '${userId}'
      );
      INSERT INTO "events" (
        "id", "organization_id", "type", "entity_type", "entity_id", "payload"
      ) VALUES (
        '${eventId}', '${organizationId}', 'research.completed', 'event',
        '${eventId}', '{"trustOrigin":"untrusted_external","preserve":true}'
      );
      INSERT INTO "files" (
        "id", "organization_id", "source", "content_text", "metadata"
      ) VALUES (
        '${fileId}', '${organizationId}', 'human-import', 'preserved file',
        '{"trustOrigin":"user_content","preserve":true}'
      );
    `);

    await migrate(db, { migrationsFolder: through0029 });

    const labels = await client.query<{
      id: string;
      trust: string;
      source: string;
      sensitivity: string;
      instructionRisk: string;
      preserve: string | boolean | null;
    }>(`
      SELECT "id", "taint_label" ->> 'trust' AS "trust",
             "taint_label" ->> 'source' AS "source",
             "taint_label" ->> 'sensitivity' AS "sensitivity",
             "taint_label" ->> 'instructionRisk' AS "instructionRisk",
             "inputs" ->> 'preserve' AS "preserve"
      FROM "ledger"
      WHERE "id" IN ('${ledgerUnknownId}', '${ledgerUntrustedId}')
      ORDER BY "id"
    `);
    assert.deepEqual(labels.rows, [
      {
        id: ledgerUnknownId,
        trust: "unknown",
        source: "unknown",
        sensitivity: "unknown",
        instructionRisk: "unknown",
        preserve: "unknown",
      },
      {
        id: ledgerUntrustedId,
        trust: "untrusted",
        source: "unknown",
        sensitivity: "unknown",
        instructionRisk: "unknown",
        preserve: "untrusted",
      },
    ]);

    const retained = await client.query<{
      memory: string;
      memoryTrust: string;
      eventTrust: string;
      fileTrust: string;
      fileText: string;
    }>(`
      SELECT
        (SELECT "content" FROM "memories" WHERE "id" = '${memoryId}') AS "memory",
        (SELECT "taint_label" ->> 'trust' FROM "memories" WHERE "id" = '${memoryId}') AS "memoryTrust",
        (SELECT "taint_label" ->> 'trust' FROM "events" WHERE "id" = '${eventId}') AS "eventTrust",
        (SELECT "taint_label" ->> 'trust' FROM "files" WHERE "id" = '${fileId}') AS "fileTrust",
        (SELECT "content_text" FROM "files" WHERE "id" = '${fileId}') AS "fileText"
    `);
    assert.deepEqual(retained.rows, [{
      memory: "preserved memory",
      memoryTrust: "verified_system",
      eventTrust: "untrusted",
      fileTrust: "authenticated_human",
      fileText: "preserved file",
    }]);

    await client.exec(`
      UPDATE "ledger"
      SET "taint_label" = '{"version":1}'::jsonb
      WHERE "id" = '${ledgerUnknownId}'
    `);
    // DrizzleLedgerStore is compiled against the CURRENT schema, so it selects
    // every column head defines (0037 added `skill` and `execution_snapshot`).
    // Exercising it against a 0029-era database therefore fails on a missing
    // column for reasons that have nothing to do with taint. Migrate to head
    // first: the assertion below is about the store's fail-closed handling of a
    // malformed taint label, which is unaffected by later columns.
    await migrate(db, { migrationsFolder: realMigrationsFolder() });
    const quarantined = await new DrizzleLedgerStore(db, {
      defaultOrganizationId: organizationId,
      defaultUserId: userId,
    }).get(ledgerUnknownId);
    assert.equal(quarantined?.taintLabel?.trust, "unknown");
    assert.equal(
      quarantined?.taintLabel?.provenanceHash,
      UNKNOWN_LABEL.provenanceHash,
    );

    await migrate(db, { migrationsFolder: through0029 });
    const replay = await client.query<{ count: string }>(`
      SELECT count(*)::text AS "count"
      FROM "ledger"
      WHERE "id" IN ('${ledgerUnknownId}', '${ledgerUntrustedId}')
    `);
    assert.equal(replay.rows[0]?.count, "2");
  } finally {
    await close();
    rmSync(through0028, { recursive: true, force: true });
    rmSync(through0029, { recursive: true, force: true });
  }
});

test("migration 0029 fresh schema has fail-closed labels and forced RLS audit tables", async () => {
  const through0029 = migrationsThrough(29);
  const { client, close } = await createLocalDb({
    migrationsFolder: through0029,
  });
  try {
    const columns = await client.query<{ table_name: string; nullable: string }>(`
      SELECT "table_name", "is_nullable" AS "nullable"
      FROM information_schema.columns
      WHERE "column_name" = 'taint_label'
        AND "table_name" IN (
          'ledger','memories','events','files','automation_runs','child_agent_runs'
        )
      ORDER BY "table_name"
    `);
    assert.equal(columns.rows.length, 6);
    assert.ok(columns.rows.every((row) => row.nullable === "NO"));

    const rls = await client.query<{
      relname: string;
      enabled: boolean;
      forced: boolean;
      policies: string;
    }>(`
      SELECT c.relname,
             c.relrowsecurity AS "enabled",
             c.relforcerowsecurity AS "forced",
             count(p.policyname)::text AS "policies"
      FROM pg_class c
      LEFT JOIN pg_policies p ON p.tablename = c.relname
      WHERE c.relname IN ('taint_sink_traces','taint_declassifications')
      GROUP BY c.relname, c.relrowsecurity, c.relforcerowsecurity
      ORDER BY c.relname
    `);
    assert.deepEqual(rls.rows, [
      {
        relname: "taint_declassifications",
        enabled: true,
        forced: true,
        policies: "1",
      },
      {
        relname: "taint_sink_traces",
        enabled: true,
        forced: true,
        policies: "1",
      },
    ]);
  } finally {
    await close();
    rmSync(through0029, { recursive: true, force: true });
  }
});
