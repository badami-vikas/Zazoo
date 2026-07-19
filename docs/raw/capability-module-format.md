---
title: Capability Module format — install/version/rollback over the Capability Trust Model
type: raw
doc_kind: design
status: draft
companions:
  - vision-pivot-living-software.md
  - research-agent-skill-workflow-practices-2026.md
  - tools-internalization.md
  - tool-standardization-plan.md
related_wiki: ../wiki/packages.md
updated: 2026-07-06
tags: [capability, module, manifest, install, versioning, dealpilot, helpdesk, recon, governance]
---

# Capability module format

A module is the SHIPPING UNIT one level above a single `capability_manifests` row. Where
`packages/core/src/capability/` (types.ts/risk.ts/lifecycle.ts/approvals.ts, ADR-012) governs
ONE capability's trust lifecycle, a module is a **bundle of capability manifests plus a
directory of implementation** — how DealPilot, Helpdesk, and Recon actually ship as installable
units an organization adopts, rather than code that only ever lived in `platform/tools/*` at
build time.

This doc is the format spec. It does not change any shipped code — `packages/core/src/
capability/` is the trust-model kernel this format is built ON TOP OF, read-only here.

## 1. Module manifest schema

A module manifest is `bridge.module.yaml` at the module root. It is a SEPARATE object from a
`capability_manifests` row — a module CONTAINS one or more capability manifests (its
`capabilities[]` array), each of which is itself the same shape `packages/core/src/capability/
types.ts`'s `CapabilityManifest` already defines (id/version/capabilityType/origin/audience/
permissions/connectors/dependencies). A module is the distribution wrapper; a capability
manifest is the trust-model unit risk.ts/lifecycle.ts/approvals.ts operate on. One module,
many manifests — this is the "module carries MULTIPLE capability manifests" requirement.

```yaml
module:
  name: dealpilot                 # kebab-case, unique across the module registry
  version: 1.2.0                  # strict semver (MAJOR.MINOR.PATCH) — see §3, no ranges
  kind: organization_definition    # one of: skill | automation | agent | view | integration_bundle | organization_definition
  summary: >-
    Sourced and evaluated small-business acquisition deals, scored against a
    configurable investment thesis.
  description: >-
    Progressive-disclosure body (>=1 paragraph, <=1024 chars per agentskills.io
    convention) — states WHAT the module does and WHEN an organization would install
    it. Read by the Learning Agent at blueprint time for install recommendations,
    same role a SKILL.md description plays for trigger matching.
  lineage_manifest_id: null        # set once shipped — chains to capability_manifests.id (see §3)
  dependencies:
    - manifest_id: company-sourcing@2.1.0
      version: "2.1.0"             # EXACT pin, never a range (see §3)
    - manifest_id: people-sourcing@1.4.0
      version: "1.4.0"
  capabilities:                    # >= 1 entries, each = one capability_manifests row
    - id: dealpilot.thesis-fit-scoring
      capability_type: skill
      permissions:
        - { resource_type: deal, action: write, data_scope: all, egress: false }
        - { resource_type: company, action: read, data_scope: all, egress: false }
      connectors: []
    - id: dealpilot.deal-dedupe
      capability_type: automation
      permissions:
        - { resource_type: deal, action: write, data_scope: all, egress: false }
      connectors:
        - { id: dedupe-engine, external_send: false }
  context_providers:               # optional — Sensor SPI / context-provider registry consumption
    - kind: email                  # must match a registered context-provider kind (docs/wiki/clients.md)
      required: false
  organization_vocab:              # domain-vocab alignment declaration (see §5 open questions)
    aligns_to_bridge_theme: true   # generated vocab defaults to Bridge theme; user naming always wins
    domain_terms:
      deal: "the Record-equivalent entity this module introduces"
```

```yaml
directory_layout:
  bridge.module.yaml     # L1 — always loaded; manifest + description (progressive disclosure entry point)
  README.md                # L1 companion — human-facing summary, not parsed by the compiler
  capabilities/             # one file per capability_manifests entry in bridge.module.yaml
    thesis-fit-scoring.ts
    deal-dedupe.ts
  scripts/                  # L3 — zero-cost until invoked; never enters agent context, only output does
    migrate-v1-to-v2.ts
  references/                # L3 — loaded on demand only (agentskills.io progressive disclosure)
    scoring-methodology.md
    api-contract.md
  assets/                    # L3 — icons, view templates, seed view configs (NOT seed DATA — no dummy data)
    icon.svg
    kanban-view.json
  migrations/                # module-owned schema deltas, see §5 open questions
    0001_add_deal_fields.sql
  tests/
    thesis-fit-scoring.test.ts
```

**Progressive disclosure mapping** (agentskills.io SKILL.md spec, folded into module shape):
L1 = `bridge.module.yaml` frontmatter-equivalent (name/version/kind/summary — always loaded into any
registry listing or Learning Agent context, ~100 tokens); L2 = `README.md` + each capability's
own manifest body (<500 lines, loaded only when a capability is inspected/proposed); L3 =
`scripts/`, `references/`, `assets/`, `migrations/` (loaded/executed on demand, code never enters
model context — only its output does, same rule as a SKILL.md's `scripts/`).

## 2. Install flow

**Install = a governed proposal through the EXISTING pipeline** (`pipeline.propose`/`decide`),
not a new install subsystem. This mirrors ADR-012's `capability.approve` and ADR-017's
`organization.blueprint.activate` — every module install is one more thing that flows through
`propose`/`decide`, never a bespoke path.

```yaml
install_flow:
  1_propose:
    actor: user | learning_agent   # agent-floor still applies — an agent may PROPOSE, never approve
    action: module.install.propose
    effect: >-
      Creates a draft module_installations row (organization_id, module name+version,
      status=pending_review). Each capability in the module is registered via the
      EXISTING capability.register path (ADR-012) — always creates `draft` state,
      never active. Registration ≠ activation, same invariant as capability lifecycle.
  2_compute_risk:
    rule: >-
      Risk is COMPUTED, never trusted from the module's own manifest hints.
      computeRisk() (packages/core/src/capability/risk.ts) walks the FULL
      dependency closure of every capability the module declares, INCLUDING
      transitive module dependencies pinned in bridge.module.yaml's dependencies[].
      A module's `summary`/`description` text is documentation only — it is
      never read as a risk signal, mirroring "a [manifest] can lie" (MCP
      annotation-trust research finding, research-agent-skill-workflow-
      practices-2026.md §6).
    composite: max(risk) over every capability in the module AND every
      dependency's capabilities, cycle-safe (existing visited-set walk).
  3_lethal_trifecta_check:
    rule: >-
      Applied at install time, per module, over the UNION of all capabilities'
      permissions: if the union contains (a) a private-data READ, (b)
      consumption of untrusted/external ingest content, AND (c) an egress
      permission — auto-escalate the WHOLE module's effective risk band to
      `external`, overriding whatever computeRisk() alone produced. This is
      the same rule roadmap.md's practice-hardening P0 line states for single
      capabilities, applied at the module-install boundary because a module
      composing three individually-safe capabilities can still assemble the
      trifecta across them.
  4_approval_routing:
    rule: >-
      requiredApproval()/resolveActivationApproval() (approvals.ts) run
      UNCHANGED against the computed (possibly trifecta-escalated) risk band
      and the module's declared audience. External band is the same
      non-removable hard floor — explicit_human, no trust grant can lower it,
      checked first, exactly as approvals.ts already enforces for a single
      capability.
  5_decide:
    action: pipeline.decide (human, or trust-grant auto per band)
    on_approve: >-
      Each capability advances draft -> validated -> approved via the existing
      lifecycle.advance() guards; module_installations flips to `installed`;
      organization_definitions may gain a new blueprint slice if the module
      declares views (ADR-017's Organization Blueprint path, unchanged).
    on_reject: module_installations -> rejected, capabilities stay `draft`
      (inert, never silently deleted — same as a rejected capability today).
```

No new approval mechanism, no new risk model, no trust bypass for anything module-shaped —
the module format is purely a bundling and distribution concern layered over the trust model
that already shipped.

## 3. Versioning

**Single live version per organization** (Zapier model, per roadmap.md P5 + research §7):

```yaml
versioning:
  model: single_live_version_per_organization
  states: [private, promoted, available, legacy, deprecating, deprecated]
  rule: >-
    At most ONE module version per organization may be `available` at a time.
    Promoting a new version to `available` AUTO-DEMOTES the prior available
    version to `legacy` in the same transaction — never two live versions
    side by side in one organization.
  rollback: >-
    Rollback = FORK a new draft from a historical version (bridge.module.yaml +
    capabilities as they existed at that version), never an in-place revert
    of the current row. Matches the append-only-ledger invariant every other
    Bridge mutation already follows (capability lifecycle, blueprint
    activation). A "rolled back" module is therefore a NEW version number
    (e.g. 1.2.0 -> 1.2.1-rollback-from-1.1.0), not a resurrected 1.1.0 row.
  dependency_pinning: >-
    bridge.module.yaml's dependencies[] pins an EXACT version per dependency
    (dependencies: [{manifest_id, version: "2.1.0"}]) — no npm-style ranges
    (^, ~, >=). A dependency bump is a new module version proposal, reviewed
    through the same install flow as a fresh install, because a version bump
    can change the computed risk of the whole module (a dependency's new
    version might add a permission the old one lacked).
  lineage_manifest_id: >-
    Every installed module version writes lineage_manifest_id pointing at
    the capability_manifests row it forked from (or null for a v1 module)—
    chains module history the same way capability_manifests already tracks
    manifest lineage (ADR-012/decisions.md v2 punch-list: "capability
    versioning/pinning/lineage — columns exist, enforcement logic still
    open"). This doc's install flow is the enforcement logic for modules;
    single-capability lineage enforcement remains the separately-tracked gap.
  in_flight_runs: >-
    An Automation/Agent Run already executing against version N of a module
    finishes on N (version marker / step memoization, per the Hatchet/
    Inngest convergence in research-agent-skill-workflow-practices-2026.md
    §4) even if N gets demoted to `legacy` mid-run. New runs after promotion
    pick up the new `available` version.
```

## 4. First three modules

Concrete sketches, not final schemas — each shows what it DECLARES (permissions/providers/risk
expectation), not a full implementation.

### DealPilot — migrate an existing compiled product

```yaml
dealpilot_module:
  kind: organization_definition
  status: already exists as tools/dealpilot (platform/) — this module format REPACKAGES it,
    does not rebuild it.
  capabilities:
    - id: dealpilot.thesis-fit-scoring
      capability_type: skill
      permissions: [{ resource_type: deal, action: write, data_scope: all, egress: false }]
      expected_risk: transformational   # ordinary organization-data write, no egress, no governed resource
    - id: dealpilot.sourcing-waterfall
      capability_type: automation
      permissions:
        - { resource_type: company, action: read, data_scope: public, egress: false }
        - { resource_type: external_fetch, action: read, data_scope: public, egress: true }
      connectors: [{ id: bizbuysell-email-parser, external_send: false }]
      expected_risk: external   # egress:true permission -> external, per riskForPermission()
  context_providers: []          # no Sensor SPI dependency — email intake goes through
                                  # @bridge/integrations-google, not a context provider
  domain_vocab: "Deal" (organization scope) — aligns to Bridge theme (Deal ~ Record-shaped)
    while keeping the user-facing term "Deal"; kernel code underneath stays Record/
    Touchpoint per the kernel-vocab rule.
```

### Helpdesk — in-Bridge governed MVP, Help Request entity

```yaml
helpdesk_module:
  kind: organization_definition
  capabilities:
    - id: helpdesk.capability-routing
      capability_type: skill
      permissions:
        - { resource_type: help_request, action: read, data_scope: all, egress: false }
        - { resource_type: help_route, action: write, data_scope: all, egress: false }
      expected_risk: transformational
    - id: helpdesk.offer-drafting
      capability_type: skill
      permissions: [{ resource_type: help_offer, action: write, data_scope: all, egress: false }]
      expected_risk: advisory   # draft-then-approve output only, matches "recommendation"-shaped write
  new_entity: Help Request (kernel-scope new node type per docs/wiki/helpdesk.md — not Lead/Ticket)
  audience: team    # Helpdesk Organizations are shared -> raises informational/advisory to at
                    # least user_pref per raiseForAudience() ("informational x shared != auto")
```

### Recon — External-band research capability

```yaml
recon_module:
  kind: skill
  status: NOT YET a module — Recon today (Tools/recon/) is a standalone Next.js app, not yet
    migrated into platform/. This sketch is the TARGET shape per tools.md's "Recon splits into
    people-sourcing + company-sourcing" plan, refined for module packaging.
  capabilities:
    - id: recon.osint-search
      capability_type: skill
      permissions:
        - { resource_type: external_fetch, action: read, data_scope: public, egress: true }
        - { resource_type: person, action: write, data_scope: public, egress: false }
      connectors: [{ id: search-provider, external_send: false }]
      expected_risk: external   # egress read alone -> external; ALSO lethal-trifecta candidate:
                                # untrusted external content + writes into the graph — install-time
                                # check in §2 step 3 applies even though no single permission
                                # combines all three legs.
  match_tiers:                  # carried from docs/wiki (Recon match governance memory) as
                                 # module-level documentation, not new mechanism
    strong: name + 1 corroborating point -> auto-linked
    moderate: name-only in-profile match -> pending review
    flag: 3 flag-risk tiers -> always human-reviewed, never auto
  per_source_name_verify: every source's own listed name must independently match before a
    tier is assigned — prevents cross-source false corroboration.
  draft_then_approve: every recon.osint-search output is a pipeline proposal (person/signal),
    same as every other external:fetch sourcing skill already in platform/packages/sourcing.
  audience: external_visible when composed into a public-facing background-check flow -> raises
    approval further per raiseForAudience(); combined with the External hard floor this makes
    Recon's install always explicit_human, no trust grant can shortcut it — matches Recon's
    "External-band always human at launch" placement in decisions.md.
```

## 5. Open questions

```yaml
open_questions:
  - id: module_migrations
    question: >-
      How does a module ship its own schema migrations (a migrations/ dir is sketched in §1)
      against a SHARED kernel schema.ts? Module-owned tables vs. module-owned COLUMNS on
      kernel tables have very different blast radius. Not resolved here.
  - id: vocab_alignment_mechanism
    question: >-
      bridge.module.yaml's organization_vocab.domain_terms declares intent ("Deal" aligns-to-Bridge-
      theme), but no compiler pass enforces or even validates this today. Is vocab alignment a
      lint (like bridge/no-crm-vocab, but inverted — warn if a module's UI drifts far from its
      declared domain_terms), a Learning-Agent-time rewrite, or purely documentation? Open.
  - id: capability_resource_type_gap
    question: >-
      docs/BUGS.md and decisions.md both note capability_manifests/organization_definitions have
      no dedicated ResourceType yet (capability.approve and organization.blueprint.activate both
      stand in with resourceType:"skill"). A module-install proposal needs its OWN
      ResourceType too (or reuses the same stand-in) — this doc does not resolve that gap, only
      inherits it.
  - id: module_registry_location
    question: >-
      Where does the module registry itself live — a new `modules` table, or is a module
      just a manifest-of-manifests resolved at install time with no durable registry row until
      first install? Affects whether "browse available modules" is a kernel query or a
      static/generated catalog.
  - id: fixture_vocab_for_modules
    question: >-
      CLAUDE.md flags unit-test fixture literals as a still-open question under the no-dummy-
      data reversal. Modules ship their own tests/ dir (per §1 layout) — do module test
      fixtures inherit that same open question, or does shipping a module to real users impose
      a stricter bar (e.g. no fixture data ships in assets/, only in tests/)? Not decided.
  - id: cross_module_shared_capabilities
    question: >-
      decisions.md's day-1 user call flags "cross-organization capability sharing ⇒ versioning +
      pinning day-1." This doc's §3 versions a module per Organization. How does one physical
      capability shared across two modules (e.g. company-sourcing used by both DealPilot and a
      future Recon module) resolve when the two modules pin DIFFERENT versions of it in the
      same organization? Diamond-dependency conflict resolution is unspecified.
```
