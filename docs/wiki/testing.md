# Testing — caveman

No vitest/jest anywhere. Every pkg = `node --test` on compiled `dist/`. No CI. No coverage
wired into `turbo run test` (had to run `--experimental-test-coverage` by hand to get real
numbers).

**Real coverage (2026-07-04, fresh install+build, not cached):**
- core 94%/81%br/92%fn — healthy.
- dedupe 100%/86%br — but misses the exact tie-break bug (no equal-score test exists).
- db store layer 79%/76%br/**46%fn** — governance/ledger/ritual/canonical stores all <42% line.
- integrations-google **54%/62%br/28%fn** — worst pkg, and worst files = buggiest files
  (gateway-google.ts 13%, oauth.ts 29%, intake.ts 9%).
- apps/api 94%* — *only measures social/*; router.ts/wiring.ts/identity.ts have NO test file,
  don't even show in the report. Biggest attack surface, zero coverage.
- dealpilot 74%, jobpilot 80% (pacing.ts 100% unit-covered, **0 production callers** — proves
  coverage% ≠ risk).

**Rule of thumb this session learned: coverage inversely tracked risk.** The 3 files with this
session's P0 bugs were the 3 worst/untested files. Don't trust package-average %, read file-by-file.

Full plan + priority test list → [../raw/testing-strategy.md](../raw/testing-strategy.md).
Bug ledger → [known-issues](known-issues.md).
