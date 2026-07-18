# TASK-006 DealPilot Local Plane durability

TASK-006 remains `in_progress`. This slice closes the code-addressable Record/capture/Gmail-state
and credential-vault blockers without claiming live provider, OS re-authentication, keychain, or
physical-device evidence.

## Outcome

- DealPilot Records, Relations, captures, candidate profiles, Gmail recovery state, discovery
  settlements, spend, dedupe, and credential audit now persist as one versioned,
  Organization-scoped Local Plane aggregate.
- File-backed PGlite updates use atomic revision checks, serialize concurrent reducers, survive
  restart, isolate Organizations, backfill Relations, and make capture materialization idempotent.
- Drizzle and runtime state share one PGlite client. Canonical-path, heartbeat-backed ownership
  rejects competing processes, including equivalent path spellings.
- Gmail continuation preserves sender/internalDate filtering, partial-fetch state, bounded pages,
  visited-token history, original checkpoints, pending receipts, attempted-message spend, stable
  IDs, dedupe, and two-phase acknowledgement across process restart.
- Source credentials use maintained MIT `@napi-rs/keyring` behind the existing vault port.
  References are opaque and bound to Organization plus Source; every write owns a unique keyring
  entry so failed concurrent requests cannot delete a winner's credential.
- Runtime server/web boot requires durable Local Plane storage and an explicitly approved secure
  vault. Memory adapters remain isolated-test-only; there is no success-shaped runtime fallback.
- Desktop supplies Tauri app-data storage and `os-keyring`, requests graceful sidecar shutdown,
  bounds forced termination, and passes its parent PID so a crashed shell cannot orphan the Local
  Plane owner.

## Trust and non-disclosure

- Governed Ritual/Agent/Skill ownership, workspace membership, Source rights, owner scope, Human
  re-authentication, audit, connector bounds, and approval revalidation remain fail closed.
- Plaintext credential values are passed only to the configured credential provider. Local Plane
  files, database state, logs, masked projections, and audit entries contain no credential value.
- Startup and partial-initialization failures release acquired clients and locks and surface cleanup
  failures rather than silently continuing.

## Verification

- Monorepo typecheck: 37/37 tasks passed.
- Monorepo build: 20/20 tasks passed.
- API: 174/174 tests passed, including process restart, explicit-vault refusal, startup cleanup,
  process ownership, compensation, non-disclosure, and server shutdown.
- DealPilot: 83/83 tests passed; 84.07% line coverage.
- Local Plane: 6/6 tests passed.
- Database: 107/107 tests passed.
- Sourcing: 7/7 tests passed.
- Google integration: 35/35 tests passed.
- Web: 49/49 tests passed.
- Desktop: `cargo check`, 29/29 Rust tests, Clippy with `-D warnings`, and scoped changed-file
  `rustfmt --check` passed.
- Changed TypeScript ESLint, no-runtime-dummy, and `git diff --check` passed.

## Migration and remaining evidence

- No numbered Drizzle migration was added. The Local Plane adapter owns
  `CREATE TABLE IF NOT EXISTS local_state`; RM4 migration `0015` and TASK-010's next released
  migration remain untouched.
- No live Google credential was available, so no real BizBuySell provider fetch is claimed.
- The keyring adapter is covered through an isolated provider seam; no real OS-keychain or verified
  OS re-authentication session is claimed.
- No physical desktop or 375px device certification, signing, or device evidence is claimed.

## Files

- Local Plane port/adapters: `platform/packages/local/src/`
- Shared local database lifecycle: `platform/packages/db/src/client-local.ts`
- Durable DealPilot store: `platform/tools/dealpilot/src/runtime-store.ts`
- OS keyring adapter: `platform/tools/dealpilot/src/keyring-credentials.ts`
- Runtime/API composition: `platform/apps/api/src/wiring.ts`, `platform/apps/api/src/router.ts`,
  `platform/apps/api/src/server.ts`
- Desktop lifecycle: `platform/apps/desktop/src-tauri/src/api_sidecar.rs`
- Restart/security tests: `platform/apps/api/test/dealpilot-durability.test.ts`,
  `platform/tools/dealpilot/test/runtime-store.test.ts`,
  `platform/tools/dealpilot/test/keyring-credentials.test.ts`
