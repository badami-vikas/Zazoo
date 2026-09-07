---
title: Notion database parity — every feature, measured against the code
type: raw
doc_kind: analysis
status: active
companions: [capability-audit-notion-airtable-evernote-2026-08-10.md, ui-rulebook.md]
related_wiki: ../wiki/notion-parity.md
updated: 2026-09-06
tags: [audit, competitive, databases, views, columns, filters, parity, canon]
---

# Notion database parity (2026-09-06)

User directive, verbatim: *"I had asked for all features of notion database to be present in our tables as well. Can you list all notion table database features and ensure our views have those inbuilt and are very similar in functionality?"*

This supersedes the scores in `capability-audit-notion-airtable-evernote-2026-08-10.md`, which predates saved Views (TASK-062), share grants (TASK-064), the governed schema mutation (TASK-084), the metadata columns (TASK-063) and the 2026-09-06 table work (TASK-104/105). That document's plan and its §9/§10 canon still stand; only its per-feature verdicts are stale.

## Method

The Notion side is the benchmark. The Bridge side is measured from code — a capability declared in a type union, disabled with a reason, or present as a hook nobody calls is scored **ABSENT**, and the line that proves it is cited. Two read-only inventories were taken before any code was written, one of `apps/web/src/app/dataviews/**` and one of the server (`apps/api/src/table-schema.ts`, `router-shared.ts`, `routers/{tableSchema,view,moduleRecords}.ts`, `packages/{tables,core,db,module-manifests}`).

---

## 1. Property types

Notion has 24. We had 15 declared, of which four are derived metadata.

| Notion property | Before 2026-09-06 | Now |
|---|---|---|
| Title (primary) | implicit — the first column, never declared | unchanged, implicit |
| Text | `text` | `text` |
| Long text | ABSENT — `text` is single-line | `longText` in the grammar |
| Number | `number`, but the inline editor committed a **string** | `number`, editor coerces (TASK-109) |
| Select | `select` | `select` |
| Multi-select | `multiselect`, no inline editor | `multiselect` with a chip editor (TASK-109) |
| Status | ABSENT — approximated by `select` + a badge display hint | `status` with `statusGroups` lifecycle |
| Date | `date`, rendered as a raw string, no picker | `date`, formatted, with a picker (TASK-109) |
| Person | ABSENT | `person` |
| Files and media | ABSENT | `files` |
| Checkbox | `checkbox`, rendered as the literal text "true" | `checkbox`, a real toggle (TASK-109) |
| URL | `url`, rendered as plain text, never a link | `url`, a link (TASK-109) |
| Email | ABSENT | `email` |
| Phone | ABSENT | `phone` |
| Formula | declared; ONE hardcoded instance (`accounting.reports.value`); a user-added formula column carries no `expressionField` and is inert | unchanged in this batch — TASK-108 must either implement or keep refusing it |
| Relation | declared and stored, **never dereferenced**; `relationTarget` unvalidated; no back-reference | a target naming no Database is refused at registration, and a rollup traverses the relation on read (TASK-108). A two-way back-reference is still ABSENT |
| Rollup | ABSENT | IMPLEMENTED — computed on read through the relation, nine reductions, never stored so it cannot go stale (TASK-108) |
| Created time / by | `createdTime` / `createdBy`, derived from the Event log | unchanged |
| Last edited time / by | `lastEditedTime` / `lastEditedBy` | unchanged |
| ID (auto-number) | ABSENT | `autoNumber` |
| Button | ABSENT | `button` with `actionId` |
| Place | `location` — ours predates Notion's | unchanged |
| AI autofill | Smartfill is a permanently disabled stub | unchanged; ours is `skill`, an Agent-computed column, which is the stronger shape |

Ours with no Notion equivalent: `skill` (a column computed by a governed Skill), `location` with real geocoding, and the display hints `badge` / `rag` / `meter` / `currency` / `multiple`.

## 2. View types

| Notion view | Before | Now |
|---|---|---|
| Table | IMPLEMENTED | IMPLEMENTED |
| Board | IMPLEMENTED (needs a `select` column) | unchanged |
| Gallery | PARTIAL — 65 lines, title plus the first four non-empty fields, no cover, no card size | real gallery is TASK-111 |
| Form | IMPLEMENTED | unchanged |
| Calendar | IMPLEMENTED — month, week, day, agenda, drag to reschedule | unchanged |
| List | ABSENT — the toolbar's "List" is the saved-View dropdown, a different thing | TASK-111 |
| Timeline / Gantt | ABSENT | TASK-111 |
| Chart | ABSENT — `DashboardView.tsx` exists outside the registry and shows count tiles, not charts | TASK-111 |

Ours with no Notion equivalent: map, graph and tree, the last with drag-to-reparent that goes through a proposal rather than a direct write.

## 3. View configuration

| Notion capability | Before | Now |
|---|---|---|
| Filters with operators | ONE hardcoded `contains` filter (`DataViews.tsx` ~324). No operator picker. | the full operator grammar plus `filterOpsForKind`; the builder is TASK-110 |
| Nested AND / OR | `filterMatch` read by seven views, **written by nothing** — permanently "all" | a Match all / Match any control is TASK-110. Nested groups remain ABSENT |
| Multi-level sort | engine does Notion-style tie-breaking; the UI replaced the array on every write | the sort editor is TASK-110 |
| Group by | Board only. Table grouping disabled on every column with a stated reason | table grouping is TASK-109 |
| Sub-group | ABSENT | `subGroupBy` in the grammar, renderer in TASK-109 |
| Show / hide columns | IMPLEMENTED | unchanged |
| Reorder columns | ABSENT | `columnOrder`, TASK-109 |
| Column width | `width` read, nothing wrote it | `columnWidths`, TASK-109 |
| Freeze column | ABSENT | `frozenColumnId`, TASK-109 |
| Wrap cells | ABSENT — every cell `whitespace-nowrap` | `wrapCells`, TASK-109 |
| Row height | a hard 40px constant | `rowHeight` with `ROW_HEIGHT_PX`, TASK-109 |
| Calculate summary row | IMPLEMENTED, ten aggregates, but the choice lived in `useState` and died on reload | `aggregates` persisted, TASK-109 |
| Page size and load more | per-page and inconsistent; a Module Page capped silently at 100 rows | one control, and on a Module Database the window is the server's (TASK-110 + TASK-108) |
| Open as peek | ABSENT — a Record opens as a full page | still ABSENT, and deliberate: our Record page carries Sections a peek panel cannot hold |
| Search in database | IMPLEMENTED | unchanged |
| Duplicate a view | ABSENT | TASK-110 |
| Delete a view | hook existed, **no caller** | TASK-110 |
| Rename a view | ABSENT | TASK-110 |
| Default view | ABSENT — "All" hardcoded | TASK-110 |
| Personal vs shared | in the type, no UI | TASK-110 |
| Lock a view | ABSENT | ABSENT |
| Linked view of a database | ABSENT | ABSENT |
| Card preview and size | ABSENT | `cardSize`, `cardPreviewField` and `cardProperties`, all persisted (TASK-111) |

## 4. Rows

| Notion capability | Verdict |
|---|---|
| Row is a page with its own body | PARTIAL — a Record page exists with Notes, Intelligence and Governance Sections; there is no free-form body |
| Comments on a row | ABSENT |
| Row history and restore | PARTIAL — every write is an Event; there is no per-Record history surface |
| Sub-items and dependencies | ABSENT (the tree view is the nearest thing, and it is a relation, not a row hierarchy) |
| Row templates | ABSENT — `formDefaults` is stored and read by nothing |
| Duplicate a row | ABSENT — the menu item is disabled on every page with a stated reason, and no page supplies a handler |
| Delete a row | IMPLEMENTED, single and bulk, on the two pages that supply it |
| Drag to reorder rows | ABSENT — no manual order column |
| Multi-select rows | IMPLEMENTED, with long-press on touch |
| Bulk edit a property | ABSENT — bulk is delete only |
| Undo / trash | ABSENT for rows. Schema changes have one level of undo |

## 5. Data operations

| Notion capability | Verdict |
|---|---|
| Server-side query | IMPLEMENTED — `moduleRecords.list` searches, filters, sorts, groups and pages over every stored Record before slicing, with the column kinds so numbers and dates compare correctly, and returns the count of the whole match (TASK-108) |
| Value validation on write | IMPLEMENTED — each value is coerced and checked against its kind, `required` is enforced on insert after defaults, and a derived column is refused rather than stored (TASK-108) |
| CSV import and export | ABSENT server-side; the only CSV writer is the audit ledger's |
| Copy and paste cell ranges | ABSENT |
| Database automations | ABSENT — the trigger vocabulary is `manual | schedule | event`, no row-created or property-changed trigger, and event dispatch says in code that nothing starts an Automation |
| Public API | ABSENT — tRPC only |
| Synced external databases | ABSENT |

## 6. Sharing

| Notion capability | Verdict |
|---|---|
| Share a view with people | IMPLEMENTED — `share_grants`, levels view / edit / co-owner, member and link grants, expiry, revocation |
| Open a shared link | ABSENT — there is no route that opens a shared View, so the panel prints the token and says so |
| Publish to the web | ABSENT |
| Database-level permission | ABSENT — a grant targets a View or a Form, never a Database; row access is Organization membership |
| Column-level permission | PARTIAL — `locked` and `sensitive` are honoured by the editor, not enforced on read |

---

## 7. What we have that Notion does not

Protect these; none of them has a Notion analogue.

1. Governed writes: a mutation can be a Proposal with an approval path, an actor and an audit trail.
2. Provenance on a value, and a red flag on a cell that feeds a learning loop.
3. `skill` columns — an Agent computation as a first-class field, with the Agent attributable.
4. A server-reported capability model: every schema command states the server's own reason when it cannot act, rather than hiding.
5. A delete-column dependency preview that lists what breaks, and marks what it did not inspect.
6. The column overlay: a rename is a per-Organization patch, not a migration.
7. Local-first residency. Map, graph and tree views. A signed Commons registry.

## 8. What this batch does not close

Stated plainly so nobody reads the matrix as a finish line: **row comments, row history UI, sub-items, row templates, bulk property edit, manual row order, row undo and trash, CSV import and export, cell-range copy and paste, database automations, a public API, external sync, a shared-view route, web publishing, database and column level permissions, linked views, locked views, and nested AND/OR filter groups.** Every one is genuinely absent today, and none of the four tasks below claims it.
