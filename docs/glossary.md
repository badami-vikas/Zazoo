# Bridge glossary

The only canonical vocabulary for product copy, architecture, APIs, schemas, Events, persisted payloads, tests, and plans. Add a term only when it names a durable distinction. Implementation symbols belong in code maps unless people must use them to reason about the product. Superseded names belong only in the migration ledger.

## Platform identity and structure

- **Bridge** — Living Software that learns how a person works and proposes, governs, and improves the software around that work.
- **Living Software** — software that adapts its data structures, capabilities, surfaces, and behavior from evidence while preserving user control.
- **Organization** — user or team security, membership, billing, and data boundary. A solo user has an Organization of one.
- **Kernel** — surface-independent shared core containing governance, graph, context, capability registration, and execution contracts.
- **Module** — installed functional area containing Databases, Pages, Views, Agents, Skills, Automations, Integrations, rules, and domain language. Every installed Module is a clickable left-navigation destination.
- **Module Detail** — actionable Module overview showing its purpose, status, Pages, Agents, each Agent’s Skills, Automations, Integrations, Files, recent Runs, settings, and permitted management Actions.
- **Blueprint** — versioned definition of an Organization’s installed Modules, default Pages, Views, Automations, and Home composition. A Blueprint proposes configuration; it does not bypass activation governance.
- **Home** — cross-Module landing View that assembles relevant, recurring context and Actions.
- **Page** — routable Module surface backed by one Database, selected by a toggle or navigation item. A Page is DERIVED, not designed: declaring a Database in a Module creates its Page. Overview, Summary, Report, File, Result, or section-only content is not a Page.
- **View** — presentation of a Page’s Database, such as table, cards, board, calendar, map, graph, or form. A View is a UI element the user picks at render time: it holds no permissions, has no trust lifecycle, and is never a Capability (ADR-180).
- **View Grammar** — registered View types and conversion rules that every Module and generated surface must follow.
- **List** — saved selection over ONE Database: which rows, and which of its columns are shown. Both row filters and column subsets are Lists — a different projection of the same Database never earns its own Page (ADR-180).
- **Section** — titled block within a Page.
- **Database** — structured collection of Records governed by one schema. A Database is a Capability (`capability_type: database`) because it is what carries record permissions; each Database in a Module surfaces as exactly one Page.
- **Record** — durable row in a Module Database.
- **Record Detail** — routable surface for one Record’s Fields and related Sections. Every Record has one; Record Detail is not a sibling Module Page.
- **Sub-module** — collapsible child of a Module in the left nav. Either a grouping of that Module's own Pages (`module.sub_modules[]`, UI Rulebook §2 rule 3) or a whole Module nesting under a parent (`parent_module`, ADR-178). A grouping is navigation only, never an installation.
- **Field** — typed value on a Record.
- **Relation** — one typed semantic connection between Records. It may carry attributes, dates, confidence, provenance, and many evidence references. Different meanings use separate Relations; group relationships use a Record or Event plus participant Relations.
- **File** — durable user-visible file produced, imported, or accumulated by a Module. Non-file outcomes are Results.

## Work and execution

- **Request** — wanted outcome supplied by a Human or another authorized actor.
- **Goal** — durable intended outcome used to classify and prioritize related Tasks and eligible Skills.
- **Task** — bounded unit of work toward a Goal with inputs, owner, state, constraints, and done criteria.
- **Planner** — bounded reasoning phase that proposes a Plan. It receives no authority to execute merely because it can plan.
- **Plan** — immutable proposed steps or directed action graph for a Request.
- **Decision** — recorded governance verdict on a Plan or consequential Action.
- **Review Mode** — computed handling requirement: `auto`, `notify`, `approve`, or `quorum`. It is resolved from risk, authority, trust, audience, data scope, side effects, and Organization policy, then recorded with its reasons.
- **Run** — deterministic, attributable, replayable execution of an approved Plan.
- **Action** — atomic governed operation within a Run.
- **Event** — append-only record that something happened. Events are residency-partitioned and may be surfaced or remain background evidence.
- **Timeline** — read projection over Events; not an independent source of occurrences.
- **Result** — outcome of a Run or Action, including status, changed Records, evidence, and produced Files.
- **Automation** — trigger- or schedule-driven coordinator that starts a governed Agent Run. The selected Agent may invoke its allowed Skills through Engines; an Automation never invokes a Skill directly or contains hidden authority.
- **Scheduled Automation** — Automation whose trigger is a time, interval, or calendar rule.
- **Automation Run** — one recorded execution of an Automation.

## Actors and capabilities

- **Human** — accountable user who supplies intent, judgment, permissions, corrections, and approvals.
- **Agent** — bounded reasoning actor with a mandate, capability scope, attributable activity, and explicit Skill set. Only Agents consume Skills.
- **Chief of Staff** — default coordinating Agent and interlocutor. Its routing role is a product composition, not an architectural requirement.
- **Learning Agent** — Agent that observes authorized evidence, conducts governed research, maintains correctable context, and recommends improvements. It does not silently change authority or production capabilities.
- **Internal Strategist** — Agent that performs analytical synthesis, comparison, hypothesis testing, scenario modeling, and evidenced recommendations from Human and Learning outputs. It does not own stakeholder commitments, source-rights attestation, policy approval, or code deployment.
- **Governance Agent** — Agent that explains policy, monitors control outcomes, and coordinates remediation. Deterministic governance controls—not the Agent’s opinion—decide authority.
- **Capability Builder** — Agent that creates and tests proposed capability changes. It cannot activate its own output.
- **Skill** — governed, versioned, callable capability that performs one bounded Goal/Task job for an eligible Agent. It has typed inputs, outputs, permissions, Plane/data scope, risk, budget, and tests. Agent defaults are preferences, not ownership; a Human or Automation never invokes it directly, and it never schedules itself.
- **Child Agent Run** — bounded delegated Run created by a parent Agent for one Goal/Task. Authority, Skills, data scope, budget, review requirement, runtime taint, and delegation depth cannot exceed the parent Run; parent remains accountable.
- **Communications Skill** — draft-only Skill for preparing communications. Sending remains a separate egress-governed Action.
- **Integration** — governed connection to an external or local system, including authentication, synchronization, and data contracts.
- **Engine** — reusable internal runtime machinery, such as execution, retrieval, routing, synchronization, policy evaluation, recurrence, or model selection. Agent-consumed Skills use Engines; Automations start Agent Runs.
- **Capability** — one governed unit with its own trust lifecycle, permissions, and risk band: a Skill, Automation, Agent, Integration, or Database. It is the ATOM the governance pipeline reasons about, not a composite of several. A Module is the shipping unit that bundles capabilities; asking whether something is "a Module or a Skill" is a category error (ADR-180).
- **Capability Manifest** — source-of-truth declaration of a capability’s inputs, outputs, permissions, Integrations, risk evidence, rollback behavior, evaluation requirements, and optional UI surface.
- **Module Installation** — Organization-scoped record that a Module and version are available for use.
- **Module Version** — immutable release of a Module. Exactly one version is live for an installation; replacement and rollback preserve history.
- **Rollback** — governed forward change based on a prior known-good version, preserving the append-only record rather than rewriting history.
- **Output Contract** — typed declaration of the Records, Events, Results, and Files a capability may produce.

## Governance, authority, and trust

- **Governance** — deterministic authority, policy, risk, approval, audit, and remediation controls around work.
- **Governance Contract** — invariant that every mutation resolves authority and policy and produces an immutable audit record. Its implementation may be distributed across Planes.
- **Capability Trust Model** — risk, origin, audience, evidence, and observed-performance model used to determine activation and Review Mode.
- **Risk Band** — computed consequence class: Informational, Advisory, Transformational, Operational, or External.
- **Origin** — provenance class of a capability: built-in, template, community, AI-generated, or user code.
- **Audience** — visibility and consequence scope, such as private, team, Organization, or external.
- **Composite Risk** — maximum effective risk across a capability and its dependency closure.
- **Lethal Trifecta** — private-data read, untrusted input, and egress combined in one execution path; this forces the strictest controls.
- **Capability State** — lifecycle state `draft`, `approved`, `active`, or `retired`.
- **Trusted Status** — time-limited property of an active capability earned from evidence. It is not a separate lifecycle state and decays or resets after material change or violation.
- **Auto Mode** — user-authorized pre-approval for narrowly allowlisted low-risk Actions. Policy, hard denies, budgets, and egress restrictions still apply.
- **Activation Budget** — Organization policy limiting how many eligible capabilities or Actions may activate automatically within a period.
- **Kill Switch** — immediate control that disables automatic activation or a capability class without waiting for a later Decision.
- **Capability-Based Access Control (CBAC)** — authority model that intersects role grants, capability scope, delegation, and temporary grants, then subtracts explicit and hard denies.
- **Row-Level Security (RLS)** — database enforcement that denies unauthorized Record access within and across Organizations.
- **Authority Decision** — deterministic result stating whether an actor may perform a requested Action and why.
- **Explicit Deny** — policy rule that remains effective even when another grant would otherwise allow the Action.
- **Agent Floor Deny** — non-removable minimum restrictions applied to every Agent, including protected governance and unrestricted egress operations.
- **Ephemeral Grant** — narrowly scoped, expiring authority for a specific context or Run.
- **Delegation** — recorded authority chain allowing an actor to act for a principal without exceeding either party’s ceiling.
- **Data Scope** — effective data-access boundary, such as none, public, private subset, or explicitly authorized set.
- **Ledger** — append-only audit record of Decisions, Actions, authority resolution, and consequential outcomes.
- **Decision Trace** — inspectable explanation of the inputs, policy version, reasons, and evidence behind an Authority Decision or Review Mode.
- **Failure Event** — typed Event recording severity, owner, retry status, affected scope, evidence, and remediation. Engines own bounded operational recovery; Governance owns policy/control remediation; Learning identifies patterns; Builder implements approved corrections; Humans decide consequential ambiguity.
- **Variance Adjustment** — governed proposal to tune bounded policy parameters from observed outcomes. It cannot alter hard limits or code silently.

## Residency and platform services

- **Local Plane** — customer-controlled residency boundary for private data and local inference. It cannot egress except through the Plane Gate.
- **Cloud Plane** — hosted residency boundary for authorized synchronized data and cloud execution.
- **Plane Gate** — deny-default policy boundary for Local-to-network or cross-residency movement.
- **Relationship Domain** — People, Communities, and Relations within either permitted Plane.
- **Work Domain** — Requests, Plans, Runs, Actions, Events, Results, Automations, and Module Records within either permitted Plane.
- **Commons** — signed registry of generalized Modules, Skills, Integrations, Blueprints, templates, and reusable capability patterns. It never stores personal user data.
- **Bridge Cloud** — hosted control services for identity, synchronization coordination, billing, and telemetry policy. It is separate from Commons.
- **Local Inference** — model execution inside the customer-controlled environment; describes compute location, not a separate Plane.
- **Cloud Inference** — model execution through an authorized hosted provider; describes compute location, not a separate Plane.
- **Unified Graph** — shared Record-and-Relation model spanning permitted Domains and Planes without erasing residency boundaries.
- **Event Partitioning** — storage rule that keeps Local and Cloud Event logs within their respective residency boundaries while allowing governed read projections.
- **Ports and Adapters** — architecture pattern in which stable interfaces isolate Engines and Modules from replaceable providers and infrastructure.

## Context, learning, and sensing

- **Context** — authorized subset of Memory assembled for an actor and Request. Context is temporary and does not become a second durable data model.
- **Memory** — umbrella for retained, inspectable information associated with a Module. Records, Relations, Events, Facts, Results, Files, and user-approved learning retain their own types while contributing to Module Memory. Memory is correctable, portable, and deletable subject to governance and audit requirements.
- **Context Tier** — retention and use class: working, episodic, semantic, or procedural.
- **Context Provider** — authorized source adapter for apps, accessibility, screen, voice, clipboard, filesystem, browser, documents, or email.
- **Sensor SPI** — optional desktop interface implemented by Context Providers; it is never required by the Kernel.
- **Raw Capture** — unprocessed sensor input that remains in the Local Plane.
- **Context Observation** — privacy-filtered, provenance-bearing information derived from a Raw Capture.
- **Capture Tell** — brief Avatar blink emitted for a capture Event so sensing is visible to the user.
- **Activity Span** — time-bounded grouping of related observed activity used before higher-level summarization.
- **Prompt Assembler** — Engine that builds model context from authorized persona, governance, Request, relevant Memory, and Module evidence while preserving provenance and taint labels.
- **Fact** — one claimed attribute of a Record with provenance, confidence, validity, and correction history.
- **Provenance** — source and transformation history of a Fact, File, Result, or context fragment.
- **Living Profile** — current read projection over append-only Facts and their supersession history.
- **Deduplication** — evidence-based process for identifying Records that may represent the same entity.
- **Possible Duplicate Event** — Event requesting review of a suspected duplicate; it does not merge Records automatically.

## Security and controlled intake

- **Credential Broker** — mechanism that resolves opaque, scoped credential grants at an authorized connection edge. Agents, Skills, and Modules never receive raw secrets.
- **Intake Policy** — rules governing how externally supplied content is classified, quarantined, reviewed, and committed.
- **Gated Intake** — quarantine → proposal → approval → commit path for external or unauthenticated content entering a governed Plane.
- **Quarantine** — isolated state in which untrusted content cannot reach privileged or egress-capable execution.
- **Runtime Taint Tracking** — versioned monotonic labels over trust/source, sensitivity, instruction risk, and bounded provenance, carried through retrieval, prompts, models, Skills, Actions, Events, Results, Files, Memory, Runs, storage, queues, caches, and retries. Composition joins labels; missing/malformed labels become unknown and quarantine.
- **Declassification** — explicit reduction of a taint restriction after deterministic validation or a recorded Human Decision.
- **Prompt Injection** — untrusted content attempting to redirect an Agent or model away from the authorized Request and policy.
- **Content Security Policy (CSP)** — browser and desktop-shell restriction on which code and resources may load or execute.
- **Local Media Store** — Local Plane storage seam for private photo, audio, and video bytes.

## Interface and onboarding

- **Avatar** — visual companion and operational status surface. Visual style never determines Agent authority, reasoning, or tone.
- **Avatar Operational State** — current presence state such as idle, working, awaiting approval, blocked, or error. Blink is a transient Capture Tell, not a persistent state.
- **Overlay Window** — desktop-only floating Avatar surface that follows the user’s chosen display and desktop space while preserving drag, position, minimize, and close behavior.
- **Onboarding** — initial trust, permission, preference, and first-value flow, followed by respectful progressive learning questions.
- **Sidebar** — primary persistent navigation surface for Home, installed Modules, and global controls.
- **Panel Control** — shared expand, collapse, and extend-arrow control used identically by the left Sidebar and right Chat Panel, including icon, direction, tooltip, keyboard behavior, animation, and persisted width/state.
- **Chat Panel** — right-side conversational surface using the same Panel Controls and width-state model as the Sidebar.
- **Control Panel** — Organization and Module configuration reached from the standard overflow menu.
- **Standard Toolbar** — shared Page controls ordered as List, View, search, filter, primary Add Action, and overflow menu.
- **Column Menu** — shared Database Field menu for rename, type, fill, filter, sort, group, calculate, lock, hide, insert, duplicate, delete, and Page-toggle commands when the Database supports them.
- **Red Flag** — platform-wide scoped negative-feedback marker on a data cell or rendered bullet. It appears uncolored on hover/focus, turns red when selected, remains reversible/audited, and never substitutes for a domain status or Decision.
- **Pin** — user-saved shortcut to a Page, View, List, Record, or File.
- **Second Brain** — actionable cross-Module graph below the installed Modules in the Sidebar. It visualizes Records, Relations, Events, Files, Agents, and originating Modules; every node and edge opens its source or a governed Action. The name applies only to this user-facing graph and never to an Engine.

## Commons and distribution

- **Commons Registry** — governed interface for discovering and retrieving signed generalized entries from Commons.
- **Registry Entry** — versioned, content-addressed Commons item with publisher identity, manifest, provenance, compatibility, and security evidence.
- **Publisher Signature** — cryptographic proof binding a Registry Entry to its publisher and content.
- **Content Hash** — immutable digest used to pin and verify the exact bytes of a Registry Entry.
- **Privacy Gate** — publish-time validation that blocks personal, Organization-specific, secret, or restricted data from Commons.
- **Marketplace** — optional discovery surface over Commons entries; installation still passes governance and supply-chain checks.
- **Component Registry** — approved reusable interface components available to Module Views and generated Pages.
- **Convergence Threshold** — evidence threshold at which a generalized capability becomes eligible for Commons review; eligibility is not automatic publication.

## Relationship Module

- **Relationship Module** — installed Module whose primary toggle Pages are Signals, People, and Communities. It also owns Relations, Interactions, Introductions, Helpdesk, Sources, Files, and relationship Automations.
- **Signal** — surfaced Relationship Event associated through participant Relations with one or more People and/or Communities. A Signal has a reason for surfacing and at least one safe Action; it is stored in the Event model, not a parallel occurrence store.
- **Person** — Record representing a Human or public identity relevant to the Organization.
- **Community** — Record representing a group, company, institution, or other collective.
- **Interaction** — Record or Event describing a meaningful exchange among participants.
- **Introduction** — governed connection proposal between participants, including consent and outcome evidence.
- **Helpdesk** — sub-module for routing Help Requests to suitable helpers through capability evidence.
- **Help Request** — Record describing requested assistance, constraints, visibility, status, and desired outcome.
- **Offer Help Action** — governed Action volunteering assistance for a Help Request.
- **Capability-Based Routing** — matching Help Requests to potential helpers using evidenced abilities and constraints rather than topic words alone.
- **Source** — Record representing an information origin, feed, intermediary, or discovery channel. Credentials are referenced through the Credential Broker, never stored as ordinary Fields.

## DealPilot Module

- **DealPilot** — Entrepreneurship Through Acquisition Module for sourcing, evaluating, diligencing, and governing acquisition opportunities.
- **Deal** — Record representing an investment opportunity.
- **Thesis** — Record describing investment focus, constraints, evidence, and evaluation criteria.
- **Deal Fit** — explained Result evaluating a Deal against one or more Theses with evidence and uncertainty.
- **Deal Stage** — governed state of a Deal from discovery through evaluation, diligence, decision, closing, portfolio, or passed outcome.
- **Sourcing Waterfall** — ordered discovery strategy across authorized Sources and Integrations.
- **Evidence Matrix** — structured support and contradiction evidence for a Deal or Thesis.
- **Hypothesis Tree** — decomposition of a Thesis or diligence question into testable claims.
- **CIM** — confidential information memorandum supplied for Deal evaluation.
- **MRL** — master request list for diligence information and Files.
- **QoE** — quality-of-earnings analysis.
- **IC** — investment committee responsible for consequential investment Decisions.
- **LOI** — letter of intent recording proposed transaction terms.
- **SDE** — seller’s discretionary earnings.
- **EBITDA** — earnings before interest, taxes, depreciation, and amortization.
- **CAGR** — compound annual growth rate over a stated period.
- **IRR** — internal rate of return.
- **MOIC** — multiple on invested capital.

## JobPilot Module

- **JobPilot** — Module for governed job discovery, fit evaluation, application preparation, and follow-up.
- **Candidate Profile** — user-controlled Record of experience, abilities, preferences, and constraints used for job matching.
- **Job Posting** — normalized Record of an external employment opportunity.
- **Application** — Record of a person’s governed application process for a Job Posting.
- **Application Stage** — current state of an Application.
- **Application Outcome** — Result of an application attempt, including success, failure, expired listing, authentication issue, or required Human handoff.
- **Pacing Gate** — policy limiting application frequency and volume to prevent spam or unintended mass submission.
- **Answer Bank** — user-approved reusable application answers with provenance and correction history.
- **Tailored Materials** — application Files adapted from verified Candidate Profile evidence without fabricated claims.

## Vocabulary scopes

- **Platform Vocabulary** — the canonical terms in this glossary used by shared architecture, governance, APIs, and schemas.
- **Module Vocabulary** — domain-specific terms such as Deal, Thesis, Help Request, or Job Posting. Module language may vary by domain or explicit user preference without redefining Platform concepts.
