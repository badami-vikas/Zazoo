---
title: JobPilot Detailed Module Plan — Design, Business, and Technical
type: raw
doc_kind: plan
status: proposed
companions: [jobpilot-vision-requirement.md, jobpilot-architecture-requirement.md, tool-standardization-plan.md, dealpilot-module-plan-2026-07.md, clean-room-capability-research-protocol-2026-07.md, day1-integrations-free-apis.md]
related_wiki: ../wiki/tools.md
updated: 2026-07-12
tags: [jobpilot, module, design, business-process, agents, skills, automations, reuse, sourcing]
---

# 0. Product decision

JobPilot is one installable capability package and one primary global-nav item (route `/jobpilot`, nav group "Work"). It is the Bridge-compiled realization of the user's standalone vision (`jobpilot-vision-requirement.md`: *"Swipe green, get applied. Everything else is agents."*), re-based onto shared kernel capabilities per the tool-standardization compose contract — JobPilot COMPOSES `company-sourcing`/`people-sourcing`/`facts`/`dedupe`/`tables`, it never re-implements them.

One reframe is load-bearing and separates the Bridge package from the standalone spec: **the standalone vision's fully-unattended auto-apply waterfall (T1 direct POST → T2 Playwright → T3 browser agent, "human decides once") becomes draft-then-approve under Bridge governance.** External application submission is an External-band capability — always human-approved at launch (Capability Trust Model). JobPilot removes the *tedium* of a job search (sourcing, scoring, tailoring, form-mapping, tracking, follow-up), not the *decision to apply*. The commercial research is unambiguous that this is also the correct product bet: mass auto-apply tools (LazyApply, AIApply, Massive, Sonara) carry 2.3/5 reputations, LinkedIn-ToS bans, and drove the 2025 "11,000 applications/minute" arms race in which 34% of recruiters now spend half their week filtering AI spam (Greenhouse 2025). JobPilot wins by being the evidence-first, ToS-respecting alternative, not another firehose.

```yaml
navigation_layers:
  global_sidebar:
    item: JobPilot
    purpose: enter package
  module_navigation:
    form: persistent secondary rail on desktop; drawer/segmented selector on mobile
    items: [Overview, Cards, Pipeline, Materials, Sources, Answers, Interviews, Playbooks]
  object_navigation:
    form: tabs within a selected Application (Job); collapses to More menu on narrow screens
    purpose: keep JD, fit flags, tailored materials, application record, communications, and interview prep attached to the one Application they explain
```

Vocabulary (built-in manifest): `Initiative → Application`, `Person → Hiring Manager`. Domain vocab is allowed in workspace scope; the user's own naming always wins.

# 1. Design lens — exact information architecture

## 1.1 Overview

Purpose: candidate's operating view, not a generic dashboard.

Sections: decision queue (new green-worthy cards, materials awaiting approval, applications awaiting submit-approval, responses needing action); pipeline by stage and category; sourcing health (source yield, freshness, dedupe rate, ToS-tier mix, quota/pacing state); materials health (tailored-vs-approved counts, truthfulness-gate pass rate); upcoming interviews and follow-up deadlines; recent changes (new postings, response detected, stage advanced); Agent activity + optimization receipts; configurable saved views, never fabricated KPIs (no invented "match %").

## 1.2 Cards — the green/red flag feed

The product's identity. Each card = one scored `JobProfile` (a projection off `facts.livingProfile`, deduped). Local-LLM fit scoring produces green flags (why apply) and red flags (concerns) over the deterministic rule score. **The flag IS the action** (already built in `JobPilotPage.tsx`): green → queue for tailoring; yellow → review; red → dismiss (feeds the flag-feedback loop). Scores shown as flags with reasons, never as a false-precision percentage.

Card contents: company/title/location/comp-if-known, source + freshness, green/red flag chips with one-line reasons, category match, dedupe/already-applied badge, quick actions (green/dismiss/open JD). Saved views/toggles: Feed · Flagged · Tailoring · Approved · Applied · Responses · Interviews · Archived; by category, source tier, remote/onsite, seniority, comp band, flag severity; "changed since last review", "missing JD detail", "needs human decision".

## 1.3 Application detail — complete object workspace

Header always visible: company, title, stage, flag state, category fit, source, next action, materials-approval state, next deadline.

```yaml
application_tabs:
  Summary:
    - decision-first brief: why it fits / why it may not
    - key facts (comp, location, remote, seniority, work-auth requirement)
    - green/red flags, category match, next actions, recent changes
  Job:
    - full JD (source-linked), parsed requirements, keywords
    - source + freshness + ToS tier of the listing; dedupe lineage (merged duplicate postings)
  Fit:
    - deterministic rule score breakdown + local-LLM flag rationale
    - requirement-by-requirement coverage vs master profile
    - gaps and honest stretch areas (never fabricated)
  Materials:
    - tailored resume + cover letter versions vs master profile
    - writer change_log with per-line evidence; evaluator verdict (5-dimension scorers + truthfulness gate)
    - approval state; regenerate-with-diff; rendered PDF (selectable text, ATS-safe)
  Answers:
    - screening-question answers drawn from the answer bank
    - sensitive questions (SSN/payment/EEO) flagged NeedsHuman, never auto-filled
  Application:
    - the submission record: channel/tier attempted, prefilled form map, submit-approval, timestamp, confirmation
    - failure taxonomy state (CAPTCHA/LOGIN/FAILED) and human-handoff deep link + prefilled answer sheet
  Communications:
    - Gmail-detected responses matched to this application (confidence-routed)
    - recruiter/hiring-manager relationships (Bridge Person graph), follow-up drafts
  Interview:
    - company research brief (fires on stage → Interview)
    - prep pack from real signals; scheduling via Calendar module; post-interview follow-up drafts
  Activity:
    - immutable timeline of Human/Agent/Automation actions; Memory/Skills/model+prompt versions; approvals; optimization receipts
```

## 1.4 Pipeline

Kanban tracker: Sourced → Flagged → Tailoring → Evaluating → Approved → Awaiting-Submit → Applied → Response → Interview → Offer/Rejected (mirrors the built `ApplicationStage` 12-state machine + `transition()`). Every card links to its Application context; work is never a disconnected task island. Per-day + per-ATS-domain pacing gate visible (defer, don't drop).

## 1.5 Materials

Cross-application library: master profile (compiled from the user's real corpus — `Master Profile/master.json`), resume variants per persona, cover-letter templates, tailored outputs with version + evidence + approval + which-version-was-sent. Compare versions; regenerate-from-new-JD with diff. PDF via `@react-pdf/renderer` from JSON Resume props (real selectable text).

## 1.6 Sources

Source catalog + health: Tier-1 legitimate APIs (ATS public JSON, aggregator APIs, RSS) with per-source yield/freshness/quota/ToS tier; category-driven saved searches; Tier-2 scrapers shown with explicit gray-zone labeling and off-by-default governance (see §2.2); dedupe/merge queue. No source runs without an enabled, ToS-classified connector.

## 1.7 Answers

The answer bank: work-auth, salary expectation, notice period, "why us" snippets, reusable across applications. Deterministic exact/fuzzy match first, LLM fallback, persist new answers back. Sensitive-question detector (SSN/payment) unconditionally routes to human.

## 1.8 Interviews

Fires on stage → Interview: auto company-research brief, prep pack from real signals (relationship graph + public company facts), scheduling handed to the Calendar module, post-interview follow-up drafts. Small % of pipeline, high value.

## 1.9 Playbooks

Installable/configurable capability library: category templates, per-ATS scoring profiles, resume/cover-letter prompt packs, answer-bank presets, interview-prep templates, pacing/ToS policies. Version, provenance, license, eval status, active/legacy state.

# 2. Business lens

## 2.1 Processes covered

```yaml
covered_processes:
  onboarding_and_profile:
    - ingest multiple resumes/cover letters -> structured master profile (JSON Resume)
    - job-category generation, editable anytime
  sourcing:
    - Tier-1 legitimate sourcing (ATS public JSON, aggregator APIs, RSS) via governed connectors
    - normalization, dedupe, already-applied detection, freshness + quota tracking
  scoring_and_triage:
    - deterministic rule score + local-LLM green/red flags
    - one-click flag decision; flag-feedback learning loop
  materials:
    - writer agent tailors resume + cover letter to the JD (post-green only)
    - evaluator agent: 5-dimension scorers + truthfulness gate; bounded iteration then human
    - PDF render (ATS-safe selectable text)
  application_preparation:
    - answer-bank fill; form-schema mapping for known ATS (Greenhouse/Lever/Ashby)
    - prefilled answer sheet + deep link for human submission
  submission_governed:
    - draft-then-approve submission; Tier-1 form map surfaced for one-click human confirm
    - failure taxonomy handling; pacing/ToS caps
  tracking_and_response:
    - end-to-end kanban with per-job artifact + event history
    - Gmail response detection + confidence-routed stage advance (draft-gated)
    - follow-up reminders and draft outreach
  interview_and_learning:
    - interview-prep packs, scheduling via Calendar module
    - analytics (response rate by category/variant/channel); scoring-prompt tuning from outcomes
```

## 2.2 Explicitly not covered

```yaml
not_covered_or_not_authoritative:
  - fully-unattended mass auto-apply (the LazyApply/AIApply model — reframed to draft-then-approve; External band is always human at launch)
  - bypassing website terms, authentication, paywalls, robots.txt, or anti-bot on ANY source (LinkedIn/Indeed/Glassdoor scraping is ToS-prohibited — not a load-bearing source)
  - fabricating or embellishing resume/answer content (truthfulness gate is a hard requirement; PROTECTED_FIELDS never jd_added)
  - auto-filling sensitive fields (SSN, payment, and EEO/self-ID answers) — always NeedsHuman
  - submitting applications the user has not approved; bulk-blast by default
  - covert interview assistance / stealth-from-screen-capture (Final Round AI "God Mode" — rejected as an ethics anti-pattern; both-party consent)
  - representing probabilistic fit scores as guarantees or as a true "match percentage"
  - guaranteeing outcomes (offers, TC uplifts, interview counts)
  - storing credentials in the artifact/localStorage; egress with raw keys (CredentialBroker only)
  - cross-tenant reuse of the user's profile, materials, or answers
  - salary/comp figures presented as fact without a cited, permitted source
```

# 3. Technical lens

## 3.1 Agents

Bridge keeps its 4 permanent platform agents. JobPilot specialists are package-provided archetypes, installed only when useful, routed by Chief of Staff, governed individually, no peer-to-peer autonomous handoffs.

```yaml
jobpilot_agents:
  Search_Strategist:
    job: turn profile + goals into categories, saved searches, and source-tier strategy
    inspiration: career-ops A–G rubric; category-generation prompt
  Sourcing_Analyst:
    job: run the legitimate-source waterfall, normalize, dedupe, track yield/quota/ToS tier
    inspiration: career-ops providers; JobSpy schema; jobhive ATS catalog
  Fit_Scorer:
    job: deterministic + local-LLM green/red flag scoring vs categories and master profile
    inspiration: ats-screener per-ATS profiles; Resume-Matcher keyword extraction
  Materials_Writer:
    job: tailor resume + cover letter to the JD, post-green, with per-line evidence
    inspiration: Resume-Matcher tailoring prompts; lib_resume_builder_AIHawk templates
  Materials_Evaluator:
    job: 5-dimension scorers + truthfulness gate + LLM-judge; bounded iteration
    inspiration: Resume-Matcher scorers + verify_skill_target_plan truthfulness gate
  Application_Coordinator:
    job: answer-bank fill, ATS form mapping, prefilled sheets, submit-approval routing, failure taxonomy
    inspiration: ApplyPilot 3-tier question policy + result taxonomy (pattern only; AGPL)
  Response_Router:
    job: Gmail response detection, confidence-routed stage advance, follow-up drafts
    inspiration: job-ops Smart Router (pattern only; AGPL+Commons-Clause)
  Interview_Prep:
    job: company brief + prep pack from real signals when stage -> Interview
    inspiration: relationship-graph + public company facts
```

Chief of Staff invokes each specialist and synthesizes. Human remains accountable for every flag decision, every materials approval, and every submission.

## 3.2 Skills

```yaml
skills:
  - resume-and-cover-letter-ingestion       # -> JSON Resume master profile
  - master-profile-compilation-and-dedupe
  - job-category-generation
  - legitimate-source-scan                  # ATS JSON / aggregator API / RSS, ToS-classified
  - listing-normalization-and-dedupe
  - already-applied-detection
  - deterministic-fit-scoring
  - green-red-flag-narration                # local LLM
  - flag-feedback-learning
  - resume-tailoring                         # writer, evidence-required
  - cover-letter-tailoring
  - materials-evaluation-and-truthfulness-gate
  - ats-safe-pdf-render
  - answer-bank-management
  - sensitive-question-detection
  - ats-form-schema-mapping                  # Greenhouse/Lever/Ashby
  - prefilled-handoff-sheet-generation
  - gmail-response-routing
  - follow-up-drafting
  - interview-prep-brief
  - response-analytics
```

## 3.3 Automations

```yaml
automations:
  - scheduled-source-scan-with-quota-and-tos-tier
  - source-yield-and-freshness-monitor
  - listing-normalize-dedupe-and-change-detect
  - fit-rescore-on-profile-or-category-change
  - new-green-card-triage-queue
  - materials-tailor-on-green-flag             # post-intent only; spends quality tokens only after green
  - evaluation-loop-with-iteration-cap
  - application-pacing-gate                     # per-day + per-ATS-domain caps, defer-not-drop
  - submit-approval-request                     # draft-then-approve; never unattended external send
  - application-failure-taxonomy-router
  - inbound-email-match-to-application          # confidence-routed, draft-gated
  - follow-up-reminder-and-draft
  - interview-prep-on-stage-change
  - career-ops-vendor-sync-diff                 # weekly pinned-submodule diff report
  - outcome-learning-and-eval-capture
```

Every Automation carries trigger, idempotency key, budget, retry/backoff, owner, stop condition, risk band, and immutable run record. External submission and consequential stage changes remain human-approved. The waterfall cost policy holds: never use an LLM to *find* jobs (local Ollama only to *score*); spend Claude tokens only post-green-flag.

## 3.4 Integrations/tools

- sourcing: governed connectors over legitimate endpoints only (see §4 catalog); browser fetch (Playwright) only for JS-rendered *permitted* pages, never to defeat anti-bot;
- documents: resume/CL parsing, JSON Resume contract, `@react-pdf/renderer` sidecar for ATS-safe PDF;
- communications: Gmail behind scoped read-only OAuth (the SAME google integration DealPilot's CIM-request uses); draft-only egress;
- relationships: Bridge Person/Relationship graph for recruiters/hiring managers and warm paths;
- calendar: interview scheduling handed to the Calendar module (time-axis projection), not a private scheduler;
- models: local Ollama for scoring/dedupe/extraction; Claude via ModelProvider for writer/evaluator; `cheap`/`agent` tier map;
- execution: CredentialBroker + isolated browser/container target only where a permitted flow requires it; never standing credentials in the package.

# 4. Reuse-first source map

The user's requirement doc already contains a repo-by-repo leverage plan with license verdicts (`jobpilot-vision-requirement.md` §5); this section carries it forward under Bridge's reuse policy and clean-room protocol. License hygiene rule (from the requirement, retained): **nothing AGPL / Commons-Clause / CC-NC is vendored** — those are design references only; everything shipped is built on MIT/Apache sources.

```yaml
reuse_policy:
  order:
    - install_or_import_existing_permissive_skill
    - wrap_existing_tool_or_repository_behind_Bridge_port
    - adapt_existing_template_or_workflow_with_attribution
    - integrate_upstream_runtime_without_copying_when_license_allows_service_use
    - build_minimal_Bridge_native_gap_only_after_documented_review
  gates:
    - pinned_commit
    - repository_and_artifact_license
    - transitive_dependencies
    - security_and_prompt_injection
    - provenance_and_signature
    - contract_and_eval_conformance
```

```yaml
sources:
  JobSpy:
    use: Tier-2 scraper library + JobPost schema seed
    mode: MIT dependency; Indeed internal-API path most durable; LinkedIn best-effort ONLY, never load-bearing; run under ToS-tier governance (off by default for prohibited sources)
    link: https://github.com/speedyapply/JobSpy
  jobhive/ats-scrapers:
    use: Tier-1 direct ATS scrapers (47 platforms) + company-slug CSVs
    mode: MIT dependency; pin version + vendor scraper code/CSVs early (project ~2 months old)
    link: https://github.com/kalil0321/ats-scrapers
  json-resume-schema:
    use: canonical resume data contract across parse -> master -> tailor -> render; enables field-by-field truthfulness diff
    mode: MIT dependency; model as Zod/TS in Bridge
    link: https://github.com/jsonresume/resume-schema
  Resume-Matcher:
    use: THE crown jewel — tailoring prompts, truthfulness gate (verify_skill_target_plan), 5-dimension eval scorers + LLM-judge rubric (~70% of writer/evaluator loop)
    mode: Apache-2.0 fork-components; adapt into Bridge Materials_Writer/Evaluator with attribution
    link: https://github.com/srbhr/Resume-Matcher
  career-ops:
    use: ~40 zero-auth public ATS JSON provider clients = Tier-1 sourcing catalog; A–G offer-eval rubric; batch worker pattern
    mode: MIT fork-components; port providers to Bridge sourcing port; RIDE via pinned-submodule vendor-sync (weekly diff, agent-reviewed re-port), never a live dependency
    link: https://github.com/(career-ops repo per Platforms CSV)
  ats-screener:
    use: per-ATS scoring profiles + keyword strategies + skills taxonomy for the evaluator
    mode: MIT fork-components
  JobFunnel:
    use: filters.py — exact key_id dedupe + TF-IDF near-dup + persistent duplicate registry
    mode: MIT fork-components (scrapers dead, take only filters)
    link: https://github.com/PaulMcInnis/JobFunnel
  lib_resume_builder_AIHawk:
    use: section-by-section resume prompt templates + HTML->PDF approach (only cleanly-licensed AIHawk piece)
    mode: MIT fork-components
  ApplyPilot:
    use: SQLite stage state-machine; accessibility-snapshot form fill with NO per-ATS selectors; 3-tier question policy; safety stops; result taxonomy; employers.yaml Workday tenants (factual data)
    mode: AGPL-3.0 COPY-PATTERNS-ONLY; reimplement on Agent SDK structured outputs; data file reusable
  job-ops:
    use: Gmail Smart Router (confidence tiers) + stage_events append-only audit schema
    mode: AGPL + Commons-Clause COPY-PATTERNS-ONLY; reimplement in Bridge + Ollama
  Auto_job_applier_linkedIn:
    use: answer-bank spec (config-first deterministic + fuzzy + LLM fallback + persist)
    mode: AGPL-3.0 COPY-PATTERNS-ONLY
  open-resume:
    use: PDF-parsing heuristics (text items -> lines -> sections -> field scoring)
    mode: AGPL-3.0 COPY-PATTERNS-ONLY; reimplement ~few hundred lines with Ollama refiner
  skip:
    - Reactive-Resume (MIT but full SaaS, no programmatic PDF API)
    - ResumeLM (AGPL + Supabase-coupled; dominated by Resume-Matcher)
    - AIHawk main (AGPL, archived, apply code purged from history)
    - EasyApplyJobsBot (CC BY-NC-SA, crippled funnel)
    - linkedin-jobs-scraper (stale; borrow li_at cookie pattern only if a deeper LinkedIn module is ever built)
    - awesome-job-boards / awesome-remote-job (CC0 link lists — seed catalogs only)
```

## 4.1 Legitimate-source catalog (the centerpiece)

From `Tools/Job/Platforms/{job_scanning_apis_repos.csv, job_portals.csv}` — Bridge uses only permitted sources; each connector carries a ToS tier.

```yaml
tier1_legitimate_apis:                 # official/public, no ToS conflict — DEFAULT ON
  ats_public_boards: [Greenhouse job-board API, Lever postings API, Ashby, Workable, SmartRecruiters, (Workday via career-ops providers)]
  aggregator_apis: [Adzuna (free tier), Jooble (partner), Careerjet (partner), USAJobs (free key), Reed.co.uk (free), The Muse (free tier), LinkUp (free tier), Techmap Job Datafeeds (1k/mo free)]
  remote_apis: [Remotive, Arbeitnow (no key), RemoteOK (no key), Himalayas]
  feeds_rss: [Indeed RSS, We Work Remotely RSS, company-careers RSS, HN Who's Hiring, Google-for-Jobs schema.org markup]
tier2_gray_zone:                       # ToS-restricted — OFF by default, governed, never load-bearing
  scraped: [LinkedIn, Indeed (search), Glassdoor, ZipRecruiter, Naukri]
  policy: prohibited by ToS + active anti-bot; JobSpy best-effort only where legally defensible; user-enabled, rate-limited, human-plausible volume; NEVER the primary catalog
comp_data:
  - levels.fyi (only legitimate paid comp API in the corpus) — optional, cited, never presented as fact without source
```

# 5. Data and capability model

Primary Application graph:

```yaml
Application:
  relates_to:
    - Job                 # posting projection off facts.livingProfile
    - Company
    - Category
    - MasterProfile       # JSON Resume, compiled from real corpus
    - TailoredResume
    - CoverLetter
    - FitScore
    - Flag
    - EvaluationVerdict
    - AnswerBankEntry
    - SubmissionRecord    # channel/tier, form map, approval, confirmation
    - StageEvent          # append-only audit (transition() is the sole writer)
    - Communication       # Gmail-matched responses, follow-ups
    - Relationship        # recruiters / hiring managers / warm paths
    - Meeting             # interviews (via Calendar module)
    - Artifact            # rendered PDFs, prep packs
    - Action
    - Memory
```

Semantics + invariants:

- Master profile is compiled from the user's real documents; tailored materials are diffs with per-line evidence — no claim absent from the master survives the truthfulness gate; PROTECTED_FIELDS (employer/title/dates/degree) can never be `jd_added`;
- fit scores resolve to their rule/flag rationale; never rendered as a bare "match %";
- every submission has an explicit human approval and an immutable record; sensitive fields are never auto-filled;
- dedupe is a first-class SQLite/registry layer (`company|title|location` key + fuzzy); already-applied is a guard, not a warning;
- credentials via CredentialBroker only; the standalone SQLite-local model maps onto `packages/db` (`jobpilotJobs`/`jobpilotApplications` already exist) — persistence and validation stay in `@bridge/jobpilot.transition()`.

# 6. Delivery sequence

Builds on what already shipped: `platform/tools/jobpilot/` (14 files, 50 tests — scoring, evaluator, state machine, answer bank, apply-tier router, gmail-router, pacing, connectors, table specs), the `job-pilot` built-in package manifest, `packages/db` store, and `JobPilotPage.tsx` (empty-state, flag-is-the-action UI). Those form JP0.

```yaml
slices:
  JP0:
    scope: DONE — jobpilot anchor package (deterministic scoring/evaluator/state-machine/answer-bank/pacing/connectors/table specs), built-in manifest, db store, prototype UI with honest empty state
  JP1:
    scope: onboarding + master profile — real resume/CL parsing (open-resume heuristics + Ollama) -> JSON Resume master; category generation; profile-backed Cards
  JP2:
    scope: Tier-1 legitimate sourcing live — career-ops/jobhive provider catalog behind the sourcing port; normalize/dedupe (JobFunnel filters); yield/quota/ToS-tier health
  JP3:
    scope: writer + evaluator loop — Resume-Matcher prompts + truthfulness gate + 5-dimension scorers; ATS-safe PDF render; materials approval
  JP4:
    scope: governed application prep + submit — answer bank fill, ATS form-schema mapping (Greenhouse/Lever/Ashby), prefilled handoff sheet, draft-then-approve submission, failure taxonomy, pacing gate
  JP5:
    scope: response + follow-up — Gmail Smart Router (confidence-routed, draft-gated), follow-up drafts, relationship-graph recruiters, analytics
  JP6:
    scope: interviews + learning — interview-prep packs, Calendar-module scheduling, flag-feedback + outcome learning, career-ops vendor-sync, multi-profile, optional Tier-2 gray-zone sourcing under governance
```

Exit gate per slice: source/license record, manifest risk, tests, held-out eval, browser evidence for changed surfaces, provenance/citation audit, security scan, cost/latency baseline, ToS-tier classification on every enabled source, and no dummy runtime data.

Sequencing note: JobPilot is roadmap **P6 (Domain + Ecosystem)** per `docs/wiki/roadmap.md` / `roadmap-6month-2026-h2.md` (post-H2); its JP0 anchor already landed early during P2/Phase-4 tool-standardization to prove the compose-not-copy pattern. This plan sequences the JP1–JP6 feature build but does not reorder the H2 sequencer; any pull-forward goes through `docs/APPROVALS.md`.
