# 2026-07-16 — Task Manager Module: plan, BRD, and roadmap addition

## What was delivered

- **Module plan** — [docs/raw/taskmanager-module-plan-2026-07.md](../docs/raw/taskmanager-module-plan-2026-07.md): three-lens (design/business/technical) plan for a Task Manager Module owning the single governed execution queue per workspace plus one Goal anchor over a self-referential, dot-path-leveled Task tree. 14 Skills, 12 guard/routing/reschedule/scan Automations, zero new permanent Agents beyond the existing roster, reuse-first source map, data model, delivery slices TM0–TM6 with exit criteria, success metrics, and a risk register.
- **BRD** — [docs/raw/brd-taskmanager-2026-07.md](../docs/raw/brd-taskmanager-2026-07.md): agent-first business requirements; the five sub-2-minute answers; included/excluded scope; layered model; game-designs workspace + Bridge self-hosting as certifying use cases.
- **Wiki summary** — [docs/wiki/taskmanager.md](../docs/wiki/taskmanager.md); index updated.
- **Roadmap** — TASK-021 in [docs/TASKS.md](../docs/TASKS.md), placed immediately after TASK-014 (execution order + physical row). AP-030 then AP-031 APPLIED (user directives = approval). R-035/R-036 recorded. ADR-099 records the vocabulary call, revised same day.

## Key design calls

1. **Productize what already works.** Bridge's own `docs/TASKS.md` + Task Manager UI and the game-designs repo independently converged on the same ledger model — the Module generalizes it: stable dot-path IDs, one-or-more structured outcomes + a falsifiable exit test per task, reconciliation-first intake, WIP limit, read-budget hot head, capped recently-completed bay swept by an Automation (guards as machinery, not convention).
2. **`tasks.md` is a projection, never a second store.** The Database is the source of truth; the markdown ledger is emitted/ingested through a drift-detecting reconciliation contract so external coding agents in any repo consume the one canonical queue.
3. **Two Record types, not four (revised same day on user pushback).** The first draft kept `Outcome`/`Initiative` as Module Record types under the AP-021 domain-label carve-out. The user correctly challenged reviving `Initiative` — AP-020 retired it as a kernel identifier requiring migration, not a display-only rename — and proposed collapsing the whole strategy/planning stack into a pure Task hierarchy with dot-notation levels (`2.3.5`). Landed model: **Goal** (kept separate — a Goal is reviewed/revised, never "done," and one Goal can own many candidate Task-trees, which collapsing into "the root task" would lose) plus a **single self-referential Task type** with an auto-maintained materialized path, `status: candidate` carrying the old Initiative meaning at any level, and `outcomes[]` as a structured field on both types rather than a separate Relation-bearing type. This is the same pattern already blessed for the Touchpoint tree, not the previously-rejected cross-domain universal-entity table.
4. **Reuse governance machinery already shipped, don't invent new authority.** The reschedule confidence-ramp ("auto-apply minor changes once the agent learns the human's patterns, still ask for significant ones") reuses ADR-073's `classifyApprovalBand` system gate and the VAR-1 Variance-Adjuster pattern verbatim — the *system*, not the agent, decides the band; the agent-floor DENY on self-approval is untouched.
5. **Planning intelligence is governed.** Methodology Playbooks (OKR, backward planning, GTD clarify, SMARTER, pre-mortem — capped at 5 in v1) are versioned configs consumed by parameterized planning Skills; every decomposition/ordering/sweep/reschedule/candidate-Goal lands as a draft proposal (approve|edit|veto), matching the 2026-06 Taskade-research verdicts (no CRDT, no universal-entity table).

## New capabilities added on the user's follow-up

- **Impact-fit-analysis on every create** — Internal Strategist runs reconciliation + fit + resequencing on every new Task/Goal before it settles into the queue.
- **Deterministic agent-task routing** — agent-assigned Tasks default to Capability Builder in this Module; a cross-Module Task whose required Skill belongs to a different eligible Agent routes there instead (pushback recorded: Builder's glossary scope is capability/code changes, not a generic worker role — the default/fallback framing resolves the tension with the user's "all agent tasks → Builder" ask).
- **Proactive value scanning** — Internal Strategist scans cross-Module platform data on a schedule and proposes new value-adding Goals/Tasks as governed candidate drafts.

## Disposition of the submitted skill idea

Relevant — adopted, restructured: one Playbook library instead of ~20 Skills; the node ontology (id/title/type/status/priority/owner/depends_on/blocked_by/evidence/policy) maps onto two Databases + typed Relations + existing governance fields, with id/title/type simplified to path/title/level and goal/outcome/initiative/task simplified to Goal + Task.status/outcomes[]; the strategic/planning/execution layers map onto canon with the execution layer reused, not rebuilt.

## Way ahead

TASK-021 now sits immediately after TASK-014 in the queue, still behind the TASK-001→TASK-005 Avatar+Commons gate and its own TASK-012/TASK-014 dependencies. TM0 (two-Database schema + VOCAB2 tree migration) is the first slice; TM3/TM4 land the impact-fit, routing, and reschedule-gate machinery; TM5 certifies on the game-designs workspace; TM6 packages for Commons.
