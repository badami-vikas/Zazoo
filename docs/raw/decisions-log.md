# Decisions Log (ADR)

Append-only record of non-trivial engineering decisions: what was decided, why, what
was rejected, and when. One entry per decision. Newest first. This complements
`docs/wiki/decisions.md` (which holds the short *locked* strategic calls) by capturing
the **rationale and alternatives** so a future session — human or agent — can see not
just what we chose but why, and what we deliberately did not choose.

Format per entry:
- **Date — Title**
- **Context:** the situation forcing a choice.
- **Decision:** what we chose.
- **Rationale:** why this over the alternatives.
- **Alternatives rejected:** and why.
- **Consequences / follow-ups:** what this commits us to, what remains open.

## 2026-07-05 — Offset/limit pagination for `dealpilot.list`/`integration.list`, not a cursor scheme

**Context:** Both procedures (`platform/apps/api/src/router.ts`) returned their ENTIRE backing
collection on every call — `dealpilot.list` mapped ALL of `wiring.dealpilot.candidateIds` through
per-id `facts.livingProfile()`; `integration.list` returned `DrizzleIntegrationStore.list()`'s
full array unsliced. Both grow linearly with usage and were flagged P1 in the 2026-07-04 review
(`All fixes.md` section 3, Phase 3 item 14c). The task brief left the offset-vs-cursor choice open,
to be decided by what the backing store actually supports.

**Decision:** Added zod-validated `limit` (`z.number().int().min(1).max(200).default(50)`) and
`offset` (`z.number().int().min(0).default(0)`) to both procedures' inputs, and changed both
return shapes to `{ items, total, hasMore }`. `dealpilot.list`'s whole input object is
`.optional().default({})` (there was no previous input at all) so the existing no-arg prototype
call site keeps compiling and running unchanged at the wire level. Implementation is a plain
`Array.prototype.slice(offset, offset + limit)` in both cases — `candidateIds` is a bare in-memory
array (`wiring.ts`) with no natural cursor key, and `DrizzleIntegrationStore.list()` (`@bridge/db`)
has no store-level pagination support to cursor against either, so the router slices the array
after the full fetch. `total`/`hasMore` are computed from the pre-slice length so callers can tell
there's more without a second round-trip.

**Rationale:** Offset/limit is the correct-and-simplest fit for the CURRENT backing stores: an
in-memory array has no stable, monotonic ordering key to cursor on (candidates aren't inserted
with a timestamp/sequence field today), and `DrizzleIntegrationStore.list()` already does a full
table scan with no `ORDER BY`/keyset-friendly column exposed at the store API. Building a cursor
scheme on top of that would add complexity (opaque cursor encoding, stability guarantees) without
a real ordering guarantee underneath it to justify the complexity — over-engineering relative to
what the task brief asked to avoid. `{ items, total, hasMore }` was chosen over a bare array or a
`nextCursor`-shaped response because grep across this router and `@bridge/core`/`@bridge/db` found
zero existing pagination-response convention to match (confirmed by search — this is the first
paginated list surface in the codebase), so this shape sets the convention for both procedures
touched here, favoring simplicity (three flat fields, no nesting) an eventual pager UI can
generalize from later once a second offset-paginated surface exists.

**Alternatives rejected:** (1) Cursor/keyset pagination (e.g. opaque cursor encoding the last id
or offset) — rejected as premature: neither backing store has a real ordering key to make a cursor
meaningfully different from an offset today, so it would be complexity theater. (2) Add real
pagination support to `DrizzleIntegrationStore.list()` itself (a SQL `LIMIT`/`OFFSET` in the
query) rather than slicing in the router — deferred: `@bridge/db` was intentionally left untouched
(not explicitly forbidden this session, but the task brief scoped changes to the two router
procedures only); the router-level slice is correct today given the FK/seeding gap uncovered while
testing this (see follow-up below) means the store's real-world row counts are tiny regardless.
(3) Leaving `dealpilot.list`'s params required (no `.default({})`) — rejected: would have broken
the existing no-arg prototype call site (`Design Bridge AI Interface (Copy)/src/app/data/api.ts`'s
`apiDealPilotList()`), and the task brief explicitly asked for backward compatibility over a
breaking change here.

**Consequences / follow-ups:** `apiDealPilotList()` now requests `{ limit: 200, offset: 0 }` and
unwraps `.items` — the prototype UI still has no pager, so it asks for the max page size to
preserve today's "show everything" behavior visually, while the backend response itself stays
bounded regardless of what any future caller requests. New
`platform/apps/api/test/pagination.test.ts` covers explicit-limit pagination and a "no unlimited
default" case for both procedures. While building the FK-satisfying test fixture for
`integration.list`, discovered `PILOT_WORKSPACE`/`PILOT_USER` (`wiring.ts`) are never actually
inserted into the `workspaces`/`users` tables anywhere — a real (non-in-memory) DB write with a FK
into either (e.g. `integration.connect`, or `workspace.create` called with the pilot user id)
would throw a raw FK violation. Out of scope for this change (bootstrap/seeding, not pagination);
spun off as a separate background task rather than fixed here. Also worth a future look: if a
second offset-paginated list surface appears, consider whether `{ items, total, hasMore }` should
move to a shared `@bridge/core` or router-level helper type rather than being re-declared per
procedure.

## 2026-07-05 — In-process seed-keyed dedup for Gmail intake, in `@bridge/integrations-google` rather than `@bridge/core`

**Context:** Two related, currently-open bug-tracker items in `platform/packages/integrations-
google/`: (1) `IntakeService`'s `hasExternal` guard only excludes already-MATERIALIZED external
items — if `syncGmail`/`syncCalendar` runs twice before the user reaches the Approvals inbox, a
second PENDING proposal gets staged for the same thread/event, and approving both double-commits
Touchpoints/Memories; (2) `GoogleApiGateway.fetchThreads` fetched each thread body with a
SEQUENTIAL `threads.get` call and no retry at all. The task brief for (1) suggested checking
whether the pipeline/ledger already exposes a query method for "list pending proposals by seed"
that could be reused instead of inventing new storage.

**Decision:** For (1): investigated `@bridge/core`'s `LedgerStore` interface
(`packages/core/src/ports.ts`) and `UniversalActionPipeline` (`packages/core/src/pipeline.ts`) —
confirmed neither exposes a query/list/find method; `LedgerStore` only has
`append`/`get(id)`/`decisionFor(proposalId)`, and `IntakeServiceDeps` deliberately carries only
`pipeline`/`bodies`/`graph`, no ledger reference. `Proposal.request.seed` IS present on the
returned `Proposal` (a `seed?: string` on `ActionRequest`), so the seed is recoverable without a
new core query — there's just nowhere durable to index "seed → still-pending proposal id" without
adding one. Rather than extend `@bridge/core` (a parallel session owned that package this
session; also a query-by-seed method would be new API surface for a fairly narrow need), added an
in-process `pendingSeeds: Map<seed, proposalId>` directly on `IntakeService`
(`packages/integrations-google/src/intake.ts`) — `stage()` checks it before calling
`pipeline.propose()` and short-circuits to the existing pending proposal's summary if the seed is
already staged; a new `clearPendingSeed()` method removes the entry once the proposal resolves,
called from `GoogleService.onApproved` (`service.ts`, already invoked after every `decide()` call
regardless of approve/veto/edit) using `resolved.request.seed`. For (2): added a small
`mapWithConcurrency` helper (bounded to 15 concurrent `threads.get` calls — a deliberate cap below
Gmail's per-user rate limit, not "fire everything at once") and a file-local `withRetry` (3
attempts, linear backoff) in `gateway-google.ts`, matching the shape of `intake.ts`'s existing
`withRetry` of the same name (added in a recent prior session for the dual-write idempotency fix).
A thread that exhausts retries is logged and skipped rather than aborting the whole sync.
Additionally hardened `extractPlainText` in the same file with a `MAX_MIME_DEPTH` (10) recursion
cap and a `MAX_BODY_BYTES` (5MB) decode cap, closing a related "unbounded multipart recursion +
full base64 decode in memory" item from the same tracker section.

**Rationale:** `IntakeService` is a long-lived singleton per `GoogleService` instance (constructed
once in `wiring.ts`, lives for the process), so an in-process map correctly closes exactly the
race window the bug describes — "two syncs before a proposal is approved" is bounded by process
lifetime, not something that needs to survive a restart. Scoping the fix entirely inside
`integrations-google` respects the session's constraint against touching `@bridge/core`,
`apps/api/src/router.ts`, or `apps/api/src/identity.ts` (other agents' concurrent work), and
avoids growing `LedgerStore`'s public surface for a need that's local to one package. Reusing
`resolved.request.seed` (already flowing through `onApproved`) to clear the map means no new
plumbing was needed to know when a proposal resolves — the existing post-decide hook was already
the right seam. For the fetch fix, bounded concurrency (not fire-everything-at-once) plus retry is
the standard fix for a sequential-N+1-with-no-resilience pattern, and reusing the `withRetry`
name/shape from `intake.ts` keeps one convention across the package instead of two subtly
different retry helpers.

**Alternatives rejected:** (1) Add a `findPendingBySeed`/`list(filter)` method to `@bridge/core`'s
`LedgerStore` — rejected: out of scope (core was off-limits this session), and a full query API is
more surface than this one narrow need justifies; flagged as a possible future core gap if
cross-session (not just cross-call) dedup-by-seed becomes a recurring pattern elsewhere. (2) Track
pending seeds in `LocalGraphStore` (`@bridge/local`) alongside `hasExternal`/`recordExternal` —
rejected: `@bridge/local` is a separate package this session wasn't scoped to touch either, and
mixing "committed external records" with "still-pending proposal seeds" in the same store
conflates two different lifecycle stages (capture ≠ commit is already a first-class distinction in
this codebase). (3) Persist the pending-seed index to survive restarts — rejected as unnecessary
for the bug as described (a same-process double-sync race); a restart naturally clears in-flight
proposals from this map the same way it clears everything else in-memory, and there is no
correctness gap introduced by that, since `hasExternal` still catches anything actually
materialized. (4) Unbounded `Promise.all` for the thread fetches — rejected: would fire as many
concurrent requests as threads in the batch, risking Gmail rate-limit errors on a large sync; a
concurrency cap is the standard mitigation.

**Consequences / follow-ups:** `IntakeService`/`GoogleService`/`IntakeMaterializer` public
constructors are unchanged (no new required deps — `clearPendingSeed` is a new public method on
the already-injected `IntakeService`, called from `GoogleService`, which already holds both).
`gateway-google.ts`'s `test` script gained `--experimental-test-module-mocks` (Node >= 22) to
support the new `node:test` `mock.module`-based gateway tests. New tests:
`packages/integrations-google/test/intake-dedup.test.ts`,
`packages/integrations-google/test/gateway-fetch-concurrency.test.ts`,
`packages/integrations-google/test/extract-plain-text-bounds.test.ts`. Full monorepo `turbo run
build --force` + `turbo run test --force` green except a pre-existing, unrelated `apps/api`
`pagination.test.ts` FK-violation failure from a parallel session's in-flight pagination work
(confirmed untouched by this change).

## 2026-07-05 — Ledger `ref_ledger_id` as a real column + partial unique index, not a jsonb key

**Context:** `decide()`'s double-approve check (`pipeline.ts`'s `decisionFor()` call) resolved
proposal-resolution linkage via `diff->>'__refLedgerId'` — a reserved key inside the `diff` jsonb
column, with no dedicated column, no index, and no uniqueness constraint. Two consequences: (1)
any skill whose `diff` output happened to contain a key literally named `__refLedgerId` would
corrupt double-approve detection (a correctness hazard baked into an unenforced naming
convention), and (2) with no unique constraint backing it, the "already resolved?" check was a
plain SELECT with no atomicity guarantee — two concurrent `decide()` calls (double-click, a client
retry after a slow response, a retried webhook) could both read "not yet resolved," both append a
resolving decision row, and both commit — firing `onApproved` twice (e.g. sending an approved
email twice). The same in-memory ledger (`InMemoryLedger` in `packages/core/src/memory/stores.ts`)
had an equivalent race: its `decisionFor()` check and the later `append()` were two separate
non-atomic steps with an `await` in between.

**Decision:** Added real `ref_ledger_id uuid`, `seed text`, `data_scope text`, `context jsonb`
columns to the `ledger` table
(`platform/packages/db/migrations/0003_ledger_ref_column.sql`, hand-written following the same
convention as `0001_governance_seed.sql`, registered in `migrations/meta/_journal.json`), plus a
**partial** unique index: `ledger_ref_ledger_id_resolved_uq` on `(ref_ledger_id) WHERE
ref_ledger_id IS NOT NULL AND user_decision IS NOT NULL`. The predicate matters: it excludes
rejected/floor-denied audit rows (which carry `refLedgerId` but a null `userDecision` — see the
2026-07-04 "audited-rejection ledger row on agent-floor deny" entry) from the uniqueness
constraint, so a blocked approve attempt never blocks the later legitimate resolution. No backfill
was written — pre-launch, no production data to migrate. `packages/db/src/ledger-store.ts` was
rewritten to read/write these as real columns (deleting the old `packDiff`/`unpack` jsonb-splicing
functions entirely) and to catch the resulting unique-violation (SQLSTATE 23505, matched against
the named index) and translate it into a new typed `AlreadyResolvedError`
(`packages/core/src/pipeline.ts`, exported from `@bridge/core`) — the SAME error the in-process
pre-check throws, so callers see one consistent type regardless of backing store. A companion
`AgentFloorDeniedError` replaces the bare `Error` previously thrown on floor-deny. `apps/api/src/
router.ts`'s `decide` procedure catches both and maps them to `TRPCError({code:"CONFLICT"})` /
`TRPCError({code:"FORBIDDEN"})`, following the existing `IntegrationFloorScopeError` → `FORBIDDEN`
pattern already in use at `router.ts:576`. For the in-memory ledger, `InMemoryLedger.append()`
gained an atomic check-and-mark against a `Set<string>` of resolved proposal ids — the check and
the mark happen in the same synchronous block with no `await` between them, so two "concurrent"
JS calls (e.g. `Promise.all([decide(), decide()])` in a test, or two requests handled on the same
event-loop turn) cannot both pass.

**Rationale:** A partial unique index is the correct database-native way to express "at most one
row of kind X per key" when "kind X" is a subset of rows (here: resolving decisions, not every
ledger row) — it's the same idiom already used in this schema for `role_permissions_uq`'s
coalesce-NULL unique index in `0001_governance_seed.sql`, so this fix follows an established
in-repo pattern rather than introducing a new one. Enforcing the constraint at the database
(rather than only in application code) is the only way to actually close a TOCTOU race across
concurrent connections/processes — an in-process check-then-act, no matter how careful, cannot by
itself prevent two different Node processes (or two requests interleaved on the event loop before
either awaits) from both passing the check. The in-memory ledger doesn't have a database to lean
on, so its fix has to be structurally different (synchronous check-and-mark) — but the invariant
it enforces is identical, and both paths are tested to prove it.

**Alternatives rejected:** (1) Wrap `decide()`'s read-then-write in an explicit SQL transaction
with `SELECT ... FOR UPDATE` locking the proposal row — rejected as the heavier option: it requires
a transaction to span the pipeline's authority/policy/skill-registry calls (or a narrower
transaction just around the ledger read+append, which still needs a lock scope decision), and the
persistent ledger's actual failure mode (two INSERTs of *new* append-only rows, not a competing
UPDATE) is exactly what a unique index is designed to prevent without any row locking at all — a
constraint is strictly simpler and correct for an append-only table. (2) Add the uniqueness rule
as an application-level global lock (e.g. an in-process mutex keyed by proposal id) — rejected: it
would only work within a single Node process/instance, not across horizontally-scaled API
instances, whereas the database constraint is correct regardless of how many API processes are
running. (3) Keep the `diff` jsonb linkage but add validation forbidding skills from ever
producing a `__refLedgerId` key — rejected: it fixes the correctness hazard but does nothing for
the TOCTOU race, which was the more serious of the two problems the review flagged, and jsonb keys
still can't be indexed with a real uniqueness guarantee the way a column can.

**Consequences / follow-ups:** `LedgerEntry` gained `dataScope`/`context` as real fields alongside
`refLedgerId`/`seed` (feeds Phase 1 item 5's fix, tracked in the same migration/PR since both
needed the same schema change). The persistent-ledger residency question (private proposals
possibly landing in a cloud ledger once `DATABASE_URL` is set — All fixes.md Phase 1 item 7)
remains open and is unaffected by this change — the new columns exist on whichever ledger table
the deployment points at, local or cloud. `packages/db/test/ledger-store.test.ts` (new) and
`packages/core/test/pipeline.test.ts` (extended) both prove the double-approve fix with a real
`Promise.allSettled` concurrent-call test — one succeeds, one gets the typed 409-mapped error —
against both the in-memory and pglite-backed ledger.

## 2026-07-05 — Agent-floor consolidation: canonical union in `@bridge/core`, not a per-site truce

**Context:** `AGENT_FLOOR_MUTATIONS` (`packages/core/src/authority.ts`), `isForbiddenAgentToken`
(`packages/core/src/agent-scope.ts`), and `ALWAYS_APPROVAL_SCOPES` (`packages/db/src/integration-
store.ts`) each independently declared the set of mutations/scopes an agent may never hold or be
granted — the exact invariant a "governed agentic execution" platform depends on staying
consistent. On inspection the three had actually drifted: `authority.ts` denied write/execute/
archive/approve on 8 governance resource types (policy, policy_param, skill, agent, role,
permission, ledger, delegation) plus `network_graph:full` read and `external:send`;
`agent-scope.ts`'s `isForbiddenAgentToken` matched the same 8 resources but for EVERY action (a
stricter check, e.g. it also blocked `agent:read`); `integration-store.ts`'s
`ALWAYS_APPROVAL_SCOPES` was only `["external:send", "network_graph:full"]` — it never covered the
governance-resource floor at all.

**Decision:** Created `packages/core/src/agent-floor.ts` as the single canonical definition,
exported from `@bridge/core`: `AGENT_FLOOR_PROTECTED_RESOURCES`, `AGENT_FLOOR_MUTATIONS`,
`AGENT_FLOOR_ALWAYS_DENIED_SCOPES`, `ALWAYS_APPROVAL_SCOPES`, `isAgentFloorDenied`,
`isForbiddenAgentToken`. `authority.ts`'s `agentFloorDeny` (kept its existing `Actor`-typed
signature since `pipeline.ts` imports it and was out of scope to touch) now delegates to
`isAgentFloorDenied` instead of re-declaring the resource/mutation sets. `agent-scope.ts` re-
exports the canonical `isForbiddenAgentToken` directly. `@bridge/db`'s `integration-store.ts`
imports and re-exports the canonical `ALWAYS_APPROVAL_SCOPES` instead of declaring its own array.
The canonical set is the UNION of all three original lists (the strictest possible floor), not an
intersection or a renegotiation — a floor must be at least as strict as anything ever enforced
anywhere, so narrowing any of the three to match the others was not an option.

**Rationale:** A single source of truth is the entire point of an "agent floor" — three
independently-maintained copies is exactly how it silently drifted (proven by the actual
discrepancy found). Picking the union preserves every guarantee any of the three call sites relied
on; nothing that was previously denied becomes newly allowed. `ALWAYS_APPROVAL_SCOPES`'s own
runtime behavior is unchanged by this fix (it only ever checked `resourceType` with no action, and
those two exact scopes are unchanged) — the fix is entirely structural (derivation, not new
denials), so no behavior-visible regression risk for existing callers.

**Alternatives rejected:** (1) Keep three lists but add a comment cross-referencing each other —
rejected, comments don't prevent drift, only imports do. (2) Intersect the three lists (keep only
what all three agreed on) — rejected, would have silently loosened `agentFloorDeny` and
`isForbiddenAgentToken`'s governance-resource coverage to match `ALWAYS_APPROVAL_SCOPES`'s gap,
turning a bug (missing coverage) into a downgrade (removed coverage) elsewhere. (3) Put the
canonical set directly in `authority.ts` rather than a new file — rejected; `agent-scope.ts` and
`integration-store.ts` (a different package, `@bridge/db`) both need it, and `authority.ts` already
carries the heavier `resolveAuthority` logic, so a small dedicated file keeps the floor
independently reviewable.

**Consequences / follow-ups:** `agentFloorDeny`'s exported signature and `pipeline.ts`'s only call
site are unchanged (out of scope for this pass, not touched). The DB-level agent-floor seed
(`0001_governance_seed.sql:52-67`) is still a documented-not-executed template — this fix closes
the app-layer triplication only; a real DB-level backstop for the floor remains a separate, still-
open item (see known-issues.md and All fixes.md Phase 1 item 6's remaining half). New smoke test
`packages/core/test/agent-floor.test.ts` iterates the canonical constants against all three
consumers so a future edit to only one of them fails a test instead of silently drifting again.

## 2026-07-05 — JWKS verify failures become a typed 401, not an unhandled rejection

**Context:** `identity.ts`'s `IdentityResolver.resolve` verified bearer tokens against either an
HS256 shared secret or a remote JWKS set (`jose`'s `createRemoteJWKSet`/`jwtVerify`), with neither
a timeout on the JWKS HTTP fetch nor a try/catch around the verify call. Any failure — a slow/down
JWKS endpoint, a network blip, or simply an invalid/expired/malformed token — propagated as a raw
rejection out of `createContext` (`context.ts`), which is invoked by the tRPC fastify adapter
before any procedure runs. Nothing in the codebase converted that into an HTTP status, so it risked
surfacing as an unhandled rejection / opaque 500 instead of a normal, expected 401 for bad
credentials.

**Decision:** Two changes. (1) `createRemoteJWKSet` now passes jose's native `timeoutDuration`
option (5s) so the key-set fetch itself is bounded — this is a first-class jose option, not a
hand-rolled `AbortController` race (no existing timeout helper/convention was found elsewhere in
the codebase to reuse; the Google integrations package has no retry/timeout module either, despite
being named as a possible source in the task brief). (2) The entire verify body (both the HS256
and JWKS branches) is wrapped in try/catch in `identity.ts`; any failure is re-thrown as a new
typed `IdentityVerificationError`. `context.ts`'s `createContext` catches that specific error type
and re-throws `TRPCError({code:"UNAUTHORIZED"})`, which `@trpc/server`'s fastify adapter maps to a
real HTTP 401 response.

**Rationale:** A typed error class at the point of failure, caught at the one place
(`createContext`) that has the tRPC vocabulary to translate it into a wire-level status, keeps
`identity.ts` free of any tRPC dependency (it only knows about verification, not HTTP semantics)
while still guaranteeing the failure surfaces correctly. Using jose's built-in `timeoutDuration`
instead of a custom wrapper avoids a second, possibly-inconsistent timeout mechanism racing jose's
own internal fetch/retry logic.

**Alternatives rejected:** (1) Silently downgrade a verify failure to the pilot fallback identity —
rejected outright, explicitly forbidden by this file's own header comment ("an invalid token is
rejected, never silently downgraded to the pilot identity") since that would let a client
sidestep verification by simply sending a bad token. (2) Catch-and-401 inside `identity.ts`
directly (import `TRPCError` there) — rejected to keep `identity.ts` a pure verification module
with no framework coupling; `context.ts` is the natural seam since it already owns the
tRPC-context boundary. (3) A generic `AbortController`-based timeout wrapper — rejected in favor of
jose's native `timeoutDuration`, which already covers exactly this case without extra code.

**Consequences / follow-ups:** New tests: `apps/api/test/identity.test.ts` (HS256 bad-secret
rejection, JWKS-unreachable-endpoint rejection completing within the bounded timeout instead of
hanging, and the no-verifier-configured pilot-fallback path proving it's unaffected) plus one new
end-to-end case in `apps/api/test/server.test.ts` (a forged-signature bearer token against a live
`buildServer()` instance via `app.inject`, asserting `statusCode === 401`). Discovered along the way:
`server.test.ts`'s existing `withEnv` test helper restores env vars in a synchronous `finally`
block that does not await an async test body, so any async test using it races env restoration
against its own logic — worked around locally with a new `withEnvAsync` helper in that file rather
than touching the existing (possibly relied-upon) `withEnv`, since fixing it project-wide was out
of scope for this pass.

## 2026-07-05 — Prototype stays the frontend; `platform/` frontend migration deferred, not started

**Context:** Asked to "retain platform and delete the reference design copy" on the premise that
platform already has the design in place. Inspected `platform/apps` — it contains only `api`
(a Fastify+tRPC backend). Zero pages/components/styling exist anywhere in `platform/`. The entire
UI (all pages, the design system, `network.ts`/`db.ts` data-access layer) lives in
`Design Bridge AI Interface (Copy)/`, which is also the source the live Cloudflare Pages prototype
deploys from (per the `prototype-deploy-mechanism` memory) and carries real LinkedIn-derived PII
(`prototype-now-tracked`). Today the prototype has two data paths: Google/Calendar goes through
platform's tRPC api (`api.ts` → `google.*`); everything else (people/communities/resources/lists)
reads Supabase directly from the browser with an embedded anon key, bypassing the api layer's
governance (Authority resolver, audit ledger, draft-then-approve pipeline) entirely.

**Decision:** Do not delete the prototype. Keep it as the real, actively-maintained frontend for
now. Defer the "real" fix — a frontend app under `platform/apps` that ports the design and routes
all reads/writes through the governed api layer — to a planned, separate initiative. It is not
started; no scaffolding exists yet.

**Rationale:** The premise behind the deletion request didn't hold (platform has no UI to fall
back to), so deleting the prototype would have deleted the only working frontend and the live
site's source with nothing to replace it — an irreversible, high-blast-radius mistake. The
end-state (frontend inside platform, fully governed) is the right direction and matches the
"governed agentic execution" principle in CLAUDE.md, but porting every page, adding the missing
tRPC procedures (people/communities/resources/lists don't exist server-side yet — only `google.*`
and `dealpilot.*` do), and verifying parity against the live prototype is a multi-day effort that
shouldn't be started opportunistically inside an unrelated bug-fixing pass.

**Alternatives rejected:** (1) Delete now, rebuild after — rejected, would break the live site
with no working replacement, not reversible casually. (2) Silently keep going without flagging the
security exposure — rejected; the client-side Supabase anon-key access to canonical PII is a real
standing risk that should be visible, not just implicitly accepted.

**Consequences / follow-ups:** Prototype continues to be the fix target for frontend issues in
this tracker (as it has been all session). The migration is now a tracked, not-yet-scoped roadmap
item (see Phase 4 / planned-but-never-built inventory) — needs a scoping pass (new tRPC procedures
inventory, page-by-page port list, parity test plan) before implementation starts, and should
happen as its own initiative with your explicit go-ahead given the live-site risk.

## 2026-07-05 — Make `commitEntity` idempotent + bounded whole-method retry on the Google intake dual-write

**Context:** `IntakeMaterializer.applyApproved` (`packages/integrations-google/src/intake.ts`)
performs a dual-write on proposal approval: cloud canonical `upsertPersonIdentity`, then local
`upsertPerson`, then per-entity `commitEntity`, then per-external-row `recordExternal`. If any
step after the first throws (network blip, local pglite hiccup), the write is left partially
applied. `upsertPersonIdentity`/`upsertPerson` (`ON CONFLICT ... DO UPDATE`) and `recordExternal`
(`ON CONFLICT ... DO NOTHING`) were already idempotent and safe to retry — but `commitEntity` was
not: pglite's version did a plain `INSERT` with no conflict clause (PK violation on retry), and
the in-memory version explicitly `throw`s on a duplicate id. Known-issues row: "Non-transactional
dual-write; fire-and-forget token refresh" (token-refresh half resolved 2026-07-04).

**Decision:** Made `commitEntity` idempotent in both `LocalGraphStore` backends —
`packages/local/src/stores/pglite.ts` now does `INSERT ... ON CONFLICT (id) DO NOTHING` (confirmed
`id` is `local_entities`'s declared PRIMARY KEY in `INIT_SQL`); `packages/local/src/stores/memory.ts`
now returns silently on a duplicate id instead of throwing, mirroring the file's existing
`recordExternal` dedup pattern (`hasExternal`-guarded push). With every dual-write step now
idempotent, added a small file-local `withRetry(label, attempts, delayMs, fn)` helper (a plain
`for` loop + `try/catch` + linear backoff, no new npm dependency) in `intake.ts` and wrapped the
entire body of `applyApproved` (extracted to a private `applyDirective`) in it — up to 3 attempts,
`console.error`-logged on each retry (matching `gateway-google.ts`'s existing logging style for
recoverable failures).

**Rationale:** Retry-the-whole-method-from-scratch is strictly simpler than fine-grained per-step
retry/compensation logic, and is now provably safe because every step it calls is idempotent by
construction — a second full pass either re-applies the same facts (no-op) or completes the
remaining steps. This also means a *future* retry-queue (mentioned in the original known-issues
row) can safely re-invoke `applyApproved` wholesale without new bookkeeping.

**Alternatives rejected:** Per-step retry with manual rollback/compensation on partial failure —
rejected as unnecessary complexity once idempotency is established at the store layer; a
generic retry/backoff npm dependency — rejected per the task's explicit constraint and because a
~15-line loop covers the need with no external surface to audit.

**Consequences / follow-ups:** `LocalGraphStore`/`CanonicalIdentityStore` port interfaces are
unchanged (implementation-only fix). Gmail sync's separate `hasExternal`-before-fetch double-propose
window (tracked as "9b" in `All fixes.md`) is a different bug and remains open. Tests added:
`packages/local/test/pglite.test.ts` (commitEntity double-call no-ops) + new
`packages/local/test/memory.test.ts`; new
`packages/integrations-google/test/materializer-retry.test.ts` (transient-then-succeed recovers
with no duplicate entity; persistent failure still surfaces after retries exhaust). Full monorepo
`turbo run build --force` + `turbo run test --force`: 28/28 packages green.

---

## 2026-07-05 — Drop the BusinessBroker.net licensed-feed build; route through the Claude-in-browser waterfall

**Context:** `businessbroker.net/robots.txt` disallows `/listings/` and every query-string URL —
DealPilot's `createBusinessBrokerNetConnector` has a real normalizer but no live fetcher. A
licensed/partner data feed would unblock a real connector, but that's a vendor/cost/legal
decision, not an engineering one, and there's no pilot fund yet whose deal flow depends on it.

**Decision:** Don't pursue the licensed feed for now. BusinessBroker.net stays a `Brokerage`
record (`data/brokerages.ts`, status `disconnected`) that routes through the existing
`ConnectAppFlow` waterfall's `claude_browser` step ("Claude in browser" — Claude drives an
actual browser session) the same way any no-API brokerage portal does. No new code needed —
this is the wizard's existing fallback for exactly this case.

**Rationale:** Zero build cost, no dead-end scraper code to maintain against a site that
actively blocks it, and the user isn't blocked on sourcing BusinessBroker.net listings — they
go through the same governed browser-driven flow as every other credential-gated brokerage.

**Alternatives rejected:** building/maintaining a scraper that violates robots.txt (legal risk,
fragile, explicitly rejected already); pausing on a licensed feed vendor search (no pilot fund
yet to justify the cost/lead time).

**Consequences / follow-ups:** `known-issues.md`'s BusinessBroker.net entry updated to point
here. If a pilot fund later needs BusinessBroker.net volume a scraper can't deliver, revisit a
licensed feed then, not speculatively now.

---

## 2026-07-04 — Generic manifest intake seam (@bridge/tool-kit), DealPilot wired first

**Context:** Wiring DealPilot's live API surface hit a real gap: its manifest declares
`intakePolicy.quarantine: true` (forced structurally, mirrors agent-floor), but no seam existed
for a manifest-composed external tool to quarantine sourced data through the pipeline and commit
it only on human "Add" — the exact gap already logged for Recon (staging.jsonl bypasses
governance entirely).

**Decision:** Added `createToolSourceSkill`/`ToolIntakeMaterializer`/`ToolCaptureStore` to
`@bridge/tool-kit` (generic, not DealPilot-specific): a tool registers a `<toolId>.source` Skill
that fetches via its `SourceConnector` and quarantines every `CaptureEnvelope` (light manifest
only, full payload stays in the store) — the skill runs inside `pipeline.propose()` as an
`external:fetch` action, so authority/policy/ledger audit apply exactly as for
`google.sourceGmail`. A separate `materializer.add(captureId)` is the human commit step (capture ≠
commit, same UX as Camera/Card Scanner). Wired DealPilot to it in `apps/api/src/wiring.ts` +
`router.ts` (`dealpilot.source`/`commit`/`list`), using the existing `createGmailFetchMessages`
composition (no new OAuth).

**Rationale:** Generalizing in `@bridge/tool-kit` (rather than a DealPilot-only helper) means
Recon's future migration reuses the exact same seam instead of a second bespoke one — directly
addresses the "Tool registry desync: 3 unlinked systems" known issue's root cause (manifests,
registry, and intake previously had no programmatic binding).

**Alternatives rejected:** An ungoverned `dealpilot.source` endpoint that fetches+commits in one
step — rejected; violates the manifest's own `quarantine: true` contract and the platform's
draft-then-approve principle for expedience. Building this only inside `@bridge/dealpilot` —
rejected; would not fix Recon's identical gap and duplicates work when Recon migrates.

**Consequences / follow-ups:** `dealpilot.list` uses a fixed empty thesis (no thesis-management
UI yet) and 1 capture = 1 candidate (dedupe-on-commit not wired into the API path yet, though
`company-sourcing.matchCompany` is available). Recon itself is NOT migrated onto this seam yet —
only the reusable piece exists. Prototype `/dealpilot` page still renders `dummy_` data, not this
API. 41/41 monorepo `turbo run typecheck test` tasks green; 9/9 tool-kit tests (7 existing + 2 new).

---

## 2026-07-04 — DealPilot P0 connectors: BizBuySell via Gmail compose (real); BusinessBroker.net scrape rejected (robots.txt)

**Context:** Phase 3 (tool-standardization-plan.md) shipped `@bridge/dealpilot`'s two P0 connectors
as proof-of-shape factories (`createBizBuySellAlertConnector`/`createBusinessBrokerNetConnector`)
with injected transport but no real parse/fetch logic. Asked to "wire the real connectors."

**Decision:** BizBuySell — implemented a real `parseBizBuySellAlert` (regex field extraction:
name/industry/geo/askPrice/revenue/sde/url, HTML-tolerant) plus `createGmailFetchMessages`, which
composes the existing governed `@bridge/integrations-google` `GoogleGatewayFactory.fetchThreads`
rather than the connector owning any OAuth/HTTP client. BusinessBroker.net — checked
`businessbroker.net/robots.txt` (2026-07-04): it Disallows `/listings/` and every query-string URL
(`/*?`), which covers exactly the search/listing endpoints a live connector needs; no RSS/sitemap
feed exists as a compliant fallback. Implemented only the real *normalization*
(`normalizeBusinessBrokerRow`, alias-tolerant field mapping + confidence heuristic) and left
`fetcher` as an injected seam — no live scraper was built.

**Rationale:** The architecture doc (`Tools/Job/DealPilot-Architecture.md` N5/§6) already commits
to "robots/rate policies enforced per domain"; BizBuySell's own docs describe the P0 source as a
saved-search *alert email*, not a scrape target (bizbuysell.com itself 403s unauthenticated
fetches — Akamai-fronted, matches the doc's proxy-tier note). Composing the existing Google
integration is strictly more correct than a bespoke Gmail client and keeps the "no tool-owned
OAuth" rule intact. For BusinessBroker.net, robots.txt is a clear compliance line — violating it to
satisfy a task ships a legal/reputational liability disguised as progress.

**Alternatives rejected:** Building a live scraper for BusinessBroker.net against its disallowed
paths — rejected outright (ToS/robots violation, no defensible business justification to override
it in this session). Giving BizBuySell connector its own Gmail OAuth client — rejected; violates
the plan's explicit "no tool-owned OAuth" rule and would duplicate the governed integration's
token lifecycle/consent surface.

**Consequences / follow-ups:** BizBuySell is now live end-to-end once a Google integration is
connected for the tenant (pass a real `GoogleGatewayFactory` + `integrationId` into
`createGmailFetchMessages`). BusinessBroker.net stays proof-shape until a licensed/partner data
feed exists — tracked in `docs/wiki/known-issues.md`. 19/19 dealpilot tests, 40/40 monorepo tasks
green (`turbo run typecheck test`).

---

## 2026-06-24 — Calendar render v1 = in-house (date-fns + Bridge tokens), not react-big-calendar

**Context:** The committed plan picked react-big-calendar (MIT) as the render engine behind a
`CalendarView` boundary. On building P0–P2, two facts shifted the call: (1) the user's explicit
follow-up — "I'll be modifying and customising it a lot and prefer a free modifiable version that
aligns with platform architecture"; (2) the prototype worktree has no `node_modules` and adding
react-big-calendar would require a new dependency install plus restyling its non-Tailwind CSS to the
Bridge design tokens.

**Decision:** Ship v1 of the Calendar surface as a **fully in-house** month/week/day/agenda renderer
built on **date-fns** (already a prototype dependency) + the Bridge design tokens, kept behind a small
view boundary (`CalendarPage` + view components). react-big-calendar remains the **documented swap-in**
if the in-house renderer's customization ceiling is ever hit — the projection + governed-write layers
don't change either way.

**Rationale:** date-fns is already present, so this adds **zero new dependency** and no install/network
risk in worktrees. An in-house renderer is maximally modifiable and design-system-native — exactly the
"free + modify a lot + aligns with platform architecture" the user asked for. The architectural
commitment that mattered (rendering is a swappable layer over an owned projection + governance) is
preserved; only the first adapter changed from a library to in-house code.

**Alternatives rejected:** **react-big-calendar now** — a new dep + CSS restyle burden + a fragile
install in a `node_modules`-less worktree, for a renderer the user intends to heavily customize anyway.
**Schedule-X / FullCalendar** — premium-gated lane views (cost), already rejected. **A headless calendar
lib** (CalendarCN/CalendarKit) — newer/unproven; date-fns hand-rolling is lower-risk and we own every line.

**Consequences / follow-ups:** The `docs/raw/calendar-plan.md` library pick is amended (render = in-house
v1; react-big-calendar = swap-in). Week/day use a simple greedy lane-packing for overlaps (good enough;
revisit if dense days need smarter packing). Recurrence stays deferred — Google expands recurring events
server-side (`singleEvents:true`), so ical.js isn't needed for the GCal-only scope.

---

## 2026-06-24 — Calendar = a projection Tool Bridge owns, not a calendar product/server

**Context:** The user wants an in-app calendar that aggregates Google Calendar (live today),
future conference/event integrations, and — as the platform matures — Rituals, Initiatives, and
Touchpoints, plus team/shared calendars and scheduling once workspaces/teams land. The brief asked
to research open-source options and justify build vs. integrate-on-top-of-OSS vs. custom.

**Decision:** Build a thin **Calendar Tool** Bridge owns, structured as **three layers with three
owners**: (1) **rendering** — adopt OSS behind a `CalendarView` port; (2) **RFC-5545 math**
(recurrence, DST/timezone, ICS parse+generate) — adopt small permissive libs behind
`RecurrenceEngine` / `IcsCodec` ports; (3) **system-of-record + governance** — BUILD on the existing
platform. The calendar is a **time-axis projection over the Unified Graph**: a read-time UNION into a
typed `CalendarEvent` output_contract over GCal `external_records` (already synced on the local plane),
Touchpoints with times, `ritual_runs`, Initiative timelines, and future conference/ICS adapters.
Sync reuses the existing `integrations` + `integration_sync_state` + `external_records` tables;
write-back routes through the Universal Action Pipeline as egress (external writes = `external:send`
= agent-floor DENY = human approval ≥ L2); team/shared calendars are RLS visibility-scoped filters,
not a new ACL system. **Library picks** (all permissive, free, forkable — the user will heavily
customize and will not pay): **react-big-calendar** (MIT, v1.20.0, maintained, drag/resize + built-in
resource columns), **ical.js** (MPL-2.0, recurrence + ICS in one lib), **ical-generator** (MIT, .ics
feed), **Luxon** (timezone). Packaged as a pinnable native Tool at `/calendar` with the manifest in
[calendar-plan.md](calendar-plan.md).

**Rationale:** Bridge's architecture already declares "Calendar = a stateless projection over the one
Touchpoint tree" ([../wiki/initiatives.md], [../wiki/schema.md]) and "new surfaces are Tools that
reuse the pipeline/ledger/contracts/gate — zero new subsystem" ([../wiki/tools.md]). Adopting a
calendar *system* would create a **second source of truth** competing with the graph + pipeline +
RLS + Authority resolver Bridge already owns and proved — the exact thing the platform-first design
exists to prevent. Rendering and recurrence math are solved, undifferentiated, and (recurrence
especially) a notorious bug factory — so adopt there. The projection + governance + pluggable-source
model is the moat — so build there. Putting the render engine behind a port makes the one risky pick
(react-big-calendar's customization ceiling) reversible: swap to headless or another lib without
touching projection/governance. The "new source = new adapter, surface unchanged" property is the
future-proofing the brief asked for.

**Alternatives rejected:**
- **Cal.com** (AGPLv3) — copyleft, banned by the OSS embed policy, and a full scheduling *product*
  that duplicates Bridge's governance. (cal.diy fork is MIT — kept as study-only for *deferred*
  scheduling, license to be re-verified when needed; 2026 signals are conflicting.)
- **CalDAV servers** Radicale / Baïkal (GPL-3.0), Nextcloud (AGPLv3) — copyleft + wrong architecture
  (running a calendar host with its own ACL/storage competes with the graph).
- **FullCalendar / Schedule-X premium** — the resource-timeline "team lane" views are paid commercial
  keys (not copyleft, but cost-averse per the tldraw-SDK precedent, and premium gating fights the
  user's heavy-customization intent). Their MIT standard bundles remain fallback options behind the
  same `CalendarView` port.
- **Hand-rolling recurrence/timezone** — rejected; RFC-5545 + DST + EXDATE is the #1 calendar
  correctness swamp. Adopt ical.js.
- **rrule.js** — the de-facto RRULE lib but last released 2022 (stale); ical.js covers recurrence
  *and* ICS in one dependency, so it wins.

**Consequences / follow-ups:** Commits to building a `CalendarEvent` typed contract + a read-time
projection, and to internalizing react-big-calendar as a forked copy (Tool-model "internal modified
copy") restyled to design-system tokens. Sequences after the local-gate slice + Initiatives P1.
Open: resource-lane view (free react-big-calendar columns vs custom build) decided at P4; whether the
Calendar gets its own agent or reuses the existing egress/intake agents (lean reuse). No code written
yet — P0 (contract + projection skeleton) is build-ready on the user's go.

---

## 2026-06-22 — Agents may never approve a proposal (Approvals are human-only)

**Context:** The Universal Action Pipeline already forces agents to draft
(`requiresApproval` returns true for any agent actor) and floor-denies agent
`external:send`. But `pipeline.decide()` — the act of *resolving* a pending proposal —
ran no authority check on the decider at all. It only checked the proposal was still
pending. So nothing structurally stopped an agent (or an agent-driven request) from
being the approver. The user asked, by analogy to gitignore hiding files from git, for
the Approvals surface to be inaccessible to in-platform agents (the agents users
configure in the Agent tab — not Claude developer agents): draft permission, never send,
and never approve.

**Decision:** Added an `approve` action to the core `Action` type and added it to the
non-removable agent-floor (`AGENT_FLOOR_MUTATIONS`), which already protects the `ledger`
resource. `pipeline.decide()` now takes a `decider: Actor` (resolved server-side) and
calls `agentFloorDeny(decider, "approve", "ledger")` before appending the decision row —
an agent decider is rejected; a human passes. The decider authorizes the call but is NOT
written into the decision row (the row still records the original proposing actor), so
append-only audit semantics and existing ledger assertions are unchanged.

**Rationale:** The floor is the right layer because it is the one rule no grant can
override — exactly the property "agents can never approve" needs. Using the floor (rather
than full `resolveAuthority` with deny-default) keeps humans as approvers by default
without forcing a new `ledger:approve` grant onto every human today; per-human approval
RBAC can layer on later via full authority resolution without reworking this.

**Alternatives rejected:**
- *Full `resolveAuthority(approve, ledger)` for the decider now* — would impose
  deny-default on humans, breaking every existing approve path until approval grants are
  seeded for all approvers. Deferred to a later RBAC pass (layered human roles).
- *Gate only in the UI (hide the Approvals button for agents)* — cosmetic; the API
  remained open. Rejected: the gate must be server-side.

**Consequences / follow-ups:**
- The decider is currently the **server-pinned pilot user** (see next entry), not yet a
  verified per-request identity — tracked in `docs/wiki/known-issues.md`.
- Denied approval *attempts* are not yet written to the ledger (decide throws before the
  append). Logged as a known issue; add an audited-rejection row in the auth-binding pass.
- Verified: `packages/core` 40/40 tests (new invariant "an agent may NEVER resolve a
  proposal" + unit `agentFloorDeny(agent,"approve","ledger")`), `integrations-google`
  3/3.

## 2026-06-22 — Server-resolve the request identity; stop trusting the client's actor

**Context:** `apps/api` established no session. The actor (`user` vs `agent`, the id, the
plane) arrived in the request body, so the deny-default gate was logically sound but the
*identity claim* feeding it was unverified — a crafted request could assert
`actor.type: "user"`. The user chose to build the identity binding now rather than defer.

**Decision:** Added `identity: Actor` to the API context, resolved **server-side**, and
made the Approvals path (`action.decide`) authorize against `ctx.identity` rather than any
client-supplied actor. First slice: identity is pinned to the single pilot user
(`wiring.pilotUserId`, overridable via `BRIDGE_PILOT_USER_ID`). The Supabase-JWT
verification seam (read bearer token → derive the real user) is the remaining work.

**Rationale:** Even pinned, a server-*chosen* decider closes the immediate hole for
approvals: the client can no longer claim to be a human approver. It is a strict
improvement deliverable in one slice, with the cryptographic verification layered on next
without changing the call sites that already read `ctx.identity`.

**Alternatives rejected:**
- *Defer all identity work* — the user explicitly chose to start now.
- *Add Supabase JWT verification in the same slice* — needs Supabase URL/JWT-secret env
  wired into the local-plane API (which today runs without `DATABASE_URL` by design) plus
  a verify dependency; sequenced as the next step to keep this change verifiable.

**Consequences / follow-ups:**
- `propose` still accepts the client actor for non-decide paths (ritual/tool/intake run
  as configured agents). Binding the *human* actor on propose, and constraining
  client-chosen agent actors, is part of the same auth task. Tracked in known-issues.

## 2026-06-22 — Hard-purge all dummy data from the platform (tests require live creds)

**Context:** The platform carried `dummy_`-prefixed data in three buckets: test fixtures,
the `FakeGoogleGateway` runtime fallback (used when no Google creds), and structural seed
constants (pilot workspace/agent/user UUIDs). The user directed: remove ALL dummy data;
retain only real data — the most literal reading, accepting that tests then require live
creds and there is no zero-infra dev fallback.

**Decision (planned, not yet executed):** Remove `FakeGoogleGateway` and the dummy_
fixtures; require the real `GoogleApiGateway` (no fake fallback in `wiring`); rename the
`DEMO_USER` pilot identity to a real pilot identity; convert or gate the tests that
depended on dummy fixtures so they require live creds (skip when absent) instead of
shipping fabricated data.

**Rationale:** User decision is explicit and is the strongest guarantee that nothing
fabricated can ever be mistaken for real data or surface to the UI/DB.

**Alternatives rejected (the options offered):**
- *Runtime-only purge* (keep test fixtures, make the fake opt-in) — not chosen.
- *UI-surface-only purge* — not chosen.

**Consequences / follow-ups:**
- CI/local dev cannot run the Google flows without live Google creds. The conformance
  suite that exercised the gate via the fake gateway must be re-expressed against either a
  live account or a non-dummy test double, or marked live-only.
- Structural UUIDs must be replaced with real pilot identities, not deleted (the system
  cannot run without an identity/workspace).

## ADR-006 — Full monorepo convergence + internal/external tool taxonomy (2026-07-03)

**Context:** Repo held 5 separate frontend apps (prototype SPA, recon, hni, card-scanner,
recorder) + platform/. Recon stranded (manifest + intake button wired to nothing, parallel
staging.jsonl governance); 3 unlinked tool-registration systems; Helpdesk living as prototype
pages (predates tool model — no slot for UI-surface tools). Two new tools specced (JobPilot,
DealPilot — specs ingested to docs/raw as requirement docs) each proposing their OWN full stack,
which would create apps #6/#7 and re-implement sourcing/dedupe/enrichment/tables a 5th time.

**Decision (user-locked):** (a) Grow `platform/` into the SINGLE monorepo home — apps/web +
apps/api + packages (tool-kit, tables, sourcing, dedupe, facts, llm, extraction) + tools/*;
no new code outside it. (b) Tool taxonomy: **internal tools** = headless capabilities
(people-sourcing, company-sourcing, enrichment, recorder, …) vs **external tools** = UI surfaces
(Helpdesk, DealPilot, JobPilot, Conference…) that declare `composes:[internal ids]`.
(c) Recon splits into people-sourcing + company-sourcing internal tools; staging.jsonl retired
through the one intake seam. (d) Integrations are platform-level only — tools never own OAuth;
capability grants via the Authority resolver. (e) Build order: engine → internal tools →
**DealPilot first** → JobPilot + Helpdesk migration → absorb prototype.

**Rationale:** One unified engine that strengthens with use; every duplicated capability
(waterfall sourcing ×5, tables ×4, review queues ×3) becomes one package with one test surface;
governance stays single-spine (all tool approvals = pipeline proposals).

**Alternatives rejected:** shared-packages-but-keep-apps (duplication of app shells remains,
integration still per-app); unify-new-tools-only (recon/hni/helpdesk debt persists and taxonomy
stays split). Building JobPilot/DealPilot per their standalone architecture docs (FastAPI+SQLite;
Next.js+Supabase+Trigger.dev) rejected — deviations recorded in the plan: Hatchet/BullMQ over
Trigger.dev, local plane over SQLite, pipeline over bespoke review queues, Python only as
sidecars behind ports.

**Consequences:** migration phases 0–5 in raw/tool-standardization-plan.md; prototype folder
eventually retires; Tools/* standalone apps frozen then deleted post-extraction; short-term
overhead maintaining the prototype bridge inside apps/web during migration.
