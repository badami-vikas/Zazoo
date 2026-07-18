<!-- Updated: 2026-07-18 | Files scanned: platform/apps/web/src/app/{routes,Layout,pages,components,data,dataviews} | Token estimate: ~500 -->

# Frontend Codemap

React + Vite thin client lives at `platform/apps/web`. `app/routes.tsx` owns routes;
`app/Layout.tsx` owns the shared shell. Tauri desktop hosts this same build.
`Design Bridge AI Interface (Copy)/` is historical reference, not the runtime entry point.

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

DataEngine/dataviews      → shared View registry; table/board/gallery/form/calendar/map/
                            graph/tree convergence remains TASK-014
```

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
