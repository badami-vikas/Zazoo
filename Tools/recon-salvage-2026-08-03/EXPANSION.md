# Recon — Expansion Plan (accuracy & depth)

Roadmap for deepening Recon beyond Phase-1 OSINT. Phase 1 of this plan is **built**
(OpenSanctions, email/MX inference, Reddit/HN social layer). The rest is sequenced
by effort-vs-return.

## A. Tool triage (evaluated candidates)

| Tool | What it is | Verdict |
|---|---|---|
| **SpiderFoot** | OSINT automation framework, 200+ modules, entity graph (OSS + API) | Phase 2 — optional self-hosted "deep scan" backend via its API; mine module list for sources. Not core. |
| **Aleph** (OCCRP) | Investigative platform: leaks, registries, corporate networks, PEP/sanctions | Phase 2 — integrate the **public OCCRP Aleph API** (free, keyed). Self-hosting = heavy infra, skip. |
| **OpenCTI** | Cyber **threat** intel (STIX/TAXII, IOCs) | Skip — wrong domain (threat actors, not people/companies). |
| **reNgine-ng** | Web **attack-surface** recon (subdomains, ports, vulns) | Skip for core — infra/pentest axis. Company tech-stack is buildable cheaper (Wappalyzer rules). |
| **knockknock** | Subdomain / login enumeration | Skip — infra axis; account-existence already covered by WhatsMyName layer. |
| **doctorfree/osint** | Curated toolkit/launcher | Reference only — mine for source ideas. |
| **neospl0it/osint-bookmark** | Bookmark collection | Reference only — mine for source ideas. |

**Conclusion:** only SpiderFoot + Aleph add people/company depth. The cyber/infra
tools answer a different question (offensive recon), not relationship intelligence.

## B. How paid players work, and what's buildable

Their moat is mechanism, not secret data:

| Mechanism (paid tool) | Buildable? | Plan |
|---|---|---|
| Identity-resolution graph (Pipl/ZoomInfo) | ✅ | Deepen `mergeCandidates` + probabilistic match over the permanent DB (Phase 3). |
| Email discovery + verification (Hunter/Apollo) | ✅ | **Done (Phase 1):** pattern inference + MX confirm. SMTP RCPT verify = Phase 3. |
| Company/domain enrichment (Clearbit) | ✅ partly | JSON-LD (have) + MX/DNS (have) + favicon + Wappalyzer tech-stack rules (Phase 2). |
| Social-listening firehose (Talkwalker/Brandwatch) | ❌ licensed | Route around: **Done (Phase 1)** Reddit + HN; add Mastodon/Bluesky/YouTube RSS (Phase 2). |
| Sanctions/PEP/adverse media (Dow Jones/WorldCheck) | ✅ | **Done (Phase 1):** OpenSanctions. Add OCCRP Aleph (Phase 2). |
| Breach exposure (multiple) | ✅ keyed | HIBP breach-by-account (Phase 2, keyed). |
| Phone intelligence | ✅ keyed | Twilio Lookup / Numverify (Phase 3). |

## C. Phased roadmap

### Phase 1 — BUILT (min effort, max return; zero new hard deps)
- **Email pattern inference + MX confirmation** (Node `dns`, zero dep). Unverified —
  no SMTP send.
- **Free social mentions** — Reddit JSON + HN Algolia.
- ~~OpenSanctions~~ **dropped** — hosted API now requires a paid key.

### Sanctions / risk screening (selective from OpenSanctions' source list)
OpenSanctions just aggregates primary sources; we pick the free ones directly.
- **Interpol Red Notices** — wired (free, selective API) BUT **Akamai-walls
  server-side requests** (403 to non-browser). Works only via the Phase-3 headless
  browser; until then it degrades gracefully to no-data.
- **OFAC SDN / EU / UK consolidated / World Bank debarred** — bulk lists, no selective
  API. Plan: a **cached reference-list refresh** (download once, screen names locally
  in-memory, refresh weekly via the monitoring cron) — the alternative to per-query
  bulk. Deferred to Phase 2/3.

### Phase 2 — moderate effort
- **BUILT: Hiring signals** — Greenhouse + Lever public job boards (momentum/roles).
- **BUILT: Tech-stack fingerprint** — Wappalyzer-style signatures on HTML we already fetch.
- **BUILT: OFAC SDN cached-list screener** — list cached to `data/ofac-sdn.json` (7-day TTL),
  ~19k entries screened in-memory. Verified: matches Putin → program RUSS.
- **BUILT (wired): OCCRP Aleph** — anonymous API 500s; needs `ALEPH_KEY` (free account) to
  return data. Degrades gracefully without it.
- **BUILT: Bluesky** — keyless public-AppView actor search (`public.api.bsky.app`,
  `app.bsky.actor.searchActors`). Profile match by handle/display-name/bio; exact-name
  matched, closest-match downgraded to Tier C + flagged "verify". `feed.searchPosts` is
  403-walled on the public AppView, so post search is intentionally omitted (no noise).
- **BUILT: Mastodon** — keyless instance `v2/search?type=accounts` on the largest
  instance (`mastodon.social`; override `MASTODON_INSTANCE`). Handles both `{accounts}`
  and bare-array shapes; degrades gracefully when an instance auth-walls search.
- **BUILT (wired): HIBP** — breach-by-account → security **Signal**. Keyed-optional
  (`HIBP_API_KEY`, paid); 404 = clean "no exposure", graceful skip without key/email.
- **DEFERRED: YouTube RSS** — the SearXNG `youtube` engine already covers keyless
  discovery in Stage A, and channel RSS needs a channel ID (no keyless name→channel
  resolution without the paid Data API). Low marginal value; revisit if a channel
  handle becomes a first-class input.
- **DEFERRED: SpiderFoot** — heavy optional self-hosted deep-scan backend (power users);
  its own integration session. Not core.

### Phase 3 — heavier / already-flagged
- **Browser/solver sidecar — SCAFFOLD BUILT** (`lib/browser.ts`, `FLARESOLVERR_URL` /
  `BROWSER_URL`, wired into OpenCorporates via `ocFetch`; no-op + graceful when unset).
  **Finding (tested live):** FlareSolverr returns `ok` but **does NOT beat OpenCorporates'
  Cloudflare *CAPTCHA/Turnstile* tier** (got the 5 KB captcha page) — it only solves the
  older "I'm Under Attack" JS challenge. Akamai (Interpol) is also out of scope for it.
  So our two hardest walls need a **paid path** (OpenCorporates' own API, or a paid
  scraping/CAPTCHA-solving service via the optional `BROWSER_URL`).
- **Playwright stealth render service** — the genuinely useful free next piece, for the
  **non-CAPTCHA JS-render tier**: Google Patents results, Google Scholar (paced),
  many State SoS portals. Expose it at `BROWSER_URL`; `fetchRendered()` already supports it.
- **SMTP RCPT** email delivery verification (careful, rate-limited).
- **SMTP RCPT** email delivery verification (careful, rate-limited).
- **Phone intelligence** (keyed).
- **Probabilistic entity-resolution upgrade** — the paid "identity graph," grown over
  the permanent DB.
- **Monitoring cron** — watch a subject → diff against permanent DB → emit Signals
  (Bridge Ritual pattern). The correct use of scheduling (not link-checking).

---

## D. Revenue estimator (communities / companies)

**Design constraint:** the median recon subject is a *private* company — no exact revenue
is legally disclosed. The estimator therefore has two layers: (1) direct-from-filing where
it exists, free; (2) modeled band from signals already pulled. Output shape for both:
`{ band, confidence_tier, method, inputs[with provenance] }` — never a fabricated point
number.

### D1 — Direct data (public cos, nonprofits, govcon) — Tier A

| Source | Access | Yields | Notes |
|---|---|---|---|
| **SEC XBRL — CompanyConcept / Frames** (`data.sec.gov/api/xbrl/companyconcept/{CIK}/us-gaap/Revenues.json`) | JSON, keyless | Actual `Revenues`/`RevenueFromContractWithCustomerExcludingAssessedTax` time-series | Same host as EDGAR (already wired). Public cos only; exact. Add `RevenueFromContract…` as fallback concept. |
| **IRS Form 990 → ProPublica Nonprofit Explorer** (`projects.propublica.org/nonprofits/api/v2/organizations/{EIN}.json`) | JSON, **keyless** | Actual revenue, expenses, net assets for all US nonprofits/foundations/endowments | ⭐ Directly relevant: foundation + endowment LPs. EIN from EDGAR EDGAR FTS or direct search. |
| **USAspending.gov** (already wired) | JSON | Federal contract $ → **revenue floor** for govcon vendors | Already in tool — surface `award_amount` as a revenue signal with `method: "govcon_floor"`. |
| **UK Companies House** (`api.company-information.service.gov.uk`) | JSON, free + 1 key | Filed annual accounts; turnover for many private UK cos | One free key; widens reach to UK private cos. Phase 2. |

### D2 — Modeled estimate (private long-tail) — Tier B/C

Works for any company; uses signals recon already pulls.

| Model | Inputs (already in recon) | Output |
|---|---|---|
| **Headcount × Revenue-per-Employee** | LinkedIn snippet employee band ("51–200"), Greenhouse/Lever open-role count, team-page count | RPE table keyed by sector (SaaS ~$150–250k/FTE, services lower, marketplaces by GMV). Ship table as `data/rpe-benchmarks.json`, cite source (Iconiq/Meritech public benchmarks). |
| **Funding-stage proxy** | SEC Form D raise amount (already pulled), ADV AUM | Stage → revenue band prior. Form D = capital raised, not revenue — use as band prior, label clearly. |
| **Hiring-velocity nudge** | Greenhouse/Lever role count delta over time (already Phase-2 built) | Nudges band ±1 tier. Momentum signal, not anchor. |
| **Tech-tier hint** | Wappalyzer fingerprint (already have) | Shopify Plus / Salesforce / enterprise CDN → spend-tier prior. Weak; Tier C only. |

### D3 — Paid moat (skip — their mechanism IS D2 above)

Growjo, Owler, PitchBook, Crunchbase, BuiltWith, Similarweb all do headcount×RPE +
funding-stage — exactly what D2 rebuilds free. Route around them per recon's ethos.
Connected Apollo/ZoomInfo MCPs are the "if you ever pay" fallback; note them in the
report footer but don't call them from the tool.

---

## E. Salary estimator (people)

Same two-layer design. Critically: **subject-type-aware** — a GP/founder's economics are
carry + equity, not W-2 salary. Switch model by subject type.

### E1 — Real disclosed wages — Tier A

| Source | Access | Yields | Notes |
|---|---|---|---|
| **DOL OFLC H-1B LCA + PERM disclosure data** (`flcdatacenter.com` bulk CSVs, mirrors: `h1bdata.info`, `myvisajobs.com`) | Bulk download / queryable, **free public** | Actual offered wages by employer + job title + worksite state | ⭐ Best free salary source. Any visa-sponsoring employer → real comp keyed to role+geo. Recon already has employer+title+location. Match on `EMPLOYER_NAME` + `JOB_TITLE` → `WAGE_RATE_OF_PAY`. Cache the current fiscal-year CSV (`data/oflc-lca.csv`, ~200 MB; filter at ingest to employer+title only). |
| **BLS OEWS API** (`api.bls.gov/publicAPI/v2/timeseries/data/`) | JSON, **keyless** (keyed for bulk) | Wage percentiles (10/25/50/75/90) by SOC occupation + metro area | Backbone benchmark. Need a title→SOC mapper (small lookup table for common VC-world roles). |
| **SEC DEF 14A proxy statements** (EDGAR full-text search — already wired) | JSON | Exact named-executive-officer comp for public cos | Already in tool's FTS reach. Search `DEF 14A` filings for subject's CIK. Public-co execs only; exact. |
| **IRS Form 990 (ProPublica — same as D1)** | JSON, keyless | Exact comp of nonprofit's highest-paid staff + officers | Relevant for foundation/endowment people (LP-side). Same API call as D1; no new dep. |

### E2 — Modeled band (title × company-tier × geo) — Tier B/C

Inputs already in recon: **title/seniority + employer + location** (LinkedIn snippet).
- Take BLS OEWS percentile for the closest SOC + metro as the baseline.
- Apply a company-tier adjuster from DOL LCA data for that employer (or sector median if
  no employer match).
- Output: `{ band: "$180k–$240k", confidence: "B", method: "OEWS+LCA_blend", inputs: [...] }`.

**Levels.fyi / Glassdoor / Payscale** — the data you'd want, all scrape-walled or paid.
Don't build on them. OEWS + DOL LCA gives a free, legally-sourced equivalent.

### E3 — Subject-type-aware economics (GPs / founders) — Tier B, high value

For the actual recon subjects (GPs/founders), W-2 salary is the wrong metric. Switch:

| Subject type | Model | Inputs (already pulled) |
|---|---|---|
| **GP / RIA** | AUM → management-fee math (2/20 heuristic → fee revenue → GP economics band) | Form ADV / IAPD AUM (already wired). |
| **Founder** | Equity-value proxy from latest raise + dilution stage | Form D raise amount + round stage (already wired). |
| **Salaried (employee)** | OEWS + DOL LCA blend (E1/E2 above) | Title + employer + location. |

This switcher makes the estimator far more useful for relationship intelligence than a
generic salary number, and all inputs are from sources already in the tool.

### E4 — Phasing

| Phase | What to build | Status |
|---|---|---|
| **Phase 2** | SEC XBRL revenue (D1) + ProPublica 990 (D1 + E1) — piggyback on EDGAR plumbing. | **BUILT** — `secXbrlRevenueEnrich` + `propublica990Enrich`; Tier A direct-filing data. |
| **Phase 2** | BLS OEWS benchmark (E2) + title→SOC lookup table (hardcoded, May 2024 data). | **BUILT** — `blsOewsSalaryEnrich`; 31-role table; title extracted from LinkedIn snippet. |
| **Phase 3** | GP / RIA fund economics (E3): AUM from IAPD → 2/20 fee model. Post-parallel. | **BUILT** — `gpFundEconomicsEnrich`; tries IAPD firm-detail endpoint; degrades to model note. |
| **Phase 3** | Founder equity proxy (E3): Form D round count → dilution model. Post-parallel. | **BUILT** — `founderEconomicsEnrich`; uses Form D count from `secEdgarEnrich` companyFields. |
| **Phase 3** | Revenue model for private companies (D2): headcount × RPE by sector. Post-parallel. | **BUILT** — `privateRevenueModelEnrich`; LinkedIn company snippet headcount × RPE table; 7 sectors; skips if direct filing revenue found. |
| **Phase 3** | DOL OFLC H-1B LCA salary (E1): actual offered wages by employer + job title. | **BUILT** — `dolOflcSalaryEnrich`; uses h1bdata.info keyless JSON API (re-publishes DOL FLC Data Center data); Tier A where matched. |
| **Phase 4** | DOL OFLC full-year CSV cache (`data/oflc-lca.csv`) — local lookup, weekly refresh, no reliance on h1bdata.info. Add `scripts/seed-oflc.ts` using DOL XLSX download. | Deferred — needs `xlsx` devDependency + ~200MB seed step. |
| **Phase 4** | SEC DEF 14A proxy comp (E1) — EDGAR FTS already wired; needs DEF 14A form-type filter + HTML Summary Compensation Table parser. | Deferred — complex HTML parsing; public-company executives only. |
