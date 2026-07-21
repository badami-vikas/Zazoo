# TASKS — canonical work ledger

This is the **only active execution queue**. A roadmap or plan defines scope; a bug supplies evidence; a request supplies intent; an approval supplies a gate. None of those creates a second task row. The Task Manager UI reads this file only.

## Execution order

Task Manager and Claude read this single ordered list top-to-bottom — the physical section order below IS the execution order. Status remains part of each task record: in-progress work is pulled first, pending work follows this order, and completed work is retained at the bottom for audit.

IDs for cross-reference: `TASK-001, TASK-003, TASK-004, TASK-005, TASK-013, TASK-012, TASK-010, TASK-008, TASK-007, TASK-014, TASK-021, TASK-015, TASK-016, TASK-017, TASK-006, TASK-011, TASK-009, TASK-002, TASK-020, TASK-018, TASK-019, TASK-022, TASK-023, TASK-024`

Captured from the user-provided Task Manager ranking on 2026-07-16. TASK-021 placed immediately after TASK-014 on 2026-07-16 per user directive (AP-033/AP-034). TASK-022 (inference cost optimization) appended at queue end 2026-07-17 per AP-038; TASK-023 (Learning Agent web-research Skill, renumbered from this session's original TASK-022 which collided with TASK-022 landing on main in parallel) appended immediately after per user directive (AP-039); TASK-024 (Zazoo public website) appended at queue end 2026-07-19 per AP-048 — no re-rank requested.

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
- Evidence: RESOLVED BUGS 2026-07-14 companion mobility and desktop chrome; RESOLVED BUGS 2026-07-18 physical Avatar drag inert; `outputs/2026-07-16-task-003-avatar-drag-persistence.md`; `outputs/2026-07-16-task-003-macos-avatar.md`; `outputs/2026-07-18-task-003-avatar-certification.md` (the user confirmed physical pointer drag/relaunch restoration, VoiceOver control activation, and external-display detach/reconnect)
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
- Evidence: `outputs/2026-07-18-task-005-demo-certification.md`; TASK-003 physical Avatar certification in `outputs/2026-07-18-task-003-avatar-certification.md`; clean isolated final-code `task005-final10-desktop-*` and `task005-final11-mobile-*` evidence covers Onboarding, Owl Avatar, Relationship Module, cited recommendation, signed Commons discovery/install, Learning Agent invocation, immutable package/hash/Agent provenance, correction, veto, no-downstream-event audit, preference deletion, and physically reachable mobile Settings/Approvals controls
- Implementation evidence: `outputs/2026-07-16-task004-commons-task005-glue.md`; signed `cited-role-model-practice@1.0.1` is installed only for Relationship's Learning Agent, declares only private Signal read/write with no egress, consumes an already approved local cited Signal, and fails closed unless the stored/current signed Skill contracts and exact current built-in Relationship Module identity, need, installed attachment, content hash, private scope, and runtime Agent binding all match; registry/trust drift removes the visible Run binding with an explanation; the shared classifier owner-isolates current/legacy private proposals and linked rows; Organization rename uses a generation-tagged, fsynced Local Plane intent under database row-lock serialization, re-locks to recover update/commit/crash failures, preserves ambiguous dual-root intents fail-closed, refuses conflicting/symlinked roots, supports case-only names, and migrates legacy bootstrap state through the same path
- Requests: user prototype-priority directives 2026-07-13–15
- Approval: AP-031 applied for bounded gate glue; AP-047 applied for exact TASK-005 certification and closure
- Dependencies: TASK-001; TASK-002; TASK-003; TASK-004
- Verification: 2026-07-19 uninterrupted authenticated runs on the final post-review code passed at desktop 1440×913 (`task005-final10-desktop-result.json`) and exact mobile 375×812 (`task005-final11-mobile-result.json`) with body/document widths equal to the viewport, no trace-drawer overflow, failed resources, JavaScript errors, unhandled rejections, console errors, retired visible terms, or runtime dummy data. Both fresh runs installed signed `cited-role-model-practice@1.0.1`, invoked it only through the allowed Learning Agent, edited its proposal from weekly to monthly before approval, inspected immutable provenance, vetoed a second run with no downstream Event, and deleted the learned preference. Visual review reverified the repaired Settings → Capabilities Module link and physically reachable Settings/Approvals layouts. The branch had already normally merged `origin/main@5ca30ca`; both final responsive runs therefore cover the combined TASK-005/TASK-010 code. A rebuilt release Tauri bundle launched Bridge main, Companion, and Annotate windows with a healthy authenticated managed API sidecar on the currently connected display; TASK-003 separately certifies the three-display mobility/topology matrix. Final independent review found no blockers. Final gates: API 251/251, DB 159/159, web 81/81, desktop Rust 44/44, typecheck 37/37 tasks, build 20/20 tasks, no-runtime-dummy, native release bundle, and all 36 non-Sensor test tasks forced uncached. The migration upgrade harness now bounds SQL, snapshots, and journal entries so later migration `0017` cannot suppress `0016`. The known TASK-017 Sensor aggregate-coverage debt remains 7/7 tests passing at 36.97% versus the 38% floor.

## Repository and manifest cleanup
- ID: TASK-013
- Status: done
- Priority: P2
- Horizon: Convergence
- Outcome: Duplicate prototypes, deprecated data/code paths, stale dummy records, and non-manifest built-ins are removed or explicitly retained with one reason and owner.
- Prototype test: Duplicate/source scan passes, package manifests drive built-ins, deprecated docs are marked rather than erased, dummy ledger matches every unavoidable fixture, and production/build entry points use one implementation.
- Scope: docs/raw/repo-restructure-egg-commons-2026-07.md P1–P2; docs/dummy.md
- Evidence: `outputs/2026-07-21-task013-repository-manifest-cleanup.md`; exact pre-cleanup `origin/main@7f37e17e1132ebbbee74f1c612f0e83b211139ef` preserved at verified private ref `archive/task-013-pre-cleanup-2026-07-21`; duplicate legacy roots removed from main without history rewrite or private-content inspection; root audit docs moved under `docs/raw/` with frontmatter; `platform/modules/manifests` is the one built-in catalog; API/executable/web routes derive from it; legacy Item Detail/Associations and unrouted JobPilot fixture BUGS/dummy rows resolved
- Requests: cleanup directives 2026-07-14
- Approval: AP-029 applied for planning; AP-061 applied for private archive, destructive cleanup, exact closure, and main landing
- Dependencies: TASK-005; TASK-012
- Verification: duplicate/root/source scans find no noncanonical tracked root, loose root audit doc, stale runtime fixture import, or second built-in manifest catalog; manifest, API Modules/Commons, and web tests pass; affected Module/API/web typechecks and builds pass; vocabulary and runtime-dummy guards are zero; changed-file lint passes; DB migrations are untouched. Web retains canonical Module, Relationship, DealPilot, JobPilot, Approvals, Task Manager, Graph, and Google routes with real APIs or honest empty/error states. Deterministic security/migration/RLS/cryptography fixtures remain tracked at current paths. One bounded final review found only stale TASK evidence and incorrect capability-kit codemap naming; both were corrected before closure. Repository history still contains the archived material because TASK-013 did not authorize history rewriting. GitHub Actions run `29806155556` failed all eight runner-backed jobs with zero steps and skipped installer aggregation, matching the payment-blocked runner condition; no CI success is claimed.

## Complete vocabulary migration
- ID: TASK-012
- Status: done
- Priority: P2
- Horizon: Convergence
- Outcome: Product copy, code, schema, API, Events, persisted payloads, routes, errors, and tests use the canonical glossary with time-boxed compatibility removed.
- Prototype test: CI inventory finds no forbidden identifiers outside explicit migration fixtures; backfills and compatibility deletion pass RLS/API/browser tests; visible UI contains no retired labels.
- Scope: docs/raw/vocabulary-code-migration-plan-2026-07-14.md VOCAB0–VOCAB6; docs/glossary.md
- Evidence: BUGS deprecated dummy-prefix rule; BUGS API error strings; BUGS package.yaml filename mismatch; BUGS Initiative-scoped API legacy; deprecated Tools/Knowledge/Workflows evidence attached to TASK-001; RESOLVED BUGS Module File writes indexed into canonical `files`/`file_refs` for Graph/File provenance; OPEN BUGS stale pre-VOCAB4 Signal-view write fixtures and stale pre-VOCAB3 Onboarding vocabulary assertions; [VOCAB0 inventory](raw/vocabulary-code-inventory-2026-07-19.md); [VOCAB0–VOCAB1 implementation](../outputs/2026-07-19-task012-vocab0-vocab1.md), integrated through PR #26 at source checkpoints `dd51797` and `bd7de18`; VOCAB2 source `88be310`, integrated through PR #27 at `f6c4376`; partial VOCAB3 checkpoint `58573ba` with migration `0021_vocab3_organization_module_record`; [VOCAB3 completion](../outputs/2026-07-20-task012-vocab3.md) under AP-055/ADR-129; [VOCAB4 completion](../outputs/2026-07-20-task012-vocab4.md) under AP-056/ADR-130 with migration `0023_vocab4_event_result_file`; [VOCAB5 completion](../outputs/2026-07-20-task012-vocab5.md) under AP-057/ADR-131; [VOCAB6 residual completion](../outputs/2026-07-20-task012-vocab6.md) under AP-058/ADR-132
- Requests: R-020; vocabulary/glossary directives 2026-07-14
- Approval: AP-020, AP-029, AP-050, AP-057, and AP-059 applied
- Dependencies: TASK-005
- Verification: VOCAB0 AST/lexical ratchet is wired into CI; it covers TypeScript/JavaScript public/private identifiers, ordinary/interpolated/static-composed strings and JSX text, plus Rust and non-migration SQL identifiers/strings, with only reviewed compatibility adapters excluded. Per-syntax fingerprints reject one-for-one replacement, and the reviewed-move writer refuses any family/kind occurrence increase. `Second Brain` is allowlisted only on the web UI surface, never in Engine identifiers. VOCAB1 uses canonical runtime/payload/UI identifiers, writes only `bridge.avatar.v2`, preserves one-version browser/API reads without deleting the legacy value on failed migration, strictly rejects malformed readiness values, renders every supported legacy style, and proves Avatar style cannot affect Agent tone or authority. VOCAB2 is merged through PR #27. VOCAB3 completed 2026-07-20 under AP-055: signed pre-VOCAB3 Commons entries verify against their original canonical content, Ed25519 signature, trusted key, and unchanged content-hash pin before deterministic Organization/Module/Record projection; the prior registry directory remains readable, current writes stay canonical, and cross-directory identity collisions fail closed. VOCAB4 completed 2026-07-20 under AP-056/ADR-130: migration `0023` backfills legacy Signals, Signal Actions, Timeline entries/refs, and Touchpoints into append-only Events plus Relations before dropping the parallel tables; Signal is a security-invoker Event projection and its API moved under Relationship; Timeline already reads participant-linked Events; non-file culture/application outputs are Results; signed pre-VOCAB4 Commons provenance keeps its original hash/signature through deterministic projection; Module File write/read reconciliation upserts stable `files`/`file_refs`. Fresh, upgrade, replay/no-drift, data-preservation, append-only RLS, Relationship API, Module Files, Local Plane, Result research, signed Commons, web, typecheck/build/lint, and live isolated Signals route checks passed. The ratchet fell from 793 to 360 with no family/kind increase; Artifact, Touchpoint, and Incident are zero. VOCAB5 completed 2026-07-20 under AP-057/ADR-131: Relationship manifest `0.2.2` owns primary Pages plus Relations/Interactions/Introductions/Helpdesk/Sources, upgrades `0.2.1` to legacy, and keeps Agents/Skills/Automations/Integrations attributable; Help Request APIs live only at `relationship.helpdesk`; the standalone `@bridge/helpdesk` package, top-level route, and dead local/remote browser stores are removed; shared Record/Relation/Event stores and VOCAB4 Signal invariants remain authoritative. Targeted API/web/typecheck/build/lint/no-dummy checks and isolated Chrome routes passed at 1440×900 and exact 375×812 with no overflow; the ratchet fell from 360 to 296 with no family/kind increase. VOCAB6 residual convergence completed 2026-07-20 under AP-058/ADR-132 at source `e657cc8` / PR #32: every active root Module is installation-driven in desktop/mobile navigation and Module Detail; Module Detail adds durable attributable recent Automation Runs; Skills remain nested under consuming Agents and server-owned authority; both panels share explicit collapsed/expanded/extended modes, Organization-scoped width/state, common controls, responsive overlays, and extended→expanded→collapsed Escape behavior; full Graph composes permission-pruned Records/Relations/Events/Files with active Module and Agent nodes at the API boundary, gives source edges canonical navigation, and retains the same renderer/callbacks for single-Database scope. Orphan Intelligence/standalone Skill surfaces and remaining runtime Knowledge identifiers/copy are removed. Targeted Core/DB/API/web tests, four package typechecks/builds, changed-file lint, no-dummy, vocabulary, bounded review, and isolated Chrome at 1440×900 plus exact 375×812 passed with document width equal to viewport. The ratchet fell 296→283; Knowledge is zero and the Tool family contains only two explicitly time-boxed built-in source-path strings. No schema/data change was required, so migration `0024` remains unallocated. GitHub Actions run `29740972890` failed every runner-backed job within seconds before any step and emitted no logs, matching the repository's payment-blocked runner condition; no CI success is claimed. TASK remains `in_progress` for the separate final compatibility deletion/full prototype certification.
- Closure evidence (supersedes unfinished milestone notes above): AP-059/ADR-133; migration `0024_task012_compatibility_deletion`; `outputs/2026-07-20-task012-final-closure.md`; stale GraphStore and Onboarding BUGS rows resolved; DealPilot/JobPilot package paths moved atomically to `platform/modules/`.
- Closure verification: scanner covers runtime, tests, regex literals, static compositions, Rust, and SQL and reports zero forbidden occurrences with an empty baseline. Migration `0024` passed fresh, forward, backup/restore, replay, and data-preservation checks; Event/File RLS, canonical GraphStore, API, Commons signature/tamper/collision, Local Plane, package, typecheck/build, and UI contracts passed. Chrome passed at 1440×900 and exact 375×812 with equal client/scroll/body widths, no retired labels, no runtime/network errors, Module/Agent/Automation/Event/File/Graph paths, Graph DealPilot source navigation, mobile installed-Module routes, and panel widths `220/286 → 360/520 → 220/286`.
- CI evidence: pull-request run `29744204062` failed all eight runner-backed jobs in 2–3 seconds before any step existed; installer aggregation skipped. This matches the known payment-blocked runner condition. No GitHub runner success is claimed.

## Platform red-flag correction feedback
- ID: TASK-010
- Status: done
- Priority: P1
- Horizon: Core Modules
- Outcome: Any eligible data cell or bullet supports one subtle, scoped, reversible red-flag correction that feeds governed learning.
- Prototype test: Hover/focus a cell and bullet, flag each, explain scope, undo it, inspect the audit evidence, and verify no green/yellow feedback semantics remain.
- Scope: docs/raw/ui-architecture-rules-2026-07.md §5d; docs/raw/agent-goal-skill-orchestration-plan-2026-07.md
- Evidence: user feedback-mechanism correction 2026-07-15; RESOLVED BUGS 2026-07-19 JobPilot table cells lacked Red Flag controls; [TASK-010 live-certification output](../outputs/2026-07-19-task010-live-certification.md); [TASK-010 round-1 output](../outputs/2026-07-17-task010-red-flag-feedback.md), [round-2/3 remediation](../outputs/2026-07-17-task010-review-remediation.md), [round-4 remediation](../outputs/2026-07-17-task010-round4-remediation.md), [round-5 remediation](../outputs/2026-07-17-task010-round5-remediation.md) — shared `RedFlagControl` primitive wired into TableView.tsx (data cells), JobPilotPage.tsx card view (real, persisted-application-backed rendered bullets), plus a Settings > Learning "Red flags" audit section; DealPilot/JobPilot green/yellow/red flag semantics removed (AP-023). Four coordinator-directed independent reviews found defects, all now remediated: round 1's auth/IDOR, ledger-privacy, saga/idempotency, CAS/lineage, anchor-identity, pagination, N+1, and touch-detection gaps (round 2); round 2's own idempotency-check and CAS `.cause`-unwrap bugs (round 3); round 4's 11-item list (governed-learning substance, private-proposal ownership, replay-safe create, durable clear/reopen, forget-across-lineage, canonical anchors, DB-pushed filtering, keyset pagination, hybrid touch, JobPilot flag-column normalization); and round 5's 11-item list — **legacy API containment** (CRITICAL): `onboarding.learningState`/`forgetMemory` were unauthenticated/owner-unscoped with no kind filter, leaking (and allowing deletion of) private red-flag/preference-adjustment content — now authenticated, owner-scoped, kind-whitelisted; **owner-aware DB RLS** (CRITICAL) — investigated and documented (not fabricated): the ledger's workspace-wide RLS lets a direct-Supabase client bypass tRPC's private-proposal filter (bounded existence/metadata leak, not raw content — round 4 already made the ledger payload opaque); the ONE offending client read path (`apps/web/src/app/data/ledger.ts`'s `loadLedger()`) and the exact fix (new RLS policy + a new paginated/filtered ledger-listing tRPC procedure) are tracked in `docs/BUGS.md`, both blocked on RM4; **shipped enactment** — the UI now checks `action.resolution` on-demand and calls `enactCorrection`, so no approved correction is stranded without a trigger; **proposal-ID correctness** — a thrown (not merely rejected) governed-learning attempt no longer persists an unconfirmed `proposalId`, and clear/forget now treat a confirmed-absent ledger entry as already-withdrawn; **saga hardening** — a genuine concurrent `updateReason`-vs-`clear` race is now CAS-protected and tested; **canonical anchor registry finished** — a single shared `canonicalModuleId` alias-normalizer feeds BOTH hashing and validation (an alias can never fork a lineage), the unrouted fixture-only `JobPilotApplicationDetail.tsx` had its red-flag wiring removed entirely (would always fail-closed), `TableView.tsx` gates on a new client-side supported-module allowlist (excludes `signal`, which has no existence-check store yet), and `JobPilotPage.tsx`'s Card view now ships the REQUIRED real, persisted-application-backed rendered-bullet surface (`Stage`/`Fit` bullets); **durable lineage ordering** — the process-local monotonic-timestamp limitation (cross-instance/restart) is now explicitly documented with the exact planned DB-backed fix, blocked on RM4; **safe structured filtering** — a confirmed-reproducible `content::jsonb` cast failure (Postgres doesn't guarantee AND-clause evaluation order) fixed via a SQL-standard-guaranteed `CASE WHEN content IS JSON` construct; **status-predicate-before-limit** pushed into the store query; **cross-process idempotency** — the shared workspace Goal's provisioning is now deterministic/race-safe (was a check-then-act race with a random id), and `casSupersede` now also catches a genuine `23505` unique-violation (a deterministic-id collision under real concurrency, distinct from the `40001` serialization-failure case it already caught) as a CAS loss, not an unhandled 500; **provider state integrity** — `RedFlagProvider` now distinguishes loading/error/empty (a failed refresh preserves last-good rows instead of clearing them), guards against out-of-order overlapping refresh responses via a generation counter, and disables `create()` until the first successful load. Round 6 (independent review of round 5 + reconciliation with TASK-008 RM4's now-landed migration `0015`): a fresh review verified all 11 round-5 items and flagged 2 non-blocking follow-ups (a docs/BUGS.md accuracy correction; `RedFlagProvider`'s `error` state gained a `retryLoad()` affordance), both fixed. RM4 landed with its own relation-proposal privacy mechanism (`assertRelationshipProposalOwner`, a new `action.listHistory` endpoint, `privateOwnerUserId`-based store-level filtering) — reconciled surgically: TASK-010's own `inputs.visibility === "private"` red-flag privacy check now composes alongside RM4's relation-specific check rather than duplicating it, and the underlying store-level filter is being widened (not replaced) to cover both. Re-verified: core 426, DB 121, API 211 (54 red-flag/security tests across all rounds), JobPilot 94, DealPilot 72, Commons 22, integrations-google 35, web 64 tests, full monorepo build (20/20) and typecheck (37/37) clean, full serialized test run 36/37 green (the one failure is `@bridge/sensors`'s pre-existing, already-documented, unrelated coverage-floor gap), lint clean on every session-touched file (2 pre-existing unrelated repo-wide findings untouched), no-dummy-runtime clean. A pre-existing, unrelated dummy-data instance (`JobPilotApplicationDetail.tsx`'s unrouted `BCG_APPLICATION` fixture) was discovered and logged to `docs/dummy.md`, and its red-flag wiring removed since the page is unreachable. Outstanding before this task can close: live desktop+375px browser evidence of the actual hover/focus/click/touch interaction, and the post-RM4 migration (owner-aware RLS, DB-backed lineage revision, JobPilot flag backfill) now in progress. Round 7 (post-TASK-008-RM4, [round-7 output](../outputs/2026-07-18-task010-round7-post-rm4-migration.md)): merged `origin/main` (`590cca6`) and reconciled surgically with RM4's own relation-proposal privacy mechanism, finding and fixing a genuine post-merge leak (RM4's new endpoints would have exposed red-flag proposals to every workspace member — widened the shared private-proposal filter to cover both privacy markers) and a merge-tool duplicate-member bug. Implemented the reserved migration `0016_new_ink`: JobPilot flag backfill+CHECK constraint; owner-aware RLS for `memories` (mirroring the existing app-side scope split); `memories.lineage_revision` WIRED end-to-end (atomically allocated per-lineage inside `casSupersede`'s own CAS transaction in both adapters; `redFlag.history` now orders by it). `ledger`'s own RLS deliberately left unchanged, matching RM4's own considered precedent (no caller-identity parameter on its read ports, broad call surface) — reported as an open, scoped gap, not silently deferred. Also fixed two build-tooling bugs surfaced by full-build verification: RM4's TASKS.md reformat had silently broken the Task Manager's `pending-work` generator (now fixed + regenerated, 22 records); a commons test wrote temp fixtures inside the repo tree instead of the OS tmpdir (fixed). Re-verified: core 430, DB 143, API 214, web 64, commons 22 tests, full monorepo typecheck (22/22)/build (23/23) clean, lint clean (2 pre-existing unrelated findings untouched), no-dummy-runtime clean, migration 0016 fresh+upgrade/no-drift tests pass. Outstanding unchanged: live desktop+375px browser evidence; additionally now open: `ledger`'s own RLS (deliberately deferred) and a dedicated two-member RLS test for the new `memories` policy. A fresh independent review verdict was **merge-ready** with 2 non-blocking findings, both fixed same day: a dangling `docs/BUGS.md` cross-reference ("see the NEW entry below" pointing to a never-added entry) corrected; and the flagged missing two-member RLS test for `memories` added (`packages/db/test/rls.test.ts`, using the existing `bridge_rls_member` restricted-role pattern) — proves public/workspace/team/private/restricted scope visibility AND that UPDATE/DELETE (not just SELECT) are RLS-narrowed by real ownership under Postgres itself, re-verified: DB 144/144 (+1).
- Requests: red-flag directive 2026-07-15
- Approval: AP-023, AP-029, and AP-046 applied
- Dependencies: TASK-001; TASK-007
- Verification: 2026-07-19 exact Prototype test passed against authenticated persistent Local Plane data. At 1280×720, keyboard focus and pointer hover revealed the subtle control; a real BCG application cell and rendered bullet were flagged, scoped with reasons, cleared, and visible in Settings > Learning audit history. At emulated 375×812 with coarse pointer/touch enabled, the control exposed a 44px-equivalent hit area, completed flag→inspect→clear, and retained its audit row. No green/yellow feedback semantics rendered.

## Relationship Module consolidation
- ID: TASK-008
- Status: done
- Priority: P1
- Horizon: Core Modules
- Outcome: Relationship is one standard Module with Signals, People, and Communities as primary toggles and shared Record/Relation/Event behavior.
- Prototype test: ✅ Open Relationship from nav, navigate Signals/People/Communities, follow a Signal to its Person/Community participants and source Event, and take a safe governed Action without entering a global Knowledge surface.
- Scope: docs/raw/relationship-module-plan-2026-07.md RM0–RM6; docs/raw/ui-architecture-rules-2026-07.md
- Evidence: The exact installed Relationship → Signals/People/Communities → Signal → Person/Community participants → source Event → governed Action prototype is integrated on `main`, with no global Knowledge route or surface. RM0 and RM4 landed at `590cca6` with `outputs/2026-07-16-task-008-relationship-module-consolidation.md`, desktop + 375px live evidence, migration `0015_task008_relation_contract`, owner-isolated Relation/effect RLS, deterministic bounded Relation reads, and durable approval-effect retry/reconciliation. The validated RM1–RM5 continuation and central trust-boundary hardening landed through `bab32ea`: owner-safe Person/Community CRUD/search/detail; participant Timeline and bounded Google/capture identity review; Memory correction/forget, commitment Event snapshots, meeting prep/follow-up; visibility-pruned paths and Community composition; double-consent Introduction Event snapshots with private decline handling and no send; self-only Local browser authority; owner-scoped private PII/Event detail; replay-safe durable staging/materialization; serialized Introduction/Memory transitions; explicit clears, canonical datetime input, and route-safe snapshot pagination. Final evidence: `outputs/2026-07-18-task-008-relationship-continuity.md`; post-main-merge core 430, DB 154, Google 39, API 218, web 69 (910 affected tests); monorepo typecheck/build; changed-file lint, no-dummy, migration no-drift, diff integrity, and independent correctness/security reviews with no blocker. Historical RM4 worktree reconciliation landed at `3741a41`, confirming `ff98c20` and `905aee9` were already ancestors and regenerating fresh-session Task Manager evidence without re-merging code. TASK-014/TASK-009 retain the separate cross-Module Graph renderer; advanced RM6/evaluation capabilities remain future plan scope, not blockers for this completed TASK-008 prototype.
- Requests: Relationship alignment directive 2026-07-14
- Approval: AP-020, AP-021, AP-029, AP-030, AP-042, and AP-043 applied
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
- Status: done
- Priority: P2
- Horizon: Convergence
- Outcome: Every Module receives the compiler-owned Page/View/Record Detail, toolbar, context-menu, Files, and Control Panel grammar proven in the shell prototype, consuming ONE canonical View Grammar registry (table/board/gallery/form/calendar/map/graph/tree) with no informal per-Page hardcoded view lists, no View kind owning a dedicated Module/Tool/route/nav identity, and no Integration determining which View kinds a Page offers.
- Prototype test: DealPilot plus two unrelated Modules pass the complete UI architecture audit, including Form view, DB-backed-only Add/Remove Page, all standard column commands, dependency preview/undo, Files layout, accessibility, and honest empty states; additionally — a Page with a date column renders Calendar view sourced from `dataviews/views/CalendarView.tsx` with zero source-specific code (Google-Calendar-synced rows render identically to Form-created rows on the same calendar); the `/calendar` route, `InstalledModuleBoundary packageName="calendar"`, and the `tools.ts`/`moduleRoutes.ts` "calendar" catalog entries no longer exist; a Relationship People/Communities Page renders real node/edge Graph view (not the current table-with-banner placeholder) at `scope:single_database`; the scope selector expands to `scope:full` and renders the same canvas with cross-Module nodes — confirming Second Brain is this view at full scope, not a separate surface (ADR-110); a Task Manager Queue Page renders Tree view over its self-referential Task type.
- Scope: docs/raw/ui-architecture-rules-2026-07.md alignment audit; docs/raw/brd-dataengine-views-2026-07.md (full View Grammar BRD — canonical 8 View kinds, eligibility rules, feature list per kind, Calendar/Integration decoupling rule, Second-Brain-vs-Page-Graph distinction, code audit of the 2026-07-17 duplicate-implementation state)
- Evidence: RESOLVED BUGS 2026-07-17 Calendar Module/Tool route identity, four independent Calendar renderers, placeholder Graph renderer, `network` vocabulary mismatch, grouped-list Map fallback, divergent migration high-water, and concurrent Organization rename/File upload; one metadata-gated registry now owns table/board/gallery/form/calendar/map/graph/tree; `DataViews` is the only renderer path; Map uses a bundled local basemap plus stored coordinate contract and an opt-in Local Plane geocoder port with no automatic public geocoding/tile egress; DealPilot, JobPilot, Relationship, Work, Initiative, and Task Manager consume the shared grammar; [TASK-014/TASK-009 implementation and live evidence](../outputs/2026-07-19-task009-task014-view-grammar-graph.md)
- Requests: table/actionability directives 2026-07-14–15; R-038 (2026-07-17: Calendar/Graph-as-view confirmation, View Grammar BRD)
- Approval: AP-010/AP-011, AP-021, AP-029, AP-036, AP-037, AP-050, and AP-051 applied; ADR-108 records the Calendar-decouples-from-Google-and-from-Module-identity call; ADR-110 supersedes ADR-108's Second-Brain-vs-Page-Graph distinction; ADR-124 records Map's Local Plane privacy boundary
- Dependencies: TASK-001; TASK-006; TASK-008
- Verification: 2026-07-19 exact desktop and 375×812 live audit passed against authenticated isolated API/web processes. All eight canonical View kinds rendered through the shared registry; Calendar and Graph tabs were exercised through pointer input; Calendar has no route/package/catalog identity; Task Manager rendered Tree; Map plots private structured coordinates on a bundled local basemap, clusters/searches/opens Records, keeps labels unresolved without a provider, and requires a Human-triggered loopback provider before any label resolution; standard column commands and DB-backed-only Page commands remained capability-aware and destructive schema mutations stayed disabled rather than bypassing dependency preview/confirmation/undo; Module Files and honest empty states rendered without document overflow. Core/Tables/DealPilot/JobPilot/DB/API/Web affected builds and suites passed. Post-merge regressions prove TASK-005 privacy backfill from the former local migration high-water and serialize File upload with Organization rename.

## Task Manager Module
- ID: TASK-021
- Status: in_progress
- Priority: P2
- Horizon: Core Modules
- Outcome: One installable Task Manager Module owning the single governed execution queue per workspace as ONE self-referential, dot-path-leveled Task type (no separate Goal/Initiative/Outcome Record types — `is_goal` is a field, not a type), with full tree restructuring (promote/insert-ancestor-above/re-parent) as governed proposals, exit-test verification with reopenable done/archived/parked status, planning Playbooks as draft-then-approve proposals, no-default agent-task routing owned by Chief of Staff, confidence-graduated reschedule and routing approval, proactive cross-Module opportunity scanning, guard Automations, and an agent-first `tasks.md` ledger projection consumable by external coding agents.
- Prototype test: In a real workspace, create a goal-flagged Task (`is_goal=true`) with outcomes[] and a 3-level Task tree under it (paths e.g. `1`, `1.1`, `1.1.1`) with exit tests via UI; creating a new Task against a populated queue produces an Internal-Strategist impact-fit/resequence proposal before it settles; promoting `1.1.1` to a new root (path recomputes, old ancestor untouched) and inserting a new ancestor above an existing branch both round-trip as approved proposals with correct path recomputation; an agent-assigned Task routes to whichever eligible Agent owns its required Skill (Chief of Staff resolves, no default — Capability Builder only when genuinely a capability/code Task) and an ambiguous Task escalates to explicit Human assignment; a human reschedule proposal requires approval, then a minor-banded reschedule auto-applies only after calibration while a significant one still requires approval; a done Task is reopened to pending after its outcome target changes; the projected tasks.md round-trips an external edit through drift-detect→reconcile without silent overwrite; a done-without-evidence task is rejected/reopened by the challenger; the `badami-vikas/Corporate-training-sims` instance's coding agent works one full task (orient→execute→evidence→done→sweep) from the projected ledger.
- Scope: docs/raw/taskmanager-module-plan-2026-07.md TM0–TM6; docs/raw/brd-taskmanager-2026-07.md; docs/raw/initiatives-taskade-research.md (verdicts bind); docs/raw/ui-architecture-rules-2026-07.md
- Evidence: docs/TASKS.md + Task Manager UI already prove the ledger model in production (AP-024/025); Bridge implementation checkpoint `c708017` adds one recursive Task Database and migration `0027`. Corporate PR #102/merge `d24e76b` completed a real queue-integrity Task and found three Bridge blockers; source `a0da415`, signed `task-manager@1.0.1` package `c32bc20`, and migration `0028` resolve them. Stricter file-backed recertification at Corporate PR #103/merge `4d6ae1c` proved same-process projection/sweep/signed install/trust controls/routing, then found four restart/identity/age blockers. Source checkpoint `689fca0` resolves all four: durable-local Drizzle Automation definitions/Runs and Module installations/`commonsSource`; UUID installation identity plus explicit stable UUID ledger mapping for legacy `pkginst_*`; and semantic projection updates preserving unchanged completed Task version/timestamp/evidence, including root-swap parent resolution from projected paths. Exact two-instance PGlite tests recover proposal/Run and complete Human decision, recover signed root plus approved/promoted next version without registry refetch, execute cap and age sweeps, and retain untouched completed timestamps. No migration `0029`: existing durable schema already stores UUID installation IDs and both affected durable tables. Targeted Core/DB/local/API/Commons/manifest/RLS/build/type/lint/policy checks pass; one bounded review's moved-root finding is fixed. GitHub Actions remain payment-blocked and no CI success is claimed. Exact remaining gate: rerun the external PASS contract in `outputs/2026-07-21-task021-task-manager-bridge.md`; do not mark done from Bridge-only evidence.
- Requests: R-035; R-036 (2026-07-16 revision: collapse Initiative/Outcome into Goal+Task, agent routing, calibrated reschedule, proactive scan, reorder after TASK-014); R-037 (2026-07-17 revision: collapse Goal into a Task field entirely, full tree restructuring, no-default CoS-owned routing, reopenable done status)
- Approval: AP-033 applied (plan+roadmap addition); AP-034 applied (revision 1); AP-035 applied (revision 2); AP-062 applied (Bridge implementation milestone and Corporate-training-sims remaining gate); AP-064 applied (first external-blocker remediation); AP-065 applied (Local Plane restart remediation and recertification landing); ADR-106 records Goal collapse; ADR-107 no-default routing; ADR-136 storage/governance/projection; ADR-138 durable effects/signed root install; ADR-139 durable-local composition, Module UUID identity, and semantic projection reconciliation.
- Dependencies: TASK-001; TASK-012 (VOCAB2 tree migration); TASK-014 (standard Module UI); TASK-004 line for TM6 only; TASK-007 (ADR-104 SkillManifest/eligible-Agent resolution — reused by agent-task-routing)

## End-to-end runtime taint tracking
- ID: TASK-015
- Status: ready
- Priority: P3
- Horizon: Hardening
- Outcome: Trust labels propagate monotonically across retrieval, prompts, models, Skills, Actions, Events, Results, Files, storage, serialization, caches, queues, retries, and governed declassification.
- Prototype test: A tainted source traverses an Agent/Skill/Automation path without losing or weakening its label; unknown labels fail closed; sink traces explain the decision; deterministic or Human-approved declassification is audited.
- Scope: docs/raw/learning-agent-roadmap-2026-07.md RT0–RT4; docs/wiki/roadmap.md
- Evidence: root gap recorded ADR-088. Planning session (`docs/Progress from Manish/subagent-progress.md` TASK-015 row) confirmed this is not greenfield: PI-1/PI-2/PI-3 already ship a partial version — `TrustOrigin` 3-value tag (`packages/core/src/types.ts`), an equality-based tainted-egress gate (`packages/core/src/policy/taint-egress.ts`), and a quarantine `ContentGuard` (`packages/core/src/guard/content-guard.ts`). Concrete gaps a future RT0–RT4 implementation must close: `DomainEvent`/`events`/`signals`/`files` carry no taint field at all today; `SkillOutput`/`RitualStep` carry none, so an Automation/Ritual step seeded from a tainted Signal can silently lose its label; there is no lattice/join (today's check is a single equality test, not a monotonic combine); no sink registry or CI coverage gate; no declassification audit trail; `packages/sourcing/src/types.ts` hand-duplicates the `TrustOrigin` union instead of importing it (drift risk); cache/retry paths in `integrations-google` are untested for taint preservation. Post-TASK-007 landing, `ChildAgentRun.taint` (`packages/db/src/child-agent-run-store.ts`) already exists but is still typed as the legacy 3-value `TrustOrigin` — RT0's lattice must upgrade this field additively, not replace it out from under TASK-007's landed contract.
- Requests: runtime taint directive 2026-07-14
- Approval: AP-020 and AP-029 applied
- Dependencies: TASK-007 (done); TASK-012 (now `in_progress` and remains the blocking gate; `ResourceType` in `packages/core/src/types.ts` still uses pre-pivot vocabulary, confirming RT-series work should not start authoring schema/types before TASK-012 renames it)

## Database and migration correctness backlog
- ID: TASK-016
- Status: ready
- Priority: P3
- Horizon: Hardening
- Outcome: Known schema, migration, identity-upsert, UUID-validation, and concurrent-test defects are corrected with regression coverage.
- Prototype test: Location enum matches all consumers; identity upsert uses a valid conflict target; migration snapshots round-trip without re-emitting old DDL; invalid UUIDs return typed errors; DB suite passes under supported concurrency.
- Scope: docs/BUGS.md detailed database evidence
- Evidence: BUGS location enum; BUGS partial dedup conflict; BUGS incomplete Drizzle metadata; BUGS pglite invalid UUID; BUGS concurrent DB flake; RESOLVED 2026-07-19 Supabase least-privilege runtime role and transaction-local Organization/user RLS context, migration `0022_supabase_runtime_role`, and focused recovery evidence in [Supabase cloud deployment readiness](../outputs/2026-07-19-supabase-cloud-deployment-readiness.md); AP-063 public-cloud RLS/provider certification is TASK-006 evidence only and does not close this backlog
- Requests: none
- Approval: AP-054 applied for the Supabase runtime-role/RLS slice; none for the remaining backlog
- Dependencies: TASK-012

## Runtime and package correctness backlog
- ID: TASK-017
- Status: ready
- Priority: P3
- Horizon: Hardening
- Outcome: Package persistence/types, Helpdesk routing, browser bundling, styling, and remaining shell persistence defects are production-correct.
- Prototype test: Package state survives restart; install proposals use the right resource type; Helpdesk topics are derived/validated; browser bundle excludes Node-only sandbox code; web styling loads; persisted pins use governed storage.
- Scope: docs/BUGS.md detailed runtime evidence
- Evidence: BUGS in-memory package store; BUGS package resourceType skill; BUGS caller-supplied Helpdesk topics; BUGS Node vm browser leak; BUGS empty globals.css; BUGS client-only pin persistence; BUGS post-decision effect retry; BUGS 2026-07-16 baseline lint/typecheck failures; BUGS 2026-07-15 sensor coverage floor; BUGS 2026-07-19 paginated Relationship Views filter/sort only the loaded page; RESOLVED 2026-07-19 API container build/readiness and exact hosted Supabase Auth admission, documented in [Supabase cloud deployment readiness](../outputs/2026-07-19-supabase-cloud-deployment-readiness.md); AP-063 Render Blueprint/public-cloud boundary is a landed slice only and does not close the remaining prototype
- Requests: none
- Approval: AP-054 applied for the Supabase container/Auth slice; none for the remaining backlog
- Dependencies: TASK-012

## DealPilot ETA core prototype
- ID: TASK-006
- Status: blocked
- Priority: P1
- Horizon: Core Modules
- Outcome: DealPilot supports ETA work through only Deals, Sources, and Theses as default Pages, with correct many-to-many relations, secure Source credential projection, Record Detail, rights/spend gates, and thesis→source→deal discovery.
- Prototype test: Add a Thesis and observe governed Source discovery; add a Source and observe Deal discovery; inspect each Record Detail; reveal/copy a vault-backed Source credential only after Human re-authentication; verify conditional Relationship and Task columns.
- Scope: docs/raw/brd-dealpilot-2026-07.md; docs/raw/dealpilot-module-plan-2026-07.md DP0–DP1
- Evidence: user DealPilot corrections 2026-07-14–15
- Implementation evidence: [core prototype](../outputs/2026-07-16-task-006-dealpilot-core-prototype.md); [durable Local Plane closure](../outputs/2026-07-18-task-006-dealpilot-local-durability.md); [Supabase deployment readiness](../outputs/2026-07-19-supabase-cloud-deployment-readiness.md); [live desktop-local Supabase continuation](../outputs/2026-07-20-task006-supabase-continuation.md). Prior code landed at `7f44186` under AP-045; deployment work landed under AP-054. The 2026-07-20 continuation created one free `us-east-1` Supabase project, activated one exact pilot subject, applied migrations through `0026`, proved least-privilege `bridge_app`, policy-backed RLS/cross-Organization denial/context reset, exact pilot `200`, service credential `401`, zero cloud rows for private Local Plane surfaces, and restart durability. It restored the real AppKit `NSWorkspace` API, made desktop residency/RLS posture explicit, aligned Supabase automatic RLS without weakening policy-backed tables, and added create-time password inputs that route Source credentials directly to the OS-vault API. Live ETA evidence created real Theses plus a rights-attested/spend-capped BizBuySell Source; Human approval materialized a symmetric Source↔Thesis Relation; Record Details, conditional Task column, desktop `1440×900`, and exact `375×812` passed. Status is `blocked` under AP-060: exact unblock requires an authorized real Source credential plus configured/authorized Google OAuth, then live Gmail/BizBuySell Deal discovery and credential reveal/copy/revoke/expiry/wrong-Human proof. The runtime password exposed by terminal transport was immediately rotated to a generated Keychain-only value; its value is absent from committed evidence. Signing and physical-mobile certification remain unclaimed.
- Render deployment evidence: [free Render deployment](../outputs/2026-07-21-render-free-deployment.md). AP-063 adds one free Virginia Docker API plus one free static site. `public-cloud` mode has no disk/vault/credential keys, denies private procedures and Google token persistence, derives exact service origins, and allows only Supabase-backed shell calls plus explicit-public governed Actions. Repository config landed, but live Render creation is externally blocked until a repository owner/admin grants the Render GitHub App access to the private repo. TASK-006 remains blocked on the unchanged Google/Source credential gate.
- Requests: DealPilot requirements 2026-07-14–15
- Approval: AP-023, AP-029, AP-044, AP-045, AP-054, AP-060, and AP-063 applied
- Dependencies: TASK-001

## JobPilot culture-research slice
- ID: TASK-011
- Status: done
- Priority: P1
- Horizon: Core Modules
- Outcome: JobPilot uses permitted public evidence to improve cover letters and interview preparation without inventing insider claims or bypassing access terms.
- Prototype test: For one target company, Learning gathers permitted evidence; Internal Strategist separates fact, opinion, theme, contradiction, and inference; the user sees citations and a rights/access warning before using recommendations.
- Scope: docs/raw/brd-jobpilot-2026-07.md; docs/raw/jobpilot-module-plan-2026-07.md JP3B
- Evidence: BCG application workspace live-evidence gap; `outputs/2026-07-17-jobpilot-culture-research-task011.md` (full round-by-round evidence: two-phase intent-then-approve-then-fetch lifecycle, pinned-DNS/manual-redirect SSRF guard, server-owned source registry, cross-instance CAS/distributed cancellation/lease-recovery, grounding DAG with quote/hash verification, artifact taint/expiry/retention, and the final central-merge-review closure — durable child-Run terminal-audit repair plus full-lineage artifact purge/redaction, in-memory and Drizzle parity, restart-durability proof)
- Requests: JobPilot culture-research directive 2026-07-15
- Approval: AP-023, AP-029, and AP-049 applied
- Dependencies: TASK-007
- Verification: 2026-07-19 exact Prototype test passed for Boston Consulting Group: `cultureResearch.propose` resolved only server-owned registry sources, `action.decide` approval gated the real fetch (veto/no-decision guarantees zero network calls), the guarded fetch ran through the pinned-DNS/bounded-redirect/byte-capped SSRF guard, and `cultureResearch.synthesize` produced a well-grounded claim (rejecting an absent-quote claim and a mutated-hash claim) exposed via `synthesisResult` with citations, contradictions, and a rights/access disclosure gating recommendations. 13+ rounds of independent/coordinator security review closed every raised defect; the final round closed a HIGH child-Run terminal-audit-durability gap and a MEDIUM artifact-retention privacy gap, then merged `origin/main` forward twice (through TASK-010's red-flag correction and TASK-005's demo certification) with a fresh independent review of the reconciliation finding no defects. Full gates: monorepo build 21/21, typecheck 39/39, `@bridge/core` 449/449, `@bridge/db` 169/169, `@bridge/jobpilot` 125/125, `@bridge/net-guard` 24/24, `@bridge/api` 312/312, `@bridge/local` 10/10, `@bridge/commons` 22/22, `@bridge/web` 93/93, no schema drift, no-runtime-dummy clean, lint's 2 findings confirmed pre-existing/unrelated.

## Actionable Second Brain graph (converged into TASK-014 Graph renderer)
- ID: TASK-009
- Status: done
- Priority: P1
- Horizon: Core Modules
- Outcome: Second Brain IS the Graph view (§3, `docs/raw/brd-dataengine-views-2026-07.md`) at `scope: full` — every permitted Database across all installed Modules, permission-filtered, same renderer as a single-Page graph. The "Second Brain" nav entry is a named preset opening Graph view at full scope. Building the real Graph renderer with scope-selector support (TASK-014) delivers this simultaneously; no separate build.
- Prototype test: From the Second Brain nav entry (Graph view, scope:full), traverse a real cross-Module Record/Relation/Event/File connection, filter by Relation type, inspect provenance/source-module, navigate to the owning Record Detail, and perform a governed Action; inaccessible nodes never render (permission-filtered); the same node/edge canvas works at scope:single-database on a Page with a relation column — confirming one renderer at all scopes.
- Scope: docs/raw/brd-dataengine-views-2026-07.md §3 (graph kind, scope_selector) + §4 (Second Brain = full scope); docs/raw/ui-architecture-rules-2026-07.md §5c; docs/raw/relationship-module-plan-2026-07.md RM6
- Evidence: RESOLVED BUGS 2026-07-14 no Second Brain graph and 2026-07-17 placeholder Graph renderer; ADR-110; `DrizzleGraphStore.listFullGraph` projects permission-pruned Record/Relation/Event/File nodes with provenance; authenticated `/second-brain` uses the shared Graph renderer at full scope; [TASK-014/TASK-009 implementation and live evidence](../outputs/2026-07-19-task009-task014-view-grammar-graph.md)
- Requests: Second Brain directive 2026-07-14; R-039 (2026-07-17 cross-module scope + collapse)
- Approval: AP-021, AP-029, AP-037, and AP-047 applied
- Dependencies: TASK-008; TASK-014 (Graph renderer with scope selector delivers this)
- Verification: 2026-07-19 exact Prototype test passed. An authenticated isolated Local Plane rendered one connected File→Person←Initiative plus Event→Person/Event→Signal cross-Module component with source Module and provenance; filtering to `file_reference` showed 2 matching nodes and 1 matching Relation; the Person node opened its owning Record Detail; the Signal node applied a governed Action; a private-node DB regression proved inaccessible Records and their incident edges never render. The same canvas passed single-Database and full scopes at desktop and 375×812 with no document overflow.

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

## Zazoo public website cinematic implementation
- ID: TASK-024
- Status: done
- Priority: P2
- Horizon: Public Brand
- Outcome: The public Zazoo homepage is one continuous, accessible day-in-the-life film that shows Aeva and the Zazoo crew working, coordinating, respecting permission, supporting the owner's progress, resting privately, and returning the next morning, with displayed copy strictly separated from visual, animation, interaction, emotion, and transition direction.
- Prototype test: At desktop and 375px widths, play the homepage from hero through final morning; confirm every mandatory scene and transition in the storyboard occurs in order, every interaction works by pointer and keyboard/touch, reduced-motion preserves the narrative without continuous locomotion, only approved Copy text is visible, the dictionary contains no Origin entry and uses the approved AI-companion definition, and no rejected-PDF composition or invented CTA/service copy appears.
- Scope: outputs/2026-07-19-zazoo-website-storyboard/README.md; outputs/2026-07-19-zazoo-website-storyboard/00-global-build-contract.md; outputs/2026-07-19-zazoo-website-storyboard/01-hero-working-world.md through 10-morning-and-final-invitation.md
- Evidence: user-supplied intended brief and rejected five-page PDF audit summarized in outputs/2026-07-19-zazoo-website-storyboard/README.md; implementation, exact verification, publication, and rollback evidence in outputs/2026-07-19-task024-zazoo-website-implementation.md; source `relationship-os@932ed80` remains merged, while user-directed Pages revert `badami-vikas/badami-vikas.github.io@6b76466` restored the pre-TASK-024 homepage at `https://zazoo.me` through successful run `29683837490`
- Requests: user website/brand storyboard directive 2026-07-19; dictionary-copy correction and task-update directive 2026-07-19; GitHub Pages publication directive 2026-07-19; GitHub Pages rollback directive 2026-07-19
- Approval: AP-048 applied; AP-052 applied; AP-053 applied
- Dependencies: none
