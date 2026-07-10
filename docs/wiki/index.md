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
- [commons](commons.md) — Universal Commons: local-first Module registry (services/commons, port 4780) · same contract as future Bridge Cloud · knowledge-only publish gate (422 + offending paths) · Marketplace = Commons website surface, web app consumes installed Modules only.
- [module-evolution](module-evolution.md) — **2026-07-07/08, ADR-032**: AI-led Module creation/evolution (confidence-tiered, no user forms), Component Registry + eval harness design, minimal-egg definition restated for ADR-029 nav, Day-1 bar = Groq-backed onboarding + 5-agent team shipping real-time Module proposals — see [foundational-agents](foundational-agents.md) for the corrected/fuller spec.
- [foundational-agents](foundational-agents.md) — **2026-07-08, ADR-033**: 5 permanent agents (CoS non-deletable/spirit-animal identity + Learning/Communications/Governance/Capability-Builder) + full 14-step Day-1 onboarding flow (account/OTP/spirit-animal/egg/Gmail-or-manual/Browser-Companion/LinkedIn/progressive Knowledge-Intelligence-Calendar). Corrects ADR-032: Groq not Grok (GroqProvider already built), no separate onboarding agent (CoS runs it). Docs only — build deferred.
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
- [security](security.md) — **2026-07-08 audit**: no CRITICAL; 4 HIGH (auth-by-default, dep CVEs, Tauri csp:null, no rate-limit) + prompt-injection verdict (MODERATE-HIGH social-eng, LOW exfil — root gap = no runtime taint) + defense plan. Bug rows in [BUGS](../BUGS.md).
- [agent-eval](agent-eval.md) — **"what better means"** (2026-07-08): Agent Quality Vector (7 axes from existing ledger/snapshots) · two-gate promotion · eval-harness data model · thresholds as policy_params · build #1 = scoring reducer (ship first).
- [undefined-elements](undefined-elements.md) — **2026-07-08**: ~21 gaps found, top-13 defined w/ competitor grounding (eval harness · Component Registry · Memory · Variance Adjuster · Blueprint · …).
- [cross-platform](cross-platform.md) — **2026-07-08**: only macOS exercised; Tauri won't compile off-mac (Apple crates unconditional); mobile stranded on a side branch; CI is JS-only. P0-P3 plan to reach 5-platform coverage.
- [config-alignment](config-alignment.md) — **2026-07-08**: harness elements fighting the vision (stale AGENTS.md [fixed] · Supabase write-MCP on prod PII · superpowers mandate · CRM/egress connectors · ambient telemetry · other-project skill noise).
- **6-month roadmap (2026 H2)** → [../raw/roadmap-6month-2026-h2.md](../raw/roadmap-6month-2026-h2.md): month-by-month sequencing of security → measurement → prompt-injection+Memory → self-improve loop → cross-platform+5-agents → packages/Commons. Per-pointer adaptive execution prompts → [../raw/roadmap-execution-prompts-2026-h2.md](../raw/roadmap-execution-prompts-2026-h2.md).
- [desktop-companion](desktop-companion.md) — **2026-07-08**: floating screen-annotating avatar; AX-first annotation via a 3rd click-through Tauri window; 5 model tiers (local-small→frontier); day-1 vs future capabilities; P0-P6 roadmap.
- [day1-integrations](day1-integrations.md) — **2026-07-08**: $0-spend launch catalog (SEC EDGAR/GLEIF/Companies House trio, Google built) + a CC0-spec→OpenAPI-Generator→governed-connector FACTORY + licensing honesty flags (Nango EL2.0, OpenCorporates ODbL, avoid OpenSanctions/Firecrawl) + day-1 robustness recs.
- [oss-commons](oss-commons.md) — **2026-07-08**: ingest OSS skills (15 repos, repo-license≠artifact-license) / agents (500-AI-Agents pattern, reject autonomous-exec) / commercial modules (reject GPL/AGPL) into Commons on ONE governed spine; supply-chain signing/provenance FIRST.
- **Token-efficient dev** → [../raw/token-efficient-development-2026-07.md](../raw/token-efficient-development-2026-07.md): **Month-1 DONE 2026-07-09** — nav map [../INDEX.md](../INDEX.md) · flow diagrams+ER [../CODEMAPS/flows.md](../CODEMAPS/flows.md) · token rules in CLAUDE.md · 111 skills scoped off via `skillOverrides`. M2/M3 pending (symbol index, docs:codemaps script, manifest cheat-sheet). Skills CSV → [../skills-diluting-project.csv](../skills-diluting-project.csv).
- **WORK TRACKER** → [../PROGRESS.md](../PROGRESS.md): current batch + next 3 batches + done-protocol + registry of every plan doc. One place. Check first.
- [BUGS](../BUGS.md) — live bug/gap/abnormality ledger across sessions. Agents log here unprompted.
- [testing](testing.md) — real coverage numbers (no CI/vitest), priority test list tied to known P0 bugs.

## Decisions + rationale
Locked one-liners → [decisions](decisions.md). Full why + alternatives rejected (ADR) → [../raw/decisions-log.md](../raw/decisions-log.md).

## Depth
Full insight: [../raw/](../raw/). Each wiki page links its raw source.

## Protocol
Wiki = caveman, key takeaways. Raw = full depth. Wiki page >1000 lines → compact + summarize. New/changed raw → update matching wiki + append [../log.md](../log.md).
