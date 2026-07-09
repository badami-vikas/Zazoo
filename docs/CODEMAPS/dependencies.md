<!-- Generated: 2026-07-04 | Files scanned: platform/{apps,packages,tools}/*/package.json | Token estimate: ~350 -->

# Dependencies Codemap

External (non-`@bridge/*`) runtime deps, per package — enumerated from actual `package.json`,
not assumed:

```
apps/api             @fastify/cors, @trpc/server, fastify, jose, zod
                      ⚠ no @fastify/rate-limit, no Redis/cache client, no CI runner dep
packages/db           drizzle-orm, postgres, @electric-sql/pglite
packages/local        @electric-sql/pglite  (local plane, private data, never reaches Supabase)
packages/integrations-google  googleapis  (zero retry/backoff lib — no p-retry, no got-with-retry)
packages/tool-kit     zod
packages/core         (none — pure TS, in-memory + port interfaces only)
packages/dedupe       (none — trigram similarity is hand-rolled, no fuzzball/string-similarity)
packages/facts, sourcing, tables  (none)
tools/dealpilot, jobpilot, people-sourcing,
  company-sourcing, recorder            (none — compose @bridge/* packages only)
```

## External services (not npm deps — runtime integrations)

```
Supabase Postgres    canonical/global plane — pgvector, pg_trgm, RLS (RLS not in migrations,
                     see known-issues)
Google APIs          Gmail + Calendar via googleapis OAuth — real, fail-closed when
                     unconfigured (no fixture fallback, unlike social providers)
Ollama / Groq        LLM calls exist ONLY in Tools/card-scanner and Tools/recorder — NOT in
                     platform/ core; JobPilot/DealPilot scoring is rule-based, no LLM bound yet
Cloudflare Pages     static hosting for the prototype UI only — manual wrangler deploy, no CI/CD
```

## Monorepo tooling

pnpm workspaces + turbo (`turbo.json`). No lockfile drift detected. `node --test` is the sole
test runner across every package — no vitest/jest, no coverage wired into `turbo run test`
(had to invoke `--experimental-test-coverage` manually — see [../wiki/testing.md](../wiki/testing.md)).
No `.github/workflows` — zero CI (see known-issues).

See also: [architecture.md](architecture.md), [backend.md](backend.md).
