---
title: Day-1 Free / Open Integrations & Public APIs — launch without paid API commitments
type: raw
doc_kind: plan
status: draft
companions: [tool-standardization-plan.md]
related_wiki: stack.md
updated: 2026-07-08
tags: [integrations, apis, licensing, day-1, open-source]
---

# Day-1 Free / Open Integrations & Public APIs

**Goal.** Make Bridge viable from launch with **zero paid API commitments**, using free API tiers,
open-source tooling, and CC0/open data. Every integration lands in Bridge's existing machinery:
the **ConnectorProvider port** (Nango, adopt-behind-port — ADR-026), the **credential broker**
(tools never own OAuth; Authority mints scoped temp grants), and the **governed gate** (Universal
Action Pipeline — the only path between the local plane and any internet egress). This is a
catalog + a cheap-scaffolding pipeline + a robustness plan, not a build order.

**Three meanings of "free" — kept honest throughout:**
- **OSS tool** (permissive license) — we run/embed the *code* for free (OpenAPI Generator,
  public-apis list, OpenAPI Directory). Embed only permissive per [oss](../wiki/oss.md).
- **Free API tier** — the *provider* gives a no-cost quota; the tool that reaches it may still be
  paid or the quota may vanish. Plan for it to disappear (graceful degradation, §4).
- **CC0 / open data** — the *data* is public-domain or openly licensed; attribution/share-alike
  obligations may still bind (§3).

**Bridge landing vocabulary (used in every catalog row):**
- `plane` — `cloud` (public facts, reached only through the gate) or `local` (private, never leaves).
- `egress` — `read` (source→quarantine→proposal), `write` (draft→approve→send), `none`.
- `band` — Capability Trust Model risk band: **Internal** (no egress, no private read),
  **Restricted** (public-scope egress read, no credentials/no private data), **External** (private
  read OR outbound send OR credentialed SaaS — **always human-approved at launch**, agent-floor
  DENY on standing `external:send`).

---

## 1. Day-1 free integration catalog

### 1a. Tooling / meta — the scaffolding layer (OSS we run, not APIs we call)

```yaml
tooling:
  - name: public-apis/public-apis (directory)
    category: catalog/seed
    license: MIT (repo) — entries link out; each target API has its OWN terms
    free_terms: fully free; ~1500 curated APIs, many no-key/free-tier
    powers: seed catalog for Learning Agent's "propose integration before building" flow
    band: n/a (reference data, not an egress target)
    honest_note: MIT covers the LIST, not the listed APIs — per-entry license still applies
  - name: publicapis.io
    category: catalog/seed
    license: site content (aggregator); links to source APIs
    free_terms: free browse/search; secondary index to the same universe
    powers: cross-check + richer metadata for the seed catalog
    band: n/a
  - name: APIs.guru OpenAPI Directory (APIs-guru/openapi-directory)
    category: spec source
    license: author-contributed specs = CC0 1.0; acquired specs = Fair Use / spec's own license
    free_terms: free REST API over ~2500 machine-readable OpenAPI 2.0/3.x specs
    powers: CC0 specs feed OpenAPI Generator to auto-scaffold typed clients (see §2)
    band: n/a (build-time input)
    honest_note: CC0 applies to submitted specs; scraped specs ride Fair Use — verify per spec
  - name: OpenAPI Generator (OpenAPITools/openapi-generator)
    category: codegen
    license: Apache-2.0 (permissive — embeddable per oss.md)
    free_terms: fully free; generates typed TS clients + server stubs from any OpenAPI spec
    powers: spec -> generated @bridge connector client behind ConnectorProvider port
    band: n/a (build-time)
  - name: Swagger Codegen (swagger-api/swagger-codegen)
    category: codegen
    license: Apache-2.0
    free_terms: fully free; OpenAPI Generator's upstream, same role — pick one
    powers: fallback codegen; OpenAPI Generator preferred (active community fork)
    band: n/a
  - name: Nango (NangoHQ/nango)
    category: OAuth / connector spine (ConnectorProvider pick)
    license: Elastic License 2.0 (source-available — self-host + embed OK; may NOT resell as managed service)
    free_terms: free self-host (docker-compose covers managed auth + API proxy + Nango Connect :3009)
    powers: OAuth 1/2, API-key, basic-auth handling for SaaS; the credential-broker backend
    band: infra (feeds External-band connectors)
    honest_note: >
      NOT MIT. ADR-026 adopts behind ConnectorProvider port CONDITIONALLY — commercial/license
      review required before hard dependency; minimal in-house OAuth seam kept as fallback so a
      license change can't strand us. Self-host is free; do not build a resold managed service on it.
  - name: Pipedream Connect
    category: OAuth / connector alternative
    license: source-available components; hosted managed-auth product (not fully OSS)
    free_terms: generous free tier on hosted; ~2700 connected apps
    powers: alternative ConnectorProvider adapter if Nango's license blocks
    band: infra
    honest_note: helps AUTH, not provider pricing; hosted dependency conflicts with local-first — reference/fallback only
  - name: RapidAPI marketplace
    category: API marketplace
    license: NOT OSS — commercial aggregator
    free_terms: many listed APIs expose free tiers; billing/keys broker through RapidAPI
    powers: discovery of long-tail APIs; some free-tier targets for connectors
    band: External (third-party broker in the egress path)
    honest_note: adds a middleman to the credential path — prefer direct provider + our own broker
```

### 1b. Relationship / communication (the core Bridge surface)

```yaml
relationship_comm:
  - name: Google (Gmail + Calendar)
    category: email/calendar
    license: proprietary API; free for end-user OAuth access (no per-call fee at Bridge's scale)
    free_terms: free with generous quotas; user consents via OAuth
    powers: Touchpoint/Memory sourcing (read) + governed draft->send (write); Calendar projection
    plane: local (tokens + raw bodies local-only) ; egress: read+write ; band: External
    status: BUILT (@bridge/integrations-google; see tools.md) — the reference integration
  - name: Microsoft Graph (Outlook/365)
    category: email/calendar
    license: proprietary; free OAuth access at Bridge scale
    free_terms: free tier via Microsoft identity platform
    powers: same shape as Google via a second connector on the same gate
    plane: local ; egress: read+write ; band: External
  - name: CalDAV / ICS feeds (RFC 5545)
    category: calendar (open standard)
    license: open protocol; ical.js (MPL-2.0) + ical-generator (MIT) already in stack
    free_terms: free; any ICS URL, no vendor
    powers: read external calendars + publish Bridge .ics feed — NO calendar server embedded
    plane: cloud (public ICS) / local ; egress: read ; band: Restricted
```

### 1c. Knowledge / research / enrichment

```yaml
knowledge_research:
  - name: Wikipedia / Wikimedia REST API
    category: knowledge
    license: content CC-BY-SA; API free
    free_terms: free, no key (rate-limited); attribution required on displayed content
    powers: entity context, company/person summaries for Knowledge
    plane: cloud ; egress: read ; band: Restricted
  - name: Wikidata Query Service (SPARQL)
    category: structured knowledge
    license: data CC0
    free_terms: free public SPARQL endpoint (fair-use rate limits)
    powers: entity disambiguation, org/person facts, identifiers cross-walk
    plane: cloud ; egress: read ; band: Restricted
  - name: OpenAlex
    category: scholarly / people-org research
    license: data CC0 (public domain)
    free_terms: free REST API, no key; polite-pool with email in User-Agent
    powers: researcher/author enrichment, institution graphs (already in entity-disambiguation)
    plane: cloud ; egress: read ; band: Restricted
  - name: Crossref / ORCID / Semantic Scholar
    category: scholarly
    license: Crossref metadata CC0-ish (open); ORCID public data CC0; Semantic Scholar free tier
    free_terms: free, keyless or free key; rate-limited
    powers: publication + identity signals for research-heavy workspaces
    plane: cloud ; egress: read ; band: Restricted
  - name: GitHub REST/GraphQL API
    category: developer knowledge
    license: proprietary API; free tier (5000 req/hr authenticated)
    free_terms: free with a user token; unauth 60 req/hr
    powers: repo/contributor context, dev-relationship signals
    plane: cloud ; egress: read ; band: Restricted (Internal if user's own repos)
```

### 1d. Registries / company & people data (Recon world — see §3 for license depth)

```yaml
registries:
  - name: SEC EDGAR (data.sec.gov)
    category: company/financial registry
    license: US-government public domain
    free_terms: free, NO key; fair-access cap 10 req/s; declarative User-Agent header REQUIRED
    powers: company facts, filings, officers — DealPilot / company-sourcing enrichment
    plane: cloud ; egress: read ; band: Restricted
    honest_note: 429 + temp IP block on breach — throttle in the connector, not the caller
  - name: GLEIF LEI (api.gleif.org)
    category: legal-entity registry
    license: data CC0
    free_terms: free API, no key; global LEI index
    powers: canonical legal-entity identity + parent/child org mapping
    plane: cloud ; egress: read ; band: Restricted
  - name: UK Companies House API
    category: company registry
    license: Crown/open; API free
    free_terms: free with a registered key; rate-limited
    powers: UK company + officer data for company-sourcing
    plane: cloud ; egress: read ; band: Restricted
  - name: OpenCorporates API
    category: company registry (global)
    license: database = ODbL (attribution + share-alike)
    free_terms: >
      free key = SHARE-ALIKE only (open-data/public-benefit use, must contribute back);
      commercial/proprietary use needs a PAID non-share-alike key
    powers: cross-jurisdiction company data
    plane: cloud ; egress: read ; band: Restricted
    honest_note: >
      NOT free for a commercial product on the share-alike key. Day-1 = SEC EDGAR + GLEIF +
      Companies House (genuinely free) first; treat OpenCorporates as a paid upgrade, not a
      launch dependency. ODbL attribution is mandatory wherever data is shown.
```

### 1e. Utility / context (no-key, no-license-friction — quick wins)

```yaml
utility:
  - name: Frankfurter (frankfurter.dev)
    category: FX rates
    license: open-source; ECB-sourced data
    free_terms: free, NO key, no stated usage limit; 30+ currencies, history to 1999
    powers: currency context for deal/finance workspaces
    plane: cloud ; egress: read ; band: Restricted
  - name: Nominatim (OSM geocoding)
    category: geocoding
    license: data ODbL (share-alike; small extractions ~ fair use)
    free_terms: free public endpoint, HARD cap 1 req/s, no bulk/systematic queries, UA required
    powers: address <-> coords for location context
    plane: cloud ; egress: read ; band: Restricted
    honest_note: 1 req/s ceiling = cache aggressively; self-host if volume grows
  - name: Open-Meteo / national weather APIs
    category: weather/context
    license: Open-Meteo data CC-BY; API free non-commercial tier
    free_terms: free keyless tier (commercial tier paid)
    powers: ambient context; low priority
    plane: cloud ; egress: read ; band: Restricted
```

---

## 2. Leverage plan — turning free specs into governed Commons capabilities cheaply

The point: **do not hand-write connectors.** Turn CC0 specs + Apache-2.0 codegen + the existing
governance spine into a near-zero-marginal-cost connector factory. Everything flows through the
Capability OS abstraction already ruled (ADR: `Capability → Bridge Manifest → Governance →
Sandbox → Evaluation → Registry → Workspace`).

**The pipeline (spec → governed connector in Commons):**

```yaml
connector_scaffold_pipeline:
  1_seed:
    input: public-apis + publicapis.io directories
    action: Learning Agent, on stated user intent, searches the seed catalog BEFORE proposing a build
    output: candidate provider + whether an OpenAPI spec exists in APIs.guru (CC0)
  2_spec:
    input: APIs.guru OpenAPI Directory (CC0 spec) OR provider-published spec
    action: fetch machine-readable spec; if none, Learning Agent drafts a minimal spec (governed, egress via gate)
    license_gate: record spec license (CC0 vs Fair Use vs provider) on the manifest — no silent scraping
  3_generate:
    input: OpenAPI spec
    action: OpenAPI Generator (Apache-2.0) emits a typed TS client
    output: '@bridge/connectors/<provider>' client — implements the SourceConnector / ConnectorProvider port shape
  4_manifest:
    action: wrap the client in a Bridge capability manifest — capabilities[] (resourceType/action/dataScope/egress),
            model_bindings (n/a), output_contract (Person|Memory|Touchpoint|Signal|Initiative), intake_policy{quarantine}
    rule: NO tool-owned OAuth — auth delegated to Nango (ConnectorProvider) + Authority credential broker
  5_risk_score:
    action: Capability Trust Model computes band from the manifest (lethal-trifecta union:
            private-read + code-exec + egress) — pure fn/SQL, zero LLM tokens
    output: Internal | Restricted | External band + required approval level
  6_govern:
    action: connector registered in broker; egress crossings run through the gate;
            External band => human approval at launch; agent-floor DENY on standing external:send
  7_publish:
    action: generalized connector KNOWLEDGE (manifest, not credentials/not user data) publishable to
            Universal Commons — the knowledge-only privacy gate (422 on workspaceId/token/email/...) enforces this
    result: one curated, reusable, version-pinned connector in the Capability Registry
```

**Cost math.** Steps 1–3 are automated (directory lookup + codegen). Human effort concentrates in
step 4 (contract mapping) and step 6 (approval) — exactly the two places Bridge's moat (governance
+ typed output contracts) lives. A CC0 spec → typed client is minutes, not days. Nango absorbs the
OAuth long tail so we never write per-SaaS token dances.

**Guardrails baked in:**
- **License provenance on every manifest** — CC0 / Fair Use / ODbL-share-alike / proprietary-free-tier
  recorded at scaffold time; ODbL + CC-BY sources carry a mandatory attribution field surfaced in UI.
- **Nango is behind a port, conditionally** — Elastic License 2.0 means license review before hard
  dependency; the minimal in-house OAuth seam stays as the fallback adapter (ADR-026).
- **Firecrawl stays hosted-API-only** (core is AGPL-3.0) for the Learning Agent's spec-drafting /
  research egress; Stagehand/Playwright is the browser fallback. Never embed the Firecrawl server.
- **Generated code is not trusted code** — a generated client executing is still governed; any raw
  transform runs in the isolated-vm (no network) per the sandbox doctrine.

---

## 3. Creative-Commons / open-data sources usable day 1

Genuinely usable at launch, with the obligations spelled out. **The trap is "free" that carries
share-alike** — those cannot ship inside a proprietary product without either contributing back or
paying. Bridge's rule: prefer CC0/public-domain first; treat share-alike (ODbL, CC-BY-SA) as
attribution-bound and NC as unusable commercially.

```yaml
open_data:
  clean_cc0_public_domain:   # safest — no share-alike, minimal friction
    - { name: SEC EDGAR, license: US public domain, obligation: User-Agent header + 10 req/s cap, commercial_ok: true }
    - { name: GLEIF LEI, license: CC0, obligation: none, commercial_ok: true }
    - { name: OpenAlex, license: CC0, obligation: polite-pool email in UA (courtesy), commercial_ok: true }
    - { name: Wikidata, license: CC0, obligation: none, commercial_ok: true }
    - { name: Crossref metadata, license: open/CC0-ish, obligation: none, commercial_ok: true }
    - { name: ORCID public data, license: CC0, obligation: none, commercial_ok: true }
    - { name: UK Companies House, license: Crown/open-gov, obligation: free key registration, commercial_ok: true }
  attribution_share_alike:   # usable but bind attribution / share-alike — surface credit in UI
    - { name: Wikipedia/Wikimedia, license: CC-BY-SA, obligation: attribution + share-alike on derived text, commercial_ok: true (with attribution) }
    - { name: OpenStreetMap / Nominatim, license: ODbL, obligation: attribution + share-alike on DB extracts; 1 req/s; cache/self-host at volume, commercial_ok: true (with attribution) }
    - { name: OpenCorporates (free key), license: ODbL share-alike, obligation: contribute-back OR buy non-share-alike key for proprietary use, commercial_ok: false on free key }
    - { name: Open-Meteo, license: CC-BY, obligation: attribution; commercial tier paid, commercial_ok: free tier non-commercial only }
  avoid_commercially:        # NC or restrictive — do NOT embed
    - { name: OpenSanctions DATA, license: CC-BY-NC, note: non-commercial — already flagged AVOID in oss.md }
```

**Attribution mechanics.** Add a `data_attribution[]` field to any connector manifest sourcing
CC-BY / CC-BY-SA / ODbL data; render a "Data sources" credit line on any surface that displays it.
This is cheap now and expensive to retrofit.

---

## 4. "Robust & viable from day 1" recommendations

Pre-revenue, privacy-first, local-first. These make the platform hold together at launch and turn
the constraints into positioning.

1. **Graceful degradation is the default, not a fallback.** The kernel already "runs with ZERO
   providers" (stack.md) and "deny OS permissions → Bridge still fully useful" (vision.md). Extend
   that contract to every connector: an unconfigured integration must render an **honest empty
   state** ("Connect Gmail to see Touchpoints") — never a spinner, never fake data (no-dummy rule).
   The Google integration's `MissingGoogleGatewayFactory` fail-closed pattern is the template:
   fail loud in dev, degrade gracefully in UI.

2. **Free-tier-first defaults, paid as explicit upgrade.** Day-1 connector defaults point at
   genuinely-free sources (SEC EDGAR, GLEIF, Companies House, Wikidata, OpenAlex, Frankfurter).
   OpenCorporates-commercial, RapidAPI-brokered, and paid model tiers are opt-in upgrades a user
   configures — never a launch dependency. This lets Bridge onboard with $0 external spend.

3. **The credential broker IS the launch differentiator — lead with it.** "Tools never hold your
   OAuth; Bridge mints scoped, temporary, revocable, audited grants" is a concrete privacy claim
   the ambient-agent competitors (Vida/Invoko/AirJelly) don't make. Every crossing is append-only
   audited; `private ∩ egress = none` is structural. Surface this in the connect flow (the
   Boundaries panel already exists in the prototype) — make the governance visible at connect time.

4. **Offline-first / local-plane read path.** Sourced public facts dual-write to the local store,
   so a workspace stays useful without a live connection (iPhone-updates model — Commons is a
   distribution channel, not a runtime dependency). Cache aggressively for rate-limited sources
   (Nominatim 1 req/s, SEC 10 req/s): a local cache with TTL turns a hard rate limit into a
   non-issue and doubles as offline data.

5. **Rate-limit + throttle inside the connector, not the caller.** SEC blocks IPs on breach;
   Nominatim caps at 1 req/s. Bake per-connector token-bucket throttling + the required
   `User-Agent` headers into the generated-client wrapper (step 3 of §2) so no caller can trip a
   ban. Connector health monitoring already exists in `packages/sourcing`.

6. **License provenance is a first-class field, enforced at scaffold.** Record spec + data license
   on every manifest; block CC-BY-NC (OpenSanctions data) and share-alike-for-proprietary
   (OpenCorporates free key) from commercial paths automatically; render attribution for
   CC-BY/ODbL. This is a compile-time check, not a lawyer's afterthought.

7. **Keep the Nango dependency reversible.** Elastic License 2.0 is not MIT. Adopt behind the
   `ConnectorProvider` port with the minimal in-house OAuth seam retained as a live fallback
   adapter, so a licensing/commercial change is a config swap, not a rewrite — same discipline as
   the `ModelProvider` and `CommonsStore` seams.

8. **Seed the Learning Agent's "propose integration before building" flow from the free catalog.**
   The public-apis / publicapis.io directories become the Learning Agent's first-pass lookup: on a
   stated need, check installed software → check the free-API seed catalog → propose an existing
   connector → only then propose a build. This operationalizes the "integration over custom
   development" principle with real, free targets on day 1.

**Net day-1 posture:** a working platform on $0 external API spend — Google/Microsoft for the
relationship core (free OAuth), a factory of CC0-spec-scaffolded read connectors for
enrichment/registries/knowledge, Nango (conditionally) absorbing OAuth, all landing in the existing
gate + broker + Commons — with paid tiers as clean, opt-in upgrades and the credential broker as
the headline privacy differentiator.
