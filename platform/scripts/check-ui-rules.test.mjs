/**
 * The gate's own gate. A checker nobody tests is a checker that silently stops
 * checking — CLAUDE.md's evidence rule: a test proves nothing until seen failing
 * unfixed, so each case here breaks a rule on purpose and asserts the detector fires.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, mkdirSync, rmSync, cpSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPTS = path.dirname(fileURLToPath(import.meta.url));
const PLATFORM = path.resolve(SCRIPTS, "..");
const SCRIPT = path.join(SCRIPTS, "check-ui-rules.mjs");

const run = () => {
  try {
    return { code: 0, out: execFileSync(process.execPath, [SCRIPT], { cwd: PLATFORM, encoding: "utf8" }) };
  } catch (error) {
    return { code: error.status ?? 1, out: `${error.stdout ?? ""}${error.stderr ?? ""}` };
  }
};

test("the repository is currently clean against its own baseline", () => {
  const { code, out } = run();
  assert.equal(code, 0, `check-ui-rules should pass on a clean tree:\n${out}`);
  assert.match(out, /doc gates pass/);
});

test("a newly introduced violation fails the gate", () => {
  const scratch = path.join(PLATFORM, "apps", "web", "src", "__ui_gate_probe__");
  mkdirSync(scratch, { recursive: true });
  const probe = path.join(scratch, "Probe.tsx");
  try {
    // Four separate rules, one file: a hardcoded hex, a raw grey, sub-12px type,
    // and a native dialog. None is in the baseline, so all four must be reported.
    writeFileSync(
      probe,
      [
        "export const Probe = () => {",
        '  if (confirm("really?")) return null;',
        '  return <p className="text-gray-500 text-[9px]" style={{ color: "#6200EE" }} />;',
        "};",
        "",
      ].join("\n"),
      "utf8",
    );
    const { code, out } = run();
    assert.equal(code, 1, "an unbaselined violation must fail the gate");
    for (const rule of ["hardcoded-hex", "raw-tailwind-gray", "sub-12px-type", "native-dialog"]) {
      assert.match(out, new RegExp(rule), `expected ${rule} to be reported:\n${out}`);
    }
    // The report has to name the rule it enforces, not just the pattern — a finding
    // whose rule cannot be found is a finding people suppress.
    assert.match(out, /ui-rulebook\.md/);
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
});

test("a fix that is not recorded in the baseline also fails", () => {
  const baselinePath = path.join(SCRIPTS, "ui-rules-baseline.json");
  const backup = mkdtempSync(path.join(tmpdir(), "ui-gate-"));
  const saved = path.join(backup, "baseline.json");
  cpSync(baselinePath, saved);
  try {
    const inflated = JSON.parse(execFileSync("cat", [baselinePath], { encoding: "utf8" }));
    inflated["hardcoded-hex"] = { ...(inflated["hardcoded-hex"] ?? {}), "apps/web/src/__not_a_real_file__.tsx": 3 };
    writeFileSync(baselinePath, `${JSON.stringify(inflated, null, 2)}\n`, "utf8");
    const { code, out } = run();
    assert.equal(code, 1, "a baseline claiming violations that no longer exist must fail");
    assert.match(out, /FIXED but not recorded/);
    assert.match(out, /--update/);
  } finally {
    cpSync(saved, baselinePath);
    rmSync(backup, { recursive: true, force: true });
  }
});

test("a doc gate fails when a retired canon grows rules back", () => {
  const stub = path.resolve(PLATFORM, "..", "docs", "wiki", "ui-architecture.md");
  const backup = mkdtempSync(path.join(tmpdir(), "ui-gate-doc-"));
  const saved = path.join(backup, "stub.md");
  cpSync(stub, saved);
  try {
    writeFileSync(stub, `# UI architecture\n\n${"A competing rule.\n".repeat(60)}`, "utf8");
    const { code, out } = run();
    assert.equal(code, 1, "a stub that regrows into a second canon must fail");
    assert.match(out, /one-canonical-rulebook/);
  } finally {
    cpSync(saved, stub);
    rmSync(backup, { recursive: true, force: true });
  }
});
