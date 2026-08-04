# Test-speed research and execution — 2026-08-04

**Task:** TASK-036 · **Decision:** ADR-167 · **Tier:** C (build/CI, cross-package)

User question: *"Are there better ways to speed up the tests?"* — asked after the 2026-08-03 audit
had already deleted 10 cannot-fail test files and added the PGlite migration snapshot. This document
records what the research found, what was implemented, what was tried and rejected, and the measured
numbers. Every timing below is from this machine (8 cores, `availableParallelism() === 8`), not from
a vendor's marketing page.

## 1. What was implemented

### 1.1 Coverage is a gate, not an inner-loop cost

`--experimental-test-coverage` is a documented performance problem — `nodejs/node#55103`, open since
2024, measures roughly 2x per-test time versus `nyc` and remains open. Every package had it baked
into `test`, so it was paid on every local iteration to re-derive floors that only matter at the CI
gate.

Each package now defines two scripts:

| script | contents | who runs it |
| --- | --- | --- |
| `test` | the former command minus the coverage flags | local iteration, `test:affected` |
| `test:coverage` | the former command, byte-for-byte, floors included | CI |

CI switched to `turbo run typecheck test:coverage build --force`. Packages with no floor
(`research`, `web`, `website`) alias `test:coverage` to `test`, so the CI sweep still runs every
package exactly once. The gate is unchanged; only the local default moved.

Measured, `packages/core`: **3.18s → 1.68s** (47% faster). Whole monorepo, `--force`, 26 packages
either way: **8m39s / 2134s CPU → 6m40s / 1560s CPU** (23% wall, 27% CPU). The suite-level gain is
smaller than the per-package gain because `apps/api` dominates the critical path and turbo already
overlaps the rest.

### 1.2 Sharded shared-process runs (`scripts/test-shards.mjs`)

`node --test` runs each test FILE in its own child process. That is a safe default, but it silently
defeated the snapshot cache added on 2026-08-03: `packages/db`'s migration snapshot was rebuilt once
per file — 52 times — instead of once.

`--test-isolation=none` fixes the cache but serialises the suite, converting a CPU win into no
wall-clock win. The new runner takes both: split the files into N groups, run one
`--test-isolation=none` process per group.

`packages/db`, 217 tests, coverage off:

| mode | wall | CPU |
| --- | --- | --- |
| per-file isolation, `--test-concurrency=4` | 137.5s | 548s |
| single process, `--test-isolation=none` | 127.7s | 152s |
| **4 shards x `--test-isolation=none`** | **74.8s** | **240s** |

217/217 passed in all three. Against the pre-audit baseline (coverage on, per-file isolation, ~300s),
`packages/db` is now roughly **4x faster**.

### 1.3 Mutation testing, out of band

`packages/core/stryker.conf.json` scopes Stryker to the enforcement path (`pipeline.ts`, `policy/**`,
`capability/**`). It mutates production code and reports every mutant no test noticed — the automated
form of the hand-check that found the 109 cannot-fail tests, and something no coverage percentage can
express. Deliberately NOT part of `test`: every mutant re-runs the suite, so it belongs on a schedule
or before touching the pipeline.

**It found a real gap on the first run.** Mutating `sinkForRequest` — the taint sink map ADR-161 had
just fixed — gave a 49.18% mutation score: **31 of 61 mutants survived**. `req.action !== "read"`
could be replaced with the literal `true` and all 485 core tests still passed. The only rule with
zero survivors was the `integration` rule, the one ADR-161 had given a dedicated regression pack.
Line coverage on that file was 88% the whole time.

ADR-161 had already predicted this and asked for "a table-driven conformance test over every
`resourceType`". That test now exists (`test/taint-sink-map.test.ts`): all 24 resource types x 6
actions, expectations restated independently of the implementation so a map change must be
consciously mirrored, and `null` asserted explicitly because "deliberately not a sink" is the claim
that rots silently. `sinkForRequest` is exported from `pipeline.ts` for it; `index.ts` is untouched,
so the package's public API does not grow.

Re-running the same range: **49.18% → 100.00%, 62 mutants, 0 survivors.** Core is 488/488 at 88.29%
line coverage.

### 1.4 The api socket flake, fixed at the root

Raising parallelism makes load-dependent races fire, so this was a precondition, not a side quest.
`jobpilot-culture-research.test.ts` slept a fixed 100ms and then asserted a `close`-event boolean —
it was measuring scheduler latency, not whether the socket was aborted. Reproduced on a loaded
machine, then fixed with a `closeObserver()` that AWAITS the event with a 10s deadline, applied to
all three occurrences (the BUGS entry had named two; the third had the same defect).

Proven non-vacuous: sabotaging the compiled test so the close is never observed fails with
`timed out after 10s waiting for the server to observe the socket close`; restoring it passes.

## 2. Tried and rejected

**`--test-isolation=none` for `apps/api`.** Hangs past 10 minutes in shared-process mode (it passes
in 284s per-file). Killed and rejected. Shared-process mode is therefore an opt-in a suite must EARN
by passing under it — `test-shards.mjs` documents that as its entry condition rather than leaving it
to hope.

**Turborepo remote / cross-worktree caching.** This was *this session's own opening recommendation*,
withdrawn after reading the repo's history. `docs/BUGS.md` records "turbo cache replays across
worktrees" as a real historical defect, and `ci.yml` carries an explicit `--force` whose comment
cites that entry: *"a green run must mean THIS checkout was tested, not a replayed log from an
unrelated branch/worktree."* The repo has untracked, generated build inputs, so a cache hit does not
reliably prove identical inputs. Re-enabling cross-worktree reuse would buy wall-clock by
re-introducing false greens. Not taken — speed is not worth a verification lie.

**ML predictive test selection.** Genuinely effective at scale: Meta reports catching 99.9% of
regressions while running 33% of tests; T-Bank (Sept 2025, 6,500 UI tests) reports running 15% of the
suite for a 5.6x CI speedup at >95% detection. Both need thousands of historical CI runs to train and
a nightly full run as the safety net. For a single developer, `turbo --affected` already gives
deterministic change-scoped runs with no model to maintain. Revisit when there is a team and a CI
history to learn from.

## 3. Should everything run every time?

No — and the split is now mechanical rather than a matter of discipline:

- **Inner loop:** `pnpm test:affected` — only packages whose inputs changed. Migration tests run when
  `packages/db` changes, and not otherwise.
- **Before pushing:** `pnpm verify:affected` (typecheck + test + build).
- **CI on `main`:** the full suite with coverage floors, `--force`, no cache. Per the
  affected-neighbour rule, a narrow green check must never be able to hide an affected failure.
- **Scheduled / before touching the pipeline:** Stryker on `packages/core`.

## 4. Still on the table

- `apps/api` is now the critical path (~284s standalone). Its 303 `buildWiring` calls are the cost,
  and shared-process reuse is closed off — a wiring fixture or builder memoisation is the remaining
  lever, and it is real work, not configuration.
- `--experimental-test-coverage` remains the largest single multiplier in CI. Sampling coverage
  (gate on `main` only, skip on PRs) would cut CI time, at the cost of later gate feedback.
- The three tools the user referenced are not test-speed tools: **Fabraix** is adversarial
  red-teaming for customer-facing AI agents (relevant to the SECURITY track in TASK-038, not here),
  **Codag** compresses infrastructure logs for AI agents (a token-cost tool for debugging sessions),
  and **Traceforce** is device-level AI/MCP security for enterprises (not applicable to a solo repo).
