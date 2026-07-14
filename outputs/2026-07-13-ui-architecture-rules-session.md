# 2026-07-13 — UI architecture rules encoded + priority realignment applied (AP-010/AP-011)

Session deliverables:
- Verbatim requirement: `docs/raw/requirement-ui-architecture-rules-2026-07-13.md`
- Canon rules: `docs/raw/ui-architecture-rules-2026-07.md` · wiki `docs/wiki/ui-architecture.md` · CLAUDE.md pointer · ADR-056 · APPROVALS AP-011
- PROGRESS batches rewritten per AP-010 (deferred by commit 69021b8): Batch 1 Egg+Commons prototype (UI-RULES-1 alignment audit first) → Batch 2 repo cleanup → Batch 3 bugs → Batch 4 rest (testing, measurement, M3–M6)
- Developer branch `origin/manishsbhoopalam8498-security-p0-hardening` (2 commits, unmerged) implements old Batch-1 Security P0 (SEC-1/2/3 + XP-1) — flagged for reconcile/merge in Batch 3; recommendation: merge it BEFORE any prototype exposure beyond the sole user.

## OSS code diligence — view systems (agent 1: NocoDB + Baserow)

**NocoDB** (⚠ head license = Sustainable Use License 2026-01 — NOT FOSS; patterns/schema shapes only, never copy code):
- `ViewTypes` enum (`packages/nocodb-sdk/src/lib/globals.ts:36`): FORM=1, GALLERY=2, GRID=3, KANBAN=4, MAP=5, CALENDAR=6, LIST=7, TIMELINE=8, GANTT=9.
- Two-level view model: common `nc_views_v2` row — `class View` (`src/models/View.ts:106`): id, title, uuid (share slug), show, order, type, lock_type, `fk_model_id`→table, show_system_fields, meta, sorts, filter — plus per-type sibling table (`nc_form_view_v2`, `nc_grid_view_v2`, …) with matching model classes.
- Form view: `FormView` (heading, subheading, success_msg, redirect_url, submit_another_form, banner/logo, starts_at/expires_at) + per-field `FormViewColumn` (`fk_column_id`, label, help, description, required, enable_scanner, show, order) — form input = table column + per-view overlay. Submission = normal row insert via `public-datas.service.ts:611 dataInsert()`. Prefill via URL params, `PreFilledMode.Hidden|Locked|Default`.
- Per-view config: `GridViewColumn` (show, order, width, group_by, group_by_order, aggregation) · `Filter` tree table `nc_filter_exp_v2` (fk_parent_id, is_group, logical_op and/or/not, comparison_op) · `Sort` table `nc_sort_v2` (direction incl. count-asc/desc), all keyed by view id.
- View switching: view = route param (`pages/.../[viewId]/[[viewTitle]].vue`); renderer = component switch (`components/tabs/Smartsheet.vue:369`: SmartsheetGrid / SmartsheetGallery / SmartsheetForm …).

**Baserow** (core = MIT "Baserow OSE", safe to adapt with attribution; `premium/`+`enterprise/` proprietary — kanban/calendar/timeline live there, don't copy):
- Django polymorphic `class View` (`contrib/database/views/models.py:73`): table FK, order, name, content_type discriminator, filter_type AND/OR, slug, public, password. Concrete subclasses = joined tables (GridView :588, GalleryView :692, FormView :741).
- View types = **plugin registry**: `class ViewType` (`registries.py:72`) with capability flags `can_filter / can_sort / can_group_by / can_decorate / can_share`, `model_class`, `field_options_model_class`, per-type serializer + frontend `getComponent()` (`web-frontend/modules/database/viewTypes.js:532+`). ← strongest architecture takeaway for Bridge.
- Form view: `FormViewFieldOptions` (:841 — name override, description, enabled, required, allowed_select_options M2M, show_when_matching_conditions + `FormViewFieldOptionsCondition/ConditionGroup` :938/:953 conditional visibility, field_component, order) + `ViewDefaultValue` (:1029). Submission: `ViewHandler.submit_form_view()` (`handler.py:3622`) — validates required, whitelists enabled fields, creates a real row. Prefill: `fieldType.parseQueryParameter()` (`pages/form.vue:126-149`).
- Per-view config: `GridViewFieldOptions` (:630 — hidden, width, order, aggregation_type) · `ViewFilter/ViewFilterGroup` (:379/:363) · `ViewSort` (:494) · `ViewGroupBy` (:542) · `ViewDecoration` (:435 row coloring); applied server-side `ViewHandler.apply_filters` (:1676) / `apply_sorting` (:2126) onto dynamic Django model.
- Routing: one table route with optional `:viewId?` param (`routes.js:11`); component resolved from frontend registry.

**Shared takeaway (adopted into rules §2/§4):** a view is a stored presentation overlay (per-view column visibility/order/width + filter tree + sorts) over the SAME table rows. Lists (row subsets = saved filter sets) and toggles (column clusters) reuse one mechanism. Form is a first-class view type; its submission is an ordinary row insert. Bridge's view set should be a registry with capability flags, not a hardcoded enum.

## OSS code diligence — page structure + nav (agent 2: Twenty + AppFlowy)

**Twenty** (license: AGPL-3.0 default + `@license Enterprise`-marked files commercial — patterns/clean-room only, never copy):
- Record page = metadata: `PageLayoutRecordPageRenderer` → `PageLayoutRenderer`; model `PageLayout → PageLayoutTab[] → PageLayoutWidget[]`; widget `{title, type: WidgetType, gridPosition{row,column,rowSpan,columnSpan}, position, configuration}` (`engine/metadata-modules/page-layout*/`). `WidgetType`: VIEW, IFRAME, FIELD(S), GRAPH, TIMELINE, TASKS, NOTES, FILES, EMAILS, CALENDAR, RECORD_TABLE, EMAIL_THREAD, … dispatched in `WidgetContentRenderer.tsx`.
- Tabs: `PageLayoutTab {title, icon, position, layoutMode: VERTICAL_LIST | CANVAS}` (react-grid-layout for CANVAS). Defaults as code (`DefaultPersonRecordPageLayout.ts`) + user-editable, persisted (`updatePageLayoutWithTabsAndWidgets`, `resetPageLayoutToDefault`).
- Summary/landing: `ShowPageSummaryCard` above tabs; related-record lists = `RecordDetailRelationSection` per relation field.
- Nav: `NavigationMenuItem` entity — CHECK-constrained types FOLDER | OBJECT | VIEW | RECORD | LINK | PAGE_LAYOUT, `folderId` nesting; collapsible primitives `CollapsibleNavigationDrawerSection` / `NavigationDrawerSubItem` / `NavigationDrawerItemsCollapsableContainer` (jotai `isNavigationDrawerExpandedState`); dnd-kit reorder.
- Views: `ViewEntity {name, objectMetadataId, type: TABLE|KANBAN|CALENDAR|FIELDS_WIDGET|TABLE_WIDGET, key (INDEX=default), position, openRecordIn}` + `view-field / view-filter(+groups) / view-sort / view-group / view-permissions` sibling entities.
- "..." menus: index page splits (a) Options dropdown = view-shape only (layout, fields show/hide, record groups) vs (b) actions dropdown = data ops (create view, import/export, deleted records; multi-select: delete/restore/merge/update). Record page dots = whole-record ops (favorites, export, navigate next/prev, delete/restore, duplicate, edit-layout mode). **Content never lives in the menu.**

**AppFlowy** (AGPL-3.0 — patterns only):
- Recursive hierarchy: `ViewPB {id, parent_view_id, name, child_views, layout: ViewLayoutPB{Document,Grid,Board,Calendar,Chat}, icon, is_favorite, extra}` (`flowy-folder/src/entities/view.rs`); Space = top-level view flagged via `extra` JSON (`view_ext.dart:150`).
- Sidebar: `sidebar.dart` + `SpaceBloc` (spaces, currentSpace, expand status); tree item `ViewItem/InnerViewItem` recursive widgets, indentation = level × padding; expand state per node in `ViewBloc.isExpanded`, persisted client-side KV (`KVKeys.expandedViews`) — NOT in the document model.
- Database view tabs: `DatabaseTabBarBloc` (`didLoadChildViews`, `_createLinkedView(layout, name)`) — linked Grid/Board/Calendar views of the same data as tabs (`tab_bar_view.dart`, `tab_bar_header.dart`).

**Takeaway**: Twenty independently converged on "everything is metadata" (pages, nav, views all DB rows with code defaults + reset). AppFlowy proves the single-recursive-type sidebar with client-side expand state, and linked views-as-tabs = the toggle mechanism.

## Open questions for the user (defaults applied, canon doc §9)
1. "forum as a standard view" read as **Form** (your sentence continues "the form collects data"). Correct?
2. "Documents" = the OS `~/Documents` folder (desktop shell provisions `Bridge Workspace/`). Or an in-app Documents module?
3. >20 artifacts grouping default = sub-module → month. Override?
4. Alignment target = `platform/apps/web`; deployed prototype NOT auto-migrated. Confirm?
5. Toggle-vs-sub-module judgment calls will be listed by the UI-RULES-1 audit for your approval.

## What the prompt was missing (gaps flagged back to user)
- No mobile/desktop breakpoint rule for toggles + landing sections (toggles at top collide with mobile bottom-bar nav).
- No empty-state rule for the artifacts section (no-dummy-data policy AP-002 requires an honest empty state spec).
- No permission story for Form view (who may submit; governed pipeline propose→decide applies to form inserts?).
- No rule for where SHARED (non-local) artifacts surface — `~/Documents/Bridge Workspace` covers local plane only.
- No sync/conflict rule if the user renames/moves files inside `Bridge Workspace` outside the app.
- Deep-linking: are toggle pages routable URLs (recommended: yes, one route per page, per NocoDB/Baserow view-as-route-param)?
- The old six-container → ADR-029 minimal-egg nav decision isn't revisited: sub-module dropdowns reintroduce nav depth — reconciled by keeping Initiative-first nav with sub-modules only under modules.
- Prototype (bridge-ai-1ay.pages.dev) migration unaddressed — left out of scope pending approval (PII + manual wrangler deploy).
