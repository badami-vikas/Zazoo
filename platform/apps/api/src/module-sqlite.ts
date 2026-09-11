/**
 * One way to open a Module's own SQLite file (ADR-246/238): Accounting and
 * D2C each keep their own sqlite under the host-granted files root
 * (`~/Documents/Bridge/<Name>/.data/<name>.sqlite`), never `@bridge/db` or
 * the PGlite Local Plane. The Module owns schema + migrations; this is only
 * the open/migrate/cache/close grant they share.
 */
import Database from "better-sqlite3";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { mkdirSync } from "node:fs";

export interface ModuleSqliteOptions {
  /** Folder under ~/Documents/Bridge, e.g. "Accounting"; the file is `<name>.sqlite`. */
  name: string;
  /** Env var that overrides the resolved path (tests, packaged desktop). */
  envVar: string;
  /** Runs once per open against the raw connection, before the handle is cached. */
  migrate: (raw: Database.Database) => void;
}

export interface ModuleSqlite {
  open: () => Database.Database;
  close: () => void;
}

export function openModuleSqlite({ name, envVar, migrate }: ModuleSqliteOptions): ModuleSqlite {
  let cached: Database.Database | null = null;
  return {
    open() {
      if (cached) return cached;
      const file =
        process.env[envVar] ??
        join(homedir(), "Documents", "Bridge", name, ".data", `${name.toLowerCase()}.sqlite`);
      mkdirSync(dirname(file), { recursive: true });
      const raw = new Database(file);
      raw.pragma("journal_mode = WAL");
      raw.pragma("foreign_keys = ON");
      migrate(raw);
      cached = raw;
      return raw;
    },
    /** WAL leaves a `-wal` journal behind on an unclean exit; callers close on shutdown. */
    close() {
      cached?.close();
      cached = null;
    },
  };
}
