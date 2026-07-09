---
title: ETA Deal-Flow — Vision (verbatim user requirement)
type: raw
doc_kind: requirement
status: active
companions: [tool-standardization-plan.md]
related_wiki: ../wiki/tools.md
updated: 2026-07-03
tags: [dealpilot, eta, requirement]
---

# DealPilot — Vision & Feature Spec
### The AI deal operating system for entrepreneurship-through-acquisition

**Status:** Draft v0.2 — 2026-07-04 · research-validated, decisions locked with founder
**Supersedes:** v0.1 · **Companion docs:** [ETA-Deal-Sources.md](ETA-Deal-Sources.md) (exhaustive source inventory)

---

## 1. Vision

Stanford's search-fund research says a searcher evaluates **100+ companies per acquisition** over a **19–20 month** median search, signs **~3.6 LOIs** per close, and a quarter never acquire at all. The canonical playbook assigns the grunt work — list building, broker screening, NDA/CIM intake, outreach personalization, pipeline hygiene — to *interns*. Most searchers don't have interns.

**DealPilot replaces the intern layer, not the searcher.** It is a multi-tenant SaaS that:

1. **Sources** deals from anywhere — pre-built connectors to the major marketplaces and broker networks, plus the hero capability: *paste any brokerage or listing URL and DealPilot tracks it* on a per-source schedule, normalizes, dedupes, and scores every deal against the user's thesis.
2. **Triages** with one keystroke (🟢/🟡/🔴). Red deals disappear forever (dedupe-aware). Green deals trigger the machine.
3. **Pursues** green deals automatically: credibility-backed CIM/NDA requests via a cost-ordered waterfall, inbound email and document parsing into a living company profile with per-cell source citations.
4. **Analyzes** to The Deal Sheet's quality bar — reconstructed P&L with *interactive add-back validation*, valuation triangulation, SBA/DSCR stress tests, risk scoring, and an explicit Pass / Conditional / Pursue verdict.
5. **Engages**: outreach sequences from the user's own inbox, integrated call scheduling, and a full call stack — recorded, transcribed seller calls that update the deal profile automatically.
6. **Learns**: company data and AI analysis live in visually separate sub-sections, each field flaggable 🟢/🔴 — company flags train the user's thesis model; analysis flags become eval cases that improve the AI.

**One-line pitch:** *From 500 listings a week to 5 seller calls that matter — with the diligence already done.*

### Why now / white space (research-validated)
- **No product covers the full loop.** Kumo ($89–149/mo, 100K+ listings) and Searcher OS ($79–149/mo, 300+ broker monitors) own aggregation + CIM *analysis*; Keye/Hebbia own PE-grade document diligence at enterprise prices. **Nobody does: auto-CIM requesting + inbound email/doc parsing into living profiles, multi-channel outreach with scheduling, or field-level AI feedback.** Those three are our moat.
- **Consolidation signal:** DealScreen.ai was just absorbed into Kumo — point-solution AI analysis is rolling into aggregators. The window favors an all-in-one, but it's shortening.
- **PE-grade tools price out searchers** (Grata ~$10–15K+, Sourcescrub ~$20K+, Cyndx mid-five-figures, Hebbia enterprise). A $79–199/mo product with credits is structurally differentiated, not just cheaper.
- **86% of dealmakers already use genAI** (Deloitte 2025); searchers improvise in ChatGPT/Claude with no dominant ETA-specific tool. Grassroots Searchfunder threads confirm demand — and their #1 critique of existing AI tools (*unvalidated add-backs*) is a feature decision we've made central.

### Success criteria
- Listing appears anywhere → triaged, thesis-scored card < 24h
- Green flag → credibility-backed CIM request sent < 1h; first-draft deep-dive < 48h of documents arriving
- Zero manual re-entry from sourcing → diligence → outreach → call → profile update
- Funnel instrumented against Stanford benchmarks (5 quality seller meetings/mo; ~3–4 LOIs per close)

### Non-goals (v1)
- Not a marketplace/broker; no listing inventory of our own; no success fees
- Not post-LOI legal automation (LOI *drafting* is in scope; purchase agreements are not)
- Off-market origination engine (SBA FOIA, SoS/UCC records) deferred to Phase 2–3

---

## 2. Users & Business Model

**SaaS from day one.** Primary persona: self-funded searchers ($250K–$5M SDE deals); secondary: traditional search funds (adds investor-reporting needs); later: micro-PE/serial acquirers (teams, multi-thesis).

**Onboarding = thesis profile:** target statement (Buy Then Build style), industries, deal-size range (SDE/EBITDA), geography, revenue-quality preferences, funding structure (SBA pre-qual, investor backing) — all user inputs, all drive scoring, filtering, and the buyer credibility book. Nothing hard-coded.

**Pricing: subscription tiers + usage credits** (market anchor: Kumo/Searcher OS at $79–149/mo):
- Tiers gate seats, connector count, custom-source count, sequence volume.
- Credits meter the variable-cost actions: deep-dive reports, enrichment waterfall runs, browser-agent tasks, call transcription minutes.
- Free tier (delayed feed + limited analyses) as the community lead magnet.

**GTM: searcher communities** — Searchfunder, SMB Twitter/X, r/buyingabusiness, Acquisition Lab cohorts. Lead magnets: free CIM analyzer, free buyer-book generator, published sample deal briefs (Deal Sheet-style content flywheel). Partnership candidates (complements, not competitors): DueDilio (QoE referrals), Acquisition Lab (education channel), Rejigg (off-market inventory), SBA lenders.

---

## 3. The Deal Lifecycle (core state machine)

```
SOURCED → TRIAGED (🟢/🟡/🔴) ──🔴──→ DISCARDED (hidden forever, dedupe-aware, reason captured)
                │🟡 → WATCHLIST (re-alert on price drop / relist / new data)
                │🟢
                ▼
        ENRICHING (waterfall: free → forms → email → browser agent → human task)
                ▼
        PROFILED (living company profile, per-cell provenance)
                ▼
        ANALYZED (deep-dive report; soft-gated on seller qualification)
                ▼
        ENGAGED (sequences → call booked → call recorded/transcribed → profile updated)
                ▼
        DECISION (Pass / Conditional / Pursue → LOI builder → QoE-lite bridge)
```

Every transition is an event; pipeline views, funnel metrics, and investor updates are queries over the event log.

---

## 4. Feature Modules

### Module A — Sourcing Engine
**A1. Custom Source Tracker (HERO).** User pastes any brokerage/marketplace/association URL → DealPilot fingerprints the site (≈6 common broker CMS templates cover most of the market), builds an extractor, and crawls on a **user-adjustable per-source frequency** (e.g., Transworld daily, boutique broker weekly). New/changed listings flow into the same normalized pipeline. Health monitoring per source (last crawl, yield, breakage alerts). Popular user-added sources graduate into the shared connector library — the user base builds our coverage moat.

**A2. Pre-built connectors** (see [ETA-Deal-Sources.md](ETA-Deal-Sources.md) for the full inventory and P0 rationale): BizBuySell, BusinessesForSale.com, BusinessBroker.net, Transworld, BBF/Florida MLS, DealStream, digital bundle (Empire Flippers/Quiet Light/Website Closers), IBBA-seeded long-tail broker crawler.

**A3. Universal email-alert/newsletter parser.** Saved-search alerts and curated newsletters (BizBuySell alerts, Axial distributions, SMB Deal Hunter) parsed from the user's connected inbox into the same pipeline. This is the de-facto "free API" for every platform and the most ToS-durable channel — every connector class gets it.

**A4. Easy-win integrations.** Reality check from research: no free public listing APIs exist at the majors. We pursue: Flippa partner/affiliate feed (application), PrivSource MCP, rented scrape actors (Apify/ScrapingBee) as build-vs-buy stopgaps for BizBuySell.

**A5. BYO-account connectors** (aggressive-coverage posture): login-gated sources (Acquire.com, Searchfunder deal board, Investors Club) accessed via the *user's own credentials* — coverage maximized, ToS risk assigned to the account owner; per-connector isolation so a ban never cascades.

**A6. Normalization + dedupe.** Unified Deal schema (ask, revenue, SDE/EBITDA, multiple, NAICS industry, geo, real estate, broker, sources[]). Cross-source dedupe (fuzzy financials + geo + description embeddings) is the product: CoStar triplets + broker-site↔marketplace syndication mean 30–50% of raw listings are duplicates. Merged deals show all listing sources; price drops and relists become events.

### Module B — Triage
- Card + table dual view; keyboard-first (G/Y/R), swipe on mobile.
- Card: headline metrics, source badges, days-on-market, **ThesisFit score** (from onboarding profile + learned flags) and AI one-liner (why fit / what smells off).
- 🔴 → Discarded: hidden everywhere, dedupe-aware (same business re-listed elsewhere stays hidden), one-tap reason capture feeding thesis learning, browsable/restorable, never deleted.
- 🟡 → Watchlist with change alerts. 🟢 → enrichment waterfall fires.

### Module C — Instant Deal Brief
Click a card → Deal Sheet-style brief from listing-tier data, honest about what's claimed vs. verified:
1. Snapshot (ask, SDE, revenue, implied vs. industry benchmark multiple, geo, tenure)
2. Business model & revenue quality (recurring vs. project)
3. Why interesting / why cautious — tied to the user's target statement
4. Industry lens (auto-selected playbook: benchmarks, margins, labor dynamics, industry-specific diligence questions)
5. Financing sketch: SBA 7(a) feasibility, DSCR at ask, seller-note scenarios
6. Provenance + confidence tag on every figure
Brief auto-regenerates as enrichment lands, with visible diffs ("SDE revised $392K → $410K after CIM p.14").

### Module D — Enrichment Waterfall (green-flag machine)
Cost-ordered, per-source configurable (reorder, cost caps, timeouts, per-deal and monthly budgets), escalating only on failure:
1. **Free:** listing platform data, company website, Google reviews, public records tier-1
2. **Automated forms:** platform "request info" auto-filled with buyer profile + e-sign NDA where supported
3. **Email:** credibility-backed CIM request from the user's own inbox (see Module I), polite follow-up cadence, NDA handling
4. **Browser agent:** Claude-driven automation (browser-use/Stagehand class) for login portals and stubborn sources
5. **Human-in-loop:** task card with pre-drafted broker-call script

**Inbound processing:** replies and attachments (CIMs, P&Ls, tax returns — PDF/XLSX) auto-matched to deals; documents parsed with **page-level citations**; extracted figures merged into the profile. Low-confidence extractions and ambiguous matches go to a review queue — never silently merged. Waterfall status + cost meter visible per deal.

### Module E — Living Company Profile
Single source of truth per green deal, **laid out in two visually distinct layers** (this is what makes flag semantics unambiguous — see Module H):
- **Company Data sections** (facts): identity/entity records, multi-year P&L (source-per-cell), customers & concentration, team, operations, real estate/lease, licenses, seller situation & catalyst.
- **AI Analysis sections** (judgments): quality-of-earnings commentary, risk assessments, growth levers, valuation opinions.
- Provenance per cell: listing / CIM p.12 / broker email 6/28 / seller-stated (call 7/3) / public record / AI-inferred (visually distinct).
- Document vault (searchable, citable) + unified timeline of every event.

### Module F — Deep-Dive Analysis (the flagship artifact)
Runs on credits; **soft-gated on seller qualification**: the report *leads* with a Seller Qualification section (catalyst, timeline, price flexibility) and warns prominently when unknown — Stanford's "don't over-analyze before qualifying the seller," encoded, without blocking the user's choice.

Report structure = the community's quality bar (The Deal Sheet + Stanford investor-memo synthesis):
1. Seller qualification & deal dynamics
2. **Reconstructed P&L with interactive add-backs** — every extracted add-back shown with its citation; user **accepts / rejects / adjusts each one**; adjusted EBITDA, valuation, and DSCR recompute live. Add-back accept/reject *is* the field-flag mechanism for financials — and directly answers the community's #1 AI-tool criticism.
3. Valuation triangulation (multiples, comps, DCF-lite, SBA-lender view) → fair-value range vs. ask
4. Financeability: DSCR under SBA/seller-note structures + stress scenarios
5. Risk register: customer concentration (>20–25% single-customer = structure/financing issue), key-person/owner dependency, accounting quality, industry headwinds — severity-scored
6. Fit vs. target statement
7. Open questions for seller/broker (auto-rolls into sequences and call prep)
8. **Verdict: Pass / Conditional (with explicit conditions) / Pursue** + next action
9. (Pursue) 100-day plan sketch

Industry playbooks (NAICS + business-model keyed) specialize sections 2–5. Every claim cites its source document/page; uncited = labeled inference. New data or flags trigger targeted section re-runs with diffs.

**Adjacent artifacts (all confirmed in scope):**
- **Buyer Credibility Book:** generated buyer one-pager (positioning, criteria, funding structure, proof-of-funds/SBA pre-qual attachments, references) + listing-specific 3–4 paragraph inquiry emails — research shows broker response hinges on signaled closability, and "I have access to capital" is a red flag while named backing is green.
- **QoE-lite bridge:** pre-LOI mini-QoE (DSCR, working-capital normalization, add-back risk score) to support the "$5–25K and 2–4 weeks for real QoE?" decision + a clean data package for the QoE provider.
- **LOI/Offer Builder:** LOI drafts with structure recommendations (price, seller note, earnout, transition terms) driven by the analysis; supports "sign LOIs early and often" best practice.
- **Investor Update Generator:** auto-drafts the quarterly 3-page format (narrative, pipeline table with pros/cons/open questions, funnel metrics + budget) from the event log.

### Module G — Call Stack (full, per founder decision)
- **Prep:** generated call agenda + question bank — FROG rapport plan (Family/Recreation/Occupation/Goals), seller-catalyst probes, deal-specific gap questions from the profile ("CIM shows 40% revenue from one GC — ask about contract terms"), with good/bad-answer guides. Broker vs. seller and first-call vs. follow-up variants. First-call doctrine baked in: earn the second call; no valuation talk on call one.
- **Scheduling:** Cal.com-embedded booking with deal-context intake; booking auto-creates prep doc + calendar event; no-show → re-book step.
- **Recording + transcription:** calls booked through the platform are recorded (with consent capture) and transcribed; answers auto-update profile fields with "seller-stated" provenance; unanswered questions roll forward into the next sequence step.
- **Live coaching cards** (stretch within Phase 3): during the call, surface the question list, flag covered/uncovered topics, prompt catalyst follow-ups.

### Module H — Field-Level Feedback (the learning loop)
Because Company Data and AI Analysis are **separate sub-sections** (Module E/F layout), flag meaning is **context-inferred with zero extra taps**:
- Flag in a Company Data section = *evaluation of the company on that metric* → feeds the per-user thesis model: re-ranks incoming deals (ThesisFit), pre-highlights sections the user cares about, and *proposes* (never auto-applies) filter refinements. Udu-style learn-from-feedback, thesis-deep.
- Flag in an AI Analysis section = *quality feedback on the AI* → flagged outputs become eval cases; per-playbook quality dashboards; prompt changes regression-tested against the accumulated eval set before shipping.
- Add-back accept/reject events are the highest-value stream of both types.
- Card-level 🟢🟡🔴 + discard reasons feed the same thesis model.
- Deal score = user's aggregated field evaluations alongside the AI's score; divergence itself is a signal surfaced to the user.

### Module I — Outreach & Sequences
- Multi-step, multi-channel sequences per deal stage (CIM request → follow-up → post-CIM questions → call scheduling → post-call thank-you + open items). Merge fields from profile + credibility book. Reply detection pauses sequence, routes to timeline.
- **Sends from the user's own Gmail/O365 (OAuth)** — brokers see a real buyer, deliverability stays clean; volume is warm dozens/week, not cold thousands. Human-approve gate on first-contact messages by default.
- Broker CRM layer: track brokers as first-class entities (response rates, listing books, cadence), "ask for their whole book" playbook.
- **iMessage: Phase 3** premium add-on via paid API (Sendblue/LoopMessage class) — multi-tenant SaaS can't use the free Mac-bridge route; warm contacts only, human-approved. Twilio SMS as compliant fallback.

### Module J — Pipeline, Funnel & Admin
- Kanban over lifecycle states; weekly digest.
- **Funnel dashboard vs. Stanford benchmarks:** reach-outs → responses → meetings → IOIs → LOIs, against reference ratios (e.g., 5 quality meetings/mo; ~3–4 LOIs per close; median first LOI ~7.8 months) — turns pipeline anxiety into instrumentation.
- Credit/cost meter per deal and per month. Settings: thesis profile, sources + frequencies, waterfall config, sequence templates, connected accounts, data retention.

---

## 5. Competitive Positioning (research summary)

| | Kumo | Searcher OS | Clearly Acquired | PE tools (Grata/Keye/Hebbia) | **DealPilot** |
|---|---|---|---|---|---|
| Listing aggregation | ✅ 100K+ | ✅ 300+ brokers | ✅ 100+ sources | ❌ (off-market focus) | ✅ + **user-added sources** |
| Triage/scoring | Partial (BuyerFit) | Partial | Light | Udu only (feedback-trained) | ✅ RYG + learned thesis |
| CIM *analysis* | ✅ (DealScreen, Ultimate tier) | ✅ | ❌ | ✅ enterprise-grade | ✅ interactive add-backs |
| **Auto-CIM request + inbound email/doc parsing → living profile** | ❌ | Beta (NDA requests) | ❌ | ❌ | ✅ **moat** |
| Deep-dive reports (Deal Sheet bar) | Screen-level | Screen-level | ❌ | ✅ at $50K+/yr | ✅ at credit prices |
| **Outreach sequences + scheduling + call stack** | ❌ | ❌ | ❌ | ❌ | ✅ **moat** |
| **Field-level AI feedback loop** | ❌ | ❌ | ❌ | ❌ | ✅ **moat** |
| Price | $0–149/mo | $0–149/mo | credits | $10K–$100K+/yr | tiers + credits, $79–199/mo band |

Reusable OSS (validated): `zoharbabin/due-diligence-agents` (Apache-2.0, active — multi-agent data-room analysis with citations) and `ttulttul/llm-diligence` (MIT — Pydantic-schema document extraction) for the diligence pipeline; crawl4ai/Crawlee (Apache-2.0) for crawling; waterfall-enrichment patterns from `enrichment-kit`. License traps to avoid: AGPL (firecrawl self-hosted, maxun, Twenty core), unlicensed repos. No OSS or commercial product does the end-to-end loop — whitespace confirmed, but multiple tiny 2025–26 prototypes signal others circling.

---

## 6. Phasing

**Phase 1 — Sourcing + triage + instant briefs.** Custom Source Tracker (hero), 3 P0 connectors (start BusinessBroker.net for pipeline plumbing, then BizBuySell, digital bundle), universal email-alert parser, normalize/dedupe, thesis onboarding, RYG triage + discard, instant briefs, free CIM analyzer as community lead magnet.
**Phase 2 — The pursuit machine.** Email-tier waterfall + credibility book, inbound parsing → living profiles, deep-dive reports with interactive add-backs (2–3 industry playbooks), field flags, Cal.com scheduling, QoE-lite. Remaining P0 connectors + BYO-account connectors.
**Phase 3 — Full engagement + learning.** Sequences + broker CRM, call recording/transcription/coaching, iMessage add-on, LOI builder, investor updates, funnel benchmarks, thesis-learning ranking, browser-agent waterfall tier, off-market engine (SBA FOIA, SoS/UCC).

---

## 7. Key Risks

| Risk | Mitigation |
|---|---|
| Anti-bot/ToS (Akamai on BizBuySell; 403s on BFS.com) | Email-alert parsing as the durable channel everywhere; residential proxies + polite crawl; BYO accounts shift gated-source risk to users; per-connector isolation; rented actors as stopgap. |
| Kumo/Searcher OS add our features (consolidation is underway) | Speed on the three moats (CIM loop, outreach, feedback); community GTM; user-added sources compound coverage. |
| Broker trust — automated outreach reads as spam | User's real inbox, credibility book attached, human-approve first contact, low volume. |
| CIM parsing errors poison analysis | Page-level citations, confidence tags, review queue, interactive add-back validation as forced human checkpoint. |
| Custom-source extractors break silently | Per-source health monitoring, yield alerts, template-detection over bespoke selectors. |
| Call recording consent (two-party states) | Consent capture in booking flow + recording disclosure default-on. |
| Credit economics (LLM/proxy costs) | Cost meter per action from day one; caps and budgets user-visible. |

---

## 8. Decisions Log (founder-confirmed 2026-07-04)

1. SaaS from day one; thesis (industries, size, geo) = user inputs at onboarding, nothing hard-coded.
2. User-added source URLs with per-source crawl frequency = hero feature; pre-built P0 connectors + email-alert parsing in parallel; pursue Flippa partner feed / PrivSource MCP as API easy-wins (no free public APIs exist at the majors).
3. Monetization: subscription tiers + usage credits.
4. Sourcing posture: aggressive coverage, including BYO-account connectors for login-gated sources.
5. Outbound email: user's own Gmail/O365 via OAuth.
6. iMessage: deferred to Phase 3 as paid-API premium add-on.
7. Deep-dive reports: interactive add-back accept/reject before valuation computes.
8. Seller qualification: soft gate (report leads with it + warns; never blocks).
9. All four adjacent artifacts in scope: credibility book, funnel dashboard + investor updates, QoE-lite bridge, LOI builder.
10. Off-market origination: Phase 2–3.
11. Flag disambiguation: company data vs. AI analysis rendered as separate sub-sections → context-inferred flag semantics.
12. Call features: full stack (prep + recording + transcription + coaching), phased within Phase 3 for the heavy parts.
13. GTM: searcher communities with free-tool lead magnets.
