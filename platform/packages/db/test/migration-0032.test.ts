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

test("migration 0032 upgrades Chat storage with constrained owner-forced cloud grants", async () => {
  const through0031 = migrationsThrough(31);
  const through0032 = migrationsThrough(32);
  const { db, client, close } = await createLocalDb({
    migrationsFolder: through0031,
  });
  const organizationId = "10000000-0000-4000-8000-000000000132";
  const userId = "20000000-0000-4000-8000-000000000132";
  const threadId = "30000000-0000-4000-8000-000000000132";
  try {
    await client.exec(`
      INSERT INTO users (id, email)
      VALUES ('${userId}', 'task026-cloud-migration@example.test');
      INSERT INTO organizations (id, name)
      VALUES ('${organizationId}', 'TASK-026 cloud migration fixture');
      INSERT INTO chat_threads (
        id, organization_id, owner_user_id, plane, data_scope
      ) VALUES (
        '${threadId}', '${organizationId}', '${userId}', 'cloud', 'public'
      );
    `);

    await migrate(db, { migrationsFolder: through0032 });
    await migrate(db, { migrationsFolder: through0032 });

    const retained = await client.query<{ id: string }>(`
      SELECT id::text FROM chat_threads WHERE id = '${threadId}'
    `);
    assert.deepEqual(retained.rows, [{ id: threadId }]);
    const posture = await client.query<{
      enabled: boolean;
      forced: boolean;
      policies: string;
    }>(`
      SELECT c.relrowsecurity AS enabled,
             c.relforcerowsecurity AS forced,
             count(p.policyname)::text AS policies
      FROM pg_class c
      LEFT JOIN pg_policies p ON p.tablename = c.relname
      WHERE c.relname = 'chat_cloud_grants'
      GROUP BY c.relrowsecurity, c.relforcerowsecurity
    `);
    assert.deepEqual(posture.rows, [{
      enabled: true,
      forced: true,
      policies: "3",
    }]);

    await assert.rejects(
      client.exec(`
        INSERT INTO chat_cloud_grants (
          id, organization_id, owner_user_id, thread_id,
          context_digest, provider_id, model_tier, expires_at
        ) VALUES (
          '60000000-0000-4000-8000-000000000132',
          '${organizationId}', '${userId}', '${threadId}',
          'not-a-digest', 'anthropic', 'default', '2099-01-01T00:00:00.000Z'
        )
      `),
      /chat_cloud_grants_digest_check/,
    );
    const grantId = "60000000-0000-4000-8000-000000000133";
    await client.exec(`
      INSERT INTO chat_cloud_grants (
        id, organization_id, owner_user_id, thread_id,
        context_digest, provider_id, model_tier, expires_at
      ) VALUES (
        '${grantId}', '${organizationId}', '${userId}', '${threadId}',
        'sha256:${"a".repeat(64)}', 'anthropic', 'default',
        '2099-01-01T00:00:00.000Z'
      )
    `);
    await assert.rejects(
      client.exec(`
        UPDATE chat_cloud_grants
        SET provider_id = 'groq'
        WHERE id = '${grantId}'
      `),
      /binding fields are immutable/,
    );
    await client.exec(`
      UPDATE chat_cloud_grants
      SET consumed_at = CURRENT_TIMESTAMP
      WHERE id = '${grantId}'
    `);
    await assert.rejects(
      client.exec(`
        UPDATE chat_cloud_grants
        SET consumed_at = NULL
        WHERE id = '${grantId}'
      `),
      /only transition from unconsumed to consumed/,
    );
  } finally {
    await close();
    rmSync(through0031, { recursive: true, force: true });
    rmSync(through0032, { recursive: true, force: true });
  }
});
