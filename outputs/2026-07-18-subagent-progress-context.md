# Subagent progress context

Created the user-requested persistent restart package at:

- [`docs/Progress from Manish/README.md`](../docs/Progress%20from%20Manish/README.md)
- [`docs/Progress from Manish/subagent-progress.md`](../docs/Progress%20from%20Manish/subagent-progress.md)
- [`docs/Progress from Manish/paused-worktrees.md`](../docs/Progress%20from%20Manish/paused-worktrees.md)
- [`docs/Progress from Manish/merge-history.md`](../docs/Progress%20from%20Manish/merge-history.md)

The package records every roadmap child session, grouped reviewer findings, merged commits, dirty worktrees, duplicate implementations, migration/ADR collisions, validation evidence, blockers, and exact resume rules. It is context only; [`docs/TASKS.md`](../docs/TASKS.md) remains the sole execution queue.

## Canonical task status snapshot

Reconciled on 2026-07-18 from [`docs/TASKS.md`](../docs/TASKS.md) and
[`docs/Progress from Manish/subagent-progress.md`](../docs/Progress%20from%20Manish/subagent-progress.md).
All workers are stopped. Off-main work below remains paused and must not be
treated as landed.

| Order | Task | Canonical status | Current reality |
|---:|---|---|---|
| 1 | TASK-001 | done | Actionable shell is merged and verified on `main`. |
| 2 | TASK-003 | blocked | Implementation is merged; physical drag/relaunch, VoiceOver, and external-display evidence remain. |
| 3 | TASK-004 | done | Signed Commons discovery/install and trust path are merged and verified. |
| 4 | TASK-005 | blocked | Gate glue is merged; waits for TASK-003 evidence and the full desktop plus 375px combined certification. |
| 5 | TASK-013 | ready | Planning only; waits for TASK-005 and TASK-012, with separate approval required before destructive archival. |
| 6 | TASK-012 | ready | Vocabulary migration plan exists; implementation waits for TASK-005. |
| 7 | TASK-010 | ready | Substantial off-main correction work is paused; migration `0016`, RLS/lineage, ledger history, and JobPilot migration remain unfinished. |
| 8 | TASK-008 | in_progress | RM0 and RM4 are merged; RM1-RM6 remain. Two competing paused RM1-RM2 candidates must be reconciled before resuming. |
| 9 | TASK-007 | done | Agent/Skill/child-Run orchestration is merged and verified. |
| 10 | TASK-014 | ready | Planning only and dependency-gated by incomplete TASK-006 and TASK-008 work. |
| 11 | TASK-021 | ready | Basic Task Manager ledger/UI exists; full TM0-TM6 scope remains dependency-gated. |
| 12 | TASK-015 | ready | Runtime-taint design is complete; implementation waits for TASK-012. |
| 13 | TASK-016 | ready | Database/migration correctness backlog is defined; no implementation progress recorded. |
| 14 | TASK-017 | ready | Runtime/package correctness backlog is defined; no implementation progress recorded. |
| 15 | TASK-006 | in_progress | Core DealPilot is merged. Local durability work is paused off-main; real provider/keychain, re-authentication, desktop, and 375px evidence remain. |
| 16 | TASK-011 | ready | Large culture-research WIP is paused off-main; terminal-audit durability and full-lineage artifact purge remain. |
| 17 | TASK-009 | ready | Planning is merged; delivery is intentionally folded into TASK-014's Graph renderer after TASK-008. |
| 18 | TASK-002 | done | Trust-first Onboarding and governed Learning controls are merged and verified. |
| 19 | TASK-020 | ready | Deferred later work; waits for TASK-003 and TASK-015. |
| 20 | TASK-018 | blocked | Desktop signing/CI and real mobile client/device evidence remain; waits for TASK-005. |
| 21 | TASK-019 | blocked | Approval inconsistency must be reconciled and TASK-005/TASK-015 must complete. |
| 22 | TASK-022 | ready | Implementation and review fixes are paused and uncommitted off-main; live provider evidence remains. |
| 23 | TASK-023 | ready | Two competing paused implementations exist; candidate A reports fuller validation, but one candidate must be selected and integrated. |

Totals: 4 done, 2 in progress, 4 blocked, and 13 ready.

## Resume order

Per the user's 2026-07-18 directive, all remaining P0 work completes before any
P1 implementation resumes. TASK-003 must first clear its physical macOS
drag/relaunch, VoiceOver, and external-display evidence. TASK-005 then runs the
complete desktop and 375px combined certification. Paused P1 worktrees remain
untouched until both P0 tasks are complete.
