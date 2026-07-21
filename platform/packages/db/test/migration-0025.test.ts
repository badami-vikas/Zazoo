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

test("migration 0025 keeps bootstrap catalogs private without breaking Organization RLS", async () => {
  const { client, close } = await createLocalDb();
  try {
    const posture = await client.query<{
      relname: string;
      relrowsecurity: boolean;
      relforcerowsecurity: boolean;
    }>(`
      SELECT c.relname, c.relrowsecurity, c.relforcerowsecurity
      FROM pg_class AS c
      JOIN pg_namespace AS n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public'
        AND c.relname IN ('organizations', 'users', 'organization_members')
      ORDER BY c.relname
    `);
    assert.deepEqual(posture.rows, [
      {
        relname: "organization_members",
        relrowsecurity: true,
        relforcerowsecurity: true,
      },
      {
        relname: "organizations",
        relrowsecurity: false,
        relforcerowsecurity: false,
      },
      {
        relname: "users",
        relrowsecurity: false,
        relforcerowsecurity: false,
      },
    ]);

    await client.exec(
      readFileSync(
        join(migrationsFolder(), "0025_task006_supabase_root_catalogs.sql"),
        "utf8",
      ),
    );
  } finally {
    await close();
  }
});
