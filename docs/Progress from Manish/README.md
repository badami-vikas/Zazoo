# Progress from Manish

User-requested restart context for the roadmap work paused on 2026-07-18.

This folder is **not** an execution queue and does not override [`docs/TASKS.md`](../TASKS.md), approvals, ADRs, plans, or prototype tests. It records what the parallel sessions delivered, what remains only in worktrees, and how to resume without repeating or losing work.

## Read first in a new session

1. Read [`subagent-progress.md`](subagent-progress.md).
2. Read [`paused-worktrees.md`](paused-worktrees.md) before touching any child branch.
3. Read [`merge-history.md`](merge-history.md) before merging or allocating a migration.
4. Fetch `origin/main` and compare it with the recorded clean baseline `7f44186`.
5. Confirm no agent/process is running and take a fresh `git status` snapshot of the chosen worktree.
6. Resume exactly one owner per worktree. Never duplicate or merge competing implementations blindly.

## State at handoff

- Central checkout: `/Users/manishsbhoopalam/.copilot/repos/relationship-os`
- Central branch: `main`
- The last code baseline verified for this handoff is
  `7f441869d1d4bc3ca92f0c62aeff655f23b998ad`, including TASK-006 durability, TASK-008 RM4, the
  validated Relationship continuation, and TASK-010 migration `0016`. Always re-fetch before
  resuming any worktree.
- Central working tree: clean when this package was written.
- Background agents: none.
- `relationship-os` worker processes: none.
- Unfinished implementations may be committed or WIP in their named worktrees; consult the exact
  row before resuming.

## Critical resume constraints

- TASK-010's post-RM4 migration `0016_new_ink` landed and merged into `main` as `e532b15` on 2026-07-18 (owner-aware `memories` RLS, DB-backed `lineage_revision`, JobPilot flag backfill+constraint). The next NEW migration allocates `0017`.
- TASK-011 requires no new migration unless its final implementation changes schema.
- TASK-006 durability added no numbered Drizzle migration.
- TASK-006 durability is merged into `main` on 2026-07-19 from
  `manishsbhoopalam8498-persist-dealpilot-locally`; validated implementation/integration head
  `2f85dc7` and final reviewed source head `adf6c95`. Live Google/BizBuySell and verified
  OS/application re-authentication remain external, so canonical status stays `in_progress`.
- TASK-008's validated Relationship continuation from candidate A is merged through `905aee9`.
  Candidate B is a superseded historical dirty worktree; do not merge either candidate again.
- TASK-023 has **two competing dirty implementations**. Select one after comparison; do not combine both wholesale.
- TASK-022 and one TASK-023 candidate both currently claim ADR-113 in branch-local docs. Renumber one during central integration.
- TASK-003 completed after human physical-input certification on 2026-07-18. TASK-005 and external provider/keychain/device evidence remain honestly blocked.
- TASK-008 includes RM0, RM4, and the validated RM1–RM5 continuity slice. It remains `in_progress`
  only for persistent user-defined Automations/Agent Runs, RM6 team permission/delegation,
  export/disconnect/forget, and held-out evaluation. TASK-014/TASK-009 own the shared Graph renderer.
- TASK-010 remains `in_progress` in `docs/TASKS.md` even after the `0016` merge — no live desktop/375px browser evidence has been claimed, and `ledger`'s own RLS was deliberately left unwidened (matches RM4's own precedent for the same port-signature reason).

## Files

- [`subagent-progress.md`](subagent-progress.md) — every roadmap project session and grouped background-review progress.
- [`paused-worktrees.md`](paused-worktrees.md) — exact unfinished worktree state, validation, blockers, and next actions.
- [`merge-history.md`](merge-history.md) — landed commits, source branches, migration sequence, and integration history.
