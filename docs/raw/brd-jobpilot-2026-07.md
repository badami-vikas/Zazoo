---
title: JobPilot — Business Requirements Document
type: raw
doc_kind: reference
status: proposed
companions: [jobpilot-module-plan-2026-07.md, jobpilot-vision-requirement.md, jobpilot-architecture-requirement.md, vocabulary-code-migration-plan-2026-07-14.md, requirement-bugs-2026-07-14-actionable-shell-second-brain.md]
related_wiki: ../wiki/jobpilot.md
updated: 2026-07-14
tags: [brd, jobpilot, module, jobs, agents, skills, automations, governance]
---

# JobPilot — Business Requirements Document

*Decision brief · July 2026 · Bridge Living Software*

## 1. Executive decision

JobPilot is an installable **Module** that helps a candidate discover suitable jobs, decide which are worth pursuing, prepare truthful application Files, submit only with explicit approval, track every Application, and learn from outcomes. Its defining interaction is a concise green/red decision supported by evidence; Agents perform the bounded preparation around that decision.

JobPilot composes shared Bridge Engines, Integrations, Agents, Skills, Automations, Databases, Records, Relations, Views, Files, Results, Events, Decisions, and Actions. It does not create a parallel runtime or duplicate shared capability.

```yaml
product_decisions:
  product_unit: installable Module
  route: /jobpilot
  primary_user: individual job candidate
  primary_value: higher-quality applications with less repetitive effort and complete visibility
  defining_interaction: evidence-backed green or red decision on each Job Posting
  submission_policy: every external submission requires an explicit Human approval at launch
  sourcing_policy: authorized structured Sources first; restricted Sources disabled by default
  truth_policy: every tailored claim must resolve to verified Candidate Profile evidence
  data_policy: private candidate data remains in the user's authorized Local or Cloud Plane
  actionability_policy: every visible JobPilot item opens context or offers a safe next Action
  skill_policy: only an Agent may select and invoke a Skill
  naming_policy: canonical terms apply to UI, code, schema, APIs, Events, persisted payloads, and tests
```

## 2. Business problem and opportunity

Candidates lose time across fragmented job boards, repeated screening forms, document tailoring, status tracking, follow-up, and interview preparation. High-volume application services reduce effort by creating spam, weak fit, unverified claims, account risk, and poor visibility. A candidate instead needs one governed operating surface that preserves judgment at consequential points while automating repeatable preparation.

```yaml
problems_to_solve:
  - relevant Job Postings are distributed across Sources with inconsistent data and duplicates
  - fit decisions lack concise evidence and clear concerns
  - resume and cover-letter tailoring is repetitive and can introduce unsupported claims
  - application answers are repeatedly entered and inconsistently maintained
  - submission state, sent Files, communications, and deadlines are fragmented
  - response and interview preparation rarely feeds future fit decisions
  - opaque bulk submission harms candidate reputation and violates user control

business_opportunity:
  user_value:
    - spend time deciding and interviewing rather than copying data
    - improve application quality without sacrificing truthfulness
    - preserve one inspectable history from discovery through outcome
  Bridge_value:
    - prove that one governed runtime supports a high-value professional Module
    - reuse sourcing, document, communication, Calendar, Relationship, and Memory capabilities
    - demonstrate measurable adaptation from Human Decisions and outcomes
```

## 3. Goals, outcomes, and exclusions

```yaml
goals:
  G1: produce useful, deduplicated Job Posting Records from authorized Sources
  G2: explain why each posting may or may not fit the Candidate Profile
  G3: turn a green Decision into truthful, reviewable Tailored Materials
  G4: prepare application fields while reserving sensitive and uncertain answers for the Human
  G5: require approval before every external submission
  G6: maintain one complete Application history including Files, Results, Events, Decisions, and Actions
  G7: detect responses, prepare follow-up, and support interviews without unattended sends
  G8: improve recommendations from explicit decisions and observed outcomes under evaluation gates
  G9: make the JobPilot Module and every meaningful item in it directly actionable

not_in_scope:
  - unattended bulk application submission
  - bypassing Source restrictions, anti-bot measures, authentication, or consent
  - covert interview assistance
  - fabricated qualifications, employment facts, education, compensation, or outcomes
  - guaranteed fit scores, interview rates, offers, or compensation
  - storing raw credentials in Module Databases, Files, browser storage, or Agent context
  - sharing candidate data across Organizations or publishing it to Commons
  - a private scheduler that duplicates the Calendar Module
  - direct Skill invocation by a Human, Module, Automation, Integration, or View
```

## 4. Users and jobs to be done

```yaml
primary_persona:
  name: Candidate
  needs:
    - define desired roles, constraints, categories, and pace
    - understand fit quickly without false precision
    - approve accurate materials and consequential Actions
    - see what happened, why, and what needs attention

supporting_roles:
  Hiring_Contact:
    role: Person associated with an Application, communication, or interview
  Organization_Administrator:
    role: governs Plane, Integration, retention, and Agent authority where JobPilot is team-managed

jobs_to_be_done:
  - when I start a search, compile my verified Candidate Profile and let me correct it before use
  - when new jobs appear, show the strongest reasons for and against pursuing each one
  - when I choose green, prepare accurate materials and answers for my review
  - before anything leaves Bridge, show the exact payload, destination, reason, and approval consequence
  - after I apply, keep status, correspondence, deadlines, and sent Files together
  - when an interview approaches, prepare an evidenced brief and connect it to Calendar
  - as outcomes accumulate, adapt future recommendations without silently changing authority
```

## 5. Product structure and navigation

JobPilot appears as an item under **Modules** in the left sidebar. The item is clickable in every state: installed Modules open their Module detail; available Modules open a governed install detail. JobPilot is never a read-only label.

```yaml
module_detail:
  header:
    fields: [name, status, Plane, version, owner, health, last activity]
    actions: [Open, Configure, Pause, Update, Uninstall]
    safety: consequential Actions require impact preview and confirmation
  sections:
    Overview:
      purpose: status, attention queue, recent Events, and primary Actions
    Data:
      purpose: Databases, Records, Relations, Files, Results, and Memory scoped to JobPilot
    Agents:
      form: Page with nested Sections
      sections:
        Agents: installed JobPilot Agents, authority, state, evaluation, and activity
        per-Agent Skills: Skills grouped within each owning or allowed Agent row and detail
    Automations:
      purpose: triggers, schedules, next run, owner Agent, status, and run history
    Integrations:
      purpose: connected services, scopes, health, and credential-reference status
    Views:
      purpose: active and available JobPilot Views with open, configure, duplicate, and disable Actions

module_detail_acceptance:
  - every listed Agent opens its detail and supported Actions
  - every listed Skill opens its contract, allowed Agents, provenance, version, evaluation, and usage history
  - every Automation opens its trigger, owner Agent, Agent Request, limits, approvals, and run Events
  - every Integration opens its authorization scopes, connected account, health, and revoke Action
  - every View opens the underlying scoped data and its configuration
  - empty states explain why the list is empty and offer the permitted next Action
  - no card, count, badge, or list row is a dead end
```

Within JobPilot, strongly related Databases use toggle Pages. Every Database Page uses the Standard Toolbar: List, View, search, filter, primary Add Action, and overflow menu. Supported Views and right-click menus follow the shared UI architecture contract.

```yaml
jobpilot_pages:
  Overview:
    sections: [attention queue, sourcing health, application pipeline, upcoming interviews, recent Events, Agent activity]
  Cards:
    purpose: green-red review feed for scored Job Postings
    saved_views: [New, Green, Review, Dismissed, Changed, Missing detail]
  Applications:
    views: [Table, Board, Calendar, Cards]
    board_stages: [Sourced, Flagged, Tailoring, Evaluating, Approved, Awaiting Submit, Applied, Response, Interview, Offer, Rejected, Archived]
  Sources:
    views: [Table, Cards]
  Materials:
    views: [Table, Cards]
  Answers:
    views: [Table]
  Interviews:
    views: [Table, Calendar, Cards]
  Agents:
    sections: [Agents, per-Agent Skills]
  Automations:
    views: [Table, Cards]
  Integrations:
    views: [Table, Cards]
  Files:
    purpose: all user-visible Files associated with JobPilot Records
```

## 6. Core experience requirements

### 6.1 Candidate Profile and preferences

```yaml
requirements:
  JP-BRD-001:
    statement: ingest one or more user-selected resumes and cover letters into a draft Candidate Profile
    acceptance:
      - every extracted Field retains provenance to its source File
      - conflicting or low-confidence Fields require Human correction
      - the Candidate approves the profile before any Agent uses it
      - profile correction creates an Event and preserves version history
  JP-BRD-002:
    statement: capture editable role categories, locations, work authorization, seniority, compensation preferences, and pacing limits
    acceptance:
      - sensitive Fields are access-controlled and never exposed through ordinary search
      - changes trigger governed rescoring through an Automation-owned Agent Request
```

### 6.2 Sourcing, normalization, and cards

```yaml
requirements:
  JP-BRD-010:
    statement: ingest Job Postings from authorized structured Sources and stamp Source, freshness, license or terms class, and provenance
    acceptance:
      - restricted Sources are disabled by default
      - Source failures are visible and never silently treated as zero results
      - duplicate postings resolve to one canonical Record with source Relations
  JP-BRD-011:
    statement: evaluate each Job Posting against the approved Candidate Profile and categories
    acceptance:
      - output is an explained Result with green reasons, red concerns, missing evidence, and uncertainty
      - no unlabeled percentage is presented as objective fit
      - users can inspect the supporting profile and posting Fields
  JP-BRD-012:
    statement: make every card actionable
    acceptance:
      - Green creates or advances an Application and requests materials preparation
      - Review keeps the posting in an explicit decision queue
      - Dismiss records the reason and prevents repeated resurfacing unless material facts change
      - Open reveals the Job Posting, Source, Relations, Events, and permitted Actions
```

### 6.3 Materials and answers

```yaml
requirements:
  JP-BRD-020:
    statement: generate Tailored Materials only after a green Decision
    acceptance:
      - each changed claim resolves to Candidate Profile evidence
      - protected facts cannot be inferred from a Job Posting
      - every version is a File with provenance, diff, status, and associated Application
      - the Candidate can edit, regenerate with instructions, approve, or reject
  JP-BRD-021:
    statement: evaluate Tailored Materials for relevance, truthfulness, clarity, and ATS-safe rendering
    acceptance:
      - evaluation produces an explained Result
      - iteration has a fixed cap and then requires Human review
      - the truthfulness gate is structural and cannot be overridden by prompt text
  JP-BRD-022:
    statement: maintain an Answer Bank of user-approved reusable answer Records
    acceptance:
      - every answer has provenance, scope, correction history, and last-reviewed date
      - uncertain or unmatched questions route to Human review
      - identity, payment, government identifier, and voluntary demographic questions are never auto-filled
```

### 6.4 Application preparation and submission

```yaml
requirements:
  JP-BRD-030:
    statement: map approved materials and answers to supported application forms
    acceptance:
      - show every proposed Field value and destination before submission
      - authentication, CAPTCHA, uncertainty, or changed forms create a visible Human handoff
      - failed mapping preserves completed preparation and a safe continuation link
  JP-BRD-031:
    statement: require a Human Decision before every external submission
    acceptance:
      - approval shows destination, Files, answers, permissions, and expected Action
      - the execution path rejects missing, stale, or mismatched approval
      - success and failure each create an immutable Event and Application Outcome Result
      - no bulk bypass or unattended submission path exists
  JP-BRD-032:
    statement: enforce per-day and per-domain pacing
    acceptance:
      - excess work is deferred rather than dropped
      - pending capacity and next eligible time are visible
      - a user may lower limits immediately but increases pass governance policy
```

### 6.5 Tracking, communications, and interviews

```yaml
requirements:
  JP-BRD-040:
    statement: maintain one Application Record from discovery through final outcome
    acceptance:
      - stage changes occur through the governed transition contract
      - Application detail contains posting, fit, materials, answers, submission, communications, interview, Relations, and activity
      - every sent File version and confirmation remains inspectable
  JP-BRD-041:
    statement: match authorized inbound communication to an Application
    acceptance:
      - high-confidence matches are proposed with supporting evidence
      - uncertainty routes to Human review and never silently advances stage
      - outbound communication remains draft-only until approved
  JP-BRD-042:
    statement: prepare an interview brief when an Application enters Interview
    acceptance:
      - claims cite authorized Sources or Module Memory
      - interview scheduling uses the Calendar Module
      - relevant Hiring Contacts use Relations to Relationship Module Records
```

## 7. Data requirements

JobPilot data is Module-scoped Memory expressed through Databases, Records, Relations, Files, Results, and Events. No separate repository of detached content is created.

```yaml
databases:
  Candidate_Profiles:
    record: Candidate Profile
    key_relations: [Source Files, Categories, Applications, Answer Bank Entries]
  Job_Postings:
    record: Job Posting
    key_relations: [Sources, Companies, Applications, Fit Results]
  Applications:
    record: Application
    key_relations: [Candidate Profile, Job Posting, Tailored Materials, Submission, Communications, Interviews, Hiring Contacts]
  Sources:
    record: Source
    key_relations: [Job Postings, Integrations, Source Runs]
  Materials:
    record: Material Version
    key_relations: [Application, Candidate Profile Evidence, Evaluation Results, Files]
  Answer_Bank:
    record: Answer Bank Entry
    key_relations: [Candidate Profile, Applications, Questions]
  Communications:
    record: Communication
    key_relations: [Application, People, Source Message]
  Interviews:
    record: Interview
    key_relations: [Application, People, Calendar Record, Preparation Result]

relation_rules:
  - one Relation row expresses one semantic relation type
  - a Relation may carry multiple typed Fields, dates, confidence, provenance, and evidence references
  - multiple meanings between the same Records use multiple Relation rows
  - group participation uses an Event or Record plus participant Relations

memory_rules:
  - every capture and imported item becomes inspectable Module-scoped Memory
  - every Memory entry resolves to its source, retention policy, Plane, and associated Records
  - generated non-file output is a Result; durable user-visible content is a File
  - all JobPilot data is associated with the JobPilot Module and, where relevant, a domain Record
```

## 8. Agent, Skill, Automation, and Integration requirements

Only Agents consume Skills. An Automation creates a scheduled or triggered **Agent Request**; the assigned Agent selects a permitted Skill under the Request, policy, Plane, and budget. A Human asks an Agent to act. A View exposes Actions that create Human Requests or Agent Requests. An Integration exposes governed external access but does not invoke a Skill itself.

```yaml
agents:
  Search_Strategist:
    outcome: maintain categories, sourcing strategy, and authorized Source priorities
    allowed_skills: [compile candidate profile, generate categories, assess source strategy]
  Sourcing_Analyst:
    outcome: retrieve, normalize, deduplicate, and monitor Job Postings
    allowed_skills: [scan authorized sources, normalize posting, deduplicate posting, detect changes]
  Fit_Scorer:
    outcome: produce evidenced green and red fit Results
    allowed_skills: [score deterministic rules, explain fit, learn from flag feedback]
  Materials_Writer:
    outcome: draft truthful Tailored Materials after a green Decision
    allowed_skills: [tailor resume, tailor cover letter, render ATS-safe PDF]
  Materials_Evaluator:
    outcome: evaluate relevance and truthfulness with bounded iteration
    allowed_skills: [evaluate materials, verify protected fields, compare versions]
  Application_Coordinator:
    outcome: prepare approved form data, route approval, and preserve submission Outcomes
    allowed_skills: [match answers, detect sensitive questions, map form fields, prepare handoff]
  Response_Router:
    outcome: match inbound communication and draft appropriate follow-up
    allowed_skills: [match inbound message, draft follow-up, summarize response]
  Interview_Prep:
    outcome: produce evidenced interview preparation and Calendar coordination
    allowed_skills: [research company, prepare interview brief, draft follow-up]

agent_skill_invariants:
  - each Skill declares allowed Agent identities, typed input, typed output, Plane, permissions, budget, and evaluation version
  - no Skill has independent authority or a direct user-run control
  - removing an Agent's permission makes the Skill unavailable immediately
  - Agent detail shows available Skills; Skill detail shows every allowed Agent
  - Skill invocation creates Events linked to the Agent Request, Agent, Record, Result or File, and approval where required

automations:
  Scheduled_Source_Scan:
    agent: Sourcing_Analyst
    trigger: authorized schedule
  Posting_Change_Detection:
    agent: Sourcing_Analyst
    trigger: Source ingestion completion
  Fit_Rescore:
    agent: Fit_Scorer
    trigger: Candidate Profile, category, or Job Posting material change
  Materials_Preparation:
    agent: Materials_Writer
    trigger: green Decision
  Materials_Evaluation:
    agent: Materials_Evaluator
    trigger: new Tailored Materials version
  Submission_Approval_Request:
    agent: Application_Coordinator
    trigger: approved materials and complete mapped answers
  Inbound_Response_Routing:
    agent: Response_Router
    trigger: authorized new communication Event
  Interview_Preparation:
    agent: Interview_Prep
    trigger: Application enters Interview

automation_invariants:
  - every Automation declares trigger, owner Agent, idempotency key, budget, retry policy, stop condition, risk band, and run history
  - an Automation never selects or invokes a Skill directly
  - retries preserve the same authority and runtime-taint labels
  - consequential failures stop safely and create an actionable attention item

integrations:
  Job_Sources: authorized ATS endpoints, aggregators, and feeds
  Documents: user-selected resume and cover-letter Files plus PDF rendering
  Communications: scoped inbound access and draft-only outbound preparation
  Relationship: People, Communities, Relations, and Signals relevant to Applications
  Calendar: interview Events and reminders
  Models: governed local and cloud model providers behind Engine ports
  Credential_Broker: opaque credential references injected only during authorized execution
```

## 9. Governance, privacy, and security

```yaml
requirements:
  authority:
    - Agents act only within explicit Module, Record, Plane, Integration, and risk scopes
    - every external submission and send requires a current Human approval
    - Agent authority cannot be expanded by a Skill, Automation, Integration response, or retrieved content
  privacy:
    - raw resumes, answers, captures, and credentials are private by default
    - candidate data never enters Commons
    - Plane crossing requires policy, purpose, minimum disclosure, and an Event
  provenance:
    - every imported Field, generated Result, File, and external Action resolves to its sources and actor
    - source terms classification is versioned and rechecked
  runtime_taint:
    - labels propagate through retrieval, prompts, models, Skills, Actions, Events, Results, Files, queues, caches, and retries
    - unknown or restricted derivation fails closed at privileged and egress boundaries
    - declassification requires deterministic validation or a recorded Human Decision
  credentials:
    - raw secrets never appear in Records, Files, Results, logs, prompts, or browser storage
    - revocation immediately blocks dependent execution and creates actionable health state
  audit:
    - material Agent, Automation, approval, submission, stage, and configuration changes produce append-only Events
```

## 10. Functional quality and accessibility

```yaml
quality_requirements:
  usability:
    - first useful card appears in the same session when authorized Sources return data
    - attention states state the cause, consequence, and next safe Action
    - standard navigation and toolbar behavior matches every other Module
  accessibility:
    - full keyboard navigation and visible focus for cards, menus, toggles, tables, and dialogs
    - color is never the sole carrier of green, red, stage, or risk meaning
    - status and async updates are announced to assistive technology
  reliability:
    - no posting, application, draft, or approval is silently dropped
    - Source and Integration failures surface within the same operating session
    - duplicate execution is blocked by idempotency and transition checks
  performance:
    - card review interactions feel immediate on supported local hardware
    - long Agent runs remain resumable and show progress without blocking navigation
  portability:
    - Desktop and web use the same Module contracts and data semantics
    - privileged local execution degrades to an explained handoff when unavailable
```

## 11. Measures of success

```yaml
success_measures:
  activation:
    metric: time from Module install to first evidenced card
    target: same session
  source_quality:
    metrics: [authorized postings per day, freshness, duplicate rate, Source failure recovery time]
  decision_quality:
    metrics: [green-to-application rate, dismissal reasons, recommendation calibration over time]
  materials_quality:
    metrics: [truthfulness block rate, evaluator-Human agreement, approved version rate]
    hard_invariant: seeded unsupported claims and protected-field changes are blocked
  efficiency:
    metrics: [Human minutes per approved Application, repeated answers avoided, preparation completion rate]
  outcomes:
    metrics: [response rate by category, File version, and Source; interview rate; final outcomes]
  trust:
    hard_invariants: [zero unapproved submissions, zero sensitive auto-fills, zero raw credential exposure]
  actionability:
    metrics: [dead-end interactive elements, actionable empty-state coverage, Module-detail destination coverage]
    target: zero dead-end interactive elements
```

## 12. Delivery priorities and acceptance gates

```yaml
delivery:
  JP0_Foundation:
    outcome: JobPilot Module detail, canonical Databases, real persistence, empty states, and actionable navigation
    required_for_exit:
      - clicking JobPilot opens Module detail
      - capability toggle group contains Agents, Automations, and Integrations Pages; Skills appear only within Agents
      - all existing deprecated identifiers are inventoried for real migration
      - no display-only alias is accepted as completion
  JP1_Profile:
    outcome: approved Candidate Profile from real user-selected Files
  JP2_Sourcing:
    outcome: real authorized Job Postings normalized, deduplicated, scored, and rendered as actionable cards
  JP3_Materials:
    outcome: evidenced Tailored Materials with structural truthfulness enforcement
  JP4_Submission:
    outcome: one real application completed through explicit approval with immutable Events
  JP5_Response:
    outcome: inbound responses matched and follow-up drafts prepared without unattended send
  JP6_Interview_and_learning:
    outcome: interview preparation, Calendar linkage, and evaluated adaptation from outcomes

universal_exit_gate:
  - canonical vocabulary in product copy, code, schema, APIs, Events, persisted payloads, tests, and migration scripts
  - no compatibility alias remains after its recorded migration window
  - real connected data or honest actionable empty state; no fabricated runtime data
  - Agent-only Skill invocation proven by positive and negative tests
  - authorization, Plane, runtime-taint, approval, idempotency, and credential tests
  - held-out evaluation and adversarial truthfulness checks
  - browser evidence for changed surfaces and keyboard paths
  - provenance, source-terms, security, cost, and latency evidence
  - adjacent Module and shared-component checks
```

## 13. Dependencies, risks, and mitigations

```yaml
dependencies:
  - shared Module detail and Standard Toolbar components
  - Engine execution, Agent Request, policy, approval, Event, and runtime-taint contracts
  - Credential Broker and authorized Integration adapters
  - Relationship Module for Hiring Contacts and Signals
  - Calendar Module for interviews
  - Commons Registry for signed generalized capabilities only

risks:
  source_fragility:
    mitigation: provider contracts, freshness health, pinned versions, and visible failures
  source_terms_change:
    mitigation: periodic classification review and automatic disable pending Human Decision
  profile_poisoning:
    mitigation: provenance, confidence, Human approval, versioning, and downstream invalidation
  unsupported_claim:
    mitigation: structural protected Fields, evidence per change, adversarial evaluation, and Human approval
  response_misroute:
    mitigation: confidence floor, evidence preview, Human review, and governed stage transition
  application_spam:
    mitigation: explicit approval, pacing limits, quality-first defaults, and no bulk bypass
  vocabulary_drift:
    mitigation: canonical glossary checks across UI, code, schema, APIs, payloads, Events, and tests
  dead_end_ui:
    mitigation: actionability acceptance tests for every card, row, badge, count, empty state, and Module section
```

## 14. Decisions still requiring evidence

```yaml
open_decisions:
  - measurable default pacing limits by Source and submission domain
  - which authorized Sources form the first production connector set by target geography
  - minimum confidence required to propose a communication-to-Application match
  - retention defaults for resumes, screening answers, communication, and rendered Files
  - when a team-managed JobPilot configuration is commercially justified beyond the individual candidate case
```

These decisions may tune thresholds and sequence within the approved JobPilot scope. They may not weaken the Human submission gate, truthfulness invariant, credential boundary, Plane policy, Agent-only Skill rule, or canonical vocabulary requirement.
