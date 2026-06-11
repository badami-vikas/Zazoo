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
