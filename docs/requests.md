# Requests Ledger

All explicit product and engineering requirements from Vikas, recorded verbatim or close-paraphrase with date and status.

---

## Open

| # | Date | Request | Status | Notes |
|---|------|---------|--------|-------|
| R-001 | 2026-07-07 | Offline capability — desktop app must work without internet; data stays local | **Open** | API runs in-memory mode without DATABASE_URL (local Postgres = full offline persistence). Missing: Tauri sidecar so API auto-starts with the desktop app (no manual server-juggling). Floating overlay state machine also needed per this request. |
| R-002 | 2026-07-07 | Floating desktop companion overlay — avatar/egg must be an OS-level floating window, NOT embedded inside the main app window | **Open** | Currently wrong: AvatarOverlay is a React div inside apps/web's DOM. Need a second Tauri window (always-on-top, borderless, small) with the Invoko-spec state machine: collapsed→hover→invoking→expanded_idle→working→result_ready→dismissing. |
| R-003 | 2026-07-07 | DealPilot, JobPilot, Helpdesk must be real add-on packages — not hardcoded into routes/shell | **In Progress** | Hardcoding confirmed as BUGS.md entry. Converting to capability packages now. |
| R-004 | 2026-07-07 | Commons — start ground work; can begin as local server, migrate to cloud later | **Open** | Agreed: start Commons as a local Fastify service (`platform/services/commons/`) with same API surface as future cloud. Sequence: fix package-gating (R-003) first so Commons has real data to sync. |
| R-005 | 2026-07-07 | dummy.md — track any unavoidable dummy data; state reason + real replacement before creating | **Done** | docs/dummy.md created with protocol. Currently empty (real-data policy holds). |
| R-006 | 2026-07-07 | requests.md — record all user requirements here | **Done** | This file. |
| R-007 | 2026-07-07 | Intelligence tab: add Packages toggle before Tools | **Done** | Committed in 4e68d85. Wired to real packages.list tRPC procedure. |
| R-008 | 2026-07-07 | Egg version: minimal, bare-bone, not bulky | **Partial** | Onboarding is 2-question minimal. Bulk concern is likely overlay being page-embedded not floating (R-002). Revisit after R-002 lands. |
| R-009 | 2026-07-07 | Standard page shell for all pages except Home/Settings: centered toggle → Lists → toolbar (view dropdown/search/filter/3-dot) → filter chips (if selected) → dashboard (analytics row) → content (table/kanban/card per view) | **In Progress** | Root cause found: apps/web pages were migrated as bare tRPC-plumbing stubs — the prototype's real UI (StandardToolbar/ListBar/Header/KanbanBoard/etc.) was never ported. Shell components + DealPilotPage done and verified live. Remaining: JobPilot, Helpdesk, KnowledgeBase, Signals, Approvals, Intelligence, Calendar, Rituals, Workspace, ChiefOfStaff. |

---

## Resolved

*(entries move here once fully shipped and verified)*

---

*This file is maintained by the assistant. Every explicit requirement goes here before work starts. Status: Open → In Progress → Done → Resolved.*
