---
title: Business Requirements Document — Bridge
type: raw
doc_kind: reference
status: draft
companions: [vision-pivot-living-software.md, roadmap-v2-universal-commons.md]
related_wiki: brd.md
updated: 2026-07-09
tags: [brd, requirements, product]
---

# Business Requirements Document — Bridge (2026-07)

This document consolidates the current state of Bridge's requirements as they exist across
`docs/wiki/vision.md`, `docs/wiki/roadmap.md`, `docs/wiki/packages.md`, `docs/wiki/commons.md`,
`docs/wiki/competitive.md`, `docs/wiki/decisions.md`, and open items in `docs/BUGS.md`. It does
not introduce new decisions; where a claim requires generalizing beyond a source line, that is
flagged inline as "generalized."

## 1. Product definition

Bridge is **Living Software** — "software that builds itself around your work" (`vision.md` §12).
It is an adaptive workspace platform structured as a pipeline: **Kernel → Compiler → Runtime →
Generated Workspace**. The Kernel learns how a user works, generates a workspace around that
work, and continuously evolves the workflows, skills, agents, and tools inside it (`vision.md`
§12, `CLAUDE.md`). The kernel itself is not sold; what is sold are the **compiled workspaces**
that run on it (`vision.md` "Kernel / Products / Interactions").

The product's core operating principle is the **Capability Lifecycle Platform**: "everything is
proposed, governed, and continuously evolved" — every artifact (table, workflow, skill, agent,
tool, integration, dashboard) moves through one lifecycle: Need → Research → Proposal → Evidence
→ Risk class → Governance → Activation → Evaluation → Promote/Demote/Retire (`vision.md` "Core
principle").

The commercial unit is the **mix-and-match add-on capability package** (Pi-extensions model),
not a standalone product per vertical. As of the 2026-07-06 pivot, DealPilot, Helpdesk, and
Recon ship together as installable packages over one workspace — "Packages = the SKU"
(`roadmap.md` P2 reframe, `packages.md`). This replaced an earlier framing where DealPilot,
JobPilot, etc. were separate products.

**What Bridge explicitly is not** (stated repeatedly across sources, not inferred):
Bridge is NOT a CRM, sales tool, task manager, or static app of any category (`CLAUDE.md`
header). It does not ship deal pipelines/Kanban stages, bulk outreach/mail-merge, external deal
sourcing, silent broker enrichment, firmwide email surveillance, or lead-capture — all explicitly
listed as brand-breaking anti-patterns (`competitive.md` "AVOID").

Bridge is multi-surface on the Notion model: one surface-agnostic kernel (tRPC/API) served by
three thin clients — web, desktop (Tauri), and mobile. Desktop is built first as a build
*sequencing* choice, not an architectural constraint (`vision.md` "Desktop-first, multi-surface").

## 2. Target users

`vision.md` states the target market directly: **"professionals + teams"** (`vision.md` §12),
explicitly broadened from an earlier VC-fund-only framing — "Customer = ~~VC fund~~ SUPERSEDED →
teams (any profession); VC fund = seed domain for DealPilot" (`decisions.md`, 2026-07-06 pivot
section).

What is **stated**: the customer base is "any profession," organized as teams with workspace +
team tenancy from day zero (`decisions.md` pre-pivot baseline, retained). DealPilot's origin
domain (VC/deal work) is called out as the "heritage of first compiled product," not the
definition of the target user (`vision.md` §12).

What is **generalized, not directly stated**: the sources do not give a firm ICP (company size,
seniority, industry mix) beyond "professionals + teams, any profession." The roadmap's phase
language ("Team pilot" in P2) implies the near-term go-to-market unit is a small team rather than
an individual, but this is an inference from roadmap sequencing (`roadmap.md` P2), not a
declared target-segment statement. JobPilot/ResearchPilot are named as *later* compiled products
(`vision.md` "Kernel / Products / Interactions"), suggesting job-seekers and researchers as future
segments, but they are P6 ("Domain + Ecosystem") and not committed near-term targets.

## 3. Problem statement

`vision.md` frames the problem as: software today is static — a fixed app that a user must adapt
their work to, rather than software that adapts to the user's work. Bridge's answer is software
that "learns how user works → generates workspace → continuously evolves workflows/skills/
agents/tools" (`vision.md` §12). The brand principles restate this as a sequencing discipline:
**"Adapt before asking · Learn before acting · Explain before automating · Govern before
executing · Build only lasting value · Simple surface, powerful underneath"** (`vision.md` "Brand
principles").

A second, more specific problem statement is embedded in the Capability Trust Model rationale:
existing agent/automation tooling either requires blanket human-only approval for everything
(too slow to be useful) or auto-executes broadly (too risky to trust) — Bridge's answer is
risk-computed, trust-decaying, band-scoped approval so routine actions can auto-commit while
higher-risk actions stay gated (`vision.md` "Capability Trust Model"). `competitive.md`
sharpens this into the stated moat: **"consent + audit AS ARCHITECTURE"** — competitors in the
relationship-graph space (Affinity, Mesh, Rolodex, ZoomInfo) build team graphs via silent
firmwide ingest with no consent; Bridge pairs shared identity with sovereign private memory and
logged consent (`competitive.md` "Moat").

No competitor is stated to ship pre-apply approval — "blueprint = persisted draft + diff +
approval card (NO competitor ships pre-apply approval — Notion/Fibery/Noloco all post-hoc undo —
this is the moat)" (`roadmap.md`, P1 practice-hardening line).

## 4. Scope by roadmap phase

Phases are ordered by irreversibility (hardest-to-reverse kernel work first), one hypothesis per
phase (`roadmap.md` intro). Status below is drawn directly from `roadmap.md`'s own phase entries.

**P0 — Bridge Kernel.** Hypothesis: *"Bridge can represent work."* Scope: surface-agnostic
kernel (tRPC/API) with graph + node_types registry, Memory (Mem0 behind a port), Governance +
Capability Trust Model (computed risk, manifests, states, credential broker, budgets), the
runtime (+ Mastra components), and an optional, desktop-only Sensor SPI with day-1 sensors
(desktop capture via Tauri/Rust on macOS, system events, browser) feeding inspectable Memory
entries with an avatar "blink" tell. Tauri is the first client shell built (sequencing, not
architecture). Status: **in progress, not marked done** — `roadmap.md` lists P0 with no "DONE"
marker, and `BUGS.md` documents multiple P0-relevant gaps still open (no auth enforced by
default, Tauri CSP disabled, sensor "screen" provider still stubbed, cross-platform build only
compiles on macOS).

**P1 — Workspace Generator.** Hypothesis: *"Bridge can generate software."* Status: **DONE**
(2026-07-06, ADR-017 + ADR-019, per `roadmap.md`). Delivered: adaptive 5–12 question onboarding,
blueprint compilation via `<DataViews>` shell (mobile-width-safe from day one), Chief of Staff
v1 with approval cards. Documented gaps carried forward in `BUGS.md`: the blueprint-activation
diff preview only renders when the referenced draft is also the active definition; per-proposal
risk display is a client-side "(estimated)" heuristic, not real computed risk; Chief of Staff's
routing registry has no real downstream skill wired to any entry yet — every routed turn stages a
generic proposal.

**P2 — First Compiled Packages.** Hypothesis: *"generated beats static."* Status: **slice 1
DONE** (2026-07-06, ADR-021): package runtime (parse/risk-with-trifecta-union/single-live-
version/rollback-as-fork) is running code, `packages.*` tRPC install flow exists, DealPilot has
been repackaged as a formal package, and a Helpdesk package MVP shipped. **Recon has not yet been
repackaged** — it remains a standalone app under `Tools/recon/` (`packages.md` "First three
packages"). Known gaps per `roadmap.md`/`packages.md`: package rows are in-memory in both
runtime modes (no Drizzle table yet), capability re-registration across versions is not
idempotent, and the resourceType used for install is an interim placeholder ("skill").

**P3 — Capability Evolution.** Hypothesis: *"improves itself."* Status: **designed only, not
built** — `roadmap.md` describes the target shape (pattern engine over sensors + activity,
promotion ladder as compiler rules, sandbox CI/CD for Capability Builder, heartbeats + auto-
suspend + governed demotion) with no "DONE" or "shipped" marker.

**P4 — Interaction Expansion.** Hypothesis: *"natural interaction."* Status: **designed only** —
Command Center (keyboard/voice/context), ambient *acting* (as distinct from day-1 ambient
*sensing*), and the Communications skill gate are specified but not reported built.

**P5 — Fork/Compose/Publish.** Hypothesis: *"many softwares, one engine."* Status: **designed
only** — Fork (egg-spawn), Compose, Publish Blueprint, versioned + pinned shared capabilities,
and deny-wins policy composition are specified in `vision.md`'s "Workspaces = projections"
section but not reported implemented.

**P6 — Domain + Ecosystem.** Hypothesis: *"compiler generalizes."* Status: **designed only** —
JobPilot/ResearchPilot as later compiled products, a community marketplace, a Windows capture
port, and the E2EE tier are named as this phase's scope with no implementation reported.

## 5. Non-goals

- Bridge is not a CRM, sales tool, task manager, or static app of any category (`CLAUDE.md`).
- Bridge is never framed against OS vendors competitively; that framing is dropped entirely from
  the competitive narrative and retained only as an internal engineering risk note (graceful
  degradation / OS entitlements) (`vision.md` "Second-pass amendments").
- The Universal Commons never holds user data — it is generalized capability knowledge only
  (archetypes, blueprints, governance heuristics, adapters, onboarding questions). Explicitly
  excluded: memories, docs, emails, names, raw captures, field values (`vision.md` "Roadmap v2
  ingest"; enforced in code via a publish-time privacy gate per `commons.md` "Knowledge-only
  rule").
- Per-product/domain competitors (e.g., DealPilot's) are researched live by the Learning Agent at
  blueprint/onboarding time and are never hardcoded into the product (`vision.md`, stated twice —
  "Second-pass amendments" and "Desktop-first, multi-surface").
- Explicitly avoided product patterns (`competitive.md` "AVOID"): bulk outreach/mail-merge, deal
  pipeline/Kanban/stages, external deal sourcing, silent broker enrichment/shadow profiles,
  firmwide email surveillance, auto-send without review, recording without both-party consent or
  BANT-style capture, meeting bots, CRM-feeder behavior, lead-capture on the Digital Card, card-
  view analytics, commerce/payouts on intros, and gamification.
- No new seeded/demo/placeholder product state going forward — "the platform shows real,
  connected data only" (`CLAUDE.md`, reversal of the earlier `dummy_`-prefix convention). Note:
  unit-test fixture literals are called out as a separate, still-open question, not covered by
  this non-goal (`CLAUDE.md`).

## 6. Success criteria

Each roadmap phase is stated as a hypothesis to prove; the sources do not attach numeric
acceptance thresholds, so criteria below restate the phase hypothesis as the pass/fail bar
(generalized only in that "proves X" is read as "criterion = demonstrate X," not stated as a
formal metric in the source):

- **P0**: Bridge can represent work — a surface-agnostic kernel with a working graph/node_types
  registry, Memory, governance + Capability Trust Model, and day-1 sensors producing inspectable
  Memory entries.
- **P1**: Bridge can generate software — adaptive onboarding produces a real, governed blueprint
  that compiles into a working `<DataViews>` workspace, reviewable via approval cards. (Met per
  `roadmap.md`'s "DONE" marker, with the documented gaps in §4 above still open.)
- **P2**: Generated beats static — mix-and-match capability packages install through the same
  governed pipeline as any other capability, and at least one repackaged product (DealPilot) plus
  one native package (Helpdesk) run on it. (Slice 1 met; Recon repackaging and a persistent
  package store remain outstanding before the phase can be called fully proven.)
- **P3**: The system improves itself — capability drafts are proposed from observed patterns and
  promoted/demoted via evidence-based thresholds without manual authoring.
- **P4**: Interaction feels natural — a cross-surface Command Center and ambient *acting*
  (suggestions, quick actions, insertion) function without breaking the governance gate.
- **P5**: One engine runs many softwares — a workspace can Fork, Compose with another workspace's
  capabilities, and Publish a Blueprint without graph partitioning or auto-merge conflicts.
- **P6**: The compiler generalizes beyond its first domain — a second/third compiled product
  (JobPilot, ResearchPilot) runs on the same kernel with a community marketplace and expanded
  platform coverage (Windows capture, E2EE tier).

## 7. Key risks

**Security — open HIGH-severity items (`BUGS.md`, all logged 2026-07-08):**
- **H1**: No authentication is enforced by default — with no `SUPABASE_JWT_SECRET`/`SUPABASE_URL`
  configured, or no `Authorization` header, every tRPC procedure silently resolves to the pilot
  identity with full write/propose access; compounded by CORS defaulting to `origin:true` outside
  production.
- **H2**: Vulnerable dependencies — `drizzle-orm` has a known SQL-identifier-injection advisory
  (GHSA-gpj5-g38j-94v9) below the patched version, plus multiple HIGH `react-router` advisories
  (turbo-stream RCE, `javascript:` XSS, manifest DoS) in `apps/web`.
- **H3**: The Tauri desktop shell ships with CSP disabled (`csp: null`) while hosting `apps/web`
  and exposing `sensor_bridge` IPC commands — any web XSS gets an unrestricted webview into the
  IPC bridge, a risk that worsens once continuous capture ships.
- **H4**: No rate limiting anywhere on the API — combined with H1, an unauthenticated caller can
  flood proposal/sync/OTP endpoints and cost-amplify against outbound-network procedures.
- Also open: M1–M6 (RLS absent from tracked migrations, membership checks missing on workspace
  invite/list/create, Recon SSRF surface, unqualified phone-OTP trust flag, no log redaction,
  client-asserted LinkedIn verification), OAuth tokens stored plaintext locally, RLS not actually
  enabled on any table, the local-first "plane" tag being client-asserted rather than
  server-derived, and no runtime provenance/taint tracking on ingested content (the
  prompt-injection root gap — the lethal-trifecta check today is a static install-time manifest
  audit, not a runtime data-flow check).

**Schema v2 punch-list backlog (`decisions.md` "v2 schema punch-list"):** roles + inheritance,
delegations + ledger `on_behalf_of`/`delegation_id`, ephemeral grants, agent-floor DENY +
deny-default + expanded resource types, touchpoint hierarchy + Planner + plan-proposal review,
signal read-only + `signal_actions` + 'saved' state, node_types registry + plane tag +
whitelisted cross-plane edges, `ritual_runs`, pin embedding dimension. Pivot-era additions still
open: sensor/memory tables for capture→Memory, and capability versioning/pinning/lineage
enforcement logic (columns exist; enforcement does not yet). Capability manifests/lifecycle/
trust_grants and the `workspace_definitions` table are marked DONE as of 2026-07-06.

**Platform coverage — macOS-only.** The Tauri desktop shell cannot compile on Linux or Windows:
`Cargo.toml` lists Apple-only crates (`objc2`, `objc2-app-kit`, `objc2-foundation`,
`macos-private-api`) as unconditional dependencies rather than cfg-gated; there is no
installer/signing/updater for any OS (`bundle.active=false`); CI never compiles the Rust/Tauri
side (desktop build/test are no-ops); and the mobile Expo client is stranded on an unmerged
branch, absent from mainline (`BUGS.md`, 2026-07-08).

**Supply-chain gaps blocking OSS ingestion into Commons.** The capability/package manifest has no
`license`, `provenance`, `content_hash`, or `signature` fields — it cannot record SPDX license,
source repo + commit SHA, or verify integrity, which blocks safe OSS ingestion and mirrors the
security audit's broader "no signature/publisher verification on imports" finding, including an
exempted MCP-import sandbox bypass (`BUGS.md`, 2026-07-08; full plan referenced at
`docs/raw/oss-commons-integration-plan-2026-07.md`).

## 8. Open commercial questions

**Pricing and go-to-market are currently unowned by any source document.** None of `vision.md`,
`roadmap.md`, `packages.md`, `commons.md`, `competitive.md`, or `decisions.md` state a pricing
model, packaging/tiering, or a go-to-market motion beyond "Team pilot" as a P2 milestone label.
`vision.md` explicitly reframes the original GP-fund customer as a superseded artifact and calls
DealPilot "heritage," which removes the one concrete monetization anchor the pre-pivot plan had,
without supplying a replacement. This is flagged here as an open question rather than answered —
**no pricing model should be inferred or invented from adjacent language** (e.g., "sell as
PRODUCTS, support/pricing" in `vision.md`'s Kernel/Products section states that products are
sold, not what they cost or how). Note: an earlier, superseded version of this document (dated
2026-07-06) did assert a specific business model (per-seat subscription + paid packages +
future Commons economy) — that assertion is not corroborated by any of `vision.md`, `roadmap.md`,
`packages.md`, or `decisions.md` as read for this pass, and is treated here as unowned rather than
carried forward.

**Prototype-to-kernel data migration path is unowned.** The existing prototype (Design Bridge AI
Interface) carries real, committed data (per project memory: "Prototype now tracked" — real
LinkedIn PII scrubbing concern) and a UI skin the platform is being migrated onto (`decisions.md`,
"platform UI must match prototype... two codebases, migration = Track C"), but no source document
in this read set specifies how existing prototype data (people, communities, lists) moves into
the P0 kernel's canonical schema, or whether it moves at all before general availability.

**Bridge Cloud control-plane is unspecified.** `vision.md`'s "Roadmap v2 ingest" section names a
separate "Bridge Cloud" control plane (sync/identity/registry, distinct from the Commons
capability registry) as a user-called requirement — onboarding on any surface routes through it —
but no source document here defines its architecture, hosting model, or relationship to the
already-specified `commons` service contract (`commons.md`'s Fastify/port-4780 service is
explicitly local-first with a stated intent to "lift to cloud" by pointing `COMMONS_URL`
elsewhere — Bridge Cloud is not that service and remains a named-but-undesigned dependency).
