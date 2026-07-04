---
title: JobPilot — Product Vision (verbatim user requirement)
type: raw
doc_kind: requirement
status: active
companions: [tool-standardization-plan.md]
related_wiki: ../wiki/tools.md
updated: 2026-07-03
tags: [jobpilot, tools, requirement]
---

# JobPilot — Product Vision & Feature Roadmap

*Working title: JobPilot. Local-first, zero-cost agentic job application platform.*
*Date: 2026-07-03*

---

## 1. Product Vision Statement

> **JobPilot is a local-first, agentic job search copilot that turns a candidate's resumes and cover letters into a continuously running application pipeline. It sources relevant opportunities from the cheapest available channel, surfaces them as swipe-simple green/red flag decisions, tailors and quality-gates application materials with a two-agent write/evaluate loop, and applies automatically through a cost-waterfall (free APIs → direct form automation → browser agent) — while giving the candidate one end-to-end tracker of every job from "discovered" to "offer." It runs entirely on the user's own computer at $0 marginal cost, keeping their data private and their judgment in the loop at exactly one decision point: the flag.*

**One-liner:** *Swipe green, get applied. Everything else is agents.*

### Core principles
1. **Human decides once, agents do the rest.** The green flag is the only mandatory human action per job.
2. **Cheapest-means-first waterfall.** Every stage (sourcing, tailoring, applying) tries the free/programmatic path before escalating to expensive automation (LLM calls, browser agents).
3. **Local and free.** SQLite + local files + local LLM (Ollama) where possible; the user's existing Claude subscription (Claude Code / Agent SDK) covers quality-critical steps. No cloud services, no per-seat fees.
4. **Quality gate before send.** Nothing is submitted unless the evaluator agent approves the tailored materials.
5. **Full pipeline visibility.** Every job has a state, a history, and artifacts (which resume version was sent, when, via which channel).

---

## 2. System Overview

```
┌─────────────────────────────────────────────────────────────┐
│  ONBOARDING: upload resumes + cover letters (multiple)      │
│  → LLM extracts profile + proposes job categories (editable)│
└──────────────────────────┬──────────────────────────────────┘
                           ▼
┌─────────────────────────────────────────────────────────────┐
│  SOURCING WATERFALL (cron, runs locally)                    │
│  T1: Free structured APIs — Greenhouse/Lever/Ashby public   │
│      job-board JSON, RemoteOK, Adzuna free tier, HN Who's   │
│      Hiring, company RSS                                    │
│  T2: Scrapers — JobSpy (LinkedIn/Indeed/Glassdoor/ZipRec)   │
│  T3: Headless browser fetch (Playwright) for JS-only boards │
└──────────────────────────┬──────────────────────────────────┘
                           ▼
┌─────────────────────────────────────────────────────────────┐
│  SCORING: local LLM ranks fit vs. categories + profile;     │
│  generates GREEN flags (why apply) and RED flags (concerns) │
│  → shown on cards in the web UI                             │
└──────────────────────────┬──────────────────────────────────┘
                 user clicks GREEN flag
                           ▼
┌─────────────────────────────────────────────────────────────┐
│  TAILORING LOOP                                             │
│  Writer agent: customizes resume + cover letter to the JD   │
│  Evaluator agent: scores against rubric (keyword match,     │
│  truthfulness vs. master resume, ATS-format, tone)          │
│  → loop until APPROVED (max N iterations, else flag human)  │
└──────────────────────────┬──────────────────────────────────┘
                           ▼
┌─────────────────────────────────────────────────────────────┐
│  APPLICATION WATERFALL                                      │
│  T1: Direct ATS form POST (Greenhouse/Lever/Ashby have      │
│      predictable form schemas) — free, fast, reliable       │
│  T2: Local Playwright form-fill with stored answer bank     │
│  T3: Claude in Chrome / Claude Agent SDK browser agent      │
│      (complex flows, logins, weird ATSs)                    │
│  T4: Human handoff — prefilled answer sheet + deep link     │
└──────────────────────────┬──────────────────────────────────┘
                           ▼
┌─────────────────────────────────────────────────────────────┐
│  TRACKER: Kanban — Sourced → Flagged → Tailoring →          │
│  Approved → Applying → Applied → Response → Interview →     │
│  Offer/Rejected. Full artifact + event history per job.     │
└─────────────────────────────────────────────────────────────┘
```

### Free/local reference stack
| Layer | Choice | Cost |
|---|---|---|
| UI | Next.js or Vite+React, runs on localhost | $0 |
| API/agents | Python FastAPI + Claude Agent SDK / Ollama | $0 (uses existing Claude sub for premium steps) |
| DB | SQLite | $0 |
| Job sourcing | JobSpy, public ATS JSON endpoints, RSS | $0 |
| Cheap LLM steps (scoring, dedup, extraction) | Ollama (Llama/Qwen local) | $0 |
| Quality LLM steps (tailoring, evaluation) | Claude via Claude Code/Agent SDK | covered by subscription |
| Browser automation | Playwright (headless, local) | $0 |
| Last-resort browser agent | Claude in Chrome | subscription |
| Scheduling | cron / launchd on macOS | $0 |

**Leverage targets:** researched in depth — see §6 "Open-Source Leverage Plan" (based on the repos in `Platforms/opensource_job_tools_master.csv`).

---

## 3. Feature List — Rank-Ordered by ROI / Effort

Scored ROI (value toward "applications sent to right jobs with least human time") ÷ Effort (build complexity on a free/local stack). Build top-down; the first 8 form the MVP.

| # | Feature | ROI | Effort | Why this rank |
|---|---|---|---|---|
| 1 | **Resume/CL ingestion + profile extraction** (multiple docs, parsed to structured profile) | High | Low | Foundation for everything; one LLM extraction call per doc. |
| 2 | **Job category generation at onboarding, editable anytime** | High | Low | Single LLM call + simple edit UI; drives all sourcing. |
| 3 | **Tier-1 job sourcing (free APIs: ATS public JSON, RemoteOK, Adzuna, HN)** | High | Low | Highest-quality data at zero cost and zero scraping fragility. |
| 4 | **Opportunity cards with green/red flags** (local-LLM fit scoring, one-click green = advance) | High | Low-Med | The core UX; scoring is cheap on Ollama; this is the product's identity. |
| 5 | **End-to-end tracker (kanban + per-job event/artifact history)** | High | Low | SQLite status field + simple board UI; needed from day one so nothing built later is untracked. |
| 6 | **Writer agent: resume + cover letter tailoring** | High | Med | Biggest quality lever per application; Claude does the heavy lifting. |
| 7 | **Evaluator agent + approval loop** (rubric: JD keyword match, truthfulness vs. master resume, ATS formatting; max-iteration cap) | High | Med | Cheap insurance against sending bad/hallucinated materials; unlocks safe auto-apply. |
| 8 | **Tier-1 auto-apply: direct ATS form submission (Greenhouse/Lever/Ashby)** | High | Med | These three ATSs cover a large share of postings and have predictable forms — most applications never need a browser agent. |
| 9 | **Answer bank** (work auth, salary, EEO, "why us" snippets, reused across applications) | High | Low | Small feature, removes the #1 blocker for unattended applying. |
| 10 | **Dedup + already-seen/already-applied detection** | Med-High | Low | Hash/fuzzy-match on company+title; prevents embarrassing double-applies and card noise. |
| 11 | **career-ops vendor sync watcher** (pinned submodule + `sync_manifest.yaml` + weekly diff job) | Med-High | Low | Rides a 58k-star, daily-updated MIT repo's new ATS providers and rubric tweaks for the cost of a weekly `git pull` + diff; keeps Tier-1 sourcing coverage current without re-researching ATS changes ourselves. |
| 12 | **Tier-2 sourcing: JobSpy scrapers (LinkedIn/Indeed/Glassdoor)** | Med-High | Med | Big volume boost, but scrapers are fragile — that's why it's after the API tier. |
| 13 | **Tier-2 apply: Playwright form-fill for non-standard forms** | Med | Med | Extends unattended coverage beyond the big-3 ATSs. |
| 14 | **Tier-3 apply: Claude in Chrome / browser-agent fallback** | Med | Med-High | Highest per-application cost and slowest — correctly last in the waterfall; also needs human-visible review before submit. |
| 15 | **Human-handoff mode** (prefilled answers + deep link when all tiers fail) | Med | Low | Graceful floor for the waterfall; cheap to build. |
| 16 | **Daily digest / notification** (new green-worthy cards, applications sent, responses) | Med | Low | Keeps engagement without opening the app; local notification or email. |
| 17 | **Response tracking + follow-up reminders** (Gmail Smart Router pattern from job-ops, ported to Ollama) | Med | Med | Value appears only after volume of applications exists; confidence-tiered auto-advance avoids manual status updates. |
| 18 | **Analytics: response rate by category / resume variant / channel** | Med | Med | Turns the pipeline into a learning system; needs weeks of data first. |
| 19 | **Flag-feedback learning loop** (red-flag clicks and rejections tune the scoring prompt) | Med | Med | Improves card precision over time; prompt-tuning, not ML training. |
| 20 | **Multi-profile support** (distinct category sets per resume persona, e.g., PM vs. Data) | Low-Med | Med | Useful for career switchers; most users run one persona. |
| 21 | **Interview prep pack per job** (auto company research brief when status → Interview) | Low-Med | Med | Nice-to-have; only fires on the small % that convert. |
| 22 | **Salary/comp enrichment on cards** (levels.fyi-style context) | Low | Med | Informational polish; data sources for this are the least free/reliable. |

**MVP = #1–8** (roughly: onboard → source → flag → tailor → evaluate → apply to Greenhouse/Lever/Ashby → track). Everything after is compounding leverage.

---

## 4. Waterfall Cost Policy (explicit)

**Sourcing:** public ATS/board APIs → RSS/HN → JobSpy scraping → Playwright fetch. Never use an LLM to *find* jobs; only to *score* them (and score with local Ollama, not Claude).

**Materials:** template-slot substitution where possible → local-LLM draft → Claude writer/evaluator loop only for jobs the user green-flagged (i.e., spend quality tokens only post-intent).

**Applying:** direct HTTP form submission → Playwright scripted fill → Claude in Chrome agent → human handoff. Each tier logs why it escalated, so tier coverage can be measured and improved.

---

## 5. Open-Source Leverage Plan

*Based on repo-by-repo research (README, architecture, license, maintenance) of the reference list in `Platforms/`. Verdict scale: USE-AS-DEPENDENCY → FORK-COMPONENTS (lift code/data, permissive license) → COPY-PATTERNS-ONLY (reimplement the design; license or language blocks code reuse) → SKIP.*

### Use as dependencies (pip-install and go)
| Repo | License | What we take |
|---|---|---|
| **JobSpy** (`pip install python-jobspy`) | MIT, active (Feb 2026) | Tier-2 scraping: Indeed works *without proxies* via its internal API; Glassdoor/Google/ZipRecruiter too. Its `JobPost` schema seeds our SQLite jobs table. LinkedIn needs rotating proxies — treat as best-effort. |
| **ats-scrapers / jobhive** (`pip install jobhive-py`) | MIT, new (May 2026) | Tier-1 sourcing: direct scrapers for 47 ATS platforms (`GreenhouseScraper("company").fetch()`) + community CSVs of company slugs per ATS + hosted dataset of 3.2M jobs. Pin version; vendor the scraper code + slug CSVs (MIT allows) as hedge against project age. |
| **JSON Resume schema** (`@jsonresume/schema`) | MIT, stable | Canonical resume data format across the whole pipeline: parser output → master resume → tailored diff → PDF render. Modeled as Pydantic in the backend; makes the evaluator's truthfulness check a structured field-by-field diff instead of text comparison. |

### Fork components (permissive license, lift code/prompts/data)
| Repo | License | What we take |
|---|---|---|
| **Resume-Matcher** | Apache-2.0, very active | The crown jewel — same stack as ours (FastAPI + LiteLLM + Ollama). Lift: JD keyword-extraction + tailoring prompts, the `verify_skill_target_plan()` truthfulness gate (classifies each skill as existing / jd_added / supported), and the deterministic 5-dimension eval harness (`tests/evals/scorers.py`: structure preservation, fabrication guard, personal-info integrity, validity, keyword coverage) + LLM-as-judge rubric. This is ~70% of our writer/evaluator loop, pre-written. |
| **career-ops** | MIT, extremely active | Port `scan.mjs` + its ~40 `providers/*.mjs` (zero-LLM, zero-auth public ATS JSON clients: Greenhouse, Ashby, Lever, Workable, SmartRecruiters, Workday…) to Python httpx — this IS our Tier-1 sourcing catalog. Also reuse its A–G offer-evaluation rubric prompts for card scoring and its batch headless-worker pattern. |
| **ats-screener** | MIT, active | Per-ATS scoring profiles (Workday/Taleo/iCIMS/Greenhouse/Lever/SuccessFactors weights + keyword strategies) → translate the rubric data + prompts into our evaluator. Skills taxonomy too. |
| **JobFunnel** | MIT, archived | Scrapers are dead; lift only `filters.py`: key_id exact dedup + TF-IDF cosine near-dup detection + persistent duplicate registry → our dedup layer as a SQLite table. |
| **lib_resume_builder_AIHawk** | MIT | Section-by-section resume-generation prompt templates and HTML→PDF approach (the only salvageable, cleanly-licensed piece of the AIHawk ecosystem). |

### Copy patterns only (blocking license — AGPL/Commons-Clause — or wrong language; reimplement the design)
| Repo | Blocker | The design worth stealing |
|---|---|---|
| **ApplyPilot** | AGPL-3.0, solo, quiet since Mar 2026 | Closest architecture to ours. Reimplement: single SQLite `jobs` table as stage state-machine (`discover → enrich → score → tailor → cover → pdf → apply`); apply agent = Claude driven through Playwright-MCP over real Chrome via CDP, filling forms from accessibility snapshots with **no per-ATS selector code**; 3-tier screening-question policy (hard facts from profile only / in-domain skills = yes / open-ended = 2–3 JD-referencing sentences); safety stops (SSN, payments, SSO); dry-run mode; structured result taxonomy (APPLIED / EXPIRED / CAPTCHA / LOGIN_ISSUE / FAILED). We upgrade its string-marker outputs to Claude Agent SDK structured outputs. Its `employers.yaml` (48 Workday tenants) is factual data — reusable. |
| **job-ops** | AGPL + Commons Clause, TypeScript | The Gmail "Smart Router": poll Gmail REST API (readonly OAuth, keyword query) → one LLM call per email with a numbered list of active applications → strict JSON `{bestMatchIndex, confidence, stageTarget}`; confidence ≥95 auto-advances the tracker, 50–94 goes to a review queue, <50 to orphan inbox. Also its tracker schema: status enum + append-only `stage_events` audit log + interviews/notes tables. Port to Python + Ollama. |
| **Auto_job_applier_linkedIn** | AGPL-3.0 | The answer-bank spec: config-first deterministic answers (experience, visa, salary, notice period) with fuzzy label/option matching → LLM fallback (OpenAI-compatible, so Ollama-ready) → persist every new Q&A back to the bank. Its LinkedIn form DOM taxonomy maps 1:1 to Playwright locators. |
| **open-resume** | AGPL-3.0, TypeScript | Best-documented resume-parsing algorithm: PDF text items → line grouping → section grouping → per-field feature scoring. Port heuristics to Python (~few hundred lines), with local Ollama as fallback refiner into JSON Resume. |

### Skip
**Reactive-Resume** (MIT but a full Postgres+auth SaaS, no programmatic PDF API), **ResumeLM** (AGPL + Supabase-coupled + no local LLM; dominated by Resume-Matcher), **AIHawk main repo** (AGPL, archived, and the famous Easy-Apply/GPTAnswerer code was purged from git history in Dec 2024 — there's nothing left to salvage), **EasyApplyJobsBot** (CC BY-NC-SA, free tier deliberately crippled as a marketing funnel), **linkedin-jobs-scraper** (Node, 16 months stale; borrow its `li_at` cookie auth pattern if we ever build a deeper LinkedIn module), **awesome-job-boards / awesome-remote-job** (CC0 link lists — bookmark as seed catalogs for niche boards).

### Vendor Sync Strategy — riding career-ops' community updates without forking it

career-ops (MIT) is updated daily and its highest-value parts — per-ATS provider scanners and evaluation rubric prompts — are modular single files, which makes selective upstream tracking practical instead of a full fork:

1. **Pin, don't run.** Add career-ops as a git submodule at `vendor/career-ops`, locked to a specific commit SHA. It's a diffable reference copy only — never executed, never shipped.
2. **`sync_manifest.yaml` is the toggle switch.** One entry per file we've ported: upstream path → our ported Python path → `watch: true/false` → last-synced upstream SHA. Set `watch: false` on anything we deliberately didn't adopt (its TUI dashboard, markdown-canonical storage, Node runtime).
3. **Weekly local cron/launchd job (free, no cloud):** `git submodule update --remote`, then for each `watch: true` entry, `git log <last_sync_sha>..HEAD -- <path>` — if it changed, write the diff into a local sync report (e.g. "new ATS provider: rippling.mjs", "oferta rubric weights changed").
4. **Human/agent-reviewed re-porting, never auto-merged.** Since it's a Node→Python port, each diff needs translation, not a blind merge — a perfect bounded task to hand an agent ("port this diff into `providers/rippling.py`").
5. **Update the manifest's SHA per file once ported**, so the next sync only shows the incremental delta.

This captures new ATS-provider coverage and rubric refinements from the community as they land, without inheriting career-ops' license terms, UI paradigm, or release roadmap — cost is one `git pull` + diff per week.

### What this changes in the build
- **Feature #3 (Tier-1 sourcing) and #8 (direct ATS apply) get dramatically cheaper:** jobhive + career-ops' provider catalog give us company discovery and ATS JSON clients on day one.
- **Features #6–7 (writer/evaluator agents) drop from Med to Low-Med effort:** Resume-Matcher's prompts, truthfulness gate, and eval scorers transplant into our FastAPI backend under Apache-2.0.
- **Feature #10 (dedup) is a lift, not a build:** JobFunnel's `filters.py`.
- **Feature #13 (browser-agent apply) has a proven prompt protocol:** ApplyPilot's design, reimplemented on the Agent SDK.
- **Feature #16 (response tracking) has a proven design:** job-ops' Smart Router, ported to Ollama.
- **License hygiene rule:** nothing AGPL/Commons-Clause/CC-NC gets vendored into the codebase — those four repos are design references only. Everything we ship is built on MIT/Apache sources.
- **PDF pipeline decision:** render tailored resumes with `@react-pdf/renderer` from JSON Resume props in our React UI (real selectable text = ATS-safe); small Node sidecar for headless batch rendering. Avoid Python PDF libs to keep one template system.

---

## 6. Guardrails & Open Items

- **Truthfulness gate:** evaluator must verify tailored resumes contain no claims absent from the master resume. Hard requirement, not a nice-to-have.
- **Submit confirmation policy:** decide whether Tier-1/2 auto-submit is fully unattended or shows a 30-second "sent unless cancelled" toast. Recommend unattended for T1/T2, confirm-before-submit for T3 (browser agent).
- **ToS awareness:** LinkedIn/Indeed scraping and bot-applying sit in gray zones; the waterfall design deliberately prefers official/public endpoints. Keep volume human-plausible.
- **Rate limiting:** cap applications/day (configurable) to avoid spam patterns and ATS flagging.
- **jobhive project risk:** `jobhive-py` is only ~2 months old; pin the version and vendor its MIT scraper code + company-slug CSVs early so Tier-1 sourcing survives if the project stalls.
- **LinkedIn reality check (from `Platforms/job_portals.csv`):** LinkedIn/Indeed/Glassdoor all prohibit scraping in ToS with active anti-bot enforcement. JobSpy's Indeed path (internal API, no proxy) is the most durable; LinkedIn coverage should be treated as best-effort and never load-bearing.
