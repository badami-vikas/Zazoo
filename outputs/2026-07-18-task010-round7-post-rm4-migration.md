---
title: TASK-010 round 7 — post-RM4 migration (0016), owner-aware Memory RLS, durable lineage revision
type: output
date: 2026-07-18
task: TASK-010
status: in_progress (not done — no live browser evidence yet)
related_wiki: docs/wiki/index.md
---

# TASK-010 round 7 — post-RM4 migration

## Context

TASK-008 RM4 landed migration `0015` on `origin/main` (`590cca6`), unblocking the three items
TASK-010 had reported as genuine blockers at head `24e4eab`: owner-aware Memory/ledger RLS,
DB-backed per-lineage revision ordering, and the JobPilot `green/yellow/red` → `pursue/review/pass`
backfill+constraint. This round merges `origin/main`, reconciles the merge surgically, implements
all three, and re-verifies the full affected surface.

## Merge reconciliation

`git merge origin/main --no-edit` produced 3 conflicts, all resolved:

- `docs/TASKS.md` — took origin/main's reordered/reformatted structure, re-applied TASK-010's own
  evidence text (kept `Status: in_progress`).
- `docs/log.md` — kept both sides' entries sequentially.
- `platform/apps/api/src/router.ts` — RM4 built its OWN relation-proposal privacy mechanism
  (`assertRelationshipProposalOwner`, a new `action.listHistory` endpoint, `pipeline.listPending`'s
  `privateOwnerUserId` param) independently of TASK-010's `inputs.visibility === "private"` red-flag
  marker. Composed BOTH: kept the `isPrivateProposalInputs`/`isProposalVisibleTo` checks (scoped to
  `resourceType !== "relation"`) alongside RM4's `assertRelationshipProposalOwner`; adopted RM4's
  `pipeline.listPending({ privateOwnerUserId })` call shape for `listPending`; kept `listHistory` as-is.

**A merge-tool bug found and fixed**: `packages/core/src/memory/stores.ts` ended up with DUPLICATE
`InMemoryAgentStore.workspaces`/`statuses`/`workspaceId`/`isActive` members (both branches added the
same `AgentQuery` methods independently, with different status enums). Kept RM4's richer version
(`"active"|"paused"|"retired"`, defaults to NOT-active when unset) after confirming no caller relied
on the old permissive default.

**A real privacy gap found and fixed post-merge**: RM4's `pipeline.listPending`/`ledger.listHistory`
filtering (`privateRelationOwnerScope`/`ledgerEntryVisibleToPrivateOwner`) was hardcoded to
`resourceType === "relation"` only — meaning a red-flag proposal (`resourceType: "signal"`,
`inputs.visibility: "private"`) would have leaked to every workspace member through RM4's own new
endpoints. Caught via a failing test written immediately after the merge. Fixed by widening both the
Drizzle (`packages/db/src/ledger-store.ts`, renamed `privateRelationOwnerScope` →
`privateProposalOwnerScope`) and in-memory (`packages/core/src/memory/stores.ts`,
`isPrivateLedgerEntry`) implementations to treat a row as private when EITHER `resourceType ===
"relation"` (RM4's original) OR `inputs.visibility === "private"` (TASK-010's marker) — same
onBehalfOf/actor ownership check for both. A SQL three-valued-logic bug surfaced in the process:
`inputs->>'visibility' = 'private'` is SQL `NULL` (not `false`) for a row with no `visibility` key,
silently excluding even that row's own legitimate owner — fixed via `coalesce(..., '')`.

RM4 also independently rewrote `apps/web/src/app/data/ledger.ts`'s `loadLedger()` to use its new
`action.listHistory` instead of a direct Supabase read — closing `docs/BUGS.md`'s previously-open
"direct ledger read bypasses tRPC privacy" entry as a side effect. Verified the widening above ALSO
protects red-flag proposals through this endpoint. `docs/BUGS.md` entry updated OPEN → RESOLVED.

## Migration `0016_new_ink`

Reserved the next free migration number after RM4's `0015`. Contents:

1. **JobPilot flag backfill + constraint**: `UPDATE jobpilot_applications SET flag = 'pursue' WHERE
   flag = 'green'` (same for `yellow→review`, `red→pass`), run BEFORE a new CHECK constraint
   (`flag IS NULL OR flag IN ('pursue','review','pass')`) so no pre-existing row can fail it.
2. **`memories.lineage_revision`** — new nullable `bigint` column, durable per-lineage revision
   ordering (see below — this round WIRED it into `casSupersede`, not just added the column).
3. **Owner-aware RLS for `memories`** — new `app_private.visible_memory_row(workspace_id, scope,
   owner_user_id)` function (mirrors `DrizzleMemoryStore`'s existing app-side
   `OPEN_SCOPES=[public,workspace]`/`OWNER_SCOPES=[team,private,restricted]` split exactly); replaced
   `memories_tenant_select`/`update`/`delete` policies to use it. INSERT stays `same_workspace`-only
   (a new row's scope/owner is caller-supplied, same convention as `edges`/`ledger`).
4. Extended migration `0015`'s `REVOKE ALL PRIVILEGES ... FROM anon, authenticated` guard to also
   cover `public.memories` (same `IF EXISTS` role-guard, no-op in pglite tests).

**`ledger`'s own RLS is deliberately left unchanged** (still `same_workspace`-only + the REVOKE) —
this was attempted (a `visible_proposal_row` policy) and reverted after it broke a real, pre-existing
test (`relation-materialization-store.test.ts`'s forced-RLS test): `LedgerStore.get(id)`/
`decisionFor(proposalId)` take no caller-identity parameter and are called from dozens of unrelated
call sites app-wide, so safely threading a viewer identity through every one of them is a genuinely
broad port-signature change, not a surgical fix in this pass. This matches TASK-008 RM4's OWN
precedent exactly: `0015` added owner-aware RLS for `edges` (simple visibility/owner columns, narrow
`RelationStore`-only caller surface) but deliberately did NOT do so for `ledger`, relying only on the
REVOKE. TASK-010's red-flag proposal privacy remains enforced at the QUERY level (`listPending`/
`listHistory`'s `privateProposalOwnerScope`, unaffected by this decision) — reported transparently as
a scoped, considered gap, not silently glossed over.

To make the new `memories` RLS policy correct for the API's OWN writes/reads (not just external
clients), `packages/db/src/memory-store.ts` was substantially reworked: a new `withMemoryRlsContext`
helper wraps every public method (`write`/`supersede`/`get`/`retrieve`/`forget`/`currentForLineage`/
`casSupersede`) in a transaction that sets both `app.workspace_id`/`app.user_id` session GUCs — needed
because `SET LOCAL`-equivalent config only survives for the current transaction, and (per `client.ts`'s
own doc comment) production app connections are expected to run under a real, RLS-subject role, not a
superuser bypass.

## Durable per-lineage revision ordering (`lineage_revision`)

Beyond adding the column, this round WIRED it end-to-end:

- `@bridge/core`'s `MemoryEntry` gained `lineageRevision?: number | null`; `MemoryQuery` gained
  `orderBy?: "createdAt" | "lineageRevision"` (the latter only valid for a query already scoped to one
  lineage via `subjectElementId` — comparing revisions ACROSS lineages is meaningless, since every
  lineage's first row is revision 1) and a `cursor.lineageRevision` field.
- Both adapters' `casSupersede` now allocate `(current?.lineageRevision ?? 0) + 1` in the SAME
  transaction/turn that already reads the lineage's current head under SERIALIZABLE isolation (DB
  adapter) / the same synchronous turn (in-memory adapter) — a concurrent racer computing the same
  next revision hits the exact write-skew SERIALIZABLE isolation already detects and aborts, so no
  separate `MAX(lineage_revision)` query is needed.
- `apps/api/src/router.ts`'s `redFlag.history` procedure now passes `orderBy: "lineageRevision"`
  (valid — it's scoped to one flag's own lineage) instead of `createdAt`; the cross-lineage `flags`
  audit list is unchanged (still `createdAt`, correctly — a per-lineage revision is meaningless there).
  `encodeRedFlagCursor`/`decodeRedFlagCursor` now carry an optional third `lineageRevision` slot.
- A `null` revision (any legacy row, or any write not made through `casSupersede`) always sorts
  OLDEST regardless of direction — proven via both a real-Postgres DB test and an in-memory test, each
  covering the exact null/allocated keyset-pagination boundary (the class of three-valued-logic bug
  this task has hit twice before, in the `contentPathEquals` JSON cast and the RLS predicate).
- The process-local `monotonicRedFlagNowISO()` counter is UNCHANGED and still needed — it still
  supplies `createdAt` itself, and cross-lineage global ordering still legitimately uses it.

New/updated tests: `packages/core/test/memory-store-cas.test.ts` (+2: revision allocation 1/2/3/...
per-lineage isolation and racer-safety; null-revision keyset ordering/pagination),
`packages/db/test/memory-store-cas.test.ts` (+2: same two properties against REAL pglite Postgres,
including a genuine concurrent-transaction race proving the winner always gets the correct next
revision, never a duplicate).

## Two build-tooling bugs discovered and fixed (blast-radius)

1. **`generate-pending-work.mjs` silently produced 0 Task Manager records after the RM4 merge.** RM4's
   `docs/TASKS.md` reformat changed every task heading from `## TASK-XXX — Title` to `## Title` + a
   separate `- ID: TASK-XXX` line; `task-doc-parser.mjs`'s heading regex still expected the old shape,
   so it silently matched nothing and `pending-work.generated.json` regenerated to an empty
   `items: []` on every build — a silent data-loss regression with no error. Fixed the parser to
   recognize a `## Title` heading as a task iff the immediately-following line is `- ID: TASK-XXX`
   (any other `##` heading resets the current task, so its own stray fields never leak onto the
   preceding task). Updated the parser's test fixture to the new canonical shape and added a
   dedicated non-task-heading-reset regression test. Regenerated the file (22 records, correct order).
   Logged to `docs/BUGS.md`.

   **Addendum (post-second-merge)**: before this round could push, `origin/main` moved to `da25b97`
   (a TASK-003 recovery merge that also carried a parallel `TASK-023` addition). Merging it revealed
   that ANOTHER session had independently discovered and fixed this exact same parser bug — their
   version is a strict superset of this round's fix (it ALSO accepts the legacy `## TASK-XXX — Title`
   heading for backward compatibility, and throws on a section whose `## Title` and `- ID:` line name
   two different, conflicting task IDs). Adopted `origin/main`'s implementation wholesale over this
   round's own narrower one; kept both test suites (no assertions overlapped) — 4 tests total.
   Regenerated `pending-work.generated.json` again against the fully-merged `docs/TASKS.md`: 23
   records (one more than this round's own 22, since the second merge's `TASK-023` is now included).
2. **`services/commons/test/signing.test.ts` created its temp fixture dirs inside the repo tree**
   (`process.cwd()`) instead of the OS tmpdir, unlike its sibling `registry.test.ts` — any interrupted
   test run left `.commons-signing-test-*`/`.commons-restart-test-*` debris as untracked repo litter.
   Fixed both `mkdtemp()` call sites to use `os.tmpdir()`. Deleted the pre-existing (git-untracked,
   empty) leftover directories. Logged to `docs/BUGS.md`.

## Verification

- `@bridge/core`: 430/430 (+2 lineage-revision tests).
- `@bridge/db`: 143/143 (+2 lineage-revision tests).
- `@bridge/api`: 214/214 (full suite, including all 38 red-flag tests).
- `@bridge/web`: 64/64 (unaffected by DB/core changes; confirmed after the pending-work fix).
- `@bridge/commons`: 22/22 (confirmed no repo litter after the signing-test fix).
- Full monorepo `typecheck` (22/22 packages) and `build` (23/23) clean.
- `lint`: 2 pre-existing, unrelated findings (`ZazooAvatar.tsx`, `determinism.ts`) — unchanged from
  every prior round, not touched by this session.
- `check:no-dummy-runtime`: clean.
- Migration `0016_new_ink.sql` fresh-db apply + idempotent no-drift re-run verified via
  `packages/db/test/migration-0016.test.ts` (JobPilot backfill+constraint; `lineage_revision` added as
  backward-compatible nullable; idempotent re-migrate).
- `@bridge/sensors` and `@bridge/commons` coverage-threshold "failures" seen in one `turbo run test`
  pass were traced to origin/main itself (reproduced standalone on a clean `origin/main` worktree,
  `631aa9f`) and a transient parallel-run flake respectively — both pre-existing/environmental, not
  caused by this round's diff. A later `red-flag.test.js` failure seen in one full-suite run was
  traced to CPU/memory contention from a DIFFERENT, unrelated session's concurrent test run sharing
  this machine (`fuzzy-meme` worktree, confirmed via `cwd` inspection of the competing processes) — a
  clean standalone re-run and two full-suite re-runs both passed 38/38 / 214/214 with zero failures.

## Explicitly NOT done / remaining gaps

- **Live desktop + 375px browser interaction evidence** — not claimed, per standing instruction.
- **`ledger`'s own RLS** — deliberately left at `same_workspace`-only, matching RM4's own precedent;
  reported as a considered gap, not silently deferred (see migration section above).
- **A genuine two-member "direct SQL/client role" RLS test specifically for the new `memories`
  policy** (mirroring `rls.test.ts`'s `useRlsAppRole`/`setRlsContext` pattern) was NOT added this
  round — `migration-0016.test.ts`'s tests are schema/backfill-focused, and `memory-store.ts`'s own
  RLS-context-threading was verified via the full existing memory-store suite (zero regressions) but
  not via a dedicated restricted-role adversarial test. Flagged as outstanding, not fabricated as done.

`docs/TASKS.md` TASK-010 `Status` remains `in_progress`.
