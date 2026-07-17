# 2026-07-17 — Task Manager Module: Goal collapses into a field, no-default CoS-owned routing

Follow-up to [2026-07-16-taskmanager-module-plan.md](2026-07-16-taskmanager-module-plan.md). Addresses R-037 (AP-035 applied).

## What changed

1. **Goal is no longer a separate Database.** `is_goal: boolean` is now a plain field on the one `tasks` Database (ADR-106, supersedes ADR-105's two-Database call). The user's objection was structurally correct: a root Task already branches and can own multiple candidate child-trees, so a second type added nothing — and a hard-typed Goal would force a table migration on every promote/demote, exactly the friction the user wanted removed.
2. **Full tree restructuring is now a first-class, governed capability.** Three operations, all proposals: **promote** (drop a stale ancestor, subtree becomes a new root — `b.c.d`→`c.d`, keeping `c`'s identity intact), **insert-ancestor-above** (`b.c.d`→`a.b.c.d`, demoting the old root into a child), and **re-parent** (move a subtree elsewhere). Because there's only one type, all three are pure `parent_task_id`/materialized-`path` updates recomputed atomically over the affected subtree — never a row migration between tables. New `task-tree-restructure` Skill (Internal Strategist) + `task-tree-restructure-proposal` Automation.
3. **Reopening is explicit.** `done`/`archived`/`parked` accept a governed reverse transition to `pending`/`in_progress` — the ordinary task-manager "reignite" convention — typically on a changed `outcomes[]` target. New `target-change-reopen-prompt` Automation.
4. **No default agent-task-routing executor (ADR-107).** The "default Capability Builder" fallback is gone. Routing always resolves an agent-assigned Task's executor by matching its required Skill against eligible Agents — reusing the real `SkillManifest`/eligible-Agent resolution shipped under **ADR-104 (TASK-007, landed on main same day)** rather than inventing a second mechanism. Ambiguous or unmatched cases escalate to explicit Human assignment; they never silently stall or silently pick.
5. **Routing ownership moves to Chief of Staff, not Internal Strategist.** CoS's glossary definition is literally "its routing role is a product composition," and the already-shipped `chiefOfStaff.converse` @mention dispatch (routing a request to Learning/Communications/Governance/Builder) is direct precedent. Internal Strategist keeps impact-fit-analysis and tree-restructure — placement/strategy questions — while CoS owns the dispatch question. Reschedule-confidence-calibration is extended to also calibrate routing confidence; a new `routing-approval-gate` Automation applies the same `classifyApprovalBand` system gate (ADR-073) that reschedule already uses.

## Local preview

The Task Manager UI already exists — `platform/apps/web/src/app/pages/TaskManagerPage.tsx` → `PendingWorkPage.tsx`, live at `/task-manager`, predating this Module's plan. Screenshot confirmed the Status column is already wired (RANK/TASK/STATUS/PROGRESS/PRIORITY/HORIZON/SOURCE/RECORD). Regenerated `pending-work.generated.json` from the merged `docs/TASKS.md` (21 records, TASK-021 included) — but the already-running dev server on port 5174 serves the **main checkout**, which has its own separate uncommitted work in progress and hasn't pulled the merge, so TASK-021 doesn't render there yet; that working tree wasn't touched, per the standing rule against discarding another session's uncommitted work.

A second server started from this worktree (port 5175, new `platform-web-worktree` launch config) hit a pre-existing, unrelated build break: `@bridge/core`'s `InMemoryAgentStore` no longer satisfies the `AgentQuery` interface after the TASK-007 orchestration work landed, so `dist/` was never produced and Vite's import-analysis fails on `@bridge/core`. Logged to `docs/BUGS.md` (2026-07-17) — out of scope for this Module's docs work, belongs with TASK-007 follow-up.

## Docs touched

`docs/raw/taskmanager-module-plan-2026-07.md`, `docs/raw/brd-taskmanager-2026-07.md`, `docs/wiki/taskmanager.md`, `docs/TASKS.md`, `docs/raw/decisions-log.md` (ADR-106, ADR-107, pointer on ADR-105), `docs/APPROVALS.md` (AP-035), `docs/requests.md` (R-037), `docs/BUGS.md`, `.claude/launch.json`.

## Way ahead

TASK-021 stays immediately after TASK-014 in the queue. TM0 now targets ONE Database instead of two; TM3 gains `task-tree-restructure`; TM4 gains no-default routing plus the shared reschedule/routing confidence gate. The `@bridge/core` build break should be fixed before any worktree attempts to run `platform-web` from a fresh checkout.
