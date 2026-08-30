# The UI Rulebook (wiki index)

**Canon: [`../raw/ui-rulebook.md`](../raw/ui-rulebook.md).** One file, four parts — I architecture ·
II interaction/element-pages/ergonomics (C-rules) · III design system · IV open decisions. This page is
the terse index; the raw rulebook is the source of truth.

The three canons it replaced are stubs: `ui-architecture.md`, `design-system.md`,
`raw/DESIGN-SYSTEM.md`. CVN's original C-rule wording is archived at
`raw/ui-conventions-cvn-archive.md` for provenance and is NOT a rule source.

Still authoritative outside the rulebook, deliberately: **`ui-conformance.test.mjs`** holds enforcement
(a rule only binds when a test fails — where the doc and the gate disagree, the gate wins);
**`theme.css`** holds token values (a value in a doc drifts from the value in code).

**Tags.** `[GATED]` a test fails if you break it · `[CANON]` binding, but only a reviewer catches it · `[NEW]` approved 2026-08-29/30, not yet built.

---

## How to read this book

Every rule states the thing to build. No rule is phrased as the negation of a past mistake, and none exists only to say that an example is not a definition — where the definition is complete, the comparison carries no information and is deleted. Named Modules and Agents illustrate rules; they never supply their content. (ADR-258)

- **Module** `[CANON]` — an installable unit declaring its own manifest, version and trust lifecycle, owning one or more Databases and the Pages that render them. One rail entry each. Governed by its own manifest `governance` block.
- **Sub-module** `[CANON]` — a Module declaring `module.parent_module`. Navigational only: no shared credentials, no inherited permissions, no plane relaxation, one level deep. An unresolvable or cyclic parent renders the child at root — grouping is a re-arrangement, never a filter.
- **Agent** `[CANON]` — an attributable actor that holds Skills, is invoked under a declared scope, and produces Agent Runs. A Skill is never invoked except by an Agent allowed to hold it, and never appears as a Page. Automations start Agent Runs.
- **View** `[CANON]` — a stored overlay (column show/order, filters, sorts) over the same table rows. Eight kinds: table, board, gallery, form, calendar, map, graph, tree. Metadata decides eligibility; `DataViews` is the only renderer path.
- **List** `[CANON]` — the same mechanism over a row subset.
- **New** `[NEW]` — creates a Record by opening a new element page showing every field of that Database, identical to that element's page before any user input, with column defaults already applied. Writes nothing until Save. Pre-filling a default is not a write.
- **Form view** `[CANON]` — collects one new Record through its fields and inserts it through the same governed pipeline as any other write.
- **Element page** `[CANON]` — the routable detail surface every Database row gets. Fields plus Sections: Relations, Tasks, Files, Results, Integrations, Agent activity, Event history, and whichever of Notes / Intelligence / Governance are enabled for that element in the toolbar ⋮. Never a sibling Page.

---

## 0 · What wins when rules disagree

- **Precedence** `[CANON]` — 1. A passing gate in `ui-conformance.test.mjs`, the only rule that cannot be ignored. 2. The latest user directive / ADR by date. 3. The doc text.
- **Second Brain** `[GATED]` — one entry point: the first tab of Intelligence. No rail entry; `/second-brain` redirects to `/intelligence`. (ADR-224)
- **Module Detail is gone** `[CANON]` — deleted 2026-08-10. `/module/:name` resolves only as a redirect to the Module's landing Page; the cross-Module inventory lives at `/intelligence`. **Consequence, recorded not hidden: admin — mount/unmount, scopes, versions — has no surface at all today.** Choosing its new home is an open product question (TASK-080).
- **Dropdown search** `[CANON]` — the 6-option threshold is **retained**; imported C-22's "search on every dropdown, always" is narrowed to "past six options". A three-option dropdown reads faster without a search box. C-22's pinned "+ Add" is untouched. (ADR-259)
- **New: one gesture** `[NEW]` — **C-33 is reversed**; C-7 applies everywhere, table-shaped records included. One creation gesture beats the keystroke C-33 saved. The zero-rows rule is untouched, and the gated add-row test is rewritten rather than deleted. (ADR-258)
- **Disabled vs never-refuse** `[CANON]` — C-31 governs the missing-related-record case (the picker creates it); ADR-001 governs everything else; enabled-with-warning (§3) narrows both.

---

## 1 · Shell & navigation

- **One header height** `[GATED]` — rail org row, page header and chat-panel header are the shared `h-14` constant, aligned on one line at the same y-origin, at every viewport and orientation. (§5g, C-1, ADR-187)
- **macOS titlebar** `[GATED]` — on macOS the header row *is* the titlebar: no reserved strip, traffic-light gutter respected, workspace name exactly once.
- **Closed left-nav** `[CANON]` — the rail carries ONLY profile/Organization control, Modules, Intelligence, Settings. Settings pinned last; the Modules region is the rail's only scroller. (ADR-180/AP-103)
- **Right-click a Module** `[NEW]` — opens a context menu with **Hide** and **Rename**, the same gesture that opens the column menu on a table header. Hidden Modules are restored from a rail **View options** entry, never lost. Hiding is presentation only: it never uninstalls, never alters permissions or plane, never filters a Module out of Intelligence or search. (TASK-081)
- **Drag to reorder** `[NEW]` — Modules are drag-reorderable and the order persists per Organization. (TASK-081)
- **Panels collapse** `[CANON]` — both side panels always collapsible/expandable; the resize affordance reveals on hover/focus only. Collapsed = no extra icons; empty-space click expands.
- **Soft seams** `[CANON]` — shell seams are `box-shadow`, never a hard border. Internal panel headers keep their own `border-b`. (ADR-187)
- **Nav lands on data** `[CANON]` — clicking a Module opens its first real data Page, never a capability inventory. (ADR-152/AP-084)
- **Zazoo always on** `[CANON]` — present on every launch and every route, ungated by onboarding; only what it may *do* is gated.
- **Chat composer** `[CANON]` — one rounded bordered row: paperclip · model pill · text · mic · send, sized by the `compact` prop. (ADR-186/AP-108)
- **Paperclip uploads** `[NEW]` — attachments route through the same Module File path every other upload uses (`modules.addFile`). (TASK-082)
- **Mic everywhere** `[NEW]` — the chat mic works on every Bridge surface, not only inside the Tauri shell. (TASK-082)
- **Avatar auto-sends** `[CANON]` — speaking to the Avatar via its shortcut sends the transcript straight through. The panel Chat mic still fills the draft for review; a Chat turn can start governed Task proposals, so that split is deliberate.

---

## 2 · Page anatomy & data shape

- **One shell** `[GATED]` — data-shape pages render through `ModuleSurfaceLayout` + `DataViews`, or sit in `EXEMPT` with a written reason. Hand-rolled tables, toolbars and dropdowns fail the build. (§3, §5)
- **Page order** `[CANON]` — landing section (standard views incl. Form) → related sections → Files section (>20 files → agent smart-grouping) → Intelligence section (Agents · Automations · Integrations, manifest-sourced, read-only) → Governance section.
- **Shape decides surface** `[CANON]` (ADR-259) — the axis is the **Database**, not the column set:
  - **One Database → LIST**, whatever changes: different columns, different rows, or both. That is what a View is. **Never a new Page.**
  - **Several Databases that share Relations → TOGGLE**: sibling Pages, buttons at the top of one surface. The test is inter-relation, not column similarity.
  - **Conceptually related Modules → SUB-MODULE**: parent/child, collapsible under the parent in the rail.
  - **Unrelated → new Module.**
- **Record Detail** `[CANON]` — every DB row gets a routable detail page. Detail is never a sibling Page.
- **Deep links** `[CANON]` — every toggle page is a routable URL. (§4a)
- **New opens a page** `[NEW]` — New opens a new element page showing every field, defaults pre-filled, writing nothing until Save. The New affordance is part of the table's shape: always present, stating its reason when it cannot insert rather than vanishing. (TASK-083; the reason-when-disabled half stays `[GATED]`)
- **Local files** `[CANON]` — all user-visible Files live at `~/Documents/Bridge/<Org>/<Module>/<Sub-module>/`; renames carry forward; a user-moved file is never overwritten. (ADR-125/178)

---

## 3 · Primitives — one of each

- **One dropdown** `[GATED]` — `StandardDropdown` owns all dropdowns: selected-first, type-to-filter search past six options, pinned "＋ Add" that never scrolls or filters away, 5 rows then scroll. Missing behaviour goes into the primitive, never a local variant. No bare `<select>` where a user picks a record. (§5e, C-22 as narrowed)
- **StandardColumnMenu** `[GATED]` — opened by right-clicking the header or its caret; the same 17 items either way: **Rename · Edit column · Change type · AI Smartfill** — **Filter · Sort ascending · Sort descending · Group** — **Calculate · Lock column · Hide column** — **Add column left · Add column right · Duplicate · Delete** — and, on Database-backed columns only, **Add page · Remove page**.
- **StandardRowMenu** `[GATED]` — opened by right-clicking any cell or the row caret; identical items: **Open · Edit · Duplicate · Pin** — separator — **Delete**. The red-flag control lives here.
- **Toolbar ⋮** `[CANON]` — **Add column · View options · Sort by · Elements · Reset view**. Filter folds in when the row compresses. No Admin entry, no Control Panel.
- **Elements** `[NEW]` — the ⋮ carries an **Elements** entry with per-element toggles for **Notes**, **Intelligence** and **Governance**, deciding which Sections an element page shows. Turning one off hides the Section and preserves its content; it never deletes. (TASK-083)
- **Enabled with warning** `[NEW]` — a command the surface *can* run is enabled and warns: it states the consequence and proceeds on confirmation. Disabled-with-a-reason is reserved for what is genuinely impossible here. Destructive schema commands warn by showing dependency preview + confirmation + undo — that is the warning, not an exception to it. ADR-001 still forbids hiding a command. (TASK-084)
- **One insights row** `[GATED]` — the dashboard strip is the one `DashboardRow` component everywhere.

---

## 4 · Toolbar & table chrome

- **One row means one row** `[CANON]` — the insights strip and the toolbar are each a single row that never wraps. Compress first; side-scroll last. (C-2, C-3)
- **Right-aligned cluster** `[CANON]` — Filter · New · ⋮, right-aligned and adjacent, in that order. The menu glyph is vertical `⋮`. (C-4, C-5, C-6)
- **Card + lists + grouping** `[CANON]` — every table's View dropdown offers Table and Card; the Lists dropdown offers "+ Add list"; grouping lives under ⋮. (C-8, C-9)

---

## 5 · Interaction & touch

- **Whole row is the target** `[CANON]` — clicking any cell opens that row's element page. No dead cells. (C-10)
- **Double-click edits** `[CANON]` — every cell is editable in place unless marked `editable:false` or `locked`. Double-click opens the inline editor — cells, list names, column headings, section titles — click-outside commits, and the write goes through the same governed pipeline as any other write, never a second path. An Edit button is an addition, never a replacement. (C-11)
- **fx toggles the formula** `[NEW]` — a cell in a `formula` column shows an **fx** affordance in its editor, switching between editing the value and editing the expression. Editing the expression changes the column, so it warns before committing. Binds to Accounting's existing formula engine rather than growing a second one. (TASK-084)
- **Long-press order** `[CANON]` — on touch, long-press fires the context menu where one exists; only without one does it stand in for hover-reveal. (C-12)
- **Deletes reveal and confirm** `[CANON]` — delete controls are never resident: hover, long-press, or inside the ⋮. Record-level delete lives in the element page's ⋮. Every delete asks first and says what cannot be undone. (C-13, C-23)
- **Focus in the gesture** `[CANON]` — every editable surface raises the keyboard on first tap; focus moves inside the gesture handler. Deferred `autoFocus` or effect focus is a defect on iOS Safari, not a platform limit. (C-14)
- **Actionability** `[CANON]` — anything that looks interactive must perform, open, filter, explain, or start a governed Action. Otherwise it is plain text.

---

## 6 · Element (detail) pages

- **Back + path header** `[CANON]` — back button plus breadcrumb, sticky; content scrolls under it, never hidden behind it. (C-15)
- **Section buttons** `[CANON]` — all of a section's buttons form one row at its top or bottom. (C-16)
- **Print one** `[CANON]` — print/PDF view is editable and renders only the selected element. (C-17)
- **Write on first save** `[CANON]` — a page opened for a new record writes nothing until Save. A picker's "+ Add" is the deliberate exception. (C-34)

---

## 7 · Fields, dropdowns & relations

- **Tooltips, not prose** `[CANON]` — descriptions are concise tooltips, a phrase not a sentence. (C-18)
- **Dropdown over checkbox** `[CANON]` — "Add column" offers Dropdown (single/multi-select) rather than Checkbox. (C-19)
- **Link to related DBs** `[CANON]` — a relation column's "Link to" picker lists only databases already related to the current one. (C-20)
- **Star a default** `[CANON]` — every value-picking dropdown lets an option be starred; defaults are per-device. View/Filter dropdowns exempt. (C-21)
- **Never a dead end** `[CANON]` — if a field needs a record that doesn't exist, the picker's "+ Add" creates it in place. (C-31)
- **Relations are symmetric** `[CANON]` — a connection is one fact, makeable and unmakeable from either end. (C-32)
- **Present, not absent** `[CANON]` — a command that cannot run stays visible and disabled with a reason. (ADR-001)

---

## 8 · Empty states & honesty

- **Chrome stays, silence** `[GATED]` — an empty View keeps full chrome (headers, grid pitch, New affordance, footer) and says NOTHING at zero rows. Never replaced by a message box. Filler rows are `aria-hidden`, never Records. (§6b)
- **No dummies** `[CANON]` — real connected data or honest empty states. Any unavoidable dummy is tracked in `docs/dummy.md` with a removal condition.
- **Data is never invented** `[CANON]` — never fabricate a figure; "unknown" is first-class. Generated UI binds ids, never carries values; the server has the last word. (ADR-247)

---

## 9 · Flags & feedback

- **Red is the only flag** `[CANON]` — no green or yellow feedback flags. Hover a cell → subtle uncolored flag; select → red, scoped, reversible, audited. (§5d, AP-023)
- **Click removes** `[GATED]` — plain click toggles unflagged ↔ flagged. Inspect, edit and reason live on right-click / long-press / Shift+Enter, and the flag lives in the standard row menu.
- **RAG is domain data** `[CANON]` — a red/yellow/green cell status is a user-entered domain signal, never a feedback flag. (ADR-155)

---

## 10 · Ergonomics laws (AP-012 / ADR-010)

- **Fitts** `[CANON]` — the most-reached control is largest and nearest; Save sits next to what it saves; every touch target clears 44px. (C-24)
- **Proximity** `[CANON]` — controls that act together sit and wrap together; a wrapping row breaks between fields, never inside one. (C-25)
- **Size follows answer** `[CANON]` — a 2-character answer gets a 2-character box; labels use the abbreviation people already use. (C-26)
- **Hick** `[CANON]` — one way to do a thing. Two controls that create the same record are one too many. (C-27)
- **Jakob** `[CANON]` — familiar first: a table behaves like a spreadsheet, a dropdown like a dropdown. (C-28)
- **Miller** `[CANON]` — chunk lists and heavy text at five to seven. Twenty undifferentiated things is a defect. (C-29)
- **Tidy is correctness** `[CANON]` — consistent spacing, alignment and rhythm are part of correctness, not decoration. (C-30)

---

## 11 · Views, graph & privacy

- **View grammar** `[CANON]` — eight types; metadata decides eligibility; legacy aliases fail; Calendar has no route identity; Google Calendar is an Integration only. (ADR-108/110)
- **Display hints** `[CANON]` — `ColumnSpec.display` (badge · rag · meter · currency · multiple) is opt-in and purely visual; value, edit, sort, filter and writes untouched. (ADR-155)
- **Graph encoding** `[CANON]` — categorical node colour from the ordered `GRAPH_PALETTE` (never a hue hash), mandatory legend, one shared `colorOf`. Edge labels drawn on the edge, never upside down; label fade with zoom is stated, never silent. (ADR-223)
- **Map privacy** `[CANON]` — local basemap only; stored coordinates plot; no public geocoder, no remote tiles; labels stay local. (ADR-124)

---

## 12 · Governance Section (ADR-248, TASK-072, AP-163)

- **On every Module** `[CANON]` — sits immediately below the Intelligence Section on every Module page, rendered from the manifest's `governance` block as Allowed / Denied. Intelligence answers *what this Module can do*; Governance answers *what it may do*.
- **Empty is not deny** `[CANON]` — a Module with no policy renders the Section with an honest empty state and is never filtered out of the layout. (ADR-001)
- **The engine reads it** `[CANON]` — governance that only renders reproduces the prose-nobody-enforces failure it exists to end. The exit test is enforcement, not rendering. *Enforced at one call site today; one Module of thirteen declares a policy.*
- **User-editable** — **broken today**: the edit link points at a deleted page and no mutation exists to write a policy. Filed in BUGS 2026-08-29.

---

## 13 · Design system

- **Tokens or nothing** `[CANON]` — source of truth is `theme.css`. Components consume tokens; never hardcode hex, raw `text-gray-*`, or ad-hoc pixel sizes.
- **Palette** `[CANON]` — warm paper `#FAF9F5` · surface `#F0EEE8` · navy ink `#1A2B3C` · steel primary `#4D7EA8` · sage trust · amber dormant · border `#E2DED5`. Relationship states encode as hue + position, never a number.
- **Type** `[CANON]` — Geist for UI/data/body; Source Serif 4 for headings and person names. Scale h1 32 / h2 24 / h3 18 / h4 16 · body 15 · label 12. Weights 300–600. Minimum 12px.
- **Rhythm** `[CANON]` — spacing 4/8/16/24/40/64 · radius card 12, button 8, pill 20 · motion 200/400/2000ms ease-out. Calm, premium, trust-first — not loud SaaS.

---

## Open work

| Task | What |
|---|---|
| TASK-080 | Canon repair — Module Detail purged, `module.yaml` corrected, backward-facing rules replaced by definitions, data-shape tree re-axed |
| TASK-081 | Rail right-click (Hide / Rename) + View options + drag-reorder |
| TASK-082 | Paperclip uploads; mic on every surface |
| TASK-083 | New opens an element page with defaults pre-filled; ⋮ → Elements |
| TASK-084 | Governed schema-mutation capability — turns enabled-with-warning and fx into behaviour |
| TASK-073 | Retrofit the C-rules onto the seven pre-2026-08-16 Modules |
| TASK-061 | Burn down the divergence ratchet |

**Two open defects** (BUGS 2026-08-29): the Governance Section's circular "Edit in Module Detail" link; canon documents naming surfaces that do not exist.

**Two live gaps this book names and does not paper over.** Admin (mount/unmount, scopes, versions) has no surface at all. And C-9 requires every table to offer grouping from the ⋮ — `Group` is disabled on every table, because `onGroup` is passed by nobody.
