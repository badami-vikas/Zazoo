# UI Architecture Rules

full: [../raw/ui-architecture-rules-2026-07.md](../raw/ui-architecture-rules-2026-07.md) · verbatim: [../raw/requirement-ui-architecture-rules-2026-07-13.md](../raw/requirement-ui-architecture-rules-2026-07-13.md) · AP-011. Binds hand-built pages AND compiler output.

**Data shape decide surface:**
- Different columns, same table / strong sibling cluster → **TOGGLE** at top. Each toggle target = **page**. Seeds: People/Communities · Automations/Agents/Skills/Integrations · Deals/Sources/Thesis.
- Same columns, same table (row subset) → **LIST** (ListDropdown). Never new page.
- Related to module, not strongly to root/sub-modules → **new SUB-MODULE** = collapsible dropdown under module in left nav.
- Unrelated → new module.

**Page anatomy:** landing section (standard views: table, card, … + **Form view** — one input/field, collects new row, direct insert + Learning Agent applies same standard process other DB writes get e.g. enrichment) → related sections below → **artifacts section** (>20 → CoS agent smart-groups, not fixed rule). Landing section internally scrollable; scroll past it = page scroll. Empty states = honest, metadata-generated, never dummy rows (§6a).

**Toolbar:** Control Panel ⚙ slot DIES — moves into 3-dots menu. Contents re-sorted: record-ish data → page sections; true admin (mount/unmount, scopes, versions) stays in 3-dots→Control Panel.

**Local artifacts:** `~/Documents/Bridge Workspace/<Module>/<Sub-module>/` (OS Documents folder, confirmed) — ALL local artifacts live here; cloud-resident data ALWAYS mirrored locally too, never cloud-only. Rename/move outside app tracked via FS-watcher + content-hash index (Dropbox-style), conflict = app never overwrites user-moved file, recreates its own copy instead.

**Deep linking:** every toggle page = routable URL (§4a).

**First task next run = UI-RULES-1** (PROGRESS Batch 1): alignment audit of apps/web per raw doc §8.

**Alignment started 2026-07-14:** inventory + target map → [raw audit](../raw/ui-architecture-alignment-audit-2026-07.md). Covered already: toolbar/list spine, registered non-Form views, some stacked sections + honest empty states. Landed now: dead Control Panel toolbar slot removed; Initiative 3-dots owns Control Panel; Initiative page/view state deep-links via query params. Still open: route-backed seed toggles · Form registry/write parity · sub-module nav · standard Artifacts sections · Documents provisioning/index/watcher · CoS grouping · metadata empty states. macOS FS/entitlement validation flagged, not attempted.

**OSS precedent (code diligence 2026-07-13):** view = stored overlay (column show/order + filters + sorts) over SAME table rows → lists + toggles = one mechanism; Form = first-class view type, submission = ordinary row insert; view-type set = registry w/ capability flags (Baserow pattern). Licenses: NocoDB head = Sustainable-Use, patterns ONLY never copy · Baserow core MIT ok (premium dirs proprietary) · Twenty/AppFlowy AGPL, patterns only.

**All open Qs resolved 2026-07-13** (§9 of raw doc) — Form confirmed (typo fix) · Documents = OS folder confirmed · smart CoS-driven grouping · direct-insert Form write + Learning Agent parity check · empty-state spec added · cloud-always-mirrored-locally · rename/move tracking policy · deep-linking confirmed · Egg+Commons acceptance criterion = EG0–EG1+CM0–CM1 confirmed (NOT yet built — see egg-commons.md). Toggle-vs-sub-module boundary judgment calls still surface in the UI-RULES-1 audit.
