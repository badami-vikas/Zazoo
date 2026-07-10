---
title: Spec — Avatar Day-1
type: raw
doc_kind: design
status: draft
companions:
  - foundational-agents-onboarding-2026-07.md
related_wiki: ../wiki/foundational-agents.md
updated: 2026-07-09
tags: [avatar, ux, onboarding, desktop, capture, spirit-animal]
---

# Avatar Day-1 — Full Spec

## Overview

The avatar is Bridge's personality layer. It is not decorative: it serves as the primary visual tell for capture events and the entry point into the inspectable Memory ledger. It has growth stages, operational states, and two surfaces (web + desktop overlay).

---

## Growth stages

Growth is driven by measurable system state, never by streaks or login history.

| Stage | Trigger | Visual |
|---|---|---|
| Egg | Default from account creation through onboarding | Egg form; dormant |
| Creature | Memory entry count >= 10 OR installed capability count >= 1 | Creature form; animates |
| Mature | Memory entry count >= 100 AND installed capability count >= 3 | Mature form; richer idle animations |

Stage thresholds are `policy_params` (tunable, not hard-coded constants in the UI).

---

## Operational states (primary)

These states represent what the system is doing. Only one operational state is active at a time.

| State | Trigger | Visual cue |
|---|---|---|
| `idle` / `meditating` | No active operation | Gentle breathing animation |
| `listening` | Sensor active (microphone / AX-tree capture running) | Subtle pulse |
| `reading_context` | ContextProvider API call in progress | Eyes scan |
| `drafting` | Agent generating a proposal draft | Typing / thinking animation |
| `awaiting_approval` | One or more proposals pending human review in Approvals | Subtle waiting gesture |
| `blocked_by_policy` | Capability Trust Model denied an operation | Visual freeze + indicator |
| `error` | Runtime error in the active agent or skill | Alert posture |

---

## Personality states (secondary)

Secondary states overlay on top of the operational state.

| State | Trigger | Visual cue |
|---|---|---|
| `awake` | Default when app is in foreground | Eyes open |
| `blink` | `sensor.capture` event fires | Single blink animation (the capture tell) |

The blink on `sensor.capture` is the primary capture contract tell. Every capture MUST produce a blink; the blink is the only user-visible confirmation that a capture happened. Raw capture stays local-plane only.

---

## Surfaces

### Web in-page persona component (all platforms)

- Renders as a small fixed element in the application layout (bottom-right corner or a designated persona slot in the sidebar).
- Responsive: renders at mobile widths from day 1 (lightweight SVG / CSS animation, not a canvas element).
- Always present when the app is open.
- Lighter interaction model than the desktop overlay (no always-on-top behaviour).

### Tauri overlay window (desktop only)

- A third Tauri window: `always_on_top: true`, transparent background, click-through-by-default (OS hit-testing passes through the transparent frame to the window below).
- Activates on click: transitions to click-interactable mode for the duration of the popover interaction, then returns to click-through.
- Positioned: bottom-right corner of the primary display.
- Requires the Tauri shell; absent on web and mobile (those surfaces use the in-page persona component).

---

## Click behaviour

1. Click (either surface) → `awaken` state (brief animation).
2. Avatar reads the current context via **ContextProvider API** (the same API the Learning Agent uses; the avatar is a consumer, not a producer).
3. Avatar navigates (or opens a popover pointing) to the inspectable Memory entry that corresponds to the most recent capture or the current context.
4. This is the **capture contract**: every capture event is traceable to a Memory entry; the avatar is the UI entry point into that trail.

---

## Hatch ceremony

- The egg form is shown throughout the onboarding flow.
- On **blueprint activation** (the user's first workspace blueprint is activated via the governance pipeline), the hatch animation plays.
- The hatch animation is a single, continuous sequence. Duration: 3–10 seconds. Hard cap: 60 seconds. The animation MUST NOT block the user from accessing their first workspace view — it plays in the avatar slot while the workspace renders underneath.
- If blueprint activation happens while the user is not looking (e.g. background session), the hatch animation plays on the user's next visit.

---

## Spirit-animal question

- A "what is your spirit animal?" (or equivalent creature-archetype) question is added to `apps/web/src/app/onboarding/questions.ts` as part of the standard onboarding question set.
- The answer drives the **creature archetype** (visual style of the mature creature). Options are a small fixed set (e.g. fox, owl, bear, dolphin, phoenix — exact set TBD by design).
- The answer is persisted as a `workspace_settings` key (`spirit_animal_archetype`). It influences the avatar's visual theme but does not affect any functional behaviour.
- The question is optional (user can skip); skipping results in a default archetype.

---

## Implementation notes

- State machine lives in `@bridge/core` as a pure function / reducer; UI subscribes via a React context.
- `sensor.capture` event subscription: the Tauri side emits the event on every `sensor_drain` result; the JS side sets `blink` state for 300ms then returns to the prior operational state.
- Avatar assets (SVG or Lottie): owned by the design-system pass. The spec does not prescribe the asset format.
- Growth-stage thresholds are read from `policy_params` at mount time, not hard-coded.
