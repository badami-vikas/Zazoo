---
title: Bridge primitive specifications
type: raw
doc_kind: ontology
status: draft
updated: 2026-07-07
companions:
  - authority-model.md
  - runtime-pipeline.md
  - capability-evolution.md
  - ARCHITECTURE.md
  - tool-standardization-plan.md
tags: [ontology, primitives, agents, skills, automations, workspaces, elements, integrations]
---

# Bridge primitive specifications

This document defines Bridge primitives as ontology objects. It separates
semantics from implementation details, database schema, runtime execution,
governance, and lifecycle rules.

## Current Code Vocabulary

The codebase still contains historical or implementation-level terms:

- `ritual` and UI text such as "Workflow" map to the Automation primitive.
- `tool`, `ToolManifest`, and `@bridge/tool-kit` are implementation/package
  terms. The user-facing surface primitive is Workspace.
- `connection` maps to Integration.
- `initiative`, `person`, `community`, `resource`, `deal`, `job`, and similar
  table rows are ElementTypes under the Element model.
- `Chief of Staff` is an Agent archetype, not a separate primitive.
- `Intent` is a raw human-originated Request, not a separate primitive.
- `Signal` is a meaningful derived Incident, not a fully independent event root.

## Canonical Template

Every primitive should be specified with the same sections:

1. Purpose
2. Definition
3. Responsibilities
4. Boundaries
5. Inputs
6. Outputs
7. Identity
8. Persona
9. Behaviors
10. Habits
11. Governance
12. Dependencies
13. Consumes
14. Produces
15. Lifecycle
16. Runtime
17. Persistence
18. Observability
19. Evolution

Authority belongs inside Governance. It has a dedicated sub-model because the
resolver is important enough to document independently.

## Taxonomy

### Execution actors and coordinators

- Human
- Agent
- Automation

These are the only primitives that initiate or coordinate work.

### Capability primitives

- Skill
- Integration

These provide capability but do not decide to run themselves.

### Work primitives

- Request
- Action
- Incident
- Artifact

These describe work, operations, history, and outputs. Signal is a subtype or
derived view of Incident.

### Surface and structure primitives

- Workspace
- Element
- ElementType
- View

These define where work is organized, displayed, and shaped.

### Context primitives

- Memory
- Knowledge

These are consumed by execution actors and capabilities.

## Core Rules

1. Humans, Agents, and Automations initiate or coordinate work.
2. Skills and Actions execute only when invoked by a Human, Agent, or Automation
   through governed runtime paths.
3. Actions are work primitives: atomic operations, usually implemented as tool
   calls, function calls, API calls, commands, or system operations.
4. Incidents record what happened. Actions may produce Incidents, but external
   systems and humans may also produce Incidents.
5. Signals are meaningful derived Incidents, not separate event roots.
6. Requests are normalized units of wanted work. Raw human intent is a Request
   in `raw_intent` state.
7. Workspaces contain and display Elements. A Project is an ElementType, not a
   separate primitive.
8. Chief of Staff is an Agent archetype.
9. Promotion never mutates primitive category.

## Human

### Purpose

The Human is the true owner of intent, judgment, approval, and accountability.

### Definition

A Human is a user or accountable person who creates Requests, provides context,
makes judgments, grants approval, and owns final outcomes.

### Responsibilities

- Create raw and actionable Requests.
- Approve, reject, or edit governed proposals.
- Configure Workspaces, Agents, Automations, Integrations, and trust settings.
- Resolve ambiguity when policy, context, or confidence is insufficient.

### Boundaries

- A Human is not a tool call, Skill, Automation, or Workspace.
- Human approval cannot be simulated by an Agent in approval-sensitive cases.
- Human ownership can be delegated only through explicit governed delegation.

### Inputs

Context, proposals, Signals, Incidents, Artifacts, Workspace state, and
recommendations.

### Outputs

Requests, approvals, rejections, edits, preferences, grants, comments, and
decisions.

### Identity

Stable user id, workspace membership, role grants, delegation state, and audit
identity.

### Persona

Not applicable. Persona belongs to Agents.

### Behaviors

Human behavior is learned as preferences and decision history, not enforced as
primitive behavior.

### Habits

Recurring Human behavior may suggest Automations or Workspace defaults.

### Governance

Humans are governed by workspace membership, roles, policy, explicit denies,
approval requirements, and audit. Human approval is powerful but not a universal
bypass.

### Dependencies

Identity provider, role model, policy, Workspaces, and governance stores.

### Consumes

Requests, proposed outputs, Signals, Incidents, Artifacts, Memory, Knowledge,
and Workspace surfaces.

### Produces

Requests, decisions, grants, preferences, comments, Artifacts, and Incidents.

### Lifecycle

Invited, active, suspended, removed, archived.

### Runtime

Humans act through clients: web, desktop, browser, mobile, API, or other
approved surfaces.

### Persistence

Identity, preferences, grants, decisions, delegation, and audit history persist.

### Observability

Record who initiated, approved, edited, rejected, delegated, or configured work.

### Evolution

Human preferences and trust settings evolve. The Human primitive does not
promote into another primitive.

## Agent

### Purpose

An Agent is a responsible domain actor.

### Definition

An Agent interprets context, applies persona and behaviors, chooses Skills,
requests Actions through Skills or runtime paths, coordinates with allowed
collaborators, drafts proposals, communicates with Humans, and escalates when
authority or confidence is insufficient.

Agent archetypes include Chief of Staff, Deal Analyst, Researcher, Legal
Reviewer, Financial Analyst, and Operator Coach. Chief of Staff is the routing
and prioritization archetype, not a separate primitive.

### Responsibilities

- Own outcomes within a bounded domain.
- Decide when to answer, ask, delegate, invoke a Skill, or escalate.
- Draft governed proposals through the Runtime Pipeline.
- Use Memory and Knowledge within authority.
- Explain decisions and uncertainty.

### Boundaries

- An Agent does not approve its own governed proposals.
- An Agent does not own deterministic schedules; Automations do.
- An Agent does not own UI surfaces; Workspaces do.
- An Agent does not own atomic operation implementation; Actions do.
- An Agent cannot mutate its own authority, policy, role, skill registry, or
  ledger.

### Inputs

Requests, Workspace context, Elements, Memory, Knowledge, Signals, Incidents,
Artifacts, allowed Skills, policy, and authority-scoped data.

### Outputs

Drafts, proposed decisions, Skill invocations, escalated Requests, Artifacts,
Signals, explanations, and Incidents.

### Identity

Agent id, name, archetype, domain, version, persona, responsibilities,
behaviors, allowed skills, collaboration model, capability scope, data scope,
plane, owner, and lifecycle state.

### Persona

Communication style only. Persona affects tone and interaction, not authority.

### Behaviors

Decision policies such as verify before citing, prefer Project Memory, never
send externally without approval, escalate legal risk, and state uncertainty.

### Habits

Recurring tendencies an Agent may recommend or initiate. Habits become
Automations only when materialized as governed Automation objects.

### Governance

Agent authority is a ceiling, not a grant. It is resolved through role grants,
capability scope, data scope, plane gate, ephemeral grants, explicit denies, and
agent-floor constraints. Agents draft; Humans approve where required.

### Dependencies

Skills, Memory, Knowledge, Element context, Workspaces, model providers,
Runtime Pipeline, policy, and role grants.

### Consumes

Requests, Elements, Memory, Knowledge, Artifacts, Incidents, Signals, and Skill
outputs.

### Produces

Proposals, drafts, explanations, Requests, Artifacts, Signals, Incidents, and
Skill calls.

### Lifecycle

Draft, configured, validated, approved, active, trusted, suspended, deprecated,
archived, killed.

### Runtime

Agents reason and propose through the Runtime Pipeline. Mutating work passes
through authority, policy, review, ledger, and event handling.

### Persistence

Agent definition, versions, persona, behavior policy, trust evidence,
collaboration model, run history, and audit references persist.

### Observability

Trace route, model, prompt/version where applicable, Memory used, Skill
selection, authority decision, policy results, proposal id, and outcome.

### Evolution

An Agent earns autonomy. It never becomes a Skill, Automation, Action, or
Workspace.

## Automation

### Purpose

An Automation coordinates deterministic execution over time.

### Definition

An Automation owns triggers, schedules, waits, retries, checkpoints, and
deterministic orchestration. It may invoke Skills, trigger Actions through
Skills or runtime nodes, consult Agents for reasoning checkpoints, pause, retry,
or request approval.

### Responsibilities

- Coordinate ordered or DAG-shaped execution.
- Own time, recurrence, retries, waits, and pauses.
- Preserve deterministic run state.
- Request Human approval at checkpoints.
- Escalate failures and policy exceptions.

### Boundaries

- An Automation does not reason autonomously.
- An Automation does not own domain judgment.
- An Automation does not exceed assigned actor authority.
- An Automation does not become a Skill or Agent.

### Inputs

Trigger, schedule, parameters, Workspace/Element context, assigned actors,
Skills, policy, clock, and approvals.

### Outputs

Requests, Action invocations, Skill outputs, Artifacts, Incidents, Signals,
run snapshots, and status changes.

### Identity

Automation id, name, version, trigger, schedule, owner, assigned actors, steps,
approval level, and lifecycle state.

### Persona

Not applicable.

### Behaviors

Retry policy, timeout policy, idempotency, failure handling, pause/resume,
approval thresholds, and notification policy.

### Habits

An Automation is the materialized form of a recurring Habit.

### Governance

Automation scope must be within assigned actor authority. Egress, external
send, sensitive data, and high-risk steps require review. Runs are auditable.

### Dependencies

Runtime Pipeline, Skills, Actions, Agents, Humans, policy, clock, id generator,
and stores.

### Consumes

Triggers, Requests, Element state, Memory, Knowledge, Skill outputs, and
approvals.

### Produces

Run state, Requests, Action calls, Artifacts, Incidents, Signals, and ledger
references.

### Lifecycle

Draft, validated, approved, active, trusted, paused, suspended, deprecated,
archived, killed.

### Runtime

Planner may propose a DAG. Executor runs deterministic steps through governed
runtime paths.

### Persistence

Definition, versions, run history, snapshots, step outputs, approvals, and
ledger references persist.

### Observability

Trigger id, run id, step id, retry count, failures, policy results, proposal
ids, latency, and replay context.

### Evolution

An Automation earns trust. It remains an Automation.

## Skill

### Purpose

A Skill is a reusable capability behind a stable interface.

### Definition

A Skill maps typed inputs to typed outputs. It may internally orchestrate
validation, model calls, and Actions, but consumers should see a stable
contract.

### Responsibilities

- Provide a stable capability contract.
- Hide implementation complexity.
- Validate inputs and outputs.
- Produce draft outputs for governed runtime.
- Accumulate maturity evidence.

### Boundaries

- A Skill does not decide to run itself.
- A Skill is not a responsible actor; Agents own judgment.
- A Skill is not a schedule; Automations own time.
- A Skill is not a UI; Workspaces surface capabilities.

### Inputs

Typed input contract, scoped context, dependencies, Memory, Knowledge, Element
state, and granted Integration handles.

### Outputs

Typed output, diff, Artifact, proposed Element update, Request, Signal, or
validation error.

### Identity

Skill id, name, version, manifest, schemas, owner, origin, dependencies, risk,
and lifecycle state.

### Persona

Not applicable.

### Behaviors

Validation, confidence thresholds, citation policy, deterministic fallback,
error handling, and output-contract enforcement.

### Habits

Not applicable. Recurring use belongs to Agent habits or Automations.

### Governance

Skills hold no independent authority. They run under the invoking actor/request.
Skill manifests declare required permissions, dependencies, and connectors for
risk computation.

### Dependencies

Actions, Integrations, model providers, stores, Knowledge, Memory, and other
Skills.

### Consumes

Inputs, scoped context, Element data, Memory, Knowledge, Integration responses,
and Action results.

### Produces

Draft outputs, Artifacts, validation results, confidence, citations, Incidents,
and Signals.

### Lifecycle

Draft, validated, approved, active, trusted, suspended, deprecated, archived,
killed.

### Runtime

Invoked inside governed runtime after authority and pre-policy, before runtime
policy and review.

### Persistence

Manifest, versions, schemas, evaluation evidence, run history, and committed
outputs persist.

### Observability

Input/output schema version, run id, model/version, dependency calls,
confidence, validation failures, cost, and policy effects.

### Evolution

A Skill earns maturity. It never becomes an Agent, Automation, Action, or
Workspace.

## Integration

### Purpose

An Integration exposes an external system to Bridge.

### Definition

An Integration is a governed connection to systems such as Gmail, Google Drive,
Calendar, GitHub, Slack, FINRA, EDGAR, OpenAlex, or provider APIs.

### Responsibilities

- Hold external-system configuration, consent, and scopes.
- Provide scoped access to provider capabilities.
- Expose typed gateways to Skills and Actions.
- Record usage, errors, and side effects.

### Boundaries

- An Integration is not an Action.
- An Integration does not grant authority by existing.
- A Workspace must not own its own OAuth for the same provider.
- Provider events are Incidents until interpreted or acted on.

### Inputs

OAuth consent, API keys, scopes, provider config, policy, and scoped requests.

### Outputs

Scoped handles, provider data, webhooks, normalized captures, errors, and
Incidents.

### Identity

Integration id, provider, account, workspace, scopes, storage plane, status,
owner, and lifecycle state.

### Persona

Not applicable.

### Behaviors

Token refresh, scope enforcement, provider error mapping, rate limiting,
retry, revocation, and degradation.

### Habits

Not applicable.

### Governance

Integrations are governed by consent, provider scopes, Bridge authority, data
scope, plane gate, and policy. Declared capability need does not grant access.

### Dependencies

Credential storage, local/cloud plane boundary, provider APIs, Integration
stores, and policy.

### Consumes

Credentials, scoped requests, provider events, and user consent.

### Produces

Provider responses, normalized data, external side effects, Incidents, and
Signals.

### Lifecycle

Disconnected, pending consent, connected, scoped, degraded, revoked,
deprecated, archived, killed.

### Runtime

Called by Actions and Skills after authority and plane checks.

### Persistence

Configuration, scopes, grants, and usage persist. Tokens and private data follow
local-plane storage rules where required.

### Observability

Provider, scope, operation, actor, latency, error, rate limits, and external
side-effect ids.

### Evolution

An Integration earns scope confidence and reliability. It remains an
Integration.

## Request

### Purpose

A Request is a unit of wanted work or judgment.

### Definition

A Request normalizes something that needs attention, action, answer, review, or
approval. Raw Human intent is a Request in `raw_intent` state. Requests may also
come from Automations, Agents, Signals, Incidents, Workspaces, or Integrations.

### Responsibilities

- Preserve the original ask or trigger context.
- Normalize work into an actionable shape.
- Carry owner, assignee, target, priority, due time, and status.
- Track whether the Request needs Human judgment.

### Boundaries

- A Request is not the execution itself.
- A Request is not an Action, though it may trigger Actions.
- A Request is not an Incident, though it may be created from one.
- A Request does not create authority.

### Inputs

Human text, Agent escalation, Automation checkpoint, Signal, Incident,
Integration event, Workspace command, or approval proposal.

### Outputs

Route, clarification, assignment, proposal, answer, Action plan, or decision.

### Identity

Request id, source, state, kind, target Element, requester, assignee, priority,
status, due time, and workspace.

### Persona

Not applicable.

### Behaviors

Routing, deduplication, prioritization, SLA, reminders, escalation, and status
transitions.

### Habits

Recurring Requests may become Automations.

### Governance

Assignee authority controls what can be done. Approval Requests require
authorized Human decision where applicable.

### Dependencies

Workspaces, Agent routing, Approvals, Elements, policy, and Runtime Pipeline.

### Consumes

Raw asks, context, Signals, Incidents, proposals, and assignments.

### Produces

Clarifications, assignments, proposals, decisions, Action invocations, and
Incidents.

### Lifecycle

Raw intent, normalized, assigned, in progress, waiting, resolved, rejected,
archived.

### Runtime

Requests enter through Workspaces, Humans, Agents, Automations, Integrations, or
system triggers.

### Persistence

Request text, normalized form, status, context, decisions, and linked objects
persist.

### Observability

Source, route, assignee, state changes, resolution time, decision, and linked
ledger rows.

### Evolution

Request types can be standardized. Individual Requests resolve or archive.

## Action

### Purpose

An Action is an atomic work operation.

### Definition

An Action is the governed abstraction for a tool call, function call, API call,
command, provider operation, local operation, or system operation. It does not
execute itself; Humans, Agents, and Automations trigger it directly or through
Skills.

Examples: search, read file, OCR image, query database, fetch calendar, send
email, create Artifact, approve proposal, pause Automation.

### Responsibilities

- Perform one bounded operation.
- Declare input, output, side-effect, and idempotency behavior.
- Return structured result or error.
- Avoid domain judgment and multi-step business logic.

### Boundaries

- An Action is not an execution actor.
- An Action is not a Skill; Skills may compose Actions.
- An Action is not an Incident; it may produce Incidents.
- An Action is not an Integration; it may consume Integrations.

### Inputs

Parameters, scoped credentials, execution context, timeout, idempotency key, and
authority-scoped data.

### Outputs

Result, error, side-effect confirmation, metadata, cost, latency, and Incident.

### Identity

Action id, operation type, version, provider, permission requirements,
side-effect class, and idempotency model.

### Persona

Not applicable.

### Behaviors

Timeout, retry, rate limit, validation, idempotency, error mapping, and
side-effect handling.

### Habits

Not applicable.

### Governance

Actions run only under a governed caller. External send/share, private data,
and provider access are authority and policy gated.

### Dependencies

Integrations, local filesystem, network, database, models, OS capabilities, or
other provider resources.

### Consumes

Parameters, credentials, scoped data, and external resources.

### Produces

Results, errors, side effects, Incidents, metrics, and sometimes Artifacts.

### Lifecycle

Registered, validated, active, deprecated, archived, killed.

### Runtime

Called by Skills, Automations, Humans, or system runtime under governance.

### Persistence

Definition and audit metadata persist. Raw results persist only when committed
or needed for replay.

### Observability

Caller, parameters hash, provider, duration, result size, error type, retry
count, cost, and side-effect id.

### Evolution

An Action earns operational reliability. It remains an Action.

## Incident

### Purpose

An Incident records that something happened.

### Definition

An Incident is an append-only occurrence record. It may be caused by an Action,
Human decision, Automation transition, Integration webhook, external observed
event, provider change, or system event.

Examples:

- inbound email received
- integration webhook fired
- model provider changed
- Automation paused
- external market event observed
- Human approved proposal
- email sent
- Skill failed

### Responsibilities

- Preserve history.
- Support audit, replay, debugging, and reporting.
- Provide raw material for Signals.
- Correlate actions, external events, and system transitions.

### Boundaries

- An Incident is not an Action.
- An Incident does not itself require action.
- A Signal is a meaningful derived Incident or pattern over Incidents.
- Incidents should not be edited in place.

### Inputs

Runtime events, Action results, webhooks, provider changes, Human decisions,
Automation state transitions, and external observations.

### Outputs

History, audit evidence, diagnostics, metrics, and Signal candidates.

### Identity

Incident id, type, source, subject, timestamp, severity, correlation id,
workspace, and linked objects.

### Persona

Not applicable.

### Behaviors

Append-only capture, correlation, severity mapping, deduplication, and
retention.

### Habits

Not applicable.

### Governance

Incident visibility inherits source data scope. Sensitive content is redacted or
stored on the correct plane. Governed history is append-only.

### Dependencies

Ledger, event bus, stores, observability, Integrations, Actions, and runtime.

### Consumes

Events, state transitions, external observations, and execution results.

### Produces

Audit history, Signal candidates, metrics, and diagnostics.

### Lifecycle

Recorded, correlated, optionally signaled, retained, archived.

### Runtime

Emitted by runtime, Actions, Integrations, stores, Workspaces, Automations, and
Humans.

### Persistence

Append-only or append-mostly event history with retention policy.

### Observability

Source, correlation id, severity, actor, linked Action/request/ledger row, and
derived Signal ids.

### Evolution

Incident taxonomies can evolve. Historical Incidents remain records.

## Signal

Signal is not a root primitive. It is a meaningful derived Incident, a pattern
over Incidents, or a surfaced view of Incident history.

Examples:

- Incident: seller replied. Signal: seller engagement increased.
- Incident: skill failed three times. Signal: automation reliability degraded.
- Incident: external market event observed. Signal: thesis risk changed.

Signals may create Requests, update priority, or trigger Automations, but they
do not perform work themselves.

## Artifact

### Purpose

An Artifact is a produced deliverable.

### Definition

Artifacts are outputs created by Humans, Agents, Automations, or Skills.

### Responsibilities

- Represent produced work.
- Preserve provenance, version, and review state.
- Support export, reuse, citation, and linkage to Elements and Requests.

### Boundaries

- An Artifact is not the Skill or Action that produced it.
- An Artifact is not Knowledge until curated as reference.
- An Artifact is not Memory unless learned from.

### Inputs

Skill outputs, Human edits, Knowledge, Memory, Element data, templates, and
source files.

### Outputs

Files, structured documents, exports, previews, summaries, or derivative
Artifacts.

### Identity

Artifact id, type, version, owner, source run, linked Request/Element,
provenance, and status.

### Persona

Not applicable.

### Behaviors

Versioning, review, export, retention, access control, and provenance display.

### Habits

Recurring Artifact production may become an Automation.

### Governance

Creation, read, edit, export, and share follow authority, data scope, and egress
policy.

### Dependencies

File stores, renderers, templates, Skills, Actions, Workspaces, and Knowledge.

### Consumes

Context, templates, data, files, Skill outputs, and Human edits.

### Produces

Deliverables, previews, exports, citations, and Knowledge candidates.

### Lifecycle

Draft, in review, approved, published, exported, superseded, archived.

### Runtime

Created by Humans, Skills, Agents, or Automations through governed flows.

### Persistence

Content, metadata, versions, provenance, and review state persist.

### Observability

Source run, input set, versions, edits, approvals, exports, and shares.

### Evolution

Artifacts can be revised, superseded, or curated into Knowledge. They remain
Artifacts.

### Examples

- Investment memo
- Founder research brief
- Diligence report
- Valuation model
- Financial model spreadsheet
- KPI dashboard export
- Meeting prep brief
- Call summary
- Board update
- Investor update
- Draft email
- Outreach sequence
- LOI draft
- Contract summary
- Risk register
- Market map
- Target company list
- Candidate shortlist
- Presentation deck
- CSV export
- PDF report
- Decision log
- Postmortem
- 100-day plan
- Integration audit report

## Workspace

### Purpose

A Workspace is the user-facing operating surface and container for a body of
work.

### Definition

A Workspace composes Elements, Views, Agents, Skills, Automations,
Integrations, Artifacts, Requests, Memory, and Knowledge into a usable work
environment.

### Responsibilities

- Provide the interface for accomplishing work.
- Contain and organize Elements.
- Define Views over ElementTypes.
- Surface capabilities without owning their logic.
- Route mutations through governed runtime paths.

### Boundaries

- A Workspace is not the domain logic it surfaces.
- A Workspace is not a Project; Project is an ElementType.
- A Workspace does not own provider OAuth.
- A Workspace does not bypass governance.

### Inputs

Human interactions, Element state, Views, capability manifests, Requests,
Signals, Incidents, Artifacts, Memory, and Knowledge.

### Outputs

Requests, Action triggers, proposals, view changes, Artifacts, and
configuration updates.

### Identity

Workspace id, name, blueprint, version, owner, installed capabilities, routes,
views, ElementTypes, and permissions.

### Persona

Not applicable, though product copy and interaction style should match the
Workspace domain.

### Behaviors

Progressive disclosure, view eligibility, action availability, governed submit
flows, and explicit status/error reporting.

### Habits

Workspace defaults may suggest Automations or pinned Views.

### Governance

Workspace UI must reflect effective authority and route mutations through
governed runtime paths. Installed capabilities remain governed by their own
manifests.

### Dependencies

ElementTypes, Views, Agents, Skills, Automations, Integrations, Memory,
Knowledge, packages, and stores.

### Consumes

Elements, Requests, Artifacts, Memory, Knowledge, Signals, Incidents, and
capability metadata.

### Produces

Requests, proposals, Action invocations, configuration changes, Views, and
Artifacts.

### Lifecycle

Draft blueprint, proposed, activated, configured, active, deprecated, archived.

### Runtime

The code baseline compiles workspace blueprints and still mounts tool surfaces
through `apps/web` and `platform/tools/*`.

### Persistence

Blueprint, ElementTypes, Views, installed capabilities, pins, preferences, and
workspace-level configuration persist.

### Observability

Page/view events, proposal ids, failed actions, configuration changes, and view
eligibility failures.

### Evolution

A Workspace gains installed capabilities, Views, and versions. It remains a
Workspace.

## Element

### Purpose

An Element is a typed object inside a Workspace.

### Definition

Elements are the rows, cards, records, graph nodes, or objects that a Workspace
contains and displays. What was previously called Project should be modeled as
an Element with `ElementType = Project` or a domain-specific type such as
Initiative, Deal, Job, Meeting, Person, Company, Community, Resource, Help
Request, Artifact, Memory, or Knowledge Item.

### Responsibilities

- Represent a durable object of work or context.
- Carry typed fields and relationships.
- Appear in tables, boards, calendars, maps, graphs, galleries, and dashboards.
- Scope associated Requests, Artifacts, Memory, Knowledge, Incidents, and
  Signals.

### Boundaries

- An Element is not the Workspace itself.
- An Element is not an execution actor.
- An Element does not define its own schema; ElementType does.
- An Element does not execute Actions.

### Inputs

Human edits, imports, Skill outputs, Integration data, Automations, and
approved proposals.

### Outputs

State, relationships, view rows/cards, context bundles, and linked work objects.

### Identity

Element id, ElementType id, workspace id, title/name, lifecycle state,
relationships, ownership, and permissions.

### Persona

Not applicable.

### Behaviors

Validation against ElementType, relationship rules, lifecycle transitions, and
view eligibility.

### Habits

Not applicable, though Element activity may trigger Automations.

### Governance

Element access and mutation are governed by workspace membership, role, data
scope, policy, and ElementType rules.

### Dependencies

ElementType, Workspace, Views, graph/table stores, Memory, Knowledge, Requests,
and Artifacts.

### Consumes

Field values, relationships, source data, and updates.

### Produces

Context, view rows/cards, relationship edges, Requests, and Incidents.

### Lifecycle

Created, active, paused/on hold where applicable, completed/resolved where
applicable, archived.

### Runtime

Elements are read and mutated through governed runtime paths and rendered by
Workspace Views.

### Persistence

Fields, relationships, lifecycle state, and audit references persist.

### Observability

Creation, field changes, relationship changes, lifecycle changes, view use, and
linked ledger rows.

### Evolution

Elements may change state or type only through governed migrations. They remain
Elements.

## ElementType

### Purpose

An ElementType defines the schema and behavior of a class of Elements.

### Definition

ElementType is the governed type definition for table rows and workspace
objects. It defines fields, relationships, lifecycle, Views, permissions,
default Actions, allowed Artifacts, and validation rules.

### Responsibilities

- Define fields and schemas.
- Define relationship rules.
- Define lifecycle states.
- Define default Views and view eligibility.
- Define default Actions and allowed Artifacts.

### Boundaries

- ElementType is not an individual record.
- ElementType is not a Skill or Agent.
- ElementType does not execute work.

### Inputs

Workspace blueprint, package manifests, Human configuration, migrations, and
governed schema updates.

### Outputs

Schema, validation, default views, allowed relationships, and UI affordances.

### Identity

ElementType id, name, version, workspace/package owner, schema version, and
lifecycle state.

### Persona

Not applicable.

### Behaviors

Validation, migrations, compatibility checks, view eligibility, and relationship
constraints.

### Habits

Not applicable.

### Governance

ElementType changes are schema changes. They require governance, migration
plans, compatibility checks, and rollback/deprecation strategy.

### Dependencies

Workspace blueprints, table/view engine, graph store, packages, and migration
tools.

### Consumes

Field definitions, relation definitions, lifecycle definitions, and permission
rules.

### Produces

Typed Elements, Views, validation, and default Action affordances.

### Lifecycle

Draft, validated, active, migrated, deprecated, archived.

### Runtime

Used by Workspaces to render, validate, filter, and mutate Elements.

### Persistence

Type definitions, versions, migrations, and compatibility metadata persist.

### Observability

Schema changes, migration runs, validation failures, and affected Elements.

### Evolution

ElementTypes evolve by versioned migration. They remain ElementTypes.

## View

### Purpose

A View presents Elements in a specific form.

### Definition

A View is a table, board, calendar, map, graph, gallery, dashboard, detail page,
or other projection over Elements.

### Responsibilities

- Present Elements for scanning, comparison, editing, or decision.
- Encode filters, sorts, grouping, layout, and allowed actions.
- Reflect authority and field-level availability.

### Boundaries

- A View is not the Element data.
- A View is not the Workspace.
- A View does not own business logic.

### Inputs

Element collections, ElementTypes, filters, sorts, grouping, permissions, and
user preferences.

### Outputs

Rendered UI state, selected Elements, view actions, and user commands.

### Identity

View id, type, workspace, ElementType coverage, config, owner, and version.

### Persona

Not applicable.

### Behaviors

Filtering, sorting, grouping, layout, pagination, selection, and responsive
presentation.

### Habits

Pinned or recurring Views may become Workspace defaults.

### Governance

Views must not reveal fields or actions the actor cannot access.

### Dependencies

Workspace, ElementTypes, Elements, permissions, and table/view engine.

### Consumes

Elements, field metadata, permissions, and user preferences.

### Produces

Rendered projections, selections, commands, and view-state Incidents.

### Lifecycle

Draft, active, pinned, deprecated, archived.

### Runtime

Rendered in Workspaces and may issue Requests or Action triggers.

### Persistence

Configuration, owner, pins, filters, sorts, and layout state persist.

### Observability

Usage, failed eligibility, hidden fields/actions, and performance.

### Evolution

Views can be versioned or replaced. They remain Views.

## Memory

### Purpose

Memory is dynamic learned information.

### Definition

Memory is learned from interactions, decisions, preferences, work history, and
approved summaries. It is scoped and updateable.

### Responsibilities

- Preserve useful learned context.
- Separate private/local data from public/shared data.
- Support personalization and continuity.
- Supersede stale or incorrect information.

### Boundaries

- Memory is not static reference material; Knowledge is.
- Memory is not raw event history; Incidents are.
- Memory is not an ElementType, though Memory may be represented as Elements.

### Inputs

Decisions, approved summaries, Human feedback, Project/Element activity,
preferences, and repeated patterns.

### Outputs

Scoped context, preference hints, personalization, and suggested updates.

### Identity

Memory id, type, subject Element, scope, source, confidence, created time, and
supersession state.

### Persona

Not applicable.

### Behaviors

Recency handling, confidence, supersession, privacy classification, and
retrieval policy.

### Habits

Procedural Memory may describe repeated patterns. Automations materialize them.

### Governance

Reads and writes are data-scope governed. Private Memory remains local/private
and cannot cross egress gates.

### Dependencies

Memory stores, local plane, graph/table associations, retrieval, and policy.

### Consumes

Decisions, approved summaries, Element context, and Human feedback.

### Produces

Retrieved context, preference hints, and Memory update proposals.

### Lifecycle

Draft, confirmed, active, superseded, archived.

### Runtime

Agents and Skills may read scoped Memory and propose Memory updates through
governed runtime paths.

### Persistence

Persistent by definition, with explicit scope and provenance.

### Observability

Record Memory used in a run when it materially affects output.

### Evolution

Memory evolves by supersession and confidence changes. It remains Memory.

## Knowledge

### Purpose

Knowledge provides curated reference information.

### Definition

Knowledge is curated material: documents, playbooks, research papers,
communities, resources, reference datasets, and validated external information.
Person, Community, Resource, and Knowledge Item can also be ElementTypes when
they need table/view behavior.

### Responsibilities

- Provide reliable reference context.
- Preserve provenance and version.
- Support citation and retrieval.
- Separate curated reference from learned Memory.

### Boundaries

- Knowledge is not personal learned context.
- Knowledge does not decide or execute.
- Knowledge should not be silently modified by runs.

### Inputs

Documents, resources, playbooks, imported references, curated datasets, and
approved Artifacts.

### Outputs

Retrieved passages, citations, summaries, references, and Knowledge Items.

### Identity

Knowledge id or Element id, source, version, owner, scope, citation metadata,
and freshness.

### Persona

Not applicable.

### Behaviors

Citation, freshness checks, indexing, source validation, and access control.

### Habits

Not applicable.

### Governance

Access follows workspace, Element, and data-scope authority. Copyright,
confidentiality, and citation policy apply.

### Dependencies

Document stores, search/indexing, parsers, KnowledgeBase views, and policy.

### Consumes

External or internal reference material.

### Produces

Context, citations, summaries, and derived Artifacts.

### Lifecycle

Imported, indexed, curated, active, stale, archived.

### Runtime

Retrieved by Agents and Skills as scoped context. Mutation requires governed
import or update.

### Persistence

Source material, parsed representations, metadata, and versions persist.

### Observability

Record sources used when cited or materially relied upon.

### Evolution

Knowledge can be refreshed, curated, or versioned. It remains Knowledge.

