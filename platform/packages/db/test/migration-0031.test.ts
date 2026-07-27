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
import { createLocalDb } from "../src/index.js";

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
      // Try the source layout after the compiled layout.
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
    rmSync(join(dir, `meta/${String(entry.idx).padStart(4, "0")}_snapshot.json`), {
      force: true,
    });
  }
  journal.entries = journal.entries.filter(({ idx }) => idx <= lastIdx);
  writeFileSync(journalPath, `${JSON.stringify(journal, null, 2)}\n`);
  return dir;
}

test("migration 0031 upgrades existing data and installs owner-forced Chat RLS", async () => {
  const through0030 = migrationsThrough(30);
  const through0031 = migrationsThrough(31);
  const { db, client, close } = await createLocalDb({
    migrationsFolder: through0030,
  });
  const organizationId = "10000000-0000-4000-8000-000000000131";
  const userId = "20000000-0000-4000-8000-000000000131";
  try {
    await client.exec(`
      INSERT INTO users (id, email)
      VALUES ('${userId}', 'task026-migration@example.test');
      INSERT INTO organizations (id, name)
      VALUES ('${organizationId}', 'TASK-026 migration fixture');
    `);

    await migrate(db, { migrationsFolder: through0031 });
    await migrate(db, { migrationsFolder: through0031 });

    const retained = await client.query<{ name: string }>(`
      SELECT name FROM organizations WHERE id = '${organizationId}'
    `);
    assert.deepEqual(retained.rows, [{ name: "TASK-026 migration fixture" }]);
    const rls = await client.query<{
      relname: string;
      enabled: boolean;
      forced: boolean;
      policies: string;
    }>(`
      SELECT c.relname,
             c.relrowsecurity AS enabled,
             c.relforcerowsecurity AS forced,
             count(p.policyname)::text AS policies
      FROM pg_class c
      LEFT JOIN pg_policies p ON p.tablename = c.relname
      WHERE c.relname IN ('chat_threads', 'chat_turns', 'chat_turn_refs')
      GROUP BY c.relname, c.relrowsecurity, c.relforcerowsecurity
      ORDER BY c.relname
    `);
    assert.deepEqual(rls.rows, [
      { relname: "chat_threads", enabled: true, forced: true, policies: "4" },
      { relname: "chat_turn_refs", enabled: true, forced: true, policies: "3" },
      { relname: "chat_turns", enabled: true, forced: true, policies: "4" },
    ]);

    await assert.rejects(
      client.exec(`
        INSERT INTO chat_threads (
          id, organization_id, owner_user_id, plane, data_scope
        ) VALUES (
          '30000000-0000-4000-8000-000000000131',
          '${organizationId}',
          '${userId}',
          'cloud',
          'private'
        )
      `),
      /chat_threads_plane_scope_check/,
    );

    const threadId = "30000000-0000-4000-8000-000000000132";
    const turnId = "40000000-0000-4000-8000-000000000132";
    const refId = "50000000-0000-4000-8000-000000000132";
    await client.exec(`
      INSERT INTO chat_threads (
        id, organization_id, owner_user_id, plane, data_scope
      ) VALUES (
        '${threadId}', '${organizationId}', '${userId}', 'local', 'private'
      );
      INSERT INTO chat_turns (
        id,
        organization_id,
        owner_user_id,
        thread_id,
        sequence,
        role,
        actor_type,
        actor_id,
        content,
        state,
        client_request_id,
        request_fingerprint,
        taint_label
      ) VALUES (
        '${turnId}',
        '${organizationId}',
        '${userId}',
        '${threadId}',
        1,
        'assistant',
        'agent',
        'internal-strategist',
        '',
        'queued',
        'migration-turn',
        'sha256:0000000000000000000000000000000000000000000000000000000000000000',
        '{"version":1,"trust":"human","source":"human_input","sensitivity":"private","instructionRisk":"instruction_like","originChain":[],"provenanceHash":"test"}'::jsonb
      );
      INSERT INTO chat_turn_refs (
        id, organization_id, owner_user_id, thread_id, turn_id, kind, ref_id
      ) VALUES (
        '${refId}',
        '${organizationId}',
        '${userId}',
        '${threadId}',
        '${turnId}',
        'proposal',
        '60000000-0000-4000-8000-000000000132'
      );
      SET ROLE bridge_app;
      SELECT set_config('app.organization_id', '${organizationId}', false);
      SELECT set_config('app.user_id', '${userId}', false);
    `);
    await assert.rejects(
      client.exec(`
        UPDATE chat_turns
        SET actor_id = 'forged-agent'
        WHERE id = '${turnId}'
      `),
      /permission denied|Failed query/i,
    );
    await assert.rejects(
      client.exec(`DELETE FROM chat_turn_refs WHERE id = '${refId}'`),
      /permission denied|Failed query/i,
    );
    await assert.rejects(
      client.exec(`DELETE FROM chat_turns WHERE id = '${turnId}'`),
      /permission denied|Failed query/i,
    );
    await client.exec(`
      UPDATE chat_turns
      SET state = 'processing', updated_at = now()
      WHERE id = '${turnId}'
    `);
    await assert.rejects(
      client.exec(`
        UPDATE chat_turns
        SET state = 'queued', updated_at = now()
        WHERE id = '${turnId}'
      `),
      /invalid chat turn transition|Failed query/i,
    );
    await client.exec(`DELETE FROM chat_threads WHERE id = '${threadId}'`);
    const cascaded = await client.query<{ count: string }>(`
      SELECT count(*)::text AS count
      FROM chat_turns
      WHERE id = '${turnId}'
    `);
    assert.deepEqual(cascaded.rows, [{ count: "0" }]);
  } finally {
    await close();
    rmSync(through0030, { recursive: true, force: true });
    rmSync(through0031, { recursive: true, force: true });
  }
});
