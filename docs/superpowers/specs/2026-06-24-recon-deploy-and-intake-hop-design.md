# Design — Recon Always-On Deploy + Bridge Intake Hop

- **Date:** 2026-06-24
- **Status:** Draft (direction approved verbally; awaiting spec review)
- **Supersedes (as the active plan):** the
  [Monorepo Unification program](2026-06-24-monorepo-unification-program.md) and its slice-1
  spec are **shelved** — the user chose "tool stays a separate entity, tightly integrated,"
  not a codebase merge. The
  [extension deploy + LinkedIn-send spec](2026-06-24-recon-extension-deploy-and-linkedin-send-design.md)
  is **deferred** to a later strand (LinkedIn-send is original request #2, not in this effort).
- **Scope:** `Tools/recon/` (config + deploy) and `platform/apps/api` (one new intake route + deploy).
  No code change to Recon's research/approval logic. No codebase merge.

## Goal

Make the **already-implemented** Recon flow actually run, always-on, and complete the one
missing hop so Recon findings reach the Bridge web Approvals as Signals.

Two parts, in order:
- **A. Deploy + configure Recon** so its built-in quality-tiering / approval / canonical DB write
  runs in production without a local server. *No new code.*
- **B. Build the missing intake hop** so Recon's `CaptureEnvelope` (person + memories + **signals**)
  lands as governed `ledger` proposals visible in the Bridge web Approvals UI.

## Background (why it's broken — diagnosed)

- Recon's mapping is built: `mapReportToCapture()` → quarantined `CaptureEnvelope`
  (facts→Memory, risk flags→**Signal**), `RECON_MANIFEST.intake_policy.commit_via =
  'pipeline_proposal'` ([bridge.ts](../../../Tools/recon/lib/bridge.ts)).
- But `addToBridge()` only delivers when `NEXT_PUBLIC_BRIDGE_INTAKE_URL` is set; it isn't, so every
  finding falls into a dead `localStorage` outbox ([bridge.ts:154-171](../../../Tools/recon/lib/bridge.ts)).
- The endpoint it expects (`tool.intake`) **was never built** on `platform/apps/api`.
- No `.env.local` in Recon → `SUPABASE_SERVICE_KEY` unset → "results saved to local JSONL only"
  → nothing reaches `people_canonical`.
- The web Approvals page already reads the Supabase `ledger`
  ([ApprovalsPage.tsx:79](<../../../Design Bridge AI Interface (Copy)/src/app/pages/ApprovalsPage.tsx>)) —
  the read side is fine; only the write side is unwired.

## Decisions (locked with user)

| # | Decision | Choice |
|---|----------|--------|
| 1 | Direction | Tool stays separate, tightly integrated; **no codebase merge** |
| 2 | Priority | **Make the existing flow run** (deploy + configure) first, then the intake hop |
| 3 | Target approval surface | Recon's own approval **and** the Bridge web Approvals/Signals (A then B) |
| 4 | Recon deploy host | **Stateful host with persistent volume (Fly.io recommended)** — Recon's JSONL store needs a real filesystem; serverless (Cloudflare/Vercel) would break "make existing flow run." Overrides the earlier Cloudflare lean. |
| 5 | API protection | **Shared-secret header** on the intake route (carried from the deferred extension spec) |
| 6 | LinkedIn-send feature | **Out of scope here** — separate later strand |

## Part A — Deploy + configure Recon (no new code)

**Config:**
- Create `Tools/recon/.env.local` (and the host's secret store) with `SUPABASE_URL`,
  `SUPABASE_SERVICE_KEY`, optionally `BRIDGE_WORKSPACE_ID`, and (for Part B)
  `NEXT_PUBLIC_BRIDGE_INTAKE_URL` + the shared secret. Secrets never committed.
- With `SUPABASE_SERVICE_KEY` set, the extension import path
  ([capture-rpc.ts](../../../Tools/recon/lib/capture-rpc.ts) → `capture_profile` RPC) writes to
  `people_canonical` instead of local-only JSONL.

**Deploy:**
- Containerize the Recon Next.js app; deploy to **Fly.io** with a **persistent volume** mounted at
  the app's `data/` dir so `staging.jsonl` / `permanent.jsonl` / `flags.jsonl` /
  `entity-links.jsonl` / `ofac-sdn.json` survive restarts (Recon's own approval store keeps working
  unchanged). Always-on (min-machines ≥ 1).
- Env/secrets set on the host. Optional sidecars (SearXNG, FlareSolverr) deferred — Recon degrades
  gracefully without them.

**Acceptance (A):**
- Recon reachable at a stable https URL with no local server running.
- A LinkedIn capture (extension → `/api/linkedin-import`) creates/updates a `people_canonical` row
  (verify via Supabase).
- Recon's StagingViewer/promote flow works against the mounted volume across a restart.

## Part B — Bridge intake hop (small, reuses everything built)

**New: an intake route on `platform/apps/api`.**
- `addToBridge()` does a **raw JSON POST** of the `CaptureEnvelope`. tRPC procedures expect
  tRPC-wrapped input, so the cleanest fit is a **plain Fastify POST route** (e.g. `POST /intake/recon`)
  rather than a tRPC procedure — minimal change to the existing Recon client (just point the env var
  at it).
- The handler:
  1. Verifies the `x-recon-secret` header against `RECON_SHARED_SECRET` (401 otherwise).
  2. Validates the envelope (zod) — reuse/extend the seam's validation discipline.
  3. Maps envelope → governed proposals **through the existing pipeline**: for the subject →
     `person` proposal; each `signals[]` → `signal` proposal; (memories → `memory` proposals,
     or batched — see open choice below). Calls the **same `propose()` path** that `action.propose`
     uses, so Authority → Policy → draft-then-approve → **append-only `ledger`** all apply.
  4. Returns `{ ok, proposalIds }`.
- Wire it in `platform/apps/api/src/server.ts` / `wiring.ts` alongside the tRPC plugin.

**Recon side:**
- Set `NEXT_PUBLIC_BRIDGE_INTAKE_URL` → `https://<deployed-api>/intake/recon` and the shared secret.
  `addToBridge()` then posts to it instead of the outbox.
- **Outbox flush:** add nothing structural — on next `addToBridge` success the new envelope goes
  through; for already-stranded items, a tiny "flush outbox" action (reuse `loadOutbox()`) re-posts
  them. (Small, but it is the one code touch on the Recon side; flagged as such.)

**Deploy `apps/api`:**
- Deploy the Fastify gateway (Fly.io, same platform family as Recon), env: `DATABASE_URL` → the
  **same Supabase project** the web app reads, identity/pilot keys, `RECON_SHARED_SECRET`. Always-on.

**Acceptance (B):**
- POST a sample `CaptureEnvelope` (with ≥1 signal) to `/intake/recon` with the secret → `ledger`
  gains proposal rows with `user_decision = null`.
- Those proposals appear in the **Bridge web Approvals UI** (which already reads `ledger`) as
  pending Signals; approving/rejecting one writes a decision row (governed path intact).
- Wrong/missing secret → 401; malformed envelope → 400, no partial writes.

## Open choices for the plan (small)

- **Memory proposals volume:** a report can yield many `memories[]`. Option (i) one `memory`
  proposal each (faithful, noisy), or (ii) batch all memories into a single proposal attached to
  the person. Recommend **(ii)** to keep the Approvals inbox signal-dense; confirm in the plan.
- **Quarantine status mapping:** envelope `status: 'quarantined'` → proposal metadata so the UI can
  badge provenance. Confirm the `ledger` proposal schema has a slot (else add a metadata field).

## Risks

- **R1 — Recon filesystem store on serverless.** Resolved by decision #4 (stateful host + volume).
  If the user later insists on Cloudflare, the JSONL store must first migrate to Supabase (separate,
  larger work) — not in scope.
- **R2 — Two write patterns coexist.** Extension → `capture_profile` (direct `people_canonical`)
  and report → `/intake/recon` (governed `ledger` proposals) are *different* on purpose: captures
  are deterministic identity rows; report findings are proposals for human approval. Documented so
  it isn't "fixed" into one path.
- **R3 — Service-role key on a deployed app.** `SUPABASE_SERVICE_KEY` + the intake route both need
  the shared-secret gate (decision #5) so the deployed surfaces aren't open writers.
- **R4 — Pilot identity uuids.** The web seam hardcodes pilot workspace/agent/user uuids; the
  intake route must use real uuids the pipeline accepts (reuse the seam's constants) or proposals
  fail to insert. Plan verifies against the live Supabase schema.
- **R5 — `globalThis.crypto.randomUUID` in envelope id** — fine on Node 20 (host) and modern
  browsers; no action, noted.

## Verification (end-to-end)

1. Deploy `apps/api` + Recon (Fly.io), both always-on, env/secrets set.
2. From a browser with no local server: run a Recon report, hit "Add to Bridge."
3. Confirm `ledger` gains proposals (Supabase) and they show in the web Approvals UI as Signals.
4. Approve one → decision row written; reject one → excluded. Governance intact.
5. Restart both apps → Recon's JSONL store persists (volume); flow still works.
6. Negative: drop the secret → 401; capture with `SUPABASE_SERVICE_KEY` set → `people_canonical` row.

## Files touched (anticipated)

**Recon (`Tools/recon/`):** `.env.local` (uncommitted) + host secrets; a small outbox-flush hook in
`lib/bridge.ts`/its caller; Dockerfile + `fly.toml` (+ volume). **No research/approval-logic change.**

**Platform (`platform/apps/api/`):** new `src/intake/recon-route.ts` (Fastify handler: secret check
→ zod validate → pipeline propose); wiring in `src/server.ts`/`src/wiring.ts`; reuse
`@bridge/core` propose path + `@bridge/db` ledger writer; Dockerfile + `fly.toml`; env for
`RECON_SHARED_SECRET` + `DATABASE_URL`.

**Docs:** ADR in `docs/raw/decisions-log.md` (separate-but-integrated; Fly.io for the filesystem
store; intake-as-Fastify-route; two-write-patterns rationale); `docs/wiki/known-issues.md`
(prior R1 FS limitation now scoped via host choice); `docs/log.md`.
