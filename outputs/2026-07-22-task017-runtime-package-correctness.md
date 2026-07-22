# TASK-017 — Runtime and package correctness backlog (closed)

**Status:** `done` under AP-072 (2026-07-22). Delivered in five reviewed slices merged to `main`:
`21a4ca3`, `5c5ddbe`, `e70a5f8`, `49a9fff`, `5674b05`. No DB migration required (high-water stays `0030`).

## What was actually broken vs. stale

Of the eleven catalogued defects, three were already stale (fixed incidentally by later work, never
marked resolved) and were confirmed + closed as documentation only; the rest were real code fixes.
The lint failure and a chunk of the taint-test fallout were **regressions that had reached `main`
unnoticed because the repo's GitHub Actions runners are payment-blocked** — no CI has actually run
for weeks.

| ID | Defect | Outcome |
|----|--------|---------|
| D1 | Repo `pnpm lint` red | **Real (regression).** TASK-013 relocated DealPilot to `platform/modules/dealpilot/`, which the `bridge/no-crm-vocab` rule's `KERNEL_PATH` then treated as kernel scope, wrongly flagging DealPilot's own sanctioned `Deal` Record vocabulary (219 errors). Added a narrow `modules/dealpilot/**` carve-out; removed one unused eslint-disable. Lint exit 0. |
| D2 | `globals.css` empty / app unstyled | **Stale.** File is ~9.3 KB with `@import "tailwindcss"` + theme tokens. Marked RESOLVED. |
| D3 | `node:vm` in the browser bundle | **Real.** `InProcessJsSandboxProvider` moved to a new `@bridge/core/server` subpath export; the barrel keeps only browser-safe sandbox types. Web build emits zero `node:` externalization. |
| D4 | Package store in-memory in both modes | **Stale/superseded.** Persistent wiring composes `DrizzleModuleStore` (`module_installations`-backed). Marked RESOLVED. |
| D5 | Install proposals use interim `signal`/`skill` tokens | **Real.** Added `module_installation`/`organization_definition`/`capability` ResourceTypes (ledger `resource_type` is free text — no migration); repointed the three interim sites; preserved agent-floor protection and module-install authority. |
| D6 | `helpdesk.route` topics caller-supplied | **Real (security).** Topics now derived server-side from `Person.skills`; input is `candidatePersonIds` (no caller topics). Closes a vector where a caller could inject topics onto someone else's Person to steer routing. |
| D7 | Pins persisted only in `localStorage` | **Stale/moot.** Pins feature removed under shell IA v2; `lib/pins.ts` gone. Marked RESOLVED. |
| D8 | Approved external effects had no durable retry | **Real.** Verified existing relationship/module reconcilers, then added a general idempotent `action.reconcileApproved` (reuses the original approval + idempotency key + authority + audit; no second decision). |
| D9 | `@bridge/sensors` below coverage floor | **Real.** The low number was `@bridge/core` dist diluting the aggregate; scoped coverage to `dist/src/**` (own source 100%, floor 38 unchanged) plus meaningful capture-ledger/capability-store tests. |
| D10 | Paginated Relationship Views filter/sort only the loaded page | **Real.** `listPeople`/`listCommunities` accept the View's `sorts`/`rowFilters`/`filterMatch`; `DrizzleGraphStore` applies them in SQL before `limit`/`offset`. Injection-safe: explicit column allowlist, parameterized values, `ESCAPE '!'` ILIKE, deterministic `id` tiebreaker, bounded (5 sorts / 20 filters). |
| D11 | "3 stale Relationship API taint expectations" | **Real, broader than catalogued.** The TASK-015 taint landing left the api Relationship test **plus 14 `@bridge/core` tests** (pipeline-ags1, conformance INVARIANTs, capture-pipeline, postcommit-effect-types) asserting pre-taint behavior — all failing because their hand-built `RunCtx` fixtures omitted the `human_input` taint label that `context.ts` always attaches in production. Fixed by attaching that label to the shared test helpers; no runtime code changed, no quarantine weakened. |

Also fixed a stale `modules.test` VOCAB5 expectation (Relationship manifest legitimately `0.2.2`→`0.2.3`
via the TASK-023 web-research merge).

## Verification

Code/build/test-based (not a live browser walkthrough): builds of `@bridge/core`/`@bridge/db`/`@bridge/api`
clean; `@bridge/web` typecheck clean; targeted tests — core 477/477, db graph-store 21/21, api
graph-people-communities 12/12, modules 22/22, capability-governance 7/7, blueprint 6/6, router-decide
10/10, sensors own-source 100%; repo `eslint .` exit 0.

## Two pre-existing gaps surfaced during review — filed, not fixed here

1. **GitHub Actions runners are payment-blocked.** No CI has run for weeks, which is the root cause the
   above regressions reached `main` uncaught. Restoring billing/runners would auto-catch this class.
2. **Authorization gap in governance approvals.** `capability.approve` and `organization.blueprint.activate`
   return early only on a `pending_review` proposal — a `rejected` (authority-denied) proposal falls through
   and performs the mutation anyway. Compounded by `seedGovernance` granting no `capability:approve`/
   `organization_definition:approve` authority, so these endpoints currently work only via the fall-through.
   Needs a hard-stop on `rejected` **and** proper approve grants. Recorded in `docs/BUGS.md` (OPEN 2026-07-22).
