---
title: "TASK-004 Commons Closure and TASK-005 Gate Glue"
date: 2026-07-16
tasks: [TASK-004, TASK-005]
status: "TASK-004 done; TASK-005 blocked"
---

## TASK-004 outcome

TASK-004 passes its exact Prototype test. A real JobPilot need searches a local authenticated Commons, inspects signed provenance, SHA-256 content pin, and deterministic scan evidence, installs the trusted capability through governance, and renders it beneath the Application tracking Agent. The installed Skill never appears as a top-level Module.

The supply chain rejects unsigned, tampered, untrusted-key, non-Ed25519, name/version-substituted, content-colliding, hash-mismatched, unresolved or content-substituted dependency, unpinned Blueprint capability reference, open/extra provenance, privacy-bearing, and concurrent duplicate publication. The signed deterministic scan carries exact dependency hashes and sets an install-time governance risk floor. Commons persists its signing identity, requires authenticated publication, binds publication order into the signature, and stores no Module/workspace attachment data.

TASK-004 database state is one migration: `0011_same_cyclops.sql` adds `module_attachment` and its attachment-identity unique index. It safely collapses only exact legacy retry duplicates, repoints lineage to the retained row, and aborts on conflicting same-identity data. The store converges sequential/concurrent retries only when canonical manifest, risk, lineage, and full content-hash attachment still match. The former branch-local `0012_gifted_bucky.sql` was consolidated into 0011; 0012 stays free for TASK-007.

Manual-risk installation now creates one stable forced-Human-review proposal. Approval activates only after rechecking the signed root/dependency closure and the current owning Module need/Agent/kind/tags; veto leaves the package private. A post-decision activation failure stays explicit and can be replayed idempotently through `packages.reconcileApproved` without a second Human decision.

Live clean-registry evidence:
- Desktop `1280x720`: Module-scoped search/inspect/install; provenance/hash/scan visible; no Intelligence/marketplace route.
- Mobile `375x812`: installed need, attached Skill, owning Agent attribution, body width `375`.
- Final integrated build/typecheck `40/40` tasks across 22 packages; no-dummy runtime gate passed.
- Final reconciliation suites: core `363/363`, Commons `22/22`, DB `81/81`, API `145/145`, web `43/43`.

## TASK-005 gate-glue delta

TASK-005 remains blocked; it is not certified or marked done.

- Ritual definitions persist one owning Agent and Plane through core, in-memory, and Drizzle stores.
- `ritual.create` rejects ambiguous multi-Agent ownership.
- `ritual.runById` checks workspace membership, derives the actor server-side, and rejects arbitrary caller actors or missing ownership.
- Legacy direct `ritual.run` is membership-gated and accepts only the authenticated member as actor; Module runtime UUIDs cannot bypass manifest/package binding.
- Migration `0013_uneven_dragon_lord.sql` backfills same-workspace singular, fully valid, non-egress legacy ownership with an explicit Local Plane. External, malformed, cross-workspace, or ambiguous legacy Automations stay unbound pending Human rebind. It translates UUID Skill allowlists to same-workspace/global procedure names and aborts rather than widening unresolved references.
- DealPilot's signed Module manifest declares one generalized Ritual key. The server resolves `(Module package, Ritual key)` to Local-Plane UUIDs, confirms the installed manifest and stored owning Agent in both runtime modes, and only then tells Module Detail to expose one governed Run.
- Inventory-only Automations say runtime binding pending instead of exposing fake Actions.
- Pending-review Runs route to the existing Approvals provenance/edit/veto surfaces; no duplicate correction UI was added.

TASK-003 physical macOS evidence completed on 2026-07-18. Full TASK-005 still requires the combined desktop+375px Onboarding, Avatar, Module, Commons, Agent/Automation, provenance, correction, and undo certification.

## Files

Commons trust/runtime: `platform/packages/core/src/package/commons-trust.ts`, `platform/services/commons/src/{server,security-scan,privacy-gate,signing,store}.ts`, `platform/apps/api/src/{commons-client,router,wiring,built-in-packages}.ts`.

Ownership/runtime: `platform/packages/core/src/{ports,ritual-executor}.ts`, `platform/packages/core/src/memory/stores.ts`, `platform/packages/db/src/{schema,ritual-stores}.ts`, `platform/packages/db/migrations/0013_uneven_dragon_lord.sql`.

UI: `platform/apps/web/src/app/pages/ModuleDetailPage.tsx`, `platform/apps/web/src/app/components/CommonsCapabilityPanel.tsx`, `platform/apps/web/src/app/pages/ApprovalsPage.tsx`.

## Coordinator merge verification

The branch was merged onto the hardened Relationship/Approvals/Helpdesk baseline. AP-030 remained the task-by-task integration directive; this task's approval was renumbered AP-031. Its ADRs were renumbered ADR-100–102.

The merge gate passed the full platform build/typecheck and core, Commons, DB, API, and web suites. Review found and closed migration compatibility defects covering UUID-to-text Skill allowlist casting, duplicate legacy package-install identities, missing Plane backfill, cross-workspace Agent references, malformed pipelines, and future-dated journal entries. It also closed open provenance, non-Ed25519 signing, unpinned Blueprint references, invalid built-in source references, stale built-in version identity, caller-controlled execution authority, missing Automation rate classification, and approval-without-installation. Real pglite tests execute both migrations and prove exact-dedup lineage preservation plus fail-closed conflicts, Skill name resolution, unresolved-reference abort, explicit local backfill, and external/`share`/malformed/cross-workspace/ambiguous ownership blocking. Changed-file lint and the no-dummy runtime gate pass; the unrelated pre-existing Zazoo lint configuration defect remains attached to TASK-017.
