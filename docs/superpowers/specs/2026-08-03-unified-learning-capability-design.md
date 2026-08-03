# Unified Learning Capability — Design Spec

**Date:** 2026-08-03 · **Status:** drafted, awaiting approval
**Scope:** Collapse seven parallel research/capture surfaces into one Learning Agent capability. Restores the deleted `Tools/recon` connectors and Chrome extension, folds the `@bridge/research` Run engine, `skill.webResearch`, and `@bridge/sourcing` into a single loop behind existing ports, and fixes the delegation contract so a `neverExecutes` agent can still get work done.

## Why this exists

Every digression in this area exists for the same reason: a **source** was given its own loop. Recon got a Next.js app, a JSONL store, a scheduler daemon and a browser extension. The Run engine got a kernel ledger and a webview. `skill.webResearch` got a governed skill path. `@bridge/sourcing` got a waterfall. All four answer "find things about people and companies on the web."

The fix is not a new abstraction. It is that **sources become adapters behind ports that already exist**, and the Learning Agent owns exactly one loop.

## Ground truth (verified 2026-08-03 against `origin/main`)

| Surface | State |
|---|---|
| `@bridge/research` engine | Live. Green/amber/red authority, bounds, injection quarantine, 31 tests, no network in tests |
| `research_webview.rs` + `research_read_page` / `research_locate` | Live in the Tauri shell |
| `skill.webResearch` | Live. Parallel Search MCP, keyless |
| Kernel Runs — `research_runs` + `research_run_steps` (migration `0035`) | Live. Append-only, FORCE RLS, terminal rows frozen by trigger |
| Learning Agent manifest | Declared with 2 skills (`stage-offer`, `web-research`). Agent itself is still prompt + one LLM call |
| `@bridge/sourcing` + `people-sourcing` / `company-sourcing` | Live. Its own header names itself the seam recon should funnel through |
| `social/registry.ts` LinkedIn provider | **Fixture only.** `LINKEDIN_RECON_BRIDGE` env reserved; `registerLiveProvider` never called for `linkedin` |
| `Tools/recon` + Chrome extension | **Deleted** by `41d3b37` "Complete repository and manifest cleanup" (2026-07-21) — 456 files, 117,567 lines |

Recovery source: `git show 41d3b37^:Tools/recon/...`, and a code-only salvage committed at `Tools/recon-salvage-2026-08-03/` (61 files, no `node_modules`, no `data/`, no `.env.local`). The local working copy was verified byte-identical to git — nothing uncommitted was lost.

The salvage is **source material to port from, not a restored application.** It is deliberately not wired into the workspace, not built, and not run. It exists so the connectors cannot be lost a second time. Scanned before committing: no API keys, no third-party PII. It does carry the repository owner's own contact address in `SEC_UA` and the OpenAlex `mailto` — both are functionally required (SEC and OpenAlex block requests lacking a descriptive contact UA), and both must be reviewed before any change to this repository's visibility.

`scripts/check-no-pii.sh` was deleted by the same commit. Capture is coming back; **that guard is restored first.**

## Decisions taken

### D1 — Visibility keys on account involvement, not on browsing

| Read touches | Mode |
|---|---|
| Your logged-in session, your account, your credentials | **Visible. You present. Never automated while away.** |
| Anonymous public web — search, public records, JSON APIs, public JS-rendered pages | **Background. Headless. No window.** |

Rationale: the always-on-bottom visible webview was protecting against *silent action on your behalf*. Anonymous research is not on your behalf in that sense — no session is spent, nothing is attributable to you. Forcing it on screen buys no safety and costs a usable machine.

**Background is not unaudited.** Every step lands in `research_run_steps`, is inspectable in the `/research` timeline, and carries its taint label. Background means no window, not no record. The Avatar blink stays bound to capture Events, which under this rule fires exactly on account-touching reads.

### D2 — Delegation: any agent, authority re-derived

Canon (`foundational-agents.md`) says a child Run gets a "subset/intersection of parent authority." Read strictly this makes a `neverExecutes` agent unable to accomplish anything through delegation, and forbids delegating to a *more* capable specialist — which is not how any real organisation works.

But the reason subset-thinking exists is real. If a subagent can be any agent **and treats the caller's request as authorization**, delegation becomes a privilege-escalation channel. The concrete failure: hostile page text steers the Learning Agent; Learning cannot execute, so it delegates to Builder; Builder executes. `neverExecutes` constrained the caller and bought nothing. This is the confused-deputy problem, and it is the most likely breach path for this capability, because the Learning Agent's entire job is reading text written by strangers.

**Contract:**

> Any agent may be delegated to. **Authority is never inherited, transferred, or borrowed — it is re-derived at the callee from the callee's own grant.** The handover is a per-request Decision that the Governance Agent observes.

Learning → Builder is therefore a plain call, not a special escalation concept. Builder acts because *Builder* holds that authority and a human Decision authorized *this* request. Learning resumes from the ledger on the Result (BR4 replay already does this).

| | Subset-only | Any-agent, inherited | **Any-agent, re-derived** |
|---|---|---|---|
| Delegate to a specialist | ✗ | ✓ | ✓ |
| Escalation-proof | ✓ | ✗ | ✓ |
| `neverExecutes` holds | ✓ | ✗ | ✓ |
| Run tree statically bounded | ✓ | ✗ | ✓ (per node's own grant) |
| Cost | — | none | one Decision per handover |

**Held firm:** the Decision is per-request. A standing "Learning may call Builder" grant is inheritance wearing a different hat.

### D3 — Recon salvage: connectors and semantics, not the app

Nothing standalone survives. The Next.js verify/report UI becomes a governed Bridge Page and a Result. The JSONL draft-then-approve store retires onto suggested-Memory. The scheduler daemon becomes an Automation with a budget.

### D4 — Stealth confined to infrastructure-walled public records

CloakBrowser is admitted **only** for public records walled by infrastructure rather than by terms: State SoS portals, Google Patents results, Interpol's Akamai wall, Scholar. Never LinkedIn, never anything behind a login. Enforcement is a domain allowlist table, not policy prose.

## Architecture

### One reader port, three adapters

`ResearchPageReader` already exists. Adapter selection is made by the **engine** from a domain policy table — never by the planner, same rule that makes the authority tiers safe.

| Adapter | Handles | Mode | Status |
|---|---|---|---|
| `http-reader` | static / server-rendered | background | exists |
| `webview-reader` | public JS-rendered pages | background (was visible; D1 relaxes it) | exists |
| `extension-reader` | LinkedIn and any page you have open — your session, your consent, you present | **visible, inherently** | restore |
| `cloak-reader` | infrastructure-walled public records, allowlisted | background | new, optional |

`cloak-reader` cannot be pointed at LinkedIn because LinkedIn is not on its list — enforced by table, not by prose.

### One search/source port

`ResearchSearch` exists (Parallel Search MCP). Adds:
- **SearXNG** adapter (self-hosted, from recon's `docker-compose.searxng.yml` + `searxng/settings.yml`; requires `formats: [html, json]`)
- **Context.dev** adapter (Tier 2, see triage) for scrape-to-Markdown, crawl, and structured extraction

The 35 recon enrichers become `SourceConnector`s in `@bridge/sourcing`, reached through the waterfall `people-sourcing` / `company-sourcing` already run. The agent gains **one** green tool, `sources`, rather than 35 ad-hoc fetches.

### One evidence ledger

Kernel `research_runs` + `research_run_steps`. Recon's `staging.jsonl` retires; its dedup key (`subject + scope + label + value + source`) moves onto suggested-Memory so re-running a subject still does not double-count.

### One approval gate

Recon's "100 staged rows → approve/discard" becomes the `suggested-memory-batch-digest` Automation the learning roadmap already specifies. Same semantics, one mechanism.

### One capture envelope

The extension posts a `CaptureEnvelope` (recon's `lib/bridge.ts` already defined this contract) to the desktop sidecar — tainted `untrusted_external`, provenance `user_present`. Never straight to the graph; always through `pipeline.propose`. This closes the declared-but-empty seam by finally calling `registerLiveProvider("linkedin", …)`.

**Hardening on restore:** drop `debugger` from the MV3 manifest (currently requested alongside `activeTab`, `scripting`, `storage`, `tabs`, `alarms` — `debugger` grants full CDP over any tab and is not needed for DOM extraction).

### Final tool list for the Learning Agent

- **green:** `search` · `read` · `find` · `note` · `sources` *(new)* · `capture` *(new)*
- **amber:** unreachable from this agent — routed by Proposal → Decision → Builder Run → Governance observes → Learning resumes
- **red:** unchanged, never proposed — credentials, payment, purchases, publishing/sending, any login/checkout/security page

## What migrates from recon

**35 enricher connectors**, all keyless or optional-key: FINRA BrokerCheck · OpenAlex · ORCID · Semantic Scholar · GLEIF · SEC EDGAR + XBRL revenue + Form ADV/IAPD · USAspending · CourtListener · OFAC SDN (cached list) · OCCRP Aleph · Interpol · HIBP · WhatsMyName username enumeration · Bluesky · Mastodon · Reddit + HN mentions · Greenhouse/Lever hiring · tech-stack fingerprint · MX email inference · ProPublica 990 · BLS OEWS + DOL OFLC salary · Wikidata · GitHub · JSON-LD · SearXNG discovery · news (GDELT + Google News RSS) · State SoS / UCC / OpenCorporates / Patents deep-links.

**The parts that are harder to rebuild than the fetchers** — and therefore the real migration value:
- Identity resolution: `resolveIdentities`, `mergeCandidates`, `foldInto`, `idKeys`, `applyHints`, `nameMatchScore`, `affiliationCorroborates` → `@bridge/dedupe` (which already has `match.ts` / `scoring.ts`)
- Confidence tiering: `groupByTier`, `applyMultiSignalBoost`, `classifyHit`, `getMissingEnricherKeys`
- Economics models: `privateRevenueModelEnrich`, `gpFundEconomicsEnrich`, `founderEconomicsEnrich` — banded estimates with provenance, never point numbers
- Circuit-breaker and pacing logic from `scripts/scheduler.mjs`, tuned against real throttling: canary classification (SearXNG + GitHub), three-tier breaker (in-run abort → cross-run backoff → hard pause), `DAILY_CAP`

**Compared, not ported blind:** recon's `ssrf.ts` (149 lines) against the shipped `@bridge/net-guard`. Expect net-guard to win; recon's tests come along regardless.

**Does not migrate:** the Next.js app, `data/*.jsonl` (real PII), `.env.local` (live keys), the launchd plist.

## External tool triage

Assessed under the reuse-intake order (install → wrap → adapt → integrate-without-copying → build).

| Tool | What it is | Verdict |
|---|---|---|
| **WUPHF** (nex-crm) | Go multi-agent office. Per-agent notebook + shared git-native markdown wiki; promotion flow notebook→wiki; typed facts with triplets; per-entity append-only fact logs; `/lookup` cited retrieval; `/lint` for contradictions, orphans, stale claims; per-agent MCP tool scoping | **REFERENCE-ONLY — license bars adoption.** Sustainable Use License, not OSI open source; restricts hosting for third parties, which is exactly Bridge's distribution model. **Pattern value is the highest of the six:** notebook→wiki promotion *is* LA0's propose→accept; `/lint` *is* the `knowledge-freshness-sweep` Automation; per-agent tool scoping (DM loads 4 of 27) validates giving the Learning Agent 6 tools rather than 35 |
| **Context.dev** | Web context API: scrape→Markdown, crawl, web search, schema-validated JSON extraction, screenshots, sitemap, page/sitemap/extract **monitors** with signed webhooks. REST + TS/Python SDKs + MCP server | **ADOPT-BEHIND-PORT, Tier 2.** Best available answer to the Firecrawl problem the roadmap flagged (AGPL engine, 5-service self-host). One credit per successful page; JS render and anti-bot included without multipliers; failed requests unbilled. Free 250–500 credits → $25/mo for 10k. Its **monitors** also close recon EXPANSION Phase 3's "monitoring cron → diff → emit Signals" |
| **Coasty** | Computer-use API. Screenshot→structured actions with (x,y) grounding, stateful sessions, managed Linux/Windows VMs, schedules, webhook triggers, BYOK | **TIER 3, Builder-side only, not adopted now.** Learning is `neverExecutes`, so this could only ever sit behind Builder. Two blockers: cloud VMs make it Cloud Plane, and shipping raw screenshots off-machine violates raw-capture-stays-local for anything account-touching. It also duplicates TASK-027's Set-of-Mark locator, which already works |
| **Rindler** | Hosted MCP server; per-site human-mapped typed tools. Benchmarked 4× faster / 3× cheaper vs browser-use | **REJECT as a service; STEAL THE PATTERN.** "You sign in once and Rindler reuses the session" puts your credentials and live session on their infrastructure — direct conflict with D1 and with local-plane residency. But *map a site once into deterministic typed tools instead of re-deriving selectors every run* is the correct answer to brittle scraping — and it is precisely what recon's 35 enrichers already are. Independent validation of the migration |
| **Prized** | AI-built internal tools; admin pre-approved connections, per-tool role + grant list, workspace audit log | **REFERENCE — competitive validation.** Not a research agent. Its scoped-grant + audit-log model is a market signal that Bridge's governance posture is the right one, not a component to adopt |
| **LemonLime** | SaaS; self-creates agents and automations, "deploys thousands of agents to study your business" | **REFERENCE — competitive.** Closest public analogue to Living Software's adapt-before-asking pitch. No API, license, or self-host story to evaluate |

**Provider tiering (extends ADR-111):**
- **Tier 1** — free, no account: Parallel Search MCP *(have)*, self-hosted SearXNG, the 35 keyless connectors
- **Tier 2** — free tier, needs a key: **Context.dev**
- **Tier 3** — paid, evaluation- and approval-gated: CloakBrowser Pro, Coasty, Rindler

**Account creation is a human action.** Context.dev advertises an agentic self-signup flow (`auth.md`) where an agent registers and retrieves an API key. Bridge does not use it — accounts and credentials are provisioned by the user, and the key lands in the existing vault.

## Data flow

```
objective
  → planner proposes step (tool + argument)
  → ENGINE assigns authority tier + selects reader adapter from domain policy
  → green: execute
     · account-touching  → extension-reader, visible, user present
     · anonymous         → http / webview / cloak reader, background
  → external text quarantined as untrusted_external at the boundary
     (fenceUntrusted; never concatenated into an instruction channel)
  → step recorded to research_run_steps (terminal child Run under one parent envelope)
  → amber: Proposal → human Decision → Builder Run (Builder's own authority)
           → Governance observes transition → Result → Learning resumes from ledger
  → red: refused, never proposed
  → findings batch → suggested-Memory digest → accept/reject → durable Memory
```

Bounds on every Run: steps · pages · wall clock · total bytes. Every exit path records a `StopReason`.

## Error handling

- Source failure is **logged, never fatal** — recon's rule. SearXNG down degrades discovery; registries still run.
- Failures classified before the breaker reacts: sources walled by design (Interpol, OpenCorporates, Aleph, State SoS) are ignored; only canary sources (SearXNG, GitHub) returning 403/429/CAPTCHA/timeout count as block signals.
- Anti-bot walls that cannot be verified emit an **honest "unverified pointer"**, never a fabricated row.
- A resumed Run replays prior steps from the ledger as evidence and never re-executes them — it cannot re-click or win back a spent budget.
- Unknown taint label fails closed.

## Testing

- Engine keeps its no-network / no-browser / no-model unit discipline; new adapters are ports, tested against fakes.
- **Injection eval suite is a permanent gate, not a retrofit** — seeded hostile pages must produce zero behaviour change and zero unauthorized Memory writes.
- Delegation tests: a `neverExecutes` agent cannot reach amber; a Proposal originating from quarantined text cannot auto-approve; Builder rejects a request lacking its own grant.
- Domain-policy tests: `cloak-reader` refuses a non-allowlisted host; account-touching hosts refuse background mode.
- Migrated connectors carry recon's SSRF tests.
- Cross-plane leak test as a hard invariant.

## Sequencing

**Step 0 — sync.** Local `main` is 352 commits behind `origin/main`. Nothing starts before this.

1. **Salvage + guard** — restore `check-no-pii.sh`; recover connectors from `41d3b37^`; compare `ssrf.ts` against `@bridge/net-guard`; port SSRF tests
2. **Sources** — 35 enrichers → `@bridge/sourcing` connectors; entity resolution + tiering → `@bridge/dedupe`; `sources` green tool; SearXNG adapter
3. **Capture** — extension restored, `debugger` permission dropped, `registerLiveProvider("linkedin", …)` wired, `CaptureEnvelope` → `pipeline.propose`
4. **Reader tiers** — domain policy table; `cloak-reader` behind allowlist; D1 visibility rule enforced in adapter selection
5. **Delegation** — Proposal → Decision → Builder → Governance observation → resume; per-request grant
6. **Context.dev** — Tier 2 adapter behind `ResearchSearch` / `ResearchPageReader`; monitors → Signals
7. **Retire** — delete every parallel loop. Nothing standalone survives

## Governance records required

- **ADR** — the D2 delegation contract (any agent, authority re-derived, per-request Decision). This *refines* `foundational-agents.md` rather than reversing ADR-046; `neverExecutes` is strengthened, not relaxed
- **ADR** — D1 visibility rule keyed on account involvement, superseding blanket always-visible browsing
- **ADR** — extends ADR-111 provider tiering with Context.dev (Tier 2), CloakBrowser / Coasty / Rindler (Tier 3), WUPHF / Prized / LemonLime (reference-only, license or residency barred)
- **APPROVALS** — Tier 3 spend gate before any paid provider call
- **`docs/dummy.md`** — the LinkedIn fixture provider is tracked there until step 3 replaces it with the live capture path

## Risks

| Risk | Mitigation |
|---|---|
| **Confused-deputy via delegation** — the single biggest one; the agent's job is reading hostile text | Authority re-derived at callee; per-request Decision; injection suite as permanent gate |
| **PII re-entering the repo** — recon's `data/` holds real enriched profiles; a prior cleanup already deleted this whole tree once | `check-no-pii.sh` restored *before* salvage; `data/` and `.env.local` excluded from the snapshot; salvage directory is untracked |
| **CloakBrowser licensing drift** — v148+ needs Pro; OEM required to distribute | Confined to one optional adapter; free-tier binary goes stale by design, so treat as evaluation-only until an APPROVALS row |
| **Second store re-emerging** | Retirement is step 7 of the plan, not an afterthought |
| **Salvage mistaken for a live app** | It is tracked but deliberately unwired — no workspace entry, no build, no run. Retirement (step 7) deletes it once the ports are ported |
| **`data/` or `.env.local` re-added later** | Both were excluded at salvage time and must stay excluded; `data/` holds real enriched profiles and `.env.local` holds live keys |

## Open questions

- Whether `webview-reader` and `cloak-reader` collapse into one background adapter once the domain policy table exists, or stay separate for CVE-surface reasons
- Whether the recon report becomes a first-class governed Result type or renders from `research_run_steps`
- Concrete `DAILY_CAP` and budget values for the enrichment Automation under kernel budgets rather than the daemon's own knobs
