# Bridge AI — platform monorepo

Track B. The real backend behind the prototype. Platform-first: substrate → governance spine → capability runtime. Pages/Rituals/Tools are config instances, not bespoke code.

```
platform/
  packages/
    db/      Drizzle schema mirroring docs/raw/SCHEMA.sql + client factory
    core/    Universal Action Pipeline · Authority resolver · Policy engine · RitualExecutor seam (zero runtime deps)
  apps/
    api/     Fastify 5 + tRPC 11 surface over the pipeline
```

## The spine

Every mutation flows through the **Universal Action Pipeline** ([packages/core](packages/core)):

```
Request → Authority → Policy(pre) → Agent+Skill → Policy(runtime)
        → User Review(approve|veto|edit) → Ledger(append) → Policy(post) → Variance Adjuster → Output/Event
```

**Authority** (deny-default, 4 layers): `(role ∩ capability_scope) ∪ active ephemeral − deny`. On-behalf-of also ∩ principal authority. Seeded agent-floor DENY is non-removable.

**Determinism**: engine code takes `Clock` + `Rng` from `ctx` — never `Date.now()` / `Math.random()`. Replayable from the ledger.

## Commands

```bash
pnpm install
pnpm build       # turbo: db → core → api
pnpm test        # core pipeline conformance (node:test)
pnpm typecheck
```

`packages/core` has **zero runtime dependencies** and ships in-memory adapters, so the pipeline runs and is tested without a live database. `packages/db` (Drizzle) and `apps/api` (Fastify/tRPC) bind it to Supabase + the wire.
