# Calendar (wiki)

full: [../raw/calendar-plan.md](../raw/calendar-plan.md)

**STATUS (2026-06-24): P0–P2 BUILT for Google Calendar** — list + create/modify/delete, governed round-trip. Backend `@bridge/integrations-google` (5/5 calendar tests, suite 9/9). Frontend = pinnable native `/calendar` Tool. P3–P6 (rituals/initiatives overlay · team/shared · conference adapters · scheduling) = future.

**Call:** Calendar = time-axis PROJECTION over Unified Graph, packaged as pinnable **Tool**. NOT a calendar product/server. Build thin surface Bridge owns. Adopt OSS only for rendering + RFC-5545 math.

## Why not buy whole calendar
- Every calendar SYSTEM = copyleft → banned embed. Cal.com AGPLv3 · Radicale/Baïkal GPL-3.0 · Nextcloud AGPLv3.
- Whole product = SECOND source-of-truth → fights graph + pipeline + RLS Bridge already owns.
- Arch already says so: List/Board/Table/**Calendar**/MindMap = projections over ONE Touchpoint tree.

## 3 layers, 3 owners
1. **Render** (month/week/day/agenda grid, drag, resize, lanes) → ADOPT OSS behind `CalendarView` port. No moat.
2. **Standards math** (RRULE recurrence, DST/tz, ICS parse+gen) → ADOPT small libs behind `RecurrenceEngine`/`IcsCodec`. NEVER hand-roll recurrence — #1 bug factory.
3. **System-of-record + governance** (projection, sync, write-back, team scope, scheduling) → BUILD on existing platform. THE moat.

## Library picks (permissive, verified 2026-06-24)
- **Render = IN-HOUSE** (date-fns + Bridge tokens), v1 SHIPPED — user wanted max-modifiable + design-native + no new dep. **react-big-calendar** (MIT) = documented swap-in behind the view boundary (ADR in [decisions](decisions.md) / decisions-log). Reject pay: FullCalendar/Schedule-X premium lane views.
- **ical.js** (MPL-2.0) = recurrence expand + ICS parse — **DEFERRED**: Google expands recurring events server-side (`singleEvents:true`), so not needed for GCal-only scope. (Re-add for ICS-import / multi-source.)
- **ical-generator** (MIT, .ics feed) + **Luxon** (tz) = future (feed + multi-source).

## How it plugs in (zero new subsystem)
- **Projection** = read-time UNION → normalized `CalendarEvent` contract. Sources: GCal `external_records` (local plane, ALREADY synced) · Touchpoints w/ times · ritual_runs next-fire · Initiative timelines · FUTURE conference/ICS adapters.
- **Sync** = reuse existing `integrations`+`integration_sync_state`+`external_records` (GCal shipped 2026-06-20). External stays source-of-truth.
- **Write-back** = create/move → Pipeline egress → `external:send` agent-floor DENY → human approve ≥L2. Gate already enforces.
- **Team/shared cal** = RLS visibility filter (private|team|workspace), NOT new ACL. `visibility>=team AND team_id=:t` over projection.
- **New source** = new integration adapter emitting `CalendarEvent`. Surface NEVER changes. = future-proof.
- **Scheduling** (Calendly-like) = build on projection later (P6+). Cal.com AGPL banned; revisit cal.diy (MIT) — verify license first.

## Tool manifest
id `calendar` · native · pinnable + `/calendar` · reads gcal/touchpoints/ritual_runs/initiatives · output_contract `CalendarEvent` · write via pipeline · ports `CalendarView`/`RecurrenceEngine`/`IcsCodec`.

## Phases
P0 contract+projection (no UI) → P1 read-only surface (react-big-calendar) → P2 governed write-back + .ics feed → P3 rituals/initiatives overlay → P4 team/shared (RLS + lanes) → P5 conference adapters → P6+ scheduling (defer). Sequences after local-gate slice + Initiatives P1.

## Risks
render lib ceiling → headless via port · recurrence/DST → ical.js never hand-roll · cal.diy license drift → defer+verify · mixed tz → normalize to timestamptz, render user-tz.
