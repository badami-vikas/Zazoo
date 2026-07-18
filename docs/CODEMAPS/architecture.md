<!-- Updated: 2026-07-18 | Files scanned: platform/apps/{api,web,desktop}, platform/packages/{core,db,local}, platform/tools | Token estimate: ~750 -->

# Architecture Codemap

One authoritative runtime lives under **`platform/`**:

1. **Engine/API** — TypeScript monorepo (pnpm + Turbo), Fastify + tRPC, Universal Action
   Pipeline, Drizzle, and Local/Supabase adapters.
2. **Web client** — `platform/apps/web` React + Vite thin client over governed tRPC surfaces.
3. **Desktop client** — `platform/apps/desktop` Tauri host for the same web client plus native
   Avatar/capture/display behavior.

`Design Bridge AI Interface (Copy)/` is retained historical prototype/reference material. It is
not the production build entry point.

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
(pending) → Human `action.decide` → Ledger append (resolved) → post-Policy → Event emit →
domain effect. Relationship effects persist separately and reconcile after restart; the Human
decision is never rolled back or repeated because materialization failed.

Agent-floor DENY: a hard-coded non-removable deny list (`AGENT_FLOOR_MUTATIONS` in
`packages/core/src/authority.ts`) blocks agents from ever writing policy/ledger/agent/role or
calling `approve`/`external:send` — humans only. **Enforced in 3 separate places** (authority.ts,
agent-scope.ts, integration-store.ts) — see known-issues for the triplication risk.

## Composition root

`apps/api/src/wiring.ts` builds all ports (ledger, policy, Agent/Goal/Task/Skill, graph,
Relation materialization, packages, Rituals, media, captures) and branches on `DATABASE_URL`
for persistent versus in-memory adapters. Persistent startup provisions both DealPilot and
Relationship governance. `PILOT_WORKSPACE`/`PILOT_USER` still constrain the prototype runtime;
see `docs/BUGS.md` for stores that remain process-local.

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
[../BUGS.md](../BUGS.md), [../wiki/testing.md](../wiki/testing.md).
