# 2026-07-17 — DataEngine / View Grammar BRD: Calendar and Graph corrected/confirmed as View kinds

## What was delivered

- **BRD** — [docs/raw/brd-dataengine-views-2026-07.md](../docs/raw/brd-dataengine-views-2026-07.md): the canonical 8-kind View Grammar (table, board, gallery, form, calendar, map, graph, tree), each with an eligibility rule computed from column metadata, a feature list, a write path, and worked "which Page renders which views" examples. Includes a full 2026-07-17 code audit, the Calendar/Integration decoupling rule, and the Graph scope selector + Second Brain collapse.
- **TASK-014 scope rewrite** — [docs/TASKS.md](../docs/TASKS.md): Outcome/Prototype-test/Scope/Evidence now explicitly name every deliverable this BRD surfaces, including the Graph scope selector.
- **TASK-009 updated** — Second Brain converged into TASK-014's Graph renderer (scope:full = Second Brain); no separate build.
- **Four bug rows + ADR-108 (first issue)** — [docs/BUGS.md](../docs/BUGS.md): the `/calendar` routing bug, Calendar-as-Module packaging, four duplicate calendar renderers, the GraphView placeholder, and the `network`/`graph` vocabulary mismatch.
- **ADR-109** — Graph view scope selector; Second Brain = Graph at full scope; reverses ADR-108's "never merge" stance. **AP-037** — records the approval. **R-039** — records the request.
- No code changed in this pass — TASK-014 executes the consolidation.

## The 8 canonical View kinds (summary — full detail + features + worked examples in the BRD)

| Kind | Gated on | Currently |
|---|---|---|
| table | always | working, canonical |
| board (kanban) | a status/select column | working |
| gallery (card) | always | working |
| form | always | working, insert path confirmed correct |
| **calendar** | a date column | 4 non-shared implementations, wrongly Module-packaged |
| map | a location column | working but pins are known-broken ("map view is not a map") |
| **graph** (code: `network`) | a relation column + scope selector | eligibility correct, renderer is a placeholder; scope selector adds cross-DB capability |
| **tree** (new) | a self-referential parent column | new — introduced by the Task Manager Module plan |

## Graph view scope selector (new — ADR-109)

Graph is the one View kind that is not purely single-Database. It has three scopes:

| Scope | What it shows | Access |
|---|---|---|
| `single_database` | This Page's rows + their Relations (default) | Any Page with a relation column |
| `multi_database` | User-selected Databases as nodes + cross-DB Relations as edges | User picks from view toolbar |
| `full` | All permitted Databases across every Module — **this is Second Brain** | Graph view toolbar OR the Second Brain nav entry (a preset) |

Second Brain is not a separate surface. It is a named preset that opens Graph view at `scope: full`. One renderer, three scopes.

## Way ahead

TASK-014 executes: consolidate onto the existing `dataviews/registry.ts` system, remove Calendar's Module/route/nav identity, build the real Graph renderer **with scope selector** (which simultaneously delivers Second Brain — TASK-009), rename `network`→`graph`, add `tree`, and fix the tracked map-pin gap.
