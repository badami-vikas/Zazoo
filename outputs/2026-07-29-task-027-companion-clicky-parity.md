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
