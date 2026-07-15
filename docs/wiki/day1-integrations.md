# Day-1 Integrations — $0 free/open launch

full: [../raw/day1-integrations-free-apis-2026-07.md](../raw/day1-integrations-free-apis-2026-07.md) · 2026-07-08. Related: [stack](stack.md), [oss](oss.md), [commons](commons.md).

**Headline: Bridge can launch on $0 external API spend.**

**Day-1 catalog** (4 buckets): (a) **relationship core** — Google Gmail+Calendar (already BUILT) +
Microsoft Graph, free at Bridge scale via user OAuth; open CalDAV/ICS, no embedded calendar server ·
(b) **research/evidence/enrichment** — Wikidata, OpenAlex, Crossref/ORCID, Wikipedia, GitHub —
keyless, CC0/CC-BY · (c) **company/people registries** — genuinely-free launch trio: **SEC EDGAR**
(US public domain, no key), **GLEIF LEI** (CC0), **UK Companies House** (free key) · (d) utilities —
Frankfurter FX (no key/limit), Nominatim geocoding. Catalog is explicit about the 3 meanings of "free".

**Leverage pipeline = a connector FACTORY, not hand-written integrations**: APIs.guru **CC0 OpenAPI
specs** → **OpenAPI Generator (Apache-2.0)** → typed TS client → capability manifest → automatic
risk-band score (pure fn, zero LLM tokens) → governed connector in Commons. public-apis/publicapis.io
(MIT) seed the Learning Agent's "propose integration before building" flow. Nango absorbs the OAuth
long tail. Human effort concentrates only on output-contract mapping + approval (the moat). CC0 spec →
typed client in minutes.

**Licensing honesty flags (enforced)**: **Nango = Elastic License 2.0** (source-available, not MIT —
free to self-host/embed, may NOT resell as managed service) ⇒ adopt CONDITIONALLY behind the port, keep
in-house OAuth seam as live fallback · **OpenCorporates free key = ODbL share-alike** ⇒ paid upgrade,
NOT a launch dependency · **OpenSanctions CC-BY-NC = AVOID** · **Firecrawl core AGPL** = hosted-API-only.
License provenance = an enforced compile-time manifest field w/ mandatory attribution rendering.

**Day-1 robustness/viability recs**: (1) graceful degradation as default — unconfigured connector =
honest empty state, never fake data/spinner · (2) free-tier-first defaults, paid = explicit opt-in ·
(3) **lead with the credential broker** as the headline privacy differentiator (tools never hold OAuth;
scoped/revocable/audited grants; private∩egress structurally impossible) · (4) offline-first via
local-plane dual-write + caching (turns rate limits into non-issues) · (5) throttle + User-Agent in the
generated connector wrapper (SEC bans IPs, Nominatim caps 1 req/s) · (6) license provenance as an
enforced manifest field.
