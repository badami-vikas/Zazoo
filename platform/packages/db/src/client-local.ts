/**
 * Local-plane Postgres via pglite (in-process, file-backed or in-memory).
 *
 * This is the customer-controlled store from the two-plane residency model
 * (docs/wiki/architecture.md, decisions.md). Private relationship data — captured
 * media, DM/post bodies, OAuth tokens — persists HERE, on the user's machine/VPC,
 * and NEVER reaches cloud Supabase. It binds the SAME Drizzle schema as the cloud
 * client (client.ts), so `createDrizzlePorts()` works unchanged against either
 * plane. This is the "local store" the wiki names as the priority track — the
 * adapter that lets residency hold instead of "today all cloud Supabase".
 */
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { vector } from "@electric-sql/pglite/vector";
import { drizzle, type PgliteDatabase } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import * as schema from "./schema.js";

export type LocalDatabase = PgliteDatabase<typeof schema>;

export interface LocalDbConfig {
  /**
   * Filesystem path for the local datastore (the local plane lives here).
   * Omit for an ephemeral in-memory pglite — used by tests.
   */
  dataDir?: string;
  /**
   * Folder of generated SQL migrations to apply on open. Defaults to this
   * package's `migrations/` dir, resolved for both source (vitest) and compiled
   * (dist) layouts.
   */
  migrationsFolder?: string;
}

export class LocalDbInitializationCleanupError extends AggregateError {
  constructor(initializationError: unknown, closeError: unknown) {
    super(
      [initializationError, closeError],
      "Local Plane database initialization failed and its PGlite client could not be closed",
    );
    this.name = "LocalDbInitializationCleanupError";
  }
}

const here = dirname(fileURLToPath(import.meta.url));

/** Resolve packages/db/migrations whether running from src/ (vitest) or dist/src/. */
function defaultMigrationsFolder(): string {
  for (const rel of ["../migrations", "../../migrations"]) {
    const candidate = resolve(here, rel);
    if (existsSync(resolve(candidate, "meta/_journal.json"))) return candidate;
  }
  return resolve(here, "../migrations");
}

/**
 * Open the local-plane store, apply migrations, and return a Drizzle handle plus
 * a close fn. The handle is shape-compatible with the cloud `Database`, so the
 * same port bindings (`createDrizzlePorts`) drive either plane.
 */
export async function createLocalDb(
  config: LocalDbConfig = {},
): Promise<{ db: LocalDatabase; client: PGlite; close: () => Promise<void> }> {
  // pgvector lives in the cloud schema (embedding columns). pglite ships it as a
  // loadable extension; register it and CREATE it before migrations run, because
  // the generated DDL (0000) references vector(768) without creating the extension
  // itself — that CREATE EXTENSION lives in the non-journaled governance seed.
  const client = new PGlite(
    config.dataDir
      ? { dataDir: config.dataDir, extensions: { vector } }
      : { extensions: { vector } }, // no dataDir => in-memory
  );
  try {
    await client.exec("CREATE EXTENSION IF NOT EXISTS vector;");
    const db = drizzle(client, { schema });
    await migrate(db, {
      migrationsFolder: config.migrationsFolder ?? defaultMigrationsFolder(),
    });
    return { db, client, close: () => client.close() };
  } catch (error) {
    try {
      await client.close();
    } catch (closeError) {
      throw new LocalDbInitializationCleanupError(error, closeError);
    }
    throw error;
  }
}
