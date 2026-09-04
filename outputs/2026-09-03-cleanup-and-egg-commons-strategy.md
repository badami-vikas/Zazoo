# Codebase cleanup + Egg/Commons split — audit and strategic path

Date: 2026-09-03. Tier C audit (read-only; no code changed). Four parallel audits over `platform/`
(egg completeness, duplication, dead/unlinked code, Module-to-Commons inventory) plus the 24 OPEN
entries in `docs/BUGS.md`. Numbers are from the tree at `542bfd7d`.

## 1. Shape of the problem

| Fact | Number |
|---|---|
| `apps/api/src/router.ts` | 23,139 lines, 33 namespaces, 361 procedures, 106 commits in last 400 |
| tRPC procedures with no client caller | 97 of 361 (27%) |
| Procedures with zero references anywhere, tests included | 9 |
| `InMemory*` store classes duplicating Drizzle stores | 28 (core) + PGlite/memory pair in `packages/local` |
| Hand-copied `assertPilotOrganization` / `assertMembership` guard pairs | 312 / 225 sites |
| Hand-copied `makeCaller()` test helpers | 39 files |
| Workspace packages with zero dependents | `module-host`, `services/commons` |
| Web files with zero importers | 8 (+ `uikit.html` entry never built) |
| Modules declared in `modules/manifests` | 11 (+2 skill manifests); only 6 have a `modules/<x>` package |
| Module code living inside the kernel (`packages/db` stores, `packages/core` task-manager/learning, `apps/web/pages/whatsapp`) | ~2,000 + ~4,000 + 3,610 LOC |
| Kernel→Module dependency edges that must break | `db→jobpilot`, `integrations-github→devpilot`, `web→whatsapp`, `api→{6 modules}` |
| CI jobs that cannot pass / never run / no-op | `prototype` (deleted dir), `desktop-bundle` (no `v*` tag ever), `pii-guard` |
| `docs/raw` | 125 files, 3.2 MB; 29 superseded, 33 referenced by nothing |
| ADR number collisions | ADR-158 ×7, 107 ×6, 160 ×6, 172 ×5, 175 ×4, and ~15 more |
| `outputs/` | 139 files, 2.6 MB, read by nothing |
| `Tools/recon-salvage-2026-08-03` | 788 KB second Next.js app, outside workspace and CI |

The debt is **structural, not sloppy**: name-level duplication is near zero, in-line TODOs are
four. What has rotted is (a) surfaces built server-side and never wired to a client, (b) one
composition root where Egg and every Module are fused, (c) three store families for one set of
ports, and (d) documentation that describes code the tree no longer has.

## 2. Answer: what part of the Egg is NOT fully built

Egg = kernel + Builder + Research/Learning agent + primitives (governance, trust, capability
registration, Memory, ModelProvider, surface compiler, Commons install). Status, worst first:

| # | Primitive | State | Evidence |
|---|---|---|---|
| 1 | **Builder surface** | server done, **no client** | `builder.run` (`router.ts:19657`) is the only `builder.*` procedure; nothing in `apps/web`/`apps/desktop` calls it; no `/builder` route. `learning.builderRuns` also client-less. |
| 2 | **Builder container sandbox** | **stub** | `NotImplementedContainerSandboxProvider.run()` throws (`packages/core/src/capability/sandbox-provider.ts:129`); no `SandboxProvider` bound in `wiring.ts` at all. TASK-092 NOT LANDED. Untrusted bodies have no execution path. |
| 3 | **Builder per-Module command policy** | inert | `apps/api/src/builder/run.ts:96` hardcodes `policy = {}`; nothing populates `ModulePrimitivePolicy`. |
| 4 | **Builder approval round-trip** | missing | a step needing approval stops the Run; no resume (BA4 unassigned). |
| 5 | **Commons registry UI** | built, **never mounted** | `CommonsCapabilityPanel.tsx` has zero importers outside two tests; no `/registry` route. |
| 6 | **Commons service** | built, **undeployed** | no `render.yaml` entry; six `COMMONS_*` vars undeclared; `BRIDGE_COMMONS_ARCHETYPES=0` makes `learning.archetypes.*` return `PRECONDITION_FAILED`. |
| 7 | **Commons stores manifests only** | partial | `services/commons/src/store.ts` holds `{manifest, provenance, signature}`; no code bundle, no SQL, no UI. "Install" today is a governance row over always-compiled code. |
| 8 | **Governance overlay for installed Modules** | partial | `declaredModuleGovernance` reads `BUILT_IN_MODULES` only; a Commons-installed Module cannot be governed. Only Accounting declares a `governance` block; only one enforcement site (`router.ts:18575`). |
| 9 | **Trust Model grant tier** | inert | `trustGrants: []` hardcoded at `router.ts:5204`, `:20748`, `:22281`. |
| 10 | **EventBus** | emit-only | one emit site (`pipeline.ts:869`), no reader; Automations/Signals cannot be event-driven, only cron. |
| 11 | **`capability.*` registration API** | 12/12 procedures client-less | superseded by `modules.*`; wire-or-delete decision open (TASK-037d). |
| 12 | **Agent orchestration** | substrate only | 8 `agentOrchestration.*` Goal/Task/childRun procedures client-less; research lane is the only consumer. |
| 13 | **ViewConfig persistence** | unbuilt | TASK-062 `ready`; every view choice dies on refresh; blocks lists, saved views, sharing, linked views, TASK-084 preview. |
| 14 | **Research agent** | **working end-to-end** | `/research` page, child-Run cancel, Parallel search Tier 1+2. Gaps: single vendor (TASK-040), keys via `InMemoryCredentialBroker` from env. |
| 15 | **ChatBackend / Claude Code** | working | `attachModule` has no UI control; `chat.model.stop` client-less; 8k reply truncation. |
| 16 | **PromptAssembler v1** | missing | named by both Builder BA0 and Learning LA1, built by neither. |
| 17 | **policyParams** | read-only | `DrizzlePolicyParamStore` bound, no write path. |
| 18 | **module-host** (out-of-process Module runtime) | built, **dead** | zero dependents; `accounting-store.ts:9` calls it dead weight. It is the only thing shaped like the runtime a Commons-installed Module needs. |
| 19 | **Memory** | working | no Mem0 adapter exists (comments only). |
| 20 | **Sensors / capture** | working on desktop | `input_permission_*` Tauri commands registered, never called (K11). |

**Bottom line for "install the Egg bare":** the Research agent and Chat are shippable today. The
Builder is a headless engine with no door, no sandbox, and no policy. Commons is a registry with
no server, no panel, and no code artifacts. Those three gaps are the Egg work; everything else in
§4 is cleanup that makes them cheaper.

## 3. Strategic path

Ordering principle: delete before moving, move before building. Each phase leaves `pnpm verify`
green. Phases 0–2 need no product decisions. Phase 3+ needs APPROVALS rows.

### Phase 0 — make CI honest (½ day, no decisions)
- Delete `prototype` and `pii-guard` jobs from `.github/workflows/ci.yml:341-380`; delete
  `scripts/check-no-pii.sh` + `.githooks` wiring; fix `.claude/launch.json:7`.
- Fix the two pre-existing red tests (BUGS 2026-08-30): unawaited nested `test()` at
  `apps/api/test/modules.test.ts:386`; pin TZ in `packages/core/test/input-capture.test.ts:325`.
- Resolve `check:vocabulary` red (BUGS 2026-08-08): the WhatsApp "Tool" family. Either rename or
  build the allowlist the script's own error message promises. Do not regenerate the baseline.
- Lint red: register `react-hooks` plugin (BUGS 2026-07-16); widen `no-crm-vocab` carve-out or
  move `dealpilot-store.ts` out of `apps/api` (it moves anyway in Phase 3).
- Decide `desktop-bundle`: cut a `v0.0.1` tag once to prove it, or delete 145 lines.
- Stop committing `apps/web/src/app/data/pending-work.generated.json` (172 commits of churn):
  generate at build time, gitignore it.

### Phase 1 — delete (1 day, no decisions)
Safe-to-delete list (zero importers, zero routes, zero tests depending):
`lib/routing-decision-display.ts`, `lib/exportTable.ts`, `lib/csvImport.ts`, `lib/useLocalEdits.ts`,
`components/ListPillRow.tsx`, `components/Breadcrumb.tsx`, `components/ui/table.tsx`,
`uikit.html` + `uikit-main.tsx`, `components/shared/Pill.tsx`, `TableSelectionBar.tsx`,
`apps/api/src/built-in-modules.ts` (48-line re-export shim), the 9 zero-reference procedures
(`taskManager.approvalBand`, `whatsapp.{stageExtraction,relationshipLinks,chatLink}`,
`learning.acceptanceAudit`, `graph.getRecord`, `capability.{submitForValidation,suspend,demoteOnDependencyChange}`),
`modules/dealpilot/src/keyring-credentials.ts`, unused deps (`cmdk`, `lodash`,
`react-responsive-carousel`, `proper-lockfile`, accounting `zod`, api `@bridge/{company-sourcing,dedupe,facts}`),
`Tools/recon-salvage-2026-08-03/` (move to an archive branch), stale Glide comments in
`StandardCellMenu.tsx:72`, `ModuleSurfaceLayout.tsx:30`, `TableView.tsx:975`, `cell-format.tsx:56`.
Keep `module-host` — it is the Phase 3 runtime, not dead code.

### Phase 2 — standardize (3–4 days, no decisions)
**Status 2026-09-03: DONE for items 1, 2, 3, 8 and the `useDismiss` half of 6.** Item 4 (store
family) awaits a user decision; item 5 (AES envelope) is TASK-038's; item 7 (micro-packages)
moves to Phase 3 as Commons content, not core; the rest of 6 and item 9 are open. Full api suite
581/580 after the split.

Ranked by LOC recovered / risk:
1. **`orgProcedure` middleware** replacing 537 inline guard pairs in `router.ts` (precedent:
   `dealpilotProcedure` at `router.ts:2476`). Mechanical, ~1,600 lines gone, closes a class of
   forgot-the-guard bugs.
2. **Split `router.ts` per namespace** into `apps/api/src/routers/<ns>.ts`, composed in one
   `appRouter`. No behaviour change. This is the precondition for every Module move.
3. **One `makeCaller()`** in `apps/api/test/caller.ts`; delete 39 copies.
4. **One store family.** Replace 28 `InMemory*` classes + `packages/local/src/stores/memory.ts`
   with a PGlite-backed `buildInMemoryPorts()` (PGlite already a dependency; `server.ts:61` is
   the only switch). Collapse `packages/core/test/*-store.test.ts` into a conformance suite run
   against both drivers. ~3,500 LOC and one whole test family removed.
5. **One AES-GCM envelope** (`packages/local/src/stores/oauth-token-crypto.ts` is the keeper;
   dealpilot's copy imports it). Forcing function for TASK-038's `@bridge/credentials`.
6. **One UI kit.** `Header` + `ModuleSurfaceLayout` won (21/13 importers); migrate the single
   `StandardToolbar` consumer, delete `StandardToolbar` + `ListDropdown`; collapse
   `StandardDropdown` + `ui/dropdown-menu` + `ui/popover` into one. One `useDismissOnOutside`
   hook replacing 7 copies (and the `mousedown`/`pointerdown` split). One
   `useModuleTableSurface(specId)` hook replacing the 9× page boilerplate. This IS TASK-061.
7. **Fold micro-packages into `@bridge/core`:** `capability-kit` (255 LOC, mirrors
   `core/capability/`), `facts` (105), `dedupe` (134). Three manifest schemas become one
   discriminated zod union in `core/module/manifest.ts`. `sensors` and `research` stay only if a
   second consumer is scheduled; otherwise fold.
8. **Small correctness fixes found in passing:** two `cosineSimilarity` with different semantics
   (`capability/registry.ts:101` vs `learning/retrieval.ts:205`, latent bug); two `scopePermits`
   (`authority.ts:90` private copy); `PILOT_ORGANIZATION` UUID declared in web and api
   independently (silent cross-tenant drift); one `makeStateMachine` for four bespoke
   `transition()` copies; one `defaultSeam` for seven `{nextId, nowISO}` literals.
9. **Conventions:** one ID generator (`ctx.run.ids.next()`; retire raw `uuidv7()`/`randomUUID()`
   at 25 sites), one `requireEnv()` for 94 raw `process.env` reads, a pino logger for 60+
   `console.*`, one shared `organizationId` zod fragment for 200 declarations.

### Phase 3 — physical Egg/Commons split (2–3 weeks, needs APPROVALS)
Target layout:
```
platform/
  egg/            core db local models research sensors net-guard module-host
                  apps/api (routers/{modules,commons,builder,chat,research,learning,governance,...})
                  apps/web (shell, dataviews, chat, avatar, routes registry) · apps/desktop
  commons/        accounting d2c devpilot jobpilot dealpilot academics events helpdesk whatsapp
                  <each: manifest.ts + api/ + web/ + migrations/ + test/>
  services/commons (registry; gains code-bundle storage)
```
Preconditions (build once, reuse for every move):
- **Dynamic web routes**: `routes.tsx` resolves `manifest.route` → lazy import from the Module
  bundle; `InstalledModuleBoundary` becomes the loader.
- **Dynamic api routers**: mount `packages/module-host` (`createHost`) so each Module contributes
  a `BridgeModule` tRPC router composed at boot from `module_installations`.
- **Per-Module migrations**: a `migrations/` dir per Module run at install; precedent
  `apps/api/src/d2c-migrations.ts`. `packages/db/migrations` 0027/0033/0034/0041/0042/0043 and
  the 7 Module stores (~2,000 LOC) leave `packages/db`.
- **Commons bundle format**: content-addressed `{manifest, js, sql, ui}` in the signed envelope;
  `security-scan.ts` and the privacy gate scan the bundle, not the manifest.
- **ESLint boundary rule**: `egg/**` may not import `commons/**`.
Move order (cleanest first, per audit): accounting → d2c → devpilot (break
`integrations-github→devpilot` first) → jobpilot (break `db→jobpilot`; extract tables from
`schema.ts:1196+`; culture-research constants out of `wiring.ts`) → dealpilot (strip `DEMO_DEALS`
from `wiring.ts`) → academics/events/helpdesk (create packages; unnest helpdesk from the
`relationship` router) → whatsapp (4,283 LOC Rust becomes a desktop plugin; 3,610 LOC pages leave
the shell) → task-manager (**split, not move**: decide whether goals/tasks are UAP primitives) →
relationship (last, or accept as the Egg's one bundled Module).
Also delete `seedBuiltInModules` (`wiring.ts:5177`), which rewrites manifests on every boot.

### Phase 4 — finish the Egg (2–3 weeks, product decisions)
In dependency order:
1. Deploy `services/commons` (render.yaml entry, `COMMONS_*` secrets); flip
   `BRIDGE_COMMONS_ARCHETYPES=1`; mount `CommonsCapabilityPanel` at `/registry`.
2. Bind a real `SandboxProvider` (container) in `wiring.ts`; delete `NotImplementedContainerSandboxProvider`.
3. Builder page: `/builder` route calling `builder.run`, Runs list from `learning.builderRuns`,
   approval-resume (BA4), populate `ModulePrimitivePolicy` from the Module manifest.
4. Governance overlay reads installed manifests, not `BUILT_IN_MODULES`; `trustGrants` from a
   store; second-Organization clause.
5. EventBus reader → event-driven Automations/Signals.
6. ViewConfig persistence (TASK-062) — unlocks five queued tasks.
7. Second search vendor (TASK-040); durable credential broker.
8. PromptAssembler v1; policyParams write path.
Wire-or-delete decisions (one APPROVALS row each): `capability.*` (recommend delete, 12 procs),
`agentOrchestration.*` (keep, wire to a Runs page), `jobpilot.cultureResearch.*` (8 client-less,
moves to Commons anyway), `integration.*` (6) + `google.*` (7; `GOOGLE_CLIENT_SECRET` is not
provisioned on Render so the integration cannot work in prod — provision or remove),
`taskManager.run*` (13 runners; keep if Automations invoke them, else delete).

### Phase 5 — docs (1 day)
- Archive the 29 superseded + 33 unreferenced `docs/raw` files to `docs/archive/`; archive
  `outputs/` older than 30 days.
- Renumber colliding ADRs or add an explicit "ADR ids are non-unique; cite by date+title" rule.
- Purge `module.yaml` and Module Detail from `CLAUDE.md`, `wiki/ui-architecture.md` (BUGS 2026-08-29).
- Fix the ADR-160 entry that still describes `GlideTableView`; ADR-194 (2026-08-06) replaced it.
- Regenerate `docs/CODEMAPS/architecture.md` with the Egg/Commons diagram after Phase 3.

## 4. Open bugs, triaged into the phases

| Bug | Phase |
|---|---|
| Stale `@bridge/api` types, `trpc.chat` missing (2026-07-27) | 0 — build order / turbo dep |
| Baseline lint red (2026-07-16), `no-crm-vocab` ×40 (2026-07-31), `check:vocabulary` red (2026-08-08), two red tests (2026-08-30), `sensors` coverage floor (2026-07-15) | 0 |
| Prototype CI job on deleted dir (2026-07-18), 7 HIGH audit advisories (2026-07-26) | 0 |
| `SandboxProvider` leaks `node:vm` into browser bundle (2026-07-07) | 2 (fold `capability-kit`, split exports) |
| Governance "Edit in Module Detail" circular link; nothing writes a policy (2026-08-29) | 4.4 |
| `module.yaml` / Module Detail in canon docs (2026-08-29) | 5 |
| Dummy-prefix ESLint rule contradicts reversal (2026-07-07) | 1 |
| Deprecated Tools visible / Module rows dead ends (2026-07-14); Second Brain graph (2026-07-14) | 3 (relationship move) |
| No per-Initiative scoping (2026-07-07); helpdesk topics caller-supplied; package_installation resourceType; `bridge.package.yaml` naming | 3 |
| WhatsApp: send ceiling can't tell manual from automated; `list_contacts` empty; downloads inert (2026-08-02/03) | 3 (whatsapp plugin) |
| Chat "no cloud provider" (secret only user can set); llama-server orphan guard; Radix Dialog ref warning; mobile app absent | unchanged — config / desktop / product |

## 5. Rejected alternatives
- **Move Modules first, clean later.** Rejected: 23k-line router and three store families make
  every move a rebase war; the audit found nothing moves cleanly until the router is split.
- **Keep `module-host` deleted.** Rejected: it is the only out-of-process Module runtime in the
  tree and exactly what a Commons install needs. Its "dead weight" status is a wiring gap.
- **Mark `capability.*` as Egg API and build a client.** Rejected: `modules.*` already carries the
  lifecycle; two lifecycle APIs is the duplication this plan removes.
- **Treat Supabase as Commons.** Not viable as-is: there is no `supabase/` dir; all SQL is
  `packages/db/migrations`. Commons needs a content-addressed code bundle store, which the
  existing `services/commons` Fastify registry is the right home for. Supabase can back it later.

## 6. What this document does not do
No code changed. No TASKS/APPROVALS rows written: Phase 3+ reorders roadmap and touches canon,
so it needs the user's approval in-session before any ledger edit.
