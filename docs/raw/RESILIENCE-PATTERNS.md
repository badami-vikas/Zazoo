---
title: Resilience patterns — failure-class field guide mapped to Bridge (2026-06-01)
type: raw
doc_kind: design
status: active
companions: []
related_wiki: wiki/resilience.md
updated: 2026-06-22
tags: [resilience, patterns, reliability]
---
# Resilience patterns — failure-class field guide mapped to Bridge (2026-06-01)

Source: an external post-mortem of *PeopleGamez*, a Firebase-based real-time multiplayer platform,
rebuilt onto Cloudflare Durable Objects + Postgres. 14 failure classes + 10 portable principles.
This doc assesses each against Bridge AI: what Bridge already does, what to adopt, and one
refinement to a prior call.

## Verdict
Highly relevant — but mostly as VALIDATION plus a few sharp net-new disciplines. Bridge is not a
real-time game, but its **governed agentic execution** has the same deep shape as PeopleGamez's core
problem: a long-lived, multi-step, must-be-auditable stateful process. **The ritual run is Bridge's
"authoritative actor."** Every lesson about the per-room serialized reducer maps to how Bridge's
ritual executor (P1/P2) must be built.

## The one root cause, translated
PeopleGamez root cause: no single authoritative compute point — truth smeared across Firestore +
RTDB + Functions + cron; two code paths (a "live" path and a "resolve" path) inevitably diverged.

Bridge's equivalent risk surface = the **ritual executor + Universal Action Pipeline**. If a ritual's
state is computed in two places (the engine's view + a hand-updated `ritual_runs.status` column; or a
"live" agent path + a "resolve" cron), it will drift — the same bug. Bridge's locked decisions
(append-only ledger; one Action Pipeline; draft-then-approve) already point the right way. The job is
to make the RUNTIME embody them rather than smear state again.

Key reframe: **replayability IS auditability.** If the ritual executor is a deterministic reducer
folding the append-only ledger, then "explain why the agent did X" = replay the log → identical
state. Bridge already wants explainable/auditable governance; determinism is how you get it for free.

## Mapping (14 classes)

### A. Already dodged or validated (Bridge's locked calls, independently confirmed)
- **#7 Authorization drift** — SAME disaster already captured in `AUTHZ-HARDENING.md`. Bridge: single
  `workspace_members` membership ledger · single `requireAuthority` resolver · permissions from DB not
  JWT (revocation is immediate) · impersonation audited via ledger `on_behalf_of`. Confirmed.
  (See the RLS refinement below.)
- **#2 Counter/ledger drift** — Bridge ledger is append-only (locked); `signal_actions` append-only;
  reactions never mutate. ADOPT the sharper rule: never store a writable aggregate beside the event
  log (pending-approval count, `policy_params`) — DERIVE by fold, or treat as an idempotent projection.
- **#5 Timing misses** — Bridge chose Hatchet (Postgres-native, precise per-job scheduling) + BullMQ
  over a coarse global cron precisely to avoid the "60s-late" class. Validated. Rule: per-ritual alarms
  to the exact deadline, no global sweep enforcing fine timers.
- **#12 Hidden-info leakage / per-role projections** — Bridge's CORE TRUST STORY. Two-tier data
  (canonical vs relationship) + "AI sees filtered context" + scoped AI-context release + E2EE
  relationship tier = "per-role projections are the only thing clients/AI receive, computed
  server-side, sanitized at one chokepoint." Validated; see adopt #25 to make it a single chokepoint.
- **#14 Platform-specific Firebase failure modes** — N/A by construction: Bridge is Postgres + RLS from
  day 0. The meta-rule "a database with triggers is not a stateful-coordination server" VALIDATES not
  running ritual coordination as pg_cron/triggers — use a real durable-execution engine (Hatchet /
  LangGraph checkpoint).

### B. Adopt now — net-new disciplines (cheap before code, expensive to retrofit)
- **#8 Determinism by construction** — inject `ctx.now` + seeded RNG into the agent runtime & ritual
  reducer; lint-ban `Date.now()`/`Math.random()` in engine/agent code. Payoff: replay-equality → the
  ledger becomes a replayable audit trail. Directly serves the explainable/auditable principle. Aligns
  with the LangGraph checkpoint choice (checkpoints are only sound if steps are deterministic).
- **#13 Make invariants executable — Governance Conformance Suite** — generalize the planned
  Authorization Conformance Suite into a headless, property-based, CI-gated suite: authority resolution
  (the 6 authz scenarios) + ledger replay-equality + projection no-leak + lifecycle legality + policy
  pre/runtime/post. A ritual can't ship until it passes. Every past/variance bug → a property test that
  fails forever if it returns.
- **#3 Validate + sanitize at one boundary** — a single Zod chokepoint (the `data/db.ts` seam is the
  natural spot) that strips undefined, coerces non-finite numbers, and a test-only loud check that
  fails CI on NaN with the offending path. Concrete Bridge risk: warmth/trust/reciprocity are DERIVED
  numerics rendered as qualitative labels (Hot/Warm/Cooling) — a silent NaN mislabels rather than errors.
- **#4 Lifecycle = state machines, not string flags** — Bridge already models the intro-consent flow
  as a state machine (requested→awaiting_both→active|declined) — good. Extend the same to `ritual_runs`
  (draft→running⇄paused→completed) and ledger decisions; make illegal transitions impossible
  (XState-style or DB-enforced). LangGraph interrupt/checkpoint is the substrate.

### C. Code-hygiene / lighter-weight (track, apply in build)
- **#1 Shared-state race** — Bridge's shared mutable surface is the GLOBAL-deduped canonical tier (two
  workspaces enriching the same person; Splink identity merges). Fix: canonical writes are idempotent
  upserts keyed by `dedup_key`; enrichment is append-only events folded into the canonical view, not an
  in-place read-modify-write.
- **#9 Identity from stable ids** — Bridge keys on stable ids/`dedup_key` (good). Minor smell:
  `db.ts mapCanonical` falls back to `SB-${i}` (array index) when `d.id` missing — index identity
  shifts if rows reorder. Use a stable surrogate.
- **#10 No bytes in DB / live state** — Files & Media: store bytes in Supabase Storage behind immutable
  URLs; touchpoints/config carry an id, never base64. Same spirit as the locked "embeddings off entity
  tables → central `embeddings` table." Content-address + dedup by hash.
- **#6 Audited ownership handover** — Bridge's delegations + `on_behalf_of` already exceed PeopleGamez's
  creator-bound ownership. Ensure initiative/ritual ownership is a reassignable + ledger-audited
  handover (so a partner leaving the fund doesn't strand a ritual).
- **#11 Heavy renderers on weak hardware** — low relevance (B2B, fund partners on real hardware). Keep
  Orbit on Canvas2D/SVG, no perpetual three.js loops. Noted, not prioritized.

## Refinement to a prior call: RLS = coarse defense-in-depth, NOT a second policy
PeopleGamez sharpens #7: "DB RLS is defense-in-depth only — re-encoding the full policy in SQL would
just recreate multi-source drift." This refines `AUTHZ-HARDENING.md`'s "RLS as primary guard." The
correct split for Bridge:
- **RLS enforces COARSE structural invariants** — `workspace_id` tenant isolation + visibility tier
  (private/team/workspace). Simple, stable, hard to get wrong. The backstop that holds if app code breaks.
- **`requireAuthority` is the SINGLE source for the FINE policy** — role ∩ capability-ceiling ∪
  ephemeral − deny, delegation chains, on-behalf-of. This lives in ONE place only.
- **Do NOT re-encode the fine policy in RLS.** Two encodings of the same fine policy = the multi-source
  drift bug. Document this so nobody later "helpfully" pushes capability logic into SQL policies.

## Roadmap tie-in
These are P1 (Governance Spine) + P2 (Registries & Runtime) design constraints — exactly the runtime
that makes **functional sample rituals** possible. This field guide effectively becomes the
**ritual-executor design spec**: a deterministic reducer over the append-only ledger, injected
time/RNG, state-machine lifecycle, single projection + validate chokepoints, conformance-tested.
Commit determinism + conformance + projection-chokepoint into ARCHITECTURE.md now (cheap), implement
in P1/P2.

## Portable principles → Bridge status (one-liners)
- One authority, one code path → Universal Action Pipeline + ritual reducer (locked dir; enforce in runtime).
- Derive, don't duplicate → append-only ledger (locked); audit for writable aggregates.
- One-directional data flow → authority → store; reinforce in pipeline.
- Determinism by construction → ADOPT (#8).
- Validate + sanitize at one boundary → ADOPT (#3).
- Identity from stable ids → mostly have; fix `SB-i`.
- Never bytes in DB → ADOPT for Files & Media.
- Permissions from a single live source, never the token → LOCKED (authz-hardening).
- Make invariants executable → ADOPT/EXPAND (#13, Governance Conformance Suite).
- Match the runtime to the problem → VALIDATES Hatchet + Postgres; don't run rituals on pg_cron.
