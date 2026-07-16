# Task Manager order and documentation model

Canonical order, shared by Claude and the platform through `docs/TASKS.md`:

`TASK-001, TASK-003, TASK-004, TASK-005, TASK-013, TASK-012, TASK-010, TASK-008, TASK-007, TASK-014, TASK-015, TASK-016, TASK-017, TASK-006, TASK-011, TASK-009, TASK-002, TASK-020, TASK-018, TASK-019`

Each task retains a status. Task Manager places in-progress work first, pending work in this order, and completed/dropped work last. Completed tasks remain visible for audit.

`BUGS.md` remains append-only reproduction/evidence, not a queue. `PROGRESS.md` is pointer/rules only; its history is archived in `docs/raw/progress-archive-2026-07.md`. `TASKS.md` is the one execution source; generator reads it directly and emits UI data.
