# Desktop Companion Agent — annotate + help

full: [../raw/desktop-companion-agent-roadmap-2026-07.md](../raw/desktop-companion-agent-roadmap-2026-07.md) · 2026-07-08. Related: [clients](clients.md), [foundational-agents](foundational-agents.md).

Floating always-on-top avatar that annotates the screen + helps in-context.

**Current state vs gap**: a real 2nd Tauri window EXISTS (`overlay.rs` — 96×96 transparent
always-on-top bottom-right, `overlay_resize`/`focus_main_window`), driven by `avatar-store.ts` 7-state
machine + Rust-originated `sensor.capture`→`bridge:capture` blink tell. 2 providers live (`apps`,
`clipboard`); `screen` = honest stub, `accessibility` unbuilt. So today = faithful **status mascot
with a tell** — can't see screen, can't draw, runs no model. Needs 3 new layers: screen-understanding
input · display-spanning annotation output · a model tier connecting them.

**Annotation approach**: INPUT = build `accessibility` provider FIRST (AX-tree rects = deterministic
"point at the Send button", no vision model needed); promote `screen` to real on-demand single-frame
only where AX insufficient. OUTPUT = a NEW 3rd Tauri window (`annotate`), display-sized, transparent,
**click-through** (`set_ignore_cursor_events`), rendering a constrained typed mark vocab
(highlight/arrow/callout/spotlight). Marks = **Rust-produced, Rust-validated command list, NEVER
HTML/model-text in the webview** (extends the un-spoofable rule; **requires the `csp:null` finding
fixed first**). Rides existing Sensor SPI (raw = local-plane only, blink still fires, deny-perms
degrades to AX-only/panel text).

**Small-model-first ramp (5 tiers via ModelProvider seam)**: T0 no-model deterministic (geometry/rules
— WHERE IT STARTS) · T1 small local text SLM (Ollama ~1-3B) · T2 on-device VLM (Moondream2 ~1.9B /
SmolVLM ~2B, laptop-runnable) · T3 hosted Groq (already wired, opt-in egress) · T4 Claude frontier
(draft-then-approve, External=human). Each capability ships at the LOWEST tier that clears its bar;
T0-T2 = local privacy default.

**Day-1 capabilities**: blink tell · click→Memory · live status · approvals nudge · "what am I looking
at" one-liner · quick-action launcher · AX-only element-pointer annotation. **Future**: proactive
coaching · walkthroughs · form-fill · visual QA · ambient suggestions · cross-app workflow synthesis ·
voice. (Each carries a one-line actualization brief + required tier + trust band in the raw doc.)

**Roadmap P0-P6**: P0 event-driven status + fix CSP · P1 accessibility provider + AX-only annotation
window · P2 Tier-1 local help · P3 real `screen` + on-device VLM · P4 voice/walkthroughs · P5
proactive/ambient · P6 workflow synthesis + form-fill. Risks: multi-monitor/DPI coord accuracy ·
`csp:null` hard blocker · click-through correctness (build-verified not GUI-verified) · VLM footprint.
