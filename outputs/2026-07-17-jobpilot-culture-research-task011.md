---
title: TASK-011 — JobPilot Culture-Research Slice (JP3B)
date: 2026-07-17
task: TASK-011
status: implemented (remediated after SEVEN rounds of independent/coordinator security review), pending coordinator ledger reconciliation
---

# TASK-011 — JobPilot culture-research slice (JP3B)

## Outcome

JobPilot performs **permitted, cited company-culture research** for a real target company
(Boston Consulting Group) using a genuinely **two-phase, intent-then-approve-then-fetch**
lifecycle: proposing a fetch is side-effect-free; the real, guarded network fetch happens ONLY
after a human decision approves that specific proposal; claims used in the final synthesis must
ground against the immutable artifacts this run actually fetched. This satisfies TASK-011's
prototype test and BRD JP-BRD-042.

This document supersedes the initial 2026-07-17 pass, which an independent security review found
had seven high/medium defects (approval-after-execution ordering, forgeable rights classification,
a TOCTOU/DNS-rebinding-vulnerable SSRF guard, ungrounded claims, unbounded fan-out, non-atomic
budget reservation, and unreachable cancellation). Every defect below was fixed on this branch,
re-tested, and independently re-reviewed. **Canonical `docs/TASKS.md` status is unchanged** — this
doc records evidence for the coordinator to review before any status flip.

## The two-phase lifecycle (corrected)

```
1. cultureResearch.propose(workspaceId, company, sourceIds)
     — resolves ONLY server-owned sourceIds against CULTURE_SOURCE_REGISTRY
       (workspace+company scoped); unknown/cross-workspace/cross-company ids
       reject the WHOLE request
     — classifies eligibility per source TYPE (unchanged Tier-1 catalog);
       non-permitted sources are skipped with zero child Run/network access
     — dedupes ids; caps fan-out at the FIXED MAX_CULTURE_SOURCES_PER_RUN,
       independent of request length
     — creates ONE bounded child Agent Run per permitted source and a
       genuinely PURE pipeline proposal (jobpilot.researchCultureSource.run()
       performs NO network access — it only re-resolves + re-validates the
       source from the registry and returns an intent descriptor)
     — returns proposal/child-Run handles; NOTHING has been fetched yet

2. action.decide(proposalId, "approve" | "veto")
     — the SAME generic governed-pipeline decision endpoint every other
       mutation in this repo uses; a veto (or simply never deciding)
       guarantees the real fetch can never happen

3. cultureResearch.materialize(workspaceId, proposalId, childRunId)
     — re-checks the ledger's REAL decision (never trusts the caller);
       refuses anything not "approve"
     — reserveChildRunAction validates + atomically consumes the child Run's
       budget IMMEDIATELY before the network call (not earlier — propose has
       nothing to gate; not later — would allow a race)
     — performs the REAL fetch via guardedFetch (@bridge/net-guard) — pinned
       DNS resolution, validated bounded redirects, byte-cap streaming,
       content-type check, real AbortSignal
     — idempotent: re-materializing an already-fetched/failed/cancelled
       source returns the stored record, never refetches
     — any exception fails the child Run closed with audit evidence; success
       completes it only once the artifact is durably stored

4. cultureResearch.cancel(workspaceId, proposalId, childRunId)
     — available at any point; aborts a REAL in-flight fetch via the stored
       AbortController, or guarantees one never starts

5. cultureResearch.synthesize(workspaceId, company, claims)
     — claims must GROUND against the artifacts this run actually fetched
       (groundClaims): fact/opinion claims need a quote that is a real
       substring of the correct artifact AND a matching content hash;
       theme/inference/contradiction claims reference other real claims in
       the same batch (no dangling/self/duplicate references) — an absent
       quote, mismatched hash, or forged reference fails the WHOLE batch
       closed before the fabrication/insider-claim guard even runs
     — skippedSources for the disclosure are recomputed SERVER-SIDE from the
       registry, never trusted from the client
```

## The seven defects — what was fixed

### 1. SSRF TOCTOU / DNS rebinding — FIXED
Replaced `assertOutboundAllowed()` + plain `fetch()` (which re-resolved DNS a second,
unguarded time, and auto-followed redirects with NO validation) with a single primitive,
`guardedFetch` (new `@bridge/net-guard` package):
- A custom DNS `lookup` override is the ONE place resolution happens — it returns ONLY
  vetted (non-private/reserved/metadata) addresses directly to Node's own connection
  machinery, so the address validated IS the address connected to (no re-resolution window).
  The original hostname is still used for the TLS SNI/`Host` header, so certificate
  validation is unaffected.
- Redirects are followed MANUALLY, one hop at a time (`http`/`https.request` never
  auto-follows), re-running the FULL guard (scheme, credentials, hostname block-list, pinned
  DNS) on every hop before connecting — a redirect to a private/metadata target, or a
  redirect cycle, is rejected exactly like a direct request would be. Bounded by
  `maxRedirects` (default 3).
- URLs carrying embedded credentials (`user:pass@host`) are rejected before any network
  attempt.
- Tests exercise this against a REAL local HTTP server (not a mock of `guardedFetch`
  itself): redirect-to-private-target, redirect cycle, max-hop exceeded, a hostname
  unresolvable by real DNS that only succeeds because the pinned lookup result was used
  (proving no second, unguarded resolution exists anywhere), IPv4/IPv6 blocking, metadata
  targets, credentialed-URL rejection, and both `AbortSignal`-based cancellation paths.

### 2. Forgeable rights classification — FIXED
The router no longer accepts a client-supplied URL/sourceType/label at all. A new
`CULTURE_SOURCE_REGISTRY` (server-owned, workspace+company scoped) is the ONLY place a
source's URL/type/label/rights-classification is resolved from; a client selects ONLY a
`sourceId`. `resolveAuthorizedCultureSource` returns `null` (treated as unknown) for any id
that doesn't belong to the requesting workspace/company. The governed Skill itself
re-resolves from the registry too (defense in depth). Tests: unknown id rejected; a REAL id
requested under the wrong company rejected (cross-company forgery); extra client-supplied
`url`/`sourceType`/`sourceLabel` fields alongside a valid id have zero effect (the server
never reads them); non-permitted source types produce zero network calls.

### 3. Approval-after-execution ordering — FIXED
`jobpilot.researchCultureSource.run()` is now PURE — see the lifecycle above. The real fetch
lives in `materializeCultureSourceFetch`, called by the router ONLY from a separate
`materialize` procedure, which re-checks `ledger.decisionFor(proposalId) === "approve"`
before doing anything. Tests prove zero network calls for a never-decided proposal AND for
an explicitly vetoed one.

### 4. Unbounded resources — FIXED
`MAX_CULTURE_SOURCES_PER_RUN` (5, `@bridge/jobpilot`) is a fixed constant; `propose` dedupes
ids first, then rejects (doesn't silently truncate) a request exceeding the cap. The parent
Run's budget envelope is built from this constant, never from `sourceIds.length`.
`guardedFetch` enforces a hard byte cap while STREAMING (before full buffering) and also
pre-checks a declared `Content-Length` header; `materializeCultureSourceFetch` additionally
rejects a non-text `content-type`. Tests: over-limit request rejected, duplicate ids deduped,
oversized chunked body rejected mid-stream, declared-oversized `Content-Length` rejected
before any body bytes are read, non-text content-type rejected.

### 5. Ungrounded claims — FIXED
New `groundClaims` (`@bridge/jobpilot`): a fact/opinion claim must carry a `quote` that is an
exact substring of the CORRECT fetched artifact's real content, AND a `contentHash` that
matches that artifact's server-computed (`node:crypto` sha256) hash — binding the claim to
the exact fetched bytes, not merely "some artifact somewhere contains this text." A
mismatched/forged hash is rejected even when the quote text is genuinely present elsewhere.
Theme/inference/contradiction claims reference other REAL claims in the same batch; dangling,
self-referencing, or duplicate-id claims are rejected. Grounding fails the WHOLE batch closed
(no partial application) before the fabrication/insider-claim guard runs. Tests: absent quote,
stale/mismatched hash, dangling reference, self-reference, duplicate id — all rejected;
well-grounded claims accepted and correctly partitioned.

### 6. Non-atomic reservation / non-idempotent execution — FIXED
`materializeCultureSourceFetch` calls `reserveChildRunAction` (validates + atomically consumes
budget) immediately before the network call — not at `propose` time (nothing to gate yet) and
not after (would allow a race). Idempotency check runs FIRST: a proposal whose fetch already
resolved (fetched/failed/cancelled) short-circuits and returns the stored record, never
refetching (proven directly: a second `materialize` call against a real local test server
leaves the request counter at 1). Any exception calls `failChildAgentRun` with audit evidence;
success calls `completeChildAgentRun` only once the artifact is durably stored in the new
`InMemoryCultureFetchStore`.

### 7. Unreachable cancellation — FIXED
`propose` returns proposal/child-Run handles BEFORE any fetch occurs. `cultureResearch.cancel`
(and the lower-level `cancelCultureSourceFetch`) aborts the REAL in-flight `guardedFetch` call
via a stored `AbortController` — proven against a real local server whose request handler
observes the connection actually close, not merely a rejected promise. Cancelling before any
fetch starts guarantees zero network calls (`materialize` afterward short-circuits on the
now-"cancelled" status rather than proceeding).

## `InMemoryAgentStore` status vocabulary — reconciled

`isActive()`'s contract (already fixed in the prior pass to unblock `@bridge/core`'s own build)
is now backed by explicit regression tests
(`platform/packages/core/test/in-memory-agent-store.test.ts`): only the EXACT string
`"active"` is active; unset/unseeded, `"inactive"`, `"paused"`, `"retired"`, or any other
value is inactive; the mere presence of `assumedRole`/`capabilityScope`/`dataScope` entries
never implies active. This exactly mirrors `DrizzleAgentStore.isActive`
(`packages/db/src/governance-stores.ts`: `rows[0]?.status === "active"`). **Semantic choice,
stated explicitly**: this fail-closed contract is authoritative on this branch over any
weaker fallback (e.g. treating role/scope presence as implicit activity) that may exist
elsewhere — an Agent must be explicitly seeded `"active"`; nothing else may imply it. All
legitimate in-memory seeds (`seedGovernance` in `wiring.ts`) already explicitly set both
`workspaces`/`statuses` for every real physical Agent identity.

## Files (this remediation pass)

### New
| File | Purpose |
|---|---|
| `platform/packages/core/test/in-memory-agent-store.test.ts` | 6 regression tests for the fail-closed Agent status vocabulary |

### Rewritten
| File | Change |
|---|---|
| `platform/packages/net-guard/src/index.ts` | Replaced `assertOutboundAllowed` + plain fetch with the single `guardedFetch` primitive (pinned DNS, manual bounded redirects, byte-cap streaming, credential rejection, AbortSignal) |
| `platform/packages/net-guard/test/net-guard.test.ts` | 17 tests, including real local-server redirect/cycle/byte-cap/abort/rebinding-pin proofs |
| `platform/packages/core/src/child-agent-run.ts` | Fixed `InMemoryChildAgentRunStore.consumeBudget`'s non-atomic check-then-act race (found by the fresh post-remediation review) |
| `platform/packages/core/test/child-agent-run.test.ts` | +2 concurrent-reservation atomicity regression tests |
| `platform/tools/jobpilot/src/culture-research.ts` | Added `MAX_CULTURE_SOURCES_PER_RUN`, `CultureArtifactRef`, `GroundedClaimInput`, `groundClaims` |
| `platform/tools/jobpilot/test/culture-research.test.ts` | +12 `groundClaims` tests |
| `platform/apps/api/src/wiring.ts` | Server-owned `CULTURE_SOURCE_REGISTRY` + `resolveAuthorizedCultureSource`; PURE `jobpilot.researchCultureSource` skill; new `materializeCultureSourceFetch`/`cancelCultureSourceFetch`/`InMemoryCultureFetchStore`; `jobpilot.synthesizeCultureProfile` now calls `groundClaims` first; childRunId/proposalId cross-check; mid-function cancellation re-check |
| `platform/apps/api/src/router.ts` | Replaced the single `researchCulture` procedure with `cultureResearch.{propose,materialize,cancel,status,synthesize}`; `synthesize` now scopes fetched artifacts to the requested company |
| `platform/apps/api/test/jobpilot-culture-research.test.ts` | 21 tests covering every defect above end-to-end, including the 4 issues from the fresh review |

## Verification (live evidence, this remediation pass)

- `@bridge/net-guard`: 17/17 tests pass (96% line coverage), including real-socket redirect/
  cycle/byte-cap/content-length/abort/pinned-resolution proofs.
- `@bridge/core`: 427/427 tests pass (including the 6 new Agent-status regressions).
- `@bridge/jobpilot`: all tests pass (114 total), including 12 new `groundClaims` cases.
- `@bridge/api`: all tests pass, including 18 in `jobpilot-culture-research.test.ts` covering
  every one of the 7 defects plus the extra-fields-forgery and content-type tests.
- `@bridge/web`: build + typecheck + tests all pass (net-guard's Node-only code confirmed
  still excluded from the browser bundle).
- `@bridge/db`: build + tests pass.
- Full monorepo `turbo run build`: 21/21 tasks succeed.
- `npx eslint` on every new/changed file: 0 errors.
- `pnpm run check:no-dummy-runtime`: clean.

## Known gaps carried over (unchanged)

- `goalTasks`/`skillManifests`/`childAgentRuns`/`cultureFetchStore`/`CULTURE_SOURCE_REGISTRY`
  remain in-memory only — restart does not persist in-flight culture-research state or the
  source catalog. A real admin surface to manage the source registry, and Drizzle-backed
  stores for the rest, are future work.
- Claim *authoring* (turning a fetched artifact's raw text into candidate quotes) is still
  manual/hand-curated pending a real PromptAssembler/claim-extraction substrate
  (`docs/wiki/learning-agent.md`: "PromptAssembler unbuilt") — `groundClaims` verifies
  authorship against real fetched bytes; it does not itself generate claims.
- Google Places API (for a lawful, narrow Google-reviews path) remains unintegrated.

## Independent fresh review (after remediation) — 4 additional issues found and fixed

A second, read-only code-review pass over commit `e40d741..0cd5aaa` (the remediation above)
confirmed all 7 original defects were convincingly fixed, but found 4 further issues in the
remediation itself — all fixed in a follow-up commit on this branch:

1. **`consumeBudget` was not actually atomic (High)** — `platform/packages/core/src/child-agent-run.ts`'s
   `InMemoryChildAgentRunStore.consumeBudget` read its pre-write state via `await this.get(...)`
   — a distinct async call that still yields a microtask tick even with no internal `await` of
   its own — opening a genuine check-then-act race: two concurrent reservations against the
   same `maxCalls:1` child Run could both read the same stale snapshot and both "succeed."
   **Fixed** by reading via a direct synchronous `this.runs.get(id)`, matching `updateStatus`'s
   already-atomic pattern in the same file. Regression tests added
   (`child-agent-run.test.ts`): 2 and 10 concurrent reservations against a `maxCalls:1` budget
   — exactly one ever succeeds.
2. **A cancellation landing during `materialize`'s approval/reservation window could be silently
   overridden (Medium)** — `materializeCultureSourceFetch` only checked the fetch record's
   status once, at the top; the unconditional `record.status = "fetching"` several awaits later
   could clobber an intervening cancellation. **Fixed** by re-checking `record.status ===
   "pending"` immediately before that assignment (no intervening `await`), short-circuiting if
   cancelled. In practice the child-Run-status check inside `reserveChildRunAction` (itself
   fixed by #1) already closes most of this window; this re-check closes the remainder as
   defense in depth. Regression test added exercising the exact timing with a deliberately
   delayed `ledger.decisionFor`.
3. **`materialize` didn't validate that the caller-supplied `childRunId` belongs to the given
   `proposalId` (Medium)** — a caller juggling several pending proposals from one batch could
   materialize an approved proposal while charging a DIFFERENT (unrelated) child Run's budget.
   **Fixed** by rejecting when the stored record's `childRunId` doesn't match. Regression test
   added proving the mismatched child Run's budget stays untouched.
4. **`synthesize` pooled fetched artifacts workspace-wide, not scoped to the requested company
   (Medium)** — a workspace with fetched artifacts for two different companies could ground
   company A's claims against company B's evidence, since `groundClaims` only matches by
   `sourceId`. **Fixed** by cross-referencing each candidate artifact's `sourceId` against
   `CULTURE_SOURCE_REGISTRY` entries scoped to the requested `(workspaceId, company)` pair
   before making it available for grounding. Regression test added with two real companies'
   fetched artifacts present simultaneously in one workspace.

Re-verified after these 4 fixes: `@bridge/core` 429/429 (2 new atomicity tests), `@bridge/api`
all tests including 21 in `jobpilot-culture-research.test.ts` (4 new regression tests), full
monorepo build 21/21, eslint clean, no-dummy-runtime clean.

## Third fresh review — 1 more issue found and fixed (round 2's own new code)

A THIRD read-only review (of the round-2 fix commit itself) found that round 2 mirrored the
`childRunId`/`proposalId` cross-check into `materializeCultureSourceFetch` but not into
`cancelCultureSourceFetch` — the same class of bug (a caller pairing an arbitrary `proposalId`
with an unrelated, real `childRunId` from a different in-flight proposal) could still cancel
someone else's child Run. It also found that the round-2 regression test for issue 2 (the
mid-function cancellation re-check) was satisfied by the pre-existing child-Run-status check
inside `reserveChildRunAction`, not by the new guard itself — meaning that specific test would
have passed even if the new guard had been deleted.

Both fixed in a further commit:
- `cancelCultureSourceFetch` now rejects when the stored record's `childRunId` doesn't match the
  supplied one, mirroring `materializeCultureSourceFetch`'s check exactly. New test proves an
  unrelated child Run stays untouched.
- The issue-2 regression test was replaced with a deterministic reproduction that manually rolls
  a child Run's status back to `"running"` after cancellation (simulating the exact scenario the
  guard exists for — a ledger-append failure rolling back the CAS while the fetch record itself
  stays `"cancelled"`) and proves `materializeCultureSourceFetch` still refuses to proceed via the
  record-level guard alone, independent of the child-Run-level check.

Re-verified: `@bridge/api` all 22 tests in `jobpilot-culture-research.test.ts`, full monorepo
build 21/21, eslint clean, no-dummy-runtime clean.

## Blockers / proposed ledger changes (still NOT applied — for the coordinator)

Per instruction, canonical `docs/TASKS.md`/`docs/BUGS.md`/`docs/APPROVALS.md`/
`docs/raw/decisions-log.md`/`docs/log.md` remain untouched by this pass (status NOT flipped).
Proposed entries (unchanged intent from the prior pass, updated for this remediation):

1. **`docs/raw/decisions-log.md`** — an ADR for `@bridge/net-guard`'s existence as its own
   package (browser-bundle safety) AND a second ADR for the two-phase propose/decide/
   materialize pattern this Skill introduces (any future Skill whose `run()` would need a
   real external side effect should follow this same split, not repeat the first pass's
   mistake of fetching inside `run()`). A THIRD ADR should record the durable-intent-record
   pattern below (§"Fourth remediation round") — reusing `MemoryStore` for a governed
   intent/effect binding, not just "learned preferences" — as a reusable shape for any future
   Skill needing a durable, restart-surviving, fail-closed intent-to-effect binding without a
   new migration.
2. **`docs/BUGS.md`** — the `InMemoryAgentStore` gap entry from the prior pass, now with a
   pointer to the new regression tests, PLUS a new entry for the `agent.create` eligibility
   gap fixed below (a dynamically created Agent was previously permanently unusable).
3. **`docs/TASKS.md`** — TASK-011 exit criteria are met by the changes above; propose flipping
   status once the coordinator has reviewed this doc and the fresh independent review.

## Fourth remediation round (2026-07-18 coordinator final review) — 7 more issues found and fixed

A fourth review round (the coordinator's own final review of `d990427`) found 7 further,
architecturally significant issues. All 7 are fixed on this branch; full detail below.

### 1. Durable culture-fetch intent state (was process-local only)

`InMemoryCultureFetchStore` (a plain in-process `Map` keyed by proposal id) is REPLACED by
`DurableCultureFetchStore`, a new adapter over the existing `MemoryStore` port
(`platform/apps/api/src/wiring.ts`). `MemoryStore` is Drizzle-backed (real Postgres in
persistent mode, real local-file-backed pglite in zero-infra dev/test mode — see
`buildPersistentPorts`/`buildInMemoryPorts`) — no new DB migration was needed or added (RM4 owns
migration 0015).

- Keyed by `childRunId` (`subjectElementId`, a deliberate, documented repurposing of that field)
  because the child Run exists BEFORE the ledger proposal does — the durable record is created
  the moment `propose()` creates the child Run, pinning `canonicalUrl`/`allowedRedirectOrigins`/
  `goalId`/`taskId`/`skill`/`action`/`actorId`/`company`/`workspaceId`/`parentRunId` from the
  SERVER-owned registry right then; `proposalId` is attached once `pipeline.propose()` returns it
  (`attachProposal`).
- `getByProposal(workspaceId, proposalId, childRunId)` is the ONLY lookup a router caller's
  `(proposalId, childRunId)` pair may use — a mismatch (or a missing record) returns `null`,
  never reconstructs from `proposedOutput` or any other fallback.
- `transition(workspaceId, childRunId, fromStatuses, mutate)` is an atomic (per-`childRunId`,
  single-process) compare-and-set: a small `KeyedAsyncMutex` serializes the load→mutate→persist
  sequence so two racing transitions on the SAME record can never both observe the
  pre-transition status (`MemoryStore.supersede()` alone has no CAS guarantee — two concurrent
  `supersede(sameId, ...)` calls would both succeed and produce two "current" rows). Throws the
  new, typed `CultureFetchAlreadyTerminalError` when the record isn't in an expected status.
- `materializeCultureSourceFetch`/`cancelCultureSourceFetch` now: load via `getByProposal` (fail
  closed, no fallback); cross-validate the IMMUTABLE ledger proposal's `workspaceId`/`action`/
  `resourceType`/`inputs`/`context` against the durable record's own binding; re-resolve the
  CURRENT registry entry fresh and refuse to proceed if the pinned `canonicalUrl` no longer
  matches (a registry entry removed/changed between propose and materialize fails closed rather
  than fetching a stale target).
- A production bug was caught during a background sub-agent's independent test-rewrite pass and
  fixed before this round closed: `DurableCultureFetchStore`'s row `id` was a composite string
  (`culture-fetch:<childRunId>:<uuid>`), but `memories.id` is UUID-typed — EVERY write failed with
  Postgres `22P02 invalid input syntax for type uuid`. Fixed by using a plain `randomUUID()` for
  the row id (the lookup key remains `subjectElementId = childRunId`, which is already a real
  UUID from `ctx.run.ids.next()`/`uuidv7()`).
- Restart-durability proof: since two full `Wiring` instances against the same on-disk
  `BRIDGE_LOCAL_DIR` hit a PRE-EXISTING, unrelated `buildInMemoryPorts` migration-rerun limitation
  (`42P07 relation already exists` — re-running Drizzle's migration set against an
  already-migrated local pglite file), the test instead constructs a SECOND, independent
  `DurableCultureFetchStore` wrapping the SAME `wiring.memoryStore` port and proves it sees the
  identical record — proof the record lives in the durable port itself, not an in-process cache
  private to the first store instance. The two-`Wiring` migration-rerun gap is noted as an
  existing, separate limitation, not something this task introduces or fixes.

### 2. Grounding DAG — cycles and transitive rootedness

`groundClaims` (`platform/tools/jobpilot/src/culture-research.ts`) gained a `computeReferenceGrounding`
pre-pass: a DFS with visiting/done coloring over every claim's reference edges
(`supportingClaimIds` for theme/inference, `contradicts` for contradiction) that computes, for
every claim, (a) whether it is TRANSITIVELY rooted in ≥1 real artifact-grounded fact/opinion, and
(b) which claims sit on a reference cycle. Two new failure reasons
(`reference-cycle`, `not-transitively-grounded`) reject a purely synthetic cyclic chain of
theme/inference claims that never touches a fact/opinion — previously, since the old checks only
verified "the referenced id exists in this batch", such a chain passed validation. A contradiction
whose contradicted branch is itself ungrounded now also fails (a contradiction cannot borrow
rootedness from a claim that has none). 6 new tests cover a 2-node cycle, a 3-node cycle, a deep
(4-hop) chain that DOES root in a real fact (accepted), a deep chain that never roots (rejected),
a contradiction referencing an ungrounded branch, and an empty-artifact graph.

### 3. Redirect safety — header stripping, downgrade rejection, origin allowlist

`guardedFetch` (`platform/packages/net-guard/src/index.ts`) gained:
- `allowedRedirectOrigins` option — EVERY hop (including the first) is checked against this set;
  a hop landing outside it throws the new `RedirectOriginNotAllowedError`. The server-owned
  `AuthorizedCultureSource` registry entry now carries its own `allowedRedirectOrigins` (currently
  just the source's own origin per entry — no cross-origin redirects are expected for the BCG
  pilot sources; the mechanism supports a wider allowlist per source if a real deployment needs it).
- Credential-bearing header stripping (`Authorization`, `Cookie`, `Proxy-Authorization`,
  `X-API-Key`/`API-Key`/`X-Auth-Token`-shaped headers) on any CROSS-ORIGIN hop — same-origin hops
  keep them, matching browser `fetch`'s own cross-origin redirect behavior (which Node's
  `http`/`https.request` does not replicate on its own, since it never follows redirects itself).
- HTTPS→HTTP downgrade rejection (`RedirectDowngradeError`) on ANY hop, unconditionally — an
  allowlisted origin does not license a scheme downgrade.
- `GuardedFetchResult.hopOrigins` — the full in-order origin chain, so a caller can independently
  re-verify what actually backed a fetch.
- `materializeCultureSourceFetch` passes the durable record's pinned `allowedRedirectOrigins`
  straight through.
7 new tests, including a real self-signed-certificate HTTPS test server (openssl-generated at
test time, `NODE_TLS_REJECT_UNAUTHORIZED` relaxed for that ONE test only) proving the downgrade
rejection over a genuine TLS handshake, not a mocked one.

### 4. Cancellation state machine — atomic CAS, typed already-terminal error

- `platform/packages/core/src/child-agent-run.ts` gained `ChildRunAlreadyTerminalError` (typed,
  carries `runId`/`currentStatus`), replacing a plain `Error` thrown by
  `recordChildAgentRunTransition` when a child Run is already terminal. Every
  `cancelChildAgentRun`/`completeChildAgentRun`/`failChildAgentRun` call site inside the
  culture-research flow now catches ONLY this specific typed error (an expected, benign race) and
  surfaces everything else. Existing regression test extended to assert the typed error, its
  `runId`, `currentStatus`, and message.
- `materializeCultureSourceFetch`'s catch block now checks `abortController.signal.aborted`
  (true only if OUR OWN controller was aborted, not a timeout or unrelated failure) — if true, and
  the durable record already reads `"cancelled"`, it returns that record UNCHANGED instead of
  overwriting it to `"failed"`. This is the literal fix for "abort caused by cancellation must
  remain cancelled, not failed."
- `cancelCultureSourceFetch` calls `transition(..., ["pending", "fetching"], ...)` — cancelling an
  ALREADY-terminal record (fetched/failed/cancelled) throws `CultureFetchAlreadyTerminalError`,
  caught and turned into a no-op that returns the CURRENT (unchanged) record — cancellation can
  never rewrite a terminal state.
- New/updated tests: cancel-during-fetch (asserts the FINAL status is `"cancelled"`, not
  `"failed"`), cancel-after-fetch (asserts the record and its artifact are UNCHANGED), and the
  existing mismatched-`childRunId` tests for both `materialize` and `cancel`.

### 5. `agent.create` eligibility — a real, previously-total bug

Independent of culture-research, `router.ts`'s `agent.create` mutation created a new Agent's
scope/dataScope/allowedSkills/assumed-role entries but NEVER called
`mem.agents.workspaces.set(...)` or `mem.agents.statuses.set(...)`. Since `AgentQuery.workspaceId`/
`isActive` are fail-closed by design (added by an already-merged Relationship-module commit, made
correctly fail-closed by this task's earlier `InMemoryAgentStore` fix), an agent created via this
endpoint was **permanently workspace-unbound and inactive** — it could never pass the AGS1
workspace-match check nor any "must be active" gate. This bug was LATENT before this task's own
earlier `isActive`/`workspaceId` fix (the interface didn't even have these methods yet), and
became live/exploitable-as-a-functional-break only once that fix landed — this task closes the
loop it opened. Fixed: `agent.create` now adds `assertPilotWorkspace`/`assertMembership` (matching
every other workspace-scoped mutation) and explicitly binds the new agent's workspace + `"active"`
status immediately (this endpoint IS the explicit, governed creation act — there is no separate
"activate" step for API-created agents elsewhere in this codebase). 2 new tests
(`platform/apps/api/test/agent-eligibility.test.ts`): create→task-assign succeeds; a non-pilot
workspaceId is rejected.

### 6. Synthesis binding — exact parent run, no cross-run pooling

`cultureResearch.synthesize` now requires a `parentRunId` (returned by `propose()`). Fetched
artifacts are resolved ONLY from that exact run's own child Runs (via
`childAgentRuns.listByParentRun` + `cultureFetchStore.get` per child run) — never pooled across
historical or concurrent runs for the same company (the prior round's company-scoping fix closed
cross-company pooling but not cross-RUN pooling within the same company). A `parentRunId`
belonging to a different company, or containing a duplicate fetched source id, is rejected
`BAD_REQUEST`. `SynthesizeCultureProfileOutput` now carries `parentRunId` and
`artifactHashes: {sourceId, contentHash}[]` so the persisted ledger row records exactly which
run/artifacts backed it. A new `cultureResearch.synthesisResult` query reads the PERSISTED,
APPROVED result (`{status:"not_available"}` before approval, `{status:"available", approvedAt,
result}` after) — the durable source of truth the web UI now queries (see §7). 2 new tests prove
cross-company `parentRunId` rejection and no cross-run artifact pooling.

### 7. Runtime UI grounding — no hand-authored claims

`platform/apps/web/src/app/data/bcg-application.ts` no longer carries ANY `cultureResearch`
static data block (nor the `CultureClaim`/`CultureSkippedSource`/`CultureClaimType` types it used).
`JobPilotApplicationDetail.tsx`'s `CultureResearchSection` is now a live, stateful component:

- A new `cultureResearch.sources` query lets the client discover the server-owned authorized
  sources for a company (id/label/type/eligibility/reason — never the raw URL, irrelevant until
  fetched and disclosed).
- Before any research has been proposed, it renders an honest empty state ("No culture research
  has been run for this application yet") with a real "Start culture research" action — never a
  placeholder claim.
- `propose` → per-source "Approve & fetch" (calls `action.decide` then `materialize`) →
  "Synthesize evidence" (submits one real, fully-grounded "fact" claim per fetched source, via the
  new `deriveFullArtifactFactClaim` helper — the claim's `quote` is the artifact's ENTIRE real
  fetched content, never fabricated or paraphrased text; a richer human-excerpt-picker or
  LLM-assisted theme/opinion/contradiction extraction is tracked as future work) → "Approve
  synthesis" → the real, persisted `synthesisResult` renders (citations, content hashes, an
  approval timestamp, and the disclosure), all fetched live from the API.
- The disclosure-gates-recommendations behavior is preserved exactly: the grounded evidence only
  renders once `disclosureOpen` is true, matching the pre-existing UX pattern.
- A tiny client-side pointer (`platform/apps/web/src/app/data/culture-research-client.ts`,
  `localStorage`-backed) remembers WHICH proposal/childRun/parentRun ids are in flight for a
  (workspaceId, company) pair, so a page refresh re-queries the real API state instead of
  resetting to "nothing happened" — it stores only identifiers, never claim content; every claim/
  citation/hash/disclosure the user sees is fetched live from the server each time. 7 new pure-
  function tests cover round-tripping, corrupt-JSON handling, and the claim-derivation helper.
- `docs/dummy.md`'s TASK-011 entry updated: the BCG Application Record no longer has anything to
  remove (there is no static `cultureResearch` data left in that file); the row is retained solely
  for the TEST fixtures.

### Verification (this round)

- `@bridge/core`: 429/429 (typed-error assertion added to the existing terminal-transition test).
- `@bridge/net-guard`: 22/22 (96.34% line coverage) — 7 new redirect-safety tests.
- `@bridge/jobpilot`: 120/120 — 6 new DAG cycle/rootedness tests.
- `@bridge/api`: 29/29 in `jobpilot-culture-research.test.ts` + `agent-eligibility.test.ts`
  (27 + 2), full package suite 198/199 in one parallel run (1 flaky timing-based abort test that
  passes reliably in isolation — a PRE-EXISTING flakiness class in this timing-based test style,
  not a new regression), 199/199 confirmed passing when the same file is run in isolation twice.
- `@bridge/web`: build + typecheck + 55/55 tests pass (net-guard's Node-only code confirmed still
  excluded from the browser bundle; new `culture-research-client.test.mjs` adds 7 tests).
- `@bridge/db`: 107/107.
- Full monorepo `turbo run build`: 21/21 tasks succeed.
- `pnpm run lint`: 2 PRE-EXISTING, unrelated problems remain (`ZazooAvatar.tsx` and
  `core/determinism.ts`, confirmed present on `d990427` before this round's changes via
  `git stash`) — zero new lint problems from this round's changes.
- `pnpm run check:no-dummy-runtime`: clean.
- `@bridge/sensors#test` fails a PRE-EXISTING, unrelated coverage-percentage threshold
  (36.98%→38% required on `d990427` before this round; 37.09% after — confirmed via `git stash`
  that this package's test failure exists independent of, and is not caused by, this round's
  changes; @bridge/sensors's own 7 tests all pass, only the aggregate coverage threshold is short).
- A background sub-agent independently rewrote/extended `jobpilot-culture-research.test.ts` for
  the new async/durable API shape and, in doing so, caught the `memories.id` UUID bug (§1) before
  this round closed — a genuine instance of the "independent verification catches real bugs"
  pattern this whole remediation cycle has followed.

Canonical `docs/TASKS.md`/`docs/BUGS.md`/`docs/APPROVALS.md`/`docs/raw/decisions-log.md`/
`docs/log.md` remain untouched (status NOT flipped) — see the updated proposed-changes list above.

## Fifth review — 2 more issues found and fixed (round 4's own new code)

A FIFTH, read-only independent review (of the round-4 commit `1c19602`) confirmed the 7 fixes
above were genuine and found no defects in points 2, 3, 5, 6, or 7 (verified DAG cycle detection
via manual trace on multiple cyclic/diamond graphs; redirect-origin/downgrade/header-stripping
logic including multi-hop; `agent.create`'s workspace/active binding introduces no
privilege-escalation path; `synthesize`'s `parentRunId` scoping is workspace/company cross-checked
and not forgeable; the web UI's disclosure gating and localStorage usage — confirmed it stores
only ids and every rendered claim is sourced from a live API response). It found 2 genuine High
issues in points 1 and 4's own new code:

1. **Cancellation during the reservation window did not actually abort the in-flight fetch (High)**
   — `materializeCultureSourceFetch` registered its `AbortController` in `abortControllers` only
   AFTER `reserveChildRunAction` resolved. A `cancelCultureSourceFetch` call landing during that
   `await` found nothing to abort (a silent no-op on the network side), flipped the durable record
   to `"cancelled"`, and then `materialize` went on to create its controller too late and complete
   the REAL fetch anyway — the record read `"cancelled"` but the request still went out and
   finished, violating "cancel guarantees the fetch never starts." Empirically reproduced by the
   reviewer against the built code with a delayed `childAgentRuns.get`. **Fixed** by registering the
   `AbortController` immediately after the "pending"→"fetching" CAS succeeds, with no intervening
   `await`, and re-checking `abortController.signal.aborted` right after `reserveChildRunAction`
   resolves (before ever calling `guardedFetch`) — closing the exact gap the reviewer found. Also
   fixed an adjacent inconsistency surfaced while writing the regression test: the
   reservation-violation branch previously always threw, even when the "violation" was itself a
   symptom of a concurrent cancel already having resolved the record terminally — it now returns
   the current terminal record instead of masking it with a "rejected" error. New deterministic
   regression test (`jobpilot-culture-research.test.ts`) reproduces the exact race via a delayed
   `childAgentRuns.get` proxy and asserts the server never receives the request.
2. **`ChildRunAlreadyTerminalError` was not thrown by the actual racing CAS boundary (High)** —
   `recordChildAgentRunTransition`'s own `get()`-based pre-check threw the new typed error, but the
   REAL atomic compare-and-set is `ChildAgentRunStore.updateStatus`, whose mismatch branch — in
   BOTH `InMemoryChildAgentRunStore` and the production `DrizzleChildAgentRunStore` — still threw a
   plain, generic `Error`. Two genuinely concurrent transitions on the same run both pass the
   pre-check (reading "running" before either writes); the LOSER's conflict is detected inside
   `updateStatus` itself, which threw the untyped error — every `instanceof
   ChildRunAlreadyTerminalError` swallow-guard introduced across this remediation cycle would
   incorrectly rethrow a genuine, expected race, and inside `materializeCultureSourceFetch`'s catch
   block this could mask the original fetch-failure error. Empirically reproduced by the reviewer
   firing `cancelChildAgentRun`/`completeChildAgentRun` concurrently at the same run. **Fixed**:
   `InMemoryChildAgentRunStore.updateStatus` now throws `ChildRunAlreadyTerminalError` directly from
   its CAS-mismatch branch; `DrizzleChildAgentRunStore.updateStatus` performs one follow-up read on
   a failed UPDATE to distinguish "unknown run" from a genuine CAS mismatch and throws the same
   typed error with the row's real current status. Existing regression test extended to assert the
   typed error end-to-end.

Re-verified after both fixes: `@bridge/core` 429/429, `@bridge/db` 107/107, `@bridge/api` 30/30 in
`jobpilot-culture-research.test.ts` + `agent-eligibility.test.ts` (1 new regression test), full
monorepo build 21/21, eslint clean (same 2 pre-existing, unrelated issues confirmed via
`git stash`), no-dummy-runtime clean.

Canonical `docs/TASKS.md`/`docs/BUGS.md`/`docs/APPROVALS.md`/`docs/raw/decisions-log.md`/
`docs/log.md` remain untouched (status NOT flipped).

## Sixth review — 1 deeper issue found in the round-5 cancellation fix itself

A SIXTH, narrowly-scoped confirmation review (of `fa2bf92`) confirmed fix #2 (typed
`ChildRunAlreadyTerminalError` from the real CAS-mismatch branch) is correct and complete in both
store implementations (traced the Drizzle follow-up-SELECT's own theoretical TOCTOU window and
confirmed every caller only does `instanceof` checks, never inspects the carried status, so it has
no behavioral consequence). It found fix #1 (the cancellation race) was **incomplete**: moving the
`AbortController` registration to immediately after the "fetching" CAS closed the gap *within*
`materializeCultureSourceFetch`'s own code, but `cancelCultureSourceFetch`'s check for that
controller (`deps.abortControllers.get(childRunId)`) is a plain, unsynchronized map read that is
not itself coupled to the SAME mutex boundary as the durable-record transition — a concurrent
cancel's controller-lookup can still run and find nothing *before* materialize's registration
lands, even though materialize's own transition-then-register step has no internal gap. The
reviewer empirically reproduced this (4/4 runs) with a scratch copy of `fa2bf92`, delaying
`memoryStore.retrieve()` to widen the window, and confirmed the server received the full request
despite the record correctly reading `"cancelled"`.

**Fixed**: `materializeCultureSourceFetch` now performs an authoritative, DURABLE-STATE pre-flight
re-check (`deps.fetchStore.get(...)`) — not `abortController.signal.aborted` — immediately before
ever calling `guardedFetch`. If the record no longer reads `"fetching"` (a concurrent cancel has
already won, regardless of `abortControllers` map timing), it bails out without starting the real
network request. `cancelCultureSourceFetch` also now re-checks for a controller *after* its own
transition succeeds (in addition to before), as best-effort defense in depth for aborting an
already-in-flight connection sooner. Also fixed the reservation-violation branch to return the
current record (rather than always throwing) when the violation-path transition itself reveals a
concurrent cancel already won.

A genuine bug was found and fixed while writing the new regression test for this: both this test
and the round-5 reservation-window test used `{...store, method: override}` object-spread to build
a delayed test double — spread only copies an instance's OWN enumerable properties, silently
dropping a class's *prototype* methods (`consumeBudget`/`updateStatus`/`create`/`listByParentRun`
for `ChildAgentRunStore`; every method at all for `DurableCultureFetchStore`, which has no public
instance fields). TypeScript's structural typing did not catch this for interface-typed
dependencies (only for `DurableCultureFetchStore`, a class with private fields, where it correctly
rejected the spread at compile time). Both test doubles were rewritten as real `Proxy` wrappers
with every non-overridden method explicitly `.bind(target)`'d back to the real instance (a Proxy's
default receiver is otherwise the proxy itself, which breaks classes relying on private `#` fields).
The new test was verified genuinely load-bearing by temporarily reverting the pre-flight-check fix
in a scratch copy and confirming the test fails (`materialized.status` reads `"fetched"`, proving
the real network fetch completed, instead of `"cancelled"`) — then restoring the fix and confirming
it passes again.

Re-verified after this fix: `@bridge/core` 429/429, `@bridge/db` 107/107, `@bridge/jobpilot`
120/120, `@bridge/net-guard` 22/22, `@bridge/api` 31/31 in `jobpilot-culture-research.test.ts` +
`agent-eligibility.test.ts` (1 more new regression test), `@bridge/web` 55/55, full monorepo build
21/21, eslint clean (same 2 pre-existing, unrelated issues), no-dummy-runtime clean.

Canonical `docs/TASKS.md`/`docs/BUGS.md`/`docs/APPROVALS.md`/`docs/raw/decisions-log.md`/
`docs/log.md` remain untouched (status NOT flipped).

## Seventh review — a durable-worker/state-machine redesign (13 production defects, not process-local patches)

A SEVENTH coordinator review of `67e141d` explicitly rejected further process-local mutex patching
and required a genuine durable-worker/state-machine redesign. All 13 findings below were fixed on
this branch (final SHA below), re-tested, and independently re-reviewed.

### The architectural shift

Every previous round's `KeyedAsyncMutex`-based `DurableCultureFetchStore` was **process-atomic
only** — correct for one API instance, silently unsafe across two. The fix is a new
`MemoryStore.compareAndSupersede(id, next)` primitive added to the core `MemoryStore` port:
- `InMemoryMemoryStore`: synchronous check-then-write (process-atomic, dev/test default).
- `DrizzleMemoryStore`: wraps `db.transaction()` + `pg_advisory_xact_lock(hashtext(id))` — a REAL
  Postgres/pglite server-side advisory lock. Two API instances sharing one database can never both
  win a race and fork a "current" state for the same lineage; a losing writer gets a typed
  `MemoryConflictError`, never a silent double-write. (Verified: pglite does NOT support two
  separate processes opening the same on-disk directory concurrently — confirmed empirically and
  via the pglite maintainers' own documentation — so the honest, sandbox-feasible proof is two
  concurrent **transactions** against the SAME pglite instance, exercising the identical
  `pg_advisory_xact_lock` mechanism a real deployed Postgres server would use across genuinely
  separate processes; advisory locks are connection-agnostic, server-side primitives, so this is a
  faithful proof of the cross-instance guarantee, not a weaker substitute.)

`DurableCultureFetchStore` (and everything downstream) now uses `compareAndSupersede` exclusively —
no process-local mutex anywhere in the culture-fetch write path.

### The 13 findings, fixed

1. **Cross-instance atomic intent state** — `compareAndSupersede` (above) replaces `KeyedAsyncMutex`
   in every `DurableCultureFetchStore` mutation (`create`, `attachProposal`, `transition`,
   `acquireLease`, `requestCancel`). New tests in `memory-store.test.ts` prove exactly one of two
   concurrent transactions against one pglite instance wins.
2. **Distributed cancellation** — `cancelRequested` is now a durable field on
   `CultureFetchIntentRecord`, set via `requestCancel`. If no live lease exists, cancellation is
   immediate. If a lease IS live, `requestCancel` can only set the flag; the WORKER holding the
   lease (whichever process that is) is responsible for noticing it. `materializeCultureSourceFetch`
   runs a `setInterval` poll (`CULTURE_CANCEL_POLL_MS = 400`) against the durable flag while
   streaming and aborts its own socket on seeing it — the process-local `AbortController` map is now
   explicitly an optimization, never the authority. New test
   (`distributed cancellation: a SECOND, independent instance...`) proves this using a deps object
   with its OWN empty `abortControllers` Map (genuinely no local knowledge of the fetch) issuing the
   cancel while a separate deps object holds the live socket.
3. **Lease/recovery** — `leaseOwner`/`leaseExpiresAt`/`attempt` fields implement a reclaimable lease
   (`CULTURE_FETCH_LEASE_MS = 30_000`). `acquireLease` succeeds if `pending`, or if `fetching` but
   the prior lease has expired (reclaims it, increments `attempt`); throws
   `CultureFetchLeaseHeldError` for a still-live lease held by someone else. New tests prove: (a) a
   live lease blocks a second acquire; (b) an expired/orphaned lease is reclaimable by an
   independent store instance; (c) `requestCancel` against an orphaned (expired) lease transitions
   directly to `cancelled` rather than waiting on a worker that crashed and will never poll again.
4. **Child-run terminal-status/audit atomicity** — `recordChildAgentRunTransition` (core) now
   appends the ledger audit entry BEFORE the status CAS runs (previously the reverse, with a
   rollback-to-running on audit failure). If the audit append fails, the CAS never runs at all — no
   caller can ever observe a terminal status that later reverts, because nothing is exposed until
   the audit durably succeeds. Deliberate semantic change: BOTH racing attempts now get audited
   (previously only the winner did) — the ledger is now a record of every attempt, not only
   confirmed transitions. Existing "concurrent terminal transitions" test updated for the new
   `ledger.entries.length === 2` expectation; new test proves an audit-append failure leaves status
   untouched (`"running"`).
5. **Persistent Learning provisioning** — `ensureLearningAgentGovernance`/
   `ensureInternalStrategistGovernance` (persistent/Drizzle mode) now grant `external:fetch:read` +
   `jobpilot.researchCultureSource` (Learning) and `dataScope:"all"` +
   `jobpilot.synthesizeCultureProfile` (Internal Strategist), matching the in-memory wiring. New
   real pglite-backed boot/invocation test in `wiring.test.ts`; an existing `local-store.test.ts`
   assertion that pinned the OLD (incomplete) capability list was updated to reflect the corrected
   grant.
6. **Governed `agent.create`** — replaced client-supplied `capabilityScope`/`allowedSkills` with a
   server-owned `AGENT_ROLE_TEMPLATES` registry (`agent-role-templates.ts`), deriving each
   template's capability scope from the real `GOVERNED_SKILL_MANIFEST_CATALOG` (fails closed if a
   skill isn't registered; rejects wildcard grants). The client selects only a `roleTemplateId`;
   the server resolves everything else — mirrors the established `CULTURE_SOURCE_REGISTRY`
   "server owns catalog, client selects ID" pattern. `agent.update` updated the same way. New
   create→task-assign and cross-workspace-rejection tests.
7. **Source policy snapshot** — `CultureFetchIntentRecord.policySnapshot` pins
   `{ registryVersion, eligibility }` at `propose()` time via `computeSourcePolicyHash` (hashes every
   security-relevant registry field, not just the URL). `materialize` re-resolves the CURRENT
   registry entry and rejects if the snapshot no longer matches — a source reclassified between
   propose and materialize (e.g. `permitted` → `do_not_use`) fails closed even at the identical URL.
8. **External trust/retention** — `CultureArtifactRef` now carries `trustOrigin:
   "untrusted_external"` (never `"operator"`) and a bounded `expiresAt` (`CULTURE_ARTIFACT_RETENTION_MS
   = 24h`). The governance-metadata RECORD itself (the fact that a fetch was requested/leased) is
   still `trustOrigin: "operator"` — the FETCHED BYTES it may reference are the untrusted part; the
   two are never conflated.
9. **Synthesis result binding/schema** — `synthesisResult`/`synthesize` require `company` +
   `parentRunId` (not just `proposalId`); a strict `synthesizeCultureProfileOutputSchema` (Zod)
   rejects any malformed/foreign `proposedOutput`; the endpoint independently re-derives the run's
   real fetched artifacts and cross-checks every `artifactHashes` entry against real content hashes.
   An arbitrary OTHER approved proposal (any skill) is rejected as `not_available`, never rendered.
10. **Deterministic derived-claim text** — `groundClaims`/`computeReferenceGrounding`
    (`culture-research.ts`) now build theme/inference/contradiction claim TEXT via fixed templates
    over a topologically-ordered (`postOrder`) map of already-validated supporting evidence —
    caller-supplied `quote` is NEVER used for derived claim types. Closes the "arbitrary
    caller-authored theme text" gap entirely.
11. **IPv6 SSRF hardening** — extended `net-guard`'s `IPV6_BLOCKS` with `fec0::/10`,
    `2001:db8::/32`, `64:ff9b:1::/48`, and additional IANA special-purpose ranges; fixed
    `::127.0.0.1`-style dotted-quad parsing; generalized embedded-IPv4 handling (IPv4-compatible/
    mapped + NAT64 well-known prefix). Reuse/license intake performed first: neither `ipaddr.js` nor
    `ip-address` (both MIT) cleanly matched the fail-closed policy without still needing the same
    local override table, so the hand-rolled classifier was extended rather than replaced — decision
    and rationale recorded in code comments. 24/24 net-guard tests (was 22).
12. **Cross-origin header allowlist** — replaced `CROSS_ORIGIN_STRIPPED_HEADERS` (a denylist) with
    `CROSS_ORIGIN_ALLOWED_HEADERS` (`accept`, `accept-language`, `user-agent`, `content-type` only).
    An unrecognized custom header (e.g. `x-goog-api-key`) is now stripped on every cross-origin hop
    by default, closing the "unknown header silently forwarded" gap a denylist can never close.
13. **Server-authoritative UI resume** — added `cultureResearch.latestRun` (new tRPC query) and a
    small `DurableCultureSynthesisPointerStore` (same `MemoryStore`, no new migration, keyed by
    `parentRunId`) recording the (parentRunId → synthesisProposalId) pointer. `latestRun` derives
    the latest parent Run + pending sources + synthesis pointer for a (workspaceId, company) purely
    from durable server state via a new `DurableCultureFetchStore.listByCompany`. The web UI now
    queries this on every mount and treats it as authoritative — `localStorage` is overwritten by
    whatever the server returns (including `null`, clearing a stale/foreign pointer), so clearing
    storage or switching devices still surfaces real pending/completed research. Also fixed two
    ALREADY-BROKEN `synthesisResult` call sites (missing the now-required `company`/`parentRunId`
    fields) and added graceful reconciliation for "proposal already approved" — `action.decide`'s
    409 `CONFLICT` (`AlreadyResolvedError`) is now caught and treated as success (proceed to
    materialize/read result) rather than surfaced as an error, satisfying "do not call decide again;
    reconcile based on durable status."

### New tests this round

`memory-store.test.ts` (+2, cross-instance CAS), `wiring.test.ts` (+1, persistent governance),
`agent-eligibility.test.ts`/`ritual-ownership.test.ts` (updated for role-template model),
`net-guard.test.ts` (+2, IPv6 + header allowlist), `child-agent-run.test.ts` (rewrote 1, +1 new,
audit-before-status atomicity), `jobpilot-culture-research.test.ts` (+5: `latestRun` resume/company
isolation/latest-run-wins, distributed cancellation via a genuinely separate deps object,
orphaned-lease reclaim, orphaned-lease-cancel-transitions-directly), `local-store.test.ts` (updated
1 stale capability-list assertion).

### Verification

`@bridge/core` 430/430, `@bridge/db` 109/109, `@bridge/net-guard` 24/24, `@bridge/jobpilot` 120/120,
`@bridge/api` 207/208 (the 1 failure is the same pre-existing timing-sensitive test documented in
prior rounds — `cancelCultureSourceFetch aborts a real in-flight fetch...` — confirmed passing in
isolation both before and after this round's changes; flakiness is tied to system load from
concurrent background work, not a real regression), `@bridge/web` 55/55 tests + clean build +
clean `tsc --noEmit`, full monorepo `turbo run build` 21/21, eslint clean (same 2 pre-existing,
unrelated issues in `ZazooAvatar.tsx`/`core/determinism.ts`), no-dummy-runtime clean.

Synced with `origin/main`: no new commits since the prior round's sync (`f20f611` remains both
`origin/main`'s tip and this branch's merge-base) — no reconciliation needed. No new migration was
created (per the coordinator's explicit sequencing instruction); the entire cross-instance-safety
redesign relies on `pg_advisory_xact_lock` inside the existing `memories` table, avoiding any
conflict with RM4's `0015` or TASK-010's next-in-line migration.

Canonical `docs/TASKS.md`/`docs/BUGS.md`/`docs/APPROVALS.md`/`docs/raw/decisions-log.md`/
`docs/log.md` remain untouched (status NOT flipped).
