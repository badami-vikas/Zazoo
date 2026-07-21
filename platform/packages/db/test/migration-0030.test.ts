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
      // Try source layout after compiled layout.
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

test("migration 0030 adds the canonical Event index without data loss and replays", async () => {
  const through0029 = migrationsThrough(29);
  const through0030 = migrationsThrough(30);
  const { db, client, close } = await createLocalDb({
    migrationsFolder: through0029,
  });
  const organizationId = "76000000-0000-4000-8000-000000000001";
  const eventId = "77000000-0000-4000-8000-000000000001";
  try {
    await client.exec(`
      INSERT INTO organizations (id, name)
      VALUES ('${organizationId}', 'TASK-016 migration fixture');
      INSERT INTO events (id, organization_id, type, entity_type, entity_id, payload)
      VALUES (
        '${eventId}',
        '${organizationId}',
        'task016.index',
        'event',
        '${eventId}',
        '{"preserve":true}'
      );
    `);

    await migrate(db, { migrationsFolder: through0030 });
    await migrate(db, { migrationsFolder: through0030 });

    const indexes = await client.query<{ indexname: string }>(`
      SELECT indexname
      FROM pg_indexes
      WHERE tablename = 'events' AND indexname = 'events_org_created_idx'
    `);
    assert.deepEqual(indexes.rows, [{ indexname: "events_org_created_idx" }]);
    const retained = await client.query<{ preserve: boolean }>(`
      SELECT (payload ->> 'preserve')::boolean AS preserve
      FROM events
      WHERE id = '${eventId}'
    `);
    assert.deepEqual(retained.rows, [{ preserve: true }]);
  } finally {
    await close();
    rmSync(through0029, { recursive: true, force: true });
    rmSync(through0030, { recursive: true, force: true });
  }
});
