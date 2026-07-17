---
title: TASK-010 round-5 remediation — legacy API containment, RLS gap tracked, saga/lineage/idempotency hardening
type: raw
doc_kind: audit
status: applied
companions: []
related_wiki: docs/wiki/decisions.md
updated: 2026-07-17
tags: [task-010, red-flag, governed-learning, saga, review-remediation, rls]
---

# TASK-010 round-5 remediation

The coordinator's round-5 review of the round-4-remediated commit (`b177778`) found 11 more defects,
2 explicitly marked CRITICAL (legacy-API Memory-kind leakage; DB RLS bypass). This round fixed
everything possible at the application layer, and DOCUMENTED (never fabricated) the pieces that
genuinely require the still-pending TASK-008 RM4 migration (`0015`, confirmed not yet landed on
`origin/main` via `git fetch`). All 11 items are addressed below.

## 1. Legacy API containment (CRITICAL)

**Before**: `onboarding.learningState` was a bare `procedure` (unauthenticated for queries) reading
Memory scoped to the shared `ctx.wiring.pilotUserId` constant with **no kind filter** — any caller,
authenticated or not, could read every Memory in that scope, including private `red_flag`/
`preference_adjustment` corrections. `onboarding.forgetMemory` had the same auth gap plus no kind
check — any caller could delete a red-flag Memory directly, bypassing `redFlag.forget`'s proposal-
withdrawal logic entirely (leaving an approvable proposal referencing deleted evidence).

**Now**: both are `authenticatedProcedure` + `assertMembership`, owner-scoped to `ctx.identity.id`
(never `pilotUserId`). `learningState` filters to a new `isLegacyOnboardingContent` whitelist
(`onboarding_preference`/`reflection_schedule`/`trust_capture` only — confirmed against
`SettingsPage.tsx`'s `LearningSection`, which never reads anything else from this query).
`forgetMemory` explicitly rejects (`FORBIDDEN`) a `red_flag`/`preference_adjustment`-kind target,
forcing all correction deletion through `redFlag.forget`. New tests: tokenless/non-member rejection
on both procedures, `learningState` never surfacing red-flag/adjustment content even when such rows
exist for the SAME owner, `forgetMemory` rejecting both kinds explicitly.

## 2. Owner-aware DB RLS (migration-gated — documented, not fabricated)

Investigated the full scope: `ledger`/`memories` RLS is workspace-wide SELECT with no owner/
visibility predicate, so a client bypassing tRPC (direct Supabase read) could see the mere
*existence* of another member's private red-flag proposal (round 4 already made the ledger payload
opaque — `{flagMemoryId, governed, applied, summary}`, never raw anchor/renderedValue/reason — so
this is a bounded existence/metadata leak, not the critical raw-content leak rounds 2-4 already
closed). Audited every direct-Supabase web read: `apps/web/src/app/data/ledger.ts`'s `loadLedger()`
is the ONLY one bypassing tRPC (`loadPendingApprovals()` already correctly uses
`trpc.action.listPending.query`, which enforces the private-proposal filter). No direct client
`ledger`/`memories` INSERT/UPDATE/DELETE exists anywhere in the web app (confirmed via grep) — that
part of the requirement is already satisfied structurally.

**Why not fixed outright this round**: closing this needs (a) a real RLS migration narrowing
`ledger` SELECT to `(workspace member AND (not private OR on_behalf_of_id = auth.uid()))` — blocked
behind RM4's `0015` — and (b) a brand-new tRPC "list full ledger history, filtered" procedure (the
`LedgerStore` port only exposes `listPending`/`get`/`decisionFor`/`append` today — no "list all,
paginated" method exists for ANY feature, not just red-flag). Building that is a genuinely large,
cross-cutting addition (the Execution Ledger page serves every feature's decision history, not just
red-flag) that risks destabilizing unrelated areas if rushed in this pass. Logged as a fully
evidenced, tracked `docs/BUGS.md` entry (2026-07-17) with the exact fix sequence instead of silently
deferring or fabricating a migration. **Remains open** pending RM4 + the new endpoint.

## 3. Ship enactment (no more stranded approved corrections)

**Before**: `redFlag.enactCorrection`/`revokeCorrection` existed server-side (round 4) but
`RedFlagControl.tsx` never called `enactCorrection` — an approved correction had no UI trigger and
would sit forever un-enacted.

**Now**: the popover checks `action.resolution({proposalId})` **on demand** (only when the popover
opens on a `learningStatus: "proposed"` flag — never batched into the page-load query, so this
doesn't reintroduce the item-7 N+1) and shows an "Enact correction" button once approval is
confirmed, calling `ctx.enactCorrection`. "Undo correction" (`revokeCorrection`) already existed from
round 4 and is unchanged.

## 4. Proposal ID correctness

**Before**: `attemptGovernedLearningStep` initialized `resolvedProposalId` to the deterministic
*guess* before any ledger confirmation. If `synthesizePreferenceAdjustment` or `pipeline.propose`
itself THREW (not merely returned rejected), the catch block never reset it — the flag's content
persisted a `proposalId` that was never actually appended to the ledger. `withdrawPendingRedFlagProposal`
(called by clear/forget) would then call `pipeline.decide(proposalId, ...)` on that phantom id, which
throws a bare, untyped `Error` (`"decide: no ledger entry ..."`) that isn't one of the two swallowed
exception types — an unhandled 500 on clear/forget for a flag whose learning step genuinely failed
before touching the ledger.

**Now**: `resolvedProposalId` starts `undefined` and is only ever set once existence is confirmed —
either via the `existingLedgerEntry` reconciliation check, or via the REAL `Proposal.id`
`pipeline.propose` hands back on a normal return (`#reject`'s rejected-path ledger entry gets its own
`ctx.ids.next()` id, never the requested one, so `proposal.id` is always the ledger's actual id
either way). `withdrawPendingRedFlagProposal` also now checks `ledger.get(proposalId)` directly
first and treats a confirmed-absent entry as "already withdrawn," defensively covering any
historical flag that might still carry a stale phantom id. New tests: a thrown governed step leaves
`proposalId` absent (not the deterministic guess); clear/forget on such a flag succeed without
erroring.

## 5. Cross-store saga hardening

Audited every listed race. Most were already covered by rounds 2-4's existing CAS/reconciliation
work (`casSupersede` + re-read-on-`null` pattern used consistently across clear/reopen/updateReason/
enactCorrection/revokeCorrection/forget). The one genuinely untested gap — a REAL concurrent
`updateReason` vs. `clear` racing the SAME current flag (the prior test only checked sequential
staleness) — now has a dedicated `Promise.allSettled` test: exactly one wins, the other gets
CONFLICT, and the lineage never forks (its current version is exactly the winner's own result). The
durable DB-backed outbox TABLE the coordinator's ideal design calls for is migration-gated (same RM4
dependency as items 2/7) — the existing in-request CAS-and-reconcile pattern is the interim, and
remains correct for every single-request saga step this app currently issues.

## 6. Canonical anchor registry

- `canonicalModuleId()` — a single shared alias-normalization function used by BOTH
  `canonicalAnchorString` (hashing) and `validateAnchorTarget` (existence-checking), so an alias
  (`"job-pilot"` vs. `"jobpilot"`, `"initiative"` vs. `"dealpilot"`, `"people"` vs. `"person"`,
  `"communities"` vs. `"community"`) can never fork one real target's correction lineage in two, nor
  validate more permissively under one spelling than another. New test proves both spellings hash to
  the identical lineage key and collide as the SAME flag (CONFLICT on a second create, identical
  `listForAnchor` results).
- `JobPilotApplicationDetail.tsx` (unrouted, renders on the static non-UUID `BCG_APPLICATION`
  fixture) had its `RedFlagControl`/`RedFlagProvider` wiring **removed entirely** — a control there
  would always fail-closed (`NOT_FOUND`) against the fixture's fake ids, which is not "interactive-
  looking UI that works" (AP-021). `docs/dummy.md`'s existing entry for this fixture was updated to
  note the removal.
- `TableView.tsx` now gates rendering on a new `isSupportedRedFlagModule()` client-side mirror of the
  server's `validateAnchorTarget` allowlist — a `"signal"` node type (rendered via `WorkspacePage.tsx`,
  no backing existence-check store yet) no longer gets a flag glyph that would always error; the
  supported modules (`jobpilot`, `dealpilot`/`initiative`, `touchpoint`, `person`, `community`) still
  render and work.
- **The required "real bullet" prototype target**: `JobPilotPage.tsx`'s Card view now renders two
  real, `RedFlagControl`-wrapped bullets (`Stage: …`, `Fit: … (NN%)`) per job, anchored to the REAL
  persisted `application.id` (validated server-side via `jobpilotStore.getApplication`) using
  already-persisted fields (`stage`, the normalized `flag`/`fitScore`) — not fabricated content. This
  closes the gap flagged across rounds 4-5 (JobPilot's `strengths`/`concerns` reason arrays are never
  persisted anywhere, so no *rendered* bullet surface existed with a real backing record before this).

## 7. Durable lineage ordering (migration-gated — documented)

The process-local `monotonicRedFlagNowISO()` counter is correct within one request/process but not
across multiple server instances or a restart. Extended its doc comment with an explicit, permanent
warning plus the exact planned fix (a DB-backed, atomically-allocated per-lineage revision column,
allocated inside `casSupersede`'s own transaction, `history`'s keyset becoming
`(lineage_revision, id)`) — blocked behind the same RM4 migration gate as items 2/5. Left the interim
counter in place (still strictly better than nothing for the single-instance case this deployment
currently runs).

## 8. Safe structured filtering

**Before**: `retrieve()`'s `contentPathEquals` unconditionally cast `content::jsonb` — Postgres does
not guarantee left-to-right evaluation of `AND`-combined conditions, so a single non-JSON `content`
row anywhere in the matching set (not just across different `sourceRefType`s — any row within the
SAME `sourceRefType:"feedback"` subset could be non-JSON) could break the whole query with a real,
reproducible cast error (confirmed via a 50+-row adversarial repro; a `WITH ... AS MATERIALIZED` CTE
fence does NOT fix this, since the unsafe rows can exist within the "safe" subset itself).

**Now**: wrapped in `CASE WHEN content IS JSON THEN (content::jsonb #>> ...) ELSE NULL END` — the SQL
standard guarantees `CASE WHEN` evaluates sequentially (unlike `AND`/`OR`), making the cast provably
safe regardless of query plan. `IS JSON` is a real PG16+ predicate (pglite runs genuine PostgreSQL
16.4). New regression test: 60 non-JSON `sourceRefType:"feedback"` rows + 1 real red-flag row, exactly
1 correct match, no error.

## 9. Status predicate before limit

`redFlag.listAll`'s `status` filter is now pushed into `contentPathEquals` alongside `kind:
"red_flag"` (safe thanks to item 8's fix), replacing the prior app-side post-page `.filter(...)` —
matches item 8/round-4's "filter in the store before limits" principle exactly.

## 10. Cross-process idempotency

Two real bugs found and fixed:

- **`provisionRedFlagLearningTask`'s Goal provisioning** used `listGoals` + `.find(...)` — a
  check-then-act race with a NON-deterministic Goal id (random `seam.nextId()` fallback). Two
  concurrent callers (different processes) could both see no matching Goal and both insert a
  SEPARATE one. Fixed to a deterministic Goal id (one per workspace) with a `getGoal`-first +
  catch-and-recheck fallback, mirroring the Task-creation logic immediately below it. New test: two
  DIFFERENT anchors' first-ever flags in a fresh workspace, created concurrently, both succeed and
  converge on exactly ONE Goal.
- **`casSupersede` only caught `40001`** (serialization failure), not `23505` (unique violation) —
  a deterministic Memory id (e.g. a red-flag correction's `memoryId`) means two genuinely concurrent
  callers can both pass the in-transaction "no current row" compare and then both attempt to INSERT
  the IDENTICAL row id, which Postgres reports as `23505`, a different failure mode than the
  write-skew `40001`. Added `isMemoryIdUniqueViolation` (scoped to `memories_pkey`, mirroring
  `ledger-store.ts`'s existing `isRefLedgerUniqueViolation` pattern) and extended the catch. Unlike
  the `40001` case, pglite's single-connection execution model DOES reliably reproduce this specific
  race for real — confirmed via a genuine `Promise.all` repro during development (one call resolved
  to the row, the other to `null`, no unhandled throw), now a permanent regression test.

## 11. Provider state integrity

`RedFlagProvider.tsx`'s `refresh()` previously did `.catch(() => setRows([]))` on failure — a
transient network error made every EXISTING flag disappear from the UI, indistinguishable from a
genuinely empty scope, and `loading` silently flipped to `false`. Fixed:
- A distinct `error: boolean` context field; a failed refresh now preserves last-good `rows` and
  only flips `error`, never resetting to `[]`.
- A `generationRef` counter stamps every `refresh()` call; a response is only applied if it's still
  the most recent refresh when it lands — closes an out-of-order-response race between an older
  in-flight refresh (e.g. initial mount) and a newer one (e.g. a mutation's own follow-up refresh).
- `create()` now throws if `rows === null` (the batched scope query has never yet succeeded) —
  `RedFlagControl`'s flag glyph is correspondingly disabled while unflagged AND still loading, and
  surfaces a `create()` failure inline (`role="alert"`) instead of an unhandled rejection.

## Verification

Full re-run after ALL 11 items: core 426, db 121 (+2), api 211 (+21 new/rewritten red-flag/security
tests across rounds), web 64 (+7), jobpilot 94, dealpilot 72, commons 22, integrations-google 35 — all
pass. The Goal-provisioning race test and the concurrent-updateReason-vs-clear test were each re-run
3x back to back to confirm stability (no flakes). Full monorepo `turbo run typecheck` (37/37) and
`build` (20/20) clean. Full `turbo run test --concurrency=1 --continue` (serialized to eliminate
resource-contention flakiness, matching the documented pattern in `docs/BUGS.md` 2026-07-14): 36/37
green — the one failure (`@bridge/sensors` coverage floor, 37.22% vs. the 39% floor) is a
pre-existing, already-documented (`docs/BUGS.md` 2026-07-15), completely unrelated baseline gap, not
touched by this session. `check:no-dummy-runtime` clean. Lint: scoped to every file this session
touched, 0 findings; the 2 pre-existing repo-wide findings (`ZazooAvatar.tsx`'s unregistered
`react-hooks/exhaustive-deps` rule, `determinism.ts`'s unused eslint-disable) are unrelated,
already-documented, outside this session's blast radius.

## Remaining / not claimed

- **Item 2 (RLS) and item 7 (durable lineage revision)** remain genuinely open pending TASK-008 RM4's
  migration `0015` landing on `main` — documented above and in `docs/BUGS.md`/inline code comments,
  not fabricated.
- **Item 2's new "list full ledger history" tRPC endpoint** is additionally not yet built (a
  cross-cutting addition beyond a quick fix) — tracked in `docs/BUGS.md`.
- **No live desktop/375px browser evidence** has been captured this round — only source/unit/HTTP-
  level verification, consistent with every prior round. `docs/TASKS.md` TASK-010 stays `in_progress`.
- The persisted `FitRecommendation` migration (green→pursue/yellow→review/red→pass backfill, item 9
  from round 4) remains pending the SAME RM4 gate, as already reported.
