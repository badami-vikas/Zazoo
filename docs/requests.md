# Requests Ledger

All explicit product and engineering requirements from Vikas, recorded verbatim or close-paraphrase with date and status.

---

## Open

| # | Date | Request | Status | Notes |
|---|------|---------|--------|-------|
| R-001 | 2026-07-07 | Offline capability — desktop app must work without internet; data stays local | **Open** | API runs in-memory mode without DATABASE_URL (local Postgres = full offline persistence). Missing: Tauri sidecar so API auto-starts with the desktop app (no manual server-juggling). Floating overlay state machine also needed per this request. |
| R-002 | 2026-07-07 | Floating desktop companion overlay — avatar/egg must be an OS-level floating window, NOT embedded inside the main app window | **Open** | Currently wrong: AvatarOverlay is a React div inside apps/web's DOM. Need a second Tauri window (always-on-top, borderless, small) with the Invoko-spec state machine: collapsed→hover→invoking→expanded_idle→working→result_ready→dismissing. |
| R-003 | 2026-07-07 | DealPilot, JobPilot, Helpdesk must be real add-on packages — not hardcoded into routes/shell | **Done** | Built-in packages seeded on API boot (built-in-packages.ts); Intelligence → Tools derives from packages.list state (commit 9a30e8c). Route-level gating still coarse (routes registered statically). |
| R-004 | 2026-07-07 | Commons — start ground work; can begin as local server, migrate to cloud later | **Open** | Agreed: start Commons as a local Fastify service (`platform/services/commons/`) with same API surface as future cloud. Sequence: fix package-gating (R-003) first so Commons has real data to sync. |
| R-005 | 2026-07-07 | dummy.md — track any unavoidable dummy data; state reason + real replacement before creating | **Done** | docs/dummy.md created with protocol. Currently empty (real-data policy holds). |
| R-006 | 2026-07-07 | requests.md — record all user requirements here | **Done** | This file. |
| R-007 | 2026-07-07 | Intelligence tab: add Packages toggle before Tools | **Done** | Committed in 4e68d85. Wired to real packages.list tRPC procedure. |
| R-008 | 2026-07-07 | Egg version: minimal, bare-bone, not bulky | **Partial** | Onboarding is 2-question minimal. Bulk concern is likely overlay being page-embedded not floating (R-002). Revisit after R-002 lands. |
| R-009 | 2026-07-07 | Standard page shell for all pages except Home/Settings: centered toggle → Lists → toolbar (view dropdown/search/filter/3-dot) → filter chips (if selected) → dashboard (analytics row) → content (table/kanban/card per view). Signals screenshot = canonical reference. No separate tool-name row — the toggle IS the identity element. | **In Progress** | DealPilot + Signals done, verified live. REVISED by R-011/R-012/R-013 (list dropdown, collapsible dashboard section, single-tab = plain title). Full rollout resumes AFTER R-010 faithful port. |
| R-010 | 2026-07-07 | Faithful port of the ENTIRE prototype (bridge-ai-1ay.pages.dev = "Design Bridge AI Interface (Copy)") into apps/web FIRST — HomePage and every missing page/surface — before further shell restyling | **Done** | Merged 2026-07-07 (agent commit 9c3feba): 22 pages incl. HomePage (now index), WorkPage, ItemDetail, DataEngine network view; 15 new routes; deps added (motion, glide-data-grid, leaflet, tesseract.js, supabase-js, …). Kept real-data pages + shared shell. Ported fixture data logged in dummy.md — removal condition: shell-v2 real-endpoint wiring. Skipped (shell owned by real Layout): prototype Sidebar/AgentPanel/Header/AuthGate/standalone routes. Verified: typecheck+build clean, HomePage + /work confirmed live. |
| R-011 | 2026-07-07 | Lists becomes a DROPDOWN in the toolbar row (not a pill row): first item = currently-open list, up to 5 visible then scrollable, "Add list" always pinned as the 6th omnipresent slot | **In Progress** | Shell-v2 subagent launched 2026-07-07. |
| R-012 | 2026-07-07 | Filter chips + dashboard analytics form ONE collapsible section — expand/collapse arrow next to the 3-dots, expanded by default | **In Progress** | Shell-v2 subagent launched 2026-07-07. |
| R-013 | 2026-07-07 | Single-section pages: no toggle chrome — just the name, Title case, centered in header | **Done** | shared/Header renders a plain centered title when tabs.length === 1. |
| R-014 | 2026-07-07 | AI chat panel identity = the avatar, not a Bridge monogram: header icon (done earlier today) AND the collapsed rail must show the avatar | **Done** | AvatarIcon in header (commit 0f37579) + collapsed rail now leads with AvatarIcon. |
| R-015 | 2026-07-07 | Align ALL architecture docs, plans, roadmaps with the f87dd61 primitive-ontology refinement (docs/wiki/ontology.md + raw authority-model / runtime-pipeline / capability-evolution / primitive-specifications) | **In Progress** | Docs-alignment subagent launched 2026-07-07. Code renames out of scope for this pass. |
| R-016 | 2026-07-07 | Continue primitive + platform development via subagents — FIRST preference: offline desktop app (R-001 sidecar + R-002 floating overlay) and Commons (R-004) | **In Progress** | Desktop + Commons subagents launched 2026-07-07 in parallel with shell-v2 + docs alignment. |
| R-017 | 2026-07-07 | Settings = PLATFORM-wide admin only. Rename Workspace → Organization. Settings nav = Organization / Team & Permissions / Knowledge / Intelligence / Governance / Notifications / Billing & Plan / Security / API Keys / Help & Support. Knowledge answers "what does the platform know?", Intelligence answers "what can it do with what it knows?" | **In Progress** | Settings/nav refactor subagent launched 2026-07-07. |
| R-018 | 2026-07-07 | Initiative Control Panel: per-Initiative admin ONLY (never cross-Initiative). ⚙ icon ALWAYS between Filters and the 3-dot menu in the header/toolbar. Opens a unified resource table (Category / Name / Status / Source Module / Version / Scope / Actions) — single admin surface, no scattered config screens | **In Progress** | Icon slot = shell-v2 agent (StandardToolbar); panel surface = settings/nav agent. |
| R-019 | 2026-07-07 | Apple-like product architecture: nav = Home + Initiatives as first-class items + "+ New" (always below initiatives, above Settings) + Settings. NO intermediate Initiatives page. Four concepts only: Initiative / Module / Knowledge / Intelligence. Marketplace lives in COMMONS (website), not the web app. "+ New" → installed-Module picker → Chief of Staff analyzes overlap → recommendation (new / extend / merge / reject) with reasoning, user can override. CoS continuously optimizes environment (reduce duplication, maximize reuse) | **In Progress** | Nav + picker v1 in settings/nav subagent; CoS decision engine = follow-up kernel work (recommendation must be real analysis, not fabricated). |
| R-020 | 2026-07-07 | NO deprecated terminology or legacy primitives anywhere user-facing — labels, placeholders, help text, empty states, navigation. Ontology vocab only (Initiative/Module/Knowledge/Intelligence/Assistant/Skill/Automation/Workflow). Progressive disclosure; users never see internal architecture unless in configuration mode | **Open** | Full UI vocab sweep runs AFTER shell-v2 merge (same files — sequenced to avoid conflicts). |

---

## Resolved

*(entries move here once fully shipped and verified)*

---

*This file is maintained by the assistant. Every explicit requirement goes here before work starts. Status: Open → In Progress → Done → Resolved.*
