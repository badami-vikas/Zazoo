# Capability packages (wiki)

full: [../raw/capability-package-format.md](../raw/capability-package-format.md)

**What:** shipping unit ABOVE one `capability_manifests` row (ADR-012 trust model = kernel this
builds on, unchanged). Package = `package.yaml` + dir, bundles MULTIPLE capability manifests +
impl. Distribution/bundling concern only — no new risk model, no new approval mechanism.
Manifest `kind` values map to primitives ([ontology](../wiki/ontology.md)): workflow=**Automation** ·
tool=implementation surface (user-facing primitive=**Workspace**) · integration_bundle=**Integration** ·
view=**View** · workspace_definition=**Workspace** definition. Code enum unchanged.

## Manifest shape
`name·version(semver, exact, no ranges)·kind(skill|workflow|agent|tool|view|integration_bundle|
workspace_definition)·summary+description(agentskills.io L1, <=1024 chars, what+when)·
lineage_manifest_id·dependencies[{manifest_id,version EXACT}]·capabilities[] (each = full
CapabilityManifest shape from types.ts)·context_providers[]·workspace_vocab{aligns_to_bridge_
theme,domain_terms}`.

## Dir layout (agentskills.io progressive disclosure)
L1 `package.yaml`+`README.md` (always loaded) · L2 `capabilities/*.ts` (loaded on inspect) · L3
`scripts/`·`references/`·`assets/`·`migrations/`·`tests/` (zero-cost till read; scripts' CODE
never enters context, only output).

## Install flow (governed proposal, existing pipeline)
1. propose (user or Learning Agent — agent-floor still blocks agent-approve) → each capability
   `capability.register` (draft only, registration≠activation).
2. risk COMPUTED via `computeRisk()` over FULL dependency closure incl. transitive package
   deps — package's own description/hints NEVER trusted as risk signal ("a manifest can lie").
3. **lethal-trifecta check at install time, over the UNION of all capabilities' permissions** —
   private-read + untrusted-ingest + egress anywhere in the union ⇒ whole package escalates to
   `external`, overriding computeRisk() alone (catches trifecta assembled ACROSS capabilities
   that are individually safe).
4. `requiredApproval()`/`resolveActivationApproval()` run unchanged on the (possibly escalated)
   band — External = same non-removable hard floor, no trust grant loosens it.
5. approve → each capability `lifecycle.advance()` normally, package_installations→installed;
   reject → stays draft, never deleted.

## Versioning (Zapier single-live-version model)
One `available` version per workspace at a time; promote new ⇒ auto-demote prior to `legacy`
(never two live side by side). **Rollback = fork new draft from history, never in-place revert**
(matches append-only ledger everywhere else). Dependencies pinned EXACT (no `^`/`~`/ranges) — a
dep bump = new version proposal thru the SAME install flow (risk can change). `lineage_
manifest_id` chains to `capability_manifests` (columns exist per decisions.md punch-list; this
doc = the enforcement logic for the PACKAGE layer — single-capability-lineage enforcement stays
a separate open gap). In-flight runs finish on their pinned version (version-marker/step-
memoization convergence, Hatchet/Inngest).

## First three packages (sketches)
- **DealPilot** — repackages existing `tools/dealpilot`. `thesis-fit-scoring` (transformational,
  ordinary write) + `sourcing-waterfall` (egress:true ⇒ external). Domain vocab "Deal" — aligns
  to Bridge theme (Deal~Initiative-shaped) at workspace scope; kernel code stays Initiative.
- **Helpdesk** — in-Bridge governed MVP, new kernel Help Request entity. `capability-routing`
  (transformational) + `offer-drafting` (advisory, draft-only write). Audience=team ⇒
  informational/advisory raised to at least user_pref (shared ≠ auto).
- **Recon** — NOT migrated yet (still standalone Tools/recon/ app); target shape per tools.md's
  people-sourcing/company-sourcing split. `osint-search` = egress read ⇒ external; ALSO a
  lethal-trifecta candidate (untrusted external content + graph writes) even without one
  permission carrying all three legs. Carries 3 match tiers (strong=name+1pt auto / moderate=
  name-only pending / flag=3 risk tiers, always human) + per-source name verify + draft-then-
  approve as DOCUMENTATION, not new mechanism. audience=external_visible when public-facing ⇒
  install always explicit_human (matches "External-band always human at launch").

## Open questions
Package-owned migrations vs shared kernel schema (blast radius unresolved) · vocab-alignment
enforcement mechanism (lint? Learning-Agent rewrite? doc-only?) · capability/package install
still has no dedicated `ResourceType` (inherits ADR-012's known gap) · package registry: new
table vs computed-at-install · package test fixtures vs the still-open no-dummy-data fixture
question · diamond-dependency: two packages pinning different versions of ONE shared capability
in the same workspace = unspecified.

## SHIPPED — P2 slice 1 (2026-07-06, ADR-021)
Format above now = running code. `platform/packages/core/src/package/` — parsePackageManifest
(pure, typed errors) · computePackageRisk (max over bundled+dep-closure caps + trifecta UNION
across caps ⇒ external) · single-live-version lifecycle (promote auto-demotes prior→legacy;
rollback = fork-from-history) · PackageStore port + in-memory. tRPC:
`packages.{register,install,list,get,promote,rollback}` — install = same
resolveActivationApproval + pipeline.propose path as capability.approve; bundled caps register
as DRAFT capability_manifests rows. First two packages: `tools/dealpilot/bridge.package.yaml`
(3 caps, computes external — repackages existing code) · `tools/helpdesk/bridge.package.yaml`
+ new @bridge/helpdesk (routeHelpRequest graph routing, draftHelpOffer draft-then-approve;
`helpdesk.route`/`helpdesk.stageAnswer` in api). Recon untouched.
**Filename caveat**: manifest file = `bridge.package.yaml`, NOT `package.yaml` — pnpm reads
package.yaml as a project manifest, shadows package.json, breaks install. Amend raw spec §1.
Gaps (BUGS.md): package rows in-memory both modes (no Drizzle table yet) · cap re-registration
non-idempotent across versions · interim resourceType "skill" · route topics caller-supplied.

## DealPilot detailed plan (2026-07-11)

full: [../raw/dealpilot-module-plan-2026-07.md](../raw/dealpilot-module-plan-2026-07.md)
designer brief: [../raw/dealpilot-design-requirements-2026-07.md](../raw/dealpilot-design-requirements-2026-07.md)

- Nav = ONE global DealPilot item → module rail (Overview/Deals/Sourcing/Theses/Work/Reports/Relationships/Playbooks) → Deal/Thesis tabs. No global-sidebar explosion.
- Deal = core Element. CIM/Documents, Hypothesis Tree, Evidence, Diligence/MRL, Financials/QoE, Valuation/Returns, Risks, IC, Relationships, Execution, Activity live inside Deal workspace.
- Global lists still expose cross-deal sourcing, work, reports, relationships, and playbooks; every row links home to source Deal/Thesis.
- Tech catalog explicit: 9 package Agent archetypes, 28 Skills, 20 Automations, integrations/tools. CoS routes; no peer handoffs/autonomous IC decisions.
- Business plan explicit: thesis→origination→triage→diligence→underwriting→IC→closing→100-day→learning. Explicit exclusions: professional opinions, fund admin, custody/payments, autonomous sends/decisions, ToS bypass, portfolio ERP.
- Reuse-first mandatory. Import/wrap/adapt existing assets before Bridge-native gap build. SmallPE inspected: real 1+7 agent team + MRL/evidence/thesis/impact/output assets; current FSL blocks competing commercial vendoring. Need permission/license/partnership; never silently copy.
- License-limited source → clean-room research protocol: exhaustive functional inventory + black-box benchmark + independently authored spec + provenance/separation. Protected expression/assets stay out. Full: [clean-room protocol](../raw/clean-room-capability-research-protocol-2026-07.md).
