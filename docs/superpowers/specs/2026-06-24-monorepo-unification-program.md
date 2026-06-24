# Program — Bridge AI Monorepo Unification

- **Date:** 2026-06-24
- **Status:** Program overview (decomposition only — each slice gets its own spec)
- **Decision:** Merge the three Bridge AI apps into the existing pnpm/Turbo workspace.
  End state = **monorepo unification** (one repo, one type graph, separately deployable apps),
  NOT full single-app fusion.

## Why this is a program, not a task

Three apps, three stacks, ~40k LOC total, currently in three folders:

| App | Stack | Role | Today |
|---|---|---|---|
| `Design Bridge AI Interface (Copy)/` | React 18 + Vite 6 + React Router 7 SPA (~23k LOC) | User-facing Bridge web app | Deployed to Cloudflare Pages; Supabase-direct + optional tRPC seam |
| `platform/` | pnpm+Turbo monorepo: `@bridge/core`, `@bridge/db`, `@bridge/local`, `@bridge/integrations-google`, `apps/api` (Fastify+tRPC) (~8.6k LOC) | Governed backend runtime (Universal Action Pipeline / Authority / RitualExecutor) | Not deployed |
| `Tools/recon/` | Next.js 15 + Supabase + MV3 extension (~8.2k LOC) | OSINT Tool + analyst approval UI; feeds Bridge via `addToBridge()` | Local only |

**They are already designed to integrate via seams** (prototype's `VITE_API_URL` tRPC seam →
`apps/api`; recon's `lib/bridge.ts` → `CaptureEnvelope` → `pipeline_proposal` intake). The merge
is about **unifying the repo, wiring those seams live, and deploying together** — not rewriting.

## Target topology

The existing `platform/` workspace is promoted/extended to host everything:

```
<workspace root>
  apps/
    web/         ← prototype SPA (was "Design Bridge AI Interface (Copy)/")
    recon/       ← Recon Next.js app (was Tools/recon/)
    api/         ← platform Fastify+tRPC gateway (existing)
  packages/
    core/        ← @bridge/core (existing)
    db/          ← @bridge/db (existing)
    local/       ← @bridge/local (existing)
    integrations-google/  ← (existing)
    contracts/   ← NEW: shared domain types + tRPC contract + zod schemas
    extension/   ← Recon MV3 extension (was Tools/recon/extension/)
  pnpm-workspace.yaml · turbo.json · package.json (root)
```

Apps stay independently deployable (web → Cloudflare Pages; api → server; recon → Cloudflare per
the prior extension spec). Unification = shared dependency graph + shared `packages/contracts`,
not one server.

## Slice breakdown (dependency-ordered; each = its own spec → plan → build)

**Slice 1 — Monorepo skeleton + shared contracts.** *(next; design now)*
Establish the unified workspace at the chosen root; relocate the existing `platform/` packages;
create `packages/contracts` (shared domain types + the tRPC contract the web seam already expects).
Acceptance: `pnpm install` + `pnpm -r typecheck/build` green from the new root; **no app behaviour
change**. Pure foundation.

**Slice 2 — Web frontend → `apps/web`.**
Relocate the Vite SPA into the workspace; wire into Turbo; consume `packages/contracts` types where
the tRPC seam references them. No functional change — still Supabase-direct + optional seam; still
deploys to the same Pages project. Acceptance: web builds/typechecks/deploys; app mounts unchanged.

**Slice 3 — Recon → `apps/recon` + extension → `packages/extension`.**
Relocate Recon and its extension. **The prior spec
(`2026-06-24-recon-extension-deploy-and-linkedin-send-design.md`) folds in here** — configurable
backend URL, LinkedIn connection-send, shared-secret guard — now targeting the unified structure.
Acceptance: recon + extension build from the monorepo; planned extension features work.

**Slice 4 — Deploy `apps/api` + flip the web tRPC seam live.**
Deploy the Fastify+tRPC gateway; point `apps/web`'s `VITE_API_URL` at it so governed writes flow
through the Universal Action Pipeline (Authority → Policy → Ledger → Approval) instead of
Supabase-direct. Acceptance: a web write is observable end-to-end through the pipeline + ledger.

**Slice 5 — Wire recon → pipeline live; consolidate duplicate write paths.**
`addToBridge()` hits the deployed pipeline; reconcile the three "staging/approval" concepts
(recon JSONL · prototype Approvals UI · platform ledger). Retire Supabase-direct writes the
platform now owns. Acceptance: recon findings surface as pipeline proposals in the web Approvals UI.

**Slice 6 — Cleanup (optional).**
Single tsconfig/lint base, workspace CI, retire the legacy top-level folders, dedupe types.

## Risks carried across the program

- **R-A — Two Supabase access patterns coexist** during slices 2–5 (direct client vs. pipeline).
  Plan must keep both working until slice 5 retires the duplicates; no big-bang cutover.
- **R-B — Three stacks under one workspace** (Vite, Next.js, Fastify, plus pnpm/Turbo). Build
  tooling must accommodate all three; Turbo task graph kept simple per app.
- **R-C — Recon's filesystem JSONL store** (from the prior spec's R1) still blocks serverless
  recon deploy; remains a follow-on, not resolved by the merge.
- **R-D — Relocation churn** (imports, paths, deploy configs, the untracked PII build artifacts
  noted in project memory). Each relocation slice verifies build + deploy before declaring done.
- **R-E — Git history / large move.** Relocations are large diffs; do them per-slice, verified.

## Out of scope (whole program)

- Full single-app fusion (one server for everything).
- Resolving recon's JSONL→Supabase migration (R-C) — separate follow-on.
- Any new product features beyond the already-specced extension work.
