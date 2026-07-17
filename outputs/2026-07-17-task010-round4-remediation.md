---
title: TASK-010 round-4 remediation — governed learning substance, private proposals, saga durability
type: raw
doc_kind: audit
status: applied
companions: []
related_wiki: docs/wiki/decisions.md
updated: 2026-07-17
tags: [task-010, red-flag, governed-learning, saga, review-remediation]
---

# TASK-010 round-4 remediation

The coordinator's final review of the round-2/round-3 remediated commit found 11 remaining
defects. This document records what each one was, exactly how it was fixed, and the 3 additional
real bugs found while implementing the fixes (each caught by actually executing the code — writing
a repro, running it, watching it fail — not just re-reading the diff).

## 1. Governed learning must be substantive, not a no-op opaque echo

**Before**: the governed proposal's `inputs`/`proposedOutput` was `{kind, flagMemoryId, governed:
true, applied: false, summary}` — a fixed, static shape. Approving it did nothing: `resourceType:
"signal"` is advisory-only, so there was no "enactment" path at all. The whole governed step was a
structural no-op dressed up as a workflow.

**Now**:
- `synthesizePreferenceAdjustment` (router.ts) reads the flag's own evidence Memory **under owner
  authorization** (`memoryStore.get(flagMemoryId, {workspaceId, userId: ownerId})` — fails loudly if
  unreadable, a real guard, not a formality) and writes a genuinely structured, owner-private
  `preference_adjustment` Memory: `{kind, flagMemoryId, anchor, proposedChange: {type:
  "suppress_value"}, rationale, proposalId, status}`. `proposedChange` is deliberately the ONE safe,
  generic corrective action derivable from a flag without inventing an unverified replacement value
  out of free-text `reason` — "this rendered value is wrong; withhold it once enacted."
- The ledger's own `inputs` stays exactly as private/opaque as round 2 already made it — now also
  referencing the new `preferenceAdjustmentId` — never the adjustment's own content.
- `redFlag.enactCorrection` (new) — a plain, Human-authorized, authenticated tRPC mutation (never
  `pipeline.propose`, never an Agent actor) — requires the linked proposal to be genuinely
  `approve`d (`ledger.decisionFor`), then supersedes the preference adjustment to `status:
  "applied"` and the flag's own `learningStatus` to `"applied"`. Idempotent (already-applied is a
  clean no-op).
- `redFlag.revokeCorrection` (new) — the undo: permanently revokes the linked preference adjustment
  (terminal `status: "revoked"`, never re-enactable) and reverts the flag's `learningStatus` to
  `"dismissed"`.
- `clear`/`forget` also call `revokePreferenceAdjustmentPermanently` (new helper) — an
  already-**applied** correction gets un-applied (permanently) the moment its flag is cleared or
  forgotten, never left silently still-in-effect.
- **The web half**: `RedFlagControl` renders `(corrected, pending re-entry)` in place of the
  flagged value whenever `learningStatus === "applied"` — the literal, visible proof that "behavior
  changes only after approval" — with an "Undo correction" button wired to `revokeCorrection`.

Tests: `redFlag.create writes...synthesizes a real private preference adjustment`, `ENACTMENT:
enactCorrection requires an approved proposal...`, `ENACTMENT: a rejected/vetoed proposal can never
be enacted`, `REVOCATION: revokeCorrection undoes...permanently prevents re-enactment`,
`CLEAR/FORGET: clearing/forgetting an ALREADY-APPLIED correction permanently revokes...`.

## 2. Private-proposal resolution

**Before**: `action.listPending`/`decide` had no ownership concept beyond workspace membership — any
member could see and resolve ANY proposal, including a red flag's private correction.

**Now**: the red-flag proposal's `inputs` carries `visibility: "private"`. `isPrivateProposalInputs`/
`isProposalVisibleTo` (router.ts) gate both:
- `action.listPending` loops through the pipeline's own pages (mirroring the existing
  `proposeOutreachDraft` accumulate-until-exhausted idiom) and filters out any private proposal not
  raised `onBehalfOf` the caller, before slicing to the requested page — `total`/`hasMore` describe
  the caller's actually-visible set.
- `action.decide` rejects `FORBIDDEN` if the target proposal is private and the caller isn't its
  `onBehalfOfId`.
- Every OTHER (non-private) proposal shape is completely unaffected — team-visible semantics
  unchanged.

Tests: `PRIVATE PROPOSALS: a red-flag proposal is invisible in action.listPending to any OTHER
member, and only its owner can decide it`, `PRIVATE PROPOSALS: an UNRELATED (non-private) proposal
keeps full team-visible semantics` (constructs a REAL governed Agent-Run proposal via
`agentOrchestration.goal/task.create` + a direct `pipeline.propose` call, proving the private-gate
is scoped to `visibility: "private"` alone).

## 3. Replay-safe create saga

**Before**: on retry, if a prior attempt's `pipeline.propose` had already appended a ledger entry
(e.g. the process crashed before the final outcome CAS), a retry would blindly call `propose` again
with the same deterministic `proposalId` — either throwing the ledger's own duplicate-id violation
(misreported as `"failed"`) or, worse, attempting the governed Skill a second time. Separately, a
genuinely `"failed"` outcome was permanently un-retryable (the skip-check only excluded `"none"`).

**Now**:
- `attemptGovernedLearningStep` (the extracted, shared step-2 helper — also used by `reopen`) first
  checks `wiring.ledger.get(proposalId)` — if it already exists, the governed step already
  succeeded; reconciliation lands on `"proposed"`, never re-invoking `propose`.
- The skip-check for step 2 is now `learningStatus !== "none" && learningStatus !== "failed"` —
  `"failed"` is explicitly retryable.

Tests: `SAGA: a crash between ledger append and the outcome CAS recovers to 'proposed', not
'failed', without a duplicate pipeline.propose call` (hand-reconstructs the exact pre-crash
intermediate state using the same deterministic ids `create()` itself derives — `deterministicUuid`/
`anchorLineageKey` exported from router.ts for this purpose), `SAGA: a genuinely failed governed
step is retryable through a subsequent create() call`, `SAGA: concurrent first-create on the SAME
anchor with DIFFERENT operationIds — exactly one wins, the other gets CONFLICT`.

## 4. Clear/reopen saga durability

**Before**: `clear` superseded the flag to `"cleared"` FIRST, then attempted to withdraw its
proposal — a withdrawal failure left a flag marked "cleared" while its proposal remained silently
approvable. `reopen` just flipped `status` back to `"open"`, leaving the OLD (withdrawn) proposal
reference in place — approving it later would have resurrected a permanently-resolved decision.

**Now**:
- `clear` withdraws (and revokes any applied preference adjustment) BEFORE the status-flip CAS. If
  either throws, NOTHING has mutated — the flag is untouched and the whole `clear` call can simply
  be retried (both helpers are themselves idempotent). The status-flip also sets `learningStatus:
  "dismissed"` when there was anything to withdraw/revoke.
- `reopen` resets the flag to `{status: "open", learningStatus: "none"}` (clearing
  `proposalId`/`preferenceAdjustmentId`/`learningFailureReason`) and then IMMEDIATELY calls the SAME
  `attemptGovernedLearningStep` helper with a seed derived from the freshly-reopened row's own id
  (`${ownerId}:reopen:${reopenedId}`) — guaranteeing a FRESH taskId/proposalId/preferenceAdjustmentId,
  never colliding with or resurrecting the old, permanently-resolved ones.

Tests: `CLEAR: a genuine withdrawal failure leaves the flag untouched...so a retry is safe`
(monkeypatches `pipeline.decide` to throw once), `REOPEN: reopening a withdrawn flag creates a NEW
proposal for the new active version, never resurrecting the vetoed one`.

## 5. Forget enumerates the whole lineage

**Before**: `forget` only withdrew `value.proposalId` from whichever SPECIFIC version-id the caller
passed — but `MemoryStore.forget` deletes the ENTIRE lineage (every version, superseded or not), so
a proposal linked from an EARLIER (already-superseded) or a LATER version than the passed id could
survive un-withdrawn after its evidence Memory was deleted.

**Now**: `forget` first walks the full lineage via keyset-paginated `retrieve({subjectElementId,
includeSuperseded: true, order: "asc", limit: 200, cursor})` (looping until exhausted — no cap),
collecting every distinct `proposalId`/`preferenceAdjustmentId` across ALL versions, withdrawing/
revoking each, THEN deletes.

Test: `FORGET: enumerates every proposal across the WHOLE lineage — including one from an EARLIER
(already-cleared) version — before deleting` (create → clear (proposal A pending→withdrawn) →
reopen (proposal B, freshly pending) → forget(the reopened id) → asserts BOTH A and B are resolved).

## 6. Server-validated canonical anchors

**Before**: `redFlag.create` accepted any well-formed anchor shape without checking the target
actually exists, belongs to this workspace, or that `moduleId` is even a real module. `TableView.tsx`
fell back to the sorted row's array index (`String(row["id"] ?? i)`) as `recordId` when a row lacked
a real `id` — a meaningless, resort-unstable anchor.

**Now**: `validateAnchorTarget` (router.ts) resolves a record-shaped target (`cell.recordId`,
`bullet.target.type === "record"`) against its OWN module's real store:
- `jobpilot`/`job-pilot` → `jobpilotStore.getApplication(recordId, workspaceId)`
- `dealpilot`/`initiative` → `graphStore.getInitiative(recordId)` + workspace check
- `touchpoint` → `graphStore.getTouchpoint(workspaceId, recordId)` (**new** store method, mirrors
  `getInitiative`'s shape)
- `person`/`people` → `graphStore.getPerson(workspaceId, viewerUserId, recordId)`
- `community`/`communities` → `graphStore.getCommunity(workspaceId, viewerUserId, recordId)`
- any other `moduleId` → fails closed (`NOT_FOUND`), never accepted existence-proof-free.

`file`/`result` bullet targets have no backing existence store yet (no currently-wired bullet
surface in this app uses one) — a documented, bounded limitation, accepted structurally only.
`TableView.tsx` now derives a `stableRecordId` from `row["id"]` and renders the cell as
NOT flaggable (no `RedFlagControl` wrapper) when absent — never the row index.

Tests: `ANCHOR VALIDATION: create rejects a nonexistent JobPilot application recordId`, `...a
JobPilot application that exists but belongs to a DIFFERENT workspace`, `...an unrecognized
moduleId, failing closed`, `...a nonexistent 'initiative'/'touchpoint' module recordId too, not just
JobPilot`. Every existing test's fabricated `recordId: "app-1"`-style anchor was replaced with a
REAL, seeded `jobpilotStore.createJob(...)` application id.

## 7. Scope batching pushed into the DB

**Before**: `listForScope` fetched EVERY `sourceRefType: "feedback"` Memory in the workspace
(capped at 1000) then filtered by `anchor.moduleId` app-side.

**Now**: `@bridge/core`'s `MemoryQuery` gained `contentPathEquals?: Array<{path: string; equals:
string}>` — a dot-path JSON-content equality predicate pushed into the SQL WHERE (Postgres
`content::jsonb #>> '{a,b}'`, no schema migration; in-memory adapter walks the parsed object).
`listForScope`/`listForAnchor`/`listAll` all now push `{path: "kind", equals: "red_flag"}` (this
turned out to be load-bearing — see bug-found-while-implementing #1 below) and `listForScope` also
pushes `{path: "anchor.moduleId", equals: input.moduleId}`. The remaining database/record/file/
result narrowing stays app-side over that already-scoped, typically small result set (an OR across
cell/bullet shapes a single equality predicate can't express).

Tests (packages/db): 4 new `retrieve()` tests proving the JSON predicate pushdown and its AND
composition against real pglite.

## 8. Keyset audit/history pagination

**Before**: `listAll` used an opaque OFFSET cursor (`Buffer.from(String(offset))`); `history` had a
hardcoded `limit: 200` with no pagination at all.

**Now**: `MemoryQuery` gained `order: "asc"|"desc"` and a real `cursor: {createdAt, id}` keyset
(both adapters — in-memory sorts+filters in JS, Drizzle pushes a `(createdAt, id) < / >
(cursorCreatedAt, cursorId)` row-value comparison into SQL). `listAll`/`history` both use it now;
`history`'s 200-cap is gone (paginates via `limit`/`cursor`/`nextCursor` like `listAll`).

Tests (packages/db): 2 new tests proving keyset pagination returns every row exactly once across
pages and is immune to a row inserted between fetches. (apps/api): `listAll paginates
server-side with a real keyset cursor...stable across a concurrent insert between pages`, `history
returns the full lineage...with keyset pagination and no silent 200-cap`.

## 9. Reason-save/action serialization

**Before**: `RedFlagProvider`'s mutations discarded their own returned row and only called a
background `refresh()`; `RedFlagControl`'s clear/reopen/forget handlers used `current.row.id`
captured from the render closure — stale the instant a reason-save (which supersedes the lineage to
a NEW row) resolved first.

**Now**: `RedFlagProvider`'s `applyLocally` helper updates the LOCAL `rows` cache synchronously from
every mutation's own returned row (replacing the entry for that anchor) before a background
`refresh()` reconciles; every provider method now RETURNS the resulting row/memory.
`RedFlagControl.saveReasonIfChanged` resolves to the flagId the SAVE ITSELF produced;
`afterPendingSave()` (awaited by every other action) resolves to THAT id — never a stale
closure value.

Tests: `RedFlagControl serializes reason-save...and chains clear/reopen/forget off the SAVE's own
returned id`, `RedFlagProvider applies every mutation's own returned row to its LOCAL cache
synchronously`.

## 10. Hybrid touch

**Before**: touch detection used `(hover: none)` and `(pointer: coarse)` — both test the device's
PRIMARY pointer only, missing a touch digitizer that coexists with a mouse/trackpad (a
touchscreen laptop where the OS reports "mouse" as primary).

**Now**: `(any-pointer: coarse)` is added alongside both existing queries — visibility persistence
and the enlarged hit-target overlay now trigger if ANY attached pointer is coarse, not only the
primary one.

Test: `RedFlagControl gates visibility on POINTER CAPABILITY...keeps a >=44px touch hit target on
ANY coarse pointer`.

## 11. Legacy flag normalization at the store boundary

**Before**: `normalizeLegacyFitFlag` (`@bridge/jobpilot`) existed but nothing called it outside a
test — every real read path (`jobpilot.create`/`.list` router procedures, and the underlying store
methods they call) returned the RAW `applications.flag` column value, so a pre-AP-023 legacy row
(`"green"`/`"yellow"`/`"red"`) would reach the client verbatim.

**Now**: `DrizzleJobPilotStore` normalizes at its OWN read boundary — `createJob`, `listJobs`,
`updateApplication`, and `getApplication` all pass their returned `ApplicationRow`(s) through a new
`normalizeApplicationRow` helper before returning. This is DRY and future-proof: no caller of this
store, present or future, can forget the step.

Tests (packages/db): the existing `updateApplication` test's legacy-value assertion was corrected to
expect the normalized value; a new dedicated test writes a raw legacy value directly to the DB
(bypassing the store) and proves BOTH `getApplication` and `listJobs` normalize it on read, while a
fresh application's `null` flag and an already-modern value both pass through unchanged.

---

## Bugs found and fixed while implementing (by executing, not just reading)

1. **Preference-adjustment lookups used a stale `.get(id)` instead of `currentForLineage`.**
   `enactCorrection`'s own adjustment fetch and `revokePreferenceAdjustmentPermanently`'s fetch both
   used `memoryStore.get(preferenceAdjustmentId, auth)` — but that id is the adjustment's STABLE
   lineage key (its own original id), and `.get()` fetches by exact primary key regardless of
   supersession. Once `enactCorrection` superseded the adjustment to a NEW row id (marking it
   `"applied"`), every LATER read via the original id returned the FROZEN pre-enactment `"proposed"`
   row — reproducing exactly the class of bug round 3 already found once for the red-flag lineage
   itself. A test asserting `adjustmentValue.status === "applied"` after enactment caught it. Fixed
   by switching both call sites to `currentForLineage(workspaceId, ownerId, preferenceAdjustmentId)`.

2. **The outcome-Memory id was deterministic (not per-attempt), causing a primary-key collision on
   any retry that changed learning status.** `attemptGovernedLearningStep`'s final `casSupersede`
   used `id: deterministicUuid(\`redflag-memory-outcome:${seed}\`)` — fine for the FIRST successful
   write, but a SECOND attempt reaching this write again (e.g. a `"failed"` attempt retried into a
   genuine `"proposed"` success) tried to INSERT the exact same id a second time — a real
   `memories_pkey` duplicate-key violation on a real pglite/Postgres backend, not a benign no-op.
   Caught by the new `"a genuinely failed governed step is retryable"` test. Fixed by using a fresh
   `uuidv7()` per write — this row is a VERSION marker (append-only), not a resource meant to exist
   exactly once, exactly mirroring how `clear`/`reopen`/`updateReason` already mint a new id for
   their own new versions.

3. **Every superseding red-flag write silently inherited its predecessor's `createdAt`.** All of
   `clear`/`reopen`/`updateReason`/`enactCorrection`/`revokeCorrection`/
   `revokePreferenceAdjustmentPermanently`'s `next: {...current, id: uuidv7(), ...}` object literals
   spread `...current` WITHOUT overriding `createdAt` — and `DrizzleMemoryStore.#insert` honors a
   truthy `entry.createdAt` over the column's own `defaultNow()`. Every version after the first
   therefore carried the EXACT SAME timestamp as its original ancestor — confirmed with a direct
   repro (`history()` on a create→clear→reopen chain showed all 5 rows sharing one identical
   millisecond). This made `history`/`listAll`'s new keyset `(createdAt, id)` order fall back
   entirely to `id`, which has no causal relationship to insertion order once one side is a
   content-hash-derived id (step 1's `memoryId`) rather than a time-ordered `uuidv7` — the internal
   "none" row could sort AFTER its own "proposed" successor. This was a PRE-EXISTING bug (present
   since round 2, not introduced this round) that the round-3/round-4 keyset changes simply made
   newly visible and deterministically wrong (previously it was silently relying on Postgres's own
   unspecified tie-break order). Fixed with a process-local `monotonicRedFlagNowISO()` helper
   (strictly increasing even within the same millisecond) applied to all 10 red-flag write sites.

## Validation

core 426, db 118 (+5), api 203 (33 red-flag, up from 17), jobpilot 94, dealpilot 72, commons 22,
integrations-google 35, web 59 (10 red-flag-control) — all pass. Full monorepo `pnpm -r build`
(23/23 packages) clean. `apps/web`/`apps/api` typecheck clean. `eslint .` clean on every file this
round touched (the only 2 pre-existing findings, both on files untouched by TASK-010, remain
unchanged). `check:no-dummy-runtime` clean.

## Outstanding

- Item 9/11's JobPilot flag-column migration remains explicitly PENDING — TASK-008 RM4 owns
  migration `0015` and has not landed on `main`. Once it does: merge main, add migration `0016+`
  (backfill `green→pursue`, `yellow→review`, `red→pass`, plus a `CHECK` constraint), prove fresh +
  upgrade with no drift.
- No live desktop/375px browser walkthrough has been captured — source-level, unit-test-level, and
  (round 1) HTTP-level verification only.
- A pre-existing, unrelated dummy-data instance was discovered along the way — `docs/dummy.md` now
  tracks it (see that file for detail); not fixed here (out of TASK-010's scope, and the page it
  affects is currently unrouted/unreachable).
