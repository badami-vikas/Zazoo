# TASKS — canonical work ledger

This is the **only active execution queue**. A roadmap or plan defines scope; a bug supplies evidence; a request supplies intent; an approval supplies a gate. None of those creates a second task row. The Task Manager UI reads this file only.

## Execution order

Task Manager and Claude read this single ordered list. Status remains part of each task record: in-progress work is pulled first, pending work follows this order, and completed work is retained at the bottom for audit.

`TASK-001, TASK-003, TASK-004, TASK-005, TASK-013, TASK-012, TASK-010, TASK-008, TASK-007, TASK-014, TASK-015, TASK-016, TASK-017, TASK-006, TASK-011, TASK-009, TASK-002, TASK-020, TASK-018, TASK-019`

Captured from the user-provided Task Manager ranking on 2026-07-16.

## Operating standard

### One task, one outcome

Every active item has one stable `TASK-nnn` identity and contains:

- **Outcome** — the user-visible or system result, not an activity list.
- **Prototype test** — the fastest honest test that can disprove completion.
- **Scope** — the detailed plans/specifications that define the work.
- **Evidence** — bug reports, audits, or other proof attached to the task.
- **Requests** — user-request identifiers whose intent the task fulfils.
- **Approval** — `none`, an applied standing decision, or a blocking proposed decision.
- **Dependencies** — other canonical task IDs only.

### Intake and reconciliation

1. Search this file for the same outcome, root cause, or completion test.
2. If found, attach the new request/bug/approval as metadata on that task. Do not create another task.
3. Create a task only when the outcome and exit test are independently deliverable.
4. A user-reported defect may raise the existing task's priority and add bounded same-surface work, but does not create a separate bug queue.
5. Detailed reproduction evidence stays append-only in `docs/BUGS.md`; verbatim requests stay in requirement docs/`docs/requests.md`; canon decisions stay in `docs/APPROVALS.md`. Those files are evidence and audit trails, not execution queues.
6. New plans must map every implementation item to an existing or new `TASK-nnn`. Unmapped checklist items are invalid.

### Status, priority, and order

- Status: `inbox`, `ready`, `in_progress`, `blocked`, `done`, or `dropped`.
- Priority: `P0` prototype gate, `P1` core value, `P2` convergence, `P3` hardening, `P4` later.
- Tasks appear in execution order. Reordering the prototype gate or changing canonical scope follows the approval rule; presentation-only rank/schedule changes do not.
- Only one task should normally be `in_progress`. A task may be `blocked` only with a named unblock condition.

### Completion and reporting

A task exits the active queue only when its Prototype test and source exit criteria pass, relevant evidence is resolved, required approval is applied, affected-neighbour checks pass, and the change is recorded in `docs/log.md`. Runtime surfaces require live evidence at their named viewports/devices; “build passes” alone is insufficient.

There is no separate progress narrative. Report task deltas only: status change, material decision, new evidence, blocker, or verification result. `docs/log.md` records landed changes; dated `outputs/` files preserve substantive user-facing outcomes. The Task Manager's rank, schedule, width, and hidden-row preferences are views over this ledger, not new sources of truth.

## Prototype gate — prove value before broad cleanup

The next build sequence is TASK-001 → TASK-002 → TASK-003 → TASK-004 → TASK-005. TASK-005 is the gate: do not resume broad vocabulary migration, repo cleanup, or later Modules until the combined Avatar + Commons path is usable and tested.

## TASK-001 — Coherent actionable shell prototype
- Status: done
- Priority: P0
- Horizon: Prototype
- Outcome: A small, consistent shell where installed Modules are actionable, deprecated surfaces are absent, table controls are predictable, and both side panels behave alike.
- Prototype test: On desktop and 375px, open two installed Modules from the left nav; inspect their Agent-owned Skills, Automations, Integrations, Files, and standard table toolbar/context menu; resize/collapse/extend both panels; confirm no visible Tools, Knowledge, Workflows, Projects, or inert interactive rows.
- Scope: docs/raw/ui-architecture-rules-2026-07.md §2–§5; docs/raw/vocabulary-code-migration-plan-2026-07-14.md VOCAB2/VOCAB6; docs/raw/relationship-module-plan-2026-07.md RM0; docs/raw/brd-dealpilot-2026-07.md; docs/raw/brd-jobpilot-2026-07.md
- Evidence: RESOLVED TASK-001 portions of BUGS deprecated Tools/dead Modules, standalone Skills, asymmetric panels, Knowledge shell IA, Intelligence toolbar/Workflows, hardcoded Modules, and pinned legacy surfaces; broader Agent invocation, Relationship storage, Run/lifecycle, and server-copy tails remain attached to their owning follow-up tasks
- Requests: R-019; R-020; R-021; R-023; user shell/module/table directives 2026-07-14–15
- Approval: AP-020, AP-021, and AP-027 applied
- Dependencies: none
- Verification: 2026-07-16 exact Prototype test passed at 1280×720 and emulated 375×812 against isolated API/web processes; Tauri launched and remained alive against the same API-backed Vite client.

## TASK-002 — Trust-first onboarding and behavioral learning prototype
- Status: in_progress
- Priority: P0
- Horizon: Prototype
- Outcome: One comprehensible Onboarding flow that explains why each question matters, learns progressively under user control, and produces an immediately useful governed recommendation.
- Prototype test: A new user completes Onboarding without internal vocabulary, sees why/consequence copy for every question, supplies an admired public figure, receives a cited Learning recommendation that requires approval, can re-enter/reset Onboarding, and can skip/snooze/pause/inspect/correct/delete learned preferences; the day-7 qualities prompt is schedulable.
- Scope: docs/raw/egg-commons-feature-roadmap-2026-07.md AV1/EG3; docs/raw/bridge-foundational-agents-onboarding-2026-07.md; docs/raw/learning-agent-roadmap-2026-07.md
- Evidence: BUGS 2026-07-14 blueprint-centric onboarding; BUGS onboarding re-entry; BUGS Radix Dialog warning; 2026-07-16 API/Memory regression evidence in outputs/2026-07-16-task002-onboarding-learning.md
- Requests: R-028; R-029; R-030; role-model and behavioral-learning directive 2026-07-14
- Approval: AP-020 applied
- Dependencies: none

## TASK-003 — Movable cross-screen Avatar desktop prototype
- Status: blocked
- Priority: P0
- Horizon: Prototype
- Outcome: The Avatar is a real desktop companion: draggable, persistent across macOS Spaces and display topology changes, with native window controls inside the Sidebar header.
- Prototype test: Drag the Avatar, change Spaces, enter/exit fullscreen, attach/detach an extended display, and move between displays; position persists/reconciles and close/minimize/zoom remain accessible in the supplied-reference layout.
- Scope: docs/raw/desktop-companion-agent-roadmap-2026-07.md AV0; docs/raw/egg-commons-feature-roadmap-2026-07.md AV0
- Evidence: BUGS 2026-07-14 companion mobility; BUGS 2026-07-14 desktop chrome
- Requests: R-001; R-002; R-016; desktop overlay/chrome directive 2026-07-14
- Approval: AP-020 applied
- Dependencies: none
- Unblock: In a local macOS session, implement and verify join-all-Spaces/fullscreen non-activating panel behavior, runtime display hot-plug reconciliation, and the supplied-reference Sidebar chrome across the full prototype test.

## TASK-004 — Commons install and trust prototype
- Status: done
- Priority: P0
- Horizon: Prototype
- Outcome: The app can discover and install one real Commons capability through the governed signed supply chain without transferring personal data to Commons.
- Prototype test: From a real Module need, search Commons, inspect provenance and scan results, install a signed content-hash-pinned capability, reject tampered/untrusted input, and show the installed capability in its owning Module.
- Scope: docs/raw/egg-commons-feature-roadmap-2026-07.md CM0–CM1; docs/raw/module-evolution-system-2026-07.md
- Evidence: e5edafc audit; `outputs/2026-07-16-task004-commons-task005-glue.md` — clean local Commons/API/web desktop+375px Prototype test passed with signed hash/provenance/scan inspection, governed Agent attachment, rejection/privacy tests, and no marketplace route
- Requests: R-004; R-016; R-026
- Approval: AP-030 applied
- Dependencies: TASK-001

## TASK-005 — Avatar + Commons end-to-end demo certification
- Status: blocked
- Priority: P0
- Horizon: Prototype
- Outcome: A short, repeatable demo proves the combined product rather than isolated screens.
- Prototype test: On desktop and 375px, complete Onboarding, meet the movable Avatar, open an actionable Module, obtain a governed recommendation, install one trusted Commons capability, run it through an Agent/Automation, inspect provenance, and exercise correction/undo with no deprecated vocabulary or console-blocking defects.
- Scope: docs/raw/egg-commons-feature-roadmap-2026-07.md prototype gate; docs/raw/ui-architecture-rules-2026-07.md
- Evidence: outputs/2026-07-14-e5edafc-egg-commons-ui-audit.md; outstanding live-browser evidence in docs/raw/progress-archive-2026-07.md
- Implementation evidence: `outputs/2026-07-16-task004-commons-task005-glue.md` — singular stored Automation owner, server-derived Agent actor/Plane, persistent/in-memory Ritual stores, one manifest-declared governed DealPilot Run, and existing Approvals correction route; full certification remains blocked
- Requests: user prototype-priority directives 2026-07-13–15
- Approval: AP-030 applied for the bounded gate-glue implementation only; no DONE approval
- Dependencies: TASK-001; TASK-002; TASK-003; TASK-004
- Unblock: complete TASK-003 physical macOS evidence and run the full TASK-005 desktop+375px combined Onboarding→Avatar→Module→Commons→Agent/Automation→Approvals correction/undo Prototype test.

## TASK-006 — DealPilot ETA core prototype
- Status: ready
- Priority: P1
- Horizon: Core Modules
- Outcome: DealPilot supports ETA work through only Deals, Sources, and Theses as default Pages, with correct many-to-many relations, secure Source credential projection, Record Detail, rights/spend gates, and thesis→source→deal discovery.
- Prototype test: Add a Thesis and observe governed Source discovery; add a Source and observe Deal discovery; inspect each Record Detail; reveal/copy a vault-backed Source credential only after Human re-authentication; verify conditional Relationship and Task columns.
- Scope: docs/raw/brd-dealpilot-2026-07.md; docs/raw/dealpilot-module-plan-2026-07.md DP0–DP1
- Evidence: user DealPilot corrections 2026-07-14–15
- Requests: DealPilot requirements 2026-07-14–15
- Approval: AP-023 applied
- Dependencies: TASK-001

## TASK-007 — Agent, Skill, and child-Run orchestration
- Status: ready
- Priority: P1
- Horizon: Core Modules
- Outcome: CoS, Learning, Internal Strategist, Governance, and Builder have durable boundaries; Skills resolve from Goals/Tasks; bounded child Agent Runs inherit ceilings; non-Agent Skill invocation fails closed.
- Prototype test: Assign a typed Task to a non-default eligible Agent, resolve the required Skill, create a bounded child Run, preserve authority/budget/taint/audit limits, and reject direct Human/Automation Skill execution.
- Scope: docs/raw/agent-goal-skill-orchestration-plan-2026-07.md AGS0–AGS3; docs/raw/bridge-foundational-agents-onboarding-2026-07.md
- Evidence: BUGS standalone Skills/non-Agent invocation; specialist-agent overfit review
- Requests: R-019; R-028; R-029; agent redesign directive 2026-07-15
- Approval: AP-021 and AP-023 applied
- Dependencies: TASK-001

## TASK-008 — Relationship Module consolidation
- Status: ready
- Priority: P1
- Horizon: Core Modules
- Outcome: Relationship is one standard Module with Signals, People, and Communities as primary toggles and shared Record/Relation/Event behavior.
- Prototype test: Open Relationship from nav, navigate Signals/People/Communities, follow a Signal to its Person/Community participants and source Event, and take a safe governed Action without entering a global Knowledge surface.
- Scope: docs/raw/relationship-module-plan-2026-07.md RM0–RM6; docs/raw/ui-architecture-rules-2026-07.md
- Evidence: BUGS Knowledge/Relationship IA; BUGS no actionable cross-Module graph
- Requests: Relationship alignment directive 2026-07-14
- Approval: AP-020 and AP-021 applied
- Dependencies: TASK-001

## TASK-009 — Actionable Second Brain graph
- Status: ready
- Priority: P1
- Horizon: Core Modules
- Outcome: A permission-filtered graph below Modules reveals useful cross-Module connections while every datum remains owned by its source Module.
- Prototype test: Traverse a real cross-Module Record/Relation/Event/File connection, filter it, inspect provenance/backlinks, return to the owning Module, and perform a governed Action; inaccessible nodes never render and an accessible list fallback works.
- Scope: docs/raw/ui-architecture-rules-2026-07.md §5c; docs/raw/relationship-module-plan-2026-07.md RM6
- Evidence: BUGS 2026-07-14 no Second Brain graph
- Requests: Second Brain directive 2026-07-14
- Approval: AP-021 applied
- Dependencies: TASK-008

## TASK-010 — Platform red-flag correction feedback
- Status: ready
- Priority: P1
- Horizon: Core Modules
- Outcome: Any eligible data cell or bullet supports one subtle, scoped, reversible red-flag correction that feeds governed learning.
- Prototype test: Hover/focus a cell and bullet, flag each, explain scope, undo it, inspect the audit evidence, and verify no green/yellow feedback semantics remain.
- Scope: docs/raw/ui-architecture-rules-2026-07.md §5d; docs/raw/agent-goal-skill-orchestration-plan-2026-07.md
- Evidence: user feedback-mechanism correction 2026-07-15
- Requests: red-flag directive 2026-07-15
- Approval: AP-023 applied
- Dependencies: TASK-001; TASK-007

## TASK-011 — JobPilot culture-research slice
- Status: ready
- Priority: P1
- Horizon: Core Modules
- Outcome: JobPilot uses permitted public evidence to improve cover letters and interview preparation without inventing insider claims or bypassing access terms.
- Prototype test: For one target company, Learning gathers permitted evidence; Internal Strategist separates fact, opinion, theme, contradiction, and inference; the user sees citations and a rights/access warning before using recommendations.
- Scope: docs/raw/brd-jobpilot-2026-07.md; docs/raw/jobpilot-module-plan-2026-07.md JP3B
- Evidence: BCG application workspace live-evidence gap
- Requests: JobPilot culture-research directive 2026-07-15
- Approval: AP-023 applied
- Dependencies: TASK-007

## TASK-012 — Complete vocabulary migration
- Status: ready
- Priority: P2
- Horizon: Convergence
- Outcome: Product copy, code, schema, API, Events, persisted payloads, routes, errors, and tests use the canonical glossary with time-boxed compatibility removed.
- Prototype test: CI inventory finds no forbidden identifiers outside explicit migration fixtures; backfills and compatibility deletion pass RLS/API/browser tests; visible UI contains no retired labels.
- Scope: docs/raw/vocabulary-code-migration-plan-2026-07-14.md VOCAB0–VOCAB6; docs/glossary.md
- Evidence: BUGS deprecated dummy-prefix rule; BUGS API error strings; BUGS package.yaml filename mismatch; BUGS Initiative-scoped API legacy; deprecated Tools/Knowledge/Workflows evidence attached to TASK-001
- Requests: R-020; vocabulary/glossary directives 2026-07-14
- Approval: AP-020 applied
- Dependencies: TASK-005

## TASK-013 — Repository and manifest cleanup
- Status: ready
- Priority: P2
- Horizon: Convergence
- Outcome: Duplicate prototypes, deprecated data/code paths, stale dummy records, and non-manifest built-ins are removed or explicitly retained with one reason and owner.
- Prototype test: Duplicate/source scan passes, package manifests drive built-ins, deprecated docs are marked rather than erased, dummy ledger matches every unavoidable fixture, and production/build entry points use one implementation.
- Scope: docs/raw/repo-restructure-egg-commons-2026-07.md P1–P2; docs/dummy.md
- Evidence: BUGS duplicate prototype/Tools copies; BUGS dummy-prefix conflict
- Requests: cleanup directives 2026-07-14
- Approval: archive/deletion substep requires a dedicated approval before destructive removal
- Dependencies: TASK-005; TASK-012

## TASK-014 — Full standard Module UI rollout
- Status: ready
- Priority: P2
- Horizon: Convergence
- Outcome: Every Module receives the compiler-owned Page/View/Record Detail, toolbar, context-menu, Files, and Control Panel grammar proven in the shell prototype.
- Prototype test: DealPilot plus two unrelated Modules pass the complete UI architecture audit, including Form view, DB-backed-only Add/Remove Page, all standard column commands, dependency preview/undo, Files layout, accessibility, and honest empty states.
- Scope: docs/raw/ui-architecture-rules-2026-07.md alignment audit
- Evidence: BUGS map view is not a map; BUGS pin persistence only local; BUGS Initiative resource scoping; existing partial table implementation
- Requests: table/actionability directives 2026-07-14–15
- Approval: AP-010/AP-011 and AP-021 applied
- Dependencies: TASK-001; TASK-006; TASK-008

## TASK-015 — End-to-end runtime taint tracking
- Status: ready
- Priority: P3
- Horizon: Hardening
- Outcome: Trust labels propagate monotonically across retrieval, prompts, models, Skills, Actions, Events, Results, Files, storage, serialization, caches, queues, retries, and governed declassification.
- Prototype test: A tainted source traverses an Agent/Skill/Automation path without losing or weakening its label; unknown labels fail closed; sink traces explain the decision; deterministic or Human-approved declassification is audited.
- Scope: docs/raw/learning-agent-roadmap-2026-07.md RT0–RT4; docs/wiki/roadmap.md
- Evidence: root gap recorded ADR-087
- Requests: runtime taint directive 2026-07-14
- Approval: AP-020 applied
- Dependencies: TASK-007; TASK-012

## TASK-016 — Database and migration correctness backlog
- Status: ready
- Priority: P3
- Horizon: Hardening
- Outcome: Known schema, migration, identity-upsert, UUID-validation, and concurrent-test defects are corrected with regression coverage.
- Prototype test: Location enum matches all consumers; identity upsert uses a valid conflict target; migration snapshots round-trip without re-emitting old DDL; invalid UUIDs return typed errors; DB suite passes under supported concurrency.
- Scope: docs/BUGS.md detailed database evidence
- Evidence: BUGS location enum; BUGS partial dedup conflict; BUGS incomplete Drizzle metadata; BUGS pglite invalid UUID; BUGS concurrent DB flake
- Requests: none
- Approval: none
- Dependencies: TASK-012

## TASK-017 — Runtime and package correctness backlog
- Status: ready
- Priority: P3
- Horizon: Hardening
- Outcome: Package persistence/types, Helpdesk routing, browser bundling, styling, and remaining shell persistence defects are production-correct.
- Prototype test: Package state survives restart; install proposals use the right resource type; Helpdesk topics are derived/validated; browser bundle excludes Node-only sandbox code; web styling loads; persisted pins use governed storage.
- Scope: docs/BUGS.md detailed runtime evidence
- Evidence: BUGS in-memory package store; BUGS package resourceType skill; BUGS caller-supplied Helpdesk topics; BUGS Node vm browser leak; BUGS empty globals.css; BUGS client-only pin persistence; BUGS 2026-07-16 baseline lint/typecheck failures; BUGS 2026-07-15 sensor coverage floor
- Requests: none
- Approval: none
- Dependencies: TASK-012

## TASK-018 — Cross-platform release blockers
- Status: blocked
- Priority: P3
- Horizon: Hardening
- Outcome: Desktop signing/CI and the mobile client meet their real-device release criteria without fabricated scaffolding.
- Prototype test: Desktop checks pass on the named OS matrix with signing prerequisites, and a real on-branch Expo app runs against the shared kernel on a device/simulator.
- Scope: docs/raw/roadmap-6month-2026-h2.md XP2–XP3
- Evidence: BUGS mobile app absent from accessible refs; AP-012 desktop CI-green follow-up
- Requests: cross-platform roadmap work
- Approval: none
- Dependencies: TASK-005

## TASK-019 — Approved long-term optimization rollout
- Status: blocked
- Priority: P4
- Horizon: Later
- Outcome: Observability, Memory lifecycle/security, retrieval-first context, stronger sandboxing, and optional remote execution are sequenced only after the user accepts the proposed phase mapping and prerequisite gates pass.
- Prototype test: Approval is applied, each optimization has a measurable baseline and safety boundary, and the first approved slice improves that measure without weakening privacy/authority.
- Scope: docs/raw/optimizations-memory-vm-dealpilot-plan-2026-07.md §6; docs/raw/module-evolution-system-2026-07.md
- Evidence: none
- Requests: R-026
- Approval: AP-007 proposed; AP-008 ledger/status inconsistency must be reconciled before treating its rule as applied
- Dependencies: TASK-005; TASK-015

## TASK-020 — Browser companion and Avatar visual expansion
- Status: ready
- Priority: P4
- Horizon: Later
- Outcome: The deferred browser companion is a real permission-bounded extension, and expanded Avatar visuals use production assets without reviving retired lifecycle/personality vocabulary.
- Prototype test: Install the real extension, inspect and revoke its permissions, capture through the governed Memory path with Avatar blink feedback, and render the approved Avatar asset set consistently across supported surfaces without dummy integration claims.
- Scope: docs/raw/desktop-companion-agent-roadmap-2026-07.md; docs/raw/bridge-foundational-agents-onboarding-2026-07.md
- Evidence: R-030 explicitly deferred Browser Companion; current Avatar art is dimensional SVG rather than a 3D asset pipeline
- Requests: R-029; R-030
- Approval: none
- Dependencies: TASK-003; TASK-015
