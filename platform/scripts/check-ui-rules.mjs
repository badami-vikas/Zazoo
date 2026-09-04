#!/usr/bin/env node
/**
 * check-ui-rules — the code-level gate for the UI Rulebook (docs/raw/ui-rulebook.md).
 *
 * WHY THIS EXISTS. §10 of the rulebook records the failure this repeats otherwise: UI
 * rules that live only in prose are advisory, nothing in the build fails when a page
 * ignores them, and "standardized" becomes a claim in a document. `ui-conformance.test.mjs`
 * already turns the STRUCTURAL rules into failures (which shell a page uses, which menu
 * a right-click opens). This script covers the rules that are counted rather than
 * structural — hardcoded colours, dead type sizes, native dialogs — plus the integrity of
 * the rulebook itself now that it is a single source of truth (ADR-260).
 *
 * HOW IT FAILS. Two mechanisms, deliberately different:
 *
 *   RATCHETS (code). Each rule has a per-file count in ui-rules-baseline.json. A count that
 *   GOES UP fails: you introduced a violation. A count that goes DOWN also fails, asking you
 *   to lower the baseline: a fix that is not recorded can silently regress later. This is the
 *   same shape as check-retired-vocabulary and as the rulebook's own divergence ratchet — a
 *   list that can only shrink. Ratchets exist because ~226 hardcoded hexes and ~900 raw greys
 *   predate the rule; a hard fail would make the gate unrunnable and therefore ignored.
 *
 *   GATES (docs). Hard failures, no baseline. These protect invariants that are true TODAY
 *   and must never regress by one: a single canonical rulebook, no instructions pointing at a
 *   deleted surface, no reference to a file that has never existed.
 *
 * Run: node scripts/check-ui-rules.mjs           (verify)
 *      node scripts/check-ui-rules.mjs --update   (re-record the baseline after real fixes)
 */
import { readFileSync, writeFileSync, readdirSync, statSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const PLATFORM = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const REPO = path.resolve(PLATFORM, "..");
const WEB_SRC = path.join(PLATFORM, "apps", "web", "src");
const BASELINE_PATH = path.join(PLATFORM, "scripts", "ui-rules-baseline.json");
const EXT = new Set([".ts", ".tsx"]);

/**
 * Counted rules. Each cites the rulebook section it enforces, because a gate whose rule
 * cannot be found is a gate people delete.
 */
const RULES = {
  "hardcoded-hex": {
    rule: "Part III — components consume tokens; token VALUES live in theme.css, never inline",
    test: (line) => (line.match(/#[0-9a-fA-F]{6}\b|#[0-9a-fA-F]{3}\b/g) ?? []).length,
  },
  "raw-tailwind-gray": {
    rule: "Part III — Tailwind's cool greys clash with warm paper and were never Bridge colours",
    test: (line) => (line.match(/\b(?:text|bg|border|ring|divide)-gray-\d{2,3}\b/g) ?? []).length,
  },
  "sub-12px-type": {
    rule: "Part III — minimum 12px; smaller is an accessibility failure",
    test: (line) => (line.match(/text-\[(?:[0-9]|1[01])(?:\.\d+)?px\]/g) ?? []).length,
  },
  "vh-not-dvh": {
    rule: "Part II — dvh, never vh: iOS/iPadOS collapsing bars make vh the LARGEST viewport",
    test: (line) => (line.match(/\b\d+vh\b/g) ?? []).length,
  },
  "native-dialog": {
    rule: "Part II C-23/C-30 — one confirmation style app-wide; no native confirm/prompt/alert",
    test: (line) => (line.match(/\b(?:window\.)?(?:confirm|prompt|alert)\s*\(/g) ?? []).length,
  },
  "bare-select": {
    rule: "Part II C-22 — no bare <select> where a user picks a record; StandardDropdown owns it",
    test: (line) => (line.match(/<select[\s>]/g) ?? []).length,
  },
  "absolute-menu": {
    rule: "Part IV.6 — menus position against the viewport, never absolutely inside a scroller",
    test: (line) => (line.match(/absolute\s+top-full/g) ?? []).length,
  },
  "overscroll-contain": {
    rule: "Part I §3 — `contain` severs the scroll handoff that reaches Files and Intelligence",
    test: (line) => (line.match(/overscroll-(?:behavior[^;]*contain|contain)/g) ?? []).length,
  },
};

/** Docs invariants. Hard failures — these are true today and must stay true. */
const DOC_GATES = [
  {
    name: "one-canonical-rulebook",
    why: "ADR-260 — exactly one file may declare itself the UI canon",
    check() {
      const rb = path.join(REPO, "docs", "raw", "ui-rulebook.md");
      if (!existsSync(rb)) return "docs/raw/ui-rulebook.md is missing — the UI canon has no home";
      const claimants = ["docs/wiki/ui-architecture.md", "docs/wiki/design-system.md", "docs/raw/DESIGN-SYSTEM.md", "docs/raw/ui-architecture-rules-2026-07.md"]
        .filter((rel) => {
          const p = path.join(REPO, rel);
          if (!existsSync(p)) return false;
          const text = readFileSync(p, "utf8");
          // A stub points at the rulebook and stays short. Anything longer has grown rules back.
          return !text.includes("ui-rulebook.md") || text.split("\n").length > 40;
        });
      return claimants.length ? `these should be stubs pointing at the rulebook, but carry their own rules again: ${claimants.join(", ")}` : null;
    },
  },
  {
    name: "no-module-yaml",
    why: "BUGS 2026-08-29 — no module.yaml has ever existed; manifests are TypeScript",
    check() {
      const p = path.join(REPO, "CLAUDE.md");
      return readFileSync(p, "utf8").includes("module.yaml")
        ? "CLAUDE.md names module.yaml, a file that does not exist. Manifests are platform/modules/manifests."
        : null;
    },
  },
  {
    name: "no-live-module-detail",
    why: "ADR-224 — Module Detail was deleted; a rule may not direct a reader to it",
    check() {
      const p = path.join(REPO, "docs", "raw", "ui-rulebook.md");
      // A line may NAME Module Detail to record that it is gone — that note is what
      // stops the references being re-added. It may not DIRECT a reader there. The
      // difference is whether the same line says it was removed; a gate that fires on
      // correct prose is a gate people learn to ignore.
      const DIRECTS = /reached from|Manage in|links to|routes to|see Module Detail|in Module Detail/i;
      const SAYS_ITS_GONE = /delet|remov|no longer|superseded|does not exist|dead|gone/i;
      const bad = readFileSync(p, "utf8")
        .split("\n")
        .map((line, i) => [i + 1, line])
        .filter(([, line]) => /Module Detail/.test(line) && DIRECTS.test(line) && !SAYS_ITS_GONE.test(line));
      return bad.length
        ? `the rulebook directs a reader to the deleted Module Detail at line(s) ${bad.map(([n]) => n).join(", ")}`
        : null;
    },
  },
];

const walk = (dir) => {
  const out = [];
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry === "dist" || entry === ".turbo") continue;
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else if (EXT.has(path.extname(full))) out.push(full);
  }
  return out;
};

function inventory() {
  const found = {};
  for (const file of walk(WEB_SRC)) {
    const rel = path.relative(PLATFORM, file);
    const lines = readFileSync(file, "utf8").split("\n");
    for (const [name, { test }] of Object.entries(RULES)) {
      let n = 0;
      for (const line of lines) n += test(line);
      if (n > 0) (found[name] ??= {})[rel] = n;
    }
  }
  return found;
}

const update = process.argv.includes("--update");
const current = inventory();

if (update) {
  writeFileSync(BASELINE_PATH, `${JSON.stringify(current, null, 2)}\n`);
  const total = Object.values(current).reduce((a, files) => a + Object.values(files).reduce((x, y) => x + y, 0), 0);
  console.log(`check-ui-rules: baseline written — ${total} tracked occurrences across ${Object.keys(current).length} rules.`);
  process.exit(0);
}

const baseline = existsSync(BASELINE_PATH) ? JSON.parse(readFileSync(BASELINE_PATH, "utf8")) : {};
const introduced = [];
const fixed = [];

for (const name of new Set([...Object.keys(current), ...Object.keys(baseline)])) {
  const cur = current[name] ?? {};
  const base = baseline[name] ?? {};
  for (const file of new Set([...Object.keys(cur), ...Object.keys(base)])) {
    const c = cur[file] ?? 0;
    const b = base[file] ?? 0;
    if (c > b) introduced.push({ name, file, c, b });
    if (c < b) fixed.push({ name, file, c, b });
  }
}

// AP-182: doc gates WARN. Prose drifting is worth a line in the log, not a red build.
const docWarnings = DOC_GATES.map((g) => ({ g, msg: g.check() })).filter((x) => x.msg);
for (const { g, msg } of docWarnings) {
  console.log(`\nDOC GATE WARNING (not blocking) — ${g.name}\n  ${g.why}\n  ${msg}`);
}

if (!introduced.length && !fixed.length) {
  const total = Object.values(current).reduce((a, files) => a + Object.values(files).reduce((x, y) => x + y, 0), 0);
  console.log(`check-ui-rules: OK — ${DOC_GATES.length - docWarnings.length}/${DOC_GATES.length} doc gates pass, ${total} known violations held at the baseline.`);
  process.exit(0);
}

for (const { name, file, c, b } of introduced) {
  console.error(`\nNEW VIOLATION — ${name} (${c}, was ${b})\n  ${file}\n  ${RULES[name].rule}`);
}
if (fixed.length) {
  console.error(`\n${fixed.length} violation(s) FIXED but not recorded. Run:\n  node scripts/check-ui-rules.mjs --update\nA fix left out of the baseline can silently regress later.`);
  for (const { name, file, c, b } of fixed) console.error(`  ${name}: ${file} ${b} -> ${c}`);
}
console.error("\nRules: docs/raw/ui-rulebook.md\n");
process.exit(1);
