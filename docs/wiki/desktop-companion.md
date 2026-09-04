# Desktop Companion Agent — annotate + help

full: [../raw/desktop-companion-agent-roadmap-2026-07.md](../raw/desktop-companion-agent-roadmap-2026-07.md) · 2026-07-08. Related: [clients](clients.md), [foundational-agents](foundational-agents.md).

Floating always-on-top avatar that annotates the screen + helps in-context.

**Current state (2026-07-18)**:
- One 96×96 Avatar panel per connected monitor. macOS = non-activating NSPanel, all Spaces, fullscreen auxiliary.
- Position save = native `Moved` event → one debounced worker per label; save resolves current window; quit flushes. macOS persistence = tagged logical desktop coordinates. Mixed-DPI screens no longer overlap.
- Reported real 3-display pass: anchors right; Accessibility-driven move/save/relaunch right; external reposition right; extend→mirror→extend 3→2→3 right; no crash. Recovery review fixed expanded re-anchor + missing-startup retry. Direct NSPanel close was wrong; convert back first.
- Human certification complete: physical cross-display pointer drag + quit/relaunch restoration, VoiceOver activation of native close/minimize/fullscreen, and physical display detach/reconnect pass. TASK-003 done.
- Hover chat and right-click Hide/Meditate/Observe remain. CSP remains closed.

**Screen-aware ask shipped (TASK-027, 2026-07-29, clicky parity)**: ⌘⇧Space push-to-talk (Rust-registered
global shortcut) or hover ✨ opens the CompanionAsk panel. One CONSENTED screenshot per ask → Groq vision
(`GROQ_API_KEY`, model overridable) → `[POINT:x,y:label]` tags parsed in Rust → typed spotlight+callout marks
on the captured monitor only, 12 s auto-clear, animated entrance. No key or no consent → managed local Qwen
answers text-only + says it cannot see the screen. Voice = hold-to-record → Groq Whisper (typed fallback);
answers spoken by local `say`, cancellable. `screen` sensor = REAL on-demand now (`screencapture` +
CGPreflight/Request), every capture → observation + blink; overlay bridges `sensor.capture` → DOM blink.
Right-click Observe seeds "What am I looking at?" into the same job; there is no capture-only path.
Missing grant fails before capture (wallpaper-only macOS output refused); missing Groq vision key states
the setup needed. Chief of Staff text routing differs by design: local Qwen3-4B or Groq gpt-oss-20b,
versus Avatar Groq Llama-4 Scout vision.
Repair gates pass; second-owner live retry remains external confirmation. No screenshot was sent to
Groq during repair verification.

**Hands shipped (TASK-095, 2026-09-03, Hey Clicky parity)**: Do mode in the companion panel (Ask ·
Research · Do; "do/click/type/open…" typed asks route there). `act.rs` loop: consented capture →
gridded planner call (ONE JSON action: click/double/right/type/key/scroll/open_app/done/fail) →
two-stage locator refine → typed spotlight → `actuator.rs` glides the REAL pointer (CGEvent
`mouseMoved` stream, smoothstep Bézier, 0.35–1.1 s) → click/type/press/scroll → settle → look again.
Bounds 15 steps / 150 s. Gates: `allowControl` per request (panel switch, default OFF), macOS
Accessibility (fail closed + prompt), Privacy Guard every step, key allowlist (no ⌘Q/⌘W/chords),
typed text ≤500, sanitised app names, Stop button, and TAKEOVER — real cursor >28 px off the glide
path halts the run. Every step emits `bridge:act-step`; panel narrates, Zazoo speaks the `say`.
Pointer glyph is now an ARROW (`AgentPointer.tsx`, own polygon, avatar colour + white outline) that
FLIES on jumps (clicky-style arc, leans into travel, puffs mid-flight, reduced-motion → snap) and
snaps on actuator samples; click flashes a ring. Hey Clicky itself drives a per-window background
driver and never moves the real cursor — Bridge moves the real one on purpose (visible = honest).
Same day: **Show me how** (guide mode: point + narrate + wait for the user's own click,
`CGEventSourceButtonState` poll, no control consent), **Circle an area** (annotate window interactive
for one drag → red outline in the sent image + prompt note), **Dictate into my app** (Fn-held speech →
`act_type_text`, same gates), **Only act in these apps** allowlist (empty = any). Still open: background
per-window driver (refused — invisible), Skills from the panel (Chat panel in the overlay already
reaches them), always-on wake word (refused).

**Annotation output exists**: one display-sized `annotate.rs` window per monitor; click-through from
creation (`set_ignore_cursor_events(true)`). Typed highlight/arrow/callout/spotlight marks only.
Rust validates finite geometry, positive size, ≤12 marks, and ≤120-char labels before emit. Frontend
receives the typed shape over a Tauri event — no HTML/model-text injection. Build-verified and browser
previewed with synthetic marks; annotation multi-monitor GUI behavior still lacks its own hardware pass.

**INPUT half still a gap, by design**: `providers/accessibility.rs` ships ONLY
`ax_permission_status` (`AXIsProcessTrusted()` — a single safe no-argument FFI call, genuinely
verified via a real unit test). Full AX-tree walking (AXUIElementRef creation, CFArray attribute
reads, coordinate conversion) needs real CoreFoundation retain/release bookkeeping that wasn't hand-
rolled without a live macOS session + granted permission to exercise it against — the same judgment
call this codebase made for the `screen` sensor before its narrower on-demand capture path shipped.
`annotate_show` takes already-resolved rects, so whatever builds AX tree-walking next (or a manual
walkthrough source) can drive the existing output half unchanged. 2 sensor providers live (`apps`,
`clipboard`); `screen` = real on-demand only, never ambient.

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
voice/walkthroughs · P5 proactive/ambient · P6 workflow synthesis + form-fill. Risks: annotation
multi-monitor/DPI still needs its own real-hardware pass · click-through correctness · VLM footprint ·
AXUIElement retain/release safety (why tree-walking waited).

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
- **v1 LANDED for the floating overlay (2026-07-31)**: Zazoo is the collapsed companion face
  (`CompanionZazooFace`, 44px head crop, reduced-motion → static `ZazooCompact`); pure
  `statusToPerformance` maps AvatarStatus → `perform()` (no new taxonomy, nothing persisted);
  capture blink = one-shot curious lift auto-reverting via `duration`; ⌘⇧Space perks ears on
  keypress; delivered answer plays a transient happy one-shot. Drag was already live. **Pet NOT
  wired** — the collapsed button's press is ambiguous with drag (`suppressAvatarClick`); wire only
  after the drag threshold is declined. In-page `AvatarFigure` surfaces unchanged. Verified live in
  the lab (shared director drove full rig + shipped face; ears enlarged on `listening`).
  Still open for v1: hatch→Zazoo, in-page default swap. v2 = pipeline events→perform, long-idle
  scenes, persona axes. v3 = voice sync, Commons character packages.
- **Companion session memory governed (2026-07-31)**: role filter before take (injected turns can't
  shrink the window), per-path char budgets (vision 800/4,800 vs local 2,000/8,000, oldest dropped
  first), 15-min idle TTL, `screenDerived` provenance tag on turns, consent copy now discloses that
  recent turns ride along on consented asks.
- Platform rename Bridge→Zazoo = separate canon question → AP-022 PROPOSED.

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
