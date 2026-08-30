---
title: CV Naturals' UI conventions C-1..C-34 — provenance archive, NOT canon
type: raw
doc_kind: reference
status: archived
companions: [ui-rulebook.md]
related_wiki: ../wiki/ui-rulebook.md
updated: 2026-08-30
tags: [ui, provenance, archive, cvn, superseded]
---

> **ARCHIVE — NOT CANON (ADR-260, 2026-08-30).** This preserves CV Naturals' original wording unedited,
> as ADR-249 required. The canonical, reconciled form of these rules is **Part II of
> [`ui-rulebook.md`](ui-rulebook.md)**. Where this archive and the rulebook differ, the rulebook is
> canon — notably C-12, which the donor itself superseded on 2026-08-17, and C-22, narrowed 2026-08-30.
> Do not cite this file as a rule source.

# CV Naturals' UI conventions (C-1..C-34), imported verbatim

Source: CV Naturals `docs/wiki/ui-conventions.md`, registered there 2026-08-14 (AP-008/AP-012,
ADR-005/ADR-009/ADR-010). Imported into Bridge canon 2026-08-16 (ADR-249/AP-161) as part of the
Accounting/D2C module merge. Reconciliation against Bridge's own `ui-architecture.md` — what's
duplicate, what's newly adopted, and the one apparent conflict that turned out not to be one — is
recorded there, not here. This file preserves CV Naturals' original wording unedited.

---

# UI conventions — canon for every module

Registered 2026-08-14 from a user directive ("Everything mentioned here are rules that need to
be registered and implemented for all future modules"). Approval: **AP-008**. Rationale:
**ADR-005**.

These are binding on every `StandardTable` consumer, every element (detail) page, and every new
module. A new module is not "done" until it satisfies all of them. Where a rule is not yet
implemented app-wide, the implementing task is named — the rule is canon regardless of how far
the code has caught up.

## Layout

**C-1 · Header alignment is absolute.** The left nav header, the module header, and the right
panel header sit on one line at the same height, at every viewport size and in both
orientations. Rotation must not break the alignment.

**C-2 · One row means one row.** The dashboard (insights) strip is a single row. The toolbar
("sandwich" row: Lists · View · Search · Filter · New · ⋯) is a single row. Neither wraps —
not on a narrow iPad in portrait, not on rotation. When there is no room left to compress,
the row scrolls sideways; it never wraps to a second line.

**C-3 · Compress before scrolling.** When new dashboard tiles are added, shrink tile sizing to
fit first. Side-scroll is the fallback for when compression is exhausted, not the first
resort.

## Toolbar and table chrome

**C-4 · "New" is a button, not a row.** Creating a record is an always-visible button
immediately right of Filter — never a "+ New …" row at the bottom of the table.

**C-5 · Right-aligned action cluster.** Filter, New `<element>`, and the ⋯ menu are
right-aligned and adjacent, in that order.

**C-6 · The ⋯ is vertical.** `⋮`, not `⋯` — table options and row actions alike.

**C-7 · New opens the element page.** Clicking New navigates to the new element's own page.
It never creates an inline blank row to be filled in place.

**C-8 · Card is a view.** Every table's View dropdown offers Table and Card. Every table's
Lists dropdown offers "+ Add list".

**C-9 · Group by lives under ⋮.** Every table offers grouping from the ⋮ menu.

## Interaction

**C-10 · The whole row is the target.** Clicking *any* cell in a row opens that row's element
page. There are no dead cells.

**C-11 · Double-click edits.** Anything editable is editable on double-click — cells, list
names, column headings, section titles. An Edit button, where one exists, is an addition to
double-click, never a replacement for it.

**C-12 · Long-press is right-click first, hover second.** On touch, a long press fires the
context menu where one exists; only if the element has no context menu does long-press stand in
for hover-reveal. (Refines TASK-015, which mapped long-press to hover only.)

**C-13 · Destructive controls are revealed, not resident.** Delete controls appear on hover
(desktop) / long-press (touch), never permanently in the row.

## Touch

**C-14 · Touch is a first-class input.** Every editable surface raises the on-screen keyboard
on first tap. Focus must be moved inside the user's gesture handler — deferred/programmatic
focus (`autoFocus` on a freshly-mounted input, focus in an effect) is silently ignored by iOS
Safari and is a defect, not a platform limitation.

## Element (detail) pages

**C-15 · Header is back + path.** An element page's header is the back button followed by the
file path (breadcrumb). The header is sticky, and page content must scroll *under* it without
being swallowed — content is never hidden behind the header.

**C-16 · Section buttons form one row.** Every button belonging to a section sits in a single
row at the top or bottom of that section. Invoices use a top row.

**C-17 · Print is editable, and prints one.** Print/PDF view is editable, and renders only the
selected element — never every record in the table.

## Fields

**C-18 · Descriptions are tooltips.** Field, element, and column descriptions render as concise
tooltips, not as body text, unless the user explicitly asks for them inline. Concise means a
phrase, not a sentence.

**C-19 · Dropdown replaces checkbox as a column type.** "Add column" offers Dropdown (choosing
single-select or multi-select) instead of Checkbox.

**C-20 · Link to only offers linked databases.** A relation column's "Link to" picker lists
only databases already related to the current one — without a shared pivot there is nothing to
map on. (Narrows ADR-004's open 8-entity registry.)

## Dropdowns

Registered 2026-08-14 (second directive). Approval: **AP-012**. Rationale: **ADR-009**.

**C-21 · Any option can be starred as the default.** Every dropdown that picks a *value*
(supplier, method, activity type) lets an option be starred; a fresh dropdown opens on the
starred one. Defaults are per-device, not per-database — a default is a personal habit, not
shared business data. Dropdowns that pick a *view setting* (View, Filter) are exempt: there is
nothing to remember that the saved list doesn't already remember better.

**C-22 · Search and add, on every dropdown, always.** Opening a dropdown focuses a search box;
a "+ Add …" row is pinned at the bottom and never filtered away. Where the page has no create
path, the row stays present and disabled with a reason (ADR-001). There are no bare `<select>`
elements anywhere a user picks a record — a select has neither, and that is the whole reason
this rule exists. A dropdown must also offer **every** candidate row, not only the ones already
related to the current record: the first purchase from a supplier is exactly how that link
gets made.

**C-23 · Every delete is revealed *and* confirmed.** Supersedes C-13's first half and removes
its invoice-line exception. A delete control is never resident in a row — it appears on hover
(desktop) or long press (touch), or lives inside the ⋮. A record-level delete lives inside the
element page's ⋮, never as a red button in the page. Every delete, at any level, asks first and
says what cannot be undone.

## Ergonomics

Registered 2026-08-14 from a user directive naming six UX laws. Approval: **AP-012**.
Rationale: **ADR-010**. These are design constraints on every new screen, not aspirations.

**C-24 · Fitts's Law — big and near.** The control the user reaches for most on a screen is the
largest and closest one. Save sits next to what it saves; it is never separated from its record
by a page of scroll. On touch, every control clears 44px.

**C-25 · Law of Proximity — related things touch.** Controls that act together sit together and
wrap together as a unit (Add + Cancel; a price field and its Save). A caption is never separated
from its own field — a wrapping row must break *between* fields, never inside one.

**C-26 · Field size follows the answer; labels use common abbreviations.** A 2-character state
code gets a 2-character box, not a full-width one; a note gets a wide one. Labels are the
abbreviation people already use — "Qty", "Amt ₹", "Ref.", "Ref. price / kg" — not the long form.

**C-27 · Hick's Law — one way to do a thing.** Two controls that create the same record are one
control too many. Where a choice is a field of the record being created, it is a field in the
form, not a row of buttons above it.

**C-28 · Jakob's Law — familiar first.** A table behaves like a spreadsheet, a dropdown like a
dropdown, a notepad like a notepad. Novel interaction models must earn their place; when in
doubt, copy the pattern the user already knows from other software.

**C-29 · Miller's Law — chunk at five to seven.** Long lists and heavy text are broken into
groups of about five to seven. Sections, grouping, and pagination exist for this; a screen that
presents twenty undifferentiated things has a defect.

**C-30 · Aesthetic-Usability Effect — tidy is a feature.** Consistent spacing, alignment and
rhythm are part of correctness here, not decoration: a neat screen is read as trustworthy and
easier, and this app's job is holding someone's money and stock.


## Creation and connection

**C-31 · A missing related record is never a dead end.** If a field needs a record that doesn't
exist yet, the field creates it — every picker's "+ Add" is the mechanism (C-22). No screen may
refuse to open, and no action may refuse to run, on the grounds that some other record has to be
made first, whenever that record can be made from where the user already is.

**C-32 · A connection is one fact, editable from both ends.** Supplier↔raw material,
material↔product, customer↔invoice: whichever page shows the link can also make and unmake it.
A relationship that is writable from one side only is a defect, not a design.

**C-33 · Table-shaped records are created in the table.** Where an element page shows nothing
the columns don't already show — a ledger entry, a payment — New opens a draft row inside the
table, under the same headers, and writes on Add. This is the exception to C-7, not a repeal of
it: anything with detail beyond its columns still opens its element page. There is never a
separate creation form floating above a table.

**C-34 · Write on first save.** An element page opened for a new record writes nothing until
Save, so backing out leaves nothing behind. Records created by a picker's "+ Add" (C-31) are the
deliberate exception: naming one is already the decision to create it.

## Standing rules this does not change

- **ADR-001 (present-not-absent)** still governs: a command that cannot run stays visible and
  disabled with a reason. C-4/C-5 change *where* controls live, never *whether* they appear.
