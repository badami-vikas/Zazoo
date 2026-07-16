---
title: "TASK-001 Module Shell — Implementation Handoff"
date: 2026-07-16
task: TASK-001
status: done
blockers: []
---

## Outcome

TASK-001 is complete. Installed Modules now come from signed `packages.list` manifests and open a manifest-driven Module Detail with real Page/Database bindings, attributable Agent-owned Skills, Automations, Integrations, and canonical local-plane File inventory. DealPilot and JobPilot use real tRPC records and retain their standard table headers/column menus when the database is empty.

The shell has one persisted panel contract: desktop Sidebar and Chat Panel both collapse, explicitly reopen, resize by pointer or keyboard, and preserve extended widths. At 375px, Module and Chat overlays retain access to installed Modules, New, Pending work, and chat. Deprecated Tools, Knowledge, Workflows, Projects, ritual, Intelligence, and standalone Skill routes are absent; live Page routes are installation-gated.

The Tauri startup race was fixed by creating windows before setup returns. The desktop process now remains alive against the same isolated API-backed Vite client.

## Evidence

- API `4010`: health passed; four built-in Module manifests at `0.2.0` loaded as installed/available with explicit Agent→Skill and Automation bindings.
- Desktop `1280×720`: DealPilot and JobPilot inventories opened; column menu stayed inside viewport; Sidebar/Chat extended to `252px/318px`, collapsed to `76px/51px`, then reopened at persisted widths.
- Mobile `375×812`: both Module details, nested Skills, Automations, File inventory, Module drawer actions, Chat overlay, table header, and clamped column menu passed; deprecated-label denylist was empty.
- Tauri: debug app compiled, launched, and remained alive against web `5174` and API `4010`.
- Tests: core manifest `12/12`, API package/File `11/11`, web `25/25`, desktop Rust `19/19`; web typecheck/build and desktop `cargo check` passed.

## Files

Core/runtime: `platform/packages/core/src/package/{types,manifest}.ts`, `platform/apps/api/src/{built-in-packages,module-files,router,wiring}.ts`.

Shell: `platform/apps/web/src/app/{Layout,routes}.tsx`, `pages/{ModuleDetailPage,DealPilotPage,JobPilotPage,CalendarPage,ResourcesPage}.tsx`, `components/InstalledModuleBoundary.tsx`, `components/shared/{PanelControl,AgentPanel,StandardColumnMenu}.tsx`.

Desktop: `platform/apps/desktop/src-tauri/src/lib.rs`.

Broader Agent invocation enforcement, Module Run/lifecycle actions, Relationship storage migration, and server error-copy migration remain in their existing canonical follow-up tasks; they do not block the TASK-001 Prototype test.
