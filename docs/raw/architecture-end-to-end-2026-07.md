---
title: End-to-end architecture — Kernel → Compiler → Runtime → Generated Workspace
type: raw
doc_kind: reference
status: current
companions:
  - ARCHITECTURE.md
  - capability-package-format.md
  - capability-evolution.md
  - roadmap-v2-universal-commons.md
  - client-architecture-context-providers.md
related_wiki: architecture.md
updated: 2026-07-09
tags: [architecture, kernel, compiler, runtime, workspace, synthesis]
---

# End-to-end architecture — Kernel → Compiler → Runtime → Generated Workspace

Synthesis doc. Does not introduce new decisions — every claim below cites the raw doc that owns it
(no owning doc = flagged `[SPECULATIVE]`). Written because no single file walked the four Living
Software layers (CLAUDE.md's "Kernel → Compiler → Runtime → Generated Workspace") top to bottom;
the detail lives correctly-but-separately in [ARCHITECTURE.md](ARCHITECTURE.md),
[capability-package-format.md](capability-package-format.md), [capability-evolution.md](capability-evolution.md),
[roadmap-v2-universal-commons.md](roadmap-v2-universal-commons.md).

## 0. The four layers, one sentence each

| Layer | Proves | Owning doc |
|---|---|---|
| **Kernel** | "Bridge can represent work" | [ARCHITECTURE.md](ARCHITECTURE.md) |
| **Compiler** | "Bridge can generate software" | [ARCHITECTURE.md](ARCHITECTURE.md) §Enablement meta-model + `blueprint.ts` |
| **Runtime** | "generated beats static" | [capability-package-format.md](capability-package-format.md) |
| **Generated Workspace** | "improves itself / many softwares, one engine" | [capability-evolution.md](capability-evolution.md), [roadmap-v2-universal-commons.md](roadmap-v2-universal-commons.md) |

Sequencing = [roadmap.md](../wiki/roadmap.md) P0→P6, ordered by irreversibility (kernel hardest-first,
one hypothesis per phase). Layers are cumulative, not swappable — Runtime cannot exist without
Compiler output; Generated Workspace cannot evolve a capability the Runtime never installed.

## 1. Kernel — the substrate everything else compiles onto

Surface-agnostic: one API (tRPC/Fastify), three thin clients (web/desktop-Tauri/mobile — Notion
model). Owns four things, all in `packages/core`, zero deps, conformance-tested:

- **Unified Graph** — one `edges` fabric, two governance planes (Mirror = pure Person/Community;
  Operational = Initiative/Touchpoint/Ritual/Tool/Agent/Signal), cross-plane edges whitelisted only.
- **Universal Action Pipeline** — the ONLY mutation path: `Request → Authority → Policy(pre) →
  Agent+Skill → Policy(runtime) → User Review → Ledger(append) → Policy(post) → Variance Adjuster →
  Output/Event`. Deny-default, append-only ledger, no hard delete.
- **Authority resolver** — `(role ∩ capability_scope) ∪ active ephemeral − deny`, non-removable
  agent-floor DENY (no edit policy/skill/agent/role/ledger, no full-graph read, no `external:send`).
- **Local ↔ Gate ↔ Cloud two-plane split** — local plane (customer-controlled, pglite/Postgres, never
  leaves) / the gate (= the Pipeline, only egress path, `private ∩ egress = none` structurally
  rejects) / cloud plane (canonical + enrichment + send, reachable only through the gate).

Sensor SPI (desktop capture, system events, browser) is an **optional capability bolted onto the
Kernel**, never a Kernel dependency — day-1 per P0, but the Kernel is complete without it.

Status: gate ✅, plane gate ✅ (structural, 38/38 tests incl. gate invariants), local store ✅
(`createLocalDb`, same ports as cloud). Governance ledger/people still cloud-Supabase-by-default in
the running API — next slice (per [ARCHITECTURE.md](ARCHITECTURE.md) §Implemented).

## 2. Compiler — turns intent into a running workspace

Not a separate service — a pure-function boundary inside the Kernel that the client layer calls.

- **`compileBlueprint()`** (`@bridge/core`, `blueprint.ts`) — enforces registered node types +
  relationship views restricted to `graph|table`. Input = onboarding answers (5-12 adaptive
  questions, branches on solo/team + domain); output = a compiled blueprint the `<DataViews>` shell
  renders. Propose/activate is itself a governed Pipeline proposal (`workspace.blueprint.{get,
  propose,activate}` — same `pipeline.propose/decide` seam as every other mutation, no special case).
- **`classifyIntent`** (`chief-of-staff.ts`) — routes free-text intent to a proposal. Star topology
  is enforced by *type shape* (`RoutingDecision` has no multi-route field), not convention — a
  structural guarantee against peer-agent handoffs, plus a hard chain-depth cap (`assertChainDepth`,
  cap=3).
- **Enablement meta-model** — Skill (atomic/versioned) / Agent (goal+identity+capability_scope) /
  Ritual (trigger+pipeline+surface) / Tool (composition+surface) — **all four compile to the same
  Pipeline, same Graph** ([ARCHITECTURE.md](ARCHITECTURE.md) §Enablement). This is what makes
  "workflow/skill/agent/tool = PEERS" ([roadmap-v2-universal-commons.md](roadmap-v2-universal-commons.md))
  true at the type-system level, not just as a naming convention.

Status: DONE for P1 (ADR-017 `<DataViews>` shell + registry, ADR-019 onboarding pop-up + Chief of
Staff v1). Gaps logged: no avatar v1 that pass (later un-deferred to P1, see roadmap Consolidation
sprint), diff preview only works when the referenced draft is also the active definition, Chief of
Staff routes always stage a generic proposal (no real downstream skill to execute yet) — see
[BUGS.md](../BUGS.md).

## 3. Runtime — installs and executes compiled capability, package-shaped

Everything the Compiler emits becomes a **governed package**, installed through the same Pipeline:

- **Package format** ([capability-package-format.md](capability-package-format.md), ADR-018) — a
  `PackageManifest` bundles one or more `CapabilityManifest`s. Install = a governed proposal; risk
  is **computed over the dependency closure** (not per-capability in isolation) with **lethal-trifecta
  union** (private-read + untrusted-ingest + egress across the whole closure ⇒ auto-External, no
  matter how each capability looks alone).
- **Versioning** — Zapier-style **single-live-version** (only one version active per install), rollback
  = **fork-from-history**, never in-place revert (append-only, matches the ledger's own invariant).
- **Origin tiers** — `built_in` (Bridge-authored) vs `community` (foreign-imported, always treated as
  `user_code`-tier untrusted regardless of source reputation — see §5 below for how OSS enters here).
- **Ritual execution** = planner/executor split — an agentic Planner proposes a DAG (swarm-like,
  non-deterministic OK), a review gate (L0-L3) approves, a deterministic DAG executes through the
  Pipeline node-by-node (each node: Authority→Policy→Skill→Policy→Review→Ledger→Policy). "Swarm
  plans, DAG runs" — the boundary is a per-node `plan|execute` toggle in the UI, egress/agent-floor
  nodes pinned to `execute`.

Status: SLICE 1 DONE (ADR-021) — package runtime in core (parse/risk-with-trifecta/single-live-
version/rollback-as-fork), `packages.*` tRPC install flow, DealPilot + Helpdesk repackaged as add-on
capability packages over one workspace (Pi-extensions model — **not separate products**, roadmap.md
P2). Recon still standalone (migration pending). Known gaps: in-memory package store, non-idempotent
capability re-registration (BUGS.md).

## 4. Generated Workspace — the layer that evolves itself

Where the platform stops being "compile once" and starts being "improve continuously":

- **Component Registry + similarity detection** (ADR-032, [capability-evolution.md](capability-evolution.md))
  — designed, not yet built. Confidence-tiered AI-led Module creation, no user forms; dedups new
  capability proposals against what already exists before proposing a duplicate.
- **Two-gate promotion** (roadmap.md P3 practice-hardening) — every generated capability crosses
  Draft→Validated via TWO independent gates: output-quality pass rate AND trigger precision/recall.
  Held-out eval selection (an eval can't validate the capability that generated it). Baseline-vs-
  with-capability parallel runs = the default eval shape.
- **Promotion ladder = trust ladder, never type mutation** (ontology.md, ADR-028) — a promoted Skill
  stays a Skill; a new governed object *consumes* it. This is the rule that keeps "workflow/skill/
  agent/tool = peers" from becoming a hierarchy in disguise.
- **Universal Commons** — cloud service, generalized capability knowledge ONLY (archetypes,
  blueprints, governance heuristics, adapters, onboarding questions). Structurally forbidden from
  holding memories/docs/emails/names/raw captures/field values (privacy-gate.ts 422s on any
  workspace-data key). v1 = curated human-published package registry (format = ADR-018); community
  self-serve publish is out of scope for v1 (External band, needs full signing chain — see §5).
- **Control-plane separation** — Commons ≠ "Bridge Cloud." Bridge Cloud = sync/identity/registry
  control plane (onboarding from any surface); Commons = pure capability-knowledge distribution
  (iPhone-updates model). Every surface still functions independently offline regardless of Commons
  reachability.

Status: designed, not built (ADR-032/033 are docs-only per roadmap.md). This is the layer P3
("Capability Evolution") targets.

## 5. Cross-cutting: how external/OSS capability enters the Runtime

Not a fifth layer — a **feeder into the Runtime's package format**, governed by the same trust model
as every internally-generated capability. Full plan: [oss-commons-integration-plan-2026-07.md](oss-commons-integration-plan-2026-07.md).
One ingestion spine, three source-type front-ends (OSS skills / OSS agent-patterns / OSS software
modules), converging on the same `parsePackageManifest` + `computePackageRisk` + Commons publish
contract the Runtime already runs — foreign origin is `community`-tier (== `user_code`-tier
untrusted) by construction, no exception for popularity or stars. Status: **draft, Section 0
(supply-chain trust foundation — content-hash pinning, signing, dropping the MCP sandbox exemption)
not yet built** — this is the prerequisite the plan itself says must land before the first foreign
artifact publishes.

## 6. What this doc deliberately does not cover

Full DB schema → [SCHEMA.sql](SCHEMA.sql) / [../wiki/schema.md](../wiki/schema.md). Client/context-
provider registry (how desktop/web/mobile each surface the same Kernel) →
[client-architecture-context-providers.md](client-architecture-context-providers.md) /
[../wiki/clients.md](../wiki/clients.md). Stack/library choices →
[STACK.md](STACK.md) / [../wiki/stack.md](../wiki/stack.md). Security posture and open HIGH findings
→ [../wiki/security.md](../wiki/security.md) / [BUGS.md](../BUGS.md).
