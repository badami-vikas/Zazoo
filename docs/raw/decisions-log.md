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

---

## 2026-06-24 — Recon: separate-but-integrated, deployed always-on, intake hop completed

**Context:** Recon ran only on `localhost:3001` and its findings never reached Bridge.
Diagnosis: `addToBridge()` posts to `NEXT_PUBLIC_BRIDGE_INTAKE_URL` (unset → dead `localStorage`
outbox), the platform had no intake endpoint, and `.env.local` was absent (no
`SUPABASE_SERVICE_KEY` → "results saved to local JSONL only"). The mapping/contract
(`mapReportToCapture`, `RECON_MANIFEST.commit_via: 'pipeline_proposal'`) and Recon's own
quality-tiering/approval WERE built — only the last delivery hop was a stub.

**Decision:** (1) Tool stays a separate app — **no codebase merge** (monorepo-unification
program shelved). (2) Add a plain Fastify route `POST /intake/recon` on `apps/api` mapping the
existing `CaptureEnvelope` → governed `pipeline.propose()` (subject + memories → one
`person:write` proposal; each risk flag → its own `signal:write`; actor = seeded drafts-only
`INTAKE_AGENT` on behalf of the pilot user) → `pending_review` ledger rows the web Approvals UI
already reads. (3) Deploy Recon + `apps/api` to **Fly.io** always-on; Recon gets a **persistent
volume** at `/app/data`. (4) Gate the intake route with a **shared-secret header**
(`x-recon-secret` / `RECON_SHARED_SECRET`).

**Rationale:**
- *Fastify route, not tRPC* — `addToBridge()` posts the envelope as raw JSON; a plain route
  matches the existing client with the least change.
- *Fly.io, not Cloudflare/Vercel* — Recon's approval store is filesystem JSONL (`data/*.jsonl`);
  serverless has no persistent writable FS, breaking "make the existing flow run." A stateful
  host + volume keeps it working with zero code change.
- *Reuse propose()* — Authority → Policy → draft-then-approve → append-only ledger apply for free.

**Alternatives rejected:**
- *Full codebase merge / monorepo unification* — user chose separate-but-integrated; deferred.
- *Cloudflare (same platform as prototype)* — incompatible with Recon's filesystem store unless
  migrated to Supabase first (separate, larger work).
- *Direct Supabase write of findings (bypass approval)* — violates draft-then-approve.

**Consequences / follow-ups:**
- Two write patterns coexist BY DESIGN: extension capture → `capture_profile` RPC → direct
  `people_canonical`; report findings → `/intake/recon` → governed `ledger` proposals. Do not unify.
- **Persistent-mode governance must be seeded in Supabase**: `seedGovernance()` only runs in-memory,
  so with `DATABASE_URL` set the `INTAKE_AGENT`/`role-intake`/pilot-user grants must exist in the DB
  or `propose()` is denied (plan Task 8).
- `NEXT_PUBLIC_*` vars are build-time-inlined → must be present at Recon's Fly build.
- LinkedIn connection-send (original request #2) + full configurable-URL extension UI remain a
  deferred follow-on strand.

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
