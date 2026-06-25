---
title: Calendar Tool — Implementation Plan
type: raw
doc_kind: plan
status: P0–P2 BUILT (Google Calendar — list + create/modify/delete, governed); P3–P6 future
companions: [ARCHITECTURE.md, SCHEMA.sql, tools-internalization.md, OSS.md, STACK.md]
related_wiki: ../wiki/calendar.md
updated: 2026-06-24
tags: [calendar, tool, projection, integrations, scheduling, oss, rendering]
---

# Bridge AI — Calendar Tool Implementation Plan

> **Verdict:** Do **not** adopt a calendar *product* or *server* (Cal.com, Radicale, Baïkal,
> Nextcloud). Build a thin **Calendar Tool** Bridge owns, and adopt OSS only for the two
> undifferentiated layers — **UI rendering** and the **RFC-5545 date math**. The calendar is a
> **time-axis projection over the Unified Graph**, governed by the Universal Action Pipeline.
> Adding a new event source later = a new integration adapter, never a calendar rebuild.

## 1. Why a calendar at all, and why this shape

The user wants one in-app surface that shows **everything time-bearing**: Google Calendar today;
conference / event integrations next; and Rituals + Initiatives + Touchpoints (work nodes with
due/scheduled times) as the platform matures — plus team calendars, shared calendars, and
scheduling when workspaces/teams land.

Bridge's architecture **already pre-decides most of this**:

- [initiatives.md](../wiki/initiatives.md) / [schema.md](../wiki/schema.md): *"List / Board / Table /
  **Calendar** / MindMap = stateless read-time **PROJECTIONS** over the ONE relational tree."* The
  calendar is the **time-axis renderer** of the graph, not a separate datastore.
- [tools.md](../wiki/tools.md): new surfaces are **Tools** (composition + surface) that reuse the
  pipeline / ledger / contracts / gate — **zero new subsystem**. The Calendar is a pinnable Tool,
  like Resources / Helpdesk / Card-Scanner.
- The Google Calendar integration **already exists** on the local plane (`@bridge/local` +
  `@bridge/integrations-google`, shipped 2026-06-20): OAuth, read+write, `external_records`
  idempotency, sync cursors, draft-then-approve egress. The calendar **consumes** this, it does not
  re-build sync.

So the real question is not "build vs. buy" — it is **"which of three layers, and who owns each."**

## 2. The three-layer split (the core decision)

```yaml
layers:
  - layer: 1 — Rendering (the grid)
    scope: month/week/day/agenda views, drag-to-reschedule, resize, resource columns, virtualization
    decision: ADOPT OSS, internalized behind a CalendarView port
    rationale: Solved, undifferentiated, a UX/correctness swamp to hand-roll. Zero moat.
    owner: external lib (forked copy)
  - layer: 2 — Standards math
    scope: RRULE recurrence expansion, DST / timezone correctness, ICS parse + generate
    decision: ADOPT small permissive libs behind RecurrenceEngine + IcsCodec ports
    rationale: Recurrence + DST + EXDATE is the #1 calendar bug factory. Never hand-roll RFC-5545.
    owner: external libs (thin deps)
  - layer: 3 — System-of-record + governance
    scope: unified event projection, sync, write-back, team/shared scoping, scheduling
    decision: BUILD on existing platform — reuse graph + pipeline + RLS + Authority + integrations
    rationale: This IS the moat. Bridge already owns every primitive.
    owner: Bridge (the Calendar Tool)
```

### Why NOT adopt a calendar product/server (explicit rejection)

```yaml
rejected_systems:
  - name: Cal.com
    license: AGPLv3
    verdict: REJECT embed
    why: Copyleft — banned by OSS policy (do_not_embed). Also a second source-of-truth that would
         duplicate Bridge's graph + governance + pipeline.
    revisit: cal.diy fork is MIT — revisit ONLY for scheduling/availability (Phase 6+), internalized
             per the Tool model. VERIFY cal.diy's current license first (conflicting 2026 signals).
  - name: Radicale / Baïkal (CalDAV servers)
    license: GPL-3.0
    verdict: REJECT
    why: Copyleft + wrong architecture. Running a CalDAV server makes Bridge a calendar host with its
         own ACL/storage — competes with the Unified Graph + RLS Bridge already owns.
  - name: Nextcloud
    license: AGPLv3
    verdict: REJECT
    why: Copyleft, heavyweight, full-suite. Same second-source-of-truth problem.
  - name: FullCalendar Premium / Schedule-X Premium (resource-timeline views)
    license: commercial key (not copyleft)
    verdict: REJECT (cost + customization)
    why: User will heavily modify and will not pay. Premium gating fights deep customization. The MIT
         renderer (below) covers basic resource columns free; build the heavy lane view custom if needed.
```

## 3. Library picks (all permissive — verified 2026-06-24)

> **BUILT NOTE (2026-06-24):** render v1 shipped **in-house** (date-fns + Bridge tokens), NOT
> react-big-calendar — see the ADR "Calendar render v1 = in-house" in [decisions-log.md](decisions-log.md).
> User wanted maximal modifiability + design-system alignment + no new dep; react-big-calendar stays the
> documented swap-in behind the same view boundary. The original render pick is kept below for the record.

```yaml
adopt:
  - layer: Rendering engine
    pick: IN-HOUSE (date-fns + Bridge tokens) — v1 SHIPPED  # was: react-big-calendar (now the swap-in)
    license: n/a (own code); react-big-calendar fallback = MIT
    capabilities: month/week/day/agenda · click-to-create/edit · time-grid w/ greedy lane-packing ·
      agenda grouping — all on date-fns (already a prototype dep), no new dependency
    why: User will heavily customize + wanted design-system-native + no install. View boundary keeps
      react-big-calendar a drop-in if the in-house ceiling is hit.
    install: pages/CalendarPage.tsx in the prototype (no new dependency)
  - layer: Recurrence + ICS
    pick: ical.js (mozilla-comm)
    license: MPL-2.0   # explicitly allowed by OSS policy
    version_seen: 2.2.1, maintained
    why: ONE library covers BOTH RRULE expansion AND ICS/vCard parsing → fewest deps, one license to vet.
      Projection expands recurrence into concrete event instances BEFORE handing to the dumb renderer.
  - layer: ICS feed generation
    pick: ical-generator
    license: MIT
    why: Emit a subscribable Bridge calendar feed (.ics). Supports Luxon / Temporal date objects.
  - layer: Timezone
    pick: Luxon (or Temporal API when stable)
    license: MIT
    why: Pin ONE tz lib; bind react-big-calendar's localizer to it. Decouple from chat/embedding models.

evaluate_only:
  - name: rrule.js
    license: BSD (permissive)
    note: De-facto RRULE lib but last release 2022 (stale). Use ical.js instead; reach for rrule-es
      (elastic, modern, TZ-correct — verify exact license) only if natural-language RRULE is needed.
  - name: Schedule-X / FullCalendar (standard, MIT)
    note: Modern alternatives behind the same CalendarView port if react-big-calendar's customization
      ceiling is hit. Premium plugins remain off-limits (cost).
  - name: CalendarCN / CalendarKit (shadcn-native, free)
    note: Newer, design-system-aligned. Spike candidates for a headless future; maturity unproven.
```

## 4. Architecture — how it plugs into the existing platform

### 4.1 The unified event projection (Layer 3, the build)

A read-time query that UNIONs every time-bearing source into one normalized `CalendarEvent` shape —
the same "many views over one tree" pattern Initiatives uses, on the time axis.

```yaml
calendar_event_contract:   # typed output_contract, like every Tool boundary
  id: string                  # stable per source instance
  source: enum                # gcal | touchpoint | ritual_run | initiative | conference | ics_feed
  source_record_id: string    # external_records.id / touchpoint.id / ritual_run.id / ...
  title: string
  start: timestamptz
  end: timestamptz | null
  all_day: boolean
  recurrence: { rrule: string | null, expanded_from: string | null }   # ical.js expands → instances
  location: string | null
  participants: person_ref[]  # mirror-plane refs (whitelisted cross-plane edge only)
  plane: enum                 # local | cloud  (drives gate behavior on write)
  visibility: enum            # private | team | workspace  (RLS-scoped)
  editable: boolean           # is this source writable from Bridge?
  governance: { write_action: string | null, requires_approval_level: L0..L3 }
  color_key: string           # source-derived; UI maps to design-system token
```

```yaml
event_sources:
  - source: gcal
    from: external_records (local plane, @bridge/local) — already synced via integrations-google
    write: create/move/delete → pipeline egress (external:send) → draft-then-approve, forced >= L2
  - source: touchpoint
    from: touchpoints with scheduled/due time fields (the Taskade work node)
    write: in-app mutation → pipeline (trivial = auto-mode eligible per allowlist)
  - source: ritual_run
    from: ritual_runs next-fire / scheduled execution (read-only on the calendar)
    write: none (rituals are configured in the Ritual builder, not the calendar)
  - source: initiative
    from: initiatives.timeline{start,target} (read-only span)
    write: none (edited in Initiative detail)
  - source: conference   # FUTURE — pluggable
    from: a new integration adapter emitting external_records + CalendarEvent (Luma/Eventbrite/ICS-subscribe)
    write: per-adapter (mostly read-only import)
  - source: ics_feed     # FUTURE
    from: subscribed external .ics URLs parsed by ical.js
    write: read-only
```

### 4.2 Sync, write-back, and the gate

External calendars stay **source-of-truth**. Bridge **reads** them into the local plane via the
existing `integrations` + `integration_sync_state` + `external_records` tables (GCal already does
exactly this). **Writes** (create/move/delete an external event) route through the **Universal
Action Pipeline as egress** → `external:send` is an **agent-floor DENY**, so a human always approves
(≥ L2). The gate (`planeGate`) already enforces `private ∩ egress = none ⇒ reject`. **No new sync
engine, no new gate.**

### 4.3 Team / shared calendars = RLS, not a new ACL system

A "shared calendar" is a **visibility-scoped saved filter** over the projection:
`private | team | workspace` tiers resolved by the **Authority resolver + RLS** Bridge already
proved live (cross-workspace = 0, team = 1, workspace = 1 — see [schema.md](../wiki/schema.md)).
A team calendar is `WHERE visibility >= team AND team_id = :team` over the same projection. **No
separate calendar permissions model.**

### 4.4 New integrations are pluggable (the future-proofing)

Each new event source (conferences, Luma, Eventbrite, subscribed .ics) is a **new integration
adapter** that emits `external_records` + the typed `CalendarEvent` contract — the **same
`SocialProvider` / Tool-manifest pattern already shipped**. **Adding a source never touches the
calendar surface.** That is the whole point: the surface renders a contract; sources fill the contract.

### 4.5 Scheduling / availability (deferred)

Calendly-like free/busy + slot-finding builds **on the projection** later (Phase 6+). Do **not**
embed Cal.com (AGPL). If/when scheduling is a priority, evaluate the **cal.diy MIT** fork
internalized per the Tool model — after verifying its current license.

## 5. The Calendar Tool manifest (per the Tool model)

```yaml
tool_manifest:
  id: calendar
  name: Calendar
  kind: native            # rendered in-app, not iframed
  surfaces: [pinnable_tool, route:/calendar]
  run_modes: [account_bound]     # standalone/shareable-link = future (public availability page)
  model_bindings: { plane_default: local }
  reads: [external_records(gcal), touchpoints, ritual_runs, initiatives]
  output_contract: CalendarEvent           # section 4.1
  write_path: universal_action_pipeline     # create/move via propose -> decide
  intake_policy: { external_writes: egress, requires_approval_level: ">=L2" }
  ports:
    - CalendarView        # rendering engine seam (react-big-calendar adapter; swappable)
    - RecurrenceEngine    # ical.js RRULE expansion
    - IcsCodec            # ical.js parse + ical-generator emit
  registry_rows: [tools (route /calendar), agents (none new — reuses egress/intake agents)]
```

The Calendar reuses the pipeline / ledger / contracts / gate / versions — **zero new subsystem**,
exactly the conclusion the Tools doc reaches for every other surface.

## 6. Phased plan

# Status (2026-06-24): P0 ✅ · P1 ✅ · P2 ✅ (Google Calendar only) · P3–P6 future.
# Backend = @bridge/integrations-google (5/5 calendar conformance tests, full suite 9/9 green).
# Frontend = prototype /calendar native Tool (in-house render). Recurrence deferred — Google
# expands recurring events server-side (singleEvents:true), so ical.js isn't needed for GCal-only.

```yaml
phases:
  - id: P0    # ✅ BUILT — google.listCalendarEvents skill + service + tRPC google.listEvents
    name: Contract + projection (no UI)
    work: define CalendarEvent typed contract; build read-time projection UNION-ing gcal external_records
      + touchpoint times; stand up CalendarView / RecurrenceEngine / IcsCodec ports
    exit: projection returns normalized CalendarEvent[] for a date range across sources
  - id: P1    # ✅ BUILT — in-house month/week/day/agenda at /calendar (pinnable native Tool)
    name: Read-only calendar surface
    work: in-house render (date-fns) over the projection; source-colored events; pinnable Tool at /calendar
    exit: user sees their Google Calendar on one grid in-app  # DONE (Touchpoints overlay = P3)
  - id: P2    # ✅ BUILT — create/update/delete round-trip through the gate
    name: Governed write-back
    work: create/update/delete event -> proposeSend (action) -> approve -> EgressExecutor writes to Google;
      idempotent + audited. (.ics feed via ical-generator = deferred)
    exit: creating/editing/deleting from Bridge drafts → approves → syncs to Google  # DONE
  - id: P3
    name: Rituals / Initiatives overlay
    work: ritual_runs next-fire + initiative timelines render as native read-only event sources
    exit: one surface shows external events + work nodes + automations + initiative spans
  - id: P4
    name: Team / shared calendars
    work: visibility-scoped projections via RLS; resource-lane view (decide free-columns vs custom build)
    exit: team calendar = visibility>=team filter; per-team lanes render
  - id: P5
    name: Conference / event integrations
    work: add adapters (Luma / Eventbrite / ICS-subscribe) emitting CalendarEvent; surface unchanged
    exit: a conference source appears on the calendar with zero surface changes
  - id: P6+
    name: Scheduling / availability (deferred)
    work: free/busy + slot-finding on the projection; evaluate cal.diy (MIT) internalized
    exit: out of scope for v1
```

**Sequencing:** slots after the local-gate slice and Initiatives P1, where Calendar was already
marked "incremental" ([initiatives.md](../wiki/initiatives.md)).

## 7. Risks / open items

```yaml
risks:
  - risk: react-big-calendar customization ceiling
    mitigation: CalendarView port keeps the engine swappable → headless (own shadcn rendering) if hit
  - risk: recurrence/DST correctness
    mitigation: never hand-roll; ical.js expands RRULE in the projection; test against EXDATE/RECURRENCE-ID
  - risk: cal.diy license drift (AGPL->MIT->? )
    mitigation: scheduling is deferred; verify license at the time it's needed
  - risk: timezone of mixed sources (GCal tz vs Touchpoint tz vs user tz)
    mitigation: normalize all CalendarEvent times to timestamptz in the projection; render in user tz via Luxon
open_decisions:
  - resource-lane view: free react-big-calendar columns vs custom build (decide at P4)
  - whether Calendar gets its own agent or reuses egress/intake agents (lean reuse)
```
