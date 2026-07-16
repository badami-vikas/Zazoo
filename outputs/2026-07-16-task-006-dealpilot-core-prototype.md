# TASK-006 DealPilot core prototype handoff

## Outcome

Implemented the DP0-DP1 prototype slice:

- only Deals, Sources, and Theses default Pages;
- dedicated routable Record Detail for each Record type;
- symmetric Deal-Source, Deal-Thesis, and Source-Thesis many-to-many Relations;
- conditional Tasks and Relationships columns from Module bindings;
- direct Form inserts with honest empty states and no runtime seed data;
- reviewed Thesis-to-authorized-Source discovery;
- rights-, connector-, membership-, and server-budget-gated Source-to-Deal discovery;
- provenance-preserving quarantined candidate commit through the governed pipeline;
- masked Source credential projection, owner scope, workspace membership, verified recent `auth_time`, audited reveal/copy, timed reveal clearing, and clipboard-clear request;
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

- `@bridge/dealpilot`: build passed; 63 tests passed; 83.44% line coverage.
- `@bridge/api`: build and full test suite passed; 65.01% line coverage.
- `@bridge/web`: 28 tests passed; production build passed.
- `@bridge/core`: build passed; 347 tests passed.
- `@bridge/db`: build passed; 62 tests passed.
- `git diff --check`: passed.

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
- Repository-wide web typecheck remains blocked by the pre-existing missing `Link` import in `platform/apps/web/src/app/pages/IntelligencePage.tsx:87,89`; DealPilot has no type errors.

## Coordinator reconciliation

- TASK-006 declares no specialist Agent roster or Skill-manifest resolver. Thesis discovery
  and capture commit use the shared `stageMutation` governance hook with typed DealPilot task
  payloads; `dealpilot.source` remains the pre-existing connector execution seam that TASK-007
  may bind into the shared Agent/Goal/Task catalog.
- No database migration was added; reserved migrations `0011` and `0012` remain untouched.
- `platform/apps/api/src/built-in-packages.ts`, `router.ts`, `wiring.ts`, `platform/apps/web/src/app/pages/DealPilotPage.tsx`, and `routes.tsx` overlap uncommitted TASK-001-TASK-004 coordinator work.
- Preserve the coordinator's `PackageManifest.module`, `InstalledModuleBoundary`, shared `StandardColumnMenu`, and newer shell contracts while carrying over the three DealPilot Page bindings/routes and all DP0-DP1 API/security behavior here.
- Reconcile TASK-006 evidence/status, log, and any bug/ADR ledger entries centrally; this branch intentionally does not allocate IDs or flip canonical status.
