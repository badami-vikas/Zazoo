# Bridge Wiki — Index

Bridge = **Living Software** — governed Engine/runtime adapts installed Modules around user work across web, desktop, and mobile. DealPilot and Relationship are Modules, not separate products or kernel primitives.

## How to read
Agents read wiki by default. Hit `../raw/` only when wiki thin / strong need. Start here → [decisions](decisions.md).

**AP-020 vocabulary rule:** [glossary](../glossary.md) wins over older wiki/raw prose. Older files remain historical/migration evidence and may contain code names being removed by VOCAB0–VOCAB5.

## Pages
- [vision](vision.md) — **2026-07-06 PIVOT: Living Software / Capability Lifecycle Platform. READ FIRST.**
- [decisions](decisions.md) — decision set + pivot re-audit verdicts (nothing "locked").
- [clients](clients.md) — **one platform, three clients** (desktop depth / browser reach / mobile accessibility) + context-provider registry (Learning Agent consumes context, not screenshots) + voice command center.
- [architecture](architecture.md) — planes, pipeline, registries, local↔gate↔cloud two-plane agents.
- [ontology](ontology.md) + [glossary](../glossary.md) — canonical vocabulary: Organization/Module/Page/View/Database/Record/Relation/File · Request→Plan→Decision→Run→Action→Event→Result · Human/Agent/Automation · Skill/Integration/Engine · Avatar/Onboarding · Local/Cloud Planes. Code names migrate too; no display-only aliases.
- [engine](engine.md) — runtime machinery; Agent-owned Skills; Automation→Agent Run boundary.
- [relationships](relationships.md) — Relationship Module: Signals/People/Communities toggles; Signal = surfaced participant-linked Event; Agent-owned Skills; Second Brain consumer.
- [dealpilot](dealpilot.md) — BRD summary: Deal/Source/Thesis graph, evidence, diligence, Agent-owned Skills, DP0–DP6.
- [jobpilot](jobpilot.md) — BRD summary: truthful governed applications, Agent-owned Skills, JP0–JP6.
- [optimizations](optimizations.md) — runtime token/cost Optimization Module · Memory targets · account-constrained isolated-computer policy · strengthened DealPilot plan.
- [commons](commons.md) — Universal Commons: signed generalized Module/capability registry; privacy gate rejects personal Memory; separate from Bridge Cloud.
- [module-evolution](module-evolution.md) — AI-led governed Module creation/evolution, Component Registry, evaluations, and proposal loop; current Avatar/Onboarding canon wins over historical language inside.
- [foundational-agents](foundational-agents.md) — historical agent/onboarding design; current canon = 4 Agents (CoS, Learning, Governance, Capability Builder), Communications Skill, one Onboarding flow, one Avatar. VOCAB1 removes old code/payload names.
- [calendar](calendar.md) — Calendar Module = time-axis projection over Events and Records; provider implementations stay behind ports. **SUPERSEDED IN PART 2026-07-17 (ADR-108, TASK-014)**: "pinnable Tool + global-nav item" framing is target-corrected — Calendar becomes purely a View kind (`docs/raw/brd-dataengine-views-2026-07.md`), no Module/route/nav identity; Google Calendar is a plain Integration. This page not yet rewritten — TASK-014 executes the correction.
- [helpdesk](helpdesk.md) — Relationship sub-module: capability routing over graph → governed Help Request Records.
- [taskmanager](taskmanager.md) — **DONE 2026-07-21 (TASK-021, AP-066)**: one recursive Task Database, governed tree surgery, agent-first projection, guards/routing/Playbooks, signed installable Module; Corporate PR #104 two-instance external PASS.
- [schema](schema.md) — data model, two-tier, governance tables.
- [roadmap](roadmap.md) — phases 0–6.
- [stack](stack.md) — tech, libs, model provider.
- [oss](oss.md) — open-source picks, build-not-buy, licenses.
- [competitive](competitive.md) — rivals, easy-adds, avoid, moat.
- [ui-architecture](ui-architecture.md) — data-shape→surface rules, Form, shared menus, Control Panel→3-dots, Files Section, `~/Documents/Bridge/<Organization>/`; UI-RULES-1 first runtime task. Full View Grammar (8 kinds, eligibility rules, feature list per kind) → [../raw/brd-dataengine-views-2026-07.md](../raw/brd-dataengine-views-2026-07.md) — **2026-07-17, TASK-014 scope**. **Graph view gains scope selector (single-DB/multi-DB/full); Second Brain = Graph at full scope, not a separate surface (ADR-110, 2026-07-17).**
- [design](design.md) — prototype alignment audit + fix spec.
- [design-system](design-system.md) — brand/type/color tokens + violations.
- [resilience](resilience.md) — failure-class field guide → Engine/Governance/Learning/Builder/Human ownership.

Historical wiki pages whose filenames preserve retired identifiers are migration evidence only; [glossary](../glossary.md) and [VOCAB0–VOCAB6](../raw/vocabulary-code-migration-plan-2026-07-14.md) govern implementation.
- **TASK-013 cleanup (2026-07-21)** — one `platform/` production tree; legacy source private-archived, not history-scrubbed. Built-ins come from `platform/modules/manifests`; prototype fixture pages gone. Historical consolidation trio now lives under `docs/raw/`.
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
- **ACTIVE TASKS** → [../TASKS.md](../TASKS.md): one reconciled queue; each task carries scope, evidence, requests, approval, status, dependencies, and prototype test. Check first. [../PROGRESS.md](../PROGRESS.md) is a pointer/rules page; detailed history lives in [../raw/progress-archive-2026-07.md](../raw/progress-archive-2026-07.md).
- [calendar-plan](../raw/calendar-module-plan-2026-07.md) — **2026-07-12, strengthened same day** (per-slice exit criteria + metrics + risk register; CAL4 hard-blocked on SEC-5/6): Calendar module plan (CAL0–CAL6, three-lens) — time-axis projection over the graph, NOT a calendar product; CAL0–CAL2 shipped (Google, governed write-back); reuse = adopt OSS for render (in-house/react-big-calendar MIT) + RFC-5545 math (ical.js MPL), build projection/sync/governance; Cal.com/Radicale/Nextcloud banned (copyleft + second source-of-truth).
- [jobpilot-plan](../raw/jobpilot-module-plan-2026-07.md) — **2026-07-12, strengthened same day** (per-slice exit criteria + metrics + risk register): JobPilot module plan (JP0–JP6, three-lens) — Bridge-governed realization of the standalone vision; auto-apply reframed to draft-then-approve (mass auto-apply = reputational/ToS wreckage per research); legitimate-source catalog centerpiece (ATS public APIs/aggregators/RSS on; scraping off-by-default); OSS leverage map (Resume-Matcher/career-ops/jobhive Apache-MIT; ApplyPilot/job-ops AGPL patterns-only).
- [avatar-commons](avatar-commons.md) — minimal Avatar shell + Onboarding + Commons roadmap. Avatar ≠ Local Plane; Commons ≠ Cloud Plane. Legacy EG ids/file names migrate with code under VOCAB1.
- [builder-agent](builder-agent.md) — **2026-07-11, strengthened 07-12**: Capability Builder roadmap (BA0–BA6, now per-slice exit criteria + metrics + risk register): no builder IDE, drafts-only via Approvals; patterns from bolt.diy/Dyad/Budibase/Appsmith/ToolJet (streamed action contract, chat-turn≡commit, two-tier model economy, DB-truth/git-projection diffs, stable node IDs); their shared gaps = pre-apply-approval moat.
- [governance-agent](governance-agent.md) — **2026-07-12**: Governance Agent roadmap (GA0–GA6). Paradox: trust-model mechanisms BUILT (ADR-012) but agent identity = prompt-only stub, trustGrants hardcoded `[]`, budgets in-memory, no decider identity. Invariant: **kernel decides, agent explains** (LLM never computes risk/decides). GA3 = MINOR auto-approve carve-out (dual-keyed, budgeted, ledgered); GA5 provenance gate must land before Commons opens.
- [learning-agent](learning-agent.md) — **2026-07-12**: Learning Agent roadmap (LA0–LA6). Nearly all greenfield: Memory primitive absent, Mem0 adapter unbuilt, PromptAssembler unbuilt, research lane "policy decided no mechanism"; platform's biggest injection surface (audit HIGH). Taint tiers + injection suite from LA0, not retrofitted; suggested-then-accepted memories; SSRF client before crawlers; graph stays source of truth.
- [oss-code-diligence](../raw/oss-code-diligence-2026-07.md) — **2026-07-13, ADR-055 (renumbered on merge)**: source-level verification of the roadmap reuse maps. No vapor; firecrawl → port-safeFetch-pattern (AGPL engine demoted); cal.diy MIT verified; RBC lanes = full-instance-behind-port; career-ops 54 providers (rubric/batch = prompts, not code); mem0 traps (telemetry default-ON→PostHog, cloud defaults); Builder stack: appsmith serialization CONFIRMED Apache+adaptable (drop SHARE branch), dyad package.json "MIT" mislabel + Apache-imports-FSL seam trap, bolt.diy parser WebContainer-free/portable (runner is not).
- [engines](engine.md) — reusable internal runtime machinery: compression · sync · routing · MCP capability · memory/retrieval · Automation mining. Distinct from Skills and Automations. Runtime taint RT0–RT4 gates high-autonomy use.
- [BUGS](../BUGS.md) — live bug/gap/abnormality ledger across sessions. Agents log here unprompted.
- [testing](testing.md) — real coverage numbers (no CI/vitest), priority test list tied to known P0 bugs.
- **Specs (2026-07-09)** — [spec-control-panel-icon](../raw/spec-control-panel-icon.md) · [spec-workspace-naming](../raw/spec-workspace-naming.md) · [spec-avatar](../raw/spec-avatar.md) · [spec-dream-cycle](../raw/spec-dream-cycle.md) · [spec-virtual-office](../raw/spec-virtual-office.md) · [spec-fork-metaphor](../raw/spec-fork-metaphor.md) · [spec-cos-board-meeting](../raw/spec-cos-board-meeting.md).

## Decisions + rationale
Locked one-liners → [decisions](decisions.md). Full why + alternatives rejected (ADR) → [../raw/decisions-log.md](../raw/decisions-log.md).

## Depth
Full insight: [../raw/](../raw/). Each wiki page links its raw source.

## Protocol
Wiki = caveman, key takeaways. Raw = full depth. Wiki page >1000 lines → compact + summarize. New/changed raw → update matching wiki + append [../log.md](../log.md).
