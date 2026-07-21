<!-- Updated: 2026-07-21 | Files scanned: platform/apps/web/src/app/{routes,Layout,pages,components,data,dataviews}, platform/modules/manifests | Token estimate: ~550 -->

# Frontend Codemap

React + Vite thin client lives at `platform/apps/web`. `app/routes.tsx` owns routes;
`app/Layout.tsx` owns the shared shell. Tauri desktop hosts this same build.
Built-in route roots come from `@bridge/module-manifests`; installed navigation and Home come
from `modules.list`. No second prototype build entrypoint remains on main.

## Main surfaces → governed data seams

```
ApprovalsPage             → data/governance.ts + data/ledger.ts
                            action.pending/resolution/decide/listHistory
                            relationship outstanding/retry/reconcile

RelationshipPage          → graph APIs for Signals/People/Communities, participant Relations,
                            source Events, and governed Signal Actions

DealPilotPage/detail      → dealpilot tRPC records, discovery, relation and credential seams

ModuleDetailPage          → installed manifest inventory; Pages, Agents→Skills, Automations,
                            Integrations, Files/Results, settings

HomePage                  → modules.list; installed Modules or honest load/empty/error state

DataEngine/dataviews      → shared View registry; table/board/gallery/form/calendar/map/
                            graph/tree convergence remains TASK-014
```

Legacy Item Detail, standalone Work/Agent/Integration/Resource pages, and the unrouted
fixture-only JobPilot detail were removed by TASK-013. Canonical Record Detail and Module
surfaces remain.

## Relationship decision recovery (RM4)

The browser never infers a decision link from proposal JSON. It reads server-owned resolution
and materialization state. Pending/failed Relationship effects remain visible in Approvals with
an explicit owner retry; applied effects disappear from outstanding work. Execution Ledger
history comes through bounded authenticated tRPC, not direct browser access to the ledger table.

## Persistence boundaries

Server-owned Records, Relations, approvals, and effect state use API/DB adapters. Local UI
preferences still use browser persistence where explicitly implemented; do not treat those as
authoritative domain state. Runtime surfaces must render connected data or honest empty states.

See also: [architecture.md](architecture.md), [backend.md](backend.md),
[../wiki/ui-architecture.md](../wiki/ui-architecture.md).
