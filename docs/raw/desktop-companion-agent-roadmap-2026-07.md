---
title: Floating Desktop Companion Agent — Screen-Annotation, Model Ramp, Capability Roadmap
type: raw
doc_kind: plan
status: draft
companions: [spec-consolidation-2026-07.md, client-architecture-context-providers.md]
related_wiki: clients.md
updated: 2026-07-08
tags: [desktop, avatar, companion, sensors, roadmap, models]
---

# Floating Desktop Companion Agent

The floating companion is the desktop embodiment of the Chief of Staff (ADR-033): a small,
always-on-top avatar that (a) shows the user what Bridge is doing right now, and (b) helps
them in-context — eventually including drawing *on their screen*. This doc plans the road from
the 96×96 status-tell overlay that exists today to a screen-aware companion, with an explicit
**start-small-on-models** ramp and a Day-1-vs-Future capability catalog.

This is a companion-agent plan; it does not restate the vision, the sensor SPI design, or the
foundational-agents roster — see `docs/wiki/clients.md`, `client-architecture-context-providers.md`,
and `foundational-agents.md`. It builds on those, and preserves every existing invariant:
sensors optional, deny-perms-still-works, raw capture local-plane only, blink = the tell,
Rust-originated capture events.

---

## 1. Concept + current state

### What exists today (real, in the tree)

- **A real second OS window.** `platform/apps/desktop/src-tauri/src/overlay.rs` builds the
  `"overlay"` webview: 96×96, transparent, undecorated, `always_on_top`, `skip_taskbar`,
  anchored bottom-right with `MARGIN_RIGHT`/`MARGIN_BOTTOM`. `overlay_resize` grows the window
  up-and-left keeping the bottom-right corner pinned; `focus_main_window` raises the main app.
  Its frontend is `apps/web/overlay.html` (`OverlayApp.tsx`), reusing the same Creature +
  `avatar-store.ts` as the in-page `AvatarOverlay.tsx` (in-page one is suppressed under Tauri to
  avoid a double avatar — `docs/wiki/clients.md`).
- **A status + prefs store.** `platform/apps/web/src/app/avatar/avatar-store.ts` holds durable
  local prefs (`SpiritAnimal`, `eggHatched`, `avatarName` — localStorage, not kernel state) and
  an in-memory pub/sub `AvatarStatus` state machine: `idle · listening · reading_context ·
  drafting · awaiting_approval · blocked_by_policy · error`. `setAvatarStatus` is the seam any
  kernel event drives.
- **The blink tell, Rust-originated.** `sensor_bridge.rs` fires the `sensor.capture` Tauri event
  per drained observation; `dispatchCaptureEvent` / `CAPTURE_EVENT` (`bridge:capture`) is the
  webview-side hook that makes the avatar blink. The event originates in the Rust core — the
  security-audit requirement that the blink be un-spoofable from the webview is already the
  design intent (see §2 hardening).
- **Two real context providers.** `platform/packages/sensors` + `providers/apps.rs`,
  `providers/clipboard.rs`: `apps` (NSWorkspace frontmost) and `clipboard` (NSPasteboard) are
  live, drained via `sensor_drain`, buffered in an observation queue + bounded raw ring buffer.
  **`screen` is an honest stub** — `sensor_list` reports it `not_implemented`;
  `capture_screenshot_on_demand` returns `SENSOR_NOT_IMPLEMENTED` (needs the Screen Recording
  permission + a real ScreenCaptureKit/CGWindowList path). `accessibility` is not built at all.
- **Capabilities file.** `src-tauri/capabilities/default.json` covers `["main","overlay"]` with
  only `core:default` — deliberately minimal; sensor commands are behind explicit grants.
- **ModelProvider seam.** `platform/packages/models` — `GroqProvider` is built + wired behind
  `GROQ_API_KEY` (`foundational-agents.md`); Ollama-local is the capture-plane default; Claude is
  configurable. This is the plug for the model ramp in §3.

### The gap

Today's overlay is a **status mascot with a tell** — it faithfully *reflects* state and blinks on
capture, and it can open the main window. It does **not**:

1. know what is on the screen (the `screen` and `accessibility` providers are stubs),
2. draw anything *on the user's screen* (the overlay is a fixed 96×96 corner window, not a
   display-sized canvas),
3. run any model against captured context to produce in-context help.

"Annotate on screen + help in context" needs three new things layered onto the existing overlay:
a **screen-understanding input** (§2, provider side), a **display-spanning annotation output**
(§2, a new window), and a **model that turns one into the other** (§3). The state machine, the
blink contract, and the CoS identity are reused as-is.

---

## 2. Screen-annotation capability (the hard new part)

Two distinct surfaces, deliberately kept apart from the 96×96 avatar window so neither can
compromise the other.

### 2a. Knowing what's on screen (input)

- **`accessibility` provider (preferred, cheap, deterministic).** AX-tree read of the focused
  window (macOS AXUIElement) → normalized `ContextObservation` (role/label/frame rects of buttons,
  fields, links). This is the *primary* signal for annotation: it gives element bounding boxes in
  screen coordinates without any pixel model, so "point at the Send button" is a deterministic
  geometry lookup, not a vision inference. Build this before `screen`.
- **`screen` provider (on-demand only, never a recorder).** Promote `capture_screenshot_on_demand`
  from stub to a real single-frame ScreenCaptureKit/CGWindowList capture, gated on the Screen
  Recording permission. Used only when AX is insufficient (canvas apps, images, PDFs) and only for
  a *single frame on user intent* — no rolling capture. Feeds the vision tiers in §3.
- **Coordinate contract.** Both providers must emit element/region rects in the same
  logical-screen coordinate space the annotation window draws in, accounting for `scale_factor`
  (the same DPI handling `overlay_resize` already does). This mapping is the load-bearing detail:
  an arrow that points 40px off is worse than no arrow.

### 2b. Drawing on screen (output) — the annotation overlay window

A **new third Tauri window** (proposed label `"annotate"`), sibling to `overlay.rs`, built the
same way but:

- **Display-sized, click-through, transparent.** Covers the full monitor (or the focused window's
  bounds), `transparent(true)`, `always_on_top(true)`, `skip_taskbar(true)`, **and set
  click-through** (macOS `ignoresMouseEvents` / Tauri `set_ignore_cursor_events(true)`) so the
  user keeps interacting with the app *underneath* the annotations. The avatar overlay stays a
  separate 96×96 window — the annotation layer is ephemeral and content-free chrome.
- **Renders a constrained vocabulary of marks**, not arbitrary HTML: region highlight (rounded
  rect), arrow/pointer to a rect, numbered callout badge, dimmed spotlight (everything-but-this),
  short text label. Marks are described by a **typed command list** (`{kind, rect, text?}[]`)
  emitted from Rust, not an HTML string — see hardening below.
- **Auto-dismiss + explicit dismiss.** Annotations clear on focus change, on a timeout, or on user
  gesture. The companion never leaves persistent marks on screen.

### 2c. Privacy / trust / security model

- **Local-plane only, structurally.** Screen + AX reads ride the existing Sensor SPI: raw frames /
  AX dumps are `RawCapture` (local-plane, `readRawCapture`-gated), consumers only ever see derived
  `ContextObservation`. Annotation reasoning that needs pixels runs against the **local model
  tier** by default (§3); nothing screen-derived leaves the machine unless the user explicitly
  escalates to a cloud model for a specific action.
- **The blink still tells.** Every screen/AX capture drains through `sensor_drain` → `sensor.capture`
  → blink, exactly as apps/clipboard do today. Reading the screen to annotate is never silent;
  the user sees the tell and can click through to the CaptureLedger entry.
- **Permission-gated + graceful.** No Screen Recording grant → `screen` stays `not_implemented`,
  annotation degrades to AX-only (still useful) or to "open the panel and tell me" — the app stays
  fully usable, per the graceful-degradation rule. No AX grant → no on-screen pointing, companion
  falls back to text guidance in its own panel.
- **Not an injection surface (security-audit item).** The annotation window must **never** render
  model output or screen text as HTML/JS. It renders only the typed mark-command list, and that
  list is **produced and validated in the Rust core** before it reaches the annotate webview — the
  same "blink event originates in Rust, un-spoofable from webview" principle, extended to
  annotations. Fix `csp:null` (open security-audit finding) before this window ships: a strict CSP
  on both `overlay` and `annotate` webviews, no remote origins, no inline script beyond the
  bundled entry. A compromised page underneath must not be able to inject marks or read the
  companion's reasoning.

---

## 3. Model capability ramp — start with lower-capability models

**Explicit principle: begin with the smallest model that can do a narrow, deterministic job, prove
value, then ramp up.** The capture plane defaults to local models; larger/cloud models are opt-in
per action and gated by trust band. The `ModelProvider` seam (`packages/models`, `GroqProvider`
already wired) is the switch — no capability names a model directly, they name a *tier*.

### Tier 0 — No model (deterministic)
Pure geometry + rules over AX-tree observations and kernel state. Blink-on-capture, "highlight the
field the AX-tree says is focused," "point at the Approvals button because
`awaiting_approval` is set." **Unlocks:** the entire Day-1 annotation baseline with zero inference
cost and zero privacy surface. This is where the companion *starts*.

### Tier 1 — Small local text model (Ollama, ~1–3B)
On-device text SLM (e.g. Llama-3.2-3B / Qwen-class small, via the Ollama provider). Summarize an
AX-tree or clipboard observation into one line, classify intent for the voice command, pick which
canned annotation applies. **Unlocks:** "what am I looking at" one-liners, intent routing, gentle
phrasing of nudges. Fully local, capture-plane default.

### Tier 2 — Small local vision model (on-device VLM, ~2B)
A memory-light on-device VLM for the single-frame `screen` capture: **Moondream 2 (~1.9B, <4GB
VRAM)** or **SmolVLM (~2B, best-in-class footprint, laptop-runnable)** via Ollama. Narrow visual
QA: "which region of this screenshot is the error," "read the number in this cell." Used only when
AX is insufficient. **Unlocks:** annotation on non-AX surfaces (canvas/image/PDF), visual "what am
I looking at." Still fully local.

### Tier 3 — Hosted small/fast model (Groq)
`GroqProvider` (already built) for low-latency hosted small models when local is too slow or the
task needs more reasoning than a 2–3B gives. **Opt-in**, because it means derived context (never
raw frames) can leave the machine. **Unlocks:** multi-step in-context guidance, richer summaries,
draft generation tied to on-screen content. Internal/External trust band applies.

### Tier 4 — Frontier model (Claude, configurable)
Full reasoning for genuinely hard help: cross-app workflow synthesis, "build a workflow from what
you see me doing," complex form-fill logic. Highest capability, highest cost, most egress —
**always draft-then-approve, External band always human at launch** (Capability Trust Model).

**Ramp discipline:** a capability ships at the *lowest tier that clears its bar*. A tier is only
promoted for a capability when Tier-N demonstrably can't do the job — measured, not assumed. Local
tiers (0–2) are the privacy default; 3–4 are per-action escalations the user (or policy) allows.

Concrete small-model options, July 2026: Moondream 2, SmolVLM, Qwen2.5-VL-7B (structured
screenshots/OCR) and Llama-3.2-Vision, all Ollama-deployable. See sources at end.

---

## 4. Capability catalog — Day 1 vs Future

Each entry: **how it can be actualized** (mechanism using existing Bridge primitives) · **model
tier** · **trust band**.

### Day 1 — minimum genuinely-useful set

1. **Blink-on-capture tell** — *exists.* `sensor.capture` (Rust) → `bridge:capture` → blink.
   · Tier 0 · Internal (read-only, no egress).
2. **Click avatar → inspectable Memory** — click during/after blink opens the CaptureLedger
   filtered to that timestamp (`avatar-store` → tRPC ledger query); proves capture→Memory.
   · Tier 0 · Internal.
3. **Live status surface** — the 7-state machine already in `avatar-store.ts`, driven by real
   ritual/agent/approval events instead of demo state. · Tier 0 · Internal.
4. **Pending-approvals nudge** — `awaiting_approval` state + a Tier-0 pointer annotation at the
   Approvals button (AX rect); "Open Bridge" via `focus_main_window`. · Tier 0/1 · Internal
   (approval action itself stays human).
5. **"What am I looking at" one-liner** — frontmost `apps` + `accessibility` observation → Tier-1
   SLM one-line summary shown in the expanded overlay panel (not on-screen yet). · Tier 1 · Internal.
6. **Quick-action launcher** — expanded panel lists context-relevant capabilities (the voice
   command center's understanding of workspace/page/selection, `docs/wiki/clients.md`), routed by
   a Tier-1 intent classifier. · Tier 1 · per-capability band.
7. **Element-pointer annotation (AX-only)** — deterministic highlight/arrow at an AX rect on the
   `annotate` window: "the button you mean is here." No vision model. · Tier 0 · Internal.

### Future — extensive set

8. **Proactive on-screen coaching** — companion notices (via AX + Tier-1) the user is stuck/repeating
   and offers an annotated hint. Proposal-gated so it isn't nagging. · Tier 1–2 · Internal, opt-in.
9. **Walkthrough guidance** — a step sequence rendered as numbered callouts across `annotate`,
   advancing on user action (AX state change per step). · Tier 1 (+Tier 3 to author the steps) ·
   Internal.
10. **Form-fill assist** — read form fields (AX), draft values from graph/Memory, annotate each
    field with the proposed value; **draft-then-approve**, user commits each. · Tier 3 · Internal
    (External if it submits anything — human at launch).
11. **Visual "what is this" on non-AX surfaces** — single-frame `screen` capture → on-device VLM
    region answer, annotated. · Tier 2 · Internal, local.
12. **Ambient suggestions** — Learning Agent observes context stream, surfaces a Signal → the
    companion shows it as a gentle overlay cue (every Signal → an action). · Tier 1–3 · Internal.
13. **Cross-app workflow help** — "build a workflow from what I'm doing": multi-app sequence
    synthesis into a proposed `ritual`. · Tier 4 · External-adjacent, always human approval.
14. **Voice-driven in-context help** — the Voice Command Center (`clients.md`) drives the
    companion: speak → intent → annotate/act, tone matched to spirit animal (Comms Agent). · Tier
    1 (intent) + task-appropriate tier for the action · per-capability band.

---

## 5. Development roadmap (mapped to P0–P6)

Graceful degradation is preserved at every phase: each new provider/window is an optional
capability; denying its permission leaves everything before it fully working.

- **P0 (Kernel — now): status companion solid.** Drive the real state machine from kernel events;
  wire Day-1 items 1–3 to live data; fix `csp:null` on `overlay` (and pre-register a locked-down
  `annotate` CSP). Deliverable: the corner avatar is honest and event-driven, no new surface.
- **P1: accessibility provider + AX-only annotation.** Build the `accessibility` context provider
  (macOS AXUIElement) end-to-end through the Sensor SPI (raw local-plane, derived observation,
  blink). Build the `annotate` click-through window rendering the typed mark-command list from
  Rust. Ships Day-1 items 4 + 7 (Tier 0). No models yet.
- **P2: Tier-1 local text model help.** Wire the Ollama provider behind the companion; ship items
  5 + 6 ("what am I looking at", intent-routed launcher). Capture plane stays local.
- **P3: `screen` provider + Tier-2 on-device VLM.** Promote `capture_screenshot_on_demand` to a
  real single-frame ScreenCaptureKit capture behind the Screen Recording grant; add the on-device
  VLM (Moondream/SmolVLM). Ships item 11 and vision-assisted annotation. Still local, still on-demand.
- **P4: Command Center + voice + walkthroughs.** Cross-surface voice command center drives the
  companion (item 14); walkthrough guidance (item 9); Tier-3 Groq escalation for authored steps.
  This is where the companion becomes conversational and instructional.
- **P5: proactive + ambient.** Learning-Agent-driven proactive coaching + ambient suggestions
  (items 8, 12), all proposal-gated so the companion suggests, never interrupts uninvited.
- **P6: workflow synthesis + form-fill at scale.** Tier-4 cross-app workflow help (item 13) and
  full form-fill assist (item 10), under the Capability Trust Model with External-band human
  approval at launch.

### Open questions / risks
- **Coordinate accuracy across multi-monitor + DPI** — the annotate window must resolve AX rects on
  the *right* monitor at the right scale; `overlay.rs` only handles the single landed monitor today.
- **`csp:null` must be fixed before any screen-derived content renders** (security-audit item) —
  hard blocker for §2/P1.
- **Click-through correctness** — a full-screen always-on-top window that isn't reliably
  click-through would trap the user; needs real-device verification (current overlay is
  cargo-check/build-verified only, not GUI-verified headless — `clients.md` gap).
- **On-device VLM footprint** — 2B VLMs are laptop-runnable but not free; measure latency/memory
  before committing P3 to a default-on posture.

---

Sources (small-model options): Moondream 2 / SmolVLM / Qwen2.5-VL / Llama-3.2-Vision via Ollama —
[SmolVLM (HuggingFace)](https://huggingface.co/blog/smolvlm) ·
[qwen2.5vl (Ollama)](https://ollama.com/library/qwen2.5vl) ·
[Best Ollama Models 2026](https://mljourney.com/best-ollama-models-in-2026-a-practical-guide-by-use-case/).
