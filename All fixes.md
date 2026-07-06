# All Fixes — Master Tracker

Single source of truth for the 2026-07-04 brutal code review + platform audit. Every pointer
from the review is listed below, one checkbox each. Status legend:

- `[x]` RESOLVED — done, verified (build/test or explicit decision), date given.
- `[~]` IN PROGRESS — partially done, gap noted.
- `[ ]` OPEN — not started.

Cross-references: [docs/BUGS.md](docs/BUGS.md) is the live bug ledger
(update it, not just this file, when something here changes state — this file is the phase/
priority view, BUGS.md is the per-bug detail view). [docs/raw/decisions-log.md](docs/raw/decisions-log.md)
holds the rationale for every approval-gated call. Update this file's checkboxes whenever an item
here changes state; don't let it drift from BUGS.md.

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
- [x] **[P0] RESOLVED 2026-07-05** — `wiring.ts` god composition root refactored: extracted
      `buildPersistentPorts(env)` / `buildInMemoryPorts(env)`, each returning one fully-typed
      `ModePorts` object; every `let`-sprawl reassignment in `buildWiring()` is gone, replaced
      with a single `url ? buildPersistentPorts(...) : await buildInMemoryPorts(...)` branch.
      Canonical identity store now genuinely persists: `buildPersistentPorts()` binds it to the
      real `DrizzleCanonicalIdentityStore` (`@bridge/db`) instead of the in-memory fake it was
      unconditionally using before, even with `DATABASE_URL` set. **Two lies could not be closed
      for real and are now HONEST instead of silent:** (1) DealPilot's `ToolCaptureStore` has no
      persistent implementation anywhere in the codebase yet (Phase 3 item 11b) — it stays
      in-memory in persistent mode, with a loud `console.warn` at boot naming exactly this gap;
      (2) the "ledger MUST stay local" header claim is NOT enforced in persistent mode (the
      ledger binds to whatever `DATABASE_URL` points at, which may be cloud) — also a loud
      `console.warn` at boot, pointing at Phase 1 item 7's still-open residency decision (not
      resolved here, per that item's "needs your decision" status). New
      [wiring.test.ts](platform/apps/api/test/wiring.test.ts) proves both factories' port shapes
      and both warnings fire. See decisions-log 2026-07-05. *(closes Phase 2 item 8's
      typed-port-factory sub-bullet)*
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
      item 6 remains open, see BUGS.md)*
- [x] **[P1] RESOLVED 2026-07-05** — Post-commit policy phase was decorative — `pipeline.ts`'s
      `#commit()` computed and discarded `evaluate()`; a `block` effect from a post-commit policy
      blocked nothing (the commit had already happened). Took the type-narrowing option (safer of
      the two the tracker offered). New `PostCommitEffect` and `PostCommitPolicyResult` types in
      [types.ts](platform/packages/core/src/types.ts) exclude `"block"`/`"require_approval"` from
      what a post-commit-phase policy can return; a new `toPostCommitResults()` helper in
      [pipeline.ts](platform/packages/core/src/pipeline.ts) narrows the post-commit
      `evaluate()` return through this type and `console.warn`-logs (rather than silently
      dropping) any policy that still tries to return `block`/`require_approval` post-commit,
      naming it a policy-authoring anomaly. `PolicyStore.evaluate()` itself stays a single
      interface shared by in-memory and Drizzle implementations (both out of scope this round),
      so the narrowing happens at the one call site that matters instead of the port signature.
      New test
      [postcommit-effect-types.test.ts](platform/packages/core/test/postcommit-effect-types.test.ts)
      has `@ts-expect-error` assertions proving `block`/`require_approval` are no longer
      assignable to the post-commit type, plus a runtime test proving a `phase: "post"` policy
      returning `block` no longer stops the commit (action/ledger/events still fire once,
      exactly as before) — it's now just logged. `@bridge/core` build+test green (66/66,
      including the new test).
- [ ] **[P1]** Injected seams reading as shipped protection but unwired: `PacingGate` zero
      callers; `createBusinessBrokerNetConnector` normalizer with no fetcher; agent-floor DENY
      seed in `0001_governance_seed.sql:52-67` a documented-not-executed template. Fix: wire each
      or mark experimental; stop claiming a DB backstop that isn't real. *(feeds Phase 3 item 14
      for PacingGate; BusinessBroker.net decided below, not wiring)*
- [x] **[P2] RESOLVED 2026-07-05** — BizBuySell alert HTML parsed by hand-rolled regex
      (`connectors.ts`) had no counter/alert if the template changed and parse rate silently
      dropped to zero. Added a `ParseBatchSummary` (`attempted`/`parsed`/`parseRate`) plus
      `LOW_PARSE_RATE_THRESHOLD = 0.5` / `LOW_PARSE_RATE_MIN_ATTEMPTS = 2` and a
      `warnIfLowParseRate()` helper in
      [connectors.ts](platform/tools/dealpilot/src/connectors.ts) that `console.warn`s naming
      "template drift" explicitly as the likely cause once a batch's parse rate drops below 50%
      (matching the `console.warn`/namespaced-message convention already used in
      `@bridge/integrations-google`, the only real logging precedent in this call chain — dealpilot
      and jobpilot had no metrics emitter of their own to match instead). New exported
      `parseBizBuySellAlertBatch()` returns the summary object directly for callers who want to
      inspect it; `createBizBuySellAlertConnector`'s existing signature/return shape is unchanged
      (its one real call site in `wiring.ts` was untouched) but now tallies parses per `fetch()`
      call and runs the same warn check internally. 4 new `dummy_`-prefixed tests in
      [connectors.test.ts](platform/tools/dealpilot/test/connectors.test.ts) cover a healthy batch
      (no warning) and a template-drift batch (warns, names template drift), both via the new
      batch function and via the connector's `fetch()`. `@bridge/dealpilot` test green (23/23).
- [x] **[P2] RESOLVED 2026-07-05** — Untyped jsonb read silently dropped malformed data:
      `ritual-stores.ts`'s `asStep` filtered bad steps to `null` (a ritual "ran successfully"
      while silently doing less than configured); same pattern in `governance-stores.ts` for
      agent `capability_scope`/`allowed_skills`. Fixed at both ends: new colocated zod schemas
      (`ritualStepDefSchema`, `ritualStepListSchema`, `toolCompositionSchema` in
      [ritual-stores.ts](platform/packages/db/src/ritual-stores.ts);
      `agentCapabilityScopeSchema`, `allowedSkillsSchema` in
      [governance-stores.ts](platform/packages/db/src/governance-stores.ts)) validate at WRITE
      time via new `saveSteps()`/`saveCapabilityScope()`/`saveAllowedSkills()` methods that throw
      before persisting anything malformed. At READ time, `DrizzleRitualRegistry.load()`,
      `DrizzleToolRegistry.load()`, and the agent store's scope/skills readers now THROW on a
      malformed row instead of filtering it to `null`/an empty default — covers both
      pre-existing bad rows and any future write path that bypasses the new validation. Added
      `zod` as a runtime dep of `@bridge/db` (schemas colocated there rather than shared, since
      `@bridge/core` is a types-only zero-runtime-deps package). 10 new `dummy_`-prefixed tests in
      [ritual-stores.test.ts](platform/packages/db/test/ritual-stores.test.ts) and
      [governance-stores.test.ts](platform/packages/db/test/governance-stores.test.ts) prove both
      the write-time throw and the read-time throw (via a raw Drizzle insert that bypasses the
      store's own write validation, simulating a row written before this fix existed).
      `@bridge/db` build+test green (18/18 including all 10 new tests).
- [x] **[P2] RESOLVED 2026-07-05** — Copy-paste drift: 3 near-identical ATS connector factories
      in `jobpilot/connectors.ts` were collapsed into one parameterized
      `createAtsConnector(id, fetcher)` factory that `createGreenhouseConnector`/
      `createAshbyConnector`/`createLeverConnector` now each call — a real dedup, not a comment
      (the 3 were byte-identical modulo the id string; no behavior changed, pinned by a new smoke
      test asserting id/tier/cost/confidence/request-passthrough for all 3). `FUZZY_THRESHOLD =
      0.9` in the jobpilot answer-bank duplicated `@bridge/dedupe`'s fuzzy-match threshold with no
      shared source: added and exported `FUZZY_MATCH_THRESHOLD = 0.9` from
      [`@bridge/dedupe`](platform/packages/dedupe/src/types.ts), and jobpilot's `answer-bank.ts`
      now does `export const FUZZY_THRESHOLD = FUZZY_MATCH_THRESHOLD` imported from `@bridge/dedupe`
      instead of re-declaring the literal (jobpilot already depended on `@bridge/dedupe`, no
      cycle — see decisions-log.md for the ADR on why direct import beat a new shared package). New
      tripwire test `fuzzy-threshold-consolidation.test.ts` asserts
      `strictEqual(FUZZY_THRESHOLD, FUZZY_MATCH_THRESHOLD)`. **Scoped down**: the tracker's
      `costPerCall` and `0.5 + 0.1 * filled` magic-number bullet does not apply to the current
      repo state — grep across all of `platform/tools/jobpilot` (src + test) found no
      `filled`-based formula anywhere (scoring.ts/evaluator.ts/pacing.ts) and `costPerCall` only
      appears as an already-named, already-documented config field on `@bridge/sourcing`'s
      `ApiClientConfig`, not a magic number belonging to jobpilot. Named/documented the closest
      legitimate analog instead: the ATS connectors' own cost/confidence literals are now
      `ATS_CONNECTOR_COST_PER_CALL = 0` / `ATS_CONNECTOR_CONFIDENCE = 0.95` with short comments.
      `@bridge/dedupe` test green (9/9), `@bridge/jobpilot` test green (50/50).
- [x] **[P3] RESOLVED 2026-07-05** — `resolveAuthority`'s agent branch mixed four authority
      layers in ~90 lines (`authority.ts`, re-read fresh post agent-floor-consolidation round).
      The four layers, named for what they actually check (not the tracker's guessed generic
      names): `evaluateAgentRoleScope` (role grants ∩ capability_scope ceiling, short-circuits on
      explicit role deny), `evaluateEphemeralGrant` (active ephemeral grants unioned with the base
      authorization, short-circuits on ephemeral deny/deny-by-default), `computeAgentDataScope`
      (requested ∩ agent data-scope ceiling ∩ contributing grant's scope), and `evaluateDelegation`
      (on-behalf-of delegation, intersecting the principal's own authority/scope). A new
      `resolveAgentAuthority()` orchestrates all four in the original order; `resolveAuthority`'s
      `actor.type === "agent"` case now just calls it. Pure refactor, human-principal branch and
      the `agentFloorDeny`/`planeGate` layers untouched. No dedicated `authority.test.ts` exists —
      coverage is indirect via `conformance.test.ts`/`pipeline.test.ts`; confirmed the exact test
      name list before/after this refactor is unchanged (65/65 → 66/66, the one new test came from
      a concurrent unrelated pipeline.ts change, not this refactor). `@bridge/core` build+test
      green.

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
      (unrelated pre-existing `pagination.test.ts` failures untouched, see BUGS.md).
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

- [~] **[P0] PARTIALLY RESOLVED 2026-07-05** — Single-tenant by construction, API pretends
      otherwise — `PILOT_WORKSPACE`/agent IDs baked into `buildWiring()`; `dealpilot.list`
      accepted `workspaceId` and ignored it; several other workspace-scoped procedures had no
      validation at all. Interim safety fix (full multi-tenancy is out of scope for this pass,
      Phase 5 pilot-recruitment-driven): every procedure in `router.ts` that takes a
      `workspaceId` (`action.propose`, `ritual.create`/`run`/`runById`, `dealpilot.source`,
      `dealpilot.list` (param added, optional), `tool.run`, all of `integration.*`,
      `workspace.inviteMember`/`listMembers`) now runs through a `withPilotWorkspaceGuard`
      tRPC middleware that rejects any non-pilot `workspaceId` with
      `TRPCError({code:"FORBIDDEN"})` via a typed `NonPilotWorkspaceError` — a silent
      cross-tenant leak is now a loud, typed 403 instead. `google.*` procedures were left
      workspace-IMPLICIT on purpose (no `workspaceId` param added): no frontend caller
      (`Design Bridge AI Interface (Copy)/src/app/data/api.ts`) ever attempts to pass one, so
      there was no silent-ignore bug to close there — see decisions-log 2026-07-05 for the full
      reasoning. New
      [single-tenant-guard.test.ts](platform/apps/api/test/single-tenant-guard.test.ts) proves
      rejection + pilot-workspace success for two independently-shaped procedures.
      **Still open:** this is a safety net, not real multi-tenancy — no per-workspace data
      isolation exists in the backing stores themselves. *(Phase 3 item 11a)*
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
- [x] **[P1] RESOLVED 2026-07-05** — Random UUIDv4 PKs on append-only high-write tables (ledger,
      events, timeline_entries) — B-tree page-split thrashing, no time-locality. Switched all
      three to UUIDv7 (RFC 9562, time-prefixed) for NEW rows: `uuidPkV7()` in
      [schema.ts](platform/packages/db/src/schema.ts) calls `@bridge/core`'s new `uuidv7()`
      ([determinism.ts](platform/packages/core/src/determinism.ts), ~20-line in-house generator —
      no native pg `uuidv7()` pre-PG18, and the project convention is a small in-house algorithm
      over a new npm dependency) via Drizzle's `$defaultFn`, generated application-side before
      each INSERT. Forward-only: existing v4 row ids are NOT migrated (pre-launch, no production
      data). `timeline_entries` ALSO got the missing `(workspace_id, occurred_at)` composite
      index it had none of beyond its PK (full scan + sort from day one) —
      `timeline_entries_ws_occurred_idx` in
      [0004_schema_hardening.sql](platform/packages/db/migrations/0004_schema_hardening.sql).
      No partitioning/retention story added (out of scope for this pass). *(Phase 3 item 12)*
- [x] **[P1] RESOLVED 2026-07-05** — Missing hnsw index on embeddings — `SCHEMA.sql` specifies
      `USING hnsw (embedding vector_cosine_ops)`, migrations only created a btree lookup index.
      Added `embeddings_embedding_hnsw_idx` in
      [0004_schema_hardening.sql](platform/packages/db/migrations/0004_schema_hardening.sql).
      **Confirmed working against pglite too** (not just documented as a real-Postgres-only
      caveat): `@electric-sql/pglite/vector` at the version pinned in this repo's `package.json`
      DOES implement real hnsw index builds — verified empirically (a standalone pglite instance
      builds `USING hnsw (e vector_cosine_ops)` without error) before relying on it, and a new
      test in
      [schema-hardening.test.ts](platform/packages/db/test/schema-hardening.test.ts) proves the
      index exists AND that a similarity query's `EXPLAIN` plan actually names it (not a seq
      scan). *(Phase 3 item 12)*
- [x] **[P2] RESOLVED 2026-07-05** — `people_canonical.emails text[]` had no index (`= ANY(emails)`
      was a per-row array scan); `dedup_key` was a plain unique (NULLs already didn't collide in
      Postgres semantics, but the "many NULLs allowed / non-null duplicates rejected" intent was
      implicit in a NULL-treated-as-distinct plain constraint, not declared). Added a GIN index
      (`people_canonical_emails_idx`) and converted `dedup_key` on BOTH `people_canonical` and
      `communities_canonical` to an explicit partial unique index (`*_dedup_key_uq ... WHERE
      dedup_key IS NOT NULL`), following the exact same idiom as `ledger_ref_ledger_id_resolved_uq`
      in migration 0003. All in
      [0004_schema_hardening.sql](platform/packages/db/migrations/0004_schema_hardening.sql);
      `schema.ts`'s `dedupKey` columns dropped their `.unique()` modifier (the hand-written
      partial index is now the sole canonical constraint, same reconciliation pattern as
      `role_permissions` below). Tests in
      [schema-hardening.test.ts](platform/packages/db/test/schema-hardening.test.ts) prove both:
      multiple NULL-key rows insert fine, a second row with a duplicate non-null key is rejected.
      *(Phase 3 item 12)*

## 5. Type definitions, schemas, API contracts

- [ ] **[P1]** `inputs: z.unknown()` at the "single validate+sanitize chokepoint"
      (`router.ts:89`) — unvalidated client payload flows to `skill.run` and the ledger;
      `envelope as never` (`router.ts:310`) is a hard type-system bypass where a
      `z.discriminatedUnion` on `kind` belongs. *(Phase 3 item 12)*
- [x] **[P1] RESOLVED 2026-07-05** — Naive drizzle-generated unique on `role_permissions` vs. the
      hand-written coalesce index in `0001` — `drizzle-kit push` locally tested different
      uniqueness semantics than production migrates to (NULLs distinct vs. coalesced-to-sentinel).
      `schema.ts`'s `rolePermissions` table no longer declares a `unique(...).on(...)` builder at
      all — the hand-written coalesce-NULL index from `0001_governance_seed.sql` (reasserted
      defensively, idempotently, in
      [0004_schema_hardening.sql](platform/packages/db/migrations/0004_schema_hardening.sql)) is
      now the ONE canonical constraint on both paths. New test in
      [schema-hardening.test.ts](platform/packages/db/test/schema-hardening.test.ts) proves
      exactly one non-PK unique index exists on `role_permissions` and that its semantics are
      correct (two type-wide/NULL-resource_id grants collide; a scoped/non-null-resource_id grant
      for the same role/type/action does not).
- [x] **[P2] RESOLVED 2026-07-05** — Enum-as-text with zero CHECK constraints (`visibility`,
      `effect`, `user_decision`, `actor_type`, `on_behalf_of_type`) — zod only guarded the API
      door; a direct/malformed insert (`'approvd'`) would corrupt every audit query. Added CHECK
      constraints in
      [0004_schema_hardening.sql](platform/packages/db/migrations/0004_schema_hardening.sql),
      values taken from the authoritative app-side types/zod schemas (NOT guessed): `visibility`
      (`private|team|workspace`, `SCHEMA.sql` comments), `effect` on `permissions`/
      `role_permissions` (`allow|deny`, core's `PermissionEffect`) vs. `effect` on `policies`
      (`allow|block|require_approval`, core's `PolicyEffect` — these are genuinely two different
      enums sharing a column name, confirmed by reading `core/src/types.ts` before writing either
      constraint), `user_decision` (`approve|veto|edit`, nullable), `actor_type` on `ledger`/
      `ephemeral_grants` (`user|team|agent`, core's `ActorType`) — **and a real bug this surfaced
      and fixed in the same pass**: `actor_type` on `permissions` needed a WIDER list
      (`user|team|agent|integration`) because `@bridge/db`'s `integration-store.ts` writes a 4th
      value, `INTEGRATION_ACTOR_TYPE = "integration"`, to that specific table only — the existing
      `integration-permissions.test.ts` caught this immediately (23514 CHECK violation) when the
      narrower 3-value list was first applied, confirming the test suite as the correctness
      backstop for the enum-value lists, not guesswork. Tests in
      [schema-hardening.test.ts](platform/packages/db/test/schema-hardening.test.ts) prove each
      CHECK rejects an invalid value and that the legitimate `'integration'` actor_type is NOT
      rejected. *(Phase 3 item 12)*
- [x] **[P2] RESOLVED 2026-07-05** — Inconsistent zod strictness in one file — `resourceId:
      z.string()` (no `.uuid()`) in `router.ts`'s shared `proposeInput`/`ritualStep` schemas vs.
      `.uuid()` required on other id fields elsewhere in the same file — malformed ids became 500s
      instead of 400s. Both `resourceId` occurrences now carry `.uuid()`. *(Phase 3 item 12)*
- [x] **[P2] RESOLVED 2026-07-05** — Two soft-delete idioms (`archived_at` vs. `status='archived'`)
      audited. `archived_at` (nullable timestamp, "NEVER hard delete") is the canonical DB-schema
      idiom per `SCHEMA.sql`'s own header comment and is what the clear majority of
      `schema.ts` tables use (7: `workspaces`, `teams`, `communities`, `people`, `initiatives`,
      `files`, `rituals`). Tables carrying a `status` text column (`skills`, `tools`,
      `integrations`, `agents`, `ritual_runs`, `touchpoints`, `signals`) are a **different,
      non-overlapping concept** — general lifecycle state (`active`/`running`/`open`/`new`, no
      `'archived'` value ever assigned to any of them in app code) — not a second soft-delete
      idiom competing with `archived_at`; grepped all of `platform/packages/{core,db}/src` and
      `apps/api/src` for `'archived'`/`status.*archived` and found no writer that assigns
      `status='archived'` to any `schema.ts` table. The one REAL instance of the two idioms
      genuinely coexisting on the same conceptual event is `@bridge/db`'s
      [media-store.ts](platform/packages/db/src/media-store.ts) (LOCAL-plane, hand-rolled SQL, not
      a `schema.ts` table): `MediaStatus = "pending"|"committed"|"archived"` is a real 3-state
      lifecycle (not a delete flag) that ALSO gets `archived_at` set on the same `archive()` call
      — this is by design (status carries WHICH state, `archived_at` carries WHEN), not accidental
      drift, so no schema change was made there. **Flagged, not fixed in this pass**: `archive()`
      in both `media-store.ts` and the matching in-memory adapter
      (`core/src/memory/stores.ts`, on this pass's explicit do-not-touch list) hardcode
      `archivedAt` to `new Date(0)` (epoch) instead of the actual current time — logged to
      BUGS.md rather than fixed here since a correct fix touches the do-not-touch
      in-memory store too and should land as one coherent change, not half of one.
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
      and BUGS.md) — that half was intentionally out of scope for this pass.
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
  - [x] **RESOLVED 2026-07-05** — `wiring.ts` typed-port-factory refactor itself. See section
        1's matching P0 entry above for the full writeup (`buildPersistentPorts`/
        `buildInMemoryPorts`, `ModePorts`, honest-lie warnings for the ledger-residency gap and
        DealPilot's `ToolCaptureStore`).
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
- [x] **RESOLVED 2026-07-05** — 10. Parse-null-rate counters on connectors; BizBuySell alert
      threshold. See section 1's matching P2 entry for the full writeup
      ([connectors.ts](platform/tools/dealpilot/src/connectors.ts) `warnIfLowParseRate` +
      `ParseBatchSummary`, threshold 50%, 4 new tests, `@bridge/dealpilot` 23/23 green).

### Phase 3 — Multi-tenant honesty & data-layer debt

- [x] **11a. RESOLVED 2026-07-05 (interim safety fix, not full multi-tenancy)** — Every
      workspace-scoped `router.ts` procedure now explicitly rejects a non-pilot `workspaceId`
      instead of ignoring/lacking validation for one. See section 4's matching P0 entry above
      for the full writeup and the `google.*` workspace-implicit reasoning.
- [ ] 11b. Persist `tool_captures` to a real table — **still open**.
- [x] **12. RESOLVED 2026-07-05 (schema-hardening sub-items)** — hnsw index, `(workspace_id,
      occurred_at)` on `timeline_entries`, GIN on `emails`, `dedup_key` partial-unique, CHECK
      constraints, `.uuid()` consistency, UUIDv7 for ledger/events/timeline_entries, and the
      `role_permissions` naive-vs-coalesce reconciliation are all done — see the matching section
      4/5 bullets above for the full writeup
      ([0004_schema_hardening.sql](platform/packages/db/migrations/0004_schema_hardening.sql) +
      [schema.ts](platform/packages/db/src/schema.ts) +
      [schema-hardening.test.ts](platform/packages/db/test/schema-hardening.test.ts), 8 new tests,
      full monorepo `turbo run build --force`/`turbo run test --force` all green). **Still open**
      (different pass, not schema/DDL): `updated_at` triggers, envelope discriminated union
      (`router.ts`'s `envelope as never`), per-skill input schemas (`inputs: z.unknown()`) — these
      are app-layer/API-contract items, not database hardening, and were out of scope for this
      migration-focused pass.
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
      `@bridge/*` deps — see [BUGS.md](docs/BUGS.md) for the two candidate
      paths). Needs your direction before implementation starts.
- [ ] localStorage → API swap for prototype tables — **needs your approval** (Blockers B).
- [ ] Ritual engine build (DAG, planner/executor split, snapshots, versioning/rollback, Hatchet
      backend) — not started, architecture complete.
- [~] **IN PROGRESS 2026-07-05/06** — `platform/apps/web` real frontend migration. Prototype is
      NOT being deleted and remains live in parallel until this lands and is verified at parity
      (cutover is a separate future decision). Scoping doc:
      [docs/raw/frontend-migration-scoping.md](docs/raw/frontend-migration-scoping.md).
      - [x] **Phase 1 (no new backend needed) — DONE, all 11 pages ported and verified**:
        DealPilotPage (reference port, live-verified against a running `@bridge/api`, 200 OK),
        RitualsPage/RitualCreate/RitualDetail, ToolsPage/ToolDetail, AgentCreate/AgentDetail,
        IntegrationDetail/GoogleIntegrationPanel, CalendarPage. `RitualsPage`/`ToolsPage` are
        link-out stubs (no `ritual.list`/`tool.list` procedure exists — logged to BUGS.md, not
        invented). `tsc --noEmit` + `vite build` clean (88 modules). Layout is a minimal 4-link
        nav shell, NOT the prototype's Sidebar/AgentPanel (separate follow-up increment).
      - [x] **Phase 2 (small backend additions) — DONE**: added `action.listPending` (new
        `LedgerStore.listPending`/pipeline passthrough, paginated) so the Approvals inbox has a
        real backing list — `apps/web`'s `ApprovalsPage` ported against it (list + approve/veto).
        SettingsPage explicitly NOT ported this pass (scoped down to `workspace.*` only per the
        original plan; still open).
      - [x] **Phase 3 (new core tRPC surface) — backend DONE, frontend NOT started**: new
        `graph` router (`graph.listInitiatives`/`.getInitiative`/`.listTouchpoints`/
        `.listSignals`/`.recordSignalAction`) + `DrizzleGraphStore`
        (`platform/packages/db/src/graph-store.ts`) — the READ surface Initiative/Touchpoint/
        Signal never had. Writes to initiative/touchpoint already flow through the existing
        generic `action.propose` (resourceType enum already included them); `recordSignalAction`
        is a direct authenticated write (bookkeeping, not a governed mutation — see
        graph-store.ts header comment). `WorkPage`/`IntelligencePage`/`InitiativeDetail` frontend
        pages still NOT ported — that's next against this new surface.
      - [x] **Phase 4 (new backend entirely) — DONE 2026-07-06**: three from-scratch backends,
        each with its own new tables (migration `0005_dashing_epoch.sql`, hand-trimmed — see
        BUGS.md's drizzle-kit snapshot-drift entry) + Drizzle store + router + frontend page,
        all live-verified end-to-end in-browser (create → list → read-back, zero console errors):
        - **JobPilot**: `jobpilot` router (`create`/`list`/`transition`) + `DrizzleJobPilotStore` —
          wires `@bridge/jobpilot`'s pure scoring (`scoreJobFit`)/state-machine (`transition`) logic
          to real persistence for the first time; `JobPilotPage` ported.
        - **Helpdesk**: `helpdesk` router with an authenticated agent-inbox side
          (`list`/`get`/`reply`) AND a genuinely public `helpdesk.public.*`
          (`createTicket`/`getThread`/`reply`) that never reads `ctx.identity` — token-possession
          auth instead of a new Actor type, see decisions-log.md 2026-07-06. `HelpdeskPage`/
          `HelpdeskThread` (agent side) + `PublicHelpdesk` (at `/help`, outside the authenticated
          nav shell) ported.
        - **Resources**: `resources` router (`create`/`list`) + `DrizzleResourcesStore`, replacing
          the prototype's Supabase-direct `resources_canonical` read; `ResourcesPage` ported.
      Full monorepo verified after every step this pass: `pnpm turbo run build --force` 17/17,
      `pnpm turbo run test --force` 30/30, no regressions.

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
- [x] ~~Execute the dummy purge (decided 2026-06-22, never run)~~ — **RESOLVED (verified
      2026-07-05): already fully executed in an earlier round, tracker was stale.** Grep-verified:
      no `FakeGoogleGateway` exists anywhere; `gateway.ts`'s `MissingGoogleGatewayFactory` fails
      closed (no fake fallback); `PILOT_USER`/`PILOT_WORKSPACE` are real structural identities,
      not a `DEMO_USER` placeholder. See BUGS.md and decisions-log.md 2026-07-05 entries.
      **New, separate open question** (not part of the original ADR's scope): should the
      social-provider fixture seam (X/Instagram/Facebook) get the same treatment? See
      BUGS.md — flagged for your call, not actioned.
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
