---
title: Capability audit — Bridge vs Notion, Airtable, Evernote
type: raw
doc_kind: analysis
status: active
companions: [ui-architecture-rules-2026-07.md, brd-dataengine-views-2026-07.md]
related_wiki: ../wiki/capability-audit.md
updated: 2026-08-10
tags: [audit, competitive, databases, views, fields, forms, automations, ai, canon]
---

# Capability audit — Bridge vs Notion, Airtable, Evernote (2026-08-10)

User directive: *"Audit our feature list against [Notion / Airtable / Evernote capability lists]. Share the capabilities missing or sub par to competitors and plan how we can excel in every dimension."*

## Method and honesty note

Competitor capabilities are taken **verbatim from the user-supplied lists** and not independently re-verified against vendor docs; they are the benchmark as given. Bridge's side is measured from code, not from docs or claims:

- `platform/packages/tables/src/types.ts` — `ColumnKind`, `ViewKind`, `ViewConfig`
- `platform/apps/web/src/app/dataviews/registry.ts` — which view components are actually registered
- `platform/apps/web/src/app/lib/` — `exportTable.ts`, `csvImport.ts`
- `platform/apps/web/src/app/dataviews/views/` — the renderers themselves

Where something is declared in a type but has no implementation, it is scored **as absent** and said so.

---

## 1. Field / property types

Bridge `ColumnKind` today — **11**: `text` · `number` · `select` · `multiselect` · `date` · `checkbox` · `url` · `relation` · `formula` · `skill` · `location`.

Plus 5 presentation hints on `display` (`badge`, `rag`, `meter`, `currency`, `multiple`) — these are *rendering*, not types: they do not change validation, sort, or write behaviour.

| Capability | Notion | Airtable | Bridge | Verdict |
|---|:--:|:--:|:--:|---|
| Single line text | ✅ | ✅ | ✅ | parity |
| Long text / rich text | ✅ | ✅ | ❌ | **missing** — `text` is single-line only |
| Number | ✅ | ✅ | ✅ | parity |
| Percent | — | ✅ | ~ | display hint only, no type |
| Currency | — | ✅ | ~ | display hint only, no type |
| Duration | — | ✅ | ❌ | **missing** |
| Rating | — | ✅ | ❌ | **missing** |
| Select / multi-select | ✅ | ✅ | ✅ | parity |
| Date / date-time | ✅ | ✅ | ✅ | parity (no time-zone semantics) |
| Checkbox | ✅ | ✅ | ✅ | parity |
| URL | ✅ | ✅ | ✅ | parity |
| Email | ✅ | ✅ | ❌ | **missing** |
| Phone | ✅ | ✅ | ❌ | **missing** |
| Person / user | ✅ | ✅ | ❌ | **missing** — significant: Bridge is a relationship product |
| Files / attachment | ✅ | ✅ | ❌ | **missing** — Files exist as a Module Section, never as a column |
| Relation / linked record | ✅ | ✅ | ✅ | parity |
| Rollup | ✅ | ✅ | ❌ | **missing** |
| Lookup | — | ✅ | ❌ | **missing** |
| Count | — | ✅ | ❌ | **missing** |
| Formula | ✅ | ✅ | ⚠️ | **declared, not implemented** — `kind: "formula"` exists in the type union with no evaluator anywhere in the repo. Form view explicitly excludes it. This is a phantom capability. |
| Autonumber | — | ✅ | ❌ | missing |
| Barcode | — | ✅ | ❌ | missing (low priority) |
| Button | — | ✅ | ❌ | **missing** — and it is the natural home for a governed Action in a cell |
| Created time / by | ✅ | ✅ | ❌ | **missing** |
| Last edited time / by | ✅ | ✅ | ❌ | **missing** |
| Title (primary field) | ✅ | ✅ | ~ | implicit — the first column, never declared |
| Location / coordinates | — | — | ✅ | **Bridge only** |
| Skill (Agent-computed cell) | — | ~ | ✅ | **Bridge only** — Airtable's "AI in fields" is the nearest analogue |

**Score: 11 of ~26 benchmark types.** The four metadata fields (created/edited time/by) are the cheapest and highest-leverage gap — they are pure derivation from data the Event log already holds, and half a dozen competitor features (activity feeds, staleness rules, "recently edited" views) depend on them.

---

## 2. Views

Bridge registered view kinds — **8**: `table` · `board` · `gallery` · `form` · `calendar` · `map` · `graph` · `tree`.

| View | Notion | Airtable | Bridge |
|---|:--:|:--:|:--:|
| Table / grid | ✅ | ✅ | ✅ |
| Board / kanban | ✅ | ✅ | ✅ |
| Calendar | ✅ | ✅ | ✅ |
| Gallery | ✅ | ✅ | ✅ |
| Form | ✅ | ✅ | ✅ |
| List | ✅ | ✅ | ❌ |
| Timeline / Gantt | ✅ | ✅ | ❌ |
| Chart | ✅ | ~ | ❌ |
| Dashboard | ✅ | ✅ | ❌ (a `DashboardView.tsx` file exists but is **not registered**, so it cannot render) |
| Map | ✅ | — | ✅ |
| Graph | — | — | ✅ **Bridge only** |
| Tree | — | — | ✅ **Bridge only** |

**Gap: List, Timeline/Gantt, Chart, Dashboard.** Timeline is the most-cited omission for deal and job pipelines — both are inherently stage-over-time.

---

## 3. View mechanics — the biggest structural gap

| Capability | Notion | Airtable | Bridge | Note |
|---|:--:|:--:|:--:|---|
| Multiple named views per table | ✅ | ✅ | ⚠️ | The List dropdown exists in the UI; the ViewConfig behind it **is not persisted** |
| **Saved view state (filters/sorts/columns)** | ✅ | ✅ | ❌ | **`ViewConfig` is React state. It dies on reload.** No table, no API, no per-user storage. |
| Per-view filters | ✅ | ✅ | ⚠️ | applied in-memory, not saved |
| Per-view sorts | ✅ | ✅ | ⚠️ | same |
| Grouping | ✅ | ✅ | ❌ | in the column menu as a command, no group renderer |
| Column visibility | ✅ | ✅ | ⚠️ | in-memory `hiddenColumns` Set |
| Column width | ✅ | ✅ | ~ | `ColumnSpec.width` exists, not user-resizable |
| Cell wrapping | ✅ | — | ❌ | rows are fixed 40px, `whitespace-nowrap` |
| Linked views (same data, many places) | ✅ | ✅ | ❌ | **missing** |
| Inline vs full-page database | ✅ | — | ❌ | a Page is always full-page |
| Personal vs collaborative views | — | ✅ | ❌ | no view ownership model |
| Shareable view link | ~ | ✅ | ❌ | Share panel is **rendered and disabled with its reason** — Bridge has exactly one sharing primitive (`helpdeskTickets.accessToken`) and it is not wired to Views |
| Row = a page with its own content | ✅ | ~ | ⚠️ | Record Detail exists; a Record has **no body/notes** of its own |

**This is the single largest gap in the audit.** Every competitor treats "a view is a stored overlay you name, save, share, and return to". Bridge renders views correctly and then throws the configuration away. Lists, sharing, personal-vs-team views, and linked views are all downstream of the same missing persistence layer — one schema change unlocks five benchmark features.

---

## 4. Forms

| Capability | Airtable | Bridge |
|---|:--:|:--:|
| Form as a view type | ✅ | ✅ |
| Per-field label / help / required override | ✅ | ❌ — driven straight off `ColumnSpec` |
| Conditional field visibility | ✅ | ❌ |
| Prefill via URL params | ✅ | ❌ |
| Share / publish the form | ✅ | ⚠️ UI present, disabled with reason |
| Access rules (private / team / anyone) | ✅ | ⚠️ same |
| Submission = ordinary row insert | ✅ | ✅ |
| Post-insert enrichment pipeline | ~ | ✅ **Bridge better** — Learning Agent applies the same standard process every other write path gets |

---

## 5. Collaboration, history, governance

| Capability | Notion | Airtable | Evernote | Bridge |
|---|:--:|:--:|:--:|:--:|
| Record comments | ✅ | ✅ | ✅ | ❌ |
| @mentions + notifications | ✅ | ✅ | ✅ | ❌ |
| Record revision history | ✅ | ✅ | ✅ | ⚠️ Events are logged; **no per-Record history UI** |
| Field/table edit restrictions | ✅ | ✅ | — | ✅ `locked` / `editable` / `sensitive` |
| Role model (owner/editor/commenter/read-only) | ✅ | ✅ | ✅ | ⚠️ Authority resolver exists; no commenter role |
| Provenance / evidence on a value | — | — | — | ✅ **Bridge only** |
| Governed proposal → approval on writes | — | — | — | ✅ **Bridge only** |
| Negative-feedback capture (red flag → learning) | — | — | — | ✅ **Bridge only** |

---

## 6. Automations, AI, API, platform

| Dimension | Benchmark | Bridge | Verdict |
|---|---|---|---|
| Trigger→action automations | Airtable: full builder + JS | Automations start Agent Runs | **different shape, comparable power**; no visual builder |
| AI in fields | Airtable field agents | `kind: "skill"` columns | parity in concept |
| AI app-building | Airtable Omni | Builder Agent (BA0/BA1) | roadmap, not shipped |
| MCP server | Airtable ✅ | ❌ | **missing** — and a natural fit |
| Web API + webhooks | Airtable ✅ | tRPC surface; no public REST/webhooks | **missing** |
| CSV import / export | Airtable ✅ | ✅ `csvImport.ts` / `exportTable.ts` | parity |
| Third-party sync (Sheets, etc.) | Airtable ✅ | Gmail/Calendar Integrations only | partial |
| Two-way sync between bases | Airtable ✅ | ❌ | missing |
| Extensions / plugin ecosystem | Airtable ✅ | Commons capability registry | **different shape, arguably stronger** — signed, governed |
| Web / Mac / Windows / iOS / Android | Airtable ✅ | web + Tauri desktop; mobile app is Expo scaffold | partial |
| Offline access | Evernote ✅ | Local Plane is local-first by design | **Bridge better** in principle |
| Meeting notes / transcription | Evernote ✅ | `companion_transcribe` (Whisper) exists | partial — no meeting-notes surface |
| Semantic search across everything | Evernote ✅ | Mem0 Memory; no cross-Module semantic search UI | **missing** |
| OCR / search inside attachments | Evernote ✅ | ❌ | missing |
| Templates | Evernote ✅ | ❌ | missing |
| Save-by-email into the system | Evernote ✅ | ❌ | missing |
| Encrypt selected text | Evernote ✅ | `sensitive` columns → vault | comparable |

---

## 7. Where Bridge already exceeds all three

These are not gaps to close but the moat to protect, and none of the three benchmarks has an answer to them:

1. **Governed writes.** Every mutation can be a Proposal with an approval path, an actor, and an audit trail. Airtable has permissions; nobody has *governance*.
2. **Provenance on a value.** A cell can carry where it came from and how confident that is. This is the substrate for trust, and it has no competitor analogue.
3. **Red flag → learning loop.** Negative feedback on a specific rendered value, scoped and reversible, feeding a governed correction. Competitors have "report a problem"; none feeds a learning system.
4. **Agent-owned Skills as a column type.** `kind: "skill"` makes an Agent computation a first-class field, with the Agent attributable.
5. **Local-first residency.** Raw capture stays on the Local Plane. Notion and Airtable are cloud-only by construction.
6. **Graph and Tree views + Second Brain.** Cross-Module graph over permitted Records is genuinely absent from all three.
7. **Commons.** A signed, governed capability registry is a stronger shape than an extensions marketplace.

---

## 8. Plan — how to excel, sequenced by leverage

Ordered by *unlocked features per unit of work*, not by list order.

### Tier 1 — the unlock (do first; everything else compounds off it)

**P1. Persist `ViewConfig`.** One table (`view_config`: id, database_id, name, owner, scope, kind, filters, sorts, groups, hidden_columns, widths) plus CRUD. This single change delivers: named saved views · saved filters/sorts/columns · Lists that survive reload · personal-vs-collaborative views · linked views · and the storage half of view sharing. **Five benchmark rows from one schema.**

**P2. Metadata columns** — `created_time`, `created_by`, `last_edited_time`, `last_edited_by` as real `ColumnKind`s derived from the Event log. Cheap, and unlocks activity feeds, staleness automations, and "recently edited" views.

**P3. Wire the sharing primitive to Views.** The Share panel UI already exists and is honestly disabled. Generalize `helpdeskTickets.accessToken` into a scoped share-grant (target, scope, access level, expiry, revocation) and connect it. Delivers: shareable view links · form publishing · access rules · and §5's view-vs-co-owner permission model, which is currently canon with no implementation.

### Tier 2 — parity where absence is conspicuous

**P4. Field types, in dependency order.** `email` · `phone` · `long_text` · `person` · `attachment` → then the computed trio `lookup` · `rollup` · `count` (which need P1's relation traversal) → then `percent` · `duration` · `rating` · `autonumber`.

**P5. Implement `formula` or delete it.** A declared type with no evaluator is a phantom capability and exactly the kind of thing this session's audit was called to find. Either ship an evaluator or remove it from the union.

**P6. Register `DashboardView`; add `list`, `timeline`, `chart`.** Timeline first — deal and job pipelines are stage-over-time and both flagship Modules want it.

**P7. Record body + comments + history.** Notion's "rows are pages" is the shape to match: a Record gets its own content, a comment thread, and a revision timeline. See §9 — this is also where the user's Notes/Governance requirement lands.

### Tier 3 — the differentiated bets

**P8. MCP server + public API + webhooks.** Airtable has all three; Bridge has a sibling-project design already validated (see `avilo-external-agent-reference`). This is how Bridge becomes something other tools build on.

**P9. Semantic search across every Module,** over Memory + Files + Records, permission-pruned. Evernote's strongest card, and Bridge's Local-Plane posture makes it a privacy story nobody else can tell.

**P10. Templates + save-by-email capture.** Both are Evernote table stakes and both fit Bridge's capture-day-1 principle.

**P11. Two-way sync and third-party data sources.** Lowest leverage; do it last, and only for sources users actually name.

### The rule that keeps this from eroding

Every item above ships with a check in `platform/apps/web/test/ui-conformance.test.mjs` or its own gate, per `ui-architecture-rules-2026-07.md` §10. A capability that exists only in a type union or only in a doc is scored as absent by this audit, and should be scored that way by the build too.

---

## 9. Notes and Governance sections on every element

User directive 2026-08-10: *"every element should have a notes section and governance section."* This is canon, recorded here and in `ui-architecture-rules-2026-07.md` §3b.

Every Record Detail surface carries two standard Sections, in addition to whatever domain Sections its Module adds:

**Notes** — the Record's own body, matching Notion's "rows are pages" and Evernote's note tooling:

- rich text with **checkboxes and checklists**;
- **templates**, including user-authored custom templates;
- **note history with restore** — every revision, reversible;
- **save-by-email into the Record**, with subject-line routing commands (target Module/Database, tags, reminder) mirroring Evernote's capture path;
- attachments inline, participating in the Files Section and the local tree (§6);
- keyboard shortcuts, including user-configurable global ones.

**Governance** — the section no competitor has, and the reason Notes can be trusted:

- provenance for each field: where the value came from, which Agent or import, and when;
- the Proposal/approval history for every governed write to this Record;
- red flags currently open on it, and the learning state of each;
- residency: which plane each field lives on, and what is mirrored where;
- who may read, edit, comment, or co-own — the same model §5 gives Lists and Views;
- Agent and Automation activity attributable to this Record, with Run links.

Notes without Governance is Notion. Governance without Notes is a compliance tool. The pair is the product.

---

## 10. Helpdesk data model (clarified 2026-08-10)

User directive: *"Helpdesk is a database and custom helpdesk is associated database that appears as toggle. Public database is just a feature that converts certain helpdesk properties and appears on right clicking a helpdesk element or inside helpdesk element as a checkbox."*

Recorded as canon:

- **Helpdesk is a Database**, not a bespoke surface — it gets the standard toolbar, views, lists and Record Detail like every other Database (§0: rules are generic).
- **Custom Helpdesk is an associated Database** related to it, so by §2 rule 1 it renders as a **sibling toggle Page**, not a sub-module and not a separate surface.
- **"Public" is a property-level feature, not a database type.** It marks which of a Helpdesk Record's properties are exposed publicly. It surfaces two ways, both of them standard: a **checkbox inside the Record Detail**, and a command on the **cell/row right-click menu** (§5f). It never creates a second Database, and a Record's public projection is always a filtered view of the same row.
