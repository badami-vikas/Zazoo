import type { PGlite } from "@electric-sql/pglite";

const LOCAL_TENANT_TABLES = [
  "oauth_tokens",
  "message_bodies",
  "local_people",
  "local_entities",
  "local_external_records",
  "local_external_records_legacy",
  "external_records",
  "local_state",
] as const;

/**
 * One-version compatibility for Local Plane databases that are not managed by
 * the numbered @bridge/db migrations. Refuse ambiguous schemas and let
 * PostgreSQL carry primary-key/index definitions across the column rename.
 */
export async function migrateVocab3OrganizationColumns(db: PGlite): Promise<void> {
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
