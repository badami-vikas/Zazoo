import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";

const here = dirname(fileURLToPath(import.meta.url));

function migrationSql(): string {
  for (const relative of [
    "../migrations/0017_task005_private_learning_recommendations.sql",
    "../../migrations/0017_task005_private_learning_recommendations.sql",
  ]) {
    const candidate = resolve(here, relative);
    if (existsSync(candidate)) return readFileSync(candidate, "utf8");
  }
  throw new Error("0017 migration not found");
}

test("migration 0017 owner-scopes legacy Learning recommendations and linked audit rows", async () => {
  const db = new PGlite();
  try {
    await db.exec(`
      CREATE TABLE "ledger" (
        "id" uuid PRIMARY KEY,
        "workspace_id" uuid NOT NULL,
        "actor_type" text NOT NULL,
        "actor_id" uuid NOT NULL,
        "on_behalf_of_type" text,
        "on_behalf_of_id" uuid,
        "resource_type" text NOT NULL,
        "inputs" jsonb,
        "data_scope" text,
        "ref_ledger_id" uuid
      );
      INSERT INTO "ledger" (
        "id", "workspace_id", "actor_type", "actor_id", "on_behalf_of_type",
        "on_behalf_of_id", "resource_type", "inputs"
      ) VALUES (
        '10000000-0000-4000-8000-000000000001',
        '20000000-0000-4000-8000-000000000001',
        'agent',
        '30000000-0000-4000-8000-000000000001',
        'user',
        '40000000-0000-4000-8000-000000000001',
        'signal',
        '{"kind":"learning_recommendation"}'
      );
      INSERT INTO "ledger" (
        "id", "workspace_id", "actor_type", "actor_id", "resource_type", "inputs", "ref_ledger_id"
      ) VALUES (
        '10000000-0000-4000-8000-000000000002',
        '20000000-0000-4000-8000-000000000001',
        'agent',
        '30000000-0000-4000-8000-000000000001',
        'ledger',
        '{"proposalId":"10000000-0000-4000-8000-000000000001"}',
        '10000000-0000-4000-8000-000000000001'
      );
      INSERT INTO "ledger" (
        "id", "workspace_id", "actor_type", "actor_id", "resource_type", "inputs"
      ) VALUES (
        '10000000-0000-4000-8000-000000000003',
        '20000000-0000-4000-8000-000000000001',
        'agent',
        '30000000-0000-4000-8000-000000000001',
        'signal',
        '{"kind":"shared_signal"}'
      );
    `);
    await db.exec(migrationSql());
    const result = await db.query<{
      id: string;
      data_scope: string | null;
      on_behalf_of_type: string | null;
      on_behalf_of_id: string | null;
    }>(`
      SELECT "id", "data_scope", "on_behalf_of_type", "on_behalf_of_id"
      FROM "ledger"
      ORDER BY "id"
    `);
    assert.deepEqual(result.rows, [
      {
        id: "10000000-0000-4000-8000-000000000001",
        data_scope: "private",
        on_behalf_of_type: "user",
        on_behalf_of_id: "40000000-0000-4000-8000-000000000001",
      },
      {
        id: "10000000-0000-4000-8000-000000000002",
        data_scope: "private",
        on_behalf_of_type: "user",
        on_behalf_of_id: "40000000-0000-4000-8000-000000000001",
      },
      {
        id: "10000000-0000-4000-8000-000000000003",
        data_scope: null,
        on_behalf_of_type: null,
        on_behalf_of_id: null,
      },
    ]);
  } finally {
    await db.close();
  }
});
