---
title: TASK-011 — JobPilot Culture-Research Slice (JP3B)
date: 2026-07-17
task: TASK-011
status: implemented (remediated after independent security review), pending coordinator ledger reconciliation
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
   mistake of fetching inside `run()`).
2. **`docs/BUGS.md`** — the `InMemoryAgentStore` gap entry from the prior pass, now with a
   pointer to the new regression tests.
3. **`docs/TASKS.md`** — TASK-011 exit criteria are met by the changes above; propose flipping
   status once the coordinator has reviewed this doc and the fresh independent review.
