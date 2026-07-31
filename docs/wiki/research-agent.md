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

**Prototype wiring (2026-07-30, user-approved prototype-first)**: companion panel Research tab (`ResearchRun.tsx`) runs the engine in the overlay webview — search → governed `skill.webResearch`, read/find → shell commands, planner → `createChatPlanner` over text-only `research_chat` (key stays in Rust). Green tools only: no actuator/proposal channel wired, engine blocks amber honestly. LIVE-VALIDATED 2026-07-30: 8-step Run, real page reads in the contained reader, cited brief, honest bound stop (six live defects fixed — see log 2026-07-30).

**Kernel Runs (2026-07-31, ADR-156)**: the Run is a durable owner-scoped kernel record (migration `0035`: `research_runs` + append-only `research_run_steps`, chat-style FORCE RLS, terminal rows frozen by trigger). `agentOrchestration.research.*`: start · recordStep (each step = a TERMINAL child Agent Run under one parent envelope — inspectable via `childRun.listByParentRun`) · requestStop (cooperative cross-surface interrupt the executor polls) · complete (exactly once, CAS) · get/list/steps. Engine's ledger port points at the kernel → BR4 resume replays durable evidence across app restarts; interrupted Runs offered for resume in the panel. `/research` Page: step timeline (tool, trusted summary, source, untrusted-external marker, child-Run id), brief, citations, Stop / mark-interrupted. Quarantined text is stored for resume but withheld from every other read.

**Open**: executor still runs in the overlay (kernel-executor bridge is the recorded follow-up); run-level brief not yet a governed Result; `research_locate` live accuracy check; live browser evidence of the `/research` Page.
