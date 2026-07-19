# TASK-014 View Grammar + TASK-009 Graph

## Outcome

TASK-014 and converged TASK-009 are complete.

- One compiler-owned registry renders Table, Board, Gallery, Form, Calendar, Map, Graph, and Tree.
- Metadata decides View eligibility. Blueprint v2 emits canonical kinds; v1 aliases migrate.
- Calendar is no longer a Module, Tool, package, route, or nav identity. Google Calendar remains an Integration.
- DealPilot, JobPilot, Relationship, Work, Initiative, and Task Manager consume shared `DataViews`.
- Second Brain is the shared Graph renderer at full scope. One/selected/full Database scopes use the same canvas.
- Full Graph projects permission-pruned Records, Relations, Events, and Files with Database/Module provenance.
- Module pages expose real local Files sections and honest empty states.
- Map plots stored coordinates on a bundled local basemap. Place labels never trigger public geocoding or tile requests; an optional loopback `GeocodingProvider` runs only after a Human click and saves a Location-only patch through the ordinary Record update path.
- Map filtering/sorting understands structured Location values, schema metadata drives titles/search, co-located Records remain selectable, and a visible keyboard-accessible Record list mirrors the canvas.
- Board moves are available only for editable unlocked group fields, one-shot group defaults clear when leaving Form, and Table headers expose current sort direction visually and through `aria-sort`.

## Exact evidence

Authenticated isolated browser evidence passed at desktop and 375×812:

- all eight View kinds rendered;
- Calendar and Graph tabs activated through pointer input;
- Task Manager rendered Tree;
- no document-level mobile overflow;
- one live Graph connected a File, Person, Initiative, Event, and Signal across Modules;
- Relation filtering narrowed the canvas to 2 matching nodes and 1 File Relation;
- the Person node opened its Record Detail;
- the Signal node applied its governed Action;
- inaccessible private nodes and incident edges stayed absent in the DB regression.
- Map's privacy regression proves labels remain unresolved without a provider, public provider URLs are rejected, and coordinate values support labels, pairs, structured objects, and GeoJSON Points.
- A 21-label regression proves a successful first 20-label batch remains plotted when the second provider batch fails; owner-only persistence, partial-save continuity, hide/show lifecycle, and multiline/scientific round-trips are covered.

Affected Core, Tables, DealPilot, JobPilot, DB, API, and Web builds/tests passed.

## Durable links

- [Canonical tasks](../docs/TASKS.md)
- [View Grammar BRD](../docs/raw/brd-dataengine-views-2026-07.md)
- [UI architecture wiki](../docs/wiki/ui-architecture.md)
- [Calendar wiki](../docs/wiki/calendar.md)
- [ADR-121](../docs/raw/decisions-log.md)
- [ADR-122](../docs/raw/decisions-log.md)
- [Bug evidence](../docs/BUGS.md)

## Explicit follow-ups

- TASK-012 VOCAB4: watcher/hash index must connect Module filesystem Files to canonical `files`/`file_refs`.
- TASK-013: retire or rewire legacy `/item/:name` Associations, which still consumes prototype network data.
- TASK-017: move paginated Relationship View filters/sorts to validated server queries so they apply before limit/offset.
