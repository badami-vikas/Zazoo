import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { createLocalDb } from "../src/client-local.js";

const here = dirname(fileURLToPath(import.meta.url));

function migrationsFolder(): string {
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

test("migration 0026 leaves no RLS-enabled table without a tracked policy", async () => {
  const { client, close } = await createLocalDb();
  try {
    const policyless = await client.query<{ relname: string }>(`
      SELECT c.relname
      FROM pg_class AS c
      JOIN pg_namespace AS n ON n.oid = c.relnamespace
      LEFT JOIN pg_policies AS p
        ON p.schemaname = n.nspname
       AND p.tablename = c.relname
      WHERE n.nspname = 'public'
        AND c.relkind = 'r'
        AND c.relrowsecurity
      GROUP BY c.relname
      HAVING count(p.policyname) = 0
      ORDER BY c.relname
    `);
    assert.deepEqual(policyless.rows, []);

    const membership = await client.query<{
      relrowsecurity: boolean;
      relforcerowsecurity: boolean;
    }>(`
      SELECT c.relrowsecurity, c.relforcerowsecurity
      FROM pg_class AS c
      JOIN pg_namespace AS n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public'
        AND c.relname = 'organization_members'
    `);
    assert.deepEqual(membership.rows, [
      { relrowsecurity: true, relforcerowsecurity: true },
    ]);

    await client.exec(
      readFileSync(
        join(migrationsFolder(), "0026_task006_supabase_auto_rls_alignment.sql"),
        "utf8",
      ),
    );
  } finally {
    await close();
  }
});
