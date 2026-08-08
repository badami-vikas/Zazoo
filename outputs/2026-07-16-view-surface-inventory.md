# View-surface inventory

## Shared view engine

`platform/apps/web/src/app/dataviews/DataViews.tsx` is the shared shell for blueprint-backed tables. It provides view switching, text filtering, column visibility, responsive wrapping, and registered-view enforcement. `StandardToolbar.tsx` is a separate shared toolbar for legacy Module pages: list selection, view dropdown, search, filter, custom actions, overflow menu, and insights collapse.

Registered `DataViews` kinds:

| View | Features | Limits |
|---|---|---|
| Table | TableSpec-driven columns, click-header sort, row filters, column visibility, horizontal mobile scroll | Rows are currently display-only; no shared row detail/edit/context menu |
| Kanban | Filters/sorts, group-by select/status column, grouped cards | No shared drag/drop or card actions |
| Calendar | Filters/sorts, date-column grouping, month grid | No shared create/edit; separate Google Calendar page has its own Month/Week/Day/Agenda UI |
| Gallery/Card | Filters/sorts, responsive card grid, title/subtitle/meta formatting | No shared card action contract beyond renderer |
| Map | Filters/sorts, location grouping | Honest list fallback; no map renderer |
| Network/Graph | Relationship-limited table-backed graph surface | Current implementation delegates to TableView; no graph visualization |
| Form | One input per editable column, insert callback | Caller must provide governed insert; no shared edit form |

## Legacy/bespoke surfaces

| Surface | Views/features currently implemented | Shared primitives? |
|---|---|---|
| DealPilot | Table + Card; StandardToolbar; search/filter; refresh; KPI insight row; row/card opening; red/yellow fit flags; source/deal metadata | StandardToolbar + NotionCard/CardGrid, but bespoke table markup |
| JobPilot | Card + Kanban + List; StandardToolbar; list dropdown; search; stage filters; fit flags; approve/reject; dispatch; park/resume; application detail | StandardToolbar + NotionCard/CardGrid, bespoke renderers |
| Signals | Table + Card + timeline/list fallback; StandardToolbar; search/filter; refresh; Act/Save/Dismiss actions; insight metrics | StandardToolbar + NotionCard/CardGrid, bespoke table markup |
| Helpdesk | Card + Table; StandardToolbar; status/mine filters; impact report; create Ask/helpdesk; open thread | StandardToolbar + CardGrid, bespoke table markup |
| Tools | Table + Card; StandardToolbar; search/filter; pin/unpin; row open; source metadata | StandardToolbar, bespoke table/card markup |
| Work/Initiatives | Card + Table + Board + Calendar dropdown; list dropdown; search; insights collapse; pagination; create/delete/open | StandardToolbar, bespoke card/table/board/calendar markup; Rituals/Tools tabs redirect |
| Task Manager | Ranked table; search/filter; status, progress, priority, horizon, source, record, scheduled columns; drag ranking; resize/hide columns; double-click edit; context menu; task detail modal | StandardToolbar, bespoke table markup; source is generated from `docs/TASKS.md` |
| Knowledge/Workspace | `DataViews` for project/compiled blueprint entities; dashboard cards and blueprint view loop | Shared DataViews; some dashboard/empty-state paths are bespoke |
| Public Helpdesk / Item / Initiative / Settings | Bespoke tables and cards for detail/administration | No common DataViews contract |

## Conclusion

The repo has two table systems: the `DataViews` engine and multiple page-local renderers. Cards are more consistent because `NotionCard/CardGrid` is reused, but tables are not. Standardization is therefore incomplete: the correct convergence task is to migrate Module list/table/card surfaces to `DataViews` + a shared row-detail/action contract, while retaining specialized projections (Google Calendar and relationship graph) as registered view implementations.
