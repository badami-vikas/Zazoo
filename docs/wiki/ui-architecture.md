# UI Architecture Rules

full: [../raw/ui-architecture-rules-2026-07.md](../raw/ui-architecture-rules-2026-07.md) · verbatim: [../raw/requirement-ui-architecture-rules-2026-07-13.md](../raw/requirement-ui-architecture-rules-2026-07-13.md) · AP-011. Binds hand-built pages AND compiler output.

**Data shape decide surface:**
- Different columns, same table / strong sibling cluster → **TOGGLE**. Seeds: Relationship Signals/People/Communities · DealPilot Deals/Sources/Theses. Agents/Automations/Integrations/Files/Results stay standard Sections unless user adds eligible DB-backed Page. Skills never Page.
- Same columns, same table (row subset) → **LIST** (ListDropdown). Never new page.
- Related to module, not strongly to root/sub-modules → **new SUB-MODULE** = collapsible dropdown under module in left nav.
- Unrelated → new module.

**Page anatomy:** landing section (standard views: table, card, … + **Form view** — one input/field, collects new row, direct insert + Learning Agent applies same standard process other DB writes get e.g. enrichment) → related sections below → **Files section** (>20 → CoS agent smart-groups, not fixed rule). Landing section internally scrollable; scroll past it = page scroll. Empty states = honest, metadata-generated, never dummy rows (§6a).

**Record Detail:** every DB row gets routable detail. Fields + Relations/Tasks/Files/Results/Integrations/Agent activity/Event history = Sections. Detail ≠ sibling Page.

**Toolbar:** Control Panel ⚙ slot DIES — moves into 3-dots menu. Contents re-sorted: record-ish data → page sections; true admin (mount/unmount, scopes, versions) stays in 3-dots→Control Panel.

**Context menus:** shared across ALL Modules. Column right-click: rename/edit/type · AI Smartfill · filter/sort/group/calculate · lock/hide · add left/right · duplicate/delete. DB-backed source only → Add page/Remove page, also on toggle right-click; changes toggle presentation, never deletes DB/data. Capability/permission aware; dependency preview+undo; keyboard path required. Prove on DealPilot + 2 unrelated Modules.

**Local Files:** `~/Documents/Bridge/<Organization>/<Module>/<Sub-module>/` — ALL user-visible Files live here; cloud-resident data mirrored locally too. External rename/move tracked by watcher+hash index; never overwrite user-moved File. Legacy folder discovery/migration occurs under VOCAB4.

**Deep linking:** every toggle page = routable URL (§4a).

**Actionability:** interactive-looking item opens detail/edit/filter/explanation/governed Action. Otherwise plain text. Every installed Module = left-nav route → one standard manifest-driven capability inventory. Module customizes content, never inventory structure.

**Red flag:** only feedback flag. Hover/focus cell or bullet → subtle uncolored flag. Select → red, scoped, reversible, audited. No green/yellow feedback flags. Domain choices use explicit Actions.

**Shell:** left Sidebar + right Chat Panel share expand/collapse/extend icons, state model, persisted width, inner-edge resize, keyboard/ARIA, responsive collision rules.

**Second Brain:** below Modules. IS the Graph view (§3 BRD) at `scope: full` — all permitted Databases across all installed Modules, permission-filtered, same node/edge renderer as a single-Page graph. The Second Brain nav entry is a named preset that opens Graph view pre-configured to `scope: full`. No separate surface, no separate component (ADR-110). Filters + evidence + backlinks + source navigation + governed Actions + list fallback. No static data.

**First task next run = UI-RULES-1** (PROGRESS INTERRUPT): remove deprecated capability/global-index routes, build Module drill-down, nest Skills under Agents, unify panels, Relationship toggles, then Second Brain per raw §8.

**Alignment started 2026-07-14:** inventory + target map → [raw audit](../raw/ui-architecture-alignment-audit-2026-07.md). Covered already: toolbar/list spine, registered non-Form views, some stacked sections + honest empty states. Landed now: dead Control Panel toolbar slot removed; Initiative 3-dots owns Control Panel; Initiative page/view state deep-links via query params. Still open: route-backed seed toggles · Form registry/write parity · sub-module nav · standard Artifacts sections · Documents provisioning/index/watcher · CoS grouping · metadata empty states. macOS FS/entitlement validation flagged, not attempted.

**OSS precedent (code diligence 2026-07-13):** view = stored overlay (column show/order + filters + sorts) over SAME table rows → lists + toggles = one mechanism; Form = first-class view type, submission = ordinary row insert; view-type set = registry w/ capability flags (Baserow pattern). Licenses: NocoDB head = Sustainable-Use, patterns ONLY never copy · Baserow core MIT ok (premium dirs proprietary) · Twenty/AppFlowy AGPL, patterns only.

**View Grammar formalized 2026-07-17 (ADR-108/ADR-110, TASK-014, full: [../raw/brd-dataengine-views-2026-07.md](../raw/brd-dataengine-views-2026-07.md)):** 8 canonical kinds — table/board/gallery/form/**calendar**/map/**graph**/tree — each gated purely by column metadata (date/select/relation/location/parent-ref), never hand-assigned per Page. Code audit found real violations: Calendar wrongly coded as an installed Module/Tool (`/calendar` route even misroutes to Task Manager) with 4 non-shared renderers; fix = one `CalendarView`, no Module/route/nav identity, Google Calendar becomes a plain Integration. Graph (code: `network`, renaming to `graph`) gains a **scope selector**: `single_database` (default — this Page's rows + Relations), `multi_database` (user-selected DBs), `full` (all permitted Databases = **Second Brain**). Second Brain IS the Graph view at `scope: full` — same renderer, same eligibility rule, same component; the Second Brain nav entry is a named preset to that scope. ADR-110 reverses ADR-108's "never merge" stance. `network`→`graph` code rename tracked (glossary already says "graph").

**Current gate:** Avatar foundation/Onboarding + CM0–CM1. Form/direct-insert, smart grouping, honest empty states, local mirror, rename tracking, deep links unchanged. Toggle-vs-sub-module judgment stays in UI-RULES-1 audit.
