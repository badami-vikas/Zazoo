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
- Startup detects the legacy text-keyed adapter `external_records`, moves it out of Drizzle's
  namespace, copies and verifies exact rows in `local_external_records`, and safely resumes an
  interrupted import before dropping the backup. No numbered migration is involved.
- Gmail continuation preserves sender/internalDate filtering, partial-fetch state, bounded pages,
  visited-token history, original checkpoints, pending receipts, attempted-message spend, stable
  IDs, dedupe, and two-phase acknowledgement across process restart.
- Source credentials use maintained MIT `@napi-rs/keyring` behind the existing vault port.
  References are opaque and bound to Organization plus Source; every write owns a unique keyring
  entry so failed concurrent requests cannot delete a winner's credential.
- Opaque create/revoke journals reconcile a crash between keyring and aggregate updates. They
  contain references and intent only, never a credential value.
- Explicit credential revoke requires the same owner-scoped Human re-authentication as reveal/copy,
  removes the secure-vault entry, clears the durable Source projection across restart, records a
  value-free audit Event, and consumes the short-lived credential session.
- Runtime server/web boot requires durable Local Plane storage and an explicitly approved secure
  vault. Memory adapters remain isolated-test-only; there is no success-shaped runtime fallback.
- Desktop supplies Tauri app-data storage and `os-keyring`. On Unix it binds the random loopback
  socket in Rust, passes the same listener descriptor to Node, and retains its own copy so a dead
  child cannot donate the credential-bearing port. Unsupported release hosts without safe socket
  activation fail closed.
- Desktop generates a 256-bit per-launch loopback capability, injects it only into trusted Tauri
  webviews, forces the child API to loopback even under shared deployment settings, and configures
  a closed Tauri-origin allowlist. The API constant-time verifies the redacted header; file-backed
  Local Plane state is authentication-sensitive persistence.
- A tokenless bootstrap precedes authenticated sidecar readiness. Child loss terminally disables
  capture and topology work, clears pending/raw capture, hides privileged windows with
  NSPanel-safe retirement, surfaces an unavailable window, and retains the listener until exit.
  Authenticated shutdown drains active requests and closes newly idle connections before a
  separate five-second orphan deadline.

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
- Every flow also uses PKCE S256. The verifier remains in Local Plane pending state and is consumed
  with the state; Google receives only its challenge. All token operations for one Integration
  share one lock: exchanged credentials stay provisional and invisible until membership
  finalization, failure restores the exact prior token before unlocking, and refresh persistence
  uses ordered compare-and-swap so stale refresh cannot overwrite reconnect.
- Privileged release webviews stay on trusted Tauri origins. Only the main webview receives the
  origin-guarded immutable sidecar capability; Google consent opens in the validated system browser
  and returns to the sidecar's actual random-port callback. Browser launcher helpers are waited on,
  and legacy Google UI calls share the injected API URL plus bearer/sidecar authorization headers.
- Startup and partial-initialization failures release acquired clients and locks and surface cleanup
  failures rather than silently continuing.

## Verification

- Monorepo typecheck: 37/37 tasks passed.
- Monorepo build: 20/20 tasks passed.
- API: 239/239 tests passed with bounded file concurrency, including process restart,
  explicit-vault refusal, startup cleanup, process ownership, compensation, pagination,
  password-AMR validation, log non-disclosure, membership-revocation races, and authenticated
  server shutdown.
- DealPilot: 90/90 tests passed; 84.00% line coverage.
- Local Plane: 8/8 tests passed.
- Database: 155/155 tests passed, including landed migrations through TASK-010 `0016` and
  Relation-effect regressions.
- Core: 430/430 tests passed.
- Sourcing: 7/7 tests passed.
- Company sourcing: 4/4 tests passed.
- Google integration: 39/39 tests passed.
- Web: 70/70 tests passed.
- Desktop: `cargo check`, 44/44 Rust tests, Clippy with `-D warnings`, and scoped changed-file
  `rustfmt --check` passed.
- The branch normally merged `origin/main` `bab32ea4a7917a273ee91f7c5df520a775301083`
  after preserving the implementation. Relationship continuity changes and migration `0016`
  remain intact; TASK-006 adds no migration delta. Approval/ADR collisions were reconciled as
  AP-044 and ADR-117–ADR-120, and hardened PKCE/token-finalization won the OAuth code conflict.
- The user then authorized main integration under AP-045. The validated branch landed at
  `7f44186` with TASK-006 still `in_progress`; no external provider or re-authentication evidence is
  inferred from that integration.
- A live macOS keyring write/read/delete/missing round-trip passed with an ephemeral random value;
  the value was not printed or written to Bridge storage.
- Real Chrome rendered `/dealpilot/sources` at 375x812 CSS pixels with an honest empty state and no
  horizontal overflow (`scrollWidth === clientWidth === 375`). An earlier live Tauri run opened
  DealPilot Module Detail in its requested 1280x800 native window. The final socket-activation
  build was rerun as a real release process: authenticated readiness created the native main and
  companion windows; simulated Node death left the Rust shell alive, surfaced the Local Plane
  unavailable window, and kept the parent-held port unrebindable (`EADDRINUSE`). Session artifacts:
  `dealpilot-sources-375px-final-2026-07-18.png` and
  `dealpilot-tauri-desktop-route-2026-07-18.png`.
- Independent correctness/security review found and closed loopback authentication, predictable
  OAuth state, privileged-webview navigation, PGlite schema/ownership cleanup, settlement-ledger
  retention, keyring deletion/revoke races, token-finalization/read and refresh/reconnect races,
  desktop OAuth polling, socket handoff, shutdown interruption, browser-helper reaping,
  packaged-desktop Google transport, incorrect sidecar host binding, and OAuth
  membership-revocation races. Live release validation additionally found and closed the missing
  data-URL feature plus unsafe NSPanel destruction on sidecar loss.
- Final read-only security review found no vulnerabilities. Correctness review raised only releasing
  directory ownership when client close throws; that suggestion is deliberately rejected and
  regression-tested because a failed close can leave the embedded client live.
- Final post-main-reconciliation security and correctness re-reviews found no actionable issues.
- Changed TypeScript ESLint, no-runtime-dummy, and `git diff --check` passed.

## Migration and remaining evidence

- No numbered Drizzle migration was added. The Local Plane adapter owns `local_state` and
  `local_external_records`; RM4 migration `0015` and TASK-010's next released migration remain
  untouched.
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
- Desktop readiness/failure lifecycle: `platform/apps/desktop/src-tauri/src/lib.rs`,
  `platform/apps/desktop/src-tauri/src/overlay.rs`
- Restart/security tests: `platform/apps/api/test/dealpilot-durability.test.ts`,
  `platform/tools/dealpilot/test/runtime-store.test.ts`,
  `platform/tools/dealpilot/test/keyring-credentials.test.ts`
