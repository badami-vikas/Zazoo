import assert from "node:assert/strict";
import {
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";

const here = dirname(fileURLToPath(import.meta.url));

function migrationSql(tag: string): string {
  for (const relative of [`../migrations/${tag}.sql`, `../../migrations/${tag}.sql`]) {
    const candidate = resolve(here, relative);
    if (existsSync(candidate)) return readFileSync(candidate, "utf8");
  }
  throw new Error(`${tag} migration not found`);
}

function writeMigrations(
  root: string,
  entries: Array<{ idx: number; when: number; tag: string; sql: string }>,
): void {
  mkdirSync(join(root, "meta"), { recursive: true });
  writeFileSync(
    join(root, "meta/_journal.json"),
    JSON.stringify({
      version: "7",
      dialect: "postgresql",
      entries: entries.map(({ idx, when, tag }) => ({
        idx,
        version: "7",
        when,
        tag,
        breakpoints: true,
      })),
    }),
  );
  for (const entry of entries) {
    writeFileSync(join(root, `${entry.tag}.sql`), entry.sql);
  }
}

test("migration 0019 applies the private-learning backfill above the local-parent high-water mark", async () => {
  const tempRoot = mkdtempSync(join(tmpdir(), "bridge-migration-0019-"));
  const localParent = join(tempRoot, "local-parent");
  const merged = join(tempRoot, "merged");
  writeMigrations(localParent, [
    {
      idx: 17,
      when: 1784414197737,
      tag: "0017_tense_warbound",
      sql: "SELECT 1;",
    },
  ]);
  writeMigrations(merged, [
    {
      idx: 17,
      when: 1784361600000,
      tag: "0017_task005_private_learning_recommendations",
      sql: migrationSql("0017_task005_private_learning_recommendations"),
    },
    {
      idx: 18,
      when: 1784414197737,
      tag: "0018_tense_warbound",
      sql: "SELECT 1;",
    },
    {
      idx: 19,
      when: 1784449600000,
      tag: "0019_repeat_private_learning_backfill",
      sql: migrationSql("0019_repeat_private_learning_backfill"),
    },
  ]);

  const client = new PGlite();
  const db = drizzle(client);
  try {
    await migrate(db, { migrationsFolder: localParent });
    await client.exec(`
      CREATE TABLE "ledger" (
        "id" uuid PRIMARY KEY,
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
        "id", "actor_type", "actor_id", "on_behalf_of_type",
        "on_behalf_of_id", "resource_type", "inputs"
      ) VALUES (
        '10000000-0000-4000-8000-000000000011',
        'agent',
        '30000000-0000-4000-8000-000000000011',
        'user',
        '40000000-0000-4000-8000-000000000011',
        'signal',
        '{"kind":"learning_recommendation"}'
      );
      INSERT INTO "ledger" (
        "id", "actor_type", "actor_id", "resource_type", "inputs", "ref_ledger_id"
      ) VALUES (
        '10000000-0000-4000-8000-000000000012',
        'agent',
        '30000000-0000-4000-8000-000000000011',
        'ledger',
        '{"proposalId":"10000000-0000-4000-8000-000000000011"}',
        '10000000-0000-4000-8000-000000000011'
      );
    `);

    await migrate(db, { migrationsFolder: merged });
    await migrate(db, { migrationsFolder: merged });

    const result = await client.query<{
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
        id: "10000000-0000-4000-8000-000000000011",
        data_scope: "private",
        on_behalf_of_type: "user",
        on_behalf_of_id: "40000000-0000-4000-8000-000000000011",
      },
      {
        id: "10000000-0000-4000-8000-000000000012",
        data_scope: "private",
        on_behalf_of_type: "user",
        on_behalf_of_id: "40000000-0000-4000-8000-000000000011",
      },
    ]);
  } finally {
    await client.close();
    rmSync(tempRoot, { recursive: true, force: true });
  }
});
