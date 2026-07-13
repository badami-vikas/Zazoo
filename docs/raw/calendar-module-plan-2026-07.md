---
title: Calendar Module Plan — Design, Business, and Technical
type: raw
doc_kind: plan
status: proposed
companions: [calendar-plan.md, dealpilot-module-plan-2026-07.md, jobpilot-module-plan-2026-07.md, clean-room-capability-research-protocol-2026-07.md, day1-integrations-free-apis.md]
related_wiki: ../wiki/calendar.md
updated: 2026-07-13
tags: [calendar, module, design, business-process, projection, agents, skills, automations, reuse, scheduling]
---

# 0. Product decision

Calendar is one pinnable Tool + one primary global-nav item (route `/calendar`, "Home" adjacency). It is a **time-axis projection over the Unified Graph**, governed by the Universal Action Pipeline — **not a calendar product or server, and not a second source-of-truth.** This decision is already made and partly shipped (`docs/raw/calendar-plan.md`, ADR "Calendar render v1 = in-house"): P0–P2 are BUILT for Google Calendar (list + create/modify/delete, governed round-trip; `@bridge/integrations-google` 5/5 calendar tests; in-house render at `/calendar`). This module plan re-expresses that architecture plan in the DealPilot three-lens format and sequences the P3–P6 build (rituals/initiatives overlay, team/shared, conference adapters, scheduling).

Load-bearing reframe vs standalone calendar apps: the calendar is a **renderer of a contract** (`CalendarEvent`), so adding a source (conference, ICS, another provider) is a new integration adapter, never a calendar rebuild; and every external write is pipeline egress (`external:send` agent-floor DENY → human approves ≥L2), so Bridge never becomes a calendar host with its own ACL/storage.

```yaml
navigation_layers:
  global_sidebar:
    item: Calendar
    purpose: enter the time-axis surface (pinnable Tool)
  view_navigation:
    form: month / week / day / agenda toggle; segmented on mobile
    items: [Month, Week, Day, Agenda]
  object_navigation:
    form: event detail popover/panel; source-typed (gcal | touchpoint | ritual_run | initiative | conference | ics_feed)
    purpose: keep each event's source record, participants (Person graph), governance, and linked work attached to the one event
```

Competitive frame: standalone calendars that became second sources-of-truth got acquired-and-killed (Sunrise, Mailbox) or fragmented the user's data. Modern AI calendars (Motion, Reclaim, Notion Calendar, Vimcal, Akiflow) win on command-bar speed, defrag/auto-scheduling, and meeting context — but all of that is a *projection + governance* story Bridge already owns the primitives for. Bridge's differentiation: the calendar renders the SAME graph that drives Touchpoints, Rituals, Initiatives, DealPilot meetings, and JobPilot interviews, with prep/follow-up drafts governed through the pipeline — no separate scheduler, no third data store. (Note: the fresh commercial + OSS diligence subagents for this module hit the session limit; the reuse verdicts below are the already-verified picks from `calendar-plan.md` §3, refreshable later.)

# 1. Design lens — exact information architecture

## 1.1 The grid (built)

Month/week/day/agenda over the projection, in-house render (date-fns + Bridge tokens), source-colored events, click-to-create/edit, greedy lane-packing on the time grid, agenda grouping. `CalendarView` port keeps the engine swappable (react-big-calendar MIT is the documented drop-in if the in-house ceiling is hit). Honest empty state until a source connects; never seeded dummy events.

## 1.2 Event detail

Source-typed popover/panel. Contents by source:

```yaml
event_detail:
  common:
    - title, start/end, all-day, location, timezone (normalized to timestamptz, rendered user-tz)
    - source badge + source_record_id; editable/read-only state; visibility (private|team|workspace)
    - participants as Person-graph refs (mirror-plane, whitelisted cross-plane edge)
    - governance: write_action + required approval level
  gcal:
    - full event, attendees, conferencing link; edits route through pipeline egress (>=L2 approve)
  touchpoint:
    - the underlying work node (Taskade tree); in-app mutation via pipeline (trivial = auto-mode eligible)
  ritual_run:
    - next-fire / scheduled execution; read-only (configured in the Ritual builder, not here)
  initiative:
    - timeline span (start/target); read-only (edited in Initiative detail)
  conference / ics_feed:
    - imported event + adapter provenance; read-only (per-adapter)
```

## 1.3 Overlays (P3)

Toggleable source layers on one surface: external events + Touchpoints (work with times) + ritual next-fires + Initiative spans. Each layer is source-colored and independently show/hide-able. This is the "one surface shows everything time-bearing" payoff — the reason Calendar is a projection, not an app.

## 1.4 Team / shared views (P4)

A "shared calendar" is a visibility-scoped saved filter over the projection (`visibility >= team AND team_id = :t`), resolved by the Authority resolver + RLS Bridge already proved live — not a new ACL system. Resource-lane view (per-person/per-team columns): decide free react-big-calendar columns vs custom build at P4.

## 1.5 Prep & follow-up (the graph payoff)

Because the calendar renders the same graph as DealPilot/JobPilot/Relationships, each meeting carries governed prep and follow-up: a prep pack assembled from the relationship graph + linked Initiative/Deal/Application context, and post-meeting follow-up drafts — all draft-then-approve, never auto-sent. This is where Bridge's calendar diverges from a plain grid: meetings are Touchpoints with context, not opaque blocks.

## 1.6 Scheduling / availability (P6+, deferred)

Calendly-like free/busy + slot-finding built ON the projection later. Scheduling links are draft-gated egress (a public availability page is future). Cal.com (AGPL) banned as embed; evaluate the cal.diy MIT fork internalized per the Tool model, after verifying its current license.

## 1.7 Playbooks

Configurable capability library: event templates, meeting-type prep templates, focus/buffer/pacing policies (for any future defrag proposals), tz/rendering preferences, per-source color/visibility defaults. Version, provenance, eval status, active/legacy.

# 2. Business lens

## 2.1 Processes covered

```yaml
covered_processes:
  time_visibility:
    - one surface UNION-ing every time-bearing source into a normalized CalendarEvent contract
    - month/week/day/agenda; source overlays; user-tz rendering
  external_sync:
    - read external calendars into the local plane via existing integrations + external_records (GCal shipped)
    - governed write-back (create/move/delete) as pipeline egress, human-approved >= L2
  work_on_the_time_axis:
    - Touchpoints with times, ritual next-fires, Initiative spans rendered as native sources
    - in-app touchpoint mutation via pipeline
  collaboration:
    - team/shared calendars as RLS visibility filters; resource lanes
  meeting_intelligence:
    - prep packs from the relationship + work graph; post-meeting follow-up drafts (draft-then-approve)
    - interview scheduling for JobPilot; meeting scheduling for DealPilot — same surface, one contract
  extensibility:
    - new event sources (Luma/Eventbrite/ICS-subscribe) as pluggable adapters emitting CalendarEvent
  scheduling_future:
    - free/busy + slot-finding on the projection (P6+); draft-gated scheduling links
```

## 2.2 Explicitly not covered

```yaml
not_covered_or_not_authoritative:
  - embedding or running a calendar product/server (Cal.com AGPL, Radicale/Baikal GPL, Nextcloud AGPL — banned)
  - becoming a second source-of-truth: external calendars stay authoritative; Bridge projects + writes back
  - a separate calendar ACL/permissions model (team scope = existing RLS, not new tables)
  - unattended external event writes: every create/move/delete is pipeline egress, human-approved >= L2
  - hand-rolled recurrence/RRULE/DST math (the #1 calendar bug factory — adopt ical.js, never hand-roll)
  - paid rendering tiers (FullCalendar/Schedule-X premium lane views — cost + customization conflict)
  - autonomous defrag/auto-scheduling that moves the user's real events without approval (Motion/Reclaim model reframed to governed proposals)
  - storing provider credentials in the surface; egress with raw keys (CredentialBroker only)
  - cross-tenant sharing of calendar data; participant refs cross planes only on the whitelisted edge
```

# 3. Technical lens

## 3.1 Agents

No new permanent agents. Calendar leans on existing egress/intake agents for write-back and on Chief of Staff for prep/follow-up synthesis (open decision in `calendar-plan.md` §7 resolved toward reuse). If a dedicated archetype is ever added it is package-provided and governed like any other.

```yaml
calendar_agents:
  reuse:
    - egress/intake agents (write-back via pipeline)
    - Chief of Staff (prep-pack + follow-up synthesis, routed)
  future_optional:
    - Scheduling_Coordinator: free/busy + slot proposals on the projection (P6+, governed)
```

## 3.2 Skills

```yaml
skills:
  - calendar-event-projection            # UNION sources -> normalized CalendarEvent[]
  - recurrence-expansion                 # ical.js RRULE -> concrete instances (deferred for GCal-only)
  - ics-parse-and-generate               # ical.js parse + ical-generator emit (.ics feed)
  - timezone-normalization               # to timestamptz, render user-tz (Luxon)
  - event-write-back                      # create/move/delete -> pipeline egress
  - meeting-prep-brief                    # from relationship + work graph
  - follow-up-drafting
  - availability-computation             # free/busy over projection (P6+)
  - shared-view-scoping                  # RLS visibility filter -> team/shared calendars
  - source-adapter-conformance           # validate a new source emits CalendarEvent correctly
```

## 3.3 Automations

```yaml
automations:
  - external-calendar-sync                # existing integration_sync_state cursor refresh (GCal shipped)
  - projection-refresh-on-source-change
  - meeting-prep-on-upcoming-event
  - follow-up-reminder-and-draft          # post-meeting, draft-gated
  - ritual-nextfire-overlay-refresh
  - ics-feed-regenerate
  - conflict-and-double-book-detection    # surfaces as a Signal/Incident, never auto-resolves
```

Every Automation carries trigger, idempotency key, budget, retry/backoff, owner, stop condition, risk band, immutable run record. All external writes remain human-approved (≥L2).

## 3.4 Integrations/tools

- providers: Google Calendar (shipped, local plane, `@bridge/integrations-google`); Microsoft Graph calendar + Apple/iCloud CalDAV = future adapters emitting `CalendarEvent`;
- rendering: in-house (date-fns + Bridge tokens) behind `CalendarView` port; react-big-calendar (MIT) documented swap-in;
- standards math: ical.js (MPL-2.0) recurrence + ICS parse behind `RecurrenceEngine`/`IcsCodec`; ical-generator (MIT) for `.ics` feed; Luxon (MIT) timezone;
- write path: Universal Action Pipeline egress (propose→decide), `external:send` agent-floor DENY;
- graph: reads `external_records(gcal)`, `touchpoints`, `ritual_runs`, `initiatives`; participants as Person-graph refs;
- cross-module: hands scheduling to JobPilot interviews and DealPilot meetings — one contract, one surface.

# 4. Reuse-first source map

The layer split IS the reuse decision (`calendar-plan.md` §2): adopt OSS for the two undifferentiated layers (rendering, RFC-5545 math), build the moat layer (projection, sync, governance, scheduling). Clean-room protocol applies to any license-limited source.

```yaml
reuse_policy:
  order:
    - install_or_import_existing_permissive_skill
    - wrap_existing_tool_or_repository_behind_Bridge_port
    - adapt_existing_template_or_workflow_with_attribution
    - integrate_upstream_runtime_without_copying_when_license_allows_service_use
    - build_minimal_Bridge_native_gap_only_after_documented_review
  gates:
    - pinned_commit
    - repository_and_artifact_license
    - transitive_dependencies
    - security_and_prompt_injection
    - provenance_and_signature
    - contract_and_eval_conformance
```

```yaml
sources:
  in-house-render:
    use: month/week/day/agenda grid (v1 SHIPPED, date-fns + Bridge tokens)
    mode: own code behind CalendarView port; no new dependency
  react-big-calendar:
    use: rendering engine drop-in if the in-house ceiling is hit; resource-lane view for CAL4 (code-verified 2026-07-13 — lanes REAL via resources prop, luxonLocalizer exists, React 19 OK, v1.20.0)
    mode: MIT adopt-behind-port. CAL4 constraint (code-verified): lanes are NOT piecemeal-importable (TimeGrid/DayColumn internal, unexported) — adoption = a FULL <Calendar> instance behind the CalendarView port for the lane surface, in-house grid elsewhere
    link: https://github.com/jquense/react-big-calendar
  ical.js:
    use: RRULE recurrence expansion + ICS/vCard parse (ONE lib covers both). Code-verified 2026-07-13: EXDATE format-mismatch edge + RECURRENCE-ID/RANGE=THISANDFUTURE handled in-lib (recur_expansion.js/event.js); HIGH confidence for the CAL5 eval suite
    mode: MPL-2.0 dependency behind RecurrenceEngine/IcsCodec; DEFERRED for GCal-only (Google expands server-side singleEvents:true); re-add for ICS-import/multi-source. Two wrapper duties CONFIRMED — no tzdb ships (manual TimezoneService registry; register inbound VTIMEZONE, delegate render math to Luxon) and the parser is STRICT (throws ParserError — IcsCodec try/catch per feed for the hostile-ICS gate)
    link: https://github.com/kewisch/ical.js
  ical-generator:
    use: emit a subscribable Bridge .ics feed (code-verified 2026-07-13: repeating()/exclude/recurrenceId API clean, zero runtime deps)
    mode: MIT dependency (future). Pin a STABLE 11.x (repo HEAD tracks develop); does NOT generate VTIMEZONE — wire the vtimezoneGenerator hook (shared tz-data seam with ical.js: one IcsCodec concern, budget in the CAL5 DST eval work)
    link: https://github.com/sebbo2002/ical-generator
  luxon:
    use: timezone-correct rendering; bind the view localizer
    mode: MIT dependency (future/multi-tz)
  evaluate_only:
    - name: rrule.js (BSD) — de-facto but stale (2022); prefer ical.js; consider rrule-es only for NL-RRULE
    - name: Schedule-X (verified 2026-07-13 — ALL published packages MIT v4.6.1, premium lane plugins off-tree; @schedule-x/ical already wraps ical.js) / FullCalendar standard (MIT) — alternatives behind the same port; premium plugins off-limits (cost); lanes hit the same paid wall as FullCalendar
    - name: CalendarCN / CalendarKit (shadcn-native, free) — headless-future spike candidates, maturity unproven
  rejected_systems:
    - Cal.com (AGPLv3): banned embed + second source-of-truth; cal.diy fork VERIFIED MIT 2026-07-13 (root LICENSE = MIT © Cal.com Inc, /ee subtree removed not relicensed) — license-drift suspicion RESOLVED at root; before any P6+ code contact still do a full-tree license sweep at the pinned commit + transitive-dep gate (young fast-moving fork)
    - Radicale / Baikal (GPL-3.0): CalDAV servers — copyleft + makes Bridge a calendar host with its own ACL/storage
    - Nextcloud (AGPLv3): copyleft, heavyweight, second source-of-truth
    - FullCalendar / Schedule-X premium: commercial key — cost + gating fights deep customization
```

# 5. Data and capability model

The `CalendarEvent` contract is the whole data model — a typed output_contract like every Tool boundary.

```yaml
CalendarEvent:
  id: string                 # stable per source instance
  source: enum               # gcal | touchpoint | ritual_run | initiative | conference | ics_feed
  source_record_id: string
  title: string
  start: timestamptz
  end: timestamptz | null
  all_day: boolean
  recurrence: { rrule: string | null, expanded_from: string | null }
  location: string | null
  participants: person_ref[]   # mirror-plane refs, whitelisted cross-plane edge only
  plane: enum                  # local | cloud (drives gate behavior on write)
  visibility: enum             # private | team | workspace (RLS-scoped)
  editable: boolean
  governance: { write_action: string | null, requires_approval_level: L0..L3 }
  color_key: string            # source-derived; UI maps to design token
```

Invariants:

- external calendars stay source-of-truth; Bridge reads via `integrations` + `integration_sync_state` + `external_records`, writes back as egress;
- all times normalized to `timestamptz` in the projection, rendered in user tz — never mix source timezones in memory;
- recurrence is expanded by ical.js in the projection before the renderer sees it — the renderer is dumb;
- team/shared = RLS visibility filter, not a new ACL; participant refs cross planes only on the whitelisted edge;
- every external write is a pipeline proposal with an approval level and an immutable record; credentials via CredentialBroker only;
- adding a source never changes the surface — a new adapter emits `CalendarEvent`.

# 6. Delivery sequence

Universal exit gate (applies to every slice, in addition to its own criteria): source/license record, manifest risk, tests, held-out eval (esp. recurrence/DST against EXDATE/RECURRENCE-ID), browser evidence for changed surfaces, provenance/citation audit, security scan, cost/latency baseline, and no dummy runtime data.

```yaml
slices:
  CAL0:
    status: DONE (P0)
    scope: CalendarEvent contract + read-time projection (gcal external_records + touchpoint times); CalendarView/RecurrenceEngine/IcsCodec ports
  CAL1:
    status: DONE (P1)
    scope: in-house read-only surface at /calendar (month/week/day/agenda), source-colored, pinnable Tool
  CAL2:
    status: DONE (P2)
    scope: governed write-back (create/update/delete -> proposeSend -> approve -> EgressExecutor -> Google), idempotent + audited (5/5 integration tests)
  CAL3:
    goal: one surface shows everything time-bearing — the projection thesis proven
    depends_on: [CAL2, ritual engine (shipped), Initiatives P1]
    deliverables:
      - ritual_runs next-fire projection adapter + initiative timeline-span adapter (both read-only sources)
      - toggleable source layers, per-user persisted show/hide + color prefs
      - conflict/double-book detector emitting Signals (never auto-resolves)
    exit_criteria:
      - gcal + touchpoints + ritual next-fires + initiative spans all render on ONE surface from real data (or honest empty state per layer)
      - seeded overlap produces a conflict Signal with both events linked; no automatic mutation occurs (negative test)
      - layer preferences persist across sessions; each adapter passes source-adapter-conformance (emits valid CalendarEvent, nothing else changed)
  CAL4:
    goal: team time without a new ACL system — RLS filters prove out as "shared calendars"
    depends_on: [CAL3, SEC-5 RLS-as-code + SEC-6 membership checks (Batch 3 — hard prerequisite)]
    deliverables:
      - visibility-scoped saved filters as shared calendars (visibility >= team AND team_id)
      - resource-lane view — timeboxed spike: react-big-calendar free columns vs custom lanes; decision recorded as ADR
      - meeting prep packs assembled from relationship + linked Initiative/Deal/Application graph (draft artifacts)
    exit_criteria:
      - two-user RLS test at the DB level: team member sees team events, non-member sees none, private events never leak (tested as policy, not just UI filtering)
      - a shared calendar is provably just a filter — zero new permission tables in the migration diff
      - prep pack renders from real graph data for a real upcoming meeting
  CAL5:
    goal: source count grows without touching the surface — the adapter contract proven on hostile inputs
    depends_on: [CAL3]
    deliverables:
      - ical.js (MPL-2.0) re-added behind RecurrenceEngine/IcsCodec; recurrence expanded in projection, renderer stays dumb
      - ICS-subscribe + Luma/Eventbrite adapters emitting CalendarEvent; ical-generator (MIT) outbound .ics feed
      - Microsoft Graph calendar + Apple/iCloud CalDAV provider adapters (read + governed write-back, same egress path as GCal)
      - Luxon (MIT) bound for multi-tz rendering
    exit_criteria:
      - recurrence/DST eval suite green: RRULE + EXDATE + RECURRENCE-ID + DST-boundary + all-day-across-tz cases (the #1 calendar bug factory, gated not hoped)
      - a real external ICS feed imports read-only end-to-end; malformed/hostile ICS degrades gracefully (fuzz set)
      - MS Graph create/edit/delete round-trips through propose -> approve -> egress exactly like GCal (no second write path)
      - adding each adapter changes zero renderer code (diff audit)
  CAL6:
    goal: scheduling ON the projection, governed — not a Calendly clone bolted on
    depends_on: [CAL5 (multi-source free/busy needs all sources projected)]
    deliverables:
      - availability-computation skill: free/busy + slot-finding over the full projection (all sources, user tz-correct)
      - slot proposals as drafts (Scheduling_Coordinator archetype if added — package-provided, governed)
      - scheduling links draft-gated; public availability page deferred behind its own approval; cal.diy (MIT fork) license re-verified BEFORE any code contact
    exit_criteria:
      - slot-finder correctness eval vs known busy/free fixtures incl. cross-tz + recurrence-generated busy blocks
      - no public-facing page or link ships without an explicit approval record; every booked slot becomes a governed event write (>= L2)
      - free/busy never leaks event details to counterparties (title/participants stripped — contract test)
```

## 6.1 Success measures

```yaml
metrics:
  projection: p95 projection build latency; sync lag (source change -> surface); per-adapter conformance pass rate
  correctness: recurrence/DST eval suite pass (must stay 100%); escaped calendar-math bugs (target 0 — each one becomes a permanent eval case)
  governance: write-back approval turnaround; unapproved external writes == 0 (hard invariant, monitored)
  adoption: overlay layers actively enabled; prep packs opened before meetings; conflicts surfaced -> acted on
  team: shared-view usage without any RLS incident (leak count must be 0)
```

## 6.2 Risk register

```yaml
risks:
  recurrence_dst_math:
    risk: hand-rolled or half-adopted RRULE/DST logic ships subtle wrong-time bugs (the classic calendar failure)
    mitigation: ical.js only, expansion in projection layer only, permanent eval suite gating every CAL5+ change
  rls_leak:
    risk: team calendar shows a private event — trust-destroying, silent
    mitigation: CAL4 hard-blocked on SEC-5/SEC-6; policy-level tests (not UI tests); leak count is a monitored invariant
  second_source_of_truth_creep:
    risk: convenience features (offline edits, Bridge-only events with no source) quietly turn the projection into a store
    mitigation: every event has a source; Bridge-native time-bearing objects are touchpoints/rituals/initiatives, never a raw "calendar event" row; review at each slice exit
  provider_quota_and_drift:
    risk: GCal/MS-Graph quota exhaustion or API changes break sync silently
    mitigation: integration_sync_state health surfaced; contract tests per provider; sync failures emit Signals
  render_ceiling:
    risk: in-house grid hits a wall at resource lanes / drag-drop density
    mitigation: CalendarView port keeps react-big-calendar (MIT) a documented swap; CAL4 spike decides early, recorded as ADR
  scheduling_scope_creep:
    risk: CAL6 drifts toward rebuilding Cal.com (booking pages, routing forms, workflows)
    mitigation: scheduling stays a projection query + draft proposals; anything public-facing needs its own approval; cal.diy evaluated but never embedded before license verification
```

Sequencing note: CAL0–CAL2 are shipped (Google Calendar). CAL3–CAL6 are the P3–P6 future work from `calendar-plan.md`; per that plan Calendar sequences after the local-gate slice and Initiatives P1. This module plan expresses the build in the module template but does not reorder the H2 sequencer; any scheduling pull-forward or a `status` flip on the existing calendar-plan goes through `docs/APPROVALS.md`. Cross-roadmap: CAL4 is hard-blocked on Batch-3 SEC-5/SEC-6; JobPilot JP6 and DealPilot meeting flows consume CAL3+; prep/follow-up drafting reuses the Communications skill (ADR-046), not a new agent.
