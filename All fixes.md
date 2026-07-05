# All Fixes — Master Tracker

Single source of truth for the 2026-07-04 brutal code review + platform audit. Every pointer
from the review is listed below, one checkbox each. Status legend:

- `[x]` RESOLVED — done, verified (build/test or explicit decision), date given.
- `[~]` IN PROGRESS — partially done, gap noted.
- `[ ]` OPEN — not started.

Cross-references: [docs/wiki/known-issues.md](docs/wiki/known-issues.md) is the live bug ledger
(update it, not just this file, when something here changes state — this file is the phase/
priority view, known-issues.md is the per-bug detail view). [docs/raw/decisions-log.md](docs/raw/decisions-log.md)
holds the rationale for every approval-gated call. Update this file's checkboxes whenever an item
here changes state; don't let it drift from known-issues.md.

Last updated: 2026-07-05.

---

## 1. Architectural anti-patterns & code smells

- [ ] **[P0]** Ledger resolution linkage lives in a jsonb magic string
      (`diff->>'__refLedgerId'`, `ledger-store.ts:17`). No column/index/constraint — any skill
      returning a diff key literally named `__refLedgerId` corrupts double-approve detection.
      Fix: real `ref_ledger_id` column + seed + partial unique index. *(feeds Phase 1 item 4)*
- [ ] **[P0]** `wiring.ts` is a 350-line god composition root that lies about persistence
      (`wiring.ts:234-279`, let-sprawl if/else). Capture store in-memory unconditionally (line
      212), canonical identity store in-memory even when `DATABASE_URL` set (line 259), header's
      "ledger MUST stay local" contradicted by the persistent branch. Fix:
      `buildPersistentPorts()` / `buildInMemoryPorts()` factories, one fully-typed object, delete
      every `let`. *(feeds Phase 2 item 8)*
- [ ] **[P1]** Agent-floor invariant triplicated: `AGENT_FLOOR_MUTATIONS` (`authority.ts:31-49`),
      `isForbiddenAgentToken` (`agent-scope.ts:46-60`), `ALWAYS_APPROVAL_SCOPES`
      (`integration-store.ts:28`). Fix: one exported const in `@bridge/core`, other two derive.
      *(feeds Phase 1 item 6)*
- [ ] **[P1]** Post-commit policy phase is decorative — `pipeline.ts:234-244` computes and
      discards `evaluate()`; a `block` effect blocks nothing. Fix: narrow post-phase effect type
      to advisory, or wire a remediation path.
- [ ] **[P1]** Injected seams reading as shipped protection but unwired: `PacingGate` zero
      callers; `createBusinessBrokerNetConnector` normalizer with no fetcher; agent-floor DENY
      seed in `0001_governance_seed.sql:52-67` a documented-not-executed template. Fix: wire each
      or mark experimental; stop claiming a DB backstop that isn't real. *(feeds Phase 3 item 14
      for PacingGate; BusinessBroker.net decided below, not wiring)*
- [ ] **[P2]** BizBuySell alert HTML parsed by hand-rolled regex (`connectors.ts:26-57`) — one
      template change silently drops parse rate to zero, no counter/alert. Fix: parse-null-rate
      metric + threshold alarm. *(feeds Phase 2 item 10)*
- [ ] **[P2]** Untyped jsonb read silently drops malformed data: `ritual-stores.ts:20-35`
      `asStep` filters bad steps to `null` (ritual "runs successfully" doing less than
      configured); same pattern in `governance-stores.ts:113-144`. Fix: zod-validate at write
      time, throw loudly on read.
- [ ] **[P2]** Copy-paste drift: 3 near-identical ATS connector factories
      (`jobpilot/connectors.ts:9-19`); `FUZZY_THRESHOLD = 0.9` in answer-bank duplicating
      dedupe's threshold with no shared source; uncommented magic numbers (`costPerCall`,
      `0.5 + 0.1 * filled`).
- [ ] **[P3]** `resolveAuthority`'s agent branch mixes four authority layers in 90 lines
      (`authority.ts:204-268`) — split before the delegation-runtime punch-list item extends it.

## 2. Silent edge-case failures & race conditions

- [ ] **[P0]** Double-approve TOCTOU in `decide()` — `pipeline.ts:171-206`, no transaction/lock/
      unique constraint; two concurrent decides both commit, both fire `onApproved`, an approved
      email sends twice. Same hole in the in-memory ledger (`stores.ts:142-157`). *(Phase 1 item 4)*
- [x] **[P0] RESOLVED 2026-07-04** — Non-deterministic auto-merge tie-break.
      [match.ts](platform/packages/dedupe/src/match.ts) `matchOne` rewritten: exact-score ties
      downgrade to `moderate` (human review) instead of silent array-order pick. 2 new tests in
      [match.test.ts](platform/packages/dedupe/test/match.test.ts), 9/9 green.
- [x] **[P0] RESOLVED 2026-07-04** — Fire-and-forget OAuth token persistence.
      [gateway-google.ts](platform/packages/integrations-google/src/gateway-google.ts) token
      listener now `.catch()`s and logs the integration id instead of a bare `void`.
- [ ] **[P1]** Gmail sync double-propose window — `hasExternal` (`intake.ts:155`) only excludes
      materialized records; two syncs before approval → duplicate pending proposals → duplicate
      Touchpoints/Memories on double-approve. No dedup key on the entities themselves.
      *(Phase 2 item 9)*
- [ ] **[P1]** Ritual halt leaves the graph half-mutated — `ritual-executor.ts:141-166`, no
      rollback/compensation/"partially applied" surfacing on a mid-run deny.
- [ ] **[P1]** JWKS verify failures explode context creation — `identity.ts:62-66`, no
      timeout/catch; a slow/down JWKS endpoint turns every authenticated request into an opaque
      rejection instead of a 401.
- [ ] **[P2]** `decide()` reconstructs the request with `skill: "(replayed)"`, silently drops
      `context`/`dataScope` (`pipeline.ts:320-334`) — audit trail can't answer which ritual
      produced a decision or what data tier it touched. *(Phase 1 item 5)*
- [ ] **[P2]** Untyped pipeline errors — bare `Error` throws surface as `INTERNAL_SERVER_ERROR`
      for what are really 403/404/409 conditions. `IntegrationFloorScopeError` pattern
      (`router.ts:576`) proves the fix is known; applied once. *(feeds Phase 1 item 4's typed
      errors)*

## 3. Memory leaks & bottlenecks

- [ ] **[P1]** Every in-memory store unbounded, and in-memory is the default production path:
      `InMemoryLedger.entries`, `InMemoryEventBus.events`, `InMemoryEphemeralStore.grants`
      (expired grants never pruned) — linear leak until OOM, `/health` still reports `ok:true`.
      Fix: refuse to boot in production without a real ledger; cap+evict dev adapters.
      *(Phase 2 item 8)*
- [ ] **[P1]** N+1 sequential Gmail fetches — `gateway-google.ts:85-124`, `threads.list` then a
      sequential `threads.get(format:"full")` per thread, re-fetching already-seen bodies. Zero
      retry/backoff/quota handling in the package. *(Phase 3 item 14)*
- [ ] **[P1]** No pagination on any list surface — `dealpilot.list` (`router.ts:480-488`) maps
      the entire candidate set through per-id `facts.livingProfile()`; `integration.list` same.
      Add `limit`/`cursor` now. *(Phase 3 item 14)*
- [ ] **[P2]** Unbounded multipart recursion + full base64 decode in memory —
      `extractPlainText` (`gateway-google.ts:46-64`), no depth limit, no size cap before
      `Buffer.from(...).toString()`.
- [ ] **[P2]** Fresh OAuth2 + gmail/calendar client construction per skill invocation
      (`forIntegration`, no cache keyed by `integrationId`), each attaching a new tokens listener.

## 4. Scale-blocking complexities

- [ ] **[P0]** Single-tenant by construction, API pretends otherwise —
      `PILOT_WORKSPACE`/agent IDs baked into `buildWiring()` (`wiring.ts:73-77`); `google.*`
      procedures accept no workspace; `dealpilot.list` accepts `workspaceId` and ignores it —
      second workspace = cross-tenant leak. *(Phase 3 item 11)*
- [~] **[P0] PARTIALLY RESOLVED 2026-07-04** — Fresh-provision infrastructure broken.
      `_journal.json` now registers `0001_governance_seed` + `0002_add_recon_columns` (was only
      `0000`); 4 latent bugs this exposed (missing statement-breakpoints, unused pgcrypto,
      DROP INDEX→DROP CONSTRAINT, Supabase-only role REVOKE) all fixed, verified via
      `packages/db` pglite suite. **Still open:** RLS policy DDL still lives only in the live
      Supabase project, no migration file for it — blocked on Supabase project access (see
      Blockers C). *(Phase 0 item 2)*
- [ ] **[P1]** Synchronous in-request ritual execution — `InProcessRitualExecutor` runs all steps
      inside the tRPC await chain, no timeout/cancellation/resume; process crash leaves runs
      "running" forever. Known-deferred behind the Hatchet seam.
- [ ] **[P1]** Random UUIDv4 PKs on append-only high-write tables (ledger, events,
      timeline_entries) — B-tree page-split thrashing, no time-locality. `timeline_entries` has
      no index beyond its PK — full scan + sort from day one. No partitioning/retention story.
      *(Phase 3 item 12, UUIDv7)*
- [ ] **[P1]** Missing hnsw index on embeddings — `SCHEMA.sql` specifies it, migrations only
      create a btree lookup index. Every similarity query is a seq-scan. *(Phase 3 item 12)*
- [ ] **[P2]** `people_canonical.emails text[]` has no index (`= ANY(emails)` is a per-row array
      scan); `dedup_key` is a nullable unique — unlimited NULL-key rows defeat "globally
      deduped." *(Phase 3 item 12)*

## 5. Type definitions, schemas, API contracts

- [ ] **[P1]** `inputs: z.unknown()` at the "single validate+sanitize chokepoint"
      (`router.ts:89`) — unvalidated client payload flows to `skill.run` and the ledger;
      `envelope as never` (`router.ts:310`) is a hard type-system bypass where a
      `z.discriminatedUnion` on `kind` belongs. *(Phase 3 item 12)*
- [ ] **[P1]** Naive drizzle-generated unique on `role_permissions` vs. the hand-written coalesce
      index in `0001` — `drizzle-kit push` locally tests different uniqueness semantics than
      production migrates to.
- [ ] **[P2]** Enum-as-text with zero CHECK constraints (`visibility`, `effect`, `user_decision`,
      `actor_type`, etc.) — zod guards the API door only; `'approvd'` inserts fine and corrupts
      every audit query. *(Phase 3 item 12)*
- [ ] **[P2]** Inconsistent zod strictness in one file — `resourceId: z.string()` (no `.uuid()`)
      at `router.ts:88/112` vs. `.uuid()` required at `router.ts:543/551` — malformed ids become
      500s instead of 400s. *(Phase 3 item 12)*
- [ ] **[P2]** Two soft-delete idioms (`archived_at` vs. `status='archived'`) coexist with no
      rule for which applies where; `WHERE archived_at IS NULL` silently includes archived
      agents/tools/skills.
- [ ] **[P3]** `recon_signals`/`embedding_models` are speculative columns/tables with GIN
      indexes and zero consumers — write amplification paid today for queries that don't exist.
      `docs/raw/SCHEMA.sql` stale vs. deployed schema (v1.1 recon columns never reflected back).

---

## Revised Plan — phase tracker

### Phase 0 — Make verification real (prereq for trusting any later "green")

- [x] **RESOLVED 2026-07-04** — GitHub Actions: install, typecheck, `test --force`, build both
      apps. `.github/workflows/ci.yml` exists (added by a parallel session), verified using
      `--force`. **Gap:** not yet verified green on a live push — needs your repo secrets
      (see Blockers C).
- [~] **PARTIALLY RESOLVED 2026-07-04** — Migration hygiene: `0001`/`001_add_recon_columns`
      (renamed `0002_add_recon_columns`) now registered in `_journal.json`. **Still open:**
      extract live RLS policy DDL from Supabase into `0003_rls_policies.sql`; CI asserting
      fresh-migrate produces non-empty `pg_policies` + schema matching `schema.ts` — blocked on
      Supabase project access.
- [ ] Commit the `dummy_` `network.ts` stub — **needs your approval** (Blockers B).

### Phase 1 — Governance spine correctness

- [ ] 4. `ref_ledger_id` + seed as real columns, partial unique index, transactional `decide()`;
      typed errors (`AlreadyResolvedError` → 409, floor deny → 403) with audited-rejection rows.
      *(Note: the audited-rejection-row HALF of this is already done — see below — the
      transactional/typed-error half is still open.)*
- [ ] 5. Persist `dataScope` + `context` on `LedgerEntry` (audit completeness).
- [ ] 6. Consolidate the triplicated agent-floor constant; execute (or explicitly retire) the
      DB-level agent-floor seed.
- [ ] 7. Resolve the local-ledger residency contradiction in persistent mode — **needs your
      decision**: split ledger by `data_scope`, or drop the guarantee from the header.

  Sub-item already done, tracked under Phase 1's audit-completeness goal:
  - [x] **RESOLVED 2026-07-04** — Audited-rejection ledger row on agent-floor deny.
        [pipeline.ts](platform/packages/core/src/pipeline.ts) `decide()` now fetches the
        original entry, then on floor-deny appends an audited-rejection row before throwing.
        `pipeline.test.ts` updated, 54/54 `@bridge/core` tests green.

### Phase 2 — Stop the silent lies

- [ ] 8. `wiring.ts` refactor into typed port factories; fail-fast on missing env in production;
      `/health/ready`; loud warnings + synthetic-marking on every fixture/in-memory fallback
      (social, canonical store, capture store).
  - [x] **RESOLVED 2026-07-04 (CORS half only)** — CORS allowlist.
        [server.ts](platform/apps/api/src/server.ts) `corsOriginConfig()`: explicit
        `API_ALLOWED_ORIGINS` always wins, production fails closed without it, loud
        `app.log.warn` either way. 3 new tests, all green.
  - [ ] Startup env assertions + `/health/ready` probing db + local plane — **still open**.
  - [ ] Silent-fallback loudness (db.ts loaders, social fixtures) — **still open**.
  - [ ] `wiring.ts` typed-port-factory refactor itself — **still open**.
- [x] **RESOLVED 2026-07-04** — 9a. Deterministic `matchOne` tie-break (tie → downgrade to
      moderate). *(same fix as section 2's P0 above — one entry, listed once for traceability)*
- [ ] 9b. `hasExternal`-before-fetch + pending-proposal dedup by seed — **still open**.
- [x] **RESOLVED 2026-07-04** — 9c. `.catch()` + health flag on token persist.
      *(same fix as section 2/3's fire-and-forget token entry above)*
- [x] **RESOLVED (verified 2026-07-04, was already fixed)** — 9d. Gmail draft creation moved
      post-approval. Inspection found the code this described (`draftOutbound()`) no longer
      exists — current `skills.ts`/`egress.ts` split already composes-then-approves-then-creates
      correctly. Added the missing proof test (email path had no coverage; calendar did) in
      [calendar.test.ts](platform/packages/integrations-google/test/calendar.test.ts), 6/6 green.
- [ ] 10. Parse-null-rate counters on connectors; BizBuySell alert threshold — **still open**.

### Phase 3 — Multi-tenant honesty & data-layer debt

- [ ] 11a. Thread `workspaceId` through `google.*` and DealPilot wiring (or explicitly reject
      non-pilot `workspaceId`s until then) — **still open**.
- [ ] 11b. Persist `tool_captures` to a real table — **still open**.
- [ ] 12. Schema pass: hnsw index, `(workspace_id, occurred_at)` on `timeline_entries`, GIN on
      `emails`, `dedup_key` NOT NULL/partial-unique, CHECK constraints, `updated_at` triggers,
      `.uuid()` consistency, envelope discriminated union, per-skill input schemas, UUIDv7 for
      ledger/events — **all still open**.
- [ ] 13. Supabase JWT identity (Phase C) — **needs your approval** (Blockers B); then per-human
      approval RBAC — **needs your approval** (Blockers B).
- [ ] 14a. Wire or demote `PacingGate` (persisted counters, timezone-anchored day, atomic
      reserve) — **still open**.
- [ ] 14b. Backoff/quota helper for the Google gateway — **still open**.
- [ ] 14c. Pagination params on all list endpoints — **still open**.

  Adjacent item already done in this theme:
  - [x] **RESOLVED 2026-07-05** — DealPilot dedupe-on-commit wired (`wiring.ts`'s
        `dealPilotMaterializer.commit` now calls `matchCompany` before assigning a candidate id;
        strong matches merge instead of duplicating). This is a DealPilot-specific instance of
        the broader "no dedupe on commit" gap called out in the original review's feature list —
        the general capture-list-endpoint + thesis-storage gaps for DealPilot remain **open**.

### Phase 4 — resume the feature roadmap

*(unchanged from the earlier plan; nothing here should start before Phases 0-2 land)*

- [ ] Recon migration onto the intake seam — **scoped as a multi-session architecture decision,
      not a same-pass fix** (2026-07-04 inspection: Recon is a fully standalone Next.js app, zero
      `@bridge/*` deps — see [known-issues.md](docs/wiki/known-issues.md) for the two candidate
      paths). Needs your direction before implementation starts.
- [ ] localStorage → API swap for prototype tables — **needs your approval** (Blockers B).
- [ ] Ritual engine build (DAG, planner/executor split, snapshots, versioning/rollback, Hatchet
      backend) — not started, architecture complete.

---

## Demo/mock/fixture inventory (not real)

Tracking whether each demo-tier item has since gone real. Unchanged items are still exactly as
audited 2026-07-03/04 unless noted.

**Prototype UI:**
- [ ] Auth — `AuthGate.tsx` hardcoded credential check, not real auth.
- [~] Network graph data — `network.ts` dummy_ stub in place (unblocks builds); real file
      regeneration is a you-must-run-locally step (see Blockers C); committing the stub needs
      your approval (Blockers B).
- [ ] Data loaders — all 4 canonical loaders in `db.ts:86-260` silently fall back to local data.
- [ ] All table edits — `usePersistentState`/`persist.ts`, localStorage only.
- [ ] Workspaces — `Sidebar.tsx:18` hardcoded `['Acme Corp', 'Wayne Ent.']`.
- [~] DealPilot demo set — `dummy_dealCandidates` still renders when `VITE_API_URL` unset, but
      real API listings now merge in when on, including dedupe-on-commit (resolved above) and
      real Brokerage linkage (resolved by a parallel session 2026-07-04).
- [ ] JobPilot page — `data/jobpilot.ts` entirely local dummy; real `@bridge/jobpilot` backend
      exists but is not wired to the prototype at all.
- [ ] Helpdesk public surface (`/help/:slug`) — local store; Supabase anon-RLS designed, not live.
- [ ] Helpdesk AI routing — deterministic keyword/capability matching, no real model.
- [ ] Governance/permission editor UI — mostly demo; real policies live in `platform/packages/core`.
- [ ] PeopleMapView, SignalsView, RitualCanvas — local/demo state.
- [x] **RESOLVED 2026-07-04** — SettingsPage API-keys tab duplicate-key bug (both Members and
      API Keys tables had it) — unique string ids assigned, `useState` type corrected.

**Platform backend:**
- [ ] In-memory everything without `DATABASE_URL` — restart = data gone, `/health` still `ok`.
- [ ] Social fixture fallback — `makeFixtureProvider()` silently serves dummy_ items when OAuth
      keys absent.
      - [x] **RESOLVED 2026-07-04 (a narrower, related bug only)** — the fixture provider's
        `draftId` collision (two drafts before a publish sharing an id) is fixed; the broader
        "silently serves dummy data as if live" fallback itself is **still open**.
- [ ] Identity — `PILOT_USER` pinned in `wiring.ts:102`; no real per-user auth.
- [ ] `FakeGoogleGateway` — still exists for tests; dummy purge not executed.
- [x] **DECIDED 2026-07-05** — BusinessBroker.net connector: not pursuing a licensed feed; stays
      routed through `ConnectAppFlow`'s existing `claude_browser` waterfall step. See
      decisions-log 2026-07-05.
- [ ] JobPilot backend — rule-based only (keyword skill extraction, no PDF/LLM; injected
      classifier; in-memory pacing).
- [ ] No `ModelProvider`/LLM integration in core platform at all.

---

## Planned-but-never-built inventory

- [ ] Schema-v2 punch-list: roles+inheritance, delegation runtime enforcement, ephemeral_grants
      usage, touchpoint hierarchy traversal + Planner + plan-proposal review, signals saved UI +
      action workflow, node_types/plane cross-plane write enforcement, ritual_runs, embedding
      version-swap mechanism. Only agent-floor DENY is fully live.
- [ ] Ritual engine (DAG, planner/executor split, snapshots, versioning/rollback, Hatchet backend).
- [ ] Memory table + classification.
- [ ] Events→Signals derivation rules + Signal→Context→Insight→Action execution surface.
- [ ] Variance Adjuster (learn from vetoes → policy_params).
- [ ] Agent auto-mode (allowlist auto-commit).
- [ ] Orbit/map signature visual; seed ritual library; seed tools (Digital Card projection).
- [ ] Community inference from interaction clusters; voice/quick-add capture; pgvector
      retrieval/search UI.
- [ ] Initiatives Taskade views (List/Board/Calendar/MindMap projections, CRDT).
- [ ] Phase 5 pilot (1-2 GP funds) and Phase 6 E2EE — deferred by design, seam exists. **Your
      call on recruitment timing** — see the recruitment guidance already given; not solvable by
      more code alone.
- [ ] DealPilot enrichment waterfall (S5: free→forms→email→browser-agent→human) — only cheap-tier
      scoring exists.
- [ ] DealPilot thesis-management UI — **still open** (dedupe-on-commit itself is now resolved,
      see above).
- [ ] DealPilot capture-list endpoint — **still open**.
- [ ] JobPilot: real PDF parsing, LLM classification/extraction, HTTP/Playwright tier execution,
      tier-escalation loop, dispatch/pacing persistence, prototype API wiring.
- [ ] Infrastructure: webhooks (everything polls), scheduled rituals, Temporal (intentionally
      deferred behind `RitualExecutor`).

---

## Temporary builds with a known better alternative

| Temporary | Better alternative | Status |
|---|---|---|
| localStorage persistence across the prototype | Swap `usePersistentState` → platform API/pipeline | OPEN |
| In-memory ledger/stores when env unset | Fail-fast on missing `DATABASE_URL` + `/health/ready` | OPEN |
| Silent fixture/local fallback (social, db.ts) | Fail-fast in prod, loud warn + badge in dev | OPEN |
| Pinned `PILOT_USER` + client-asserted propose actor | Supabase JWT verify → server-resolved identity | OPEN (decide-path fixed 2026-06-22; propose-path open) |
| CORS `origin: true` | `API_ALLOWED_ORIGINS` allowlist | **RESOLVED 2026-07-04** |
| Gmail draft created at propose-time | Compose locally at propose, create draft post-approval | **RESOLVED (was already fixed; proof added 2026-07-04)** |
| Non-transactional dual-write; fire-and-forget token refresh | Idempotency key + retry queue; persist-failure signals | Token-refresh half **RESOLVED 2026-07-04**; dual-write idempotency OPEN |
| Calendar single fetch, no `timeMax`, 250-event cap | Bounded range fetch + local event cache | OPEN |
| Recon's staging.jsonl/permanent.jsonl parallel governance | Migrate onto `createToolSourceSkill` intake seam | OPEN — scoped as multi-session architecture decision |
| Tool registry = 3 unlinked systems | Manifest as single source; registry derives | OPEN |
| JobPilot keyword heuristics + injected classifier + in-memory pacing | LLM package + PDF parser + DB-persisted pacing | OPEN |
| DealPilot empty thesis + 1-capture-=-1-candidate | Thesis storage/UI + dedupe wired into commit | Dedupe-on-commit **RESOLVED 2026-07-05**; thesis storage OPEN |
| Manual wrangler deploys | GitHub Actions CI/CD | CI file **RESOLVED 2026-07-04**; deploy step needs your secrets (Blockers C) |
| In-house calendar renderer | react-big-calendar behind `CalendarView` port | Documented, arguably fine as-is — OPEN if revisited |
| Helpdesk deterministic routing | Train on pilot data (Phase 5) | OPEN — blocked on pilot fund |
| BusinessBroker.net scraper (blocked by robots.txt) | Licensed/partner feed | **DECIDED 2026-07-05: not pursuing — routed through Claude-in-browser waterfall instead** |

---

## Bug review themes → what must be built

1. **Trust the data you see** — silent fallbacks (db.ts loaders, social fixtures, in-memory
   ledger) let the UI lie about liveness. Build: data-source/health indicator surface +
   fail-fast env validation. **OPEN.**
2. **Security perimeter** — CORS (**RESOLVED**) + pinned identity (OPEN) + client-asserted
   propose actor (OPEN) + no per-human approval RBAC (OPEN, needs approval) + denied-approvals
   not audited (**RESOLVED**). Build: the remaining auth-binding pass as one coherent slice.
3. **Reproducibility & verification** — prototype build fails on fresh clone (gitignored
   `network.ts`, stub uncommitted — needs your approval) (OPEN); CI now exists (**RESOLVED**,
   pending first live run); turbo cache-replay issue understood, worked around with `--force`
   this session.
4. **Governance completeness** — Recon's parallel staging path (OPEN, scoped), tool-registry
   desync (OPEN), dummy purge unexecuted (OPEN, needs approval).

Smaller bugs: SettingsPage duplicate React key (**RESOLVED**), calendar fetch window (OPEN),
`-1` duplicate config files (**RESOLVED**), `ItemDetail.tsx` implicit-anys (OPEN, untouched).

---

## Blockers

### A. I can solve — batch on your "go"

- [ ] Startup env assertions + `/health/ready` (`server.ts`)
- [x] ~~Audited-rejection ledger row on agent-floor deny~~ — **RESOLVED 2026-07-04**
- [x] ~~Gmail draft → post-approval creation~~ — **RESOLVED (verified already-fixed + proof added, 2026-07-04)**
- [ ] Silent-fallback loudness: warn + source badge (db.ts loaders); fail-fast/mark-synthetic for
      social fixtures
- [x] ~~SettingsPage duplicate-key fix; delete `-1` merge-artifact files~~ — **RESOLVED 2026-07-04**
- [ ] `ItemDetail.tsx` implicit-anys — still open, not touched
- [x] ~~DealPilot: wire `matchCompany` dedupe on commit~~ — **RESOLVED 2026-07-05**
- [ ] DealPilot: add capture-list endpoint; basic thesis storage — still open
- [ ] Recon migration onto the intake seam — **reclassified**: this needs your direction on
      which of two architecture paths (headless connector vs. cross-service tRPC integration)
      before it's a plain "go" item — see Phase 4 above.
- [x] ~~GitHub Actions CI (typecheck/test/build, `--force`)~~ — **RESOLVED 2026-07-04** (file
      exists; you still need to add repo secrets for a live green run + any deploy step)
- [ ] Calendar `timeMax` + exact-range fetch — still open
- [ ] Idempotency key + retry on dual-write — still open
- [x] ~~Token-refresh error handling~~ — **RESOLVED 2026-07-04**

### B. Need your approval — decisions are yours

- [ ] Commit the `dummy_` `network.ts` stub
- [ ] Execute the dummy purge (decided 2026-06-22, never run)
- [ ] Supabase JWT auth switch (Phase C)
- [ ] localStorage → API swap for prototype tables
- [ ] Per-human approval RBAC (confirm when to un-defer)

### C. You must solve — external / business, not code

- [x] ~~BusinessBroker.net licensed/partner data feed~~ — **DECIDED 2026-07-05: dropped, routed
      through the Claude-in-browser waterfall instead** (no vendor negotiation needed now)
- [ ] Production OAuth credentials (Google client id/secret in prod + real social-provider keys)
- [ ] GP-fund pilot recruitment (Phase 5)
- [ ] CI/deploy secrets (Cloudflare wrangler token + Supabase keys into GitHub Actions)
- [ ] Regenerate real `network.ts` (runs on your machine against your LinkedIn export)
