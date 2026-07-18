# TASKS — canonical work ledger

This is the **only active execution queue**. A roadmap or plan defines scope; a bug supplies evidence; a request supplies intent; an approval supplies a gate. None of those creates a second task row. The Task Manager UI reads this file only.

## Execution order

Task Manager and Claude read this single ordered list top-to-bottom — the physical section order below IS the execution order. Status remains part of each task record: in-progress work is pulled first, pending work follows this order, and completed work is retained at the bottom for audit.

IDs for cross-reference: `TASK-001, TASK-003, TASK-004, TASK-005, TASK-013, TASK-012, TASK-010, TASK-008, TASK-007, TASK-014, TASK-021, TASK-015, TASK-016, TASK-017, TASK-006, TASK-011, TASK-009, TASK-002, TASK-020, TASK-018, TASK-019, TASK-022, TASK-023`

Captured from the user-provided Task Manager ranking on 2026-07-16. TASK-021 placed immediately after TASK-014 on 2026-07-16 per user directive (AP-033/AP-034). TASK-022 (inference cost optimization) appended at queue end 2026-07-17 per AP-038; TASK-023 (Learning Agent web-research Skill, renumbered from this session's original TASK-022 which collided with TASK-022 landing on main in parallel) appended immediately after per user directive (AP-039) — no re-rank requested.

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

A task exits the active queue only when its Prototype test and source exit criteria pass, relevant evidence is resolved, required approval is applied, affected-neighbour checks pass, and the change is recorded in `docs/log.md`. Runtime surfaces require live evidence at their named viewports/devices; "build passes" alone is insufficient.

There is no separate progress narrative. Report task deltas only: status change, material decision, new evidence, blocker, or verification result. `docs/log.md` records landed changes; dated `outputs/` files preserve substantive user-facing outcomes. The Task Manager's rank, schedule, width, and hidden-row preferences are views over this ledger, not new sources of truth.

## Prototype gate — prove value before broad cleanup

The next build sequence is TASK-001 → TASK-002 → TASK-003 → TASK-004 → TASK-005. TASK-005 is the gate: do not resume broad vocabulary migration, repo cleanup, or later Modules until the combined Avatar + Commons path is usable and tested.

AP-029 exception (user-directed 2026-07-16): start TASK-006 through TASK-015 now in dependency-aware waves. TASK-006/007/008 may execute in parallel with the remaining gate work; TASK-009–015 may plan now but implementation still waits for their named dependencies. No task closes without its exact Prototype test and all prerequisite evidence.

## Coherent actionable shell prototype
- ID: TASK-001
- Status: done
- Priority: P0
- Horizon: Prototype
- Outcome: A small, consistent shell where installed Modules are actionable, deprecated surfaces are absent, table controls are predictable, and both side panels behave alike.
- Prototype test: On desktop and 375px, open two installed Modules from the left nav; inspect their Agent-owned Skills, Automations, Integrations, Files, and standard table toolbar/context menu; resize/collapse/extend both panels; confirm no visible Tools, Knowledge, Workflows, Projects, or inert interactive rows.
- Scope: docs/raw/ui-architecture-rules-2026-07.md §2–§5; docs/raw/vocabulary-code-migration-plan-2026-07-14.md VOCAB2/VOCAB6; docs/raw/relationship-module-plan-2026-07.md RM0; docs/raw/brd-dealpilot-2026-07.md; docs/raw/brd-jobpilot-2026-07.md
- Evidence: RESOLVED TASK-001 portions of BUGS deprecated Tools/dead Modules, standalone Skills, asymmetric panels, Knowledge shell IA, Intelligence toolbar/Workflows, hardcoded Modules, pinned legacy surfaces, the clean-build JobPilot project-reference gap, Module File-root traversal, and synchronous sidecar health-wait regression; broader Agent invocation, Relationship storage, Run/lifecycle, and server-copy tails remain attached to their owning follow-up tasks
- Requests: R-019; R-020; R-021; R-023; user shell/module/table directives 2026-07-14–15
- Approval: AP-020, AP-021, and AP-027 applied
- Dependencies: none
- Verification: 2026-07-16 exact Prototype test passed at 1280×720 and emulated 375×812 against isolated API/web processes; Tauri launched and remained alive against the same API-backed Vite client. Independent integration review then closed and re-reviewed the File-root traversal and startup-stall defects with core 350/350, full API 103/103, and desktop Rust 28/28 plus clean builds/typechecks and Clippy.

## Movable cross-screen Avatar desktop prototype
- ID: TASK-003
- Status: done
- Priority: P0
- Horizon: Prototype
- Outcome: The Avatar is a real desktop companion: draggable, persistent across macOS Spaces and display topology changes, with native window controls inside the Sidebar header.
- Prototype test: Drag the Avatar, change Spaces, enter/exit fullscreen, attach/detach an extended display, and move between displays; position persists/reconciles and close/minimize/zoom remain accessible in the supplied-reference layout.
- Scope: docs/raw/desktop-companion-agent-roadmap-2026-07.md AV0; docs/raw/egg-commons-feature-roadmap-2026-07.md AV0
- Evidence: RESOLVED BUGS 2026-07-14 companion mobility and desktop chrome; `outputs/2026-07-16-task-003-avatar-drag-persistence.md`; `outputs/2026-07-16-task-003-macos-avatar.md`; `outputs/2026-07-18-task-003-avatar-certification.md` (real three-display mixed-DPI placement, cross-display move/native-event save/relaunch, VoiceOver navigation and physical activation, fullscreen/Spaces presence, external-display reposition, extend→mirror→extend 3→2→3, and physical detach/reconnect all pass)
- Requests: R-001; R-002; R-016; desktop overlay/chrome directive 2026-07-14
- Approval: AP-020, AP-026, AP-040, and AP-041 applied
- Dependencies: none
- Verification: 2026-07-18 software gates passed (desktop Rust 31/31, Clippy warnings denied, cargo check, web 49/49, production build, typecheck, targeted ESLint, no-dummy). The user then confirmed the exact remaining human matrix passes: physical cross-display pointer drag with quit/relaunch restoration, physical VoiceOver activation of close/minimize/fullscreen, and physical external-display detach/reconnect. Prototype test complete.

## Commons install and trust prototype
- ID: TASK-004
- Status: done
- Priority: P0
- Horizon: Prototype
- Outcome: The app can discover and install one real Commons capability through the governed signed supply chain without transferring personal data to Commons.
- Prototype test: From a real Module need, search Commons, inspect provenance and scan results, install a signed content-hash-pinned capability, reject tampered/untrusted input, and show the installed capability in its owning Module.
- Scope: docs/raw/egg-commons-feature-roadmap-2026-07.md CM0–CM1; docs/raw/module-evolution-system-2026-07.md
- Evidence: e5edafc audit; `outputs/2026-07-16-task004-commons-task005-glue.md` — clean local Commons/API/web desktop+375px Prototype test plus final review passed with Ed25519, closed provenance, signed hash/dependency/scan inspection, stable Human-review install finalization/reconciliation, current Module-need revalidation, governed Agent attachment, rejection/privacy tests, and no marketplace route
- Requests: R-004; R-016; R-026
- Approval: AP-031 applied
- Dependencies: TASK-001

## Avatar + Commons end-to-end demo certification
- ID: TASK-005
- Status: done
- Priority: P0
- Horizon: Prototype
- Outcome: A short, repeatable demo proves the combined product rather than isolated screens.
- Prototype test: On desktop and 375px, complete Onboarding, meet the movable Avatar, open an actionable Module, obtain a governed recommendation, install one trusted Commons capability, run it through an Agent/Automation, inspect provenance, and exercise correction/undo with no deprecated vocabulary or console-blocking defects.
- Scope: docs/raw/egg-commons-feature-roadmap-2026-07.md prototype gate; docs/raw/ui-architecture-rules-2026-07.md
- Evidence: `outputs/2026-07-18-task-005-demo-certification.md`; TASK-003 physical Avatar certification in `outputs/2026-07-18-task-003-avatar-certification.md`; clean isolated desktop and exact 375×812 evidence covers Onboarding, Owl Avatar, Relationship Module, cited recommendation, signed Commons discovery/install, Learning Agent invocation, immutable package/hash/Agent provenance, correction, veto, no-downstream-event audit, and physically reachable mobile Settings/Approvals controls
- Implementation evidence: `outputs/2026-07-16-task004-commons-task005-glue.md`; signed `cited-role-model-practice@1.0.0` is installed only for Relationship's Learning Agent, and `commons.runInstalledSkill` fails closed unless the stored/current signed Skill contracts and exact current built-in Relationship Module identity, need, installed attachment, content hash, private scope, and runtime Agent binding all match; private current/legacy proposal reads, linked audit rows, and decisions are owner-isolated; Organization rename coordinates DB and local Files state under a row lock with target-conflict refusal, commit-failure rollback, and Files-aware legacy bootstrap
- Requests: user prototype-priority directives 2026-07-13–15
- Approval: AP-031 applied for bounded gate glue; AP-042 applied for exact TASK-005 certification and closure
- Dependencies: TASK-001; TASK-002; TASK-003; TASK-004
- Verification: 2026-07-18 uninterrupted clean runs passed on the final post-fix code at desktop 1440×913 and exact mobile 375×812 with body/document widths equal to the viewport, no trace-drawer overflow, failed resources, JavaScript errors, unhandled rejections, console errors, retired visible terms, or runtime dummy data. Both runs edited the installed-Skill proposal before approval and then vetoed a second run; the append-only ledger retained Learning Agent plus package/hash provenance, showed the corrected monthly cadence, and proved the veto emitted no downstream Event. Visual review caught and the final mobile rerun reverified both the repaired Settings → Capabilities Module link and physically reachable Settings/Approvals layouts. A release Tauri bundle built and launched Bridge main, Companion, and Annotate windows with a healthy managed API sidecar on the currently connected display; TASK-003 separately certifies the three-display mobility/topology matrix. Final gates: API 33/33, web focused checks including the 375px regression, desktop Rust 31/31, typecheck 37/37 tasks, build 20/20 tasks, native release bundle, and all 36 non-Sensor test tasks; the known TASK-017 Sensor aggregate-coverage debt remains 7/7 tests passing at 36.97% versus the 38% floor.

## Repository and manifest cleanup
- ID: TASK-013
- Status: ready
- Priority: P2
- Horizon: Convergence
- Outcome: Duplicate prototypes, deprecated data/code paths, stale dummy records, and non-manifest built-ins are removed or explicitly retained with one reason and owner.
- Prototype test: Duplicate/source scan passes, package manifests drive built-ins, deprecated docs are marked rather than erased, dummy ledger matches every unavoidable fixture, and production/build entry points use one implementation.
- Scope: docs/raw/repo-restructure-egg-commons-2026-07.md P1–P2; docs/dummy.md
- Evidence: BUGS duplicate prototype/Tools copies; BUGS dummy-prefix conflict; BUGS legacy prototype CI imports deliberately uncommitted PII-derived modules
- Requests: cleanup directives 2026-07-14
- Approval: AP-029 applied for planning; archive/deletion substep still requires a dedicated approval before destructive removal
- Dependencies: TASK-005; TASK-012

## Complete vocabulary migration
- ID: TASK-012
- Status: ready
- Priority: P2
- Horizon: Convergence
- Outcome: Product copy, code, schema, API, Events, persisted payloads, routes, errors, and tests use the canonical glossary with time-boxed compatibility removed.
- Prototype test: CI inventory finds no forbidden identifiers outside explicit migration fixtures; backfills and compatibility deletion pass RLS/API/browser tests; visible UI contains no retired labels.
- Scope: docs/raw/vocabulary-code-migration-plan-2026-07-14.md VOCAB0–VOCAB6; docs/glossary.md
- Evidence: BUGS deprecated dummy-prefix rule; BUGS API error strings; BUGS package.yaml filename mismatch; BUGS Initiative-scoped API legacy; deprecated Tools/Knowledge/Workflows evidence attached to TASK-001
- Requests: R-020; vocabulary/glossary directives 2026-07-14
- Approval: AP-020 and AP-029 applied
- Dependencies: TASK-005

## Platform red-flag correction feedback
- ID: TASK-010
- Status: ready
- Priority: P1
- Horizon: Core Modules
- Outcome: Any eligible data cell or bullet supports one subtle, scoped, reversible red-flag correction that feeds governed learning.
- Prototype test: Hover/focus a cell and bullet, flag each, explain scope, undo it, inspect the audit evidence, and verify no green/yellow feedback semantics remain.
- Scope: docs/raw/ui-architecture-rules-2026-07.md §5d; docs/raw/agent-goal-skill-orchestration-plan-2026-07.md
- Evidence: user feedback-mechanism correction 2026-07-15
- Requests: red-flag directive 2026-07-15
- Approval: AP-023 and AP-029 applied
- Dependencies: TASK-001; TASK-007

## Relationship Module consolidation
- ID: TASK-008
- Status: in_progress
- Priority: P1
- Horizon: Core Modules
- Outcome: Relationship is one standard Module with Signals, People, and Communities as primary toggles and shared Record/Relation/Event behavior.
- Prototype test: ✅ Open Relationship from nav, navigate Signals/People/Communities, follow a Signal to its Person/Community participants and source Event, and take a safe governed Action without entering a global Knowledge surface.
- Scope: docs/raw/relationship-module-plan-2026-07.md RM0–RM6; docs/raw/ui-architecture-rules-2026-07.md
- Evidence: RM0 prototype and RM4 Relation persistence/materialization are integrated on `main` at `590cca6`: `outputs/2026-07-16-task-008-relationship-module-consolidation.md`; desktop + 375px live evidence; migration `0015_task008_relation_contract`; owner-isolated Relation/effect RLS; deterministic bounded Relation reads; durable approval-effect retry/reconciliation; core 422, DB 123, API 164, web 43, and desktop 28 tests; monorepo build/typecheck, web production build, migration fresh/upgrade/no-drift, changed-file lint, runtime no-dummy, and final independent central-merge review. Remaining exact plan scope: RM1 governed Person/Community CRUD/search/detail, RM2 unified Timeline/intake/identity queue, RM3 Memory/commitment/prep lifecycle, RM4 governed Map/path finder, RM5 introductions/recommendations/user Automations, and RM6 team permission/delegation/evolution work. TASK-014/TASK-009 own RM6's cross-Module Graph renderer.
- Requests: Relationship alignment directive 2026-07-14
- Approval: AP-020, AP-021, AP-029, and AP-030 applied
- Dependencies: TASK-001

## Agent, Skill, and child-Run orchestration
- ID: TASK-007
- Status: done
- Priority: P1
- Horizon: Core Modules
- Outcome: CoS, Learning, Internal Strategist, Governance, and Builder have durable boundaries; Skills resolve from Goals/Tasks; bounded child Agent Runs inherit ceilings; non-Agent Skill invocation fails closed.
- Prototype test: ✅ Assigned active Agents resolve matching workspace Goal/Task Skills; unauthorized/missing/inactive/cross-workspace invocation fails closed; a server-owned child Run narrows authority/budget/taint/depth, records lifecycle audit, and can be stopped by Governance/Human.
- Scope: docs/raw/agent-goal-skill-orchestration-plan-2026-07.md AGS0–AGS3; docs/raw/bridge-foundational-agents-onboarding-2026-07.md
- Evidence: RESOLVED BUGS standalone Skills/non-Agent invocation; specialist-agent overfit review; [TASK-007 output](../outputs/2026-07-16-task007-agent-skill-child-run-orchestration.md); core 421, DB 106, API 161, Google 35, web 43 tests; monorepo typecheck/build; changed-file lint; migration no-drift; four independent security/correctness reviews, final no findings.
- Requests: R-019; R-028; R-029; agent redesign directive 2026-07-15
- Approval: AP-021, AP-023, AP-029, and AP-032 applied
- Dependencies: TASK-001

## Full standard Module UI rollout
- ID: TASK-014
- Status: ready
- Priority: P2
- Horizon: Convergence
- Outcome: Every Module receives the compiler-owned Page/View/Record Detail, toolbar, context-menu, Files, and Control Panel grammar proven in the shell prototype, consuming ONE canonical View Grammar registry (table/board/gallery/form/calendar/map/graph/tree) with no informal per-Page hardcoded view lists, no View kind owning a dedicated Module/Tool/route/nav identity, and no Integration determining which View kinds a Page offers.
- Prototype test: DealPilot plus two unrelated Modules pass the complete UI architecture audit, including Form view, DB-backed-only Add/Remove Page, all standard column commands, dependency preview/undo, Files layout, accessibility, and honest empty states; additionally — a Page with a date column renders Calendar view sourced from `dataviews/views/CalendarView.tsx` with zero source-specific code (Google-Calendar-synced rows render identically to Form-created rows on the same calendar); the `/calendar` route, `InstalledModuleBoundary packageName="calendar"`, and the `tools.ts`/`moduleRoutes.ts` "calendar" catalog entries no longer exist; a Relationship People/Communities Page renders real node/edge Graph view (not the current table-with-banner placeholder) at `scope:single_database`; the scope selector expands to `scope:full` and renders the same canvas with cross-Module nodes — confirming Second Brain is this view at full scope, not a separate surface (ADR-110); a Task Manager Queue Page renders Tree view over its self-referential Task type.
- Scope: docs/raw/ui-architecture-rules-2026-07.md alignment audit; docs/raw/brd-dataengine-views-2026-07.md (full View Grammar BRD — canonical 8 View kinds, eligibility rules, feature list per kind, Calendar/Integration decoupling rule, Second-Brain-vs-Page-Graph distinction, code audit of the 2026-07-17 duplicate-implementation state)
- Evidence: BUGS map view is not a map; BUGS pin persistence only local; BUGS Initiative resource scoping; existing partial table implementation; BUGS 2026-07-17 `/calendar` route resolves to Task Manager instead of Calendar (routes.tsx:87) and Calendar modeled as an installed Module/Tool in 3+ places instead of a View kind; BUGS 2026-07-17 four independent, non-shared calendar renderers (DataEngine.tsx, CalendarPage.tsx, dataviews/CalendarView.tsx, InitiativeDetail.tsx/WorkPage.tsx local hardcodes); BUGS 2026-07-17 GraphView.tsx is a table-with-banner placeholder, not a real node/edge renderer; BUGS 2026-07-17 `ViewConfig["kind"]` code says `network`, glossary canon says `graph` — vocabulary mismatch
- Requests: table/actionability directives 2026-07-14–15; R-038 (2026-07-17: Calendar/Graph-as-view confirmation, View Grammar BRD)
- Approval: AP-010/AP-011, AP-021, and AP-029 applied; AP-036 applied (View Grammar BRD + this scope update); ADR-108 records the Calendar-decouples-from-Google-and-from-Module-identity call; AP-037 applied (Graph view scope selector + Second Brain collapse into Graph at full scope); ADR-110 supersedes ADR-108's Second-Brain-vs-Page-Graph distinction
- Dependencies: TASK-001; TASK-006; TASK-008

## Task Manager Module
- ID: TASK-021
- Status: ready
- Priority: P2
- Horizon: Core Modules
- Outcome: One installable Task Manager Module owning the single governed execution queue per workspace as ONE self-referential, dot-path-leveled Task type (no separate Goal/Initiative/Outcome Record types — `is_goal` is a field, not a type), with full tree restructuring (promote/insert-ancestor-above/re-parent) as governed proposals, exit-test verification with reopenable done/archived/parked status, planning Playbooks as draft-then-approve proposals, no-default agent-task routing owned by Chief of Staff, confidence-graduated reschedule and routing approval, proactive cross-Module opportunity scanning, guard Automations, and an agent-first `tasks.md` ledger projection consumable by external coding agents.
- Prototype test: In a real workspace, create a goal-flagged Task (`is_goal=true`) with outcomes[] and a 3-level Task tree under it (paths e.g. `1`, `1.1`, `1.1.1`) with exit tests via UI; creating a new Task against a populated queue produces an Internal-Strategist impact-fit/resequence proposal before it settles; promoting `1.1.1` to a new root (path recomputes, old ancestor untouched) and inserting a new ancestor above an existing branch both round-trip as approved proposals with correct path recomputation; an agent-assigned Task routes to whichever eligible Agent owns its required Skill (Chief of Staff resolves, no default — Capability Builder only when genuinely a capability/code Task) and an ambiguous Task escalates to explicit Human assignment; a human reschedule proposal requires approval, then a minor-banded reschedule auto-applies only after calibration while a significant one still requires approval; a done Task is reopened to pending after its outcome target changes; the projected tasks.md round-trips an external edit through drift-detect→reconcile without silent overwrite; a done-without-evidence task is reopened by the challenger; the game-designs instance's coding agent works one full task (orient→execute→evidence→done→sweep) from the projected ledger.
- Scope: docs/raw/taskmanager-module-plan-2026-07.md TM0–TM6; docs/raw/brd-taskmanager-2026-07.md; docs/raw/initiatives-taskade-research.md (verdicts bind); docs/raw/ui-architecture-rules-2026-07.md
- Evidence: docs/TASKS.md + Task Manager UI already prove the ledger model in production (AP-024/025), live at `/task-manager` with a working Status column (verified 2026-07-17); user's game-designs repo independently converged on the identical format (2026-07-16 report); RESOLVED BUGS 2026-07-18 canonical title+ID parser regression that made prebuild generate zero rows; BUGS.md 2026-07-17 pre-existing `@bridge/core` build break (unrelated, blocks a from-scratch worktree preview, not this Module's scope)
- Requests: R-035; R-036 (2026-07-16 revision: collapse Initiative/Outcome into Goal+Task, agent routing, calibrated reschedule, proactive scan, reorder after TASK-014); R-037 (2026-07-17 revision: collapse Goal into a Task field entirely, full tree restructuring, no-default CoS-owned routing, reopenable done status)
- Approval: AP-033 applied (plan+roadmap addition); AP-034 applied (revision 1); AP-035 applied (revision 2); ADR-106 records the Goal-collapse vocabulary call (supersedes ADR-105's two-Database call), ADR-107 records the no-default CoS-owned routing call (renumbered chain: this session's original AP-030/AP-031/ADR-099 → AP-033/034/ADR-105 during merge-integration → AP-035/ADR-106/ADR-107 for the further collapse and routing revision)
- Dependencies: TASK-001; TASK-012 (VOCAB2 tree migration); TASK-014 (standard Module UI); TASK-004 line for TM6 only; TASK-007 (ADR-104 SkillManifest/eligible-Agent resolution — reused by agent-task-routing)

## End-to-end runtime taint tracking
- ID: TASK-015
- Status: ready
- Priority: P3
- Horizon: Hardening
- Outcome: Trust labels propagate monotonically across retrieval, prompts, models, Skills, Actions, Events, Results, Files, storage, serialization, caches, queues, retries, and governed declassification.
- Prototype test: A tainted source traverses an Agent/Skill/Automation path without losing or weakening its label; unknown labels fail closed; sink traces explain the decision; deterministic or Human-approved declassification is audited.
- Scope: docs/raw/learning-agent-roadmap-2026-07.md RT0–RT4; docs/wiki/roadmap.md
- Evidence: root gap recorded ADR-088
- Requests: runtime taint directive 2026-07-14
- Approval: AP-020 and AP-029 applied
- Dependencies: TASK-007; TASK-012

## Database and migration correctness backlog
- ID: TASK-016
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

## Runtime and package correctness backlog
- ID: TASK-017
- Status: ready
- Priority: P3
- Horizon: Hardening
- Outcome: Package persistence/types, Helpdesk routing, browser bundling, styling, and remaining shell persistence defects are production-correct.
- Prototype test: Package state survives restart; install proposals use the right resource type; Helpdesk topics are derived/validated; browser bundle excludes Node-only sandbox code; web styling loads; persisted pins use governed storage.
- Scope: docs/BUGS.md detailed runtime evidence
- Evidence: BUGS in-memory package store; BUGS package resourceType skill; BUGS caller-supplied Helpdesk topics; BUGS Node vm browser leak; BUGS empty globals.css; BUGS client-only pin persistence; BUGS post-decision effect retry; BUGS 2026-07-16 baseline lint/typecheck failures; BUGS 2026-07-15 sensor coverage floor
- Requests: none
- Approval: none
- Dependencies: TASK-012

## DealPilot ETA core prototype
- ID: TASK-006
- Status: in_progress
- Priority: P1
- Horizon: Core Modules
- Outcome: DealPilot supports ETA work through only Deals, Sources, and Theses as default Pages, with correct many-to-many relations, secure Source credential projection, Record Detail, rights/spend gates, and thesis→source→deal discovery.
- Prototype test: Add a Thesis and observe governed Source discovery; add a Source and observe Deal discovery; inspect each Record Detail; reveal/copy a vault-backed Source credential only after Human re-authentication; verify conditional Relationship and Task columns.
- Scope: docs/raw/brd-dealpilot-2026-07.md; docs/raw/dealpilot-module-plan-2026-07.md DP0–DP1
- Evidence: user DealPilot corrections 2026-07-14–15
- Implementation evidence: [TASK-006 output](../outputs/2026-07-16-task-006-dealpilot-core-prototype.md); DealPilot 72, Google 35, focused API 8, web 49, core 421, and DB 107 tests; builds/typechecks; changed-file lint; no-dummy; final cursor/backlog/partial-provider/transactional-ack/continuation-reset/token-cycle regressions. Status stays `in_progress` pending durable Local Plane Records/vault, live Google + re-auth evidence, and desktop/375px proof.
- Requests: DealPilot requirements 2026-07-14–15
- Approval: AP-023 and AP-029 applied
- Dependencies: TASK-001

## JobPilot culture-research slice
- ID: TASK-011
- Status: ready
- Priority: P1
- Horizon: Core Modules
- Outcome: JobPilot uses permitted public evidence to improve cover letters and interview preparation without inventing insider claims or bypassing access terms.
- Prototype test: For one target company, Learning gathers permitted evidence; Internal Strategist separates fact, opinion, theme, contradiction, and inference; the user sees citations and a rights/access warning before using recommendations.
- Scope: docs/raw/brd-jobpilot-2026-07.md; docs/raw/jobpilot-module-plan-2026-07.md JP3B
- Evidence: BCG application workspace live-evidence gap
- Requests: JobPilot culture-research directive 2026-07-15
- Approval: AP-023 and AP-029 applied
- Dependencies: TASK-007

## Actionable Second Brain graph (converged into TASK-014 Graph renderer)
- ID: TASK-009
- Status: ready
- Priority: P1
- Horizon: Core Modules
- Outcome: Second Brain IS the Graph view (§3, `docs/raw/brd-dataengine-views-2026-07.md`) at `scope: full` — every permitted Database across all installed Modules, permission-filtered, same renderer as a single-Page graph. The "Second Brain" nav entry is a named preset opening Graph view at full scope. Building the real Graph renderer with scope-selector support (TASK-014) delivers this simultaneously; no separate build.
- Prototype test: From the Second Brain nav entry (Graph view, scope:full), traverse a real cross-Module Record/Relation/Event/File connection, filter by Relation type, inspect provenance/source-module, navigate to the owning Record Detail, and perform a governed Action; inaccessible nodes never render (permission-filtered); the same node/edge canvas works at scope:single-database on a Page with a relation column — confirming one renderer at all scopes.
- Scope: docs/raw/brd-dataengine-views-2026-07.md §3 (graph kind, scope_selector) + §4 (Second Brain = full scope); docs/raw/ui-architecture-rules-2026-07.md §5c; docs/raw/relationship-module-plan-2026-07.md RM6
- Evidence: BUGS 2026-07-14 no Second Brain graph; ADR-110 (Second Brain collapses into Graph view at full scope, supersedes ADR-108's "never merge" stance)
- Requests: Second Brain directive 2026-07-14; R-039 (2026-07-17 cross-module scope + collapse)
- Approval: AP-021 and AP-029 applied; AP-037 applied (convergence with TASK-014 Graph renderer)
- Dependencies: TASK-008; TASK-014 (Graph renderer with scope selector delivers this)

## Trust-first onboarding and behavioral learning prototype
- ID: TASK-002
- Status: done
- Priority: P0
- Horizon: Prototype
- Outcome: One comprehensible Onboarding flow that explains why each question matters, learns progressively under user control, and produces an immediately useful governed recommendation.
- Prototype test: A new user completes Onboarding without internal vocabulary, sees why/consequence copy for every question, supplies an admired public figure, receives a cited Learning recommendation that requires approval, can re-enter/reset Onboarding, and can skip/snooze/pause/inspect/correct/delete learned preferences; the day-7 qualities prompt is schedulable.
- Scope: docs/raw/egg-commons-feature-roadmap-2026-07.md AV1/EG3; docs/raw/bridge-foundational-agents-onboarding-2026-07.md; docs/raw/learning-agent-roadmap-2026-07.md
- Evidence: BUGS 2026-07-14 blueprint-centric onboarding (resolved 2026-07-16); BUGS onboarding re-entry (resolved 2026-07-16); BUGS Radix Dialog warning remains cosmetic and non-blocking; 2026-07-16 API/Memory/persistent-authority regressions plus native Tauri and exact 375px prototype evidence in outputs/2026-07-16-task002-onboarding-learning.md
- Requests: R-028; R-029; R-030; role-model and behavioral-learning directive 2026-07-14
- Approval: AP-020 and AP-028 applied
- Dependencies: none

## Browser companion and Avatar visual expansion
- ID: TASK-020
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

## Cross-platform release blockers
- ID: TASK-018
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

## Approved long-term optimization rollout
- ID: TASK-019
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

## Inference cost optimization: prompt caching + model tiering
- ID: TASK-022
- Status: ready
- Priority: P2
- Horizon: Core Modules
- Outcome: ModelProvider calls use Anthropic prompt caching on the stable prefix, model selection routes by cost/capability tier (cheap/default/reasoning) instead of first-registered-provider, and complete() returns usage token counts enabling cost receipts — all preserving the local-plane-never-falls-to-cloud rule.
- Prototype test: A repeated CoS turn shows non-zero cache_read_input_tokens on the second call; CoS intent classification runs on the cheap tier while a reasoning-tagged call runs on a higher tier; complete() usage is logged for at least one call site.
- Scope: platform/packages/models/src/anthropic-provider.ts; platform/packages/models/src/router.ts; platform/packages/core/src/ports.ts; platform/packages/core/src/run-context.ts; platform/packages/core/src/chief-of-staff.ts; platform/apps/api/src/router.ts (~4573); docs/raw/optimizations-memory-vm-dealpilot-plan-2026-07.md (phase 1 slice)
- Evidence: outputs/2026-07-17-llm-inference-optimization-audit.md (zero runtime prompt optimization confirmed: no cache_control, no batching, no tiering, model = providers[0])
- Requests: LLM prompt/infra optimization audit directive 2026-07-17
- Approval: AP-038 applied
- Dependencies: none

## Learning Agent governed web-research/recon Skill
- ID: TASK-023
- Status: ready
- Priority: P2
- Horizon: Convergence
- Outcome: Learning Agent's LA3 research lane gains a governed `web-research` Skill backed by a provider-agnostic `SearchProvider` port (same shape as `ModelProvider`/`MemoryStore`/`ContentGuard`), wired first to $0 Tier-1 direct-access sources (Parallel Search MCP, Jina AI keyless, DuckDuckGo Instant Answer API) with a pre-vetted Tier-2 (signup-gated free tier) and Tier-3 (paid/self-hosted-only) expansion path, and every fetched result tagged `untrusted_external` taint per PI-1/PI-2 before reaching a Memory or prompt.
- Prototype test: From a real workspace, Learning Agent runs a `web-research` Skill call for a bounded research objective, returns cited results sourced from at least one Tier-1 provider with provenance/taint recorded on the resulting Memory/Result, degrades gracefully if a provider is unavailable, and never silently escalates to a paid Tier-3 provider without a prior `docs/APPROVALS.md` cost/ROI gate.
- Scope: docs/raw/learning-agent-roadmap-2026-07.md §7 (LA3 provider survey + rollout phases)
- Evidence: outputs/2026-07-17-learning-agent-recon-search-integrations.md — 178-candidate Parallel FindAll audit (46 matched + 132 unmatched reviewed), Tier 1/2/3 classification, grouped discard reasoning
- Requests: user directive 2026-07-17 (recon-capability provider research, tiering, roadmap, task)
- Approval: AP-039 applied
- Dependencies: TASK-007 (Agent/Skill/child-Run orchestration — Skill resolution this reuses)
