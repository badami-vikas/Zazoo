---
title: Task Manager Module Plan — Design, Business, and Technical
type: raw
doc_kind: plan
status: active
companions: [brd-taskmanager-2026-07.md, initiatives-taskade-research.md, productivity-app-research-2026.md, calendar-module-plan-2026-07.md, agent-goal-skill-orchestration-plan-2026-07.md, ui-architecture-rules-2026-07.md, clean-room-capability-research-protocol-2026-07.md]
related_wiki: ../wiki/taskmanager.md
updated: 2026-07-21
tags: [taskmanager, module, tasks, planning, playbooks, agents, skills, automations, ledger, agent-first]
---

# 0. Product decision

Task Manager is one installable Module (left-nav item, manifest-driven Module Detail per AP-021) that owns the **single execution queue** of a workspace: **one self-referential Task type**, dot-path leveled, with no separate Goal/Outcome/Initiative Databases. It is governed by the Universal Action Pipeline — **not a project-management product clone, and never a second execution pathway.** The execution layer (Task → Action → Evidence → Verification) rides the existing Request→Plan→Decision→Run→Action→Event→Result canon; the Module adds one strategy/planning Database, the queue surface, planning Playbooks, and the ledger-file contract.

Load-bearing reframe vs standalone task apps: the queue is **a governed Database with an agent-first read contract**, and the markdown `tasks.md` file that coding agents consume in any repository is a **projection of that Database, not a separate store**. Adding a consumer (a repo agent, a Human surface, a stand-up brief) never adds a queue.

Provenance: this productizes a system already proven twice — Bridge's own `docs/TASKS.md` + Task Manager UI (AP-024/AP-025: one reconciled queue, stable TASK-nnn IDs, prototype tests, evidence attachment, read-budget layout) and the user's game-designs repository which independently converged on the identical format (single tasks.md, exit tests, WIP-1, recently-completed bay with a hard cap enforced by a check script). The 2026-06 Taskade research verdict also binds: one canonical hierarchy with many stateless view projections; agent decomposition flows through the pipeline as draft-then-approve; no CRDT machinery; no universal-entity table.

**2026-07-16 revision**: collapsed from four Record types to two (Goal + Task). `Initiative` stays a retired kernel identifier (AP-020); `Outcome` became a field.

**2026-07-17 revision (ADR-106, further collapse — user pushback again correct)**: collapsed the remaining two types to **one**. The user pointed out that a root-level Task already has branching structure and can own multiple candidate child-trees — nothing a separate "Goal" type adds structurally — and asked for full tree-surgery flexibility: an existing branch (`b.c.d`) must be able to gain a new ancestor above it (`a.b.c.d`, demoting the old root into a child), and a branch must be able to be promoted to a new root while its former ancestor is dropped (`b.c.d` → `c.d`, keeping `c`'s identity intact). A hard-typed Goal Database defeats exactly this: promoting/demoting a node would require migrating it between two tables. The fix: **`is_goal` is a boolean field on the one Task type**, not a type. It travels with the row through any re-parenting — insert-ancestor-above and promote-and-drop-ancestor are pure `parent_task_id`/`path` updates, never a type migration. "Goal" survives entirely as the canonical glossary *concept* (a durable, periodically-reviewed anchor), just no longer as separate storage.

```yaml
navigation_layers:
  global_sidebar:
    item: Task Manager
    purpose: enter the queue surface (installed Module, clickable per AP-021)
  pages:                       # data-shape → surface per ui-architecture canon
    - Queue        # the ONLY Page — one tasks Database; Goals is a saved filter (is_goal = true), not a second Page (same columns, per UI-architecture "same-columns→lists" rule)
  views: [table, board, form, timeline, tree]   # standard View Grammar + tree (path-ordered); all stateless projections
  object_navigation:
    form: Record Detail for every Task (goal-flagged or not)
    purpose: keep exit test, evidence Relations, dependencies, approvals, and Runs attached to the one Record
```

# 1. Design lens — exact information architecture

## 1.1 Queue Page (landing)

Ordered task table, hot-head first: in-progress block, then pending in canonical order, then a capped "Recently completed" bay at the bottom (never eats the read budget). Standard table toolbar/context menu (shared column/toggle menu, Control Panel in 3-dots), plus a **level/path column** (`2.3.5` style), a **Goal filter toggle** (`is_goal = true` — replaces the old separate Goals Page), and a candidate-filter toggle so compare-before-commit sets (former "Initiatives") are one filter too. Row click → Task Record Detail. Honest empty state until real Tasks exist — never seeded sample projects.

## 1.2 Task Record Detail

```yaml
task_record_detail:
  header: [dot-path stable id, title, status (incl. candidate/committed), priority, owner, is_goal badge if set, WIP indicator]
  sections:
    - outcomes: one or more structured results {title, measure, target, current, indicator_kind} — every Task carries this, not just goal-flagged ones
    - exit_test: the fastest honest test that can disprove completion (required before in-progress for non-goal-flagged Tasks; goal-flagged Tasks may instead carry a review_cadence — see §5)
    - scope: links to defining plans/specs (links, not inline prose)
    - evidence: Relations to Events/Results/Files/Records; verification record when exit test passed
    - graph: parent_task_id/children, depends_on, blocked_by, nearest-ancestor-or-self goal (resolved, not stored, unless a direct override is set)
    - governance: requests fulfilled, approval refs, review mode; Runs section (Agent Runs that touched this Task); assigned Agent (routing §3.1, resolved not defaulted)
    - restructure: promote (drop this node's parent, this subtree becomes a new root), insert-ancestor-above (wrap this node in a new parent), re-parent (move under a different existing node) — all proposals, §1.4
```

A candidate-status Task, at any level, is compared against its siblings in a table view before commitment — discovery before scope (Design Thinking playbook) — with no separate Page or Record type.

## 1.3 Goal-flagged Tasks

`is_goal` is a plain boolean any Human can set on any Task at any level — not a position, not a type. A goal-flagged Task typically (not necessarily) sits at or near a root, carries `outcomes[]` as measurable key results, and gets a `review_cadence`/`last_reviewed` pair the Queue's Goal filter surfaces. Its status is not required to reach `done` on a fixed exit test the way a leaf Task is — it may sit in an open-ended `in_progress`/`pending` state indefinitely, reviewed on cadence instead. Demoting a former root into a mid-tree child (§1.4) does not clear `is_goal`; it keeps behaving as a reviewed anchor exactly where it now sits — the real-world "sub-goal" case falls out for free.

## 1.4 Tree restructuring is a governed proposal, not free-form editing

Three operations, all draft-then-approve like everything else — never a silent live edit:

```yaml
restructure_operations:
  reorder:                # existing queue-sequencing scope, unchanged
    effect: sibling order changes; path segments recompute for the moved node and its subtree only
  promote:                 # "b.c.d becomes c.d" — drop an ancestor, this branch becomes a new root
    effect: parent_task_id cleared; path recomputed as a new root path; the dropped ancestor (if it has no other children) is proposed for archive, never auto-deleted; is_goal on the promoted node is untouched — flip it explicitly if it should now read as the tree's anchor
  insert_ancestor_above:   # "b.c.d becomes a.b.c.d" — wrap an existing node in a new parent
    effect: a new Task is created (or an existing detached one is chosen) as the new parent; the target node's parent_task_id repoints to it; path recomputed for the target and its whole subtree
  re_parent:                # move a subtree under a different existing node anywhere in the tree
    effect: parent_task_id repoints; path recomputed for the moved subtree; dependency/blocked_by edges are revalidated, never silently dropped
```

Every restructure recomputes `path` for the affected subtree only (an Automation, not manual entry — §3.3) and is logged as an Event so "why did this move" stays inspectable.

## 1.5 Planning surfaces are proposals

Every Agent-produced plan artifact (decomposition, ordering change, restructure, sweep, candidate-Task set, reschedule) renders as a **draft proposal review** — approve | edit | veto — before any Record commits. No live-merge editing; matches the locked Taskade-research verdict. §3.1 defines which proposals may graduate to system-gated auto-apply.

## 1.6 Reopening completed or archived work

Status is not one-directional. `done`, `archived`, and `parked` all accept a human-approved (or, once calibrated, system-gated minor) transition back to `pending`/`in_progress` — the ordinary "reopen" every task manager supports, triggered most often by a changed `outcomes[]` target or a changed exit test. This applies uniformly to every Task, goal-flagged or not, since there is only one type and one status graph (§5, §3.3 `target-change-reopen-prompt`).

## 1.7 Files Section + ledger projection

Module Files under `~/Documents/Bridge/<Organization>/Task Manager/`; the flagship File is the projected `tasks.md` ledger (per linked repository/workspace). The projection carries the read-budget header ("read in-progress + first three pending, nothing further"), stable IDs, and the recently-completed bay — byte-format compatible with what Bridge's own repo and the game-designs repo already use.

# 2. Business lens

## 2.1 Processes covered

```yaml
covered_processes:
  strategy:
    - goal-flagged Tasks: horizon, optional anchor (BHAG), one-or-more structured outcomes[], periodic review cadence
  planning:
    - candidate-Task generation + compare-before-commit at any level (what "Initiative" used to name)
    - methodology Playbooks (OKR, GTD, SMARTER, PACT, backward planning, story mapping, rolling wave, design-thinking discovery) applied as governed drafts
    - decomposition into Tasks with exit tests, owners, priorities, dependencies, dot-notation level
    - full tree restructuring — promote, insert-ancestor-above, re-parent — as governed proposals (§1.4)
  execution:
    - one ordered queue; WIP limit; blocked-state surfacing; dependency-aware "next up"
    - evidence attachment; exit-test verification before done sticks; capped completed bay + archive sweep
    - reopening done/archived/parked work on changed targets or explicit human intent
    - impact-and-fit pass on every new Task (where it sits, proposed resequence) before it settles into the queue
    - deterministic agent-task routing resolved by required Skill against eligible Agents — no default executor
    - confidence-graduated approval gate for human-assigned reschedule proposals (system-gated minor auto-apply once calibrated; significant always approved)
  agent_first:
    - tasks.md projection emit/ingest for external repos + coding agents; drift detection
    - reconciliation-first intake from chat/Signals/evidence; duplicate proposals, never auto-merge
  cadence:
    - "what just landed" orientation brief; stand-up/weekly queue brief; goal-review prompts
    - habit scaffolding: recurring Tasks / Scheduled Automations beneath goal-flagged Tasks
  proactive_value:
    - Internal Strategist scans cross-Module platform data on a schedule, proposes new value-adding Tasks (goal-flagged or not) as candidate drafts
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
  - silent restructuring: promote/insert-ancestor-above/re-parent are always proposals, never direct writes
```

# 3. Technical lens

## 3.1 Agents

No new permanent Agents. The permanent roster (AP-023: Chief of Staff, Learning, Internal Strategist, Governance, Capability Builder) covers every Task Manager job. **2026-07-17 revision**: agent-task routing moves from a hardcoded "Capability Builder default" to a Chief of Staff-owned resolution, and Capability Builder is just one of several possible eligible executors, never the fallback.

```yaml
taskmanager_agents:
  Chief_of_Staff:            # owns agent-task routing (2026-07-17 revision)
    - queue orientation ("what next / what landed"), stand-up briefs, WIP coaching, intake routing
    - agent-task-routing: resolves which Agent executes an agent-assigned Task — this is CoS's existing, glossary-defined role ("default coordinating Agent... its routing role is a product composition") and matches the shipped @mention dispatch pattern (chiefOfStaff.converse routes to Learning/Communications/Governance/Builder today); reused, not reinvented
  Internal_Strategist:        # planning + fit brain
    - applies methodology Playbooks: goal-outcome framing, candidate-Task generation, decomposition, pre-mortem, sequencing proposals
    - owns impact-and-fit analysis on every new Task; owns tree-restructure proposals (promote/insert-ancestor-above/re-parent are strategic placement calls, not dispatch); owns the proactive cross-Module opportunity scan
  Learning_Agent:
    - observes evidence (Signals, corrections, reopened tasks, human approve/veto history on reschedule AND routing proposals) → proposes intake candidates, playbook improvements, and confidence-calibration updates
  Governance_Agent:
    - explains guard outcomes (bay cap, WIP breach, unverified done, reschedule band, routing ambiguity); deterministic controls decide, agent explains
  Capability_Builder:         # one eligible executor among several, never a default
    - drafts the code/capability change when a Task's required Skill resolves to Capability Builder specifically; cannot activate its own output (existing constraint, unchanged)
  future_optional: []         # none anticipated; any later archetype is package-provided and governed
```

Why Chief of Staff and not Internal Strategist owns routing (ADR-107): routing answers "who executes," a dispatch/coordination question — CoS's defined mandate and existing shipped behavior. Impact-fit and restructuring answer "where does this sit and how should the tree look," a planning/strategy question — Internal Strategist's defined mandate. Splitting the two keeps each Agent inside its own glossary-defined scope instead of overloading one Agent with both jobs.

## 3.2 Skills

Skills bind to Tasks and are invoked only by eligible assigned Agents (AP-023, and — where it exists — the real `SkillManifest`/eligible-Agent resolution shipped under ADR-104); each carries typed IO, permissions, plane scope, risk, budget, tests.

```yaml
skills:
  - goal-outcome-framing          # any Task → outcomes[] + is_goal framing; SMARTER/PACT/BHAG/North-Star per Playbook (Internal Strategist)
  - candidate-task-generation     # parent Task → candidate (status=candidate) Task options w/ stakeholders, dependencies, risks — what "initiative-generation" named (Internal Strategist)
  - premortem-scenario            # assume failure, derive causes/mitigations; scenario pass before commitment (Internal Strategist)
  - task-decomposition            # Task → child Tasks with exit tests + dot-path level; methodology-parameterized (Internal Strategist)
  - task-tree-restructure         # NEW (2026-07-17): promote / insert-ancestor-above / re-parent proposals; recomputes path for the affected subtree only (Internal Strategist)
  - exit-test-authoring           # outcome → fastest honest disprove test (the single most load-bearing skill; Internal Strategist)
  - task-reconciliation           # intake: search same outcome/root-cause/exit-test first; attach or propose duplicate-merge (Internal Strategist)
  - queue-sequencing              # dependency- and priority-aware order proposal; WIP-limit aware; maintains materialized path on plain reorder (Internal Strategist)
  - impact-fit-analysis           # on every Task create — where it sits vs. existing work, proposed resequence, dependency check (Internal Strategist)
  - agent-task-routing            # UPDATED (2026-07-17): resolve executor for an agent-assigned Task by matching its required Skill against eligible Agents (real SkillManifest resolution where it exists, ADR-104); no default — ambiguous/no-match escalates to explicit Human assignment (Chief of Staff)
  - reschedule-confidence-calibration  # Variance-Adjuster-style — tunes a confidence policy_param off vetted human approve/veto history on reschedule AND routing proposals; feeds the system-gated auto-apply band (§3.3/ADR-073 pattern, not agent judgment; Learning Agent)
  - proactive-opportunity-scan     # Internal Strategist analyzes cross-Module data (evidence, Signals, stale/idle areas) → proposes candidate Tasks that add user value (Internal Strategist)
  - ledger-projection              # tasks Database ⇄ tasks.md markdown contract (emit + parse + diff; Internal Strategist)
  - evidence-verification          # check exit-test evidence before done sticks; produce verification record (Internal Strategist)
  - progress-synthesis             # "what just landed" brief; stand-up/weekly summary from Events, links not prose (Chief of Staff)
  - habit-scaffolding              # goal-flagged Task → recurring Task / Scheduled Automation proposals (Atomic Habits pattern; Chief of Staff)
```

All Skills emit **drafts through the pipeline**; none writes Records directly. `exit-test-authoring` and `evidence-verification` are deliberately separate Skills so authoring and checking never share one prompt context. `reschedule-confidence-calibration` computes a *parameter*, not a decision — the decision to auto-apply is a system/router gate (§3.3), matching ADR-073's "kernel decides, agent explains" invariant exactly; the agent-floor DENY on self-approval is never touched. The same calibration mechanism now also gates **routing** confidence, not just reschedule confidence (§3.3).

## 3.3 Automations

Automations start governed Agent Runs (never invoke Skills directly); each carries trigger, idempotency key, budget, retry/backoff, owner, stop condition, risk band, immutable run record.

```yaml
automations:
  - task-created-impact-analysis  # on Task create → Internal Strategist runs task-reconciliation + impact-fit-analysis + queue-sequencing; proposes placement/resequence
  - agent-task-routing-on-assign  # UPDATED: on Task assigned to an Agent → Chief of Staff's agent-task-routing resolves executor by required-Skill match; no default; ambiguous/no-match cases surface for explicit Human assignment instead of guessing
  - reschedule-approval-gate      # human-assigned reschedule proposals classified minor|significant by a deterministic band (ADR-073 pattern, reused not reinvented); minor auto-applies only once reschedule-confidence-calibration reports sufficient calibration on THAT human's history; significant always → human approval; agent never self-approves
  - routing-approval-gate         # NEW (2026-07-17): the same classifyApprovalBand-style gate applied to agent-task-routing decisions — every routing decision requires human approval at first; once reschedule-confidence-calibration (shared mechanism) observes enough approved routing decisions with no vetoes for a given Task pattern, minor/unambiguous routing auto-applies; ambiguous or cross-Module routing always requires approval
  - task-tree-restructure-proposal  # NEW: promote/insert-ancestor-above/re-parent requests become proposals; on approval, path recomputation runs as one atomic Automation over the affected subtree — never partial
  - target-change-reopen-prompt    # NEW: editing outcomes[] targets or the exit test on a done/archived/parked Task proposes reopening it to pending/in_progress
  - proactive-scan-cadence        # scheduled Internal Strategist proactive-opportunity-scan run → candidate Tasks
  - completed-bay-sweep           # bay > cap OR entry older than age limit → archive-sweep proposal (the CI-guard generalized)
  - wip-breach-detector           # >1 in-progress per actor → surfaced flag; never auto-pauses work
  - unverified-done-challenger    # done without verification record → reopen proposal + evidence request
  - dependency-unblock-notifier   # blocking task done → surfaces newly-ready task at queue head
  - ledger-drift-detector         # projected tasks.md diverges from Database → reconciliation proposal (no silent overwrite either direction)
  - stale-task-review             # in-progress with no Events for N days → nudge/replan prompt
  - goal-review-cadence           # scheduled: review prompt per goal-flagged Task (SMARTER Evaluated/Reviewed); rolling-wave re-plan for far-horizon candidate Tasks
  - standup-brief                 # scheduled: progress-synthesis run → daily/weekly brief
```

Guards are Automations, not conventions: the completed-bay cap, drift detection, and the reschedule/routing approval bands **cannot be forgotten or quietly widened**, matching the `scripts/check-docs.mjs` CI-guard insight and ADR-073's system-gate precedent.

## 3.4 Integrations / cross-module

- **ledger file**: `tasks.md` projection under Module Files + optional per-repository sync target (local plane; file IO only, no egress);
- **Calendar**: Tasks with dates and Task-tree spans render on the existing Calendar projection (CAL3 adapters — no new surface);
- **Relationship**: owners/stakeholders as Person-graph refs (whitelisted cross-plane edge only);
- **Second Brain**: Task nodes + depends_on/parent Relations appear in the cross-Module graph UI, goal-flagged Tasks visually distinguished;
- **DealPilot/JobPilot/game-designs**: domain Modules keep their own Records; work items they spawn live in the one queue with an ancestry link back; a DealPilot-originated agent Task routes to whichever Agent owns its required Skill via `agent-task-routing`, resolved dynamically — never a fixed default;
- **Commons (later)**: Module + methodology Playbooks publishable as signed capabilities; no personal data leaves.

# 4. Reuse-first source map

```yaml
reuse_verdicts:
  internal_first:
    docs_tasks_system: docs/TASKS.md format + operating standard (AP-024/025) — ADOPT as the ledger contract v1
    task_manager_ui: existing Task Manager UI (`platform/apps/web/src/app/pages/TaskManagerPage.tsx` + `PendingWorkPage.tsx`, live at `/task-manager`, already reading a generated projection of `docs/TASKS.md` with a Status column) — EVOLVE into the Module's Queue Page rather than rebuilt from scratch
    touchpoint_tree: existing relational work-node tree ("Taskade tree") + Initiatives schema — MIGRATE under VOCAB2 into the single tasks Database (adjacency list `parent_task_id` + materialized `path`), collapsing Goal/Outcome/Initiative entirely into `is_goal`/`outcomes[]`/`status` fields on the one type
    skill_manifest_agent_eligibility: existing `SkillManifest` + eligible-Agent resolution shipped under ADR-104 (TASK-007) — REUSE directly for `agent-task-routing` rather than inventing a second routing mechanism
    variance_adjuster: existing VAR-1 bounded governed nudge (ADR-073 family) — REUSE the mechanism for reschedule- and routing-confidence-calibration rather than building a new tuner
    governance_band_gate: existing classifyApprovalBand SYSTEM gate (ADR-073) — REUSE for reschedule-approval-gate and routing-approval-gate; no new "agent decides" mechanism
    pipeline: Request→Plan→Decision→Run→Action→Event→Result — REUSE as the entire execution layer
    view_grammar: table/board/form/timeline/tree — REUSE; all stateless projections
  external:
    methodologies: OKR/GTD/SMARTER/PACT/BHAG/pre-mortem/story-mapping/rolling-wave/backward/design-thinking/Atomic-Habits — public-domain concepts; encode as Bridge-authored Playbooks (no protected prose/templates copied; GTD/Atomic Habits are trademarked book brands — name the technique, never copy the text)
    pm_products: Linear/Jira/Todoist/Things — patterns only (stable IDs, one queue, keyboard-speed); no embeddable code
    oss_pm: Vikunja (AGPL), Planka (AGPL/commercial), Focalboard (archived 2024) — REJECT embed (copyleft/dead); Taskade research 2026-06 already interrogated and mapped — verdict stands
    markdown_task_formats: CommonMark + GFM task-list syntax — ADOPT for the ledger projection; no library needed beyond existing md tooling
  clean_room: not triggered — no license-limited source is being rebuilt; if a Playbook ever adapts a licensed template, AP-008 protocol applies first
```

# 5. Data and capability model

**One Database** (2026-07-17 revision — see BRD §5 and ADR-106 for the full reasoning). `Initiative` stays retired (AP-020); `status: candidate` on a Task carries its meaning. `Outcome` is a field. `Goal` is a boolean field (`is_goal`), not a type — this is what makes full tree restructuring (§1.4) possible without ever migrating a row between tables.

```yaml
databases:            # ONE Module Database; Operational/local plane; RLS + visibility like all Module data
  tasks: {fields: [
      path(materialized dot-notation, e.g. "2.3.5", auto-maintained on create/move/restructure — never hand-entered),
      level(int, derived from path depth),
      title,
      is_goal(bool, default true at creation for a root Task with no parent, false otherwise; independently settable by a Human at any time regardless of position),
      outcomes(jsonb[]: {title, measure, target, current, indicator_kind(leading|lagging), north_star(bool)}),
      anchor(bool, BHAG flag — meaningful mainly, not exclusively, when is_goal),
      review_cadence, last_reviewed(both nullable — populated when is_goal or when a Human wants periodic review on any node),
      exit_test(nullable — required before a non-goal-flagged Task may enter in_progress; optional for is_goal Tasks reviewed on cadence instead),
      status(candidate|committed|pending|in_progress|blocked|done|parked|abandoned|archived — one graph for every Task; done/archived/parked accept a reverse transition to pending/in_progress, §1.6),
      priority, owner(human_ref|agent_ref), assigned_agent(resolved by agent-task-routing when owner=agent; never defaulted),
      parent_task_id(nullable — null means root),
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

- one queue per workspace, one Task type; board/timeline/tree/briefs/Goal-filter are stateless projections — no view stores its own tree;
- the Task type is self-referential (adjacency list `parent_task_id` + materialized `path`) — the same pattern the Taskade research already blessed for Touchpoints, not the rejected cross-domain universal-entity table (one type, one Database, one RLS policy set, never a polymorphic blob spanning unrelated domains);
- `is_goal` is a plain field, never a type — promote / insert-ancestor-above / re-parent (§1.4) are pure `parent_task_id`/`path` updates and never require converting a row between tables;
- a non-goal-flagged Task needs an exit test before it may enter in-progress; done requires a verification record or a challenger fires; a goal-flagged Task may instead run on `review_cadence`;
- status is not one-directional: done/archived/parked accept a governed reverse transition to pending/in_progress (§1.6);
- Agent writes are pipeline proposals (draft-then-approve), agent-floor DENY intact; Automations only start Agent Runs; the reschedule and routing auto-apply bands are system/router gates (ADR-073 pattern), never the agent's own judgment;
- an agent-assigned Task's executor is resolved by matching its required Skill against eligible Agents (ADR-104 SkillManifest resolution where available) — there is no default executor; ambiguous or unmatched cases escalate to explicit Human assignment;
- glossary Goal/Task definitions are reused verbatim — Goal as a *concept* (durable, periodically reviewed anchor), not as separate storage; no retired kernel identifier (`Initiative` included) returns to any namespace, kernel or Module (ADR-106, superseding ADR-105's two-Database call);
- no dummy data: empty workspace shows honest empty states + an offer to run goal-outcome-framing.

# 6. Delivery sequence

Universal exit gate per slice: manifest risk record, tests, browser evidence for changed surfaces, no dummy runtime data, provenance/citation audit, and the blast-radius scan.

```yaml
slices:
  TM0:
    goal: the graph exists — schema + vocabulary settled
    deliverables:
      - one tasks Database (not two, not four) + depends_on/blocked_by/evidence Relations (migration)
      - Module manifest (Pages, Agents+Skills listing, Automations, Files) registered; ADR-106 vocabulary call recorded (2026-07-17: Goal collapses to an `is_goal` field, no separate Goal Database)
      - migration path from existing initiatives/touchpoints data under VOCAB2 into the single tasks Database (adjacency list + materialized path; no parallel old tree left live)
    exit_criteria:
      - a real multi-level Task tree (including at least one is_goal=true node with children) persists and reads back with correct dot-path values (no orphan layer)
      - retired identifiers, `Initiative` included, absent from new schema/API names (vocab lint green)
  TM1:
    goal: the queue surface — a Human can run a workspace on it
    depends_on: [TM0]
    deliverables:
      - Queue landing Page (ordered table, hot head, completed bay, path/level column, Goal filter, candidate filter), standard views incl. Form + Tree
      - Task Record Detail per §1.2–1.4; WIP indicator; honest empty states; restructure actions (promote/insert-ancestor-above/re-parent) surfaced as proposal triggers
    exit_criteria:
      - exact prototype test: create a goal-flagged Task with outcomes[], add a 3-level Task tree under it (paths e.g. `1`, `1.1`, `1.1.1`) with exit tests, reorder (path updates), promote `1.1.1` to a new root (path becomes e.g. `2`, old ancestor untouched), block one on another, complete one with attached evidence, reopen a done Task after editing its outcome target — all via UI at desktop + 375px; no inert interactive rows
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
      - goal-outcome-framing, candidate-task-generation, task-decomposition, task-tree-restructure, exit-test-authoring, premortem-scenario, task-reconciliation, queue-sequencing, impact-fit-analysis Skills via Internal Strategist
      - Playbook library v1 (OKR, backward planning, GTD clarify, SMARTER, pre-mortem) as versioned governed configs
      - proposal-review surface for plan drafts (approve|edit|veto)
      - task-created-impact-analysis + task-tree-restructure-proposal + target-change-reopen-prompt Automations wired to real Task events
    exit_criteria:
      - a raw goal-flagged Task produces a reviewable decomposition draft with exit tests; nothing commits before approval (pipeline halt verified)
      - reconciliation catches a deliberately duplicated outcome at intake and attaches instead of creating (negative test)
      - creating a new Task against a populated queue produces an impact-fit-analysis proposal (placement + resequence) before it settles (negative test: silent insert never happens)
      - promoting a subtree and inserting a new ancestor above an existing node both round-trip as approved proposals with correct path recomputation (negative test: no partial/inconsistent path state)
  TM4:
    goal: guards + routing + calibrated reschedule enforced by machinery — the system cannot rot or overreach
    depends_on: [TM2, TM3]
    deliverables:
      - completed-bay-sweep, wip-breach-detector, unverified-done-challenger, dependency-unblock-notifier, stale-task-review, goal-review-cadence, standup-brief Automations
      - agent-task-routing Skill (Chief of Staff) + agent-task-routing-on-assign + routing-approval-gate Automations — required-Skill match against eligible Agents, no default, human approval first-and-until-calibrated
      - reschedule-confidence-calibration Skill (shared for reschedule AND routing) + reschedule-approval-gate Automation, reusing the ADR-073 classifyApprovalBand system-gate pattern
    exit_criteria:
      - bay stuffed past cap → sweep proposal fires (never silent archive); done-without-evidence → challenger reopens; blocking task completed → dependent surfaces at queue head (all as tests)
      - an agent-assigned Task in this Module routes to whichever eligible Agent owns its required Skill (Capability Builder included only when the Task is genuinely a capability/code change); an ambiguous or cross-Module Task without a clean match escalates to Human assignment instead of guessing (negative test: no task silently defaults to any one Agent)
      - a human reschedule proposal and a human routing proposal both start requiring approval every time; after N observed approvals with no vetoes on a given pattern, a minor/unambiguous case auto-applies via the shared system gate while a significant or ambiguous case still requires approval (all paths tested; agent never self-approves)
  TM5:
    goal: graph payoff — strategy visible across Modules + proactive value + first real external instance certified
    depends_on: [TM4]
    deliverables:
      - Calendar adapters (task dates, Task-tree spans) via CAL3 contract; Second Brain nodes/edges; Person-ref owners/stakeholders
      - proactive-opportunity-scan Skill + proactive-scan-cadence Automation (Internal Strategist proposes candidate Tasks from cross-Module evidence)
      - Corporate-training-sims workspace live: tasks migrated (goal-flagged roots + trees), repo tasks.md linked via TM2 contract
    exit_criteria:
      - Corporate-training-sims certification: its coding agent works a full task (orient → execute → evidence → done → sweep) against the Bridge-projected ledger with zero duplicate-queue artifacts
      - a Task's resolved goal-ancestor renders in Second Brain; task dates appear on Calendar with zero renderer changes
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
  planning: % committed candidate Tasks with pre-mortem + measurable outcomes[]; goal-flagged Task reviews executed on cadence
  restructuring: promote/insert-ancestor-above/re-parent proposals with correct path recomputation (target 100%); orphaned-path incidents (target 0)
  routing: agent-task auto-apply precision post-calibration (false-auto-apply target 0); share of Tasks routed to Capability Builder specifically vs. other eligible Agents (should track the Task mix, not skew to one Agent by default)
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
    mitigation: exit-test authored at creation (required field for non-goal-flagged Tasks), verification separate Skill/context, challenger Automation, escapes become permanent tests
  methodology_bloat:
    risk: 20 playbooks nobody uses; planning theater over execution
    mitigation: Playbook library v1 capped at 5; additions require observed demand (Learning Agent evidence); playbooks are versioned configs, cheap to park
  ledger_drift:
    risk: external tasks.md edits and Database writes fork the truth
    mitigation: Database = source of truth, projection derived; drift detector + reconciliation proposals; no silent overwrite either direction (tested)
  vocabulary_regression:
    risk: a future session re-adds an `Initiative`, `Outcome`, or `Goal` Record type without checking this history, reviving retired words or re-fragmenting a deliberately unified model
    mitigation: ADR-106 records the full collapse explicitly with the reasoning; vocab lint keeps `Initiative` out of all namespaces; TM0 migrates the legacy tree rather than paralleling it
  restructure_corruption:
    risk: promote/insert-ancestor-above/re-parent leaves `path` inconsistent with `parent_task_id` for part of a subtree (a partial-write hazard unique to a self-referential, path-cached tree)
    mitigation: path recomputation runs as one atomic Automation over the whole affected subtree, never partial; every restructure is logged as an Event; TM3 exit criteria include a negative test for exactly this failure mode
  agent_overreach:
    risk: planning Skills start "helpfully" committing plans or merging duplicates; reschedule/routing auto-apply drifts from minor/unambiguous into significant/ambiguous changes
    mitigation: all writes are pipeline proposals; auto-merge structurally absent; agent-floor DENY on destructive ops; the reschedule/routing auto-apply bands are deterministic system gates the agent cannot widen; negative tests in TM3/TM4 gates
  routing_starvation_or_skew:
    risk: without a default, an unmatched Task's execution stalls, or the resolver quietly always resolves to the same Agent by construction (reintroducing the old Builder-default problem under a different name)
    mitigation: no-match/ambiguous cases escalate to explicit Human assignment (never silently stall or silently pick); §6.1 tracks the Agent-mix distribution, not just a pass/fail routing rate, so skew is visible even if every individual routing decision looked locally correct
```

# 7. Disposition of the user's skill idea

Verdict: **relevant — adopted, restructured, and further simplified on 2026-07-17 follow-up.** The submitted list (OKR, Design Thinking, story mapping, backward planning, rolling wave, SMARTER, BHAG, PACT, pre-mortem, North Star, Atomic Habits, GTD, initiatives breakdown, node ontology, three layers) is not ~20 Skills; it is:

- **one Playbook library** (methodology = versioned config consumed by the planning Skills §3.2 — capped at 5 in v1, extensible via Commons later);
- **the node ontology** → §5 data model, now ONE type (self-referential Task with materialized `path` and an `is_goal` field) instead of four or two — id/title/type collapse into path/title/level, goal/outcome/initiative/task collapse into one Task with `is_goal`/`outcomes[]`/`status`, the rest (priority/owner/depends_on/blocked_by/evidence/policy) map onto the one Database + Relations + existing governance fields unchanged;
- **the three layers** → §5 layered model, now expressed as one recursive structure with a flagged anchor rather than separate strategic/planning tiers; the Execution layer (Task→Action→Evidence→Verification) already exists as the Universal Action Pipeline and is reused, not rebuilt.

What was cut and why: separate Skills per methodology (bloat — parameterize instead); "goal/outcome/initiative/task" as a `type` field on one *cross-domain* universal node table (rejected by the 2026-06 Taskade research — typed Databases keep per-type RLS/authority; this plan's single self-referential Task type is different — one domain, one Database, the same pattern already blessed for Touchpoints); Atomic Habits as a standalone surface (folded into habit-scaffolding Skill + Scheduled Automations); a persisted `Initiative`/`Outcome` Record type (2026-07-16 revision); a persisted `Goal` Record type (2026-07-17 revision, per the user's second round of pushback — see BRD §5 and ADR-106); a default executor Agent for agent-assigned Tasks (2026-07-17 revision, ADR-107 — routing is now always resolved, never defaulted, and owned by Chief of Staff rather than Internal Strategist).
