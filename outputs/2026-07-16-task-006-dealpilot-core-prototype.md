# TASK-006 DealPilot core prototype handoff

Integrated and recertified on local `main` on 2026-07-17. Canonical TASK status remains
`in_progress` because the explicit exit-test blockers below are unresolved.

## Outcome

Implemented the DP0-DP1 prototype slice:

- only Deals, Sources, and Theses default Pages;
- dedicated routable Record Detail for each Record type;
- symmetric Deal-Source, Deal-Thesis, and Source-Thesis many-to-many Relations;
- conditional Tasks and Relationships columns from Module bindings;
- direct Form inserts with honest empty states and no runtime seed data;
- reviewed Thesis-to-authorized-Source discovery;
- complete paginated Source discovery plus approved Source-to-Thesis backfill onto Deals already linked to the Source;
- rights-, connector-, membership-, and server-budget-gated Source-to-Deal discovery;
- manifest-backed Automation execution as the server-owned Egress Agent with Goal/Task-bound Skill resolution;
- incremental Gmail scanning with per-Source message-ID dedupe, five-page run bounds, recoverable in-process continuation, original-scan checkpoint carry-forward, two-phase message acknowledgement, and checkpoint advancement only after a complete scan;
- Source spend charged for every attempted alert, including parse failures;
- provenance-preserving quarantined candidate commit through the governed pipeline;
- masked Source credential projection, owner scope, workspace membership, verified recent password `amr`/`auth_time`, CSPRNG credential sessions, real Supabase password re-authentication, audited reveal/copy, timed reveal clearing, and clipboard-clear request;
- generic approval-path materialization with pre-decision revalidation of edited outputs.
- explicit domain Thesis fit bands (`strong_fit`, `needs_review`, `weak_fit`) with no
  green/yellow/red feedback semantics. Deal stage `triage` remains a workflow stage only.

## Code

- Domain, relations, Module/Page contracts: `platform/tools/dealpilot/src/domain.ts`
- Credential vault/re-auth contracts: `platform/tools/dealpilot/src/credentials.ts`
- Source connector budget bounds: `platform/tools/dealpilot/src/connectors.ts`
- Tool exports/manifest: `platform/tools/dealpilot/src/index.ts`, `platform/tools/dealpilot/src/manifest.ts`
- API contracts, authority, approvals: `platform/apps/api/src/router.ts`, `platform/apps/api/src/context.ts`
- Composition and governed materialization: `platform/apps/api/src/wiring.ts`
- Installed package inventory: `platform/apps/api/src/built-in-packages.ts`
- Web Pages and Record Detail: `platform/apps/web/src/app/pages/DealPilotPage.tsx`, `platform/apps/web/src/app/routes.tsx`
- Tests: `platform/tools/dealpilot/test/{domain,credentials,manifest}.test.ts`, `platform/apps/api/test/dealpilot-core.test.ts`, `platform/apps/web/test/dealpilot-core.test.mjs`
- Updated directly affected API fixtures: `platform/apps/api/test/{pagination,router-decide,single-tenant-guard}.test.ts`
- Fixture tracking: `docs/dummy.md`

## Verification

- `@bridge/dealpilot`: build passed; 72 tests passed; 83.60% line coverage.
- `@bridge/integrations-google`: build passed; 35 tests passed.
- `@bridge/api`: build passed; 8 focused DealPilot API tests passed after the final connector/cursor fixes; the 170-test full suite passed before that bounded final delta.
- `@bridge/web`: 49 tests passed; production build and typecheck passed.
- `@bridge/core`: 421 tests passed.
- `@bridge/db`: 107 tests passed.
- Changed-file ESLint, no-dummy-runtime, and `git diff --check`: passed.
- Independent merge review found Gmail backlog, partial-fetch, sender, cursor-time, early-ack, unbounded-page, long-continuation, stale-token, and cross-run token-cycle bugs; the follow-up bounds/resumes pages from the original checkpoint with scan-wide token history, resets failed continuations, filters authorized senders by provider receipt time with overlap, and acknowledges message IDs only after capture/spend success.

Live isolated API/web evidence:

- Module returned exactly `Deals`, `Sources`, `Theses`.
- Deals started at an honest zero-row state.
- Thesis creation returned `pending_review`; generic approval materialized one authorized Source Relation.
- Source Detail returned the related Thesis and masked password projection only.
- Missing local verified `auth_time` blocked credential re-auth with 401.
- Server-derived exhausted spend cap blocked Source discovery with 412 before connector access.
- deep-linked Source Record route returned HTTP 200.

## Explicit blockers

- DealPilot Records and Source credential vault remain process-local. Persistent Local Plane Record storage and an approved OS keychain/vault adapter are not present; startup warns rather than claiming durability.
- The local run has no Google credentials, so the real BizBuySell Gmail-alert fetch could not produce a live Deal. API tests prove the governed quarantine-to-Deal/Source/Thesis chain with isolated tracked fixtures.
- The local run has no verified JWT `auth_time` or OS re-auth provider, so live reveal/copy correctly failed closed. The authorized path is covered by credential and API tests.
- Browser canvas was unavailable, so no visual desktop/375px evidence was captured. The production web build and deep-link HTTP route passed.

## Coordinator reconciliation

- TASK-006 adds no competing specialist Agent roster or Skill-manifest resolver. Thesis discovery
  uses the existing Human-only `stageMutation` hook; Deal discovery runs through the manifest-backed
  Ritual as the server-owned Egress Agent and resolves `dealpilot.source` through TASK-007's
  Goal/Task/SkillManifest contract.
- No database migration was added; released migration lineage through `0014` is unchanged.
- Reconciliation preserved `PackageManifest.module`, `InstalledModuleBoundary`, shared
  `StandardColumnMenu`, Relationship Module routes, approval-effect recovery, and current
  action/Agent trust boundaries.
- TASK-006 remains `in_progress`; this integration does not claim the unavailable durable-vault,
  live-provider, or physical responsive evidence.
