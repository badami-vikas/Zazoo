# Task Manager Module

Full depth: [../raw/taskmanager-module-plan-2026-07.md](../raw/taskmanager-module-plan-2026-07.md) · BRD: [../raw/brd-taskmanager-2026-07.md](../raw/brd-taskmanager-2026-07.md). Status: **DONE** 2026-07-21 (TASK-021, AP-066). Bridge PR #41 + Corporate PR #104. Signed `task-manager@1.0.2`. External two-instance PASS. Zero blockers.

## Core call

One installable Module. Owns **single execution queue** per workspace. Agent-first: coding agent often primary queue consumer, not human. Productizes proven system — repo's own `docs/TASKS.md` + Task Manager UI (AP-024/025) + user's game-designs repo converged on same format independently. Queue = governed Database; `tasks.md` file = **projection, never second store**.

## Layers — REVISED TWICE (2026-07-16, 2026-07-17 — both user pushback, both correct)

**ONE type.** 2026-07-16: dropped Initiative/Outcome as types (Initiative stays retired per AP-020; Outcome folds to a field). 2026-07-17: dropped Goal as a type TOO, after the user asked "why does Goal need to exist separately — a root task already branches" and demanded full tree-surgery flexibility (insert new ancestor above an existing branch: `b.c.d`→`a.b.c.d`; promote a branch to a new root dropping a stale ancestor: `b.c.d`→`c.d`, keeping `c`'s identity). A hard-typed Goal would force a TYPE MIGRATION on every promote/demote — exactly the friction the user wanted gone.

- **Task** (canonical) — the ONLY type. Self-referential, materialized dot-path id (`2.3.5`), `status: candidate` = old Initiative meaning, `outcomes[]` = old Outcome, **`is_goal: boolean`** = old Goal. The flag travels with the row through any re-parenting — restructuring is always a pure `parent_task_id`/`path` update, never a table migration. Demoted former-root still reads as a reviewed anchor wherever it now sits ("sub-goal" falls out free). Promoted branch keeps its own `is_goal` value untouched unless a Human flips it.
- Execution layer (Task→Action→Evidence→Verification) = existing pipeline, reused not rebuilt.
- Not a "universal entity table" (already-rejected Taskade pattern): ONE domain, ONE Database, self-referential — same as the already-blessed Touchpoint tree, just leveled + flagged.

## Load-bearing rules

- One queue. Bugs/decisions/requests = evidence attached to tasks, never queues (prevents: ~100 lost bugs).
- Every Task: dot-path id + outcomes[] + **exit test** (fastest honest disprove-test) before in-progress — UNLESS `is_goal=true`, which may run on `review_cadence` instead (goals aren't expected to hit one terminal "done").
- Status is NOT one-directional: done/archived/parked can be **reopened** to pending/in_progress (normal task-manager convention), typically on a changed outcome target — `target-change-reopen-prompt` Automation.
- Intake = reconcile first (search same outcome, attach, don't add). Duplicate-merge = proposal only.
- Every Task/Goal create triggers Internal Strategist impact-fit-analysis → resequence proposal, before it settles into queue.
- **Tree restructuring is governed**: promote (drop ancestor, subtree becomes root) / insert-ancestor-above (wrap in new parent) / re-parent — all proposals, path recomputed atomically over the affected subtree only (never partial).
- **Routing — REVISED 2026-07-17 (ADR-107)**: NO default executor. Chief of Staff (not Internal Strategist) owns `agent-task-routing` — matches required Skill against eligible Agents (reuses the real shipped `SkillManifest` resolution, ADR-104). Ambiguous/no-match → escalates to explicit Human assignment, never guesses. Why CoS: routing = dispatch/coordination, CoS's existing glossary-defined role + shipped @mention-dispatch precedent; Internal Strategist keeps impact-fit + restructuring (placement/strategy questions, not "who executes").
- **Reschedule + routing governance share one mechanism**: human proposals need approval every time at first. Confidence-calibration (reuses VAR-1/Variance-Adjuster) tunes off vetted human approve/veto history; once calibrated, MINOR/unambiguous cases auto-apply via a deterministic system gate (reuses ADR-073 `classifyApprovalBand` — kernel decides, agent explains, agent-floor DENY untouched). Significant/ambiguous always need approval.
- Proactive value: Internal Strategist scheduled scan across installed-Module data → proposes new value-adding Tasks as candidate drafts, never silent writes.
- Read budget: hot head (in-progress + next few) ≤ ~2k tokens; completed bay capped (10/7d) → archive, swept by Automation not memory.
- Agent writes = pipeline drafts, approve|edit|veto. No CRDT, no universal-entity table.

## Capabilities

- Agents: NO new permanent. **Chief of Staff = agent-task routing owner (2026-07-17)**; Internal Strategist = planning brain + impact-fit + tree-restructure + proactive scan; Learning = intake evidence + calibration signal (now for BOTH reschedule and routing); Governance = explains guards; Capability Builder = one eligible executor among several, never a default.
- Skills (15): goal-outcome-framing · candidate-task-generation · premortem-scenario · task-decomposition · **task-tree-restructure (NEW)** · exit-test-authoring · task-reconciliation · queue-sequencing · impact-fit-analysis · agent-task-routing (owner: CoS, no default) · reschedule-confidence-calibration (shared reschedule+routing) · proactive-opportunity-scan · ledger-projection · evidence-verification · progress-synthesis · habit-scaffolding.
- Playbooks v1 capped 5 (`outcome-key-results`, `backward-planning`, `clarify-organize`, `measurable-review`, `pre-mortem`) = versioned configs, not 20 skills. **REAL since 2026-08-08 (ADR-197)** — each now carries methodology, intent, the technique's questions, system-prompt guidance, and which Skills it may run. Ids stay technique-named, never book-brand-named; no protected text copied. `TASK_MANAGER_PLAYBOOKS` is derived from that content, so roster and content cannot drift.
- **TM3 gap closed in two slices, 2026-08-08.** Found by auditing the shipped Module against its own plan: all 18 `task-manager.*` Skill ids were registered manifests whose `run()` ECHOED inputs — externally indistinguishable from working Skills, which is why it survived certification. Slice 1 (ADR-196): reconciliation + queue-sequencing + impact-fit, deterministic, no model — they run on every create and decide placement. Slice 2 (ADR-197): the four generative Skills, model-backed on the **Local Plane only** (router fails rather than falling through to cloud), with the Playbook's questions + zero drafted items + a stated reason as the honest offline answer. Model never authors dot-paths, statuses, or ids. **Still echoing (8):** exit-test-authoring · task-tree-restructure · agent-task-routing · reschedule-confidence-calibration · proactive-opportunity-scan · evidence-verification · progress-synthesis · habit-scaffolding. **Nothing invokes the four new Skills yet** — registry-reachable, on no Automation or tRPC path.
- Automations (14): task-created-impact-analysis · agent-task-routing-on-assign (updated: no default) · reschedule-approval-gate · **routing-approval-gate (NEW)** · **task-tree-restructure-proposal (NEW)** · **target-change-reopen-prompt (NEW)** · proactive-scan-cadence · completed-bay-sweep · wip-breach · unverified-done-challenger · dependency-unblock · ledger-drift-detector · stale-task-review · goal-review-cadence · standup-brief. Guards = machinery, not convention.

## Slices

TM0 schema+vocab (ONE Database, migration `0027`) → TM1 Queue/Table/Form/Tree/Record Detail → TM2 deterministic `tasks.md` emit/parse/hash/drift/reconcile + repo parser projection → TM3 planning Skills/5 Playbooks + governed impact/restructure/reopen → TM4 guards + no-default routing + calibrated reschedule/routing → TM5 Calendar/Graph/proactive candidate + Corporate certification → TM6 signed Commons packaging/provenance. **All passed.**

## Reuse

Internal: TASKS.md format ADOPT · Task Manager UI (`/task-manager`, live, has Status column) EVOLVE · touchpoint tree MIGRATE (collapsed, not paralleled) · pipeline REUSE · **`SkillManifest`/eligible-Agent resolution (ADR-104, shipped by TASK-007) REUSE** for agent-task-routing · **VAR-1 Variance Adjuster REUSE** for confidence calibration · **ADR-073 classifyApprovalBand REUSE** for reschedule AND routing gates (no new "agent decides" mechanism). External: Vikunja/Planka AGPL + Focalboard dead = REJECT embed, patterns only.

## Top risks

Second-queue creep · plausibly-done · methodology bloat · ledger drift · vocabulary regression (Initiative/Outcome/Goal all types a later session must not revive — ADR-106 records why) · **restructure corruption (NEW — path/parent_task_id partial-write hazard, mitigated by atomic subtree recompute)** · agent overreach (reschedule/routing band widening — blocked by system gate) · **routing starvation/skew (NEW — no-default risks silent stall OR silent skew to one Agent; mitigated by explicit-Human escalation + Agent-mix metric, not just pass/fail)**.

## Local preview

`/task-manager` now reads the canonical Task API. Shared View Grammar supplies Table/Form/Tree and Record Detail is `/task-manager/:taskId`. `/pending-work` redirects; generated `docs/TASKS.md` data no longer backs the Module. Real-data empty state remains when no API/rows exist. Module Detail, Files, Graph, Calendar-eligible date fields, Agents→Skills, Automations, and recent Runs come from the installed signed manifest.

Recertification: drift detector now creates a UUID pipeline proposal from an attributable Internal Strategist Automation Run. Human approve/edit/veto drives File-hash CAS, Task-version CAS, deterministic re-emit, and Event/Result/File/Run evidence. Completed-bay sweep uses Governance Agent plus the same pipeline. Commons root install preserves exact signed source in `commons_source`; built-in and registry manifests share one normalizer.

Durable Local Plane: file-backed mode uses Drizzle/PGlite Automation registry, Run recorder, and Module store. Run + signed source + promotion survive restart. Module installation identity = UUID; legacy text ID maps to stable ledger UUID. Projection writes only semantic changes. Unchanged done Task keeps version/time/evidence. Root swaps resolve parent from projected path.

External proof: Corporate runtime A→B kept proposal + Run. Physical File edits reconciled. `1.0.2`→signed `1.0.3` installed, approved, promoted, restarted. Cap + age sweep passed. Real Corporate coding Task stayed evidenced/done. Skill routing picked Internal Strategist only. Ambiguous/no match stopped for Human. Full artifact: Corporate-training-sims `docs/verification/task-manager-bridge-certification.md` at merge `f3443acc`.
