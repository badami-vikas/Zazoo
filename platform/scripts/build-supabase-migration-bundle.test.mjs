import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";
import { buildSupabaseMigrationBundle } from "./build-supabase-migration-bundle.mjs";

test("Supabase bundle preserves released hashes and scopes managed-Postgres compatibility", async () => {
  const migrationsDir = resolve("packages/db/migrations");
  const journal = JSON.parse(
    await readFile(resolve(migrationsDir, "meta/_journal.json"), "utf8"),
  );
  const bundle = await buildSupabaseMigrationBundle(migrationsDir);
  const vocab3 = await readFile(
    resolve(migrationsDir, "0021_vocab3_organization_module_record.sql"),
    "utf8",
  );
  const runtimeRole = await readFile(
    resolve(migrationsDir, "0022_supabase_runtime_role.sql"),
    "utf8",
  );

  assert.equal(
    bundle.match(/INSERT INTO drizzle\.__drizzle_migrations/g)?.length,
    journal.entries.length,
  );
  assert.match(
    bundle,
    new RegExp(createHash("sha256").update(vocab3).digest("hex")),
  );
  assert.match(
    bundle,
    new RegExp(createHash("sha256").update(runtimeRole).digest("hex")),
  );
  assert.match(bundle, /CREATE FUNCTION public\.pg_get_functiondef/);
  assert.match(bundle, /DROP FUNCTION public\.pg_get_functiondef\(oid\)/);
  assert.match(bundle, /ALTER ROLE bridge_app\s+NOCREATEDB\s+NOCREATEROLE\s+NOINHERIT;/);
  assert.doesNotMatch(bundle, /ALTER ROLE bridge_app\s+NOSUPERUSER/);
  assert.match(bundle, /refusing to apply a fresh migration bundle over existing Drizzle history/);
});
