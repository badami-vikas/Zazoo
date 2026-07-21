# TASK-010 — Platform red-flag correction feedback (2026-07-17)

Status: `in_progress` (not closed — see "Outstanding" at the end). Implemented
end-to-end in this worktree per the coordinator's execute-now instruction,
following the planning session's approved plan and TASK-007's exact
red-flag handoff contract (`outputs/2026-07-16-task007-agent-skill-child-run-orchestration.md`
§"TASK-010 handoff").

## Outcome delivered

Any eligible data cell (generic `TableView.tsx`) and rendered bullet
(`JobPilotApplicationDetail.tsx`'s section bullets, fit strengths/concerns)
now exposes ONE shared `RedFlagControl` primitive: subtle/uncolored on
hover/keyboard-focus, turns solid red on first selection, second selection
opens an inspect/edit/clear (and reopen) popover, clearing is reversible and
audited, and touch/coarse-pointer viewports show the same control persistently
(no hover state on touch). No green/yellow feedback semantics remain anywhere
in the app.

## What changed

### API (`platform/apps/api/src`)
- `router.ts` — new `RedFlagAnchor` type; `LearningMemoryContent` gained a
  `"red_flag"` variant (anchor, renderedValue/Version, reason, status
  open|cleared, learningStatus none→proposed→applied|dismissed); new
  `redFlagAnchorInput` zod schema (requires at least one of
  recordId/fileId/bulletPath); new `provisionRedFlagLearningTask` helper
  (reuses the existing generic `provisionGoalTask`); new top-level `redFlag`
  router: `create`, `clear`, `reopen`, `updateReason`, `forget`,
  `listForAnchor`, `listAll`.
  - `create` does two things in one request, per TASK-007's handoff: (1) a
    plain `memoryStore.write` — `sourceRefType: "feedback"`, `trustOrigin:
    "user_content"` — the Human's own correction, never routed through
    `pipeline.propose`; (2) a SEPARATE governed `pipeline.propose` call,
    actor `LEARNING_AGENT`, skill `"learning.proposePreferenceAdjustment"`,
    resolved through a real Goal/Task assignment (`goalTaskRef`) — always
    drafts (`pending_review`), never silently applies anything.
  - `clear`/`reopen`/`updateReason` are append-only `memoryStore.supersede`
    calls — every prior row (including the very first, pre-proposal one)
    stays readable and unchanged forever. `forget` is the separate, genuine
    personal-data-deletion path.
- `wiring.ts` — new `stagePreferenceAdjustmentProposal` Skill (echoes its
  proposed output as data, mirrors `stageLearningRecommendation`); new
  `PLATFORM_RED_FLAG_LEARNING_GOAL_TYPE`/`PROPOSE_PREFERENCE_ADJUSTMENT_TASK_TYPE`
  constants; new `RED_FLAG_LEARNING_SKILL_MANIFEST` (`resourceType: "signal"`,
  never `policy`/`policy_param` — see the CRITICAL constraint in TASK-007's
  handoff: the agent floor unconditionally denies any Agent writing
  `policy_param`, checked before Skill resolution ever runs) added to
  `GOVERNED_SKILL_MANIFEST_CATALOG`; registered the Skill in `buildWiring()`;
  added `"learning.proposePreferenceAdjustment"` to `LEARNING_AGENT`'s
  in-memory skill allow-list (`seedGovernance`).
- `packages/db/src/governance-stores.ts` — added the same skill name to
  `ensureLearningAgentGovernance`'s persistent-mode `allowedSkills`, so
  DATABASE_URL-backed deployments get the identical allow-list as in-memory
  mode (one source of truth, two durability backends, matching the existing
  `GOVERNED_SKILL_MANIFEST_CATALOG` convention).

### Web (`platform/apps/web/src`)
- New `components/shared/RedFlagControl.tsx` — the one shared primitive
  every eligible surface wraps its rendered value with. Self-contained hover/
  focus-within group, positioned popover (mirrors `StandardColumnMenu.tsx`'s
  clamp/Escape/outside-click convention), `aria-pressed` + stateful
  `aria-label`, inline reason edit, Clear/Reopen, and a de-emphasized
  "Delete permanently" (the `forget` path, distinct from the reversible
  `clear`).
- `dataviews/eligibility.ts` — new `isFlaggableValue()` (mirrors
  `TableView.tsx`'s own emptiness check, so eligibility never drifts from
  what's actually rendered).
- `dataviews/views/TableView.tsx` — every non-empty cell wraps with
  `RedFlagControl`, anchored on `{ moduleId: spec.id, recordId, fieldId:
  col.id }`.
- `pages/JobPilotApplicationDetail.tsx` — section bullets and fit
  strengths/concerns bullets wrap with `RedFlagControl`, anchored on
  `bulletPath` keys (`s${i}.b${j}`, `fit.strength.${i}`, `fit.concern.${i}`)
  — the same path convention `useLocalEdits` already uses for that unrelated
  mechanism, kept legible against it without sharing storage.
- `pages/SettingsPage.tsx`'s existing `LearningSection` (Settings → Learning)
  gained a "Red flags" Card backed by `redFlag.listAll` — the audit/inspect
  surface the Prototype test names, mirroring the exact
  query-on-mount/mutate-then-refetch pattern the section already uses for
  `learningState`/`correctMemory`/`forgetMemory`. Every flag shows its
  anchor, rendered value, reason, status, learningStatus, actor, and
  timestamp, with inline Clear/Reopen/Delete.

### Green/yellow removal (AP-023)
- Deleted `components/shared/FlagIcon.tsx` (the pre-canon green/yellow/red
  hover-picker) — confirmed zero call sites repo-wide before deleting.
- Deleted `data/jobpilot.ts` (a dead, unused duplicate fixture that
  re-defined the same green/yellow/red shape separately from
  `@bridge/jobpilot`'s real types — confirmed zero importers).
- `tools/jobpilot/src/types.ts`/`scoring.ts`/`table.ts`/`index.ts` — renamed
  `FlagColor` → `FitRecommendation` (`"pursue"|"review"|"pass"`, explicit
  domain labels per §5d, DealPilot/JobPilot's underlying 0..1 score is
  unchanged); renamed `greenFlags`/`redFlags` evidence arrays →
  `strengths`/`concerns` (matches the vocabulary `JobPilotApplicationDetail.tsx`
  already renders, and removes the `redFlags` naming collision with the new
  platform Red Flag primitive). `packages/db/src/schema.ts`'s `flag` column
  comment updated to match (no migration — it's a plain `text` column, no
  enum constraint).
- DealPilot's equivalent `TriageState`/green-yellow-red system had already
  been removed by a concurrent TASK-006 pass before this session started
  (confirmed via source read, not assumed) — no DealPilot changes were
  needed.
- `JobPilotPage.tsx`'s own `FlagIcon`/`onFlagAction` fixture-driven picker UI
  had also already been removed by concurrent WIP predating this session —
  confirmed via source read.

### Pre-existing blocker fixed (tightly coupled, blocked all validation)
- `packages/core/src/memory/stores.ts`'s `InMemoryAgentStore` no longer
  satisfied the `AgentQuery` interface on the freshly-pulled `origin/main`
  (missing `workspaceId`/`isActive`, added by TASK-007's AGS1 work without
  updating this class) — this broke `@bridge/core`'s build/typecheck
  entirely, blocking every downstream package. Already logged as
  `docs/BUGS.md`'s 2026-07-17 "@bridge/core build broken on main" entry by a
  concurrent session; fixed here (added the two methods + backing
  `workspaces`/`statuses` maps, permissive defaults matching every other
  unset-ceiling default on the class) and marked RESOLVED in `docs/BUGS.md`
  with verification evidence.

## Tests added
- `platform/apps/api/test/red-flag.test.ts` (7 tests) — Human-authored
  Memory shape (`sourceRefType`/`trustOrigin`), the governed proposal always
  drafts, direct Human invocation of the governed Skill fails closed even
  with a valid `goalTaskRef`, clear/reopen append-only reversibility (every
  prior row, including the pre-proposal original, stays intact),
  updateReason, forget vs. clear, listForAnchor/listAll scoping, and anchor
  validation.
- `platform/apps/web/test/red-flag-control.test.mjs` (7 tests, source-pattern
  style matching this repo's existing `onboarding-learning.test.mjs`
  convention) — hover/focus/touch/aria-pressed/popover markers,
  create/clear/reopen/updateReason/forget/listForAnchor router calls present,
  TableView/JobPilotApplicationDetail wiring present, the Settings > Learning
  Flags audit section present, `FlagIcon.tsx`/`data/jobpilot.ts` absent, and
  no green/yellow literal strings remain in DealPilot/JobPilot pages.
- Updated `tools/jobpilot/test/{table,scoring,pipeline}.test.ts` for the
  renamed values/fields.

## Verification (live evidence)

- `@bridge/core`: 421/421 pass.
- `@bridge/db`: 107/107 pass.
- `@bridge/api`: 177/177 pass (170 pre-existing + 7 new red-flag tests), 0
  regressions.
- `@bridge/jobpilot`: 93/93 pass (renamed fixtures/values).
- `@bridge/dealpilot`: 72/72 pass (untouched, confirmed as an
  affected-neighbor sanity check).
- `@bridge/commons`: 22/22 pass (affected-neighbor sanity check).
- `@bridge/web`: 56/56 pass (49 pre-existing + 7 new), 0 regressions.
- `npx turbo run typecheck build` — full monorepo, 40/40 tasks succeed
  clean.
- `npx eslint .` — full monorepo: 0 new errors/warnings. The 2 findings
  present (`ZazooAvatar.tsx`'s `react-hooks/exhaustive-deps` disable
  targeting an unregistered rule, `determinism.ts`'s unused-disable warning)
  are pre-existing on the clean `origin/main` tree, confirmed unrelated
  (both already logged in `docs/BUGS.md`), neither touched by this change.
- `pnpm run check:no-dummy-runtime` — clean, no `dummy_` markers introduced.
- **Live HTTP smoke test**: started the real API server
  (`node dist/src/server.js`) and exercised `redFlag.create` →
  `redFlag.listForAnchor` → `redFlag.clear` → `redFlag.reopen` →
  `redFlag.listAll` end-to-end over real tRPC HTTP calls, plus a direct
  `action.propose` call as a Human actor against the governed learning
  Skill — confirmed `"rejected"` with the expected fail-closed message. This
  is real end-to-end verification of the governed pipeline, memory store,
  and Goal/Task resolver working together outside the unit-test harness.

### Outstanding (why this task is NOT marked done)
No live desktop/375px browser walkthrough of the actual pointer-hover,
keyboard-focus, click-to-flag, and popover interaction has been captured —
only source-level (component/test) and HTTP-level (server) verification.
Per the docs protocol, "build/tests pass" alone does not meet the Prototype
test's exact runtime-surface evidence requirement; the coordinator or a
follow-up pass should run the live desktop+375px walkthrough before flipping
TASK-010 to `done`.

## Read-only security/correctness review (self-conducted)

- **Fail-closed confirmed live**: a Human actor directly invoking
  `learning.proposePreferenceAdjustment` (even with a syntactically valid
  `goalTaskRef`) is rejected before any state change, both in the unit test
  and the live HTTP smoke test.
- **Agent floor untouched**: the new Skill's manifest targets
  `resourceType: "signal"`, never `policy`/`policy_param` — the
  unconditional agent-floor deny for those resource types is never engaged,
  and no manifest can override it (verified by reading `agent-floor.ts` and
  `pipeline.ts`'s gate ordering — Authority Layer 0 runs before Skill
  resolution).
- **Append-only / no silent data change**: every `clear`/`reopen`/
  `updateReason` is a `memoryStore.supersede` call — the prior row is never
  mutated or deleted; only `forget` deletes, and it is a separate, clearly
  distinguished action in the UI (de-emphasized, labeled "permanently").
  Confirmed by a dedicated test that walks create→clear→reopen and re-reads
  the very first row afterward.
- **Cross-workspace/tenant scoping**: every procedure takes an explicit
  `workspaceId` validated by the existing `assertPilotWorkspace` guard;
  `memoryStore`'s own authority-scoped visibility predicate (`memoryVisible`)
  is unchanged and reused as-is — no new cross-tenant read path was
  introduced.
- **No new dependency on client-asserted actor identity**: `create`'s
  governed step always uses the server-resolved `LEARNING_AGENT` constant
  and `ctx.identity.id` for `onBehalfOf`, never a client-supplied agent id.
- **Blast radius**: `InMemoryAgentStore`'s two new methods/maps are strictly
  additive with permissive defaults matching every other unset-ceiling
  default already on that class — confirmed via the full existing
  `@bridge/core`/`@bridge/api` suites passing unchanged (0 regressions) and
  a targeted re-grep confirming no other code path depends on the
  pre-fix (broken) shape.

## Files changed

New: `platform/apps/web/src/app/components/shared/RedFlagControl.tsx`,
`platform/apps/api/test/red-flag.test.ts`,
`platform/apps/web/test/red-flag-control.test.mjs`.

Deleted: `platform/apps/web/src/app/components/shared/FlagIcon.tsx`,
`platform/apps/web/src/app/data/jobpilot.ts`.

Modified: `platform/apps/api/src/router.ts`, `platform/apps/api/src/wiring.ts`,
`platform/packages/core/src/memory/stores.ts`,
`platform/packages/db/src/governance-stores.ts`,
`platform/packages/db/src/schema.ts` (comment only),
`platform/tools/jobpilot/src/{types,scoring,table,index}.ts`,
`platform/tools/jobpilot/test/{table,scoring,pipeline}.test.ts`,
`platform/apps/web/src/app/dataviews/eligibility.ts`,
`platform/apps/web/src/app/dataviews/views/TableView.tsx`,
`platform/apps/web/src/app/pages/JobPilotApplicationDetail.tsx`,
`platform/apps/web/src/app/pages/SettingsPage.tsx`,
`docs/TASKS.md`, `docs/BUGS.md`, `docs/log.md`.

## Overlap / conflict risk vs. current `main`

- `platform/apps/web/src/app/pages/DealPilotPage.tsx` and `JobPilotPage.tsx`
  were confirmed, via source read at session start, to have ALREADY had
  their green/yellow/`FlagIcon` UI removed by concurrent TASK-006/prior work
  — this session made NO edits to either file, so there is no overlap risk
  there.
- `packages/core/src/memory/stores.ts`'s fix addresses a bug independently
  logged by a concurrent session in `docs/BUGS.md` the same day — the fix
  here is narrowly additive (two new methods + two new maps) and should
  merge cleanly regardless of what else lands on `main` in the meantime,
  but if another concurrent session ALSO fixes this same gap independently,
  the two fixes should be reconciled (functionally equivalent, low risk).
- `platform/packages/db/src/governance-stores.ts`'s
  `ensureLearningAgentGovernance` allow-list array is a small, additive
  one-line change (`"learning.proposePreferenceAdjustment"` appended) —
  low collision risk with other concurrent Skill-catalog additions, but
  worth a quick diff check if another session also touched this exact
  array.
- No migration files were touched or created — TASK-008 RM4's reservation of
  migration `0015` is unaffected; this task needed zero schema changes.
