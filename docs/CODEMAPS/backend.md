<!-- Updated: 2026-09-11 | Files scanned: platform/apps/api/src/{server,context,router,wiring,relationship-materializer}.ts, platform/packages/core/src, platform/packages/db/src/{graph,ledger,relation-materialization,governance-stores}.ts | Token estimate: ~850 -->

# Backend Codemap

Fastify + tRPC (`apps/api/src/server.ts` → `createContext` in `context.ts` → `router.ts`, which since 2026-09-11 (ADR-258) only composes `routers/<domain>.ts` (35 files) over `router-shared.ts` — schemas, middleware, helpers, the `t` instance). `procedure` = identity → public-cloud boundary → pilot guard → `withOrganizationInput` (pilot-org + membership check whenever the input carries an `organizationId`); `publicProcedure` skips identity and the org guard (helpdesk token surface only).
No REST layer — tRPC is the sole API surface. `onError` in server.ts only logs; no typed-error
→ HTTP-status mapping (see known-issues: everything bubbles as 500).

## Routes (tRPC procedures, `apps/api/src/routers/*.ts`)

```
health.query                        → { ok: true }

action.propose                       → Authority+Policy+Goal/Task Skill gates, Ledger append
action.decide                        → append decision first; validate/materialize domain effects
action.pending/listHistory/resolution→ authenticated bounded Ledger projections; private-owner filter

google.list/connectUrl/disconnect          → GoogleService (packages/integrations-google)
google.syncGmail/syncCalendar/listEvents   → IntakeService (poll-only, no webhooks)
google.proposeSend                          → egress.ts, draft created pre-approval (known issue)

agentOrchestration.goal/task.*              → workspace-scoped GoalTaskStore
agentOrchestration.skill.resolve            → active assignment + manifest/authority/Plane/data gates
agentOrchestration.childRun.get/list/cancel → authenticated workspace inspection/stop
                                                (no public create; server runtime only)

agent.create/update                        → governance-stores.ts, capability scope stripped
                                               server-side (isForbiddenAgentToken)

ritual.create/run/runById                  → InProcessRitualExecutor (packages/core) — sync,
                                               in-request, no queue, no resume on crash

relationship.nodeTypeOwner/listRelations   → owner-aware graph reads; composite keyset cursor
relationship.proposeSignalEvidence         → Human-only private Relation proposal
relationship.materializationStatus/
  outstandingMaterializations/
  retryMaterialization/reconcileApproved   → durable decision-effect status and replay

dealpilot.module/records/record/...         → Deals/Sources/Theses store + governed discovery
dealpilot.source/commit/list                → @bridge/tool-kit quarantine/commit seam

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
goal-task.ts          workspace Goal/Task store; active assigned Task is Skill eligibility source
skill-manifest.ts     workspace manifest registry + fail-closed Agent/Task/authority resolver
child-agent-run.ts    parent-ceiling intersection, deadline/budget/lifecycle/audit contracts
```

Persistent adapters include `goal-task-store.ts`, `skill-manifest-store.ts`,
`child-agent-run-store.ts`, `graph-store.ts`, `ledger-store.ts`, and
`relation-materialization-store.ts`. Migration `0015` follows orchestration migration `0014`
and adds Relation/effect owner constraints, RLS, indexes, and verified legacy linkage repair.

## Cross-cutting gaps (see ../BUGS.md for full detail)

- CORS: explicit `API_ALLOWED_ORIGINS` → Render origin → empty in production; `origin: true` only in bare dev (`server.ts corsOriginConfig`).
- Scheduled jobs (`server.ts`) run under `withLease` rows in `job_leases`; `@fastify/rate-limit` uses a Postgres store (`rate_limit_buckets`) when `DATABASE_URL` is set (migration 0045). The Automation scheduler tick is not yet leased.
- No CI; turbo build cache has replayed stale cross-worktree logs (reproduced live 2026-07-04).
- Domain routers share one decision/effect orchestrator in `router-shared.ts`; merge reviews must preserve every pre- and post-decision hook.
- Budgets, kill switch, and OTP proofs are state-port backed when a durable Local Plane dir exists (`wiring.ts`); still process-local by design: in-flight outreach dedupe, capture stage locks, chat abort controllers, app-focus capture ledger.

See also: [architecture.md](architecture.md), [data.md](data.md),
[../BUGS.md](../BUGS.md).
