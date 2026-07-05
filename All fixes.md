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

- [x] **[P0] RESOLVED 2026-07-05** — Ledger resolution linkage lived in a jsonb magic string
      (`diff->>'__refLedgerId'`, `ledger-store.ts:17`). Real `ref_ledger_id` (+ `seed`/
      `data_scope`/`context`) columns added
      ([0003_ledger_ref_column.sql](platform/packages/db/migrations/0003_ledger_ref_column.sql),
      [schema.ts](platform/packages/db/src/schema.ts)) with a partial unique index
      (`ledger_ref_ledger_id_resolved_uq`, non-null `user_decision` only) enforcing "at most one
      resolving decision per proposal" at the database. See Phase 1 item 4 for the full writeup.
- [ ] **[P0]** `wiring.ts` is a 350-line god composition root that lies about persistence
      (`wiring.ts:234-279`, let-sprawl if/else). Capture store in-memory unconditionally (line
      212), canonical identity store in-memory even when `DATABASE_URL` set (line 259), header's
      "ledger MUST stay local" contradicted by the persistent branch. Fix:
      `buildPersistentPorts()` / `buildInMemoryPorts()` factories, one fully-typed object, delete
      every `let`. *(feeds Phase 2 item 8)*
- [x] **[P1] RESOLVED 2026-07-05** — Agent-floor invariant triplicated: `AGENT_FLOOR_MUTATIONS`
      (`authority.ts:31-49`), `isForbiddenAgentToken` (`agent-scope.ts:46-60`),
      `ALWAYS_APPROVAL_SCOPES` (`integration-store.ts:28`). New
      [agent-floor.ts](platform/packages/core/src/agent-floor.ts) in `@bridge/core` is now the
      single canonical definition (`AGENT_FLOOR_PROTECTED_RESOURCES`, `AGENT_FLOOR_MUTATIONS`,
      `AGENT_FLOOR_ALWAYS_DENIED_SCOPES`, `ALWAYS_APPROVAL_SCOPES`, `isAgentFloorDenied`,
      `isForbiddenAgentToken`); `authority.ts`'s `agentFloorDeny` and `agent-scope.ts`'s
      `isForbiddenAgentToken` now derive from it, and `@bridge/db`'s `integration-store.ts`
      re-exports the canonical `ALWAYS_APPROVAL_SCOPES` instead of declaring its own array.
      **The three lists HAD drifted**: `ALWAYS_APPROVAL_SCOPES` covered only the two exact
      scopes (`external:send`, `network_graph:full`) and was silently missing the entire
      governance-resource floor (`policy`/`policy_param`/`skill`/`agent`/`role`/`permission`/
      `ledger`/`delegation`) that the other two enforced — picked the union (strictest of the
      three) as canonical; nothing was loosened, `ALWAYS_APPROVAL_SCOPES`'s effective behavior is
      unchanged (it never checked those resources) but it now can't silently diverge from the
      runtime floor again. New smoke test
      [agent-floor.test.ts](platform/packages/core/test/agent-floor.test.ts) pins all three
      consumers to the canonical set. *(feeds Phase 1 item 6 — the DB-level seed-wiring half of
      item 6 remains open, see known-issues.md)*
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

- [x] **[P0] RESOLVED 2026-07-05** — Double-approve TOCTOU in `decide()` — `pipeline.ts:171-206`
      previously had no transaction/lock/unique constraint; two concurrent decides could both
      commit, both fire `onApproved`, an approved email sends twice. Same hole in the in-memory
      ledger (`stores.ts:142-157`). See Phase 1 item 4 for the fix.
- [x] **[P0] RESOLVED 2026-07-04** — Non-deterministic auto-merge tie-break.
      [match.ts](platform/packages/dedupe/src/match.ts) `matchOne` rewritten: exact-score ties
      downgrade to `moderate` (human review) instead of silent array-order pick. 2 new tests in
      [match.test.ts](platform/packages/dedupe/test/match.test.ts), 9/9 green.
- [x] **[P0] RESOLVED 2026-07-04** — Fire-and-forget OAuth token persistence.
      [gateway-google.ts](platform/packages/integrations-google/src/gateway-google.ts) token
      listener now `.catch()`s and logs the integration id instead of a bare `void`.
- [x] **[P1] RESOLVED 2026-07-05** — Gmail sync double-propose window — `hasExternal`
      (`intake.ts:155`) only excludes already-materialized records; two syncs before approval
      previously created duplicate PENDING proposals for the same thread/event, and approving
      both would double-commit Touchpoints/Memories (no dedup key on the entities themselves at
      propose-time). Fix: `IntakeService` gained an in-process `pendingSeeds: Map<seed,
      proposalId>` (scoped to this file/package, no core change — `@bridge/core`'s
      `LedgerStore`/`UniversalActionPipeline` expose no query surface for "list pending
      proposals by seed," only `get(id)`/`decisionFor(proposalId)`, confirmed by inspection).
      `stage()` now checks the map before calling `pipeline.propose()`: if a proposal for the
      same seed (`${source}:${sourceRecordId}`, the same string already passed as
      `ActionRequest.seed`) is already pending, it returns that SAME proposal's summary instead
      of staging a duplicate. The slot is freed via a new `clearPendingSeed()` method, called
      from `GoogleService.onApproved` (which already runs after every `pipeline.decide()` call,
      approve/veto/edit alike) using `resolved.request.seed` — so a vetoed proposal's seed is
      released for a legitimate re-sync, not stuck forever. New tests in
      [intake-dedup.test.ts](platform/packages/integrations-google/test/intake-dedup.test.ts)
      (through the REAL pipeline+gate, not mocked): syncing 3x before approval returns the SAME
      pending proposal each time; after approval+materialization, `hasExternal` correctly takes
      over (no re-propose, no duplicate Touchpoint); after a veto, a later re-sync IS allowed to
      stage a fresh proposal. *(Phase 2 item 9b)*
- [ ] **[P1]** Ritual halt leaves the graph half-mutated — `ritual-executor.ts:141-166`, no
      rollback/compensation/"partially applied" surfacing on a mid-run deny.
- [x] **[P1] RESOLVED 2026-07-05** — JWKS verify failures explode context creation —
      `identity.ts:62-66` previously had no timeout/catch around the remote JWKS verify call; a
      slow/down JWKS endpoint turned every authenticated request into an opaque rejection instead
      of a 401. Fix: `createRemoteJWKSet` now passes jose's `timeoutDuration` (5s) to bound the
      key-set fetch, and the whole verify call (HS256 and JWKS branches) is wrapped in try/catch
      that throws a typed `IdentityVerificationError` on ANY failure (timeout, network error, bad
      signature, expired/malformed token). `context.ts`'s `createContext` catches that and
      re-throws `TRPCError({code:"UNAUTHORIZED"})`, which the tRPC fastify adapter maps to a clean
      401 — verified end-to-end via `app.inject` in `server.test.ts` (forged-signature bearer
      token against a configured `SUPABASE_JWT_SECRET` yields `statusCode 401`, not a 500/hang).
      New tests: `apps/api/test/identity.test.ts` (HS256 bad-secret rejection, JWKS-unreachable-
      endpoint rejection within the bounded timeout, no-verifier pilot-fallback unaffected) +
      1 new `server.test.ts` case. `@bridge/api` identity/server/social tests 16/16 green
      (unrelated pre-existing `pagination.test.ts` failures untouched, see known-issues.md).
- [x] **[P2] RESOLVED 2026-07-05** — `decide()` used to reconstruct the request with
      `skill: "(replayed)"`, silently dropping `context`/`dataScope` (`pipeline.ts:320-334`) —
      audit trail couldn't answer which ritual produced a decision or what data tier it touched.
      See Phase 1 item 5 for the fix.
- [x] **[P2] RESOLVED 2026-07-05 (decide()'s already-resolved/floor-deny cases)** — Untyped
      pipeline errors surfaced as `INTERNAL_SERVER_ERROR` for what are really 409/403 conditions.
      `IntegrationFloorScopeError` pattern (`router.ts:576`) now also applied to `decide()`: new
      `AlreadyResolvedError`/`AgentFloorDeniedError` typed errors in
      [pipeline.ts](platform/packages/core/src/pipeline.ts), translated to `CONFLICT`/`FORBIDDEN`
      in [router.ts](platform/apps/api/src/router.ts). Other untyped-error sites in the pipeline
      are out of scope for this pass (see Phase 1 item 4).

## 3. Memory leaks & bottlenecks

- [ ] **[P1]** Every in-memory store unbounded, and in-memory is the default production path:
      `InMemoryLedger.entries`, `InMemoryEventBus.events`, `InMemoryEphemeralStore.grants`
      (expired grants never pruned) — linear leak until OOM, `/health` still reports `ok:true`.
      Fix: refuse to boot in production without a real ledger; cap+evict dev adapters.
      *(Phase 2 item 8)*
- [x] **[P1] RESOLVED 2026-07-05** — N+1 sequential Gmail fetches — `gateway-google.ts:85-124`
      previously did `threads.list` then a SEQUENTIAL `threads.get(format:"full")` per thread
      (one round-trip at a time, no retry/backoff at all). Fix: `GoogleApiGateway.fetchThreads`
      now fetches thread bodies via a new bounded-concurrency helper (`mapWithConcurrency`,
      cap 15 in flight at once — `THREAD_FETCH_CONCURRENCY`), each call wrapped in a new
      file-local `withRetry` (3 attempts, linear backoff, mirrors `intake.ts`'s existing helper
      of the same name/shape). A thread that still fails after retries is `console.error`-logged
      and SKIPPED, not fatal to the sync — one bad thread no longer aborts the whole batch.
      Cross-sync body caching was explicitly out of scope for this pass (would need a
      persistence decision). New tests in
      [gateway-fetch-concurrency.test.ts](platform/packages/integrations-google/test/gateway-fetch-concurrency.test.ts)
      (mocks the `googleapis` module via `node:test`'s `mock.module`, requiring the package's
      `test` script to add `--experimental-test-module-mocks`): proves >1 `threads.get` call is
      in flight concurrently (load-independent assertion, not wall-clock timing, to stay stable
      under CI parallel-suite contention), that a transient per-thread failure recovers via
      retry, and that a permanently-failing thread is skipped without aborting the rest.
- [x] **[P1] RESOLVED 2026-07-05** — No pagination on any list surface — `dealpilot.list`
      (`router.ts`) previously mapped the ENTIRE candidate set through per-id
      `facts.livingProfile()` on every call, and `integration.list` returned the full
      `store.list()` array with no slicing. Fix: both procedures now take zod-validated
      `limit` (`1..200`, default `50`) + `offset` (`>=0`, default `0`) and return
      `{ items, total, hasMore }` — a simple offset slice, not a cursor scheme, since the
      backing stores are a plain in-memory array (`candidateIds`) and a full-table
      `store.list()` fetch with no stable ordering key to cursor on yet. `dealpilot.list`'s
      input is `.optional().default({})` so existing no-arg callers keep working; the
      prototype's `apiDealPilotList()` (`Design Bridge AI Interface (Copy)/src/app/data/api.ts`)
      now requests `{ limit: 200, offset: 0 }` and unwraps `.items`, preserving today's
      "show everything" UI behavior (no pager built yet) while the backend stays bounded.
      New tests in
      [pagination.test.ts](platform/apps/api/test/pagination.test.ts): both procedures honor
      an explicit `limit` and return a bounded page across two offsets; a "no unlimited
      default" test seeds 75 dummy_ fixtures and confirms a no-params call returns exactly the
      documented default (50), not everything. *(Phase 3 item 14, item 14c)*
- [x] **[P2] RESOLVED 2026-07-05** — Unbounded multipart recursion + full base64 decode in
      memory — `extractPlainText` (`gateway-google.ts:46-64`) previously had no depth limit on
      MIME multipart recursion and no size cap before `Buffer.from(...).toString()`. Fix: a
      `MAX_MIME_DEPTH` (10) recursion cap that stops recursing and returns whatever was already
      extracted (falls back to the Gmail-provided snippet) instead of risking a stack overflow
      on a pathological/malicious deeply-nested multipart message; a `MAX_BODY_BYTES` (5MB) cap
      applied via a new `decodeBodyPart` helper that estimates the decoded size from the base64
      length BEFORE allocating a buffer and truncates (with a `console.warn`) rather than fully
      materializing an oversized part. New tests in
      [extract-plain-text-bounds.test.ts](platform/packages/integrations-google/test/extract-plain-text-bounds.test.ts):
      a payload nested 500 levels deep doesn't crash/hang and falls back to the snippet; an
      ~8MB body part is truncated to near the 5MB cap, not fully decoded; normal shallow nesting
      is unaffected (no regression).
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

- [x] **4. RESOLVED 2026-07-05** — `ref_ledger_id` + `seed`/`data_scope`/`context` as real ledger
      columns, partial unique index, transactional `decide()`; typed errors
      (`AlreadyResolvedError` → 409, floor deny → 403).
      [0003_ledger_ref_column.sql](platform/packages/db/migrations/0003_ledger_ref_column.sql)
      adds `ref_ledger_id uuid`, `seed text`, `data_scope text`, `context jsonb` to `ledger` (was:
      `ref_ledger_id`/`seed` only round-tripped through reserved keys in the `diff` jsonb, no
      column, no index, no constraint) plus a partial unique index
      `ledger_ref_ledger_id_resolved_uq` on `(ref_ledger_id) WHERE ref_ledger_id IS NOT NULL AND
      user_decision IS NOT NULL` — "at most one resolving decision per proposal," enforced by
      Postgres/pglite itself, not app-code sequencing. No backfill (pre-launch, no production
      data). [schema.ts](platform/packages/db/src/schema.ts) updated to match;
      [ledger-store.ts](platform/packages/db/src/ledger-store.ts) rewritten to read/write the real
      columns directly (dropped the old `packDiff`/`unpack` jsonb-key-splicing entirely) and to
      catch the unique-violation (SQLSTATE 23505 on the named index) and translate it into the
      same typed error the in-process pre-check throws. `pipeline.ts`'s `decide()` now throws
      `AlreadyResolvedError` (was a bare `Error`, "already resolved"/"not a pending proposal") and
      `AgentFloorDeniedError` (was a bare `Error` on floor-deny) — both exported from `@bridge/core`
      — closing the double-approve TOCTOU: the in-process `decisionFor()` pre-check narrows the
      race, and the actual guarantee is downstream — the partial unique index for the persistent
      ledger, and a new atomic check-and-mark `Set` in `InMemoryLedger.append()`
      ([stores.ts](platform/packages/core/src/memory/stores.ts), no `await` between check and
      mark) for the in-memory ledger. `router.ts`'s `decide` procedure now catches both typed
      errors and maps them to `TRPCError({ code: "CONFLICT" })` / `TRPCError({ code: "FORBIDDEN" })`
      respectively, mirroring the existing `IntegrationFloorScopeError` → `FORBIDDEN` pattern at
      `router.ts:576`. Tests: `pipeline.test.ts` adds a `Promise.allSettled` concurrent-decide
      test (exactly one succeeds, one gets typed `AlreadyResolvedError`, exactly one event
      emitted) for the in-memory ledger; new
      [ledger-store.test.ts](platform/packages/db/test/ledger-store.test.ts) proves the same
      against a real pglite database (partial unique index rejects the second concurrent insert;
      a floor-denied null-decision audit row does NOT block the real resolution; `seed`/
      `dataScope`/`context` round-trip through the real columns). `pipeline.test.ts` 29/29 green
      (`@bridge/core` 60/60 across all its test files), `@bridge/db` 9/9 green, full monorepo
      `turbo run build --force` 15/15 and `turbo run test --force` all green except one
      pre-existing, unrelated `apps/api` `pagination.test.ts` FK failure in a parallel session's
      in-flight `integration.list` work (confirmed unrelated: that test file was never touched by
      this change, and the migration here only touches the `ledger` table).
- [x] **5. RESOLVED 2026-07-05** — Persist `dataScope` + `context` on `LedgerEntry` (audit
      completeness). Added as real fields on `LedgerEntry`
      ([types.ts](platform/packages/core/src/types.ts)) and real `data_scope`/`context` columns
      on the `ledger` table (same migration as item 4). `pipeline.ts`'s `#appendLedger` now writes
      the proposing request's `dataScope`/`context` onto the ledger row at propose-time (was:
      never persisted at all), and `decide()`'s `#requestFromEntry` (the replay path) threads the
      ORIGINAL `dataScope`/`context` from the ledger entry into the reconstructed `ActionRequest`
      instead of silently dropping them. `skill: "(replayed)"` is kept ONLY as the literal
      skill-name placeholder (the ledger never stored a skill name to replay — `decide()` never
      re-invokes a skill) — scoped explicitly now so it no longer reads as dropping audit context
      alongside it. Test: `pipeline.test.ts` asserts a replayed decide's ledger row (both the
      pending proposal row and the resolving decision row) and `Proposal.request` carry the
      original `dataScope`/`context`, not `"(replayed)"`/undefined; `ledger-store.test.ts` proves
      the same round-trips through real Postgres/pglite columns.
- [x] 6. **RESOLVED 2026-07-05 (consolidation half only)** — Consolidated the triplicated
      agent-floor constant into `@bridge/core`'s new `agent-floor.ts` (see section 1's matching
      entry for detail; union of the three, which had drifted, picked as canonical). **Still
      open:** execute (or explicitly retire) the DB-level agent-floor seed
      (`0001_governance_seed.sql:52-67`, tracked separately in section 1's "Injected seams" bullet
      and known-issues.md) — that half was intentionally out of scope for this pass.
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
  - [x] **RESOLVED 2026-07-05** — Startup env assertions + `/health/ready` probing db + local
        plane. [server.ts](platform/apps/api/src/server.ts) `assertProductionEnv()`: refuses to
        boot (throws) when `NODE_ENV=production` and `DATABASE_URL` is unset — no more silent
        in-memory-ledger-in-production. New `GET /health/ready` actually probes `wiring.ledger`
        and `wiring.localPlane.graph` with a syntactically-valid probe id and returns
        `{ ready, persistent, checks: { ledger, localPlane } }`, 503 on any probe failure —
        distinct from `/health` (liveness only, still unconditionally `ok:true`). 4 new tests in
        `server.test.ts`, all green (`@bridge/api` 10/10; monorepo `turbo build`/`test --force`
        28/28 green).
  - [x] **RESOLVED 2026-07-05** — Silent-fallback loudness (db.ts loaders, social fixtures).
        Social fixtures half: `console.warn` + `mode` threaded into proposal inputs
        (`registry.ts`/`read-pipeline.ts`). db.ts loaders half: `console.warn` in all 4 loaders'
        catch blocks + a "Live · Supabase" / "Local fallback" badge now rendered in
        `DataEngine.tsx` from the `source` field the loaders already returned.
  - [ ] `wiring.ts` typed-port-factory refactor itself — **still open**.
- [x] **RESOLVED 2026-07-04** — 9a. Deterministic `matchOne` tie-break (tie → downgrade to
      moderate). *(same fix as section 2's P0 above — one entry, listed once for traceability)*
- [x] **9b. RESOLVED 2026-07-05** — `hasExternal`-before-fetch + pending-proposal dedup by
      seed. See section 2's matching "Gmail sync double-propose window" entry above for the
      full writeup (`IntakeService.pendingSeeds`, cleared via `GoogleService.onApproved`).
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
- [x] **14b. RESOLVED 2026-07-05 (retry half only)** — Backoff/quota helper for the Google
      gateway. A bounded linear-backoff `withRetry` helper now wraps every per-thread
      `threads.get` call in `gateway-google.ts` (see section 3's N+1 entry above). **Not done:**
      real Google API quota-aware throttling (e.g. reading `Retry-After`/429 responses
      specifically) — this is a generic transient-failure retry, not quota-specific backoff.
- [x] 14c. **RESOLVED 2026-07-05** — Pagination params on all list endpoints. `dealpilot.list`
      and `integration.list` (`router.ts`) now take zod-validated `limit`/`offset` (default
      `50`/`0`, max `200`) and return `{ items, total, hasMore }`; see the matching section 3
      P1 entry above for the full writeup and new `pagination.test.ts` coverage. **Scope note:**
      this covers the two list-shaped tRPC procedures identified in the original review; other
      read paths (e.g. `google.listCalendarEvents`) already had their own `maxResults` caps and
      were out of scope here.

  Adjacent item already done in this theme:
  - [x] **RESOLVED 2026-07-05** — DealPilot dedupe-on-commit wired (`wiring.ts`'s
        `dealPilotMaterializer.commit` now calls `matchCompany` before assigning a candidate id;
        strong matches merge instead of duplicating). This is a DealPilot-specific instance of
        the broader "no dedupe on commit" gap called out in the original review's feature list —
        the general capture-list-endpoint + basic thesis-storage gaps for DealPilot are now
        **RESOLVED 2026-07-05** (see below) — full thesis-management UI remains **open**.

### Phase 4 — resume the feature roadmap

*(unchanged from the earlier plan; nothing here should start before Phases 0-2 land)*

- [ ] Recon migration onto the intake seam — **scoped as a multi-session architecture decision,
      not a same-pass fix** (2026-07-04 inspection: Recon is a fully standalone Next.js app, zero
      `@bridge/*` deps — see [known-issues.md](docs/wiki/known-issues.md) for the two candidate
      paths). Needs your direction before implementation starts.
- [ ] localStorage → API swap for prototype tables — **needs your approval** (Blockers B).
- [ ] Ritual engine build (DAG, planner/executor split, snapshots, versioning/rollback, Hatchet
      backend) — not started, architecture complete.
- [ ] **DECIDED 2026-07-05** — `platform/` frontend migration: port the prototype's design into a
      real `platform/apps` frontend, routed entirely through the governed api layer (replacing the
      client-side direct-Supabase reads). Not started — needs a scoping pass (missing tRPC
      procedures inventory, page-by-page port list, parity test plan) before implementation. See
      decisions-log 2026-07-05. Prototype is NOT being deleted and remains the frontend fix target
      until this lands and is verified at parity.

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
- [x] **RESOLVED 2026-07-05** — Social fixture fallback — `makeFixtureProvider()` silently
      served dummy_ items when OAuth keys absent, with no way to tell short of reading code.
      `registry.ts`'s `resolveProvider()` now `console.warn`s the platform id and reason (no
      live factory registered vs. creds missing) whenever it falls through to the fixture seam;
      `read-pipeline.ts`'s `sourceToProposals()` now threads `provider.mode` into the
      `ActionRequest.inputs` and the returned `SourceResult`, so every proposal/audit row records
      fixture-vs-live. `fixtures.ts`/`provider.ts` untouched (already had the right `mode` shape).
      - [x] **RESOLVED 2026-07-04 (a narrower, related bug only)** — the fixture provider's
        `draftId` collision (two drafts before a publish sharing an id) is fixed.
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
- [ ] DealPilot thesis-management UI — basic get/set thesis storage **RESOLVED 2026-07-05**
      (`dealpilot.getThesis`/`dealpilot.setThesis` procedures, in-memory in `wiring.ts`); full
      management UI still **OPEN** (frontend work, separate larger item).
- [x] ~~DealPilot capture-list endpoint~~ — **RESOLVED 2026-07-05**: backend `dealpilot.captures`
      query done; no dedicated UI page yet (expected/fine, same as thesis storage above).
- [ ] JobPilot: real PDF parsing, LLM classification/extraction, HTTP/Playwright tier execution,
      tier-escalation loop, dispatch/pacing persistence, prototype API wiring.
- [ ] Infrastructure: webhooks (everything polls), scheduled rituals, Temporal (intentionally
      deferred behind `RitualExecutor`).

---

## Temporary builds with a known better alternative

| Temporary | Better alternative | Status |
|---|---|---|
| localStorage persistence across the prototype | Swap `usePersistentState` → platform API/pipeline | OPEN |
| In-memory ledger/stores when env unset | Fail-fast on missing `DATABASE_URL` + `/health/ready` | Ledger fail-fast + `/health/ready` **RESOLVED 2026-07-05**; other in-memory stores (events, ephemeral grants) still unbounded/unguarded — OPEN |
| Silent fixture/local fallback (social, db.ts) | Fail-fast in prod, loud warn + badge in dev | **RESOLVED 2026-07-05** — social fixtures: `console.warn` + `mode` threaded into proposal inputs; db.ts loaders: `console.warn` + "Live · Supabase"/"Local fallback" badge in `DataEngine.tsx`. Prod fail-fast for these specific fallbacks not yet added (only the ledger has `assertProductionEnv`) — narrower residual gap. |
| Pinned `PILOT_USER` + client-asserted propose actor | Supabase JWT verify → server-resolved identity | OPEN (decide-path fixed 2026-06-22; propose-path open) |
| CORS `origin: true` | `API_ALLOWED_ORIGINS` allowlist | **RESOLVED 2026-07-04** |
| Gmail draft created at propose-time | Compose locally at propose, create draft post-approval | **RESOLVED (was already fixed; proof added 2026-07-04)** |
| Non-transactional dual-write; fire-and-forget token refresh | Idempotency key + retry queue; persist-failure signals | Token-refresh half **RESOLVED 2026-07-04**; dual-write idempotency **RESOLVED 2026-07-05** (`commitEntity` made idempotent in both local-store backends; bounded whole-method retry wraps `IntakeMaterializer.applyApproved`) |
| Calendar single fetch, no `timeMax`, 250-event cap | Bounded range fetch + local event cache | `timeMax` default/threading **RESOLVED 2026-07-05**; local event cache still OPEN |
| Recon's staging.jsonl/permanent.jsonl parallel governance | Migrate onto `createToolSourceSkill` intake seam | OPEN — scoped as multi-session architecture decision |
| Tool registry = 3 unlinked systems | Manifest as single source; registry derives | OPEN |
| JobPilot keyword heuristics + injected classifier + in-memory pacing | LLM package + PDF parser + DB-persisted pacing | OPEN |
| DealPilot empty thesis + 1-capture-=-1-candidate | Thesis storage/UI + dedupe wired into commit | Dedupe-on-commit + basic thesis get/set **RESOLVED 2026-07-05**; thesis-management UI OPEN |
| Manual wrangler deploys | GitHub Actions CI/CD | CI file **RESOLVED 2026-07-04**; deploy step needs your secrets (Blockers C) |
| In-house calendar renderer | react-big-calendar behind `CalendarView` port | Documented, arguably fine as-is — OPEN if revisited |
| Helpdesk deterministic routing | Train on pilot data (Phase 5) | OPEN — blocked on pilot fund |
| BusinessBroker.net scraper (blocked by robots.txt) | Licensed/partner feed | **DECIDED 2026-07-05: not pursuing — routed through Claude-in-browser waterfall instead** |

---

## Bug review themes → what must be built

1. **Trust the data you see** — silent fallbacks (db.ts loaders, social fixtures, in-memory
   ledger) let the UI lie about liveness. Build: data-source/health indicator surface +
   fail-fast env validation. **RESOLVED 2026-07-05**: `assertProductionEnv()` + `/health/ready`
   (backend fail-fast + real readiness probe); social fixtures silent fallback (console.warn +
   `mode` threaded into proposal inputs); db.ts loaders (console.warn in all 4 catch blocks +
   a "Live · Supabase"/"Local fallback" badge in `DataEngine.tsx` driven by the `source` field
   the loaders already returned but never rendered).
2. **Security perimeter** — CORS (**RESOLVED**) + pinned identity (OPEN) + client-asserted
   propose actor (OPEN) + no per-human approval RBAC (OPEN, needs approval) + denied-approvals
   not audited (**RESOLVED**). Build: the remaining auth-binding pass as one coherent slice.
3. **Reproducibility & verification** — prototype build fails on fresh clone (gitignored
   `network.ts`, stub uncommitted — needs your approval) (OPEN); CI now exists (**RESOLVED**,
   pending first live run); turbo cache-replay issue understood, worked around with `--force`
   this session.
4. **Governance completeness** — Recon's parallel staging path (OPEN, scoped), tool-registry
   desync (OPEN), dummy purge unexecuted (OPEN, needs approval).

Smaller bugs: SettingsPage duplicate React key (**RESOLVED**), calendar fetch window
(**RESOLVED 2026-07-05**), `-1` duplicate config files (**RESOLVED**), `ItemDetail.tsx`
implicit-anys (**RESOLVED 2026-07-05**).

---

## Blockers

### A. I can solve — batch on your "go"

- [x] ~~Startup env assertions + `/health/ready`~~ — **RESOLVED 2026-07-05**
- [x] ~~Audited-rejection ledger row on agent-floor deny~~ — **RESOLVED 2026-07-04**
- [x] ~~Gmail draft → post-approval creation~~ — **RESOLVED (verified already-fixed + proof added, 2026-07-04)**
- [x] ~~Fail-fast/mark-synthetic for social fixtures~~ — **RESOLVED 2026-07-05**: `console.warn`
      on fallback (registry.ts) + `mode` threaded into proposal inputs (read-pipeline.ts)
- [x] ~~Silent-fallback loudness: warn + source badge (db.ts loaders)~~ — **RESOLVED 2026-07-05**:
      `console.warn` in all 4 loaders' catch blocks (`db.ts`) naming which loader fell back and
      why; `DataEngine.tsx` now renders a "Live · Supabase" / "Local fallback" pill in the People/
      Communities toolbar driven by the `source` field the loaders already returned but never
      rendered. `tsc --noEmit` clean.
- [x] ~~SettingsPage duplicate-key fix; delete `-1` merge-artifact files~~ — **RESOLVED 2026-07-04**
- [x] ~~`ItemDetail.tsx` implicit-anys~~ — **RESOLVED 2026-07-05**: typed `EditableText`,
      `ContactCard`'s `fv`, `Boundaries`' `Col`, `visMeta` (via `LucideIcon`), and added explicit
      `bio`/`newsInsight`/`websiteUrl`/`githubHandle`/`instagramHandle`/`twitterHandle`/`skills`/
      `education`/`previousCompanies` fields to `NetworkPerson` so its loose `[key: string]: any`
      stub index signature no longer leaks `any` into `.map()` callbacks. `tsc --noEmit` and
      `vite build` both clean; verified in browser (Marcus Webb profile renders, no console errors).
- [x] ~~DealPilot: wire `matchCompany` dedupe on commit~~ — **RESOLVED 2026-07-05**
- [x] ~~DealPilot: add capture-list endpoint; basic thesis storage~~ — **RESOLVED 2026-07-05**:
      added `dealpilot.captures` query (`apps/api/src/router.ts`, exposes
      `ctx.wiring.dealpilot.captures.list("dealpilot")` — the `QuarantinedCapture[]` already
      sitting in the `ToolCaptureStore`, unreshaped, no sensitive fields) plus `dealpilot.getThesis`
      / `dealpilot.setThesis` procedures backed by a new in-memory `dealPilotThesis` mutable
      (`apps/api/src/wiring.ts`, mirrors the existing `dealPilotCandidateIds` session-lifetime
      pattern, typed to `@bridge/dealpilot`'s `ThesisProfile`). `dealpilot.list` now reads the
      real thesis instead of the hardcoded `{ industries: [], geo: [] }` stand-in.
- [ ] Recon migration onto the intake seam — **reclassified**: this needs your direction on
      which of two architecture paths (headless connector vs. cross-service tRPC integration)
      before it's a plain "go" item — see Phase 4 above.
- [x] ~~GitHub Actions CI (typecheck/test/build, `--force`)~~ — **RESOLVED 2026-07-04** (file
      exists; you still need to add repo secrets for a live green run + any deploy step)
- [x] ~~Calendar `timeMax` + exact-range fetch~~ — **RESOLVED 2026-07-05**: added `timeMax` to
      `FetchEventsOpts` (`contracts.ts`); `GoogleApiGateway.fetchEvents` (`gateway-google.ts`)
      now defaults it to `timeMin` + 90 days when the caller omits it, bounding the previously
      unbounded forward window. Threaded through `skills.ts` (source/list calendar skills),
      `intake.ts` (`SyncOpts`), `service.ts` (`syncCalendar`/`listCalendarEvents`), and the
      `syncCalendar`/`listEvents` tRPC procedures (`router.ts`) so callers can also set it
      explicitly. Also fixed the actual root cause on the Calendar surface: `CalendarPage.tsx`
      only ever computed `rangeStart` (period start) and relied on the 250-result cap to cover
      the rest — added a matching `rangeEnd` (end of visible month/week/day, or +90d for agenda)
      and threaded it through `apiListCalendarEvents`'s `timeMax` on every reload/refresh/write
      path. Full monorepo `turbo run build` + `turbo run test --force`: 28/28 packages green
      (`@bridge/integrations-google` 6/6, `@bridge/api` 6/6); prototype `tsc --noEmit` + `vite
      build` clean; verified in-browser (Month/Week/Agenda views render, no console errors).
- [x] ~~Idempotency key + retry on dual-write~~ — **RESOLVED 2026-07-05**: `commitEntity`
      made idempotent in both `LocalGraphStore` backends — `packages/local/src/stores/pglite.ts`
      (`INSERT ... ON CONFLICT (id) DO NOTHING`, confirmed `id` is `local_entities`' PK) and
      `packages/local/src/stores/memory.ts` (duplicate-id case is now a silent no-op, mirroring
      `recordExternal`'s existing `hasExternal`-then-push dedup pattern in the same file, instead
      of throwing). `upsertPersonIdentity`/`upsertPerson`/`recordExternal` were already idempotent
      and untouched. Added a small local `withRetry` helper (no new dependency) in
      `packages/integrations-google/src/intake.ts` and wrapped the body of
      `IntakeMaterializer.applyApproved` (now delegates to a private `applyDirective`) — up to
      3 attempts, linear backoff, `console.error` logged on each retry (matching this package's
      existing `gateway-google.ts` convention). Since every dual-write step is now idempotent,
      retrying the whole method from scratch on a transient failure is safe. Tests added:
      `packages/local/test/pglite.test.ts` + new `packages/local/test/memory.test.ts` (calling
      `commitEntity` twice with the same id no-ops, doesn't throw); new
      `packages/integrations-google/test/materializer-retry.test.ts` (a fake `commitEntity` that
      throws once then succeeds proves the retry recovers with no duplicate entity; a fake that
      always throws proves retries exhaust and the error still surfaces). Full monorepo
      `turbo run build --force` + `turbo run test --force`: 28/28 packages green.
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
