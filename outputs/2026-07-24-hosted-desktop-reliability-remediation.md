# Hosted and desktop reliability remediation

Date: 2026-07-24
Source baseline: `main@cbffa3edec921da112e46ee249546a46d76e9714`
State: validated, uncommitted working tree; hosted remediation not deployed

## Outcome

- The portable macOS desktop now owns its built API and target-native Node runtime. It no longer
  depends on this repository or a system Node installation.
- The existing pre-VOCAB Local Plane upgrades through current high-water and reopens without losing
  its retained external Record.
- Hosted web reads have bounded wake recovery; mutations are never replayed.
- The recorded governed Onboarding completed. `Manish's Organization`, its active blueprint, and
  the Lion Avatar preference survive a full packaged-app/API restart.

## Hosted boundary

The client now wakes only remote APIs through cheap `/health` liveness. Wake work is single-flight,
cached, visible, and bounded to 90 seconds. tRPC queries use a separate replay-safe link because
batching sends reads as POST; a failed query may run once more after a fresh wake check. Mutations
use the non-replaying link and are never repeated after transmission. Render's Blueprint probes
`/health` rather than persistent readiness.

The public issue remains open. Render still has `autoDeploy: no`; no source was deployed, no tier or
provider configuration changed, and no natural cold-wake/Auth/375px/post-deploy Supabase
measurement is claimed.

## Desktop boundary

Bundle preparation builds the dependency-inclusive API/web tree, deploys only the API package's
allowlisted output, copies the current target-native Node executable and license, and verifies that
the generated runtime is target-matched and free of environment, credential, key, certificate, and
native-addon files.

On macOS the Keyring addon is removed from API Resources and bundled as signed code under
`Contents/Frameworks`. Packaged Node carries the JIT entitlements it requires. Signed builds must
give the app, Node, and Keyring one Team ID. A final review reproduced that the upstream
`NAPI_RS_NATIVE_LIBRARY_PATH` override could not load the renamed addon; the generated
architecture package now delegates through a reviewed `process.dlopen` bridge to the signed
Framework, and final-bundle verification imports the package and constructs `AsyncEntry` with the
packaged Node. Windows remains compile-checked, but installer preparation fails explicitly until
secure listener inheritance is implemented.

The rebuilt 349 MB `Bridge.app` launched with a Finder-like PATH, started its bundled Node/API,
served authenticated webview traffic, reopened Local Plane state, presented the native Avatar
overlay, and terminated the managed API with the app.

## Onboarding durability

The first restart exposed that `onboarding.saveProfile` was process-memory-only. The active
Organization and blueprint persisted, but the profile disappeared and browser storage retained a
neutral Owl fallback.

File-backed Local Plane mode now stores the profile as private, user-owned Memory and appends
updates through the existing correction lineage. The web hydrates that persisted profile even when
browser storage already contains a stale fallback. After save and a second packaged restart:

- Organization: `Manish's Organization`
- Blueprint: active
- Server profile Avatar: Lion
- Browser Avatar preference: Lion, ready
- Native overlay: visible

No migration `0031`, repair script, direct WebKit mutation, or personal Local Plane reset was used.

## Verification

- Web: 96 tests, typecheck, affected lint, production build.
- Local Plane: 11 focused tests, including pre-VOCAB upgrade/reopen and profile
  save/restart/correction/restart.
- Desktop: 49 Rust tests, Clippy with warnings denied, Cargo check, 3 bundle-policy tests, generated
  input/secret checks, macOS bundle layout/signature/entitlement and executable Keyring-load
  verification.
- Build: dependency-inclusive API/web build, 19/19 tasks.
- Repository gates: retired-vocabulary ratchet and no-runtime-dummy checks.

## Remaining boundaries

- Hosted recovery needs review, manual deployment, and natural-cold production evidence.
- Real Developer ID signing/notarization was not available.
- Windows installer support, the full physical desktop OS matrix, and mobile remain TASK-018 work.
- No commit, push, PR, merge, or provider-tier change occurred.

## Records

- Original diagnosis: [hosted/Supabase/desktop diagnosis](2026-07-24-hosted-supabase-desktop-diagnosis.md)
- Canonical tasks: [`docs/TASKS.md`](../docs/TASKS.md)
- Bug evidence: [`docs/BUGS.md`](../docs/BUGS.md)
- Decision: [`ADR-144`](../docs/raw/decisions-log.md)
