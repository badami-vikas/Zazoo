# UI Architecture Rules

full: [../raw/ui-architecture-rules-2026-07.md](../raw/ui-architecture-rules-2026-07.md) · verbatim: [../raw/requirement-ui-architecture-rules-2026-07-13.md](../raw/requirement-ui-architecture-rules-2026-07-13.md) · AP-011. Binds hand-built pages AND compiler output.

**RULES ARE GENERIC (§0, 2026-08-10).** No per-Module UI standard exists. DealPilot/CoS/JobPilot are *examples of* the standard, never definitions of it. A behaviour only one page implements is a divergence, not a standard.

**ENFORCEMENT (§10, 2026-08-10).** Rules used to live only in docs → nothing failed when a page ignored them → 5 of 21 pages were conformant and two competing toolbars coexisted (`StandardToolbar` = 1 consumer; `DataViews` grew its own). Now `platform/apps/web/test/ui-conformance.test.mjs` fails the build: every page must use `ModuleSurfaceLayout`+`DataViews` or sit in `EXEMPT` with a written reason; hand-rolled dropdowns/search/raw `<table>` fail; pre-existing divergences sit in a **ratchet** that can only shrink (fixed entry not deleted = also fails). Burn-down = TASK-061. **This `.md` is the only store — rendered/HTML exports are never canon.**

**Standard dropdown (§5e).** ONE primitive: `StandardDropdown.tsx`. Always selected-first + type-to-filter search (auto >6 opts) + pinned "＋ Add" that never scrolls + 5 rows then scroll. `ListDropdown` and the View switcher are bindings over it. Missing behaviour → add to the primitive, never a local variant.

**Red flag click = REMOVE flag (§5, 2026-08-10).** Plain click toggles unflagged↔flagged. Inspect/edit/reason/correction moved to right-click / long-press / Shift+Enter.

**Form is a VIEW, not an Add-row alternative (§5).** Table always keeps its New Element row too. **No Build/Preview mode toggle** — field config lives in 3-dots like every other view. Double-click edits, click-outside auto-saves. Shareable under the list/view permission model.

**3 menus, one definition each (§5f).** Column right-click ≡ header caret ≡ `StandardColumnMenu`; cell right-click ≡ row caret ≡ `StandardRowMenu`; toolbar 3-dots = Add column · View options · Sort · Export · Admin. Right-click MUST open the same menu the visible button opens.

**Shell invariants (§5g).** Both panels always collapsible/expandable, affordance revealed on hover/focus. Headers always aligned — one `h-14` constant. **Zazoo companion present on every launch, every route,** ungated by onboarding (only what it may *do* is gated).

**Data shape decide surface:**
- Different columns, same table / strong sibling cluster → **TOGGLE**. Seeds: Relationship Signals/People/Communities · DealPilot Deals/Sources/Theses. Agents/Automations/Integrations/Files/Results stay standard Sections unless user adds eligible DB-backed Page. Skills never Page.
- Same columns, same table (row subset) → **LIST** (ListDropdown). Never new page.
- Related to module, not strongly to root/sub-modules → **new SUB-MODULE** = collapsible dropdown under module in left nav. **Implemented ADR-178/AP-105 (2026-08-05):** the CHILD declares `module.parent_module` in its manifest (parent manifests are immutable, so the parent can't be the one to know). Nav relation ONLY — sub-module keeps own manifest/version/trust lifecycle; declaring a parent grants no permission, credential, or plane relaxation. One level, enforced in `buildModuleNavTree` (a grandchild re-attaches to the root). Parent resolves at nav-build time, never parse time, so install ORDER can't decide validity. Unresolvable parent, uninstalled parent, or a cycle all render the child AT ROOT — grouping is a re-arrangement, never a filter (an installed Module is always visible). Today: WhatsApp under NetworkManager. Gmail is an Integration not a Module; LinkedIn doesn't exist.
- Unrelated → new module.

**Page anatomy:** landing section (standard views: table, card, … + **Form view** — one input/field, collects new row, direct insert + Learning Agent applies same standard process other DB writes get e.g. enrichment) → related sections below → **Files section** (>20 → CoS agent smart-groups, not fixed rule) → **Intelligence section** (tabs: Agents · Automations · Integrations, manifest-sourced, read-only, links to Module Detail — AP-081). Landing section internally scrollable; scroll past it = page scroll. Table stays visible even at zero rows (Notion-style empty body + Add row), never replaced by a message box (AP-081). Empty states: **View surfaces (table/board/calendar/graph/Artefacts) keep full chrome and say NOTHING at zero rows (§6b, supersedes §6a there)** — headers, grid pitch, add-row, aggregate footer, all at the END of the section, box hugs content (`max-h-full`). Filler rows are `aria-hidden`, not Records. Non-View surfaces keep §6a's honest metadata-generated copy; never dummy rows.

**Record Detail:** every DB row gets routable detail. Fields + Relations/Tasks/Files/Results/Integrations/Agent activity/Event history = Sections. Detail ≠ sibling Page.

**Toolbar:** Control Panel ⚙ slot DIES. It moved into the 3-dots menu (AP-011); **ADR-180/AP-103 then dropped the 3-dots entry too** — its only item duplicated the scroll-revealed Intelligence Section's "Manage in Module Detail". Record-ish data → page sections; true admin (mount/unmount, scopes, versions) → **Module Detail, reached from the Intelligence Section below the table**. A 3-dots menu may return only with real page-scoped items, never with a link the surface already carries.

**Context menus:** shared across ALL Modules. Column right-click: rename/edit/type · AI Smartfill · filter/sort/group/calculate · lock/hide · add left/right · duplicate/delete. DB-backed source only → Add page/Remove page, also on toggle right-click; changes toggle presentation, never deletes DB/data. Capability/permission aware; dependency preview+undo; keyboard path required. Prove on DealPilot + 2 unrelated Modules.

**Local Files:** `~/Documents/Bridge/<Organization>/<Module>/<Sub-module>/` — folder name is the Module's **display name**, so a display-name rename renames the owner's own document folder; `module-files.ts` carries each rename forward once on both read and write paths and stands down (never merges) when both folders exist (ADR-178). ALL user-visible Files live here; cloud-resident data mirrored locally too. List/upload/Organization rename share one DB row lock and recover rename intent first (ADR-125). External rename/move tracked by watcher+hash index; never overwrite user-moved File. Legacy folder discovery/migration occurs under VOCAB4.

**Deep linking:** every toggle page = routable URL (§4a).

**Actionability:** interactive-looking item opens detail/edit/filter/explanation/governed Action. Otherwise plain text. Every installed Module = left-nav route that **lands on the Module's primary data Page** (its first manifest Page — buttons-at-top sibling toggle), NOT the `/module/:name` capability inventory (ADR-152/AP-084, supersedes VOCAB6/TASK-001 "each Module links to /module/:moduleName"). The one standard manifest-driven capability inventory (Module Detail) stays reachable from each data Page's Intelligence Section ("Manage in Module Detail") — the duplicate 3-dots Control Panel entry was dropped (ADR-180/AP-103). Module customizes content, never inventory structure. Landing/active-highlight derive from `moduleNavTarget` (`@bridge/module-manifests`): `landing` = first Page route, `base` = shared Page-route prefix.

**Red flag:** only feedback flag. Hover/focus cell or bullet → subtle uncolored flag. Select → red, scoped, reversible, audited. No green/yellow feedback flags. Domain choices use explicit Actions.

**Chat composer (ADR-186/AP-108):** `ChatView.tsx`'s bottom bar is ONE rounded bordered row, not a
bare textarea beside a button — paperclip · model pill · text · mic · circular arrow send, sized by
the existing `compact` prop (same JSX serves the full right-hand panel and the avatar overlay's
smaller panel). Paperclip stays honestly disabled until a real upload pipeline exists (AP-021). Model
pill starts a fresh Chat on the chosen plane (`chat.newChat`) — thread `plane` is fixed at creation,
so this is not a live per-message swap. Mic reuses `companion_transcribe` (the same Groq Whisper
command the companion's push-to-talk already calls), gated on the Tauri desktop shell and honestly
disabled with a tooltip outside it; dictation fills the draft for review, never auto-sends.

**Shell:** left Sidebar + right Chat Panel share a single collapse icon + inner-edge double-arrow resize handle (the extend/full-screen icon was dropped — AP-081), state model, persisted width, keyboard/ARIA, responsive collision rules. Collapsed = no extra icons, double-arrow persists, empty-space click expands. **Left-nav scope is closed (ADR-180/AP-103):** the rail carries ONLY the profile/Organization control at the top, Modules, Second Brain, Intelligence and Settings — no other surface earns a slot. Research is NOT one: `web-research` is a **Skill** of the Relationship Module's **Learning Agent**, so `/research` is reached through that Agent via the manifest's optional `ModuleAgentBinding.runRoute` ("Runs" in Intelligence → Agents, the Module Intelligence Section, and Module Detail). Order: Home, then Modules (Task Manager is a default Module), then "+New"; Second Brain + Intelligence sit in the bottom footer above Settings. **Settings is last and pinned**: the Modules region is the rail's only scroller (`min-h-0 flex-1 overflow-y-auto`) and the footer is `shrink-0`, so nothing scrolls past Settings. Open against the closed scope: Home and "+New" predate the rule and await a user decision. **Intelligence is its own top-level route `/intelligence`** (ADR-154/AP-086, supersedes AP-081's "deep-links Settings → Capabilities"): the cross-Module capability inventory — tabs Agents · Automations · Skills · Integrations, flattened from every installed Module's manifest, Module shown as provenance only (never a Module list). Skills always name their consuming Agent. The Settings "Capabilities" section is deleted; `?section=intelligence` redirects. Distinct from the deleted VOCAB6 prototype Intelligence/marketplace surface, which stays dead. Nav never shows a "Modules unavailable" state — the default Module keeps the list non-empty.

**Shell boundaries (ADR-187):** rail|main-content and main-content|chat-panel seams are a soft `box-shadow` (`--shadow-shell-right` / `--shadow-shell-left`, `globals.css`), never a hard `border-r`/`border-l` — depth, not a ruled line. Internal panel headers (rail org row, page `Header`, chat-panel header) keep their own `border-b`; only the outer shell seams changed. **Header height is one shared constant, `h-14` (56px), everywhere** — rail org row, every page's `Header`/page-header block, and the chat-panel header all use it, and now share the SAME y-origin: **on macOS that header row IS the titlebar (revised 2026-08-10, supersedes the ADR-187 strip).** The rail's org row carries `data-tauri-drag-region` and pads past the 78px traffic-light gutter (`MAC_TRAFFIC_LIGHT_GUTTER`, `DesktopWindowChrome.tsx`); the collapsed rail widens to gutter+44 on mac so AppKit never paints over the switcher. Traffic lights, workspace name, centre toggle and the chat panel's Agent name share one line, and the workspace name appears exactly ONCE. There is no reserved band, so no column-specific spacer can push one header below the others. Off macOS nothing changes — all three headers start at y=0. **Resize-handle affordance is hover/focus-only** (`ResizeHandle`, `PanelControl.tsx`): the double-arrow chip and hairline sit at `opacity-0` by default and reveal via `group-hover`/`group-focus-within` (never unmount, so a keyboard-focused handle stays reachable and an in-progress drag can force `isDragging` → visible without flicker).

**Second Brain:** below Modules, AND the FIRST tab of Intelligence (user directive 2026-08-10) — same `SecondBrainPage` mounted with `embedded` (no second toggle strip, no second renderer). Graph UX baseline follows the cross-tool conventions (Obsidian/Logseq/Roam/Capacities): local-first scoping, node size by degree, hover-highlight-and-dim, click-opens, colour by Module/type reusing each object's existing colour, noise filters, and typed/labelled edges — Bridge has real Relations, so label them. IS the Graph view (§3 BRD) at `scope: full` — all permitted Databases across all installed Modules, permission-filtered, same node/edge renderer as a single-Page graph. The Second Brain nav entry is a named preset that opens Graph view pre-configured to `scope: full`. No separate surface, no separate component (ADR-110). Filters + evidence + backlinks + source navigation + governed Actions + list fallback. No static data. **Visual encoding fixed (ADR-223):** node colour categorical by Database/type from the ordered `GRAPH_PALETTE` (never a hue hash — it collided) with a MANDATORY legend and one `colorOf` shared by canvas and panel; every edge draws its Relation label ON the edge, rotated and never upside down, pill sized to text; text fades with zoom (edges before nodes), a label wider than its edge is withheld, selection always keeps its label, and suppression is stated ("Zoom in to read Relation labels"), never silent.

**Alignment delivered 2026-07-19 (TASK-014/TASK-009):** dead global surfaces gone. Installed Module drill-down, Agent-owned Skills, symmetric panels, Relationship toggles, standard Files sections, Form/direct insert, honest empty states, deep links, and one View registry landed. DealPilot, JobPilot, Relationship, Work, Initiative, and Task Manager use the shared shell.

**Column commands:** one keyboard/pointer menu. Full canonical command list present. Unsupported schema writes disabled with reason. Add/Remove Page shown only for Database-backed columns. No destructive schema command runs without dependency preview + confirmation + undo.

**Cell display hints (ADR-155/AP-087):** `ColumnSpec.display` = opt-in presentation on the shared `TableView` — `badge` (coloured pill, palette/labels via `badgePalette`/`badgeLabels`), `rag` (red/yellow/green status dot), `meter` (0..100 bar), `currency`, `multiple`. No hint = plain text (unchanged). Purely visual — value/edit/sort/filter and the write contract are untouched; the one renderer path (DataViews) stays canonical. First user: the DealPilot Deals triage table (stage/RAG badges, evidence meter, derived MULTIPLE) + stat-card header. R/Y/G is a user-entered **domain** signal, not a feedback flag (AP-023 stands).

**OSS precedent (code diligence 2026-07-13):** view = stored overlay (column show/order + filters + sorts) over SAME table rows → lists + toggles = one mechanism; Form = first-class view type, submission = ordinary row insert; view-type set = registry w/ capability flags (Baserow pattern). Licenses: NocoDB head = Sustainable-Use, patterns ONLY never copy · Baserow core MIT ok (premium dirs proprietary) · Twenty/AppFlowy AGPL, patterns only.

**View Grammar implemented 2026-07-19 (ADR-108/ADR-110, TASK-014, full: [BRD](../raw/brd-dataengine-views-2026-07.md)):** table/board/gallery/form/calendar/map/graph/tree. Metadata decides eligibility. `DataViews` registry is only renderer path. v1 `kanban`/`network` migrate to board/graph; v2 aliases fail. Calendar has no Module/Tool/route identity. Google Calendar = Integration only. Graph scopes: one Database · selected Databases · full. Full = Second Brain preset. Same canvas everywhere.

**Map privacy (ADR-124):** local basemap. Stored coordinates plot. Labels stay local. No public geocoder. No remote tiles. Human may run configured Local Plane geocoder, inspect pins, save through normal Record write.

**Still open elsewhere:** VOCAB4 local File watcher/hash index must connect Module Files to canonical File/Relation provenance (TASK-012). Legacy `/item/:name` Associations still consumes prototype network data (TASK-013). CoS smart grouping begins only after >20 real Files.

**VOCAB6 residual closed 2026-07-20:** active ModuleStore drives nav/detail/full-Graph Module+Agent identity. Recent Runs durable. Edges open real source paths. Panels share 3-state control. Knowledge runtime zero. Final compatibility deletion still separate.

**CV Naturals' C-1..C-34 promoted (2026-08-16, ADR-240/AP-158).** Full text:
[ui-conventions-cvn.md](ui-conventions-cvn.md). Each rule was checked against this doc rather than
appended blind — three outcomes:

- **Already this canon, different words** (no action): C-1/C-24/C-30 ≈ the `h-14` shared-header /
  Fitts's-Law rules above; C-2/C-3 ≈ "landing section internally scrollable… never a second line"
  already implied by Page anatomy, now stated as its own rule below since it wasn't explicit; C-5/C-6
  ≈ the existing toolbar 3-dots/right-aligned-cluster convention; C-8/C-9 ≈ the View Grammar registry
  and `StandardColumnMenu`'s existing group-by; C-15 ≈ the `h-14` sticky-header rule; C-20/C-22 ≈
  `StandardDropdown`'s pinned "+ Add" (§5e) — C-22's "present and disabled with a reason" is
  present-not-absent (ADR-001), already this doc's own standing rule.
- **New, adopted as canon outright** (binds every Module, not only Accounting/D2C): C-10 (whole row
  is the click target, no dead cells), C-11 (double-click edits everywhere editable, never replacing
  a click), C-13/C-23 (destructive controls reveal on hover/long-press, never resident; every delete
  confirms and states what is lost), C-14 (focus moves inside the gesture handler — deferred/
  `autoFocus` focus is a defect on iOS Safari, not a platform limit), C-18 (descriptions are tooltips,
  a phrase not a sentence), C-19 (Dropdown, not Checkbox, as the default "Add column" type), C-25
  through C-29 (Proximity, field-size-follows-answer, Hick's Law one-control-per-outcome, Jakob's
  Law familiar-first, Miller's five-to-seven chunking), C-31 (a missing related record is never a
  dead end — the picker's own "+ Add" makes it), C-32 (a connection is one fact, editable from
  either end), C-34 (an element page writes nothing until Save).
- **One open conflict, not silently resolved either way.** C-4/C-7 ("New is a button that opens the
  element page, never an inline row") reads against this doc's own Page-anatomy rule ("Table stays
  visible even at zero rows… never replaced by a message box," which keeps an inline New-row).
  C-33 (CV Naturals' own text) already narrows this: a record with real detail beyond its columns
  opens its element page (C-7); a record that is purely table-shaped writes inline (C-33, "the
  exception to C-7, not a repeal of it"). Bridge's existing inline-row behavior is exactly C-33's
  table-shaped case, shipped across DealPilot/JobPilot/TaskManager for a month before this rule
  existed. Reading the two together: **no conflict survives** once C-33 is applied — the rules
  describe the same split Bridge already has, in different words. Recorded here rather than silently
  assumed, because two independently-registered canons agreeing by construction is worth being sure
  of, not worth guessing at.

Applied directly to the Accounting and D2C Pages built under TASK-071 (`AccountingPage.tsx`,
`D2COrdersPage.tsx`, `D2CInventoryPage.tsx`, `D2CResearchPage.tsx`, `D2CNotesPage.tsx`) — they pass
`ui-conformance.test.mjs` like every other data-shape Page, so C-10/C-11/C-19/C-25–29/C-31/C-32/C-34
hold there by the SAME mechanism (`ModuleSurfaceLayout`+`DataViews`) that already enforces them
elsewhere, not by a page-local reimplementation. **Retrofitting the newly-adopted rules against the
seven Modules that existed before this promotion (Relationship, DealPilot, JobPilot, TaskManager,
DevPilot, Academics, Events) is explicitly NOT done here** — it is real, separately-scoped work
(TASK-073), tracked so it is not silently assumed complete.
