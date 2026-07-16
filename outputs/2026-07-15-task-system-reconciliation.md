# Task System Reconciliation

The planning system now has one active execution ledger: [`docs/TASKS.md`](../docs/TASKS.md).

## What changed

- Reconciled related roadmap work, defects, requests, and approval gates into 20 outcome-based tasks, including the previously deferred browser companion/Avatar visual tail.
- Put the quick prototype path first: coherent shell → trust-first Onboarding → movable Avatar → trusted Commons install → combined end-to-end demo.
- Defined one intake rule: attach new evidence or intent to the existing task with the same outcome/root cause/exit test; create a task only for independently deliverable work.
- Required every task to carry Outcome, Prototype test, Scope, Evidence, Requests, Approval, Dependencies, Status, Priority, and Horizon.
- Retained `PROGRESS.md`, `BUGS.md`, `requests.md`, and `APPROVALS.md` for history, evidence, intent, and decision audit. They no longer act as work queues.
- Rewired the Task Manager generator to read canonical tasks only, eliminating the previous 67-row union and its repeated work.

## Reporting standard

There is no separate progress-report file. Report only meaningful task deltas: status/order change, material decision, new evidence, blocker, or verification result. Landed changes go to `docs/log.md`; substantive user-facing outcomes go to `outputs/`; detailed bug evidence stays in `docs/BUGS.md` and resolves against its canonical task.

## Prototype gate

Broad vocabulary cleanup, repository consolidation, and later Module work cannot preempt TASK-001–TASK-005. TASK-005 requires a live desktop and 375px path covering Onboarding, Avatar, Module actionability, trusted Commons install, Agent/Automation use, provenance, and correction/undo.
