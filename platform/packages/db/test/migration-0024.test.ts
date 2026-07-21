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

async function readOutput(
  client: Awaited<ReturnType<typeof createLocalDb>>["client"],
  ledgerId: string,
): Promise<Record<string, unknown>> {
  const result = await client.query<{ proposed_output: Record<string, unknown> }>(
    `SELECT "proposed_output" FROM "ledger" WHERE "id" = $1`,
    [ledgerId],
  );
  return result.rows[0]?.proposed_output ?? {};
}

test("migration 0024 preserves stored culture Results through backup, restore, and replay", async () => {
  const through0023 = migrationsThrough(23);
  const through0024 = migrationsThrough(24);
  const dataDir = mkdtempSync(join(tmpdir(), "bridge-db-0024-source-"));
  const backupDir = mkdtempSync(join(tmpdir(), "bridge-db-0024-backup-"));
  const organizationId = "10000000-0000-4000-8000-000000000024";
  const actorId = "20000000-0000-4000-8000-000000000024";
  const ledgerId = "30000000-0000-4000-8000-000000000024";

  try {
    const before = await createLocalDb({ dataDir, migrationsFolder: through0023 });
    await before.client.exec(`
      INSERT INTO "organizations" ("id", "name")
      VALUES ('${organizationId}', 'Compatibility deletion fixture');
      INSERT INTO "ledger" (
        "id", "organization_id", "actor_type", "actor_id", "action",
        "resource_type", "proposed_output"
      ) VALUES (
        '${ledgerId}', '${organizationId}', 'agent', '${actorId}',
        'jobpilot.synthesizeCultureProfile', 'result',
        '{"artifactHashes":[{"sourceId":"source-1","contentHash":"hash-1"}],"summary":"preserved"}'
      );
    `);
    await before.close();

    rmSync(backupDir, { recursive: true, force: true });
    cpSync(dataDir, backupDir, { recursive: true });

    const migrated = await createLocalDb({ dataDir, migrationsFolder: through0024 });
    assert.deepEqual(await readOutput(migrated.client, ledgerId), {
      resultHashes: [{ sourceId: "source-1", contentHash: "hash-1" }],
      summary: "preserved",
    });
    await migrated.close();

    const restored = await createLocalDb({ dataDir: backupDir, migrationsFolder: through0023 });
    assert.deepEqual(await readOutput(restored.client, ledgerId), {
      artifactHashes: [{ sourceId: "source-1", contentHash: "hash-1" }],
      summary: "preserved",
    });
    await restored.close();

    const recovered = await createLocalDb({ dataDir: backupDir, migrationsFolder: through0024 });
    assert.deepEqual(await readOutput(recovered.client, ledgerId), {
      resultHashes: [{ sourceId: "source-1", contentHash: "hash-1" }],
      summary: "preserved",
    });
    await recovered.close();

    const replayed = await createLocalDb({ dataDir: backupDir, migrationsFolder: through0024 });
    assert.deepEqual(await readOutput(replayed.client, ledgerId), {
      resultHashes: [{ sourceId: "source-1", contentHash: "hash-1" }],
      summary: "preserved",
    });
    await replayed.close();
  } finally {
    for (const dir of [through0023, through0024, dataDir, backupDir]) {
      rmSync(dir, { recursive: true, force: true });
    }
  }
});

test("migration 0024 applies cleanly to a fresh database", async () => {
  const through0024 = migrationsThrough(24);
  try {
    const { client, close } = await createLocalDb({ migrationsFolder: through0024 });
    const result = await client.query<{ count: string }>(
      `SELECT count(*)::text AS "count" FROM "ledger"`,
    );
    assert.equal(result.rows[0]?.count, "0");
    await close();
  } finally {
    rmSync(through0024, { recursive: true, force: true });
  }
});
