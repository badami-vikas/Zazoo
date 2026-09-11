import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));

/** Absolute path of this Module's drizzle-kit migrations folder, whether this
 * file runs from dist/src/ (built, the normal case) or src/ (tsx). */
export function accountingMigrationsDir(): string {
  for (const rel of ["../../migrations", "../migrations"]) {
    const candidate = resolve(here, rel);
    if (existsSync(resolve(candidate, "meta/_journal.json"))) return candidate;
  }
  return resolve(here, "../../migrations");
}
