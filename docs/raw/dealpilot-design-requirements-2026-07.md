---
title: DealPilot Designer-Ready Product Design Requirements
type: raw
doc_kind: design
status: proposed
companions: [dealpilot-module-plan-2026-07.md, dealpilot-architecture-requirement.md]
related_wiki: ../wiki/packages.md
updated: 2026-07-11
tags: [dealpilot, product-design, ux, information-architecture, responsive, accessibility]
---

# 1. Brief

Design an installable DealPilot workspace for ETA/search-fund and lower-middle-market deal teams. It must take a user from thesis creation and sourcing through triage, evidence-backed diligence, underwriting, IC decision, closing readiness, and 100-day handoff.

DealPilot is not a standalone CRM or a separate application shell. It inherits Bridge global navigation, design system, governance, Agent panel, approvals, relationships, Memory, and Artifact patterns.

Primary outcome: a partner can answer, in under two minutes:

1. What changed?
2. What decision is required?
3. What evidence supports the current view?
4. What remains unknown or contradicted?
5. What happens next, who owns it, and when?

# 2. Users and permissions

```yaml
personas:
  Partner:
    goals: [portfolio-level view, triage, IC decisions, risk and return judgment]
  Deal_Lead:
    goals: [coordinate deal, synthesize workstreams, prepare IC, manage next actions]
  Associate_Analyst:
    goals: [source, normalize, analyze, maintain evidence and models]
  Operating_Partner:
    goals: [business evaluation, value creation, 100-day planning]
  Specialist_Reviewer:
    goals: [review scoped financial/legal/tax/technology/impact questions]
  Read_Only_IC_or_LP:
    goals: [review approved memo/evidence within explicit scope]
```

Permission states must be visually legible: view, propose, edit, approve, external-send, restricted. Do not show inaccessible sensitive facts and then blur them; omit or replace with an explicit access-state component.

# 3. Navigation requirement

## 3.1 Layer model

Desktop:

```text
Bridge global rail | DealPilot module rail | Main canvas | Optional Agent/context panel
```

- Global rail: one DealPilot entry only.
- Module rail: Overview, Deals, Sourcing, Theses, Work, Reports, Relationships, Playbooks.
- Object navigation: horizontal tabs below a Deal or Thesis header.
- Right panel: collapsible Agent/context/evidence inspector; never mandatory for core reading.

Tablet:

- global rail collapses to icons;
- module rail becomes collapsible drawer;
- object tabs remain horizontally scrollable with active-tab persistence.

Mobile:

- module navigation uses a labelled selector/drawer;
- object tabs show 4 highest-priority tabs plus More;
- tables become cards or contained horizontal regions;
- approvals and critical evidence remain fully operable at 375px.

Avoid nested sidebars beyond global + module. Use tabs and local toggles within objects.

## 3.2 Navigation persistence

- preserve selected view, filters, sort, and Deal tab per user;
- opening a source/citation uses split view or reversible overlay where space permits;
- browser back returns to exact list state;
- deep links supported for Deal, tab, EvidenceClaim, Document page, MRL request, model scenario, IC version.

# 4. Global module screens

## 4.1 Overview

Layout order:

1. Decision Queue
2. Pipeline and Active Diligence
3. Changed Since Last Review
4. Upcoming Deadlines/Meetings
5. Sourcing Health
6. Agent and Automation Activity

Decision Queue cards show:

- Deal and stage;
- decision requested;
- reason now;
- top evidence and gap;
- risk band;
- requester/Agent;
- deadline;
- Review button.

Empty state: explain which connected sources and installed DealPilot capabilities populate each section. Never show fabricated totals.

## 4.2 Deals list

Required views:

- Table
- Board by stage
- Cards
- Timeline
- Map when geography exists

Required saved segments:

- New/Triage
- Pursue
- Diligence
- IC
- LOI/Closing
- Passed/Archived

Table columns:

- Deal/company
- Stage
- R/Y/G state
- Thesis fit
- Thesis
- Source
- Revenue
- EBITDA/SDE
- Ask / enterprise value
- Entry multiple
- Evidence coverage
- P0/P1 flags
- Owner
- Next action
- Deadline
- Last changed

Interactions:

- click row → Deal Summary;
- hover/focus → compact preview, never essential-only hover content;
- column chooser, sort, filter, saved view;
- compare 2–4 Deals;
- bulk assign/export/request-documents/archive;
- stage change is a proposal when policy requires approval;
- external message is never a bulk default.

Row signals:

- stale source;
- new document/unreviewed change;
- contradiction;
- overdue request;
- decision required;
- restricted data;
- Agent working/pending proposal.

## 4.3 Sourcing

Local toggles:

- Feed
- Sources
- Searches
- Target Companies
- Duplicates
- Outreach Queue

Feed card anatomy:

- target/listing identity and source;
- first/last seen and change indicator;
- headline financials;
- fit score with expandable factor explanation;
- inclusion/exclusion reason;
- source quality/freshness;
- actions: Create/Merge Deal, Watch, Pass, Investigate.

Sources screen:

- connector/domain, type, account/profile used;
- status, last run, next run, yield, duplicate rate, extraction confidence;
- cost, rate-limit/ToS state, error and recovery action;
- pause, test, edit schedule, inspect last run.

Duplicates screen must show side-by-side source records, match factors, differences, merge destination, and undo/provenance—not a single opaque confidence score.

## 4.4 Theses

List supports Table and Cards. Each Thesis card includes mandate, target criteria summary, version/status, linked Deals, sourcing yield, conversion, next review.

Thesis tabs:

- Summary
- Market & Trends
- Target Criteria
- Exclusions & Red Flags
- Sourcing Strategy
- Value Creation
- Financial & Return Profile
- Risks & Stress Tests
- Exit Strategy
- Concise LP Version
- Impact, only when material/enabled
- Evidence & Versions
- Linked Deals

Design requirement: Thesis criteria must be both human-readable and structured enough to drive transparent screening. Show which criterion affected each Deal score.

## 4.5 Work

Toggles: My Work, Team Work, Diligence Requests, Reviews, Approvals, Meetings, Deadlines.

Each item shows Deal, workstream, owner, requester, priority, due date, status, blocker, source object, and Agent/Automation involvement. Opening work preserves Deal context in breadcrumb/header.

## 4.6 Reports

Artifact library filters:

- Briefs
- IC
- Diligence
- QoE/Models
- Sourcing
- Interviews/MRL
- IOI/LOI/Closing
- 100-Day

Artifact card: title, Deal, type, format, version, created by, source snapshot, approval, sensitivity, last changed. Actions: preview, compare, inspect sources, export, propose regeneration.

## 4.7 Relationships

Toggles: People, Organizations, Brokers, Lenders, Advisors, Experts, Warm Paths.

Use Bridge Relationship graph. Show only DealPilot-relevant projections: active Deals, role, introduction path, permitted communications, commitments, last/next touchpoint. Do not recreate a parallel contact database.

## 4.8 Playbooks

Cards show purpose, source repository/author, license, version, risk, permissions, installed state, eval status, compatible transaction/industry adapters, and included Agents/Skills/Automations.

Install/upgrade opens progressive disclosure:

1. summary and intended use;
2. components;
3. permissions/accounts/data planes;
4. source/license/provenance;
5. eval results and known limitations;
6. governed install proposal.

# 5. Deal workspace

## 5.1 Persistent Deal header

Required fields:

- company/deal name and verified aliases;
- stage and R/Y/G state;
- thesis + fit score;
- owner/team;
- key economics;
- evidence coverage;
- unresolved P0/P1 count;
- next action/deadline;
- source freshness;
- approval/pending-Agent state.

Header actions: Ask Agent, Add/Upload, Request Information, Compare Version, Propose Stage Change, More. Sending externally must be a separately labelled approval action.

## 5.2 Summary tab

Two-column desktop hierarchy:

- left: decision brief, key economics, why fit, why fail, thesis assumptions;
- right: decision queue, red flags, evidence gaps, next actions, upcoming events;
- bottom: recent changes and related artifacts.

Every generated statement displays a source state:

- verified source;
- management-stated;
- third-party;
- user-entered;
- Agent inference;
- missing/contradicted.

## 5.3 Profile tab

Sections: legal identity, ownership, history, locations, management, products/services, customers, channels, suppliers, competitors, employees, technology, financing history.

Each field supports:

- current value;
- provenance/citation;
- confidence;
- effective/observed date;
- prior values;
- conflict indicator;
- propose correction.

## 5.4 Listings tab

Show all source listings linked to canonical Deal, with snapshot comparison and merge rationale. Include price/financial changes, delisting state, broker/source, extraction version, and original-page access where permitted.

## 5.5 Documents tab

Toggles: All, CIM/Teaser, Financial, Legal, Commercial, Transcripts, Other.

Document list fields: name, type, version, received from, received date, sensitivity, processing/review state, page count, linked facts/claims, newer-version warning.

Viewer:

- document left/center;
- extracted facts and cited claims right;
- click citation jumps to page/region/cell;
- compare versions;
- mark extraction correct/incorrect;
- redact/export under permission;
- original always remains source of truth.

## 5.6 Hypotheses tab

Views: Tree, Table, Coverage.

Hypothesis node:

- statement;
- category;
- why it matters;
- must-be-true threshold;
- evidence for/against;
- status and confidence;
- owner and next test;
- linked risk/value-creation/IC section;
- change history.

Tree branches: business, market, customers, financial, legal/regulatory, management, technology, value creation, exit.

## 5.7 Evidence tab

Toggles: Matrix, Contradictions, Gaps, Sources.

Evidence matrix columns:

- claim;
- category;
- source and exact anchor;
- source class;
- verification status;
- freshness;
- reviewer;
- gap;
- Deal implication;
- related hypothesis/risk.

Status vocabulary: Verified, Partially Verified, Unverified, Contradicted, Requires Diligence. Never use confidence color alone; pair label, icon and explanation.

## 5.8 Diligence tab

Toggles: Dashboard, MRL, Workstreams, Interviews, Findings.

Dashboard:

- completion by workstream;
- critical blockers;
- overdue requests;
- evidence coverage;
- P0/P1 findings;
- Agent workload and recent changes.

MRL row:

- request ID and description;
- workstream/priority;
- target recipient;
- internal owner;
- requested/due/received dates;
- status;
- linked documents/findings;
- blocker and follow-up draft.

Workstreams: commercial, operational, financial, technology, management/HR, legal/tax/IP referral, impact/ESG when enabled. Specialist areas must display “risk identification—not professional opinion.”

## 5.9 Financials tab

Toggles: Statements, QoE, Add-backs, Working Capital, Customers, Scenarios.

Requirements:

- spreadsheet-like density without becoming an ungoverned spreadsheet clone;
- annual/monthly switch;
- reported, management-adjusted, reviewer-adjusted and accepted values;
- formulas and source-cell lineage;
- currency/unit controls;
- scenario selector;
- comments and reviewer decisions;
- export to live-formula workbook.

QoE bridge:

`Reported EBITDA/SDE → proposed adjustments → evidence status → reviewer decision → normalized earnings`

Each add-back shows description, period, amount, recurring/non-recurring classification, source, Agent view, human decision, accepted amount and valuation/return impact.

## 5.10 Valuation & Returns tab

Toggles: Entry, Comparables, Sources & Uses, Operating Cases, Returns, Sensitivities, Exit, Terms.

Visual requirements:

- value/earnings bridge;
- sources-and-uses table;
- base/upside/downside cases;
- IRR/MOIC sensitivity matrix;
- debt paydown chart;
- breakeven and covenant headroom;
- assumption drawer with source and owner;
- never imply precision beyond source quality.

## 5.11 Risks tab

Views: Register, Heatmap, By Hypothesis, By Deal Action.

Risk row: severity, probability, evidence, affected thesis/model, owner, mitigation, deadline, residual risk, and required transaction action: Stop, Pause, Reprice, Closing Condition, Contractual Protection, Specialist Review, or 100-Day Item.

## 5.12 IC tab

Toggles: Memo, Supporting Pack, Questions, Decision History.

Memo anatomy:

1. recommendation and decision requested;
2. transaction overview;
3. thesis and key assumptions;
4. business/market/management findings;
5. financial/QoE and valuation/returns;
6. risks, mitigants and open evidence;
7. value creation and exit;
8. proposed terms/conditions;
9. dissent and alternatives;
10. Supporting Analysis & FAQ;
11. appendices/citations.

Decision component records approve/reject/defer/conditional, voter/approver, rationale, conditions, date, source snapshot, conflicts and later amendments. Agent recommendations never appear as votes.

## 5.13 Relationships tab

Participants grouped by broker/seller/management/advisors/lenders/experts/internal team. Show role, influence, introduction path, last/next interaction, commitments and linked communications. Respect communication/account restrictions visibly.

## 5.14 Execution tab

Toggles: Outreach, NDA/CIM, IOI/LOI, Financing, Closing, 100-Day.

Each milestone shows owner, counterparty, documents, approvals, dependencies, status, deadline and evidence. Draft communication clearly differs from sent communication. Closing checklist cannot imply legal completion without accountable human confirmation.

## 5.15 Activity tab

Unified immutable timeline filters: Humans, Agents, Automations, Documents, Decisions, Communications, Changes. Each entry exposes actor, action, source object, permission/approval, Memory/Skill/model used where material, optimization receipt and undo/follow-up where valid.

# 6. Cross-cutting interaction requirements

## 6.1 Evidence inspection

Any material claim or derived number must be inspectable in ≤2 interactions. Citation preview shows source, page/cell/section, quote/extract, date, confidence and access restrictions. User can open original without losing place.

## 6.2 Agent interaction

- persistent Ask Agent entry point plus contextual actions;
- Agent states: idle, gathering, analyzing, awaiting input, proposal ready, failed;
- show plan/progress at useful granularity;
- outputs land as drafts/proposals with sources;
- distinguish “Agent inferred” from “source says”;
- user can narrow account, data, model, budget and execution target before run.

## 6.3 Governance

Approval card includes what will happen, why, exact changes/output, affected data/accounts, risk, cost estimate, reversible status and requester. External actions never hide inside a general “Continue” button.

## 6.4 Change and version handling

- “changed since last review” markers;
- semantic diff for facts, documents, model assumptions and reports;
- append-only decision history;
- superseded values visible but not primary;
- regenerated artifacts identify source snapshot and changes.

# 7. States

Design each major screen/component for:

- loading/skeleton;
- honest empty/new workspace;
- partially connected;
- populated;
- stale;
- degraded connector;
- permission denied/restricted;
- offline/local-only;
- Agent running;
- awaiting approval;
- recoverable error;
- conflict/contradiction;
- archived/passed;
- success with next action.

No dummy deal data in runtime designs. Design files may use clearly labelled illustrative content, but implementation acceptance uses real connected data or honest empty states.

# 8. Visual and accessibility requirements

- follow Bridge design tokens and `docs/wiki/design-system.md`;
- professional, calm, evidence-dense; avoid generic fintech gradients and decorative dashboards;
- color never carries R/Y/G, risk, verification or permission meaning alone;
- WCAG 2.2 AA target;
- complete keyboard operation, visible focus, semantic headings/tables, meaningful labels;
- minimum 44px touch targets on mobile;
- chart data available as accessible table;
- reduced-motion support;
- truncation always offers accessible full value;
- dates, currency, units and timezones explicit;
- dense tables support zoom and do not force page-level horizontal overflow.

# 9. Design deliverables

```yaml
required_deliverables:
  - sitemap and navigation behavior at desktop/tablet/mobile
  - low-fidelity flows for sourcing-to-triage, CIM-to-diligence, QoE-to-IC, approval-to-send
  - high-fidelity Overview, Deals list, Deal Summary, Documents, Hypotheses, Evidence, Diligence/MRL, Financials/QoE, IC, Execution
  - responsive variants at 1440, 1024, 768, 375
  - component inventory and states
  - interaction annotations and keyboard behavior
  - empty/error/restricted/stale/offline states
  - citation/source inspector
  - Agent progress and approval patterns
  - prototype covering one complete Deal journey
  - accessibility annotations
  - design-token mapping and developer handoff specs
```

# 10. Prototype journey

Designer prototype must demonstrate:

1. New target appears in Sourcing Feed.
2. User inspects transparent thesis-fit factors and creates/merges Deal.
3. CIM arrives and is matched to Deal.
4. User inspects extraction and source citation.
5. Agent proposes Hypothesis Tree and MRL.
6. Contradicted evidence produces a P1 red flag and follow-up request.
7. Financials populate QoE; user accepts/adjusts/rejects add-backs.
8. Valuation and return scenarios update.
9. IC pack is generated with citations, gaps and FAQ.
10. Human records conditional decision.
11. Approved outreach/LOI draft moves into Execution.
12. Activity timeline proves who/what/why/source/approval.

# 11. Acceptance criteria

- one global DealPilot nav entry; no global-nav explosion;
- all Deal-associated information reachable from Deal workspace;
- each material claim/number reaches source in ≤2 interactions;
- user always knows source fact vs Agent inference;
- every P0/P1 risk has explicit transaction action;
- responsive at 375px without loss of approval/evidence capability;
- external action visibly separated and approval-gated;
- no inaccessible action appears enabled;
- no essential content depends on hover or color;
- exact list/filter/view state survives navigation;
- design covers all required states and full prototype journey;
- implementation can map every component to a named Bridge primitive or DealPilot package object.
