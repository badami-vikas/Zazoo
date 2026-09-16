# Notion database parity

full: [../raw/notion-database-parity-2026-09-06.md](../raw/notion-database-parity-2026-09-06.md) · 2026-09-06. Supersedes the per-feature scores in [capability-audit.md](capability-audit.md); that doc's plan and its Notes/Governance canon still stand.

**Properties.** Notion 24. We had 15. Added to the grammar: longText, email, phone, person, files, status, rollup, autoNumber, button. Ours only: `skill` (Agent-computed cell), `location`, and the badge/rag/meter/currency/multiple display hints.

**Views.** Notion 8. We had table, board, gallery, form, calendar (+ map, graph, tree, which Notion has not). Missing and now being built: list, timeline, chart; gallery was a 65-line stub.

**The three real holes found by measuring, not reading docs:**
1. **One hardcoded filter.** `contains`, one field, no operator picker, and `filterMatch` was written by nothing — permanently "all".
2. **No server query for Module Databases.** `moduleRecords.list` returned the whole JSON document; a Module Page capped silently at 100 rows.
3. **No value validation on any write.** `pickDeclared` checked key membership only, so a number column accepted an object and `required` was never enforced.

**Work:** TASK-108 server query engine + validation · TASK-109 cells, editors, column mechanics, table grouping · TASK-110 filter builder, multi-sort, saved-List verbs, pagination · TASK-111 list/timeline/chart views + a real gallery.

**Still absent after this batch, stated:** row comments · row history UI · sub-items · row templates · bulk property edit · manual row order · row undo/trash · CSV import/export · cell-range paste · database automations · public API · external sync · a route that opens a shared View · web publishing · database- and column-level permissions · linked views · locked views · nested AND/OR groups.
