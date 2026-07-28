# UI Architecture Rules

full: [../raw/ui-architecture-rules-2026-07.md](../raw/ui-architecture-rules-2026-07.md) · verbatim: [../raw/requirement-ui-architecture-rules-2026-07-13.md](../raw/requirement-ui-architecture-rules-2026-07-13.md) · AP-011. Binds hand-built pages AND compiler output.

**Data shape decide surface:**
- Different columns, same table / strong sibling cluster → **TOGGLE**. Seeds: Relationship Signals/People/Communities · DealPilot Deals/Sources/Theses. Agents/Automations/Integrations/Files/Results stay standard Sections unless user adds eligible DB-backed Page. Skills never Page.
- Same columns, same table (row subset) → **LIST** (ListDropdown). Never new page.
- Related to module, not strongly to root/sub-modules → **new SUB-MODULE** = collapsible dropdown under module in left nav.
- Unrelated → new module.

**Page anatomy:** landing section (standard views: table, card, … + **Form view** — one input/field, collects new row, direct insert + Learning Agent applies same standard process other DB writes get e.g. enrichment) → related sections below → **Files section** (>20 → CoS agent smart-groups, not fixed rule) → **Intelligence section** (tabs: Agents · Automations · Integrations, manifest-sourced, read-only, links to Module Detail — AP-081). Landing section internally scrollable; scroll past it = page scroll. Table stays visible even at zero rows (Notion-style empty body + Add row), never replaced by a message box (AP-081). Empty states = honest, metadata-generated, never dummy rows (§6a).

**Record Detail:** every DB row gets routable detail. Fields + Relations/Tasks/Files/Results/Integrations/Agent activity/Event history = Sections. Detail ≠ sibling Page.

**Toolbar:** Control Panel ⚙ slot DIES — moves into 3-dots menu. Contents re-sorted: record-ish data → page sections; true admin (mount/unmount, scopes, versions) stays in 3-dots→Control Panel.

**Context menus:** shared across ALL Modules. Column right-click: rename/edit/type · AI Smartfill · filter/sort/group/calculate · lock/hide · add left/right · duplicate/delete. DB-backed source only → Add page/Remove page, also on toggle right-click; changes toggle presentation, never deletes DB/data. Capability/permission aware; dependency preview+undo; keyboard path required. Prove on DealPilot + 2 unrelated Modules.

**Local Files:** `~/Documents/Bridge/<Organization>/<Module>/<Sub-module>/` — ALL user-visible Files live here; cloud-resident data mirrored locally too. List/upload/Organization rename share one DB row lock and recover rename intent first (ADR-125). External rename/move tracked by watcher+hash index; never overwrite user-moved File. Legacy folder discovery/migration occurs under VOCAB4.

**Deep linking:** every toggle page = routable URL (§4a).

**Actionability:** interactive-looking item opens detail/edit/filter/explanation/governed Action. Otherwise plain text. Every installed Module = left-nav route that **lands on the Module's primary data Page** (its first manifest Page — buttons-at-top sibling toggle), NOT the `/module/:name` capability inventory (ADR-152/AP-084, supersedes VOCAB6/TASK-001 "each Module links to /module/:moduleName"). The one standard manifest-driven capability inventory (Module Detail) stays reachable from each data Page's Intelligence Section ("Manage in Module Detail") + 3-dots Control Panel. Module customizes content, never inventory structure. Landing/active-highlight derive from `moduleNavTarget` (`@bridge/module-manifests`): `landing` = first Page route, `base` = shared Page-route prefix.

**Red flag:** only feedback flag. Hover/focus cell or bullet → subtle uncolored flag. Select → red, scoped, reversible, audited. No green/yellow feedback flags. Domain choices use explicit Actions.

**Shell:** left Sidebar + right Chat Panel share a single collapse icon + inner-edge double-arrow resize handle (the extend/full-screen icon was dropped — AP-081), state model, persisted width, keyboard/ARIA, responsive collision rules. Collapsed = no extra icons, double-arrow persists, empty-space click expands. Left nav: Home, then Modules (Task Manager is a default Module), then "+New"; Second Brain + Intelligence sit at the bottom above Settings. **Intelligence is its own top-level route `/intelligence`** (ADR-154/AP-086, supersedes AP-081's "deep-links Settings → Capabilities"): the cross-Module capability inventory — tabs Agents · Automations · Skills · Integrations, flattened from every installed Module's manifest, Module shown as provenance only (never a Module list). Skills always name their consuming Agent. The Settings "Capabilities" section is deleted; `?section=intelligence` redirects. Distinct from the deleted VOCAB6 prototype Intelligence/marketplace surface, which stays dead. Nav never shows a "Modules unavailable" state — the default Module keeps the list non-empty.

**Second Brain:** below Modules. IS the Graph view (§3 BRD) at `scope: full` — all permitted Databases across all installed Modules, permission-filtered, same node/edge renderer as a single-Page graph. The Second Brain nav entry is a named preset that opens Graph view pre-configured to `scope: full`. No separate surface, no separate component (ADR-110). Filters + evidence + backlinks + source navigation + governed Actions + list fallback. No static data.

**Alignment delivered 2026-07-19 (TASK-014/TASK-009):** dead global surfaces gone. Installed Module drill-down, Agent-owned Skills, symmetric panels, Relationship toggles, standard Files sections, Form/direct insert, honest empty states, deep links, and one View registry landed. DealPilot, JobPilot, Relationship, Work, Initiative, and Task Manager use the shared shell.

**Column commands:** one keyboard/pointer menu. Full canonical command list present. Unsupported schema writes disabled with reason. Add/Remove Page shown only for Database-backed columns. No destructive schema command runs without dependency preview + confirmation + undo.

**OSS precedent (code diligence 2026-07-13):** view = stored overlay (column show/order + filters + sorts) over SAME table rows → lists + toggles = one mechanism; Form = first-class view type, submission = ordinary row insert; view-type set = registry w/ capability flags (Baserow pattern). Licenses: NocoDB head = Sustainable-Use, patterns ONLY never copy · Baserow core MIT ok (premium dirs proprietary) · Twenty/AppFlowy AGPL, patterns only.

**View Grammar implemented 2026-07-19 (ADR-108/ADR-110, TASK-014, full: [BRD](../raw/brd-dataengine-views-2026-07.md)):** table/board/gallery/form/calendar/map/graph/tree. Metadata decides eligibility. `DataViews` registry is only renderer path. v1 `kanban`/`network` migrate to board/graph; v2 aliases fail. Calendar has no Module/Tool/route identity. Google Calendar = Integration only. Graph scopes: one Database · selected Databases · full. Full = Second Brain preset. Same canvas everywhere.

**Map privacy (ADR-124):** local basemap. Stored coordinates plot. Labels stay local. No public geocoder. No remote tiles. Human may run configured Local Plane geocoder, inspect pins, save through normal Record write.

**Still open elsewhere:** VOCAB4 local File watcher/hash index must connect Module Files to canonical File/Relation provenance (TASK-012). Legacy `/item/:name` Associations still consumes prototype network data (TASK-013). CoS smart grouping begins only after >20 real Files.

**VOCAB6 residual closed 2026-07-20:** active ModuleStore drives nav/detail/full-Graph Module+Agent identity. Recent Runs durable. Edges open real source paths. Panels share 3-state control. Knowledge runtime zero. Final compatibility deletion still separate.
