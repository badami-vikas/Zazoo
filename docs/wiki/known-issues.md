# Known Issues

Cross-session ledger of bugs / gaps / abnormalities. Persist across sessions. Agents:
spot something off → add row here, do NOT wait for user ask. Fix → mark RESOLVED + date.
Full rationale of decisions → [../raw/decisions-log.md](../raw/decisions-log.md).

Status: OPEN | IN PROGRESS | RESOLVED. Newest first.

---

- **OPEN — No rate limiting or caching layer anywhere in apps/api; turbo cache replays stale
  logs across worktrees (live-reproduced).** Grep-confirmed zero `rateLimit`/Redis/LRU in
  `apps/api/src`, `packages/core/src` — combined with the already-logged `CORS origin:true`,
  the API has no abuse-rate defense at all. Also: running `turbo run build` in THIS worktree
  replayed cached logs stamped with a path from a different worktree
  (`friendly-chandrasekhar-5eccb0`) before `--force` was used — live reproduction of the
  "no CI; turbo cache replays across worktrees" entry below; confirms it's not theoretical.
  Fix: add `@fastify/rate-limit` (or equivalent) keyed by IP+identity; `turbo.json` should key
  cache on an absolute-path-free hash or CI should always pass `--force`.

- **OPEN — Test coverage inversely correlates with risk on the exact files the 2026-07-04 review
  flagged.** Real `node --test --experimental-test-coverage` run (this repo had never had
  `pnpm install` run in this worktree — no `node_modules` — installed + built fresh to get real
  numbers, not cached ones):
  - `apps/api` test target covers only `social/*` (2 tests total) — `router.ts`, `wiring.ts`,
    `identity.ts`, `server.ts` (the biggest attack surface, including the double-approve `decide()`
    path and the pinned-workspace wiring) have **zero test files and don't even appear in the
    coverage report**.
  - `packages/integrations-google` is the worst-covered package (54.16% line / 27.82% funcs)
    and the undercoverage lands exactly on the buggy files: `gateway-google.ts` 13.18% line/0%
    funcs (contains the fire-and-forget token-refresh bug + N+1 thread fetch), `oauth.ts` 28.77%
    line/0% funcs, `intake.ts` 8.70% line (contains the check-then-act `hasExternal` race).
  - `packages/db` store layer: `canonical-store.ts` 39.71%/0% funcs, `governance-stores.ts`
    41.04%/45.45% funcs, `ledger-store.ts` 39.80%/57.14% funcs (the `__refLedgerId` jsonb hack
    lives here), `ritual-stores.ts` 34.88%/54.55% funcs — all under half covered.
  - `jobpilot/pacing.ts` (the `PacingGate` already flagged as dead code — zero production callers)
    is 100% line-covered in isolation — proof that unit coverage can be perfect while the safety
    invariant it exists for is unenforced anywhere in the real system.
  - Healthy by contrast: `packages/core` 94.02%/80.65%, `packages/dedupe` 100%/86.11% (though
    the tie-break bug in `match.ts:28` isn't covered by an equal-score test case despite 100%
    line coverage — line coverage ≠ edge-case coverage), `jobpilot` overall 80.11%/86.31%.
  Fix: see `docs/raw/testing-strategy.md` for prioritized test list (once drafted).

- **OPEN — P0 batch from 2026-07-04 platform code review (3 parallel staff-level review passes).**
  Verified against code, each independently ship-blocking:
  1. **RLS not in version control.** No `ENABLE ROW LEVEL SECURITY` / `CREATE POLICY` anywhere in
     `platform/packages/db/migrations/` — RLS was applied out-of-band to live Supabase. Fresh
     provision (DR, staging, new env) = zero RLS on every table. Fix: check applied policy DDL in
     as `0002_rls_policies.sql` + CI check that `pg_policies` is non-empty for tenant tables.
  2. **RESOLVED (2026-07-04, journal + 4 latent bugs it exposed — RLS DDL still missing) —
     Migration journal only tracked `0000`.** Renamed `001_add_recon_columns.sql` →
     `0002_add_recon_columns.sql` (drizzle 4-digit convention) and registered `0001_governance_seed`
     + `0002_add_recon_columns` in `migrations/meta/_journal.json`. **Correction to this entry's
     original claim of "safe to replay":** that was wrong — `0001`/`0002` had never actually been
     exercised via `drizzle-kit migrate`/pglite before (only run manually against prod psql), and
     registering them surfaced 4 real, previously-latent bugs in `0001_governance_seed.sql`, all
     fixed same session, verified via `packages/db`'s local-plane pglite test suite (5/5 green):
       a. Zero `--> statement-breakpoint` markers → drizzle's migrator sent the whole file as one
          exec call → pglite rejected multi-statement execs. Added breakpoints after every
          top-level statement (0000 has 106 of these; 0001/0002 had none).
       b. `create extension if not exists "pgcrypto"` — pglite doesn't bundle pgcrypto as a
          loadable extension (only ships it as a raw `.tar.gz`, no JS import path, unlike
          `vector`). Verified nothing in the schema actually calls a pgcrypto-specific function
          (`crypt`/`digest`/`pgp_sym_*`) — `gen_random_uuid()` is a PG13+ core builtin. Removed
          the vestigial `CREATE EXTENSION pgcrypto` line entirely rather than fight pglite's
          extension loader for an unused dependency.
       c. `drop index if exists "role_permissions_uq"` — that name is a table CONSTRAINT
          (`0000`: `CONSTRAINT "role_permissions_uq" UNIQUE(...)`), not a bare index; Postgres
          requires `ALTER TABLE ... DROP CONSTRAINT` for constraint-backed indexes. Fixed.
       d. `revoke ... from anon, authenticated` — those are Supabase's PostgREST roles, which
          exist on the cloud target this file was written for but NOT on the local pglite plane
          (a vanilla, single-role Postgres per `client-local.ts`). Wrapped the revoke loop in a
          `pg_roles` existence check per role so the same file applies cleanly to both targets.
     **Not resolved:** RLS policy DDL still lives only in the live Supabase project (no migration
     file for it — this session had no read access to the actual Bridge AI Supabase project, only
     an unrelated connected project, "CorpSim"). Someone with access must `pg_dump --schema-only`
     or query `pg_policies`/function definitions and check the DDL in as `0003_rls_policies.sql`.
     Also still true: agent-floor DENY block in `0001` is a documented template, "not executed"
     — the DB-level backstop for the agent-floor invariant does not exist; enforcement is
     app-layer only (separate from the journal fix, remains open).
  3. **`decide()` double-approve TOCTOU.** `core/src/pipeline.ts:171-206` get→decisionFor→append
     with no transaction/lock; resolution linkage lives in jsonb magic key `__refLedgerId`
     (`db/src/ledger-store.ts:17`) with no unique index. Two concurrent decides (double-click,
     retry) both pass the check → double-commit → double-fire `onApproved` → external send twice.
     Fix: real `ref_ledger_id` column + partial unique index + catch-unique-violation in decide.
  4. **DealPilot `workspaceId` accepted but ignored + captures in-memory unconditionally.**
     `wiring.ts:212` `createInMemoryCaptureStore()` with no DATABASE_URL branch (restart = sourced
     captures vanish; `tool_captures` table exists only in comments, not schema); `dealpilot.list`
     takes `workspaceId` but reads the single global store — cross-tenant leak the moment a second
     workspace exists. Google integration likewise pinned to `PILOT_WORKSPACE` in wiring (no
     workspace threading through `google.*` procedures).
  5. **`matchOne` non-deterministic tie-break feeding auto-merge.** `dedupe/src/match.ts:28`
     `if (score < best.score) continue` — equal scores overwrite, later target wins, array order
     decides which entity a `strong` match auto-merges into (violates
     ambiguous-duplicates-as-signals). Same code path used by dealpilot/jobpilot/people/company
     sourcing. Fix: deterministic tie-break; on exact tie downgrade to moderate (human review).
  6. **Google gateway: zero retry/backoff/quota handling + N+1 sequential `threads.get` per sync
     + fire-and-forget token persist** (`gateway-google.ts:233-241` `void putToken` — rotated
     refresh token that fails to persist bricks the integration silently). Fix: shared
     backoff helper, `.catch()`+health flag on token persist, batch/limit thread fetches.
  7. **`inputs: z.unknown()` through the "single validate+sanitize chokepoint"** (`router.ts:89`)
     → unvalidated client payload flows to `skill.run` and the ledger; `envelope as never` at
     `router.ts:310` bypasses typing entirely. Fix: per-skill zod schemas + discriminated union
     for envelopes.
  8. **JobPilot `PacingGate` is dead code** — exported, zero callers; the max-apps-per-day safety
     invariant is not enforced anywhere despite reading as shipped. Wire it or mark experimental.
  Full P1/P2 lists also verified (unbounded in-memory stores, no pagination on any list endpoint,
  ritual halt leaves committed steps un-rolled-back, post-policy `block` is a no-op,
  `timeline_entries` has no workspace/occurred_at index, missing hnsw index on embeddings,
  nullable-unique dedup_key, enum-as-text without CHECKs, no updated_at on mutable tables,
  BizBuySell parse-null-rate unmonitored, `hasExternal` check-then-act double-propose window,
  Gmail sync double-click duplicate proposals).

- **OPEN — Persistent mode contradicts the local-ledger residency guarantee.** `wiring.ts` header
  says "The ledger MUST stay local for private proposals" but the `DATABASE_URL` branch binds
  `ledger = ports.ledger` (Drizzle → cloud Postgres). Private-proposal bodies would land in the
  cloud ledger the moment persistence is turned on. Decide: split ledger by data_scope (private →
  local plane) or drop the guarantee explicitly. Spotted 2026-07-04 audit review.

- **OPEN — Persistent mode silently discards canonical identity writes.** `wiring.ts:259` binds
  `canonical = new InMemoryCanonicalIdentityStore()` even when `DATABASE_URL` is set ("avoids
  writing identity without intent") — so in the most production-like config, canonical dual-writes
  vanish on restart with zero signal. Needs an explicit env flag + loud log, not a silent fake.
  Spotted 2026-07-04 audit review.

- **OPEN — Persistent mode never seeds governance.** `seedGovernance()` runs only in the in-memory
  branch of `buildWiring()`; with `DATABASE_URL` set, agents/roles/user grants come only from
  migrations (`0001_governance_seed.sql` covers policies). If the pilot agent grants aren't in a
  migration, first persistent boot = every propose denied. Verify + move seeds to migrations.
  Spotted 2026-07-04 audit review.

- **OPEN — `action.propose` lets the client pick any agent id, plane, and workspaceId.**
  `router.ts:174-184`: human identity is server-resolved, but an `actor.type==="agent"` request
  keeps the client-supplied agent id, client-supplied `plane` tag, and client-supplied
  `workspaceId` (no membership check). Any origin (CORS open) can drive any agent in any
  workspace. Fix in the auth-binding pass: agent id ∈ workspace's registered agents, plane
  server-derived, workspace ∈ identity's memberships. Extends the existing identity issue.

- **OPEN — Social fixture `draftId` collision + unbounded array.** `fixtures.ts:47-53`: draftId =
  `published.length + 1`, but only `publish` pushes — two drafts before a publish share
  `dummy_x_draft_1`; `published` also grows unboundedly. Trivial fix (own counter), but real
  proposals keyed by these ids would collide. Spotted 2026-07-04 audit review.

- **OPEN — Prototype canonical loaders: fixed 29-page fan-out, silent truncation at 30k, page
  errors swallowed.** `db.ts:64-83`: when row 1000 exists, it always fires 29 parallel range
  queries (waste at 1.5k rows), silently truncates datasets >30k, and per-page errors become
  `[]` (partial data labeled `source:'supabase'`). Bare `catch {}` also hides programming errors
  as "local fallback". Fold into the silent-fallback fix: loop-until-short-page + warn + badge.
  Spotted 2026-07-04 audit review.

- **OPEN — Prototype root carries duplicate merge-artifact config files.** `Design Bridge AI
  Interface (Copy)/` contains `package-1.json`, `vite.config-1.ts`, `postcss.config-1.mjs`,
  `ATTRIBUTIONS-1.md` alongside the real files — stale `-1` copies from an earlier merge/import.
  Confusing (which config is live?) and one `npm install` away from someone editing the wrong
  file. Fix: diff each against its live twin, delete the `-1` copies. Spotted 2026-07-04
  during full platform-readiness audit.

- **RESOLVED (2026-07-04) — DealPilot's real connector/quarantine flow re-wired onto the UI-standardized page.** Follow-up to the divergent-implementations merge below: verified the real backend is genuinely live (`platform/apps/api/src/router.ts` `dealpilot.source/commit/list`, backed by `platform/tools/dealpilot`'s BizBuySell/BusinessBroker connectors + `@bridge/tool-kit`'s intake seam, 19+9 passing tests) and its DTO shape matches the prototype's `data/api.ts` exactly. Extended `data/dealpilot.ts` additively (`useLiveListings`/`usePendingCaptures`/`sourceListings`/`commitCapture`/`useDealPilotSourcing`, gated by `API_ENABLED`, all existing exports untouched) and wired `DealPilotPage.tsx`: a "Source new listings" toolbar action + a quarantine strip (sourced-but-uncommitted captures, each with an "Add" button — a real action button, not a fit-card, so it doesn't conflict with the flags-are-the-action rule) that merges committed listings into the same Card/Kanban/List views alongside the dummy_ demo set. Demo mode (API disabled) verified unchanged via a temporary test route (reverted). `tsc`/`vite build` clean, `turbo run build/test --force` 15/15 + 28/28 green.

- **OPEN — DealPilot has two divergent prototype implementations, reconciled by keeping the UI-standardized one.** A parallel session (merged same day, `feat(dealpilot): real P0 connectors + generic intake seam + live prototype wiring`) built a bespoke DealPilotPage wired to real `apiDealPilotSource/Commit/List` (BizBuySell Gmail-alert connector via the governed google gateway, quarantine→commit flow, `DealCandidate`/`TRIAGE_COLUMNS` shape) while this session independently built a UI-standardized DealPilotPage (Card/Kanban/List/Lists+merge, `Listing`/`Deal`/`scoreThesisFit` shape, local reactive store only — no live API). Merge conflict resolved 2026-07-04 by keeping this session's version (satisfies the locked platform UI-standardization requirements: ListBar, StandardToolbar, flags-as-actions, universal green/yellow/red). The real BizBuySell connector + quarantine/commit API surface has since been re-wired — see RESOLVED entry above.

- **OPEN — SettingsPage duplicate React key on API Keys tab.** `pages/SettingsPage.tsx` renders a
  table with dummy API-key rows sharing a key (`9009`-suffixed dummy dates collide) — React warns
  "Encountered two children with the same key" every render of `/settings`. Spotted 2026-07-04
  while browser-testing the JobPilot/DealPilot UI standardization pass (unrelated file, not fixed
  in that pass). Fix: give each dummy key row a unique `id`/key, not a derived date string.

- **OPEN — Recon stranded outside the tool system.** Has `RECON_MANIFEST` + `buildCaptureEnvelope` +
  "Add to Bridge" button (`Tools/recon/lib/bridge.ts`) but: no `tools.ts` registry entry, intake URL
  never configured (button posts nowhere), staging.jsonl/permanent.jsonl = parallel governance never
  reaching `tool_captures`/ledger/Approvals. Fix: register + wire intake + migrate staged facts.
  Audit 2026-07-03.
- **OPEN — BusinessBroker.net live fetch blocked by robots.txt.** Checked 2026-07-04:
  `businessbroker.net/robots.txt` Disallows `/listings/` and every query-string URL
  (`/*?`, which covers its search endpoint); no RSS/sitemap feed exists as a fallback.
  DealPilot's `createBusinessBrokerNetConnector` (`platform/tools/dealpilot/src/connectors.ts`)
  therefore ships with a real *normalization* function (`normalizeBusinessBrokerRow`) but no
  live `fetcher` — the transport stays an injected seam. Real wiring needs a licensed/partner
  data feed, not a scraper. See decisions-log 2026-07-04 (dealpilot-connectors).

- **RESOLVED (intake seam only, 2026-07-04) — Generic manifest intake seam now exists.**
  `@bridge/tool-kit` gained `createToolSourceSkill`/`ToolIntakeMaterializer`/`ToolCaptureStore`
  (quarantine → pipeline `external:fetch` proposal → human "Add" commits). DealPilot is the
  first tool wired to it (`apps/api/src/wiring.ts` + `router.ts` `dealpilot.source/commit/list`).
  **Recon itself is still NOT migrated** — it still has no `tools.ts` registry entry and its
  staging.jsonl/permanent.jsonl stay a parallel governance path; only the reusable seam it needs
  now exists. Fix remaining: register Recon's manifest + point its connector at
  `createToolSourceSkill`, migrate staged facts. Audit 2026-07-03, seam added 2026-07-04.
  **Scoped out of the 2026-07-04 bug-fixing sweep on inspection:** Recon (`Tools/recon/`) is a
  fully standalone Next.js app (own `package.json`, talks directly to Supabase via
  `@supabase/supabase-js`, zero `@bridge/*` deps, ~3600-line `lib/recon.ts`, a browser extension,
  a launchd scheduler, a FlareSolverr proxy) — not a package inside `platform/`. Migrating it onto
  `createToolSourceSkill` means either rewriting its search/enrichment logic as a `SourceConnector`
  invoked from `apps/api` (losing its standalone Next.js UI/extension/scheduler) or having it call
  `apps/api`'s tRPC surface for governance while keeping its own runtime (a cross-service auth +
  staging-schema-mapping project). Either path is a multi-session architecture decision, not a
  same-pass bug fix — needs the user to pick a direction before implementation starts.

- **OPEN — DealPilot API wiring has 1 remaining pilot-scale simplification.** `dealpilot.list`
  (`router.ts`) uses a fixed empty thesis (`{industries:[],geo:[]}`) — no thesis-management UI/
  storage exists yet, so every candidate scores on defaults. This is an `apps/api/src/wiring.ts`
  follow-up, not an architecture gap.

- **RESOLVED (2026-07-04) — DealPilot dedupe-on-commit now wired.** `wiring.ts`'s
  `dealPilotMaterializer.commit` now builds a `DedupeCandidate` from the incoming capture and
  the living profiles of already-committed candidates, and calls `@bridge/company-sourcing`'s
  `matchCompany` (the same helper `processDealCandidate` already used) before deciding the
  candidate id: a "strong" match merges the new capture's facts into the existing candidate
  instead of piling up a duplicate row; anything weaker commits as its own new candidate.
  Requires 2 new workspace deps (`@bridge/company-sourcing`, `@bridge/dedupe`) added to
  `apps/api/package.json` + `tsconfig.json` references. Verified via full monorepo
  `typecheck build test --force` (45/45 green) — no dedicated unit test added since `wiring.ts`
  has no existing test harness (would require standing up the full `buildWiring()` DB/pglite
  stack); the composed pieces (`matchCompany`, `livingProfile`) are independently tested.

- **RESOLVED (2026-07-04) — `/dealpilot` prototype page now calls the real API.**
  `data/api.ts` gained `apiDealPilotSource/Commit/List`; `DealPilotPage.tsx` renders a
  quarantine inbox (sourced-but-uncommitted listings, each with its own "Add" button — capture
  ≠ commit) above the thesis-scored kanban, and falls back to `dummy_dealCandidates` when
  `VITE_API_URL` is unset (same OFF-by-default pattern as Calendar). Verified in-browser: demo
  mode renders dummy_ data with no console errors and the Source button correctly hidden when
  the API is off. Not yet done: no dedicated capture-list endpoint exists (the inbox only shows
  what `dealpilot.source`'s light-manifest response returned), so a captureId with no sample
  preview (position 4+ in a fetch) would show "(unnamed listing)" until enriched.

- **OPEN — Tool registry desync: 3 unlinked systems.** `tools.ts` (display) vs scattered per-tool
  manifests vs `tool_captures` schema — no programmatic binding; no `tool_version`/`copy_ref` in
  schema; manifests declare egress/plane but nothing enforces at runtime; hardcoded service URLs
  (Ollama :11434, recorder :5174/:8000). Fix: manifest = single source, registry derives from it,
  intake validates against manifest version. Audit 2026-07-03.

- **RESOLVED (2026-07-03) — Table edits session-only (Notion-parity P0+P1).** Generalized the
  Resources localStorage pattern into `lib/persist.ts` (`usePersistentState`); addedRows,
  cellOverrides, customFields, savedLists, deletedIds, colVisible, communityTypeOverrides,
  customTypes, columnLabelOverrides now all persist across refresh. Added per-tab `ViewState`
  (sorts[], rowFilters, filterMatch all/any, groupBy, activeView) persisted + independent per tab —
  switching tabs no longer resets sort/filter. Added: multi-sort (Sort popover, "then by" chaining),
  OR-filter toggle, column rename (pencil icon in Columns list), dynamic Group-by (collapsible
  sections, pagination suspended while grouped). Fixed add-row: rows now PREPEND (not append) +
  jump to page 1 + set `highlightedRowId`, so a new row is immediately visible instead of landing on
  the last page looking like a no-op; Add row also now shows in gallery/kanban, not just table view.
  `tsc --noEmit` clean on DataEngine.tsx/GlideTable.tsx/persist.ts; `vite build` succeeds. Still
  session-storage-tier (localStorage, not the API/pipeline) — swap-in point is `usePersistentState`
  when the platform API is live. Remaining P2 (not done): peek panel, undo/redo, keyboard shortcuts,
  kanban card drag, relation/formula column types, convergence of Resources/Helpdesk/Tools onto the
  same TableSpec.

- **IN PROGRESS — Prototype build NOT reproducible: untracked PII artifacts are hard imports.**
  Fresh clone/worktree `vite build` FAILS: `network.ts` gitignored (PII) but imported by 6 modules
  (`DataEngine.tsx:19`, `db.ts:5`, `signals.ts:8`, `helpdesk.ts:11`, `associations.ts:12`,
  `ItemDetail.tsx:13`). 2026-07-03: created a local `dummy_`-prefixed stub at that exact path (loose
  `[key: string]: any` index signatures + `dummy_`-prefixed sample rows) to unblock `tsc --noEmit`
  and `vite build` on THIS machine — confirmed both pass. Still NOT committed (file stays gitignored
  per design; needs your go-ahead per the earlier plan to commit it so every fresh checkout builds).
  Also: ~5 pre-existing implicit-`any` errors remain in `ItemDetail.tsx` (unrelated to tables, not
  yet fixed). Root cause of "deploy ≠ local". Audit 2026-07-03.

- **OPEN — Add row looks broken.** 3 stacked causes: (1) new row appended to END of merged data
  (`DataEngine.tsx:228`) → with pagination lands on last page, click looks like no-op; (2) button
  only in `table` view + footer hidden on Signals/Map (`DataEngine.tsx:1136-1142`); (3) added rows =
  session React state only — refresh loses them, never persisted. HelpdeskPage uses GlideTable w/o
  footer → no add-row at all. Fix: insert at top of current page + scroll-to + persist (localStorage
  or API). Audit 2026-07-03.

- **OPEN — Silent local-fallback in prototype data loaders.** All 4 canonical loaders
  (`db.ts:86-260`) catch-all → local fallback, zero warn/badge. Supabase down/misconfigured =
  stale data shown as if live → "data inconsistent" perception. Fix: `console.warn` + source badge
  ("local fallback") in DataEngine footer. Audit 2026-07-03.

- **OPEN — Social registry silent fixture fallback.** `apps/api/src/social/registry.ts:56-62`:
  missing OAuth creds → `makeFixtureProvider()` silently; dummy data flows into real pipeline,
  UI reports sync success. Fix: fail-fast in prod, loud warn in dev, mark proposals synthetic.
  (Google gateway correctly fails closed — social does not.) Audit 2026-07-03.

- **OPEN — API: no env validation, in-memory ledger silently used, /health checks nothing.**
  No `DATABASE_URL` → in-memory ledger, restart = data gone, `/health` still `ok:true`
  (`server.ts:15`). No fail-fast on missing `BRIDGE_LOCAL_DIR`/`SUPABASE_*` in prod. Fix: startup
  env assertions + `/health/ready` probing db + local plane. Audit 2026-07-03.

- **RESOLVED (2026-07-04) — CORS `origin: true`.** `server.ts` gained `corsOriginConfig()`:
  `API_ALLOWED_ORIGINS` (comma-separated) always wins when set; without it, dev
  (`NODE_ENV !== "production"`) still defaults to permissive `true` so local Vite keeps working
  with zero config, but production now fails CLOSED (empty allowlist) instead of open — a loud
  `app.log.warn` fires either way so the choice is visible in server logs, not silent. 3 new
  tests in `apps/api/test/server.test.ts`, all green. **Still open:** rate limiting — CORS is
  fixed but there's still no `@fastify/rate-limit` (or equivalent), so a listed allowed origin
  can still hammer the API with no throttling.

- **RESOLVED (verified 2026-07-04, was already fixed) — Gmail draft created on Google BEFORE
  approval.** The `draftOutbound()` named in the original 2026-07-03 audit no longer exists.
  Current architecture already does the right thing: `skills.ts`'s `composeEmailSkill` (runs at
  `propose()`) only VALIDATES the envelope and returns it as a draft manifest — it never calls
  the gateway. The actual `gmail.drafts.create` call lives in `egress.ts`'s
  `EgressExecutor.executeApprovedSend`, gated behind a human `>= L2` approval, idempotent per
  proposal id. Added the missing test proving it (`calendar.test.ts`: "email send is draft-only
  at propose, gmail.drafts.create called only after human approval (idempotent)") — the calendar
  create/update/delete paths already had this coverage, email didn't. 6/6 green.

- **RESOLVED (2026-07-04) — Local+canonical dual-write non-transactional; token refresh
  fire-and-forget.** The token-persist half: `gateway-google.ts`'s `client.on("tokens", ...)` now
  `.catch()`s and logs instead of a bare `void`. **Still open:** the dual-write half (intake can
  partially fail — local ok, canonical fail — with no idempotency key or retry queue). Audit
  2026-07-03.

- **RESOLVED (2026-07-04) — No CI; turbo cache replays across worktrees.** `.github/workflows/ci.yml`
  now exists (added by a parallel session): platform typecheck+test+build with `--force` (explicit
  comment citing this exact issue), prototype typecheck+build, and a PII-guard job blocking
  non-dummy_ network.ts/Connections.csv/etc from ever being committed. Verified present and
  correctly using `--force`. Not yet verified green on a live run (no `gh` push performed this
  session) — flagging as resolved-pending-first-run, not fully closed.

- **OPEN — Calendar fetch window: no `timeMax`, 250-event cap, refetch-per-nav.** `GoogleGateway.fetchEvents`
  lists from `timeMin` forward ordered by start (max 250), no upper bound. The Calendar surface passes
  `timeMin` = start of the visible period, so a single fetch covers the view + following events up to 250;
  navigating FAR past/future or a very dense calendar can exceed the window (events missing until Refresh /
  re-nav). Live-mode also refetches (an audited `external:fetch`) on each period change — by-design but chatty.
  Fix later: add `timeMax` to the gateway + fetch exactly the visible range (and/or a local event cache).
  Calendar P0–P2 (2026-06-24).

---

- **IN PROGRESS — Identity client-asserted on `propose`.** API trusts request-body actor
  for non-decide paths. `decide` now uses server `ctx.identity` (pinned pilot user). Full
  fix = Supabase JWT verify → real per-user identity + bind human actor on propose +
  constrain client-chosen agent actors. Decider pin closes approve-spoof now. See
  decisions-log 2026-06-22 (identity).

- **RESOLVED (2026-07-04) — Denied approval attempts not audited.** `pipeline.decide()`
  ([core/src/pipeline.ts:157-181](../../platform/packages/core/src/pipeline.ts)) now fetches
  the original ledger entry first, then on agent-floor deny appends an audited-rejection row
  (`userDecision: null`, `diff: { rejected: floor }`, `refLedgerId` pointing at the proposal)
  BEFORE throwing — previously it threw immediately with zero ledger trace of the blocked
  attempt. `decisionFor()` correctly still treats the proposal as unresolved (guards on
  `userDecision !== null`), so a human can still resolve it afterward. Updated
  `packages/core/test/pipeline.test.ts`'s floor test to assert the new audit row; all 54
  `@bridge/core` tests green.

- **OPEN — No per-human approval RBAC.** Floor blocks agents from approving; ANY human
  passes (no `ledger:approve` grant required yet). Layer human approval roles via full
  `resolveAuthority(approve, ledger)` later. Intentional, tracked.

- **OPEN — Dummy purge pending.** Hard-purge decided (remove FakeGoogleGateway + all
  dummy_ + fixtures; tests need live creds). Not yet executed. See decisions-log
  2026-06-22 (dummy). Until done, `dummy_` data still in `integrations-google` gateway +
  tests + wiring seeds.
