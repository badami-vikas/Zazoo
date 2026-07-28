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

test("migration 0034 adds nullable deal-signal columns without weakening RLS", async () => {
  const through0034 = migrationsThrough(34);
  const { client, close } = await createLocalDb({ migrationsFolder: through0034 });
  try {
    // The six new signal columns exist, with the expected types, and every one
    // is NULLABLE — an unscored deal is an honest empty cell, never a default.
    const columns = await client.query<{
      column_name: string;
      data_type: string;
      is_nullable: string;
    }>(`
      SELECT column_name, data_type, is_nullable
      FROM information_schema.columns
      WHERE table_name = 'dealpilot_deals'
        AND column_name IN ('rag', 'fit_score', 'evidence_score', 'p0_flags', 'thesis_tag', 'source_channel')
      ORDER BY column_name
    `);
    assert.deepEqual(columns.rows, [
      { column_name: "evidence_score", data_type: "integer", is_nullable: "YES" },
      { column_name: "fit_score", data_type: "integer", is_nullable: "YES" },
      { column_name: "p0_flags", data_type: "integer", is_nullable: "YES" },
      { column_name: "rag", data_type: "text", is_nullable: "YES" },
      { column_name: "source_channel", data_type: "text", is_nullable: "YES" },
      { column_name: "thesis_tag", data_type: "text", is_nullable: "YES" },
    ]);

    // Forced tenant RLS from 0033 is untouched by the ADD COLUMNs.
    const rls = await client.query<{ enabled: boolean; forced: boolean; policies: string }>(`
      SELECT c.relrowsecurity AS enabled,
             c.relforcerowsecurity AS forced,
             count(p.policyname)::text AS policies
      FROM pg_class c
      LEFT JOIN pg_policies p ON p.tablename = c.relname
      WHERE c.relname = 'dealpilot_deals'
      GROUP BY c.relrowsecurity, c.relforcerowsecurity
    `);
    assert.deepEqual(rls.rows, [{ enabled: true, forced: true, policies: "1" }]);
  } finally {
    await close();
    rmSync(through0034, { recursive: true, force: true });
  }
});
