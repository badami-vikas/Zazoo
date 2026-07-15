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

## Zazoo character (2026-07-15)

Companion now have face: **Zazoo** — plush cat, round spectacles, sweater vest, CoS persona. User
spec verbatim: `docs/raw/requirement-zazoo-avatar-spec-2026-07-15.md`. Plan:
`docs/raw/zazoo-companion-avatar-roadmap-2026-07.md`.

- **2D procedural SVG rig, NOT 3D** (ADR-086). All spec behavior = params on layered rig. 3D plush
  without artist = cheap rubber look + ~600KB runtime + GPU burn in always-on overlay. Director
  contract renderer-agnostic → 3D swappable later, zero upstream cost.
- Engine live: `platform/apps/web/src/app/avatar/zazoo/` — director.ts (11 emotions, spring blend,
  warmth/confidence/energy axes, blink/saccade/breath/ear-twitch, gestures, pet, cursor gaze) +
  ZazooAvatar.tsx (ref-mutated SVG, no per-frame React render) + lab at `/zazoo.html`.
- Agent plane drive it via `perform({emotion, warmth, confidence, energy, attention, intent,
  duration})` — same JSON contract as user spec.
- Next: v1 = default in AvatarOverlay + status→emotion map + capture-blink tell + Tauri drag/pet
  (rides EG0). v2 = pipeline events→perform, long-idle scenes, hatch→Zazoo, persona axes. v3 =
  voice sync, Commons character packages.
- Platform rename Bridge→Zazoo = separate canon question → AP-020 PROPOSED.

### v0.5 crew redesign (same day, user feedback + reference image)
Rig realigned to "Zazoo crew" felt style: young proportions, huge glossy eyes, tiny nose,
thread-line mouth, suit+white-collar+accessory, nub hands, NO legs (legs only when moving, Z3),
oval tail. New: emotion-driven cheeks (opacity+puff+COLOR temperature), 3-channel brows
(raise/sorrow/furrow), whiskers float in air, listening ears ENLARGE (1.28 mild exaggeration),
per-emotion breathing frequency+depth. Poses: meditating / sneaking / hiding (→ miniature grey
egg). Notch = Zazoo's home: hover → head peeks out (demo live in lab). Petting → giggle, purr
REMOVED (Zazoo speaks, Pixar-style — Z4 voice). Wardrobe live: 6 cat colors · 5 suits ·
tie/bowtie/scarf. Pixar principles implemented (anticipation crouch, squash-stretch hop, shadow
weight cue, follow-through whiskers/specs). Roadmap now detailed Z1–Z7 (notch overlay → status
wiring → locomotion → voice → wardrobe persistence → CREW of major animals on one skeleton →
long-idle life + memory) with exit criteria per slice. Feedback verbatim:
`docs/raw/requirement-zazoo-avatar-feedback-2026-07-15.md`.
