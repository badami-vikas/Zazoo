import type { PGlite } from "@electric-sql/pglite";

const LOCAL_TENANT_TABLES = [
  "oauth_tokens",
  "message_bodies",
  "local_messages",
  "local_people",
  "local_entities",
  "local_external_records",
  "local_external_records_legacy",
  "external_records",
  "local_state",
] as const;

/** Preserve Local Plane data while bringing pre-numbered schemas to Organization scope. */
export async function migrateOrganizationColumns(db: PGlite): Promise<void> {
  const columns = await db.query<{ table_name: string; column_name: string }>(
    `SELECT table_name, column_name
       FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = ANY($1::text[])
        AND column_name IN ('workspace_id', 'organization_id')`,
    [[...LOCAL_TENANT_TABLES]],
  );
  const byTable = new Map<string, Set<string>>();
  for (const row of columns.rows) {
    const names = byTable.get(row.table_name) ?? new Set<string>();
    names.add(row.column_name);
    byTable.set(row.table_name, names);
  }

  for (const tableName of LOCAL_TENANT_TABLES) {
    const names = byTable.get(tableName);
    if (!names?.has("workspace_id")) continue;
    if (names.has("organization_id")) {
      throw new Error(
        `${tableName} contains both workspace_id and organization_id; refusing an ambiguous Local Plane migration`,
      );
    }
    await db.exec(
      `ALTER TABLE "${tableName}" RENAME COLUMN "workspace_id" TO "organization_id"`,
    );
  }
}

/**
 * Additive columns introduced after `local_people` shipped. `CREATE TABLE IF
 * NOT EXISTS` leaves an existing table untouched, so an installed Local Plane
 * would keep the old three-column shape and every insert naming `phones` or
 * `dedupe_key` would fail. Adding them here is idempotent and preserves data.
 *
 * `phones` is deliberately local-only: unlike `emails`, it is never dual-written
 * to cloud canonical without an explicit promote.
 */
export async function migrateLocalPeopleIdentityColumns(db: PGlite): Promise<void> {
  const existing = await db.query<{ column_name: string }>(
    `SELECT column_name FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'local_people'`,
  );
  const names = new Set(existing.rows.map((row) => row.column_name));
  // No table yet — INIT_SQL creates it complete, so there is nothing to migrate.
  if (names.size === 0) return;
  if (!names.has("phones")) {
    await db.exec(`ALTER TABLE local_people ADD COLUMN phones jsonb NOT NULL DEFAULT '[]'`);
  }
  if (!names.has("dedupe_key")) {
    await db.exec(`ALTER TABLE local_people ADD COLUMN dedupe_key text`);
  }
}

/**
 * Columns `local_messages` must carry, beyond the identity triple that has been
 * there since the table shipped. Same reasoning as
 * `migrateLocalPeopleIdentityColumns`: `CREATE TABLE IF NOT EXISTS` leaves an
 * already-installed table on its old shape, so an installed Local Plane would
 * keep the narrower table and every insert naming a newer column would fail.
 *
 * Every entry is nullable or defaulted, so adding it preserves existing rows.
 */
const LOCAL_MESSAGE_ADDITIVE_COLUMNS: readonly (readonly [string, string])[] = [
  ["sender_key", "text"],
  ["sender_kind", "text NOT NULL DEFAULT 'unknown'"],
  ["direction", "text NOT NULL DEFAULT 'inbound'"],
  ["sent_at", "text NOT NULL DEFAULT ''"],
  ["body", "text NOT NULL DEFAULT ''"],
  ["attachment", "jsonb"],
  ["ack", "text NOT NULL DEFAULT 'unknown'"],
  ["captured_at", "text NOT NULL DEFAULT ''"],
];

/**
 * Bring an already-installed `local_messages` up to the current shape.
 *
 * Runs BEFORE `INIT_SQL`, because INIT_SQL's indexes reference columns this may
 * still need to add. A fresh database has no table at all and INIT_SQL creates
 * it complete, so there is nothing to do.
 */
export async function migrateLocalMessageColumns(db: PGlite): Promise<void> {
  const existing = await db.query<{ column_name: string }>(
    `SELECT column_name FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'local_messages'`,
  );
  const names = new Set(existing.rows.map((row) => row.column_name));
  if (names.size === 0) return;
  for (const [column, definition] of LOCAL_MESSAGE_ADDITIVE_COLUMNS) {
    if (names.has(column)) continue;
    await db.exec(`ALTER TABLE local_messages ADD COLUMN ${column} ${definition}`);
  }
}
