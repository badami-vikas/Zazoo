---
title: DataEngine / View Grammar Business Requirements
type: raw
doc_kind: reference
status: implemented
companions: [ui-architecture-rules-2026-07.md, calendar-module-plan-2026-07.md, calendar-plan.md, relationship-module-plan-2026-07.md, taskmanager-module-plan-2026-07.md, requirement-ui-architecture-rules-2026-07-13.md]
related_wiki: ../wiki/ui-architecture.md
updated: 2026-07-19
tags: [dataengine, view-grammar, views, calendar, graph, map, table, board, form, tree, ui-architecture, business-requirements]
---

# 1. Executive decision

**Implemented 2026-07-19 (TASK-014 + TASK-009).** One registry now owns all eight kinds. Calendar's package/route identity and duplicate renderers are removed. Graph uses one renderer across single-Database, selected-Database, and full/Second-Brain scopes. Blueprint v2 emits canonical names; v1/unversioned `kanban` and `network` migrate at the schema boundary.

There is **one View Grammar**: a fixed, registered set of View kinds, each a stateless presentation overlay (filter + sort + column config + kind-specific rendering) over Database rows. A View is never a separate entity, never a separate route, never a separate installed Module, and never tied to one integration. Whether a Page offers a given View kind is computed from that Page's column metadata (does it have a date column? a relation column? a location column? a self-referential parent column?) — never hand-picked per Page and never hardcoded per surface.

One deliberate exception to the "one Database" default: **Graph view** (§3) supports a scope selector that extends its node/edge rendering from the Page's own Database (default) to any user-selected set of Databases, up to all permitted Databases across every installed Module. This makes Graph the only View kind that is not purely single-Database — and it means Second Brain (glossary-defined cross-Module graph) is Graph view at full scope, not a separate surface (§4).

This directly resolves two live architectural violations, confirmed by code audit 2026-07-17:

- **Calendar is currently modeled as an installed Module/Tool**, not a View kind: it has its own nav entry, its own `/calendar` route (which — separately — is currently misrouted to Task Manager, not even to the real Calendar page), its own `InstalledModuleBoundary packageName="calendar"` gate, and its own catalog entries in `tools.ts` and `moduleRoutes.ts`. Google Calendar sync logic is entangled with all of this. **Target state: none of that Module/Tool/route machinery exists. Calendar is `kind: "calendar"` in the View Grammar, available on any Page with a date column, full stop. Google Calendar is a plain Integration that writes rows into whatever Database it's configured to sync — it owns no page, no route, no nav identity.**
- **Four independent, hand-built calendar renderers currently coexist** (`DataEngine.tsx` inline month grid, `CalendarPage.tsx`'s Month/Week/Day/Agenda, `dataviews/views/CalendarView.tsx`, and ad hoc `{id:'calendar'}` entries in `InitiativeDetail.tsx`/`WorkPage.tsx`), none sharing code. **Target state: one `CalendarView` component, registered once, consumed by every Page.**

Graph is architecturally correct already and this BRD confirms rather than changes the data model: there is no separate relationship-graph table anywhere in the schema or the code. A Page's Graph view renders rows as nodes and their typed Relations as labeled edges — a pure projection, gated on the Page having a relation-kind column. Graph view gains a scope selector (§3) that extends this from single-DB (default) to multi-DB to full (all permitted Databases = Second Brain). The **Second Brain** cross-Module graph (glossary-defined, spans every installed Module's Records/Relations/Events/Files) is Graph view at `scope: full` — not a separate surface (§4, ADR-110).

One naming gap this BRD surfaces: the canonical glossary already says **"graph"** (`docs/glossary.md`: *"View — presentation of a Page's Database, such as table, cards, board, calendar, map, graph, or form"*), but the shipped code's `ViewConfig["kind"]` union calls the same thing **`network`**. Per the standing vocabulary rule (glossary wins, AP-020), the code identifier should rename to `graph` — tracked as a TASK-014 deliverable, not a fresh decision.

# 2. Current-state audit (2026-07-17 code read)

```yaml
audit_findings:
  calendar_as_module_not_view:
    - routes.tsx: "/calendar" resolves to TaskManagerPage (routing bug — should never point at Task Manager at all under the target model)
    - routes.tsx: "/calendar/google" -> CalendarPage wrapped in InstalledModuleBoundary packageName="calendar" (Calendar gated as an installed package)
    - moduleRoutes.ts: MODULE_ROUTES.calendar = { to: "/calendar", label: "Task Manager" } (a Module-route registry entry literally named "calendar" whose label is "Task Manager")
    - tools.ts: a `tools` catalog row id:'calendar', name:'Task Manager', route:'/calendar' (Calendar and Task Manager conflated at the catalog level)
    - IntelligencePage.tsx: lists "Calendar" as a peer built-in workspace package alongside DealPilot/JobPilot/Helpdesk
    - docs/wiki/calendar.md + docs/raw/calendar-module-plan-2026-07.md: describe Calendar as "one pinnable Tool + one primary global-nav item," not a View kind — the docs and the code agree with each other, both need to change together
  duplicate_calendar_renderers:
    - DataEngine.tsx (lines ~1139-1284): inline month grid, hand-rolled date parsing, own local state
    - CalendarPage.tsx: Month/Week/Day/Agenda, in-house date-fns, Google-Calendar-specific data source
    - dataviews/views/CalendarView.tsx: generic, gated on a date-kind column, source-agnostic — this is the correct one, source-of-truth going forward
    - InitiativeDetail.tsx / WorkPage.tsx: each has its own local hardcoded {id:'calendar'} view entry, independent of all three above
  graph_is_correct_but_unbuilt:
    - no separate relationship-graph table anywhere; RELATIONSHIP_NODE_TYPES = ["edge"] (WorkspacePage.tsx) confirms Relations render as edges over existing Person/Community rows
    - dataviews/views/GraphView.tsx is an admitted placeholder: renders TableView with a "graph rendering isn't built yet" banner
    - DataEngine.tsx's "Network" view is not a real node/edge graph either — it clusters rows by a field (company/communityType) into cards, no edges rendered at all
    - eligibility.ts already gates a "network" kind on a relation-kind column and restricts relationship-shaped Pages to ["table","network"] only — the eligibility RULE is right, the RENDERER is the gap
  two_parallel_view_systems:
    - informal: DataEngine.tsx / InitiativeDetail.tsx / WorkPage.tsx each hardcode their own `views` array + inline JSX branches per view — no shared registry, no eligibility computation, every Page gets the same fixed view list regardless of its columns
    - formal: dataviews/registry.ts (VIEW_COMPONENT_REGISTRY) + ViewConfig["kind"] (packages/tables/src/types.ts) + eligibility.ts (computeEligibleKinds) — a real registry with real gating logic, matching this BRD's target model, but wired only to /workspace
  vocabulary_gap:
    - glossary.md says "graph"; ViewConfig["kind"] code type says "network" — needs reconciling, glossary wins
    - map/network/tree are not yet named in ui-architecture-rules-2026-07.md's canon prose line (only table/card/form/kanban/calendar are), even though map/network already exist in the code type — this BRD promotes them to canon explicitly, plus adds tree (new, introduced by the Task Manager Module plan)
```

# 3. Canonical View Grammar

Eight View kinds. Every kind is gated by column metadata — never manually assigned per Page — and every kind is a read/write overlay over the SAME Database rows the Page's other views read.

```yaml
view_kinds:
  table:
    always_eligible: true
    renders: rows x visible columns, sortable/filterable, resizable/hideable columns via the shared column/toggle menu
    write_path: inline cell edit -> the Page's ordinary governed write path (Form-equivalent post-insert/update hooks apply identically)
    features: [sort, filter, column show/hide/resize/reorder, row context menu (open/edit/duplicate/delete/pin), bulk row select + bulk action, saved Lists as reusable filter+sort+column presets, pagination/virtualized scroll, AI Smartfill per-cell enrichment with source/cost/risk preview]
    reflected_in: every Module Page's landing section by default (DealPilot Deals/Sources/Theses, Relationship People/Communities, Task Manager Queue, JobPilot Applications, ...)

  board:                      # code symbol: kanban
    eligible_when: a select/status-kind column exists to group by
    renders: swimlane columns = distinct values of the grouping column; cards = a compact per-row summary
    write_path: drag a card to a new column -> updates the grouping column's value on that row, through the exact same write path table's inline edit uses (never a second write mechanism)
    features: [per-column row count/WIP badge, add-row-in-column (opens Form view prefilled with that column's value), same filter/sort/List support as table, drag-and-drop reorder within a column (updates a sort_order field where one exists)]
    reflected_in: DealPilot Deals (by stage), Task Manager Queue (by status), JobPilot Applications (by stage), any Page with a status-shaped column

  gallery:                    # code symbol: gallery ("card view")
    eligible_when: always (degrades gracefully with no image/thumbnail field)
    renders: card-per-row, a curated subset of fields (title + 2-4 key fields + optional image), same filter/sort as table
    write_path: click-through to Record Detail for edits; no inline write on the card face
    features: [configurable card field selection, same List/filter/sort support as table]
    reflected_in: Relationship People/Communities (photo-bearing rows), Resources (books/media with cover art), any Page where a visual scan beats a dense table

  form:
    eligible_when: always
    renders: one input per field of the Page's primary Database, respecting field types/required flags/defaults
    write_path: submission INSERTS a real row directly (not gated behind propose-approve like external-facing writes) — but the same post-insert pipeline stage (dedup/enrichment/scoring/tagging) that table/board/import writes already go through MUST run on the Form-submitted row too; no second, thinner write path for form-created data
    features: [field-type-aware inputs, required/default handling, prefill via URL params (create-from-context, e.g. "add task under this parent"), edit mode reuses the same layout for a selected existing row]
    reflected_in: the "Add" affordance surfaced from every other view's toolbar and empty state, on every Module Page — never a bespoke hand-built "create X" screen

  calendar:
    eligible_when: a date-kind column exists on the Page's Database
    renders: month / week / day / agenda density toggle; buckets rows onto the calendar by their date column; color-codes by a designated field (status/type)
    write_path: click an empty day/slot -> opens Form view prefilled with that date; drag an event to a new day/time -> updates the date column, through the SAME write path as a table cell edit (governed exactly like any other field write — an externally-synced row, e.g. from Google Calendar, still routes an edit through that source's own egress approval, same as it would from the table view)
    features: [month/week/day/agenda modes, color-by-field, click-to-create via Form, drag-to-reschedule via the ordinary write path, works over ANY date-bearing Page with zero source-specific code]
    reflected_in: DealPilot Deals (close date), JobPilot Applications (interview date), Task Manager Queue (task due date / candidate-Task target date), Relationship People/Communities (touchpoint/event date), a Page whose Database is populated in part by the Google Calendar Integration — the SAME renderer in every case, source-blind
    explicitly_not: a dedicated Module, Tool, nav item, or route; not owned by or coupled to any one Integration

  map:
    eligible_when: a location-kind column exists (place label and/or structured local coordinates)
    value_contract: "label; latitude,longitude; label | latitude,longitude; {label?, latitude|lat, longitude|lng|lon}; or GeoJSON Point"
    renders: pins on a bundled Local Plane basemap; click pin -> Record Detail
    geocoding: "never automatic and never public by default; unresolved labels remain local and honest until the Human invokes an explicitly configured Local Plane GeocodingProvider, then may save the resolved coordinate through the ordinary Record update path"
    features: [pin clustering at zoom-out, local search/fly-to, explicit unresolved-label state, optional private geocoder, filter/List support same as table]
    reflected_in: Relationship People/Communities (address field), DealPilot Sources (headquarters location), any Page with a location column

  graph:                      # code symbol currently "network" — rename to match glossary (§1)
    eligible_when: the Page's Database carries at least one typed Relation column — this is the minimum to unlock Graph view; the scope selector then controls how wide the graph goes
    scope_selector:
      single_database: "(default) this Page's rows as nodes, their typed Relations as edges; scoped to this Page's Database only"
      multi_database: "user selects additional Databases to include; their rows become nodes too, cross-Database Relations become edges — e.g. People + Deals + Communities on one canvas"
      full: "all permitted Databases across every installed Module, filtered by permission; this IS Second Brain — same renderer, same eligibility rule, wider data set; also accessible via the Second Brain nav entry (a named preset that opens Graph view pre-configured to scope:full)"
    renders: rows of all in-scope Databases as nodes, typed Relations as labeled edges (edge label = the Relation's type, e.g. "introduced by," "reports to"); click node -> Record Detail; click edge -> Relation detail/evidence; permission-filtered at every scope level
    write_path: read-only rendering; creating/editing a Relation happens through the owning Record Detail's Relations section (a governed write), never by drag-drawing an edge on the canvas
    features: [scope selector (single-DB / multi-DB / full), node/edge click-through, edge-type label, zoom/pan, filter by Relation type, permission-filtered node set at all scopes, progressive load for full scope], currently a PLACEHOLDER renderer (renders a table with a banner) — real node/edge rendering is a named TASK-014 deliverable, not yet shipped
    reflected_in: Relationship People/Communities (Person<->Person/Community Relations) — this is the ONLY Graph consumer today; any future Module whose Database carries typed Relations becomes eligible automatically; Second Brain nav entry = this view at scope:full
    explicitly_not: a separate relationship-graph table (confirmed — none exists); a separate surface from Second Brain (§4 — Second Brain IS this view at full scope)

  tree:                        # new, introduced by the Task Manager Module plan (docs/raw/taskmanager-module-plan-2026-07.md)
    eligible_when: the Page's Database is self-referential (a parent-ref-kind column pointing at another row of the same Database)
    renders: materialized-path hierarchy, expand/collapse, level indentation matching the dot-notation path
    write_path: reorder/re-parent -> a GOVERNED PROPOSAL (never a raw drag-drop write) per the Task Manager restructure rules — promote / insert-ancestor-above / re-parent, path recomputed atomically over the affected subtree by an Automation
    features: [expand/collapse, drag-to-restructure as a proposal (not a direct write — this view kind is the one exception to "drag = same write path as table," because tree restructuring can affect many descendant rows at once and must go through review), level/path column]
    reflected_in: Task Manager Queue (the Task type's self-referential parent_task_id) — currently the only self-referential Database in the product; any future self-referential Database becomes eligible automatically
```

# 4. Second Brain IS the Graph view at full scope

Second Brain (glossary-defined, `docs/raw/ui-architecture-rules-2026-07.md` §"Second Brain") is the Graph view kind (§3) at `scope: full` — every permitted Database across all installed Modules, filtered by permission. The only architectural difference between "a relationship graph on the People page" and "Second Brain" is which Databases contribute nodes and edges. The renderer, the eligibility rule, the write path, and the permission model are identical.

**Implementation consequence:** there is no separate surface to build. The Graph renderer, once real (TASK-014), handles all three scopes (single-DB / multi-DB / full) with the same node/edge model and the same component. Performance concerns at full scope (large node sets, deep traversal) are solved by progressive load, pagination, and a sensible default filter — not by an architectural split.

**Second Brain nav entry:** the "Second Brain" item below Modules in the left sidebar remains as a named shortcut. It opens Graph view pre-configured to `scope: full`, applying the standing permission filter. It is a nav preset, not a separate component, not a separate route class, and not a separate surface. Its permission-filtering and provenance requirements are the same as the Graph view's at full scope — nothing additional.

**What this supersedes:** ADR-108 (first issue of this BRD, 2026-07-17) stated "never merge the two, never let one Page's Graph view try to render cross-Module data, and never let Second Brain be implemented as 'just a bigger Graph view kind' — it is its own surface." ADR-110 records why that stance was overstated and has been reversed. The correct formulation is: Second Brain IS the biggest Graph view, and that is fine.

# 5. Cross-cutting features (every View kind)

```yaml
shared_across_all_views:
  toolbar: "List dropdown -> view dropdown -> search -> filter -> custom actions -> 3-dots -> insights chevron (ui-architecture-rules canon, unchanged)"
  column_menu: shared show/hide/resize/reorder menu, same component regardless of which View kind is active
  control_panel: administration-only concerns (mount/unmount capabilities, scope/permission config, versioning) live behind 3-dots -> Control Panel; anything that is DATA about the Page's own records is a Section on the Page, never buried in Control Panel
  lists: "a List is a saved filter+sort+column preset over one Database — NOT a View kind itself; every View kind can apply any List"
  empty_states: "icon + one-line statement of what this Page shows + the single next action (opens Form view) — never a greyed-out fake table, never seeded dummy rows"
  smartfill: AI Smartfill previews source fields, destination, model/provider, cost/risk, sample result before running; execution uses the ordinary governed write/enrichment pipeline with recorded provenance — never an unlogged shortcut
  governance: every write, regardless of which View kind originated it, goes through the same governed path that view's underlying field/row write already uses; a View kind never invents a second write mechanism (tree restructuring's proposal gate is the one deliberate exception, §3, because it can touch many rows atomically)
```

# 6. Integration decoupling rule

An Integration (Google Calendar, Gmail, LinkedIn, any future connector) is a **data source**, full stop: it authenticates, syncs, and writes/updates rows in whichever Database it is configured to feed, through the ordinary governed write path (egress/intake agents, `external:send`/`external:receive` gates, exactly as today). An Integration:

- owns no Page, no Module, no route, no nav entry, no pinnable-Tool identity;
- never determines which View kinds a Page offers — that is entirely a function of the Page's column metadata (§3), computed the same way whether the data came from an Integration, a Form submission, an Agent Run, or an import;
- is visible to the user exactly where every other Integration is: the Integrations surface (`/integrations`, `IntegrationDetail`) and, per-row, as a source/provenance badge on the synced records themselves.

Google Calendar specifically: it remains exactly what it already is at the sync/write layer (`apiSyncCalendar`, `CalendarEventDTO`, governed propose->approve->egress round-trip for external writes) — none of that changes. What changes is everything ABOVE that layer: no `/calendar` route, no `InstalledModuleBoundary packageName="calendar"`, no `tools.ts`/`moduleRoutes.ts` catalog entries naming "calendar" as a Module. Google-Calendar-synced rows land in whichever Database they belong to (a Touchpoint/Event-shaped Database) and are visible through that Database's own Page, in Calendar view like any other date-bearing data, alongside non-Google rows on the same calendar.

# 7. Where each feature is reflected — worked examples

```yaml
worked_examples:
  relationship_people_page:
    eligible_views: [table, gallery, map, graph, form]
    why: has a location column (map), has typed Relations to other People/Communities (graph — eligible at single-DB scope by default; user may extend to multi-DB to pull in Deals/Applications, or to full/Second Brain scope); no self-reference (no tree), no dedicated date column at the row level today (no calendar unless/until one is added)
  task_manager_queue_page:
    eligible_views: [table, board, tree, calendar, form]
    why: has a status column (board), is self-referential via parent_task_id (tree), has a due/target date field (calendar); no location/relation-to-other-Database column, so no map/graph by default
  dealpilot_deals_page:
    eligible_views: [table, board, calendar, form]
    why: has a stage/status column (board), has a close-date field (calendar); graph becomes eligible automatically the moment a Deal<->Source Relation is added, with zero new view code
  google_calendar_synced_events:
    not_a_page: "there is no 'Calendar page' — synced events land as rows in whichever Touchpoint/Event Database they're modeled under, and that Database's own Page renders them in Calendar view alongside every other date-bearing row on that Page"
```

# 8. Scope mapping — what TASK-014 must now explicitly deliver

See `docs/TASKS.md` TASK-014 (updated same session) for the canonical Outcome/Prototype-test/Scope. Summary of the delta this BRD adds to that task:

```yaml
task_014_additions:
  - retire the informal per-Page hardcoded view arrays (DataEngine.tsx, InitiativeDetail.tsx, WorkPage.tsx) in favor of the one dataviews/registry.ts-driven system, currently wired only to /workspace
  - collapse the four independent calendar renderers into the one dataviews/views/CalendarView.tsx, consumed everywhere a Page has a date column
  - remove Calendar's Module/Tool/route/nav identity entirely: routes.tsx "/calendar" and "/calendar/google", moduleRoutes.ts MODULE_ROUTES.calendar, tools.ts "calendar" catalog row, InstalledModuleBoundary packageName="calendar", IntelligencePage.tsx's "Calendar" peer-package listing
  - rename the code's ViewConfig["kind"] "network" to "graph" to match the canonical glossary term
  - build the real Graph view renderer (node/edge, replacing the current table-with-banner placeholder) — code-verified as the actual gap, not the eligibility rule; the renderer must support the scope selector (single-DB / multi-DB / full); this replaces what was previously planned as a separate "Second Brain" surface (ADR-110 — Second Brain IS this view at full scope, not a separate component)
  - add "tree" as a registered View kind (Task Manager's dot-path hierarchy) alongside the existing table/gallery/kanban/calendar/map/graph/form six
  - promote map/graph/tree into docs/raw/ui-architecture-rules-2026-07.md's canon prose line (today only table/card/form/kanban/calendar are named there)
  - fix the tracked "map view is not a map" gap (docs/BUGS.md) as part of the same consolidation, since Map is one of the eight canonical kinds this BRD formalizes
```
