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

test("migration 0027 collapses legacy Goal rows into one Task tree without identity or assignment loss", async () => {
  const through0026 = migrationsThrough(26);
  const through0027 = migrationsThrough(27);
  const dataDir = mkdtempSync(join(tmpdir(), "bridge-db-0027-upgrade-"));
  const organizationId = "10000000-0000-4000-8000-000000000027";
  const agentId = "20000000-0000-4000-8000-000000000027";
  const goalId = "30000000-0000-4000-8000-000000000027";
  const taskId = "40000000-0000-4000-8000-000000000027";
  try {
    const before = await createLocalDb({ dataDir, migrationsFolder: through0026 });
    await before.client.exec(`
      INSERT INTO organizations (id, name) VALUES ('${organizationId}', 'Task Manager migration fixture');
      INSERT INTO agents (id, organization_id, name) VALUES ('${agentId}', '${organizationId}', 'Migration Agent');
      INSERT INTO goals (id, organization_id, type, title)
      VALUES ('${goalId}', '${organizationId}', 'task-manager', 'Preserved goal title');
      INSERT INTO tasks (id, organization_id, goal_id, type, assigned_agent_id, status)
      VALUES ('${taskId}', '${organizationId}', '${goalId}', 'build', '${agentId}', 'open');
    `);
    await before.close();

    const migrated = await createLocalDb({ dataDir, migrationsFolder: through0027 });
    const rows = await migrated.client.query<{
      id: string;
      parent_task_id: string | null;
      anchor_task_id: string | null;
      path: string;
      is_goal: boolean;
      assigned_agent_id: string | null;
    }>(`
      SELECT id, parent_task_id, anchor_task_id, path, is_goal, assigned_agent_id
      FROM tasks
      WHERE organization_id = '${organizationId}'
      ORDER BY path
    `);
    assert.deepEqual(rows.rows, [
      {
        id: goalId,
        parent_task_id: null,
        anchor_task_id: null,
        path: "1",
        is_goal: true,
        assigned_agent_id: null,
      },
      {
        id: taskId,
        parent_task_id: goalId,
        anchor_task_id: goalId,
        path: "1.1",
        is_goal: false,
        assigned_agent_id: agentId,
      },
    ]);
    const legacy = await migrated.client.query<{ relation: string | null }>(
      `SELECT to_regclass('public.goals')::text AS relation`,
    );
    assert.equal(legacy.rows[0]?.relation, null);
    const policy = await migrated.client.query<{ policyname: string }>(
      `SELECT policyname FROM pg_policies WHERE tablename = 'task_change_proposals'`,
    );
    assert.deepEqual(policy.rows.map((row) => row.policyname), ["task_change_proposals_tenant_all"]);
    await migrated.close();

    const replayed = await createLocalDb({ dataDir, migrationsFolder: through0027 });
    const count = await replayed.client.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM tasks WHERE organization_id = '${organizationId}'`,
    );
    assert.equal(count.rows[0]?.count, "2");
    await replayed.close();
  } finally {
    for (const dir of [through0026, through0027, dataDir]) rmSync(dir, { recursive: true, force: true });
  }
});

test("migration 0027 applies cleanly to a fresh database", async () => {
  const through0027 = migrationsThrough(27);
  try {
    const { client, close } = await createLocalDb({ migrationsFolder: through0027 });
    const tasks = await client.query<{ count: string }>(`SELECT count(*)::text AS count FROM tasks`);
    assert.equal(tasks.rows[0]?.count, "0");
    await close();
  } finally {
    rmSync(through0027, { recursive: true, force: true });
  }
});
