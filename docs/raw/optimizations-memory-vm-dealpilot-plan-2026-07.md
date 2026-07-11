---
title: Optimizations + Memory + Isolated Computer + DealPilot Strengthening Plan
type: raw
doc_kind: plan
status: proposed
companions: [token-efficient-development-2026-07.md, oss-commons-integration-plan-2026-07.md, dealpilot-architecture-requirement.md, dealpilot-module-plan-2026-07.md]
related_wiki: ../wiki/optimizations.md
updated: 2026-07-11
tags: [optimizations, tokens, memory, vm, dealpilot, packages, roadmap]
---

# Outcome

Add an installable **Optimizations** package serving two customers through one kernel service:

1. Bridge developers/agents: cheaper orientation, retrieval, tool output, prompts, and verification.
2. Compiled workspaces: measurable token, latency, and model-cost reduction without hiding lost evidence.

Strengthen **DealPilot** as a governed investment-work package, not a monolithic autonomous deal bot. Add an **Isolated Computer** execution target only where account separation, host safety, reproducibility, or disposable state justifies its cost.

# 1. Current-state verdict

```yaml
developer_token_system:
  status: partly_shipped
  strengths:
    - wiki-first / raw-second / code-last reading
    - caveman wiki summaries
    - CODEMAPS and repository navigation index
    - skill scoping and a <4k orientation-token target
  missing:
    - runtime payload compression
    - per-run token attribution and budgets
    - compression-quality evaluation
    - cache/reuse policy
    - user-facing savings controls and receipts

platform_memory:
  status: designed_more_than_built
  strengths:
    - Memory is a governed first-class primitive
    - graph source-of-truth plus vector assistance
    - scope, plane, provenance, confidence, supersession, and audit requirements
    - Mem0 planned behind MemoryEngine port with local-plane compatibility
  missing_or_unverified:
    - production MemoryEngine implementation and API surface
    - policy-only retrieval path
    - session search
    - correction and failure capture
    - capacity consolidation and aging
    - secret/prompt-injection scanning before persistence
    - pre-compaction and shutdown flush hooks
    - procedural-memory-to-Skill proposal loop
```

Verdict: developer optimization foundation is good but static. Platform optimization is absent. Memory design is broader and safer than pi-hermes-memory; pi-hermes-memory is much more effective today because its core loop exists and is tested. Bridge should borrow its lifecycle patterns, not its Markdown/SQLite storage choices wholesale.

# 2. Optimizations package

## Product/design lens

Optimizations appears as one installable add-on with a quiet default. No “compression magic” claim. Every optimized run exposes a receipt:

- original tokens / optimized tokens / estimated cost and latency saved;
- transformations applied;
- evidence-loss risk and fallback used;
- “inspect original” and “rerun lossless” actions;
- workspace policy: Balanced default, Lossless, Aggressive, Custom;
- budgets by workspace, Agent, Automation, package, model, and external connector.

Primary surfaces:

- Control Panel → Optimizations: savings, quality, policy, budgets, exceptions.
- Run detail → Optimization receipt beside model/prompt provenance.
- Package install → declared optimization compatibility and minimum evidence policy.
- Capability Builder → “optimize this capability” proposal with baseline comparison.

## Business lens

Value: lower gross inference cost, faster responses, higher usable context, and explainable spend. Monetization should be indirect first: preserve margin and make usage limits feel fair. Later, Advanced Optimization can be a team/enterprise control feature, never a surcharge on basic efficiency.

North-star: **quality-adjusted cost per successful outcome**, not raw tokens saved.

```yaml
metrics:
  cost:
    - input_tokens_saved_pct
    - model_cost_saved_usd
    - cache_hit_rate
  speed:
    - time_to_first_token_delta
    - end_to_end_latency_delta
  quality:
    - task_success_delta
    - citation_recall
    - factual_consistency
    - user_rerun_lossless_rate
  safety:
    - evidence_loss_incidents
    - secret_redaction_leaks
    - prompt_injection_survival_rate
```

Go/no-go: no transform defaults on until held-out eval shows non-inferior success and required evidence/citations survive.

## Technical lens

Create `OptimizationEngine` behind a port. Pipeline stages:

1. Classify payload: code, logs, HTML, JSON, documents, conversation, memory, evidence.
2. Apply deterministic lossless transforms first: HTML→semantic Markdown, boilerplate removal, URL aliasing, stable dedupe, whitespace/schema compaction, repeated tool-output folding, line-range anchors.
3. Retrieve only scoped/hot context instead of injecting stores wholesale.
4. Apply semantic compression only when policy permits; preserve immutable source anchors.
5. Assemble prompt under a declared budget; route model by quality/cost/latency and plane.
6. Emit immutable receipt; compare output against unoptimized baseline via sampling.

```yaml
ports_and_records:
  ports:
    - OptimizationEngine
    - TokenEstimator
    - ContextSelector
    - CompressionTransform
    - OptimizationEvalStore
  records:
    - optimization_policies
    - optimization_runs
    - optimization_transforms
    - prompt_budgets
    - context_cache_entries
    - optimization_eval_results
  invariants:
    - originals remain addressable in their permitted plane
    - compressed text is derived data, never source-of-truth
    - citations resolve to original source spans
    - secrets are removed before any cloud transform
    - external/untrusted content retains taint through compression
    - financial/legal evidence defaults lossless
```

TokenJuice inspiration: compress every tool/search/scrape payload before model entry; retain grapheme-safe Unicode; prefer deterministic transforms; measure savings. Do not accept “up to 80%” as a Bridge promise until independently benchmarked.

## Delivery slices and ROI

```yaml
delivery:
  - slice: O0 observability
    priority: P0
    roi: very_high
    scope: token/cost/latency attribution, prompt receipts, per-run budgets
  - slice: O1 lossless compression
    priority: P1
    roi: very_high
    scope: HTML/JSON/log/tool-output transforms, dedupe, anchors, cache
  - slice: O2 retrieval-first context
    priority: P1
    roi: very_high
    scope: policy-only memory, hot-context selection, deferred tool/package disclosure
  - slice: O3 semantic compression
    priority: P2
    roi: medium
    scope: model summaries with source anchors and quality gates
  - slice: O4 adaptive optimizer
    priority: P3
    roi: medium
    scope: per-capability policies learned from evals, governed proposals only
```

# 3. Memory comparison and target architecture

pi-hermes-memory supplies a practical two-tier global/project memory, policy-only prompt mode, SQLite FTS session search, correction/failure learning, background review, consolidation, aging, secret scanning, and lifecycle flushes. Bridge should map these into its primitives:

```yaml
mapping:
  global_memory: Human-scoped Memory
  project_memory: Workspace/Element-scoped Memory
  session_search: Incident/Request/Artifact retrieval index
  failure_memory: typed Memory category=failure linked to Incident and run
  correction_memory: Human feedback linked to superseded Memory/output
  procedural_skill: proposed Skill generated from repeated procedural Memory
  markdown_source: not_adopted_as_canonical_store
  sqlite_fts: local adapter option, not universal architecture
```

Target memory flow:

capture/interaction → local secret + injection scan → classify episodic/semantic/procedural/preference/failure/correction → dedupe/conflict check → governed write or proposal → graph association + lexical/vector indexes → policy-only retrieval → fenced context with source/confidence/age → run audit → consolidation/supersession.

Required controls:

- memory is context, never instruction; current user/repo/policy evidence wins;
- retrieval filtered by workspace, subject, data scope, plane, recency, confidence, category;
- user can inspect, correct, pin, forget, export, and see “why recalled”;
- immediate correction capture; periodic background learning with explicit compute budget;
- pre-compaction/shutdown flush; idempotent indexing/backfill;
- consolidation preserves contradictions and provenance instead of flattening them;
- automatic Skill creation remains a proposal and must pass capability evaluation.

Benchmark before claiming superiority: recall@k, precision@k, stale-memory rate, correction carryover, secret-block rate, prompt tokens per answer, latency, and human override rate on a fixed longitudinal task set.

# 4. Isolated Computer / VM policy

User account constraints become executable policy, not prompt text. If user says “do not use account X” or “use only account Y,” CredentialBroker resolves allowed identities. Prefer an isolated browser profile/container when enough; use a VM when OS-level isolation or a full desktop is required.

```yaml
execution_target_order:
  - governed_host_tool
  - isolated_browser_profile
  - container_or_microvm
  - full_interactive_vm
selection_rule: least_isolated_target_that_proves_policy_and_safety
```

High-value VM use cases:

- strict account/profile separation and proof no host session was touched;
- untrusted code, files, packages, macros, or websites;
- broad browser/desktop automation across apps;
- destructive or dependency-mutating development/build work;
- reproducible customer environments, OS/version testing, and support reproduction;
- disposable research with downloads and unknown executables;
- long-running autonomous jobs needing quotas, snapshots, pause/resume, and teardown;
- regulated/client data requiring tenant-dedicated compute;
- demonstrations/training where human watches and can intervene;
- parallel agents whose dependencies or credentials must not contaminate one another.

Poor-ROI VM cases: read-only API retrieval, one trusted file edit, normal local inference, or actions already safely scoped by a connector. VM does not replace egress governance, credential scoping, approvals, content scanning, or audit.

Open Computer inspiration: visible human-in-loop desktop, ask-user channel, QEMU isolation, one disposable computer per agent. Adopt patterns behind `SandboxProvider`; do not embed until license/dependency and maturity gates pass.

```yaml
roadmap_fit:
  P0:
    - execution-target policy types
    - credential/account allow-deny constraints
    - audit proof of selected account/profile
  P3:
    - container/microVM SandboxProvider for Capability Builder and untrusted execution
    - snapshot, quota, network-off-default, teardown
  P4:
    - optional visible Isolated Computer package for cross-app desktop work
    - human observe/intervene/ask-user
  P6:
    - tenant-dedicated and remote pools if demand justifies operations
```

# 5. DealPilot strengthened package

Detailed navigation, object contents, business coverage/exclusions, Agents, Skills, Automations,
integrations, and reuse decisions now live in `dealpilot-module-plan-2026-07.md`. This section is the
summary only.

## Product/design lens

DealPilot becomes a modular deal room following the existing package plan:

1. **Inbox & sourcing** — source health, listings, dedupe, saved searches, comparison to prior runs.
2. **Thesis & triage** — user-authored criteria, transparent deterministic/ML score components, R/Y/G queue, permanent tenant-scoped discard.
3. **Evidence room** — material inventory, provenance matrix, conflicts, missing-data requests, confidence.
4. **Diligence workbench** — hypothesis tree; business, industry, financial/QoE, legal/tax/IP referral, management, valuation/returns, exit, terms.
5. **IC room** — decision-first memo, red-flag register, scenarios, dissent/assumption log, approval history.
6. **Execution** — outreach drafts, data requests, diligence tasks, closing conditions, 100-day plan; external sends always separately approved.
7. **Learning** — flags and corrections become eval cases and proposed thesis/playbook updates, never silent model retraining.

Every claim opens evidence. Every red flag must state deal impact: stop, pause, reprice, condition, protection, specialist review, or post-close action. Specialist domains identify risk and referral needs; never impersonate legal, audit, tax, patent, environmental, or safety sign-off.

## Business lens

Primary ICP: ETA/search-fund and lower-middle-market deal teams first; later PE/VC/growth adapters. Value = more opportunities screened with higher evidence discipline, faster CIM-to-IC cycle, and institutional learning that survives team turnover.

Packaging:

- Core: sourcing, thesis, triage, evidence room, instant brief.
- Diligence: playbooks, QoE-lite, red flags, IC memo.
- Execution: outreach, data-room requests, closing/100-day plan.
- Optional LP/Fund Selection adapter: manager/fund screening, explicitly separate from company-deal underwriting.

KPIs: hours from listing→triage, CIM→draft memo, evidence coverage, unresolved P0/P1 count, false-positive triage, IC decision reversals, sourced→engaged conversion, and cost per screened/pursued deal.

## Technical lens

Preserve existing sources→listings→deals→facts→analyses spine and PackageManifest. Add capabilities, not a second runtime:

```yaml
capabilities:
  - source-health-and-extraction
  - canonical-deal-resolution
  - thesis-versioning-and-triage
  - material-inventory
  - hypothesis-tree
  - evidence-matrix
  - red-flag-gate
  - financial-qoe-lite
  - valuation-return-exit-scenarios
  - ic-memo-and-decision-log
  - diligence-request-and-interview-guides
  - closing-conditions-and-100-day-plan
  - deal-learning-evals
adapters:
  transaction: [eta, buyout, growth, vc, pre_ipo, strategic]
  industry: [saas, services, manufacturing, consumer, healthcare, technology]
  output: [brief, ic_memo, red_flag_scan, data_request, interview_guide, html, docx, xlsx, pptx]
```

Source inspirations:

- private-equity-investment-dd-skill: material boundary, claim→evidence→source→status→gap→deal implication, P0/P1/P2 red flags, specialist boundaries, transaction actions.
- financial-services-plugins-new: end-to-end research→model→document workflow, firm-customizable templates, MCP/data connectors, Excel/Word/PowerPoint outputs.
- deal-evaluator: multi-site collection, compare-to-prior-run, simple explainable keyword scoring; adopt pattern, replace brittle Selenium/BeautifulSoup implementation.
- PE Fund Selection ML: prediction support using fundraising-known factors and PME threshold; use only in separate LP adapter with calibrated probability, dataset provenance, bias/drift checks, and deterministic baseline. Reported research accuracy is not production evidence.
- SmallPE: direct repository inspection completed 2026-07-11. Real assets include a Managing Partner,
  seven specialists, MRL/evidence/business-evaluation/thesis/impact workflows, document conversion,
  and branded output tools. Current FSL-1.1 prohibits competing commercial use, so Bridge may not
  vendor/copy/derive these assets without permission or license transition. Partnership, licensed
  import, interoperability, and high-level functional reference remain valid paths.
- pi-hermes-memory: correction/failure learning, policy-only retrieval, session continuity, procedural playbooks.

Security/governance:

- raw data-room content remains private/local or tenant plane; derived facts retain source anchors;
- management claims form hypotheses, not conclusions;
- external research stays tainted until corroborated;
- account-specific actions use CredentialBroker policy and isolated execution when needed;
- scraper/browser connectors have domain budgets, rate limits, legal/ToS review, and kill switches;
- ML scores never auto-reject or auto-invest; they are evidence-labeled decision support;
- report generation runs redaction, citation, formula, and layout QA.

# 6. Sequencing / dependencies

```yaml
recommended_order:
  - rank: 1
    item: Optimization O0 observability
    reason: low complexity, immediate platform-wide margin and measurement value
  - rank: 2
    item: Memory M0 retrieval/security lifecycle
    reason: prerequisite for trustworthy learning and retrieval-first token savings
  - rank: 3
    item: DealPilot evidence matrix + red-flag gate
    reason: highest user-value and risk-reduction within first compiled package
  - rank: 4
    item: Optimization O1 lossless transforms
    reason: measurable savings with low evidence risk
  - rank: 5
    item: DealPilot end-to-end artifacts and eval loop
    reason: converts analysis into repeatable team outcomes
  - rank: 6
    item: sandbox container/microVM adapter
    reason: needed before unsafe builder/import/browser workloads scale
  - rank: 7
    item: visible full VM package
    reason: valuable but higher operational cost and narrower demand
  - rank: 8
    item: semantic/adaptive compression and LP fund-selection ML
    reason: quality/model-risk gates and weaker near-term ROI
```

Dependencies: security P0, runtime taint, durable package store, MemoryEngine port/implementation, token/eval telemetry, CredentialBroker identity constraints, SandboxProvider. No roadmap batch reorder is made here; scheduling into the authoritative six-month sequencer requires the canon approval gate.

# 7. External source intake

Add these to Commons inspiration candidates, subject to pinned-commit, license, artifact-license, transitive-dependency, security, provenance, and conformance review:

```yaml
candidates:
  - tinyhumansai/openhuman
  - chandra447/pi-hermes-memory
  - Mintplex-Labs/anything-llm/open-computer
  - noahnan-max/private-equity-investment-dd-skill
  - yuping322/financial-services-plugins-new
  - sradgowski/deal-evaluator
  - xrishiraj/Private-Equity-Fund-Selection-through-ML
  - parolkar/SmallPE
```
