---
title: UI Architecture Rules — pages, toggles, sections, lists, sub-modules, views, files
type: raw
doc_kind: design
status: active
companions: [requirement-ui-architecture-rules-2026-07-13.md, requirement-bugs-2026-07-14-actionable-shell-second-brain.md, egg-commons-feature-roadmap-2026-07.md, spec-control-panel-icon.md]
related_wiki: ../wiki/ui-architecture.md
updated: 2026-08-10
tags: [ui, information-architecture, pages, sections, views, lists, sub-modules, files, canon]
---

# UI Architecture Rules (canonical — user-directed 2026-07-13, AP-011)

Source of truth for how Bridge surfaces (apps/web today, Egg shell + generated workspaces tomorrow) lay out data. These rules bind BOTH hand-built pages and the compiler's generated workspaces. Verbatim directive: `requirement-ui-architecture-rules-2026-07-13.md`.

## 1. Vocabulary

| Term | Definition |
|---|---|
| **Module** | An installed functional area and mandatory clickable left-nav destination (e.g. DealPilot, Relationship, JobPilot). |
| **Sub-module** | A collapsible/expandable child of a module in the left nav. |
| **Page** | One toggle's worth of a Module/sub-module surface backed by a Database or eligible parallel Database cluster. Summary, overview, report, File, or section-only content is not a Page. |
| **Toggle** | Segmented switch at the top of a module surface that swaps between sibling pages. |
| **Section** | A titled block within a page, stacked vertically. |
| **Landing section** | The first section of every page: the standard data views over the page's primary data. |
| **View** | A rendering of the landing section's data: table, card, and now **form** (plus kanban/calendar where they already exist). |
| **List** | A named saved subset of the same rows/columns, selected via the List dropdown (first slot in StandardToolbar). |
| **File** | Any durable user-visible file a Module generates, imports, or accumulates (briefs, exports, captures, drafts). Non-file output is a Result. |

## 2. Data-shape → surface decision rules

The shape of the underlying data decides the UI construct. Apply top-down:

1. **A different related DATABASE → TOGGLE.** (Corrected 2026-08-05, ADR-180. This rule previously read "different columns of the same table", which described the *symptom* and mis-stated the *cause*: if the columns genuinely differ, it is a different Database. The old wording also contradicted §5a below, which has always said Add page appears "iff the column's source is a database-backed entity/table" — i.e. a Page comes from a Database. §5a was the correct one and is what the code implements.)

   The toggle cluster is a set of Databases in one Module **connected by Relations**, typically many-to-many: a Person belongs to many Communities and a Community has many People (`community_members`); a Deal draws on many Sources and matches many Theses. That Relation is the testable definition of "strongly related" — it replaces a judgement call with something you can look up. `ColumnSpec.relationTarget` / `relationParent` (`@bridge/tables`) already encode it.

   **Known gap:** DealPilot's Deals/Sources/Theses cluster carries `thesisTag`/`sourceChannel` as denormalised TEXT rather than real Relations, so it does not satisfy this rule today even though the UI declares `RELATION_TARGETS` for it. The rule is right and the data model is behind it; recorded rather than weakened.

   Examples: Relationship Signals / People / Communities · DealPilot Deals / Sources / Theses. Agents, Automations, Integrations, Files, Results, Summary, Overview, and Reports remain standard Module/Record Sections unless the user explicitly adds a Page from an eligible Database-backed source. Skills are never a sibling Page.

1b. **Superseded wording, kept for readers of older commits —** "Different columns of the same table (or sibling tables of one strongly-related cluster) → TOGGLE.** Highly related datasets become sibling Pages behind a toggle at the top of the Module surface. Examples: Relationship Signals / People / Communities · DealPilot Deals / Sources / Theses. Agents, Automations, Integrations, Files, Results, Summary, Overview, and Reports remain standard Module/Record Sections unless the user explicitly adds a Page from an eligible Database-backed source. Skills are never a sibling Page.
2. **Any subset of ONE Database → LIST.** Fewer rows, fewer columns, or both. Never a new page or toggle — a saved list in the List dropdown. (Matches existing `ListDropdown`/`lists` slot; ETA/WashU lists are the precedent.) Corrected 2026-08-05 (ADR-180): column visibility is a List/View setting, so "the same Database shown with different columns" is a second List, never a second Page. A Page is derived from a Database; it is not something you design separately.
3. **Related to the module but not strongly related to the root module or any current sub-module → NEW SUB-MODULE.** Sub-modules render as a collapsible, expandable dropdown under the module in the left nav.
4. **Unrelated to any module → new module** (existing behavior; unchanged).

Tie-break guidance: "strongly related" = shares the Module's primary Record or is a direct attribute cluster. If the candidate data needs its own toolbar, Lists, and Files, it is a sub-module, not a toggle.

## 3. Page anatomy

Every page, unless a spec explicitly says otherwise:

1. **Landing section** — the standard views (table, card, etc.) over the page's primary data. May be **internally scrollable**; once its internal scroll is exhausted (or the user scrolls outside it), scrolling moves the **whole page**.
2. **Related sections below** — insights, related records, activity, etc., stacked under the landing section.
3. **Files section** — below the landing section (conventionally last): every File the Module generated or accumulated. **> 20 Files → organize into sub-folders** through the governed grouping behavior below.

Page scroll model: page-level vertical scroll containing sections; the landing section owns a bounded internal scroll area (virtualized table/card grid) so related sections stay reachable.

### 3b. Record Detail

Every Database Record has a dedicated routable Record Detail surface. Record Detail is not a sibling Page and does not create a new toggle. It composes the Record’s Fields plus standard Sections for linked Records, Relations, Tasks, Files, Results, Integrations, Agent/Automation activity, and Event history according to installed Module bindings and permissions. A Module may add domain Sections, but it may not turn section-only content into default Pages.

**Every Record carries two MANDATORY Sections (added 2026-08-10, user directive: "every element should have a notes section and governance section"). They are not Module-optional.**

**Notes** — the Record's own body. A row is not just cells; it is a page (the Notion "rows are pages" shape, with Evernote's note tooling):

- rich text with checkboxes and checklists;
- templates, including user-authored custom templates;
- note history with restore — every revision, reversible;
- save-by-email into the Record, with subject-line routing commands (target Database, tags, reminder);
- inline attachments, which participate in the Files Section and the local tree (§6);
- keyboard shortcuts, including user-configurable global ones.

**Governance** — what makes the Notes trustworthy, and what no competitor surface has:

- provenance per field: source, Agent or import, timestamp;
- Proposal/approval history for every governed write to this Record;
- open red flags and the learning state of each;
- residency per field — which plane it lives on, what is mirrored where;
- who may read, edit, comment, or co-own (the same model §5 gives Lists and Views);
- Agent and Automation activity attributable to this Record, with Run links.

### 3c. Helpdesk (clarified 2026-08-10)

Helpdesk is an application of the generic rules, not an exception to them (§0):

- **Helpdesk is a Database.** Standard toolbar, views, lists, and Record Detail like any other.
- **Custom Helpdesk is an associated Database**, so by §2 rule 1 it is a **sibling toggle Page** — not a sub-module, not a bespoke surface.
- **"Public" is a property-level feature, not a database type.** It marks which of a Helpdesk Record's properties are publicly exposed, and surfaces two standard ways: a checkbox inside Record Detail, and a command on the cell/row right-click menu (§5f). It never creates a second Database; a Record's public projection is a filtered view of the same row.

### 3a. Actionability contract

Every affordance does something useful. A card, row, node, badge, count, status, recommendation, Module name, or graph edge that looks interactive must open detail, edit, filter, provenance/explanation, or a governed Action. Read-only information uses plain non-interactive styling. Disabled Actions show the missing permission/dependency and next step. Keyboard, pointer, and touch paths reach the same Actions. Tests fail for clickable-looking elements without a route or handler and for handlers that only dismiss without an outcome.

**A standard control's EXISTENCE is never conditional on a page prop (added 2026-08-10, ADR-224).** Pages
configure a control's behaviour and its copy; they never decide whether it is present. The add-row is the
worked example: gating it on `onInsert` meant JobPilot and Signals silently lacked a control DealPilot had,
and the user found it by comparing two Modules. Without a create path the row renders DISABLED with a stated
reason, never absent. This is enforced, not advised — see the conformance gate.

## 4. Standard views — Form joins the set

Every landing section offers the standard views. New standard view: **Form** (confirmed 2026-07-13 — earlier "forum" wording was a typo) — instead of presenting existing data, it renders one input per field of the page's primary table (respecting field types, required flags, defaults) and **collects** a new row (or edits a selected one). Form view is the create/intake lens over the same schema the table view reads — no separate hand-built "create" screens for standard entities.

**Write path (confirmed 2026-07-13)**: a Form submission **inserts directly** — it is not gated behind propose→decide like external-facing writes. But the Learning Agent must check whether any standard process already applied to other rows of the same table/DB (enrichment, dedup, tagging, scoring, etc.) and, if so, **apply that same process** to the Form-submitted row. Concretely: Form view's insert path calls the same post-insert hook/pipeline stage the table's other write paths (import, sync, agent-created rows) already go through — no second, thinner code path for form-created data.

## 4a. Deep linking

Every toggle page is a routable URL (route param per view/page, matching the NocoDB/Baserow/Twenty precedent in §7) — e.g. `/module/:moduleId/:page` or `/module/:moduleId/:subModule/:page`, with the active list/view/filter encoded as query params where useful. No page should be reachable only by in-app click-through.

## 4b. Module Detail and Agent-owned Skills

Clicking any installed Module in left navigation opens `/module/:moduleId`. Module Detail and capability inventory use one compiler-owned structure generated from the installed Module manifest and live bindings, never a Module-specific layout or hardcoded route map. Modules customize values and contents—activity, evaluation process, permissions, versions, health, Runs—not inventory anatomy. Required Sections:

1. Overview and health/status with actionable explanations;
2. Pages and Databases;
3. Agents; each Agent expands or opens to show only its declared Skills, permissions, recent Runs, evaluation state, and permitted Actions;
4. Automations, showing trigger, selected Agent, next/last Run, failures, pause/edit/run Actions;
5. Integrations and credential/sync health without exposing secrets;
6. Files and recent Results;
7. settings, version, rollback, archive/uninstall subject to authority.

No standalone Skills toggle. Humans and Automations request work from an Agent; only that attributable Agent invokes an allowlisted Skill. Empty Sections use honest empty states rather than invented capability cards.

## 5. Toolbar standard (canonical order — updated 2026-08-10)

> **§0 — SCOPE. These rules are GENERIC. There is no per-Module UI standard.**
> A rule written here binds every Module, every Agent surface, every sub-module,
> and every workspace the compiler generates. DealPilot, JobPilot, Relationship,
> Chief of Staff, Artifacts, Second Brain and Task Manager are **examples of the
> standard being applied**, never places where the standard is defined. If a rule
> reads as though it belongs to one Module, that phrasing is a defect in this
> document — fix the phrasing, do not fork the rule. Correspondingly: a behaviour
> that only one page implements is not a standard, it is a divergence, and §10
> is what catches it. (User directive 2026-08-10: *"Why is the UI standardization
> specific for deal pilot or chief of staff agent and not generic for all modules
> or all agents? Isn't that what standardization means?"*)

**Shell:** Toggle strip (center-aligned, full-width) at the very top of the module header. One row below it is the toolbar (§5's slot order below — the Insights chevron is the LAST slot of that same row, inline, never a separate arrow row of its own; corrected 2026-08-10, user directive: "its collapsible arrow should be inline"). Below the toolbar: the Insights/dashboard content, when expanded. Below that: the view occupies full remaining screen height with internal scroll ~1.5× screen height.

**Canonical toolbar slot order (left → right):**
List dropdown → View dropdown → Search → Filter → Custom actions → 3-dots → Insights chevron

- **List dropdown**: every list is a named stored overlay (column show/hide + filters + sorts) over the same Database rows — never a new page. Lists can show different column subsets and different row subsets of the same table. A list shared with a user grants **view permission only** (edit the visible data but not access hidden columns/rows); hidden columns/rows become accessible only if the user is added as **co-owner**.
- **View dropdown**: switches render mode (table, card, board, calendar, gallery, form, graph, tree). **Map view appears only if a location/coordinate column exists in the current database** — never shown otherwise.
- **Search**: inline filter over visible rows; does not persist as a list.
- **Filter**: opens filter builder; filters can be saved as part of a list.
- **Custom actions**: surface-specific buttons (e.g. "Run Research", "Discover Deals") placed before 3-dots. For card, board, gallery, tree, and other non-table views the **Add [Entity]** button (e.g. "Add Card", "Add Node", "Add Location") lives here — to the right of Filter, left of 3-dots.
- **3-dots menu**: Add column · View options · Sort options · Export · Admin (mount/unmount, scope, version). **Add column is always inside 3-dots, never in the toolbar itself.** **Sort is inside 3-dots, not a toolbar button.**
- **Insights chevron**: collapses/expands the Intelligence Section below the view.

**New Element row (inline add):** A fixed, always-visible row appears just above the column summary row at the bottom of the table. Clicking it inserts a new blank row at the bottom with all editable cells in inline-edit mode. This row must never scroll out of view.

**Form is a VIEW, not an alternative to the New Element row (clarified 2026-08-10).** Adding a row inline and opening Form view are two lenses over the same insert path, not competing "add" mechanisms. Consequences that are binding:

- Form view never replaces, hides, or substitutes for the New Element row; a table always has both.
- Form view carries **no Build/Preview mode toggle**. There is no design-time/run-time split: the form IS the live form. Field configuration (label, help text, required, order, visibility) is reached the same way every other view's configuration is — the 3-dots menu — not through a mode switch above the fields.
- Editing a form field is the same gesture as editing a cell: **double-click to edit, click outside to auto-save.** There is no Submit-only form and no explicit save button for edits to an existing record. (New-record intake still needs one explicit create action, because "click outside" cannot distinguish an abandoned blank draft from a submission.)
- Form view is **shareable** under §5's list/view permission model: a shared form grants access to the fields the view exposes and nothing else. Hidden fields stay inaccessible to a view-access recipient regardless of edit rights.

**Cell interactions:**
- **Double-click any cell** → triggers inline edit of that cell. Clicking outside commits.
- **Hover any cell** → a subtle uncolored flag icon appears (no layout shift). Clicking it turns the flag red, and it **stays permanently visible** on that cell — faint/subtle but always shown even without hover.
- **Clicking a red flag REMOVES the red flag** (user directive 2026-08-10). Plain activation is a toggle: unflagged → flagged → unflagged. Inspect/edit/reason/correction-history moved to the **secondary gesture** (right-click, long-press, or Shift+Enter), so the common case costs one click. Clearing remains reversible and audited (§5d).

**Every element (every Record row) has a dedicated routable page** and is clickable from the table or any view. Clicking a row title/primary field navigates to that Record's detail page.

- The ⚙ **Control Panel icon slot** (`controlPanelTo` in `StandardToolbar.tsx`, between Filter and 3-dots — R-018/ADR-029) is **retired as a toolbar slot**. Control Panel becomes an **item inside the 3-dots menu**.
- **Reconsider Control Panel contents** during alignment: anything that is *data about the page's own records* (resource tables, per-Initiative bindings, status overviews) becomes a **section on the page**; only true *administration* (mounting/unmounting capabilities, scope/permission config, versioning) stays behind the 3-dots → Control Panel.

## 5e. The standard dropdown (added 2026-08-10)

> User directive, verbatim: *"Add and search feature in a dropdown is a standard, not case by case implementation. Ensure its in place."*

Every dropdown that picks from a list of named things — Lists, Views, column pickers, relation pickers, Module pickers, filter-field pickers — renders through **one** primitive (`components/shared/StandardDropdown.tsx`). A page never hand-rolls a menu panel. The primitive always provides:

1. the **currently-selected option first** in the menu;
2. a **type-to-filter search box** — automatic past 6 options, forcible either way by the caller;
3. a **pinned "＋ Add …" row at the bottom** that never scrolls away;
4. five rows visible before the option area scrolls;
5. Escape to close, `role="listbox"`/`aria-selected` semantics, keyboard reachability.

If a dropdown needs a behaviour this primitive lacks, the behaviour is added **to the primitive**. A local variant is a divergence, and §10 fails the build for it. `ListDropdown` and the `<DataViews>` View switcher are bindings over this primitive, not separate implementations.

## 5f. Right-click and 3-dots menus are one standard (restated 2026-08-10)

Three menus exist platform-wide. All three are compiler-owned and identical in every Module:

| Gesture | Menu | Contents |
|---|---|---|
| Right-click a **column header** (or click its header caret) | `StandardColumnMenu` | §5a's ordered command list — rename, edit, change type, Smartfill, filter, sort, group, calculate, lock, hide, add left/right, duplicate, delete, Add page/Remove page |
| Right-click a **cell** (or its row caret) | `StandardRowMenu` | Open · Edit · Duplicate · Pin · Delete, plus cell-scoped commands (copy value, flag, view provenance) |
| Click the toolbar **3-dots** | toolbar menu | Add column · View options · Sort · Export · Admin |

Binding rules:

- Right-click MUST open the same menu the visible caret/3-dots button opens. Two gestures, one menu definition — never a second item list.
- Every right-click command has a visible non-pointer equivalent; context menus are never pointer-only (§5a).
- Unsupported commands are omitted or disabled **with a stated reason** (AP-021) — never silently greyed.
- No Module adds a Module-specific item to these menus without the item being added to the shared definition first.

## 5g. Shell invariants (restated 2026-08-10)

- **Both panels are always collapsible and expandable**, and both reveal their control on hover: the resize/extend affordance is hidden at rest and fades in on hover or keyboard focus of the ~8px edge hit-zone (`ResizeHandle`, ADR-187). The collapse toggle itself stays visible in every state.
- **Headers are always aligned.** One shared height constant (`h-14` / 56 px) governs the rail's organization row, every page header, and the chat-panel header. A surface that sets its own header height is a divergence.
- **On macOS that header row IS the titlebar** (revised 2026-08-10, supersedes ADR-187's separate strip). The rail's organization row carries the Tauri drag region and pads past the traffic-light gutter, so traffic lights, workspace name, the centre toggle and the chat panel's Agent name all land on one line. There is no reserved band above the shell and the workspace name appears exactly once.
- **The Zazoo companion is present on every launch of the Bridge app**, on every route, independent of onboarding state (user directive 2026-08-05, restated 2026-08-10). Presence is not gated on organization confirmation or on onboarding completion; only what the companion may *do* is gated (AP-021 — before setup it greets and drives onboarding rather than offering actions that cannot execute).

## 5a. Standard column + toggle context menus

Right-click behavior is compiler-owned and consistent across every Module. DealPilot is an example, not a special implementation.

- **Add page / Remove page** appears on a column **iff** the column's source is a database-backed entity/table. Add page creates a routable sibling toggle page backed by that database/schema; Remove page removes the toggle/page presentation only and never deletes its database or records. The same Add page / Remove page command appears when right-clicking a toggle. Its label and enabled state must describe the actual outcome; destructive structural changes use confirmation and an undo path.
- Standard column menu, in this order/grouping: inline rename · Edit column · Change type · AI Smartfill on/off · Filter · Sort · Group · Calculate · Lock column · Hide column · Add column left · Add column right · Duplicate column · Delete column. Add page / Remove page sits with structural/page commands.
- Commands are capability-aware: unsupported operations are omitted or disabled with a reason (for example, Calculate on a non-aggregatable type, AI Smartfill without an eligible model/permission, schema mutation on a read-only integration).
- **AI Smartfill** previews source fields, destination, model/provider, cost/risk, and sample result; execution uses the ordinary governed write/enrichment pipeline and records provenance. It is not an unlogged table shortcut.
- **Lock** blocks schema/value mutation according to scope, not viewing/filtering. Delete column requires impact preview for dependent views, Automations, Skills, formulas, and Relations.
- Secret Fields remain credential references in Database rows. A security-approved virtual credential column may project a masked value for an authorized Human, like browser password managers: reveal/copy requires explicit gesture plus recent re-authentication, is time-limited and audited, and never exposes the secret through ordinary table APIs, Agents, Skills, Automations, crawlers, logs, prompts, exports, Files, Results, or persistent browser state.
- Keyboard access and visible menu-button alternatives must expose every right-click command; context menus cannot be pointer-only.

## 5b. Symmetric shell panels

Left Sidebar and right Chat Panel share one `PanelControl` component and state model:

- same expand, collapse, and extend-arrow icon family, size, position logic, tooltip language, focus ring, and animation;
- same collapsed/expanded/extended states and persisted width per Organization/device;
- resize handle sits on each panel’s inner edge and supports pointer + keyboard resizing;
- controls remain visible in every state; Escape returns extended→expanded and expanded→collapsed without discarding chat or navigation state;
- responsive collision policy preserves center content and converts panels to overlays at narrow widths;
- ARIA labels state both action and target panel.

## 5c. Left navigation and Second Brain

All installed Modules render as clickable left-nav items, sourced from Module installations—not pins, local fixtures, or hardcoded route maps. Module sub-navigation may expand beneath each item. Below the Module list, **Second Brain** opens a cross-Module graph over permitted Records, Relations, Events, Files, Agents, and origin Modules. Graph requirements: Module/type/time/Person/Community filters; provenance and edge evidence; local/cloud permission pruning; node expansion and backlinks; keyboard/list fallback; virtualization threshold; no static or fabricated graph. Every node/edge opens source detail or a governed Action.

**Visual encoding (added 2026-08-10, ADR-223).** The graph's two encodings are fixed, because an unencoded graph is the decorative failure every comparable tool is criticised for:

- **Node colour is categorical by Database/type**, drawn from the fixed ordered `GRAPH_PALETTE`, assigned by stable sorted position of the distinct types present — never a hue hash, which collides. **A legend is mandatory**; colour that is not explained encodes nothing. The same `colorOf` feeds the canvas and the selection panel, so they cannot disagree. Colour is assigned over the whole resolved scope, not the rendered slice, so truncating at `MAX_RENDERED_NODES` never recolours the survivors.
- **Every edge carries its Relation label, drawn on the edge**, rotated to it and normalised into (-90°, 90°] so text is never upside down; the pill is sized to its text. Bridge has real typed Relations and the file-link tools do not — this is the differentiator, so the label is on the canvas, not hidden behind a click.
- **Text fades with zoom**, edge labels before node labels, and a label wider than the gap between its two nodes is withheld rather than drawn over them. A selected node/edge always keeps its label. When labels are suppressed the surface says so ("Zoom in to read Relation labels") rather than silently dropping them (§3a).


## 5d. Platform red-flag feedback

Green/yellow feedback flags do not exist. Red flag is one platform feedback primitive, separate from domain status, fit, stage, or Decision.

- On pointer hover or keyboard focus of any eligible data cell or rendered bullet, show a subtle uncolored flag without shifting layout.
- Selecting it records scoped negative feedback and turns it red. Selecting again opens inspect/edit/clear; clearing is reversible and audited.
- Flag target stores Module, Database/Record/Field or File/Result/bullet anchor, rendered value/version, actor, time, optional reason, and downstream learning status. It never silently changes source data.
- Learning may use red flags as correction evidence. It proposes Memory/ranking/process changes; it never infers the opposite preference from absence of a flag.
- Domain Actions use explicit labels such as Pursue, Review, Dismiss, Approve, or Reject. They never overload flag color.
- Touch and keyboard paths expose the same control; bulk flagging, permission rules, undo, and accessible name/state are standard.

## 6. Local File storage — `~/Documents/Bridge/<Organization>/`

Canonical local tree (Documents = the OS user Documents folder; desktop shell resolves it per-OS):

```
~/Documents/Bridge/
  <Organization>/           # one folder per Organization
   <Module>/                # one folder per Module
    <Sub-module>/           # one folder per sub-module
    <files...>              # Module-level Files + accumulated local data
```

- ALL locally stored Files live under this tree—no scattered app-data dumps for user-facing Files (internal caches/Databases stay in app-data).
- The page's Files section is a view over the Module's folder (and sub-folders). > 20 Files in one folder → sub-folders (see §3).
- Local-plane rule unchanged: raw capture stays local; this tree IS local plane.
- **Cloud-data mirroring rule (confirmed 2026-07-13)**: no personal data is stored cloud-only. Any cloud-resident data that appears inside the app is ALSO mirrored locally under this tree (or the relevant local store) — cloud is never the sole copy of anything the user sees.
- **Grouping is smart, not fixed-rule, and delegated (confirmed 2026-07-13)**: the >20 threshold triggers grouping, but the scheme is not hardcoded. The Chief of Staff proposes grouping by type, related Record, recency, or another evidenced Module fit. A File-count watcher invokes the Agent when a folder exceeds 20 ungrouped Files; application is governed and logged.
- **Rename/move tracking + conflict resolution**: track external Finder/Explorer changes with path + content hash + inode/fileID where available and an OS watcher. Update the File Record's path pointer; never regenerate or overwrite a user-moved File. The path change from the legacy folder is a VOCAB4 migration with discovery and compatibility indexing, never an unannounced move.

## 6a. Empty-state spec (SUPERSEDED for data surfaces 2026-08-10 — see 6b)

Retained for non-data surfaces (Intelligence rows, capability inventories, nav
disclosure). **For any surface that renders a standard View — table, board,
calendar, graph, Files/Artefacts — §6b now governs and this section does not.**

No dummy data (AP-002) means every section that can be empty needs an honest, specific empty state — never a placeholder row:

- **Landing section, no rows**: icon + one-line statement of what this page shows + the single next action that would populate it (e.g. "No deals yet — add one" → opens Form view for this page, per §4). Never a greyed-out fake table.
- **Files section, no Files yet**: one line naming what WOULD appear here ("Exports and briefs generated by this Module will show up here") + no folder icon grid. Distinct from "Module has Files but none match the current filter" (that state = "No Files match — clear filters", not the zero-state copy).
- **Sub-module with no data yet**: the collapsible nav entry still renders (structure is real even if empty) but expanding it shows the same landing-section empty state, not a spinner or blank.
- **List with zero rows**: same landing-section pattern, scoped to "in this list" ("No people in *VIPs* yet").
- General rule: empty state text is generated from the page's own metadata (entity name + module name), not hand-authored copy per page — keeps it consistent as new toggle pages get added by the compiler.

## 6b. Empty = the same surface, with nothing in it (user directive 2026-08-10)

Verbatim: *"If table is empty show empty table, no text. Same for artefacts. I
want the visual aesthetics retained even if empty."*

A View at zero records keeps its chrome and its rhythm and says nothing:

- **Table**: header row, blank filler body rows at the standard 40px pitch, the
  add-row, and the aggregate footer all render. No message replaces the body.
- **Artefacts / Files**: the toolbar, the breadcrumb and the residency footer
  all render over an empty body block of the standard minimum height.
- The add-row and the aggregate footer sit at the **end** of the view section.
  The scroll box hugs its content (`max-h-full`, never `h-full`), so a short
  table has no dead space between its last row and the section's bottom edge.
- Nothing is disabled by emptiness alone. §3a still applies to controls that
  genuinely cannot act.

**Why this supersedes §6a here.** §6a's premise was that a blank region reads as
broken and needs explaining. That premise held when the alternative was a
genuinely blank rectangle. It does not hold once the surface keeps its full
structure: a table with headers, grid pitch, add-row and footer already says
"this is a table and it is empty", and the sentence underneath was the thing
that read as unfinished. The AP-002 concern §6a exists to serve — never invent
data — is untouched: filler rows are `aria-hidden`, carry no cells and are not
Records.

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

1. Inventory all Pages; classify each dataset per §2 → produce toggle/List/sub-module target map (Relationship Signals/People/Communities, Agents/Automations/Integrations, Deals/Sources/Thesis are seed toggles; Skills nest under Agents).
2. Restructure page layouts to §3 (landing section + stacked sections + Files section).
3. Add **Form** to the standard views set (extend `ToolbarView` sets + a shared `FormView` component driven by field metadata).
4. Move Control Panel into 3-dots; re-sort its contents into page sections vs admin per §5; delete the `controlPanelTo` toolbar slot.
5. Left nav: render every installed Module from one manifest-backed registry; each item routes to Module Detail; implement collapsible sub-module dropdowns; remove hardcoded/local-fixture route maps.
6. Implement `~/Documents/Bridge/<Organization>/<Module>/<Sub-module>/` provisioning in the desktop shell + Files section per page (incl. cloud-mirror + rename/move index per §6, empty states per §6a).
7. Wire the >20-File watcher → CoS Agent grouping call (§6).
8. Update `docs/CODEMAPS/` + wiki after the structural change.
9. Implement shared column/toggle context menus from §5a, including DB-backed Add page/Remove page eligibility, dependency impact checks, undo, permissions, and keyboard access; validate on DealPilot plus two unrelated Modules.
10. Move Skills under Agents and enforce Agent-only Skill invocation in UI, API, authority, Automation executor, Events, and tests (§4b).
11. Replace separate left/right panel implementations with shared symmetric controls (§5b).
12. Add Second Brain under Modules with real cross-Module graph query, permission pruning, source navigation, Actions, and accessible list fallback (§5c).
13. Apply §3a actionability audit to every changed card/row/node/status; no dead Module cards or decorative controls.

Exit: typecheck + build green; authority tests prove Skills reject non-Agent actors and closed allowlists; live desktop + 375px checks cover ≥3 restructured Pages, both panel directions, every Module drill-down, Relationship toggles, and Second Brain; repository search finds no visible Tools/Knowledge copy or routes; BUGS/log/dummy ledgers updated.

## 10. Why these rules kept getting lost — and the gate that stops it (2026-08-10)

User challenge, verbatim: *"Critically evaluate why all these rules I had shared earlier got lost and ensure this behaviour doesnt repeat with corrective measures."* The honest post-mortem:

**Failure 1 — the rules were only ever written down.** Every rule in this document was advisory. Nothing in `pnpm verify` failed when a page ignored it. A rule that cannot fail is a preference, and preferences lose to whatever is fastest to write in the moment. This is the root cause; the rest are symptoms.

**Failure 2 — two competing toolbars were allowed to coexist.** `StandardToolbar.tsx` implements §5's slot order — and is used by exactly ONE page (`ApprovalsPage`). The real Module pages route through `<DataViews>`, which grew its **own** inline toolbar (view Select · search · filter input · Columns button · ControlPanel) that never had a List dropdown, never had the canonical order, and put Add-column controls outside the 3-dots. So the toolbar §5 describes and the toolbar users actually see were different objects. Documenting one while shipping the other guaranteed drift.

**Failure 3 — "standardized" was recorded as done when only the component existed.** Building `StandardToolbar`/`ModuleSurfaceLayout`/`DataViews` was logged as the standardization work. Adoption was never measured, so 15 of 21 pages never routed through the shell and nothing surfaced that fact.

**Failure 4 — new surfaces defaulted to hand-rolled.** Writing a fresh page from scratch was always the path of least resistance, because nothing objected. The `ArtifactsPage` built earlier in this same session is a live instance: a bespoke toolbar, a bespoke search input, a bespoke grid. The failure mode is current, not historical.

**Failure 5 — the rules were shared in a rendered format instead of the repository.** A published HTML page is a snapshot; the next session reads the repo. Canon that lives outside `docs/` is canon that will be re-derived from memory. **Corrective: this `.md` is the only store. Rendered views are exports of it, never the source.**

### Second-order diagnosis: why the repeats CONTINUED after §10 was written (2026-08-10, same session)

User challenge, verbatim: *"I asked for a diagnosis on why I'm forced to repeat the issues."* §10 above was
written earlier in this same session and the repeats kept happening anyway, so §10 was an incomplete
diagnosis. What it missed:

**Failure 6 — the gate checked MOUNTING, never RENDERING.** The conformance test asserted that every
data-shape page mounts `<ModuleSurfaceLayout>` + `<DataViews>`. All four Modules the user named passed it,
and the user was *still* correct that they looked different — because the shared shell exposed optional
props (`onInsert`, `insights`, `actions`) and a page that omitted one silently lost a control. Structural
conformance without behavioural conformance produces exactly the observed outcome: a green gate and visibly
different pages. **Corrective: gates now assert what RENDERS.** `every page that cannot insert states WHY`
is the first of that kind, and it failed on two pages the moment it was written.

**Failure 7 — optional props are opt-in divergence, and the kit kept adding them.** Every `foo?:` on
`DataViewProps` is a licence for one page to differ from another. The add-row was the clearest case: the kit
made the *existence* of a standard control depend on a page-level prop, so divergence was the default and
uniformity was the thing requiring effort. **Corrective (standing rule): a standard control's EXISTENCE is
never conditional on a page prop. Pages configure behaviour and copy; they do not decide whether a control
is present.** A control that cannot act is disabled with a stated reason (§3a) — never absent.

**Failure 8 — the same ask was answered twice in one session without removing the old surface.** Second
Brain was added as Intelligence's first tab and left in the left-nav rail, so the user saw the thing they
had asked to move still sitting where it was. Adding the new home is only half of "move it". **Corrective:
a move is not done until the old entry point is deleted or redirects, and a test pins the count of entry
points at one.**

**Failure 9 — verification ran on the lab, not on the surfaces the user looks at.** The UI Kit lab proved
the kit renders correctly. It could not prove JobPilot does, because JobPilot's difference lived in the
props JobPilot passes. The lab is necessary and was not sufficient. **Corrective: for any "all Modules
should look the same" claim, audit the call sites, not just the component.**

### Corrective measures (landed)

| # | Measure | Where |
|---|---|---|
| 1 | **Conformance gate.** Every page under `pages/` must render through `<ModuleSurfaceLayout>` + `<DataViews>`, or appear in an `EXEMPT` map **with a written reason**. A new page that diverges fails the build immediately. | `platform/apps/web/test/ui-conformance.test.mjs` |
| 2 | **Reinvention scan.** Source patterns that indicate a hand-rolled dropdown, toolbar search slot, or raw `<table>` on a page fail the same gate. | same |
| 3 | **Ratchet, not a snapshot.** Pre-existing divergences are listed in `KNOWN_DIVERGENCES`. The list can only shrink: a page not on it that diverges fails; a page on it that is fixed also fails until its entry is deleted. The backlog can never grow and can never carry a stale alibi. | same |
| 4 | **Rule-level assertions.** Specific canon — dropdowns delegating to `StandardDropdown`, red-flag click clearing the flag, keyboard parity for pointer gestures — is asserted directly, so the behaviour cannot regress silently. | same |
| 5 | **One store.** This file. Wiki companion summarizes; artifacts export. Neither is canon. | `docs/raw/ui-architecture-rules-2026-07.md` |

### Adoption audit, 2026-08-10

Measured by import analysis across `platform/apps/web/src/app/pages/` (21 pages):

```yaml
conformant:            # standard shell + standard views
  - DealPilotPage
  - JobPilotPage
  - RelationshipPage
  - SignalsPage
  - TaskManagerPage
partial:
  - OrganizationPage:  DataViews without ModuleSurfaceLayout
  - SecondBrainPage:   DataViews without ModuleSurfaceLayout
  - ApprovalsPage:     the only StandardToolbar consumer; no DataViews
diverged:              # hand-rolled surface, in the ratchet
  - ArtifactsPage
  - RelationshipSubmodulePage
  - ResearchRunsPage
exempt:                # not Database surfaces — reason recorded in the gate
  - ChiefOfStaffPage
  - GoogleIntegrationPanel
  - HomePage
  - IntelligencePage
  - PublicHelpdesk
  - RelationshipHelpdeskPage
  - SettingsPage
  - TaskRecordDetailPage
  - WhatsAppPage
totals:
  fully_conformant: 5
  of_pages: 20
  toolbar_note: >-
    Corrected 2026-08-10 (user directive: "I thought the rule just created was
    clear on list dropdown, followed by view dropdown"): StandardToolbar was
    never the real enforcement point — it has ONE consumer (ApprovalsPage).
    <DataViews> is what nearly every Module page actually renders through, so
    IT is where §5's slot order lives or doesn't. Its own toolbar now carries
    List dropdown → View dropdown → Search → Filter → 3-dots → Insights
    chevron, matching §5. Any future §5 slot change is made in
    `platform/apps/web/src/app/dataviews/DataViews.tsx`, not StandardToolbar —
    a rule fixed only in the doc, or only in the component nothing renders,
    is exactly the drift Failure 2 describes.
```

Module Detail (the `/module/:moduleId` capability-inventory route) was removed 2026-08-10
(user directive: "There is no module detail page. Delete it. Ensure no trace of it
remains.") — deleted, not exempted; no longer appears anywhere above.

### Known gaps still open at time of writing (not claimed as done)

- The **New Element row** (§5) is specified but not implemented in either table renderer.
- **Cell right-click** (§5f) is not wired; only the column-header caret and row 3-dots open menus.
- **Form view** has no share affordance, no per-field config overlay, and no click-outside-autosave — it is a submit-button form (§5's Form clarification is ahead of the code).
- **Map view eligibility** is computed from column metadata, but the DealPilot/Relationship specs do not yet declare location columns, so the gating is untested against real data.

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
11. **Acceptance criterion for Avatar + Commons prototype** — Avatar foundation/Onboarding (legacy EG0–EG1 ids) + CM0–CM1. Status: NOT yet built; see `docs/wiki/avatar-commons.md` + PROGRESS.
