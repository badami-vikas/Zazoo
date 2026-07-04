<!-- Generated: 2026-07-04 | Files scanned: platform/{apps,packages,tools} + prototype root | Token estimate: ~650 -->

# Architecture Codemap

Two independent codebases under one repo:

1. **`platform/`** — real backend. TS monorepo (pnpm + turbo), Fastify + tRPC + Drizzle +
   Supabase Postgres. Governance-critical (draft-then-approve, append-only ledger, agent floor).
2. **`Design Bridge AI Interface (Copy)/`** — prototype UI. React + Vite, mostly localStorage-
   backed, calls `platform`'s tRPC API only where explicitly wired (Calendar, DealPilot partial).

Not yet connected: JobPilot, Helpdesk public surface, most of the prototype's data tables.

## Two-plane data model (platform)

```
CLIENT → tRPC router (apps/api) → UniversalActionPipeline (packages/core)
                                        │
                          ┌─────────────┼──────────────┐
                          ▼             ▼              ▼
                     Authority      Policy        Ledger (append-only)
                    resolver      evaluator      → Event bus → Variance Adjuster
                          │
              ┌───────────┴────────────┐
              ▼                        ▼
      LOCAL plane (pglite)      CANONICAL/global plane (Supabase Postgres, RLS)
   raw OAuth bodies, private    people/communities_canonical, permissions, roles,
   Touchpoints/Memories/Signals agents, rituals, ledger, embeddings
   never reaches Supabase
```

Draft-then-approve flow: `action.propose` → Authority+Policy pre-check → Ledger append
(pending) → human `action.decide` → Ledger append (resolved) → post-Policy (advisory only,
see known-issues) → Event emit → materialization (e.g. Google draft becomes a real send).

Agent-floor DENY: a hard-coded non-removable deny list (`AGENT_FLOOR_MUTATIONS` in
`packages/core/src/authority.ts`) blocks agents from ever writing policy/ledger/agent/role or
calling `approve`/`external:send` — humans only. **Enforced in 3 separate places** (authority.ts,
agent-scope.ts, integration-store.ts) — see known-issues for the triplication risk.

## Composition root

`apps/api/src/wiring.ts` builds all ports (ledger, policy, agent, role, ritual registry, media,
capture stores) — branches on `DATABASE_URL` presence for persistent vs in-memory. **Known gap:**
some stores silently stay in-memory even when persistent (canonical identity, capture store) —
see `docs/wiki/known-issues.md`. `PILOT_WORKSPACE`/`PILOT_USER` are hardcoded constants baked
into this file — the system is single-tenant by construction today.

## Tool model

Each `platform/tools/*` package is a standalone capability (DealPilot, JobPilot, People/Company
Sourcing, Recorder) composed from shared packages (`@bridge/sourcing` waterfall connectors,
`@bridge/dedupe` match/score, `@bridge/facts` living-profile store, `@bridge/tables` TableSpec).
`@bridge/tool-kit` provides the generic manifest→quarantine→commit intake seam; only DealPilot
is wired to it so far (Recon, a separate `Tools/recon` app outside this monorepo, is not).

## Deferred/seam-only (architecture exists, no running code)

Ritual engine (DAG/Hatchet), Memory table + classification, Variance Adjuster, Temporal (behind
`RitualExecutor` interface — only an in-process synchronous implementation exists today), E2EE
relationship tier (Phase 6). See `docs/wiki/roadmap.md` for phase gates.

See also: [backend.md](backend.md), [data.md](data.md), [dependencies.md](dependencies.md),
[../wiki/known-issues.md](../wiki/known-issues.md), [../wiki/testing.md](../wiki/testing.md).
