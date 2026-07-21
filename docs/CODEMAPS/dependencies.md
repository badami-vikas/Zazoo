<!-- Updated: 2026-07-21 | Files scanned: platform/{apps,modules,packages,services,tools}/*/package.json | Token estimate: ~400 -->

# Dependencies Codemap

External (non-`@bridge/*`) runtime deps, per package — enumerated from actual `package.json`,
not assumed:

```
apps/api             @fastify/cors, @fastify/rate-limit, @trpc/server, fastify, jose, zod
packages/db           drizzle-orm, postgres, @electric-sql/pglite
packages/local        @electric-sql/pglite  (local plane, private data, never reaches Supabase)
packages/integrations-google  googleapis  (zero retry/backoff lib — no p-retry, no got-with-retry)
packages/capability-kit  zod
modules/manifests     no external runtime dependencies; imports @bridge/core
packages/core         (none — pure TS, in-memory + port interfaces only)
packages/dedupe       (none — trigram similarity is hand-rolled, no fuzzball/string-similarity)
packages/facts, sourcing, tables  (none)
modules/dealpilot, jobpilot              compose @bridge/* packages; DealPilot also uses keyring
tools/people-sourcing, company-sourcing, recorder  internal Engine packages
```

## External services (not npm deps — runtime integrations)

```
Supabase Postgres    Cloud Plane operational store — pgvector, pg_trgm, tracked RLS
Google APIs          Gmail + Calendar via googleapis OAuth — real, fail-closed when
                     unconfigured (no fixture fallback, unlike social providers)
Model providers      @bridge/models provider seams; governed callers select through ModelProvider
```

## Monorepo tooling

pnpm workspaces + turbo (`turbo.json`). `node --test` is the sole
test runner across every package — no vitest/jest, no coverage wired into `turbo run test`
(had to invoke `--experimental-test-coverage` manually — see [../wiki/testing.md](../wiki/testing.md)).
GitHub Actions workflows exist, but hosted runners are payment-blocked; no CI success is claimed.

See also: [architecture.md](architecture.md), [backend.md](backend.md).
