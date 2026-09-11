<!-- Updated: 2026-09-11 | Files scanned: platform/apps/{api,web,desktop}, platform/modules, platform/packages/{core,db,local}, platform/tools | Token estimate: ~800 -->

# Architecture Codemap

One authoritative runtime lives under **`platform/`**:

1. **Engine/API** — TypeScript monorepo (pnpm + Turbo), Fastify + tRPC, Universal Action
   Pipeline, Drizzle, and Local/Supabase adapters.
2. **Web client** — `platform/apps/web` React + Vite thin client over governed tRPC surfaces.
3. **Desktop client** — `platform/apps/desktop` Tauri host for the same web client plus native
   Avatar/capture/display behavior.

Pre-cleanup legacy source is absent from main and preserved only on TASK-013's private archive ref.
Repository history was not rewritten.

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
calling `approve`/`external:send` — humans only. Single source `packages/core/src/agent-floor.ts`, imported by authority.ts, agent-scope.ts and integration-store.ts (triplication closed).

## Composition root

`apps/api/src/wiring.ts` builds all ports (ledger, policy, Agent/Goal/Task/Skill, graph,
Relation materialization, packages, Rituals, media, captures) and branches on `DATABASE_URL`
for persistent versus in-memory adapters. Persistent startup provisions both DealPilot and
Relationship governance. `PILOT_WORKSPACE`/`PILOT_USER` still constrain the prototype runtime;
see `docs/BUGS.md` for stores that remain process-local.

## Module and Engine boundaries

`platform/modules/manifests/src/index.ts` is the aggregate Module catalog. Since ADR-258 each packaged Module (DealPilot, JobPilot, WhatsApp, DevPilot, Accounting, D2C) owns its entry in `modules/<x>/src/module.ts` (browser-safe `./module` subpath); the catalog imports them and exports every entry by name — there is no string lookup (`requireBuiltInModule` is gone). Kernel Modules with no package stay inline. API installation, Commons publication, and web routes derive from the named exports. Runtime ids live in the `MODULE_RUNTIME_IDS` table (values pinned by test; they are persisted identity).
DealPilot and JobPilot implementation packages live in `platform/modules/{dealpilot,jobpilot}`.
People/company sourcing and recording remain internal Engine packages under the existing
`platform/tools/` workspace path; no standalone legacy application is a production entrypoint.
`@bridge/capability-kit` remains the gated intake seam used by DealPilot.

## Deferred/seam-only (architecture exists, no running code)

Ritual engine (DAG/Hatchet), Memory table + classification, Variance Adjuster, Temporal (behind
`RitualExecutor` interface — only an in-process synchronous implementation exists today), E2EE
relationship tier (Phase 6). See `docs/wiki/roadmap.md` for phase gates.

See also: [backend.md](backend.md), [data.md](data.md), [dependencies.md](dependencies.md),
[../BUGS.md](../BUGS.md), [../wiki/testing.md](../wiki/testing.md).
