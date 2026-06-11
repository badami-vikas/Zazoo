# Recon — zero-cost pre-meeting background check

Internal Bridge tool. Given a **name** (± email / company / domain / GitHub / location / US state), it:

1. **Resolves candidate identities** across web search + free public sources and asks you to **verify** the right one.
2. Runs a **detailed background check** on the verified person **and** their company, with **provenance on every fact** and a full step log.

Deterministic, **no AI**, **no paid sources**, **no bulk downloads** — every call is keyed off your single input.

## Why search-led (recall-first)

Most subjects are **not** famous (no Wikipedia), **not** engineers (no GitHub), and do **not** file with the SEC (no EDGAR) — so registry-only lookups return nothing for the median founder/GP/LP. Recon therefore leads with **general web search** (self-hosted SearXNG) to discover where a person actually exists online, then uses structured sources to **confirm**:

- **Stage A — Discover:** SearXNG metasearch → LinkedIn snippet, company team page, personal site, socials, news. (LinkedIn is never fetched — only its public SERP snippet is read.)
- **Stage B — Expand:** extract LinkedIn title/employer, JSON-LD `Person`/`Organization`, on-page emails, socials, press.
- **Stage C — Route:** type-aware registries — FINRA BrokerCheck, OpenAlex, EDGAR, IAPD, CourtListener, USAspending, OpenCorporates/Patents/SoS/UCC deep-links, news.

If nothing structured matches (the long-tail case), Recon still returns a low-confidence candidate built from your input so the report can run on live web discovery. If SearXNG is down, discovery degrades gracefully (logged, never fatal) and the registries still run.

## Sources

| Source | Access | Yields |
|--------|--------|--------|
| **Web search (SearXNG)** | self-hosted JSON | LinkedIn snippet, team page, personal site, socials, news — the recall layer |
| **FINRA BrokerCheck** | JSON API | Securities registration (CRD), member firm, **disclosures → Signal** |
| OpenAlex | JSON API | Academic works / citations / institution |
| ORCID | JSON API | Verified researcher ID + employment/affiliation |
| Semantic Scholar | JSON API | Papers, citations, h-index, affiliations (keyless; rate-limited) |
| **Username enumeration** (WhatsMyName open data) | JSON list + HTTP probes | Maps a handle to accounts across ~40 curated (or 700+ full) platforms — subsumes Sherlock/FindME/UserReCon/Lullar |
| **Hiring signals** | Greenhouse + Lever JSON | Open roles / hiring velocity / team shape → company momentum |
| **Tech stack** | HTML fingerprint (zero-dep) | Detected web stack (Next.js, Shopify, WordPress, analytics, etc.) |
| **Email inference** | DNS MX (zero-dep) | Likely corporate email patterns, MX-confirmed (Hunter-lite; unverified — no SMTP) |
| **Social mentions** | Reddit JSON + HN Algolia | Free social-listening layer (routes around the licensed X firehose) |
| **Bluesky** | public AppView (keyless) | Profile match (handle / display name / bio) on the network where much of VC/tech migrated. Exact-name-matched; closest match flagged for review |
| **Mastodon** | instance v2 search (keyless) | Fediverse account match on the largest instance (`mastodon.social`, override via `MASTODON_INSTANCE`); degrades gracefully if an instance auth-walls search |
| **HIBP** | JSON API (keyed) | Breach-exposure screen by email → **Signal**. Off unless `HIBP_API_KEY` set (paid) |
| **OFAC SDN** | Cached list (weekly) | US sanctions screen → **Signal**. List downloaded once to `data/ofac-sdn.json`, screened in-memory (not per-query bulk) |
| **OCCRP Aleph** | JSON API (keyed) | Leaks / registries / corporate networks → **Signal**. Anonymous endpoint 500s — set `ALEPH_KEY` (free account) |
| Interpol Red Notices | JSON API | Wanted-persons screen → **Signal**. Akamai-walled server-side → needs Phase-3 browser |
| Social Searcher | JSON API (keyed) | Public social mentions/profiles — off unless `SOCIAL_SEARCHER_KEY` set |
| SEC EDGAR (full-text + submissions) | JSON API | Form D funding, registrant, state of incorp, SIC, HQ |
| SEC Form ADV / IAPD | JSON API | RIA status, CRD, ADV pointer (AUM/owners) |
| Wikidata / Wikipedia | JSON API | Summary, bio, founded year, official website |
| GitHub REST | JSON API | Bio, company, repos, top languages, account age |
| Company JSON-LD (schema.org) | HTML parse | Org/Person name, title, description, `sameAs`, emails |
| USAspending.gov | JSON API | Federal contracts (B2G traction) |
| RECAP / CourtListener | JSON API | Litigation / bankruptcy → **Signal** |
| News (GDELT + Google News RSS) | JSON / RSS | Recent headlines |
| OpenCorporates · Google Patents · State SoS · State UCC | deep-link | Officer↔company graph, inventorship, incorporation, secured-debt liens → **Signal** |

Signals (FINRA disclosures, litigation, UCC liens, credit/health flags) are surfaced separately and map to Bridge **Signal** entities — every Signal → an action.

## Run

```bash
# 1. Start the search backend (one-time; needs Docker). Without it, discovery degrades.
docker compose -f docker-compose.searxng.yml up -d
curl 'http://localhost:8888/search?q=test&format=json' | head -c 80   # sanity check

# 2. Start Recon
npm install
npm run dev        # http://localhost:3000
npm run typecheck  # tsc --noEmit
npm run build      # production build
```

The SearXNG config lives in `searxng/settings.yml` — the critical setting is `formats: [html, json]` (Recon needs JSON). Recon reads `SEARXNG_URL` (default `http://localhost:8888`).

## API

`POST /api/resolve` → candidate identities for verification
```json
{ "name": "Jane Founder", "company": "Acme Capital", "email": "jane@acme.com", "state": "DE" }
```

`POST /api/background-check` → full report (send back the chosen candidate)
```json
{ "identity": { /* one candidate from /api/resolve */ }, "input": { "company": "Acme Capital" } }
```

## Config (all optional — every source works at zero cost without them)

| Env var | Effect |
|---------|--------|
| `SEARXNG_URL` | Search backend for Stage A discovery (default `http://localhost:8888`) |
| `GITHUB_TOKEN` | Raises GitHub from 60 → 5,000 req/hr (free personal token) |
| `SOCIAL_SEARCHER_KEY` | Enables the optional Social Searcher source (off without it) |
| `MASTODON_INSTANCE` | Mastodon instance for keyless account search (default `mastodon.social`) |
| `HIBP_API_KEY` | Enables the HIBP breach-exposure Signal (paid key; off without it) |
| `ALEPH_KEY` | OCCRP Aleph API key (free account) — anonymous access 500s without it |
| `ALEPH_URL` | Point at a self-hosted Aleph instance instead of aleph.occrp.org |
| `FLARESOLVERR_URL` | Phase-3 anti-bot sidecar (`docker-compose.flaresolverr.yml`). Solves *older* Cloudflare JS challenges — NOT OpenCorporates' CAPTCHA tier |
| `BROWSER_URL` | Phase-3 Playwright render service (JS-render tier: Patents, Scholar, SoS) |
| `COURTLISTENER_TOKEN` | Higher CourtListener limits (free) |
| `NEXT_PUBLIC_BRIDGE_INTAKE_URL` | "Add to Bridge" POSTs the quarantined capture here instead of localStorage |

The SEC User-Agent is hard-set to `Bridge Recon - Vikas Badami badami@wustl.edu` (`lib/recon.ts`), as SEC requires a descriptive UA with a contact email or it blocks requests.

## Identity verification (accommodating flow)

The verify step is **multi-select**, not single-pick:
- Tick **every** profile that is the same person — Recon unions their identifiers into one composite subject before the deep check (fixes "multiple profiles, one person"). Cross-source duplicates that share a strong identifier (GitHub login, domain, Wikidata QID, CIK) also collapse automatically.
- **"None match — refine search"** returns to the input with your hints kept, so you can add a company, city, or domain.
- **"Add the correct profile manually"** lets you paste a known LinkedIn / GitHub / domain / ORCID when the right entity isn't listed at all. Name + company/domain drive the deepest report.

## Global store (draft-then-approve)

Every fact and signal a background-check discovers is flattened into rows and **staged**, never written straight to permanent storage:

- `data/staging.jsonl` — holding pen for newly discovered rows.
- At **100 staged rows** the UI raises an approval gate (top bar).
- **Approve** → rows are deduped against `data/permanent.jsonl` and committed; staging clears. **Discard** → staging clears, nothing committed.
- Dedup key = `subject + scope + label + value + source`, so re-running the same subject doesn't double-count.

APIs: `POST /api/background-check` returns `{ ...report, store }`; `GET /api/store/status`; `POST /api/store/promote`; `POST /api/store/discard`. The store is plain JSONL (append-only, greppable, no DB engine) — consistent with the tool's zero-dependency ethos. This is the same governed, draft-then-approve pattern Bridge uses for graph intake.

## Bridge intake

"Add to Bridge" never writes the graph directly. It maps the report through a typed `output_contract` (facts → **Memory**, subject → **Person**, risk flags → **Signal**) into a **quarantined** `CaptureEnvelope` committed via pipeline proposal (draft-then-approve). See `lib/bridge.ts` and `RECON_MANIFEST`.

## Limits & guardrails

- **LinkedIn is never fetched directly** (ToS / anti-scrape). Recon reads only the public **SERP snippet** that search engines index — the legal, zero-cost path to a non-famous professional's title/employer/location.
- Crunchbase / X profiles appear as discovered links but are not scraped.
- SearXNG must be running with `formats: [json]` or discovery returns no JSON — logged as a failed step, never fatal; registries still run.
- Some company sites bot-wall their homepage (HTTP 403) → JSON-LD degrades gracefully and is logged, not fatal.
- OpenCorporates / Google Patents / State SoS / UCC have no keyless API → the tool emits the correct search deep-link for manual follow-up rather than fabricating rows.
- **Noise reduction:** deep-links are gated and verified, not dumped. Patents/Scholar links appear *only* when the subject already shows a technical/academic signal (GitHub / OpenAlex / ORCID / Semantic Scholar). Username matches use the full WhatsMyName exists-AND-not-missing rule plus a handle-on-page check, which removes the soft-404 false positives (e.g. Facebook/Instagram "not found" pages that echo the handle).
- **Username enumeration is still best-effort** (same class as Sherlock/WhatsMyName): auto-derived handle permutations (`jdoe`, `john.doe`) can match *different* people. Results are Tier B for analyst verification; **supply an exact handle** for a clean list. Curated ~40 sites by default; tick "Deep username scan" for the full 700+.
- **Anti-bot links cannot be auto-verified without a browser → marked "unverified pointer".** OpenCorporates (Cloudflare CAPTCHA), Google Scholar, State SoS/UCC, and JS-rendered Patents results all wall plain `fetch`. **Phase 3** plans a headless browser (Playwright) to open and verify these; until then they are honest manual pointers, not fabricated facts.
- **Talkwalker / OSINT Trace are not called** — no free programmatic API.
- Throughput: low hundreds of entities/day on one machine within free rate limits (add `GITHUB_TOKEN` for headroom; SearXNG is self-rate-limited).
