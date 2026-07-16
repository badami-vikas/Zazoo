---
title: "TASK-007 Agent, Skill, and Child-Run Orchestration — Implementation Handoff"
date: 2026-07-16
task: TASK-007
status: complete_committed_pushed_reconciled
commits:
  - "5723337 — feat(TASK-007): Agent, Skill, and child-Run orchestration (AGS0-AGS3)"
  - "59faf0b — Merge origin/main into TASK-007 branch (reconcile with TASK-001-005/PR#15)"
branch: manishsbhoopalam8498-task-007-agent-orchestration (pushed to origin, NOT merged to main)
blockers:
  - No dedicated UI surface yet (Agent Detail Tasks/child-Run listing) — deferred behind TASK-001's UI shell work; this slice validates core/API/tests only
  - ensureInternalStrategistGovernance/ensureGovernanceAgentGovernance/ensureCapabilityBuilderGovernance and the new Drizzle Goal/Task/SkillManifest/ChildAgentRun stores are tested against a REAL pglite instance (packages/db/test/*) but NOT against a real Postgres — no live Postgres is available in this sandbox; mirrors the existing buildPersistentPorts test pattern (DUMMY_POSTGRES_URL, never connected)
  - No JobPilot specialist-agent catalog exists in code to migrate (confirmed by inspection: JobPilot's own "Skill" type is a resume-schema domain field, not a @bridge/core governed Skill — see the TASK-011 correction note below) — nothing outstanding, but flagged so it isn't mistaken for an oversight
  - EGRESS_AGENT (pre-existing, used by both Google egress and the migrated dealpilot.source) is a physical Agent identity distinct from the five permanent Agents named in AGS3 — a generic "cloud/egress executor" utility identity, not a DealPilot-specific specialist Agent (no new Agent was created for DealPilot); flagged as a design note for the coordinator to confirm is acceptable, not reopened unilaterally
resolved_since_last_report:
  - Full live Skill catalog is now fail-closed by default with NO allowlist (TIME_BOXED_LEGACY_SKILLS/legacyUngovernedSkills removed entirely) — every real call site is either a registered SkillManifest, structurally agent-floor-exempt, or the one permanent KERNEL_PASSTHROUGH_SKILL reserved constant (see below)
  - Goal/Task/SkillManifest/ChildAgentRun are now restart-durable in persistent mode via real Drizzle stores + migration 0012 (packages/db/src/goal-task-store.ts, skill-manifest-store.ts, child-agent-run-store.ts) — no longer in-memory-only in either mode
  - Branch committed (5723337) and reconciled with origin/main via merge commit (59faf0b) — zero remaining conflicts (verified via `git merge-tree`), pushed to origin. NOT merged to main.
---

## Reconciliation with origin/main (commit + push, this round)

The coordinator authorized commit/push and asked TASK-007 to reconcile with `origin/main`, which had since absorbed PR #15 (TASK-001–005) plus a further "Save uncommitted changes" commit (`1e0d652`). Merged `origin/main` into this branch (`git merge origin/main`, no rebase — preserves already-pushed history). 3 files conflicted, all resolved as functionally-identical duplicate-pattern merges (no logic change on either side):

- **`platform/apps/api/src/wiring.ts`** (5 conflict hunks): combined import lists; combined `EGRESS_AGENT`/`LEARNING_ROLE`/`LEARNING_SIGNAL_PERMISSION` constants; combined `ModePorts`'s governance-seed hook fields (`ensure*Governance` × 3 + `ensureSkillManifestCatalog` + `ensureLearningGovernance`); combined `buildPersistentPorts`'s return object and `buildWiring`'s boot-time await sequence.
- **`platform/packages/db/src/governance-stores.ts`**: TASK-005's `ensureLearningAgentGovernance` was a standalone duplicate of the exact same idempotent seeding logic my `ensureFoundationalAgentGovernance` shared helper already implements — reconciled it onto that shared helper as a 4th named wrapper (`displayName: "Learning Agent"`, matching values), rather than keeping two copies of the same algorithm. `LearningAgentGovernanceConfig` kept as an exported type alias for backward compatibility.
- **`platform/packages/db/src/index.ts`**: combined re-exports.
- **`platform/apps/api/src/router.ts`** auto-merged with no conflict.

Post-reconciliation validation (full, not partial):
- `npx turbo run build`: 20/20 packages clean.
- `npx turbo run typecheck` (core/db/api/integrations-google/web): clean — the previously-flagged pre-existing `apps/web/IntelligencePage.tsx` typecheck failure is now FIXED by origin/main's own changes (confirmed not something I fixed).
- Full test suites, run directly per package: **core 398/398**, **db 86/86**, **api 127/127**, **integrations-google 35/35**, **web 36/36**, plus neighbor packages **dealpilot 57/57**, **jobpilot 93/93**, **helpdesk 7/7** — **839/839 passing, 0 failures**.
- `eslint` on all 4 resolved-conflict files: 0 errors.
- `git merge-tree $(git merge-base HEAD origin/main) HEAD origin/main`: empty output — zero remaining conflicts against current `origin/main`.

Committed as `5723337` (the TASK-007 feature commit) + `59faf0b` (the reconciliation merge commit), both with the required Co-authored-by trailer. Pushed to `origin/manishsbhoopalam8498-task-007-agent-orchestration`. **Not merged to main** — left for the coordinator/a human to review and merge.

---


## Final closure pass — full fail-closed catalog migration + restart-durable persistence (continuation, later same day)

The coordinator's final escalation rejected the prior round's `TIME_BOXED_LEGACY_SKILLS` compatibility list and the in-memory-only Goal/Task/SkillManifest/ChildAgentRun stores as NOT satisfying TASK-007 closure, and corrected the TASK-011 handoff (Glassdoor/Reddit source-rights must fail BEFORE Run creation; Google Places stays unspawned). Status of each demand:

1. **Full live Skill catalog migrated to fail-closed manifests, allowlist removed entirely** — DONE. `TIME_BOXED_LEGACY_SKILLS`/`legacyUngovernedSkills` no longer exist anywhere in the codebase (verified: `grep -rn "TIME_BOXED_LEGACY_SKILLS\|legacyUngovernedSkills"` returns nothing). Every real call site now resolves one of three ways, with NO maintained allowlist:
   - **A registered `SkillManifest`** — `stageLearningRecommendation`, `helpdesk.stageAnswer` (new dedicated skill replacing a generic `stageMutation` call), `dealpilot.source`, `capture.stage`'s `stageCapture`, and the 4 real-need Google skills (`SKILL_SOURCE_GMAIL`, `SKILL_SOURCE_CALENDAR`, `SKILL_LIST_CALENDAR`, `SKILL_STAGE`) — all migrated onto real manifests with inline Goal/Task provisioning (`provisionGoalTask` + 4 named wrappers in `router.ts`; `provisionGoogleSyncTask` in `@bridge/integrations-google`'s `intake.ts`).
   - **Structurally agent-floor-exempt** — any `(action, resourceType)` pair `isAgentFloorDenied` already, unconditionally, denies for every Agent (e.g. `capability:approve`, `blueprint:activate`, and the 4 `SKILL_COMPOSE_*` Google skills, which all target `external:send`). Requiring a manifest for these would be actively wrong (it would newly force an Agent+Task requirement onto an action no Agent could ever hold, at which point the only actor who COULD do it — a Human — would also become newly rejected once *any* manifest exists for that skill name, since `resolveSkillForTask` requires an Agent actor). This is a principled, non-removable, non-maintained derivation from `agent-floor.ts`'s own invariant — not a list of skill names anyone edits.
   - **`KERNEL_PASSTHROUGH_SKILL`** (new, permanent, reserved constant, exported from `@bridge/core`, `pipeline.ts`) — the ONE skill name (`"stageMutation"`) that is genuine pipeline plumbing, not a Skill catalog entry: its `run()` is a pure echo (`{proposedOutput: inputs, diff:{to:inputs}}`), and it is invoked across too many disparate resourceTypes by both product code and pre-existing tests as a generic "record any human-authorized mutation" passthrough (e.g. sharing one's own touchpoint — `resourceType:"touchpoint"`, `action:"share"` — which is NOT agent-floor-protected and has no Agent+Task concept to attach to; a Human sharing their own data is not a delegated Skill invocation). This is analogous to how `Action`'s `"approve"` value is reserved and never client-proposable: a single, permanent, documented exemption for the name itself, not a time-boxed list of skills awaiting migration. `wiring.ts`'s `stageMutation` Skill object's `name` field now imports and uses this constant directly (no string literal drift possible).
   Full catalog inventory + migration is captured in `pipeline.ts`'s AGS1 gate doc comment and `wiring.ts`'s per-manifest doc comments (see "Reconciled: no compatibility list" note there).

2. **Restart-durable Goal/Task/SkillManifest/ChildAgentRun persistence** — DONE. Real Drizzle-backed stores now exist and are wired into `buildPersistentPorts` (bound to Postgres when `DATABASE_URL` is set):
   - **Schema** (`packages/db/src/schema.ts`, new LAYER 8 section): `goals`, `tasks` (FK to `goals`/`agents`), `skill_manifests` (unique on `skill_id`+`version`), `child_agent_runs` (FK to `agents`/`goals`/`tasks`; `parent_run_id` is a plain uuid column, deliberately NOT a foreign key — it names an ephemeral per-request `RunCtx` id, not a persisted row, mirroring `ledger.actor_id`'s un-referenced-uuid precedent).
   - **Migration**: generated via `drizzle-kit generate`, then manually renumbered from the auto-assigned `0011` to **`0012_task007_goal_task_skill_manifest_child_run.sql`** (journal + snapshot renamed/edited to match) — **0011 is confirmed reserved for TASK-004 and was NOT consumed**; no collision (0011 doesn't exist in this worktree at all — chain integrity verified: `0012`'s snapshot `prevId` correctly points at `0010`'s `id`).
   - **Stores**: `DrizzleGoalTaskStore` (`goal-task-store.ts`), `DrizzleSkillManifestRegistry` + `seedSkillManifests` (`skill-manifest-store.ts` — the registry loads into an in-process read cache via `refresh()`, called once at boot after seeding; reading before `refresh()` throws loud rather than silently returning an empty catalog, which would look identical to "nothing registered" and incorrectly fail closed every governed skill), `DrizzleChildAgentRunStore` (`child-agent-run-store.ts`). All three follow the exact `#db`-private-field / jsonb-Zod-validated-at-the-boundary shape every other Drizzle store in this package uses (mirrors `DrizzleWorkspaceDefinitionStore`).
   - **Source-of-truth design**: the manifest CATALOG's source of truth stays the code declarations in `wiring.ts` (a governed Skill contract is a reviewed, deployed artifact) — `seedSkillManifests` idempotently upserts the new shared `GOVERNED_SKILL_MANIFEST_CATALOG` constant (all 8 real manifests, one list) into `skill_manifests` at boot, mirroring `ensureFoundationalAgentGovernance`'s "code declares, DB durably records" pattern; it is NOT a live-editable-in-DB surface. Goals/Tasks/ChildAgentRuns are genuinely dynamic runtime data with no such code-declared source — they persist directly.
   - **Wiring**: `ModePorts` gained `goalTasks`/`skillManifests`/`childAgentRuns` as first-class fields (previously constructed unconditionally, OUTSIDE `ModePorts`, in `buildWiring()` itself — the exact gap the coordinator flagged) plus an `ensureSkillManifestCatalog?: () => Promise<void>` hook mirroring the `ensure*Governance` hooks' "awaited once at boot" shape. `buildPersistentPorts` binds the three real Drizzle stores + the seed hook; `buildInMemoryPorts` registers the SAME `GOVERNED_SKILL_MANIFEST_CATALOG` synchronously into the in-memory equivalents — one source of truth for what's governed, two durability backends, never drift.
   - **Tests**: 3 new real-pglite test files (`goal-task-store.test.ts` — 4 tests; `skill-manifest-store.test.ts` — 6 tests, including idempotent re-seed and read-before-refresh fail-loud; `child-agent-run-store.test.ts` — 5 tests, round-tripping every inherited ceiling) — 15 new tests, all passing against a REAL pglite engine (never a mock). 2 new `wiring.test.ts` tests prove `buildInMemoryPorts`/`buildPersistentPorts` bind the correct type for each of the three ports and that the full catalog is pre-registered/seed-hook-wired.

3. **AGS3 re-verified against the corrected scope** — CONFIRMED complete, with one design note flagged (not silently assumed acceptable): DealPilot's one live skill (`dealpilot.source`) and the migrated helpdesk/capture/Google skills are all assigned to one of the five permanent Agents (`LEARNING_AGENT`) or the pre-existing generic `EGRESS_AGENT` cloud-egress executor identity — no NEW DealPilot- or JobPilot-specific specialist Agent was created anywhere (verified: no `DEALPILOT_AGENT`/`JOBPILOT_AGENT`-shaped constant exists in the codebase). JobPilot itself has ZERO live `@bridge/core` Skill/Agent invocations to migrate — its own `Skill` type is a resume-schema domain field (work-history skills), a pure-logic package with no pipeline usage yet (confirmed by inspection of `tools/jobpilot/src/*.ts`); this is a vacuous-but-genuine satisfaction of AGS3's DealPilot/JobPilot clause, not an oversight. Flagged design note: `EGRESS_AGENT` predates TASK-007 (shared by Google egress before I started) and is a physical Agent identity distinct from the five permanent ones — reused rather than newly minted, but the coordinator may want to fold it conceptually into `LEARNING_AGENT` in a later pass; not reopened unilaterally here since it's pre-existing infrastructure, not new specialist-agent creation.

4. **TASK-011 correction applied** — DONE (see the dedicated TASK-011 section below, updated in place): Glassdoor/Reddit are `do_not_use`/`research_only` — source-rights eligibility must fail BEFORE any child Run or fetch is created, never via `touchesExternalRisk`+approval after the fact; Google Places stays unspawned until a lawful billed integration exists; no new capability-scope token is prescribed ahead of TASK-012's canonical grammar.

5. **Full re-verification** — DONE. `npx turbo run build` (all 20 packages) clean. `npx turbo run typecheck` clean for every package this session touched (`@bridge/core`, `@bridge/db`, `@bridge/api`, `@bridge/integrations-google`) — the one typecheck failure (`apps/web`'s `IntelligencePage.tsx`, missing `Link` import) is a pre-existing, unrelated bug on a file this session never touched (confirmed via `git status`/`git log` — last touched by a TASK-001 commit), not a regression. `eslint` on every changed directory: 0 errors, 2 warnings, both pre-existing and outside this session's diff (`determinism.ts` untouched entirely; `pipeline.ts`'s warning is on a line with no diff). Test suites, run directly per-package (not via `turbo run test`, which still has the pre-existing resource-contention artifact on this sandbox, confirmed via `git stash` on a clean tree in the prior round):
   - **`@bridge/core`: 395/395**
   - **`@bridge/db`: 82/82** (67 prior + 15 new persistence tests)
   - **`@bridge/api`: 115/115** (113 prior + 2 new wiring tests)
   - **`@bridge/integrations-google`: 35/35** (run with the required `--experimental-test-module-mocks` flag)
   - **Total: 627/627 passing, 0 failing.**
   Blast-radius scan of Automation and Approvals surfaces (explicitly requested): Automation's only real execution engine remains `InProcessRitualExecutor` (reconciled in the prior round; unaffected by this round's changes — no `ModuleAutomationBinding`-shaped code exists in this worktree to blast-radius against). Approvals: `ApprovalsPage.tsx` is generic (filters by action/resource/actor/policy text, no hardcoded skill names) — newly-`pending_review` rows from the migrated skills surface there with no code change needed. Checked each migrated skill's frontend/domain caller for a synchronous-apply assumption: `CameraCaptures.tsx`'s capture flow already displays "sent to the governed pipeline for review" copy regardless of ledger status (fire-and-forget `capture.stage` call) — no regression, the UI copy was already honest. DealPilot's `sourceListings()`/`commitCapture()` already model a two-step quarantine→human-commit flow fully decoupled from ledger status (`apiDealPilotSource`'s return reads `output.proposedOutput` regardless of `pending_review`/`applied`) — no regression. `helpdesk.stageAnswer` has no live frontend caller yet (API-only surface) and no test depended on its prior synchronous-apply behavior — its status change (Human-triggered Help Offers now always draft for review, never auto-send) is an intentional, in-scope correctness improvement of the fail-closed migration, not a regression of any shipped feature.

**Reconciliation note (unchanged from the prior round):** `packages/db/src/governance-stores.ts` and `apps/api/src/wiring.ts` remain files the coordinator's own in-flight checkout also modifies (TASK-005's `ensureLearningAgentGovernance`) — same idiom, same natural insertion points, a real but easily-resolved textual merge point, not a design conflict.

---


The coordinator's continuation directive required six concrete items beyond the initial AGS0–AGS2 delivery above. Status of each:

1. **AGS3 + five durable foundational Agent boundaries** — DONE. Read-only inspection (via a background explore agent) of `tools/dealpilot/src/*` and `tools/jobpilot/src/*` found **no specialist-agent catalog in code** (no persona/named-actor concept distinct from the 5 foundational Agents; a UI-mock `ownerAgent` string in `apps/web/src/app/data/bcg-application.ts` is display-only, never instantiated as a backend Agent) — AGS3's DealPilot/JobPilot migration has nothing to migrate; verdict recorded here rather than fabricating a migration. What WAS a real gap: Governance and Capability Builder had no physical governed-pipeline identity at all (only Learning/Internal Strategist did) — a Task could never be assigned to them. Added `GOVERNANCE_AGENT`/`CAPABILITY_BUILDER_AGENT` physical identities + `signal:write` capabilityScope + role grants (in-memory `seedGovernance`), proven live: `apps/api/test/agent-orchestration.test.ts`'s new AGS3 test assigns a Task to each and resolves the same governed Skill. All five foundational Agents (CoS as router + 4 with physical pipeline identities) now have durable, not merely prompt-level, boundaries.
2. **Fail-closed-by-default skill migration** — DONE, with an honest, explicit, time-boxed exception list. `pipeline.ts`'s AGS1 gate now REJECTS any skill with no registered manifest UNLESS it is named in a new `PipelineDeps.legacyUngovernedSkills` set — the old "manifest-optional, everything else silently ungated" posture is gone. A full live-catalog inventory (background explore agent) found the ACTUALLY-invoked catalog is small: `stageMutation`, `stageCapture`, `stageLearningRecommendation`, `dealpilot.source`, and 8 dormant `google.*` skills (registered, never actually called via `pipeline.propose` anywhere today). `stageLearningRecommendation` — already invoked with `actor:{type:"agent", id:LEARNING_AGENT}` — is migrated onto a REAL `SkillManifest` (`LEARNING_RECOMMENDATION_SKILL_MANIFEST`) with a Goal/Task provisioned inline per call (`provisionRoleModelRecommendationTask` in router.ts); this changes zero runtime behavior (already agent-actor-only) and proves a genuine pre-existing-skill migration, not just the demo skill. The remaining 5 legacy skills are named explicitly in `apps/api/src/wiring.ts`'s `TIME_BOXED_LEGACY_SKILLS`, each with its own specific justification and removal condition (see that constant's doc comment) — `dealpilot.source` in particular is flagged as a TASK-006 product decision (sync human UX vs. agent-mediated pending_review), not something TASK-007 should flip unilaterally.
3. **Persistent-mode governance/authority seeding** — DONE for all three new physical identities (Internal Strategist, Governance, Capability Builder). `packages/db/src/governance-stores.ts`'s new `ensureInternalStrategistGovernance`/`ensureGovernanceAgentGovernance`/`ensureCapabilityBuilderGovernance` (a shared private `ensureFoundationalAgentGovernance` helper, three named public wrappers — matching the coordinator's own per-Agent-function style rather than one generic call) mirror the coordinator's in-flight (uncommitted, inspected read-only) `ensureLearningAgentGovernance` idiom exactly (idempotent `onConflictDoUpdate`/`onConflictDoNothing` inserts + a post-write verification read) — same pattern, not a second mechanism. Wired into `wiring.ts`'s three `ModePorts.ensure*Governance` hooks, all awaited once at boot in `buildWiring()` (persistent mode only; in-memory mode's `seedGovernance` covers all three synchronously instead). **Real pglite tests** (`packages/db/test/internal-strategist-governance.test.ts`, 5 tests total, using the SAME `createLocalDb()` a genuine local Postgres-compatible engine every other `@bridge/db` store test uses) prove each actually persists usable authority, is idempotent, and correctly re-provisions on reuse. Migration numbering: **no new migration file was created** — no schema/DDL change was needed (the functions reuse existing `roles`/`agents`/`role_permissions`/`permissions` tables via idempotent application-level upserts, identical in mechanism to the coordinator's own choice for Learning). Migration slot **0012 is reserved but not consumed**; **no collision with 0011** (TASK-004's reserved slot, not yet materialized in the coordinator's checkout either, per read-only inspection).
4. **Automation→declared-Agent-Run reconciliation** — DONE, no second actor-binding path. Read-only inspection of the coordinator's checkout confirmed the ONLY real runtime Automation-execution mechanism in this codebase is `InProcessRitualExecutor` + the `rituals` table (`ModuleAutomationBinding` in the coordinator's in-flight package-manifest work is a DECLARATIVE inventory/display shape only — "This inventory reads the installed manifest; it does not invent Automation cards," no execution engine attached). `RitualStepDef`/`RitualStep` (ports.ts, ritual-executor.ts) gained an additive, optional `goalTaskRef` field, threaded unchanged into each step's `pipeline.propose` call — an Automation's declared Agent (`rituals.agentIds`) resolves a governed Skill through the EXACT SAME `resolveSkillForTask` gate a direct Agent call uses, via the step's own `goalTaskRef`. Proven with 3 new core tests (`pipeline-ags1.test.ts`): a Ritual step whose declared Agent is eligible for its Task resolves; a step targeting a governed skill with no `goalTaskRef` halts (fails closed, not silently skipped); a Ritual run declared under a Human actor fails closed on a governed step exactly like a direct call would. The zod schema (`ritual-stores.ts`, `router.ts`'s `ritualStep`) and `ritual.create`/`ritual.run` procedures were updated to accept/round-trip the field.
5. **Child Run lifecycle itself append-only auditable** — DONE. `cancelChildAgentRun`'s signature changed (`(store, id)` → `(deps:{store,ledger}, id, actor, ctx)`) so cancellation appends its OWN ledger row (previously only `createChildAgentRun`'s CREATE was audited) — carrying `parentRunId` (via `context.runId`), the acting `actor`, and a full snapshot of the run's inherited `authorityScope`/`budget`/`taint`/`depth` AS THEY STOOD at cancellation (`proposedOutput`), per the exact wording of the requirement. Generalized into a shared `recordChildAgentRunTransition` helper and added `completeChildAgentRun`/`failChildAgentRun` (same guarantee) so EVERY lifecycle transition — not just create/cancel — is independently auditable, ready for a future `ChildRunExecutor` to call. `ParentRunEnvelope` gained an optional `onBehalfOf` field, threaded onto the CREATE audit row's `onBehalfOfType`/`onBehalfOfId` so the full principal→parent-Agent→child-Run attribution chain survives on the row itself. `createChildAgentRun`'s router call site (`agentOrchestration.childRun.cancel`) now resolves the acting actor from `ctx.identity` (server-resolved, never client-asserted). 9 tests updated/added across `child-agent-run.test.ts`.
6. **Full verification** — DONE. `npx turbo run build` (all 20 packages) and `turbo run typecheck --filter=@bridge/core --filter=@bridge/db --filter=@bridge/api` are clean. Full suites run directly (not through turbo's parallel orchestration, which hit a resource-contention artifact on this sandbox unrelated to this change — see the original Verification section below): **@bridge/core 395/395**, **@bridge/db 67/67** (including 5 new real-pglite governance tests across all three new physical Agent identities), **@bridge/api 113/113** (including 10 new agent-orchestration tests + 3 new wiring-hook tests). `eslint` on every changed/new file: 0 errors (the same single pre-existing `no-console` warning, confirmed present on the clean tree at the same source line, unaffected line-number shift only). A second background blast-radius scan covered every `RunContext.type` consumer, every `UniversalActionPipeline` constructor call, every hardcoded foundational-Agent reference, and every Skill-name collision risk — all confirmed safe. No live Postgres is available in this sandbox (checked: no `psql`/`pg_ctl`, no `DATABASE_URL`) — `ensureInternalStrategistGovernance`/`ensureGovernanceAgentGovernance`/`ensureCapabilityBuilderGovernance` are validated against a REAL pglite engine (not a mock) instead, the same evidentiary bar `buildPersistentPorts`'s own existing tests use (a never-connected dummy Postgres URL).

**Reconciliation notes for the coordinator's own in-flight work** (read-only inspected, never edited): `packages/db/src/governance-stores.ts` and `apps/api/src/wiring.ts` are files the coordinator's checkout ALSO modifies (adding `ensureLearningAgentGovernance`/`ensureLearningGovernance` for TASK-005's onboarding-learning gate). My additions use the identical idiom and were placed at the same natural insertion points (right after `parseAllowedSkills`; the `ModePorts` interface; `buildPersistentPorts`'s return object; `buildWiring`'s post-`verifyRlsPosture` await) — a real but easily-resolved textual merge point, flagged explicitly here rather than discovered as a surprise at merge time. No other coordinator-owned file was touched.

---

## Scope delivered (AGS0–AGS2 of docs/raw/agent-goal-skill-orchestration-plan-2026-07.md)

Executed in the dedicated worktree per AP-029's parallel-start authorization. Reconciles with (does not
regress) the coordinator checkout's in-flight TASK-001–004 work and TASK-005 gate glue — no shared file
outside this worktree was touched; `docs/log.md`/`docs/BUGS.md`/`docs/TASKS.md`/`docs/APPROVALS.md` were
deliberately left untouched (no AP/ADR ID allocated, no canonical status flipped) per the coordinator's
explicit instruction — proposed ledger changes are listed at the end of this doc for the coordinator to
apply.

### AGS0 — Internal Strategist
Added `"internal_strategist"` as the 4th foundational Agent (`FOUNDATIONAL_AGENTS` in
`packages/core/src/agents.ts`): mission, responsibilities (owns analytical synthesis/comparison/
scenario-modeling/recommendations; explicitly does NOT own source-rights attestation, stakeholder
commitments, policy approval, or code deployment — matching AP-023's responsibility map exactly),
`neverExecutes: true`, direct `@strategist`/`@internal-strategist` mention routing (reuses the existing
`parseMention` mechanism — no new routing code needed), and a seed `EvalDataset`
(`INTERNAL_STRATEGIST_EVAL_DATASET`, 4 cases pinning its boundary invariants: no invented evidence, no
stakeholder commitments, no source-rights attestation, cites supplied evidence).

### AGS1 — Goal/Task-bound Skill manifests + fail-closed resolver
New `packages/core/src/goal-task.ts` (Goal/Task types + `InMemoryGoalTaskStore`) and
`packages/core/src/skill-manifest.ts` (`SkillManifest` contract + `resolveSkillForTask`, the resolver
implementing AGS1's exact `resolution_order`: Goal/Task type match → assigned-Agent identity → agent
authority ⊇ manifest permissions → Plane/data-scope/budget gates → highest eligible version → recorded
alternatives-rejected). `SkillManifest.defaultAgents` is a documentation-only preference field the
resolver NEVER reads for eligibility — only `Task.assignedAgentId` governs, making "default access is a
preference, never ownership" structural rather than conventional.

`pipeline.ts`'s `UniversalActionPipeline.propose()` gained a new, purely ADDITIVE gate: `PipelineDeps`
now carries two OPTIONAL fields (`skillManifests`, `goalTasks`). When a requested skill has a registered
`SkillManifest`, the pipeline requires `actor.type === "agent"` (a Human or Automation/`team` actor is
rejected — fail closed, still audited) AND a valid `goalTaskRef` that resolves through
`resolveSkillForTask`. Skills with NO registered manifest (the entire pre-existing catalog —
`stageMutation`, `dealpilot.source`, Google/JobPilot/Helpdesk skills) are **completely unaffected** — this
was verified both by a dedicated test and a background blast-radius scan (see Verification below).

### AGS2 — Bounded child Agent Runs
New `packages/core/src/child-agent-run.ts`: `deriveChildAgentRun` computes a child Run's authority
(intersection with parent, never union), eligible Skills (intersection), data scope (intersection),
budget (min of requested/parent-remaining), review mode (`stricterReviewMode` — never lower than parent;
an "external" risk-band Skill forces at least `"approve"`), and taint (`stricterTaint` — monotonic,
never cleaner than parent). Depth is capped at `MAX_CHILD_RUN_DEPTH = 3`
(`ChildRunDepthExceededError`); an unusable derivation (no budget left, disjoint data scope) throws
`ChildRunAuthorityExceededError` rather than persisting an inert row. `createChildAgentRun` derives +
persists (`InMemoryChildAgentRunStore`) + audits in one call — an append-only ledger row attributed to
the PARENT Agent's own identity (no second identity minted, per AGS2: "not new permanent Agents"),
threaded via the new `RunContext.type === "child_agent_run"` variant (types.ts, additive). Spawning a
child Run is NOT itself routed through `pipeline.propose` (would force human approval on every spawn,
defeating "parallelize work"); every ACTION the child Run subsequently takes still goes through the
unchanged governed pipeline and still hits the existing "agents always draft, humans always approve"
floor. `validateActionWithinChildRun` is a pre-pipeline local check (mirrors
`agent-scope.ts`'s `validateRitualWithinAgents` pattern) a future `ChildRunExecutor` would call before
each step. `cancelChildAgentRun` lets Governance/a Human stop any running child Run.

### API surface
`apps/api/src/wiring.ts`: registered a demo governed Skill (`stageStrategicRecommendation`,
`AGENT_ORCHESTRATION_SKILL_MANIFEST`) bound to Goal type `relationship.learning` / Task type
`synthesize_recommendation`, assignable to either Learning or Internal Strategist (both hold
`signal:write`) — demonstrates AGS1's acceptance criterion "same Skill can be selected for two eligible
Agents assigned to same Task" live. Added `INTERNAL_STRATEGIST_AGENT` physical identity constant
(mirrors `LEARNING_AGENT`'s existing pattern) with its own `capabilityScope`/role grant in
`seedGovernance`. Added `goalTasks`/`skillManifests`/`childAgentRuns` to `Wiring` (in-memory both modes).

`apps/api/src/router.ts`: new `agentOrchestration` router — `goal.create`/`goal.list`,
`task.create`/`task.listByGoal`/`task.reassign`, `skill.resolve` (read-only AGS1 preview),
`childRun.create`/`get`/`listByParentRun`/`cancel`. `action.propose`'s existing input gained an optional
`goalTaskRef` field (additive) so the generic propose endpoint can invoke governed Skills too.
`childRun.create` re-derives the parent's `authorityScope`/`dataScope`/`plane` server-side from
`ctx.wiring.agents` — never trusts a client-asserted parent envelope — and enforces that only the Task's
actually-assigned Agent may spawn a child Run for it.

## Files

### New (initial pass)
| File | Purpose |
|------|---------|
| `platform/packages/core/src/goal-task.ts` | Goal/Task types + `InMemoryGoalTaskStore` |
| `platform/packages/core/src/skill-manifest.ts` | `SkillManifest` + `resolveSkillForTask` fail-closed resolver |
| `platform/packages/core/src/child-agent-run.ts` | Bounded child Agent Run primitive + orchestrator + validator |
| `platform/packages/core/test/goal-task.test.ts` | 4 tests |
| `platform/packages/core/test/skill-manifest.test.ts` | 14 tests — every resolution_order gate + acceptance criteria |
| `platform/packages/core/test/child-agent-run.test.ts` | 17 tests (18 after closure pass) — inheritance/depth/budget/taint/review-mode/audit/cancel |
| `platform/packages/core/test/pipeline-ags1.test.ts` | 7 tests (12 after closure pass) — the pipeline gate itself, fail-closed paths |
| `platform/apps/api/test/agent-orchestration.test.ts` | 9 end-to-end tests (10 after closure pass) over real `buildWiring()` |

### New (closure pass)
| File | Purpose |
|------|---------|
| `platform/packages/db/test/internal-strategist-governance.test.ts` | 3 real-pglite tests proving `ensureInternalStrategistGovernance` actually persists usable, idempotent authority |

### Modified (initial pass)
| File | Change |
|------|--------|
| `platform/packages/core/src/agents.ts` | Added `internal_strategist` 4th foundational Agent + eval dataset |
| `platform/packages/core/src/types.ts` | Additive: `ActionRequest.goalTaskRef`, `RunContext.type` +`"child_agent_run"` |
| `platform/packages/core/src/pipeline.ts` | Additive AGS1 gate in `propose()`; two new optional `PipelineDeps` fields |
| `platform/packages/core/src/run-context.ts` | Doc-comment update only (new RunContext variant) |
| `platform/packages/core/src/index.ts` | Barrel-exported the 3 new modules |
| `platform/packages/core/test/agents.test.ts` | Updated roster-size assertion (3→4) + new Internal Strategist test |
| `platform/apps/api/src/wiring.ts` | New agent identity, demo governed Skill + manifest, new stores wired into pipeline |
| `platform/apps/api/src/router.ts` | New `agentOrchestration` router; `context`/`goalTaskRef` schema additions |

### Modified (closure pass)
| File | Change |
|------|--------|
| `platform/packages/core/src/pipeline.ts` | AGS1 gate now fails closed by DEFAULT (no manifest ⇒ reject) unless named in the new `legacyUngovernedSkills` allowlist |
| `platform/packages/core/src/ports.ts` | `RitualStepDef` gained an additive `goalTaskRef` field |
| `platform/packages/core/src/ritual-executor.ts` | `RitualStep` gained `goalTaskRef`; threaded unchanged into each step's `pipeline.propose` |
| `platform/packages/core/src/child-agent-run.ts` | `cancelChildAgentRun` now appends its own audited ledger row (was a bare status flip); added `completeChildAgentRun`/`failChildAgentRun`; `ParentRunEnvelope` gained optional `onBehalfOf` |
| `platform/packages/core/src/agents.ts`, `index.ts` | (unchanged in closure pass beyond initial) |
| `platform/packages/core/test/agents.test.ts` | (unchanged in closure pass beyond initial) |
| `platform/packages/db/src/governance-stores.ts` | New `ensureInternalStrategistGovernance` (mirrors coordinator's in-flight `ensureLearningAgentGovernance` idiom) |
| `platform/packages/db/src/index.ts` | Exported `ensureInternalStrategistGovernance` + its config type |
| `platform/packages/db/src/ritual-stores.ts` | `ritualStepDefSchema` zod schema + `normalizeStep` accept/round-trip `goalTaskRef` |
| `platform/apps/api/src/wiring.ts` | Added `GOVERNANCE_AGENT`/`CAPABILITY_BUILDER_AGENT` physical identities + seeding; `TIME_BOXED_LEGACY_SKILLS` explicit allowlist; `LEARNING_RECOMMENDATION_SKILL_MANIFEST`; `ModePorts.ensureInternalStrategistGovernance` hook wired into `buildPersistentPorts`/`buildWiring` |
| `platform/apps/api/src/router.ts` | `provisionRoleModelRecommendationTask` helper; `ritualStep`/`ritual.create`/`ritual.run` accept `goalTaskRef`; `childRun.cancel` resolves actor from `ctx.identity` |
| `platform/apps/api/test/wiring.test.ts` | 2 new tests proving the persistent-mode governance hook is wired (structural, no live DB) |

## Verification (live evidence)

- `packages/core`: `npx turbo run test --filter=@bridge/core` → **387/387 pass** (348 pre-existing + 39 new), 0 regressions.
- `apps/api`: `npx turbo run test --filter=@bridge/api` → **109/109 pass** (100 pre-existing + 9 new), 0 regressions.
- `npx turbo run build` (all 20 packages) and `npx turbo run typecheck --filter=@bridge/core --filter=@bridge/api` → clean, 0 errors.
- `npx eslint` on every changed/new file → 0 errors (1 pre-existing, unrelated `no-console` warning confirmed present on the clean tree at the same source line).
- Confirmed via `git stash`/rebuild that the two pre-existing build errors seen once (`@bridge/jobpilot` module resolution, one `unknown`-typed `err`) are **stale-incremental-build artifacts** (resolved once dependencies are built in turbo's correct order) and **pre-exist on the clean tree** — not introduced by this change.
- Ran a full monorepo `turbo run test`; it hit a **resource-contention cascade** ("Promise resolution is still pending…" across every file in `@bridge/db`/`@bridge/api`, plus an `@bridge/integrations-google` coverage-threshold miss) — reproduced this EXACT failure mode on a clean `git stash -u` tree with `@bridge/db`/`@bridge/integrations-google` alone passing cleanly, confirming it is a sandbox concurrency/resource artifact of running 20 packages' test suites simultaneously, not a regression from this change.
- Background `explore` agent blast-radius scan across `packages/*`, `apps/*`, `tools/*`, `services/*`: confirmed (a) no exhaustive switch/match on `RunContext.type` exists anywhere that the new `"child_agent_run"` variant could break, (b) every `UniversalActionPipeline` constructor call in the repo omits the two new optional `PipelineDeps` fields safely, (c) no other code hardcodes the foundational-agent roster size/list outside the two files this change already updated, (d) `stageMutation` (used by every Approvals-surface call site: `capability.approve`, `packages.install`, `blueprint.activate`, `chiefOfStaff.converse`, etc.) has no registered manifest anywhere, so the new gate never engages for it, (e) no skill-name collision with the new `stageStrategicRecommendation` demo skill. One doc-comment nit found and fixed (`run-context.ts`).

## Exact prototype test (TASK-007) — status

> "Assign a typed Task to a non-default eligible Agent, resolve the required Skill, create a bounded
> child Run, preserve authority/budget/taint/audit limits, and reject direct Human/Automation Skill
> execution."

All five clauses are exercised live in `apps/api/test/agent-orchestration.test.ts`:
1. Task assigned to `INTERNAL_STRATEGIST_AGENT` (non-default vs. `LEARNING_AGENT`, but structurally
   irrelevant either way since defaultAgents is never checked) → `skill.resolve` returns `ok:true`.
2. `childRun.create` derives a bounded child Run whose `authorityScope`/`budget` are strictly narrower
   than requested when the request exceeds the parent's real bounds (`ledger:write` dropped;
   `maxCalls` clamped to the smaller parent ceiling) — audited via an append-only ledger row, inspectable
   via `childRun.get`/`listByParentRun`, and cancellable via `childRun.cancel`.
3. A Human actor (`type: "user"`) invoking the governed Skill directly — even with a syntactically valid
   `goalTaskRef` — is rejected with `"...may only be invoked by an eligible Agent Run..."`, still
   audited (append-only ledger row).
4. Depth-cap and not-assigned-agent failure paths map to `BAD_REQUEST`/`FORBIDDEN`, never a 500.

## TASK-011 handoff — exact APIs/types JobPilot culture research should consume (no JobPilot code added here)

Per the coordinator's explicit instruction, TASK-011 (JobPilot culture research) gets **no JobPilot-specific
logic in this task** — only the generic contracts below, which TASK-011 wires with its own Goal/Task
type strings, its own governed Skill(s), and its own manifest(s).

### 1. Naming collision warning (read this first)
`tools/jobpilot/src/resume-schema.ts` already exports a type named `Skill` (a *resume* work-skill entry,
re-exported from `tools/jobpilot/src/index.ts`). This is UNRELATED to `@bridge/core`'s governed `Skill`
interface (`ports.ts`: `{ name: string; run(inputs, ctx): Promise<SkillOutput> }`) that
`SkillManifest`/`resolveSkillForTask` govern. TASK-011 must import the governed one from `@bridge/core`
and should alias on collision, e.g. `import type { Skill as GovernedSkill } from "@bridge/core"`.

### 2. Durable Learning / Internal Strategist boundaries (already built, reuse directly)
- `FOUNDATIONAL_AGENTS` (`@bridge/core`'s `agents.ts`) already carries `"learning"` and
  `"internal_strategist"` with their fixed `does_not_own` boundaries (Learning never executes; Internal
  Strategist never attests source-rights or commits stakeholders — both `neverExecutes: true`).
  TASK-011 does not need to (and must not) redefine these — reference the existing ids.
- Physical pipeline identities: `apps/api/src/wiring.ts` exports `LEARNING_AGENT` and
  `INTERNAL_STRATEGIST_AGENT` (real UUID constants `seedGovernance` already grants `signal:write` to).
  TASK-011's culture-research Skill(s) should request whatever ADDITIONAL permission tokens they need
  (e.g. `external:fetch:read` for sourcing) added to these agents' `capabilityScope` in `seedGovernance` —
  do not mint new physical agent identities; Learning/Internal Strategist stay the same two identities.

### 3. Goal/Task-based Skill resolution — recipe for "eligible non-default Agent takes over"
Import from `@bridge/core`: `Goal`, `Task`, `GoalTaskStore`, `InMemoryGoalTaskStore`, `SkillManifest`,
`SkillManifestRegistry`, `InMemorySkillManifestRegistry`, `resolveSkillForTask`.

TASK-011 should:
1. Define its OWN Goal/Task type string constants (do NOT reuse this task's demo
   `RELATIONSHIP_LEARNING_GOAL_TYPE`/`SYNTHESIZE_RECOMMENDATION_TASK_TYPE` — those are illustrative only).
   Suggested (non-binding) shape, mirroring JP3B's own vocabulary: goal type
   `"jobpilot.culture_research"`; task types `"research_culture_source"` (Learning, one per source) and
   `"synthesize_culture_profile"` (Internal Strategist, one per company once sources are gathered).
2. Register its own `SkillManifest`(s) (e.g. `jobpilot.researchCultureSource`,
   `jobpilot.synthesizeCultureProfile`) via `SkillManifestRegistry.register()` — `goalTypes`/`taskTypes`
   matching step 1, `permissions` including whatever the Skill actually needs (culture-source research
   needs `external:fetch:read`, plane `"local"` unless it must run on the cloud/egress plane per
   `planeGate`'s local-may-not-egress rule — JP3B's "authorized pages/reviews only" sourcing likely needs a
   CLOUD-plane Skill, same shape as this repo's existing `EGRESS_AGENT`/`external:fetch` pattern in
   `wiring.ts`'s `seedGovernance`), `riskBand` (JP3B's paywall/ToS/rights language points at `"external"` —
   check `capability/approvals.ts`'s hard floor: `external` always requires `explicit_human`, matching
   JP3B's "stop for user/counsel permission; no bypass path" exit criterion for free), `evalVersion`.
   `defaultAgents: ["learning"]` (or `["internal_strategist"]` for the synthesis Skill) is a UI preference
   only — never checked by the resolver.
3. Create one `Task` per source/company via `GoalTaskStore.createTask` with `assignedAgentId:
   LEARNING_AGENT` (or `INTERNAL_STRATEGIST_AGENT` for synthesis) — reassigning a Task
   (`GoalTaskStore.reassignTask`) is the ONLY way to hand a Task to a different eligible Agent later; a
   manifest's `defaultAgents` never overrides this (already proven by this task's
   `skill-manifest.test.ts`'s "default Agent access never overrides Goal/Task assignment mismatch" case).
4. Invoke via `pipeline.propose({ actor: { type: "agent", id: LEARNING_AGENT }, skill:
   "jobpilot.researchCultureSource", goalTaskRef: { goalId, taskId }, ... })` — the SAME
   `action.propose`/pipeline call every other governed mutation in this repo uses. No JobPilot-specific
   pipeline code is needed; registering the manifest is what turns the gate on for that skill id.

### 4. Structural rejection of Human/Automation direct Skill invocation
This is automatic once step 3.2 registers a manifest for a skill id — `pipeline.ts`'s AGS1 gate (already
built, in `@bridge/core`, unconditional on the skill's manifest, not on which Module registered it) rejects
any `actor.type !== "agent"` and any Agent not equal to the Task's `assignedAgentId`, always audited. No
JobPilot code needs to re-implement or re-check this.

### 5. Bounded per-source child Agent Runs — recipe
Import from `@bridge/core`: `ParentRunEnvelope`, `ChildAgentRunRequest`, `ChildAgentRun`,
`ChildAgentRunStore`, `InMemoryChildAgentRunStore`, `createChildAgentRun`, `cancelChildAgentRun`,
`validateActionWithinChildRun`, `MAX_CHILD_RUN_DEPTH`.

For "one target company, N sources" (JP3B: company pages, Google reviews, Reddit, blogs, Glassdoor):

**CORRECTION (2026-07-16, per coordinator review) — source-rights eligibility gates BEFORE Run creation, not via `touchesExternalRisk`/approval.** Glassdoor and Reddit are `do_not_use`/`research_only` for this slice — **no child Run and no fetch may be created for them at all.** `touchesExternalRisk: true` + human approval does **not** make a prohibited or unlicensed source lawful — approval is a control on an otherwise-permitted action, not a waiver of source-rights/ToS eligibility. Google Places likewise **stays unspawned** until a lawful, billed integration exists for it — it is not merely "external risk," it is "not yet a legitimate source" at all. The correct sequence is:

0. **Before step 1 below**: for each candidate source, resolve source-rights eligibility (`do_not_use` / `research_only` / `permitted`) from JobPilot's own legitimate-source catalog (JP3B's "authorized company pages, Google reviews, Reddit, blogs, and Glassdoor **only where access and terms permit**"). A `do_not_use` or not-yet-integrated source (Glassdoor, Reddit, Google Places in this slice) is **skipped with a recorded reason and zero network access** — no `createChildAgentRun` call, no fetch, no child Run row at all for that source. Only a `permitted` source proceeds to step 1. This eligibility check is JobPilot's own responsibility (its catalog, its terms classification) — `@bridge/core`'s child-Run primitive has no source-rights concept and should not be asked to gate on it via risk band alone.
1. Build ONE `ParentRunEnvelope` for the Learning Agent's overall culture-research run for that company
   (`authorityScope`/`dataScope`/`plane` re-derived server-side from `ctx.wiring.agents`, never
   client-asserted — mirrors this task's `agentOrchestration.childRun.create` router procedure exactly).
2. Call `createChildAgentRun` ONCE PER **permitted** SOURCE (never for a skipped one) with the SAME `parentRunId`/`parentAgentId` but a distinct
   `goalId`/`taskId` per source (or the same Task if one Task covers all sources for that company — either
   is valid; `ChildAgentRun.id` is what distinguishes runs, not the Task). Each call narrows
   `authorityScope`/`eligibleSkills`/`dataScope`/`budget` to `∩` the parent's real bounds and appends its
   own audited ledger row (`context.type: "child_agent_run"`).
3. Set `budget: { maxCalls, maxCost }` per source (e.g. `{ maxCalls: 1, maxCost: 1 }` for a single fetch)
   so a misbehaving source can't consume the whole per-run budget; `deadline`/`stopCondition` should
   reflect JP3B's "skip inaccessible/paywalled/prohibited/ambiguous sources" exit criterion (a source that
   can't be resolved within its own child Run's bounds should be skipped, not retried into a different
   Run's budget).
4. Set `touchesExternalRisk: true` on any **permitted** source that is ALSO "external" risk-band (per step 3.2 of
   the manifest recipe) — this forces `reviewMode` to at least `"approve"` **in addition to**, never instead
   of, the step-0 eligibility gate. `touchesExternalRisk`/approval is a control on a permitted action; it
   is never a substitute for source-rights eligibility, and never runs for a `do_not_use`/unintegrated source.
5. `validateActionWithinChildRun` before each `pipeline.propose` call scoped to that child Run — rejects
   locally (never reaching the pipeline/ledger) if the specific source's fetch would exceed that child
   Run's narrowed authority/skills/data-scope/budget.
6. Governance (or a Human) can inspect (`childAgentRuns.listByParentRun`) or `cancelChildAgentRun` any
   in-flight per-source Run — e.g. if a source turns out to violate ToS mid-run.

**On capability-scope tokens**: do not prescribe a new capability-scope token (e.g. anything Google-Places- or
review-site-specific) unless it matches the canonical `ResourceType`/`Action` grammar established by TASK-012's
vocabulary migration. Until then, reuse the existing `external:fetch:read`-shaped tokens this task's Google
skills already use (see `packages/integrations-google/src/skills.ts`'s `SKILL_SOURCE_*` constants) rather than
inventing a new token namespace.


### 6. What is reusable vs. demo-only (do not copy these into JobPilot)
| Reusable (import from `@bridge/core`) | Demo-only (this task's `wiring.ts` — do NOT reuse) |
|---|---|
| `Goal`, `Task`, `GoalTaskStore`, `InMemoryGoalTaskStore` types/classes | `RELATIONSHIP_LEARNING_GOAL_TYPE`, `SYNTHESIZE_RECOMMENDATION_TASK_TYPE` (illustrative goal/task type STRINGS only) |
| `SkillManifest`, `SkillManifestRegistry`, `resolveSkillForTask` | `AGENT_ORCHESTRATION_SKILL_MANIFEST` (this task's one demo manifest) |
| `ParentRunEnvelope`, `ChildAgentRun*`, `createChildAgentRun`, `cancelChildAgentRun`, `validateActionWithinChildRun` | `stageStrategicRecommendation` (this task's one demo Skill implementation) |
| `LEARNING_AGENT`, `INTERNAL_STRATEGIST_AGENT` physical identity constants (`wiring.ts`) — DO reuse these two | — |
| `agentOrchestration` router shape (goal/task/skill/childRun sub-routers) as a pattern to mirror | The router's PILOT_WORKSPACE-only wiring — TASK-011 likely adds its own procedures rather than extending this exact router |

### 7. Known gaps that carry over to TASK-011
- `goalTasks`/`skillManifests`/`childAgentRuns` are in-memory only (both modes) — same gap noted above;
  JobPilot's culture-research Tasks/child-Runs will not survive a process restart until a Drizzle-backed
  store lands for these primitives.
- No persistent-mode governance seed for any of this yet (same note as item 2 above).

## TASK-010 handoff — exact resolver/Run contract for red-flag correction feedback (no red-flag UI added here)

Per the coordinator's explicit instruction, TASK-010 (platform red-flag correction feedback) gets NO
red-flag UI or feedback-specific logic in this task — only the generic contracts below.

### 1. Storing the Human-owned private correction Memory — do NOT route this through the Agent/Skill pipeline
A red flag is a Human directly correcting something they see — it is Human-authored data, not an Agent
proposing a mutation, so it should NOT go through `pipeline.propose`/`resolveSkillForTask` at all. Use
`@bridge/core`'s existing `MemoryStore` port directly (already used this way elsewhere in `apps/api`'s
router for onboarding preferences — a plain `ctx.wiring.memoryStore.write(...)` call, no pipeline
involved):
```
memoryStore.write({
  id, workspaceId, type: "preference" /* or "episodic", per what's being corrected */,
  scope: "private", content: <the correction>,
  sourceRefType: "feedback",              // MemorySourceRefType already has this exact variant
  trustOrigin: "user_content",            // Human-authored — trusted, not tainted
  confidence: 1, createdBy: <human user id>, ownerUserId: <human user id>, plane: "local",
});
```
`MemorySourceRefType`'s `"feedback"` variant already exists for exactly this (memory/memory-store.ts) —
no new type is needed. `supersede(id, next)` is the append-only correction-of-a-correction path if a red
flag is later itself corrected.

### 2. Invoking an attributable Learning Agent Skill through the Goal/Task resolver
Once correction Memories exist, TASK-010's "propose a learned policy/preference change" step is a real
governed Skill invocation and reuses TASK-007's mechanism exactly like TASK-011's recipe above:
1. Define TASK-010's own Goal/Task type strings (e.g. `"platform.red_flag_learning"` goal;
   `"propose_preference_adjustment"` task, `assignedAgentId: LEARNING_AGENT`).
2. Register a `SkillManifest` (e.g. `"learning.proposePreferenceAdjustment"`) via
   `SkillManifestRegistry.register()` — see the CRITICAL constraint below before choosing its
   `permissions`/the Skill's `resourceType`.
3. Invoke via `pipeline.propose({ actor: { type: "agent", id: LEARNING_AGENT }, skill:
   "learning.proposePreferenceAdjustment", goalTaskRef: { goalId, taskId }, ... })` — the identical call
   shape used throughout this task. The AGS1 gate (unconditional, Module-agnostic, already built) rejects
   any Human/Automation actor and any Agent other than the Task's assigned one, always audited —
   TASK-010 does not need to (and must not) re-implement this rejection itself.

### 3. CRITICAL constraint — this Skill must NOT target `policy`/`policy_param` writes directly
`agent-floor.ts`'s `AGENT_FLOOR_PROTECTED_RESOURCES` includes `"policy"` and `"policy_param"`, and
`AGENT_FLOOR_MUTATIONS` includes `"write"` — `isAgentFloorDenied("write", "policy_param")` is **always
true for every agent, unconditionally, non-removably**, checked at Authority Layer 0 BEFORE Skill
resolution ever runs. This is a pre-existing governance self-modification floor, untouched by and
independent of AGS1's SkillManifest gate — no manifest can override it. Concretely: if
`"learning.proposePreferenceAdjustment"`'s manifest declares `permissions: ["policy_param:write"]` and the
pipeline call uses `resourceType: "policy_param", action: "write"`, the request is rejected at Layer 0
with `"agent-floor: agents may not write policy_param..."` regardless of Task assignment or manifest
eligibility.

**The existing, correct pattern to follow instead** is `stageLearningRecommendation`'s shape (already in
`apps/api/src/wiring.ts`, already invoked by the real Learning Agent today): the Skill's `resourceType`
should be `"signal"` (or another non-floor-protected type), `action: "write"`, and its `proposedOutput`
should carry the proposed preference/policy change as DATA, not as an actual `policy_param` mutation.
This repo already has a matching output shape to mirror: `policy/variance-adjuster.ts`'s
`VarianceProposal` (`{ paramKey, from, to, delta, rationale, governed: true, applied: false, ... }`) is a
PURE function output that never itself mutates `policy_params` — `applied: false` signals a human (or a
separate, already-governed enactment step) still has to act on it. TASK-010's Learning Agent Skill should
produce a proposal in this same shape; a Human reviews it via the Approvals inbox (the request is already
`pending_review` — every Agent action requires human approval, structurally, per this repo's existing
"agents always draft" invariant) and a SEPARATE, Human/system-only step performs the actual
`policy_param`/`policy` write once approved. TASK-007 does not build that enactment step — it is
TASK-010's own scope, same as JobPilot's culture-synthesis output is TASK-011's own scope.

### 4. Bounded child Agent Run — optional here, available if wanted
Unlike JobPilot's per-source parallel research, a single red-flag → single proposal flow does not need a
child Agent Run to satisfy TASK-010's stated requirements — one direct governed `pipeline.propose` call
per proposal already carries full authority/audit. If TASK-010 later wants to batch many accumulated
corrections into one attributable, budget-bounded Learning Agent pass (e.g. "review this week's red
flags"), the SAME `createChildAgentRun`/`ParentRunEnvelope`/`validateActionWithinChildRun` contract
documented in the TASK-011 section above applies unchanged — nothing red-flag-specific is needed in
`@bridge/core` for that either.

### 5. Reusable vs. demo-only (same rule as TASK-011)
Reuse: `MemoryStore` (existing port, already wired), `MemorySourceRefType.feedback` (already exists),
`GoalTaskStore`/`SkillManifestRegistry`/`resolveSkillForTask`, `LEARNING_AGENT`, the `pipeline.propose`
call shape, and `VarianceProposal`'s output shape as the pattern to mirror (not the type itself — that
type is specific to the tone-chip mechanism; TASK-010 defines its own proposal payload shape with the
same `governed: true, applied: false` convention). Do not reuse this task's demo goal/task-type strings
or `AGENT_ORCHESTRATION_SKILL_MANIFEST`/`stageStrategicRecommendation`.

## Blockers / follow-up items for the coordinator's TASKS.md / BUGS.md ledger (proposed, not applied)

1. **BUGS.md 2026-07-14 "Skills are a standalone toggle and runtime allows non-Agent invocation"** — the
   underlying MECHANISM this bug asked for now exists and is proven end-to-end for one demo governed
   Skill. The bug should stay OPEN (not RESOLVED) until the full existing skill catalog is migrated onto
   manifests — recommend leaving evidence attached to TASK-007 with a note that the mechanism landed,
   full-catalog migration is follow-up scope (possibly folded into TASK-012's vocabulary migration or a
   new bounded TASK).
2. **Persistent-mode (DATABASE_URL) governance seed** — `INTERNAL_STRATEGIST_AGENT`'s capabilityScope/role
   grant currently only exists in `wiring.ts`'s in-memory `seedGovernance`. A production deploy needs an
   equivalent addition to `migrations/0001_governance_seed.sql` (or a follow-up migration) before Internal
   Strategist can act in persistent mode. Flagging for whoever owns the next DB-migration-touching slice
   (I deliberately did not touch `packages/db/migrations/` or `schema.ts` in this pass to avoid colliding
   with the coordinator's in-flight TASK-001–004/TASK-005 schema work).
3. **AGS3** (migrate DealPilot/JobPilot specialist-agent catalogs onto the permanent-Agent + Goal/Task
   Skill-bundle model) is unstarted — separate follow-up slice, not part of this delivery.
4. No conflicts detected against TASK-004/TASK-005 in the coordinator's checkout — this worktree touched
   no schema/migration files and no UI files, only `packages/core/src` (7 files, 3 new) and
   `apps/api/src` (2 files) plus tests.
