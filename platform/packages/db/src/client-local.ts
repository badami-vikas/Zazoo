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
   * module's `migrations/` dir, resolved for both source (vitest) and compiled
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
const LEGACY_EXTERNAL_RECORD_COLUMNS = new Map([
  ["organization_id", "text"],
  ["source", "text"],
  ["source_record_id", "text"],
  ["entity_type", "text"],
  ["entity_id", "text"],
  ["created_at", "text"],
]);

type ExternalRecordTableShape =
  | "missing"
  | "legacy"
  | "canonical"
  | "unsupported";

async function inspectExternalRecordTable(
  client: PGlite,
  tableName: string,
): Promise<ExternalRecordTableShape> {
  const result = await client.query<{
    column_name: string;
    data_type: string;
  }>(
    `SELECT column_name, data_type
       FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = $1`,
    [tableName],
  );
  if (result.rows.length === 0) return "missing";
  const columns = new Map(
    result.rows.map((row) => [row.column_name, row.data_type]),
  );
  const isExactLegacyShape =
    columns.size === LEGACY_EXTERNAL_RECORD_COLUMNS.size &&
    [...LEGACY_EXTERNAL_RECORD_COLUMNS].every(
      ([name, dataType]) => columns.get(name) === dataType,
    );
  if (isExactLegacyShape) return "legacy";
  if (
    tableName === "external_records" &&
    columns.get("id") === "uuid" &&
    columns.get("organization_id") === "uuid" &&
    columns.get("source") === "text" &&
    columns.get("source_record_id") === "text" &&
    columns.get("entity_type") === "text" &&
    columns.get("entity_id") === "uuid" &&
    columns.get("created_at") === "timestamp with time zone"
  ) {
    return "canonical";
  }
  return "unsupported";
}

/**
 * Early Local Plane compatibility repair. The first Local adapter used the
 * canonical `external_records` name with text identifiers. Move that table
 * aside before Drizzle migration 0000 creates its UUID/FK-backed table.
 */
export async function prepareLegacyLocalExternalRecords(
  client: PGlite,
): Promise<void> {
  const backupShape = await inspectExternalRecordTable(
    client,
    LEGACY_EXTERNAL_RECORDS,
  );
  if (backupShape === "unsupported" || backupShape === "canonical") {
    throw new Error(
      `${LEGACY_EXTERNAL_RECORDS} exists with an unsupported schema`,
    );
  }
  const sourceShape = await inspectExternalRecordTable(
    client,
    "external_records",
  );
  if (sourceShape === "missing" || sourceShape === "canonical") return;
  if (sourceShape === "unsupported") {
    throw new Error("external_records exists with an unsupported schema");
  }
  if (backupShape === "legacy") {
    await client.exec(`
      INSERT INTO ${LEGACY_EXTERNAL_RECORDS}
        (organization_id, source, source_record_id, entity_type, entity_id, created_at)
      SELECT organization_id, source, source_record_id, entity_type, entity_id, created_at
        FROM external_records
      ON CONFLICT (organization_id, source, source_record_id) DO UPDATE SET
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
