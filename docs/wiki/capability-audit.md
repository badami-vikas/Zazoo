# Capability audit vs Notion / Airtable / Evernote

full: [../raw/capability-audit-notion-airtable-evernote-2026-08-10.md](../raw/capability-audit-notion-airtable-evernote-2026-08-10.md) · 2026-08-10. Bridge side measured from CODE, not docs. Declared-but-unimplemented = scored ABSENT.

**Fields: 11 of ~26.** Have text/number/select/multiselect/date/checkbox/url/relation/formula*/skill/location (+5 display hints). Missing: long_text · email · phone · person · attachment · rollup · lookup · count · percent · duration · rating · autonumber · button · barcode · created_time/by · last_edited_time/by. *`formula` is DECLARED WITH NO EVALUATOR — phantom capability, ship or delete.

**Views: 8.** table/board/gallery/form/calendar/map/graph/tree. Missing: list · timeline/Gantt · chart · dashboard (`DashboardView.tsx` exists but is NOT registered → cannot render). **Graph + Tree + Second Brain are Bridge-only.**

**BIGGEST GAP — views are not persisted.** `ViewConfig` is React state; it dies on reload. No saved views, no saved filters/sorts/columns, no linked views, no personal-vs-collaborative, no view sharing. All five are downstream of ONE missing table.

**Also missing:** grouping renderer · column resize · cell wrap · inline databases · record comments · @mentions · per-Record revision UI · form field config/conditional/prefill · MCP server · public API/webhooks · two-way sync · semantic search · OCR · templates · save-by-email.

**Bridge already exceeds all three:** governed writes (Proposal→approval) · provenance on a value · red-flag→learning loop · Agent-owned Skill columns · local-first residency · Graph/Tree/Second Brain · signed Commons registry. Protect these; they have no competitor analogue.

**PLAN, by leverage:**
- **T1 unlock** — P1 persist ViewConfig (one table → 5 benchmark features) · P2 metadata columns from the Event log · P3 generalize `helpdeskTickets.accessToken` into scoped share grants and wire the (already-built, honestly-disabled) Share panel.
- **T2 parity** — P4 field types in dependency order (email/phone/long_text/person/attachment → lookup/rollup/count → percent/duration/rating) · P5 implement or delete `formula` · P6 register Dashboard, add list/timeline/chart (timeline first — pipelines are stage-over-time) · P7 Record body + comments + history.
- **T3 bets** — P8 MCP + public API + webhooks · P9 cross-Module semantic search (Local-Plane privacy story nobody else can tell) · P10 templates + save-by-email · P11 sync last.

**Anti-erosion rule:** every item ships with a check in `ui-conformance.test.mjs` or its own gate (§10). A capability in a type union or a doc but not in the build is scored absent.

**Notes + Governance are MANDATORY Sections on every Record (§3b).** Notes = body, checklists, templates, history+restore, save-by-email routing, inline attachments, shortcuts. Governance = per-field provenance, Proposal/approval history, open red flags + learning state, residency per field, read/edit/comment/co-own, Agent+Automation Runs. *Notes without Governance is Notion; Governance without Notes is a compliance tool; the pair is the product.*

**Helpdesk (§3c):** Helpdesk IS a Database (generic rules apply). Custom Helpdesk = associated Database → sibling TOGGLE. "Public" = a PROPERTY-level feature, not a database type — checkbox in Record Detail + command on cell right-click; never a second Database.
