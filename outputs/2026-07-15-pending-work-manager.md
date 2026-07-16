# Pending Work Manager

Delivered a functional Pending Work page at `/pending-work` inside the current Bridge web prototype.

## Scope captured

The first implementation scanned four independent ledgers and exposed 67 records. AP-024/ADR-092 corrected that model: the page now reads only `docs/TASKS.md`, where one canonical task contains its plan scope, bug evidence, request references, approval gate, status, dependencies, and prototype test. BUGS, requests, APPROVALS, and historical PROGRESS no longer manufacture duplicate rows.

## User controls

- drag rows or use up/down buttons to set rank order
- edit task wording inline while retaining the source file and line
- add a task directly to the local queue
- search and filter by source; optionally include archived work
- archive instead of destructively deleting source history, with immediate undo and later restore
- copy the originating source reference from each row

Rank, edits, local additions, and archive state persist in the browser's local plane. `docs/TASKS.md` remains the authoritative execution queue; browser edits remain presentation preferences until deliberately reconciled back into it.

## Verification

- focused reducer tests: rank order, provenance-preserving edits, archive/restore
- `@bridge/web` TypeScript check passed before a concurrent unrelated `EditableField.tsx` edit introduced an unused `@ts-expect-error`; the final full rerun reports that foreign-file error
- real-browser verification of navigation, inline edit, rank movement, archive, and undo
- visual QA at the desktop prototype viewport; corrected a table-width defect found during that pass

Known pre-existing browser noise remains: the onboarding Radix ref warning already recorded in `docs/BUGS.md`, and a missing favicon response.

## Task Manager follow-up

The Calendar destination is now presented as Task Manager at `/calendar` (also available at `/task-manager`). The pending queue is allocated across a rolling 12-day window starting today, covering the remaining current week and the following week/weekend. Each row can be rescheduled directly.

The task table now supports resizable columns, hidden columns, double-click title editing, right-click/row-menu actions for edit, delete cell, delete/hide row, duplicate, sort, and column hiding. The original Google Calendar projection remains available at `/calendar/google` as a connected-source detail surface.
