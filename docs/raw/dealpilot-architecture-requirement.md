---
title: DealPilot — Architecture (verbatim user requirement)
type: raw
doc_kind: requirement
status: active
companions: [tool-standardization-plan.md]
related_wiki: ../wiki/tools.md
updated: 2026-07-03
tags: [dealpilot, tools, requirement]
---

# DealPilot — System Architecture
### End-to-end architecture for the multi-tenant ETA deal platform

**Status:** Draft v0.1 — 2026-07-04
**Companion docs:** [ETA-DealFlow-Vision.md](ETA-DealFlow-Vision.md) (product spec v0.2) · [ETA-Deal-Sources.md](ETA-Deal-Sources.md) (source inventory)

---

## 1. Requirements Recap

**Functional (from vision v0.2):**
- F1. Track user-added source URLs + pre-built connectors on per-source schedules; normalize + dedupe into canonical deals
- F2. RYG triage with permanent, dedupe-aware discard; thesis scoring
- F3. Instant deal briefs; regenerate-on-new-data with diffs
- F4. Enrichment waterfall (free → forms → email → browser agent → human task) with per-user budgets
- F5. Inbound email/document parsing → living profile with per-cell provenance and page-level citations
- F6. Deep-dive analysis with interactive add-backs; industry playbooks; verdict
- F7. Field-level flags (context-inferred: company-data vs AI-analysis sections) feeding thesis model + eval sets
- F8. Outreach sequences from user's own Gmail/O365; broker CRM; Cal.com scheduling; call recording/transcription (Phase 3)
- F9. Credits metering + subscription tiers; funnel dashboard; investor updates

**Non-functional:**
- N1. Multi-tenant SaaS, single-region US, day one
- N2. Listing → triaged card < 24h; green flag → CIM request < 1h; docs → draft report < 48h
- N3. Cost discipline: LLM + proxy spend must be metered per action and attributable per tenant/deal
- N4. Solo-founder buildable/operable: minimal distinct runtimes, managed services, boring choices
- N5. Scrape resilience: one blocked connector must not cascade; extractor breakage must be detected, not silent
- N6. Trust: every AI-visible figure traceable to a source; no silent merges

**Scale assumptions (design targets, first 12 months):**
- 50–500 tenants; ~100K active canonical deals; 500–1,000 tracked sources; ~5–20K new/changed listings per day platform-wide
- Per tenant: dozens of green deals in flight, dozens of emails/week — *low-velocity, high-value* workflows. This is a data-pipeline + workflow product, not a high-QPS product. Optimize for correctness, observability, and cost attribution over throughput.

---

## 2. High-Level Design

**Stack decision:** Next.js (Vercel) + Supabase (Postgres/pgvector/Auth/Storage/RLS) + **Trigger.dev** (durable jobs/workflows, TypeScript) + one **containerized worker pool** (Fly.io or Railway) for crawling/browser-agent work + Claude API via Agent SDK. Stripe for billing. One language (TypeScript) end to end, Python only if a parsing library forces it (Docling runs as a small containerized service).

```
                                ┌───────────────────────────────────────────────┐
                                │                  Next.js app (Vercel)         │
                                │  triage UI · profiles · reports · sequences   │
                                │  settings · billing · funnel dashboard        │
                                └───────▲──────────────────────────┬────────────┘
                                        │ RSC / API routes         │ enqueue
                                        │                          ▼
┌──────────────┐   webhooks   ┌─────────┴─────────┐      ┌──────────────────────┐
│ Gmail/O365   ├─────────────►│  Supabase          │◄────►│  Trigger.dev          │
│ Cal.com      │              │  Postgres+pgvector │      │  (durable workflows)  │
│ Stripe       │              │  Auth · Storage    │      │  crawl orchestration  │
│ Recall.ai    │              │  RLS multi-tenant  │      │  waterfall · sequences│
└──────────────┘              └─────────▲──────────┘      │  parse · analyze      │
                                        │                 └──────────┬───────────┘
                                        │ results                    │ dispatch heavy jobs
                              ┌─────────┴──────────────────────────── ▼──────────┐
                              │        Worker pool (Fly.io containers)           │
                              │  Crawlee/Playwright crawlers (+ residential      │
                              │  proxies) · browser-use/Stagehand agent tier ·   │
                              │  Docling parse service                           │
                              └──────────────────────────────────────────────────┘
```

### Subsystem map

| # | Subsystem | Runs on | Core job |
|---|---|---|---|
| S1 | Source Registry & Scheduler | Trigger.dev cron → Postgres | Per-source crawl schedules, health, backoff |
| S2 | Crawl & Extract | Worker pool | Fetch pages, template-detect, extract raw listings |
| S3 | Normalize & Dedupe | Trigger.dev jobs | Canonical `deal` records, cross-source merge, change events |
| S4 | Thesis Scoring & Triage | Postgres + small LLM calls | ThesisFit score, card one-liners, RYG state |
| S5 | Waterfall Orchestrator | Trigger.dev workflows | Per-green-deal enrichment state machine with budgets |
| S6 | Email Hub | Gmail/MSFT APIs + Trigger.dev | OAuth send/receive, alert parsing, deal-matching, sequences |
| S7 | Document Pipeline | Storage + Docling service + Claude | PDF/XLSX → cited, schema'd extractions → review queue |
| S8 | Profile Store | Postgres | Field values with provenance; the living profile |
| S9 | Analysis Engine | Claude Agent SDK via Trigger.dev | Briefs, deep-dives, playbooks, add-back sessions, artifacts |
| S10 | Feedback & Evals | Postgres + eval harness | Flags → thesis model + eval cases; playbook regression |
| S11 | Engagement | Cal.com + Recall.ai + Sendblue (P3) | Scheduling, recording/transcription, iMessage |
| S12 | Billing & Credits | Stripe + Postgres ledger | Tiers, metered credits, per-action cost attribution |

---

## 3. Data Model (Postgres, all tables tenant-scoped via RLS)

The spine is five tables: `sources → listings → deals → deal_facts → analyses`, with `events` as the universal log.

```sql
-- Tenancy
tenants(id, name, plan, created_at)
users(id, tenant_id, email, role)
thesis_profiles(id, tenant_id, target_statement, industries jsonb, sde_min, sde_max,
                geo jsonb, revenue_prefs jsonb, funding jsonb, version, created_at)

-- S1 Sourcing
sources(id, tenant_id NULL,            -- NULL = shared/global connector
        kind ENUM(connector, custom_url, email_alert, byo_account),
        url, connector_key, crawl_frequency interval, extractor_id,
        health ENUM(ok, degraded, broken), last_crawl_at, last_yield int)
extractors(id, source_id, strategy ENUM(template, llm_generated, api, email_parser),
           template_key, selector_config jsonb, version, success_rate)
crawl_runs(id, source_id, started_at, finished_at, pages int, listings_found int,
           listings_changed int, status, error, cost_cents)

-- S2/S3 Listings → Deals
listings(id, source_id, external_id, url, raw jsonb, content_hash,
         first_seen_at, last_seen_at, delisted_at)
deals(id, canonical: name_norm, ask_price, revenue, sde, ebitda, multiple,
      naics, industry_label, geo geography, has_real_estate bool,
      broker_id, embedding vector(1024), status_global, created_at)
deal_listings(deal_id, listing_id, matched_by ENUM(exact, fuzzy, embedding, manual),
              confidence)                       -- N listings : 1 deal
deal_states(tenant_id, deal_id,                 -- per-tenant lifecycle!
            state ENUM(sourced, green, yellow, red, enriching, profiled,
                       analyzed, engaged, decision),
            thesis_fit numeric, discard_reason, updated_at,
            PRIMARY KEY (tenant_id, deal_id))
brokers(id, name, firm, email, phone, source_urls jsonb, response_stats jsonb)

-- S7/S8 Documents & Profile
documents(id, tenant_id, deal_id, kind ENUM(cim, pnl, tax_return, lease, email, transcript, other),
          storage_path, pages int, sha256, received_via, received_at)
extractions(id, document_id, schema_key, payload jsonb, confidence,
            citations jsonb,                    -- [{page, bbox?, quote}]
            review_status ENUM(auto_accepted, needs_review, accepted, rejected))
deal_facts(id, tenant_id, deal_id, section, field_key, value jsonb,
           provenance ENUM(listing, document, broker_email, seller_stated,
                           public_record, ai_inferred, user_entered),
           source_ref jsonb,                    -- {document_id, page} | {listing_id} | {call_id}
           confidence, superseded_by, created_at)   -- append-only; latest-wins view

-- S9 Analysis
analyses(id, tenant_id, deal_id, kind ENUM(instant_brief, deep_dive, qoe_lite,
         credibility_book, loi_draft, investor_update, call_prep),
         playbook_key, playbook_version, status, verdict ENUM(pass, conditional, pursue),
         content jsonb,                         -- sectioned; each block tagged data|analysis
         input_facts_snapshot jsonb, cost_cents, created_at)
addback_items(id, analysis_id, label, amount_cents, year, citation jsonb,
              ai_classification ENUM(legitimate, suspicious, personal, one_time),
              user_decision ENUM(accepted, rejected, adjusted), adjusted_amount_cents)

-- S10 Feedback
flags(id, tenant_id, deal_id, target ENUM(card, fact, analysis_block, addback),
      target_ref jsonb, color ENUM(green, red),
      semantic ENUM(company_eval, ai_quality),  -- derived from section context
      note, created_at)
eval_cases(id, playbook_key, source_flag_id, input jsonb, expected jsonb, created_at)

-- S5/S6 Waterfall & Outreach
waterfall_runs(id, tenant_id, deal_id, config jsonb, current_tier, status,
               budget_cap_cents, spent_cents, next_action_at)
sequences(id, tenant_id, deal_id, template_key, steps jsonb, status, paused_reason)
messages(id, tenant_id, deal_id, sequence_id NULL, direction, channel ENUM(email, sms, imessage),
         provider_msg_id, thread_key, subject, body_ref, matched_confidence, sent_at)
calls(id, tenant_id, deal_id, cal_booking_id, scheduled_at, recording_ref,
      transcript_ref, consent jsonb, prep_analysis_id)

-- Universal
events(id, tenant_id, deal_id NULL, actor ENUM(user, system, agent),
       type text, payload jsonb, created_at)    -- funnel + timeline + audit = queries here
credit_ledger(id, tenant_id, delta int, action_type, ref jsonb,
              underlying_cost_cents, created_at)
```

**Design notes:**
1. **Global deals, per-tenant state.** Listings and canonical deals are shared platform-wide (crawl once, serve all tenants — this is the aggregator economics). Everything judgment-shaped (`deal_states`, `deal_facts`, `flags`, `analyses`, documents) is tenant-scoped. A tenant's red flag hides the deal *for them* only; their CIM stays theirs.
2. **`deal_facts` is append-only with provenance** — the "living profile" is a latest-wins view; history is free; "SDE revised $392K → $410K after CIM p.14" diffs are a two-row comparison.
3. **Flag semantics are structural**: report/profile content blocks carry `data|analysis` tags (Module E/F layout), so `flags.semantic` derives from the flagged block — the context-inference decision, enforced in the schema.
4. **RLS everywhere** with `tenant_id` from the JWT; global tables (`deals`, `listings`) are read-only to clients through views that join `deal_states` (so discarded deals never leave the database).

---

## 4. Subsystem Deep Dives

### S1–S2. Sourcing: Registry, Scheduler, Crawl & Extract

**Scheduler:** a Trigger.dev cron (every 5 min) selects due sources (`last_crawl_at + crawl_frequency < now`), applies per-domain concurrency caps and backoff (broken sources get exponential cool-down + user notification), and enqueues crawl jobs to the worker pool. Per-source frequency is user-editable (F1).

**Crawl workers (Fly.io containers, Crawlee + Playwright):**
- Tiered fetch strategy per source: plain HTTP → headless → headless + residential proxy (Bright Data/IPRoyal), recorded per source so we always use the cheapest working tier. BizBuySell (Akamai) pins to the proxy tier; BusinessBroker.net runs on plain HTTP.
- BYO-account connectors run in isolated browser contexts with tenant-supplied credentials (encrypted at rest in Supabase Vault, injected at runtime, never logged).

**Extractor engine — the hero feature's core:**
1. On user URL submission: fetch sample pages → **template detection** against known broker-CMS fingerprints (BrokerWorks embeds, Deal Studio, common WP themes ≈ 6 templates cover most broker sites) → if matched, instantiate config-only extractor.
2. No template match → **LLM-generated extractor**: Claude examines the DOM, emits a selector/pagination config, which is validated against 3 sample pages before activation. Failures fall back to per-page LLM extraction (crawl4ai-style, expensive → flagged for extractor synthesis retry).
3. **Health monitoring:** every crawl compares yield vs trailing average; schema-validation failure rate > threshold → source marked `degraded`, extractor re-synthesis queued, user notified. No silent breakage (N5).
4. Custom sources with ≥N tenants tracking the same domain graduate to shared connectors (dedupe crawl cost, network effect).

**Email-alert parser** is just another extractor strategy: inbound alert emails (S6) route to a parser keyed by sender domain; output lands in the same `listings` table.

### S3. Normalize & Dedupe

Pipeline per new/changed listing (Trigger.dev job):
1. Normalize to canonical schema (money parsing, NAICS classification via embedding-nearest + LLM tie-break, geo geocoding).
2. Content-hash diff → skip unchanged (cheap idempotency).
3. **Dedupe cascade:** (a) exact keys (broker + external id, phone, normalized URL) → (b) blocking on {state, price band, NAICS-2} then fuzzy match on financial triple (ask/revenue/SDE ±5%) + geo proximity → (c) description-embedding cosine > 0.92 within block. Above high threshold: auto-merge into existing `deal` (new `deal_listings` row + `deal.updated` event). Gray zone: `dedupe_review` queue. Below: new deal.
4. Change events (price drop, relist, delist) emitted for watchlist alerts and discard-suppression (a red-flagged deal that reappears on a new source merges into the discarded deal and stays hidden — F2's guarantee lives here).

### S4. Thesis Scoring & Triage

- **ThesisFit v1 (deterministic + cheap):** rule score from the thesis profile (industry/size/geo/revenue-quality matches) + small-model one-liner generated only for above-threshold deals (cost control: don't narrate deals the user will never see).
- **ThesisFit v2 (learned, Phase 3):** logistic model per tenant over deal features, trained on triage outcomes + company-eval flags + discard reasons; ships as *re-ranking* plus "proposed filter refinements" — never silently changes filters.
- Triage UI reads a materialized per-tenant feed view; RYG actions are optimistic UI → `deal_states` upsert + event.

### S5. Enrichment Waterfall

A Trigger.dev **durable workflow per green deal** — this is why we want real workflow primitives (long waits, retries, human-in-loop) rather than cron-glue:

```
green_flag → waterfall.start(deal, config)
  tier1 free:    listing extras · website scrape · Google Places · public records   [parallel, cheap]
  tier2 forms:   platform "request info" auto-fill + NDA e-sign        [browser agent, small credit]
  tier3 email:   CIM request from user inbox (credibility book attached)
                 └─ wait_for_event(inbound_matched | 4d timeout) → polite follow-up ×2
  tier4 browser: portal login/download via agent worker              [credit-metered]
  tier5 human:   task card + broker-call script → wait for user
exit conditions: data_completeness ≥ threshold | budget_cap | user_stop
```

- Config (tier order, caps, timeouts) stored per tenant, overridable per deal; every tier emits cost to `credit_ledger` **before** running (reserve → settle pattern so budgets can't overshoot).
- `wait_for_event` resumes on S6's inbound-match events — the workflow is the state, no separate status table drift.

### S6. Email Hub

- **OAuth connections:** Gmail API (watch/history) + Microsoft Graph (delta) per user; refresh handled centrally; scopes: read + send + modify-labels. Verification note: Google restricted-scope review takes weeks — start it at project kickoff.
- **Outbound:** sequence steps render templates (profile + credibility-book merge fields) → create-draft-or-send via the *user's* account; first-contact steps default to `requires_approval` (draft surfaced in UI).
- **Inbound routing:** webhook/delta → classify: (a) source alert → S2 email-parser; (b) deal correspondence → **matching cascade**: thread-key → broker email → listing reference/LLM match. High confidence: auto-attach to deal timeline, resume waiting workflows, pause sequence on reply. Low confidence: match-review queue (N6: no silent merges).
- Attachments → S7 with `deal_id` from the match.

### S7. Document Pipeline

```
attachment/upload → Supabase Storage → Docling service (container): PDF/XLSX →
structured blocks + page anchors → Claude extraction per schema_key
(zod schemas: cim_summary, pnl_multi_year, addback_schedule, customer_concentration,
 lease_terms, tax_return) → extractions rows with citations[{page, quote}] →
confidence gate → auto_accept | review_queue → accepted facts upsert into deal_facts
```

- Page-level citations are non-negotiable (N6): the extraction prompt requires quote + page per figure; uncited values get `ai_inferred` provenance and depressed confidence.
- Reference implementations to mine: `ttulttul/llm-diligence` (schema-per-doc-type pattern, MIT), `zoharbabin/due-diligence-agents` (multi-domain agents + citations, Apache-2.0).
- XLSX P&Ls bypass Docling (parse directly), keeping the happy path cheap.

### S8–S9. Profile & Analysis Engine

- **Instant brief:** template + single Claude call over listing-tier facts; regenerated on `deal_facts` change with section-level diffing (compare against `input_facts_snapshot`).
- **Deep dive:** Claude Agent SDK run orchestrated by Trigger.dev; playbook = versioned prompt-pack (`playbooks/{naics-group}/{version}/…` in repo) selecting section prompts, benchmarks, and required facts. Pipeline: completeness check → seller-qualification header (soft gate warning) → section agents over the fact store + document vault (citations only) → **add-back session**: extracted `addback_items` rendered interactively; valuation/DSCR compute *client-side* from accepted items (live recompute without LLM round-trips) → verdict + open questions → artifacts (call prep, credibility book, QoE-lite, LOI draft reuse the same fact store).
- Every content block carries `{kind: data|analysis, fact_refs[], citations[]}` — powering both the two-layer UI and flag semantics.
- **Cost controls:** facts-snapshot pattern enables targeted section re-runs (only sections whose fact_refs changed); per-analysis token budget; model tiering (Haiku-class for extraction/classification, frontier model for analysis sections).

### S10. Feedback & Evals

- `ai_quality` flags → auto-materialize `eval_cases` (input snapshot + flagged output). Playbook changes run against accumulated cases in CI before version bump (promptfoo or a thin custom harness). Per-playbook quality dashboard = flags over analyses by version.
- `company_eval` flags + triage outcomes → nightly per-tenant thesis-model refresh (S4 v2).

### S11. Engagement

- **Cal.com** (hosted v1; self-host later if unit economics demand): booking webhook → `calls` row + call-prep analysis job + calendar event.
- **Recording/transcription (Phase 3):** Recall.ai meeting bot (Zoom/Meet/phone) or Twilio conference recording → WhisperX/Deepgram transcript → S7 as `transcript` document → facts with `seller_stated` provenance; consent captured in booking flow (two-party states).
- **iMessage (Phase 3):** Sendblue/LoopMessage behind a `channel=imessage` provider interface; warm contacts only + human approval enforced at the sequence-step level; Twilio SMS fallback shares the interface.

### S12. Billing & Credits

- Stripe subscriptions (tiers) + `credit_ledger` as the source of truth (Stripe meters are a projection of it). Every metered action follows **reserve → execute → settle** with `underlying_cost_cents` recorded (N3) — gross margin per action type is a query, and runaway agent loops hit the reservation wall, not the credit card.

---

## 5. API Surface (representative)

Next.js route handlers + server actions; JSON; Supabase JWT auth; tenant from token.

```
POST /api/sources                    {url, frequency}        → extractor synthesis kickoff
GET  /api/feed?state=sourced&sort=thesis_fit                 → triage feed (paginated)
POST /api/deals/:id/triage           {color, reason?}        → state change + waterfall on green
GET  /api/deals/:id/brief            → latest instant brief (+ ?diff=prev)
POST /api/deals/:id/analyses         {kind, playbook?}       → credit reserve + job enqueue
POST /api/analyses/:id/addbacks/:item {decision, amount?}    → recompute inputs
POST /api/flags                      {target, target_ref, color, note?}
POST /api/deals/:id/waterfall        {config?}  · GET status
POST /api/sequences                  {deal_id, template_key} · POST /:id/pause
GET  /api/funnel?period=q            → benchmark dashboard data
Webhooks: /wh/gmail /wh/msgraph /wh/calcom /wh/stripe /wh/recall
```

---

## 6. Security & Compliance

- RLS on every tenant table; global listing data exposed only via state-joined views. Service-role access confined to Trigger.dev tasks.
- Secrets: tenant OAuth tokens + BYO-account credentials in Supabase Vault (encrypted), runtime-injected, log-scrubbed.
- CIMs are under NDA: documents bucket is tenant-private, no cross-tenant reuse of document-derived facts (only listing-tier data is shared), signed URLs, at-rest encryption, deletion honored end-to-end (storage + extractions + facts) for offboarding.
- Scrape posture per source recorded (public/alert/BYO); BYO risk sits with user credentials by design; robots/rate policies enforced per domain centrally.
- Call recording: consent record stored per call; recording disabled unless consent captured.

---

## 7. Scale, Reliability, Cost

**Load sketch:** 1K sources × ~daily crawl ≈ 50–100K pages/day → a handful of always-on Fly workers (burst horizontally; crawls are embarrassingly parallel per source). 20K listing-changes/day → trivial for Postgres. LLM spend is the real budget line: extraction ~$0.001–0.01/listing on small models; deep dives $1–5 each on frontier models — hence credits.

**Reliability posture:** Trigger.dev gives retries/idempotency/long-waits out of the box; workers are stateless (all state in Postgres/Storage); per-connector circuit breakers (N5); dedupe and email matching prefer review queues over wrong merges. Backups: Supabase PITR. SLO monitors: feed freshness per source, inbound-email match latency, analysis job success rate, per-action gross margin. Sentry + Trigger.dev run views + a `crawl_runs`/`events`-backed internal ops dashboard.

**Failure domains kept separate:** crawl pool ▸ workflows ▸ app ▸ email hub. A proxy-provider outage degrades freshness only; Gmail API quota issues pause sequences only.

---

## 8. Key Trade-offs

| Decision | Chosen | Over | Why / cost accepted |
|---|---|---|---|
| Workflow engine | Trigger.dev | Temporal (power), n8n (speed), Inngest | TS-native, durable waits + human-in-loop, low ops for solo founder. Revisit at Temporal if workflow volume/complexity explodes. |
| Shared deals, tenant states | Global crawl once | Per-tenant crawling | Aggregator economics + network effect; cost: RLS/view discipline so tenant judgments never leak. |
| `deal_facts` append-only EAV-ish | Flexible provenance/history | Wide typed columns | Schema evolves per industry playbook without migrations; cost: latest-wins views + jsonb validation via zod at the boundary. |
| Extractor synthesis (template → LLM-generated → per-page LLM) | Adaptive | Hand-written scrapers per site | Hero feature requires it; cost: validation harness + health monitoring complexity. |
| User's own Gmail/O365 | Authenticity | Platform mailboxes | Broker trust is the product; cost: OAuth review process, per-provider API quirks, restricted-scope audit. |
| Buy: Cal.com hosted, Recall.ai, Sendblue, Bright Data, Stripe | Speed | Self-host/build | Solo founder (N4); each sits behind a provider interface for later swap. |
| Client-side valuation recompute on add-back decisions | Instant UX | Server re-analysis | Deterministic math (DSCR/multiples) doesn't need an LLM; cost: duplicated formula code, mitigated by a shared TS package. |
| Monorepo TS + Docling sidecar | One runtime | Python data stack | N4; Python confined to one stateless container. |

## 9. Revisit Triggers

- **>2K sources or per-minute freshness demands** → dedicated crawl scheduler (queue-per-domain, Redis) replacing cron-select.
- **Thesis model** outgrowing logistic re-ranking → feature store + proper training pipeline.
- **Teams/multi-seat tenants** → roles, shared pipelines, assignment (schema already tenant-first; add `assigned_to`).
- **Enterprise/off-market phase** → separate ingestion lane for SBA FOIA/SoS/UCC bulk data (different shape: universes, not listings).
- **Trigger.dev limits** (fan-out scale, workflow versioning pain) → Temporal migration; keep workflows thin/deterministic now to preserve that option.
- **Document volume** or multi-region → move parsing to queue-fed autoscaling workers; Storage → S3 + CDN.

---

## 10. Build Order (maps to vision Phases)

1. **Walking skeleton:** Supabase schema (spine tables) + Next.js shell + Trigger.dev wired + one easy connector (BusinessBroker.net) → listings → dedupe → feed → RYG triage. *Proves S1–S4 end to end.*
2. Custom Source Tracker (template detect + LLM extractor synthesis + health), BizBuySell (proxy tier), email-alert parser, instant briefs, thesis onboarding, Stripe tiers.
3. Email Hub (OAuth send/receive, matching) + waterfall tiers 1–3 + document pipeline + living profile. *Green flag → CIM in profile.*
4. Deep-dive engine + interactive add-backs + flags/evals + credits metering + Cal.com. *The flagship artifact.*
5. Sequences + broker CRM + funnel dashboard + artifacts (credibility book, QoE-lite, LOI, investor updates).
6. Phase 3: call stack (Recall.ai + transcripts→facts), browser-agent tier, iMessage add-on, thesis-learning v2, off-market lane.
