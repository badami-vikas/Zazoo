# UI Architecture Rules

full: [../raw/ui-architecture-rules-2026-07.md](../raw/ui-architecture-rules-2026-07.md) · verbatim: [../raw/requirement-ui-architecture-rules-2026-07-13.md](../raw/requirement-ui-architecture-rules-2026-07-13.md) · AP-011. Binds hand-built pages AND compiler output.

**Data shape decide surface:**
- Different columns, same table / strong sibling cluster → **TOGGLE** at top. Each toggle target = **page**. Seeds: People/Communities · Automations/Agents/Skills/Integrations · Deals/Sources/Thesis.
- Same columns, same table (row subset) → **LIST** (ListDropdown). Never new page.
- Related to module, not strongly to root/sub-modules → **new SUB-MODULE** = collapsible dropdown under module in left nav.
- Unrelated → new module.

**Page anatomy:** landing section (standard views: table, card, … + NEW **Form view** — one input per field, collects new row, no bespoke create screens) → related sections below → **artifacts section** (module's generated files; >20 → sub-folders, default sub-module→month). Landing section internally scrollable; scroll past it = page scroll.

**Toolbar:** Control Panel ⚙ slot DIES — moves into 3-dots menu. Contents re-sorted: record-ish data → page sections; true admin (mount/unmount, scopes, versions) stays in 3-dots→Control Panel.

**Local artifacts:** `~/Documents/Bridge Workspace/<Module>/<Sub-module>/` — ALL local artifacts + accumulated data live here. Artifacts section = view over this tree. Local plane.

**First task next run = UI-RULES-1** (PROGRESS Batch 1): alignment audit of apps/web per raw doc §8.

**OSS precedent (code diligence 2026-07-13):** view = stored overlay (column show/order + filters + sorts) over SAME table rows → lists + toggles = one mechanism; Form = first-class view type, submission = ordinary row insert; view-type set = registry w/ capability flags (Baserow pattern). Licenses: NocoDB head = Sustainable-Use, patterns ONLY never copy · Baserow core MIT ok (premium dirs proprietary) · Twenty/AppFlowy per outputs file.

**Open Qs (defaults applied):** "forum"→Form assumed · Documents = OS ~/Documents assumed · >20 grouping default · prototype NOT auto-migrated · toggle-vs-sub-module judgment calls surface in audit for approval.
