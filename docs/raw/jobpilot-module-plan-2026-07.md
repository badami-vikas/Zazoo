---
title: JobPilot Detailed Module Plan — Design, Business, and Technical
type: raw
doc_kind: plan
status: proposed
companions: [jobpilot-vision-requirement.md, jobpilot-architecture-requirement.md, tool-standardization-plan.md, dealpilot-module-plan-2026-07.md, clean-room-capability-research-protocol-2026-07.md, day1-integrations-free-apis.md, requirement-dealpilot-eta-agent-skill-red-flag-2026-07-15.md, agent-goal-skill-orchestration-plan-2026-07.md]
related_wiki: ../wiki/tools.md
updated: 2026-07-15
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
    form: Database Page toggles; drawer/segmented selector on mobile
    items: [Candidate Profiles, Job Postings, Applications, Sources, Materials, Answer Bank, Communications, Interviews]
  object_navigation:
    form: tabs within a selected Application (Job); collapses to More menu on narrow screens
    purpose: keep JD, fit flags, tailored materials, application record, communications, and interview prep attached to the one Application they explain
```

Vocabulary (built-in manifest): `Initiative → Application`, `Person → Hiring Manager`. Domain vocab is allowed in workspace scope; the user's own naming always wins.

# 1. Design lens — exact information architecture

## 1.1 Module health and attention Section

Purpose: candidate's operating view, not a generic dashboard.

Sections: decision queue (new high-fit cards, materials awaiting approval, applications awaiting submit-approval, responses needing action); pipeline by stage and category; sourcing health; materials health; upcoming interviews and follow-up deadlines; recent changes; Agent activity; configurable saved Views; never fabricated KPIs.

## 1.2 Job Postings Cards View — analysis plus platform red-flag feedback

Each card = one scored `JobProfile` (a projection off `facts.livingProfile`, deduped). Fit analysis produces evidenced reasons to pursue, reasons for concern, gaps, and uncertainty over the deterministic rule score. Green/yellow flag semantics are retired. Pursue, Review, and Dismiss are explicit Decisions/Actions. Platform red-flag feedback remains separate: hovering or focusing a data cell or bullet reveals a subtle uncolored flag; selecting it turns red and records scoped negative feedback.

Card contents: company/title/location/comp-if-known, Source + freshness, evidenced reasons to pursue/avoid, gaps, uncertainty, category match, dedupe/already-applied badge, and explicit Actions (Pursue/Review/Dismiss/Open JD). Saved views: Feed · Red-flagged · Tailoring · Approved · Applied · Responses · Interviews · Archived; by category, Source tier, remote/onsite, seniority, comp band, and concern severity.

## 1.3 Application detail — complete object workspace

Header always visible: company, title, stage, flag state, category fit, source, next action, materials-approval state, next deadline.

```yaml
application_tabs:
  Summary:
    - decision-first brief: why it fits / why it may not
    - key facts (comp, location, remote, seniority, work-auth requirement)
    - reasons to pursue, concerns, gaps, category match, next Actions, recent changes, platform red-flag feedback
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

## 1.4 Applications Pipeline View

Kanban tracker: Sourced → Flagged → Tailoring → Evaluating → Approved → Awaiting-Submit → Applied → Response → Interview → Offer/Rejected (mirrors the built `ApplicationStage` 12-state machine + `transition()`). Every card links to its Application context; work is never a disconnected task island. Per-day + per-ATS-domain pacing gate visible (defer, don't drop).

## 1.5 Materials

Cross-application library: master profile (compiled from the user's real corpus — `Master Profile/master.json`), resume variants per persona, cover-letter templates, tailored outputs with version + evidence + approval + which-version-was-sent. Compare versions; regenerate-from-new-JD with diff. PDF via `@react-pdf/renderer` from JSON Resume props (real selectable text).

## 1.6 Sources

Source catalog + health: Tier-1 legitimate APIs (ATS public JSON, aggregator APIs, RSS) with per-source yield/freshness/quota/ToS tier; category-driven saved searches; Tier-2 scrapers shown with explicit gray-zone labeling and off-by-default governance (see §2.2); dedupe/merge queue. No source runs without an enabled, ToS-classified connector.

## 1.7 Answers

The answer bank: work-auth, salary expectation, notice period, "why us" snippets, reusable across applications. Deterministic exact/fuzzy match first, LLM fallback, persist new answers back. Sensitive-question detector (SSN/payment) unconditionally routes to human.

## 1.8 Interviews

Fires on stage → Interview: auto company-research brief, prep pack from real signals (relationship graph + public company facts), scheduling handed to the Calendar module, post-interview follow-up drafts. Small % of pipeline, high value.

## 1.9 Playbooks Section

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
    - deterministic rule score + evidenced pursue/concern analysis
    - explicit Pursue/Review/Dismiss Decision plus separate red-flag feedback loop
  materials:
    - communications/material Skills tailor resume + cover letter to JD after Pursue Decision only
    - evaluator agent: 5-dimension scorers + truthfulness gate; bounded iteration then human
    - PDF render (ATS-safe selectable text)
  application_preparation:
    - answer-bank fill; form-schema mapping for known ATS (Greenhouse/Lever/Ashby)
    - prefilled answer sheet + deep link for human submission
  submission_governed:
    - draft-then-approve submission; Tier-1 form map surfaced for one-click human confirm
    - failure taxonomy handling; pacing/ToS caps
  tracking_and_response:
    - end-to-end kanban with per-job Files, Results, and Event history
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
  - storing credentials in Files, Results, or localStorage; egress with raw keys (CredentialBroker only)
  - cross-tenant reuse of the user's profile, materials, or answers
  - salary/comp figures presented as fact without a cited, permitted source
```

# 3. Technical lens

## 3.1 Agents

Bridge uses five permanent platform Agents. JobPilot installs no specialist Agents by default. Goal/Task-bound Skills express the workflow; a separate Agent is justified only by durable identity, authority/data boundary, evaluation lifecycle, independent queue/cadence, or irreducible conflict of duties.

```yaml
jobpilot_assignments:
  Learning: authorized job retrieval, normalization, company and culture research, review-theme extraction, provenance
  Internal_Strategist: search strategy, fit, positioning, culture synthesis, material evaluation, interview analysis
  Chief_of_Staff: application coordination, stakeholder communication, approvals, interview/follow-up orchestration
  Capability_Builder: source adapters, form mappings, renderers, Skills, tests, repair of changed integrations
  Governance: truthfulness, sensitive fields, source rights, submission review, policy/control audit
```

Human remains accountable for pursuit/dismissal, materials approval, every submission, and commercial data rights. Agents may create bounded child Agent Runs whose authority, Skills, data scope, budget, review requirement, taint, and depth cannot exceed the parent Run.

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
  - fit-reason-and-concern-narration        # local LLM
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
  - company-culture-research                # Learning; lawful company/review/forum/blog sources
  - attributed-review-theme-extraction
  - culture-evidence-synthesis              # Internal Strategist; fact/opinion/theme/inference kept distinct
  - response-analytics
skill_binding:
  primary: [Goal type, Task type]
  defaults: permanent Agent manifests
  runtime: newly assigned eligible Agent may select matching Skill only after authority, Plane, data-rights, risk, budget, and evaluation checks
```

## 3.3 Automations

```yaml
automations:
  - scheduled-source-scan-with-quota-and-tos-tier
  - source-yield-and-freshness-monitor
  - listing-normalize-dedupe-and-change-detect
  - fit-rescore-on-profile-or-category-change
  - new-high-fit-card-triage-queue
  - materials-tailor-on-pursue-decision        # post-intent only
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

Every Automation carries trigger, idempotency key, budget, retry/backoff, owner, stop condition, risk band, and immutable Run record. External submission and consequential stage changes remain Human-approved. Never use an LLM to find Jobs; spend quality-model tokens only after Pursue Decision.

## 3.4 Integrations/tools

- sourcing: governed connectors over legitimate endpoints only (see §4 catalog); browser fetch (Playwright) only for JS-rendered *permitted* pages, never to defeat anti-bot;
- documents: resume/CL parsing, JSON Resume contract, `@react-pdf/renderer` sidecar for ATS-safe PDF;
- communications: Gmail behind scoped read-only OAuth (the SAME google integration DealPilot's CIM-request uses); draft-only egress;
- relationships: Bridge Person/Relationship graph for recruiters/hiring managers and warm paths;
- calendar: interview scheduling handed to the Calendar module (time-axis projection), not a private scheduler;
- models: local Ollama for scoring/dedupe/extraction; Claude via ModelProvider for writer/evaluator; `cheap`/`agent` tier map;
- execution: CredentialBroker + isolated browser/container target only where a permitted flow requires it; never standing credentials in the package.

# 4. Reuse-first source map

The user's requirement doc already contains a repo-by-repo leverage plan with license verdicts (`jobpilot-vision-requirement.md` §5); this section carries it forward under Bridge's reuse policy and clean-room protocol. **Code-level diligence completed 2026-07-13** (`oss-code-diligence-2026-07.md` §2) — all load-bearing claims verified in source; corrections applied inline below. License hygiene rule (from the requirement, retained): **nothing AGPL / Commons-Clause / CC-NC is vendored** — those are design references only; everything shipped is built on MIT/Apache sources.

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
    - repository_and_output_license
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
    use: THE crown jewel — tailoring prompts, truthfulness gate (verify_skill_target_plan improver.py:754 + diff gate _BLOCKED_FIELD_NAMES/verify_diff_result), 5 deterministic scorers + LLM-judge (all CODE-VERIFIED 2026-07-13, decoupled from FastAPI/Next)
    mode: Apache-2.0 fork-components; adapt into Bridge materials-writing/evaluation Skills with attribution
    port_notes: their ResumeData schema ≠ JSON Resume — rewrite allow/block path regexes on remap; upstream ACCEPTS jd_added skills (diff-preview review) — Bridge tightens to PROTECTED_FIELDS-never-jd_added on port
    link: https://github.com/srbhr/Resume-Matcher
  career-ops:
    use: 54 zero-auth public ATS JSON provider clients (code-verified 2026-07-13; uniform {id,detect,fetch} contract, _registry loader, trust-validator) = Tier-1 sourcing catalog. A–G rubric + batch worker DOWNGRADED to design-reference — they are markdown prompts + a bash Claude-CLI harness, not portable code
    mode: MIT fork-components; port providers to Bridge sourcing port; RIDE via pinned-submodule vendor-sync (weekly diff, agent-reviewed re-port), never a live dependency
    link: https://github.com/santifer/career-ops
  ats-screener:
    use: per-ATS scoring profiles + keyword strategies + skills taxonomy for the evaluator
    mode: MIT fork-components
  JobFunnel:
    use: filters.py — two-stage dedupe pattern (exact key_id + TF-IDF cosine 0.75 on descriptions + persistent duplicate registry). CORRECTED 2026-07-13 — key_id is the SOURCE's job identifier (provider-prefixed), NOT a company|title|location composite; the composite key in §5 stays Bridge's own design
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
    - File                # rendered PDFs, prep packs
    - Result              # fit, evaluation, culture synthesis
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

Universal exit gate (applies to every slice, in addition to its own criteria): source/license record, manifest risk, tests, held-out eval, browser evidence for changed surfaces, provenance/citation audit, security scan, cost/latency baseline, ToS-tier classification on every enabled source, and no dummy runtime data.

```yaml
slices:
  JP0:
    status: DONE
    scope: jobpilot anchor package (deterministic scoring/evaluator/state-machine/answer-bank/pacing/connectors/table specs), built-in manifest, db store, prototype UI with honest empty state
    evidence: platform/tools/jobpilot (14 files, 50 tests), job-pilot manifest, JobPilotPage.tsx flag-is-the-action UI
  JP1:
    goal: a real master profile compiled from the user's real documents, powering profile-backed Cards
    depends_on: [JP0]
    deliverables:
      - resume/CL ingestion skill — open-resume heuristics reimplemented clean-room (AGPL patterns-only) + Ollama refiner
      - JSON Resume contract as Zod/TS in @bridge/jobpilot (json-resume-schema, MIT)
      - master-profile compile + dedupe across multiple source documents; human review/edit surface before it becomes authoritative
      - job-category generation (editable anytime); Cards read from profile, not fixtures
    exit_criteria:
      - ingest >= 2 real resumes -> ONE master.json; zero fields absent from the source corpus (spot-audit)
      - parsing field-accuracy eval on a labeled set of the user's real documents; failures degrade to NeedsHuman, never silent
      - master profile is human-approved before any downstream skill consumes it (poisoned-profile guard)
  JP2:
    goal: 100+ real postings/day flowing from legitimate sources into deduped, scored Cards
    depends_on: [JP1]
    deliverables:
      - sourcing port + first provider wave ported from career-ops (Greenhouse, Lever, Ashby, Remotive, Arbeitnow, USAJobs) with ToS tier stamped on every connector
      - JobFunnel-pattern dedupe registry (exact key + TF-IDF near-dup) + already-applied guard
      - per-source yield/freshness/quota health in the Sources surface; pacing state visible
      - career-ops pinned-submodule vendor-sync automation (weekly diff report)
    exit_criteria:
      - end-to-end: real postings -> normalize -> dedupe -> score -> Cards, with measured dedupe rate and per-source yield rendered
      - zero Tier-2 sources enabled by default; enabling one requires explicit user action + governance record
      - provider contract tests pinned so an upstream ATS API change fails loud, not silent
  JP3:
    goal: tailored materials the user can trust — every changed line evidenced, embellishment impossible
    depends_on: [JP1]
    deliverables:
      - materials-writing + materials-evaluation Skills on Resume-Matcher-derived prompts (Apache-2.0, attributed)
      - truthfulness gate wired to PROTECTED_FIELDS; per-line change_log with evidence pointers into the master profile
      - 5-dimension scorers + LLM-judge; bounded iteration cap then human
      - ATS-safe PDF via @react-pdf/renderer (selectable text); materials approval state machine
    exit_criteria:
      - red-team eval — a seeded suite of embellishment/fabrication attempts (jd_added claims, PROTECTED_FIELD edits) is 100% blocked; suite reruns on every prompt-pack change
      - evaluator-vs-human agreement measured on the user's real approve/reject decisions; disagreement feeds prompt tuning
      - PDF renders with selectable text and parses back cleanly through an ATS-style extractor
  JP3B:
    goal: cited company-culture research strengthens truthful cover letters and interview preparation
    depends_on: [JP2]
    deliverables:
      - Learning Skill for authorized company pages, Google reviews, Reddit, blogs, and Glassdoor only where access and terms permit
      - source-rights/ToS classification, recency, author context where available, attribution, contradiction and repeated-theme extraction
      - Internal Strategist synthesis separating fact, opinion, theme, uncertainty, and inference
      - cover-letter/interview suggestions linked to evidence; no anonymous claim represented as verified fact
    exit_criteria:
      - every surfaced culture claim opens its Source and retrieval date
      - inaccessible, paywalled, prohibited, or ambiguous sources are skipped or stop for user/counsel permission; no bypass path
      - seeded contradictory reviews remain visible rather than collapsed into false consensus
      - generated materials contain no invented personal affinity, insider claim, or defamatory assertion
  JP4:
    goal: one real application submitted end-to-end under draft-then-approve
    depends_on: [JP2, JP3]
    deliverables:
      - answer-bank live (deterministic -> fuzzy -> LLM fallback -> persist); sensitive-question detector routing SSN/payment/EEO to NeedsHuman unconditionally
      - ATS form-schema mapping (Greenhouse/Lever/Ashby); prefilled handoff sheet + deep link for human submission
      - submit-approval as pipeline egress proposal; SubmissionRecord immutable; failure taxonomy (CAPTCHA/LOGIN/FAILED) router
      - pacing gate enforced per-day + per-ATS-domain (defer, never drop)
    exit_criteria:
      - ">= 1 real application submitted via approve flow with complete immutable record (channel, form map, approval, confirmation)"
      - sensitive-field eval: 0 auto-fills across a seeded SSN/payment/EEO question set
      - pacing verified: overflow defers with visible queue state; nothing silently dropped; no submission path exists that skips approval (negative test)
  JP5:
    goal: responses close the loop — detected, matched, and answered without unattended sends
    depends_on: [JP4, google-integration (shipped)]
    deliverables:
      - Gmail Smart Router reimplemented in Bridge + Ollama (job-ops AGPL patterns-only): confidence-tiered match of inbound mail to Applications
      - confidence-routed stage advance, draft-gated; low confidence -> NeedsHuman
      - follow-up reminders + draft outreach; recruiters/hiring managers materialized in the Person graph
      - response analytics (rate by category/variant/channel)
    exit_criteria:
      - inbox replay eval on real historical mail: match precision measured; every misroute lands in NeedsHuman, none silently advance stage
      - stage advances only through approved transition() calls (append-only StageEvent audit holds)
      - follow-up drafts are draft-only egress — no auto-send path (negative test)
  JP6:
    goal: interviews handled + the system measurably learning from outcomes
    depends_on: [JP5, CAL3+ (calendar overlays)]
    deliverables:
      - interview-prep packs from real signals (relationship graph + public company facts) on stage -> Interview
      - scheduling handed to the Calendar module (one contract, no private scheduler)
      - red-flag feedback + outcome learning: scoped corrections, Pursue/Dismiss Decisions, and outcomes tune scoring prompts (versioned, eval-gated)
      - multi-profile support; OPTIONAL Tier-2 gray-zone sourcing behind explicit enable + rate caps + governance record
    exit_criteria:
      - an interview event round-trips through the Calendar module projection
      - learning eval: scoring drift toward user decisions demonstrated on a held-out decision set; every prompt change ships with a before/after eval delta
      - Tier-2 remains off by default; enabling produces an audit record; volumes stay human-plausible (cap test)
```

## 6.1 Success measures

```yaml
metrics:
  activation: "time from Module install -> first evidence-backed recommendation card (target: same session)"
  sourcing: postings/day from Tier-1, dedupe rate, median listing freshness, source failure MTTR
  materials_quality: truthfulness-gate pass rate, evaluator-human agreement %, red-team block rate (must stay 100%)
  outcomes: response rate by category/resume-variant/channel (the analytics loop, JP5)
  cost: tokens per application (local-vs-frontier split; LLM never used to FIND jobs — invariant)
  trust: unapproved external submissions == 0, sensitive auto-fills == 0 (hard invariants, monitored not assumed)
```

## 6.2 Risk register

```yaml
risks:
  source_fragility:
    risk: ATS/aggregator APIs change or die silently (jobhive is ~2 months old; career-ops providers unversioned)
    mitigation: pinned vendoring + provider contract tests (JP2) + weekly vendor-sync diff + per-source health monitor
  tos_drift:
    risk: a Tier-1 source tightens terms and becomes gray-zone
    mitigation: ToS tier re-verified on vendor-sync; tier changes demote the connector to off pending user re-enable
  truthfulness_false_negative:
    risk: an embellishment slips the gate -> user submits a falsified resume (worst-case product failure)
    mitigation: red-team suite reruns on every prompt/model change; PROTECTED_FIELDS structural (not prompt-only) enforcement; per-line evidence rendered so the human can audit
  profile_poisoning:
    risk: bad resume parse silently corrupts everything downstream
    mitigation: JP1 human-approval gate on the master profile; parse failures -> NeedsHuman
  response_misrouting:
    risk: Gmail router matches mail to the wrong Application and advances stage
    mitigation: confidence tiers with NeedsHuman floor; stage change draft-gated; inbox-replay eval before enable
  reputation_pacing:
    risk: even governed volume reads as AI spam to recruiters (Greenhouse 2025 filtering arms race)
    mitigation: pacing caps are product-load-bearing, not just compliance; per-ATS-domain caps; quality-over-volume defaults
  cross_module:
    risk: JP6 blocked if Calendar CAL3+ slips
    mitigation: interview scheduling degrades to read-only calendar links; prep packs don't depend on CAL
```

Sequencing note: JobPilot is roadmap **P6 (Domain + Ecosystem)** per `docs/wiki/roadmap.md` / `roadmap-6month-2026-h2.md` (post-H2); its JP0 anchor already landed early during P2/Phase-4 tool-standardization to prove the compose-not-copy pattern. This plan sequences the JP1–JP6 feature build but does not reorder the H2 sequencer; any pull-forward goes through `docs/APPROVALS.md`. Cross-roadmap: JP3/JP5 egress + approvals ride the shipped pipeline; JP6 consumes Calendar CAL3+; materials/scoring evals plug into the Agent Quality eval model (EVAL-1/2, Batch 3).
