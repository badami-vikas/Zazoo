---
title: "TASK-006–TASK-015 Parallel Start"
date: 2026-07-16
approval: AP-029
decision: ADR-098
status: in_progress
---

## Outcome

The user explicitly opened TASK-006 through TASK-015 before TASK-005 certification.
Dependencies remain hard gates: TASK-006/007/008 entered implementation; TASK-009–015
entered planning and pause before code until their prerequisites land.

## Implementation sessions

| Task | Session | ID |
|---|---|---|
| TASK-006 DealPilot core | Build DealPilot core | `9eab564f-2d44-4789-ae24-35d4a695bbf2` |
| TASK-007 Agent orchestration | Build Agent orchestration | `77450579-5d10-4898-a9c8-1760aeeca1e1` |
| TASK-008 Relationship consolidation | Consolidate Relationship | `4e046487-393d-4bb8-b98d-4729cec24f4a` |

## Planning sessions

| Task | Session | ID |
|---|---|---|
| TASK-009 Second Brain | Plan Second Brain | `1c3700d0-09a3-4968-9859-c661f882f514` |
| TASK-010 red-flag feedback | Plan red flag feedback | `942759c5-c407-4918-8d12-05284f4709ad` |
| TASK-011 JobPilot research | Plan JobPilot research | `9ec89b18-83f1-4ce2-a825-ba5380537ad5` |
| TASK-012 vocabulary migration | Plan vocabulary migration | `3179df41-d08d-4669-b73b-7788eff1f652` |
| TASK-013 repository cleanup | Plan repository cleanup | `aef84034-3206-4816-b14b-4918f06e6915` |
| TASK-014 Module UI rollout | Plan Module UI rollout | `3fd82197-81e4-4352-b6b3-d5b7a1509be1` |
| TASK-015 runtime taint | Plan runtime taint | `be52e0a6-4d88-4f04-af6f-e6fe27b6bfab` |

## Guardrails

- Every session owns one task and leaves an uncommitted reviewable diff or plan.
- Current uncommitted gate work remains the integration baseline; child worktrees may inspect it read-only.
- Shared router/schema/docs changes are reconciled centrally.
- No task is marked done without its exact Prototype test and dependency evidence.
- TASK-013 destructive deletion still needs a separate approval.
