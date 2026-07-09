---
title: JobPilot — Architecture (verbatim user requirement)
type: raw
doc_kind: requirement
status: active
companions: [tool-standardization-plan.md]
related_wiki: ../wiki/tools.md
updated: 2026-07-03
tags: [jobpilot, tools, requirement]
---

# JobPilot — End-to-End Platform Architecture

*Companion to `JobPilot-Product-Vision.md` (v2026-07-03). All 13 locked product decisions and the §5 Open-Source Leverage Plan license rules are binding here. Anything not covered by those decisions is listed in Appendix A (Architect's Discretion).*

---

## 1. System Overview

### 1.1 Component diagram

```
┌────────────────────────────── Mac (localhost only) ──────────────────────────────┐
│                                                                                  │
│  ┌─────────────┐   HTTP :5173→:8100    ┌──────────────────────────────────────┐  │
│  │  web/       │ ◄────────────────────►│  server/  (FastAPI, uvicorn :8100)   │  │
│  │  React+Vite │      REST /api/*      │                                      │  │
│  │  TS, TanStack Query, Tailwind       │  api/        routers                 │  │
│  │  card feed · review · kanban        │  services/   sourcing,dedup,scoring, │  │
│  │  needs-you · run panel · settings   │              apply,gmail,notify      │  │
│  └─────────────┘                       │  agents/     writer,evaluator,       │  │
│         │                              │              browser_apply           │  │
│         │ render request               │  providers/  greenhouse,lever,ashby, │  │
│         ▼                              │              workday,jobhive,adzuna… │  │
│  ┌─────────────┐                       │  llm/        LiteLLM router (cheap   │  │
│  │ pdf-sidecar/│◄──── exec (node) ─────│              tier) + AgentSDK client │  │
│  │ Node,       │  JSON Resume → PDF    │  db/         SQLAlchemy 2 + Alembic  │  │
│  │ @react-pdf  │                       └──────┬───────────────┬───────────────┘  │
│  └─────────────┘                              │               │                  │
│                                        ┌──────▼─────┐  ┌──────▼──────────────┐   │
│                                        │ jobpilot.db│  │ artifacts/          │   │
│                                        │ SQLite WAL │  │ pdfs, uploads, logs │   │
│                                        └────────────┘  └─────────────────────┘   │
│                                                                                  │
│  launchd ──► jobpilot CLI (`jobpilot run source|apply|gmail --config <name>`)    │
│  Playwright (Tier-2 apply, finance scrapers)   Chrome+CDP (Tier-3 agent)         │
│  osascript notifications          vendor/career-ops (submodule, read-only)       │
└──────────────────────────────────────────────────────────────────────────────────┘
   External (all free/public): ATS JSON APIs · RemoteOK/Adzuna/USAJobs · Gmail
   REST (readonly OAuth) · LLM APIs (Haiku / Gemini Flash free tier) · Claude
   subscription via Agent SDK
```

### 1.2 Process model — what runs when

| Process | How it starts | Lifetime |
|---|---|---|
| `jobpilot serve` (FastAPI + serves built web UI at `http://localhost:8100`) | LaunchAgent `com.jobpilot.server.plist`, `KeepAlive=true` | Always on (idle cost ≈ 0) |
| Morning burst: `jobpilot run source --config morning` (source → dedup → score → notify "N new cards") | LaunchAgent `com.jobpilot.burst-am.plist`, `StartCalendarInterval 06:30` | Minutes |
| Evening burst: `jobpilot run apply --config evening` (tailor → evaluate → apply waterfall for green/approved-yellow) | `com.jobpilot.burst-pm.plist`, 18:30 | Minutes–hours (paced) |
| Gmail sync: `jobpilot run gmail` | `com.jobpilot.gmail.plist`, every 2h 08:00–20:00 | Seconds |
| Run-now / custom runs | `POST /api/runs` from the UI Run Panel spawns the same CLI as a subprocess with a `run_configs` row's params | On demand |
| Weekly vendor sync: `jobpilot run vendor-sync` | `com.jobpilot.vendor.plist`, Sun 09:00 | Seconds; writes diff report only |

One writer at a time per domain: bursts take an advisory lock row (`locks` table) so a run-now can't double-apply concurrently with the evening burst.

### 1.3 Technology choices (one line each, tied to leverage plan)

- **Python 3.12 + FastAPI** — matches Resume-Matcher (Apache-2.0) so its `services/` and eval scorers transplant with minimal change.
- **SQLite (WAL) + SQLAlchemy 2.0 + Alembic** — local-first, zero-ops; ApplyPilot proved the single-DB stage-pipeline pattern (reimplemented, not copied — AGPL).
- **LiteLLM** — the model-agnostic router; already Resume-Matcher's LLM layer; Haiku/Gemini Flash today, `ollama/…` later by config edit only.
- **Claude Agent SDK (subscription auth)** — writer/evaluator/browser agents at zero marginal cost; structured outputs replace ApplyPilot's string markers.
- **React 18 + Vite + TypeScript + TanStack Query + Tailwind** — boring SPA; no Next.js because there's no SSR/SEO need on localhost.
- **@react-pdf/renderer in a Node sidecar** — one template system for interactive preview and headless batch (per leverage plan PDF decision); emits real selectable text (ATS-safe).
- **Playwright (Python)** — Tier-2 form-fill and finance-board scrapers; `@playwright/mcp` + real Chrome over CDP for Tier-3.
- **scikit-learn TF-IDF** — JobFunnel's (MIT) dedup design, lifted.
- **jobhive-py + python-jobspy (pip), career-ops providers ported to httpx** — the sourcing tiers, per leverage plan.
- **launchd** — native macOS scheduling for bursts; no daemon frameworks.

---

## 2. Data Architecture

Single database `~/.jobpilot/jobpilot.db` (WAL mode, `busy_timeout=5000`). Large blobs (PDFs, uploads) live in `~/.jobpilot/artifacts/` with paths in the DB. JSON columns are SQLite `TEXT` validated by Pydantic models at the boundary.

**Resume contract:** every resume — parsed master, tailored output, renderer input — is a **JSON Resume** document (Pydantic model `JsonResume` mirroring `@jsonresume/schema`), extended with an `x_jobpilot` namespace: `{persona_id, provenance: [{field, source: master|jd_added, evidence}], version}`. The evaluator's truthfulness check is a structured diff of tailored vs. master JSON, not text comparison.

### 2.1 Schema (DDL sketch; all tables have `created_at`, `updated_at`)

```sql
-- Identity & profile
personas(id PK, name, is_active BOOL, categories JSON,          -- editable category list
         master_resume JSON,                                    -- JSON Resume
         master_cover_letter TEXT, settings JSON)
documents(id PK, persona_id FK, kind CHECK(kind IN ('resume','cover_letter')),
          file_path, parsed_json JSON, parse_status, uploaded_at)

-- Sourcing
jobs(id PK, url UNIQUE, key_id UNIQUE,                          -- sha1(company|title|loc), JobFunnel-style
     source, ats,                                               -- 'greenhouse'|'jobspy_indeed'|'efc_scraper'…
     company, title, location, is_remote BOOL,
     description_md, salary_min, salary_max, salary_currency,
     posted_at, fetched_at, expires_check_at, status CHECK(status IN
       ('sourced','duplicate','expired','archived')),
     raw JSON)                                                  -- provider passthrough
dedup_registry(key_id PK, canonical_job_id FK, duplicate_type   -- 'key_id'|'tfidf'
               , similarity REAL)                               -- persisted forever
job_scores(id PK, job_id FK, persona_id FK, UNIQUE(job_id, persona_id),
           score INT,                                           -- 0-100, cheap-tier LLM
           green_flags JSON, red_flags JSON,                    -- card content
           model, prompt_version, scored_at)
flags(id PK, job_id FK, persona_id FK, UNIQUE(job_id, persona_id),
      flag CHECK(flag IN ('green','yellow','red')), flagged_at, via)  -- 'single'|'bulk'

-- Application pipeline (created on green/yellow flag)
applications(id PK, job_id FK, persona_id FK, UNIQUE(job_id, persona_id),
  status CHECK(status IN ('queued','tailoring','evaluating','approved',
    'awaiting_review',            -- yellow only
    'applying','parked',          -- parked = needs-you queue
    'submitted','confirmed',      -- confirmed = post-submit verification or email receipt
    'rejected_by_user','failed','expired')),
  review_mode CHECK(review_mode IN ('auto','review')),          -- from flag color
  tier_attempted INT, tier_succeeded INT,                       -- 1..4
  tailored_resume JSON, tailored_cover_letter TEXT,
  resume_pdf_path, cover_pdf_path,
  eval_report JSON,                                             -- scorer dims + judge verdict
  eval_iterations INT, result CHECK(result IN
    ('APPLIED','EXPIRED','CAPTCHA','LOGIN_ISSUE','FAILED') OR result IS NULL),
  failure_reason, submitted_at)
stage_events(id PK, application_id FK NULL, job_id FK NULL,     -- append-only audit
  from_status, to_status, actor,                                -- 'system'|'user'|'gmail_router'|agent name
  meta JSON)
needs_you(id PK, application_id FK, reason CHECK(reason IN
  ('CAPTCHA','LOGIN','SSO','QUESTION_UNKNOWN','EVAL_STUCK','OTHER')),
  deep_link, note, resolved_at NULL)

-- Answer bank
answers(id PK, persona_id FK NULL,                              -- NULL = global
  question_norm,                                                -- lowercased, stripped
  question_raw, answer TEXT, source CHECK(source IN ('config','llm','human')),
  ats NULL, times_used INT, last_used_at,
  UNIQUE(persona_id, question_norm))

-- Gmail tracking
email_links(id PK, application_id FK NULL,
  gmail_message_id, account, UNIQUE(account, gmail_message_id), -- idempotency
  subject, from_addr, snippet,
  confidence INT, stage_target,                                 -- router output
  disposition CHECK(disposition IN ('auto_linked','review','orphan','dismissed')))

-- Operations
runs(id PK, kind CHECK(kind IN ('source','apply','gmail','vendor_sync')),
  config_name, params JSON, status CHECK(status IN ('running','done','failed')),
  started_at, finished_at, stats JSON, log_path)
run_configs(id PK, name UNIQUE, kind, params JSON)              -- sources, categories, caps, dry_run…
source_quota(source, day, count, PRIMARY KEY(source, day))      -- rate-limit ledger
locks(domain PK, holder_run_id, acquired_at)                    -- 'apply'|'source'
settings(key PK, value JSON)                                    -- gmail account, notif prefs, llm tier map
```

**Indexes:** `jobs(status, fetched_at)`, `jobs(company, title)`, `job_scores(persona_id, score DESC)`, `applications(status)`, `applications(persona_id, status)`, `stage_events(application_id, id)`, `email_links(disposition)`, `answers(question_norm)`.

**State machines.** `jobs.status` is discovery-only. The pipeline lives on `applications.status`:

```
queued → tailoring → evaluating ─┬→ approved → applying ─┬→ submitted → confirmed
              ▲          │(fail) │(review_mode='review') │→ parked (needs_you) → applying (resumed)
              └──────────┘ ≤3    └→ awaiting_review ─────┤→ failed / expired
                 iterations           │approve → applying│
                                      └reject → rejected_by_user
```
Every transition writes a `stage_events` row; no status is ever updated without one (enforced in one `transition(application, to, actor, meta)` helper — the only code path allowed to touch `status`).

---

## 3. Service Design

All services live in `server/app/services/`; each is a plain class with an explicit interface, constructor-injected DB session and LLM router, unit-testable without the web layer.

| Service | Interface (core methods) | Builds on |
|---|---|---|
| `sourcing.SourcingService` | `run(config) -> RunStats` — fans out to providers, upserts `jobs` | provider registry below |
| `providers.base.Provider` | `fetch(categories: list[str], since: dt) -> list[JobPosting]`; registry via entry-point list `PROVIDERS` | — |
| `providers.ats.*` — `greenhouse.py`, `lever.py`, `ashby.py`, `workable.py`, `smartrecruiters.py`, `workday.py` | public JSON endpoints, httpx, zero auth | **career-ops `providers/*.mjs` ported to Python (MIT)**; company slugs seeded from **jobhive `ats-companies/` CSVs** filtered to US + finance sectors |
| `providers.boards.*` — `remoteok.py`, `adzuna.py`, `usajobs.py`, `themuse.py` | thin API clients (~50 lines each) | `Platforms/job_scanning_apis_repos.csv` facts |
| `providers.jobspy_source.py` | wraps `python-jobspy` (Indeed primary; LinkedIn **read-only sourcing**, never load-bearing, low page cap) | **JobSpy (MIT) as dependency** |
| `providers.finance.*` — `efinancialcareers.py`, `cfa_careers.py` | targeted Playwright scrapers, listing pages only, polite pacing | own code; leverage plan §markets |
| `dedup.DedupService` | `check(job) -> None | DuplicateHit` — key_id exact, then TF-IDF cosine ≥ threshold vs 90-day corpus; writes `dedup_registry` | **JobFunnel `filters.py` design (MIT)** |
| `scoring.ScoringService` | `score(job, persona) -> JobScore` — cheap-tier LLM, JSON schema output `{score, green_flags[], red_flags[]}` | career-ops A–G rubric prompts adapted; runs on Haiku/Flash via LiteLLM |
| `tailoring` → see §4 agents | | **Resume-Matcher services + prompts (Apache-2.0)** |
| `apply.Dispatcher` | `apply(application) -> ApplyResult` — resolves ATS, walks tiers 1→4, enforces pacing + daily caps, writes result taxonomy | ApplyPilot waterfall pattern (reimplemented) |
| `apply.tier1_ats_post` | Greenhouse/Lever/Ashby application POST: fetch form schema (`/jobs/{id}?questions=true` etc.), map fields from persona + answer bank, multipart POST with PDF | own code on documented endpoints |
| `apply.tier2_playwright` | scripted fill for known non-big-3 patterns; selector packs per ATS family; answer bank Q&A flow (see §4.4) | GodsScion two-tier Q&A **design** |
| `apply.tier3_browser_agent` | Agent SDK + Playwright-MCP session in real Chrome/CDP (see §4.3) | ApplyPilot prompt protocol **design** |
| `apply.tier4_handoff` | build prefilled answer sheet + deep link → `needs_you` | own |
| `answers.AnswerBank` | `resolve(question, persona, job) -> Answer` — normalize → exact → fuzzy (rapidfuzz ≥ 90) → LLM(cheap) with profile context → persist as `source='llm'`; unknown-and-risky → raise `NeedsHuman` | GodsScion config-first→LLM-fallback design |
| `gmail.GmailSync` | poll Gmail REST (`q="newer_than:90d (application OR interview OR assessment OR unfortunately)"`), upsert `email_links` idempotently | **job-ops Smart Router design** ported |
| `gmail.SmartRouter` | one cheap-LLM call per email with numbered active-application list → `{bestMatchIndex(1-based), confidence, stageTarget, isRelevant}`; ≥95 auto-advance, 50–94 review, <50 orphan | job-ops design |
| `notify.Notifier` | `notify(title, body, url)` → `osascript display notification`; UI badges read from `/api/counts` | own |
| `runs.RunManager` | `start(kind, params) -> run_id` (subprocess CLI), `status(run_id)`; lock acquisition | own |
| `vendor.VendorSync` | submodule pull + per-file `git log` diff vs `sync_manifest.yaml` → markdown report + notification | vision doc §5 strategy |
| `pdf.PdfRenderer` | `render(json_resume, template) -> pdf_path` — spawns `node pdf-sidecar/render.js`, ≤2 ATS-safe single-column templates | @react-pdf/renderer decision |

**LLM router (`server/app/llm/router.py`).** Single entry `complete(task: TaskName, messages, schema) -> pydantic obj`. A `settings.llm_tiers` map binds task→model chain:

```yaml
cheap:   [anthropic/claude-haiku-4-5, gemini/gemini-flash-latest]   # failover order
agent:   claude-agent-sdk            # writer/evaluator/browser; subscription auth
# future: prepend ollama/qwen2.5:14b to `cheap` — no other change
```
Tasks: `score_job`, `route_email`, `answer_question`, `extract_profile` → `cheap`. `tailor`, `evaluate_judge`, `browser_apply` → `agent`. All prompts are versioned files in `server/app/llm/prompts/` (`score_job.v1.md`…), with `prompt_version` recorded on outputs.

---

## 4. Agent Design

### 4.1 Writer agent (`agents/writer.py`)
Agent SDK session, structured output `TailoredPackage {resume: JsonResume, cover_letter: str, change_log: [{field, action, evidence}]}`.
- Input: persona master JSON Resume, JD text, job metadata, target ATS profile.
- System prompt built from Resume-Matcher's tailoring prompts + `lib_resume_builder_AIHawk` (MIT) section templates.
- Hard rule in-prompt and post-checked: every `change_log` entry must cite `evidence` from the master resume or be tagged `jd_added` (keyword-only additions to skills phrasing, never new employers/titles/dates/degrees).

### 4.2 Evaluator agent (`agents/evaluator.py`)
Two-stage, cheap-first:
1. **Deterministic scorers (pure Python, no LLM)** — ported Resume-Matcher `scorers.py`: structure preservation, fabrication guard (no employers/titles/dates/degrees absent from master), personal-info integrity, JSON Resume validity, JD keyword coverage; weighted per-ATS using ats-screener profiles (Workday/iCIMS/Greenhouse/Lever weights; exact-match bias for legacy ATSs).
2. **LLM judge (agent tier)** — only if deterministic stage passes; Resume-Matcher's "tailoring vs fabrication" judge rubric; structured verdict `{approved: bool, dimension_scores, blocking_issues[]}`.

**Loop:** writer → evaluator; on rejection, blocking_issues feed back to writer. `eval_iterations ≤ 3`, then `needs_you(reason='EVAL_STUCK')`. Fabrication-guard failures are never auto-retried past once — they park immediately.

### 4.3 Browser-apply agent (`agents/browser_apply.py`) — Tier 3
Agent SDK session with Playwright-MCP attached to **real Chrome over CDP** (user profile = existing logins).
- **Protocol (ApplyPilot design, upgraded):** context pack = job + persona profile + tailored PDF path + answer bank snapshot. Agent navigates, reads accessibility snapshots, fills fields — **no per-ATS selectors**.
- **3-tier question policy:** (a) hard facts only from profile/answer bank — never invented; (b) in-domain skill yes/no → answer from resume evidence; (c) open-ended → 2–3 sentences referencing the JD.
- **Safety stops (immediate park, no retry):** SSN/national-ID, payment details, SSO/account-creation walls, biometric/ID upload, CAPTCHA.
- **Structured result:** `{result: APPLIED|EXPIRED|CAPTCHA|LOGIN_ISSUE|FAILED, reason, confirmation_text, screenshot_path, new_answers[]}` — SDK structured output, not string markers. `new_answers` are persisted to the answer bank as `source='llm'` for review.
- **Post-submit verification:** snapshot must contain a confirmation signal before `result=APPLIED`; otherwise `FAILED:unverified`.
- Dry-run mode: fills everything, stops before final submit, screenshots.

### 4.4 Tier-2 Playwright Q&A flow
Deterministic form walk; each encountered question goes through `AnswerBank.resolve`. `NeedsHuman` (sensitive/unknown-high-stakes) → park with the partially-saved state noted. Every asked question — answered or not — is recorded, so the bank converges toward full coverage.

---

## 5. Frontend Design

SPA served by FastAPI at `/`. Pages:

| Page | Route | Key elements |
|---|---|---|
| Onboarding | `/onboarding` | upload resumes/CLs (multi), parse preview, proposed categories per persona (editable chips), persona creation (2–3) |
| Card Feed | `/` | persona switcher; opportunity cards: title/company/salary/score + green_flags/red_flags lists; per-card **Green / Yellow / Red** buttons; **checkbox multi-select + select-all-filtered** with bulk flag bar; filters (score≥, source, date, category) |
| Review Queue | `/review` | yellow-flagged approved apps: **final PDF (inline viewer) + all screening answers**; Approve→applying / Edit answers (inline, persists to answer bank as `source='human'`) / Reject |
| Tracker | `/tracker` | kanban by `applications.status` (+ email-derived stages); job drawer = artifacts, stage_events timeline, email links |
| Needs You | `/needs-you` | parked items grouped by reason, deep links, resolve buttons; email router review pile (50–94 confidence) |
| Run Panel | `/runs` | run-now buttons (source/apply/gmail); advanced form → `run_configs` (sources multi-select, categories, volume caps, dry_run toggle); live run log tail; history |
| Settings | `/settings` | personas CRUD + master resume editor (JSON Resume form), answer bank table, LLM tier map, Gmail connect (OAuth), notification prefs, launchd schedule editor |

**State:** TanStack Query against REST; no client state library (server is source of truth, localhost latency ~0). Poll `/api/counts` every 30s for badges (new cards, review pending, needs-you, orphan emails).

**API contract (`/api/*`, JSON):**
```
POST /api/onboarding/documents           multipart upload → parse job
GET  /api/personas · POST/PATCH/DELETE /api/personas/{id}
GET  /api/cards?persona_id&min_score&source&flagged=false&limit&offset
POST /api/flags                          [{job_id, persona_id, flag}] (bulk-capable)
GET  /api/review                         awaiting_review list
GET  /api/applications/{id}              full detail incl. pdf urls, answers, eval_report
POST /api/applications/{id}/approve | /reject
PATCH /api/applications/{id}/answers     edit before approve
GET  /api/tracker?persona_id             kanban payload
GET  /api/needs-you · POST /api/needs-you/{id}/resolve
GET  /api/emails?disposition=review · POST /api/emails/{id}/link {application_id} | /dismiss
POST /api/runs {kind, config_name?, params?} · GET /api/runs/{id} · GET /api/runs/{id}/log
GET  /api/counts
GET/PUT /api/settings/{key} · answers CRUD under /api/answers
GET  /api/artifacts/{path}               PDFs (localhost only)
```

---

## 6. End-to-End Flows

**(a) Morning burst → cards.** launchd → `jobpilot run source --config morning` → acquire `source` lock → `SourcingService` fans out per enabled provider honoring `source_quota` → each posting: upsert `jobs` by URL → `DedupService.check` (duplicates recorded, skipped) → new jobs scored per active persona (cheap tier, batched) → `job_scores` written → lock released, `runs.stats` saved → `Notifier`: "23 new cards (7 score ≥ 80)". UI shows them on next badge poll.

**(b) Green flag → submitted.** `POST /api/flags {flag:'green'}` → create `applications(status=queued, review_mode=auto)`. Evening burst (or run-now): writer→evaluator loop (§4.1–4.2) → `approved` → PDF rendered via sidecar → `apply.Dispatcher`: resolve ATS from `jobs.ats` → **Tier 1** if greenhouse/lever/ashby (form schema fetch → answer bank map → POST with PDF; 2xx + confirmation body → `submitted`) → else/failure-retriable → **Tier 2** Playwright pack → else → **Tier 3** browser agent → else → **Tier 4** handoff (park). Each attempt: `tier_attempted` set, stage_events written, pacing delay (jittered, per §7) before next application.

**(c) Yellow flag review.** Same until `approved`, then → `awaiting_review` + notification. User opens `/review`: PDF + answers → Approve (→ `applying`, same waterfall) / Edit answers then approve / Reject (→ `rejected_by_user`, red-flag signal recorded for learning loop).

**(d) CAPTCHA parking.** Tier 2/3 hits CAPTCHA/login wall → tier executor returns `CAPTCHA|LOGIN_ISSUE` → `status=parked`, `needs_you` row with deep link + reason → macOS notification "1 application needs you" → user clears it in Chrome, clicks Resolve → `applying` re-enters waterfall at the same tier (attempt counter respected).

**(e) Gmail auto-advance.** 2-hourly sync → new messages upserted (idempotent on `(account, gmail_message_id)`) → `SmartRouter` per message with numbered active-application list → conf ≥ 95: link + `transition(app, stageTarget, actor='gmail_router')` (e.g. `submitted→confirmed`, or interview stage on tracker) + notification "Interview detected: {company}"; 50–94: review pile in `/needs-you`; <50: orphan (browsable, dismissable).

---

## 7. Failure Handling & Guardrails

**Failure taxonomy.** *Retriable*: network errors, 429/5xx, LLM provider failover exhausted-then-recovered, Playwright timeouts (≤2 retries, exponential + jitter). *Permanent*: `EXPIRED` (posting gone — liveness check before tailoring, career-ops pattern), 4xx form rejection after 1 retry, fabrication-guard hard fail. *Human-gated*: CAPTCHA, LOGIN_ISSUE, SSO, sensitive question, EVAL_STUCK → always `parked`, never silent.

**Rate limiting & pacing.** Config defaults: `max_apps_per_day=40`, `max_apps_per_ats_domain_per_day=5`, inter-application delay 90–300s jittered, sourcing per-provider QPS caps in provider classes, JobSpy LinkedIn page cap = 3 (read-only, best-effort). All enforced in `Dispatcher`/`SourcingService` against `source_quota`; hitting a cap defers to the next burst, never drops.

**LLM degradation.** LiteLLM failover within `cheap` chain (Haiku→Flash); if the whole chain is down, scoring/routing jobs stay queued with `runs.status=failed` + notification — never skipped-and-forgotten. If Agent SDK quota is exhausted mid-burst, remaining `approved` apps stay queued; nothing downgrades tailoring to the cheap tier silently.

**Safety invariants.** (1) No submit without `eval_report.approved=true` and `result` verification. (2) Fabrication guard is deterministic code, not prompt-only. (3) `UNIQUE(job_id, persona_id)` on applications + dedup registry + pre-submit "already applied to this company+title in 90d?" check = no double-applies. (4) Sensitive data (SSN, payments) is a hard stop by construction — fields don't exist in the schema. (5) `dry_run` runs the full pipeline through Tier-2/3 form-fill screenshots without submitting. (6) Gmail scope is `gmail.readonly`; token in macOS Keychain via `keyring`. (7) Everything binds to `127.0.0.1`.

---

## 8. Build Order — Milestones (map to Vision §3 MVP features 1–8)

| M | Scope (features) | Acceptance criteria |
|---|---|---|
| **M0** | Skeleton: repo, `jobpilot` CLI, FastAPI, Alembic schema §2, React shell, launchd install script | `jobpilot serve` up; schema migrated; empty card feed renders |
| **M1** | Onboarding (F1, F2): upload/parse to JSON Resume (heuristics + cheap-LLM fallback), persona CRUD, category proposal/editing | 2 real resumes parse to valid JSON Resume; categories editable; personas persisted |
| **M2** | Sourcing T1 + dedup (F3, part F10): greenhouse/lever/ashby/workable/smartrecruiters/workday providers + remoteok/adzuna/usajobs + jobhive slugs; JobFunnel-style dedup | Morning run yields ≥100 unique US/finance jobs; rerun creates 0 dupes; quota ledger populated |
| **M3** | Scoring + cards + flags (F4): cheap-tier scoring, card feed UI, green/yellow/red, bulk multi-select, macOS notifications | Cards show flags text; select-all-filtered + bulk-green works; score visible; notification fires |
| **M4** | Tracker (F5): kanban, stage_events timeline, artifacts drawer | Every flag/status change appears on board and in timeline; no orphan transitions (audit test) |
| **M5** | Writer + evaluator + PDF (F6, F7): agents §4.1–4.2, sidecar render, review queue for yellow | Tailored PDF from JSON Resume for a green job; fabricated-employer test case is blocked deterministically; ≤3-iteration loop; yellow shows PDF+answers |
| **M6** | Tier-1 apply + answer bank (F8, F9): Greenhouse/Lever/Ashby POST, `AnswerBank.resolve`, pacing/caps, dry-run | Dry-run submits verified payloads to 3 real postings' form schemas; one live application submitted and `confirmed` via follow-up email; answers persisted/reused |
| **M7** | Gmail Smart Router (F16 pulled into MVP per locked decision 9) | Real inbox: interview email auto-advances correct application ≥95 conf; ambiguous email lands in review pile; sync idempotent across reruns |
| **M8** | Tiers 2–4 + needs-you (F12–F14): Playwright pack, browser agent, handoff, CAPTCHA parking | Non-big-3 posting applied via Tier 2; a Workday posting completes via Tier 3 in dry-run; CAPTCHA parks + notifies + resumes |

Post-MVP backlog (vision F11 vendor-sync watcher → then F15, F17–F22) unchanged.

---

## Appendix A — Architect's Discretion (decisions not covered by the locked list)

1. **SQLAlchemy 2 + Alembic** over raw SQL — migration safety for a schema this wide; boring/proven.
2. **Server always-on, work in bursts** — locked decision 10 says scheduled bursts; I kept a lightweight always-on FastAPI LaunchAgent anyway so run-now, badges, and the review queue work at any hour. Compute-heavy work still only happens in bursts.
3. **Applications are persona-scoped with `UNIQUE(job_id, persona_id)`** — two personas *may* both flag one job, but the pre-submit same-company guard (§7) blocks double-submitting; first submit wins, second parks with a warning.
4. **Cheap-tier default order Haiku→Flash** (not Flash→Haiku): consistent JSON adherence ranked above free-tier cost since Haiku rides existing billing; flip in `settings.llm_tiers` if you prefer strictly-free-first.
5. **rapidfuzz** for answer-bank fuzzy matching (MIT, boring).
6. **Prompt files versioned on disk** with `prompt_version` stamped on all outputs — needed later by the flag-feedback learning loop (F19) to A/B scoring prompts.
7. **90-day TF-IDF corpus window** for near-dup detection — balances repost catching vs. index size; configurable.
8. **Gmail poll every 2h within 08:00–20:00** — matches burst cadence; push (Pub/Sub) rejected as it needs a cloud project endpoint, violating local-only.
9. **Tier-3 uses your real Chrome profile** (existing logins reduce LOGIN_ISSUE parks) — implies Tier-3 runs only while you're not actively using that Chrome profile; evening burst timing mitigates.
10. **Finance niche boards in MVP are listing-source only** (EFC/CFA scraped for *discovery*; applications route to the employer's own ATS) — applying *through* those boards is post-MVP.
