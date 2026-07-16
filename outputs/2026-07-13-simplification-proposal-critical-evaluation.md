---
title: Critical Evaluation — Concept & Architecture Simplification Proposal
date: 2026-07-13
status: complete
---

# Verdict

**Do not approve the proposal by tier. Approve individual decisions only.** The diagnosis—Bridge
has vocabulary drift and several lifecycle axes are mixed together—is correct. The proposed cure is
uneven: a few changes remove genuine duplication, but several high-impact merges erase distinctions
that currently carry provenance, authorization, distribution, execution, residency, or retention
semantics.

Recommended disposition:

- **Approve:** 1.3 (retire concept-level `tool`, already canonical); 3.2 (`Swarm` → `Planner`, mostly
  already canonical).
- **Approve with a rewritten design:** 2.1, 2.2, 3.1.
- **Approve only as a shared-schema/storage investigation, not a primitive merge:** 1.4, 1.5.
- **Record as already-decided direction, not a new decision:** 1.6.
- **Reject as written:** 1.1, 1.2, 2.3.
- **Keep Tier 4 invariants**, but correct its category errors.

# Blocking factual and accounting errors

1. **The ADR citation is false.** ADR-049 is the Egg + Commons code-diligence decision, not a
   terminology pass and not an open Request/Action question. The canonical ontology explicitly says
   “A Request is not an Action.” See [decisions-log](../docs/raw/decisions-log.md) and
   [primitive specifications](../docs/raw/primitive-specifications.md).
2. **The primitive counts do not reconcile.** The canonical taxonomy has 15 primitives:
   3 actors + 2 capabilities + 4 work + 4 surface + 2 context. `tool` and Initiative are already
   mappings, not additional root primitives. Removing Request and combining Memory/Knowledge would
   produce 13, not 10. Retiring concept-level `tool` changes no primitive count.
3. **The manifest chain is misdescribed.** A package/module manifest, a capability manifest, and a
   ToolManifest are not YAML → DB → runtime stages of one object. The package manifest is a
   distribution envelope that bundles multiple capabilities and carries package dependencies,
   context providers, lineage, documentation, and workspace vocabulary. ToolManifest is a
   tool-shaped edge contract with surface/composition/intake semantics. CapabilityManifest is the
   trust unit. See [package types](../platform/packages/core/src/package/types.ts),
   [capability types](../platform/packages/core/src/capability/types.ts), and
   [tool manifest](../platform/packages/tool-kit/src/manifest.ts).
4. **Signals are not retired in the implementation.** The canonical ontology demotes Signal from a
   root primitive to a derived Incident, but `signals` and `signal_actions` still exist in the schema.
   The proposal confuses a terminology decision with a completed schema migration.
5. **“Separately stored L0–L3” is not the current implementation.** Capability activation currently
   computes `auto | user_pref | governance | explicit_human`; L0–L3 is primarily the Ritual review
   model and is described as future policy/snapshot data. The proposal is simplifying an asserted
   storage duplication that the current schema does not show.
6. **The glossary audit appears incomplete.** It catches overloaded `Plane` but misses another
   collision: L0–L3 means approval modes in Rituals while L0–L5 also labels PromptAssembler layers in
   the Brain design.

# Decision-by-decision evaluation

## 1.1 — Reject as written; converge schemas instead

There is a real opportunity to make CapabilityManifest the single trust/risk vocabulary and generate
runtime types from one schema. That does not justify deleting the package envelope or treating the DB
row as the universal source of truth. A distributable package must exist before installation and may
be verified/signed without a workspace DB row. Making an installed DB projection authoritative also
weakens reproducibility and supply-chain verification.

Better shape:

- `CapabilityManifest`: canonical trust unit.
- `PackageManifest`: thin, signed distribution envelope containing capability refs/definitions plus
  dependencies, provenance, docs/assets/migrations, and vocabulary metadata.
- `SurfaceSpec` or capability extension: replaces internal/external ToolManifest variants using
  explicit optional UI/composition/intake fields.
- JSON Schema/Zod (one definition) generates TS projections and validates YAML/DB payloads.

The Internal/External discriminated variants are plausible deletion targets; PackageManifest is not.

## 1.2 — Reject

Request and Action differ by kind, not maturity. A Request is wanted work or judgment: it can be
assigned, clarified, wait, resolve with an answer, be rejected, or produce many Actions. An Action is
an atomic governed operation with permissions, idempotency, retry, provider, inputs, and side effects.
`raw_intent → proposed → approved → committed` describes a pipeline proposal, not the Request
lifecycle and not the Action definition lifecycle. The merge would make unanswered questions,
approval requests, assignments, and multi-action work awkward or dishonest.

Simplify the implementation through a common `WorkItem` envelope or shared correlation IDs, while
keeping Request and Action as distinct primitives.

## 1.3 — Approve; largely already decided

The canonical ontology already says code `tool`/ToolManifest is an implementation/package surface
and the user-facing primitive is Workspace. Remove remaining concept-level prose and UI vocabulary;
schedule code/table renames only when their migration value exceeds churn. This is cleanup, not a new
ontology decision.

## 1.4 — Do not merge primitives; consider a shared ContextRecord substrate

Memory and Knowledge share retrieval, indexing, scopes, and provenance, so a shared table/interface
may reduce plumbing. Their governance is different:

- Memory is learned, confidence-bearing, personal/dynamic, and superseded over time.
- Knowledge is curated/versioned reference material with citations, freshness, copyright, and a rule
  against silent run-time modification.

`source: observed | ingested` does not preserve this boundary: ingested content can become personal
Memory, and observed external facts can become curated Knowledge. The proposed tiers also combine
durability (`working`, `episodic`) with semantic role (`procedural`). Keep two semantic kinds under a
shared `ContextRecord`/retrieval port with explicit `kind`, provenance, mutability policy, citation
requirements, scope, retention, and residency.

## 1.5 — Investigate a unified envelope; do not approve a physical-table merge yet

The two tables are append-only but serve different contracts. `events` is a machine bus record
(`entity`, structured payload, dispatch ordering); `timeline_entries` is inspectable human-readable
continuity/Memory (`occurred_at`, content, creator, many refs). Sensors deliberately write both: the
timeline entry is inspectability, the event is the avatar-blink/domain notification.

A single physical table risks mixing bus throughput/retention with durable Memory, and—more
critically—mixing local/private timeline content with cloud event infrastructure. First define a
unified `EventEnvelope`, residency/retention partitions, ref cardinality, outbox delivery semantics,
and consumer replay rules. A common append API or partitioned event store may then be justified.

## 1.6 — Direction is already canonical; migration is premature

The wiki already defines Initiative as an ElementType, not a separate primitive. The database does
not yet expose the generic Element/ElementType persistence needed to replace the dedicated
`initiatives` table, while Touchpoints, participants, communities, and calendar projection depend on
its identity. Record no new direction decision. Make this a migration candidate after the generic
Element model proves it can retain typed constraints, relationships, query performance, and RLS.

## 2.1 — Rewrite around orthogonal axes

Seven linear states overstate the lifecycle, and `trusted` is better modeled as earned, expiring
autonomy rather than as a deployment state. But the proposed fields are unsafe/incomplete:

- validation and approval are distinct decisions and must remain inspectable even if not top-level
  states;
- `trusted: bool + trusted_since` can become stale and complicates policy changes—retain an explicit
  `trusted_until` (and evidence/policy version);
- deprecated and archived have different availability/discoverability behavior even if represented
  by timestamps.

Preferred model: lifecycle `draft | approved | active | retired`; orthogonal validation result and
evidence; explicit approval ledger reference; `trusted_until`; suspension fields; `deprecated_at`,
`grace_until`, and `archived_at` where behaviors genuinely differ.

## 2.2 — Strong simplification candidate, but separate registry and installation axes

The six-state package chain is hard to defend, especially because `status` already separately tracks
pending review/installed/rejected. `draft | live | retired` can preserve single-live-version and
rollback if `grace_until`, lineage, and immutable version history remain.

Before approval, clarify whether “private/promoted/available” means registry publication visibility
or workspace installation state. Those are separate axes. For installation rows, the clearer states
may be `pending | live | retired`, with approval outcome and registry visibility modeled separately.

## 2.3 — Reject “never stored”; derive defaults, record effective decisions

Risk band describes inherent capability risk. Approval level describes the effective review mode for
a particular activation/run/action. It also depends on audience, trust grants, daily budgets, kill
switch, workspace policy, authority, egress/agent-floor rules, and quorum. L3 dual/quorum cannot be
recovered from risk alone, and the proposed function omits several current inputs.

Compute the minimum/default approval requirement from risk and context, then apply policy escalation.
Do not allow manual weakening below that floor. Persist the **effective result**, reason, policy
version, and inputs needed for audit/replay. A derived value can still require durable recording.

## 3.1 — Approve the disambiguation, revise the names

Reserve `Plane` for Local/Cloud trust/residency/egress zones. Rename Mirror/Operational as graph
partitions or graph domains. `Identity Domain` is too narrow for People, Communities, relationships,
and their edges; prefer `Relationship Graph Domain` (or retain `Mirror Graph Domain`) and
`Operational Graph Domain`. Replace “local-plane model” with `local inference` or `execution
location: local`.

## 3.2 — Approve

`Planner` accurately names the bounded, non-mutating phase that proposes a DAG; `Run` names governed
execution. Most canonical docs already use this language. Keep “swarm” only as an optional internal
planning strategy, never as the architecture component or user-facing term.

# Tier 4 corrections

The listed security/governance invariants should stay. Two descriptions need correction:

- Cloud Plane is a trust/data-execution zone, not a third service parallel to Universal Commons and
  Bridge Cloud. Commons is the generalized capability-knowledge registry; Bridge Cloud is the
  control-plane service; Cloud Plane describes where public/egress work may occur.
- Authority should not be summarized as a casual “layers 0–4” count unless the canonical model is
  normalized first: RLS, Plane Gate, role/scope resolution, ephemeral grants, delegation
  intersection, and agent-floor deny have distinct composition positions and are described with
  inconsistent layer counts across current docs.

# Recommended approval package

Do not submit one approval for all four tiers. Submit three narrow decisions:

1. **Terminology cleanup:** concept-level Tool → Workspace; Swarm → Planner; Plane vocabulary
   disambiguation with revised graph-domain names.
2. **Lifecycle redesign RFC:** orthogonal lifecycle, validation, trust, suspension, deprecation, and
   archive fields for capabilities and packages, with transition/invariant tables and migration
   examples before approval.
3. **Shared substrate investigations:** ContextRecord and EventEnvelope prototypes proving policy,
   residency, retention, citation, replay, and query behavior without changing canonical primitive
   categories or physical tables.

Explicitly reject Request→Action and “approval level never stored.” Reframe manifest simplification
as schema convergence with a retained package envelope.
