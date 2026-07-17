# TASK-010 — independent review remediation (2026-07-17, round 2)

Commit `e4a2a3c` (the initial TASK-010 implementation) was reviewed
independently and found NOT merge-ready: high/medium correctness and
privacy defects across auth/ownership, ledger privacy, saga/idempotency,
concurrency control, anchor identity, pagination, N+1 queries, touch
detection, and an unbacked persisted-column rename. This document records
the full remediation — every item, what changed, and how it was verified.
Status remains `in_progress` (docs/TASKS.md unchanged on that point): no
live desktop+375px browser evidence exists yet, only source/unit/HTTP-level
verification.

## 1. Auth/ownership (IDOR)

**Before**: every `redFlag` procedure used the permissive `procedure`
(queries were structurally unauthenticated — `requireAuthOnMutation` only
gates mutations); `ownerUserId`/auth-scope `userId` used
`ctx.wiring.pilotUserId`, a shared constant, instead of the real caller.

**After**: every procedure (`create/clear/reopen/updateReason/forget/
listForAnchor/listForScope/listAll/history`) is `authenticatedProcedure` +
`assertMembership`. Owner is always `ctx.identity.id`. `memoryStore.get()`'s
existing authority-scoped visibility (private → owner-only) is the primary
defense (a non-owner's `get()` already returns `null`, indistinguishable
from "doesn't exist" — no IDOR existence oracle); every mutation ALSO
explicitly re-asserts `ownerUserId === ctx.identity.id` and
`kind === "red_flag"` before acting. `forget` rejects arbitrary/foreign/
wrong-kind Memory ids (verified against a real onboarding-preference Memory
and a nonexistent id).

**Tests**: `IDOR: a DIFFERENT authenticated workspace member cannot read,
clear, reopen, updateReason, or forget someone else's flag`; `unauthenticated
and non-member callers are rejected on every redFlag procedure`; `forget
rejects an arbitrary/foreign/wrong-kind Memory id instead of deleting it`.

## 2. Ledger privacy / withdrawal

**Before**: `pipeline.propose()`'s `inputs` carried the flag's full
`anchor`, `renderedValue`, `reason`, and a `rationale` string built from
them — all workspace-wide-readable via `action.listPending`/`decide` (any
member can query pending proposals).

**After**: `inputs` is now exactly
`{kind: "red_flag_correction_proposal", flagMemoryId, governed: true,
applied: false, summary: "A platform red-flag correction was submitted for
governed review."}` — an opaque Memory reference plus a generic, non-
sensitive summary. A reviewer resolving the proposal must separately fetch
the referenced Memory through the SAME owner-scoped `redFlag` endpoints
(private scope, owner-only) to see substantive detail — a non-owner cannot
infer content from the ledger alone. `clear` and `forget` both call the new
`withdrawPendingRedFlagProposal` helper, which vetoes (`pipeline.decide`)
any still-`pending_review` proposal citing the flag, swallowing
`AlreadyResolvedError`/`NotPendingProposalError` (nothing left to withdraw).
Each flag version links to its proposal via `value.proposalId`.

**Tests**: `PRIVACY: the ledger's proposal row never carries the flag's
anchor/renderedValue/reason — only an opaque Memory reference + generic
summary` (asserts the serialized ledger row does NOT match the private
detail strings, and that `inputs`' keys are exactly the 5 generic ones);
`clear/forget withdraw a still-pending governed proposal so it can never
later be approved` (asserts `ledger.decisionFor(proposalId).userDecision ===
"veto"` after clear, and that a second withdrawal attempt after the
proposal is already resolved does not throw).

## 3. Saga / idempotency

**Before**: `create()` always generated fresh random ids for the Memory,
the governed Task, and the ledger proposal — a retry (network timeout,
double-submit) would create a SECOND Memory, a SECOND Task, and a SECOND
ledger row. The governed step's outcome was never distinguished from
success (`learningStatus` was unconditionally set to `"proposed"` even if
`pipeline.propose` had actually been rejected, and a THROWN error was not
handled at all).

**After**: `create` takes a client-supplied `operationId` (a UUID). Every
downstream id is deterministically derived from it via a SHA-256-based
`deterministicUuid()` helper: the Memory id
(`redflag-memory:{owner}:{operationId}`), the governed Task id
(`redflag-task:{owner}:{operationId}`), and the ledger proposal id
(`redflag-proposal:{owner}:{operationId}`). The handler is a genuine
two-step saga:
- **Step 1** (the Human's correction): idempotent via `memoryStore.get()`
  first — if the deterministic Memory id already exists, its content is
  compared to the resent input (same anchor + renderedValue) and reused;
  a MISMATCH (operationId reused with different content) is rejected
  `CONFLICT`, never silently accepted.
- **Step 2** (the governed learning attempt): skipped entirely if
  `learningStatus !== "none"` (already attempted). On success,
  `learningStatus: "proposed"`; on an explicit non-`pending_review` result
  OR a thrown error, `learningStatus: "failed"` with
  `learningFailureReason` recorded — the correction itself (step 1) is
  NEVER rolled back or lost just because step 2 failed ("Memory is Human
  truth and may survive learning failure").
- `provisionRedFlagLearningTask` checks for an existing Task at the
  deterministic id first, and falls back to a re-fetch if a concurrent
  retry's `createTask` throws a duplicate-key error — safe against the
  persistent adapter's real unique-id constraint racing a retry.

**Tests**: `SAGA: a retried create (same operationId) converges — no
duplicate Memory/Task/proposal` (asserts identical Memory id, exactly one
flag in `listAll`, exactly one Task under the Goal); `SAGA: reusing an
operationId with DIFFERENT content is rejected as a conflict`; `SAGA: create
rejects a second, DIFFERENT operationId targeting an anchor that already
has an open flag`.

## 4. Single current lineage / compare-and-swap

**Before**: `clear`/`reopen`/`updateReason` called `memoryStore.supersede()`
unconditionally — two concurrent calls (or a stale client-held `flagId`)
could both succeed, forking the lineage (two "current" rows referencing the
same original, with no way to tell which is authoritative).

**After**: `@bridge/core`'s `MemoryStore` port gained two new methods:
- `currentForLineage(workspaceId, ownerUserId, lineageKey)` — the current
  (non-superseded) row for a lineage.
- `casSupersede({workspaceId, ownerUserId, lineageKey, expectedCurrentId,
  next})` — atomic optimistic-concurrency create-or-supersede; returns
  `null` (never forks) if `expectedCurrentId` doesn't match the ACTUAL
  current row at the moment of the call.

Both `InMemoryMemoryStore` and `DrizzleMemoryStore` implement this
genuinely atomically:
- **In-memory**: a synchronous check-and-mutate — `currentForLineage`'s
  logic is duplicated as a private, non-`async`-bodied twin
  (`#currentForLineageSync`) so NO `await` occurs between the compare and
  the write, exactly mirroring `InMemoryLedger.append()`'s existing
  TOCTOU-closing technique. (Development note: the FIRST version called the
  public `async currentForLineage()` via `await`, which — despite having no
  internal `await` — still yields to the microtask queue, letting two
  `Promise.all`-raced callers both read stale state and both "win"; this
  was caught by a dedicated concurrency test during development and fixed.)
- **Persistent**: a real Postgres `SERIALIZABLE` transaction. Two
  concurrent transactions both reading "row X has no child yet" and both
  inserting a row with `supersedes_id = X` is the textbook write-skew
  scenario SERIALIZABLE is designed to reject — one transaction gets a real
  `40001` serialization-failure error, caught and reported as CAS-failure
  `null` (not a process-local lock — correct across any number of app
  server processes/connections). Verified against a REAL pglite Postgres
  instance with two genuinely concurrent transactions (`Promise.all`), not
  simulated.

No new `lineage_key` schema column was needed: `subjectElementId` (existing,
already indexed — `memories_ws_subject_idx`) is repurposed as the
lineage key, set to a deterministic UUID hash of the canonical anchor
string (see item 5). `redFlag.clear/reopen/updateReason` all use
`casSupersede` with `expectedCurrentId` = the caller's `flagId`; a stale id
is rejected `CONFLICT`.

On the client, `RedFlagControl.tsx` serializes textarea-blur reason-saves
against Clear/Reopen/Forget clicks (`pendingSaveRef` + `afterPendingSave()`)
so a fast button click can never race an in-flight reason save — blur fires
before a sibling button's click when focus moves away, which was a genuine
race window. `updateReason` is also a no-op (both client and server) when
the reason hasn't actually changed, so it never forks a lineage row for
free.

**Tests**: 5 new `@bridge/core` tests (`memory-store-cas.test.ts`) + 4 new
`@bridge/db` tests against real pglite (`memory-store-cas.test.ts`,
including the genuine two-concurrent-transaction race); API-level `CAS:
clear/reopen/updateReason reject a stale flagId with CONFLICT instead of
forking the lineage`; `updateReason is a no-op... when the reason does not
actually change`.

## 5. Canonical anchor identity

**Before**: `RedFlagAnchor` was one flat object with ALL-optional fields
(`moduleId, databaseId?, recordId?, fieldId?, fileId?, resultId?,
bulletPath?`) validated only by "at least one of recordId/fileId/
bulletPath." A cell anchor and a bullet anchor sharing `moduleId`+`recordId`
could collide (both would produce the same "identity" if fieldId/bulletPath
happened to coincide in some derived key); a file-only and a result-only
bullet anchor with the same id string and bulletPath were indistinguishable
in principle. `TableView.tsx` passed `spec.id` (e.g. `"jobpilot.jobs"`,
really the DATABASE identity) directly as `moduleId`, conflating two
different concepts.

**After**: `RedFlagAnchor` is a proper discriminated union:
```ts
type RedFlagAnchor =
  | { kind: "cell"; moduleId: string; databaseId: string; recordId: string; fieldId: string }
  | { kind: "bullet"; moduleId: string;
      target: { type: "record"; recordId: string } | { type: "file"; fileId: string } | { type: "result"; resultId: string };
      bulletPath: string };
```
enforced by a `z.discriminatedUnion` zod schema (nested discriminated union
for `target` too). `canonicalAnchorString()` builds a NUL-separated
(`\u0000`, which can never appear in ordinary field values) string
encoding every discriminant and field, so no combination of field values
across two DIFFERENT anchor shapes can produce the same string; this is
SHA-256-hashed into a deterministic, valid-shape UUID (`anchorLineageKey`)
used as the CAS lineage key (item 4). `TableView.tsx` now derives `moduleId`
from `databaseId` via a new `moduleIdFromDatabaseId()` helper (splits on the
first `.`, e.g. `"jobpilot.jobs"` → `"jobpilot"`) instead of conflating the
two.

**Tests**: `ANCHOR IDENTITY: a cell anchor and a bullet anchor sharing the
same moduleId/recordId never collide`; `ANCHOR IDENTITY: file-only and
result-only bullet anchors never collide even with the same bulletPath`
(identical `bulletPath` AND identical id string across `file`/`result`
targets — still two distinct flags).

## 6. Audit/history — pagination and full lineage

**Before**: `listAll`/`listForAnchor` fetched an unbounded (well, a hardcoded
200-row) generic `memoryStore.retrieve()` call and filtered client-side —
no server-side "kind" push-down, no pagination, and Settings could silently
truncate behind unrelated Memories once a workspace had >200 total Memory
rows of any kind.

**After**: `@bridge/core`'s `MemoryQuery` gained a `sourceRefType` filter
(both adapters push it into the actual store query, not an app-side scan),
so every red-flag list query is pre-filtered to `sourceRefType: "feedback"`
before any limiting. `listAll` takes `limit`/`cursor` (an opaque
base64url-encoded offset) and returns `nextCursor` (null once exhausted).
`listForAnchor` now does an indexed `subjectElementId` equality lookup
(the anchor's lineage key) instead of a full-table scan. A new `history`
procedure returns the COMPLETE lineage for one flag (every create/clear/
reopen/updateReason/learning-outcome version, oldest first, including
superseded rows) via `retrieve({subjectElementId, includeSuperseded: true})`.
Settings' "Red flags" Card now has a "Load more" button wired to
`nextCursor`.

Documented, accepted limitation: `status` filtering is still applied
AFTER the store's own pagination (Memory `content` is opaque JSON, so it
can't be pushed into the SQL `WHERE` without a schema change) — a page may
legitimately return fewer than `limit` matching rows even when more exist
further in the cursor. Fixing this fully would need a structured-content
schema change, out of scope here.

**Tests**: `listAll paginates server-side with an opaque cursor instead of
silently truncating` (5 flags across 3 pages of limit=2, union covers all
5 exactly once); `history returns the full lineage..., oldest first,
including superseded versions` (asserts all 4 real versions — including
the internal step-1-to-step-2 supersede inside `create()` itself).

## 7. Eliminating per-cell N+1 queries

**Before**: `RedFlagControl` called `trpc.redFlag.listForAnchor.query(...)`
on every mount — one HTTP round-trip PER rendered cell/bullet.

**After**: new `redFlag.listForScope` procedure returns every current flag
under a scope (a Module, optionally narrowed to one Database/table, or one
record/file/result) in ONE call. New `RedFlagProvider` (React context)
fetches this once per table/record and exposes `flagFor(anchor)` — a
client-side lookup over the already-fetched set, keyed by the SAME anchor
discrimination (`anchorMatchKey`, independent of the server's own
`canonicalAnchorString`/hash — only needs to be internally consistent).
`RedFlagControl` is now a pure context consumer: it makes ZERO `trpc.redFlag`
calls itself (verified by a test asserting the string `trpc.redFlag.` does
NOT appear in `RedFlagControl.tsx`); all mutations go through the
provider's `create/clear/reopen/updateReason/forget` wrappers, which
`refresh()` the ONE batched query after any mutation. `TableView.tsx` wraps
its whole `<Table>` in one `<RedFlagProvider scope={{moduleId, databaseId:
spec.id}}>`; `JobPilotApplicationDetail.tsx` wraps `ArtifactViewer` (scoped
to `recordId: artifact.id`) and the Overview tab's fit bullets (scoped to
`recordId: application.id`) each in their own provider.

**Tests**: `RedFlagControl is a context CONSUMER (no per-mount fetch)`;
`listForScope batches an entire scope's current flags in one call`.

## 8. Touch / accessibility

**Before**: persistent visibility (for devices without hover) was gated on
`max-[767px]:opacity-60` — a VIEWPORT WIDTH breakpoint, not pointer
capability. A touch-capable device at a wide viewport (e.g. a touchscreen
laptop, an external display on a tablet) would incorrectly get hover-only
(invisible-until-hover) behavior; a narrow browser window on a desktop
mouse would incorrectly get the touch treatment. The glyph's hit target was
a flat 16x16px (`h-4 w-4`) — well under the 44x44 CSS px touch-target
guideline.

**After**: visibility uses the arbitrary Tailwind variant
`[@media(hover:none)]:opacity-60` — gated on actual pointer capability, any
viewport size. The touch/coarse-pointer hit target is enlarged via an
absolutely-positioned invisible `::before` overlay
(`[@media(pointer:coarse)]:before:absolute [@media(pointer:coarse)]:before:-inset-3.5`,
a -14px inset on all sides of the 16px glyph → a 44x44 effective hit area)
that never shifts surrounding cell/bullet layout, while the visible glyph
itself stays small. Keyboard focus (`focus-visible:opacity-100`),
`aria-pressed`, and the `role="menu"` popover semantics are unchanged.
`event.stopPropagation()` on activation (already present) prevents a
table-row click handler (if one exists) from also firing.

**Tests**: `RedFlagControl gates visibility on POINTER CAPABILITY (not
viewport width), keeps a >=44px touch hit target...` — asserts the pointer-
based media query is present AND that no viewport-width breakpoint
(`max-[\d+px]:opacity`) remains.

## 9. Persisted `FitRecommendation` migration — PENDING, not fabricated

The JobPilot `applications.flag` column (schema.ts, plain `text`, no CHECK
constraint) persisted the pre-canon `"green"|"yellow"|"red"` values before
TASK-010's original rename to `"pursue"|"review"|"pass"`. Any row written
before this task's code landed would still hold an old value on disk.

**Explicitly deferred, per the review's own instruction**: TASK-008 RM4 owns
the next schema migration slot (`0015`) and has not landed on `main` as of
this pass (confirmed: `origin/main` is still at `f20f611`, unchanged since
this task started). Fabricating a `0016` migration/snapshot now — before
RM4's actual `0015` content exists — would risk exactly the kind of
migration-numbering collision the coordinator warned about.

**What WAS done now** (code + tests, no schema change):
- `@bridge/jobpilot` gained `normalizeLegacyFitFlag(value)` — maps
  `"green"→"pursue"`, `"yellow"→"review"`, `"red"→"pass"`, passes new values
  through unchanged, returns `null` for anything else. This is the interim,
  non-schema-changing safety net: nothing in the current codebase reads a
  PERSISTED `flag` value back into a client-facing context yet (confirmed —
  `JobPilotPage.tsx`'s fit/flag UI was already removed by concurrent
  TASK-006-adjacent work before this task touched it), so there is no
  current call site requiring this normalizer to be wired in today, but it
  is ready, exported, and tested for whenever one is added.
- `schema.ts`'s `flag` column comment now explicitly documents the pending
  migration and points to this doc and the normalizer.

**The exact plan for once RM4 lands** (recorded here, not yet executed):
1. `git merge origin/main` to pick up RM4's `0015`.
2. Add migration `0016` (or the next free slot after whatever RM4 actually
   used) with:
   ```sql
   UPDATE applications SET flag = 'pursue' WHERE flag = 'green';
   UPDATE applications SET flag = 'review' WHERE flag = 'yellow';
   UPDATE applications SET flag = 'pass'   WHERE flag = 'red';
   ALTER TABLE applications
     ADD CONSTRAINT applications_flag_valid_ck
     CHECK (flag IS NULL OR flag IN ('pursue', 'review', 'pass'));
   ```
3. Regenerate the Drizzle snapshot AGAINST the real post-RM4 schema state
   (never against the current, pre-RM4 `0014` baseline).
4. Prove fresh-install AND upgrade-from-`0014`-plus-RM4 paths both apply
   cleanly, plus the existing migration-no-drift check.

**Reported status**: PENDING, not complete — tracked here and in
`docs/TASKS.md`'s TASK-010 evidence, not silently marked done.

## Verification (full re-run after all 9 items)

- `@bridge/core`: 426/426 (421 pre-existing + 5 new CAS tests).
- `@bridge/db`: 111/111 (107 pre-existing + 4 new CAS tests against real
  pglite, including a genuine concurrent-transaction race).
- `@bridge/api`: 187/187 (170 pre-existing + 17 rewritten red-flag tests
  covering all 6 server-side review items).
- `@bridge/jobpilot`: 94/94 (93 + 1 new normalizer test).
- `@bridge/dealpilot`: 72/72 (untouched, affected-neighbor sanity check).
- `@bridge/commons`: 22/22, `@bridge/integrations-google`: 35/35 (affected-
  neighbor sanity checks).
- `@bridge/web`: 57/57 (49 pre-existing + rewritten red-flag-control suite,
  now 8 tests covering touch/pointer, CAS-race serialization, context-only
  consumption, anchor shape, and pagination markers).
- `npx turbo run typecheck build` — full monorepo, 40/40 tasks clean.
- `npx eslint .` — full monorepo: 0 new errors/warnings (2 pre-existing,
  unrelated findings confirmed present on the untouched tree — same two as
  round 1: `ZazooAvatar.tsx`'s broken `react-hooks/exhaustive-deps`
  disable, `determinism.ts`'s unused-disable warning).
- `pnpm run check:no-dummy-runtime` — clean.

## Outstanding

- **Item 9 (migration)**: PENDING on TASK-008 RM4 landing — see above.
- No live desktop/375px browser walkthrough of the actual pointer-hover/
  keyboard-focus/click/touch interaction has been captured — only source-
  level, unit-test-level, and (round 1) HTTP-level verification.
- A fresh independent read-only review of this remediated commit is being
  requested before reporting completion back to the coordinator.

## Round 3 — fresh independent review found 2 more real bugs, both fixed

A fresh, independent read-only review of the round-2 remediation was
requested and executed (verifying by running actual code and constructed
repros, not just reading). 7 of the 9 claimed fixes held up under
inspection with nothing worth reporting (auth/ownership, ledger privacy,
anchor identity, pagination, N+1 elimination, touch/CSS, and no-fabricated
migration). Two did not — both confirmed by executing the actual code:

### Bug A: the idempotent-retry check never actually fires on a genuine retry

**Where**: `redFlag.create`'s resumability check read `currentValue` from
`flagged` — the row fetched via `memoryStore.get(memoryId, ...)` where
`memoryId` is the DETERMINISTIC, IMMUTABLE step-1 Memory id. That specific
row's content is written ONCE at creation with `learningStatus: "none"` and
never changes in place — the actual outcome ("proposed"/"failed") is
recorded on a DIFFERENT, later-superseding row
(`redflag-memory-outcome:...`). So `currentValue.learningStatus !== "none"`
could never be true, and every retry of an already-completed `create()`
re-executed `provisionRedFlagLearningTask` + `pipeline.propose()` from
scratch with the same deterministic `proposalId` — which then threw a
"ledger: duplicate id ... (append-only violation)" internally on every
retry. The client-visible end state happened to still be correct (the
final `casSupersede` call's own stale-`expectedCurrentId` check caught the
mismatch and fell back to a re-read), masking the redundant work as a
"no observable bug" — but `pipeline.propose` was genuinely being invoked
twice, not skipped as the code's own doc comment claimed.

**Fix**: resolve the ACTUAL current lineage state via
`memoryStore.currentForLineage(workspaceId, ownerId, anchorKey)` (falling
back to `flagged` only if nothing exists yet) BEFORE deciding whether to
attempt step 2, and use that row's id (not `flagged.id`) as the final
`casSupersede`'s `expectedCurrentId`. Added a precise regression test that
monkeypatches `wiring.pipeline.propose` to count invocations and asserts
exactly 1 call across a create-then-retry pair — the kind of assertion that
would have caught this immediately (the prior test only checked the
converged end state, which is exactly what let this bug hide).

### Bug B: the persistent CAS's serialization-failure detection was dead code, and broken

**Where**: `DrizzleMemoryStore.isSerializationFailure` checked
`err.code === "40001"` directly on the caught error. drizzle-orm ≥0.45
wraps every query failure in a `DrizzleQueryError`, hanging the real
Postgres error (which carries `.code`) on `.cause` — NOT at the top level.
This exact behavior is already documented and worked around elsewhere in
this same package: `ledger-store.ts`'s `isRefLedgerUniqueViolation` walks
the `.cause` chain up to 6 levels for precisely this reason. Without the
same unwrap, a REAL Postgres `40001` serialization failure under genuine
concurrent load would never be recognized — it would re-throw as an
unhandled `DrizzleQueryError` instead of gracefully returning `null`,
which is exactly the "silently forking history" failure mode the whole
CAS primitive (review item 4) exists to close. The existing "two REAL
concurrent transactions" test did not catch this: pglite's single-
connection execution model doesn't reliably produce genuine write-skew
under `Promise.all`, so that test's "exactly one wins" result came from
the in-transaction `current.id !== expectedCurrentId` check alone — the
`catch` block (and therefore `isSerializationFailure`) was never entered.

**Fix**: `isSerializationFailure` now walks the `.cause` chain identically
to `isRefLedgerUniqueViolation`'s established pattern (same depth limit,
same reasoning). Since forcing pglite to produce a genuine `40001` isn't
reliable in this test environment, added two more targeted tests instead
of relying on chance: (1) a standalone unit test constructing REAL
`drizzle-orm` `DrizzleQueryError` instances (imported directly, not
mocked) wrapping a `.code: "40001"` cause at both one and two levels of
nesting, asserting `isSerializationFailure` recognizes both and correctly
rejects an unrelated SQLSTATE (`23505`) and non-error values; (2) a
`casSupersede` integration test that monkeypatches `db.transaction` for
one call to reject with a real wrapped `40001`, asserting `casSupersede`
returns `null` rather than letting the error propagate.

### Re-verification after both fixes

`@bridge/core`: 426/426 (unchanged — these fixes were api+db only).
`@bridge/db`: 113/113 (111 + 2 new: the standalone unwrap test and the
`casSupersede` integration test). `@bridge/api`: 187/187 (the retry test
was strengthened in place, not added as a new test — same count).
`@bridge/jobpilot`: 94/94, `@bridge/dealpilot`: 72/72, `@bridge/commons`:
22/22, `@bridge/integrations-google`: 35/35, `@bridge/web`: 57/57 —
unaffected, confirmed via a full re-run. Full monorepo
`typecheck build` (40/40) clean. `eslint .` clean on every file this round
touched (0 new errors; the 2 pre-existing, unrelated findings from prior
rounds remain, confirmed present on the untouched tree). No new schema
migration, no new dummy data.

### Outstanding (unchanged)

Item 9's migration remains PENDING on TASK-008 RM4 landing. No live
desktop/375px browser walkthrough has been captured — only source-level,
unit-test-level, and (round 1) HTTP-level verification.
