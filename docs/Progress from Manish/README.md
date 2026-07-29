# Progress from Manish

User-requested restart context for paused roadmap work and later release handoffs.

This folder is **not** an execution queue and does not override [`docs/TASKS.md`](../TASKS.md), approvals, ADRs, plans, or prototype tests. It records what the parallel sessions delivered, what remains only in worktrees, and how to resume without repeating or losing work.

## Read first in a new session

0. **Validating the companion prototype?** Read
   [`companion-clicky-parity-handoff-2026-07-29.md`](companion-clicky-parity-handoff-2026-07-29.md)
   — TASK-027 is one commit on `main` with a full live-validation protocol (V1–V11) written for
   a fresh session; `git pull` first.
1. Read [`governed-chat-release-handoff-2026-07-27.md`](governed-chat-release-handoff-2026-07-27.md).
2. Read [`subagent-progress.md`](subagent-progress.md).
3. Read [`paused-worktrees.md`](paused-worktrees.md) before touching any child branch.
4. Read [`merge-history.md`](merge-history.md) before merging or allocating a migration.
5. Fetch `origin/main` and confirm the current baseline
   `aa5b86f5a6ee4939000bf6c94974ff8b896ddb7d` remains in its ancestry.
6. Confirm no agent/process is running and take a fresh `git status` snapshot of the chosen worktree.
7. Resume exactly one owner per worktree. Never duplicate or merge competing implementations blindly.

## State at current handoff

- 2026-07-29: TASK-027 (clicky-parity screen-aware companion ask, R-041) is implemented and
  pushed to `main` as one commit on top of `8cd9d46`. Compile/test/build gates pass (Rust 68/68,
  web 106/106); live permission/vision/voice certification is pending and fully scripted in the
  dedicated handoff above. A second concurrent session commits to the same checkout and owns
  port 5173.
- Central checkout: `/Users/manishsbhoopalam/.copilot/repos/relationship-os`
- Central branch: `main`
- TASK-026 durable governed Chat landed at `1c5340d`; final certified `main` is `aa5b86f`.
  Production migrations `0031`/`0032` are applied, final web deploy
  `dep-d9jlog3rjlhs738nvq90` is live, and configured Auth passes settled light/dark WCAG checks.
  Hosted answers remain honestly unavailable until an authorized cloud `ModelProvider` is configured;
  desktop managed Qwen is complete. Read the dedicated governed-Chat handoff first.
- TASK-012 VOCAB0–VOCAB2 landed through PRs #26/#27. VOCAB3 landed through PR #28 at source
  `bdcedeb` and merge `dc50c33`. VOCAB4 landed through PR #29 at source `80f8712`, evidence
  checkpoint `a07ec02`, and merge `611c9ad`.
- VOCAB5 lands through PR #30 from implementation/evidence checkpoint `63a7aaa`: immutable
  Relationship manifest `0.2.2`, nested `relationship.helpdesk`, removal of the standalone
  package and dead browser stores, ratchet 360→296, and no migration `0024`.
- Supabase deployment session `0f3e2f14-7fd2-4d07-8f3e-9c86c7c5480a` was recovered from a
  defunct parent. Its five displayed workers were stale, completed work was preserved at
  `6590c71`, and this merge ports only the deployment slice onto current Organization-era
  `main`. Runtime-role migration `0022_supabase_runtime_role`, hosted Auth, encrypted
  credentials, residency routing, container assets, and the deployment runbook are integrated
  under AP-054 and later landed at `6ee47e1`; that recovered slice itself performed no cloud
  provisioning.
- Verified pre-landing baseline `origin/main@512cf35`. TASK-024 implementation checkpoint
  `a4bf5fb` normally merged that baseline at `69ffbff` and landed through PR #23 from
  `task-024-zazoo-website`.
- TASK-024 implementation is complete under AP-052. The standalone `@zazoo/website` app delivers the approved
  ten-scene cinematic homepage with governed copy, pointer/keyboard/touch interactions,
  reduced-motion behavior, and certified desktop plus exact 375×812 layouts. The six storyboard
  contract tests, TypeScript check, production build, and ESLint passed. Publication commit `2306808`
  was reverted at the user's request under AP-053 by Pages commit `6b76466`; `https://zazoo.me` now
  serves the older experience. The domain `CNAME` and existing `consulting.html`/`training.html`
  pages remain available.
- TASK-008's validated Relationship implementation landed through `bab32ea` after RM4 migration
  `0015_task008_relation_contract` landed at `590cca6`. Its exact prototype is complete; canonical
  status and evidence live in [`docs/TASKS.md`](../TASKS.md) and
  [`outputs/2026-07-18-task-008-relationship-continuity.md`](../../outputs/2026-07-18-task-008-relationship-continuity.md).
- TASK-006 landed on `main` at `7f441869d1d4bc3ca92f0c62aeff655f23b998ad` under AP-045 after
  validating and normally merging base `bab32ea`.
- TASK-005 is complete under AP-047 at implementation/certification checkpoint `166a01b` and
  landed on `main` through `d4de355`.
  Fresh uninterrupted desktop `1440×913` and exact mobile `375×812` runs installed signed
  `cited-role-model-practice@1.0.1`, invoked it only through Relationship's Learning Agent,
  corrected weekly→monthly, proved veto/no Event, and deleted the learned preference. ADR-121/122
  govern the exact private Skill contract and fail-closed Organization Files rename.
- The TASK-005 worktree was clean, then fast-forwarded and pushed to the then-current
  `origin/main@d153094`; it is historical and must not be resumed.
- Background agents: none.
- `relationship-os` worker processes: none.
- TASK-012 final closure lands through PR #33 from source `cd0ad97` plus provenance pin `e139d88`.
  Migration `0024` preserves stored Results; vocabulary baseline is zero; expired aliases and dual
  registry reads are deleted; signed Commons bytes remain verifiable; desktop and exact 375px
  certification pass. TASK is `done` under AP-059/ADR-133. Do not resume any VOCAB branch.
- TASK-013 is complete under AP-061/ADR-135. Exact pre-cleanup `origin/main@7f37e17` is preserved
  on verified private ref `archive/task-013-pre-cleanup-2026-07-21`; main has one production tree,
  one built-in Module manifest catalog, no superseded runtime fixture pages, and no history rewrite.
  Deterministic security/migration fixtures remain tracked. Do not restore archived legacy trees.
- TASK-021 is done after Bridge PRs #37/#40/#41/#42 and external Corporate-training-sims PR #104
  certified signed Task Manager install, governed projection, two-instance restart, completed-bay
  sweeps, semantic reconciliation, and no-default Agent routing.
- TASK-022 implementation landed through PR #43 at merge `5122695`; it remains blocked only on an
  authorized Anthropic credential plus explicit live-spend proof of a non-zero second-call cache read.
- TASK-023 candidate A landed through PR #44 and closed through PR #45 at `2e0cb73`. Anonymous
  Parallel Search MCP is the sole shipped Tier-1 provider. Candidate B is superseded, dirty, idle,
  and must not be resumed, merged, cherry-picked, or deleted.
- TASK-015 runtime taint is done: source `da26f46`, PR #46, merge `5857cb9`, migration `0029`.
- TASK-016 database correctness is done: source `0b395b1`, PR #47, merge `ba8ccc1`, migration
  `0030`; the official 198-test DB package passed three consecutive four-file-concurrency runs.
- TASK-006 resumed fresh from `origin/main@922ca52` on
  `manishsbhoopalam8498-close-dealpilot-pilot`. One free `us-east-1` Supabase project, exact
  pilot Auth, migrations through `0030`, least-privilege `bridge_app`, policy-backed RLS, Local Plane restart,
  symmetric Source↔Thesis Relation, and desktop/exact-375 evidence are live. Migrations `0025`/`0026`
  align Supabase automatic RLS; ADR-134 records the boundary. Authorized Source credentials and
  Google OAuth remain external, so TASK-006 is `blocked` under AP-060.
- AP-063/ADR-137's free Render Virginia API and static site are live at the public URLs recorded in
  `outputs/2026-07-21-render-free-deployment.md`. PRs #49–#51 repaired clean dependency builds,
  public host wiring, and Turbo public-build inputs; evidence PR #52 source `3685985` merged at
  `4d130736a873667a6ac561957ed0993144e19ee4`. Auth/refresh/logout, public/private boundary,
  RLS/reset, restart, secret scans, and exact 375px passed. No disk/database/Key Value/paid resource
  exists; TASK-006 retains only its separate Google/Source-credential blocker.

## Critical resume constraints

- TASK-010's post-RM4 migration `0016_new_ink` landed and merged into `main` as `e532b15` on 2026-07-18 (owner-aware `memories` RLS, DB-backed `lineage_revision`, JobPilot flag backfill+constraint).
- Migrations through `0032_task026_chat_cloud_grants` are allocated and represented by current
  Drizzle metadata. Production also has `0031`/`0032`. The next new migration is `0033`; never reuse
  `0024`–`0032`.
- TASK-012 VOCAB0–VOCAB6 plus final compatibility deletion is represented through PR #33. The task
  is complete; old planning/integration branches remain historical.
- TASK-011 landed on `main` under AP-049 via PR #22 (branch `manishsbhoopalam8498-shiny-adventure`, final head `5e826ad`). No new migration was required.
- TASK-024 landed on `main` through PR #23 under AP-052. Its implementation checkpoint is
  `a4bf5fb`, its `origin/main@512cf35` integration checkpoint is `69ffbff`, and it added no
  migration. Pages publication `2306808` was rolled back through `6b76466` and run `29683837490`;
  `https://zazoo.me` serves the pre-TASK-024 experience. Do not resume or re-merge the historical
  `task-024-zazoo-website` implementation worktree.
- TASK-006 durability added no numbered Drizzle migration.
- TASK-006 durability is merged into `main` on 2026-07-19 from
  `manishsbhoopalam8498-persist-dealpilot-locally`; validated implementation/integration head
  `2f85dc7`, final reviewed source `adf6c95`, and landed integration `7f44186`. Live
  Google/BizBuySell and verified OS/application re-authentication remain external, so canonical
  historical status stayed `in_progress`; AP-060 now sets the canonical task to `blocked`.
- TASK-006 live Supabase continuation allocated `0025`/`0026`; Render certification applied the
  canonical `0027`–`0030` chain without adding a deployment-only migration.
- TASK-008's validated Relationship continuation from candidate A is merged through `905aee9`.
  Candidate B is a superseded historical dirty worktree; do not merge either candidate again.
- TASK-023 candidate A is selected, merged, and done. Candidate B remains a superseded dirty
  historical worktree; do not resume, merge, cherry-pick, or delete it.
- TASK-022's paused ADR-113 collision is resolved as ADR-140 at source `61e85c3`/PR #43.
  TASK-022 remains blocked only on authorized live Anthropic cache-read evidence. Re-evaluate
  it only when that exact external proof can run. TASK-023 candidate A's former branch-local
  ADR-113 was reconciled to ADR-141 before its selected implementation landed.
- TASK-003 completed after human physical-input certification on 2026-07-18. TASK-005 completed
  its separate combined certification under AP-047; do not resume or re-merge its historical
  worktree. External provider/keychain/device evidence for other tasks remains honestly blocked.
- TASK-008 is landed and complete for its exact prototype. TASK-014 and converged TASK-009 are also
  done through the shared View Grammar/full-scope Graph renderer; advanced RM6/evaluation work is
  future plan scope.
- TASK-010 closed on 2026-07-19 after authenticated live desktop and 375px certification found and
  fixed the missing JobPilot default-table cell controls. `ledger`'s own RLS remains deliberately
  unwidened as the previously reviewed port-signature limitation; private proposal reads stay
  protected by the authenticated paginated API/store filters.
- TASK-011 (JobPilot culture research) closed on 2026-07-19 under AP-049 after 13+ rounds of
  independent/coordinator security review and a final central-merge review closing the last 2
  blockers (durable child-Run terminal-audit repair; full-lineage artifact purge/redaction). Merged
  into `main` via PR #22; do not resume or re-merge its historical worktree
  (`manishsbhoopalam8498-shiny-adventure`). Full evidence:
  `outputs/2026-07-17-jobpilot-culture-research-task011.md`.

## Files

- [`companion-clicky-parity-handoff-2026-07-29.md`](companion-clicky-parity-handoff-2026-07-29.md) - TASK-027 screen-aware companion ask prototype: architecture, command contracts, uncommitted change set, environment setup, and the V1–V11 live-validation protocol for a fresh session.
- [`governed-chat-release-handoff-2026-07-27.md`](governed-chat-release-handoff-2026-07-27.md) - durable Chat, production migration, Auth, and deploy resume state.
- [`subagent-progress.md`](subagent-progress.md) — every roadmap project session and grouped background-review progress.
- [`paused-worktrees.md`](paused-worktrees.md) — exact unfinished worktree state, validation, blockers, and next actions.
- [`merge-history.md`](merge-history.md) — landed commits, source branches, migration sequence, and integration history.
