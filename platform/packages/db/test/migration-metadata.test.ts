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

test("Drizzle metadata is rebased through 0046 and generate is a deterministic no-op", () => {
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
      idx: 46,
      version: "7",
      when: 1788394656841,
      tag: "0046_merged_task_anchor_estimate_display_name",
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
      "eval-persistence snapshot must remain tracked",
    );
    assert.ok(
      readdirSync(join(probeMigrations, "meta")).includes("0037_snapshot.json"),
      "AQV ledger-attribution snapshot must remain tracked",
    );
    assert.ok(
      readdirSync(join(probeMigrations, "meta")).includes("0039_snapshot.json"),
      "Task-dependency snapshot must be tracked (ADR-204)",
    );
    assert.ok(
      readdirSync(join(probeMigrations, "meta")).includes("0040_snapshot.json"),
      "claim-substrate snapshot must be tracked (TASK-047)",
    );
    assert.ok(
      readdirSync(join(probeMigrations, "meta")).includes("0041_snapshot.json"),
      "DevPilot GitHub tracker snapshot must be tracked (TASK-068)",
    );
    assert.ok(
      readdirSync(join(probeMigrations, "meta")).includes("0042_snapshot.json"),
      "Academics/Events module snapshot must be tracked (TASK-069/TASK-070)",
    );
    assert.ok(
      readdirSync(join(probeMigrations, "meta")).includes("0043_snapshot.json"),
      "JobPilot onboarding snapshot must be tracked (TASK-076)",
    );
    assert.ok(
      readdirSync(join(probeMigrations, "meta")).includes("0044_snapshot.json"),
      "Chat backend snapshot must be tracked (TASK-090)",
    );
    assert.ok(
      readdirSync(join(probeMigrations, "meta")).includes("0045_snapshot.json"),
      "Module-session snapshot must be tracked (TASK-093)",
    );
    assert.ok(
      readdirSync(join(probeMigrations, "meta")).includes("0046_snapshot.json"),
      "Run Task-anchor + Task estimate + Module display-name snapshot must be tracked (ADR-269/272, TASK-081)",
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
      // The NEXT index after the current head (0046). If `generate` allocates
      // this, schema.ts and the committed migrations have drifted apart.
      // 0038 is a pure DATA migration (capability_type 'view' -> 'database'),
      // so it has no snapshot and cannot make generate produce one — the
      // schema shape is byte-identical either side of it. 0041 adds
      // `devpilot_repos`/`devpilot_pulls`/`devpilot_issues` (TASK-068); 0042
      // adds the Academics/Events tables (TASK-069/070); 0043 adds
      // `jobpilot_candidate_profiles` (TASK-076); 0044 adds `chat_threads`'
      // backend columns (TASK-090); 0045 adds its
      // Module-session columns (TASK-093); 0046 adds `automation_runs.task_id`
      // (ADR-269), `tasks.estimate` (ADR-272) and
      // `module_installations.display_name_override` (TASK-081) — all real
      // shape changes. 0046's composite FK to `tasks` is deliberately NOT in
      // schema.ts (LAYER 4 is defined before LAYER 8, so naming `tasks` there
      // is a TDZ crash) and so is absent from its snapshot too — which is why
      // generate stays a no-op.
      !readdirSync(probeMigrations).some((name) => /^0047_.*\.sql$/.test(name)),
      "no-op generation must not allocate another migration",
    );
  } finally {
    rmSync(probe, { recursive: true, force: true });
  }
});
