---
title: "TASK-001 Module Shell — Implementation Handoff"
date: 2026-07-16
task: TASK-001
status: in_progress
blockers:
  - Live viewport checks (desktop + 375px) not verifiable without browser session
  - packages.list must return available packages for nav to populate (requires running API)
  - No real agent.list API — Chief of Staff binding is static until agents API ships
---

## What was delivered

### New files
| File | Purpose |
|------|---------|
| `platform/apps/web/src/app/components/shared/PanelControl.tsx` | Shared `usePanelControl` hook + `ResizeHandle` + `CollapseToggleButton` (§5b) |
| `platform/apps/web/src/app/pages/ModuleDetailPage.tsx` | Manifest-driven Module Detail at `/module/:moduleId` with 7 canonical sections |
| `platform/apps/web/test/module-detail.test.mjs` | 14 focused pure-logic tests for module detail + panel control algorithms |

### Modified files
| File | Change |
|------|--------|
| `platform/apps/web/src/app/routes.tsx` | Added `module/:moduleId → ModuleDetailPage` route |
| `platform/apps/web/src/app/Layout.tsx` | Modules from `packages.list` API; deprecated nav items removed; PanelControl shared hook |
| `platform/apps/web/src/app/components/shared/AgentPanel.tsx` | Refactored to use shared PanelControl; storage keys v1→v2 |
| `platform/apps/web/src/app/pages/IntelligencePage.tsx` | Removed Tools, Workflows, standalone Skills sections; SECTIONS → 4 items |
| `docs/log.md` | Appended TASK-001 change entry |

---

## Module Detail sections (§4b)

Each `/module/:moduleId` page renders:
1. **Overview** — packageName + description + risk tier badge + computed risk
2. **Pages/Databases** — `manifest.capabilities` as module surfaces
3. **Agents + Skills** — static Chief of Staff → `<packageName>.surface` capability
4. **Automations** — honest empty state (backend not wired)
5. **Integrations** — `manifest.connectors` list
6. **Files / Results** — honest empty state (backend not wired)
7. **Settings / Actions** — install/uninstall placeholder

---

## Panel control behavior (§5b)

Both shell panels now use `usePanelControl`:
- **Left sidebar** — snap=true, midpoint=148, collapses to 76px icon rail, expands to 220px
- **Right AgentPanel** — snap=false, continuous width 260–520px, persists via localStorage v2 key
- Both support: Escape-to-collapse keyboard shortcut, ARIA labels on resize handle and toggle

---

## Deprecated surfaces removed (VOCAB2/VOCAB6)

Left nav: removed Knowledge and Intelligence items. Only `installedModules` + Settings + Pending Work remain.  
IntelligencePage: removed Tools tab, Workflows tab, standalone Skills tab. Routes still exist for backward compat.

---

## Validation

| Check | Result |
|-------|--------|
| TypeScript `--noEmit` | ✅ No errors (only pre-existing vite/client + baseUrl warnings) |
| 14 new module-detail tests | ✅ All pass |
| Pre-existing data tests | ⚠️ 2 failures pre-existed (react import in Node env) — not caused by these changes |
| Blast-radius: no removed imports referenced | ✅ Verified with grep |
| Deprecated identifiers in modified files | ✅ None found |

---

## Remaining blockers (TASK-001 cannot be marked done)

1. **Live viewport** — desktop + 375px checks require a running browser. Cannot simulate here.
2. **packages.list data** — nav modules only populate when the API returns `state === "available"` packages. Requires running API server + seeded DB.
3. **agents.list API** — AgentCard in ModuleDetailPage uses `MODULE_AGENTS` static map. Replace when real API ships.
4. **Automations/Files backends** — sections show honest empty states; backend not yet wired.
