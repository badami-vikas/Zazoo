# Dummy-Data Ledger

**Default: do not create dummy data.** Real-data-only policy stands (CLAUDE.md, ADR-026/027) — runtime
product surfaces render real connected data or an honest empty state, never a placeholder.

> **User ratification 2026-07-09 (AP-002):** "don't use dummies unless unavoidable and when
> unavoidable, it should be tracked… log there." This is now the settled rule — the previously-open
> "do unit-test fixtures count?" question is **resolved: yes, the policy covers them.** Any unavoidable
> dummy (runtime OR test) gets a row here. Test-only fixtures may live under test dirs but still get
> logged if they're new. This ledger is the required tracking surface.

**If dummy data is genuinely unavoidable** (e.g. a UI needs *something* on screen to be reviewable before
its real data source exists, and an empty state would hide the thing being reviewed), the protocol is:

1. **Stop and state the reason before writing it** — what real element *should* eventually go there, why
   it can't yet (no backend procedure / no seeded workspace / third-party API not connected), and what
   would need to exist for the dummy value to be replaced by the real one. Get that in front of the user
   — this file assumes that conversation already happened, it doesn't replace it.
2. **Prefix the value** `test_fixture_` if it's test-only, or leave a `// DUMMY:` comment at the call site
   if it's runtime-visible (should be rare enough that it's always a deliberate, flagged exception).
3. **Append a row below** — file, reason, real element it stands in for, removal condition.
4. **Remove the row** (mark done, keep for history) once the real data source lands and the dummy is gone.

---

## Open

- **2026-07-17 — TASK-007 Agent-orchestration fixtures** (`platform/packages/core/test/{goal-task,skill-manifest,child-agent-run,pipeline-ags1}.test.ts`,
  `platform/packages/db/test/{goal-task-store,skill-manifest-store,child-agent-run-store,internal-strategist-governance,local-store,rls,migration-journal}.test.ts`,
  `platform/apps/api/test/{agent-orchestration,ritual-ownership}.test.ts`).
  **Reason:** deterministic cross-workspace denial, Agent assignment, budget race, lifecycle rollback,
  migration, RLS, and Automation binding tests cannot mutate real user Goals/Tasks or persistent Runs.
  **Real elements they stand in for:** workspace members, foundational Agents, Goals, Tasks, Skill manifests,
  parent/child Runs, budgets, lifecycle decisions, and audit entries.
  **Removal condition:** retain as isolated governance/security regressions; use user-approved local workspace
  data for product demonstrations and future end-to-end child-executor evidence.

- **2026-07-17 — TASK-011 JobPilot culture-research fixtures** (`platform/apps/api/test/jobpilot-culture-research.test.ts`,
  `platform/packages/net-guard/test/net-guard.test.ts`).
  **Reason (updated after the 2026-07-17 security-remediation pass):** these tests must never make
  a real network call in CI, yet must exercise REAL redirect/byte-cap/abort/reservation mechanics
  rather than mocking them away. `net-guard`'s tests spin up real local `node:http` servers (loopback
  is allowlisted ONLY via the test-only `unsafeTestOverrides` seam, every other private range stays
  blocked) to prove genuine redirect-following, cycle detection, byte-cap streaming, and
  `AbortSignal` cancellation over real sockets. `apps/api`'s tests register additional TEST-ONLY
  entries in the server-owned `CULTURE_SOURCE_REGISTRY` via `unsafeRegisterTestOnlyCultureSource`
  (never reachable from production code) pointing at real local test servers, and call
  `materializeCultureSourceFetch` directly with the same loopback-allow override to prove the real
  fetch/reservation/idempotency/completion logic end-to-end. All test-only company/claim/source text
  is `test_fixture_`-prefixed in spirit (labelled "test_fixture Co"/"test_fixture source N" etc.)
  even though it is plain string data, not a `dummy_` identifier.
  **Real elements they stand in for:** a real candidate company's official careers page fetch, a real
  Learning-Agent-owned bounded child Agent Run, and a real Internal-Strategist culture-evidence synthesis.
  **Removal condition:** retain as the permanent deterministic regression suite for this Skill; the BCG
  Application Record's own `cultureResearch` data (`platform/apps/web/src/app/data/bcg-application.ts`) is
  the real, live-fetched product-surface counterpart and carries no dummy/test-fixture data itself.

- **2026-07-17 — TASK-004 migration compatibility fixtures** (`platform/packages/db/test/migration-0011.test.ts`,
  `platform/packages/db/test/migration-0013.test.ts`, `platform/packages/db/test/package-store.test.ts`).
  **Reason:** deterministic pre-migration UUID Skill allowlists and singular/ambiguous Automation ownership
  cannot be reproduced against a live shared database without mutating legacy governance rows.
  **Real elements they stand in for:** concurrent legacy package-install retries, package lineage, existing
  Agent Skill UUID allowlists, legacy Ritual Agent arrays, local/external Automation steps, and same-target
  immutable package-content conflicts.
  **Removal condition:** retain as isolated migration regression coverage until every deployed pre-0013
  database has migrated and the legacy `rituals.agent_ids` column is removed.

- **2026-07-16 — TASK-008 Relationship trust-boundary test fixtures** (`platform/packages/core/test/ledger-pending.test.ts`,
  `platform/packages/core/test/pipeline.test.ts`, `platform/packages/db/test/helpdesk-store.test.ts`,
  `platform/packages/db/test/ledger-store.test.ts`, `platform/packages/db/test/local-store.test.ts`,
  `platform/apps/api/test/router-decide.test.ts`, `platform/apps/api/test/graph-people-communities.test.ts`,
  `platform/apps/api/test/server.test.ts`, `platform/apps/web/test/relationship-module.test.mjs`).
  **Reason:** deterministic tenant-pruning, append-only resolution, Agent attribution, provider-failure,
  Helpdesk credential, idempotency, rate-classification, and retry tests cannot mutate a shared workspace
  or depend on private People, Communities, Signals, tickets, and external providers.
  **Real elements they stand in for:** authenticated workspace actors, Relationship Records/Relations/Events,
  Outreach proposals and decisions, public Help Requests/replies, recovery credentials, and provider outcomes.
  **Removal condition:** retain as isolated regression fixtures; keep prototype evidence on user-approved local
  data and replace provider doubles with sandbox integration evidence when durable effect retry lands.

- **2026-07-16 — TASK-002 onboarding/Learning Agent test fixtures** (`platform/apps/api/test/security-hardening.test.ts`,
  `platform/packages/db/test/local-store.test.ts`, `platform/apps/web/test/onboarding-learning.test.mjs`).
  **Reason:** deterministic governance, scheduling, citation, Memory-lineage, and responsive UI tests cannot
  depend on private onboarding answers, a shared production workspace, or mutable external user records.
  **Real elements they stand in for:** a user's role-model answers, Learning Memories, Agent/Role grants,
  reflection schedule, trust-check observation, and governed recommendation decision.
  **Removal condition:** retain for isolated regression coverage; replace prototype/evaluation evidence with
  user-approved local-only onboarding sessions when a repeatable device-test harness is available.

- **2026-07-16 — package manifest parser fixtures** (`platform/packages/core/test/package-manifest.test.ts`).
  **Reason:** deterministic parser validation needs malformed and internally linked manifests that cannot be
  registered in a live package store without contaminating shared installation state.
  **Real element they stand in for:** signed Commons or built-in Module manifests with Page, Agent-owned Skill,
  and Automation bindings.
  **Removal condition:** retain only as isolated parser fixtures; use signed real manifests for end-to-end
  Commons/install certification.

- **2026-07-15 — JobPilot JP1 domain test fixtures** (`platform/tools/jobpilot/test/resume-schema.test.ts`,
  `master-profile.test.ts`, `profile-approval.test.ts`).
  **Reason:** deterministic merge/conflict/approval tests cannot use private real resumes in the repository.
  **Real element they stand in for:** parsed user resumes and cover letters represented as JSON Resume records.
  **Removal condition:** retain only as isolated unit fixtures; replace exit-gate/eval evidence with a
  user-approved, local-only labeled real-document corpus when JP1 ingestion is exercised.

- **2026-07-15 — DealPilot DP0 domain test fixtures** (`platform/tools/dealpilot/test/deal.test.ts`,
  `projections.test.ts`, `table.test.ts`, `domain.test.ts`, `credentials.test.ts`;
  `platform/apps/api/test/dealpilot-core.test.ts`).
  **Reason:** deterministic stage/projection tests need stable synthetic Deal shells, facts, flags, documents,
  and activity events; repository tests cannot depend on private live deal data.
  **Real element they stand in for:** Deal records and append-only facts from the governed sourcing pipeline.
  **Removal condition:** retain only as isolated unit fixtures; add local-only real-store/browser evidence
  before DP0 can be proposed DONE.

- **2026-07-15 — Commons router/package lifecycle fixtures** (`platform/apps/api/test/commons.test.ts`,
  `platform/apps/api/test/packages.test.ts`, `platform/apps/api/test/pkg2-commons-signing.test.ts`).
  **Reason:** deterministic signature, approval/veto, dependency substitution, transient failure,
  reconciliation, and Module-need drift tests cannot mutate a shared registry or real installed Modules.
  **Real elements they stand in for:** signed live-registry entries, installed Module needs, Human decisions,
  dependency closures, and post-decision provider/storage outcomes.
  **Removal condition:** retain as isolated trust/lifecycle regression coverage; keep the separate clean local
  Commons/API/web Prototype test as real end-to-end evidence.

- **2026-07-14 — desktop app icon set** (`platform/apps/desktop/src-tauri/icons/`: `icon.png`
  (now 512×512), `icon.icns`, `icon.ico`, `32x32.png`, `64x64.png`, `128x128.png`,
  `128x128@2x.png`, and the Windows `Square*Logo.png` / `StoreLogo.png` set).
  **Reason:** XP-2 (native installers) needs a multi-resolution icon set for the macOS `.icns`,
  Windows `.ico`, and bundle icons; the only in-repo source was a 32×32 / 105-byte placeholder, so the
  set was generated by `tauri icon` from that upscaled to 1024 — i.e. a blurry placeholder, not a real
  brand asset. Generating it unblocks real installer bundling (verified: a real
  `Bridge_0.1.0_aarch64.dmg` builds). A dev/build icon is a brand asset, not runtime product data, but
  it is a deliberately-flagged placeholder, so it is tracked here per the settled rule.
  **Real element it stands in for:** the real Bridge desktop app icon (a designed hi-res brand mark).
  **Removal condition:** replace the source with a real ≥1024×1024 Bridge brand icon and re-run
  `tauri icon` (file names stay the same, so no `tauri.conf.json` change needed).

- **2026-07-07 — ported prototype fixture data modules** (`platform/apps/web/src/app/data/`:
  `actionQueue.ts`, `api.ts`, `associations.ts`, `brokerages.ts`, `db.ts`, `dealpilot.ts`,
  `governance.ts`, `helpdesk.ts`, `helpdeskRemote.ts`, `initiatives.ts`, `integrations.ts`,
  `jobpilot.ts`, `ledger.ts`, `localMedia.ts`, `network.ts`, `resources.generated.ts`,
  `signals.ts`, `toolCaptures.ts`, `tools.ts`).
  **Reason:** user-ordered faithful visual port of the prototype, 2026-07-07 — the full prototype
  page surface (HomePage/WorkPage/ItemDetail/ToolsPage/SkillDetail + rich JobPilot/Helpdesk/
  Approvals/Calendar/Rituals/Resources/Settings, DataEngine at /network) had to land visually
  intact before real-data wiring; these modules are the fixture content those pages render.
  **Real element each stands in for:** people/communities → `graph.listPeople` /
  `graph.listCommunities` (exist today); approvals → `action.listPending` (exists); signals →
  signal read procedures (pending schema v2); rituals/agents/skills/integrations/tools →
  capability manifests + `packages.list` (packages.list exists; per-capability reads pending);
  initiatives/work → Initiative procedures (pending); helpdesk/jobpilot/dealpilot → their
  capability packages' backends (pending); ledger/governance → execution-ledger + trust-grant
  reads (pending).
  **Removal condition:** each page wired to real endpoints in the shell-v2 pass — a module's
  entry moves to Resolved when its consuming page(s) read tRPC instead of the module.

## Resolved

*(entries move here, struck through, once removed — none yet)*
