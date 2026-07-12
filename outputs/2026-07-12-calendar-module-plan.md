---
title: Session Outputs — Calendar Module Plan
date: 2026-07-12
status: complete
---

# Scope

User asked for a Calendar roadmap in the same module-plan style. This file records the user-facing
outcome.

# Delivered

- **Plan**: [docs/raw/calendar-module-plan-2026-07.md](../docs/raw/calendar-module-plan-2026-07.md) —
  DealPilot three-lens template applied to the Calendar Tool: product decision (time-axis projection,
  not a product), design lens (grid/event-detail/overlays/team-views/prep-follow-up/scheduling IA),
  business coverage/exclusions, technical lens (reuse existing agents; 10 skills; 7 automations;
  integration + port map), reuse-first source map, the CalendarEvent contract as the data model, and
  CAL0–CAL6 slices.
- **Wiki**: index line; Plan Registry line; log entry; **ADR-051**.

# Key conclusions

- Calendar is a **projection over the graph**, not a calendar product/server or second
  source-of-truth — the standing, partly-shipped decision, now expressed in module form.
- **CAL0–CAL2 are already built** for Google Calendar (contract + projection, in-house read surface,
  governed create/modify/delete write-back; `@bridge/integrations-google` 5/5 calendar tests).
  CAL3–CAL6 sequence the future work: rituals/initiatives overlay, team/shared via RLS, conference/
  ICS + Microsoft Graph/CalDAV adapters, deferred scheduling.
- **Reuse = the layer split**: adopt OSS for rendering (in-house date-fns shipped; react-big-calendar
  MIT swap-in) and RFC-5545 math (ical.js MPL; ical-generator MIT; Luxon MIT); build projection/sync/
  governance. Copyleft calendar systems (Cal.com AGPL, Radicale/Baïkal GPL, Nextcloud AGPL) banned as
  embeds; recurrence/DST never hand-rolled.
- Governance carry-throughs: external stays source-of-truth; every write is pipeline egress approved
  ≥L2; team/shared = existing RLS, not a new ACL; autonomous defrag reframed to governed proposals.
- Status `proposed`; no code change, no calendar-plan.md edit, no sequencer reorder.

# Note

The fresh commercial-landscape (Motion/Reclaim/Notion Calendar/Vimcal/Calendly) and OSS
code-diligence (react-big-calendar/Cal.com/ical.js) subagents hit the session limit (resets 8:20am
CT). The plan is complete without them because the calendar reuse verdicts were already independently
verified in `calendar-plan.md` §3 (2026-06-24); a commercial-landscape refresh can be appended later
if wanted.
