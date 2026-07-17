---
title: Task Manager Module Plan — Design, Business, and Technical
type: raw
doc_kind: plan
status: proposed
companions: [brd-taskmanager-2026-07.md, initiatives-taskade-research.md, productivity-app-research-2026.md, calendar-module-plan-2026-07.md, agent-goal-skill-orchestration-plan-2026-07.md, ui-architecture-rules-2026-07.md, clean-room-capability-research-protocol-2026-07.md]
related_wiki: ../wiki/taskmanager.md
updated: 2026-07-16
tags: [taskmanager, module, goals, tasks, planning, playbooks, agents, skills, automations, ledger, agent-first]
---

# 0. Product decision

Task Manager is one installable Module (left-nav item, manifest-driven Module Detail per AP-021) that owns the **single execution queue** of a workspace and the one strategic anchor above it (Goal → self-referential Task tree, dot-path leveled). It is governed by the Universal Action Pipeline — **not a project-management product clone, and never a second execution pathway.** The execution layer (Task → Action → Evidence → Verification) rides the existing Request→Plan→Decision→Run→Action→Event→Result canon; the Module adds the two strategy/planning Databases, the queue surface, planning Playbooks, and the ledger-file contract.

Load-bearing reframe vs standalone task apps: the queue is **a governed Database with an agent-first read contract**, and the markdown `tasks.md` file that coding agents consume in any repository is a **projection of that Database, not a separate store**. Adding a consumer (a repo agent, a Human surface, a stand-up brief) never adds a queue.

Provenance: this productizes a system already proven twice — Bridge's own `docs/TASKS.md` + Task Manager UI (AP-024/AP-025: one reconciled queue, stable TASK-nnn IDs, prototype tests, evidence attachment, read-budget layout) and the user's game-designs repository which independently converged on the identical format (single tasks.md, exit tests, WIP-1, recently-completed bay with a hard cap enforced by a check script). The 2026-06 Taskade research verdict also binds: one canonical hierarchy with many stateless view projections; agent decomposition flows through the pipeline as draft-then-approve; no CRDT machinery; no universal-entity table.

**2026-07-16 revision**: collapsed from four Record types to two. `Initiative` stays a retired kernel identifier (AP-020) — a `status: candidate` Task carries the identical meaning without reviving a migrated-away word. `Outcome` is a structured field (`outcomes[]`) on Goal and Task, not a Relation-bearing type. The Task tree is self-referential with a materialized dot-notation `path` (e.g. `2.3.5` = 5th child of the 3rd child of the 2nd root Task) — this is the same adjacency-list-tree pattern the 2026-06 Taskade research already blessed for Touchpoints, generalized with path-based leveling, not the rejected cross-domain "universal entity" table (one type, one Database, one RLS policy — not a polymorphic blob spanning Person/Deal/Task together).

```yaml
navigation_layers:
  global_sidebar:
    item: Task Manager
    purpose: enter the queue + strategy surfaces (installed Module, clickable per AP-021)
  pages:                       # data-shape → surface per ui-architecture canon
    - Queue        # tasks Database — the landing Page; ordered table/board/tree views, candidate filter
    - Goals        # goals Database with outcomes[] fields
  views: [table, board, form, timeline, tree]   # standard View Grammar + tree (path-ordered); all stateless projections
  object_navigation:
    form: Record Detail for every Goal/Task
    purpose: keep exit test, evidence Relations, dependencies, approvals, and Runs attached to the one Record
```

# 1. Design lens — exact information architecture

## 1.1 Queue Page (landing)

Ordered task table, hot-head first: in-progress block, then pending in canonical order, then a capped "Recently completed" bay at the bottom (never eats the read budget). Standard table toolbar/context menu (shared column/toggle menu, Control Panel in 3-dots), plus a **level/path column** (`2.3.5` style) and a candidate-filter toggle so compare-before-commit sets (former "Initiatives") are one filter, not a separate Page. Row click → Task Record Detail. Honest empty state until real Goals/Tasks exist — never seeded sample projects.

## 1.2 Task Record Detail

```yaml
task_record_detail:
  header: [dot-path stable id, title, status (incl. candidate/committed), priority, owner, WIP indicator]
  sections:
    - outcomes: one or more structured results {title, measure, target, current, indicator_kind} — not an activity list
    - exit_test: the fastest honest test that can disprove completion (required before in-progress)
    - scope: links to defining plans/specs (links, not inline prose)
    - evidence: Relations to Events/Results/Files/Records; verification record when exit test passed
    - graph: serves_goal_id (resolved Goal), depends_on, blocked_by, parent_task_id/children
    - governance: requests fulfilled, approval refs, review mode; Runs section (Agent Runs that touched this Task); assigned Agent (routing §3.1)
```

A candidate-status root or branch Task is compared against its siblings in a table view before commitment — discovery before scope (Design Thinking playbook) — with no separate Page or Record type.

## 1.3 Goals Page

Goals with horizon + optional anchor (BHAG) flag; each Goal's `outcomes[]` as measurable rows (target, current, leading/lagging indicators, optional North Star flag). Review-cadence state visible (last reviewed, next review). Goal Record Detail shows every Task tree that serves it (one Goal, many candidate/committed root Tasks).

## 1.4 Planning surfaces are proposals

Every Agent-produced plan artifact (decomposition, ordering change, sweep, candidate-Task set, reschedule) renders as a **draft proposal review** — approve | edit | veto — before any Record commits. No live-merge editing; matches the locked Taskade-research verdict. §3.1 defines which proposals may graduate to system-gated auto-apply.

## 1.5 Files Section + ledger projection

Module Files under `~/Documents/Bridge/<Organization>/Task Manager/`; the flagship File is the projected `tasks.md` ledger (per linked repository/workspace). The projection carries the read-budget header ("read in-progress + first three pending, nothing further"), stable IDs, and the recently-completed bay — byte-format compatible with what Bridge's own repo and the game-designs repo already use.

# 2. Business lens

## 2.1 Processes covered

```yaml
covered_processes:
  strategy:
    - Goal capture (incl. one anchor goal), measurable Outcome definition, periodic review cadence
  planning:
    - Initiative generation + comparison; stakeholder/dependency/risk identification; pre-mortem + scenario pass
    - methodology Playbooks (OKR, GTD, SMARTER, PACT, backward planning, story mapping, rolling wave, design-thinking discovery) applied as governed drafts
    - decomposition into Tasks with exit tests, owners, priorities, dependencies, dot-notation level
    - candidate-Task generation + compare-before-commit at any level (what "Initiative" used to name)
  execution:
    - one ordered queue; WIP limit; blocked-state surfacing; dependency-aware "next up"
    - evidence attachment; exit-test verification before done sticks; capped completed bay + archive sweep
    - impact-and-fit pass on every new Task/Goal (where it sits, proposed resequence) before it settles into the queue
    - deterministic agent-task routing (default Capability Builder; cross-Module by required Skill)
    - confidence-graduated approval gate for human-assigned reschedule proposals (system-gated minor auto-apply once calibrated; significant always approved)
  agent_first:
    - tasks.md projection emit/ingest for external repos + coding agents; drift detection
    - reconciliation-first intake from chat/Signals/evidence; duplicate proposals, never auto-merge
  cadence:
    - "what just landed" orientation brief; stand-up/weekly queue brief; goal-review prompts
    - habit scaffolding: recurring Tasks / Scheduled Automations beneath goals
  proactive_value:
    - Internal Strategist scans cross-Module platform data on a schedule, proposes new value-adding Goals/Tasks as candidate drafts
```

## 2.2 Explicitly not covered

```yaml
not_covered_or_not_authoritative:
  - second queues (bug/decision/request ledgers stay evidence + audit)
  - time tracking, billing, capacity/resource planning, gantt resourcing
  - autonomous task execution or auto-done without exit-test evidence
  - auto-merge of suspected duplicates (proposal only)
  - embedding PM products (Vikunja AGPL, Planka AGPL/CC-BY-NC, Focalboard archived — patterns only)
  - new kernel primitives or a parallel pipeline (execution layer = existing pipeline canon)
  - engagement mechanics (streaks, points)
```

# 3. Technical lens

## 3.1 Agents

No new permanent Agents. The permanent roster (AP-023: Chief of Staff, Learning, Internal Strategist, Governance, Capability Builder) covers every Task Manager job:

```yaml
taskmanager_agents:
  Internal_Strategist:   # primary planning brain
    - applies methodology Playbooks: goal→outcomes framing, candidate-Task generation, decomposition, pre-mortem, sequencing proposals
    - owns impact-and-fit analysis on every new Task/Goal; owns the proactive cross-Module opportunity scan
  Chief_of_Staff:
    - queue orientation ("what next / what landed"), stand-up briefs, WIP coaching, intake routing
  Learning_Agent:
    - observes evidence (Signals, corrections, reopened tasks, human approve/veto history on reschedule proposals) → proposes intake candidates, playbook improvements, and confidence-calibration updates
  Governance_Agent:
    - explains guard outcomes (bay cap, WIP breach, unverified done, reschedule band); deterministic controls decide, agent explains
  Capability_Builder:   # default executor for agent-assigned Tasks in this Module
    - drafts the code/capability change a routed Task specifies; cannot activate its own output (existing constraint, unchanged)
  future_optional: []    # none anticipated; any later archetype is package-provided and governed
```

## 3.2 Skills

Skills bind Goals/Tasks and are invoked only by eligible assigned Agents (AP-023); each carries typed IO, permissions, plane scope, risk, budget, tests.

```yaml
skills:
  - goal-outcome-framing          # Goal → outcomes[]; SMARTER/PACT/BHAG/North-Star framing per Playbook
  - candidate-task-generation     # Goal or parent Task → candidate (status=candidate) Task options w/ stakeholders, dependencies, risks — what "initiative-generation" named
  - premortem-scenario            # assume failure, derive causes/mitigations; scenario pass before commitment
  - task-decomposition            # Task → child Tasks with exit tests + dot-path level; methodology-parameterized (GTD clarify, story mapping, backward-from-deadline, rolling wave)
  - exit-test-authoring           # outcome → fastest honest disprove test (the single most load-bearing skill)
  - task-reconciliation           # intake: search same outcome/root-cause/exit-test first; attach or propose duplicate-merge
  - queue-sequencing              # dependency- and priority-aware order proposal; WIP-limit aware; maintains materialized path on reorder/move
  - impact-fit-analysis           # NEW: on every Task/Goal create — where it sits vs. existing work, proposed resequence, dependency check
  - agent-task-routing            # NEW: resolve executor for an agent-assigned Task — default Capability Builder in this Module; else the eligible Agent owning the Task's required Skill (cross-Module)
  - reschedule-confidence-calibration  # NEW: Variance-Adjuster-style — tunes a confidence policy_param off vetted human approve/veto history on reschedule proposals; feeds the system-gated auto-apply band (§3.1/ADR-073 pattern, not agent judgment)
  - proactive-opportunity-scan     # NEW: Internal Strategist analyzes cross-Module data (evidence, Signals, stale/idle areas) → proposes candidate Goals/Tasks that add user value
  - ledger-projection              # tasks/goals Database ⇄ tasks.md markdown contract (emit + parse + diff)
  - evidence-verification          # check exit-test evidence before done sticks; produce verification record
  - progress-synthesis             # "what just landed" brief; stand-up/weekly summary from Events, links not prose
  - habit-scaffolding              # goal → recurring Task / Scheduled Automation proposals (Atomic Habits pattern)
```

All Skills emit **drafts through the pipeline**; none writes Records directly. `exit-test-authoring` and `evidence-verification` are deliberately separate Skills so authoring and checking never share one prompt context. `reschedule-confidence-calibration` computes a *parameter*, not a decision — the decision to auto-apply is a system/router gate (§3.3), matching ADR-073's "kernel decides, agent explains" invariant exactly; the agent-floor DENY on self-approval is never touched.

## 3.3 Automations

Automations start governed Agent Runs (never invoke Skills directly); each carries trigger, idempotency key, budget, retry/backoff, owner, stop condition, risk band, immutable run record.

```yaml
automations:
  - task-created-impact-analysis  # NEW: on Task/Goal create → Internal Strategist runs task-reconciliation + impact-fit-analysis + queue-sequencing; proposes placement/resequence
  - agent-task-routing-on-assign  # NEW: on Task assigned to an Agent → agent-task-routing resolves executor; Capability Builder default, else Skill-eligible Agent
  - reschedule-approval-gate      # NEW: human-assigned reschedule proposals classified minor|significant by a deterministic band (ADR-073 pattern, reused not reinvented); minor auto-applies only once reschedule-confidence-calibration reports sufficient calibration on THAT human's history; significant always → human approval; agent never self-approves
  - proactive-scan-cadence        # NEW: scheduled Internal Strategist proactive-opportunity-scan run → candidate Goals/Tasks
  - completed-bay-sweep           # bay > cap OR entry older than age limit → archive-sweep proposal (the CI-guard generalized)
  - wip-breach-detector           # >1 in-progress per actor → surfaced flag; never auto-pauses work
  - unverified-done-challenger    # done without verification record → reopen proposal + evidence request
  - dependency-unblock-notifier   # blocking task done → surfaces newly-ready task at queue head
  - ledger-drift-detector         # projected tasks.md diverges from Database → reconciliation proposal (no silent overwrite either direction)
  - stale-task-review             # in-progress with no Events for N days → nudge/replan prompt
  - goal-review-cadence           # scheduled: review prompt per Goal (SMARTER Evaluated/Reviewed); rolling-wave re-plan for far-horizon candidate Tasks
  - standup-brief                 # scheduled: progress-synthesis run → daily/weekly brief
```

Guards are Automations, not conventions: the completed-bay cap, drift detection, and the reschedule approval band **cannot be forgotten or quietly widened**, matching the `scripts/check-docs.mjs` CI-guard insight and ADR-073's system-gate precedent.

## 3.4 Integrations / cross-module

- **ledger file**: `tasks.md` projection under Module Files + optional per-repository sync target (local plane; file IO only, no egress);
- **Calendar**: Tasks with dates and candidate/committed Task timeline spans render on the existing Calendar projection (CAL3 adapters — no new surface);
- **Relationship**: owners/stakeholders as Person-graph refs (whitelisted cross-plane edge only);
- **Second Brain**: Goal/Task nodes + serves/depends_on Relations appear in the cross-Module graph UI;
- **DealPilot/JobPilot/game-designs**: domain Modules keep their own Records; work items they spawn live in the one queue with a `serves_goal_id`/ancestry link back; a DealPilot-originated agent Task routes to its owning Agent per `agent-task-routing`, not blindly to Builder;
- **Commons (later)**: Module + methodology Playbooks publishable as signed capabilities; no personal data leaves.

# 4. Reuse-first source map

```yaml
reuse_verdicts:
  internal_first:
    docs_tasks_system: docs/TASKS.md format + operating standard (AP-024/025) — ADOPT as the ledger contract v1
    task_manager_ui: existing Task Manager UI consuming TASKS.md — EVOLVE into the Module's Queue Page
    touchpoint_tree: existing relational work-node tree ("Taskade tree") + Initiatives schema — MIGRATE under VOCAB2 into the single tasks Database (adjacency list `parent_task_id` + materialized `path`), collapsing the former separate Initiatives/Outcomes schema into `status` + `outcomes[]` fields on the same type
    variance_adjuster: existing VAR-1 bounded governed nudge (ADR-073 family) — REUSE the mechanism for reschedule-confidence-calibration rather than building a new tuner
    governance_band_gate: existing classifyApprovalBand SYSTEM gate (ADR-073) — REUSE for reschedule-approval-gate; no new "agent decides" mechanism
    pipeline: Request→Plan→Decision→Run→Action→Event→Result — REUSE as the entire execution layer
    view_grammar: table/board/form/timeline — REUSE; board/timeline are stateless projections
  external:
    methodologies: OKR/GTD/SMARTER/PACT/BHAG/pre-mortem/story-mapping/rolling-wave/backward/design-thinking/Atomic-Habits — public-domain concepts; encode as Bridge-authored Playbooks (no protected prose/templates copied; GTD/Atomic Habits are trademarked book brands — name the technique, never copy the text)
    pm_products: Linear/Jira/Todoist/Things — patterns only (stable IDs, one queue, keyboard-speed); no embeddable code
    oss_pm: Vikunja (AGPL), Planka (AGPL/commercial), Focalboard (archived 2024) — REJECT embed (copyleft/dead); Taskade research 2026-06 already interrogated and mapped — verdict stands
    markdown_task_formats: CommonMark + GFM task-list syntax — ADOPT for the ledger projection; no library needed beyond existing md tooling
  clean_room: not triggered — no license-limited source is being rebuilt; if a Playbook ever adapts a licensed template, AP-008 protocol applies first
```

# 5. Data and capability model

**Two Databases, not four** (2026-07-16 revision — see BRD §5 for the full reasoning). `Initiative` stays retired (AP-020); `status: candidate` on a Task carries its meaning. `Outcome` is a field on Goal and Task, never a Relation-bearing type.

```yaml
databases:            # Module Databases; Operational/local plane; RLS + visibility like all Module data
  goals: {fields: [title, description, horizon, anchor(bool), outcomes(jsonb[]: {title,measure,target,current,indicator_kind(leading|lagging),north_star(bool)}), status, owner, review_cadence, last_reviewed, visibility]}
  tasks: {fields: [
      path(materialized dot-notation, e.g. "2.3.5", auto-maintained on create/move/reorder),
      level(int, derived from path depth),
      title, outcomes(jsonb[]: same shape as goals.outcomes),
      exit_test,
      status(candidate|committed|pending|in_progress|blocked|done|parked|abandoned|archived),
      priority, owner(human_ref|agent_ref), assigned_agent(resolved by agent-task-routing when owner=agent),
      parent_task_id, serves_goal_id(direct ref; if unset, resolved by walking parent_task_id to the nearest ancestor that sets it),
      verification, visibility
    ]}
relations:
  - depends_on      # task→task
  - blocked_by      # task→{task|record|approval}
  - evidence        # task→{event|result|file|record}, many, with provenance
ledger_contract:      # tasks.md projection — one file per linked workspace/repo
  header: read-budget rule (in-progress + first N pending)
  entry: "## <path> — title" + Status/Priority/Outcomes/Exit test/Scope/Evidence/Dependencies lines; a legacy top-level ledger (like Bridge's own docs/TASKS.md, which predates this Module and uses stable TASK-nnn ids) maps its counter onto root-level path segments (TASK-014 ≈ path "14") for the TM2 dogfood check — byte-compatibility is about the surrounding contract shape (header/sections/bay), not forcing every existing TASK-nnn id to be renumbered
  bay: "Recently completed" capped (default 10 entries / 7 days) → archive file
  invariants: [Database is source of truth, projection is derived, ingest = reconciliation proposal never silent overwrite]
```

Invariants:

- one queue per workspace; board/timeline/tree/briefs are stateless projections — no view stores its own tree;
- one Task type is self-referential (adjacency list `parent_task_id` + materialized `path`) — the same pattern the Taskade research already blessed for Touchpoints, not the rejected cross-domain universal-entity table (one type, one Database, one RLS policy set, never a polymorphic blob spanning unrelated domains);
- every Task has an exit test before it may enter in-progress; done requires a verification record or a challenger fires;
- Agent writes are pipeline proposals (draft-then-approve), agent-floor DENY intact; Automations only start Agent Runs; the reschedule auto-apply band is a system/router gate (ADR-073 pattern), never the agent's own judgment;
- an agent-assigned Task's executor defaults to Capability Builder in this Module; a Task whose required Skill belongs to a different eligible Agent (cross-Module) routes there instead — Builder never invokes a Skill it doesn't own;
- glossary Goal/Task definitions are reused verbatim; no retired kernel identifier (`Initiative` included) returns to any namespace, kernel or Module (ADR-099 revised 2026-07-16);
- no dummy data: empty workspace shows honest empty states + an offer to run goal-outcome-framing.

# 6. Delivery sequence

Universal exit gate per slice: manifest risk record, tests, browser evidence for changed surfaces, no dummy runtime data, provenance/citation audit, and the blast-radius scan.

```yaml
slices:
  TM0:
    goal: the graph exists — schema + vocabulary settled
    deliverables:
      - goals/tasks Databases (two, not four) + depends_on/blocked_by/evidence Relations (migration)
      - Module manifest (Pages, Agents+Skills listing, Automations, Files) registered; ADR-099 vocabulary call recorded (revised 2026-07-16: Initiative stays retired, no Outcome type)
      - migration path from existing initiatives/touchpoints data under VOCAB2 into the single tasks Database (adjacency list + materialized path; no parallel old tree left live)
    exit_criteria:
      - a real Goal→Task chain (including a multi-level Task tree) persists and reads back with correct dot-path values (no orphan layer)
      - retired identifiers, `Initiative` included, absent from new schema/API names (vocab lint green)
  TM1:
    goal: the queue surface — a Human can run a workspace on it
    depends_on: [TM0]
    deliverables:
      - Queue landing Page (ordered table, hot head, completed bay, path/level column, candidate filter), Goals Page, standard views incl. Form + Tree
      - Task/Goal Record Detail per §1.2–1.4; WIP indicator; honest empty states
    exit_criteria:
      - exact prototype test: create a Goal with outcomes[], add a 3-level Task tree (paths e.g. `1`, `1.1`, `1.1.1`) with exit tests, reorder (path updates), block one on another, complete one with attached evidence — all via UI at desktop + 375px; no inert interactive rows
  TM2:
    goal: agent-first ledger contract — external agents consume the same queue
    depends_on: [TM1]
    deliverables:
      - ledger-projection Skill (emit + ingest tasks.md keyed on path), Files Section wiring, ledger-drift-detector Automation
      - Bridge repo dogfood: docs/TASKS.md validates against the contract (byte-format compatibility check)
    exit_criteria:
      - round-trip: edit tasks.md externally → drift detected → reconciliation proposal → approve → Database updated (and reverse); no silent overwrite in either direction (negative test)
      - a fresh agent orients from the projection reading only the hot head (measured ≤ ~2k tokens)
  TM3:
    goal: planning intelligence — Playbooks propose, humans decide
    depends_on: [TM1]
    deliverables:
      - goal-outcome-framing, candidate-task-generation, task-decomposition, exit-test-authoring, premortem-scenario, task-reconciliation, queue-sequencing, impact-fit-analysis Skills via Internal Strategist
      - Playbook library v1 (OKR, backward planning, GTD clarify, SMARTER, pre-mortem) as versioned governed configs
      - proposal-review surface for plan drafts (approve|edit|veto)
      - task-created-impact-analysis Automation wired to run on every real Task/Goal create
    exit_criteria:
      - a raw Goal produces a reviewable decomposition draft with exit tests; nothing commits before approval (pipeline halt verified)
      - reconciliation catches a deliberately duplicated outcome at intake and attaches instead of creating (negative test)
      - creating a new Task against a populated queue produces an impact-fit-analysis proposal (placement + resequence) before it settles (negative test: silent insert never happens)
  TM4:
    goal: guards + routing + calibrated reschedule enforced by machinery — the system cannot rot or overreach
    depends_on: [TM2, TM3]
    deliverables:
      - completed-bay-sweep, wip-breach-detector, unverified-done-challenger, dependency-unblock-notifier, stale-task-review, goal-review-cadence, standup-brief Automations
      - agent-task-routing Skill + agent-task-routing-on-assign Automation (Capability Builder default; Skill-eligible Agent for cross-Module)
      - reschedule-confidence-calibration Skill + reschedule-approval-gate Automation, reusing the ADR-073 classifyApprovalBand system-gate pattern
    exit_criteria:
      - bay stuffed past cap → sweep proposal fires (never silent archive); done-without-evidence → challenger reopens; blocking task completed → dependent surfaces at queue head (all as tests)
      - an agent-assigned Task in this Module routes to Capability Builder by default; a cross-Module Task with a Skill owned by a different eligible Agent routes there instead (negative test: Builder invoked outside its Skill scope never happens)
      - a human reschedule proposal starts requiring approval every time; after N observed approvals with no vetoes, a minor-banded reschedule auto-applies via the system gate while a significant-banded one still requires approval (both paths tested; agent never self-approves)
  TM5:
    goal: graph payoff — strategy visible across Modules + proactive value + first real external instance certified
    depends_on: [TM4]
    deliverables:
      - Calendar adapters (task dates, Task-tree spans) via CAL3 contract; Second Brain nodes/edges; Person-ref owners/stakeholders
      - proactive-opportunity-scan Skill + proactive-scan-cadence Automation (Internal Strategist proposes candidate Goals/Tasks from cross-Module evidence)
      - game-designs workspace live: goals/tasks migrated, repo tasks.md linked via TM2 contract
    exit_criteria:
      - game-designs certification: its coding agent works a full task (orient → execute → evidence → done → sweep) against the Bridge-projected ledger with zero duplicate-queue artifacts
      - a Task's Goal path renders in Second Brain; task dates appear on Calendar with zero renderer changes
      - a scheduled proactive scan against real cross-Module data produces at least one honest candidate proposal (or an honest "nothing found" — never a fabricated one)
  TM6:
    goal: Commons packaging — the system others install
    depends_on: [TM5, Commons publish path (TASK-004 line)]
    deliverables:
      - Module + Playbooks as signed Commons capabilities; per-repo agent-ledger template; docs
    exit_criteria:
      - fresh Organization installs from Commons and reaches TM1's prototype test with no personal data crossing to Commons (audited)
```

## 6.1 Success measures

```yaml
metrics:
  queue_integrity: duplicate-task creation rate ~0; parallel-queue recurrence 0; order-adherence (work pulled = head)
  honesty: unverified-done challenger catches / escapes (escapes target 0 — each escape becomes a permanent test)
  context: hot-head orientation cost (tokens) p95; sweep-cap violations 0
  planning: % committed (former-Initiative) candidate Tasks with pre-mortem + measurable outcomes[]; goal reviews executed on cadence
  routing: agent-task misroute rate (Builder invoked outside its Skill scope) target 0
  reschedule: proposals requiring approval vs. auto-applied post-calibration; false-auto-apply rate target 0; time-to-calibration per human
  proactive_value: candidate proposals from proactive-opportunity-scan accepted vs. dismissed (signal for scan quality, not a target ratio)
  governance: agent plan-writes bypassing proposals == 0 (hard invariant)
```

## 6.2 Risk register

```yaml
risks:
  second_queue_creep:
    risk: bug/idea/note ledgers quietly become queues again (the original failure that lost ~100 bugs)
    mitigation: intake rule + reconciliation Skill; evidence-only framing in UI (attach flows everywhere, no "add to bug queue" affordance); recurrence is a tracked metric
  plausibly_done:
    risk: tasks marked done on vibes; exit tests written to pass rather than disprove
    mitigation: exit-test authored at creation (required field), verification separate Skill/context, challenger Automation, escapes become permanent tests
  methodology_bloat:
    risk: 20 playbooks nobody uses; planning theater over execution
    mitigation: Playbook library v1 capped at 5; additions require observed demand (Learning Agent evidence); playbooks are versioned configs, cheap to park
  ledger_drift:
    risk: external tasks.md edits and Database writes fork the truth
    mitigation: Database = source of truth, projection derived; drift detector + reconciliation proposals; no silent overwrite either direction (tested)
  vocabulary_regression:
    risk: a future session re-adds an `Initiative` or `Outcome` Record type without checking this history, reviving the retired word
    mitigation: ADR-099 (revised 2026-07-16) records the collapse explicitly with the reasoning; vocab lint keeps `Initiative` out of all namespaces, not just kernel; TM0 migrates the legacy tree rather than paralleling it
  agent_overreach:
    risk: planning Skills start "helpfully" committing plans or merging duplicates; reschedule auto-apply drifts from minor into significant changes
    mitigation: all writes are pipeline proposals; auto-merge structurally absent; agent-floor DENY on destructive ops; reschedule auto-apply band is a deterministic system gate the agent cannot widen; negative tests in TM3/TM4 gates
  builder_misuse:
    risk: routing every agent-assigned Task to Capability Builder regardless of domain, forcing it outside its "creates/tests capability changes" scope
    mitigation: agent-task-routing Skill checks the Task's required Skill against eligible Agents first; Builder is the default/fallback, not an unconditional override; misroute rate tracked in §6.1
```

# 7. Disposition of the user's skill idea

Verdict: **relevant — adopted, restructured.** The submitted list (OKR, Design Thinking, story mapping, backward planning, rolling wave, SMARTER, BHAG, PACT, pre-mortem, North Star, Atomic Habits, GTD, initiatives breakdown, node ontology, three layers) is not ~20 Skills; it is:

- **one Playbook library** (methodology = versioned config consumed by the planning Skills §3.2 — capped at 5 in v1, extensible via Commons later);
- **the node ontology** → §5 data model, revised 2026-07-16 to two types (Goal + self-referential Task with materialized `path`) instead of four — id/title/type collapse into path/title/level, goal/outcome/initiative/task collapse into Goal + Task.status/outcomes[], the rest (status/priority/owner/depends_on/blocked_by/evidence/policy) map onto Databases + Relations + existing governance fields unchanged;
- **the three layers** → §5 layered model; the Execution layer (Task→Action→Evidence→Verification) already exists as the Universal Action Pipeline and is reused, not rebuilt.

What was cut and why: separate Skills per methodology (bloat — parameterize instead); "goal/outcome/initiative/task" as a `type` field on one *cross-domain* universal node table (rejected by the 2026-06 Taskade research — typed Databases keep per-type RLS/authority; this plan's single self-referential Task type is different — one domain, one Database, the same pattern already blessed for Touchpoints); Atomic Habits as a standalone surface (folded into habit-scaffolding Skill + Scheduled Automations); a persisted `Initiative`/`Outcome` Record type (2026-07-16 revision, per the user's direct pushback — see BRD §5).
