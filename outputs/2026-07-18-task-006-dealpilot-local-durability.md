# TASK-006 DealPilot Local Plane durability

TASK-006 remains `in_progress`. This slice closes the code-addressable Record/capture/Gmail-state
and credential-vault blockers. It records actual host keychain, native desktop, and 375px browser
evidence without claiming live Google, verified OS re-authentication, signing, or physical-mobile
device evidence.

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
- Explicit credential revoke requires the same owner-scoped Human re-authentication as reveal/copy,
  removes the secure-vault entry, clears the durable Source projection across restart, records a
  value-free audit Event, and consumes the short-lived credential session.
- Runtime server/web boot requires durable Local Plane storage and an explicitly approved secure
  vault. Memory adapters remain isolated-test-only; there is no success-shaped runtime fallback.
- Desktop supplies Tauri app-data storage and `os-keyring`, requests authenticated graceful
  sidecar shutdown on every OS, bounds forced termination, and passes its parent PID so a crashed
  shell cannot orphan the Local Plane owner.
- Desktop generates a 256-bit per-launch loopback capability, injects it only into trusted Tauri
  webviews, forces the child API to loopback even under shared deployment settings, and configures
  a closed Tauri-origin allowlist. The API constant-time verifies the redacted header; file-backed
  Local Plane state is authentication-sensitive persistence.

## Trust and non-disclosure

- Governed Ritual/Agent/Skill ownership, workspace membership, Source rights, owner scope, Human
  re-authentication, audit, connector bounds, and approval revalidation remain fail closed.
- Credential re-authentication accepts only a cryptographically verified password AMR timestamp,
  replaces earlier sessions for the same Human/Organization/Source, clears reveals when it expires
  or fails, and never treats a bare JWT `auth_time` as password proof.
- Plaintext credential values are passed only to the configured credential provider. Local Plane
  files, database state, logs, masked projections, and audit entries contain no credential value.
- Credential request fields are redacted from server logs, discovery output does not echo sampled
  provider payloads, and clipboard clearing never overwrites a value copied after the credential.
- Pending captures use deterministic `(capturedAt, captureId)` ordering, Source filtering, and a
  server-enforced 1–200 page bound rather than exposing an unbounded private-payload collection.
- The sidecar capability authenticates only the server-owned desktop client. It cannot satisfy the
  password-AMR requirement for credential reveal, copy, or revoke.
- Google OAuth connect issues a 256-bit, ten-minute, single-use state after authenticated
  membership checks. Only its hash and server binding persist; callback validation and consumption
  happen before denial handling or provider code exchange. The initiating Human's membership and
  Integration binding are checked before exchange and membership is checked again at the token
  persistence boundary.
- Privileged release webviews stay on trusted Tauri origins. Only the main webview receives the
  origin-guarded immutable sidecar capability; Google consent opens in the validated system browser
  and returns to the sidecar's actual random-port callback. Browser launcher helpers are waited on,
  and legacy Google UI calls share the injected API URL plus bearer/sidecar authorization headers.
- Startup and partial-initialization failures release acquired clients and locks and surface cleanup
  failures rather than silently continuing.

## Verification

- Monorepo typecheck: 37/37 tasks passed.
- Monorepo build: 20/20 tasks passed.
- API: 187/187 tests passed with bounded file concurrency, including process restart,
  explicit-vault refusal, startup cleanup, process ownership, compensation, pagination,
  password-AMR validation, log non-disclosure, membership-revocation races, and authenticated
  server shutdown.
- DealPilot: 87/87 tests passed; 83.43% line coverage.
- Local Plane: 7/7 tests passed.
- Database: 124/124 tests passed, including RM4 migration `0015` and Relation-effect regressions.
- Core: 423/423 tests passed.
- Sourcing: 7/7 tests passed.
- Company sourcing: 4/4 tests passed.
- Google integration: 35/35 tests passed.
- Web: 50/50 tests passed.
- Desktop: `cargo check`, 34/34 Rust tests, Clippy with `-D warnings`, and scoped changed-file
  `rustfmt --check` passed.
- A live macOS keyring write/read/delete/missing round-trip passed with an ephemeral random value;
  the value was not printed or written to Bridge storage.
- Real Chrome rendered `/dealpilot/sources` at 375x812 CSS pixels with an honest empty state and no
  horizontal overflow (`scrollWidth === clientWidth === 375`). The live Tauri process opened the
  DealPilot Module Detail in a 1280x800 native window. Session artifacts:
  `dealpilot-sources-375px-2026-07-18.png` and
  `dealpilot-tauri-desktop-route-2026-07-18.png`.
- Independent correctness/security review found and closed loopback authentication, predictable
  OAuth state, privileged-webview navigation, PGlite schema/ownership cleanup, settlement-ledger
  retention, keyring deletion/revoke races, desktop OAuth polling, Windows hard-kill, browser-helper
  reaping, packaged-desktop Google transport, incorrect sidecar host binding, and OAuth
  membership-revocation races. Focused final follow-up found no remaining issue.
- Changed TypeScript ESLint, no-runtime-dummy, and `git diff --check` passed.

## Migration and remaining evidence

- No numbered Drizzle migration was added. The Local Plane adapter owns
  `CREATE TABLE IF NOT EXISTS local_state`; RM4 migration `0015` and TASK-010's next released
  migration remain untouched.
- No live Google credential was available, so no real BizBuySell provider fetch is claimed.
- Real macOS keychain interaction is proven. A verified OS/application re-authentication session is
  not available and is not claimed.
- Native desktop and real-browser 375px viewport evidence is proven. No signed package, physical
  mobile handset, or device certification is claimed.

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
