---
title: Cross-repository UI rule intake — Avilo, CV Naturals, Avatar, clicky-avatar
type: raw
doc_kind: intake
status: proposed
companions: [docs/wiki/ui-rulebook.md, docs/wiki/ui-architecture.md]
related_wiki: docs/wiki/ui-rulebook.md
updated: 2026-08-30
tags: [ui, rules, intake, avilo, cvn, avatar, cross-repo]
---

# Cross-repository UI rule intake (2026-08-30)

User directive: *"Can you look for all UI rules across the projects and see if we are missing any rules. List them"* across
`Repo/Avatar`, `Workspace/clicky-avatar`, `Workspace/avilo-dashboard-v9`, `Workspace/CV Naturals`, `Workspace/Relationship OS`.

**Nothing here is canon.** Each entry is a candidate awaiting rule-by-rule adoption. Adoption needs an APPROVALS row;
ADR-247's selection test applies — *does this rule change what an agent does on a Module it did not come from?* — not
*is this rule good*. ADR-247 rejected promoting everything precisely because always-loaded instruction budget is a
governed cost.

## Category 0 — Bridge's own raw doc, lost in wiki compression

`docs/raw/ui-architecture-rules-2026-07.md` is 486 lines; its wiki companion is 113. These bind today and were simply
not carried into the summary or the rulebook. They need no approval — they are already canon, only unindexed.

- §3b **Notes Section, mandatory on every Record** ("not Module-optional"): rich text with checkboxes/checklists;
  templates including user-authored; note history with restore, every revision reversible; save-by-email with
  subject-line routing commands; inline attachments participating in the Files Section and local tree; keyboard
  shortcuts including user-configurable global ones.
- §3b **Record Governance Section, mandatory on every Record** — DISTINCT from the Module Governance Section (ADR-248):
  provenance per field (source, Agent or import, timestamp); proposal/approval history per governed write; open red
  flags and each one's learning state; residency per field; who may read/edit/comment/co-own; Agent and Automation
  activity with Run links.
- §5 canonical toolbar slot order: List → View → Search → Filter → Custom actions → ⋮ → Insights chevron, the chevron
  inline as the last slot and never its own row.
- §5 List/View sharing: a shared list grants **view permission only**; hidden columns/rows require **co-owner**.
- §5 **Map view appears only if a location/coordinate column exists.**
- §5 Search is an inline filter over visible rows and does not persist as a list.
- §5 Custom actions slot: non-table views put their "Add [Entity]" button between Filter and ⋮.
- §5a **Secret Fields**: a masked credential column requires explicit gesture PLUS recent re-authentication, is
  time-limited and audited, and never exposes the secret through table APIs, Agents, Skills, Automations, crawlers,
  logs, prompts, exports, Files, Results, or persistent browser state.
- §5a **AI Smartfill previews** source fields, destination, model/provider, cost/risk and a sample result before running.
- §5a **Keyboard parity**: every right-click command must be reachable by keyboard; context menus are never pointer-only.
- §5a Lock blocks schema/value mutation by scope, not viewing or filtering.
- §5b Panels: Escape walks extended→expanded→collapsed without discarding state; narrow widths convert panels to
  overlays preserving centre content; ARIA names state both action and target panel.
- §5d Red flag **never silently changes source data**; learning **never infers the opposite preference from absence**.
- §3c Helpdesk: **"Public" is a property-level feature, not a database type** — a public projection is a filtered view
  of the same row, never a second Database.
- §3a general form (ADR-224): **a standard control's EXISTENCE is never conditional on a page prop.** The add-row is the
  worked example, not the rule.
- Prototype design docs: **no naked scores** — a score is never shown as a bare number without its basis.

## Category 1 — CV Naturals, post-dating the 2026-08-16 import

C-1..C-34 verified byte-identical to what Bridge imported (four commits, all pure insertions). These are additions.

- **C-35** (2026-08-17): space a collapsed panel gives up belongs to the module between the panels — never to the other
  panel, never to dead background; `.main` carries no `max-width`; fixed chrome height is ONE variable.
- **ADR-017/AP-023 — holding a row enters MULTI-SELECT, not the context menu.** This explicitly narrows C-12, the day
  after Bridge imported it. **Bridge currently holds the superseded version of C-12.**
- A tap while multi-select is active toggles the row, never opens it; the synthetic click on finger-lift is swallowed.
- Every table renders a column-summary row unconditionally; a page cannot opt out by omission.
- A permission or role that cannot be honoured is offered **disabled with the reason**, never hidden or faked
  (ADR-001 extended from commands to permissions).
- A preview is rendered by the same builder as the final document — one builder, two callers.
- A table row is exactly one line high; width that no longer wraps goes to horizontal scroll.
- Text stops at the edge of its container (`overflow-wrap: anywhere` on cards/tiles/modals/breadcrumbs); tables exempt.
- Dashboard tiles are a label and a number — no sub-text.
- Scrollable table height uses **`dvh`, never `vh`** (iPad Safari's collapsing bars make `vh` the largest viewport).
- **Row/cell/column menus are viewport-positioned (`position: fixed`), never absolute inside a scroll container** —
  on a short table everything below the first item was clipped and unreachable.
- A filter control's trigger always reads "Filter"; it never renames itself after the filtered column.
- The assistant panel starts collapsed at every width and never re-expands itself on rotation.
- A shared/public page renders without booting the local database.
- A log recording a revocation keeps the struck-through row rather than deleting it.
- One confirmation style app-wide; **no native `confirm()`/`prompt()`**.
- "Every new module starts as a table" — an unnumbered convention older than the C-series.
- One address addresses a record through its whole life; old addresses redirect, never 404.

## Category 2 — Avilo dashboard v9

### Document/print mode — an entire second rendering mode Bridge has none of
- Print rules defined ONCE outside `@media print`, applied via a `.paper` class, so preview and PDF cannot diverge.
- As a document, card chrome comes off and sections become continuous flow separated by headings.
- Subtitles and instructional copy are stripped in document mode (an instruction to the editor, not the reader).
- **Hide print chrome by intent (`no-print`), never by element type** — hiding every `<button>` deleted real cards.
- Empty sections keep chrome on screen but drop out entirely in the document.
- The on-screen sheet is sized in `210mm` so on-screen line breaks are the printer's.
- PDF export is the browser's own vector print-to-PDF, never a raster/html2canvas pipeline.
- Cmd-P and the native Print menu must produce the document too — the class is added to the live DOM node on
  `beforeprint`, because React never hears about a native print.
- Working memory never prints; client-facing content does.

### Panels and sections
- A section ends in a sentence naming what the picture shows, derived from the same numbers — **a chart is never left
  to speak for itself.**
- Panels are **open by default and collapsible**, not closed and expandable.
- **A collapsed panel shows its FINDING, not its definition.**
- A panel whose time basis differs from the global picker states its own basis in its own header.
- One file owns the shared furniture, so sections cannot each invent their own card.

### Charts
- No chart draws the library's own canvas legend.
- Legend selection state is per chart, never per page.
- An empty selection is the resting state (draw everything), never a filter that removed everything.
- A wide chart scrolls inside its own box; a wide series never pushes the page sideways.
- **A card's height must not change with its data** — render an empty sized div, never `null`.
- Sparkline honesty: minimum three readings; position by index not rank; gaps drawn as gaps; isolated reading = a dot;
  area fill only under an unbroken line; a flat series drawn down the middle.
- A stacked chart may only stack things that genuinely sum.
- A share-of-total visual DIMS rather than isolates — removing a slice makes the ring a share of nothing.
- A derived index is never printed beside the measurement it was derived from.
- A display label must never be parsed back into the underlying value; carry both.

### Tables
- Toolbar degradation has a named ladder — `full → icons → narrow → compact` — measured from the CONTAINER, never the
  viewport.
- Aggregate options are offered per column data type; a text column never advertises "sum".
- Hidden/reordered columns live in the view, never in component state.
- A card view reuses the table's own column renderers — never a second formatting path.
- An unknown id in a stored arrangement is dropped at render, not merely refused at propose time.
- Ids an arrangement omits are appended in canonical order, EXCEPT tile rows where order is a selection.
  "Tiles select, panels permute."
- Normalizing an unset arrangement spells out the app's REAL default, not an empty one.
- A malformed stored view must never block the page.

### Editing and reversibility
- **A field that can be stored and cannot be typed is a field the user will assume was lost.**
- Blast radius is expressed by WHICH CELL you double-click, not by a dialog asking you to choose.
- **A permanent decision needs a visible undo** — the mapped row STAYS in the list showing what it was mapped to.
- Copy must state that a decision persists into the future.
- Restore-from-history is not framed as "undo" — it appends, and the UI says so.
- Test a credential against the real endpoint before it can be saved.
- One upload dialog, classifier-driven — a misdetection costs one click because nothing writes until Import.

### Colour and AI-generated content
- Red is reserved application-wide for missing data and errors — which is why other palettes deliberately contain no red.
- A severity scale is not applied uniformly; reserve red for the genuinely actionable band.
- Threshold colour bands come from ONE declared source, never re-written beside the panel that renders them.
- **Rich text from a model is spans (text + optional colour + optional in-app link id), never markup and never a URL** —
  no `dangerouslySetInnerHTML`, no `href` from generated output; a link becomes a `<button>` calling a handler.
- A link's visible words must never be the destination id.
- Tabular figures wherever money appears.

### Errors and honesty
- A 404 and a component crash must not present identically — they have opposite remedies.
- A deleted or mistyped record id must say so, never leave the spinner up.
- Empty states say what to do next where an action exists.
- When confidence is low, say there is no answer rather than proposing the nearest match.
- A refusal must name what CAN be done and the actual next step — naming the button is the difference between an
  answer and a dead end.
- A capability boundary drawn where the code happens to be flexible, rather than where a user would draw it, produces a
  surface that looks arbitrary.
- A button that silently does less than it appears to must say which changes it reaches.

### Tooltips and component mechanics
- Explanatory text goes in tooltips, not extra rows; it stays in the accessibility tree.
- Any component used as a floating-UI trigger MUST forward its ref, or the panel parks offscreen — open, focusable,
  invisible. Documented twice in Avilo as a repeat defect.

### Verification methodology
- Browser-pane/headless verification is unreliable for pointer-driven UI: a backgrounded pane never fires rAF, so
  throttled event proxies never flush and pointer-driven menus do not open. Say which method was actually used.
- Measure available height from `getBoundingClientRect().top` on scroll and resize; `max-height: 100vh` is wrong for
  anything not pinned to the top.

## Category 3 — Avatar and clicky-avatar

- **Marks/overlay content must be OPAQUE AT REST.** A transparent, never-focused, click-through webview throttles CSS
  animations, so an entrance animation holding `opacity: 0` can stay invisible forever. Animation decorates an
  already-visible element; it is never a precondition for visibility. *(The single most transferable rule found.)*
- Reduced motion keeps a tiny moving hold and removes all large travel — the character never goes fully still; orbits,
  bobs, blinks, quirks AND eye tracking are all gated.
- Spring motion only; linear tweening banned. Gaze leads and runs faster than body posture.
- A hard step cap bounds any spring so a non-converging animation cannot hang the thread.
- Nothing loops for attention except the companion's own idle life; no sound.
- Every animation must answer "what is my companion doing while I'm busy?" or be cut.
- Hover pauses, never accelerates.
- Actions only replace the channels they own; fixed composition order (calm base → emotion pose → action overrides →
  interaction modifiers → one-shot gesture → ambient life → spring renderer).
- Species-specific motion is forbidden in the registry — new behaviour is a shared channel or shared gesture.
- The rig spec is the ONLY place spatial information exists; symmetry is a property of the spec, not the art.
- The pupil can never visually poke outside the white of the eye, clamped against the CURRENT scale.
- Pointer-down on the character is petting — a temporary acting overlay, never a different emotion.
- The floating companion is a non-activating NSPanel (`can_join_all_spaces` + `full_screen_auxiliary`), never an
  ordinary always-on-top window, and never steals focus. `accept_first_mouse(true)` so the first click registers.
- The annotation overlay is click-through from creation and must never intercept a click.
- Expanding the panel keeps its anchored corner pinned so the window never walks off-screen.
- A passive "look at this" draws a ghost cursor; the user's real OS cursor is never hijacked.
- Mark vocabulary is a closed enum with a max count and length cap, rendered as text content and never HTML.
- No `calc()` inside SVG geometry attributes.
- Permission failures degrade to a logged warning with honest copy, never a crash and never a silent blank.

### Gaps in BOTH avatar repos — write from scratch or fix, do not copy
- **No frame-rate budget anywhere.** The nearest proxies are a technique budget (transform/opacity only, no scroll
  listeners) and a spring step cap.
- **No accessibility rules for a floating companion.** clicky's avatar is a bare `<div>` with a `title` — no `role`,
  no `aria-label`, no `tabIndex`, no keyboard activation. A mouse-only 72px companion is the thing to fix, not copy.
- **clicky has no reduced-motion handling at all** — its pulse, glide and spring cursor run unconditionally.
- Avatar's authoring canvas is 400×440, not Bridge's 3840² registration canvas. Reconcile before sharing art.

## Verified against Bridge's code (2026-08-30)

Already covered, do not re-adopt: the 220ms double-click grace (already ported from Avilo); server-speaks-first and
"already configured is not a refusal" (both promoted in ADR-247); the blink-as-capture-tell; the compact-overlay
component reuse; Avilo's table geometry and aggregate footer (ADR-182/218); `h-14`; red-as-only-flag.

Confirmed ABSENT in Bridge and therefore live gaps: `useToolbarDensity` (0 files), any print/`.paper`/`@media print`
mode (0), sparklines (0), `isRouteErrorResponse` (0), multi-select in tables (0), long-press handling in `TableView`
(0). `100vh` appears in five avatar surfaces against exactly one `dvh` use. `StandardDropdown` positions its panel with
`absolute top-full` — the construction CV Naturals replaced after menus were clipped unreachable on short tables.
