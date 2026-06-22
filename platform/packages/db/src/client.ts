/**
 * Postgres/Supabase client factory. Pooled connection via postgres-js + Drizzle.
 *
 * RLS is enforced in the database; this client connects with whatever role the
 * connection string carries. App requests should run under the member JWT path
 * (PostgREST/Supabase) or a request-scoped role — service-role bypass is reserved
 * for the derivation pipeline, never the app surface.
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
