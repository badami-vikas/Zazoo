---
title: Platform Testing Strategy
type: raw
doc_kind: plan
status: DRAFT — coverage numbers measured 2026-07-04, priority list not yet executed
companions: [decisions-log.md, ARCHITECTURE.md, SCHEMA.sql]
related_wiki: ../wiki/testing.md
updated: 2026-07-04
tags: [testing, coverage, ci, governance, google-integration, dedupe]
---

# Platform Testing Strategy

Every package uses Node's built-in `node --test` against compiled `dist/test/*.test.js` —
no vitest/jest, no coverage wired into `turbo run test`, no CI at all (see BUGS.md).
Numbers below are from a real `node --test --experimental-test-coverage` run on 2026-07-04
after a from-scratch `pnpm install` + `turbo run build --force` in a worktree that had never
been installed — not from cache, not estimated.

## Testing pyramid by component

```
                E2E (0 today)
         Prototype UI ↔ real API, DealPilot/JobPilot source→commit→approve flows

           Integration (thin today)
    tRPC router ↔ core pipeline ↔ Drizzle stores ↔ real Postgres (RLS, unique constraints)
    Google gateway ↔ recorded HTTP fixtures (refresh, 401, 429, rotation)

              Unit (majority of what exists)
  core pipeline, authority, agent-scope, dedupe/match, jobpilot scoring/pacing,
  dealpilot connectors/scoring
```

Node's `--test` runner is adequate for the unit layer already in place. It has no fixture/
recording story (`nock`-equivalent) for the integration layer — that gap is why
`integrations-google` sits at 54% line / 28% funcs despite being the highest-risk package.

## Coverage snapshot (2026-07-04, real run)

| Package | Line % | Branch % | Func % | Verdict |
|---|---|---|---|---|
| packages/core | 94.02 | 80.65 | 92.11 | Healthy |
| packages/dedupe | 100.00 | 86.11 | 100.00 | Green but misses the exact tie-break bug (see below) |
| packages/db | 78.89 | 76.00 | 45.75 | Store layer badly undertested |
| packages/integrations-google | 54.16 | 61.81 | 27.82 | Worst package; buggiest files least tested |
| apps/api | 93.96* | 83.33 | 69.23 | *Only measures `social/*` — router/wiring/identity untested and invisible to the tool |
| tools/dealpilot | 73.98 | 83.60 | 65.00 | connectors.js good; pipeline branch coverage thin |
| tools/jobpilot | 80.11 | 86.31 | 74.47 | pacing.ts 100% unit-covered, 0 production callers |

**The headline finding: coverage is inversely correlated with risk.** The three files carrying
this session's P0 findings (`gateway-google.ts`, `ledger-store.ts`, `apps/api/src/router.ts`)
are the three worst-tested or entirely untested files in the platform. Coverage percentage
alone is not a proxy for risk — this table should be read file-by-file, not by package average.

## What to cover (priority order, tied to confirmed defects)

### P0 — must land before any pilot workspace goes live

1. **`decide()` double-approve.** `packages/core/src/pipeline.ts` — concurrent `decide()` calls
   on the same proposal (fire two in parallel via `Promise.all`, assert exactly one commits, one
   throws a typed "already resolved" error). Currently **zero test exercises concurrency** — all
   existing pipeline tests are sequential awaits.
2. **`matchOne` tie-break determinism.** `packages/dedupe/src/match.ts` — add a test with two
   pool targets at an *exactly equal* trigram score and assert the winner is deterministic
   (currently unspecified — passes today only because no test constructs a tie). This is the
   single highest-value test to add: one assertion converts a silent data-corruption bug into a
   caught regression.
3. **OAuth token-refresh persistence failure.** `packages/integrations-google/src/gateway-google.ts`
   — inject a `SecretStore.putToken` that rejects, fire a `"tokens"` event, assert the failure is
   logged/surfaced rather than silently swallowed (today: zero test touches the `"tokens"`
   listener at all — 13% line coverage on this file confirms it).
4. **Router-level test file for `apps/api/src/router.ts`.** There is currently no test file for
   this module — add one covering: `propose`/`decide` happy path through real (not fixture)
   wiring, agent-floor-denied rejection, and the `dealpilot.list` cross-workspace-id case (assert
   it either scopes correctly or explicitly rejects a non-pilot `workspaceId` — see known-issues).
5. **`hasExternal` double-propose window.** `packages/integrations-google/src/intake.ts` —
   simulate two `syncGmail()` calls before approval; assert the second does not create a second
   pending proposal for the same `sourceRecordId`.

### P1 — before the next tenant/workspace onboards

6. **Governance store round-trips.** `packages/db/src/governance-stores.ts`,
   `ritual-stores.ts`, `canonical-store.ts` — each is under 42% line / under 58% func. At minimum:
   one round-trip test per store method against a real (or pglite) Postgres, plus one malformed-
   jsonb test per `asStep`/`#scope` parser asserting it throws or logs rather than silently
   filtering (see known-issues "untyped jsonb read via shape-guessing").
7. **Ledger `ref_ledger_id` / `__refLedgerId` collision.** Once the schema fix lands (real column
   + unique index, per the code-review plan), add a regression test: a skill's `diff` output that
   happens to contain a key named `__refLedgerId` must not corrupt resolution detection.
8. **Rate-limit / CORS absence.** No test today asserts an unauthenticated or over-quota request
   is rejected — because there's no rate limiter to test. Once `@fastify/rate-limit` (or
   equivalent) lands, add a 429-path test; add a CORS-origin-rejected test now (it will currently
   fail, which is the point — write it red, fix the middleware, watch it go green).
9. **Ritual halt / partial-commit.** `packages/core/src/ritual-executor.ts` — one test asserting
   what the current behavior actually is (steps 0..N-1 committed, step N halted, no rollback) so
   any future rollback fix has a pinned "before" baseline to diff against.

### P2 — coverage-completeness pass, not urgent

10. Bring `packages/db` store layer to the `packages/core` bar (~90%+ line, 80%+ func) —
    mechanical, mostly missing happy-path tests for methods that exist but are never called.
11. `integrations-google/oauth.ts` and `intake.ts` general branch coverage — errors on malformed
    Gmail payloads, empty `parts`, oversized base64 bodies (ties to the "unbounded multipart
    recursion" finding — a test with a deeply nested/large payload should assert a cap, once one
    exists).
12. E2E: at least one recorded flow per governed tool (DealPilot source→quarantine→commit→approve;
    JobPilot onboarding→scoring→apply-gate) against the real API, not the prototype's local store.

## What to skip

Trivial getters, Drizzle-generated schema type re-exports (`schema.ts` func coverage is
structurally near-0% and not meaningful — it's column definitions, not logic), one-off scripts
in `Tools/*/scripts`, and the prototype's localStorage persistence layer (real behavior to test
is the swap point, `usePersistentState`, once it targets a real API — not the localStorage shim
itself).

## Process

- Wire `--experimental-test-coverage` into each package's `test` script and have CI (once it
  exists, see known-issues CI entry) fail under a per-package floor: 80% line for `packages/core`
  and `packages/dedupe` (already met), 70% line for everything else as an interim floor before
  raising it — do not set floors above what's currently achievable or CI will be red on day one
  for reasons unrelated to this session's work.
- Every new P0/P1 fix from the 2026-07-04 code review must ship with the regression test listed
  above in the same change — these are exactly the tests that would have caught the bug.
