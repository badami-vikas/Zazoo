# 2026-07-17 — DataEngine / View Grammar BRD: Calendar and Graph corrected/confirmed as View kinds

## What was delivered

- **BRD** — [docs/raw/brd-dataengine-views-2026-07.md](../docs/raw/brd-dataengine-views-2026-07.md): the canonical 8-kind View Grammar (table, board, gallery, form, calendar, map, graph, tree), each with an eligibility rule computed from column metadata, a feature list, a write path, and worked "which Page renders which views" examples. Includes a full 2026-07-17 code audit, the Calendar/Integration decoupling rule, and the Second-Brain-vs-Page-Graph distinction.
- **TASK-014 scope rewrite** — [docs/TASKS.md](../docs/TASKS.md): Outcome/Prototype-test/Scope/Evidence now explicitly name every deliverable this BRD surfaces.
- **Four bug rows** — [docs/BUGS.md](../docs/BUGS.md): the `/calendar` routing bug, Calendar-as-Module packaging, four duplicate calendar renderers, the GraphView placeholder, and the `network`/`graph` vocabulary mismatch.
- **ADR-108** — records the architectural call. **AP-036** — records the approval (user directive). **R-038** — records the request.
- No code changed in this pass — this is the plan TASK-014 executes, matching how the Task Manager Module's ADR-105/106 preceded its own build slices.

## Your two questions, confirmed by code audit (not just doc review)

1. **Calendar — you were right, and it's currently wrong in the shipped code.** `/calendar` resolves to Task Manager (a routing bug), the real Google Calendar page sits at a second route `/calendar/google`, and Calendar is catalogued as an installed Module/Tool in three separate places (`routes.tsx`'s `InstalledModuleBoundary packageName="calendar"`, `moduleRoutes.ts`, `tools.ts`). Four independent calendar renderers exist with no shared code. Target state: Calendar is purely `kind: "calendar"` in the View Grammar, available on any Page with a date column; Google Calendar is a plain Integration with zero page/route/nav identity of its own.
2. **Graph — confirmed correct already.** No separate relationship-graph table exists anywhere in code or docs. Relations render as typed edges over People/Community rows, gated the same way Calendar is gated (by column metadata, not hardcoding). One caveat: the actual renderer (`GraphView.tsx`) is currently a placeholder (table + banner) — a known, separate gap, not an architecture problem. Second Brain (the cross-Module graph) is explicitly documented as a distinct, wider surface — never to be confused with or merged into a single Page's Graph view.

## The 8 canonical View kinds (summary — full detail + features + worked examples in the BRD)

| Kind | Gated on | Currently |
|---|---|---|
| table | always | working, canonical |
| board (kanban) | a status/select column | working |
| gallery (card) | always | working |
| form | always | working, insert path confirmed correct |
| **calendar** | a date column | 4 non-shared implementations, wrongly Module-packaged |
| map | a location column | working but pins are known-broken ("map view is not a map") |
| **graph** (code: `network`) | a relation column | eligibility correct, renderer is a placeholder |
| **tree** (new) | a self-referential parent column | new — introduced by the Task Manager Module plan |

## Way ahead

TASK-014 executes: consolidate onto the existing `dataviews/registry.ts` system (currently wired only to `/workspace`), remove Calendar's Module/route/nav identity, build the real Graph renderer, rename `network`→`graph`, add `tree`, and fix the tracked map-pin gap alongside it since Map is one of the eight kinds this BRD formalizes.
