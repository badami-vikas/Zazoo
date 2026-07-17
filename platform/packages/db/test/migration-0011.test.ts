import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";

const here = dirname(fileURLToPath(import.meta.url));

function migrationSql(): string {
  for (const relative of [
    "../migrations/0011_same_cyclops.sql",
    "../../migrations/0011_same_cyclops.sql",
  ]) {
    const candidate = resolve(here, relative);
    if (existsSync(candidate)) return readFileSync(candidate, "utf8");
  }
  throw new Error("0011 migration not found");
}

async function legacyDatabase(): Promise<PGlite> {
  const db = new PGlite();
  await db.exec(`
    CREATE TABLE "package_installations" (
      "id" uuid PRIMARY KEY,
      "workspace_id" uuid NOT NULL,
      "package_name" text NOT NULL,
      "package_version" text NOT NULL,
      "manifest" jsonb NOT NULL,
      "computed_risk" text NOT NULL,
      "state" text NOT NULL,
      "status" text NOT NULL,
      "lineage_manifest_id" uuid,
      "created_at" timestamptz NOT NULL
    );
  `);
  return db;
}

test("migration 0011 collapses exact legacy retry duplicates and preserves lineage", async () => {
  const db = await legacyDatabase();
  try {
    const keeperId = "10000000-0000-4000-8000-000000000001";
    const duplicateId = "10000000-0000-4000-8000-000000000002";
    const childId = "10000000-0000-4000-8000-000000000003";
    const workspaceId = "20000000-0000-4000-8000-000000000001";
    await db.query(
      `INSERT INTO "package_installations"
        ("id", "workspace_id", "package_name", "package_version", "manifest", "computed_risk", "state", "status", "lineage_manifest_id", "created_at")
       VALUES
        ($1, $4, 'test_fixture_package', '1.0.0', '{"name":"test_fixture_package"}', 'advisory', 'available', 'installed', NULL, '2026-07-16T00:00:00Z'),
        ($2, $4, 'test_fixture_package', '1.0.0', '{"name":"test_fixture_package"}', 'advisory', 'available', 'installed', NULL, '2026-07-16T00:00:01Z'),
        ($3, $4, 'test_fixture_package', '2.0.0', '{"name":"test_fixture_package"}', 'advisory', 'private', 'pending_review', $2, '2026-07-16T00:00:02Z')`,
      [keeperId, duplicateId, childId, workspaceId],
    );

    await db.exec(migrationSql());

    const rows = await db.query<{ id: string; lineage_manifest_id: string | null }>(
      `SELECT "id", "lineage_manifest_id" FROM "package_installations" ORDER BY "id"`,
    );
    assert.deepEqual(rows.rows, [
      { id: keeperId, lineage_manifest_id: null },
      { id: childId, lineage_manifest_id: keeperId },
    ]);
    const indexes = await db.query<{ indexname: string }>(
      `SELECT "indexname" FROM "pg_indexes" WHERE "indexname" = 'package_installations_attachment_uq'`,
    );
    assert.equal(indexes.rows.length, 1);
  } finally {
    await db.close();
  }
});

test("migration 0011 aborts rather than deleting conflicting legacy duplicates", async () => {
  const db = await legacyDatabase();
  try {
    await db.exec(`
      INSERT INTO "package_installations"
        ("id", "workspace_id", "package_name", "package_version", "manifest", "computed_risk", "state", "status", "created_at")
      VALUES
        ('10000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001', 'test_fixture_package', '1.0.0', '{"name":"test_fixture_package"}', 'advisory', 'available', 'installed', '2026-07-16T00:00:00Z'),
        ('10000000-0000-4000-8000-000000000002', '20000000-0000-4000-8000-000000000001', 'test_fixture_package', '1.0.0', '{"name":"test_fixture_package"}', 'advisory', 'private', 'pending_review', '2026-07-16T00:00:01Z');
    `);
    await assert.rejects(
      () => db.exec(migrationSql()),
      /conflicting duplicate attachment identities/,
    );
  } finally {
    await db.close();
  }
});
