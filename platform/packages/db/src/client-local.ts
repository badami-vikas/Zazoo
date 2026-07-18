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
  /** Optional query observer used by bounded-query regression tests. */
  queryLogger?: { logQuery(query: string, params: unknown[]): void };
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
const LEGACY_EXTERNAL_RECORDS = "local_external_records_legacy";

async function hasLegacyExternalRecordShape(
  client: PGlite,
  tableName: string,
): Promise<boolean> {
  const result = await client.query<{
    column_name: string;
    data_type: string;
  }>(
    `SELECT column_name, data_type
       FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = $1`,
    [tableName],
  );
  const columns = new Map(
    result.rows.map((row) => [row.column_name, row.data_type]),
  );
  return (
    columns.get("workspace_id") === "text" &&
    columns.get("source") === "text" &&
    columns.get("source_record_id") === "text" &&
    columns.get("entity_type") === "text" &&
    columns.get("entity_id") === "text" &&
    columns.get("created_at") === "text"
  );
}

/**
 * Early Local Plane compatibility repair. The first Local adapter used the
 * canonical `external_records` name with text identifiers. Move that table
 * aside before Drizzle migration 0000 creates its UUID/FK-backed table.
 */
export async function prepareLegacyLocalExternalRecords(
  client: PGlite,
): Promise<void> {
  const backupExists = await client.query<{ exists: boolean }>(
    `SELECT to_regclass('public.${LEGACY_EXTERNAL_RECORDS}') IS NOT NULL AS exists`,
  );
  const hasBackup = backupExists.rows[0]?.exists === true;
  const backupIsLegacy =
    hasBackup &&
    (await hasLegacyExternalRecordShape(client, LEGACY_EXTERNAL_RECORDS));
  if (hasBackup && !backupIsLegacy) {
    throw new Error(
      `${LEGACY_EXTERNAL_RECORDS} exists with an unsupported schema`,
    );
  }
  if (!(await hasLegacyExternalRecordShape(client, "external_records"))) return;
  if (backupIsLegacy) {
    await client.exec(`
      INSERT INTO ${LEGACY_EXTERNAL_RECORDS}
        (workspace_id, source, source_record_id, entity_type, entity_id, created_at)
      SELECT workspace_id, source, source_record_id, entity_type, entity_id, created_at
        FROM external_records
      ON CONFLICT (workspace_id, source, source_record_id) DO UPDATE SET
        entity_type = EXCLUDED.entity_type,
        entity_id = EXCLUDED.entity_id,
        created_at = EXCLUDED.created_at;
      DROP TABLE external_records;
    `);
    return;
  }
  await client.exec(
    `ALTER TABLE external_records RENAME TO ${LEGACY_EXTERNAL_RECORDS}`,
  );
}

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
    await prepareLegacyLocalExternalRecords(client);
    const db = drizzle(client, {
      schema,
      ...(config.queryLogger ? { logger: config.queryLogger } : {}),
    });
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
