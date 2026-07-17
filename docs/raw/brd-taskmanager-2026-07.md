---
title: Task Manager Business Requirements
type: raw
doc_kind: reference
status: proposed
companions: [taskmanager-module-plan-2026-07.md, initiatives-taskade-research.md, productivity-app-research-2026.md, agent-goal-skill-orchestration-plan-2026-07.md, ui-architecture-rules-2026-07.md]
related_wiki: ../wiki/taskmanager.md
updated: 2026-07-17
tags: [taskmanager, module, business-requirements, tasks, planning, agent-first, ledger]
---

# 1. Executive decision

Task Manager is one installable Module for governed goal and work management: **one self-referential Task type**, dot-path leveled, where a plain `is_goal` field — not a separate type — marks a Task as a durable, periodically-reviewed anchor. Candidate approaches, ordinary work, and subtasks are all the same Task type at different tree positions (see §5). It sequences one execution queue and verifies completion with evidence. It is one item in the global Modules list.

Task Manager must make five answers available to any accountable actor — Human or Agent — in under the cost of reading one screen (for a Human) or ~2k tokens (for an Agent):

1. What is in progress right now?
2. What should be picked up next, in what order?
3. What just landed, and what evidence proves it?
4. What is blocked, on what, and who owns the unblock?
5. Which goal-flagged Task does the current work serve, and is that anchor still on track?

Task Manager is **agent-first by design**: the primary consumer of the queue is as likely to be a coding or research Agent as a Human. Every design decision optimizes what an actor must read to act — stable IDs, a small hot head, links instead of inline prose, cold history out of the read path, and guards enforced by Automations rather than conventions in prose.

The design is already validated in production: Bridge's own repository runs on this exact model (`docs/TASKS.md` + the Task Manager UI, AP-024/AP-025), and the user's game-designs workspace independently converged on the same format. This Module generalizes that proven system into a governed, installable capability.

# 2. Business problem and intended outcomes

Work today fragments across duplicate queues (roadmaps, bug trackers, chat threads, doc TODO lists), each claiming to be "what to do next." Empirically this destroys work: duplicate tasks, ~100 lost bugs in one observed instance, "plausibly done" items that were never verified, and agents rereading whole histories to orient. Existing task managers optimize for human dashboards, not for the context economics of AI agents that now do a large share of execution.

Task Manager must:

- maintain exactly **one** "what do I do next" surface per workspace; every other artifact (bugs, decisions, requests, notes) demotes to evidence attached to tasks;
- give every task one stable identity, one-or-more outcomes, and — for ordinary work — one falsifiable **exit test**; a goal-flagged Task may instead run on a periodic review cadence, since it is not expected to reach a single terminal "done";
- reconcile before creating: intake searches for the same outcome first and attaches, never duplicates;
- keep the read path small: in-progress plus the next few pending tasks orient any session; completed work sweeps to an archive under a hard cap enforced by an Automation, not by memory;
- connect execution upward to strategy: any Task resolves to its nearest goal-flagged ancestor (or itself) by walking `parent_task_id`, so "why am I doing this" is one hop away — with no separate Goal Record to look up;
- support **full tree restructuring** as governed proposals — promoting a subtree to a new root while dropping a stale ancestor, or inserting a new ancestor above an existing branch — as pure re-parenting operations, never a type migration, because there is only one Task type;
- support **reopening** done, archived, or parked work back to pending/in-progress when the user's intent or the outcome's target changes, the same way any task manager allows;
- run an impact-and-fit pass whenever a new Task is created — where it sits against existing work, and how the queue should resequence — before it settles into the ledger;
- route agent-assigned Tasks by matching the Task's required Skill against eligible Agents, with **no default executor** — Chief of Staff owns this resolution (its existing, glossary-defined coordinating/routing role), and an ambiguous or unmatched Task escalates to explicit Human assignment rather than guessing;
- route human-assigned reschedule *and* routing proposals through a shared approval gate that graduates minor/unambiguous changes to auto-apply only once calibrated on the human's own vetted decision history — significant or ambiguous changes always require approval;
- have Internal Strategist proactively scan platform data across installed Modules and propose new value-adding Tasks, always as governed drafts;
- plan with proven methodologies (OKR, GTD, SMARTER, PACT, backward planning, pre-mortem, story mapping, rolling wave, and others) as governed, versioned Playbooks applied by Agents as draft proposals — never as ungoverned auto-writes;
- project the queue to and from a plain-markdown ledger file so external coding agents working in any repository consume the same canonical queue;
- provide real connected data or honest empty states, never fabricated tasks or sample projects.

# 3. Human accountability

Task Manager defines no user personas. Authority comes from the authenticated Human, Organization membership, Record scope, and explicit permissions.

The Human remains accountable for which Tasks carry `is_goal`, priority calls, scope changes, approving tree restructures, marking strategic outcomes achieved, and every consequential external Action. Agents propose plans, decompositions, orderings, restructures, routings, sweeps, and completion verdicts; the deterministic governance controls — not Agent opinion — decide what commits. A task marked done without its exit test evidence is challenged, not silently accepted.

# 4. Scope

## 4.1 Included

```yaml
included_capabilities:
  strategy:
    - any Task may be flagged is_goal: true (horizon, optional anchor/BHAG, one or more structured outcomes[] — key-result semantics, leading and lagging indicators, optional headline North Star measure); no separate Goal Record
    - periodic review cadence for goal-flagged Tasks (the Evaluated/Reviewed halves of SMARTER)
  planning:
    - candidate-Task generation — candidate approaches to a goal-flagged or ordinary parent Task (what "Initiative" used to name), compared before commitment; available at any level
    - full tree restructuring as governed proposals: promote a subtree to a new root (dropping a stale ancestor), insert a new ancestor above an existing branch, or re-parent under a different node — always a parent_task_id/path update, never a type conversion
    - methodology Playbooks applied by Agents as draft plan proposals (OKR backward planning, GTD clarify/organize, story mapping, design-thinking discovery, rolling wave, backward-from-deadline scheduling)
    - stakeholder, dependency, and risk identification per candidate Task; pre-mortem and scenario passes before large commitments
    - task decomposition with exit tests, owners, priorities, dependencies, and dot-notation level (e.g. `2.3.5`)
  execution:
    - one ordered queue per workspace; WIP limit (default 1 in-progress per actor)
    - unified Task lifecycle: candidate → committed → pending → in-progress → blocked → done → swept-to-archive (parked/abandoned as alternate terminal states); blocked is a flagged state, never a separate queue; done/archived/parked accept a governed reverse transition back to pending/in-progress (reopening)
    - evidence attachment (Events, Files, Records, links) and exit-test verification before done sticks
    - recently-completed bay with a hard cap and age limit, swept by Automation
    - impact-and-fit pass on every Task creation: where it sits against existing work, proposed resequence
    - deterministic agent-task routing with no default (required-Skill match against eligible Agents, owned by Chief of Staff) and a confidence-graduated approval gate shared by reschedule AND routing proposals (minor/unambiguous auto-applies once calibrated; significant or ambiguous always needs approval)
  agent_ergonomics:
    - stable dot-path identity per Task; read-budget layout (hot head first)
    - markdown ledger projection: emit and ingest a tasks.md contract for external repositories and coding agents
    - reconciliation-first intake from any source (chat, Signals, email drafts, bug evidence)
  habits:
    - recurring task and Scheduled Automation scaffolding beneath goal-flagged Tasks (systems-over-goals, Atomic Habits pattern)
  proactive_value:
    - Internal Strategist scans platform data across installed Modules on a schedule and proposes new value-adding Tasks as candidate drafts
```

## 4.2 Excluded or not authoritative

```yaml
not_covered_or_not_authoritative:
  - a second queue anywhere: bug ledgers, decision logs, request logs stay evidence/audit, never execution queues
  - time tracking, billing, capacity planning, resource management (future Modules if ever)
  - autonomous execution of tasks: the Module sequences and verifies work; doing the work stays with governed Agent Runs or Humans
  - auto-completing tasks without exit-test evidence; auto-merging suspected duplicate tasks (proposals only)
  - embedding a project-management product (Vikunja/Planka/Focalboard AGPL-family — rejected; patterns only)
  - kernel vocabulary changes: no `Initiative`, `Outcome`, or `Goal` Record type exists at all (2026-07-16 then 2026-07-17 revisions) — `Initiative` stays retired (AP-020), `Outcome` and `Goal` are fields, not types
  - a separate execution pipeline: Task → Action → Evidence → Verification rides the existing Request→Plan→Decision→Run→Action→Event→Result canon
  - a default executor Agent for agent-assigned Tasks: routing is always resolved by required-Skill match, never defaulted to any one Agent (2026-07-17 revision)
  - silent tree restructuring: promote/insert-ancestor-above/re-parent are always proposals
  - gamification, streaks, or engagement mechanics
```

# 5. Layered model

**One Record type.** `Initiative` is a retired kernel identifier (AP-020) — reviving it as a "Module Record type" was considered and rejected on 2026-07-16. On 2026-07-17 the user pushed further, asking why Goal needs to exist separately at all — a root Task already branches and can own multiple candidate child-trees — and asked for full tree flexibility: an existing branch (`b.c.d`) gaining a new ancestor above it (`a.b.c.d`), and a branch being promoted to a new root while a stale ancestor is dropped (`b.c.d` → `c.d`, keeping `c`'s identity). That pushback is correct: a hard-typed Goal Database would force a type migration on every promote/demote, which is exactly the friction the user is trying to eliminate. The fix is `is_goal: boolean` on the one Task type — it travels with the row through any re-parenting, so restructuring is always a pure `parent_task_id`/`path` update, never a table migration.

```yaml
layers:
  one_recursive_type:
    Task: canonical glossary term — bounded unit of work; self-referential (parent_task_id + materialized path)
          a candidate/committed Task IS what "Initiative" used to name
          a Task with no children IS what "Subtask" named the leaf of
          a Task with is_goal=true IS what "Goal" used to name — periodically reviewed rather than exit-tested, may sit at a root or, after restructuring, mid-tree ("sub-goal" falls out for free)
    Action: canonical — atomic governed operation within a Run (existing pipeline, reused not rebuilt)
    Evidence: Relations from a Task to Events, Results, Files, Records
    Verification: recorded pass of the Task's exit test against its evidence

node_record_shape:      # every Task carries (user's original ontology, mapped 1:1)
  identity: [path (stable dot-notation, e.g. "2.3.5" = 5th child of 3rd child of the 2nd root Task), title, level]
  state: [status (candidate|committed|pending|in_progress|blocked|done|parked|abandoned|archived — reversible, §4.1), priority, owner, is_goal]
  graph: [depends_on, blocked_by, parent_task_id]   # typed Relations/refs; nearest is_goal ancestor is resolved, not stored, unless explicitly overridden
  outcomes: [{ title, measure, target, current, indicator_kind, north_star? }]   # one or more, per node — every Task carries this field, not just goal-flagged ones
  proof: [exit_test, evidence[], verification]      # exit_test required for non-goal-flagged Tasks; goal-flagged Tasks may run on review_cadence instead
  policy: [visibility, review_mode, approval refs]   # existing governance fields, not new machinery
```

Why the concept "Goal" is retained even though the type is not: the glossary's Goal definition (durable intended outcome, classification/prioritization anchor) survives entirely as a *behavior* a Task can carry — `is_goal`, `outcomes[]`, `review_cadence` — not as separate storage. This is a deliberate, reasoned collapse (see the module plan §0/§5 and ADR-106), not a silent drop of the glossary term.

# 6. Primary certifying use cases

1. **Game-designs workspace** — the user's game-design work runs as a Task Manager instance: a goal-flagged Task per design objective with playtest-measurable outcomes, candidate mechanics as `status: candidate` Tasks, a single ordered build/test queue with exit tests ("fastest honest playtest that can disprove the mechanic works"), agent-assigned build Tasks routed to whichever eligible Agent owns the relevant Skill (Capability Builder among them, never assumed by default), and the markdown ledger projected into the game repo for its coding agent.
2. **Bridge self-hosting** — `docs/TASKS.md` and the existing Task Manager UI (`platform/apps/web`, live at `/task-manager`) become a read/write instance of this Module's ledger contract; the repo dogfoods the Module it ships.

# 7. Success measures

```yaml
measures:
  single_queue: duplicate-task rate at intake (target ~0 via reconciliation); parallel-queue recurrences (target 0)
  honesty: done-without-evidence reopens caught by the challenger Automation; "plausibly done" escapes (target 0)
  context_economics: tokens/lines an agent reads to orient (hot head ≤ ~2k tokens); archive sweep violations (cap breach count target 0)
  strategy_link: share of in-progress Tasks whose nearest is_goal ancestor resolves cleanly (no orphaned trees)
  restructuring: path-consistency after promote/insert-ancestor-above/re-parent (target 100% — no orphaned or partially-recomputed paths)
  routing_and_reschedule: agent-task Agent-mix distribution (should track the real Task mix, not skew to one Agent — the signal that "no default" is actually holding); reschedule/routing auto-apply precision once graduated (false-auto-apply target 0)
  governance: unapproved plan-writes == 0; every decomposition/restructure/routing lands as a reviewed proposal
```
