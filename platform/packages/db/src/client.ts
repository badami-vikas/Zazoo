/**
 * Postgres/Supabase client factory. Pooled connection via postgres-js + Drizzle.
 *
 * RLS is enforced in the database; this client connects with whatever role the
 * connection string carries. App requests should run under the member JWT path
 * (PostgREST/Supabase) or a request-scoped role — service-role bypass is reserved
 * for the derivation pipeline, never the app surface.
 */
import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema.js";

export type Database = PostgresJsDatabase<typeof schema>;

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
