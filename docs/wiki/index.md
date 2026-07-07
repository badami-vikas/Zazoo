# Bridge Wiki — Index

Bridge = **Living Software** — adaptive workspace platform; software that builds itself around your work (pivot 2026-07-06, see [vision](vision.md)). Kernel + compiled workspaces (DealPilot first). NOT a static app of any category. Old "relationship-intelligence OS / VC-fund wedge" framing = superseded.

## How to read
Agents read wiki by default. Hit `../raw/` only when wiki thin / strong need. Start here → [decisions](decisions.md).

## Pages
- [vision](vision.md) — **2026-07-06 PIVOT: Living Software / Capability Lifecycle Platform. READ FIRST.**
- [decisions](decisions.md) — decision set + pivot re-audit verdicts (nothing "locked").
- [clients](clients.md) — **one platform, three clients** (desktop depth / browser reach / mobile accessibility) + context-provider registry (Learning Agent consumes context, not screenshots) + voice command center.
- [architecture](architecture.md) — planes, pipeline, registries, local↔gate↔cloud two-plane agents.
- [ontology](ontology.md) — **canonical primitive taxonomy (2026-07-07, ADR-028)**: actors Human/Agent/Automation · capabilities Skill/Integration · work Request/Action/Incident/Artifact · surface Workspace/Element/ElementType/View · context Memory/Knowledge. Mappings: Intent=raw Human Request, Chief of Staff=Agent archetype, Project=ElementType, Signal=derived Incident, code `ritual`/"Workflow"=Automation, code `tool`=implementation surface (user-facing primitive=Workspace), Connection=Integration. Promotion NEVER mutates category.
- [initiatives](initiatives.md) — thin-slice Taskade call: views-over-one-tree; reject CRDT/universal-entity.
- [rituals](rituals.md) — engine call: planner/executor split (swarm plans, DAG runs); broker/levels/snapshots/versioning; 3 reconciles.
- [tools](tools.md) — tool model: internalize external repos · two run modes (standalone/shared-link + account-bound) · gated intake; reuses pipeline/contracts/versions.
- [packages](packages.md) — capability package format: manifest bundles multiple capability_manifests · install = governed proposal + computed risk over dependency closure + lethal-trifecta escalation · Zapier single-live-version + fork-from-history rollback · DealPilot/Helpdesk/Recon sketches.
- [calendar](calendar.md) — Calendar Tool = time-axis projection over graph; adopt react-big-calendar (MIT) + ical.js; never embed a calendar product/server.
- [helpdesk](helpdesk.md) — AI-mediated assistance: capability routing over the graph → governed proposals; in-Bridge MVP; new Help Request entity.
- [schema](schema.md) — data model, two-tier, governance tables.
- [roadmap](roadmap.md) — phases 0–6.
- [stack](stack.md) — tech, libs, model provider.
- [oss](oss.md) — open-source picks, build-not-buy, licenses.
- [competitive](competitive.md) — rivals, easy-adds, avoid, moat.
- [design](design.md) — prototype alignment audit + fix spec.
- [design-system](design-system.md) — brand/type/color tokens + violations.
- [resilience](resilience.md) — failure-class field guide → Bridge fixes (ritual executor = authoritative actor).
- [BUGS](../BUGS.md) — live bug/gap/abnormality ledger across sessions. Agents log here unprompted.
- [testing](testing.md) — real coverage numbers (no CI/vitest), priority test list tied to known P0 bugs.

## Decisions + rationale
Locked one-liners → [decisions](decisions.md). Full why + alternatives rejected (ADR) → [../raw/decisions-log.md](../raw/decisions-log.md).

## Depth
Full insight: [../raw/](../raw/). Each wiki page links its raw source.

## Protocol
Wiki = caveman, key takeaways. Raw = full depth. Wiki page >1000 lines → compact + summarize. New/changed raw → update matching wiki + append [../log.md](../log.md).
