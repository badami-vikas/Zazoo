---
title: Session Outputs — Optimizations, DealPilot, Memory, Isolated Computer, and Relationships
date: 2026-07-11
status: complete
---

# Scope

This file records the substantive user-facing outputs from the 2026-07-11 planning session. It is a
durable handoff, not hidden reasoning or raw tool output.

# 1. Optimizations, memory, isolated computer, and DealPilot

Delivered conclusion:

- Bridge already had strong developer-side token discipline: wiki→raw→code reading, caveman wiki,
  CODEMAPS, navigation index, skill scoping, and a <4k orientation target.
- Bridge did not yet have an OpenHuman-style runtime Optimization package.
- Proposed Optimizations sequence: O0 observability; O1 lossless compression; O2 retrieval-first
  context; O3 semantic compression; O4 adaptive per-capability optimization.
- Each optimized run should show original/optimized tokens, cost/latency savings, transformations,
  evidence risk, source preservation, and lossless rerun.
- Bridge Memory target is stronger than pi-hermes-memory on governance/provenance/planes, but Hermes
  is operationally ahead because retrieval, search, correction/failure capture, consolidation,
  secret scanning, aging, and lifecycle flushes exist.
- Account restrictions should compile to CredentialBroker policy. Execution ladder: governed host →
  isolated browser profile → container/microVM → full VM.
- High-ROI VM use: account proof, untrusted code/files/sites, destructive builds, cross-app desktop
  work, reproducible environments, long jobs, tenant isolation, and human-observable execution.
- Roadmap mapping proposed: policy/account constraints P0; sandbox adapter P3; visible Isolated
  Computer package P4; remote tenant pools P6.

Artifacts:

- `docs/raw/optimizations-memory-vm-dealpilot-plan-2026-07.md`
- `docs/wiki/optimizations.md`
- AP-007 in `docs/APPROVALS.md`

# 2. SmallPE correction and DealPilot expansion

Delivered correction:

- Initial SmallPE inspection failure was a web cache/internal retrieval failure, not inaccessible
  code. Direct clone inspection succeeded at commit `3b11c970d3a3c50fe11e267bd96c1bcdb36db705`.
- SmallPE contains Managing Partner plus Oracle, Helios, Athena, Prometheus, Themis, Logos, Hermes,
  and Iris; MRL/evidence/thesis/impact workflows; Excel/PDF conversion; Pandoc/Slidev output tools;
  and deal-memory conventions.
- SmallPE current FSL-1.1-Apache-2.0-Future terms block competing commercial vendoring today.
  Valid paths: partnership/permission, applicable future-license conversion, interoperability, or
  independently specified functional alternatives.

DealPilot delivered design:

- One global DealPilot entry, module rail, then Deal/Thesis object tabs.
- Module rail: Overview, Deals, Sourcing, Theses, Work, Reports, Relationships, Playbooks.
- Deal workspace: Summary, Profile, Listings, Documents, Hypotheses, Evidence, Diligence,
  Financials, Valuation & Returns, Risks, IC, Relationships, Execution, Activity.
- CIM = versioned Document/Artifact; QoE = structured Analysis/Artifact; Hypothesis Tree = versioned
  Artifact plus linked hypotheses/evidence; IC Memo = cited snapshot.
- Technical catalog: 9 optional Agent archetypes, 28 Skills, 20 Automations, integration/tool map.
- Business coverage: thesis through sourcing, diligence, underwriting, IC, transaction execution,
  100-day handoff, and learning.
- Explicit exclusions: autonomous investment/IC vote, professional opinions, fund administration,
  custody/payments, autonomous send, ToS bypass, and portfolio ERP.

Artifacts:

- `docs/raw/dealpilot-module-plan-2026-07.md`
- `docs/raw/dealpilot-design-requirements-2026-07.md`
- `docs/wiki/packages.md`

# 3. License-limited capability research

Delivered policy:

- Reuse intake comes before custom build.
- If reuse is permitted: import, wrap, adapt, or integrate.
- If constrained: exhaustive lawful functional research, exact version/license record, complete
  Agent/Skill/Automation/UI/data/workflow inventory, black-box benchmark, independent requirements,
  provenance, and researcher/implementer separation when warranted.
- Prohibited: copying/light paraphrase, disguised translation, restricted datasets, access-control
  bypass, treating public GitHub as permission, or claiming clean-room work without separation.
- Compare Bridge alternative as equivalent, better, worse, intentionally different, or not
  comparable across quality, evidence, control, cost, security, accessibility and maintainability.

Artifacts:

- `docs/raw/clean-room-capability-research-protocol-2026-07.md`
- AP-008 in `docs/APPROVALS.md` (still proposed unless separately approved)

# 4. Relationships module

Delivered current-state audit:

- Implemented: local/private plane, gate, People/Communities/canonical/member/edge/touchpoint/timeline
  tables, list endpoints, Gmail/Calendar intake, capture tools, KnowledgeBase shell, approvals,
  Signals, Calendar, Agent panel.
- Partial: People/Communities UI says not wired although endpoints exist; shallow list-only APIs;
  static-export association map; inconsistent derived indicators; incomplete identity/intake UX;
  no complete Person/Community workspace; Memory lifecycle incomplete.
- Catalog concepts such as Reconnect, Community Pulse, Memory Search, Milestones and Intro Round are
  not implementation proof without trigger/store/API/eval/browser evidence.

Delivered product design:

- Relationships is an installable Workspace projection, not CRM or second graph.
- Module rail: Today, People, Communities, Map, Touchpoints, Introductions, Signals, Workflows,
  Sources.
- Person tabs: Overview, Timeline, Context, Connections, Communities, Projects, Introductions,
  Commitments, Files, Permissions, Activity.
- Community tabs: Overview, Members, Map, Touchpoints, Projects, Signals, Gatherings, Resources,
  Permissions, Activity.
- Relationship = typed governed graph edge plus evidence-backed projection.
- Introductions use mutual-value check, consent A, consent B, approved send, follow-up and outcome.
- Derived warmth/recency/reciprocity/dormancy must expose inputs/version/time/confidence and never
  imply moral worth or objective trust.
- Technical catalog: 7 optional Agent archetypes, 30 Skills, 20 Automations.
- RM0–RM6: wire current UI; Person/Community workspace; timeline/intake/identity; Memory/commitments;
  graph/map; introductions/Signals; team/cross-module evolution.

Artifacts:

- `docs/raw/relationship-module-plan-2026-07.md`
- `docs/raw/relationship-design-requirements-2026-07.md`
- `docs/wiki/relationships.md`

# 5. Source references used

- OpenHuman: https://github.com/tinyhumansai/openhuman
- pi-hermes-memory: https://pi.dev/packages/pi-hermes-memory
- Open Computer: https://github.com/Mintplex-Labs/anything-llm/tree/master/open-computer
- SmallPE: https://github.com/parolkar/SmallPE
- SmallPE workflow: https://smallpe.com/docs/#workflow
- PE diligence skill: https://github.com/noahnan-max/private-equity-investment-dd-skill
- Financial services plugins: https://github.com/yuping322/financial-services-plugins-new
- Deal evaluator: https://github.com/sradgowski/deal-evaluator
- PE fund-selection ML: https://github.com/xrishiraj/Private-Equity-Fund-Selection-through-ML
- Dex: https://getdex.com/
- Affinity: https://www.affinity.co/product/relationship-intelligence
- Monica: https://www.monicahq.com/features
- US Copyright Office software guidance: https://www.copyright.gov/register/tx-programs.html
- US Copyright overview: https://www.copyright.gov/what-is-copyright/

# 6. Repository outcome

The session created detailed planning/design documents, updated wiki navigation and plan registry,
recorded decisions/proposals, and added the standing output-record convention. Runtime product code
was not changed in this session.
