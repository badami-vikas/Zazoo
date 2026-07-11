# Desktop Companion Agent — annotate + help

full: [../raw/desktop-companion-agent-roadmap-2026-07.md](../raw/desktop-companion-agent-roadmap-2026-07.md) · 2026-07-08. Related: [clients](clients.md), [foundational-agents](foundational-agents.md).

Floating always-on-top avatar that annotates the screen + helps in-context.

**Current state (2026-07-10)**: `overlay.rs` now creates ONE overlay window PER CONNECTED MONITOR
(labels `overlay`, `overlay-1`, …), each 96×96 transparent always-on-top anchored bottom-right of its
own screen; `overlay_resize`/`overlay_hide` take the CALLING window as a Tauri-injected param (works
correctly per-instance without knowing which monitor). Frontend (`OverlayApp.tsx`) gained a hover chat
bubble → compact inline chat (real `chiefOfStaff.converse` round-trip, verified live against a running
API) and a right-click menu (Hide / Meditate / Observe — Observe triggers
`capture_screenshot_on_demand`). CSP fixed (SEC-4 — was `csp: null`, now a real policy scoped to
`'self'` + the sidecar's dynamic local port). **OUTPUT half of annotation now exists**: a 3rd Tauri
window per monitor (`annotate.rs`), display-sized, transparent, **click-through**
(`set_ignore_cursor_events(true)` from creation), rendering a constrained typed mark vocab
(highlight/arrow/callout/spotlight) via SVG in `AnnotateApp.tsx`. Marks are a Rust enum
(`AnnotationMark`/`MarkKind`), validated in Rust (finite geometry, positive size, ≤12 marks, ≤120-char
labels) BEFORE `annotate_show` emits them — the frontend only ever receives this typed shape over a
Tauri event, never HTML/model-text (extends the un-spoofable rule; this is why CSP had to land first).
Build-verified (cargo check/clippy/test all green) + visually verified in a browser preview with
synthetic marks (real Tauri GUI/multi-monitor behavior still build-verified-not-GUI-verified, same
honesty caveat as the pre-existing overlay window).

**INPUT half still a gap, by design**: `providers/accessibility.rs` ships ONLY
`ax_permission_status` (`AXIsProcessTrusted()` — a single safe no-argument FFI call, genuinely
verified via a real unit test). Full AX-tree walking (AXUIElementRef creation, CFArray attribute
reads, coordinate conversion) needs real CoreFoundation retain/release bookkeeping that wasn't hand-
rolled without a live macOS session + granted permission to exercise it against — the same judgment
call this codebase already made for the `screen` sensor (honest stub over a faked capture path).
`annotate_show` takes already-resolved rects, so whatever builds AX tree-walking next (or a manual
walkthrough source) can drive the existing output half unchanged. 2 sensor providers live (`apps`,
`clipboard`); `screen` = honest stub.

**Small-model-first ramp (5 tiers via ModelProvider seam)**: T0 no-model deterministic (geometry/rules
— WHERE IT STARTS) · T1 small local text SLM (Ollama ~1-3B) · T2 on-device VLM (Moondream2 ~1.9B /
SmolVLM ~2B, laptop-runnable) · T3 hosted Groq (already wired, opt-in egress) · T4 Claude frontier
(draft-then-approve, External=human). Each capability ships at the LOWEST tier that clears its bar;
T0-T2 = local privacy default.

**Day-1 capabilities**: blink tell · click→Memory · live status · approvals nudge · "what am I looking
at" one-liner · quick-action launcher · AX-only element-pointer annotation. **Future**: proactive
coaching · walkthroughs · form-fill · visual QA · ambient suggestions · cross-app workflow synthesis ·
voice. (Each carries a one-line actualization brief + required tier + trust band in the raw doc.)

**Roadmap P0-P6**: **P0 DONE (2026-07-10)** — event-driven status + CSP fixed. **P1 PARTIAL
(2026-07-10)** — annotation WINDOW done (multi-monitor overlay + click-through annotate window + typed
mark rendering); AX-tree lookup (the piece that resolves "the Send button" → a rect) still open, only
the permission check shipped. P2 Tier-1 local help · P3 real `screen` + on-device VLM · P4
voice/walkthroughs · P5 proactive/ambient · P6 workflow synthesis + form-fill. Risks: multi-monitor/DPI
coord accuracy (build-verified, not GUI-verified against real hardware) · click-through correctness
(same caveat) · VLM footprint · AXUIElement retain/release safety (why tree-walking waited).
