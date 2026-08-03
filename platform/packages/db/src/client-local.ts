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
const CANONICAL_EXTERNAL_RECORD_COLUMNS = new Map([
  ["id", "uuid"],
  ["organization_id", "uuid"],
  ["source", "text"],
  ["source_record_id", "text"],
  ["entity_type", "text"],
  ["entity_id", "uuid"],
  ["created_at", "timestamp with time zone"],
]);
const PRE_VOCAB_CANONICAL_EXTERNAL_RECORD_COLUMNS = new Map(
  [...CANONICAL_EXTERNAL_RECORD_COLUMNS].map(([name, dataType]) => [
    name === "organization_id" ? "workspace_id" : name,
    dataType,
  ]),
);

type ExternalRecordTableShape =
  | "missing"
  | "legacy"
  | "pre-vocab-canonical"
  | "canonical"
  | "unsupported";

function hasExactColumns(
  actual: ReadonlyMap<string, string>,
  expected: ReadonlyMap<string, string>,
): boolean {
  return (
    actual.size === expected.size &&
    [...expected].every(([name, dataType]) => actual.get(name) === dataType)
  );
}

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
  if (hasExactColumns(columns, LEGACY_EXTERNAL_RECORD_COLUMNS)) return "legacy";
  if (tableName !== "external_records") return "unsupported";
  if (hasExactColumns(columns, CANONICAL_EXTERNAL_RECORD_COLUMNS)) {
    return "canonical";
  }
  if (hasExactColumns(columns, PRE_VOCAB_CANONICAL_EXTERNAL_RECORD_COLUMNS)) {
    return "pre-vocab-canonical";
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
  if (
    backupShape === "unsupported" ||
    backupShape === "canonical" ||
    backupShape === "pre-vocab-canonical"
  ) {
    throw new Error(
      `${LEGACY_EXTERNAL_RECORDS} exists with an unsupported schema`,
    );
  }
  const sourceShape = await inspectExternalRecordTable(
    client,
    "external_records",
  );
  if (
    sourceShape === "missing" ||
    sourceShape === "canonical" ||
    sourceShape === "pre-vocab-canonical"
  ) {
    return;
  }
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
 * Test-only schema snapshot (BRIDGE_DB_TEST_SNAPSHOT=1). The 2026-08-03 test
 * audit measured 202 in-memory `createLocalDb()` calls across the db suite,
 * each replaying the full migration chain at ~1.85s — ~375s of the suite's
 * 994s CPU budget was pure `migrate()`. With the flag on, the FIRST in-memory
 * open in a process migrates normally and dumps the resulting data dir; every
 * subsequent in-memory open restores that dump instead of re-migrating.
 *
 * Deliberately narrow: only when the env flag is set (the db test script sets
 * it; production never does), only for in-memory opens (`dataDir` callers get
 * real persistence semantics), and only for the default migrations folder
 * (migration-harness tests pass their own folder precisely because they are
 * testing migration BEHAVIOUR, and must keep executing the real chain).
 * node --test runs each test file in its own process, so the cache is
 * per-file — cross-file isolation is untouched.
 */
let testSnapshot: Promise<Blob | File> | null = null;

function snapshotEligible(config: LocalDbConfig): boolean {
  return (
    process.env.BRIDGE_DB_TEST_SNAPSHOT === "1" &&
    !config.dataDir &&
    !config.migrationsFolder
  );
}

/**
 * Open the local-plane store, apply migrations, and return a Drizzle handle plus
 * a close fn. The handle is shape-compatible with the cloud `Database`, so the
 * same port bindings (`createDrizzlePorts`) drive either plane.
 */
export async function createLocalDb(
  config: LocalDbConfig = {},
): Promise<{ db: LocalDatabase; client: PGlite; close: () => Promise<void> }> {
  if (snapshotEligible(config) && testSnapshot) {
    // Restore the already-migrated schema; the dump carries the drizzle
    // migrations journal, the vector extension state, and the legacy-table
    // preparation, so none of the setup below needs to re-run.
    const client = new PGlite({
      loadDataDir: await testSnapshot,
      extensions: { vector },
    });
    const db = drizzle(client, {
      schema,
      ...(config.queryLogger ? { logger: config.queryLogger } : {}),
    });
    return { db, client, close: () => client.close() };
  }
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
    if (snapshotEligible(config) && !testSnapshot) {
      testSnapshot = client.dumpDataDir();
      await testSnapshot;
    }
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
