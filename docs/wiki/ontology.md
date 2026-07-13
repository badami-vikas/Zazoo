# Ontology

full: [../raw/primitive-specifications.md](../raw/primitive-specifications.md) ·
simplification decided 2026-07-12 (ADR-053,
[requirement](../raw/requirement-simplification-directives-2026-07-12.md),
[proposal+resolution](../raw/simplification-proposal-2026-07-12.md))

Bridge primitives use one template: purpose, definition, responsibilities,
boundaries, inputs, outputs, identity, persona, behaviors, habits, governance,
dependencies, consumes, produces, lifecycle, runtime, persistence,
observability, and evolution.

Authority is part of Governance. Separate model because authority resolution is
core mechanism.

Shared docs:

- [Authority Model](../raw/authority-model.md): governance sub-model for who may
  act.
- [Runtime Pipeline](../raw/runtime-pipeline.md): how governed work executes.
- [Capability Evolution](../raw/capability-evolution.md): promotion, downgrade,
  suspend, kill, trust, maturity, autonomy, composition.

## Canonical taxonomy (post-simplification, ADR-053)

- **Execution actors**: Human, Agent, Automation.
- **Capability primitives**: Skill, Integration. Capability = umbrella term for
  any governed callable. One manifest type: CapabilityManifest (DB row = source
  of truth; runtime type = generated projection; `surface: none|ui` field
  replaces old Internal/External split).
- **Work chain** (each stage distinct, immutably recorded):
  **Request → Plan → Decision → Run → Action(s) → Event(s) → Result.**
  - Request = human intent. NOT merged into Action (rejected — merge conflates
    intent with execution; one Request fans into many Actions via Plan).
  - Plan = Planner output, immutable (absorbs "Execution Snapshot").
  - Decision = governance verdict on Plan (approve/veto/edit) + recorded
    reviewMode resolution.
  - Run = deterministic, replayable execution of approved Plan.
  - Action = atomic governed work operation inside Run.
  - Event = append-only occurrence record, residency-partitioned.
  - Result = recorded outcome (status + produced Artifacts), not new table.
- **Structure primitives**: Organization, Module, ElementType, Element, View.
  - Organization = tenancy, membership, billing, security boundary.
    Single user = Organization of one.
  - Module = installed functional experience: capabilities + data types +
    policies + views. DealPilot, Calendar, Relationships, JobPilot = Modules
    installed into an Organization.
  - ElementType = typed bucket of Elements. Element = durable domain data row.
  - View = screen, projection, or layout.
  - Home = distinguished cross-module landing View, optional. NOT a primitive.
- **Context primitive**: Context. `source: observed|ingested` ×
  `tier: working|episodic|semantic|procedural`. UI labels "Memory" (observed)
  and "Knowledge" (ingested) = display filters, not primitives.
- **Artifact**: durable output produced by Actions.
- **Blueprint**: definition of an Organization's composition — installed
  Modules, ElementTypes, Views, default Automations, Home layout.
  Blueprint : Organization :: image : container. Commons-publishable.

## Invariants vs defaults (ADR-053 — do NOT re-freeze defaults)

Kernel INVARIANTS (non-negotiable):

- Governance contract: every mutation resolves authority → policy → immutable
  ledger record. Contract enforced per plane; NOT a centralized service
  requirement.
- Bounded, attributable DAG execution: depth caps, every hop attributed, no
  ungoverned peer handoff. Runs recorded + replayable.
- Agent-floor DENY non-removable; exactly one distinguished governance
  authority per Organization.
- Plane Gate: Local→Egress DENY default; private ∩ egress = none.
- Lethal-trifecta escalation (private-read + untrusted-ingest + egress).
- reviewMode computed, never configured; resolved {result, inputs, reason,
  policyVersion} immutably recorded.

Default COMPOSITIONS (product choices, swappable):

- 4-agent roster (CoS, Learning, Governance, Capability Builder).
- Star topology / CoS-as-sole-router.
- Planner-then-Run phase split.
- Home layout, module rails, view defaults.

## Governance vocabulary

- **reviewMode** (replaces L0–L3): semantic computed outcomes
  `auto | notify | approve | quorum`.
  `reviewMode = resolve(risk, origin, audience, authority, trust, sideEffect,
  dataScope, egress, organizationPolicy, delegation, quorumRules)`.
  Risk = what could go wrong. reviewMode = what governance this operation
  requires. Never stored as source of truth; resolution always recorded.
- **CapabilityState**: draft → approved → active → retired.
  Trusted = `active.trusted: bool` + 90-day TTL attribute, not a state.
- **ModuleVersionState**: draft → live → retired (+ `grace_until`).
  Single-live-version rule unchanged.

## Planes and domains

- **Plane** = Local/Cloud trust, residency, egress boundary ONLY.
  Local Plane / Cloud Plane. "Local inference / cloud inference" for models.
- **Graph domains** (were Mirror/Operational "planes"):
  - **Relationship Domain** — people, communities, relationship edges.
    ("Relationship" not "Identity": holds more than identity records.)
  - **Work Domain** — Initiatives→ElementTypes, Automations, Artifacts, Events.
- Three distinct cloud services (unchanged): Cloud Plane = canonical user data
  (Supabase, RLS) · Universal Commons = capability knowledge, never user data ·
  Bridge Cloud = control plane (accounts/billing/telemetry).

## Events and Timeline

- Event logs are **residency-partitioned** (local-plane events never merge into
  a cloud table — Plane Gate). `surfaced` flag = user-visible.
- **Timeline = read-time projection over the partitioned event logs.** Not a
  table. Same pattern as Calendar Projection. `timeline_entries` +
  `timeline_entry_refs` fold into events + generic event refs (migration
  pending).

## Retired terms (do not use)

Workspace (→ Organization/Module/View split) · Package (→ Module) · Tool at
concept level (→ Module/View; code `tool` router = legacy, migration pending) ·
ToolManifest (→ CapabilityManifest projection) · Ritual (→ Automation) ·
Signal / Incident (→ Event) · Swarm (→ Planner) · Mirror Plane (→ Relationship
Domain) · Operational Plane (→ Work Domain) · L0–L3 (→ reviewMode) ·
Compiled Workspace/Product (→ Module + Blueprint) · Execution Snapshot (→ Plan).

Egg = avatar growth stage, UX only. Unrelated to any plane/domain.

## Migrations pending (direction locked, staged later)

`workspace_id` → `organization_id` (RLS + every table — large blast radius) ·
`ritual_runs` → `automation_runs` · `package_installations` →
`module_installations` · `timeline_entries` → events projection · initiatives
table → seeded ElementType row · CapabilityState/ModuleVersionState enum
collapse · L0–L3 columns → recorded reviewMode resolutions.

Key rule (unchanged): promotion never mutates primitive category. Skill stays
Skill, Automation stays Automation, Agent stays Agent. Promotion creates new
governed object consuming the existing primitive.
