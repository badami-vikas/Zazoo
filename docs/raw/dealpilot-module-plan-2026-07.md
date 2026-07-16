---
title: DealPilot Detailed Module Plan — Design, Business, and Technical
type: raw
doc_kind: plan
status: proposed
companions: [dealpilot-architecture-requirement.md, optimizations-memory-vm-dealpilot-plan-2026-07.md, oss-commons-integration-plan-2026-07.md, dealpilot-design-requirements-2026-07.md, clean-room-capability-research-protocol-2026-07.md, requirement-dealpilot-eta-agent-skill-red-flag-2026-07-15.md, agent-goal-skill-orchestration-plan-2026-07.md]
related_wiki: ../wiki/packages.md
updated: 2026-07-15
tags: [dealpilot, eta, module, design, business-process, agents, skills, automations, reuse]
---

# 0. Product decision

DealPilot is one installable ETA Module and one primary global-nav item. It is not seven unrelated top-level apps. Its only default Pages are Deals, Sources, and Theses.

```yaml
navigation_layers:
  global_sidebar:
    item: DealPilot
    purpose: enter package
  module_navigation:
    form: top toggle selector for default Database Pages
    items: [Deals, Sources, Theses]
  object_navigation:
    form: Record Detail Sections within selected Deal/Source/Thesis; collapses appropriately on narrow screens
    purpose: show every Field, File, Result, Relation, Task, Integration, and related activity around one Record without creating more Pages
```

Reason: one top-level Module keeps Bridge composable. Three Database Pages match independent schemas. Record Detail keeps CIM, QoE, hypotheses, evidence, valuation, and Decision history attached to the Record they explain.

# 1. Design lens — exact information architecture

## 1.1 Module health and attention Section

Purpose: partner-level operating view, not generic dashboard.

Sections:

- decision queue: new deals awaiting triage, P0/P1 issues, evidence gaps, IC decisions, approvals;
- pipeline by stage and thesis;
- active diligence health: MRL completion, overdue requests, contradiction count, evidence coverage;
- sourcing health: source failures, new matches, duplicate merges, cost/yield;
- upcoming meetings and deadlines;
- recent changes: new CIM, revised financial, thesis change, score/verdict diff;
- Agent activity and optimization receipts;
- configurable saved views, never fabricated KPIs.

## 1.2 Deals — primary Element list

Each row/card represents a canonical **Deal Element**. CIM, QoE, hypothesis trees, models, evidence, outreach, IC memos, and closing work are linked objects inside it—not competing top-level Deal records.

Default columns:

- company/deal name, logo if sourced, source/listing link;
- stage: sourced → triage → engaged → NDA/CIM → diligence → IC → LOI → closing → portfolio / passed;
- R/Y/G decision state and thesis-fit score;
- assigned thesis and transaction adapter;
- asking price, revenue, EBITDA/SDE, implied multiple, geography, industry;
- source freshness and number of merged listings;
- evidence coverage and unresolved P0/P1 flags;
- latest document/change;
- owner, next action, next deadline;
- last Agent run and pending approval.

Saved list views/toggles:

- Pipeline · New/Triage · Pursue · Diligence · IC · LOI/Closing · Passed/Archived;
- Table · Board by stage · Cards · Timeline · Map;
- My deals · Team deals · All permitted;
- thesis selector; source; owner; industry; geography; size; score; evidence status; flag severity;
- “changed since last review,” “missing CIM,” “blocked,” and “needs human decision.”

Bulk actions: assign, stage proposal, request documents, export, compare, archive. External outreach remains per-run approval; never bulk-send by default.

## 1.3 Deal detail — complete object workspace

Header always visible: company, stage, R/Y/G, thesis fit, owner, next action, evidence health, key economics, approval state, source freshness.

Object tabs and exact contents:

```yaml
deal_tabs:
  Summary:
    - decision-first brief
    - why it fits / why it may fail
    - key economics and current normalized metrics
    - top assumptions, P0/P1 flags, evidence gaps
    - next actions, upcoming meetings, recent changes
  Profile:
    - legal entities, history, ownership, management, locations
    - products/services, customers, channels, suppliers, competitors
    - source-linked living facts with confidence and supersession history
  Listings:
    - every merged source listing
    - duplicate/match rationale, price/history changes, source health
  Documents:
    - CIM, teaser, NDA, financials, tax, QoE, contracts, data-room files, transcripts
    - version, status, received source/date, parser result, redaction, citations
    - document viewer with page/section anchors
  Hypotheses:
    - investment thesis tree
    - must-be-true assumptions
    - business, market, financial, legal, management, value-creation, exit branches
    - evidence for/against, confidence, owner, next test, status
  Evidence:
    - claim → evidence → source → verification status → gap → deal implication
    - verified / partial / unverified / contradicted / requires diligence
    - contradictions, source hierarchy, freshness, reviewer, audit history
  Diligence:
    - workstream dashboard
    - Master Request List; request owner, target owner, due date, status, blocker
    - management/customer/supplier/expert interview guides and notes
    - commercial, operational, technology, HR, legal/tax/IP referral, ESG/impact adapters
  Financials:
    - normalized P&L, balance sheet, cash flow, working capital
    - revenue/customer cohorts, concentration, margin bridge, cash conversion
    - EBITDA/SDE normalization and add-back ledger
    - QoE workspace: reported → adjustments → verified normalized earnings
    - formula lineage, scenario assumptions, source-cell citations
  Valuation_Returns:
    - entry valuation and comparable transactions/companies
    - debt structure, sources & uses, operating cases
    - leverage/paydown, IRR/MOIC, sensitivities, downside/breakeven
    - exit routes and probabilities; terms and downside protections
  Risks:
    - P0/P1/P2 register
    - probability, impact, evidence, owner, mitigation
    - deal action: stop, pause, reprice, condition, protection, specialist review, 100-day item
  IC:
    - current IC memo and cited supporting pack
    - recommendation, scenarios, open questions, dissent/assumption log
    - Supporting Analysis & FAQ
    - versions, comments, approvals, conditions, decision history
  Relationships:
    - broker, seller, management, advisors, lenders, experts, warm paths
    - permitted communication history, meetings, commitments, follow-ups
  Execution:
    - NDA/CIM request, outreach drafts, process milestones
    - IOI/LOI drafts, exclusivity, financing, closing checklist, conditions precedent
    - 100-day plan handoff and portfolio transition
  Activity:
    - unified immutable timeline of Human/Agent/Automation actions
    - Memory used, Skills used, model/prompt versions, optimization receipts, approvals
```

Within complex tabs, toggles avoid deeper sidebars:

- Financials: Statements · QoE · Add-backs · Working Capital · Customers · Scenarios;
- Diligence: Dashboard · MRL · Workstreams · Interviews · Findings;
- Evidence: Matrix · Contradictions · Gaps · Sources;
- IC: Memo · Supporting Pack · Questions · Decision History;
- Documents: All · CIM/Teaser · Financial · Legal · Commercial · Transcripts;
- Execution: Outreach · NDA/CIM · LOI · Financing · Closing · 100-Day.

## 1.4 Sourcing

Subpages:

- Feed: normalized listings and discovered targets before they become pursued Deals;
- Sources: connector/custom URL/email/API health, schedule, yield, legal/ToS state, spend;
- Searches: saved thesis-driven queries and watchlists;
- Target Companies: proprietary targets not yet brokered deals;
- Duplicates: merge-review queue;
- Outreach Queue: draft-only warm intro/CIM requests awaiting approval.

## 1.5 Theses

Each Thesis is its own Element and can govern many Deals.

List columns: name, fund/strategy, status/version, target profile, owner, linked deals, conversion, last review, evidence health.

Thesis detail tabs:

- Summary · Market/Trends · Target Criteria · Exclusions/Red Flags · Sourcing Strategy;
- Value Creation Playbook · Financial/Return Profile · Risks/Stress Tests · Exit Strategy;
- Concise LP-ready version · Impact Thesis when material · Versions/Evidence · Linked Deals.

## 1.6 Work

Cross-deal operational lists:

- My Work · Team Work · Diligence Requests · Reviews · Approvals · Meetings · Deadlines;
- filters by Deal, workstream, owner, Agent, priority, blocked state, due date;
- rows link back to Deal context. Work is never a disconnected task island.

## 1.7 Reports

Cross-Deal Files and Results library:

- instant briefs, IC memos, diligence reports, QoE workbooks, valuation models;
- sourcing plans, interview guides, MRL exports, LOI/closing packs, 100-day plans;
- formats HTML/PDF/DOCX/XLSX/PPTX; template, version, sources, creator, approval, sensitivity label;
- compare versions and regenerate-from-new-data with diff.

## 1.8 Relationships

Views: People · Organizations · Brokers · Lenders · Advisors · Experts · Warm Paths. Uses Bridge Person/Relationship graph; no duplicate CRM subsystem. Deal-specific involvement appears inside Deal → Relationships.

## 1.9 Playbooks

Installable/configurable capability library:

- transaction adapters: ETA, buyout, growth, VC, Pre-IPO, strategic;
- industry adapters;
- diligence checklists and MRL templates;
- thesis, sourcing, valuation, QoE, IC, closing, impact templates;
- firm-specific scoring, approval, document, and output conventions;
- version, source/provenance, license, eval status, and active/legacy state.

# 2. Business lens

## 2.1 Processes covered

```yaml
covered_processes:
  fund_and_strategy:
    - fund/mandate thesis development and iteration
    - market/trend and whitespace analysis
    - target criteria, exclusions, value-creation, returns, exit, impact thesis when material
  origination:
    - broker/source monitoring
    - proprietary target discovery
    - thesis-fit screening and scoring
    - source normalization, dedupe, watchlists, warm-path mapping
  triage_and_engagement:
    - R/Y/G decisions and pass reasons
    - opportunity snapshots and instant briefs
    - approved outreach, NDA/CIM requests, meeting preparation
  diligence:
    - material inventory and data-room ingestion
    - MRL creation, assignment, tracking, escalation
    - hypothesis trees and evidence verification
    - commercial, operational, technology, management, financial/QoE workstreams
    - legal/tax/IP/regulatory/ESG risk identification and specialist referral
    - interviews, contradictions, gaps, red flags
  underwriting:
    - normalization and add-backs
    - valuation, capital structure, sources/uses
    - operating/downside cases, sensitivities, IRR/MOIC
    - exit analysis and term/downside-protection analysis
  decision:
    - IC memo and supporting pack
    - questions/FAQ, dissent, conditions, approvals, decision history
  transaction_execution:
    - IOI/LOI drafting support
    - financing workstream and lender comparisons
    - closing checklist and conditions precedent
    - 100-day-plan handoff
  institutional_learning:
    - thesis/playbook versioning
    - correction/failure Memory
    - flags converted into eval cases
    - source, model, cost, and outcome attribution
```

## 2.2 Explicitly not covered

```yaml
not_covered_or_not_authoritative:
  - autonomous investment, rejection, IC vote, or fund-allocation decisions
  - final legal opinions, legal drafting sign-off, audit opinions, tax opinions, patent/FTO opinions
  - replacing licensed accountants, lawyers, tax advisers, environmental/safety experts, or lenders
  - securities trading or public-market buy/sell recommendations
  - fund administration, capital calls/distributions, NAV accounting, waterfall accounting, LP registry, K-1/tax filing
  - custody, payments, escrow, wire initiation, banking, or movement of funds
  - definitive agreement execution or electronic signature authority
  - autonomous external email/message sending at launch
  - bypassing website terms, authentication, paywalls, robots/rate limits, or data-use rights
  - representing probabilistic/ML scores as facts or guarantees
  - portfolio ERP, HRIS, accounting, or full operating-system replacement
  - impact/ESG claims without materiality, evidence, metrics, and accountability
  - cross-tenant sharing of documents, deal judgments, Memories, or proprietary theses
```

Future optional packages—not DealPilot core: Fund Administration, LP/Investor Relations, Portfolio Operations, and LP Fund Selection. They may reuse DealPilot Elements but require separate permissions, data models, and professional boundaries.

# 3. Technical lens

## 3.1 Agents

Bridge keeps five permanent platform Agents: Chief of Staff, Learning, Internal Strategist, Governance, and Capability Builder. DealPilot installs no specialist Agents by default. ETA work maps to these permanent responsibilities; separate Agents require a durable identity, authority/data boundary, evaluation lifecycle, independent queue/cadence, or irreducible conflict of duties.

```yaml
dealpilot_assignments:
  Learning: authorized research, Source discovery, retrieval, normalization, evidence, provenance
  Internal_Strategist: ETA thesis, fit, commercial and operational analysis, diligence synthesis, financial models, valuation, scenarios, recommendations, IC materials
  Chief_of_Staff: stakeholder management, relationship-aware coordination, communications, approvals, meetings, commitments, next Actions
  Capability_Builder: programmed connectors, Integrations, Skills, formulas, schemas, Views, tests, governed deployment
  Governance: data-rights and policy review, control checks, risk, evidence sufficiency, approvals, audit
```

Each permanent Agent may create bounded child Agent Runs. Child authority, Skills, data scope, budget, review requirement, taint, and delegation depth are intersections/subsets of the parent Run. Child Runs never become invisible specialist Agents; parent remains accountable. Human remains accountable for commercial data rights and investment Decisions.

## 3.2 Skills

```yaml
skills:
  - thesis-development-and-iteration
  - macro-trend-and-whitespace-analysis
  - target-criteria-and-exclusion-design
  - value-creation-playbook-design
  - source-discovery-and-health-assessment
  - listing-extraction-normalization-and-dedupe
  - thesis-fit-screening
  - opportunity-snapshot
  - warm-path-mapping
  - material-inventory
  - document-ingestion-and-classification
  - hypothesis-tree-development
  - master-request-list-management
  - interview-guide-generation
  - evidence-matrix-and-contradiction-analysis
  - red-flag-classification-and-deal-action
  - business-evaluation
  - financial-normalization-and-qoe
  - add-back-review
  - valuation-comps-and-precedents
  - lbo-sources-uses-and-returns
  - sensitivity-and-downside-analysis
  - ic-memo-and-supporting-faq
  - ioi-loi-and-process-document-drafting
  - financing-and-closing-readiness
  - post-close-100-day-plan
  - impact-materiality-and-theory-of-change
  - file-render-and-quality-assurance
skill_binding:
  primary: [Goal type, Task type]
  defaults: Agent manifests may list preferred Skills
  runtime: any assigned eligible Agent may select a matching Skill after authority, Plane, data, rights, risk, budget, and evaluation gates
```

## 3.3 Automations

```yaml
automations:
  - scheduled-source-scan-with-domain-budget
  - source-yield-and-extractor-health-monitor
  - listing-normalize-dedupe-and-change-detect
  - thesis-fit-rescore-on-thesis-or-deal-change
  - new-match-triage-queue
  - deal-brief-regenerate-with-diff
  - inbound-email-and-document-match-to-deal
  - document-parse-redact-index-and-cite
  - fact-extract-with-human-review-threshold
  - contradiction-and-stale-evidence-detection
  - MRL-create-from-adapter
  - MRL-reminder-and-blocker-escalation
  - hypothesis-evidence-coverage-refresh
  - P0-P1-red-flag-escalation
  - financial-model-refresh-on-new-source
  - IC-pack-build-and-preflight
  - approval-gated-outreach-sequence
  - meeting-prep-and-follow-up-draft
  - closing-condition-and-deadline-monitor
  - post-decision-learning-and-eval-capture
```

Every Automation has trigger, idempotency key, budget, retry/backoff, owner, stop condition, risk band, and immutable run record. External send and consequential stage/decision changes remain human-approved.

## 3.4 Integrations/tools

- document: local files, Bridge Storage, Docling/provider port, OCR, PDF/XLSX/DOCX/PPTX renderers;
- communications: Gmail/O365 behind scoped OAuth; Calendar/meeting/transcript providers;
- sourcing/research: user URLs, email alerts, public registries, approved broker connectors, browser agent only as last tier;
- financial: Excel workbook generation with live formulas; optional approved market/private-data providers;
- relationships: Bridge Person/Relationship graph and permitted email/calendar signals;
- outputs: HTML, PDF, Word, Excel, PowerPoint behind File providers;
- execution: CredentialBroker + isolated browser/container/VM target when account or host isolation requires it.

# 4. Reuse-first source map

No capability should be rebuilt from scratch before importer/wrapper/adaptation review. “Reuse” does not mean copying license-restricted work.

When direct reuse is license-limited, apply `clean-room-capability-research-protocol-2026-07.md`:
perform detailed lawful research; inventory every observable feature, Agent, Skill, Automation,
workflow, input/output, state, integration, architectural approach, quality control, strength,
weakness and limitation; produce black-box benchmarks and an independently authored functional
specification; separate researchers from implementers when risk warrants; then compare the original
and Bridge alternative on outcomes. Never copy or lightly paraphrase protected code, prompts,
templates, documentation, distinctive design expression, datasets or naming. License/contract,
patent, trademark, trade-secret, anti-circumvention and data-right constraints still apply.

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
    - repository_and_output_license
    - transitive_dependencies
    - security_and_prompt_injection
    - provenance_and_signature
    - contract_and_eval_conformance
```

Source decisions:

```yaml
sources:
  noahnan-max/private-equity-investment-dd-skill:
    use: diligence workflow, evidence matrix, red flags, adapters, report structure
    mode: import/adapt only after license and output review
    link: https://github.com/noahnan-max/private-equity-investment-dd-skill
  yuping322/financial-services-plugins-new:
    use: PE/financial-analysis skills, data-to-Excel/Word/PowerPoint workflows, connectors
    mode: Apache-2.0 candidate for importer/wrapper; verify each plugin/dependency
    link: https://github.com/yuping322/financial-services-plugins-new
  sradgowski/deal-evaluator:
    use: multi-source discovery, prior-run comparison, explainable score pattern
    mode: inspect license before code reuse; likely pattern/reference if license absent
    link: https://github.com/sradgowski/deal-evaluator
  xrishiraj/Private-Equity-Fund-Selection-through-ML:
    use: optional LP Fund Selection research baseline only
    mode: do not use production code/model/data without license and dataset rights; separate adapter
    link: https://github.com/xrishiraj/Private-Equity-Fund-Selection-through-ML
  parolkar/SmallPE:
    use: agent role definitions, thesis→sourcing→diligence→modeling→closing flow, MRL/evidence/impact/output patterns
    mode: FSL-1.1 currently blocks competing commercial use; no vendoring/copying/derivatives without permission or license transition. Seek partnership/license, or interoperate/reference high-level functional requirements.
    inspected_commit: 3b11c970d3a3c50fe11e267bd96c1bcdb36db705
    link: https://github.com/parolkar/SmallPE
    docs: https://smallpe.com/docs/#workflow
  chandra447/pi-hermes-memory:
    use: correction/failure memory, retrieval, consolidation, lifecycle hooks
    mode: MIT candidate behind MemoryEngine; do not adopt storage shape as kernel canon
    link: https://pi.dev/packages/pi-hermes-memory
```

SmallPE assets discovered in direct repository inspection:

- 1 Managing Partner + 7 specialists: Oracle, Helios, Athena, Prometheus, Themis, Logos, Hermes, Iris;
- sequential deal pipeline plus cross-cutting impact review;
- MRL workflow/templates and dashboards;
- evidence tracker, gap report, verification summary;
- business-evaluation workflow pairing analysis and verification;
- thesis iteration, secret-sauce, impact/Theory-of-Change templates;
- PDF→Markdown, Excel→Markdown, Pandoc PDF, and Slidev presentation tooling;
- journals/deal capsules intended for persistent memory.

These are real reusable candidates, but current FSL restriction makes commercial incorporation a business-development/legal decision, not an engineering shortcut.

# 5. Data and capability model

Deals, Sources, and Theses form one strongly-related DealPilot object cluster. Each may use a dedicated database because each owns different fields, but relationships are symmetric many-to-many—not a hierarchy:

```yaml
DealPilot_cluster:
  surfaces: [Deals, Sources, Theses]
  surface_rule: only default sibling toggle Pages in DealPilot; each keeps its own DB-backed schema and standard toolbar/views
  non_pages: [Overview, Summary, Reports, Files, Results]
  optional_pages: user-created only from eligible DB-backed sources via standard Add page; Relationships, Agents, Automations, Integrations, or Work are not default Pages
  relationships:
    Deal_Source: many_to_many
    Deal_Thesis: many_to_many
    Source_Thesis: many_to_many
  field_ownership_examples:
    Deal: [company, stage, revenue, EBITDA, asking_price, evidence_health]
    Source: [name, link, connector_type, credential_ref, last_checked_at, spend_cap, spend_to_date, health, schedule, yield, rights_state]
    Thesis: [name, industry_focus, target_CAGR, criteria, exclusions, sourcing_strategy]
  credential_rule:
    - Source stores opaque CredentialBroker/keychain reference, never raw user ID/password
    - Sources table projects secure virtual User ID and Password columns like browser password managers
    - password masked by default; reveal/copy requires explicit Human gesture and recent OS/application re-authentication
    - reveal is time-limited and audited; secret never enters Agent/Skill/Automation/crawler input, ordinary API, logs, prompts, exports, Files, Results, or persistent browser storage
  conditional_columns:
    Relationships: only when authorized Relationship Module Database binding exists
    Tasks: when Calendar/Work Database binding exists; present by default because Calendar is a default Module
  record_detail_rule: every Deal, Source, and Thesis row opens a dedicated Record Detail route; its Fields, Files, Results, Relations, Integrations, Agent/Automation activity, and Event history are Sections, not sibling Module Pages
  triggers:
    thesis_created_or_materially_changed: propose governed source discovery/search Automation; attach discovered Sources only after dedupe and review policy
    source_created_or_materially_changed: propose/run governed source scan; normalize and dedupe candidate Deals; preserve source provenance
    source_or_thesis_link_changed: recompute affected Deal thesis-fit and explain the diff
Deal:
  relates_to:
    - Source
    - Company
    - Thesis
    - Listing
    - Document
    - Fact
    - Hypothesis
    - EvidenceClaim
    - DiligenceRequest
    - Finding
    - Risk
    - FinancialModel
    - QoEAnalysis
    - ValuationScenario
    - ICDecision
    - Relationship
    - Communication
    - Meeting
    - File
    - Result
    - Action
    - Memory
```

CIM and QoE semantics:

- CIM = versioned File linked to Deal; parsed facts never overwrite source;
- QoE = structured Result linked to source financial Files, adjustments, reviewer Decisions, and formulas;
- Hypothesis Tree = versioned Result plus hypothesis Records; evidence links are first-class;
- IC Memo = generated File snapshot citing the exact Deal graph/version used;
- every derived figure resolves to original document/page/cell or explicitly says user/Agent inference.

# 6. Delivery sequence

```yaml
slices:
  DP0:
    scope: ETA Deals/Sources/Theses many-to-many schema + only-default sibling Pages + dedicated Record Detail contracts + conditional Relationship/Task columns + standard capability inventory + Source Link/credential projection/last checked/spend cap/rights gate + real data/empty states
  DP1:
    scope: thesis→source-discovery and source→deal-discovery Automations + Sourcing feed/searches + normalization/dedupe + provenance-preserving thesis-fit triage
  DP2:
    scope: Hypotheses + Evidence + Diligence/MRL + red-flag gate
  DP3:
    scope: Financials/QoE + valuation/returns + live-formula Files and Results
  DP4:
    scope: IC room + cited memo/FAQ + approvals/decision history
  DP5:
    scope: Relationships + approved outreach + meetings + execution/closing/100-day handoff
  DP6:
    scope: learning/evals + package playbooks/importers + optional impact and LP adapters
```

Exit gate per slice: source/license record, manifest risk, tests, held-out eval, browser evidence for changed surfaces, provenance/citation audit, security scan, cost/latency baseline, and no dummy runtime data.
