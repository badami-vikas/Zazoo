# Platform bloat audit — 2026-08-02

Full-repo review (6 parallel area agents + 2 forensic agents) of `platform/` (~145k LOC TS).
Verdict: structurally healthy (no version drift, 2 TODOs total, no committed artifacts), but
~9–10k LOC dead/duplicated (~7%), three monolith files, and one probable security bug.

## P0 — escalate

- **Probable security bug**: `packages/core/src/pipeline.ts:104` — integration taint-sink
  condition reads `action !== "write"` (siblings use `!== "read"`): tainted turns can WRITE
  integration resources ungated while reads are gated. Fix is a one-token change + test; Tier C.
- Related pipeline hardening notes: `pipeline.ts:347` (human-only exemption via `!== "agent"`),
  `pipeline.ts:507` (post-skill egress re-check skip undocumented), `pipeline.ts:739,751`
  (synthesized `dataScope: "all"` echoed regardless of grant).

## Delete now (safe; recoverable from git; tag `pre-cleanup-2026-08-02` first)

| Item | LOC | Provenance |
|---|---|---|
| 29 unused shadcn primitives `apps/web/src/app/components/ui/` (incl. sidebar.tsx 726) | ~3,051 | Prototype port 1b4f5a2/9c3feba (2026-07-06/07); template leftover |
| Dead web components: PendingWorkPage, OrganizationTeamModal, EditableField, NotionCard, KanbanBoard, ListView, Captcha, Placeholder, figma/ImageWithFallback | ~610 | Superseded by DataViews / Task Manager module (c708017) or figma scaffolding |
| GlideTable.tsx + lib/columnTypes.ts + `@glideapps/glide-data-grid` dep | ~320 + bundle | Orphaned by 928d66e (TASK-009/014) — see Glide decision below |
| Dead web deps: tesseract.js, idb, browser-image-compression, date-fns | bundle/install | Camera tool removed 6590c71 without pruning deps |
| Dead api workspace deps: @bridge/dedupe, @bridge/facts, @bridge/company-sourcing (+tsconfig refs) | build graph | Never imported; arrive transitively |
| Schema tables `teamMembers`, `embeddingModels` | ~40 + migrations | Pre-pivot Track B leftovers (01f86d5); Tier C migration + APPROVALS row |
| `procedure` alias in api router.ts:487 (byte-identical to authenticatedProcedure) | ~5 | Latent auth hazard (name implies no auth) |

## Keep — roadmap-ahead, NOT debris (do not delete)

- **Core eval/self-improvement substrate** (`eval/*`, `policy/variance-adjuster.ts`,
  `capability/registry.ts`, `foreign-import.ts`, `builder-primitives.ts`, ~1,300 LOC):
  landed as roadmap batches M2/M4 (089421f, f81dbce, 1729a21) per ADR-026/027/060 +
  tunable-param ADRs; P3 canon still depends on them (AQV gates, variance adjuster,
  Commons import). Action: de-export from `src/index.ts` barrel (69 unused exports),
  mark experimental in codemap; keep tests green.
- **`@bridge/sensors`** (811 LOC): Rust `sensor_bridge.rs` mirrors it as its contract;
  Sensor SPI is P0 canon. Action: task to wire hub.ts to the bridge, not deletion.
- **Schema tables** `decision_traces`, `delegations`, `integration_sync_state`,
  `external_records`: named in design.md F2/F3, roadmap P4, tools.md intake flow. Keep.

## Glide / tables decision (needs explicit user call — canon)

- Original plan (tool-standardization-plan.md:79-81): TableSpec + **GlideTable renderer**.
  928d66e built `dataviews/` registry + shadcn TableView instead; no decision against Glide
  was ever recorded; STACK.md/wiki still claim glide-data-grid.
- DataViews IS the standard: all 7 pilot pages render through it. Stragglers: PendingWorkPage
  (dead), SettingsPage:379, ExecutionLedger.tsx:210,227 (bespoke `<table>`).
- Lost in the switch: inline cell edit, clipboard copy, column resize/reorder, canvas
  virtualization. TableView renders ALL rows — perf cliff on large datasets.
- Options: (a) revive Glide as a registered DataViews renderer for big datasets, or
  (b) delete Glide, virtualize TableView, restore cell features there, correct stack docs.
  Either way record the ADR this time.

## Consolidate (duplication → shared code)

1. **API org-guard**: `assertPilotOrganization`+`assertMembership` inlined ~140× →
   one `orgProcedure` middleware (~900 LOC; also removes a per-request DB round-trip).
2. **DB migration-test harness**: identical ~50-line helper in ~21 test files → shared
   `test/helpers/migrations.ts` (~1,000 LOC).
3. **graph-store person/community mirror methods** → generic per-verb helpers (~600–900 LOC).
4. **DealPilotStore record construction** implemented 3× (domain.ts / runtime-store.ts /
   api dealpilot-store.ts) → shared factories in domain.ts (~350 LOC).
5. **Credentials vault** (`modules/dealpilot/credentials*.ts`, ~1,189 LOC, domain-agnostic)
   → extract `@bridge/credentials` before jobpilot copies it.
6. **`scopePermits`/`tokensFor`** duplicated (authority.ts vs agent-scope.ts) — security-
   critical matcher; single canonical impl in authority.ts.
7. **Web server-state**: every page hand-rolls fetch/loading/error → shared
   `useTrpcQuery` or `@trpc/react-query` (~600 LOC + kills redundant refetches).
8. Small helpers: normalizeOptionalText (core/db), clamp01 (2× in core), clampMenuPosition
   (2× in web), Page/PageOpts pagination types (3 db stores).

## Structure fixes

- Split `apps/api/src/router.ts` (15,237 LOC, 214 procedures) into per-domain routers.
- Split `apps/api/src/wiring.ts` (4,838) and `packages/db/src/graph-store.ts` (4,889).
- Fix backwards layering: `packages/db` imports `normalizeLegacyFitFlag` from
  `modules/jobpilot` (jobpilot-store.ts:15) — move shared types down or store up.
- `apps/web`/`apps/website` tsconfigs don't extend base → weaker strictness than backend;
  add a shared `tsconfig.vite.json`.
- Route-level code-splitting: routes.tsx statically imports all pages (public helpdesk
  pays for whole authed app).
- turbo.json `lint` task dead (root script bypasses turbo); pick one.
- Pre-vocab legacy in `db/src/client-local.ts:68-80` needs deletion criterion/date.

## Root-cause patterns (learnings)

1. **Fidelity-port-everything**: July 6–7 prototype port copied entire component kit +
   package.json → shadcn dump, figma leftovers, dead deps.
   Rule: ports import on demand; a port PR must include an unused-file/dep sweep.
2. **Batch-executed roadmap without consumers**: M2/M4/M6 substrate landed 2026-07-14 with
   no runtime caller, then priorities pivoted to the prototype queue.
   Rule: code lands with its first consumer, or lands explicitly quarantined (non-exported,
   codemap-flagged "experimental, consumer: <planned task>").
3. **Supersede-without-delete**: DataViews, Task Manager module, Supabase runtime shipped
   but replaced files/deps stayed; stack docs never reconciled (Glide).
   Rule: a superseding TASK's exit test includes deleting/reconciling what it replaces
   (files, deps, tsconfig refs, STACK/wiki claims) + an ADR when it reverses a plan.
4. Supporting guardrails: knip (or ts-prune + depcheck) in CI for unused exports/deps/files;
   size gate on router.ts-style files; periodic `pnpm dedupe`-style audit task.

## EXECUTION RECORD — 2026-08-02 (TASK-029 wave 1)

WhatsApp safety check FIRST (user directive). Three active branches exist and all
three are DESCENDANTS of this branch's HEAD `1be17e1`:
`claude/whatsapp-module-contact-extractor-9cfff3` (contains `5b334ce` as the user
said; 96 files / +22,302), `claude/task030-whatsapp-relationship-link` (83 files),
`claude/whatsapp-tools-task030` (78 files). The module is real —
`platform/modules/whatsapp/` + `apps/web/src/app/pages/whatsapp/` +
`apps/desktop/src-tauri/src/whatsapp_*.rs`. Verified against every deletion target:
- ZERO importers of any deleted component on any of the three branches.
- All three use exactly the 10 SURVIVING ui primitives (badge, button, checkbox,
  dialog, dropdown-menu, input, label, popover, select, table).
- None import `GlideTable`, `columnTypes`, or any deleted page/dep.
- None touch `dataviews/` or `TableView`, so ADR-160 cannot conflict.
Correction to this document's earlier premise: the claim "no WhatsApp code in the
repo" was true only of THIS branch; it was never true of the repository.

Landed:
- ADR-161 security fix + `packages/core/test/integration-sink.test.ts`, verified
  red-then-green (2/3 fail pre-fix, 3/3 pass post-fix). Core 485→488.
- ADR-160 table renderers: new `dataviews/cell-format.tsx` (shared ADR-155
  semantics), new `dataviews/views/GlideTableView.tsx`, `TableView` split into a
  dispatcher + `DomTableView`. Glide overlay-editor chunks confirmed in the build.
- Deleted 29 ui primitives (28 unused + `use-mobile`; `utils.ts` KEPT — the
  surviving primitives import `cn` from it, which the original audit missed),
  11 dead components/pages, and 23 dependencies (19 Radix + tesseract.js, idb,
  browser-image-compression, date-fns).
- Verified: web build OK, web tests 106/106, core 488/488 + coverage gate,
  `turbo typecheck` 21/21.

NOT done in this wave, deliberately: the router.ts/wiring.ts/graph-store.ts splits
and the duplication consolidations. Three active WhatsApp branches sit on top of
this HEAD; a 15k-line router split would force each of them through a near-total
rebase. Sequence those AFTER the WhatsApp branches land.

## Recovery index (for anything deleted)

All deletions recoverable: `git log --diff-filter=D -- <path>` then
`git checkout <sha>^ -- <path>`. Tag `pre-cleanup-2026-08-02` before the sweep.
Deletion commits must be single-purpose and reference this doc.
