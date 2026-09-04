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
- **Token-efficient dev** → [../raw/token-efficient-development-2026-07.md](../raw/token-efficient-development-2026-07.md): codemaps/diagrams/nav-index to add + token best practices + roadmap. Skills diluting the project (CSV) → [../skills-diluting-project.csv](../skills-diluting-project.csv).
- [BUGS](../BUGS.md) — live bug/gap/abnormality ledger across sessions. Agents log here unprompted.
- [testing](testing.md) — real coverage numbers (no CI/vitest), priority test list tied to known P0 bugs.
- [entity-disambiguation](entity-disambiguation.md) — Recon OSINT name-collision handling: entity IDs, auto-assignment heuristics, analyst override, crowd-merge threshold. Source lives in Tools/recon, not docs/raw.
- [brd](brd.md) — **2026-07-09**: Business Requirements Doc — product/users/problem/scope-by-phase/non-goals/success-criteria/risks; pricing+GTM flagged UNOWNED (prior invented pricing removed).

## Decisions + rationale
Locked one-liners → [decisions](decisions.md). Full why + alternatives rejected (ADR) → [../raw/decisions-log.md](../raw/decisions-log.md).

## Nav files (2026-07-09)
- [INDEX](index.md) — this file, map o' wiki.
- [CHANGELOG](CHANGELOG.md) — pointer to [../log.md](../log.md), da real trail, dated, append-only.
- [QUESTIONS](QUESTIONS.md) — open thread pile, future page seed not grown yet.
- [../raw/_INGESTED.md](../raw/_INGESTED.md) — source registry: every raw doc, promoted/orphan/historical status.

## Default behaviour (caveman triggers)
Say word, get act. No essay, no ask-permission-first unless act touch code or delete thing.
- **"compile"** → walk raw/_INGESTED.md orphan list. Any orphan cited 2+ place now (wiki OR asked
  twice this session)? Promote it — new wiki page, full: line, add to Pages list here, log it. Skip
  requirement-kind docs (verbatim, never promote per CLAUDE.md).
- **"ask a question"** (or any genuinely open/unresolved thing found mid-work) → add row to
  [QUESTIONS](QUESTIONS.md), don't stop work to resolve unless it blocks current task.
- **"health check"** → re-run: (1) every wiki page has full:/source line or is flagged meta-exempt,
  (2) every raw doc has a row in [_INGESTED.md](../raw/_INGESTED.md), (3) index.md Pages list matches
  actual files in docs/wiki/ 1:1, (4) no wiki page cites a raw file that doesn't exist. Report drift,
  fix small stuff (missing line, missing index entry) inline, flag big stuff (orphan pile grown,
  contradiction found) to QUESTIONS.md.

## Plans + progress
Present/past/future plan docs indexed once, not scattered: [../plan/INDEX.md](../plan/INDEX.md).
Only the ACTIVE plan is tracked live → [../plan/PROGRESS.md](../plan/PROGRESS.md) (so "in progress"
never gets confused with "planned" or "done").

## Non-permanent outputs
Answers/analysis that don't change code or add durable knowledge (status checks, gap audits,
one-off Q&A) → [../output/](../output/), not the wiki. Promoted to wiki ONLY if it adds genuinely
new synthesized knowledge AND gets asked first (see Article standard below).

## Depth
Full insight: [../raw/](../raw/). Each wiki page links its raw source.

## Protocol
Wiki = caveman-dense telegraphic shorthand (established house style, not literal caveman grammar —
see any existing page for the pattern), key takeaways only. Raw = full depth. Wiki page >1000 lines →
compact + summarize.

**Article standard** (every wiki page should carry, retrofitted opportunistically on next touch, not
a batch rewrite): confidence flag per non-obvious claim (**established** = shipped+tested,
**emerging** = designed/decided not built, **speculative** = proposed/unconfirmed) · a `full:` line
pointing at the raw source(s) · related-pages links · nothing stated without a raw citation or an
explicit `[SPECULATIVE]` flag.

**Source provenance rule** (non-negotiable): every factual claim in a wiki page either traces to a
raw file (via the page's `full:` line or an inline link) or is marked speculative inline. No
uncited claims.

**Promotion pattern** (confirmed by auditing existing wiki, 2026-07-09): a raw doc earns a wiki page
when it's referenced repeatedly across OTHER wiki pages' `related`/companion links — e.g.
decisions-log.md, roadmap docs, capability-package-format.md, oss-commons-integration-plan all hit
this bar and are already promoted ([decisions](decisions.md), [roadmap](roadmap.md),
[packages](packages.md), [oss-commons](oss-commons.md)). Apply the same bar going forward: a raw doc
that gets cross-referenced from 2+ other wiki pages, or gets asked about again in a session, is a
promotion candidate — log it in [QUESTIONS](QUESTIONS.md) first, promote after confirming.

New/changed raw → update matching wiki + append [../log.md](../log.md).
