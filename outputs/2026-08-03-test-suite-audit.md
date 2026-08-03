# Test suite audit — 2026-08-03

Four parallel read-only agents over all 240 test files / ~62,500 test LOC / ~1,400 tests.
Question asked: which tests always pass, which are redundant, which can merge.

**Headline: the problem is not test COUNT. It is (a) ~130 frontend tests that cannot
fail, and (b) two runtime sinks that have nothing to do with how many tests exist.**

| Suite | Files | Test LOC | Tests | Verdict |
|---|---|---|---|---|
| apps/api | 38 | 19,712 | 389 | Solid; runtime is 303 `buildWiring()` calls |
| packages/db | 52 | 15,039 | 217 | **Healthiest suite in the repo**; runtime is 202 migration replays |
| packages/core | 51 | 9,822 | 493 | Solid; harness duplication is a live hazard |
| apps/web | 18 | 2,679 | 164 | **66% cannot fail** |
| everything else | 81 | ~15,000 | ~140 | Behavioural, small overlaps |

---

## 1. Tests that cannot fail (~130 tests)

**apps/web — 109 of 164 tests (66%) are source-text greps.** They `readFile` a `.tsx`
and `assert.match(source, /regex/)`. A further 19 (12%) assert against constants
copy-pasted into the test file. Only 36 (22%) import and call real app code; only
5 of 18 files import production code at all.

- `relationship-module.test.mjs` — 180 of 182 assertions are regexes over 14 source
  files. Fails on a rename; passes if the page is completely broken.
- `red-flag-control.test.mjs` — asserts Tailwind substrings
  (`/\[@media\(any-pointer:coarse\)\]:before:-inset-3\.5/`). A CSS spellchecker.
- `module-detail.test.mjs` — re-implements `clampWidth`/`snapDecision` inside the test
  and tests the copy; `:59` asserts a literal object against a literal list —
  mathematically cannot fail.
- `apps/website/test/*` — all 6 tests are greps.

**KEEP the one real exception:** `apps/web/test/whatsapp-engine.test.mjs` parses the
Rust allowlist (`script_for_op`) and the TS `runReadOp(...)` call sites and asserts
SET EQUALITY ACROSS TWO LANGUAGES. That genuinely breaks on drift — source parsing is
the correct tool there.

**packages/core — 2 files, 182 LOC, 11 tests.** `foreign-import.test.ts` (asserts
fixture literals back at themselves; the module under test is types-only, no runtime
code exists to exercise) and `context-provider.test.ts` (3 of 5 tests exercise a class
defined inside the test file). Also `agents.test.ts:13-23` asserts a 4-element array
has 4 elements, with a comment conceding the type system already proves it.

**apps/api — 4 spots.** `single-tenant-guard.test.ts:58,69` assert `total === 0` on an
unseeded store (comment admits "just proves the call succeeds") at the cost of two full
wirings; `commons.test.ts:191` tests a kind-filter whose fixture makes it a no-op;
`wiring.test.ts:271,281` assert `typeof x === "function"` (TypeScript's job) and
`:259,265` assert the absence of a `console.warn` that no longer exists in source.

**packages/db — NONE.** No no-assertion tests, no constant assertions, no tautological
schema mirroring. Verified individually.

---

## 2. Runtime — where the 17 minutes actually goes

Neither sink is caused by test count. Both are fixable without deleting a test.

**apps/api: 303 `buildWiring()` calls across 27 files**, each spinning a fresh PGlite +
full migrations (~2s). Runtime is ~linear in wiring count, not test count — measured:
`relationship-help-routing` (5 tests, 0 wirings) = **0.30s**; `single-tenant-guard`
(5 tests, 6 wirings) = **50.4s**.

`--test-concurrency=1` is the bigger half. It was added in `6590c71` ("prepare Supabase
pilot runtime") **with no rationale in the commit**. The rationale exists in
`docs/BUGS.md:1887-1888` + AP-019 — a pglite resource-starvation flake — but **that
entry's own resolution was to cap `@bridge/db` at `--test-concurrency=4`, not 1**, and
db still runs at 4 today with heavier migrations. `apps/api` is the ONLY package pinned
to 1. Safe-by-construction to raise: every file uses `mkdtempSync`, node runs each file
in its own process, so the 5 files mutating `process.env` and the 2 stubbing
`globalThis.fetch` cannot collide across files.
**Action: `--test-concurrency=4`. ~10 min → ~3-4 min, zero test changes.**

**packages/db: 202 `createLocalDb()` calls**, each replaying the whole migration chain
at ~1.85s — roughly **375s of the 994s CPU budget is pure `migrate()`**. Worst:
`graph-store` (21), `memory-store` (17), `local-store` (15), `module-store` (12),
`rls` (9). `createLocalDb` already accepts `dataDir`: build the migrated schema once
per worker and restore via pglite `dumpDataDir`/`loadDataDir`, or `TRUNCATE ... CASCADE`
a shared instance. **~60% of db wall time, zero tests deleted.**

---

## 3. Harness duplication (~1,250 LOC, and one is dangerous)

- **apps/api**: `makeRun()` and `makeCaller()` redefined in **21 files each**, `withEnv`
  in 2. `commons-fixtures.ts` already exists as a shared-helper home. ~400 LOC.
- **packages/core**: 6 files independently rebuild the pipeline harness (~318 LOC), and
  **they have already diverged** — `redteam-egress.test.ts:67` and
  `integration-sink.test.ts:72` build ctx WITHOUT a taint label while the other four
  require one; four carry a verbatim-copied 12-line ADR-142 comment block. A taint-model
  change needs six coordinated edits. Extract `test/support/pipeline-harness.ts`
  (a non-`.test.ts` file compiles but never runs as a suite). ~230 LOC.
- **packages/db**: the migration harness is in **13** files (~620 LOC) in **three
  dialects** — NOT the ~21 files / ~1,000 LOC claimed in the 2026-08-02 bloat audit.
  That earlier figure is corrected here.

---

## 4. Mergeable clusters (~500 LOC, coverage-neutral)

- **api Group 2**: 14 near-identical "non-member is rejected" tests, each booting its own
  wiring, all exercising the same `assertOrganizationMember` middleware. Keeper:
  `red-flag.test.ts:205` (loops every procedure); collapse the rest to one table-driven
  test → ~10 fewer wirings ≈ 20s.
- **api Group 3**: 34 tests → 7 table-driven across `jobpilot-culture-research` (16),
  `red-flag` (7), `commons` (5), `pkg2-commons-signing` (6) → ~28 fewer wirings ≈ 55s.
- **core**: `blueprint.test.ts:44-140` (8 → 1), `module-risk` + `sandbox-policy` (merge,
  keep every lethal-trifecta case), `media-store` + `goal-task` → stores file.
- **db**: delete 3 "fresh DB has an empty table" tests; fold `migration-0033/0034/0025`
  into `0026`'s generic RLS sweep (they assert HEAD schema properties, not migration
  behaviour) — ~250 LOC. Two `listPeople`/`listCommunities` pairs in `graph-store` are
  honest table-driven candidates (~150 LOC).
- **modules**: dealpilot vs jobpilot `table.test.ts` (~57 LOC → one shared conformance
  helper); both `scoring.test.ts` files are 4-case tables written longhand.

---

## 5. Coverage floors are being lowered to let features merge

| Floor | Packages |
|---|---|
| 80 | core, net-guard, dedupe |
| 70 | local, tables, facts, sourcing, capability-kit, dealpilot, jobpilot, whatsapp, people-sourcing, recorder |
| 65 | company-sourcing |
| 60 | **apps/api — currently RED at 48.84%** |
| 54 | db ⚠️ 55→54 (`40306ca`) — actual coverage is **90.36%**, 36 points of headroom |
| 53 | integrations-google (50→53, ratcheted UP) |
| 40 | commons |
| 38 | sensors ⚠️ 40→39 (`40306ca`) →38 (`d09ead7`) |
| 35 | models ⚠️ 40→35 (`089421f`) |
| none | **apps/web, apps/website, research, manifests** |

Three downward ratchets, **all landed inside feature commits, not test commits**. The
non-round values (35/38/53/54) are the tell — each sits just under what was measured.
"Tests pass" means 35% of lines ran in `models` and 80% in `net-guard`. The suite with
the most tests (`apps/web`, 164) has no gate at all — and is the one that cannot fail.

**Note the inversion:** db's floor is 54 while it actually achieves 90.36%. The floor is
meaningless there. Meanwhile `taint-audit-store.js` sits at 12.5% — under-tested, the
opposite of floor-gaming.

---

## 6. Why apps/api's coverage gate is red — and why no test change fixes it

`router.ts` is **16,795 of the 27,039-line `src/` (62%)** and sits at **34.49%** line
coverage. No amount of pruning or merging moves 48.84% → 60. **Splitting `router.ts` is
the only path to that floor** — i.e. TASK-031's deferred monolith split is the
prerequisite for the api gate ever going green, not a nice-to-have.

Three deletions would push coverage further down and must be done as MERGES, not
deletes: `commons.test.ts:172-274` (only coverage of `commons.list/get/getVersion`),
`single-tenant-guard.test.ts:58,69` (only happy-path coverage of `dealpilot.list`),
`wiring.test.ts:259-291` (only coverage of `buildPersistentPorts` at all).

---

## Recommended order

1. **`apps/api` → `--test-concurrency=4`** (one line, ~6 min saved, repo's own AP-019
   precedent). Biggest single win in this document.
2. **Share the db migrated schema** (~60% of db wall time, zero tests touched).
3. **Delete the 2 core files + trim `agents.test.ts`** (182 LOC, 11 tests, zero risk).
4. **Extract the three harnesses** (~1,250 LOC) — do core's FIRST, it is a correctness
   hazard, not just duplication.
5. **Replace the web grep suites with render tests** (~1,300 LOC out, ~300 LOC of real
   tests in). Keep `whatsapp-engine.test.mjs`.
6. **Execute the merge clusters** (~500 LOC, coverage-neutral).
7. **One monorepo coverage floor** with documented per-package exemptions; add a gate to
   `apps/web` once its tests are real. Add `--test-coverage-exclude` for core's
   roadmap-ahead paths so the 80% floor stops subsidising consumer-less substrate.

## Do NOT touch

Every kernel invariant test in `packages/core`: `pipeline`, `conformance` (13 INVARIANT
tests), `taint` (lattice, fail-closed unknown label, declassification), `redteam-egress`,
`integration-sink`, `agent-floor`, `agent-scope`, `skill-manifest` (15 AGS1 fail-closed
paths), `pipeline-ags1`, `child-agent-run`, `capability-trust`, `chat-store`,
`memory-store*`, `module-signing`, `content-guard`, `stores-bounded`. Plus every db
migration test asserting backfill correctness or rollback semantics (`0011`, `0013`,
`0015`, `0016:203`, `0017`, `0019`, `0020`, `0021`, `0023`, `0024:58`, `0027:41`,
`0029:50`, `0030`, `0031`, `0032`).

The 1,273 LOC / 72 core tests covering consumer-less roadmap substrate (`eval/*`,
`capability/registry`, `importer`, `builder-primitives`, `variance-adjuster`) are the
executable spec for ADR-recorded designs — quarantine behind a `test/roadmap/` glob,
do not delete.

---

## EXECUTION RECORD — 2026-08-03 (same day, user directive "Dont recommend, implement")

Landed:
1. **api `--test-concurrency=1` → `4`** (apps/api/package.json). Full suite at 4:
   391 pass / 2 fail — both failures were timing-sensitive socket-abort tests in
   `jobpilot-culture-research.test.ts`, rerun 57/57 clean on an idle machine; they
   flaked because the measurement run shared the CPU with the db suite. Watch item
   filed in BUGS (flake-under-load, not concurrency unsafety).
2. **db schema snapshot** (`BRIDGE_DB_TEST_SNAPSHOT=1`, env-guarded in
   `src/client-local.ts`, set by the db test script only): first in-memory open per
   process migrates + `dumpDataDir()`; later opens restore the dump. Measured:
   memory-store file 87s→35s; full suite **6m21s→5m00s, 217/217, coverage 90.40%
   unchanged**. Gain is per-file (202 migrates → 52) because node isolates test
   files per process — the audit's ~60% estimate assumed cross-file sharing and is
   corrected here.
3. **turbo.json: `test` now `dependsOn: ["build", "^build"]`** (was `^build` only —
   packages ran STALE compiled tests). This was the entire "48.84% coverage
   collapse": fresh api build measures **81.54% and PASSES its 60 floor**; the
   merged-tree turbo run had executed month-old dist tests. api gate is NOT
   structurally red; §6's router-split-required claim applied to the stale build.
4. **Deleted 10 cannot-fail test files** (2 core: foreign-import, context-provider;
   8 web greps: relationship-module, red-flag-control, view-grammar,
   table-renderers, dealpilot-core, taint-trace, observed-learning, avatar-overlay
   — each verified to import zero production code). KEPT `agents.test.ts`'s roster
   test (over-flagged: its deepEqual pins the ADR-046 runtime roster, a canon
   guard) and `whatsapp-engine.test.mjs` (Rust↔TS allowlist parity).
5. **Replacement behavioural coverage**: new `apps/web/test/dataviews-behavior.test.mjs`
   imports the real eligibility/migration/rowSearch/red-flag logic (node 24 type
   stripping). Two first-draft assertions FAILED against real behaviour
   (migrateViewConfig leaves known-but-ineligible kinds to the shell;
   isFlaggableValue's rule is emptiness, not primitiveness) — precisely the
   feedback grep tests can never give. Web suite: 164 → **116/116**, all meaningful.
6. **Tiering** (the "should all tests run all the time" answer): root
   `test:affected` / `verify:affected` scripts (turbo `--affected`) for local runs —
   packages untouched vs main don't run, so migration tests execute only when db
   changes; CI on main keeps the FULL suite as the gate per the affected-neighbour
   canon. Tiering changes when tests run, never whether they gate a merge.

Verified after all changes: core 485/485 (88.24% vs 80 floor), db 217/217 (90.40%),
web 116/116, api 393/394+1 skip (81.54% vs 60 floor, gate passing).

Deferred to TASK-036 (test absorber): harness extractions (core pipeline harness is
the priority — two of six copies already diverged), the ~34→7 api merge clusters,
db's 3 empty-table deletions + 0033/0034/0025→0026 fold, single monorepo coverage
floor + web gate, core roadmap-path coverage-exclude.
