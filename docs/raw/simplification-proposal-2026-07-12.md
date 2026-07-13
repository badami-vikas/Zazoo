---
title: Concept & Architecture Simplification Proposal
type: raw
doc_kind: plan
status: DECIDED with amendments 2026-07-12 — see Resolution section + ADR-053
companions: [requirement-simplification-directives-2026-07-12.md]
related_wiki: ../wiki/ontology.md
updated: 2026-07-12
tags: [simplification, ontology, architecture, proposal, decided]
---

# RESOLUTION (2026-07-12, user directive — verbatim in companion requirement doc)

```yaml
resolutions:
  - item: 1.1 manifest collapse (3 -> 1)
    verdict: ADOPTED as proposed (user silent; delegated)
  - item: 1.2 Request merged into Action
    verdict: REJECTED by user — correctly. Work chain preserved as
      Request -> Plan -> Decision -> Run -> Action(s) -> Event(s) -> Result.
      Merge would conflate intent with execution; one Request fans out into
      many Actions via Plan. Plan absorbs "Execution Snapshot".
  - item: 1.3 retire concept-level Tool
    verdict: ADOPTED
  - item: 1.4 Memory+Knowledge -> Context
    verdict: ADOPTED as proposed (user silent; delegated)
  - item: 1.5 merge timeline_entries into events
    verdict: ADOPTED with user's superior refinement — event logs are
      residency-partitioned (single physical table would violate Plane Gate);
      Timeline = read-time PROJECTION over partitioned logs (Calendar pattern)
  - item: 1.6 initiatives -> seeded ElementType
    verdict: ADOPTED direction-only (migration staged later)
  - item: 2.1 CapabilityState 7 -> 4
    verdict: ADOPTED as proposed
  - item: 2.2 ModuleVersionState 6 -> 3
    verdict: ADOPTED as proposed
  - item: 2.3 approval derivation
    verdict: ADOPTED with user's broadening — L0-L3 deleted; semantic computed
      outcomes auto|notify|approve|quorum; resolve() over risk, origin,
      audience, authority, trust, sideEffect, dataScope, egress,
      organizationPolicy, delegation, quorumRules; resolved
      {result, inputs, reason, policyVersion} immutably recorded
  - item: 3.1 plane rename
    verdict: ADOPTED with user's naming — Relationship Domain (not Identity
      Domain; holds people/communities/relationships) + Work Domain; Plane
      reserved for Local/Cloud residency boundary
  - item: 3.2 Swarm -> Planner
    verdict: ADOPTED; Planner/Run phase split is a DEFAULT not an invariant
  - item: "NEW (user): drop Workspace as kernel primitive"
    verdict: ADOPTED — split into Organization (tenancy/membership/billing/
      security), Module (installed functional experience), Element(Type),
      View, Home. Home = distinguished cross-module landing View, NOT a fifth
      primitive (Claude refinement, accepted basis "optional"). Blueprint
      (was WorkspaceBlueprint) = Organization composition definition.
      workspace_id -> organization_id migration staged (large blast radius).
  - item: "NEW (user): invariants vs defaults"
    verdict: ADOPTED — 4-agent roster, star topology, centralized pipeline
      service, Planner/Run split = DEFAULT COMPOSITIONS. Kernel invariants =
      governance contract per plane, bounded attributable DAG execution,
      agent-floor DENY + one distinguished governance authority, Plane Gate,
      lethal trifecta, computed-and-recorded reviewMode.
```

Everything below = the original proposal as evaluated. Superseded where the
Resolution says so.

# Concept & Architecture Simplification Proposal

**Status: PROPOSED. No code or doc changes applied from this file. Requires explicit
user approval per [docs/APPROVALS.md](../APPROVALS.md) before any tier is implemented
(this touches canonical primitive taxonomy in [ontology.md](../wiki/ontology.md)).**

## Diagnosis

The platform vocabulary (~220 terms per [glossary audit](../../outputs/) this session)
carries recurring redundancy: the same concept is named 2–3 times across different
layers (yaml manifest / DB row / TypeScript runtime type), and several lifecycle state
machines have more states than they have distinct decisions. This proposal groups
findings into four tiers by risk and reversibility.

---

## Tier 1 — Merge (same concept, multiple names)

```yaml
- id: 1.1
  title: Collapse three manifest types into one
  current: "ModuleManifest (yaml) -> CapabilityManifest (DB row) -> ToolManifest (TS runtime type)"
  proposed: "One CapabilityManifest. DB row = source of truth. Runtime type = generated projection, not a separate concept. Module = list of capability refs + version, no separate manifest shape."
  kills: [ToolManifest, InternalToolManifest, ExternalToolManifest]
  replacement: "surface: none | ui field on the capability manifest replaces the Internal/External split"

- id: 1.2
  title: Request becomes an Action lifecycle state
  current: "Request (raw_intent state) and Action (ledger-committed) are separate primitives"
  proposed: "One primitive (Action) with state machine: raw_intent -> proposed -> approved -> committed"
  kills: [Request as standalone primitive]
  note: "This was flagged as an open question in the 2026-07-12 terminology pass (ADR-052); this proposal resolves it"

- id: 1.3
  title: Retire 'tool' as a concept-level term
  current: "Code name 'tool' = user-facing Workspace primitive; two names for one thing"
  proposed: "Concept-level: only 'Workspace'. Code rename of the 'tool' router/table is a separate, later migration."
  kills: []
  note: "Falls out naturally once ToolManifest is retired per 1.1"

- id: 1.4
  title: Merge Memory and Knowledge into one Context primitive
  current: "Memory (derived from captures/events) and Knowledge (curated, ingested) are separate primitives, both permanent-tier apart from Memory's working/episodic layer"
  proposed: "One Context primitive: { source: observed | ingested, tier: working | episodic | semantic | procedural }"
  kills: [Memory, Knowledge as separate primitives]
  keep: "UI labels 'Memory' and 'Knowledge' can remain as display filters over source, no user-facing change required"

- id: 1.5
  title: Merge timeline_entries into events
  current: "timeline_entries (continuity log) and events (bus) are both append-only logs with separate ref tables"
  proposed: "One events table: { kind: system | timeline | surfaced }. timeline_entry_refs folds into a generic event_refs table."
  kills: [timeline_entries, timeline_entry_refs as separate tables]

- id: 1.6
  title: Fold initiatives into ElementType (defer — bigger migration)
  current: "initiatives is a dedicated table, but Initiative is conceptually just one ElementType among many"
  proposed: "initiatives becomes a seeded ElementType row rather than a special-cased table"
  kills: []
  status: "Direction-only decision requested now; migration itself can be scheduled later given blast radius (touches initiative_participants, initiative_communities, calendar projection)"
```

---

## Tier 2 — Collapse lifecycle states

```yaml
- id: 2.1
  title: CapabilityState 7 states -> 4
  current: "Draft -> Validated -> Approved -> Active -> Trusted -> Deprecated -> Archived"
  proposed: "draft -> approved -> active -> retired"
  rationale: "Validated/Approved is a process detail, not a distinct governed state. Trusted = active + trusted:bool + ttl attribute, not a separate state. Archived = retired + time, not a separate state."
  kills: [Validated as distinct state, Trusted as distinct state, Archived as distinct state]
  replacement_fields: "active.trusted: bool, active.trusted_since: timestamp (drives the existing 90-day TTL logic); retired.archived_at: timestamp"

- id: 2.2
  title: ModuleVersionState 6 states -> 3
  current: "private / promoted / available / legacy / deprecating / deprecated"
  proposed: "draft -> live -> retired"
  rationale: "Single-live-version rule is unchanged. legacy/deprecating collapse into retired + a grace-period flag."
  kills: [promoted, available, legacy, deprecating, deprecated as distinct states]
  replacement_fields: "retired.grace_until: timestamp"

- id: 2.3
  title: Derive approval level from risk band instead of storing it separately
  current: "Approval Level (L0-L3) and Risk Band (Informational..External) both encode overlapping authorization info"
  proposed: "Keep risk bands as the source of truth. Approval level becomes a pure function: resolveApprovalLevel(riskBand, origin, audience) -> L0..L3. Never stored, never manually set."
  kills: [L0-L3 as standalone vocabulary/storage]
  keep: "The L0-L3 output values themselves remain useful as a computed label in UI and logs"
```

---

## Tier 3 — Rename overloaded words

```yaml
- id: 3.1
  title: "'Plane' is used for three different things"
  current: "Local/Cloud planes (data residency) + Mirror/Operational planes (graph partition) + informal 'local-plane models' (inference location)"
  proposed: "Reserve 'Plane' for Local/Cloud (residency) only. Rename Mirror/Operational planes to 'graph domains': identity domain, work domain."
  kills: [Mirror Plane as a name, Operational Plane as a name]
  replacement: "Identity Domain (was Mirror Plane), Work Domain (was Operational Plane)"

- id: 3.2
  title: "Swarm -> Planner"
  current: "'Swarm' implies uncontrolled multi-agent execution; the actual thing is a bounded planning phase that proposes a DAG"
  proposed: "Rename Swarm to Planner. Keep 'Run' for the deterministic execution phase (already used for DAG Run)."
  kills: [Swarm as a term]
  replacement: "Planner (plans) / Run (executes)"
```

---

## Tier 4 — Keep as-is (earned complexity, do not touch)

```yaml
kept:
  - Universal Action Pipeline — the core governance moat, every mutation passes through it
  - Authority layers 0-4 (tenancy RLS, plane gate, role/scope, ephemeral grants, delegation, agent-floor DENY) — each layer blocks a distinct real attack class
  - Lethal Trifecta check — genuine security invariant (private-read + untrusted-ingest + egress)
  - Star topology + MAX_CHAIN_DEPTH — cheap enforcement, prevents runaway agent chains
  - Two-plane data residency + Plane Gate — the trust core of the whole platform
  - 4 foundational agents (CoS, Learning, Governance, Capability Builder) — already minimized per ADR-046
  - Commons / Cloud Plane / Bridge Cloud three-way split — genuinely three different services with different data-handling rules
```

---

## Net effect if fully approved

```yaml
before_after:
  - metric: Primitives
    before: 14
    after: 10
    note: "-Request (merged into Action), Memory+Knowledge -> Context (net -1), -tool as concept term"
  - metric: Manifest types
    before: 3
    after: 1
  - metric: CapabilityState values
    before: 7
    after: 4
  - metric: ModuleVersionState values
    before: 6
    after: 3
  - metric: Approval vocabulary
    before: "risk bands + separately-stored L0-L3"
    after: "risk bands only; L0-L3 computed"
  - metric: Append-only log tables
    before: "events + timeline_entries (signals already retired 2026-07-12)"
    after: "events (single table)"
  - metric: "'Plane' meanings"
    before: 3
    after: 1
```

Approximately 30% concept-count reduction. No governance, security, or auditability
capability is removed — every Tier 4 item stays untouched, and every Tier 1-3 change is
a rename/merge/derivation, not a capability cut.

---

## Approval options

- **A. All tiers** — full simplification, apply 1.1–3.2 (1.6 direction-only, migration scheduled separately).
- **B. Tiers 1 + 3 only** — merges and renames; leave existing state machines (2.1–2.3) as-is.
- **C. Cherry-pick** — approve specific item IDs only.

No changes will be made to code or canonical docs until one of the above is selected in
chat, per the canon-change approval rule in `CLAUDE.md`.
