# Companion clicky-parity handoff — 2026-07-29 (TASK-027)

> Purpose: complete restart/validation context for the screen-aware companion ask prototype, written
> for a DIFFERENT model/session that has no access to the implementing conversation. It must be able
> to validate the prototype end-to-end from this file alone. This file is not an execution queue:
> `docs/TASKS.md` (TASK-027), R-041 in `docs/requests.md`, and
> `outputs/2026-07-29-task-027-companion-clicky-parity.md` remain authoritative.

---

## 1. Background and intent

User directive R-041 (2026-07-29, verbatim in `docs/requests.md`): replicate the desktop-agent
capabilities of the open-source clicky family on macOS, on top of Bridge's existing Avatar/overlay
baseline, as a working prototype:

- https://github.com/farzaa/clicky — original macOS Swift menu-bar AI teaching companion:
  push-to-talk voice, ScreenCaptureKit screenshot → Claude, `[POINT:x,y:label:screenN]` tags animate
  a cursor overlay, ElevenLabs TTS, AssemblyAI STT.
- https://github.com/emreyilmaz46/clicky_windows — .NET 8/WPF port: conversation memory (10 turns),
  multi-monitor capture, spring-physics pointer.
- https://github.com/Bitshank-2338/clicky-windows — Python/PyQt6 port: multi-provider LLM/STT/TTS,
  DPI-aware multi-monitor coordinates, whiteboard annotations.
- https://github.com/CONFUZ3/ClickyWindows — .NET 8 + Gemini Live port: PointParser +
  FlightPathAnimator, per-session WebSocket, interrupt capability.

**Reuse intake:** all four are MIT-licensed. Only *behaviors* were adopted from public
READMEs/architecture docs; no source code was copied, translated, or paraphrased (their stacks are
Swift/C#/Python; Bridge's shell is Rust/Tauri). Bridge's invariants were preserved rather than
cloned from clicky: consent-gated cloud egress, blink-tell capture honesty, typed un-spoofable
annotations, graceful permission degradation.

**Deliberately NOT adopted** (honest gaps, future layers): always-on wake-word listening (violates
Bridge's no-silent-sensing rule), lesson MP4 recording, SM-2 knowledge journal, OCR fine-print
extraction, per-app memory isolation, drag-and-drop document context, spring-physics cursor
trailing (Bridge uses its typed mark vocabulary instead of a free-moving fake cursor).

---

## 2. Resume state

- Repository: local checkout `/Users/manishsbhoopalam/Claude Projects/relationship-os`, branch `main`
- Baseline commit at implementation time: `8cd9d46` ("Move sign-out into the top account dropdown")
- Implementation status: **committed and pushed to `main`** as a single TASK-027 commit (this
  handoff file landed inside it — `git log --oneline -1 -- docs/Progress\ from\ Manish/companion-clicky-parity-handoff-2026-07-29.md`
  shows the exact SHA). Start validation with `git pull` and confirm that commit is in ancestry.
- **Concurrent-session hazard:** another Claude session has been committing to this same checkout
  (`8cd9d46` landed mid-implementation) and owns a Vite dev server on **port 5173** (PID visible via
  `lsof -nP -iTCP:5173 -sTCP:LISTEN`). Take a fresh `git status` snapshot before starting, stop or
  coordinate around that server, and never push/merge without explicit user authorization.

TASK-027 change set (one commit on `main`):

```yaml
new:
  - platform/apps/desktop/src-tauri/src/companion.rs          # the whole ask/point/TTS/STT pipeline
  - platform/apps/desktop/src-tauri/Info.plist                # NSMicrophone/NSScreenCapture usage strings
  - platform/apps/web/src/app/avatar/CompanionAsk.tsx         # ask panel UI
  - platform/apps/web/src/app/avatar/tauri-internals.ts       # shared raw tauriInvoke/tauriListen helpers
  - outputs/2026-07-29-task-027-companion-clicky-parity.md    # capability mapping + evidence
modified:
  - platform/apps/desktop/src-tauri/Cargo.toml                # + tauri-plugin-global-shortcut 2, ureq 2 (json), base64 0.22, imagesize 0.13
  - platform/apps/desktop/src-tauri/Cargo.lock
  - platform/apps/desktop/src-tauri/src/lib.rs                # plugin registration, ⌘⇧Space, 5 new commands, exit shutdown
  - platform/apps/desktop/src-tauri/src/sensor_bridge.rs      # REAL on-demand screen capture (was honest stub)
  - platform/apps/desktop/src-tauri/src/annotate.rs           # extracted validate_marks + show_marks_on(monitor)
  - platform/apps/desktop/src-tauri/src/overlay.rs            # monitor_index_for_label + tests
  - platform/apps/desktop/src-tauri/src/providers/apps.rs     # pub(crate) frontmost_app_once()
  - platform/apps/web/src/app/avatar/OverlayApp.tsx           # ask panel, PTT listener, sensor.capture→blink bridge, ✨ button, menu item
  - platform/apps/web/src/app/avatar/AnnotateApp.tsx          # mark entrance/pulse animation (reduced-motion aware)
  - docs/TASKS.md                                             # TASK-027 row + queue append note + ID list
  - docs/requests.md                                          # R-041 verbatim
  - docs/log.md                                               # 2026-07-29 entry
  - docs/wiki/desktop-companion.md                            # current-state paragraph
  - docs/CODEMAPS/current-tasks.md                            # regenerated projection
  - platform/apps/web/src/app/data/pending-work.generated.json # regenerated projection
```

---

## 3. Architecture (what was built, exactly)

### 3.1 Flow

```
⌘⇧Space (global-shortcut plugin, Rust)
  └─ emits "bridge:companion-ptt" {pressed|released} → all webviews
       └─ OverlayApp (session-ready gate) → opens "ask" panel, pttActive=true
            └─ CompanionAsk: getUserMedia + MediaRecorder while held
                 └─ release → blob → base64 → invoke companion_transcribe
                      └─ Rust → Groq /audio/transcriptions (whisper-large-v3-turbo)
                           └─ transcript → auto companion_ask
companion_ask {question, shareScreenWithCloud, speak, history[≤10]}
  ├─ consent && GROQ key?
  │    ├─ YES → sensor_bridge::capture_display_jpeg(monitor of calling overlay)
  │    │        ├─ CGPreflight/RequestScreenCaptureAccess
  │    │        ├─ `screencapture -x -t jpg -D <n+1> <tmp>` → bytes, real dims via imagesize
  │    │        ├─ push `screen` Observation (metadata only) + emit "sensor.capture" (blink)
  │    │        └─ POST Groq /chat/completions (vision model, data-URI image, POINT protocol prompt)
  │    └─ NO  → read model_supervisor endpoint.json → POST local llama /v1/chat/completions
  │             (text-only; system prompt names frontmost app; forbids POINT tags)
  ├─ parse_point_tags(reply) → ≤5 points → map image px → logical monitor coords
  ├─ marks_for_points → typed Spotlight+Callout marks (≤10 total, under annotate MAX_MARKS 12)
  ├─ annotate::show_marks_on(app, monitor_index, marks) → emit_to that monitor's annotate window,
  │    hide the others; 12 s auto-clear thread with generation guard
  ├─ speak? → macOS `say`, text over stdin (never argv), previous child killed first
  └─ return CompanionAnswer {text(strip tags), provider, screenShared, points, spoke, captureNote}
```

### 3.2 New Tauri command surface (all registered in lib.rs)

| Command | Args | Returns | Typed errors |
|---|---|---|---|
| `companion_capabilities` | — | `{cloudVision, visionModel, localModel, cloudStt, tts, screenPermission}` | — |
| `companion_ask` (async) | `request: {question, shareScreenWithCloud?, speak?, history?}` | `{text, provider: "groq-vision"\|"local-qwen", screenShared, points, spoke, captureNote?}` | `COMPANION_EMPTY_QUESTION`, `COMPANION_QUESTION_TOO_LONG` (4 000 chars), `COMPANION_CAPTURE_FAILED`, `COMPANION_PROVIDER_STATUS`, `COMPANION_PROVIDER_UNREACHABLE`, `COMPANION_PROVIDER_SHAPE`, `COMPANION_NO_MODEL`, `COMPANION_ANNOTATE_FAILED`, `COMPANION_TASK_FAILED` |
| `companion_transcribe` (async) | `request: {audioBase64, mime}` | transcript `string` | `COMPANION_NO_STT`, `COMPANION_BAD_AUDIO` (empty / >24 MB / unsupported mime), `COMPANION_STT_FAILED` |
| `companion_speak` | `text` | `()` | `COMPANION_EMPTY_SPEECH`, `COMPANION_TTS_UNSUPPORTED` (non-macOS) |
| `companion_stop_speaking` | — | `()` | `COMPANION_STATE` |
| `capture_screenshot_on_demand` (now REAL) | — (uses calling window) | `{base64Jpeg, imageWidth, imageHeight, permissionGranted}` | `SENSOR_CAPTURE_FAILED`, `SENSOR_NOT_IMPLEMENTED` (non-macOS) |

Events: `bridge:companion-ptt` (payload `"pressed"`/`"released"`, emitted app-wide from the
Rust shortcut handler); `sensor.capture` (existing blink-tell, now also emitted per on-demand
screenshot and bridged to the DOM `bridge:capture` event inside OverlayApp so ALL captures blink
the OS overlay avatar).

### 3.3 Configuration resolution (companion.rs)

- Groq key: `GROQ_API_KEY` env var, else `{app_data}/bridge/companion.json` → `{"groqApiKey": "..."}`
  (`{app_data}` = `~/Library/Application Support/ai.bridge.desktop`). Absent → cloud vision + STT
  honestly unavailable.
- Vision model: `BRIDGE_COMPANION_VISION_MODEL` env, else companion.json `visionModel`, else
  `meta-llama/llama-4-scout-17b-16e-instruct`. STT model fixed: `whisper-large-v3-turbo`.
- Local model endpoint: `model_supervisor::runtime_dir_for_local_plane(local_dir)/endpoint.json`
  (`{baseUrl, apiKey, model}`), where `local_dir` = `BRIDGE_LOCAL_DIR` env or
  `{app_data}/bridge/local-plane`. File exists only while the managed llama server is healthy.

### 3.4 Coordinate mapping (validate marks land correctly)

`screencapture -D <n>` captures display n at PHYSICAL pixel resolution; the model is told the
image's real decoded dimensions and asked for coordinates in image-pixel space. Rust maps
`logical = image_coord × (monitor_logical_size / image_size)` per axis, clamped to the monitor;
monitor logical size is fetched via a main-thread roundtrip (Tao monitor APIs are not
worker-thread-safe on macOS). The annotate window covers that monitor at logical size, so mark
coordinates are window-relative. Overlay window label ↔ monitor index: `"overlay"`→0,
`"overlay-N"`→N (`overlay::monitor_index_for_label`, unit-tested).

### 3.5 Security/consent invariants (review anchors)

- **Consent is per-ask and default-off**: `CompanionAskRequest.share_screen_with_cloud`
  `#[serde(default)]` false; UI checkbox is per-session, unchecked by default, copy names the
  provider and one-screenshot semantics (CompanionAsk.tsx). Without it the vision branch is
  unreachable (`run_ask` in companion.rs).
- **Raw frames never enter shared state**: `capture_display_jpeg` pushes a metadata-only
  `Observation` (trigger/monitor/dims/permission) — the JPEG bytes go only to the caller and, on
  the consented branch, to the provider request. Nothing image-shaped enters the queue, ring
  buffer, or any event payload.
- **Pointing is un-spoofable**: model text can only become `annotate::AnnotationMark` enum values
  through `parse_point_tags` (≤5 points, finite non-negative coords, labels
  control-char-stripped ≤60 chars) and `validate_marks` (≤12 marks, finite geometry, positive
  size, ≤120-char labels). The annotate webview renders labels as SVG text content, never HTML.
- **TTS injection-safe**: `say` receives text on stdin, never argv, so a reply starting with `-`
  cannot become a flag.
- **Shortcut not webview-bindable**: plugin + registration are Rust-side only; no
  capabilities/default.json entries were added (still `core:default` for `main` + `overlay*`).
- **Shell hygiene**: speech child killed on panel close and app Exit
  (`companion::shutdown`); auto-clear timers are generation-guarded so an old ask can't wipe a
  newer ask's marks; capture refuses to run once the sensor hub is disabled (sidecar loss).

---

## 4. Already verified by the implementing session (spot-check, don't re-derive)

```yaml
rust:
  cargo_check: pass
  cargo_build_link: pass            # CoreGraphics extern + global-shortcut plugin link OK
  cargo_test: 68/68                 # baseline was 59; +9 new (POINT parsing/stripping/bounds,
                                    # coord mapping/clamping, history bounding/role filter,
                                    # multipart body, label sanitization, monitor_index_for_label)
web:
  typecheck: pass
  node_tests: 106/106
  production_build: pass            # pre-existing chunk-size warning only
not_verified_live (this is YOUR job):
  - screencapture under a granted Screen Recording permission (implementing sandbox was
    TCC-denied: "could not create image from display" — expected, the in-app
    CGRequestScreenCaptureAccess prompt is the designed grant path)
  - any Groq call (no GROQ_API_KEY in the implementing environment)
  - WKWebView getUserMedia/MediaRecorder mic path (needs interactive grant)
  - global shortcut delivery + overlay summon on a real launch
  - mark placement accuracy on retina/multi-monitor hardware
```

---

## 5. Environment prerequisites

1. macOS 14+ physical session (OS permission dialogs must be clickable; SSH/headless cannot pass).
2. **Port 5173 free.** The other session's Vite owns it right now
   (`lsof -nP -iTCP:5173 -sTCP:LISTEN`). Stop it (coordinate first) or validation cannot launch —
   `tauri.conf.json`'s `devUrl` is fixed to 5173.
3. **Groq key** for V3–V6: export `GROQ_API_KEY` in the launching shell, or write
   `~/Library/Application Support/ai.bridge.desktop/bridge/companion.json` →
   `{"groqApiKey": "gsk_..."}`. Free tier suffices (vision + whisper are on it). Never commit or
   log the key.
4. **Managed local model** for V2/V7: first launch downloads/verifies the pinned Qwen3-4B artifact
   (~2.5 GB) — wait for model_supervisor to publish `endpoint.json` (watch stdout for llama-server
   lines; `companion_capabilities.localModel` flips true).
5. **TCC nuance for dev builds:** under `pnpm tauri dev` the Screen Recording / Microphone grants
   attach to the RESPONSIBLE app (usually the terminal/IDE that spawned it), not
   `ai.bridge.desktop`. Grant whatever app macOS names in the prompt. For repeatable
   permission-denial tests: `tccutil reset ScreenCapture` / `tccutil reset Microphone` (optionally
   suffixed with the responsible bundle id) — then relaunch.
6. Launch:

```bash
cd "/Users/manishsbhoopalam/Claude Projects/relationship-os/platform/apps/desktop"
GROQ_API_KEY=gsk_... pnpm tauri dev
```

7. Complete/confirm Onboarding so an Organization is active — the Avatar overlay presents only
   after the session-readiness gate (`overlay_set_session_ready`); a hidden avatar means
   onboarding isn't done, not a companion bug. Startup log tell:
   `[bridge-desktop] avatar overlay visible label=overlay`.

---

## 6. Validation protocol

Record per item: PASS/FAIL, what you observed, and evidence (screenshot path / log excerpt /
exact response text). Suggested evidence dir: `outputs/2026-07-29-task-027-live-validation/`.

### V1 — Summon and panel chrome
Preconditions: app running, avatar visible. Steps: (a) hover the avatar → an ✨ button and a 💬
button appear; click ✨. (b) Close it; right-click the avatar → menu shows Hide / Meditate /
Observe / **Ask about my screen**; click the last. (c) Close it; focus a DIFFERENT app (e.g.
Safari fullscreen) and press ⌘⇧Space.
Expected: each route opens the same "«name» — Ask" panel; the window grows to 380×500 with its
bottom-right corner pinned and collapses back on ×; ⌘⇧Space works while Bridge is unfocused and
even beside fullscreen apps (NSPanel all-Spaces behavior). If the shortcut does nothing, check
stdout for `companion push-to-talk registration failed` (combo already taken by another app).

### V2 — Local ask, zero egress
Preconditions: "Share this screen" UNCHECKED (leave key configured; the gate under test is
consent, not the key). Local model ready. Steps: type "What app am I looking at right now?" →
Enter. Expected: answer within local-model latency; provider line **"Answered locally by the
managed model — no screen view"**; the text either names the frontmost app (from
NSWorkspace metadata) or honestly says it cannot see the screen; **no avatar blink**, no new
`screen` observation, no marks. FAIL if the provider line claims local but a capture blink fires.

### V3 — Consented vision ask + on-screen pointing (the core loop)
Preconditions: key configured, "Share this screen" CHECKED, first-use Screen Recording prompt
granted (relaunch after granting if macOS requires). Open a recognizable app (Finder window,
System Settings, or a browser on a form). Steps: ask "Where do I click to create a new folder?"
(adapt to the visible app). Expected, in order: avatar **blinks** at capture; status line
"Looking at your screen…" then the answer; provider line **"Answered by Groq vision — screen
shared with your consent"**; if the reply referenced locations, animated spotlight rings +
labeled callouts appear **on the correct targets of the SAME display** (settle+pulse animation);
panel notes "Pointing at N places…"; marks **auto-clear ≈12 s**; while visible, clicking
*through* a mark reaches the app underneath (click-through window). Accuracy bar: spotlight
center within ~40 logical px of the true target on a retina display (this validates the
physical→logical mapping). Zero points is acceptable ONLY if the answer needed no location;
coordinates on the wrong display or wildly offset marks are FAILs (suspect the mapping or `-D`
display indexing — capture which monitor and scale factor).

### V4 — Push-to-talk voice → transcription → spoken answer
Preconditions: key configured; "Speak answers aloud" ON. Steps: hold ⌘⇧Space, grant the mic
prompt on first use, say "What is on my screen right now?", release. Expected: placeholder shows
"Listening… release ⌘⇧Space to ask" and "● Recording" while held; on release "Transcribing your
voice…"; the transcript appears in the box and the ask fires automatically; the answer is
**spoken aloud** (macOS `say`); "Stop speaking" cuts audio instantly; a second ask while speech
plays kills the old speech first. Avatar status flows listening → reading_context/drafting →
idle.

### V5 — Conversation memory
Steps: after V3/V4, ask a follow-up that only works with context ("and how would I undo that?").
Expected: the answer resolves the pronoun from prior turns (history is bounded to 10 turns,
role-filtered user/assistant, 2 000-char cap per turn).

### V6 — TTS toggle isolation
Steps: toggle "Speak answers aloud" OFF; ask anything. Expected: silent answer, no "Stop
speaking" button rendered.

### V7 — Degradation: no cloud key
Steps: quit; relaunch WITHOUT `GROQ_API_KEY` and with no companion.json key. Expected: consent
checkbox disabled with copy "Screen answers need a cloud vision key (GROQ_API_KEY)…"; typed asks
still answer locally (V2 behavior); holding ⌘⇧Space shows "Voice needs GROQ_API_KEY — type your
question instead." and nothing records; nothing crashes. Also check `sensor_list`-driven UI (if
surfaced) still reports screen availability honestly.

### V8 — Degradation: permissions denied
(a) Mic: deny/reset Microphone for the responsible app (`tccutil reset Microphone`), relaunch,
hold ⌘⇧Space → expect "Microphone permission was declined — type your question instead." and a
functional typed path. (b) Screen: reset ScreenCapture, relaunch, run a consented ask and DECLINE
the prompt → expect the ask to still complete, with the panel warning that screenshots may show
only the wallpaper AND `captureNote` on the answer; a wallpaper-only model description is the
expected honest state, not a bug. No crash, no hang in either case.

### V9 — Multi-monitor (hardware permitting)
Steps: connect a second display; each display gets its own avatar overlay instance. Run V3 from
display 2's avatar. Expected: the screenshot and the marks both belong to display 2; display 1
shows no marks; any stale marks elsewhere are hidden when new marks land (targeted
`show_marks_on` hides non-target annotate windows). Then run from display 1 and confirm the
inverse.

### V10 — Blink-tell regression (cross-window bridge)
Steps: in the main Bridge window enable the `apps`/`clipboard` sensors (Settings/sensor UI),
switch frontmost apps or copy text so drains occur. Expected: the OS-overlay avatar (not just the
in-page one) now blinks on those captures too — the new `sensor.capture` → DOM bridge in
OverlayApp. Previously overlay blinks only fired for same-webview events; this closes the noted
follow-up.

### V11 — Regression sweep
```bash
cd platform/apps/desktop/src-tauri && cargo test          # expect 68/68
cd ../../web && pnpm typecheck && pnpm test               # expect clean + 106/106
```
Plus by hand: overlay drag to a new position → quit → relaunch → position restored; 💬 chat panel
still opens and chats (TASK-026 surface untouched); Observe menu item completes without error
(now returns a real screenshot payload); main-window sign-in/nav unaffected.

---

## 7. Troubleshooting

| Symptom | Likely cause / action |
|---|---|
| `could not create image from display` in logs; `COMPANION_CAPTURE_FAILED` | Screen Recording not granted to the RESPONSIBLE app (terminal in dev). Grant in System Settings → Privacy & Security → Screen Recording, relaunch. |
| ⌘⇧Space inert | Another app owns the combo — see startup log `push-to-talk registration failed`. Validate via ✨ instead and file the conflict as evidence. |
| `COMPANION_PROVIDER_STATUS` 400 mentioning the model | Groq deprecated the default vision model. Set `BRIDGE_COMPANION_VISION_MODEL` to a current Groq vision model id and note it — acceptable, not a FAIL. |
| `COMPANION_NO_MODEL` on local asks | model_supervisor hasn't published `endpoint.json` yet (first-run download) or the runtime crashed — check its stdout; wait or restart. |
| Recording never transcribes; `COMPANION_BAD_AUDIO` unsupported format | WKWebView produced an unexpected MediaRecorder mime. Record the exact mime from the error — supported: mp4/m4a/aac/webm/ogg/wav. This is a real finding; file it. |
| Marks on wrong display / offset | Note monitor arrangement, scale factors, which overlay asked. Suspect `screencapture -D` indexing vs Tauri monitor order — file with a screenshot of System Settings → Displays arrangement. |
| Avatar never appears | Onboarding/session gate, not companion — confirm active Organization; look for `avatar overlay visible` log. |
| Vite port error at launch | Port 5173 still owned by the other session — stop that server first. |

---

## 8. On completion

- **All pass** → flip TASK-027 `in_progress` → `done` in `docs/TASKS.md` and append a
  `- Verification: DONE <date> — …` line summarizing V1–V11 with evidence pointers; append the
  result to `docs/log.md`; add the live evidence to
  `outputs/2026-07-29-task-027-companion-clicky-parity.md` (or a sibling live-validation file);
  regenerate the projection: `node platform/scripts/generate-pending-work.mjs`.
- **Any FAIL** → file the exact repro in `docs/BUGS.md`, attach it to TASK-027, keep status
  `in_progress`, and record which V-items passed so the next session doesn't repeat them.
- Known-acceptable deviations (not FAILs): Groq vision model id rotated (env override works);
  wallpaper-only capture when the permission is declined; voice unavailable without the key.
- Commit/push ONLY with explicit user authorization; coordinate with the concurrent session
  before any push/merge. Never write the Groq key into any tracked file.
