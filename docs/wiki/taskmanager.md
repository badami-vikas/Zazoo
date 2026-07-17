# Task Manager Module

Full depth: [../raw/taskmanager-module-plan-2026-07.md](../raw/taskmanager-module-plan-2026-07.md) · BRD: [../raw/brd-taskmanager-2026-07.md](../raw/brd-taskmanager-2026-07.md). Status: proposed 2026-07-16, revised same day (TASK-021, AP-030/AP-031, placed after TASK-014).

## Core call

One installable Module. Owns **single execution queue** per workspace + one strategy anchor above it. Agent-first: coding agent often primary queue consumer, not human. Productizes proven system — repo's own `docs/TASKS.md` + Task Manager UI (AP-024/025) + user's game-designs repo converged on same format independently. Queue = governed Database; `tasks.md` file = **projection, never second store**.

## Layers — REVISED 2026-07-16 (user pushback, correct call)

**Two types, not four.** `Initiative` STAYS retired (AP-020 migrated it off kernel identifiers — reviving it as "Module Record type" was tried in first draft, rejected same day). `Outcome` was never a type — folded to a field.

- **Goal** (canonical) — the one non-Task anchor. Kept separate from Task on purpose: Goal reviewed/revised not "done"; one Goal can own MANY candidate Task-trees (collapsing loses that); glossary already locks the distinction. Carries `outcomes[]` (structured measures: title/measure/target/current/indicator_kind/north_star).
- **Task** (canonical) — self-referential, ONE recursive type covers what used to be Initiative+Task+Subtask. `status: candidate` = old Initiative meaning (compare-before-commit, now usable at ANY level not just top). Materialized dot-path id (`2.3.5` = 5th child of 3rd child of 2nd root) — user's idea, adopted, auto-maintained on reorder. Carries own `outcomes[]` too (same shape as Goal's).
- Execution layer (Task→Action→Evidence→Verification) = existing pipeline, reused not rebuilt.
- Not a "universal entity table" (already-rejected Taskade pattern): ONE domain, ONE Database, self-referential — same as the already-blessed Touchpoint tree, just leveled.

## Load-bearing rules

- One queue. Bugs/decisions/requests = evidence attached to tasks, never queues (prevents: ~100 lost bugs).
- Every Task: dot-path id + outcomes[] + **exit test** (fastest honest disprove-test) before in-progress; done needs verification record or challenger Automation reopens.
- Intake = reconcile first (search same outcome, attach, don't add). Duplicate-merge = proposal only.
- **NEW**: every Task/Goal create triggers Internal Strategist impact-fit-analysis → resequence proposal, before it settles into queue.
- **NEW routing**: agent-assigned Task → default Capability Builder (this Module is build/code-shaped); cross-Module Task whose required Skill belongs to a different eligible Agent routes there instead — Builder never invokes a Skill it doesn't own.
- **NEW reschedule governance**: human-assigned reschedule proposals need approval every time at first. Confidence-calibration (reuses VAR-1/Variance-Adjuster pattern) tunes off vetted human approve/veto history; once calibrated, MINOR reschedules auto-apply via a deterministic system gate (reuses ADR-073 `classifyApprovalBand` — kernel decides, agent explains, agent-floor DENY untouched). Significant changes always need approval.
- **NEW proactive value**: Internal Strategist scheduled scan across installed-Module data → proposes new value-adding Goals/Tasks as candidate drafts, never silent writes.
- Read budget: hot head (in-progress + next few) ≤ ~2k tokens; completed bay capped (10/7d) → archive, swept by Automation not memory.
- Agent writes = pipeline drafts, approve|edit|veto. No CRDT, no universal-entity table.

## Capabilities

- Agents: NO new permanent. Internal Strategist = planning brain + impact-fit + proactive scan; CoS = orientation/briefs; Learning = intake evidence + calibration signal; Governance = explains guards; **Capability Builder = default executor for agent-assigned Tasks**.
- Skills (14): goal-outcome-framing · candidate-task-generation · premortem-scenario · task-decomposition · exit-test-authoring · task-reconciliation · queue-sequencing (+ path maintenance) · **impact-fit-analysis** · **agent-task-routing** · **reschedule-confidence-calibration** · **proactive-opportunity-scan** · ledger-projection · evidence-verification · progress-synthesis · habit-scaffolding.
- Playbooks v1 capped 5 (OKR, backward planning, GTD clarify, SMARTER, pre-mortem) = versioned configs, not 20 skills.
- Automations (12): **task-created-impact-analysis** · **agent-task-routing-on-assign** · **reschedule-approval-gate** · **proactive-scan-cadence** · completed-bay-sweep · wip-breach · unverified-done-challenger · dependency-unblock · ledger-drift-detector · stale-task-review · goal-review-cadence · standup-brief. Guards = machinery, not convention.

## Slices

TM0 schema+vocab (two Databases, migrate legacy tree under VOCAB2) → TM1 queue surface → TM2 tasks.md contract + drift detect (dogfood repo TASKS.md) → TM3 planning Skills + Playbooks + impact-fit-on-create → TM4 guard Automations + agent routing + calibrated reschedule → TM5 Calendar/Second Brain/proactive scan + **game-designs instance certification** → TM6 Commons packaging.

## Reuse

Internal: TASKS.md format ADOPT · Task Manager UI EVOLVE · touchpoint tree MIGRATE (collapsed, not paralleled) · pipeline REUSE · **VAR-1 Variance Adjuster REUSE** for confidence calibration · **ADR-073 classifyApprovalBand REUSE** for the reschedule gate (no new "agent decides" mechanism). External: Vikunja/Planka AGPL + Focalboard dead = REJECT embed, patterns only.

## Top risks

Second-queue creep · plausibly-done · methodology bloat · ledger drift · vocabulary regression (a later session re-adding Initiative/Outcome as types — ADR-099 now records why not) · agent overreach (reschedule band widening — blocked by system gate) · Builder misuse (routing everything to Builder regardless of domain — mitigated by Skill-eligibility check first).
