# Egg + Commons Feature Roadmap

full: [../raw/egg-commons-feature-roadmap-2026-07.md](../raw/egg-commons-feature-roadmap-2026-07.md)

One thesis, two halves: minimal Egg (fixed chrome, ADR-029 shell — NOT
superseded ADR-023 six-container) + Commons carries everything else.
Sequencing: surface first, ecosystem second (Raycast/Zapier order — nobody
wins registry-first). Egg leads Commons by one beat.

**Diligence 2026-07-11** (code-level, clones in scratchpad):
- **Clicky (farzaa/clicky)**: MIT, founder-blessed. Frozen v1 — shipping
  heyclicky (50k agents, 185 paying) went closed 2026-04; open code = Swift
  menu-bar app, ~7.8k LOC. GOLD = onboarding choreography (trust copy in
  human voice → permission rows w/ live polling + proof-by-capture → first
  value PERFORMED: avatar points at user's real screen mid-video → single
  next action) + `[POINT:x,y:label:screenN]` protocol w/ multi-monitor
  coord math + Computer-Use-tool-as-coordinate-locator hack. DO NOT COPY:
  unauthenticated Worker proxy, transcripts→PostHog, SILENT demo
  screenshots (adopt theater, every capture blinks + Memory-logs).
- **Pluely**: GPL-3.0 → NO vendoring. Value = blueprint + permissive crate
  set: tauri-nspanel (MIT, non-activating panel over fullscreen apps),
  xcap (Apache), cidre/wasapi/libpulse-binding (per-OS system-audio
  loopback behind one Stream<f32> trait — macOS process tap = modern
  no-driver way). ~1.5k LOC clean glue reachable. DO NOT COPY: plaintext
  secure_storage.json, keys in localStorage + csp:null, baked-in API
  token, stealth-as-concealment (contentProtected = self-exclusion only).
- **New Data corpus** (113 platforms / 60 CoS / 14 skill repos): desktop
  assistant table stakes = screen context · hotkey invocation · cross-app
  action · Gmail+Calendar · memory · background agents w/ artifacts ·
  daily brief. NOBODY answers trust questions (retention/audit/screenshot
  handling) — capture contract IS the differentiated onboarding. Commons:
  ~10k+ ingestible skills exist (Anthropic 50+, VoltAgent 1000+,
  Antigravity 1800+, OpenClaw-derived 5400+, Agensi 500+ = only
  security-scanned one); NO registry has versioning/trust
  metadata/knowledge generalization — all Bridge territory. Caveat:
  Competitors Document.md = HeyClicky self-report; OpenClaw "280k stars"
  unverified.

**Egg slices EG0–EG5**: EG0 crates+hotkey+keychain/CSP posture · EG1
onboarding v2 (OnboardingProfile schema→CoS prompt, permission theater,
governed live-demo beat, 4-agent live proposals) · EG2 pointing input
(AX-tree + locator fallback + [POINT] port) · EG3 daily rhythm (brief,
commitments, artifact lane) · EG4 audio+screen sensors on local tiers,
post-meeting action (notes NOT product — saturated) · EG5 voice +
proactive. Defer: broad computer-use actuation (category trust failure).

**Commons slices CM0–CM5**: CM0 wire registry (commons.* tRPC — service
built; **2026-07-15 partial landed**: API composition + list/get/version/install-propose/
publish-builtins + Registry browser; Learning similarity + full exit gates remain) · CM1 supply-chain trust FIRST
(signing, content-hash pins, publisher verify, 8-point scan, drop MCP
exemption) · CM2 marketplace website (permissions/risk/provenance on
install cards, deep-link install-via-conversation, beats CLI norm) · CM3
ingest ~10k corpus (dedup, taxonomy, per-artifact license, SKILL.md
interchange) · CM4 evals + staged propagation + convergence miner · CM5
Bridge Cloud Postgres twin + monetization seam. CM1 before CM3 (oss-commons
ruling). Same universal exit gate. No sequencer reorder. ADR-049.

**UI alignment partial 2026-07-15**: Form = registered standard DataView. Typed metadata fields +
insert-hook seam built. Real direct-insert/process-parity bindings still required. No macOS checks run.
