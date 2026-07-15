# UI Architecture Rules

full: [../raw/ui-architecture-rules-2026-07.md](../raw/ui-architecture-rules-2026-07.md) · verbatim: [../raw/requirement-ui-architecture-rules-2026-07-13.md](../raw/requirement-ui-architecture-rules-2026-07-13.md) · AP-011. Binds hand-built pages AND compiler output.

**Data shape decide surface:**
- Different columns, same table / strong sibling cluster → **TOGGLE** at top. Each toggle target = **page**. Seeds: People/Communities · Automations/Agents/Skills/Integrations · Deals/Sources/Thesis.
- Same columns, same table (row subset) → **LIST** (ListDropdown). Never new page.
- Related to module, not strongly to root/sub-modules → **new SUB-MODULE** = collapsible dropdown under module in left nav.
- Unrelated → new module.

**Page anatomy:** landing section (standard views: table, card, … + **Form view** — one input/field, collects new row, direct insert + Learning Agent applies same standard process other DB writes get e.g. enrichment) → related sections below → **Files section** (>20 → CoS agent smart-groups, not fixed rule). Landing section internally scrollable; scroll past it = page scroll. Empty states = honest, metadata-generated, never dummy rows (§6a).

**Toolbar:** Control Panel ⚙ slot DIES — moves into 3-dots menu. Contents re-sorted: record-ish data → page sections; true admin (mount/unmount, scopes, versions) stays in 3-dots→Control Panel.

**Context menus:** shared across ALL Modules. Column right-click: rename/edit/type · AI Smartfill · filter/sort/group/calculate · lock/hide · add left/right · duplicate/delete. DB-backed source only → Add page/Remove page, also on toggle right-click; changes toggle presentation, never deletes DB/data. Capability/permission aware; dependency preview+undo; keyboard path required. Prove on DealPilot + 2 unrelated Modules.

**Local Files:** `~/Documents/Bridge/<Organization>/<Module>/<Sub-module>/` — ALL user-visible Files live here; cloud-resident data mirrored locally too. External rename/move tracked by watcher+hash index; never overwrite user-moved File. Legacy folder discovery/migration occurs under VOCAB4.

**Deep linking:** every toggle page = routable URL (§4a).

**First task next run = UI-RULES-1** (PROGRESS Batch 1): alignment audit of apps/web per raw doc §8.

**OSS precedent (code diligence 2026-07-13):** view = stored overlay (column show/order + filters + sorts) over SAME table rows → lists + toggles = one mechanism; Form = first-class view type, submission = ordinary row insert; view-type set = registry w/ capability flags (Baserow pattern). Licenses: NocoDB head = Sustainable-Use, patterns ONLY never copy · Baserow core MIT ok (premium dirs proprietary) · Twenty/AppFlowy AGPL, patterns only.

**Current gate:** Avatar foundation/Onboarding + CM0–CM1. Form/direct-insert, smart grouping, honest empty states, local mirror, rename tracking, deep links unchanged. Toggle-vs-sub-module judgment stays in UI-RULES-1 audit.
