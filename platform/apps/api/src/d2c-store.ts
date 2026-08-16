/**
 * The D2C Module's own SQLite database (ADR-246/238).
 *
 * Same shape as `accounting-store.ts` for the same reason: its own sqlite,
 * inside the host-granted files root, never `@bridge/db`/PGlite. D2C's
 * migrations are plain SQL strings (`d2c-migrations.ts`, imported verbatim
 * from CV Naturals) rather than drizzle-kit's file-based migrator, so they
 * are applied directly against a small tracking table — the same idea as
 * drizzle's own `__drizzle_migrations`, hand-rolled because there is no
 * migrations FOLDER here to point the real migrator at.
 */
import Database from "better-sqlite3";
import { drizzle, type BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { mkdirSync } from "node:fs";

import * as schema from "./d2c-schema.js";
import { MIGRATIONS } from "./d2c-migrations.js";

export type D2CDb = BetterSQLite3Database<typeof schema>;
export { schema as d2cSchema };

function dbPath(): string {
  return (
    process.env.BRIDGE_D2C_DB_PATH ?? join(homedir(), "Documents", "Bridge", "D2C", ".data", "d2c.sqlite")
  );
}

function applyMigrations(raw: Database.Database): void {
  raw.exec(
    "CREATE TABLE IF NOT EXISTS _d2c_migrations (tag text PRIMARY KEY NOT NULL, applied_at text NOT NULL DEFAULT (datetime('now')))",
  );
  const applied = new Set(
    raw.prepare("SELECT tag FROM _d2c_migrations").all().map((row) => (row as { tag: string }).tag),
  );
  const insertApplied = raw.prepare("INSERT INTO _d2c_migrations (tag) VALUES (?)");
  for (const migration of MIGRATIONS) {
    if (applied.has(migration.tag)) continue;
    raw.exec(migration.sql);
    insertApplied.run(migration.tag);
  }
}

let cached: { db: D2CDb; raw: Database.Database } | null = null;

export function getD2CDb(): D2CDb {
  return getD2CConnection().db;
}

export function getD2CConnection(): { db: D2CDb; raw: Database.Database } {
  if (cached) return cached;

  const file = dbPath();
  mkdirSync(dirname(file), { recursive: true });
  const raw = new Database(file);
  raw.pragma("journal_mode = WAL");
  raw.pragma("foreign_keys = ON");

  applyMigrations(raw);
  const db = drizzle(raw, { schema });

  cached = { db, raw };
  return cached;
}

export function closeD2CConnection(): void {
  if (cached) {
    cached.raw.close();
    cached = null;
  }
}
