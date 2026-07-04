---
title: ETA Deal Sources — Connector taxonomy (verbatim user requirement)
type: raw
doc_kind: requirement
status: active
companions: [tool-standardization-plan.md]
related_wiki: ../wiki/tools.md
updated: 2026-07-03
tags: [dealpilot, eta, sources, requirement]
---

# Deal Source Inventory — Exhaustive List
### Sourcing universe for the ETA deal platform · Compiled 2026-07-04 (research-verified)

**Legend:** Type = MP (marketplace) / BR (broker/brokerage) / AG (aggregator) / CU (curator/newsletter) / NW (network/directory) / DATA (records). Scrape difficulty and volumes are point-in-time estimates from July 2026 research.

> **Product context:** user-added source URLs are the hero feature — this list seeds the default connector library and the priority order for pre-built connectors. Note: **none of the major platforms (BizBuySell, Acquire.com, Flippa) offer a free public listings API** — "easy wins" are structurally: email-alert parsing (free, ToS-clean, works for every platform), small clean-HTML sites, and Flippa's partner/affiliate feed (application required).

---

## 1. General SMB Marketplaces

⚠️ BizBuySell, BizQuest, and LoopNet-biz are all **CoStar properties** with heavy cross-posting — cross-source dedupe is mandatory (~30–50% of raw listings are duplicates market-wide).

| Source | URL | Type | Volume | Sweet spot | Access | Scrape | Priority |
|---|---|---|---|---|---|---|---|
| BizBuySell | bizbuysell.com | MP | ~45K+ active US — largest | $100K–$5M ask | Public pages, saved-search **email alerts**; no API | Med-Hard (Akamai Bot Manager; server-rendered; residential proxies; proven scrapable — Apify/ScrapingBee actors exist) | **P0** |
| BusinessesForSale.com | businessesforsale.com | MP | ~50–60K worldwide | $50K–$5M; intl (UK/CA/AU) | Public, email alerts | Hard (403 wall; headless + residential proxies) | **P0** |
| BusinessBroker.net | businessbroker.net | MP | ~30K | $100K–$3M | Public, email alerts | Easy-Med (lightest anti-bot of big three) | **P0** |
| DealStream (ex-MergerNetwork) | dealstream.com | MP | ~22K (biz subset smaller; RE/O&G noise) | $500K–$10M+ | Public browse; contacts behind membership (~$25–50/mo) | Medium | **P1** |
| BizQuest | bizquest.com | MP | ~30K (heavy BizBuySell overlap) | Same as BBS | Public, alerts | Medium (CoStar stack) | P1 (dedupe source) |
| Sunbelt Network | sunbeltnetwork.com | BR/MP | Thousands across ~200+ offices | $200K–$5M | Public per-office search | Medium (fragmented subsites) | P1 |
| BizBen | bizben.com | MP | ~5K (California only) | $100K–$2M CA | Public, alerts | Easy-Med | P1 (if CA matters) |
| LoopNet – Businesses | loopnet.com/biz | MP | Subset of BizQuest cross-posts | RE-included deals | Public | Med-Hard | P2 |
| BusinessMart | businessmart.com | MP | Low thousands, franchise-ad heavy | $100K–$1M | Public | Easy | P2 |
| eQuire / MergerPlace / GlobalBX / BizJournals classifieds | various | MP | Small, stale-heavy long tail | <$1M | Public | Easy | P2 |
| DealNexus | — | AG | **Defunct** (absorbed into Intralinks) | — | — | — | Skip |

## 2. Online / Digital Business Marketplaces

| Source | URL | Type | Volume | Sweet spot | Access | Scrape | Priority |
|---|---|---|---|---|---|---|---|
| Empire Flippers | empireflippers.com | MP/BR | ~100–140 (curated, structured data) | $100K–$5M online | Public teasers; free account for detail | Easy-Med | **P0** (clean, cheap) |
| Quiet Light | quietlight.com/listings | BR | ~30–60 | $500K–$10M ecom/SaaS/content | Public + email alerts | Easy | **P0** (bundle w/ EF) |
| Website Closers | websiteclosers.com | BR | ~200–400 | $1M–$20M digital | Public | Easy | **P0** (bundle) |
| Flippa | flippa.com | MP | ~5K live (long tail junky — filter hard) | $5K–$1M | Public, alerts; **partner/affiliate feed exists (apply)** | Medium (Cloudflare, JS search) | **P1** — pursue the partner feed as a potential API easy-win |
| Acquire.com | acquire.com | MP | ~1–2K; top self-serve SaaS marketplace | $100K–$2M SaaS/ecom | **Login-gated** details; buyer Premium ~$390–780/yr | Hard (auth + anonymized) | P1 via **BYO user account** (aggressive-coverage posture) |
| Investors Club | investors.club | MP | ~50–150 | $20K–$1M | Membership-gated | Hard | P2 (BYO account) |
| Motion Invest | motioninvest.com | MP | ~30–80 | $5K–$500K content | Public + alerts | Easy | P2 |
| Latona's | latonas.com | BR | ~100–200 | $50K–$5M digital + domains | Public | Easy | P2 |
| FE International | feinternational.com | BR | Dozens, confidential-first | $1M–$50M | Email list; rarely public | N/A (email parse only) | P2 |
| ExitBid | exitbid.io | MP | Small/new, auction-first | $50K–$2M | Public | Easy | P2 |
| Microns / Tiny Acquisitions / SideProjectors | various | MP | Hundreds micro (<$100K) | Below scope | Public | Easy | P2 |

## 3. Franchise Resale Platforms

| Source | URL | Volume | Sweet spot | Access | Priority |
|---|---|---|---|---|---|
| FranchiseResales.com | franchiseresales.com | Hundreds | $150K–$2M | Public + weekly email | P1 |
| National Franchise Sales | nationalfranchisesales.com | Hundreds (restaurant/multi-unit) | $500K–$10M | Public + registration | P1 |
| We Sell Restaurants | wesellrestaurants.com | Hundreds | $100K–$2M | Public + alerts | P1 (if restaurants in scope) |
| Franchise Flippers | franchiseflippers.com | Hundreds | $100K–$2M | Public + alerts | P2 |
| FranchiseSellers.com | franchisesellers.com | ~400+ | $100K–$2M | Public | P2 |
| Franchise Empire resales | franchiseempire.com/resales | Small | $100K–$1M | Public | P2 |
| Franchisor-run resale pages (UPS Store, Snap-on, QSR brands…) | per-brand | Small each, large aggregate | varies | Public | P2 long tail |

## 4. Broker Networks & Brokerage Sites

Broker sites often post **earlier and richer** than their BizBuySell syndication. The long-tail broker crawler (Kumo's moat: 1,000+ broker sites) is the highest-ROI engineering after the big marketplaces — most broker sites run ~6 common CMS templates (BrokerWorks embeds, Deal Studio, WP themes), so template-detection scales.

| Source | URL | Volume | Sweet spot | Scrape | Priority |
|---|---|---|---|---|---|
| Transworld Business Advisors | tworld.com | ~1,500–2,500 exclusives; largest network (250–350 offices) | $200K–$5M | Medium (one platform, many subdomains) | **P0** |
| Murphy Business | murphybusiness.com | Hundreds–low thousands (~120 offices) | $500K–$10M | Easy-Med | P1 |
| VR Business Brokers | vrbb.com | Hundreds | $200K–$5M | Easy | P1 |
| First Choice Business Brokers | fcbb.com | Hundreds–1K+ (~140 offices) | $100K–$3M | Easy | P1 |
| Calhoun Companies | calhouncompanies.com | ~50–100 (Upper Midwest) | $500K–$5M | Easy | P2 |
| Viking Mergers | vikingmergers.com | ~50–100 (Southeast) | $1M–$10M | Easy | P2 |
| Regional boutiques batch: Raincatcher, Peterson Acquisitions, Hedgestone, Synergy (NE), Woodbridge, The Firm (NE), IAG, Apex (KC), The Veld Group (CA), Pacific Business Sales (CA), Sigma (TX), Certified Business Brokers (Houston) | various | 20–150 each | $500K–$10M | Easy each; breadth is the work | P1 as batch |

## 5. Aggregators / Curators (competitors and/or feed inputs)

| Source | URL | What | Cost | Priority as source |
|---|---|---|---|---|
| **Kumo** | withkumo.com | 100K+ active listings, 1,000+ brokers, ~700 new/day, dedupe, AI summaries, DealScreen.ai CIM analysis (absorbed) | Free (30-day-delayed) / Pro $89 / Ultimate $149/mo | Benchmark competitor; P2 as feed (ToS) |
| Searcher OS | searcheros.ai | 300+ broker-site monitor, AI CIM analysis, "Mark" NDA-request agent (beta) | Free / $79 / $149/mo | Closest workflow competitor; study, don't source |
| BizNexus | biznexus.com | OmniSource aggregation + concierge sourcing | Quote | P2 |
| Clearly Acquired | clearlyacquired.com | 100+ marketplace aggregation + financing, credit-based | Credit tiers | Competitor reference |
| Searchfunder deal board | searchfunder.com | Broker-posted deals + community | ~$400/yr-ish (lifetime $432 refs) | P1 via BYO member account |
| Axial | axial.net | LMM network, ~10K deals/yr, $5M–$100M EV | Custom + success fee | P1 via **email-alert parsing** ($5M+ band) |
| PrivSource | privsource.com | Curated LMM network, AI buyer lists, **has an MCP for Claude** | $299/mo buy-side, no success fees | P1 |
| Rejigg | rejigg.com | Off-market: 15–20 fresh sellers/wk, $200K–$3M EBITDA | Free/$150/mo/Concierge $3K/mo + success fee | P1 (partnership > scrape) |
| Interexo | interexo.com | 3,600+ active deals ≥$500K EBITDA; pay-to-unlock contacts | ~$200/mo or $2K/yr | P2 (mixed reviews) |
| SMB Deal Hunter | smbdealhunter.com | Curated newsletter 3x/wk | Free/paid | P1 (easy parse, pre-curated) |
| The Deal Sheet | thedealsheet.co | Briefs + industry deep dives (quality bar, not feed) | n/p | P2 (content model reference) |
| Mainshares / OffDeal / DueDilio / Baton / DealBuilder | various | Capital, sell-side AI bank, diligence services, tech brokerage, CIM generation | various | Partners, not sources |

## 6. Off-Market / Proprietary Channels

| Source | What | Access | Priority |
|---|---|---|---|
| **IBBA directory** (ibba.org) | ~1,000+ intermediaries — the seed list for the long-tail broker crawler | Public | **P0 as crawler seed** |
| **BBF / BBFMLS.com** (Business Brokers of Florida) | True state co-brokerage MLS, ~4–5K FL listings, substantial exclusives | Public | **P0** (standout single source) |
| State broker associations: CABB (CA), TABB (TX), GABB (GA, own listings page), MBBI (Midwest), CVBBA (Carolinas-VA), NEBBA, AZBBA, CABI (CO), PBBA (PA), NYABB, OABB, MABB | Directories (crawler seeds) + some listing pages | Public | P1 |
| Industry association classifieds: PCT Marketplace (pest), NALP (landscaping), NFDA (funeral), Coin Laundry Assn/PlanetLaundry, ARVC (campgrounds), self-storage marketplaces, pharmacy/veterinary | Small each, high signal, low competition | Public, easy | P1 (pick verticals per user demand) |
| Professional-practice verticals: APS (accountingpracticesales.com), ADS dental network, Private Practice Transitions (law), AgencyEquity (insurance), RxOwnership (pharmacy) | MLS-like vertical sites, excellent $500K–$5M SDE fit | Mostly public | P1 |
| Routes: RoutesForSale.net, BizRoutes, MrRouteBroker | FedEx/bread/vending/ATM routes $50K–$1.5M | Public | P1-P2 |
| Craigslist business-for-sale (per metro) | Thousands, noisy/FSBO/scam-prone | Anti-scrape, legally sensitive (3taps precedent) | P2 |
| Facebook groups/Marketplace, LinkedIn | FSBO groups, broker posts | ToS-hostile | P2 (manual/community) |

## 7. Auction / Court Channels (brief)

Tranzon, Ten-X (CoStar), Tiger Group/Hilco liquidations, PACER §363 bankruptcy sales (via Stretto/Epiq/Kroll claims agents), state receivership/ABC notices. All P2 — distressed intent, bolt on later.

## 8. Data Sources for Finding UNLISTED Businesses (Phase 2–3 off-market engine)

| Source | Signal | Access |
|---|---|---|
| **SBA FOIA 7(a)/504 loan data** | Every SBA-financed business, loan size/year → **maturing loans = likely sellers**. Underrated. | Free bulk CSV, sba.gov |
| State SoS registries | Entity age, officers → owner-tenure proxies | Public; bulk via OpenCorporates/Middesk |
| UCC filings | Lender/equipment debt → refinance/exit signals | Per-state; bulk via vendors |
| State/county license DBs (CSLB contractors, liquor, health, home-care) | Vertical universes w/ revenue proxies | Public, scrapeable |
| Form 5500 (DOL) | Employee counts, owner age via retirement plans | Free bulk |
| Google Places + review velocity | Universe building + health proxies | Paid API |
| Data Axle / D&B / ZoomInfo / Grata / SourceScrub | Firmographics, owner age | Paid $$ |

---

## MVP Connector Plan (reflecting product decisions)

**Hero:** user-added source URLs — any brokerage/listing page a user pastes becomes a tracked source with per-source crawl frequency, auto-extraction, normalization, and dedupe. Popular user-added sources graduate into the shared connector library (network effect).

**Pre-built P0 connectors (8 classes):**
1. BizBuySell (scrape + email-alert parse)
2. BusinessesForSale.com
3. BusinessBroker.net (cheapest volume win — build pipeline here first)
4. Transworld
5. BBF/BBFMLS Florida
6. Digital bundle: Empire Flippers + Quiet Light + Website Closers
7. IBBA-seeded long-tail broker crawler (template-detection engine)
8. Universal email-alert/newsletter parser (works for EVERY platform incl. Axial, SMB Deal Hunter — the true "free API")

**"Easy-win API" reality check (per research):** no free public listing APIs exist at BizBuySell/Acquire/Flippa. Closest equivalents: Flippa partner/affiliate feed (apply), PrivSource MCP, Apify/ScrapingBee paid actors for BizBuySell (rent vs build), and email alerts everywhere. BYO-account connectors (Acquire.com, Searchfunder, Investors Club) ship under the aggressive-coverage posture with ToS risk assigned to the user's own credentials.
