---
title: Cross-repository UI rule intake — Avilo, CV Naturals, Avatar, clicky-avatar
type: raw
doc_kind: intake
status: triaged
companions: [docs/wiki/ui-rulebook.md, docs/wiki/ui-architecture.md]
related_wiki: docs/wiki/ui-rulebook.md
updated: 2026-09-01
tags: [ui, rules, intake, avilo, cvn, avatar, cross-repo]
---

# Cross-repository UI rule intake (2026-08-30)

User directive: *"Can you look for all UI rules across the projects and see if we are missing any rules. List them"* across
`Repo/Avatar`, `Workspace/clicky-avatar`, `Workspace/avilo-dashboard-v9`, `Workspace/CV Naturals`, `Workspace/Relationship OS`.

**Triaged 2026-09-01 (TASK-085, ADR-269, AP-175). Every candidate below now has a disposition in
the appendix at the end of this document.** The list above is preserved verbatim as the evidence
it was; nothing in it was edited. Read the appendix for what became canon.

**Nothing in the lists themselves is canon.** Each entry was a candidate awaiting rule-by-rule adoption. Adoption needs an APPROVALS row;
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


---

# Dispositions (2026-09-01 — TASK-085, ADR-269, AP-175)

Every candidate above is disposed here as **ADOPTED** (now in `docs/wiki/ui-rulebook.md`),
**COVERED** (Bridge already states it — re-adopting would duplicate canon), **SCOPED** (true, but
only for one surface, so it is not promoted to the always-reachable rulebook), or **REJECTED /
DEFERRED** with the reason.

ADR-247's selection test governs throughout: *does this rule change what an agent does on a Module
it did not come from?* — not *is this rule good*. ADR-247 explicitly rejected promoting everything,
because a hundred adopted rules reproduce exactly the failure it prevented. **13 of ~110 candidates
outside Category 0 were adopted.** That ratio is the point, not an accident.

## Category 0 — ADOPTED in full (16 rules, no approval needed)

Already canon in `docs/raw/ui-architecture-rules-2026-07.md`; they were lost when the wiki
compressed 486 lines to 113, and are now indexed. Notes Section · Record Governance Section ·
canonical toolbar slot order · Custom-actions slot · List/View sharing permission levels ·
Map-view eligibility · search-is-not-a-List · Secret Fields · Smartfill preview · keyboard parity ·
Lock scope · panel Escape walk · red-flag never rewrites source · Helpdesk public-as-property ·
control existence never conditional on a page prop · no naked scores.

**Exit-test check:** a reader of the wiki rulebook alone can now state the Notes Section
requirements (§6), the Record Governance Section and how it differs from the Module one (§6, §12),
the canonical toolbar slot order (§4), the Secret Fields rule (§7) and keyboard parity (§5). None
of the five was in the wiki before this task.

## The four corrections TASK-085 flagged ahead of the rest

| # | Correction | Disposition |
|---|---|---|
| 1 | **C-12 stale** — Bridge's wiki held the pre-narrowing text CV Naturals superseded on 2026-08-17 | **FIXED.** `docs/raw/ui-rulebook.md` already carried the resolved form (ADR-261); the wiki did not. §5 now states long-press enters multi-select, with the residual hover-reveal clause intact. |
| 2 | **`StandardDropdown` uses `absolute top-full`** | **FIXED IN CODE**, not just in canon — see 3. |
| 3 | **Positioning resolved by ADR-261; "build it here"** | **BUILT.** `StandardDropdown.tsx` positions its panel `position: fixed`, anchored from the trigger's `getBoundingClientRect()` through the existing `clampMenuPosition` helper (reused, not reinvented), re-anchored on scroll and resize because a viewport-positioned panel does not travel with its trigger. Off-screen until first measurement rather than flashing at 0,0. |
| 4 | **`100vh` in five avatar surfaces against one `dvh`** | **FIXED.** All seven occurrences across `OverlayApp`, `NotchHome`, `ZazooLab` and `ZazooWorld` are now `dvh`; `grep -rn "100vh" platform/apps/web/src` returns nothing. Honest note: on the Tauri overlay surfaces the OS sizes the window and the two units agree, so only `ZazooLab`/`ZazooWorld` could actually have exhibited the iPad Safari defect. Changed everywhere anyway so the rule is greppable. |

## Category 1 — CV Naturals

**ADOPTED (4):** viewport-positioned menus (§6) · the C-12 narrowing (§5) · and two rules Bridge was
already **enforcing without ever writing down** — **one confirmation style, no native dialog**
(now C-23a) and **`dvh` never `vh`** (now C-14a).

> **A rejection I had to withdraw — twice, and the second correction is the interesting one.**
> I first disposed the confirmation rule as "a rule against a defect Bridge does not have", reasoning
> from the repo's general strictness rather than from the repo. Running the grep instead of assuming
> it: `confirm`/`prompt`/`alert` appear **17 times across four files** — `SettingsPage.tsx` (8),
> `RelationshipPage.tsx` (7), `DealPilotPage.tsx` (1), `NewModuleDialog.tsx` (1). So I flipped it to
> ADOPTED as a *new* rule. That was wrong too. `platform/scripts/check-ui-rules.mjs` already carries a
> `native-dialog` ratchet citing *"Part II C-23/C-30 — one confirmation style app-wide; no native
> confirm/prompt/alert"*, and its baseline already holds all 17 call sites. The rule was live, gated,
> and ratcheting down. **What was missing was the clause the gate cites**: `docs/raw/ui-rulebook.md`
> contained no such sentence. Same for `dvh` — a `vh-not-dvh` ratchet enforcing prose the book never
> stated.
>
> That is the real finding of this triage, and it is not one the intake list predicted: two of
> Bridge's eight counted UI gates were enforcing rules that existed only in the gate's own error
> message. A rule you cannot read in the rulebook is a rule that gets argued with in review. Both are
> now written as C-23a and C-14a, each naming the ratchet that enforces it. **No new debt is filed**:
> the 17 call sites are already tracked by the baseline, which can only shrink, and retiring them is
> TASK-073's scope — a triage that grows into a three-page refactor stops being a triage.

**COVERED — Bridge already says this (5):** disabled-with-a-reason extended to permissions → §7
"Present, not absent" / ADR-001 already covers commands *and* is stated without a command/permission
distinction. Unconditional column-summary row → ADR-182/218's aggregate footer. Table row one line
high with horizontal scroll → §4 "One row means one row … side-scroll last". A tap during
multi-select toggles rather than opens → now inside the adopted C-12 text. Every new module starts
as a table → §2's data-shape default.

**SCOPED (2):** a log keeps the struck-through revoked row rather than deleting it — true for audit
and Approvals surfaces, not a rule for every Module. A shared/public page renders without booting
the local database — a real constraint, but it belongs to the sharing work (TASK-064), which does
not exist yet.

**REJECTED / DEFERRED (6), each with its reason:** C-35's collapsed-panel space allocation and the
single fixed-chrome-height variable — Bridge's shell is one `Layout.tsx` with no multi-panel
collapse geometry to govern; the rule describes a layout Bridge does not have. A preview rendered
by the same builder as the final document — Bridge has no preview/document split (see Category 2's
print mode). Text stops at the container edge — a CSS default worth having, but it changes no
agent's behaviour on an unfamiliar Module; it belongs in `theme.css`, not the rulebook. Dashboard
tiles are a label and a number with no sub-text — contradicted by Bridge's own `DashboardRow`,
which is already one component everywhere; changing its contract needs a directive, not an import.
A filter trigger always reads "Filter" — **already true** and now load-bearing after ADR-268
deleted the Goals/Candidates toggles; recorded here rather than added as a rule nobody can violate.
One address for a record's whole life with
redirects — Bridge's routes are already id-addressed and `/module/:name` already redirects; no live
divergence to correct.

## Category 2 — Avilo dashboard v9

**ADOPTED (6):** a stored view never blocks the page + unknown ids dropped at render + column
visibility lives in the View not component state (§8, one rule — the persistence half is TASK-062) ·
model output is spans, never markup (§3) · a floating trigger forwards its ref (§3) · a refusal
names the next step (§8) · say which verification method was actually used (§8) · a display label
is never parsed back into the value (§7).

**COVERED (4):** red reserved application-wide → §9 "Red is the only flag". Explanatory text in
tooltips → C-18. Empty states say what to do next → §8. Toolbar degradation ladder → `DataViews`
already has `COLLAPSE_PRIORITY`, a measured ladder; naming Avilo's four rungs on top of it would be
two ladders.

**REJECTED / DEFERRED — the whole print/document mode (9 rules):** Bridge has no print mode at all
(`grep` for `@media print` / `.paper`: zero files). Adopting nine rules that govern a rendering mode
that does not exist is precisely the always-loaded cost ADR-247 refused. If a document mode is ever
built, these nine are its specification and should be lifted from this document then — recorded, not
lost.

**REJECTED / DEFERRED — charts (10 rules):** sparkline honesty (Bridge has zero sparklines), stacked
charts may only stack summing things, share-of-total dims rather than isolates, legend selection per
chart, no library canvas legend, empty selection is the resting state, wide chart scrolls in its own
box, card height must not change with data, a derived index never printed beside its measurement.
Bridge's only chart surfaces are `DashboardRow` tiles and the graph view, neither of which these
describe. Deferred as a block to whenever Bridge grows real charting; adopting them now would be
canon about a capability that does not exist.

**SCOPED (7):** aggregate options offered per column data type (the aggregate footer's own contract,
ADR-218) · a card view reuses the table's column renderers (`DataViews` already routes every kind
through one renderer path) · test a credential against the real endpoint before saving (Integrations)
· one classifier-driven upload dialog (Files) · threshold colour bands from one declared source and
a severity scale that reserves red for the actionable band (the flag/RAG work, ADR-155) · tabular
figures wherever money appears (Accounting) · measure available height from `getBoundingClientRect`
on scroll and resize (now implemented inside `StandardDropdown`, which is where it was needed).

**REJECTED / DEFERRED — editing and reversibility (6):** a storable-but-not-typable field, blast
radius expressed by which cell you double-click, a permanent decision needs a visible undo, copy
states that a decision persists, restore-from-history appends and says so, a button that does less
than it appears must say which changes it reaches. All six are **already the shape TASK-084 built**
(dependency preview + confirmation + undo, and the fx cell). Re-stating them as rules would describe
the same behaviour twice, in two places that can drift.

**REJECTED (3):** a 404 and a component crash must not present identically; a deleted or mistyped id
must say so rather than spin; when confidence is low say there is no answer. All three are
consequences of §8's "Data is never invented" and ADR-247's "unknown is first-class" applied to
error surfaces — true, and already derivable. A capability boundary drawn where the code is flexible
rather than where a user would draw it is an observation about design judgement, not a checkable rule.

## Category 3 — Avatar and clicky-avatar

**ADOPTED (3):** overlay content is opaque at rest (§3 — the scan's most transferable finding, and a
real class of invisible-forever bug) · a floating companion carries `role`/`aria-label`/`tabIndex`/
keyboard activation (§3 — accessibility basics are never traded away for brevity) · a closed,
length-capped mark vocabulary rendered as text content and never HTML (folded into §3's
model-output-is-spans rule, which is the same closure).

**SCOPED to the Avatar/companion surfaces (14):** reduced-motion gating that keeps a tiny hold ·
spring-only motion, no linear tweening · gaze leads and outruns body posture · a hard spring step cap ·
nothing loops for attention but idle life, and no sound · hover pauses and never accelerates · fixed
channel composition order · no species-specific motion in the registry · the rig spec is the only
place spatial information lives · pupil clamped inside the eye against current scale · pointer-down is
petting, an overlay and not an emotion · non-activating `NSPanel` with `accept_first_mouse(true)` ·
click-through annotation overlay · expanding keeps the anchored corner pinned. Every one is true and
none changes what an agent does on a Module it did not come from — they govern one surface, and they
stay documented here rather than in a rulebook every Module reads.

**ADOPTED as a general rule, not an avatar one (1):** a passive "look at this" draws a ghost cursor
and never hijacks the user's real OS cursor. Folded into §5's Actionability contract rather than
given its own line — taking over the pointer is the extreme case of a control doing more than it
appears to.

**SCOPED (2):** permission failures degrade to a logged warning with honest copy rather than a crash
or a silent blank — already the shape of `ModuleGovernanceSection`'s honest empty state, recorded
against the desktop permission surfaces. No `calc()` inside SVG geometry attributes — a rendering
detail of the avatar art path.

**GAPS, recorded and NOT adopted (4):** no frame-rate budget exists in either avatar repo, so there
is nothing to import — the nearest proxies are a technique budget and the spring step cap, both
already scoped above. clicky has no reduced-motion handling at all — a defect in that repo, not a
rule for this one. clicky's avatar is a bare `<div>` with a `title` — the thing the adopted
accessibility rule exists to prevent, cited as the motivating defect. Avatar's 400×440 authoring
canvas versus Bridge's 3840² registration canvas must be reconciled before any art is shared —
an open task, not a UI rule.
