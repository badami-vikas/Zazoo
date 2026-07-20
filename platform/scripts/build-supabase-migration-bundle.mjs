import { createHash } from "node:crypto";
import { chmod, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

export async function buildSupabaseMigrationBundle(migrationsDir) {
  const journal = JSON.parse(
    await readFile(join(migrationsDir, "meta", "_journal.json"), "utf8"),
  );
  const statements = [
    "BEGIN;",
    "CREATE SCHEMA IF NOT EXISTS drizzle;",
    `CREATE TABLE IF NOT EXISTS drizzle.__drizzle_migrations (
  id SERIAL PRIMARY KEY,
  hash text NOT NULL,
  created_at bigint
);`,
    `CREATE FUNCTION public.pg_get_functiondef(target_oid oid)
RETURNS text
LANGUAGE sql
STABLE
STRICT
AS $$
  SELECT CASE
    WHEN function_row.prokind IN ('f', 'p')
      THEN pg_catalog.pg_get_functiondef(function_row.oid)
    ELSE ''
  END
  FROM pg_catalog.pg_proc AS function_row
  WHERE function_row.oid = target_oid
$$;`,
    "SET LOCAL search_path = public, pg_catalog, extensions;",
    `DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM drizzle.__drizzle_migrations) THEN
    RAISE EXCEPTION 'refusing to apply a fresh migration bundle over existing Drizzle history';
  END IF;
END
$$;`,
  ];

  for (const entry of journal.entries) {
    const source = await readFile(join(migrationsDir, `${entry.tag}.sql`), "utf8");
    const hash = createHash("sha256").update(source).digest("hex");
    let executableSource = source;
    if (entry.tag === "0022_supabase_runtime_role") {
      const restrictedAlter = `ALTER ROLE bridge_app
  NOSUPERUSER
  NOCREATEDB
  NOCREATEROLE
  NOINHERIT
  NOREPLICATION
  NOBYPASSRLS;`;
      const managedAlter = `ALTER ROLE bridge_app
  NOCREATEDB
  NOCREATEROLE
  NOINHERIT;`;
      executableSource = source.replace(restrictedAlter, managedAlter);
      if (executableSource === source) {
        throw new Error(
          "Supabase role compatibility transform no longer matches migration 0022",
        );
      }
    }
    statements.push(executableSource.replaceAll("--> statement-breakpoint", ""));
    statements.push(
      `INSERT INTO drizzle.__drizzle_migrations (hash, created_at) VALUES ('${hash}', ${entry.when});`,
    );
  }

  statements.push("DROP FUNCTION public.pg_get_functiondef(oid);");
  statements.push("COMMIT;");
  return `${statements.join("\n\n")}\n`;
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  const migrationsDir = process.argv[2];
  const outputPath = process.argv[3];
  if (!migrationsDir || !outputPath) {
    throw new Error(
      "usage: build-supabase-migration-bundle <migrations-dir> <output-file>",
    );
  }
  await writeFile(
    outputPath,
    await buildSupabaseMigrationBundle(migrationsDir),
    { mode: 0o600 },
  );
  await chmod(outputPath, 0o600);
}
