# Design — Slice 1: Monorepo Skeleton + Shared Contracts

- **Date:** 2026-06-24
- **Status:** Draft (awaiting user review)
- **Program:** [Monorepo Unification](2026-06-24-monorepo-unification-program.md) — slice 1 of 6.
- **Scope:** `platform/` workspace only. **No web/recon relocation. No runtime behaviour change.**

## Goal

Lay the foundation for the merge: establish a shared-contract package inside the existing
`platform/` pnpm/Turbo workspace so later slices can give the web app end-to-end typed access to
the governed API. Slice 1 is pure foundation — it must leave every existing app behaving exactly
as today.

## Decisions (locked with user)

| # | Decision | Choice |
|---|----------|--------|
| 1 | Workspace root | **Keep in `platform/`** (already the pnpm@10.33.3 + Turbo workspace) |
| 2 | `contracts` scope (slice 1) | **Minimal** — shared zod input schemas + a published API type; web untouched |
| 3 | Relocation | **N/A for slice 1** — existing platform packages are already in their final `platform/`-rooted layout; web/recon move in slices 2–3 |

### Refinement to decision #2 (and why)
The user picked "publish `AppRouter` + zod inputs." Implemented literally — `@bridge/contracts`
re-exporting `AppRouter` *from `@bridge/api`* while `@bridge/api` imports schemas *from
`@bridge/contracts`* — creates a **package↔app dependency cycle**. To avoid it while fully meeting
the intent:
- `@bridge/contracts` **owns the zod input schemas** + their inferred TS types. `@bridge/api`
  imports them (one-way: app → package). Pure refactor; same schemas, same validation.
- The **`AppRouter` type stays exported by `@bridge/api`** (it is `typeof appRouter`, which must
  live with the router). Typed clients import it type-only — the canonical tRPC monorepo pattern.

Net: the seam's input contract is shared and single-sourced; the router type is published and
consumable; no cycle.

## What slice 1 changes

### New package: `platform/packages/contracts` (`@bridge/contracts`)
- `package.json` (name `@bridge/contracts`, private, `main`/`types` → built `dist`, `zod` dep,
  build/typecheck scripts mirroring sibling packages).
- `tsconfig.json` matching the other packages (composite/project-ref style if they use it).
- `src/index.ts` exporting the shared **named zod input schemas** moved verbatim from
  `apps/api/src/router.ts`:
  `actorSchema`, `onBehalfOfSchema`, `proposeInput`, `decideInput`, `ritualStep`,
  `ritualRunInput`, `ritualRunByIdInput`, `agentCreateInput`, `agentUpdateInput`,
  `ritualCreateInput` — plus `z.infer<>` input types for each.
- These schemas reference `@bridge/core` types; `@bridge/contracts` therefore depends on
  `@bridge/core` (same as `apps/api` already does). One-way, no cycle.
- The handful of **inline** `.input(z.object({…}))` schemas in `router.ts` (e.g. google/tool/
  integration sub-routers) stay inline in slice 1 — moving them is optional later cleanup, not
  needed for the foundation. (Documented so it isn't mistaken for an omission.)

### Edit: `platform/apps/api/src/router.ts`
- Remove the named schema definitions listed above; import them from `@bridge/contracts` instead.
- Add `@bridge/contracts` to `apps/api`'s `package.json` deps.
- **No procedure logic changes.** Same schemas → identical validation → identical behaviour.

### Workspace wiring
- `packages/contracts` is picked up automatically by the existing `packages/*` glob in
  `platform/pnpm-workspace.yaml` — no workspace-file edit needed.
- Turbo tasks (`build`/`typecheck` with `^build`) already cover it generically; verify
  `@bridge/contracts` builds before `@bridge/api` via the dependency edge.
- `pnpm install` to link the new workspace package.

## Architecture / boundaries

```
@bridge/core  ──used by──▶  @bridge/contracts  ──used by──▶  @bridge/api ──exports type AppRouter──▶ (future) apps/web
                                  (zod input schemas)            (router + procedures)
```

- `@bridge/contracts` is a leaf-ish package: depends only on `@bridge/core` + `zod`. It must never
  depend on an app. This rule is what keeps the graph acyclic and is the whole point of the refactor.
- Single source of truth for the seam's input validation now lives in `@bridge/contracts`.

## Non-goals (slice 1)

- No changes to `apps/web` (prototype) or `Tools/recon` — they don't move and don't adopt
  contracts yet (that's slices 2–3).
- No relocation of existing platform packages (they're already correctly placed).
- No move of inline router schemas, no domain-vocabulary-type centralization (deferred to slice 2).
- No deployment, no API behaviour change.

## Risks

- **R1 — Build-order / project references.** If the platform packages use TS `composite` project
  references, `@bridge/contracts` must be added to `apps/api`'s `references` and the root solution
  tsconfig. Plan verifies `pnpm -r typecheck` resolves the new edge. Low risk; mechanical.
- **R2 — Accidental behaviour drift.** Mitigated by moving schemas *verbatim* (no edits) and
  diffing the effective schema set. Acceptance includes a build + typecheck of `apps/api`.
- **R3 — exactOptionalPropertyTypes** strictness (the file already has `cleanOnBehalfOf` shims) —
  moved schemas must keep identical optionality. Verbatim move preserves this.

## Verification / acceptance

1. From `platform/`: `pnpm install` succeeds; `@bridge/contracts` is linked.
2. `pnpm -r typecheck` green across all packages including `@bridge/api` consuming contracts.
3. `pnpm -r build` (turbo) green; `@bridge/contracts` builds before `@bridge/api`.
4. Grep confirms `router.ts` imports the named schemas from `@bridge/contracts` and no longer
   defines them locally.
5. `apps/api` server still boots (smoke) and the tRPC surface is unchanged (procedure list +
   input shapes identical) — proving no behaviour change.

## Files touched (anticipated)

**New:** `platform/packages/contracts/{package.json,tsconfig.json,src/index.ts}`
**Edited:** `platform/apps/api/src/router.ts`, `platform/apps/api/package.json`,
possibly `platform/apps/api/tsconfig.json` + a root solution tsconfig (only if project refs are used).
**Docs:** `docs/log.md` entry; ADR in `docs/raw/decisions-log.md` (contracts package + acyclic
boundary rule); update the wiki stack page if it enumerates packages.
