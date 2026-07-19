/**
 * Migration 0016 (TASK-010 review round-6, post-TASK-008-RM4) — proves the
 * UPGRADE path from the real 0015 snapshot, not a hand-approximated schema:
 * builds a database on migrations 0000-0015 only (a temp copy of the real
 * migrations folder truncated before 0016), seeds pre-migration-shaped rows
 * (a legacy JobPilot `flag` value; red-flag/preference-adjustment Memories
 * with no `lineage_revision`), then applies ONLY 0016 from another temp copy
 * truncated after 0016 via drizzle-orm's own migrator (which tracks
 * already-applied migrations, so re-running it against the SAME migrations
 * folder applies just the one new migration — never re-executes 0000-0015
 * or accidentally advances to a later migration). This is the
 * "upgrade/no-drift" evidence the coordinator asked for: the migration is
 * exercised via drizzle's real apply mechanism against a real prior schema
 * state, not fabricated from scratch.
 */
import assert from "node:assert/strict";
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { sql } from "drizzle-orm";
import { migrate } from "drizzle-orm/pglite/migrator";
import { createLocalDb, schema } from "../src/index.js";

const here = dirname(fileURLToPath(import.meta.url));

function realMigrationsFolder(): string {
  for (const relative of ["../migrations", "../../migrations"]) {
    const candidate = resolve(here, relative);
    if (readFileSyncSafe(join(candidate, "meta/_journal.json"))) return candidate;
  }
  throw new Error("migrations folder not found");
}
function readFileSyncSafe(path: string): string | null {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return null;
  }
}

type Journal = {
  entries: Array<{ idx: number; tag: string }>;
};

/** Copy the real migration history through `lastIdx`, removing every later
 * SQL/snapshot/journal entry so future migrations cannot change this test's
 * starting point or advance Drizzle's migration high-water mark. */
function migrationsThrough(lastIdx: number): string {
  const real = realMigrationsFolder();
  const dir = mkdtempSync(join(tmpdir(), `bridge-db-through-${lastIdx}-`));
  cpSync(real, dir, { recursive: true });
  const journal = JSON.parse(readFileSync(join(dir, "meta/_journal.json"), "utf8")) as Journal;
  for (const entry of journal.entries.filter(({ idx }) => idx > lastIdx)) {
    rmSync(join(dir, `${entry.tag}.sql`), { force: true });
    rmSync(join(dir, "meta", `${entry.tag.slice(0, 4)}_snapshot.json`), { force: true });
  }
  journal.entries = journal.entries.filter(({ idx }) => idx <= lastIdx);
  writeFileSync(join(dir, "meta/_journal.json"), JSON.stringify(journal, null, 2));
  return dir;
}

test("migration 0016 (upgrade path): backfills legacy JobPilot flag values and then enforces the CHECK constraint", async () => {
  const preDir = migrationsThrough(15);
  const through0016Dir = migrationsThrough(16);
  const { db, close } = await createLocalDb({ migrationsFolder: preDir });
  try {
    const [ws] = await db.insert(schema.workspaces).values({ name: "test_fixture_migration_0016_jobpilot" }).returning({ id: schema.workspaces.id });
    assert.ok(ws);
    const [job] = await db
      .insert(schema.jobpilotJobs)
      .values({ workspaceId: ws.id, title: "test_fixture_role", company: "test_fixture_co" })
      .returning({ id: schema.jobpilotJobs.id });
    assert.ok(job);
    // Three legacy-flag rows + one already-modern row — all writable pre-0016
    // since the CHECK constraint does not exist yet at this schema version.
    const legacyValues = ["green", "yellow", "red", "pursue"] as const;
    const appIdByValue = new Map<string, string>();
    for (const value of legacyValues) {
      const [app] = await db
        .insert(schema.jobpilotApplications)
        .values({ workspaceId: ws.id, jobId: job.id, flag: value })
        .returning({ id: schema.jobpilotApplications.id });
      assert.ok(app);
      appIdByValue.set(value, app.id);
    }

    // Apply ONLY 0016 (0000-0015 are already applied and tracked).
    await migrate(db, { migrationsFolder: through0016Dir });

    const rows = await db.select({ id: schema.jobpilotApplications.id, flag: schema.jobpilotApplications.flag }).from(schema.jobpilotApplications);
    const byId = new Map(rows.map((r) => [r.id, r.flag]));
    assert.equal(byId.get(appIdByValue.get("green")!), "pursue", "green must backfill to pursue");
    assert.equal(byId.get(appIdByValue.get("yellow")!), "review", "yellow must backfill to review");
    assert.equal(byId.get(appIdByValue.get("red")!), "pass", "red must backfill to pass");
    assert.equal(byId.get(appIdByValue.get("pursue")!), "pursue", "an already-modern value must pass through unchanged");

    // The CHECK constraint is now real — a fresh legacy write must fail.
    await assert.rejects(
      () => db.insert(schema.jobpilotApplications).values({ workspaceId: ws.id, jobId: job.id, flag: "green" }),
      (err: unknown) => String((err as { cause?: { message?: string } })?.cause?.message ?? err).includes("jobpilot_applications_flag_valid_ck"),
    );
    // A null flag and every modern value must still be writable.
    await db.insert(schema.jobpilotApplications).values({ workspaceId: ws.id, jobId: job.id, flag: null });
    await db.insert(schema.jobpilotApplications).values({ workspaceId: ws.id, jobId: job.id, flag: "review" });
  } finally {
    await close();
    rmSync(preDir, { recursive: true, force: true });
    rmSync(through0016Dir, { recursive: true, force: true });
  }
});

test("migration 0016 (upgrade path): adds memories.lineage_revision as a nullable, backward-compatible column (no backfill fabricated for pre-existing rows)", async () => {
  const preDir = migrationsThrough(15);
  const through0016Dir = migrationsThrough(16);
  const { db, close } = await createLocalDb({ migrationsFolder: preDir });
  try {
    const [ws] = await db.insert(schema.workspaces).values({ name: "test_fixture_migration_0016_memories" }).returning({ id: schema.workspaces.id });
    assert.ok(ws);
    const ownerUserId = "60000000-0000-4000-8000-000000000001";
    // Raw SQL (not the typed Drizzle insert builder): the CURRENT schema.ts
    // (and therefore `schema.memories`) already declares `lineage_revision`,
    // so a typed insert would always reference that column even against
    // this pre-0016 database, where it genuinely does not exist yet.
    const existingRows = await db.execute<{ id: string }>(sql`
      INSERT INTO memories (workspace_id, type, scope, content, confidence, trust_origin, plane, created_by, owner_user_id)
      VALUES (${ws.id}, 'semantic', 'private', ${JSON.stringify({ kind: "red_flag" })}, '1', 'user_content', 'local', ${ownerUserId}, ${ownerUserId})
      RETURNING id
    `);
    const existing = existingRows.rows[0];
    assert.ok(existing);

    await migrate(db, { migrationsFolder: through0016Dir });

    const [row] = await db.select({ lineageRevision: schema.memories.lineageRevision }).from(schema.memories).where(sql`${schema.memories.id} = ${existing.id}`);
    assert.equal(row?.lineageRevision, null, "a pre-migration row must get NULL, never a fabricated revision number");

    // A NEW row written after the migration can set a real revision (proving
    // the column is genuinely writable, not merely present).
    const [fresh] = await db
      .insert(schema.memories)
      .values({
        workspaceId: ws.id,
        type: "semantic",
        scope: "private",
        content: JSON.stringify({ kind: "red_flag" }),
        confidence: "1",
        trustOrigin: "user_content",
        plane: "local",
        createdBy: ownerUserId,
        ownerUserId,
        lineageRevision: 1,
      })
      .returning({ lineageRevision: schema.memories.lineageRevision });
    assert.equal(fresh?.lineageRevision, 1);
  } finally {
    await close();
    rmSync(preDir, { recursive: true, force: true });
    rmSync(through0016Dir, { recursive: true, force: true });
  }
});

test("migration 0016 (upgrade path): re-running the SAME migrations folder a second time is a no-op (idempotent, no drift)", async () => {
  const preDir = migrationsThrough(15);
  const through0016Dir = migrationsThrough(16);
  const { db, close } = await createLocalDb({ migrationsFolder: preDir });
  try {
    await migrate(db, { migrationsFolder: through0016Dir });
    // Re-applying against the identical (already-fully-migrated) folder must
    // not error and must not re-run 0016's statements a second time (which
    // would fail outright on the ADD COLUMN / ADD CONSTRAINT statements if
    // drizzle's own migration-tracking table were not being honored).
    await migrate(db, { migrationsFolder: through0016Dir });
  } finally {
    await close();
    rmSync(preDir, { recursive: true, force: true });
    rmSync(through0016Dir, { recursive: true, force: true });
  }
});
