import assert from "node:assert/strict";
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
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
    rmSync(join(dir, `meta/${String(entry.idx).padStart(4, "0")}_snapshot.json`), { force: true });
  }
  journal.entries = journal.entries.filter(({ idx }) => idx <= lastIdx);
  writeFileSync(journalPath, `${JSON.stringify(journal, null, 2)}\n`);
  return dir;
}

test("migration 0033 creates DealPilot Cloud-Plane tables with forced tenant RLS", async () => {
  const through0033 = migrationsThrough(33);
  const { client, close } = await createLocalDb({ migrationsFolder: through0033 });
  try {
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
      WHERE c.relname IN ('dealpilot_deals', 'dealpilot_sources', 'dealpilot_theses', 'dealpilot_relations')
      GROUP BY c.relname, c.relrowsecurity, c.relforcerowsecurity
      ORDER BY c.relname
    `);
    assert.deepEqual(rls.rows, [
      { relname: "dealpilot_deals", enabled: true, forced: true, policies: "1" },
      { relname: "dealpilot_relations", enabled: true, forced: true, policies: "1" },
      { relname: "dealpilot_sources", enabled: true, forced: true, policies: "1" },
      { relname: "dealpilot_theses", enabled: true, forced: true, policies: "1" },
    ]);

    // The credential pointer columns exist but never hold secrets (canon).
    const columns = await client.query<{ column_name: string }>(`
      SELECT column_name FROM information_schema.columns
      WHERE table_name = 'dealpilot_sources'
        AND column_name IN ('credential_ref', 'credential_owner_id')
      ORDER BY column_name
    `);
    assert.deepEqual(
      columns.rows.map((row) => row.column_name),
      ["credential_owner_id", "credential_ref"],
    );
  } finally {
    await close();
    rmSync(through0033, { recursive: true, force: true });
  }
});
