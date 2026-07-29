# Research Agent — bounded multi-step background Runs

full: [../raw/autonomous-browser-research-agent-plan-2026-07.md](../raw/autonomous-browser-research-agent-plan-2026-07.md) · 2026-07-29. Related: [desktop-companion](desktop-companion.md), [foundational-agents](foundational-agents.md).

Agent takes an objective, plans steps, searches, reads pages, comes back with a cited brief. Background. Inspectable. Bounded.

**Engine**: `platform/packages/research` (`@bridge/research`). Port-driven — search, page reading, element location, actuation, planner, ledger are ALL injected. Nothing in the package opens a socket. 31 tests, no network/browser/model.

**Authority (the load-bearing part)** — decided by the ENGINE from tool + target, never by the planner, so a planner cannot self-grant by rephrasing:
- **green, autonomous**: search · read · find · note.
- **amber, Proposal required** (AP-088): click · type. Run parks until a Decision. No approval channel = no action.
- **red, refused, never proposed**: credentials · payment · purchases · publishing/sending · any action on a login/checkout/security page. Asking a user to approve a password entry would normalise the thing that must stay impossible.

**Bounds**: steps · pages · wall clock · total bytes. EVERY exit path records a `StopReason` (`planner_finished`, `bound_*`, `cancelled`, `refused_red_action`, `injection_detected`, `planner_failed`). No path just stops looping.

**Injection defense** (learning-agent-roadmap §3.3): structural first — external text is quarantined at the boundary (`untrusted_external`) and reaches the planner only as labelled observations, never concatenated into an instruction channel. `fenceUntrusted` neutralises fence markers so a payload cannot close its own fence. The pattern detector is a tripwire ON TOP, not the defense; a page carrying instructions aimed at the agent is REPORTED and its text never becomes usable evidence.

**Page reading (BR1)**: HTTP + HTML→text, no bundled browser engine (AP-089 — a bundled Chromium costs ~150-200 MB on a ~349 MB bundle, owns every upstream CVE, and grows the signing surface already blocking TASK-018). Static and server-rendered pages work; JS-rendered pages come back thin and honestly so. An unclosed `<script>` swallows the rest of the document — script bodies are a natural hiding place for instructions aimed at the agent.

**Webview reader + locator (BR1 escalation, BR2)**: `research_webview.rs` in the desktop shell. JS-rendered pages load in a REAL webview; injected script ships settled visible text out through a cancelled `bridge-extract:` navigation (outbound-only channel). Containment: window label absent from capabilities (zero Tauri permissions), external origin gets no IPC injection at all, `on_navigation` allows http(s) only, own init script (never the sidecar token's). Window is VISIBLE, always-on-bottom, never focused — no silent browsing, same principle as the blink-tell. `research_locate` screenshots THE WINDOW's own image (`screencapture -l` — overlapping windows never leak into the frame) and reuses TASK-027's drawn-grid pipeline to resolve a description to a viewport rectangle. Commands: `research_read_page` / `research_locate` / `research_close`.

**Restart (BR4)**: prior steps replay from the ledger as history/evidence, never re-executed — a resumed Run never re-clicks and never wins back a spent step, page, or byte budget.

**Reuses**: TASK-023 keyless cited SearchProvider · TASK-007 Agent/Skill/child-Run · TASK-026 Proposal→Decision→Run→Result · TASK-027 Set-of-Mark locator (for BR2 element finding).

**Open**: live wiring (API procedure, Run detail Page, "Research this" entry point in the companion panel) is not built yet; the engine and the desktop reader/locator commands exist but are not yet reachable from the UI. Live validation pending for the webview reader (a JS-rendered page returns real text; `-l` capture of an always-on-bottom window; locate accuracy on a real page).
