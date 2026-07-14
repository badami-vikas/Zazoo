---
title: UI Architecture Rules — pages, toggles, sections, lists, sub-modules, views, artifacts
type: raw
doc_kind: design
status: active
companions: [requirement-ui-architecture-rules-2026-07-13.md, egg-commons-feature-roadmap-2026-07.md, spec-control-panel-icon.md]
related_wiki: ../wiki/ui-architecture.md
updated: 2026-07-14
tags: [ui, information-architecture, pages, sections, views, lists, sub-modules, artifacts, canon]
---

# UI Architecture Rules (canonical — user-directed 2026-07-13, AP-011)

Source of truth for how Bridge surfaces (apps/web today, Egg shell + generated workspaces tomorrow) lay out data. These rules bind BOTH hand-built pages and the compiler's generated workspaces. Verbatim directive: `requirement-ui-architecture-rules-2026-07-13.md`.

## 1. Vocabulary

| Term | Definition |
|---|---|
| **Module** | A left-nav destination (e.g. DealPilot, Relationship, Helpdesk). |
| **Sub-module** | A collapsible/expandable child of a module in the left nav. |
| **Page** | One toggle's worth of a module/sub-module surface. A module surface with toggles has one page per toggle. |
| **Toggle** | Segmented switch at the top of a module surface that swaps between sibling pages. |
| **Section** | A titled block within a page, stacked vertically. |
| **Landing section** | The first section of every page: the standard data views over the page's primary data. |
| **View** | A rendering of the landing section's data: table, card, and now **form** (plus kanban/calendar where they already exist). |
| **List** | A named saved subset of the same rows/columns, selected via the List dropdown (first slot in StandardToolbar). |
| **Artifact** | Any file a module generates or accumulates locally (briefs, exports, captures, drafts). |

## 2. Data-shape → surface decision rules

The shape of the underlying data decides the UI construct. Apply top-down:

1. **Different columns of the same table (or sibling tables of one strongly-related cluster) → TOGGLE.** Highly related datasets become sibling pages behind a toggle at the top of the module surface. Examples (user-given): People / Communities · Automations / Agents / Skills / Integrations · Deals / Sources / Thesis. Each toggle target is simply a *page*.
2. **Same columns of the same table (row subsets) → LISTS.** Never a new page or toggle — a saved list in the List dropdown. (Matches existing `ListDropdown`/`lists` slot; ETA/WashU lists are the precedent.)
3. **Related to the module but not strongly related to the root module or any current sub-module → NEW SUB-MODULE.** Sub-modules render as a collapsible, expandable dropdown under the module in the left nav.
4. **Unrelated to any module → new module** (existing behavior; unchanged).

Tie-break guidance: "strongly related" = shares the module's primary entity or is a direct attribute-cluster of it. If the candidate data would need its own toolbar, lists, and artifacts, it is a sub-module, not a toggle.

## 3. Page anatomy

Every page, unless a spec explicitly says otherwise:

1. **Landing section** — the standard views (table, card, etc.) over the page's primary data. May be **internally scrollable**; once its internal scroll is exhausted (or the user scrolls outside it), scrolling moves the **whole page**.
2. **Related sections below** — insights, related records, activity, etc., stacked under the landing section.
3. **Artifacts section** — below the landing section (conventionally last): every artifact the module generated. **> 20 artifacts → organize into sub-folders** (default grouping: by sub-module, then by month; a module spec may override).

Page scroll model: page-level vertical scroll containing sections; the landing section owns a bounded internal scroll area (virtualized table/card grid) so related sections stay reachable.

## 4. Standard views — Form joins the set

Every landing section offers the standard views. New standard view: **Form** (confirmed 2026-07-13 — earlier "forum" wording was a typo) — instead of presenting existing data, it renders one input per field of the page's primary table (respecting field types, required flags, defaults) and **collects** a new row (or edits a selected one). Form view is the create/intake lens over the same schema the table view reads — no separate hand-built "create" screens for standard entities.

**Write path (confirmed 2026-07-13)**: a Form submission **inserts directly** — it is not gated behind propose→decide like external-facing writes. But the Learning Agent must check whether any standard process already applied to other rows of the same table/DB (enrichment, dedup, tagging, scoring, etc.) and, if so, **apply that same process** to the Form-submitted row. Concretely: Form view's insert path calls the same post-insert hook/pipeline stage the table's other write paths (import, sync, agent-created rows) already go through — no second, thinner code path for form-created data.

## 4a. Deep linking

Every toggle page is a routable URL (route param per view/page, matching the NocoDB/Baserow/Twenty precedent in §7) — e.g. `/module/:moduleId/:page` or `/module/:moduleId/:subModule/:page`, with the active list/view/filter encoded as query params where useful. No page should be reachable only by in-app click-through.

## 5. Toolbar + 3-dots (Control Panel moves)

- The ⚙ **Control Panel icon slot** (`controlPanelTo` in `StandardToolbar.tsx`, between Filter and 3-dots — R-018/ADR-029) is **retired as a toolbar slot**. Control Panel becomes an **item inside the 3-dots menu**.
- **Reconsider Control Panel contents** during alignment: anything that is *data about the page's own records* (resource tables, per-Initiative bindings, status overviews) becomes a **section on the page**; only true *administration* (mounting/unmounting capabilities, scope/permission config, versioning) stays behind the 3-dots → Control Panel.
- 3-dots menu = page-level actions + admin entries (Control Panel, export, settings-ish); toolbar keeps: List dropdown → view dropdown → search → filter → custom actions → 3-dots → insights chevron.

## 5a. Standard column + toggle context menus

Right-click behavior is compiler-owned and consistent across every Module. DealPilot is an example, not a special implementation.

- **Add page / Remove page** appears on a column **iff** the column's source is a database-backed entity/table. Add page creates a routable sibling toggle page backed by that database/schema; Remove page removes the toggle/page presentation only and never deletes its database or records. The same Add page / Remove page command appears when right-clicking a toggle. Its label and enabled state must describe the actual outcome; destructive structural changes use confirmation and an undo path.
- Standard column menu, in this order/grouping: inline rename · Edit column · Change type · AI Smartfill on/off · Filter · Sort · Group · Calculate · Lock column · Hide column · Add column left · Add column right · Duplicate column · Delete column. Add page / Remove page sits with structural/page commands.
- Commands are capability-aware: unsupported operations are omitted or disabled with a reason (for example, Calculate on a non-aggregatable type, AI Smartfill without an eligible model/permission, schema mutation on a read-only integration).
- **AI Smartfill** previews source fields, destination, model/provider, cost/risk, and sample result; execution uses the ordinary governed write/enrichment pipeline and records provenance. It is not an unlogged table shortcut.
- **Lock** blocks schema/value mutation according to scope, not viewing/filtering. Delete column requires impact preview for dependent views, Automations, Skills, formulas, and relations. Secrets remain credential references and never become revealable table cells.
- Keyboard access and visible menu-button alternatives must expose every right-click command; context menus cannot be pointer-only.

## 6. Local artifact storage — `~/Documents/Bridge Workspace/`

Canonical local tree (Documents = the OS user Documents folder; desktop shell resolves it per-OS):

```
~/Documents/Bridge Workspace/
  <Module>/                 # one folder per module
    <Sub-module>/           # one folder per sub-module
    <artifacts...>          # module-level artifacts + accumulated local data
```

- ALL locally-stored artifacts and accumulated data live under this tree — no scattered app-data dumps for user-facing files (internal caches/DBs stay in app-data).
- The page's Artifacts section is a view over the module's folder (and sub-folders). > 20 artifacts in one folder → sub-folders (see §3).
- Local-plane rule unchanged: raw capture stays local; this tree IS local plane.
- **Cloud-data mirroring rule (confirmed 2026-07-13)**: no personal data is stored cloud-only. Any cloud-resident data that appears inside the app is ALSO mirrored locally under this tree (or the relevant local store) — cloud is never the sole copy of anything the user sees.
- **Grouping is smart, not fixed-rule, and delegated (confirmed 2026-07-13)**: the >20 threshold still triggers grouping, but the grouping *scheme* is not hardcoded sub-module→month — **the Chief of Staff agent decides and performs the grouping** (by type, project, Initiative, recency, whatever fits that module's artifacts) at the moment the count crosses 20. Implementation: an artifact-count watcher calls the CoS agent when a module/sub-module folder exceeds 20 ungrouped files; CoS proposes + applies a folder scheme (governed, not silent — logs the grouping decision like any other agent action).
- **Rename/move tracking + conflict resolution (confirmed 2026-07-13)**: the app must track when the user renames or moves a file inside `Bridge Workspace` from outside the app (Finder/Explorer). Recommended approach — adopt the same pattern proven by sync tools (Dropbox/Syncthing-style): a lightweight local index (path + content-hash + inode/fileID where available) rebuilt on shell startup and updated via an OS file-watcher (macOS FSEvents / Windows ReadDirectoryChangesW / Linux inotify — already partially in the sensor SPI's provider surface, see `platform/apps/desktop/src-tauri/src/providers/`). Detect rename-vs-delete+recreate by content-hash match; update the artifact's DB record's path pointer, never re-generate the artifact. Conflict (user moved AND app tries to write to the old path): app writes win only for its own next-generated version; a user-moved file is treated as the user's copy and left alone — the app re-creates its own copy at the expected path rather than overwriting the moved one. Full design deferred to the sensor SPI build-out (EG-track); this is the standing policy to build to.

## 6a. Empty-state spec (added 2026-07-13, closes AP-002 gap for this canon)

No dummy data (AP-002) means every section that can be empty needs an honest, specific empty state — never a placeholder row:

- **Landing section, no rows**: icon + one-line statement of what this page shows + the single next action that would populate it (e.g. "No deals yet — add one" → opens Form view for this page, per §4). Never a greyed-out fake table.
- **Artifacts section, no artifacts yet**: one line naming what WOULD appear here ("Exports and briefs generated by this module will show up here") + no folder icon grid. Distinct from "module has artifacts but none match the current filter" (that state = "No artifacts match — clear filters", not the zero-state copy).
- **Sub-module with no data yet**: the collapsible nav entry still renders (structure is real even if empty) but expanding it shows the same landing-section empty state, not a spinner or blank.
- **List with zero rows**: same landing-section pattern, scoped to "in this list" ("No people in *VIPs* yet").
- General rule: empty state text is generated from the page's own metadata (entity name + module name), not hand-authored copy per page — keeps it consistent as new toggle pages get added by the compiler.

## 7. OSS precedents consulted (code-level diligence 2026-07-13)

Deep code analysis (clones inspected, not READMEs). Full agent reports: `outputs/2026-07-13-ui-architecture-rules-session.md`.

**NocoDB** (`ViewTypes` enum in `nocodb-sdk/src/lib/globals.ts` — FORM/GALLERY/GRID/KANBAN/MAP/CALENDAR/LIST/TIMELINE/GANTT):
- Two-level view model: common `nc_views_v2` row (`View`: id, title, order, type, lock_type, `fk_model_id`→table, meta) + per-type sibling table (`nc_form_view_v2`, `nc_grid_view_v2`, …).
- Form = table column + per-view overlay: `FormViewColumn` (label, help, required, show, order) per (view, column); submissions write a **normal row** via the data-insert service. Prefill via URL params (`PreFilledMode.Hidden|Locked|Default`).
- Per-view config: `GridViewColumn` (show, order, width, group_by, aggregation) + `Filter` tree table (logical_op and/or/not) + `Sort` table, all keyed by view id.
- View = route param (`.../[viewId]/[[viewTitle]].vue`); renderer = component switch on view type.
- ⚠ **License: head is "Sustainable Use License" (2026-01) — NOT FOSS. Patterns/schema shapes only, never copy code.**

**Baserow** (Django polymorphic `View` base + per-type joined tables; view types = **plugin registry** `ViewType` with capability flags `can_filter/can_sort/can_group_by/can_decorate/can_share`, per-type model + serializer + frontend component via `getComponent()`):
- `FormView`: per-field `FormViewFieldOptions` (label override, description, enabled, required, allowed select options, **conditional visibility** via condition groups, order) + `ViewDefaultValue` per-column defaults; `submit_form_view()` validates required, whitelists enabled fields, creates a real row.
- `GridViewFieldOptions` (hidden, width, order, aggregation) + `ViewFilter/ViewFilterGroup/ViewSort/ViewGroupBy/ViewDecoration` keyed by view.
- View = optional route param on one table route; component resolved from frontend view-type registry.
- **License: core = MIT (safe to adapt w/ attribution); `premium/`+`enterprise/` (kanban/calendar/timeline) proprietary — don't copy those.**

**Shared takeaway adopted into §2/§4**: a "view" is a stored presentation overlay (column visibility/order + filters + sorts) over the SAME table rows — so *lists* (row subsets = saved filter sets) and *toggles* (column clusters) reuse one mechanism; **Form is a first-class view type** whose per-field config is an overlay on the same schema and whose submission is an ordinary row insert. Bridge's view-type set should be a registry with capability flags (Baserow pattern), not a hardcoded enum.

**Twenty** (AGPL + Enterprise-marked files — patterns/clean-room only, never copy code):
- Record pages are fully metadata-driven: `PageLayout → PageLayoutTab[] → PageLayoutWidget[]` (widget = title, `WidgetType` [VIEW/FIELDS/TIMELINE/TASKS/NOTES/FILES/EMAILS/RECORD_TABLE/…], grid position, configuration); code-defined defaults + user-editable + reset-to-default mutations. Summary card sits above tabs. Related lists/timeline/activity = just widgets → validates §3 stacked-sections model and gives the compiler a target shape.
- Views: `ViewEntity` (objectMetadataId, type, position, key=INDEX default) + sibling `view-field/view-filter(+groups)/view-sort/view-group/view-permissions` entities — same overlay pattern as NocoDB/Baserow.
- Left nav: `NavigationMenuItem` DB rows, type-discriminated (FOLDER/OBJECT/VIEW/RECORD/LINK/PAGE_LAYOUT) with `folderId` nesting; collapsible primitives (`CollapsibleNavigationDrawerSection`, `NavigationDrawerSubItem`) → precedent for §2.3 sub-module dropdowns.
- **"..." menu precedent (adopted in §5)**: dots menus hold ONLY whole-record/whole-view operations (favorite, export, delete/restore, duplicate, navigate, enter-layout-edit) + view-shape settings; page CONTENT (fields, related lists, timeline) is never in the menu — it's sections/widgets.

**AppFlowy** (AGPL — patterns only):
- One recursive type covers the whole sidebar: `ViewPB {id, parent_view_id, child_views, layout: Document|Grid|Board|Calendar|Chat, is_favorite, extra}`; "Space" = top-level view flagged in `extra`. Expand/collapse state is client-side KV (`KVKeys.expandedViews`), not in the data model → sub-module expand state stays client-side.
- A database page's child database-views render as tabs over the same data (`DatabaseTabBarBloc`, `_createLinkedView`) → precedent for toggles-as-sibling-views over one dataset.

## 8. Alignment audit (the FIRST task next run — UI-RULES-1 in PROGRESS)

Aligning the project = executing this checklist against `platform/apps/web`:

1. Inventory all pages; classify each dataset per §2 → produce toggle/list/sub-module target map (People/Communities, Automations/Agents/Skills/Integrations, Deals/Sources/Thesis are the seed toggles).
2. Restructure page layouts to §3 (landing section + stacked sections + artifacts section).
3. Add **Form** to the standard views set (extend `ToolbarView` sets + a shared `FormView` component driven by field metadata).
4. Move Control Panel into 3-dots; re-sort its contents into page sections vs admin per §5; delete the `controlPanelTo` toolbar slot.
5. Left nav: implement collapsible sub-module dropdowns under modules.
6. Implement `~/Documents/Bridge Workspace/<Module>/<Sub-module>/` provisioning in the desktop shell + Artifacts section per page (incl. cloud-mirror + rename/move index per §6, empty states per §6a).
7. Wire the >20-artifact watcher → CoS agent grouping call (§6).
8. Update `docs/CODEMAPS/` + wiki after the structural change.
9. Implement shared column/toggle context menus from §5a, including DB-backed Add page/Remove page eligibility, dependency impact checks, undo, permissions, and keyboard access; validate on DealPilot plus two unrelated Modules.

Exit: typecheck + build green, live check of ≥3 restructured pages, BUGS/log/dummy ledgers updated.

## 9. Questions resolved 2026-07-13 (superseded — kept for trail)

1. ~~"forum as a standard view"~~ → **Form**, confirmed typo. See §4.
2. **Documents root** — confirmed OS `~/Documents` folder only. See §6.
3. **Artifacts >20 grouping** — confirmed **smart, CoS-agent-driven**, not a fixed rule. See §6.
4. **Scope of first alignment** — confirmed `platform/apps/web`; deployed prototype (bridge-ai-1ay.pages.dev) still NOT auto-migrated (unchanged).
5. **Toggle vs sub-module boundary** — still surfaces as judgment calls in the UI-RULES-1 audit for approval (unchanged).
6. **Form write path** — confirmed direct insert + Learning-Agent standard-process parity check. See §4.
7. **Empty states** — spec added, §6a.
8. **Cloud/local data** — confirmed no cloud-only personal data; cloud-resident data always mirrored locally. See §6.
9. **Rename/move tracking + conflict resolution** — policy recommended and accepted. See §6.
10. **Deep linking** — confirmed, every toggle page is a route. See §4a.
11. **Acceptance criterion for "Egg + Commons prototype"** — confirmed as EG0–EG1 + CM0–CM1 (per `egg-commons-feature-roadmap-2026-07.md` §6). Status as of 2026-07-13: see `docs/wiki/egg-commons.md` status line / PROGRESS Batch 1 — NOT yet built (see session output for the concrete gap list).
