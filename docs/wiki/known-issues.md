# Known Issues

Cross-session ledger of bugs / gaps / abnormalities. Persist across sessions. Agents:
spot something off → add row here, do NOT wait for user ask. Fix → mark RESOLVED + date.
Full rationale of decisions → [../raw/decisions-log.md](../raw/decisions-log.md).

Status: OPEN | IN PROGRESS | RESOLVED. Newest first.

---

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

- **OPEN — DealPilot API wiring has 2 pilot-scale simplifications.** (1) `dealpilot.list`
  (`router.ts`) uses a fixed empty thesis (`{industries:[],geo:[]}`) — no thesis-management UI/
  storage exists yet, so every candidate scores on defaults. (2) Candidate ids are just capture
  ids (1 capture = 1 candidate) — no dedupe-on-commit pass wired in yet, though
  `@bridge/company-sourcing`'s `matchCompany` (used in `processDealCandidate`) is available to
  wire in when a UI needs it. Both are `apps/api/src/wiring.ts` follow-ups, not architecture
  gaps.

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

- **OPEN — CORS `origin: true`** (`server.ts:16`). Combined w/ pinned pilot identity = any site can
  drive the API as pilot user. Fix: allowlist from `API_ALLOWED_ORIGINS`. Audit 2026-07-03.

- **OPEN — Gmail draft created on Google BEFORE approval.** `draftOutbound()` calls
  `gmail.drafts.create` at propose; veto leaves orphan draft in user's Gmail. Fix: compose local at
  propose, create Google draft post-approval (or delete on veto). Audit 2026-07-03.

- **OPEN — Local+canonical dual-write non-transactional; token refresh fire-and-forget.** Intake
  dual-write can partially fail (local ok, canonical fail) → orphans/dupes; `gateway-google.ts`
  `client.on("tokens", void putToken)` — failed persist silent → stale token → 401 next sync.
  Fix: idempotency key + retry queue; try/catch + signal on token persist fail. Audit 2026-07-03.

- **OPEN — No CI; turbo cache replays across worktrees.** Zero `.github/workflows`. Turbo replays
  cached test logs from OTHER worktrees (stale paths in output) → green run ≠ this checkout tested.
  Fix: GH Actions (install/typecheck/test/build both apps) + `--force` in CI. Audit 2026-07-03.

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

- **OPEN — Denied approval attempts not audited.** `pipeline.decide()` throws on
  agent-floor deny BEFORE ledger append → no audit row for a blocked approve try. Add
  audited-rejection row in auth-binding pass. Append-only spine else intact.

- **OPEN — No per-human approval RBAC.** Floor blocks agents from approving; ANY human
  passes (no `ledger:approve` grant required yet). Layer human approval roles via full
  `resolveAuthority(approve, ledger)` later. Intentional, tracked.

- **OPEN — Dummy purge pending.** Hard-purge decided (remove FakeGoogleGateway + all
  dummy_ + fixtures; tests need live creds). Not yet executed. See decisions-log
  2026-06-22 (dummy). Until done, `dummy_` data still in `integrations-google` gateway +
  tests + wiring seeds.
