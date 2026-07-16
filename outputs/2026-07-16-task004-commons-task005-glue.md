---
title: "TASK-004 Commons Closure and TASK-005 Gate Glue"
date: 2026-07-16
tasks: [TASK-004, TASK-005]
status: "TASK-004 done; TASK-005 blocked"
---

## TASK-004 outcome

TASK-004 passes its exact Prototype test. A real JobPilot need searches a local authenticated Commons, inspects signed provenance, SHA-256 content pin, and deterministic scan evidence, installs the trusted capability through governance, and renders it beneath the Application tracking Agent. The installed Skill never appears as a top-level Module.

The supply chain rejects unsigned, tampered, untrusted-key, name/version-substituted, content-colliding, hash-mismatched, unresolved or content-substituted dependency, privacy-bearing, and concurrent duplicate publication. The signed deterministic scan carries exact dependency hashes and sets an install-time governance risk floor. Commons persists its signing identity, requires authenticated publication, binds publication order into the signature, and stores no Module/workspace attachment data.

TASK-004 database state is one migration: `0011_same_cyclops.sql` adds `module_attachment` and its attachment-identity unique index. The former branch-local `0012_gifted_bucky.sql` was consolidated into 0011; 0012 stays free for TASK-007.

Live clean-registry evidence:
- Desktop `1280x720`: Module-scoped search/inspect/install; provenance/hash/scan visible; no Intelligence/marketplace route.
- Mobile `375x812`: installed need, attached Skill, owning Agent attribution, body width `375`.
- Final build `20/20`, typecheck `37/37`, no-dummy runtime gate passed.
- Affected suites: core `357/357`, Commons `19/19`, DB `68/68`, API `122/122`, web `28/28`.

## TASK-005 gate-glue delta

TASK-005 remains blocked; it is not certified or marked done.

- Ritual definitions persist one owning Agent and Plane through core, in-memory, and Drizzle stores.
- `ritual.create` rejects ambiguous multi-Agent ownership.
- `ritual.runById` checks workspace membership, derives the actor server-side, and rejects arbitrary caller actors or missing ownership.
- Migration `0013_uneven_dragon_lord.sql` backfills only singular legacy ownership and stores procedure-name Skill allowlists as `text[]`.
- DealPilot's signed Module manifest declares one generalized Ritual key. The server resolves `(Module package, Ritual key)` to Local-Plane UUIDs, confirms the installed manifest and stored owning Agent in both runtime modes, and only then tells Module Detail to expose one governed Run.
- Inventory-only Automations say runtime binding pending instead of exposing fake Actions.
- Pending-review Runs route to the existing Approvals provenance/edit/veto surfaces; no duplicate correction UI was added.

Full TASK-005 still requires TASK-003 physical macOS evidence and the combined desktop+375px Onboarding, Avatar, Module, Commons, Agent/Automation, provenance, correction, and undo certification.

## Files

Commons trust/runtime: `platform/packages/core/src/package/commons-trust.ts`, `platform/services/commons/src/{server,security-scan,privacy-gate,signing,store}.ts`, `platform/apps/api/src/{commons-client,router,wiring,built-in-packages}.ts`.

Ownership/runtime: `platform/packages/core/src/{ports,ritual-executor}.ts`, `platform/packages/core/src/memory/stores.ts`, `platform/packages/db/src/{schema,ritual-stores}.ts`, `platform/packages/db/migrations/0013_uneven_dragon_lord.sql`.

UI: `platform/apps/web/src/app/pages/ModuleDetailPage.tsx`, `platform/apps/web/src/app/components/CommonsCapabilityPanel.tsx`, `platform/apps/web/src/app/pages/ApprovalsPage.tsx`.
