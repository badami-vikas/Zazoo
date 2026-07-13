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
- [relationships](relationships.md) — installable Relationship workspace over shared People/Communities/Memory/Touchpoints: current-state audit, full IA/design, consentful introductions, Agents/Skills/Automations, delivery plan.
- [optimizations](optimizations.md) — runtime token/cost Optimization package · Hermes memory gap/target · account-constrained isolated-computer policy · strengthened DealPilot plan.
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
- [calendar-plan](../raw/calendar-module-plan-2026-07.md) — **2026-07-12, strengthened same day** (per-slice exit criteria + metrics + risk register; CAL4 hard-blocked on SEC-5/6): Calendar module plan (CAL0–CAL6, three-lens) — time-axis projection over the graph, NOT a calendar product; CAL0–CAL2 shipped (Google, governed write-back); reuse = adopt OSS for render (in-house/react-big-calendar MIT) + RFC-5545 math (ical.js MPL), build projection/sync/governance; Cal.com/Radicale/Nextcloud banned (copyleft + second source-of-truth).
- [jobpilot-plan](../raw/jobpilot-module-plan-2026-07.md) — **2026-07-12, strengthened same day** (per-slice exit criteria + metrics + risk register): JobPilot module plan (JP0–JP6, three-lens) — Bridge-governed realization of the standalone vision; auto-apply reframed to draft-then-approve (mass auto-apply = reputational/ToS wreckage per research); legitimate-source catalog centerpiece (ATS public APIs/aggregators/RSS on; scraping off-by-default); OSS leverage map (Resume-Matcher/career-ops/jobhive Apache-MIT; ApplyPilot/job-ops AGPL patterns-only).
- [egg-commons](egg-commons.md) — **2026-07-11**: Egg+Commons feature roadmap (EG0–EG5 / CM0–CM5) from code diligence of Clicky (MIT — onboarding choreography, [POINT] protocol) + Pluely (GPL reference-only; permissive crates tauri-nspanel/xcap/cidre for capture core) + New Data corpus (assistant table stakes; ~10k-skill ingest targets; trust gap = our onboarding).
- [builder-agent](builder-agent.md) — **2026-07-11, strengthened 07-12**: Capability Builder roadmap (BA0–BA6, now per-slice exit criteria + metrics + risk register): no builder IDE, drafts-only via Approvals; patterns from bolt.diy/Dyad/Budibase/Appsmith/ToolJet (streamed action contract, chat-turn≡commit, two-tier model economy, DB-truth/git-projection diffs, stable node IDs); their shared gaps = pre-apply-approval moat.
- [governance-agent](governance-agent.md) — **2026-07-12**: Governance Agent roadmap (GA0–GA6). Paradox: trust-model mechanisms BUILT (ADR-012) but agent identity = prompt-only stub, trustGrants hardcoded `[]`, budgets in-memory, no decider identity. Invariant: **kernel decides, agent explains** (LLM never computes risk/decides). GA3 = MINOR auto-approve carve-out (dual-keyed, budgeted, ledgered); GA5 provenance gate must land before Commons opens.
- [learning-agent](learning-agent.md) — **2026-07-12**: Learning Agent roadmap (LA0–LA6). Nearly all greenfield: Memory primitive absent, Mem0 adapter unbuilt, PromptAssembler unbuilt, research lane "policy decided no mechanism"; platform's biggest injection surface (audit HIGH). Taint tiers + injection suite from LA0, not retrofitted; suggested-then-accepted memories; SSRF client before crawlers; graph stays source of truth.
- [oss-code-diligence](../raw/oss-code-diligence-2026-07.md) — **2026-07-13, ADR-053**: source-level verification of the roadmap reuse maps. No vapor; firecrawl → port-safeFetch-pattern (AGPL engine demoted); cal.diy MIT verified; RBC lanes = full-instance-behind-port; career-ops 54 providers (rubric/batch = prompts, not code); mem0 traps (telemetry default-ON→PostHog, cloud defaults). Builder-stack section pending.
- [brain](brain.md) — **2026-07-09, ADR-035**: Brain/Engine = 6 engines over existing seams (Compression Cascade · Sync Scheduler+Comms-Graph · Routing Policy · MCP host+discovery · memory consolidator+PromptAssembler+Domain Profiler/Buddy · Automation Miner); fills gaps #6/#7; 5-phase plan onto P0–P3. Execution plan → [../raw/brain-engine-execution-plan-2026-07.md](../raw/brain-engine-execution-plan-2026-07.md).
- [BUGS](../BUGS.md) — live bug/gap/abnormality ledger across sessions. Agents log here unprompted.
- [testing](testing.md) — real coverage numbers (no CI/vitest), priority test list tied to known P0 bugs.
- **Specs (2026-07-09)** — [spec-control-panel-icon](../raw/spec-control-panel-icon.md) · [spec-workspace-naming](../raw/spec-workspace-naming.md) · [spec-avatar](../raw/spec-avatar.md) · [spec-dream-cycle](../raw/spec-dream-cycle.md) · [spec-virtual-office](../raw/spec-virtual-office.md) · [spec-fork-metaphor](../raw/spec-fork-metaphor.md) · [spec-cos-board-meeting](../raw/spec-cos-board-meeting.md).

## Decisions + rationale
Locked one-liners → [decisions](decisions.md). Full why + alternatives rejected (ADR) → [../raw/decisions-log.md](../raw/decisions-log.md).

## Depth
Full insight: [../raw/](../raw/). Each wiki page links its raw source.

## Protocol
Wiki = caveman, key takeaways. Raw = full depth. Wiki page >1000 lines → compact + summarize. New/changed raw → update matching wiki + append [../log.md](../log.md).
