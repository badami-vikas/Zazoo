---
title: DevPilot Module Plan — Software Engineer Pilot on the AI Harness
type: raw
doc_kind: plan
status: in-progress
companions: [ai-harness-plan-2026-08-09.md, capability-module-format.md, capability-surface-taxonomy-2026-08.md, brd-dataengine-views-2026-07.md, day1-integrations-free-apis-2026-07.md, bridge-constitution-2026-08.md, decisions-log.md]
updated: 2026-08-14
tags: [devpilot, module, ai-harness, github, jira, slack, gmail, triage, pr-review, integrations, work-brief]
---

# DevPilot Module Plan (D0+D1+D2 SHIPPED — ADR-235/AP-153/TASK-067-068 (2026-08-13), ADR-237/AP-155/TASK-071 (2026-08-14); D3–D6 not started)

Saved 2026-08-13 from Manish's planning session, then implemented the same day on the user's "Implement the devpilot plan now" directive. D0 (module skeleton) and D1 (GitHub tracker slice) below are DONE — see ADR-235 for the as-built decisions and TASK-067/TASK-068 for verification evidence. The proposed ids originally sketched in this doc were superseded by the actually-assigned ADR-234/AP-152/TASK-067-068 at implementation time, then renumbered to ADR-235/AP-153 at merge time when K10 (landed independently on `origin/main` the same day) turned out to have claimed the same ADR-234/AP-152 numbers first — the same renumbering-at-merge precedent as K9's ADR-229/232-233 collision. D2 (engineering-assist Skills) shipped 2026-08-14 on the user's "start on the next task" directive, disambiguated to D2 via a clarifying question — see ADR-237/TASK-071. D3 onward remain future TASK rows, each starting only on its own explicit "start".

## Context

DevPilot organizes a freelance software engineer's work and boosts efficiency: it observes activity through the Central AI Harness, integrates GitHub + Jira (code/issues), Gmail + Slack (missed-reply triage), a tech-news/OSS radar, and provides PR-review / issue-analysis / best-practice skills, work-brief recommendations, and task prioritization feeding the existing Task Manager.

**Decisions made with the user (2026-08-13):** name **DevPilot** (`devpilot` everywhere); GitHub + Jira both in the first integration phase; Gmail first + Slack early for triage (Google Messages deferred — no technical path; the WhatsApp module's desktop capture is the only precedent and it required a whole module); first build = **skeleton + GitHub tracker slice (D0+D1)**.

**Harness leverage (why this builds on the AI Harness rather than beside it):**
- Learning coverage is free by construction: `moduleIdForSkill()` (`platform/packages/core/src/learning/ledger-miner.ts:80`) attributes signals from the skill-id prefix before the first `.`. Skills named `devpilot.*` feed digest → suggestion → preference → promotion with **zero module-specific hooks** (ADR-212 deleted exactly that pattern — do not re-add it).
- Recommendations surface via the generic `learning.*` tRPC namespace (`platform/apps/api/src/router.ts:14157`, optional `moduleId`) and `brief.morning` (router.ts:13992).
- Activity capture: consume existing K7 app-focus + K8 browser captures only. **Clicks/keystrokes/mouse are K11 — hard-blocked behind the K10 hardening gate (TASK-043) plus the user's content-vs-events decision** (`docs/raw/ai-harness-plan-2026-08-09.md`). Out of scope here; D-future wires them when unblocked.

**Naming note (record in the module ADR):** DealPilot's manifest name `deal-pilot` mismatches its `dealpilot.` skill prefix, so its learning attribution disagrees with its manifest name. DevPilot uses `devpilot` for manifest name, skill prefix, capability ids, table prefix, and route segment so ledger-miner attribution, capability ids, and nav all agree.

## Phase ladder D0–D7 (only D0+D1 in the first build; later phases land as TASK rows)

| Phase | Outcome | Reuses |
|---|---|---|
| **D0 — Skeleton + governance (dark)** | `devpilot` module installed end-to-end, invisible with flight OFF; AP/ADR/TASK rows landed | `seedBuiltInModules` (wiring.ts:4876), manifest-driven nav, WhatsApp skeleton precedent (AP-090, commits 20b35ee/27828d6) |
| **D1 — GitHub tracker slice** | Repos/PRs/issues rows in DevPilot Databases, 15-min scheduled poll, PAT encrypted locally, idempotent re-sync | `integrations-google` package shape, `guardedFetch`, `SecretStore`, `integration_sync_state`, automation scheduler, DealPilot credential masking |
| **D2 — Engineering skills SHIPPED 2026-08-14 (ADR-237, TASK-071)** | `devpilot.reviewPr` / `devpilot.suggestPractice` / `devpilot.analyzeIssue` as **draft-only** pipeline proposals — inline `spotlightUntrusted()`, not a second quarantine call, since output always halts for Human review; posting a review (`external:send`) stayed deferred, not built | Skill pipeline, `authority_bearing` executionClass, `github_intake` taint source, `resolveDevpilotReviewModel` |
| **D3 — Jira connector** | Jira issues merged into the same `devpilot_issues` table (`source:"jira"`); API-token paste auth, JQL `updated >=` cursor | Everything D1 built — second consumer proves the connector seam |
| **D4 — Comms triage** | Missed-reply detection (Gmail then Slack bot-token connector) emitting governed `task_change_proposals` reviewed in the existing Task Manager approval surface — **never direct task writes**; priority nudges also proposals | Google gateway, DealPilot `GmailFetchStateStore` restart-safe pagination, `task_change_proposals` (schema.ts:1505) |
| **D5 — News/OSS radar** | Daily bounded rights-verified digest (HN Algolia, lobste.rs RSS, GitHub releases atom for tracked deps) into a Radar Database via a `DEVPILOT_RADAR_SOURCE_CATALOG` (modeled on jobpilot `CULTURE_SOURCE_CATALOG`); reads through `@bridge/research` quarantine (posting is RED). **LinkedIn: deferred indefinitely** — ToS-hostile, fails the rights catalog by construction | `@bridge/research`, SearchProvider router (wiring.ts:5122) |
| **D6 — Focus analytics + Work Brief** | Work Brief page composing `brief.morning` + `learning.suggestions(moduleId:"devpilot")` + K7/K8 capture aggregates (deep-work windows, context-switch counts, Local Plane only) + DevPilot Databases. No new context doors, no new senses | Sensors hub, capture ledger, existing procedures only |
| **D-future — K11 senses** | Input/click capture — blocked behind K10 (TASK-043) + explicit user decision. Listed so nobody smuggles it in earlier | — |

## First build: D0 + D1 executable detail

### New package A: `platform/modules/devpilot/` (`@bridge/module-devpilot`)
- `src/table.ts` — three `TableSpec`s mirroring `platform/modules/dealpilot/src/table.ts`: `devpilot.repos`, `devpilot.pulls` (state/reviewState selects, additions/deletions numbers), `devpilot.issues` (`source` select github/jira for D3 forward-compat). View factories: pulls triage board grouped by `reviewState`, issues list by `updatedAt` — Views derive from column metadata (brd-dataengine-views §6).
- `src/domain.ts` (pure types + normalization, injected clock), `src/manifest.ts` (provenance target for `BUILT_IN_SOURCE_REFS`), `src/index.ts`, tests for table/domain/manifest.
- `package.json`/`tsconfig.json` mirror `platform/modules/whatsapp/`.

### New package B: `platform/packages/integrations-github/` (`@bridge/integrations-github`)
File-for-file on the `integrations-google` template:
- `src/contracts.ts` (wire types + `GithubGateway` port), `src/gateway.ts` (port + in-memory fake), **`src/gateway-live.ts` — the only file touching network**: all calls via `guardedFetch` to `api.github.com` (`/user`, `/user/repos`, per-repo `pulls?state=all&sort=updated`, `issues?since=<cursor>`); ETag conditional requests, Link-header pagination, rate-limit headers surfaced never tight-retried; every response tainted `untrusted_external` at ingest.
- `src/pat.ts` — PAT validation (`ghp_`/`github_pat_`), masked metadata only (DealPilot `metadataForCredential` pattern), scope introspection; token never logged.
- `src/intake.ts` — payload → normalized row proposals, quarantined; bodies are data, never instructions.
- `src/manifest.ts` — integration manifest: `external:fetch` read/public/egress **only** (no `external:send` in D1); `intake_policy { quarantine: true, commit_via: "pipeline_proposal" }`.
- Tests on recorded JSON fixtures, injected fetch double, zero network. **Fixture test must filter the `pull_request` key from issue listings** (GitHub mixes PRs into `/issues` — classic trap).

### Modified files
| File | Change |
|---|---|
| `platform/modules/manifests/src/index.ts` | Runtime ids continuing after `...000108`: `DEVPILOT_TRACKER_AGENT_ID = b0000000-...-000000000109`, `DEVPILOT_GITHUB_POLL_AUTOMATION_ID = ...-00000000010a`, key `devpilot.github-poll`; branches in `resolveModuleAgentRuntimeId` + `resolveModuleAutomationRuntimeId`; `BUILT_IN_SOURCE_REFS["devpilot"]`; `devpilotCapabilities` + `BUILT_IN_MODULES` entry (below); exclude `devpilot` from `COMMONS_BUILT_IN_MODULES` (personal work data) |
| `platform/modules/manifests/test/catalog.test.ts` | Ordered name list six→seven; assert pages `[pulls,issues,repos]`, nav target, **no capability carries `external:send`**, agent has `plane`, automation has `schedule` (binding preconditions fail fast in CI, not at boot) |
| `platform/packages/db/src/schema.ts` + `migrations/0041_devpilot_github_tracker.sql` | `devpilot_repos` / `devpilot_pulls` / `devpilot_issues`, each `unique(organization_id, source, source_id)`; `tracked` flag on repos; `external_updated_at`/`synced_at`. Cursors in existing `integration_sync_state` (keys like `github:issues:<repoId>`); no new cursor table. Re-check 0041 is still free before generating |
| `platform/packages/db/src/devpilot-store.ts` (new) | `DrizzleDevpilotStore`: idempotent upserts on the unique triple, list-with-filters, `setTracked`, cursor read/write |
| `platform/apps/api/src/wiring.ts` | Flight `devpilotEnabled = options.devpilotEnabled ?? env BRIDGE_DEVPILOT` (default OFF, block at :5228-5246); `DEVPILOT_SYNC_GITHUB_SKILL_MANIFEST` in `GOVERNED_SKILL_MANIFEST_CATALOG` (:3948) with **non-empty `goalTypes`/`taskTypes`** (binding throws otherwise, verified :5916/:5924); register real `devpilot.syncGithub` skill calling the gateway port — PAT resolved from `SecretStore` inside the Local-Plane host, never in skill inputs; construct live gateway with `guardedFetch` + store. Automation binding at :5906 then works with zero new wiring code |
| `platform/apps/api/src/router.ts` | `devpilot: t.router({...})` + `assertDevpilotFlightEnabled` beside the guards at :6011. **Coordinate with K9 WIP — same file (see Risks)** |
| `platform/apps/api/src/agent-role-templates.ts` | Seed `dev-tracker` role: `allowedSkills: ["devpilot.syncGithub"]`, `egressTier: "none"` |
| `platform/apps/web/src/app/routes.tsx` | Derive devpilot routes from manifest pages inside `<InstalledModuleBoundary moduleName="devpilot">` (DealPilot map pattern :88); `/integration/github` panel route; `/module/devpilot` landing redirect |
| `platform/apps/web/src/app/pages/DevPilotPage.tsx` (new) | `<ModuleSurfaceLayout>` + `<DataViews>` over the three Databases, page from route param (DealPilotPage pattern) |
| `platform/apps/web/src/app/pages/GithubIntegrationPanel.tsx` (new) | PAT paste → `devpilot.github.connect`; masked metadata, scopes, revoke, "run sync now". Add ui-conformance EXEMPT entry with reason (GoogleIntegrationPanel precedent) |
| `docs/APPROVALS.md`, `docs/raw/decisions-log.md`, `docs/TASKS.md` | One AP row (module + integration + flight), one ADR (naming, PAT-over-device-flow, module tables, no learning hooks, Commons withholding, D2 draft-first), two TASK rows (D0, D1); then `node platform/scripts/generate-pending-work.mjs` |

### Manifest entry (shape)
`computedRisk: "external"` (mirrors deal-pilot: public fetch egress + record writes). Capabilities: three `database` rows (`devpilot.repos/pulls/issues`), `devpilot.syncGithub` skill (`external:fetch` read/public/egress, connector `github`), `devpilot.tracker-agent` agent (skillIds `["devpilot.syncGithub"]`, **`plane` required**), `devpilot.github-poll` automation (`schedule: {kind:"schedule", everyMinutes:15}`, `procedure: "devpilot.syncGithub"`, `automationId` set → opted into executable runtime), `devpilot.github` integration row. Pages: pulls (landing), issues, repos. Version `0.1.0` — manifest content is immutable per version; never edit without a bump.

### tRPC `devpilot` namespace (all flight-gated except `status`)
`devpilot.status` (always answerable: `{enabled, githubConnected, trackedRepoCount, lastSyncAt}`) · `github.connect` (PAT in → validate via `gateway.viewer()` → `SecretStore` key `integration:github:pat`, Local Plane only, refuse on public cloud; return masked metadata) · `github.disconnect` · `github.status` · `repos.list` / `repos.setTracked` · `pulls.list` · `issues.list` · `sync.run` (manual trigger through the same governed skill path → ledger → learning attribution for free).

### Auth decision: PAT paste first, device flow later
Fine-grained read-only PAT (Metadata, Contents, Pull requests, Issues; per-repo scoping). No OAuth App registration, no callback route needed (Google needed `google-oauth-routes.ts` only because consent redirects exist), and the repo already has complete pasted-credential machinery (DealPilot `SourceCredentialVault` masking + keyring/encrypted-file backends, `SecretStore`).

## Design decisions (carry into later phases)
1. **Module tables over generic DataEngine rows** — DealPilot precedent; typed columns power DataViews boards; Integrations own no pages (brd-dataengine-views §6).
2. **PR-review within taint rules (D2)** — quarantined `untrusted_external` input → `authority_bearing` skill → output as pipeline proposal draft on the PR row; posting = `external:send` (ALWAYS_APPROVAL, structurally non-grantable standing, agent-floor denied) → draft-first per-item approval only.
3. **Triage writes through governed proposals (D4)** — `task_change_proposals` reviewed in Task Manager's existing approval surface; DevPilot never writes tasks directly.
4. **Work Brief composes existing procedures only (D6)** — no new context doors; ui-conformance EXEMPT with stated reason.
5. **No new foundational agents** — module-scoped agents only (per agent-orchestration canon); "PR review agent" etc. are `devpilot.*` skills run by the module agent.

## Budget envelope (constitution Layer B)
- **D0**: ~25 files, 0 model tokens; meter = `pnpm verify`; failure ⇒ stop, no dark-ship.
- **D1**: ≤200 tracked repos hard cap, ≤5k rows/repo backfill, $0 (REST+ETags); gateway owns the rate-limit meter — `X-RateLimit-Remaining` <10% ⇒ skip cycle, log `rate_budget_exhausted`, resume next tick, never tight-retry; 60s/repo wall-clock cap.
- **D2**: ≤1 model call/PR (≤8k in/1k out), 25 reviews/day; exhaustion ⇒ visible "budget deferred".
- **D4**: metadata-first, bodies local-only, 90-day lookback; ≤20 open proposals then detector pauses loudly.
- **D5**: ≤5 sources, ≤50 items/day, 30-day TTL; rights re-verify clock auto-disables a source rather than degrading silently.
- **D6**: aggregates only, no new raw capture, Local Plane residency.
- Deliberate overspend axis: **build time on the integration spine (D1)** — the GitHub connector is over-engineered relative to one user so D3 (Jira) and D4 (Slack) become template-stampings.

## Risks / sequencing
1. **K9 WIP collision (highest)** — as of 2026-08-13 the working tree has uncommitted TASK-053 work citing ADR-231 (untracked `core/src/learning/builder.ts` + modified `router.ts`/`core/src/index.ts`/`SettingsPage.tsx`). Sequence D0 **after that WIP lands** or branch rebased over it; never touch the learning sections of router.ts/core-index. At execution: `git fetch` + re-grep AP/ADR/TASK high-water from `origin/main` **before writing ids and again before pushing**; at write time next-free looked like ADR-232 / AP-149 / TASK-067.
2. **Migration race** — re-check `platform/packages/db/migrations/` high-water (0040 at write time) before generating 0041.
3. **Pinned counts** — catalog test's exact module-name list; `pnpm verify` task count grows 77→83 (2 packages × 3 tasks); ui-conformance EXEMPT list.
4. **Token exposure** — PAT never in tRPC responses/ledger/logs; asserted by test.
5. **Vocabulary gate** — run `check:vocabulary`; avoid retired families in new copy (incl. the "element" family gotcha, even in error strings).

## Verification
- `pnpm verify` green (expect 83 turbo tasks + vocab/agent-context checks); new tests: catalog assertions, manifest round-trip, table specs, intake fixtures (incl. `pull_request`-key filter), PAT masking/never-logged, gateway pagination/ETag/cursor on the fake, **negative controls** (flight OFF ⇒ all `devpilot.*` except `status` throw PRECONDITION_FAILED; missing PAT ⇒ typed fail-closed, no partial rows; taint asserted on every ingested field).
- **Live walk (D1 acceptance):** launch with `BRIDGE_DEVPILOT=1` → DevPilot appears in nav (no nav code written) → paste fine-grained PAT at `/integration/github`, masked metadata renders → track 1–2 repos → "run sync now" fills Pull Requests/Issues DataViews → ledger shows Agent Run attributed to `tracker-agent` / skill `devpilot.syncGithub` (learning signal carries `moduleId:"devpilot"`) → dev-override poll to 1 min: cursor advances, re-run inserts zero dupes → network drop mid-poll = bounded failure → flight off: module gone, `status` still answers → grep logs for `ghp_`/`github_pat_` = zero hits.
- Reuse the established live-walk recipe (BRIDGE_LOCAL_DIR + vault pair + flight vars + HS256 JWT on :4000; web via platform-web preview → 5180). Never launch a second desktop instance while the user's own runs; never kill their `node .../api/dist/src/server.js`.
