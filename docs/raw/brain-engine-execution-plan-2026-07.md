---
title: Brain/Engine — step-by-step execution plan
type: raw
doc_kind: plan
status: draft
companions:
  - docs/raw/brain-engine-architecture-2026-07.md
  - docs/raw/agent-quality-eval-model-2026-07.md
  - docs/raw/security-audit-2026-07.md
related_wiki: docs/wiki/brain.md
updated: 2026-07-09
tags: [brain, execution-plan, roadmap, ingestion, routing, mcp, memory, automation-mining]
---

# Brain/Engine Execution Plan

Turns the ADR-046 design ([brain-engine-architecture-2026-07.md](brain-engine-architecture-2026-07.md)) into an ordered, buildable step list. Every step names real repo paths, its test, and a binary done-when. Sizing: **S** ≤ half-day session · **M** = one focused session · **L** = multi-session slice.

**Ground truth checked against the repo (2026-07-09)**: these seams already exist and are extended, not created — `platform/packages/core/src/capability/{credential-broker,sandbox-provider,importer,foreign-import,risk}.ts` · `core/src/memory/stores.ts` · `core/src/{ports,pipeline,ritual-executor,agents,chief-of-staff,onboarding-profile,context-provider}.ts` · `packages/models/src/router.ts` (createModelRouter) · `packages/sensors/src/{hub,capture-ledger}.ts` · `packages/dedupe` (entity resolution) · `packages/sourcing/src/{connectors,waterfall}.ts` · `packages/integrations-google` · `packages/local` (pglite).

**Standing rules for every step**: ports get a conformance suite bound by both in-memory and real adapters (existing pattern) · thresholds live in `policy_params`, never constants · no dummy data — honest empty states · every mutation through the Pipeline · raw capture local-plane only · new/changed raw docs update wiki + log.

---

## Stage 0 — Unblockers (do first; everything downstream depends on these)

### 0.1 Pin the canonical embedding model + dimension — **M** · BLOCKS 1.3, 1.5, 3.x
- **Decision to make**: one canonical dim for `vector(N)` columns (existing schema-v2 punch-list item). Recommendation: **768** (nomic-embed-text on Ollama = local-plane default; re-embed ritual defined now for any future switch).
- **Where**: `EmbeddingProvider` port in `packages/core/src/ports.ts` (types only, zero-dep) · Ollama impl in `packages/models/src/` · dim constant + migration in `packages/db`.
- **Test**: conformance suite (dim assertion, determinism-of-shape); wiring boots with `EchoEmbeddingProvider` (no network).
- **Done when**: `embed()` callable from wiring in both modes; ADR appended recording the pin + re-embed policy.

### 0.2 `episodes` schema decision — **S** · BLOCKS 1.3
- **Decision**: rollup table (`episodes`) referencing `timeline_entries` ids — never fork timeline (undefined-elements #3 verdict). Levels `span|hourly|daily|weekly`, `consolidation_state`, `embedding` col at pinned dim.
- **Where**: `packages/db` migration + Drizzle mirror; local-plane pglite default via `packages/local`.
- **Done when**: migration applied in pglite conformance run; row shape matches design §8.2.

### 0.3 Provenance field groundwork (minimal taint) — **S** · BLOCKS safe 4.x
- **What**: add `origin: 'user'|'sensor'|'connector'|'mcp'|'web'` to `ContextObservation` (`core/src/context-provider.ts`) and tool-output envelopes in `run-context.ts`. No enforcement yet — the field lands NOW so Phase-4 data never needs retro-tagging. Full tainted-context egress gate = security-audit track, parallel.
- **Test**: type-level (field required at construction) + one pipeline test asserting provenance survives into the execution snapshot.

---

## Phase 1 — Ingest & Remember (hypothesis: honest memory from real streams)

### 1.1 `memories` table + MemoryStore extension — **M**
- **Where**: extend `core/src/memory/stores.ts` port (add `status: candidate|confirmed|superseded`, provenance episode links, `last_corroborated_at`); pglite adapter in `packages/local`; migration in `packages/db`.
- **Test**: conformance suite — supersede-never-delete invariant (superseding writes a new row + flips status, old row remains); authority-scoped read filter at the store boundary.
- **Done when**: in-memory + pglite adapters pass the same suite.

### 1.2 Salience Filter + event compaction → ActivitySpans — **M**
- **Where**: new `packages/sensors/src/compaction.ts` — pure functions: `filterSalient(events, denylist)` (T0 rules: drop keystroke noise, dedupe focus, coalesce scroll) + `compactToSpans(events, window)` → `ActivitySpan`. Denylist (password fields, incognito, user-flagged apps) enforced BEFORE any write. Hub (`hub.ts`) pipes provider output through both.
- **Test**: golden fixture streams (recorded, PII-scrubbed) → deterministic span output; volume assertion (output ≤5% of raw fixture events); denylist events NEVER appear in any output.
- **Done when**: a day-long fixture reduces to 500–2000 spans, replayably.

### 1.3 Episode rollups + embedding pass — **M** · needs 0.1, 0.2
- **Where**: `packages/core/src/brain/episodes.ts` (new `brain/` dir) — pure reducers `rollupHourly(spans)` / `rollupDaily(hourlies)`; summarization behind `ModelProvider` (T1 local), deterministic-fallback = template concatenation so kernel runs with zero providers. Embed each level via `EmbeddingProvider`.
- **Test**: reducer purity (same input → same rollup skeleton); fallback path produces valid episodes with no model.
- **Done when**: fixture day → hourly + daily episodes in pglite with embeddings + `source_refs` drill-down links.

### 1.4 Sync Scheduler — **M**
- **Where**: `packages/sourcing/src/sync-scheduler.ts` — `SyncPlan` type, cursor persistence (local store), adaptive cadence as a pure fn over recent delta counts, backoff state. First registered connector: Gmail delta via existing `packages/integrations-google` gateway. All fetches through the gate as cloud-plane sourcing (existing doctrine).
- **Test**: cadence fn table-tests (empty deltas decay to floor; bursts tighten); cursor survives restart (pglite conformance); simulated 429 → backoff.
- **Done when**: scheduler runs Gmail delta sync on a live account without manual triggering, cursors persisted.

### 1.5 Comms-Graph Builder — **L** · needs 1.4
- **Where**: `packages/sourcing/src/comms-graph.ts` — `RawCommsItem` normalizer per connector; entity resolution delegates to `packages/dedupe` with Recon match-tier policy (strong = auto proposal, moderate = pending, ambiguous = `possible_duplicate` Signal, never auto-merge); writes = Person/Touchpoint/Memory proposals via `pipeline.propose` — never direct graph writes. Touchpoint summaries embedded.
- **Test**: match-tier fixtures (one per tier) → correct proposal kind; cross-plane whitelist respected (attempted bad edge refused at write); residency (content local-only, identity dual-write).
- **Done when**: a real Gmail inbox produces reviewable Person/Touchpoint proposals in ApprovalsPage.

### 1.6 PromptAssembler v1 — **M**
- **Where**: `packages/core/src/brain/prompt-assembler.ts` — fixed layer order L0–L5 (design §5), per-layer token budgets in `policy_params`, overflow policy (truncate L4 → L3 tail → compress L5; L0–L2 never truncate). L0 consumes `onboarding-profile.ts` store (this IS the onboarding-profile→CoS-prompt seam — build it here, no bespoke path). L3 retrieval = hybrid pgvector + pg_trgm against `memories`, authority-filtered at store. Wire into `chiefOfStaff.converse`.
- **Test**: budget table-tests (overflow truncates in documented order; L0–L2 survive pathological inputs); `memory_used[]` ids land in the execution snapshot; authority test (private-tier memory absent from an unauthorized agent's assembly).
- **Done when**: CoS answers demonstrably use retrieved memories, and the snapshot proves which ones.

**Phase 1 exit**: connect Gmail + one day of desktop use on a blank workspace → inspectable digests, memories, and comms proposals — all via CaptureLedger, all local-plane.

---

## Phase 2 — Route & Compress (hypothesis: right model, right cost; screen data stays cheap)

### 2.1 TaskEnvelope + Task Classifier — **M**
- **Where**: `packages/core/src/brain/task-classifier.ts` — closed `TaskClass` enum (design §3.2), deterministic keyword fallback FIRST (same pattern as `classifyIntent` in `chief-of-staff.ts`), model path behind ModelProvider with structured output; confidence < τ → one tier up.
- **Test**: fallback-only classification table; low-confidence upgrade rule.

### 2.2 Routing Policy layer — **L**
- **Where**: `packages/models/src/routing-policy.ts` wrapping `createModelRouter` — strict chain plane → modality → capability floor → score(w_q·quality − w_c·cost − w_l·latency) → budget; capability matrix + weights in `policy_params`; budget check ties to trust_grants budget tables (create minimal table if absent — long-tail gap); over-budget → degrade tier + Signal, never silent.
- **Test**: pure-fn conformance table (task_class × constraints → expected provider) — this table IS the spec; plane invariant re-asserted (local-default binding cannot resolve cloud even when scored higher); budget-degrade emits Signal.
- **Done when**: every dispatch through wiring carries a `constraint_trace`.

### 2.3 `routing_metrics` store + outcome labeling — **M** · needs 2.2
- **Where**: `packages/db` migration (design §8.3) + write in `apps/api` wiring at dispatch; outcome grade backfilled from the downstream proposal decision (approve-unedited/edited/veto = free labels — hook in `pipeline.decide`).
- **Test**: dispatch→decide roundtrip writes one complete row; no PII in metrics rows (task_class + ids only).

### 2.4 Frame dedup + AX-first extraction — **L** · coordinates with desktop-companion P1
- **Where**: `packages/sensors/src/frames.ts` — pHash dedup vs last-N per window, keyframe threshold; capture triggers (app-switch-after-dwell, explicit ask, ritual step) not blind timers; frames → existing `LocalMediaStore`. AX extraction rides the desktop-companion track's `accessibility` provider (its P1) — this step consumes it, doesn't build it; if AX answers the need, NO frame is taken.
- **Test**: pHash near-duplicate fixture set (dedupe rate assertion); AX-first guard — an AX-answerable fixture must produce zero frame captures.

### 2.5 Tiered captioning (T2 on-device VLM) — **M** · needs 0.1, 2.4
- **Where**: caption skill behind ModelProvider (Ollama VLM binding, plane_default local — structurally cannot fall to cloud); structured caption shape from design §2.2; T4 vision = explicit egress grant only.
- **Test**: caption schema validation on fixture frames; plane test (caption task with only cloud providers registered → refuses, honest error, never silently degrades privacy).

### 2.6 Retention/aging ritual — **M**
- **Where**: nightly ritual via `ritual-executor.ts`: age raw frames (72 h default) / spans (30 d) / hourly (90 d) per `policy_params`; `archived_at` only; blob-space reclaim from archived frames = the ONE sanctioned physical delete, itself a governed ritual step with ledger entry.
- **Test**: aging table-tests; referenced-by-Memory frame is exempt; ledger row per reclaim.

**Phase 2 exit**: 7-day capture soak fits the local disk envelope; every model dispatch has an auditable constraint trace + metrics row.

---

## Phase 3 — Understand & Curate (hypothesis: knows what you do without being told)

### 3.1 Dream-cycle consolidation ritual — **L** · needs 1.1, 1.3
- **Where**: nightly L1 (act+notify) ritual, local models only: cluster (embedding + entity overlap) → extract candidate facts (T1/T2 structured) → reconcile against `memories` (corroborate ↑confidence / propose supersede / insert candidate) → promote on threshold or user confirmation. Reducers in `core/src/brain/consolidate.ts`, pure where possible.
- **Test**: contradiction fixtures (supersede keeps both rows + provenance); corroboration-threshold promotion; user-stated fact skips to confirmed; ritual replayable via injected Clock/Rng.

### 3.2 UserDomainProfile store + governed diffs — **L** · needs 3.1
- **Where**: `core/src/brain/domain-profile.ts` — schema per design §8.1, immutable versions; dream cycle emits profile DIFFS as proposals; minor = Governance-Agent auto-approve (dual-axis minor), domain/role shifts = approval card. Profile is user-inspectable + editable; **local-plane only, never Commons-minable**.
- **Test**: diff/version invariants (no in-place mutation); minor-vs-major routing fixture; residency test (profile absent from any cloud-plane read path).

### 3.3 Concept extraction — **M** · needs 3.2
- **Where**: term-frequency + embedding clustering over episodes + Touchpoints → concept nodes with evidence links; vocabulary GROWS from evidence (no hardcoded profession lists — invariant).
- **Test**: fixture corpus (synthetic "engineer week" vs "investor week") → distinguishable concept distributions without any profession label in code.

### 3.4 Buddy curation v1 — **M** · needs 3.2
- **Where**: Learning Agent (`core/src/agents.ts`) gains a curation routine: profile slice + staleness → governed-egress research (reuses gate) → relevance × novelty × actionability filter → `insight` Signals, each carrying an action; budget `max_insights_per_week` in `policy_params`. Dismiss/act = labels; thresholds tuned by Variance Adjuster nudges.
- **Test**: budget cap enforced; every emitted Signal has a non-empty action; muted-concept suppression.

### 3.5 complexity_stage inference v1 — **S** · needs 3.3
- **Where**: pure scorer over evidence features (task types, tools adopted, lookup rates) → stage per concept cluster; stage gates suggestion depth in Buddy + Miner ambition later.
- **Test**: monotonicity table-tests (more advanced evidence never lowers stage without decay).

**Phase 3 exit**: two-week-old workspace → profile the user endorses (≥8/10 top concepts "yes that's my work") + ≥1 acted-on insight/week.

---

## Phase 4 — Expand: MCP (hypothesis: safely grows its own hands)

> Prerequisite gate: 0.3 provenance field shipped, and the security-audit taint track at least at "tainted-context egress gate" before any high-autonomy MCP use. H3 (`csp:null`) irrelevant here but H1 (auth-by-default) should be closed before exposing mcp-host over HTTP.

### 4.1 `@bridge/mcp-host` package — **L**
- **Where**: new `platform/packages/mcp-host` — stdio transport first (spawn under sandbox), streamable HTTP second; introspection → DERIVED `capability_manifest` per tool via existing `capability/importer.ts`/`foreign-import.ts` machinery (server self-description = untrusted input, manifest human-reviewed); tool calls route agent → Pipeline → broker → tool (never direct); tool outputs tagged `origin:'mcp'` (0.3) and treated as tainted in prompt assembly.
- **Test**: introspection fixture server → expected manifests; direct-call attempt refused; output provenance asserted end-to-end into snapshot.

### 4.2 Credential broker extension — **L**
- **Where**: extend `core/src/capability/credential-broker.ts` — `{credential_id, capability_id, scope_subset, expires_at, budget}` grants; injection PROXY at the egress edge (server never sees raw token; token stripped from anything written back); revoke = refuse immediately; every injection ledgered as `credential_use`. RFC 8693 token exchange = adapter slot, not v1.
- **Test**: conformance — raw token never appears in any tool-visible payload (grep-the-wire test); expired/revoked grant refused; ledger row per injection.

### 4.3 Gap Detector — **M** · needs 3.2
- **Where**: Learning Agent routine — inputs: task failures ("no capable tool"), profile drift (new concept cluster with `gap_state:none` + no linked capability), explicit ask → emits `capability_gap` Signal with evidence episode ids.
- **Test**: seeded "user starts AWS work" fixture stream → gap Signal with correct domain terms.

### 4.4 Registry search — **M** · needs 4.3
- **Where**: `packages/mcp-host/src/discovery.ts` — order Commons (local `services/commons`, port 4780) → official MCP registry → GitHub (`topic:mcp-server` + domain terms); all fetches = cloud-plane sourcing through the gate; static metadata score (license auto-reject AGPL/SSPL/BUSL per oss policy, recency, adoption, declared auth, signature).
- **Blocker to clear in the same slice**: manifest lacks `license/provenance/content_hash/signature` fields (filed ADR-018 follow-on bug) — add fields to `capability/types.ts` + risk input.
- **Test**: candidate-ranking fixtures incl. a license-poisoned candidate that must be rejected before any trial.

### 4.5 Static vet + sandbox trial — **L** · needs 4.1, 4.4
- **Where**: trial harness over `capability/sandbox-provider.ts` — spawn candidate with NO credentials, NO egress (synthetic/read-only creds only if the probe demands, explicitly flagged); generated probe suite = schema-conformance calls + 3–5 task-shaped evals from the gap's attempted_tasks; scores → `mcp_candidate` record; computed risk with trifecta rule (private-read + egress ⇒ External, human always).
- **Test**: adversarial fixture servers — over-broad scopes, schema drift mid-session, prompt-injection payload in tool output — each caught at the documented stage; egress attempt from trial sandbox refused + logged.

### 4.6 Governed adoption — **M** · needs 4.5
- **Where**: adoption = capability package install through existing `packages.*` tRPC flow (single-live-version, rollback-as-fork); approval card shows what/why/evidence/risk/exact tool list/credential scopes. ≥L2 minimum; trust starts Draft/low, earns per trust-decay model. Connected servers register into the deferred-lookup registry (≤20 tools per turn respected).
- **Test**: end-to-end — gap Signal → candidate → card → approve → governed run; auto-install impossible (no code path).

**Phase 4 exit**: one real third-party MCP server discovered, vetted, approved, used in a governed run — zero raw-token exposure, provenance intact.

---

## Phase 5 — Automate & Co-evolve (hypothesis: gives time back)

### 5.1 Canonical token alphabet — **M** · needs 1.2
- **Where**: `core/src/brain/canonicalize.ts` — spans + comms + in-Bridge actions → `verb(app_class, object_type)` tokens; T0 rules + optional T1 assist; identical work must produce identical strings (determinism test is the point).

### 5.2 Sequence miner — **L** · needs 5.1
- **Where**: `core/src/brain/miner.ts` — closed sequential-pattern mining (PrefixSpan-family) with gap tolerance + periodicity detector; PURE algorithm, zero model tokens (ladder-audit invariant). Runs inside the nightly ritual window.
- **Test**: planted-pattern streams (known support/period) → detection P/R benchmark; pattern-free stream → <1 spurious candidate/week budget.

### 5.3 Candidate scoring + suppression memory — **M**
- **Where**: score = support × regularity × duration × automatability − risk; thresholds in `policy_params` (default ≥3 occurrences / ≥2 weeks / every step capability-mappable); rejected candidates remembered (suppress M days; repeat rejection → negative preference memory).
- **Test**: threshold table-tests; suppression roundtrip.

### 5.4 Planner synthesis → ritual draft + dry-run — **L** · needs 5.3
- **Where**: candidate → existing agentic Planner → proposed DAG whose nodes are REGISTERED capabilities only; unmappable step → `capability_gap` Signal into Phase 4's loop (never a screen-script hack); draft proposal carries evidence ("done 7×, ~12 min each") + step-by-step dry-run preview (P3 SHIP item).
- **Test**: unmappable-step fixture → gap Signal not a broken draft; dry-run preview renders every node with inputs.

### 5.5 Trigger-P/R accounting into two-gate promotion — **M** · depends on agent-eval scoring reducer (its build #1)
- **Where**: run outcomes → episodes → trigger precision/recall stats per mined ritual; promotion L2→L1→L0 requires BOTH gates (quality AND trigger P/R); egress/agent-floor steps pinned ≥L2 forever.
- **Test**: simulation — perfect-output/wrong-trigger workflow must fail gate 2.

### 5.6 Routing bandit v2 + stage-gated depth — **M** · needs 2.3, 3.5
- **Where**: ε-greedy per (task_class, provider) over `routing_metrics`, clamped INSIDE constraint-filtered candidates; preference-order changes = `policy_params` diffs through the Pipeline. Buddy/Miner ambition gated by complexity_stage + trust together.
- **Test**: clamp invariant (bandit can never select a plane/floor/budget-violating provider, adversarial fixture); param change appears as governed diff.

**Phase 5 exit**: ≥1 mined automation adopted and re-run by a real user, minutes-saved measured on the ledger.

---

## Dependency spine & parallelization

```yaml
critical_path: [0.1, 0.2, 1.1, 1.3, 3.1, 3.2, 4.3, 4.5, 5.4]   # each blocks the next listed use
parallel_lanes:                       # independent — run as isolated worktree agents
  lane_A_sensors:   [1.2, 2.4, 2.5, 2.6]        # sensors/compression (desktop-companion coord on 2.4)
  lane_B_connectors: [1.4, 1.5]                  # sourcing/comms-graph
  lane_C_routing:   [2.1, 2.2, 2.3, 5.6]        # models/routing (only 0.x-independent lane)
  lane_D_mcp:       [4.1, 4.2]                   # mcp-host + broker (start once 0.3 lands)
  lane_E_memory:    [1.1, 1.6, 3.1, 3.2, 3.3]   # serial within lane
external_dependencies:
  - desktop-companion P1 accessibility provider   # 2.4 consumes
  - agent-eval scoring reducer (build #1)         # 5.5 consumes
  - security taint track (tainted-egress gate)    # gates Phase-4 autonomy
sizing_total: {S: 3, M: 14, L: 8}                 # ~2 engineer-months serial; lanes compress to ~5-6 wk
```

**First three concrete sessions**: (1) Stage 0 complete (0.1+0.2+0.3 fit one session); (2) 1.1 + 1.2 (memory table + compaction, independent halves); (3) 1.6 PromptAssembler (immediately user-visible: CoS answers from memory). Everything after that runs the lanes.
