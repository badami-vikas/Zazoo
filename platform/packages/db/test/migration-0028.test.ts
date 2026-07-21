import assert from "node:assert/strict";
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
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
      // Try source and compiled layouts.
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

test("migration 0028 preserves proposals/installations and adds durable recertification metadata", async () => {
  const through0027 = migrationsThrough(27);
  const through0028 = migrationsThrough(28);
  const dataDir = mkdtempSync(join(tmpdir(), "bridge-db-0028-upgrade-"));
  const organizationId = "10000000-0000-4000-8000-000000000028";
  const taskId = "20000000-0000-4000-8000-000000000028";
  const proposalId = "30000000-0000-4000-8000-000000000028";
  try {
    const before = await createLocalDb({ dataDir, migrationsFolder: through0027 });
    await before.client.exec(`
      INSERT INTO organizations (id, name) VALUES ('${organizationId}', 'Recertification migration');
      INSERT INTO tasks (id, organization_id, path, title, type, is_goal)
      VALUES ('${taskId}', '${organizationId}', '1', 'Preserved Task', 'task', true);
      INSERT INTO task_change_proposals (id, organization_id, kind, task_id, actor_id, payload)
      VALUES ('${proposalId}', '${organizationId}', 'archive_sweep', '${taskId}', 'governance', '{"taskIds":[]}');
    `);
    await before.close();

    const migrated = await createLocalDb({ dataDir, migrationsFolder: through0028 });
    const proposal = await migrated.client.query<{
      id: string;
      idempotency_key: string | null;
      result: unknown;
    }>(`SELECT id, idempotency_key, result FROM task_change_proposals WHERE id = '${proposalId}'`);
    assert.deepEqual(proposal.rows, [{ id: proposalId, idempotency_key: null, result: null }]);
    const commonsColumn = await migrated.client.query<{ exists: boolean }>(`
      SELECT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'module_installations' AND column_name = 'commons_source'
      ) AS exists
    `);
    assert.equal(commonsColumn.rows[0]?.exists, true);
    await migrated.close();

    const replayed = await createLocalDb({ dataDir, migrationsFolder: through0028 });
    const count = await replayed.client.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM task_change_proposals WHERE id = '${proposalId}'`,
    );
    assert.equal(count.rows[0]?.count, "1");
    await replayed.close();
  } finally {
    for (const dir of [through0027, through0028, dataDir]) rmSync(dir, { recursive: true, force: true });
  }
});

test("migration 0028 applies cleanly to a fresh database", async () => {
  const through0028 = migrationsThrough(28);
  try {
    const { client, close } = await createLocalDb({ migrationsFolder: through0028 });
    const rows = await client.query<{ count: string }>(`SELECT count(*)::text AS count FROM task_change_proposals`);
    assert.equal(rows.rows[0]?.count, "0");
    await close();
  } finally {
    rmSync(through0028, { recursive: true, force: true });
  }
});
