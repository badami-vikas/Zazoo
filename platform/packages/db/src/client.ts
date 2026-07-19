/**
 * Postgres/Supabase client factory. Pooled connection via postgres-js + Drizzle.
 *
 * RLS is enforced in the database; hosted API requests connect as the dedicated
 * `bridge_app` role and establish transaction-local Organization/user context.
 * Owner, service-role, and BYPASSRLS identities are never runtime identities.
 */
import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import type { PgliteDatabase } from "drizzle-orm/pglite";
import postgres from "postgres";
import * as schema from "./schema.js";

/**
 * A Drizzle handle over the Bridge schema on EITHER plane: postgres-js (cloud
 * Supabase, this file) or pglite (the local plane, client-local.ts). Both extend
 * the same PgDatabase base, so the Drizzle-backed port bindings drive either one.
 */
export type Database =
  | PostgresJsDatabase<typeof schema>
  | PgliteDatabase<typeof schema>;

export interface DbConfig {
  /** Postgres connection string (e.g. Supabase pooler URL). */
  url: string;
  /** Max pool connections. Keep low behind the Supabase pooler. */
  max?: number;
}

export function createDb(config: DbConfig): { db: Database; close: () => Promise<void> } {
  const sql = postgres(config.url, { max: config.max ?? 5, prepare: false });
  const db = drizzle(sql, { schema });
  return { db, close: () => sql.end() };
}

export { schema };
