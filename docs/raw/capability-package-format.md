---
title: Capability package format — install/version/rollback over the Capability Trust Model
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
tags: [capability, package, manifest, install, versioning, dealpilot, helpdesk, recon, governance]
---

# Capability package format

A package is the SHIPPING UNIT one level above a single `capability_manifests` row. Where
`packages/core/src/capability/` (types.ts/risk.ts/lifecycle.ts/approvals.ts, ADR-012) governs
ONE capability's trust lifecycle, a package is a **bundle of capability manifests plus a
directory of implementation** — how DealPilot, Helpdesk, and Recon actually ship as installable
units a workspace adopts, rather than code that only ever lived in `platform/tools/*` at
build time.

This doc is the format spec. It does not change any shipped code — `packages/core/src/
capability/` is the trust-model kernel this format is built ON TOP OF, read-only here.

## 1. Package manifest schema

A package manifest is `package.yaml` at the package root. It is a SEPARATE object from a
`capability_manifests` row — a package CONTAINS one or more capability manifests (its
`capabilities[]` array), each of which is itself the same shape `packages/core/src/capability/
types.ts`'s `CapabilityManifest` already defines (id/version/capabilityType/origin/audience/
permissions/connectors/dependencies). A package is the distribution wrapper; a capability
manifest is the trust-model unit risk.ts/lifecycle.ts/approvals.ts operate on. One package,
many manifests — this is the "package carries MULTIPLE capability manifests" requirement.

```yaml
package:
  name: dealpilot                 # kebab-case, unique across the package registry
  version: 1.2.0                  # strict semver (MAJOR.MINOR.PATCH) — see §3, no ranges
  kind: workspace_definition       # one of: skill | workflow | agent | tool | view | integration_bundle | workspace_definition
  summary: >-
    Sourced and evaluated small-business acquisition deals, scored against a
    configurable investment thesis.
  description: >-
    Progressive-disclosure body (>=1 paragraph, <=1024 chars per agentskills.io
    convention) — states WHAT the package does and WHEN a workspace would install
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
      capability_type: workflow
      permissions:
        - { resource_type: deal, action: write, data_scope: all, egress: false }
      connectors:
        - { id: dedupe-engine, external_send: false }
  context_providers:               # optional — Sensor SPI / context-provider registry consumption
    - kind: email                  # must match a registered context-provider kind (docs/wiki/clients.md)
      required: false
  workspace_vocab:                 # domain-vocab alignment declaration (see §5 open questions)
    aligns_to_bridge_theme: true   # generated vocab defaults to Bridge theme; user naming always wins
    domain_terms:
      deal: "the Initiative-equivalent entity this package introduces"
```

```yaml
directory_layout:
  package.yaml            # L1 — always loaded; manifest + description (progressive disclosure entry point)
  README.md                # L1 companion — human-facing summary, not parsed by the compiler
  capabilities/             # one file per capability_manifests entry in package.yaml
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
  migrations/                # package-owned schema deltas, see §5 open questions
    0001_add_deal_fields.sql
  tests/
    thesis-fit-scoring.test.ts
```

**Progressive disclosure mapping** (agentskills.io SKILL.md spec, folded into package shape):
L1 = `package.yaml` frontmatter-equivalent (name/version/kind/summary — always loaded into any
registry listing or Learning Agent context, ~100 tokens); L2 = `README.md` + each capability's
own manifest body (<500 lines, loaded only when a capability is inspected/proposed); L3 =
`scripts/`, `references/`, `assets/`, `migrations/` (loaded/executed on demand, code never enters
model context — only its output does, same rule as a SKILL.md's `scripts/`).

## 2. Install flow

**Install = a governed proposal through the EXISTING pipeline** (`pipeline.propose`/`decide`),
not a new install subsystem. This mirrors ADR-012's `capability.approve` and ADR-017's
`workspace.blueprint.activate` — every package install is one more thing that flows through
`propose`/`decide`, never a bespoke path.

```yaml
install_flow:
  1_propose:
    actor: user | learning_agent   # agent-floor still applies — an agent may PROPOSE, never approve
    action: package.install.propose
    effect: >-
      Creates a draft package_installations row (workspace_id, package name+version,
      status=pending_review). Each capability in the package is registered via the
      EXISTING capability.register path (ADR-012) — always creates `draft` state,
      never active. Registration ≠ activation, same invariant as capability lifecycle.
  2_compute_risk:
    rule: >-
      Risk is COMPUTED, never trusted from the package's own manifest hints.
      computeRisk() (packages/core/src/capability/risk.ts) walks the FULL
      dependency closure of every capability the package declares, INCLUDING
      transitive package dependencies pinned in package.yaml's dependencies[].
      A package's `summary`/`description` text is documentation only — it is
      never read as a risk signal, mirroring "a [manifest] can lie" (MCP
      annotation-trust research finding, research-agent-skill-workflow-
      practices-2026.md §6).
    composite: max(risk) over every capability in the package AND every
      dependency's capabilities, cycle-safe (existing visited-set walk).
  3_lethal_trifecta_check:
    rule: >-
      Applied at install time, per package, over the UNION of all capabilities'
      permissions: if the union contains (a) a private-data READ, (b)
      consumption of untrusted/external ingest content, AND (c) an egress
      permission — auto-escalate the WHOLE package's effective risk band to
      `external`, overriding whatever computeRisk() alone produced. This is
      the same rule roadmap.md's practice-hardening P0 line states for single
      capabilities, applied at the package-install boundary because a package
      composing three individually-safe capabilities can still assemble the
      trifecta across them.
  4_approval_routing:
    rule: >-
      requiredApproval()/resolveActivationApproval() (approvals.ts) run
      UNCHANGED against the computed (possibly trifecta-escalated) risk band
      and the package's declared audience. External band is the same
      non-removable hard floor — explicit_human, no trust grant can lower it,
      checked first, exactly as approvals.ts already enforces for a single
      capability.
  5_decide:
    action: pipeline.decide (human, or trust-grant auto per band)
    on_approve: >-
      Each capability advances draft -> validated -> approved via the existing
      lifecycle.advance() guards; package_installations flips to `installed`;
      workspace_definitions may gain a new blueprint slice if the package
      declares views (ADR-017's compiled-workspace path, unchanged).
    on_reject: package_installations -> rejected, capabilities stay `draft`
      (inert, never silently deleted — same as a rejected capability today).
```

No new approval mechanism, no new risk model, no trust bypass for anything package-shaped —
the package format is purely a bundling and distribution concern layered over the trust model
that already shipped.

## 3. Versioning

**Single live version per workspace** (Zapier model, per roadmap.md P5 + research §7):

```yaml
versioning:
  model: single_live_version_per_workspace
  states: [private, promoted, available, legacy, deprecating, deprecated]
  rule: >-
    At most ONE package version per workspace may be `available` at a time.
    Promoting a new version to `available` AUTO-DEMOTES the prior available
    version to `legacy` in the same transaction — never two live versions
    side by side in one workspace.
  rollback: >-
    Rollback = FORK a new draft from a historical version (package.yaml +
    capabilities as they existed at that version), never an in-place revert
    of the current row. Matches the append-only-ledger invariant every other
    Bridge mutation already follows (capability lifecycle, blueprint
    activation). A "rolled back" package is therefore a NEW version number
    (e.g. 1.2.0 -> 1.2.1-rollback-from-1.1.0), not a resurrected 1.1.0 row.
  dependency_pinning: >-
    package.yaml's dependencies[] pins an EXACT version per dependency
    (dependencies: [{manifest_id, version: "2.1.0"}]) — no npm-style ranges
    (^, ~, >=). A dependency bump is a new package version proposal, reviewed
    through the same install flow as a fresh install, because a version bump
    can change the computed risk of the whole package (a dependency's new
    version might add a permission the old one lacked).
  lineage_manifest_id: >-
    Every installed package version writes lineage_manifest_id pointing at
    the capability_manifests row it forked from (or null for a v1 package)—
    chains package history the same way capability_manifests already tracks
    manifest lineage (ADR-012/decisions.md v2 punch-list: "capability
    versioning/pinning/lineage — columns exist, enforcement logic still
    open"). This doc's install flow is the enforcement logic for packages;
    single-capability lineage enforcement remains the separately-tracked gap.
  in_flight_runs: >-
    A ritual/agent run already executing against version N of a package
    finishes on N (version marker / step memoization, per the Hatchet/
    Inngest convergence in research-agent-skill-workflow-practices-2026.md
    §4) even if N gets demoted to `legacy` mid-run. New runs after promotion
    pick up the new `available` version.
```

## 4. First three packages

Concrete sketches, not final schemas — each shows what it DECLARES (permissions/providers/risk
expectation), not a full implementation.

### DealPilot — repackage an existing compiled product

```yaml
dealpilot_package:
  kind: workspace_definition
  status: already exists as tools/dealpilot (platform/) — this package format REPACKAGES it,
    does not rebuild it.
  capabilities:
    - id: dealpilot.thesis-fit-scoring
      capability_type: skill
      permissions: [{ resource_type: deal, action: write, data_scope: all, egress: false }]
      expected_risk: transformational   # ordinary workspace-data write, no egress, no governed resource
    - id: dealpilot.sourcing-waterfall
      capability_type: workflow
      permissions:
        - { resource_type: company, action: read, data_scope: public, egress: false }
        - { resource_type: external_fetch, action: read, data_scope: public, egress: true }
      connectors: [{ id: bizbuysell-email-parser, external_send: false }]
      expected_risk: external   # egress:true permission -> external, per riskForPermission()
  context_providers: []          # no Sensor SPI dependency — email intake goes through
                                  # @bridge/integrations-google, not a context provider
  domain_vocab: "Deal" (workspace scope) — aligns to Bridge theme (Deal ~ Initiative-shaped)
    while keeping the user-facing term "Deal"; kernel code underneath stays Initiative/
    Touchpoint per the kernel-vocab rule.
```

### Helpdesk — in-Bridge governed MVP, Help Request entity

```yaml
helpdesk_package:
  kind: workspace_definition
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
  audience: team    # helpdesk_workspaces are shared -> raises informational/advisory to at
                    # least user_pref per raiseForAudience() ("informational x shared != auto")
```

### Recon — External-band research capability

```yaml
recon_package:
  kind: skill
  status: NOT YET a package — Recon today (Tools/recon/) is a standalone Next.js app, not yet
    migrated into platform/. This sketch is the TARGET shape per tools.md's "Recon splits into
    people-sourcing + company-sourcing" plan, refined for package packaging.
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
                                 # package-level documentation, not new mechanism
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
  - id: package_migrations
    question: >-
      How does a package ship its own schema migrations (a migrations/ dir is sketched in §1)
      against a SHARED kernel schema.ts? Package-owned tables vs. package-owned COLUMNS on
      kernel tables have very different blast radius. Not resolved here.
  - id: vocab_alignment_mechanism
    question: >-
      package.yaml's workspace_vocab.domain_terms declares intent ("Deal" aligns-to-Bridge-
      theme), but no compiler pass enforces or even validates this today. Is vocab alignment a
      lint (like bridge/no-crm-vocab, but inverted — warn if a package's UI drifts far from its
      declared domain_terms), a Learning-Agent-time rewrite, or purely documentation? Open.
  - id: capability_resource_type_gap
    question: >-
      docs/BUGS.md and decisions.md both note capability_manifests/workspace_definitions have
      no dedicated ResourceType yet (capability.approve and workspace.blueprint.activate both
      stand in with resourceType:"skill"). A package-install proposal needs its OWN
      ResourceType too (or reuses the same stand-in) — this doc does not resolve that gap, only
      inherits it.
  - id: package_registry_location
    question: >-
      Where does the package registry itself live — a new `packages` table, or is a package
      just a manifest-of-manifests resolved at install time with no durable registry row until
      first install? Affects whether "browse available packages" is a kernel query or a
      static/generated catalog.
  - id: fixture_vocab_for_packages
    question: >-
      CLAUDE.md flags unit-test fixture literals as a still-open question under the no-dummy-
      data reversal. Packages ship their own tests/ dir (per §1 layout) — do package test
      fixtures inherit that same open question, or does shipping a package to real users impose
      a stricter bar (e.g. no fixture data ships in assets/, only in tests/)? Not decided.
  - id: cross_package_shared_capabilities
    question: >-
      decisions.md's day-1 user call flags "cross-workspace capability sharing ⇒ versioning +
      pinning day-1." This doc's §3 versions a package PER WORKSPACE. How does one physical
      capability shared across two packages (e.g. company-sourcing used by both DealPilot and a
      future Recon package) resolve when the two packages pin DIFFERENT versions of it in the
      same workspace? Diamond-dependency conflict resolution is unspecified.
```
