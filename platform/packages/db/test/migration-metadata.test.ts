import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  cpSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
} from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const dbRoot = resolve(here, "../..");
const migrationsFolder = resolve(dbRoot, "migrations");
const drizzleKitBin = resolve(dbRoot, "node_modules/drizzle-kit/bin.cjs");

test("Drizzle metadata is rebased through 0036 and generate is a deterministic no-op", () => {
  const probe = mkdtempSync(resolve(dbRoot, ".drizzle-noop-"));
  const probeMigrations = join(probe, "migrations");
  try {
    cpSync(migrationsFolder, probeMigrations, { recursive: true });
    const journalPath = join(probeMigrations, "meta/_journal.json");
    const journalBefore = readFileSync(journalPath, "utf8");
    const journal = JSON.parse(journalBefore) as {
      entries: Array<{ idx: number; tag: string }>;
    };
    const last = journal.entries.at(-1);
    assert.deepEqual(last, {
      idx: 36,
      version: "7",
      when: 1785814388328,
      tag: "0036_task034_eval_persistence",
      breakpoints: true,
    });
    assert.ok(
      readdirSync(join(probeMigrations, "meta")).includes("0029_snapshot.json"),
      "TASK-015 high-water snapshot must remain tracked",
    );
    assert.ok(
      readdirSync(join(probeMigrations, "meta")).includes("0030_snapshot.json"),
      "schema-alignment snapshot must remain tracked",
    );
    assert.ok(
      readdirSync(join(probeMigrations, "meta")).includes("0031_snapshot.json"),
      "Chat-store snapshot must remain tracked",
    );
    assert.ok(
      readdirSync(join(probeMigrations, "meta")).includes("0032_snapshot.json"),
      "current Chat cloud-grant snapshot must be tracked",
    );
    assert.ok(
      readdirSync(join(probeMigrations, "meta")).includes("0033_snapshot.json"),
      "DealPilot Cloud-Plane snapshot must be tracked",
    );
    assert.ok(
      readdirSync(join(probeMigrations, "meta")).includes("0034_snapshot.json"),
      "DealPilot deal-signals snapshot must be tracked",
    );
    assert.ok(
      readdirSync(join(probeMigrations, "meta")).includes("0035_snapshot.json"),
      "Research Run snapshot must remain tracked",
    );
    assert.ok(
      readdirSync(join(probeMigrations, "meta")).includes("0036_snapshot.json"),
      "current eval-persistence snapshot must be tracked",
    );

    const generated = spawnSync(
      process.execPath,
      [
        drizzleKitBin,
        "generate",
        "--schema",
        resolve(dbRoot, "src/schema.ts"),
        "--out",
        relative(dbRoot, probeMigrations),
        "--dialect",
        "postgresql",
        "--name",
        "task026_noop",
      ],
      {
        cwd: dbRoot,
        encoding: "utf8",
        timeout: 60_000,
      },
    );
    const output = `${generated.stdout}${generated.stderr}`;
    assert.ifError(generated.error);
    assert.equal(generated.status, 0, output);
    assert.match(output, /No schema changes, nothing to migrate/);
    assert.equal(readFileSync(journalPath, "utf8"), journalBefore);
    assert.ok(
      // The NEXT index after the current head (0036). If `generate` allocates
      // this, schema.ts and the committed migrations have drifted apart.
      !readdirSync(probeMigrations).some((name) => /^0037_.*\.sql$/.test(name)),
      "no-op generation must not allocate another migration",
    );
  } finally {
    rmSync(probe, { recursive: true, force: true });
  }
});
