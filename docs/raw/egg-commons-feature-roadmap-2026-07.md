---
title: Egg + Universal Commons Feature Roadmap — Design, Business, and Technical
type: raw
doc_kind: plan
status: proposed
companions: [module-evolution-system-2026-07.md, roadmap-v2-universal-commons.md, oss-commons-integration-plan-2026-07.md, bridge-foundational-agents-onboarding-2026-07.md, desktop-companion-agent-roadmap-2026-07.md, builder-agent-roadmap-2026-07.md, clean-room-capability-research-protocol-2026-07.md]
related_wiki: ../wiki/egg-commons.md
updated: 2026-07-11
tags: [egg, commons, shell, onboarding, avatar, marketplace, registry, ingestion, reuse, diligence]
---

# 0. Product decision

The **Egg** is Bridge's minimal kernel shell — fixed chrome, everything else streams in as installed Commons content. The **Universal Commons** is the registry of generalized capability knowledge (never user data) that keeps the Egg light. They are two halves of one thesis (user requirement, `roadmap-v2-universal-commons.md`): *"considering I wanted a minimalistic egg, pushing more capabilities to bridge commons will help keep the egg light."*

```yaml
composition:
  egg:
    is: ADR-029 shell (Home → Initiatives → "+ New" → Knowledge/Intelligence/Calendar gated → Settings) + DataViews surface compiler + onboarding ceremony + avatar companion + 4 permanent agents + Trust Model
    is_not: ADR-023 six-container chrome (SUPERSEDED — do not build); a feature-stuffed assistant; a meeting-notes product
  commons:
    is: knowledge-only package registry (service on :4780, permanent HTTP contract, privacy gate 422+offendingPaths) + future marketplace WEBSITE + Bridge Cloud hosted twin
    is_not: a store of user data (ever); an in-app marketplace tab (web app consumes INSTALLED Modules only, ADR-030); Bridge Cloud itself (separate service, ADR-020)
  sequencing_thesis: surface first, ecosystem second — the proven composition order (Raycast, Notion templates, Zapier); nobody wins registry-first. Egg slices lead; Commons slices follow one beat behind.
```

Competitive frame (researched 2026-07-11 — code diligence on Clicky and Pluely; `My Data/New Data` corpus of 113 platforms, 60 chief-of-staff products, 14 skill registries): every desktop assistant ships the same seven table stakes (screen context, low-friction invocation, cross-app action, Gmail/Calendar/Slack/Notion connectors, persistent memory, background agents producing artifacts, daily brief). None answers the trust questions (retention, screenshot handling, audit) — HeyClicky's own doc shows "not found" across SOC2/audit/retention. **Bridge's capture contract (blink tell, inspectable Memory, draft-then-approve) IS the differentiated onboarding**, not a compliance appendix. On the Commons side, ~10k+ ingestible skills exist across public registries, yet none does versioning, trust metadata, or knowledge generalization — every gap is Bridge's occupied-by-design territory. Most structurally similar competitor: OpenClaw (runtime + de-facto skill registry); best composition benchmark: Raycast.

# 1. Design lens — exact surfaces

## 1.1 Egg shell (built — hold the line)

ADR-029 chrome is the Egg: primary rail Home → Initiatives → "+ New" (Module picker over `packages.list` + CoS new-vs-extend) → Knowledge/Intelligence/Calendar (locked until unlocked) → Settings. DataViews shell + 7 registered views = the whole surface grammar. Roadmap rule: **no new chrome**; every feature below lands inside existing containers or the companion windows. Chrome fixed, content streams in — permanent pressure, not one-time.

## 1.2 Onboarding ceremony v2 (the Clicky merge)

Current: adaptive questions → `compileBlueprint` preview → EggHatcher hatch <60s (E1 already removed LinkedIn/OTP). Upgrade with Clicky's choreography (MIT, founder-blessed), governed:

- **Trust copy in a human voice before any permission**: plain-language "nothing runs in the background; capture only happens when you see the blink" — the founder-as-narrator register, mapped to Bridge's capture contract;
- **Permission theater**: sequenced rows (mic → accessibility → screen) with live polling that flips rows green in real time, grant proven by a real capture — but the proof capture itself is an **inspectable Memory entry with the avatar blink**, never silent. Adopt the theater, refuse the silence;
- **First value performed, not explained**: mid-ceremony, the avatar points at one real thing on the user's own screen with a short comment — the "it can see me" beat — as a governed, blinking, Memory-logged capture; latency pre-warmed so the beat never lags;
- **Single next action**: ceremony ends with exactly one streamed prompt (talk to your Chief of Staff), auto-dismissing; never a feature tour;
- **Live Module proposals during onboarding** (ADR-032/033 Day-1 bar): the 4-agent team drafts real proposals into Approvals while the user answers — shipped-for-approval, never live;
- **Profile seam**: answers land in a typed onboarding-profile schema that compiles into CoS's system prompt (gap today — schema doesn't exist), including tone-to-spirit-animal mapping beyond the current `ANIMAL_TONE` map.

## 1.3 Avatar companion + annotation

Built: per-monitor overlay avatar (hover chat, right-click menu), per-monitor click-through annotate window with typed mark vocabulary (highlight/arrow/callout/spotlight), Rust-validated. Roadmap:

- **Pointing input half**: resolve "the Send button" → rect via AX-tree walking (primary) with the **Computer-Use-tool-as-coordinate-locator** trick as fallback (Clicky `ElementLocationDetector`: use the provider's computer-use tool definition purely for pixel-accurate coordinates, aspect-ratio-matched downscale). Port Clicky's `[POINT:x,y:label:screenN]` protocol + coordinate math (px→pt→global, origin flip, multi-monitor offsets, center-clamp so demos never whiff);
- **Non-activating panels**: migrate companion windows to `tauri-nspanel` (`NonActivatingPanel` + `FullScreenAuxiliary` + join-all-Spaces) so the avatar floats over fullscreen apps without stealing focus — the canonical recipe from Pluely's window layer, re-derived from the MIT plugin's own examples;
- **Self-exclusion, not stealth**: `contentProtected` ONLY on Bridge's own overlay/annotate windows so the avatar never photobombs the user's screen shares. Never as concealment from other people — both-party consent is a principle, and Pluely/Cluely-style invisible-in-meetings is explicitly rejected;
- **Transient presence**: appear on invocation, fade after response + pointing + grace period (Clicky's transient cursor pattern) — presence is earned, not squatted.

## 1.4 Invocation + daily rhythm

- **Hotkey invocation** (category benchmark: Raycast speed, Clicky push-to-talk): global shortcut registry with runtime rebind + recorder UI (pattern from Pluely's registry, reimplemented on the permissive `tauri-plugin-global-shortcut`);
- **Morning brief**: the chief-of-staff category's most repeated feature (Alfred/Bond/Ambient/Carly) — CoS composes a daily brief from Signals/Approvals/Calendar/commitments; every item links to its source Memory; never fabricated KPIs;
- **Commitment detection** (Ambient/AirJelly pattern): CoS extracts commitments from connected mail/calendar into governed follow-up proposals;
- **One background-agent lane producing a durable artifact** — the category's strongest proof-of-work pattern; result lands as an Artifact + approval card, not a chat answer.

## 1.5 Commons marketplace (website surface)

Not in the app. The Commons website reads the registry API:

- browse: kind/tag taxonomy, search, official-vs-community provenance badges, risk band, eval status, install count;
- Module detail: manifest-derived permissions ("what it can touch") rendered before install — the trust signal no existing registry shows; version history; provenance chain (sourceRepo, inspected commit, license, signature);
- **one-click install from conversation**: the app-side flow stays "ask CoS" → governed install proposal; the website's Install button deep-links into it. Beats the ecosystem's CLI-installer norm;
- publish flow: gate preview (the 422 offendingPaths surfaced as a pre-publish check), signing, review queue for community submissions.

## 1.6 Approvals, receipts, audit (shared)

Every capture, install, publish, and background run is inspectable: blink tell on capture, Memory entry per capture, immutable run records, cost receipts. This is the answer sheet to the trust questions the whole category fails — surfaced in-product, not in a compliance PDF.

# 2. Business lens

## 2.1 Processes covered

```yaml
covered_processes:
  day_1_trust:
    - permissioned capture with visible tells and inspectable Memory
    - onboarding ceremony to first hatched workspace under 60s
    - live Module proposals drafted during onboarding (approval-gated)
  daily_operation:
    - morning brief, commitment detection, approvals nudges
    - in-context help ("what am I looking at"), governed annotation walkthroughs
    - one background-agent artifact lane; draft-then-approve on all egress
  capability_supply:
    - discover → inspect (permissions/risk/provenance) → governed install → single-live-version updates
    - publish: generalize → privacy gate → sign → curate → list
    - OSS ingestion: harvest public skill corpora into Commons format under supply-chain gates
  ecosystem_learning:
    - convergence-threshold archetype mining (N% of users evolve the same pattern → Commons candidate)
    - eval results and community signals as quality metadata
    - staged propagation of Module updates; local customization never silently overwritten
```

## 2.2 Explicitly not covered

```yaml
not_covered_or_not_authoritative:
  - stealth/anti-capture concealment from other meeting participants (Pluely/Cluely product core — rejected; both-party consent)
  - meeting transcription as a product (saturated: Granola/Otter/Fireflies/Fathom; Bridge acts AFTER the meeting, notes are not the product)
  - broad autonomous computer-use actuation at launch (the category's known trust failure — MultiOn/Fellou; annotation points, it does not click)
  - storing ANY user/workspace data in Commons (gate-enforced, 422)
  - hosting user code execution in Commons (registry serves knowledge; execution stays in the workspace sandbox)
  - an in-app marketplace tab (ADR-030: web app consumes installed Modules only)
  - telemetry containing transcripts/prompts/screens (Clicky ships transcripts to PostHog; Pluely posts error bodies + machine UID — both rejected; capture plane is local, analytics are governed + consented)
  - unauthenticated egress proxies or build-time embedded secrets (Clicky Worker / Pluely APP_ENDPOINT patterns — rejected)
  - vendoring GPL/closed code (Pluely GPL-3.0 = reference-only; heyclicky post-fork product is closed — pattern research only)
  - auto-approving community/AI-generated Modules; External band stays human-approved
```

# 3. Technical lens

## 3.1 Egg technical plan

```yaml
egg_workstreams:
  capture_core_crates:            # adopt Pluely's dependency set directly (all permissive), reimplement glue (~1.5k LOC)
    - tauri-nspanel (MIT): non-activating always-on-top panels for avatar/annotate
    - xcap (Apache-2.0): monitor capture; crop in Rust, no base64-megashot IPC
    - cidre (macOS CoreAudio process tap, 14.4+), wasapi (Windows loopback), libpulse-binding (Linux monitor): system-audio SpeakerStream behind one Stream<f32> trait
    - energy-VAD pre-filter (rewrite ~150 LOC; Silero-ONNX locally for quality) gating local STT
  pointing_pipeline:
    - AX-tree walking via maintained accessibility crate (deferred in ADR-047; now scheduled) feeding annotate_show rects
    - fallback: Computer-Use-tool-as-locator (aspect-ratio-matched downscale) via ModelProvider
    - "[POINT:x,y:label:screenN]" response protocol + parser + multi-monitor coord math ported to Rust/TS
  onboarding_v2:
    - typed OnboardingProfile schema -> PromptAssembler layer -> CoS system prompt
    - permission rows with live polling + proof-by-capture (capture = Memory entry + blink)
    - governed live-demo beat (TLS/model pre-warm; center-clamped pointing)
    - 4-agent live proposal drafting into Approvals during ceremony (Groq tier)
  agents_and_models:
    - split 3 non-CoS agents into separately invocable nodes (today one chief-of-staff.ts node)
    - 5-tier model ramp holds (T0 deterministic -> T1 local SLM -> T2 on-device VLM -> T3 Groq -> T4 frontier); capture plane local by default
  daily_rhythm:
    - brief composer (Signals/Approvals/Calendar/commitments), commitment extractor, background-artifact lane on existing pipeline
  security_posture:                # anti-patterns from diligence, enforced
    - secrets in OS keychain only; strict CSP everywhere; no vendor-API calls from webview with raw keys; per-user tokens only
```

## 3.2 Commons technical plan

```yaml
commons_workstreams:
  wire_the_registry:               # biggest gap: service exists, nothing consumes it
    - commons.* tRPC procedures over the CommonsRegistry port (list/get/install-propose/publish)
    - install-from-Commons = governed proposal through existing packages install flow
    - publish-builtins run against live registry; Learning Agent reads Commons for similarity detection
  supply_chain_trust:              # BEFORE any ingestion (oss-commons plan ruling)
    - artifact signing + checksum (versionPin becomes content hash), publisher verification
    - provenance block (sourceRepo, inspectedCommit, license, artifactLicense) using gate-safe key names
    - security scan as publish gate: Agensi-style 8-point automated scan extended with manifest-derived risk bands + lethal-trifecta union
    - drop the MCP-server sandbox exemption
  ingestion_pipeline:
    - corpus: ~10k+ public skills (Anthropic official 50+, VoltAgent 1000+, Antigravity 1800+, OpenClaw-derived 5400+, Rezvani 345, Agensi 500+)
    - harvest -> dedup (massive overlap across lists) -> taxonomy normalization -> license check (repo-license != artifact-license) -> convert to bridge.package.yaml -> scan -> curate -> publish
    - SKILL.md compatibility both directions: ingest the portable format, emit it on export
  quality_and_versioning:          # absent in EVERY existing registry = differentiation
    - real semver + immutable versions (built) + provenance + eval results as listed metadata
    - single-live-version updates with staged propagation (auto/staged/opt-out/pin/rollback); local customization never overwritten
    - community signals + convergence-threshold mining (N% by user count per ADR-020)
  marketplace_site:
    - static-first website over GET routes; detail pages render manifest permissions + risk + provenance; deep-link install
  bridge_cloud:
    - Postgres CommonsStore behind the same CommonsStore port; deploy same contract; COMMONS_URL config swap (designed in ADR-030)
    - monetization seam: hosted registry + curation + routing = paid; local registry stays free (mirrors Dyad/ToolJet split, per builder-agent plan)
```

## 3.3 Skills

```yaml
skills:
  - onboarding-profile-synthesis
  - permission-ceremony-orchestration
  - live-demo-pointing            # governed screen-point with clamped coordinates
  - daily-brief-composition
  - commitment-extraction
  - screen-context-answering      # "what am I looking at", tiered models
  - annotation-walkthrough-authoring
  - module-discovery-and-similarity
  - manifest-permission-explanation   # renders "what it can touch" for install cards
  - package-ingest-conversion     # SKILL.md/repo -> bridge.package.yaml
  - license-and-artifact-audit
  - provenance-attestation
  - knowledge-generalization      # strip specifics, abstract pattern, pass privacy gate
  - publish-gate-preflight
```

## 3.4 Automations

```yaml
automations:
  - morning-brief-schedule
  - commitment-followup-drafts
  - approvals-nudge
  - background-artifact-lane
  - commons-sync-and-update-check      # installed Modules vs registry versions
  - staged-propagation-rollout
  - ingest-harvest-and-dedup-batch
  - security-scan-on-publish
  - signature-and-checksum-verify-on-install
  - convergence-threshold-miner
```

Every Automation carries trigger, idempotency key, budget, retry/backoff, owner, stop condition, risk band, and immutable run record. Commons contribution is External band by definition (ADR-020) — always human-approved.

# 4. Reuse-first source map

Reuse policy and gates identical to the DealPilot/Builder plans; clean-room protocol applies to license-limited sources.

```yaml
reuse_policy:
  order:
    - install_or_import_existing_permissive_skill
    - wrap_existing_tool_or_repository_behind_Bridge_port
    - adapt_existing_template_or_workflow_with_attribution
    - integrate_upstream_runtime_without_copying_when_license_allows_service_use
    - build_minimal_Bridge_native_gap_only_after_documented_review
  gates:
    - pinned_commit
    - repository_and_artifact_license
    - transitive_dependencies
    - security_and_prompt_injection
    - provenance_and_signature
    - contract_and_eval_conformance
```

Source decisions (code-level diligence 2026-07-11; clones retained in session scratchpad):

```yaml
sources:
  farzaa/clicky:
    license: MIT (c) 2026 Farza — README explicitly blesses reuse; caveat: frozen v1 snapshot, the shipping heyclicky (agents/payments/Windows) went closed-source 2026-04
    inspected_commit: a80fa80721a8aebe51a170a7780705024ebc6e46
    as_is: system prompts (spoken-companion style, seed-planting retention rule, pointing rules, demo center-clamp — light edits); AGENTS.md self-update structure
    modify_and_incorporate: onboarding choreography as design spec (trust copy -> permission rows w/ live polling + proof-by-capture -> email/account gate after permissions before magic -> performed first-value demo -> single next action); "[POINT:x,y:label:screenN]" protocol + parser + multi-monitor coordinate math; Computer-Use-tool-as-coordinate-locator w/ aspect-ratio-matched resolutions
    reference_only: macOS TCC permission UX behaviors (live polling, reveal-in-Finder fallback, xcodebuild-invalidates-TCC gotcha class); TLS pre-warm + shared-URLSession websocket gotcha; transient-cursor presence pattern
    do_not_copy: unauthenticated CF Worker proxy; transcripts/responses to PostHog; SILENT demo screenshots (adopt the theater, make every capture blink + Memory-log); 10-turn RAM memory, no persistence
    link: https://github.com/farzaa/clicky
  iamsrikanthnani/pluely:
    license: GPL-3.0 single-license — NO source vendoring into Bridge; value = architecture blueprint + its permissive dependency set
    inspected_commit: 4fb23ac348ad087ef22920272012030398b6b155
    as_is_dependencies: tauri-nspanel (MIT) non-activating panel; xcap (Apache-2.0) capture; cidre / wasapi / libpulse-binding for per-OS system-audio loopback — depend directly, reimplement ~1.5k LOC glue
    reference_only: speaker/* per-OS loopback architecture behind one Stream<f32> trait (macOS CoreAudio process tap = the modern no-driver approach); energy-VAD tuned constants as cheap pre-filter; global-shortcut registry + recorder UI pattern; capture-first-then-overlay multi-monitor region flow; contentProtected for SELF-exclusion only; curl-template provider idea for user-defined-endpoint manifests (not core paths)
    do_not_copy: plaintext "secure_storage.json" + keys in localStorage + csp:null; anthropic-dangerous-direct-browser-access from webview; build-time embedded API token; machine-UID telemetry + error bodies to vendor; stealth-as-concealment product stance
    link: https://github.com/iamsrikanthnani/pluely
  heyclicky_product (closed):
    use: vision doc + traction as interface-problem validation; roadmap table shows assistants converge on needing a connector marketplace ("speculative" in their own doc) — Bridge ships the governed one first
    mode: market intelligence only; Competitors Document.md is a HeyClicky self-report — treat live-context claims as vendor claims
    link: https://docs.google.com/document/d/1jzsFHCM1g7tB2Op1sjYKY8RkWuIuicGnmWgFdMAR5Rw
  skill_corpora (ingestion targets):
    use: ~10k+ skills — anthropics/skills (50+, official), VoltAgent/awesome-agent-skills (1000+), sickn33/antigravity-awesome-skills (1800+), OpenClaw-derived registries (5400+), alirezarezvani/claude-skills (345), Agensi (500+, the only security-scanned marketplace — adopt its 8-point-scan idea)
    mode: per-artifact license check (repo-license != artifact-license, oss-commons plan); ingest via CM3 pipeline only AFTER CM1 supply-chain gates; SKILL.md as portable interchange format
    link: My Data/New Data/01_agent_skill_repositories.csv
  composition_benchmarks:
    use: Raycast (invocation speed + extension marketplace + power-user polish — the composition model); OpenClaw (runtime+registry at OSS scale — most structurally similar, verify its scale claims independently); Zapier/Relay.app (integration-graph moat under agents; Relay's agents-create-agents ≈ capability-compiles-capability)
    mode: pattern reference from user-curated research corpus; no code involved
    link: My Data/New Data/
```

# 5. Data and capability model

```yaml
Egg:
  OnboardingProfile:            # net-new typed schema
    fields: profession, mode, domain, team, vocab prefs, spirit_animal, tone, connected_sources, permission_states
    compiles_to: CoS system prompt layer (PromptAssembler) + blueprint hints
  CaptureEvent:
    invariants: blink tell fired, Memory entry written, plane=local, provider + permission snapshot recorded
  AnnotationMark:               # built — typed enum, Rust-validated
    extended_by: target_ref (AX element id) | located_coords (locator fallback) + provenance of resolution
  Commitment:
    fields: source Memory, counterparty, due, status, followup Draft link
Commons:
  PackageEntry:                 # built manifest + net-new trust metadata
    adds: provenance{sourceRepo, inspectedCommit, license, artifactLicense}, signature, contentHash, scanReport, evalResults, installCount, publisherVerified
  ConvergenceSignal:
    fields: archetype hash, cohort %, threshold band (10/5/1/0.1% per ADR-020), candidate Module link
invariants:
  - Commons never stores user/workspace data — privacy gate is code, not policy (422 + offendingPaths)
  - versions immutable; updates = new version + staged propagation; local customization never silently overwritten
  - every capture inspectable; every install/publish/run has an immutable record
  - secrets: OS keychain / CredentialBroker only — never artifacts, localStorage, or binaries
  - contentProtected only for self-exclusion; no concealment features, ever
```

# 6. Delivery sequence

```yaml
egg_slices:
  EG0:
    scope: capture-core crates adoption (tauri-nspanel panels, xcap, shortcut registry + hotkey invocation) + keychain/CSP posture audit
  EG1:
    scope: onboarding ceremony v2 — OnboardingProfile schema→CoS prompt seam, permission theater w/ proof-by-capture, governed live-demo pointing beat, live Module proposals via 4-agent Groq team
  EG2:
    scope: pointing input half — AX-tree walking + Computer-Use-locator fallback + [POINT] protocol; annotation walkthroughs
  EG3:
    scope: daily rhythm — morning brief, commitment detection, background-artifact lane, approvals nudges
  EG4:
    scope: system-audio + real screen sensors on T0–T2 local tiers; post-meeting action drafts (never a notes product)
  EG5:
    scope: voice lane + proactive/ambient suggestions (desktop-companion P4/P5 alignment)
commons_slices:
  CM0:
    scope: wire registry — commons.* tRPC over CommonsRegistry port, install-from-Commons governed flow, publish-builtins live, Learning Agent similarity reads
  CM1:
    scope: supply-chain trust — signing, content-hash pins, publisher verification, provenance block, 8-point scan gate, drop MCP sandbox exemption
  CM2:
    scope: marketplace website v1 — browse/detail with permissions+risk+provenance rendered, deep-link one-click install-via-conversation
  CM3:
    scope: ingestion pipeline over public skill corpora — harvest, dedup, taxonomy, per-artifact license check, SKILL.md interchange
  CM4:
    scope: quality + versioning — eval metadata, community signals, staged propagation controls, convergence-threshold miner
  CM5:
    scope: Bridge Cloud hosted registry (Postgres store, same contract, COMMONS_URL swap) + curation/routing monetization seam
```

Exit gate per slice: source/license record, manifest risk computed, tests, held-out eval, browser evidence for changed surfaces, provenance/citation audit, security scan, cost/latency baseline, and no dummy runtime data.

Sequencing notes: EG0–EG1 refine live P0–P1/desktop-companion tracks; CM0 is pure gap-closure on shipped code (registry exists, nothing consumes it); CM1 must precede CM3 (oss-commons ruling: supply-chain trust FIRST); CM5 aligns with roadmap P5 (Publish Blueprint) / P6 (community marketplace). Egg leads Commons by one beat (surface-first composition order). No H2 sequencer reorder; any pull-forward goes through `docs/APPROVALS.md`.
