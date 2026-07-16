---
title: DealPilot Business Requirements
type: raw
doc_kind: reference
status: proposed
companions: [dealpilot-module-plan-2026-07.md, dealpilot-design-requirements-2026-07.md, dealpilot-architecture-requirement.md, requirement-bugs-2026-07-14-actionable-shell-second-brain.md, requirement-dealpilot-eta-agent-skill-red-flag-2026-07-15.md, agent-goal-skill-orchestration-plan-2026-07.md]
related_wiki: ../wiki/dealpilot.md
updated: 2026-07-15
tags: [dealpilot, eta, module, business-requirements, sourcing, diligence, underwriting]
---

# 1. Executive decision

DealPilot is one installable Module for Entrepreneurship Through Acquisition (ETA): sourcing, evaluating, diligencing, deciding on, and preparing the acquisition of an operating business. It is one item in the global Modules list, not a collection of unrelated applications or a generic institutional-fund platform.

DealPilot must make five answers available to an authorized decision-maker in under two minutes:

1. What changed?
2. What Decision is required now?
3. What evidence supports the current position?
4. What remains unknown, stale, or contradicted?
5. What Action happens next, who owns it, and when?

DealPilot supports human investment judgment. It does not make autonomous investment, rejection, allocation, legal, tax, audit, or fund-movement Decisions.

# 2. Business problem and intended outcomes

Investment teams currently assemble source feeds, screening logic, diligence evidence, financial analysis, communications, and committee materials across disconnected systems. This creates duplicate opportunities, weak provenance, stale analysis, inconsistent review, and unclear accountability.

DealPilot must:

- turn authorized Sources into normalized, deduplicated Deals;
- connect each Deal to all relevant Sources and Theses without forcing a hierarchy;
- explain fit, uncertainty, contradictions, and changes;
- preserve source-level provenance for material facts and derived figures;
- coordinate diligence, underwriting, IC preparation, and transaction readiness;
- keep consequential external Actions and Decisions human-governed;
- retain reusable, correctable Memory from outcomes, corrections, and failures;
- provide real connected data or honest empty states, never fabricated operating data.

# 3. Human accountability

DealPilot defines no user personas. Authority comes from the authenticated Human, Organization membership, Record scope, and explicit permissions—not a fictional role template.

The Human remains accountable for commercial data rights, Source authorization, investment judgment, professional advice, external commitments, and final Decisions. Bridge must surface that onus at the point it matters and must not treat a user attestation as permission to bypass law, contract, authentication, access controls, robots/rate limits, or provider terms.

Restricted information is omitted or replaced by an explicit access state. It is never exposed through blur, CSS masking, logs, exports, prompts, or browser storage.

# 4. Scope

## 4.1 Included

```yaml
included_capabilities:
  strategy:
    - Thesis creation, versioning, criteria, exclusions, value-creation assumptions, and review
    - market, trend, whitespace, return, exit, and material impact analysis
  sourcing:
    - authorized Source monitoring and health
    - proprietary target discovery and saved searches
    - normalization, deduplication, change detection, and warm-path mapping
    - transparent Thesis-fit evaluation
  triage_and_engagement:
    - evidenced fit, concern, and pass rationale with explicit Decisions; platform red flags remain feedback only
    - opportunity briefs and comparison
    - approval-gated outreach, NDA and CIM requests, and meeting preparation
  diligence:
    - File intake, classification, versioning, extraction review, and citations
    - hypothesis trees, evidence matrix, contradictions, gaps, MRL, and workstreams
    - commercial, operational, technology, management, financial, and QoE review
    - legal, tax, IP, regulatory, and impact risk identification for specialist referral
  underwriting:
    - financial normalization and add-back review
    - valuation, sources and uses, capital structure, operating cases, sensitivities, IRR, and MOIC
    - downside, breakeven, exit, and term analysis
  decision_and_execution_readiness:
    - cited IC memo, supporting analysis, questions, dissent, conditions, and Decision history
    - IOI and LOI drafting support, financing comparisons, closing checklist, and 100-day handoff
  learning:
    - correction and failure Memory
    - evaluation cases from reviewed outcomes
    - Source, model, cost, and outcome attribution
```

## 4.2 Excluded or non-authoritative

```yaml
excluded:
  - autonomous investment, rejection, IC vote, or capital-allocation Decisions
  - final legal, tax, audit, accounting, patent, regulatory, or environmental opinions
  - custody, banking, payments, escrow, wires, or movement of funds
  - definitive agreement execution or signature authority
  - autonomous external sending at launch
  - bypassing authentication, access controls, terms, rate limits, or data-use rights
  - fund administration, capital calls, distributions, NAV, carried-interest accounting, or tax filing
  - portfolio ERP, HRIS, or accounting replacement
  - unsupported impact, ESG, or probabilistic claims presented as facts
  - cross-Organization sharing of private Files, Deal judgments, Memory, or proprietary Theses
```

# 5. Information architecture and actionability

DealPilot appears as a clickable item under Modules in the global Sidebar. Selecting it opens the standard Module Detail shell and its standard capability inventory. DealPilot customizes inventory data—activities, evaluations, permissions, Runs, versions, health—not the inventory structure. Every visible Record, metric, status, and recommendation must offer an appropriate next Action when an Action exists; permission-denied Actions are clearly unavailable, not misleadingly enabled.

```yaml
module_click_through:
  default_pages:
    - Deals
    - Sources
    - Theses
  forbidden_default_pages: [Overview, Summary, Reports, Files, Results, Relationships, Agents, Automations, Integrations, Work]
  optional_page_rule: user may add a Page only from an eligible Database-backed source through the standard Add page command; removal changes presentation only
  standard_module_sections: [health_and_attention, Databases_and_Pages, Agents_and_goal_task_Skills, Automations, Integrations, Files_and_Results, Runs, settings]
  capability_inventory_contract: platform standard; DealPilot supplies manifest and live values only
  configuration:
    entry: Control Panel in the standard overflow menu
```

Every Database-backed Page uses the Standard Toolbar in this order: List, View, search, filter, primary Add Action, and overflow. Required Views are selected from table, cards, board, calendar, timeline, map, graph, and form according to the data shape. The shared Column Menu and Page-toggle commands apply consistently.

Every Deal, Source, and Thesis Record opens a dedicated Record Detail route. Record Detail is not a sibling Module Page: it is one Record’s full workspace, assembled from Fields and Sections. Overview, Summary, Reports, Files, Results, Relations, Agents, Integrations, and Activity are Sections or Views inside Record Detail, never default Pages merely because they need display space.

Default Record Detail contracts:

```yaml
Deal_detail_sections: [key Fields, evaluation and decision state, Theses, Sources, Files, Results, Integrations, evidence and diligence, financial analysis, Relations when available, Tasks when available, Agent and Automation activity, Event history]
Source_detail_sections: [connection Fields, credential controls, rights and approval state, Integrations when predefined, dynamic acquisition Skills when applicable, crawl health and Runs, linked Deals, linked Theses, spend and usage, Files and Results, Event history]
Thesis_detail_sections: [criteria and exclusions, industry and market assumptions, versions, evidence, sourcing strategy, linked Sources, linked Deals, fit Results, Files, Agent and Automation activity, Event history]
conditional_columns:
  Relationships:
    condition: Relationship Module Database is installed, bound, and authorized
    behavior: Relation-backed column; never a duplicate DealPilot contact store
  Tasks:
    condition: Calendar/Work Database is installed, bound, and authorized
    default_state: present because Calendar is a default Module
    behavior: Relation-backed task column and Section
```

# 6. Core domain model

Deals, Sources, and Theses are sibling Databases inside DealPilot. They form a symmetric many-to-many cluster. None is subordinate to another.

```yaml
databases:
  Deals:
    record: Deal
    owned_fields: [company, stage, revenue, EBITDA, SDE, asking_price, evidence_health, owner]
  Sources:
    record: Source
    owned_fields: [name, link, connection_type, credential_reference, last_checked_at, spend_cap, spend_to_date, health, schedule, yield, rights_state, rights_attested_at, rights_attested_by]
  Theses:
    record: Thesis
    owned_fields: [name, focus, target_CAGR, criteria, exclusions, sourcing_strategy, version]
relations:
  Deal_Source: many_to_many
  Deal_Thesis: many_to_many
  Source_Thesis: many_to_many
relation_rule: one Relation row expresses one semantic connection and may carry attributes, dates, confidence, provenance, and evidence references
credential_rule:
  storage: Source Records hold one opaque Credential Broker reference; user ID and password values remain encrypted in OS keychain or approved vault
  table_projection: virtual User ID and Password columns appear in Sources table; password is masked; user ID follows configured masking
  reveal: explicit Human gesture plus recent re-authentication; time-limited; audited; never available to Agents, Skills, Automations, crawlers, exports, logs, prompts, Files, Results, or ordinary API responses
  copy: OS-authenticated copy without persistent reveal; clipboard clearing where supported; Event recorded without secret value
  access_state: unavailable, revoked, or locked is shown as state—not fake bullets
```

A Deal can have multiple Sources and Theses. A Source can support multiple Deals and Theses. A Thesis can govern multiple Deals and Sources. Deal-only Fields such as EBITDA remain on the Deal. Source-only connection Fields remain on the Source. Thesis-only Fields such as target industry CAGR remain on the Thesis.

Files are durable user-visible material linked to Module Records. A CIM is a versioned File linked to a Deal; extracted Fields never overwrite its source. A QoE is structured analysis linked to source Files, formulas, adjustments, and reviewer Decisions. An IC memo is a versioned File citing the exact Record, Relation, and evidence snapshot used. Non-file outcomes are Results.

Material facts and figures carry provenance, observed/effective date, confidence, correction history, and explicit source or inference classification. Events form the append-only Activity record.

# 7. Business rules

```yaml
rules:
  thesis_change:
    outcome: propose a governed Source-discovery Automation and re-evaluate affected Deal fit
  source_change:
    outcome: run or propose an authorized scan, normalize and deduplicate candidate Deals, and preserve provenance
  relation_change:
    outcome: re-evaluate affected Deal fit and explain the difference
  duplicate_detection:
    outcome: high-confidence matches may merge under policy; ambiguous matches enter human review; every merge is explainable and reversible
  source_breakage:
    outcome: detect abnormal yield or schema failures, mark degraded, stop unsafe extraction, and present recovery Action
  new_evidence:
    outcome: append rather than silently overwrite; identify superseded values and refresh affected Results
  external_action:
    outcome: show exact recipient, content, account, cost, risk, and approval before sending
  consequential_change:
    outcome: stage changes, pass Decisions, IC Decisions, and accepted financial adjustments follow configured Review Mode
  derived_figure:
    outcome: resolve to source File page, section, or cell, or state explicitly that it is a Human or Agent inference
```

# 8. Functional requirements

## 8.1 Overview and decision queue

- Show Decisions required, pipeline position, active diligence health, changes since last review, deadlines, Source health, and Agent/Automation activity.
- Each item links to the affected Record and offers the next safe Action.
- Empty sections explain which authorized connections or capabilities populate them.

## 8.2 Deal management

- Provide table, board-by-stage, cards, timeline, and geography Views where supported.
- Support saved Lists for New/Triage, Pursue, Diligence, IC, LOI/Closing, and Passed/Archived.
- Support inspect, compare, assign, request Files, propose stage change, export, archive, and approved communication Actions.
- Preserve View, List, filters, sort, and selected Deal tab across navigation and browser back.

## 8.3 Source discovery and health

- Add authorized URLs, feeds, email alerts, APIs, and account-backed connections.
- Sources table includes Link, virtual User ID, virtual masked Password, Last checked timestamp, Spend cap, spend-to-date, rights state, health, and next Run.
- Show last/next Run, yield, duplicate rate, extraction confidence, rights state, cost, and failures.
- Support pause, test, reschedule, inspect Run, and correct connection Actions.
- A blocked Source must not cascade into other Source Runs.
- Enabling an account-backed or commercially licensed Source requires explicit Human attestation of data rights, intended use, permitted scope, and spend cap. Ambiguous or commercially material restrictions stop at counsel/upstream-permission review.

## 8.4 Thesis management and fit

- Store human-readable and structured criteria, exclusions, target profile, value-creation assumptions, risks, returns, exit, and versions.
- Explain every Deal-fit factor, evidence used, uncertainty, and score change.
- Learned ranking may propose criteria changes but never silently change a Thesis.

## 8.5 File and evidence handling

- Import and classify PDFs, spreadsheets, text Files, email attachments, and transcripts under permission.
- Preserve originals, versions, sensitivity, source, received date, processing state, and review state.
- Open any material claim or derived figure at its source in no more than two interactions.
- Surface contradictions, stale evidence, missing evidence, and extraction corrections.

## 8.6 Diligence and risk

- Create and manage hypotheses, evidence coverage, MRL items, interviews, findings, and workstream status.
- Classify P0/P1/P2 risk and require a Deal Action: Stop, Pause, Reprice, Closing Condition, Contractual Protection, Specialist Review, or 100-Day Item.
- Label specialist analysis as risk identification unless an accountable professional supplies the opinion.

## 8.7 Financial analysis and returns

- Support statements, QoE, add-backs, working capital, customer analysis, assumptions, scenarios, valuation, and return sensitivities.
- Preserve formulas and source-cell lineage.
- Separate reported, proposed, reviewer-adjusted, and accepted values.
- Export live-formula workbooks while preserving source and version references.

## 8.8 IC and transaction readiness

- Generate cited draft IC materials with recommendation, assumptions, open questions, dissent, alternatives, conditions, and supporting analysis.
- Record Human Decisions, rationale, conflicts, conditions, source snapshot, and later amendments.
- Coordinate approved outreach, NDA/CIM, IOI/LOI, financing, closing, and 100-day readiness without implying legal completion.

## 8.9 Relations and communications

- Reuse the Relationship Module’s People, Communities, and Relations rather than create a parallel contact store.
- Show Deal-relevant roles, warm paths, permitted communications, commitments, and last/next interactions.
- Draft communication and sent communication are visually and semantically distinct.

# 9. Agents, Skills, Automations, and Integrations

DealPilot defines no default specialist Agents. It assigns ETA Goals and Tasks to the five permanent platform Agents. Skills are Goal/Task-bound; listed Agent access is a default preference, not exclusive ownership. A different eligible Agent may use the Skill when runtime authority, Plane, data scope, risk, budget, and evaluation gates pass.

```yaml
agents:
  Learning:
    owns: authorized Source discovery, retrieval, normalization, evidence collection, provenance, and research Memory
  Internal_Strategist:
    owns: ETA thesis, fit, business quality, diligence synthesis, financial analysis, valuation, scenarios, risks, recommendations, and decision materials
  Chief_of_Staff:
    owns: stakeholder context, relationship-sensitive coordination, communications, meetings, approvals, commitments, and next-action orchestration
  Capability_Builder:
    owns: connector, Integration, Skill, schema, model, formula, and workflow programming with tests and governed deployment
  Governance:
    owns: data-rights gate, policy/control review, evidence sufficiency review, risk classification, approval routing, audit, and conflict checks
skills_by_job:
  thesis_and_sourcing:
    - Thesis development and iteration
    - market, trend, and whitespace analysis
    - Source discovery and health assessment
    - listing normalization and deduplication
    - transparent Deal-fit evaluation
  diligence_and_evidence:
    - File intake and classification
    - hypothesis tree development
    - MRL management
    - interview guide preparation
    - evidence matrix and contradiction analysis
    - red-flag classification
  finance_and_decision:
    - financial normalization and QoE
    - add-back review
    - valuation and comparable analysis
    - sources, uses, returns, sensitivity, and downside analysis
    - IC memo and supporting questions
  execution:
    - approved communication drafting
    - IOI and LOI drafting support
    - financing and closing readiness
    - 100-day-plan preparation
agent_creation_rule: create a separate Agent only for a durable identity, authority/data boundary, evaluation lifecycle, independent queue/cadence, or irreducible conflict of duties; otherwise use a Goal/Task Skill or bounded child Agent Run
automations:
  - scheduled Source scan with domain budget
  - Source yield and extraction health monitoring
  - normalization, deduplication, and change detection
  - Thesis-fit refresh on Deal, Source, Thesis, or Relation change
  - new-match triage queue
  - Deal brief regeneration with difference summary
  - inbound email and File matching
  - File parsing, redaction, indexing, and citation
  - contradiction and stale-evidence detection
  - MRL reminders and blocker escalation
  - P0/P1 escalation
  - financial Result refresh on new evidence
  - IC pack build and preflight
  - approval-gated outreach
  - closing condition and deadline monitoring
  - post-Decision evaluation and Memory capture
integrations:
  - local and authorized cloud file stores
  - Gmail and Microsoft 365 through scoped authorization
  - calendar, meeting, and transcript providers
  - approved public registries, broker feeds, and research connections
  - spreadsheet and File rendering providers
  - Credential Broker and isolated browser execution where required
```

Predefined external connections appear in the Integrations Section of the relevant Record Detail, especially Source detail. Dynamic acquisition or transformation behavior is a Goal/Task Skill, not a fake Integration. Files and Results (the canonical replacement for “artefacts”) appear as separate Sections in Deal detail.

Every Automation declares its trigger or schedule, owner, idempotency key, budget, retry/backoff, stop condition, risk band, invoked Agents, and immutable Run record. An Automation contains no hidden authority.

# 10. Governance, privacy, and security

- Every mutation resolves authority and policy and emits an immutable Event.
- Row-level access separates Organizations and sensitive Deal material.
- Local Plane and Cloud Plane residency is explicit; cross-plane movement passes the deny-default Plane Gate.
- Raw credentials are never exposed to Agents, Skills, Automations, crawlers, Module data APIs, Files, Results, logs, prompts, exports, or persistent browser state. Authorized Humans may reveal/copy them only through the dedicated credential projection and re-authentication flow.
- User commercial-data-rights responsibility is shown before Source activation, schedule changes, broader scope, and spend-cap increases. Bridge still blocks prohibited bypass and fails closed where rights are missing or ambiguous.
- External and account-affecting Actions show exact scope and require the configured Review Mode.
- Runtime taint labels remain attached through prompts, Engines, Skills, Actions, Events, Results, Files, queues, caches, and retries.
- Untrusted content is quarantined from privileged or egress-capable execution until deterministic validation or recorded Human Decision.
- Every Agent statement distinguishes source evidence from inference.
- Cost is estimated before consequential Runs and attributed to Organization, Deal, capability, and provider.
- Failures emit typed Failure Events with owner, retry state, affected scope, evidence, and remediation Action.

# 11. Non-functional requirements

```yaml
requirements:
  correctness:
    - no silent Record merge or evidence overwrite
    - idempotent ingestion and Automation Runs
    - append-only Event and Decision history
  responsiveness:
    - new or changed listing to triage queue within 24 hours of authorized Source availability
    - approved high-priority request to outbound draft within 1 hour
    - received diligence Files to draft cited Result within 48 hours, subject to size and review policy
  resilience:
    - one failing Source cannot cascade across Sources
    - retries are bounded and visible
    - degraded extraction is detected rather than silently accepted
  accessibility:
    - WCAG 2.2 AA target
    - complete keyboard operation and visible focus
    - color never carries state alone
    - essential Actions remain operable at 375px
  observability:
    - every Run exposes state, cost, source, actor, policy, retry, and outcome
  portability:
    - provider-specific services remain behind stable ports
  data_quality:
    - no dummy runtime data
    - source and inference labels on material content
```

# 12. Measures of success

```yaml
measures:
  decision_readiness:
    - median time to answer the five executive questions
    - percent of active Deals with explicit next Action and owner
  evidence_quality:
    - percent of material claims and figures with inspectable provenance
    - contradiction and stale-evidence resolution time
    - extraction correction rate by Source and version
  sourcing_quality:
    - unique qualified Deals per Source cost
    - duplicate detection precision and reviewed merge reversal rate
    - Source degradation detection time
  operating_quality:
    - overdue MRL and blocker rate
    - IC preflight failure rate
    - Automation success, bounded retry, and Human handoff rate
  trust:
    - unauthorized external Action count must remain zero
    - silent merge or silent overwrite count must remain zero
    - percent of consequential Runs with complete Decision Trace
```

# 13. Delivery sequence and gates

```yaml
slices:
  DP0:
    outcome: ETA-focused clickable DealPilot Module shell; only Deals, Sources, and Theses default Pages; dedicated Record Detail for every row; many-to-many Relations; conditional Relationship and Task columns; standard capability inventory; Source credential projection, last checked, spend cap, rights gate; honest empty states
  DP1:
    outcome: Thesis-to-Source discovery, Source-to-Deal discovery, normalization, deduplication, provenance, and fit triage
  DP2:
    outcome: hypotheses, evidence, diligence, MRL, contradictions, and red-flag gate
  DP3:
    outcome: financial normalization, QoE, valuation, returns, live formulas, and cited exports
  DP4:
    outcome: IC room, cited memo and questions, approvals, and Decision history
  DP5:
    outcome: Relationship Module projections, approved communications, meetings, execution readiness, closing checklist, and 100-day handoff
  DP6:
    outcome: evaluation Memory, capability improvement, adapter expansion, and optional material-impact support
slice_gate:
  - source and license record for reused capability
  - capability manifest and risk assessment
  - automated tests and held-out evaluations
  - browser evidence for changed surfaces
  - provenance and citation audit
  - security and runtime-taint audit
  - cost and latency baseline
  - no dummy runtime data
  - no deprecated product or code terminology introduced
```

# 14. Acceptance criteria

- DealPilot is a clickable global Module item and opens the standard Module Detail and standard capability inventory populated by DealPilot manifest/live data.
- Deals, Sources, and Theses are sibling Database Pages with symmetric many-to-many Relations.
- No other default DealPilot Page exists. Overview, Summary, Reports, Files, and Results are Sections/Views; user-added Pages require an eligible Database-backed source.
- Every Deal, Source, and Thesis row has a dedicated Record Detail route containing its complete Field/Section contract.
- Sources table contains Link, secure virtual User ID/Password columns, Last checked, Spend cap, spend-to-date, and rights state without returning raw secrets through ordinary data paths.
- The standard toolbar, Views, search, filters, Add Action, overflow, and shared column behavior are consistent across Database Pages.
- Agents, Automations, Integrations, Files, and Results associated with DealPilot are discoverable from the Module overview.
- Skills resolve from Goals and Tasks, remain discoverable under eligible Agents, and show version, permissions, input-output contract, and evaluation state.
- Every surfaced recommendation, status, Record, File, and Result links to context and an appropriate next Action when one exists.
- Every material claim and derived figure reaches its source within two interactions.
- Source evidence, Human input, and Agent inference are unambiguous.
- Source failures, duplicate ambiguity, contradictions, and insufficient evidence produce visible recovery or review Actions.
- External Actions and consequential Decisions are visibly separate and governed.
- View and navigation state survive reversible navigation.
- Desktop, tablet, and mobile retain evidence inspection and approval capability.
- Runtime uses real connected data or honest empty states.
- Implementation uses canonical vocabulary in copy, identifiers, APIs, schemas, payloads, Events, and tests; temporary compatibility is time-boxed and deleted.

# 15. Open business decisions

```yaml
decisions_required_before_later_slices:
  - initial ETA segment and transaction adapter: searcher, self-funded search, traditional search fund, independent sponsor, or ETA lender/advisor workflow
  - authorized Source portfolio and commercial data rights
  - launch boundary between draft-only and approval-gated external sending
  - default Review Mode for stage changes, merge decisions, and financial adjustments
  - initial financial provider and spreadsheet rendering choices
  - specialist professional-review boundary by jurisdiction and customer policy
  - retention and residency defaults for confidential Files and communications
```
