# Calendar

full grammar: [DataEngine / View Grammar BRD](../raw/brd-dataengine-views-2026-07.md) · history: [old Tool plan](../raw/calendar-plan.md) · [old Module plan](../raw/calendar-module-plan-2026-07.md) · ADR-108.

**NOW (2026-07-19): Calendar = View.**

- One canonical kind: `calendar`.
- Eligible when Database has Date column.
- One renderer: `dataviews/views/CalendarView.tsx`.
- Same Page rows as Table/Form/Board. No second store.
- No `/calendar` route. No Module. No Tool. No nav item. No package gate.
- Google Calendar = Integration. Syncs rows. Does not own UI.
- Form-created and Integration-synced rows render same.
- Creation controls appear only when Page has real governed insert.
- Honest empty state when no dated rows.

**Old plans superseded:** their projection/governance lessons survive. Their dedicated Calendar Tool/Module/nav identity does not.

**Writes:** ordinary Page write or governed external egress. External Calendar write stays Human-approved.

**Future:** recurrence/ICS/team scheduling only when a consuming Database/Integration needs it. Never rebuild Calendar as product/server.
