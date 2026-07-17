---
title: Task Manager Business Requirements
type: raw
doc_kind: reference
status: proposed
companions: [taskmanager-module-plan-2026-07.md, initiatives-taskade-research.md, productivity-app-research-2026.md, agent-goal-skill-orchestration-plan-2026-07.md, ui-architecture-rules-2026-07.md]
related_wiki: ../wiki/taskmanager.md
updated: 2026-07-16
tags: [taskmanager, module, business-requirements, goals, tasks, planning, agent-first, ledger]
---

# 1. Executive decision

Task Manager is one installable Module for governed goal and work management: capturing Goals, decomposing them into a recursive Task tree (candidate approaches, work, and subtasks are all Tasks — see §5) with measurable outcomes and falsifiable exit tests, sequencing one execution queue, and verifying completion with evidence. It is one item in the global Modules list.

Task Manager must make five answers available to any accountable actor — Human or Agent — in under the cost of reading one screen (for a Human) or ~2k tokens (for an Agent):

1. What is in progress right now?
2. What should be picked up next, in what order?
3. What just landed, and what evidence proves it?
4. What is blocked, on what, and who owns the unblock?
5. Which Goal does the current work serve, and is that Goal still on track?

Task Manager is **agent-first by design**: the primary consumer of the queue is as likely to be a coding or research Agent as a Human. Every design decision optimizes what an actor must read to act — stable IDs, a small hot head, links instead of inline prose, cold history out of the read path, and guards enforced by Automations rather than conventions in prose.

The design is already validated in production: Bridge's own repository runs on this exact model (`docs/TASKS.md` + the Task Manager UI, AP-024/AP-025), and the user's game-designs workspace independently converged on the same format. This Module generalizes that proven system into a governed, installable capability.

# 2. Business problem and intended outcomes

Work today fragments across duplicate queues (roadmaps, bug trackers, chat threads, doc TODO lists), each claiming to be "what to do next." Empirically this destroys work: duplicate tasks, ~100 lost bugs in one observed instance, "plausibly done" items that were never verified, and agents rereading whole histories to orient. Existing task managers optimize for human dashboards, not for the context economics of AI agents that now do a large share of execution.

Task Manager must:

- maintain exactly **one** "what do I do next" surface per workspace; every other artifact (bugs, decisions, requests, notes) demotes to evidence attached to tasks;
- give every task one stable identity, one outcome, and one falsifiable **exit test** — the fastest honest test that can disprove completion;
- reconcile before creating: intake searches for the same outcome first and attaches, never duplicates;
- keep the read path small: in-progress plus the next few pending tasks orient any session; completed work sweeps to an archive under a hard cap enforced by an Automation, not by memory;
- connect execution upward to strategy: any Task resolves to its Goal by walking `serves_goal_id`/ancestry, so "why am I doing this" is one hop away;
- run an impact-and-fit pass whenever a new Task or Goal is created — where it sits against existing work, and how the queue should resequence — before it settles into the ledger;
- route agent-assigned Tasks deterministically (default: Capability Builder in this Module; cross-Module Tasks route to whichever Agent owns the required Skill) and route human-assigned reschedule proposals through an approval gate that graduates minor changes to auto-apply only once calibrated on the human's own vetted decision history — significant changes always require approval;
- have Internal Strategist proactively scan platform data across installed Modules and propose new value-adding Goals/Tasks, always as governed drafts;
- plan with proven methodologies (OKR, GTD, SMARTER, PACT, backward planning, pre-mortem, story mapping, rolling wave, and others) as governed, versioned Playbooks applied by Agents as draft proposals — never as ungoverned auto-writes;
- project the queue to and from a plain-markdown ledger file so external coding agents working in any repository consume the same canonical queue;
- provide real connected data or honest empty states, never fabricated tasks or sample projects.

# 3. Human accountability

Task Manager defines no user personas. Authority comes from the authenticated Human, Organization membership, Record scope, and explicit permissions.

The Human remains accountable for goal selection, priority calls, scope changes, marking strategic outcomes achieved, and every consequential external Action. Agents propose plans, decompositions, orderings, sweeps, and completion verdicts; the deterministic governance controls — not Agent opinion — decide what commits. A task marked done without its exit test evidence is challenged, not silently accepted.

# 4. Scope

## 4.1 Included

```yaml
included_capabilities:
  strategy:
    - Goal capture with horizon (including a single long-range anchor goal per workspace, BHAG-style) and one or more structured outcomes[] (key-result semantics; leading and lagging indicators; optional headline North Star measure)
    - periodic goal review cadence (the Evaluated/Reviewed halves of SMARTER)
  planning:
    - candidate-Task generation — candidate approaches to a Goal or parent Task (what "Initiative" used to name), compared before commitment; available at any level, not only under a Goal
    - methodology Playbooks applied by Agents as draft plan proposals (OKR backward planning, GTD clarify/organize, story mapping, design-thinking discovery, rolling wave, backward-from-deadline scheduling)
    - stakeholder, dependency, and risk identification per candidate Task; pre-mortem and scenario passes before large commitments
    - task decomposition with exit tests, owners, priorities, dependencies, and dot-notation level (e.g. `2.3.5`)
  execution:
    - one ordered queue per workspace; WIP limit (default 1 in-progress per actor)
    - unified Task lifecycle: candidate → committed → pending → in-progress → blocked → done → swept-to-archive (parked/abandoned as alternate terminal states); blocked is a flagged state, never a separate queue
    - evidence attachment (Events, Files, Records, links) and exit-test verification before done sticks
    - recently-completed bay with a hard cap and age limit, swept by Automation
    - impact-and-fit pass on every Task/Goal creation: where it sits against existing work, proposed resequence
    - deterministic agent-task routing (default Capability Builder; cross-Module Tasks route by required Skill) and a confidence-graduated approval gate for human-assigned reschedule proposals (minor auto-applies once calibrated; significant always needs approval)
  agent_ergonomics:
    - stable dot-path identity per Task; read-budget layout (hot head first)
    - markdown ledger projection: emit and ingest a tasks.md contract for external repositories and coding agents
    - reconciliation-first intake from any source (chat, Signals, email drafts, bug evidence)
  habits:
    - recurring task and Scheduled Automation scaffolding beneath goals (systems-over-goals, Atomic Habits pattern)
  proactive_value:
    - Internal Strategist scans platform data across installed Modules on a schedule and proposes new value-adding Goals/Tasks as candidate drafts
```

## 4.2 Excluded or not authoritative

```yaml
not_covered_or_not_authoritative:
  - a second queue anywhere: bug ledgers, decision logs, request logs stay evidence/audit, never execution queues
  - time tracking, billing, capacity planning, resource management (future Modules if ever)
  - autonomous execution of tasks: the Module sequences and verifies work; doing the work stays with governed Agent Runs or Humans
  - auto-completing tasks without exit-test evidence; auto-merging suspected duplicate tasks (proposals only)
  - embedding a project-management product (Vikunja/Planka/Focalboard AGPL-family — rejected; patterns only)
  - kernel vocabulary changes: no `Initiative` or `Outcome` Record type exists at all (2026-07-16 revision) — `Initiative` stays retired (AP-020), `Outcome` is a field, not a type
  - a separate execution pipeline: Task → Action → Evidence → Verification rides the existing Request→Plan→Decision→Run→Action→Event→Result canon
  - gamification, streaks, or engagement mechanics
```

# 5. Layered model

Two Record types, not four. `Initiative` is a retired kernel identifier (AP-020) — reviving it as a "Module Record type" was considered and rejected (2026-07-16 revision): a task defined by `status: candidate` already carries the same meaning without resurrecting a migrated-away word. `Outcome` is a structured field, not a Relation-bearing type — it never needed independent RLS or provenance of its own.

```yaml
layers:
  strategic:             # why — the one non-Task anchor
    Goal: canonical glossary term — durable intended outcome; may be flagged anchor/BHAG; carries outcomes[]
  planning + execution:  # what + how + proof — one recursive type
    Task: canonical glossary term — bounded unit of work; self-referential (parent_task_id + materialized path);
          a candidate/committed Task IS what "Initiative" used to name; a Task with no children IS what "Subtask" named the leaf of
    Action: canonical — atomic governed operation within a Run (existing pipeline, reused not rebuilt)
    Evidence: Relations from a Task to Events, Results, Files, Records
    Verification: recorded pass of the Task's exit test against its evidence

node_record_shape:      # every Goal and Task carries (user's original ontology, mapped 1:1)
  identity: [path (stable dot-notation, e.g. "2.3.5" = 5th child of 3rd child of the 2nd root Task), title, level]
  state: [status (candidate|committed|pending|in_progress|blocked|done|parked|abandoned|archived), priority, owner]
  graph: [depends_on, blocked_by, parent_task_id, serves_goal_id]   # typed Relations/refs
  outcomes: [{ title, measure, target, current, indicator_kind, north_star? }]   # one or more, per node — not a separate type
  proof: [exit_test, evidence[], verification]
  policy: [visibility, review_mode, approval refs]   # existing governance fields, not new machinery
```

Why Goal stays separate from Task (pushback recorded, not just asserted): a Goal is periodically reviewed/revised, never "done" the way a Task's exit test resolves it; a Goal is the stable point several independent candidate Task-trees attach to (collapsing it into "the root task" would let a Goal own only one tree, losing compare-before-commit as a first-class shape); and the glossary already locks Goal/Task as distinct canonical terms, so merging them is a separate canon-edit decision, not a silent fold-in.

# 6. Primary certifying use cases

1. **Game-designs workspace** — the user's game-design work runs as a Task Manager instance: design goals with playtest-measurable outcomes, candidate mechanics as `status: candidate` Tasks, a single ordered build/test queue with exit tests ("fastest honest playtest that can disprove the mechanic works"), agent-assigned build Tasks routed to Capability Builder, and the markdown ledger projected into the game repo for its coding agent.
2. **Bridge self-hosting** — `docs/TASKS.md` and the existing Task Manager UI become a read/write instance of this Module's ledger contract; the repo dogfoods the Module it ships.

# 7. Success measures

```yaml
measures:
  single_queue: duplicate-task rate at intake (target ~0 via reconciliation); parallel-queue recurrences (target 0)
  honesty: done-without-evidence reopens caught by the challenger Automation; "plausibly done" escapes (target 0)
  context_economics: tokens/lines an agent reads to orient (hot head ≤ ~2k tokens); archive sweep violations (cap breach count target 0)
  strategy_link: share of in-progress Tasks with a live Goal path (ancestry/`serves_goal_id` resolvable to a real Goal)
  routing_and_reschedule: agent-task misroute rate (target 0 — Builder invoked outside its Skill scope never happens); reschedule auto-apply precision once graduated (false-auto-apply target 0)
  governance: unapproved plan-writes == 0; every decomposition lands as a reviewed proposal
```
