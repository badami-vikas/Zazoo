---
title: Session Outputs — Egg + Universal Commons Feature Roadmap
date: 2026-07-11
status: complete
---

# Scope

User asked for a detailed feature roadmap for the Egg and the Universal Commons, with in-depth
code-level diligence (not high-level analysis) of open-source competitors — specifically
farzaa/clicky, iamsrikanthnani/pluely, the heyclicky vision doc, and the competitor research stored
in `My Data/New Data/` — including whether any code can be incorporated as-is, modified, or used as
reference. This file records the user-facing outcome.

# Delivered

- **Plan**: [docs/raw/egg-commons-feature-roadmap-2026-07.md](../docs/raw/egg-commons-feature-roadmap-2026-07.md)
  — DealPilot-template structure: composition decision (Egg = ADR-029 shell + ceremony + companion;
  Commons = knowledge-only registry + marketplace website + Bridge Cloud twin; surface-first
  sequencing), design lens (onboarding ceremony v2, avatar/pointing, daily rhythm, marketplace
  surfaces), business coverage/exclusions, technical workstreams, code-diligence reuse map, data
  model + invariants, EG0–EG5 + CM0–CM5 slices with the universal exit gate.
- **Wiki**: [docs/wiki/egg-commons.md](../docs/wiki/egg-commons.md) + index line; Plan Registry line;
  log entry; **ADR-049** (reuse verdicts + rejected anti-patterns).

# Diligence findings

- **Clicky (MIT, commit a80fa80, ~7.8k LOC Swift)** — frozen v1; the shipping heyclicky product
  (agents, payments) is closed-source, so its traction metrics do not attach to this code. Reusable:
  onboarding choreography (trust copy in a human voice, permission rows with live polling and
  proof-by-capture, first value performed via a live pointing demo on the user's own screen, single
  next action), the `[POINT:x,y:label:screenN]` protocol with multi-monitor coordinate math, the
  Computer-Use-tool-as-coordinate-locator technique, and the spoken-companion system prompts.
  Rejected: unauthenticated key proxy, transcripts sent to PostHog, silent demo screenshots (Bridge
  adopts the theater but every capture blinks and lands in Memory).
- **Pluely (GPL-3.0, commit 4fb23ac, ~26k LOC Tauri)** — no source vendoring. Its two hard assets
  (cross-platform system-audio loopback via CoreAudio process tap / WASAPI / PulseAudio; the
  non-activating NSPanel overlay) are reachable by depending on the same permissive crates
  (tauri-nspanel, xcap, cidre, wasapi, libpulse-binding) plus ~1.5k LOC of clean glue. Rejected:
  plaintext secret storage, keys in localStorage with no CSP, baked-in API tokens, machine-UID
  telemetry, and stealth-as-concealment (contentProtected is used only to keep Bridge's own windows
  out of screen shares).
- **New Data corpus (113 platforms / 60 chief-of-staff products / 14 skill registries)** — desktop
  assistants converge on seven table stakes (screen context, hotkey invocation, cross-app action,
  Gmail/Calendar, memory, background agents producing artifacts, daily brief); none answers
  retention/audit questions, so the capture contract is the differentiated onboarding. Commons:
  ~10k+ ingestible public skills exist, but no registry ships versioning, trust metadata, or
  knowledge generalization — the CM slices build into that vacuum. Flag: `Competitors Document.md`
  is a HeyClicky self-report; treat its claims as vendor claims.

# Key roadmap conclusions

- Egg: EG0 capture-core crates + hotkey + keychain/CSP posture → EG1 onboarding ceremony v2 (profile
  schema → CoS prompt, permission theater, governed live-demo beat, live Module proposals) → EG2
  pointing input half (AX-tree + locator fallback) → EG3 daily rhythm (brief, commitments, artifact
  lane) → EG4 audio/screen sensors on local model tiers → EG5 voice + proactive. Deferred: broad
  computer-use actuation (category trust failure) and meeting transcription (saturated).
- Commons: CM0 wires the already-built registry (biggest gap: nothing consumes it) → CM1
  supply-chain trust before any ingestion → CM2 marketplace website with permissions/risk/provenance
  on install cards → CM3 corpus ingestion with dedup and per-artifact license checks → CM4 evals +
  staged propagation + convergence mining → CM5 Bridge Cloud hosted twin + monetization seam.
- Status `proposed`; no H2 sequencer reorder; slice scheduling goes through APPROVALS.
