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

## Current repository projection

- `task-doc-parser.mjs` accepts either a legacy `## TASK-nnn — title` heading or a section title plus `- ID: TASK-nnn`; duplicate matching IDs coalesce and conflicting IDs in one section fail loudly.
- Keep the backtick `IDs for cross-reference` list synchronized with physical task-section order while compatibility parsing exists. It may rank parsed tasks but never authorizes a second execution order.
- Canonical list fields (`Scope`, `Evidence`, `Requests`, `Dependencies`) are semicolon-delimited; `none` means an empty list. `Prototype test` maps to `prototypeTest`; unknown prose is not silently promoted into schema.
- `generate-pending-work.mjs` is a one-way projection: map canonical statuses, preserve task metadata, assign rank/source file/source line, and regenerate `pending-work.generated.json`. Never hand-edit generated JSON.
- `pending-work.ts` reconciles generated Tasks with local presentation edits. LocalStorage order, title patches, archived visibility, widths, and schedules are user-view preferences only; they do not change `docs/TASKS.md`, approval, scope, status, or evidence.
- Preserve deterministic display ordering: in-progress first, then pending canonical rank, then completed/dropped. Reconciliation keeps existing schedules and allocates dates only for newly projected Tasks.
- The current parser/UI is a pre-Module bridge. `is_goal`, structured Outcomes, `parent_task_id`, dot paths, evidence Relations, drift round-trip, Agent routing, and governed tree edits remain TASK-021 work; do not fake them with extra local-only fields.

## Editing and validation

- Reconcile an incoming requirement against existing outcomes/root causes/exit tests before editing. Canonical scope/order/status changes follow the approval rule; update the explicit ID list, task section, projection, and audit evidence together.
- Run parser tests for both heading forms, conflicts, list parsing, and explicit order; generator tests for status/rank/source metadata; data tests for edit reconciliation and schedule preservation; web tests for columns, reorder/archive undo, and source links.
- Regenerate the projection after every canonical task edit and verify its Task count, IDs, rank order, statuses, and source lines against `docs/TASKS.md`.
