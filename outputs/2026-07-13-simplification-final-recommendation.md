---
title: Final Recommendation — Bridge Simplification Target Architecture
date: 2026-07-13
status: complete
---

# Recommendation

**Approve the simplification initiative, but replace the four-tier proposal with a target-model
redesign.** The proposal is right that Bridge has too many nouns, parallel schemas, and linear state
machines. It does not go far enough in some places and collapses the wrong boundary in others.

The design rule should be:

> Keep distinctions that represent different causal facts. Turn differences in source, policy,
> maturity, presentation, or deployment into typed attributes, projections, or orthogonal facets.

Under that rule, Request and execution must remain separate; Memory and Knowledge do not need to be
separate root primitives; a timeline does not need its own canonical log; package, capability, and
runtime records should share schemas without pretending they are the same object.

# Target kernel vocabulary

Bridge should converge toward eight core architectural concepts:

1. **Principal** — who acts: Human or Agent. An Automation executes under an owning Principal rather
   than becoming a third kind of authority.
2. **Request** — desired work, judgment, or outcome. This preserves the essential distinction
   between “wanted” and “done.”
3. **Capability** — what Bridge can do. Skill, Integration, Automation, operation/tool, and agent
   behavior become capability kinds or compositions, not parallel manifest systems.
4. **Run** — an attempt to satisfy a Request using Capabilities. A Run contains steps; an Action is a
   governed operation invocation/step, not the lifecycle continuation of a Request.
5. **Element** — typed durable organization/domain data. Initiative, Artifact, Person-like records,
   and domain objects are ElementTypes where their policy/residency permits it.
6. **ContextItem** — information available for reasoning. Learned Memory and curated Knowledge become
   modes of one primitive with different mutability, citation, confidence, freshness, and retention
   policies.
7. **Event** — an immutable fact that something occurred. Incident and Signal become classifications
   or derived projections over Events; Timeline is a human-readable projection.
8. **Module** — an installable composition of Capabilities, ElementTypes, policies, and Views. A
   Module is the functional/product unit. A “tool” with UI is a surfaced Capability inside a Module,
   not a primitive.

`Workspace` is deliberately absent. Its former meanings split cleanly:

- tenancy/security boundary → **Organization** or **Account** infrastructure
- installed functional experience → **Module**
- durable domain data → **Element**
- screen/projection/layout → **View**
- cross-module landing surface → **Home** or a saved layout, not a kernel primitive

**Governance is not a ninth business primitive.** Policy, authority resolution, approval decisions,
and audit evidence are a cross-cutting kernel protocol applied to Requests, Runs, Capabilities,
Elements, ContextItems, and Events.

## Module and Initiative are not the same object

They may share a generic resource envelope, IDs, ownership, Events, and governance machinery, but
they represent different causal facts:

- **Module** answers “what behavior, schema, policy, and Views are installed?” It is versioned
  software/configuration: a reusable definition plus an organization installation.
- **Initiative** answers “what outcome are we pursuing?” It is mutable user/domain data: an Element
  with goal, participants, dates, status, evidence, and related work.

The relationship is many-to-many: one Module supports many Initiatives; one Initiative may use many
Modules. DealPilot is a Module; “Acquire Acme” is an Initiative that may use DealPilot, Calendar, and
Relationships. Closing the Initiative must not uninstall those Modules, and upgrading DealPilot must
not create a new Initiative.

Even when Bridge generates a one-off Module for an Initiative, keep two linked records:
`Initiative --uses--> ModuleInstallation`. The Module may later be reused or generalized; the
Initiative retains its own outcome lifecycle. Do not let Module absorb work-tracking semantics or it
will become the same overloaded container that Workspace was.

# Final disposition of the proposal

## Adopt

### Retire concept-level Tool and Workspace

Use Capability for behavior, Module for composition, Element for durable data, and View for
presentation. UI presence is a View declaration, not an Internal/External tool identity. Do not keep
Workspace as a generic wrapper: use Organization/Account only for the tenant boundary, and Module for
the installed product experience.

### Unify Memory and Knowledge as ContextItem

This is a worthwhile primitive merge in a greenfield target. The proposal's two fields are too weak.
ContextItem needs at least:

- `mode`: learned | reference
- `origin`: observed | imported | authored | derived
- `scope` and `residency`
- `mutability`: supersedable | versioned | immutable
- `confidence`, `freshness`, and `retention`
- source/citation lineage
- subject links and authority policy

“Memory” and “Knowledge” remain useful user-facing lenses and policy presets, not root object types.

### Make Timeline a projection over Event

Use one EventEnvelope contract and append model. Do not make every event globally co-resident: the log
must be partitioned by workspace and residency plane. A local private event stays local. A bus is a
delivery mechanism over committed events, not a second canonical history. Human-readable timeline
entries, alerts, Signals, activity feeds, and avatar notifications become projections/subscriptions.

The EventEnvelope should carry structured payload, occurred/recorded time, actor, subject refs,
residency, visibility, retention class, causation/correlation IDs, and optional human-readable
summary.

### Initiative becomes an ElementType

Adopt this fully in the target model. Typed constraints, relations, indexes, and materialized
projections can preserve performance without retaining Initiative as a root primitive or canonical
special table. The owning Module declares/installs the `initiative` ElementType; the kernel does not
hard-code it. A dedicated SQL table or materialized view may remain as a performance projection, but
it is never the canonical identity or API contract.

### Collapse lifecycle state machines

Adopt short primary lifecycles, but model other concerns orthogonally.

Capability:

- lifecycle: `draft | approved | active | retired`
- validation: result + evidence + validator version
- trust: `trust_expires_at` + evidence/policy version
- availability: suspended flag/reason
- retirement: deprecated/grace/archive timestamps as presentation and compatibility facts

Package release/install:

- release: `draft | published | retired`
- installation: `pending | live | retired`
- registry visibility, approval outcome, grace period, and lineage are separate fields

This is simpler than both the current model and the proposal's attempt to encode several axes inside
one state value.

### Disambiguate Plane and rename Swarm

- Plane = Local/Cloud trust, residency, and egress boundary.
- Graph Domain = Relationship Domain / Work Domain.
- Inference Location = local | cloud.
- Planner proposes; Run executes. “Swarm” may describe an internal planning strategy only.

## Modify

### One capability schema, not one object

Converge on one canonical Capability schema and generate validators/types/projections from it. Retain
a thin PackageDescriptor because distribution, signing, dependency closure, assets, migrations, and
multi-capability composition are real concerns.

Recommended objects:

- immutable, signed `CapabilityDefinition`
- immutable, signed `PackageDescriptor` containing capability definitions/refs and distribution
  metadata
- organization-scoped `CapabilityInstallation` DB projection with computed risk, grants, state, and
  evidence
- optional `ViewSpec` attached to a capability/package

The database is the source of truth for installation and operational state. The signed artifact is
the source of truth for the distributed definition. Runtime types are generated projections. There
is no universal single source of truth across these different facts.

### Compute approval policy; record the resolution

Risk is an input to approval, not a synonym for it. Delete L0–L3 as standalone vocabulary and
independently editable state. Use semantic computed outputs instead:

- `auto`
- `notify`
- `approve`
- `quorum`

Compute the effective review mode from risk, origin, audience, authority, trust, action/side-effect,
data scope, egress, organization policy, delegation, and quorum rules. Risk × origin × audience is the
base calculation, not the complete authorization function.

Do not interpret “derived” as “never persisted.” Every resolved decision must record:

- effective review mode/quorum as an immutable audit fact, never as an independent policy input
- reason and policy version
- relevant inputs
- approvers/decision
- expiry or delegation context

This preserves audit and replay while eliminating competing sources of truth.

## Reject

### Request as an Action lifecycle state

This collapses desire into execution. One Request may require no Action, one Action, many Actions,
clarification, assignment, waiting, or a judgment-only answer. A failed Run does not mean the Request
is invalid, and approval of a plan does not mean its operations committed.

Keep the causal chain:

`Request → Plan/Proposal → Decision → Run → Steps/Actions → Events → Result`

Reduce vocabulary by demoting Action to a Run-step record and making Capability the operation
definition—not by turning Request into an Action state.

# Reassessment of “earned complexity”

Keep these as kernel invariants:

- every mutation proves authority and policy, produces an auditable decision, and commits atomically
- deny-default authority, delegation intersection, ephemeral grants, and non-removable safety floors
- Local/Cloud Plane Gate
- lethal-trifecta escalation
- bounded execution and delegation

Do **not** freeze these as architectural invariants:

- **One centralized pipeline service:** require the pipeline contract, not one network bottleneck.
  Local and cloud implementations can enforce the same protocol transactionally.
- **Star topology:** keep it as the safe default. The real invariant is bounded, attributable DAG
  execution with delegation budgets, cycle prevention, depth/cost limits, and authority intersection.
- **Four permanent agents:** ship them as a default product team if useful, but keep the kernel
  role/capability-driven. Product personas are replaceable compositions, not architecture.
- **Commons / Cloud Plane / Bridge Cloud as three services:** preserve logical trust and ownership
  boundaries, but allow co-deployment. Cloud Plane is a zone, Commons is a registry capability, and
  Bridge Cloud is a control-plane deployment—not three equivalent service categories.

# Implementation sequence

1. Ratify the eight-concept target vocabulary and causal chain.
2. Define schemas for CapabilityDefinition, PackageDescriptor, CapabilityInstallation,
   ContextItem, EventEnvelope, Request, Run, Element, Module, and View.
3. Specify invariants and orthogonal lifecycle facets before choosing tables.
4. Build compatibility projections from the new model to existing clients; avoid a big-bang rename.
5. Migrate Event/Timeline and Memory/Knowledge only after residency, retention, citations, replay,
   and policy tests prove the unified models.
6. Remove old names and physical structures after consumers have moved.

# Bottom line

The best future Bridge is **more simplified than the proposal at the ontology level, but more precise
than the proposal at causal and governance boundaries**. Unify information, event history, capability
schemas, and typed domain objects. Keep wanted work separate from attempted execution. Derive
policy decisions from one ruleset, but immutably record their outcomes. Treat agents, tools, Signals,
Incidents, Initiatives, Memory, Knowledge, Timeline, and Workspace as kinds, infrastructure labels,
roles, or projections wherever their differences can be expressed safely as policy-bearing facets.
