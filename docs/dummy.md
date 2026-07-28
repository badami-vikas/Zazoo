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

- **2026-07-28 — Pilot Organization demo data (AP-083)** (`platform/apps/api/src/wiring.ts` →
  `seedPilotDemoData`). **Reason**: the deployed public-cloud web app must show non-empty, editable
  modules for the pilot Organization before real pilot data exists; an empty state would hide the DealPilot
  and JobPilot surfaces the user asked to see working. **Real element it stands in for**: the pilot's actual
  Deals/Sources/Theses and tracked Jobs. **What it seeds**: 3 DealPilot Deals, 2 Sources (no credentials —
  credential columns stay NULL), 2 Theses, 1 deal_source Relation; 3 JobPilot Jobs + Applications. Seeded via
  the Cloud-Plane stores at boot, idempotently (guards on an empty surface), **only** when
  `publicCloudOnly && DATABASE_URL` (so tests and desktop/dev boots never seed). **NOT credentials or raw
  capture** — those stay Local Plane. **Removal condition**: delete `seedPilotDemoData` (and its call) once
  the pilot creates real Records in the cloud; the guard makes it a no-op the moment real Deals/Jobs exist.

- **2026-07-26 — TASK-026 governed Chat fixtures** (`platform/packages/core/test/chat-store.test.ts`,
  `platform/packages/db/test/{chat-store,migration-0031,migration-0032}.test.ts`,
  `platform/apps/api/test/{chat,chat-model-manager,chat-residency-store}.test.ts`,
  `platform/apps/web/test/chat.test.mjs`, `platform/apps/desktop/scripts/prepare-bundle.test.mjs`,
  `platform/apps/desktop/src-tauri/src/model_supervisor.rs`).
  **Reason:** exact cloud-consent digests, owner/Plane isolation, pagination, retry interleaving,
  crash and concurrent reconciliation, artifact corruption, runtime ownership, UI merge/scroll,
  and process-supervision failure paths must be deterministic and cannot send private Human
  conversations to a provider, mutate a real Task queue, or corrupt an installed model/runtime.
  **Real elements they stand in for:** private/public Chat threads and turns, Human decisions,
  Tasks and Automation Runs, cloud providers, a Qwen installation, llama.cpp processes, desktop
  instances, and paginated UI state.
  **Removal condition:** retain as isolated privacy/governance/concurrency regressions; pair them
  with the owner-approved real Local Plane model, desktop restart, shared-surface, and hosted
  public-turn certification required by TASK-026.

- **2026-07-21 — TASK-016 database/migration fixtures** (`platform/packages/db/test/{canonical-store,uuid-boundary,migration-0030,migration-concurrency,migration-metadata,organization-definition-store,schema-hardening}.test.ts`, `platform/apps/api/test/{blueprint,graph-people-communities}.test.ts`).
  **Reason:** partial-index races, null-key multiplicity, malformed UUID failure-before-SQL, migration replay/generation, RLS isolation, and Location-definition persistence must be deterministic and cannot mutate a Human's database or real identities.
  **Real elements they stand in for:** canonical People identities, Organizations/Humans, Relationship Records, Organization definitions, and fresh/upgraded Local Plane databases.
  **Removal condition:** retain as isolated correctness/security regressions; certify releases against owner-approved Postgres/Supabase separately without copying personal data into fixtures.

- **2026-07-18 — TASK-023 SearchProvider/network/governance fixtures** (`platform/packages/net-guard/test/net-guard.test.ts`,
  `platform/packages/models/test/{search-provider,local-content-guard}.test.ts`,
  `platform/apps/api/test/agent-orchestration.test.ts`, `platform/packages/core/test/pipeline.test.ts`,
  `platform/packages/db/test/{local-store,graph-store}.test.ts`, `platform/modules/manifests/test/catalog.test.ts`).
  **Reason:** deterministic DNS rebinding, SSRF, redirect, timeout, size/content-type, provider degradation,
  paid-escalation, taint, and Agent-authority regressions cannot depend on mutable internet/DNS/provider state
  or write to a shared workspace.
  **Real elements they stand in for:** DNS answers and sockets, Parallel MCP sessions/results, provider outages,
  Learning Agent Goal/Task assignments, citations, and Ledger/Memory state.
  **Removal condition:** retain as isolated security/governance regressions; pair them with bounded live
  rights-approved provider smoke evidence for releases, never replace runtime data with these fixtures.

- **2026-07-18 — TASK-022 model-provider protocol fixtures** (`platform/packages/models/test/{providers,router}.test.ts`,
  `platform/packages/models/test/local-content-guard.test.ts`, `platform/apps/api/test/chief-of-staff.test.ts`,
  `platform/packages/core/test/{agents-invoke,capability-registry,chief-of-staff,content-guard,eval-judge,model-provider}.test.ts`).
  **Reason:** cache creation/read, tier selection, usage propagation, provider failure, Authority/Plane denial,
  and append-only receipt tests
  must be deterministic and cannot spend against mutable external APIs, require developer credentials, or write
  synthetic calls into a real workspace ledger. The Anthropic adapter enforces the documented model-specific
  minimum cacheable prefix and explicit system-block breakpoint; it is test-only, never a runtime fallback.
  The secure opt-in CoS live branch uses the real Anthropic adapter and is not satisfied by these fixtures.
  **Real elements they stand in for:** Anthropic/Groq/Ollama completion responses, configured cheap/reasoning
  providers, token price metadata, authenticated Chief-of-Staff calls, and persisted model-call receipts.
  **Removal condition:** retain as isolated protocol/governance regressions; add credentialed provider-sandbox
  evidence separately when an approved non-production account and spend budget exist.

- **2026-07-19 — Supabase deployment-boundary fixtures** (`platform/packages/db/test/rls.test.ts`,
  `platform/apps/api/test/{server,security-hardening,wiring,residency-ledger}.test.ts`,
  `platform/apps/web/test/auth-session.test.mjs`,
  `platform/modules/dealpilot/test/encrypted-file-credentials.test.ts`,
  `.github/workflows/ci.yml`).
  **Reason:** deterministic runtime-role isolation, JWT/pilot admission, production fail-closed,
  Local/Cloud routing, encrypted-vault corruption/rotation/scope, and container smoke tests
  cannot mutate a live Supabase project, a Human's Local Plane, or real Source credentials.
  **Real elements they stand in for:** Supabase Auth subjects and tokens, two Organizations,
  public/private proposals, Source credentials and wrapping keys, an encrypted persistent
  volume, and production API configuration.
  **Removal condition:** retain as permanent identity/RLS/residency/cryptography/deployment
  regressions; certify each release against owner-provisioned Supabase and hosting without
  copying live secrets or private payloads into fixtures.

- **2026-07-19 — TASK-009/TASK-014 merge regressions** (`platform/packages/db/test/migration-0019.test.ts`, `platform/apps/api/test/workspace-membership.test.ts`, `platform/apps/api/test/packages.test.ts`).
  **Reason:** deterministic divergent-migration ancestry and concurrent Organization rename/File upload cannot safely mutate a real user's migration journal or private Files.
  **Real elements they stand in for:** an upgraded Local Plane database, private Learning recommendation rows, an Organization Files root, and a Human-uploaded Module File.
  **Removal condition:** retain as permanent migration/privacy/concurrency regressions; use user-approved local data only for product certification.

- **2026-07-19 — TASK-014 private Map/geocoder regression fixtures** (`platform/packages/tables/test/location.test.ts`, `platform/apps/api/test/map-geocoding.test.ts`).
  **Reason:** deterministic coordinate parsing, fail-closed provider configuration, label deduplication, not-found handling, and loopback-origin tests cannot send real private place labels to a live service or mutate user Records.
  **Real elements they stand in for:** Location Record values, a user-installed Local Plane geocoder, and provider coordinates.
  **Removal condition:** retain as isolated privacy/contract regressions; use user-approved local Records and a local self-hosted provider for browser certification.

- **2026-07-17 — TASK-007 Agent-orchestration fixtures** (`platform/packages/core/test/{goal-task,skill-manifest,child-agent-run,pipeline-ags1,pipeline}.test.ts`,
  `platform/packages/db/test/{automation-stores,goal-task-store,skill-manifest-store,child-agent-run-store,internal-strategist-governance,local-store,rls,migration-journal}.test.ts`,
  `platform/apps/api/test/{agent-orchestration,modules,ritual-ownership}.test.ts`).
  **Reason:** deterministic cross-workspace denial, Agent assignment, budget race, lifecycle rollback,
  migration, RLS, and Automation binding tests cannot mutate real user Goals/Tasks or persistent Runs.
  **Real elements they stand in for:** workspace members, foundational Agents, Goals, Tasks, Skill manifests,
  installed Modules, attributable Automation/parent/child Runs, budgets, lifecycle decisions, and audit entries.
  **Removal condition:** retain as isolated governance/security regressions; use user-approved local workspace
  data for product demonstrations and future end-to-end child-executor evidence.

- **2026-07-17 — TASK-011 JobPilot culture-research fixtures** (`platform/apps/api/test/jobpilot-culture-research.test.ts`,
  `platform/packages/net-guard/test/net-guard.test.ts`, `platform/modules/jobpilot/test/culture-research.test.ts`,
  `platform/apps/api/test/agent-eligibility.test.ts`).
  **Reason (updated after the 2026-07-18 coordinator final-review remediation pass):** these tests must
  never make a real network call in CI, yet must exercise REAL redirect/byte-cap/abort/reservation/
  durability mechanics rather than mocking them away. `net-guard`'s tests spin up real local `node:http`/
  `node:https` servers (loopback is allowlisted ONLY via the test-only `unsafeTestOverrides` seam, every
  other private range stays blocked; the HTTPS downgrade test generates a real, throwaway self-signed
  certificate via `openssl` at test time and relaxes `NODE_TLS_REJECT_UNAUTHORIZED` for that one test
  only) to prove genuine redirect-following, cross-origin header-stripping, downgrade rejection, cycle
  detection, byte-cap streaming, and `AbortSignal` cancellation over real sockets. `apps/api`'s tests
  register additional TEST-ONLY entries in the server-owned `CULTURE_SOURCE_REGISTRY` via
  `unsafeRegisterTestOnlyCultureSource` (never reachable from production code) pointing at real local
  test servers, and call `materializeCultureSourceFetch`/`cancelCultureSourceFetch` directly with the
  same loopback-allow override to prove the real durable-record/CAS/reservation/idempotency/completion
  logic end-to-end (including a genuine restart-durability proof via a second `DurableCultureFetchStore`
  wrapping the same underlying `memoryStore`). All test-only company/claim/source text is
  `test_fixture_`-prefixed in spirit (labelled "test_fixture Co"/"test_fixture source N" etc.) even
  though it is plain string data, not a `dummy_` identifier.
  **Real elements they stand in for:** a real candidate company's official careers page fetch, a real
  Learning-Agent-owned bounded child Agent Run, and a real Internal-Strategist culture-evidence synthesis.
  **Removal condition:** retain as the permanent deterministic regression suite for this Skill.

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
  `platform/packages/db/test/graph-store.test.ts`, `platform/packages/db/test/governance-stores.test.ts`,
  `platform/packages/db/test/ledger-store.test.ts`, `platform/packages/db/test/local-store.test.ts`,
  `platform/packages/db/test/migration-0015.test.ts`, `platform/packages/db/test/relation-materialization-store.test.ts`,
  `platform/packages/db/test/rls.test.ts`,
  `platform/apps/api/test/{router-decide,graph-people-communities,wiring}.test.ts`,
  `platform/apps/api/test/server.test.ts`, `platform/apps/web/test/relationship-module.test.mjs`).
  **Reason:** deterministic tenant-pruning, append-only resolution, Agent attribution, provider-failure,
  Helpdesk credential, owner-scoped semantic uniqueness, atomic materialization, stale-reconcile,
  migration, RLS, evidence-pruning, keyset pagination, bounded batch authorization, restart ordering, idempotency,
  rate-classification, and retry tests cannot mutate a
  shared workspace or depend on private People, Communities, Signals, Relations, tickets, and external providers.
  **Real elements they stand in for:** authenticated workspace actors, Relationship Records/Relations/Events,
  Outreach proposals and decisions, public Help Requests/replies, recovery credentials, and provider outcomes.
  **Removal condition:** retain as isolated regression fixtures; keep prototype evidence on user-approved local
  data and replace provider doubles with sandbox integration evidence when it becomes available.

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

- **2026-07-15 — JobPilot JP1 domain test fixtures** (`platform/modules/jobpilot/test/resume-schema.test.ts`,
  `master-profile.test.ts`, `profile-approval.test.ts`).
  **Reason:** deterministic merge/conflict/approval tests cannot use private real resumes in the repository.
  **Real element they stand in for:** parsed user resumes and cover letters represented as JSON Resume records.
  **Removal condition:** retain only as isolated unit fixtures; replace exit-gate/eval evidence with a
  user-approved, local-only labeled real-document corpus when JP1 ingestion is exercised.

- **2026-07-15 — DealPilot DP0 domain test fixtures** (`platform/modules/dealpilot/test/deal.test.ts`,
  `projections.test.ts`, `table.test.ts`, `domain.test.ts`, `credentials.test.ts`,
  `keyring-credentials.test.ts`, `runtime-store.test.ts`;
  `platform/apps/api/test/dealpilot-core.test.ts`, `dealpilot-durability.test.ts`;
  `platform/packages/local/test/memory.test.ts`, `pglite.test.ts`).
  **Reason:** deterministic stage/projection tests need stable synthetic Deal shells, facts, flags, documents,
  activity events, restart state, concurrent writes, and credential-provider behavior; repository tests cannot
  depend on private live deal data or mutate a developer's OS keychain.
  **Real element they stand in for:** Deal records, append-only facts, Local Plane state, and keychain entries
  from the governed sourcing pipeline.
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

- **2026-07-20 — signed pre-VOCAB3 Commons compatibility fixture**
  (`platform/services/commons/test/signing.test.ts`).
  **Reason it can't be real yet:** the regression must create a controlled historical signed entry
  with known bytes and a temporary Ed25519 key to prove hash/signature preservation, vocabulary
  projection, prior-directory discovery, and tamper rejection without depending on a user's real
  Commons registry or private signing key.
  **Real element it stands in for:** a generalized Commons entry published and signed before
  VOCAB3 under the prior manifest and filesystem vocabulary.
  **Removal condition:** remove with the explicit pre-VOCAB3 Commons compatibility adapter after
  every supported registry has migrated and the TASK-012 compatibility-deletion gate passes.

## Resolved

- ~~**2026-07-07 — ported prototype fixture data modules.**~~ **Resolved 2026-07-21:** TASK-013
  deleted superseded prototype consumers and fixture-bearing modules. Home now reads installed
  Modules from `modules.list`; canonical Module, Relationship, DealPilot, JobPilot, Approvals,
  Task Manager, and Google surfaces use real API data or honest empty/error states. Remaining
  `data/api.ts`, `data/governance.ts`, and `data/ledger.ts` files are typed API/empty-state
  adapters, not seeded product data.

- ~~**2026-07-17 — unrouted JobPilot application fixture.**~~ **Resolved 2026-07-21:** TASK-013
  deleted the superseded page, its fixture module, and its fixture-only client tests. The routed
  `JobPilotPage.tsx` continues to use persisted application Records and live culture-research
  procedures.
