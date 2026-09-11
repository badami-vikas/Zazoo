/**
 * The D2C Module's own SQLite database (ADR-246/238), opened through the same
 * `openModuleSqlite` grant as Accounting. Schema and migrations live in the
 * Module (`@bridge/d2c/drizzle-schema`, `@bridge/d2c/migrations`); this file
 * only applies them.
 *
 * ponytail: string-ledger migrations; move to drizzle-kit only with a one-time
 * ledger import (`_d2c_migrations` -> `__drizzle_migrations`), otherwise an
 * already-migrated install re-runs CREATE TABLE.
 */
import type Database from "better-sqlite3";
import { drizzle, type BetterSQLite3Database } from "drizzle-orm/better-sqlite3";

import * as schema from "@bridge/d2c/drizzle-schema";
import { MIGRATIONS } from "@bridge/d2c/migrations";

import { openModuleSqlite } from "./module-sqlite.js";

export type D2CDb = BetterSQLite3Database<typeof schema>;
export { schema as d2cSchema };

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

const store = openModuleSqlite({ name: "D2C", envVar: "BRIDGE_D2C_DB_PATH", migrate: applyMigrations });

export function getD2CDb(): D2CDb {
  return getD2CConnection().db;
}

export function getD2CConnection(): { db: D2CDb; raw: Database.Database } {
  const raw = store.open();
  return { db: drizzle(raw, { schema }), raw };
}

export function closeD2CConnection(): void {
  store.close();
}
