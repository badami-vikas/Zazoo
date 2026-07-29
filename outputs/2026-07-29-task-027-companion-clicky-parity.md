# TASK-027 — Screen-aware companion ask prototype (clicky parity) — 2026-07-29

User directive R-041: adopt the capabilities of the open-source clicky family
(farzaa/clicky and its three Windows ports) as a working macOS prototype on the existing
Bridge desktop Avatar/overlay baseline.

## Reuse intake

All four repositories are MIT-licensed. Their *behaviors* were studied from public
READMEs/architecture documentation and re-implemented natively on Bridge's existing governed
surfaces. No source code was copied, translated, or paraphrased (clicky is Swift; the ports are
C#/.NET and Python — Bridge's shell is Rust/Tauri, so reuse-by-import was not even mechanically
possible).

## Capability mapping

| clicky-family capability | Source | Bridge implementation |
|---|---|---|
| Push-to-talk global hotkey | all four | `tauri-plugin-global-shortcut`, ⌘⇧Space, registered Rust-side only; pressed/released events summon the overlay ask panel ([lib.rs](../platform/apps/desktop/src-tauri/src/lib.rs)) |
| Screen capture → model | all four | Real on-demand `capture_display_jpeg` (`screencapture` CLI + `CGPreflightScreenCaptureAccess`/`CGRequestScreenCaptureAccess` preflight) replacing the honest stub; every capture pushes an inspectable `screen` observation and fires the `sensor.capture` blink tell ([sensor_bridge.rs](../platform/apps/desktop/src-tauri/src/sensor_bridge.rs)) |
| AI answer w/ vision (Claude / Gemini Live / multi-LLM) | all four | `companion_ask`: Groq vision model (`meta-llama/llama-4-scout-17b-16e-instruct`, overridable) when GROQ_API_KEY is configured AND the user checked per-session screen consent; otherwise the managed local Qwen endpoint (model_supervisor `endpoint.json`) answers text-only with frontmost-app context and says honestly it cannot see the screen ([companion.rs](../platform/apps/desktop/src-tauri/src/companion.rs)) |
| `[POINT:x,y:label]` animated pointing | farzaa, CONFUZ3 (PointParser/FlightPathAnimator), Bitshank (whiteboard) | Tags parsed in Rust (no regex dep), image-pixel → logical-monitor coordinate mapping, rendered as the EXISTING typed spotlight+callout `AnnotationMark` vocabulary on the captured monitor only (`annotate::show_marks_on`), 12 s auto-clear with generation guard, CSS settle/pulse entrance animation with reduced-motion opt-out ([AnnotateApp.tsx](../platform/apps/web/src/app/avatar/AnnotateApp.tsx)) |
| Voice STT (AssemblyAI / Whisper engines) | all four | Push-to-talk records in the overlay webview (getUserMedia/MediaRecorder) only while ⌘⇧Space is held; `companion_transcribe` sends the clip to Groq `whisper-large-v3-turbo`; mic-denied/unavailable degrades to typed input ([CompanionAsk.tsx](../platform/apps/web/src/app/avatar/CompanionAsk.tsx)) |
| TTS speak-back (ElevenLabs / Edge TTS) | all four | macOS built-in `say` — fully local, no key, cancellable (`companion_speak`/`companion_stop_speaking`); text over stdin so answer content can never be parsed as flags |
| Conversation memory (last 10 turns) | emreyilmaz46, CONFUZ3 | Bounded ephemeral history in the ask panel, role-filtered and length-capped in Rust; the durable governed Chat (TASK-026) remains the persistent surface |
| Multi-monitor awareness | emreyilmaz46, Bitshank | Overlay label ↔ monitor index mapping (`monitor_index_for_label`); capture, mark targeting, and mark hiding are per-display |

Not adopted (out of prototype scope, honest gaps): always-on wake-word listening (violates
no-silent-sensing), lesson MP4 recording, SM-2 knowledge journal, OCR fine-print extraction,
per-app memory isolation, drag-and-drop document context. Each can layer on the same seams later.

## Invariants preserved

- **Raw capture Local-Plane only, consent-gated egress**: the screenshot leaves the machine only
  when the user ticks the per-session "share this screen" control whose copy names the provider
  and the one-screenshot semantics; the request field defaults false everywhere. Push-to-talk
  audio likewise goes only to the transcription provider and only from an explicit hold.
- **Blink = the tell**: `capture_display_jpeg` emits `sensor.capture`; OverlayApp now bridges
  that Tauri event to the DOM blink event, closing the previously noted cross-window gap.
- **Un-spoofable pointing**: model output can only become the typed, Rust-validated
  `AnnotationMark` enum (≤12 marks, finite geometry, ≤120-char plain-text labels); `[POINT]`
  parsing caps at 5 points and sanitizes labels to 60 control-char-free chars.
- **Graceful degradation**: no key → local text answers; no local model → typed error naming the
  unblock; no mic → typed input; no Screen Recording grant → capture proceeds with an honest
  wallpaper-only warning surfaced in the panel and in `sensor_list`.

## Verification (this session)

```yaml
rust:
  cargo_check: pass
  cargo_build_link: pass          # CoreGraphics extern + global-shortcut plugin link
  cargo_test: 68/68               # was 59; +9 companion/overlay/annotate tests
web:
  typecheck: pass
  node_tests: 106/106
  production_build: pass
environment_boundaries:
  screencapture_cli: TCC-denied for this build sandbox ("could not create image from display") —
    the in-app CGRequestScreenCaptureAccess prompt is the designed interactive grant path
  groq_api_key: absent — cloud vision/STT paths unexercised live
  live_desktop_run: not performed (another session owns the dev port; permission prompts need
    an interactive user)
```

## How to run the prototype

```bash
cd platform/apps/desktop
GROQ_API_KEY=... pnpm tauri dev   # or configure {app_data}/bridge/companion.json {"groqApiKey": "..."}
```

1. Complete onboarding so the Avatar overlay presents.
2. Hold ⌘⇧Space and speak, or hover the avatar and click ✨ (also right-click → "Ask about my
   screen") and type.
3. Tick "Share this screen" to enable vision; grant Screen Recording + Microphone when macOS
   prompts; expect the blink on capture, a spoken answer, and auto-clearing spotlights.

## Files

- `platform/apps/desktop/src-tauri/src/companion.rs` — NEW: ask/points/TTS/STT pipeline
- `platform/apps/desktop/src-tauri/src/sensor_bridge.rs` — real on-demand screen capture
- `platform/apps/desktop/src-tauri/src/annotate.rs` — shared validation + monitor-targeted marks
- `platform/apps/desktop/src-tauri/src/overlay.rs` — label→monitor index helper
- `platform/apps/desktop/src-tauri/src/lib.rs` — plugin, shortcut, commands, shutdown wiring
- `platform/apps/desktop/src-tauri/Info.plist` — NEW: mic/screen usage descriptions
- `platform/apps/web/src/app/avatar/CompanionAsk.tsx` — NEW: ask panel
- `platform/apps/web/src/app/avatar/OverlayApp.tsx` — ask panel/PTT/blink-bridge wiring
- `platform/apps/web/src/app/avatar/AnnotateApp.tsx` — mark entrance animation
- `platform/apps/web/src/app/avatar/tauri-internals.ts` — NEW: shared raw-internals helpers

---

# Live validation session — 2026-07-29 (same day)

Run on the user's machine with Screen Recording + Microphone granted and a real `GROQ_API_KEY`.
Six defects were found and fixed; the loop now works end to end. Evidence screenshot:
[`2026-07-29-task-027-live-marks-evidence.png`](2026-07-29-task-027-live-marks-evidence.png) —
a yellow dashed spotlight ring plus an "Ask button" callout rendered over a fullscreen app.

## Defects found and fixed

| # | Defect | Root cause | Fix |
|---|---|---|---|
| 1 | `only alphanumeric, '-', '/', ':', '_' permitted for event names: "annotate.marks"` | Tauri v2 rejects `.` in event names. Pre-existing: `annotate.marks` AND `sensor.capture` were both dead on arrival, their emit errors discarded — so the blink tell and every annotation had never actually delivered | Renamed to `annotate:marks`, `sensor:capture`, `sensor:started` |
| 2 | Vision replies rendered as `<think></think>` | `qwen/qwen3.6-27b` is a reasoning model | `strip_think_blocks` client-side + `reasoning_effort: "none"` |
| 3 | Empty answers presented as success | `reasoning_format: "hidden"` still spends the token budget thinking (verified: `finish_reason=length`, empty content) | `reasoning_effort: "none"` (verified to answer directly) + typed `COMPANION_EMPTY_ANSWER` so an empty reply can never look like success |
| 4 | Marks emitted `Ok` but never reached the webview | `capabilities/default.json` covered `["main","overlay*"]` only. `plugin:event|listen` is a CORE command, so the annotate webview was denied permission to listen — silently, because custom `#[tauri::command]`s still worked | Added `annotate*` to the capability windows |
| 5 | Webview applied marks, nothing painted | (a) frame used `calc()` in an SVG geometry attribute → computes to 0 in WebKit; (b) marks used an entrance animation with `backwards` fill, which holds `opacity: 0` during its delay — a transparent, never-focused, click-through webview throttles animations, so marks stayed invisible permanently | Frame is a plain CSS border; marks are opaque at rest with animation as decoration only |
| 6 | Marks invisible even when painted | The annotate window was an ordinary `always_on_top` window, so it lived in ONE Space and could never draw over a fullscreen app — unlike the Avatar, which is an NSPanel with `can_join_all_spaces` + `full_screen_auxiliary` | Annotate windows get the same NSPanel treatment (non-activating, still click-through) |

## Improvements made during validation

- **Vision model**: `meta-llama/llama-4-scout-17b-16e-instruct` was retired by Groq (404). Configured
  `qwen/qwen3.6-27b` via `companion.json`.
- **Two-stage grid locator** (user-chosen option, adapted from Bitshank's clicky-windows): the model's
  raw `[POINT:x,y]` coordinates are discarded — measured unreliable (a target at 750,450 in a
  1000x600 image returned 136,808; a 3x3 grid probe returned C2 for a target in C3). Instead the
  answer call returns a `[CELL:<cell>:<label>]` tag (stage 1, free — same call as the answer), then
  one call on a padded crop refines it (stage 2). The mark is drawn at the size of the located
  region, so ring size honestly conveys precision.
- **Image downscaling** to 1280px longest edge (890 KiB → 151 KiB typical). Combined with folding
  stage 1 into the answer call, this brought a pointing ask from 3 provider calls to 2 and under the
  free tier's 8,000 tokens/minute — stage-2 refinement only started succeeding after this.
- **High-visibility marks**: bright yellow (#FFD400) over a near-black halo, thicker strokes, haloed
  bold labels, plus a screen-edge frame while marks are active. The previous navy theme colour was
  effectively invisible over dark windows.
- **Diagnostics**: pipeline trace (image/logical dims, cell, located box, mark count, reply head),
  annotate window geometry, and a webview-side `annotate_ready` ping that reports marks applied.

## Verified live

```yaml
V1_summon_and_panel: pass        # hover ✨, right-click menu item, ⌘⇧Space from another app
V3_capture_and_answer: pass      # real screen content described correctly, consent-gated
V3_marks_render: pass            # yellow ring + callout + frame visible over a FULLSCREEN app
V3_auto_clear: pass              # "applied 2" → "applied 0" after ~12s
V4_transcription: pass           # push-to-talk → Groq Whisper transcript → auto-ask
locator_stage2_refinement: pass  # located box narrowed from 1140x738 to 456x344
source_gates: { rust: 72/72, web_tests: 106/106, typecheck: pass, build: pass }
```

## Honest remaining gap

**Pointing accuracy.** The plumbing is proven, but `qwen/qwen3.6-27b` grounds locations poorly: in the
evidence screenshot the ring lands a few hundred logical pixels below-left of the real Ask button
(target ≈ (1565,597), ring centre (1140,725)), so the button sits just outside the ring. The model
describes the screen correctly in words and picks roughly the right area, but cannot reliably convert
"that button" into a position. Groq's current catalogue has no grounding-strong vision model.

Options, in the order recommended: (1) switch the vision provider to one with real grounding
(Anthropic / OpenAI / Gemini) — smallest change, biggest accuracy gain, consent gate unchanged;
(2) raise the Groq tier and increase the locator to 3 stages; (3) accept coarse "look in this area"
pointing and document it. Not yet decided by the user.
