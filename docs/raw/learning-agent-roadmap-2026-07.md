---
title: Learning Agent Roadmap — Design, Business, and Technical
type: raw
doc_kind: plan
status: proposed
companions: [governance-agent-roadmap-2026-07.md, builder-agent-roadmap-2026-07.md, bridge-foundational-agents-onboarding-2026-07.md, roadmap-v2-universal-commons.md, undefined-elements-definitions-2026-07.md, security-audit-2026-07.md, desktop-companion-agent-roadmap-2026-07.md]
related_wiki: ../wiki/learning-agent.md
updated: 2026-07-18
tags: [learning-agent, memory, mem0, rag, research, competitor-discovery, prompt-assembler, taint, injection, web-search, recon, search-provider]
---

# 0. Product decision

The Learning Agent is one of Bridge's four permanent platform Agents (ADR-046). It learns from conversations, behavior, corrections, connected systems, and documents; runs external research; builds Organization knowledge, user models, domain knowledge, and relationship understanding; and feeds recommendations to every other agent. Its firm invariant is enforced in code: **`neverExecutes: true`** — it never takes Actions; outputs are Memories, Files/Results, Events, and recommendations, all inspectable.

**Ground truth (audited 2026-07-12).** This roadmap is mostly greenfield:

```yaml
current_state:
  built:
    - "@learning dispatch (packages/core/src/agents.ts + router.ts converse) = static prompt + 512-token model call; no retrieval, no store reads, no tools"
    - neverExecutes:true enforced; requiresApproval:false (it only talks)
    - onboarding profile store (onboarding-profile.ts) — narrow, IN-MEMORY only (animal, answers, phone-verified, connected sources)
    - signals + signal_actions tables (schema.ts) — exist, no Learning producer wired
    - embeddings + embedding_models tables — exist, no retrieval layer over them
  decided_but_unbuilt:
    - Memory/Knowledge kernel primitive — "genuinely absent; a separate, larger build" (onboarding-profile.ts's own comment)
    - Mem0 behind a Memory port (ADR-010f/020/031) — decision ratified, zero mem0 references in source
    - PromptAssembler (ADR-031 §9) — layered persona·capabilities·context·memory·governance-state assembly; buildAgentSystemPrompt is the primitive stand-in
    - competitor-discovery skill (undefined-elements §8) — "policy decided, no mechanism": query synthesis → search → extract → CompetitorBrief
    - integration-over-custom discovery (ADR-020 §7) — Learning checks installed software/browser apps before Builder builds
    - RAG knowledge layer (roadmap-v2 §RAG) — personal/workspace/external; graph traversal + vector + structured filtering; graph stays source of truth
    - ambient suggestions from the desktop context stream (desktop-companion roadmap)
  security_debt_it_inherits:
    - security-audit: Learning is the PRIMARY untrusted-input consumer — captured screen/AX/clipboard and scraped web content would flow into Memory verbatim; no taint marking, no SSRF-hardened fetch, no quarantine. All flagged HIGH, all unbuilt.
```

**Load-bearing invariant — everything it learns is data, never instructions; everything it stores is inspectable.** The Learning Agent is Bridge's biggest prompt-injection surface (it reads email, documents, screens, and the open web). So taint/provenance marking ships in the *first* slice, not as hardening later: every Memory entry carries source + trust tier; tainted content never reaches a tool-bearing context; suggested Memories are proposed and user-visible, never silently absorbed (capture contract: every capture → inspectable Memory entry; avatar blink = the tell; raw capture local-plane only).

**Metadata is not runtime tracking.** PI-1/PI-2 added provenance fields and a tainted-egress policy, but the root gap remains until taint labels propagate through every runtime value and composition boundary. RT0–RT4 below make taint a joined label on source envelopes, retrieved context, prompt segments, model outputs, Skill inputs/outputs, Action arguments/results, Events, Results, and Files; instrument sinks; deny tainted tool-bearing/egress use; and preserve labels across storage, serialization, retries, caches, and cross-process queues.

Learning does not own correction execution. It detects repeated failure/correction patterns and proposes changes. Engine owns bounded operational recovery; Governance owns policy/control remediation; Capability Builder implements tested changes; Human resolves consequential ambiguity.

Competitive frame: ambient desktop agents (Vida, Invoko, AirJelly) and memory layers (Mem0, Graphiti/Letta — reference-only per decisions-log) prove the demand; none combine governed learning (proposed memories, taint tiers, local plane) with a workspace that consumes the knowledge. Bridge's differentiation is that learning output feeds a governed capability platform, not a chat log.

# 1. Design lens — learning surfaces

## 1.1 No learning console

Surfaces are embedded: suggested-Memory cards ("I noticed you always… should I remember that?"), the Knowledge area ("what I know," per onboarding progressive model), research briefs attached to Builder proposals, `@learning` chat answers, and per-Memory inspect/edit/delete. The user can always see what Bridge knows and where each item came from.

## 1.2 Suggested Memories

Learning never silently writes durable knowledge about the user. Observations become *suggested* Memories: card with the claim, the evidence (source excerpts, provenance tier), and accept/edit/reject. Corrections are first-class signals — a rejected suggestion teaches too. High-frequency trivial facts (timezone, name spellings) may auto-accept under a user-granted trust grant (Governance-managed, GA2), receipted like MINOR approvals.

## 1.3 Knowledge area

The onboarding progressive model's "what I know": org knowledge, user model, domain knowledge, relationship understanding — browsable, source-attributed, deletable. Honest empty state until sources connect ("insufficient information… to unlock magic").

## 1.4 Research briefs

Research output is an artifact, not chat: `CompetitorBrief` / `ResearchFindings` with query trail, sources + trust tiers, extraction date, and a summary — attached to the Builder proposal or blueprint that requested it. Stale briefs show their age; nothing is presented as current without a timestamp.

## 1.5 Ambient suggestions (later)

With the desktop sensor plane: Learning observes the context stream (local models, local plane) and surfaces Signals at the right moment ("you're drafting a reply to X — here's the thread history + the promise you made in May"). Always a Signal, never an action.

# 2. Business lens

## 2.1 Processes covered

```yaml
covered_processes:
  memory:
    - conversation/correction/behavior observation → suggested Memories (accept/edit/reject)
    - onboarding profile persistence + enrichment; user model (goals, style, autonomy, privacy prefs)
  knowledge:
    - org/domain/relationship knowledge from connected systems (Gmail/Docs/tasks/CRM), source-attributed
    - retrieval serving every agent: graph traversal + semantic vector + structured filtering (graph = source of truth)
  prompt_construction:
    - PromptAssembler feeds: Agent persona, capabilities, context, Memory, governance state
  research:
    - live external research at blueprint time (competitor-discovery; never hardcoded competitor tables — ADR-012e)
    - integration-over-custom discovery: installed software + browser apps checked (explicit permission, stated intent) before Builder builds
    - overlap/similarity detection vs Component Registry + Commons ("install instead?")
  recommendations:
    - insights routed to CoS/Builder/Governance; ambient Signals from the context stream (sensor plane, later)
```

## 2.2 Explicitly not covered

```yaml
not_covered_or_not_authoritative:
  - executing ANY action (neverExecutes is structural; outputs are Memories/Signals/briefs/recommendations only)
  - silently writing durable user knowledge (suggested-then-accepted, except receipted trivial-fact grants)
  - treating learned/scraped/captured content as instructions (data always; tainted content never meets tools)
  - egress outside the pipeline: research fetches are governed external:fetch through the plane gate; local plane never egresses
  - bypassing website terms, robots.txt, paywalls, or anti-bot during research
  - compiling profiles of third parties beyond the both-party-consent trust model; raw capture stays local-plane
  - cross-tenant learning; Commons receives generalized capability knowledge only, never user data
  - presenting stale or unsourced research as current fact (every brief carries sources + dates)
  - a second knowledge store competing with the graph (vectors index the graph; the graph stays source of truth)
```

# 3. Technical lens

## 3.1 Skills

```yaml
learning_skills:
  - memory-write-proposal            # observation → suggested Memory card (evidence + provenance attached)
  - memory-retrieval                 # port-backed recall serving all agents (Mem0 adapter behind MemoryPort)
  - user-model-maintenance           # goals/style/autonomy/privacy prefs; onboarding profile enrichment
  - knowledge-ingestion              # connected-system content → taint-tiered, source-attributed knowledge
  - retrieval-orchestration          # graph traversal + vector + structured filter, fused (RAG layer)
  - prompt-context-assembly          # PromptAssembler Memory/context layers; tone from explicit communication preferences
  - competitor-discovery             # query synthesis → governed search/fetch → extract → CompetitorBrief
  - installed-software-discovery     # explicit-permission scan → integration candidates for Builder
  - overlap-similarity-detection     # vs Component Registry + Commons; feeds "install instead?"
  - research-brief-synthesis         # ResearchFindings artifact w/ query trail + trust tiers + dates
  - correction-learning              # rejected suggestions/user edits → model-of-user updates
  - taint-classification             # source → trust tier; quarantine routing
```

## 3.2 Automations

```yaml
learning_automations:
  - suggested-memory-batch-digest        # observations accumulate → periodic suggestion cards, not spam
  - knowledge-freshness-sweep            # stale briefs/facts flagged; re-research proposed, never auto-run
  - memory-decay-and-dedupe              # confidence decay, near-dup merge proposals, TTL on ephemeral facts
  - retrieval-quality-eval-run           # scheduled RAG evals against the held-out set
  - source-sync-ingestion                # connected-system deltas → taint-tiered ingestion queue
  - ambient-signal-emitter               # sensor context stream → Signals (local plane, later)
```

Every Automation carries trigger, idempotency key, budget, retry/backoff, owner, stop condition, risk band, immutable run record. None execute actions; research fetches ride governed `external:fetch` proposals.

## 3.3 Injection defense (load-bearing, not optional)

Per the security audit, built alongside — not after — each capability:

- **Taint tiers on every stored item**: user-direct > connected-system > captured-screen/AX/clipboard > open-web. Tier travels with the content forever.
- **SSRF-hardened fetch client** for all research: block RFC-1918/link-local/metadata IPs, DNS-rebinding guard, scheme allowlist — before any Firecrawl/Exa/Stagehand traffic.
- **Dual-LLM quarantine**: tainted content is summarized/extracted by a tool-less quarantine model; only the sanitized, provenance-tagged product enters contexts that have tools. No tool access on tainted context, ever.
- **Injection eval suite**: seeded hostile documents/pages/screen-captures (instructions, exfil lures, tool-call bait) must produce zero behavior changes and zero unauthorized memory writes — a permanent gate, rerun on every model/prompt change.

## 3.4 Model + plane placement

Capture/sensor-plane learning runs on local models by default (data-residency rule: raw capture local-plane only); research synthesis and brief writing can use frontier models via `ModelProvider`; retrieval/embedding is local-plane-compatible (pgvector already in stack). Cheap-tier models for taint classification and dedupe; frontier only where synthesis quality pays.

# 4. Reuse-first source map

```yaml
reuse_policy:
  order:
    - install_or_import_existing_permissive_skill
    - wrap_existing_tool_or_repository_behind_Bridge_port
    - adapt_existing_template_or_workflow_with_attribution
    - integrate_upstream_runtime_without_copying_when_license_allows_service_use
    - build_minimal_Bridge_native_gap_only_after_documented_review
  gates: [pinned_commit, license, transitive_dependencies, security_and_prompt_injection, provenance, contract_and_eval_conformance]
sources:
  mem0:
    use: memory layer (add/search/update/history, user+agent+run scoping) behind Bridge MemoryPort. Code-verified 2026-07-13 — uniform Apache-2.0 (no mixed dirs), pgvector backend real, fully-local provable (ollama llm+embedder+pgvector), taint/provenance stored via metadata JSONB (natively filterable); mem0 has NO taint concept of its own — quarantine policy is Bridge-layer
    mode: Apache-2.0 — the ratified adoption (ADR-010f/020/031); wrap the in-process Memory/AsyncMemory class, ignore server//openmemory//client (their service+platform SDK). MUST-DO on adoption — set MEM0_TELEMETRY=False (ships events to PostHog BY DEFAULT — local-plane violation) and ALWAYS pass explicit local config (zero-config defaults = OpenAI llm/embedder + qdrant). Wrap, don't copy (main.py = 163KB monolith)
    link: https://github.com/mem0ai/mem0
  graphiti_letta:
    use: temporal-knowledge-graph + agent-memory patterns
    mode: REFERENCE-ONLY (decisions-log) — patterns inform the graph-first retrieval design; no adoption
  firecrawl:
    use: SSRF-client reference + optional crawl breadth. Code-verified 2026-07-13 — license MIXED (engine AGPL-3.0, SDKs MIT; apps/api package.json "ISC" is a stale field, ignore it); self-host footprint grew to 5 services (redis+rabbitmq+postgres+foundationdb+playwright); its safeFetch.ts SSRF guard is genuine (connect-time unicast-only check on resolved socket IP, defeats DNS rebinding, survives redirects) but the Playwright render path bypasses it
    mode: PREFERRED VERDICT (revised 2026-07-13) — port the ~95-line safeFetch.ts pattern into Bridge's own SSRF client + drive Playwright directly (Bridge must own SSRF hardening anyway; avoids AGPL + ops burden). Fallback: MIT SDK → separately-deployed AGPL self-host only if crawl/extract breadth is needed; cloud SDK only for cloud-plane research
    link: https://github.com/mendableai/firecrawl
  stagehand:
    use: governed browser extraction where structured APIs don't exist. Code-verified 2026-07-13 — MIT clean; env:"LOCAL" provably Browserbase-free (local Chrome + in-process LLM via own provider clients); Zod extraction schemas ENFORCED client-side (extract output re-validated) → pin to Bridge CompetitorBrief/ResearchBrief at the port
    mode: adopt-behind-port (ADR-031), LOCAL mode only; expose ONLY extract/observe through the port — act() + CUA agent handlers take actions and are gated off for a neverExecutes agent; it has NO SSRF guard of its own — Bridge's SSRF/allowlist + governed-session wrapper fronts every session
    link: https://github.com/browserbase/stagehand
  pgvector:
    use: embedding index over the graph (embeddings tables already in schema)
    mode: already in stack; retrieval layer is the build, not the extension
  mastra_evals:
    use: retrieval/answer quality eval components
    mode: adopt-behind-port (existing stack decision), powers LA retrieval evals
```

# 5. Data and capability model

```yaml
MemoryEntry:
  claim: string                     # the learned fact/preference/pattern
  evidence: source_excerpt[]        # what produced it
  provenance: { source_type: enum, taint_tier: enum, captured_at: timestamptz, plane: local|cloud }
  status: suggested | accepted | rejected | expired
  confidence: decaying
  scope: user | workspace | org
  links: graph_refs[]               # Person/Initiative/Community/… — graph stays source of truth

ResearchBrief:
  kind: competitor | domain | integration_candidate | overlap
  query_trail: string[]
  sources: { url, trust_tier, fetched_at }[]
  synthesis: string
  consumed_by: BuildRequest | Blueprint | Proposal | null
```

Invariants:

- Learning never executes; its writes are Memory proposals, Signals, and briefs — all inspectable, all deletable;
- taint tier travels with content forever; tainted content never meets a tool-bearing context (quarantine model only);
- graph remains source of truth — vectors index it, they never replace it;
- suggested-then-accepted for durable user knowledge; trivial-fact auto-accept only under a receipted, revocable grant;
- research egress is pipeline-governed `external:fetch`; local plane never egresses; raw capture never leaves the local plane;
- Commons publication path receives generalized capability knowledge only — a scrubber gate, not a policy hope.

# 6. Delivery sequence

Universal exit gate (every slice): source/license record, manifest risk computed, tests, held-out eval, browser evidence for changed surfaces, provenance audit, security scan (injection suite from LA0 onward), cost/latency baseline, no dummy runtime data.

```yaml
slices:
  RT0:
    goal: one runtime taint lattice and envelope contract
    deliverables: [TaintLabel source/trust/sensitivity/instructionRisk, deterministic join, required RuntimeValue envelope, serialization contract]
    exit_criteria: every ingest source and stored Memory carries a label; join is monotonic and property-tested
  RT1:
    goal: propagation through prompt/model/Skill/Action paths
    depends_on: [RT0]
    deliverables: [PromptSegment labels, model-output derivation, Skill IO propagation, Action/Event/Result/File propagation, cache/queue/retry preservation]
    exit_criteria: end-to-end provenance trace survives process boundaries with no unlabeled fallback
  RT2:
    goal: sources and sinks instrumented
    depends_on: [RT1]
    deliverables: [screen/clipboard/email/web/MCP source adapters, network/file/credential/schema-mutation sinks, deny-by-default unknown labels]
    exit_criteria: source/sink coverage inventory is complete; uninstrumented sink fails CI/runtime registration
  RT3:
    goal: policy enforcement and quarantine
    depends_on: [RT2]
    deliverables: [no tainted content in tool-bearing context, egress join gate, dual-model quarantine, declassification only by deterministic validator or explicit human Decision]
    exit_criteria: injection/exfiltration/red-team suite has zero unauthorized Actions and zero label loss
  RT4:
    goal: operations, migration, and observability
    depends_on: [RT3]
    deliverables: [backfill existing data, taint trace UI, metrics/alerts, incident replay, compatibility removal]
    exit_criteria: production-like replay proves propagation; old unlabeled records quarantined or classified; runtime taint root gap closed
  LA0:
    goal: the Memory primitive exists — taint-tiered from day one
    depends_on: [pgvector (in stack), Mem0 adoption decision (ADR-010f)]
    deliverables:
      - MemoryPort + Mem0 adapter (local-plane compatible); MemoryEntry schema incl. provenance/taint/status/decay
      - onboarding profile moved from in-memory to persistent store, feeding the user model
      - taint-classification skill + tier propagation; injection eval suite v1 (permanent gate starts HERE)
      - suggested-Memory write path: propose → accept/edit/reject; per-entry inspect/delete
    exit_criteria:
      - a Memory round-trips propose → accept → retrieval → deletion, with provenance intact at every step
      - injection suite: seeded hostile content produces zero unauthorized writes and zero behavior change (gate, reruns forever)
      - onboarding answers survive restart and are visible/editable in the Knowledge surface (honest empty state otherwise)
  LA1:
    goal: what Bridge knows shapes how agents behave — PromptAssembler live
    depends_on: [LA0]
    deliverables:
      - PromptAssembler v1 (shared build with Builder BA0): persona · capabilities · context · memory · governance-state layers
      - onboarding profile → Chief of Staff persona construction (closes the foundational-agents open item)
      - Avatar visual style remains UI-only; Agent tone derives from explicit communication preferences and eval-gated Memory, never Avatar style
      - memory-retrieval serving @-dispatched agents (grounded answers replace prompt-only stubs)
    exit_criteria:
      - the same question answered before/after an accepted Memory demonstrably changes agent output (the learning-visible test)
      - assembled prompts fit a token budget with layer-level accounting; governance-state layer present in every agent call
      - tone eval: two explicit communication preferences produce measurably distinct register on a fixed prompt set, without content divergence
  LA2:
    goal: Bridge learns from being used — observation + correction loops
    depends_on: [LA1]
    deliverables:
      - conversation/correction observation → suggested-Memory digest (batched, not spam); correction-learning updates the user model
      - connected-system ingestion (Gmail/Docs first — integrations shipped) → taint-tiered knowledge with source attribution
      - Signals producer wired (signals tables exist): learning insights emit Signals routed to CoS
      - memory decay + dedupe automations; trivial-fact auto-accept behind a receipted grant (Governance GA2 mechanism)
    exit_criteria:
      - a user correction measurably changes subsequent suggestions (held-out correction-replay eval)
      - every ingested knowledge item shows its source; rejected suggestions never resurface verbatim (dedupe test)
      - suggestion volume stays under the digest cap (annoyance guard, measured)
  LA3:
    goal: the research lane — live external knowledge, safely fetched
    depends_on: [LA0 taint infra, pipeline external:fetch gate (shipped)]
    deliverables:
      - SSRF-hardened fetch client (RFC-1918/metadata block, DNS-rebinding guard, scheme allowlist) — BEFORE any crawler integration
      - competitor-discovery skill: query synthesis → governed search/fetch (Firecrawl-behind-port after license review; Stagehand for JS-only permitted pages) → dedupe → CompetitorBrief
      - dual-LLM quarantine for all fetched content; research-brief artifacts with query trail + trust tiers + dates
      - source-trust registry + result caching (undefined-elements §8 open items)
    exit_criteria:
      - SSRF suite green (metadata endpoints, rebinding, redirect chains — seeded); zero fetches bypass the pipeline gate (negative test)
      - a real blueprint-time competitor brief is produced for a test domain with cited, dated sources — no hardcoded competitor data anywhere (ADR-012e audit)
      - hostile-page suite: injection content in fetched pages never reaches a tool-bearing context (quarantine proof)
  LA4:
    goal: integration-over-build becomes real — Learning feeds the Builder
    depends_on: [LA3, Component Registry (Builder wave)]
    deliverables:
      - installed-software/browser-app discovery (explicit permission, stated intent) → integration candidates
      - overlap/similarity detection vs Component Registry + Commons; ResearchFindings handoff consumed by Builder BA1+ ("install instead?" evidence)
      - research-before-build wired into the Builder pipeline's research stage
    exit_criteria:
      - a build intent for an already-integrable tool yields an integration proposal, not a from-scratch build (end-to-end test with a real installed app)
      - discovery runs only after an explicit, logged permission grant (negative test: no grant → no scan)
      - Builder proposals render the Learning research trail (BA4 card completeness depends on this)
  LA5:
    goal: retrieval at platform quality — the RAG layer
    depends_on: [LA2, EVAL-1/2 (eval harness)]
    deliverables:
      - retrieval-orchestration: graph traversal + semantic vector + structured filtering, fused; graph stays source of truth
      - personal/workspace/external knowledge layers (roadmap-v2 §RAG) with plane + visibility enforcement
      - retrieval eval set (held-out Q→evidence pairs from real usage) + scheduled eval automation (Mastra components)
    exit_criteria:
      - retrieval eval: precision/recall measured and baselined; regressions block ship from here on
      - cross-plane leak test: local-plane content never surfaces in cloud-plane retrieval (hard invariant)
      - RLS/visibility respected in retrieval for team scopes (aligns with SEC-5/SEC-6)
  LA6:
    goal: ambient — learning from the context stream, still never acting
    depends_on: [LA5, desktop sensor plane (desktop-companion roadmap), Tauri capture core (P0)]
    deliverables:
      - sensor context-stream consumption on local models, local plane (capture contract: inspectable entries, avatar-blink tell)
      - ambient-signal emitter: right-moment Signals with linked context; org-knowledge aggregation for teams (consented scopes only)
      - captured-content taint tier enforced end-to-end (screen/AX/clipboard = high-taint, quarantined like web content)
    exit_criteria:
      - every capture-derived Memory is inspectable and attributed to its capture moment; blink-tell fires on capture (contract test)
      - injection-via-screen suite: hostile on-screen content produces zero behavior change (the audit's HIGH gap, closed and gated)
      - ambient Signals are rate-capped and dismissible; dismissals teach (correction loop applies)
```

## 6.1 Success measures

```yaml
metrics:
  memory_quality: suggested-Memory acceptance rate; correction-incorporation rate; duplicate/stale complaints (target ~0)
  retrieval: precision/recall on the held-out eval set (baselined LA5, regression-gated)
  research: briefs consumed by Builder proposals; source citation completeness; brief staleness at consumption
  restraint_integration: % of build intents resolved by integrate-instead-of-build (shared metric with Builder — Learning's discovery drives it)
  safety: injection-suite pass == 100%; unauthorized memory writes == 0; executed actions == 0; cross-plane leaks == 0 (hard invariants)
  ux: suggestion volume vs digest cap; time-to-first-useful-memory after onboarding
```

## 6.2 Risk register

```yaml
risks:
  prompt_injection:
    risk: the platform's largest injection surface — email, docs, screens, open web all flow here (audit: HIGH)
    mitigation: taint tiers from LA0 (not retrofitted); dual-LLM quarantine; no tools on tainted context; permanent injection suite gating every slice
  memory_poisoning:
    risk: hostile or wrong content becomes durable "knowledge" steering every agent
    mitigation: suggested-then-accepted for durable writes; provenance visible on every card; decay + easy deletion; quarantine before storage
  ssrf_and_egress:
    risk: research fetches reach internal/metadata endpoints or bypass governance
    mitigation: hardened client BEFORE crawler integration (LA3 ordering); all fetches via pipeline external:fetch; local plane never egresses (plane gate, built)
  privacy_creepiness:
    risk: accurate-but-unsettling memories destroy trust faster than wrong ones
    mitigation: everything inspectable/deletable; capture contract (blink tell); suggestion framing ("should I remember?"); raw capture local-plane only; both-party consent holds
  memory_bloat_staleness:
    risk: unbounded accumulation degrades retrieval and surfaces outdated facts as current
    mitigation: confidence decay, TTLs on ephemeral facts, dedupe merge proposals, freshness sweep; retrieval evals catch degradation
  license_exposure:
    risk: Firecrawl AGPL contaminates the research lane
    mitigation: behind-port + service-use or reviewed self-host only; Playwright fallback documented; license gate in reuse policy
  vector_store_drift:
    risk: the embedding index quietly becomes a second source of truth diverging from the graph
    mitigation: vectors index graph nodes only (refs, not copies); rebuildable from graph at any time (rebuild test at LA5)
  dependency_chain:
    risk: LA4 needs Component Registry; LA5 needs EVAL-1/2; LA6 needs the sensor plane — three external gates
    mitigation: LA0–LA3 are self-contained and deliver standalone value; later slices degrade gracefully (research works without registry; retrieval ships baselined without scheduled evals)
```

Sequencing note: LA0/LA1 overlap P0–P1 commitments (Memory seam, PromptAssembler ADR-031, onboarding profile ADR-034) — they refine those tracks, no H2 sequencer reorder; pull-forwards via `docs/APPROVALS.md`. LA1's PromptAssembler is a shared build with Builder BA0 (one subsystem, two consumers — build once). LA3's SSRF/quarantine work is the same hardening the security audit demands; closing it here closes those findings. Cross-roadmap: Builder BA1+ consumes LA3/LA4 research; Governance GA2 supplies the trivial-fact grant mechanism; Commons ingestion trust (egg-commons CM slices) reuses LA taint/provenance infrastructure.

# 7. LA3 web-research provider survey — Tier 1/2/3 candidate Integrations (2026-07-17)

LA3's research lane needs concrete web-search/extraction backends behind its SSRF-hardened client. This section records a full-market survey (178 candidates reviewed, sourced from a Parallel.ai FindAll run) so LA3 doesn't start from zero when it builds the fetch layer. Full raw classification (per-provider notes, discarded-group reasoning): `outputs/2026-07-17-learning-agent-recon-search-integrations.md`. Decision record: ADR-111 (`decisions-log.md`). Execution task: TASK-023.

```yaml
search_provider_port:
  shape: "same port/adapter pattern as ModelProvider/MemoryStore/ContentGuard — one interface, swappable backends, no caller change on provider swap"
  taint: "every result carries untrusted_external taint (PI-1/PI-2) before reaching Memory or a prompt — no new mechanism, reuse of the shipped pipeline"
tier_1_free_direct_no_account:
  approved_now:
    - parallel_search_mcp: "https://search.parallel.ai/mcp — anonymous HTTP MCP, web_search, $0; official anonymous-access docs + live protocol/terms headers verified 2026-07-18"
  rights_gated:
    - jina_ai_search_foundation: "BLOCKED 2026-07-18 — current official access terms require registration/key and disallow the assumed generic keyless automated-client path; no adapter ships"
    - duckduckgo_instant_answer: "BLOCKED 2026-07-18 — current automated/commercial permission could not be verified and API-domain robots policy disallows the assumed path; no adapter ships"
tier_2_free_tier_signup_required:
  count: 33
  examples: [Exa, Tavily, You.com API, Brave Search API, SerpAPI, Serper, Firecrawl, Linkup, Apify, Browserbase, Steel.dev, ZenRows, ScrapingBee]
  full_list: "outputs/2026-07-17-learning-agent-recon-search-integrations.md"
  credential_pattern: "Bridge's existing vault (same shape as DealPilot Source credentials, TASK-006)"
tier_3_paid_or_self_hosted_only:
  paid_enterprise: [Perplexity Sonar, Bright Data, Oxylabs, Nimble, Nebius, Azure AI Search, Reworkd, Webz.io, Klue, Contify, xAI/Grok API, DataForSEO, Gemini Deep Research Agent]
  self_hosted_only_no_hosted_endpoint: [Crawl4AI, Scrapy, OrioSearch, Vane, SearXNG]
  infra_only: [Roundproxies]
rollout:
  phase_1: "$0 — wire only rights-verified Parallel Search MCP behind the SearchProvider port; taint every result; fail explicitly if unavailable"
  phase_2: "$0 at eval volume — add 2-4 proven Tier-2 providers (not all 33) as fallback adapters once Tier-1 coverage proves insufficient for a real need"
  phase_3: "paid, evaluation-gated — Tier-3 only behind an explicit cost/ROI proposal + APPROVALS.md gate, never a silent default"
  non_goal: "self-hosted-only Tier-3 items deferred indefinitely — no hosting decision made for them yet"
rights_review:
  decision: "ADR-113 / AP-040 supersede only ADR-111's assumption that all three surveyed Tier-1 candidates were currently lawful direct-access adapters"
  recheck_rule: "provider rights metadata expires after 90 days; changed Parallel terms/privacy headers stop execution pending review"
```
