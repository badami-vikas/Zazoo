---
applyTo: "docs/TASKS.md,platform/scripts/*pending-work*,platform/scripts/task-doc-parser.mjs,platform/apps/web/src/app/pages/TaskManagerPage.tsx,platform/apps/web/src/app/pages/PendingWorkPage.tsx,platform/apps/web/src/app/data/pending-work*"
---

# Task Manager Module

- Read `CLAUDE.md`, `docs/wiki/taskmanager.md`, and TASK-021 in `docs/TASKS.md`; use the linked plan/BRD only when needed.
- Preserve one canonical execution queue per workspace. `docs/TASKS.md` is the repository's current source; the Module's `tasks.md` is a projection, never a second store.
- Model one self-referential Task type/Database. Goal is `is_goal=true`; Outcome is `outcomes[]`; retired Initiative/Subtask types must not return. Tree changes update `parent_task_id` and materialized dot path atomically.
- Intake reconciles the same outcome/root cause/exit test before adding a Task. Bugs, requests, approvals, and decisions attach as evidence; they do not become parallel queues.
- Require a falsifiable exit test before execution, except cadence-reviewed goal Tasks. Done/archived/parked Tasks remain reopenable when targets change.
- Routing has no default Agent. Chief of Staff matches required Skills to eligible Agents; ambiguity or no match escalates to explicit Human assignment.
- Agent edits, resequencing, restructuring, routing, and rescheduling are governed proposals. Preserve deterministic system gates and Human approval until confidence is calibrated.
- Evolve the existing parser/projection/UI; do not create a second task format, local-only truth, or a replacement queue.
