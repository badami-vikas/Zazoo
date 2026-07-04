---
title: Tool Standardization Plan — one unified engine, internal/external tools, monorepo convergence
type: raw
doc_kind: plan
status: active
companions: [tools-internalization.md, jobpilot-vision-requirement.md, jobpilot-architecture-requirement.md, dealpilot-architecture-requirement.md, eta-dealflow-vision-requirement.md, eta-deal-sources-requirement.md, ARCHITECTURE.md]
related_wiki: ../wiki/tools.md
updated: 2026-07-03
tags: [tools, architecture, monorepo, jobpilot, dealpilot, recon, standardization, plan]
---

# Tool Standardization Plan

User decisions locked 2026-07-03: **full monorepo convergence** · **DealPilot ships first** ·
**specs ingested into docs/raw**. This plan supersedes the per-tool ad-hoc pattern and extends
[tools-internalization.md](tools-internalization.md); the manifest contract there stays, this plan
adds the internal/external taxonomy, the shared-engine package layout, and the migration sequence.

## 1. The problem this solves

Today the repo holds **five separate frontend applications** (prototype Vite SPA, recon Next.js,
hni Next.js, card-scanner Next.js, recorder FastAPI+Vite) plus the `platform/` pnpm monorepo.
Consequences observed in the 2026-07-03 audit:

- Recon has a manifest and an "Add to Bridge" button that post nowhere — a parallel governance
  system (staging.jsonl) that never reaches the ledger.
- Three unlinked registration systems (tools.ts display registry · scattered manifests ·
  tool_captures schema).
- Helpdesk lives as prototype pages, not a tool package — because it predates the tool model,
  there was no "one place" for it to live. (Answer to "why is there no Tools/helpdesk folder":
  the folder layout never had a slot for UI-surface tools; only scrape-style side apps went to
  Tools/. That split is exactly what this plan removes.)
- JobPilot/DealPilot specs each propose **their own full stack** (FastAPI+SQLite local;
  Next.js+Supabase+Trigger.dev SaaS) — building them as written would create apps #6 and #7 and
  duplicate sourcing, dedupe, enrichment, tables, calendar, recorder, approvals per tool.
- Duplicated capabilities already visible: recon company OSINT ↔ hni people lists ↔ ETA investor
  extraction ↔ DealPilot S1–S5 sourcing ↔ JobPilot Tier-1/2/3 sourcing are all the same
  waterfall pattern, written (or about to be written) five times.

## 2. Tool taxonomy (locked)

**Internal tool = capability.** Headless engine. No nav entry, no route of its own. Invoked by
external tools, rituals, agents, or the platform. Ships as a versioned package with a manifest
(`kind: internal`). Examples: people-sourcing, company-sourcing, enrichment-waterfall, recorder
(capture+transcribe), dedupe, fact-store, document-extraction, scoring.

**External tool = surface.** A product the user sees: registry entry, routes, UI. Ships as a tool
package with a manifest (`kind: external`) that declares `composes: [internal tool ids]`.
Examples: Helpdesk, DealPilot, JobPilot, Card Scanner, Camera, Calendar, future Conference tool.

Composition is the whole point: a Conference tool declares `composes: [recorder, people-sourcing,
calendar]` and gets recorder UI panels + governed capture without owning any of that code. Recon
stops being a standalone app and becomes two internal tools (§4). Recorder's engine becomes
internal; its current standalone UI remains only until its first composing external tool ships.

**Manifest additions** (extends the contract in tools-internalization.md):

```yaml
kind: internal | external
composes: [tool-id, ...]        # external only — internal capabilities it mounts
provides:                        # internal only — the typed API it exposes
  - { id: source.people, input: SourceQuery, output: CaptureEnvelope[] }
surfaces:                        # external only — routes + nav placement
  - { route: /dealpilot, nav: Work, icon: ... }
```

## 3. Target architecture — one monorepo, one engine (ADR-006)

`platform/` grows into the single home. Everything else migrates in; no new code lands outside it.

```
platform/
  apps/
    web/            ← THE app shell (absorbs the prototype; router mounts external-tool surfaces)
    api/            ← existing Fastify+tRPC (pipeline, authority, intake seam)
  packages/
    core|db|local|integrations-google   ← existing, unchanged
    tool-kit/       ← ToolManifest types + registry loader + intake client + conformance tests
    tables/         ← Notion-parity table engine extracted from DataEngine:
                      TableSpec (columns as data) · PersistencePort (localStorage adapter now,
                      pipeline adapter later) · ViewConfig (views as data) · GlideTable renderer
    sourcing/       ← connector framework + waterfall orchestrator:
                      SourceConnector port (API client | email-alert parser | template-detect
                      scraper | LLM-synthesized extractor | Playwright fallback) · tiered cost
                      waterfall (free → forms → email → browser-agent → human) · budget metering
                      (reserve→execute→settle) · connector health monitoring
    dedupe/         ← key-id exact + blocking rules + TF-IDF/embedding fuzzy + review-queue
                      escalation (JobFunnel + DealPilot S3 designs, one implementation)
    facts/          ← append-only fact store w/ provenance enum (listing|document|email|
                      seller_stated|public_record|ai_inferred|user_entered), per-cell confidence,
                      superseded_by, latched latest-wins views ("living profile" for deals, jobs,
                      people — DealPilot deal_facts generalized)
    llm/            ← model router on the ModelProvider seam: cheap tier (Ollama/Haiku) for
                      scoring/extraction, agent tier (Claude SDK) for analysis; prompts versioned
                      on disk, prompt_version stamped on outputs
    extraction/     ← document pipeline (PDF/XLSX → Docling sidecar → schema-keyed Claude
                      extraction with page-level citations → confidence gate → review|auto)
  tools/
    people-sourcing/    (internal — from recon person paths + hni + JobPilot Tier-1/2)
    company-sourcing/   (internal — from recon company paths + ETA extraction + DealPilot S1-S2)
    enrichment/         (internal — waterfall instances over packages/sourcing)
    recorder/           (internal — engine from Tools/recorder; FastAPI worker stays as sidecar)
    helpdesk/           (external — migrated out of prototype pages)
    dealpilot/          (external — first new build)
    jobpilot/           (external — second)
    card-scanner/ camera/ calendar/   (external — align to manifest, migrate incrementally)
```

**Deviations from the standalone JobPilot/DealPilot architecture docs — deliberate:**
- DealPilot's Trigger.dev → platform's Hatchet/BullMQ ritual engine (same durable-workflow role,
  already chosen in stack.md). Vercel/Next.js SaaS shell → `apps/web` surface. Supabase stays
  (already the platform DB); RLS multi-tenant pattern adopted as specced.
- JobPilot's FastAPI+SQLite → platform local plane (pglite) for the same local-first guarantee;
  Python survives only as sidecar services where library gravity is real (Docling parsing,
  Resume-Matcher scorers) behind typed ports — same pattern as the recorder's Whisper worker.
- Both tools' human-approval gates (Tier-3 browser agent, first-contact sequences, low-confidence
  merges) route through the EXISTING Universal Action Pipeline instead of bespoke review queues.
  DealPilot's review-queue rows = pending proposals; JobPilot's yellow-flag queue = Approvals.

**Platform-wide integration (no per-tool integration).** Integrations (Gmail, Calendar, future
Slack/LinkedIn) are connected ONCE at platform level, stored on the local plane, governed by the
existing integration-permission store. Tools never hold their own OAuth; a tool's manifest
declares `capabilities` and the Authority resolver grants scoped access (ritual ⊆ agent layering
already shipped). DealPilot's "CIM request from user's Gmail" and JobPilot's "Gmail Smart Router"
both consume the SAME google integration through the gate — zero new OAuth flows.

## 4. Recon decomposition

Recon (search-led OSINT background-check app) splits into:

- **`tools/people-sourcing`** (internal): person search/verify/enrich. Absorbs recon's per-source
  name-verification + match-tier governance (strong/moderate/flag — already a locked decision),
  hni's discovery lib, JobPilot's ATS/API clients where person-shaped.
- **`tools/company-sourcing`** (internal): company/deal discovery + enrichment. Absorbs recon's
  company paths, ETA investor extraction, DealPilot's S1–S2 connector designs + ETA-Deal-Sources
  P0 list, template-detect + LLM-extractor-synthesis as the shared long-tail scraper.

Both emit `CaptureEnvelope`s into the ONE intake seam → quarantine (`tool_captures`) → proposal →
Approvals → materialize (graph + ledger). Recon's staging.jsonl/permanent.jsonl parallel
governance is retired; existing permanent.jsonl facts migrate through the intake seam once, as
proposals. The recon Next.js UI survives short-term as a dev harness only; its "Add to Bridge"
button finally works because the seam it was built for now exists platform-wide.

## 5. Phases

**Phase 0 — hygiene (prereq, ~2 days).** Commit dummy_ stubs + `.nvmrc` + CI (already planned);
ingest Job specs (done 2026-07-03); expand pnpm workspace globs for `tools/*`; scaffold
`packages/tool-kit` with the manifest schema + registry loader + a conformance test ("manifest
present, intake round-trip, agent-floor respected").

**Phase 1 — extract the engine (~1–2 weeks).** `packages/tables` from DataEngine (P0/P1 already
shipped 2026-07-03 — extraction is a move, not a rewrite); `packages/dedupe`; `packages/facts`;
`packages/sourcing` skeleton with 2 proof connectors (one API client from career-ops pattern, one
email-alert parser). `apps/web` shell mounts the prototype as-is (iframe/route bridge) so nothing
breaks while surfaces migrate.

**Phase 2 — internal tools (~1–2 weeks).** `tools/people-sourcing` + `tools/company-sourcing` +
`tools/enrichment` on the engine; recon facts migrated; hni folded in; recon/hni standalone apps
frozen (read-only). Recorder engine extracted to `tools/recorder` (internal), FastAPI worker as
sidecar.

**Phase 3 — DealPilot (~3–4 weeks, first external proof).** `tools/dealpilot` composing
company-sourcing + enrichment + facts + extraction + tables + calendar + recorder. Scope per the
ingested architecture doc, re-based on platform stack: P0 connectors (BizBuySell email-alerts,
BusinessBroker.net, digital bundle), S3 dedupe, ThesisFit v1 scoring, living profile
(facts store), waterfall with cost ledger, deep-dive analyses on the llm package, sequences
through the governed google integration. Kanban/feed/detail UIs on `packages/tables` views.

**Phase 4 — JobPilot + Helpdesk migration (~3 weeks).** `tools/jobpilot` composing
people-sourcing + enrichment + facts + llm + calendar + google (Smart Router); Resume-Matcher
scorers as Python sidecar. Helpdesk pages move from prototype into `tools/helpdesk` (external) —
first migration proof that prototype surfaces can move. Conference-tool composition documented as
the reference example (recorder inside an external tool).

**Phase 5 — absorb the prototype.** Remaining prototype pages (Network/DataEngine, ItemDetail,
Signals, Settings…) move into `apps/web` proper; the "Design Bridge AI Interface (Copy)" folder
retires; Cloudflare Pages deploys `apps/web`. Standalone Tools/* apps deleted after their engines
are extracted.

## 6. Rules going forward (Definition of Done for ANY tool work)

1. Manifest first — no tool code without a manifest; registry derives from manifests at build.
2. One intake seam — every capture is a CaptureEnvelope through /tool-intake; no parallel stores.
3. Compose, don't copy — an external tool consumes internal tools via `composes`; copying engine
   code into a tool package fails review.
4. No new app shells — new UI = a surface in `apps/web`; new capability = a package/internal tool.
5. No tool-owned OAuth — integrations are platform-level; tools get capability grants.
6. Env-bound services — every external service URL is a validated env var; fail loud in prod.
7. Conformance test + wiki page + log entry before "done".

## 7. Building an external tool standalone, in a separate session/worktree (locked 2026-07-05)

DealPilot (and later JobPilot) can be built in parallel, in a different session or even a
different worktree, WITHOUT waiting for Phase 2's real recon/hni migration to land — provided it
is built against the **composition contract**, never against another tool's internals. The test
for "did I do this right": merging it back into `platform/` should be a diff that deletes stub
files and flips `workspace:*` deps, not a diff that rewrites DealPilot's own logic.

**The contract, concretely:**

1. **Manifest from day one.** Even a single-file prototype gets a real `kind: external` manifest
   (`tools/dealpilot/src/manifest.ts`, same shape as `tools/company-sourcing`) with `surfaces` +
   `composes: ["company-sourcing", "people-sourcing", "recorder", ...]` filled in for the
   capabilities it WILL use, even before those tools are wired to live data. The manifest is the
   seam — it's what makes later integration a flip, not a rewrite.

2. **Depend on the published port/type, never on the internal implementation.** DealPilot code
   imports `SourceConnector`, `RunWaterfall`, `PersistencePort`, `FactStore`, `RecorderPort`,
   `DedupeCandidate`/`MatchResult` — all already shipped, versioned, tested types in
   `@bridge/sourcing` / `@bridge/tables` / `@bridge/facts` / `@bridge/recorder` / `@bridge/dedupe`.
   It never imports from `Tools/recon`, `Tools/hni`, or reaches into another tool's `src/`
   directly. If a capability DealPilot needs isn't live yet (e.g. company-sourcing's real
   BizBuySell connector), DealPilot writes its OWN connector using the SAME `SourceConnector`
   interface — a temporary implementation behind a permanent shape, not a fork of recon's code.

3. **If the session/worktree doesn't have the platform packages available yet:** vendor
   hand-written **stub** modules that re-export the *exact* type signatures from the packages
   above (copy the `.d.ts` shape, not the implementation) plus a trivial in-memory
   implementation (mirrors `createMemoryPort`/`createBudgetLedger` patterns already in
   `@bridge/sourcing`/`@bridge/tables`). Mark every such file with a `// STUB — replace with
   @bridge/<pkg> on merge` header comment so a grep finds every seam that needs deleting. Do
   **not** hand-roll a different shape "for now and fix later" — the shape must match on day one,
   because the shape is the whole point.

4. **Own only DealPilot-shaped things.** Deal facts schema, ThesisFit scoring, kanban/feed view
   configs, CIM-request sequences — all DealPilot's own code, lives in `tools/dealpilot/`. Sourcing
   connectors, dedupe thresholds, the fact store, the table engine, the recorder port — never
   copied in, always imported.

5. **No tool-owned OAuth even standalone.** If DealPilot needs Gmail during standalone
   development, it calls through a `GoogleIntegrationPort` interface it defines locally (mirroring
   the real one) with a manual/mocked implementation — never its own OAuth app registration. This
   is the one rule where skipping the "build the real thing later" temptation matters most: a
   tool-owned Gmail OAuth app is exactly the kind of thing that's expensive to retrofit away.

6. **Merge-back checklist** (this IS the "remove the common part" step the user asked about):
   - Delete every file tagged `// STUB — replace with @bridge/<pkg>`.
   - Change `@bridge/*` deps in `tools/dealpilot/package.json` from a local path/stub to
     `workspace:*`.
   - Re-run DealPilot's own test suite unchanged — if a test breaks after swapping stub→real, the
     stub's shape had drifted from the real package and that's the bug to fix, not the test.
   - Register the manifest in the real tool-kit registry; run the cross-tool composition test
     (same pattern as `tools/company-sourcing/test/engine.test.ts`'s registry test).
   - `pnpm turbo run typecheck test build --force` at the platform root must stay green.

This same recipe is how JobPilot should be built in Phase 4, and is the general answer to "can an
external tool be developed independently and merged later": yes, as long as it depends on
contracts (manifests + typed ports), never on another tool's implementation.
