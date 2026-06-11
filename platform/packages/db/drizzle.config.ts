import { defineConfig } from "drizzle-kit";

/**
 * drizzle-kit config. `generate` is offline — it diffs the schema to SQL with no
 * DB connection. `migrate`/`push` need DATABASE_URL (the Supabase pooler URL).
 *
 * NOTE: RLS policies, the append-only REVOKEs, and the agent-floor DENY seed live
 * in the hand-written migration alongside the generated DDL — drizzle-kit emits
 * table shape only.
 */
export default defineConfig({
  schema: "./src/schema.ts",
  out: "./migrations",
  dialect: "postgresql",
  dbCredentials: { url: process.env.DATABASE_URL ?? "postgres://localhost:5432/bridge" },
  strict: true,
  verbose: true,
});
