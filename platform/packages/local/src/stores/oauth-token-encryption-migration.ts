import type { PGlite } from "@electric-sql/pglite";
import {
  encodeTokenField,
  encryptTokenField,
  type TokenVaultKeys,
} from "./oauth-token-crypto.js";

/**
 * Bring a pre-encryption `oauth_tokens` table (plaintext `access_token`/
 * `refresh_token` columns — BUGS.md OPEN 2026-07-08) forward to the encrypted
 * shape. A no-op when the table does not exist yet (fresh install: INIT_SQL
 * creates the encrypted shape directly) or has already been migrated.
 */
export async function migrateOAuthTokenEncryption(
  db: PGlite,
  keys: TokenVaultKeys,
): Promise<void> {
  const columns = await db.query<{ column_name: string }>(
    `SELECT column_name FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'oauth_tokens'`,
  );
  const names = new Set(columns.rows.map((r) => r.column_name));
  if (names.size === 0) return; // table does not exist yet
  if (!names.has("access_token")) return; // already migrated

  if (!names.has("access_token_encrypted")) {
    await db.exec(`ALTER TABLE oauth_tokens ADD COLUMN access_token_encrypted text`);
  }
  if (!names.has("refresh_token_encrypted")) {
    await db.exec(`ALTER TABLE oauth_tokens ADD COLUMN refresh_token_encrypted text`);
  }

  const rows = await db.query<{
    integration_id: string;
    access_token: string;
    refresh_token: string | null;
  }>(
    `SELECT integration_id, access_token, refresh_token FROM oauth_tokens
      WHERE access_token_encrypted IS NULL`,
  );
  for (const row of rows.rows) {
    const accessEncrypted = encodeTokenField(
      encryptTokenField(keys, `${row.integration_id}:access_token`, row.access_token),
    );
    const refreshEncrypted = row.refresh_token
      ? encodeTokenField(
          encryptTokenField(keys, `${row.integration_id}:refresh_token`, row.refresh_token),
        )
      : null;
    await db.query(
      `UPDATE oauth_tokens SET access_token_encrypted = $2, refresh_token_encrypted = $3
        WHERE integration_id = $1`,
      [row.integration_id, accessEncrypted, refreshEncrypted],
    );
  }

  await db.exec(`ALTER TABLE oauth_tokens DROP COLUMN access_token`);
  await db.exec(`ALTER TABLE oauth_tokens DROP COLUMN refresh_token`);
  await db.exec(`ALTER TABLE oauth_tokens ALTER COLUMN access_token_encrypted SET NOT NULL`);
}
