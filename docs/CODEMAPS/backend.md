<!-- Generated: 2026-07-04 | Files scanned: platform/apps/api/src, platform/packages/core/src | Token estimate: ~550 -->

# Backend Codemap

Fastify + tRPC (`apps/api/src/server.ts` → `createContext` in `context.ts` → `router.ts`).
No REST layer — tRPC is the sole API surface. `onError` in server.ts only logs; no typed-error
→ HTTP-status mapping (see known-issues: everything bubbles as 500).

## Routes (tRPC procedures, `apps/api/src/router.ts`)

```
health.query                        → { ok: true }

action.propose  → core.pipeline.propose   → Authority+Policy pre-check, Ledger append (pending)
action.decide   → core.pipeline.decide    → resolve proposal, commit, emit event
                    ⚠ no transaction/unique-constraint — concurrent decide = double-approve

google.list/connectUrl/disconnect          → GoogleService (packages/integrations-google)
google.syncGmail/syncCalendar/listEvents   → IntakeService (poll-only, no webhooks)
google.proposeSend                          → egress.ts, draft created pre-approval (known issue)

agent.create/update                        → governance-stores.ts, capability scope stripped
                                               server-side (isForbiddenAgentToken)

ritual.create/run/runById                  → InProcessRitualExecutor (packages/core) — sync,
                                               in-request, no queue, no resume on crash

dealpilot.source/commit/list                → @bridge/tool-kit intake seam + DealPilot pipeline
                                               ⚠ workspaceId param accepted but ignored —
                                               single global in-memory capture store

tool.run                                    → generic ritual-run-by-id wrapper

integration.list/connect/disconnect/
  listScopes/grantScope/revokeScope         → integration-store.ts, ALWAYS_APPROVAL_SCOPES
                                               floor (2nd copy of the agent-floor deny list)
```

## Core pipeline (`packages/core/src/`)

```
pipeline.ts          UniversalActionPipeline: propose() → decide() → #commit() → emit()
                      post-Policy phase result is computed but discarded (advisory only)
authority.ts          resolveAuthority(): role grants, ephemeral grants, delegation, agent
                      capability scope intersection, AGENT_FLOOR_MUTATIONS hard deny
agent-scope.ts        buildAgentCapability(), isForbiddenAgentToken() — 2nd floor-list copy
ritual-executor.ts    InProcessRitualExecutor — sequential steps, halt-on-reject, NO rollback
                      of already-committed prior steps
memory/stores.ts      InMemory{Ledger,EventBus,EphemeralStore,...} — unbounded, no eviction;
                      this is the default when DATABASE_URL is unset (production risk)
skills.ts             Skill registry; each skill.run(inputs: unknown, ctx) — no per-skill
                      zod validation (inputs is z.unknown() all the way from the router)
```

## Cross-cutting gaps (see ../BUGS.md for full detail)

- No rate limiting, no caching layer (grep-confirmed zero hits in apps/api, packages/core).
- CORS `origin: true` — any site can call the API.
- No CI; turbo build cache has replayed stale cross-worktree logs (reproduced live 2026-07-04).

See also: [architecture.md](architecture.md), [data.md](data.md),
[../BUGS.md](../BUGS.md).
