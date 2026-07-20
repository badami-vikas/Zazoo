# TASK-006 Supabase continuation

## Outcome

TASK-006 remains `in_progress`, but its live Supabase blocker is closed.

- Created one isolated free Supabase project in `us-east-1`.
- Enabled `vector` and applied 26 Drizzle migrations without rewriting released migration bytes or hashes.
- Created a login-capable `bridge_app`; direct pooler login proves no superuser, database-create, role-create, inheritance, replication, or RLS-bypass attributes.
- Activated exactly one pilot Auth subject. Pilot bearer returns `200`; a revealed-only-in-process service credential returns `401`.
- Configured exact local Auth site/redirect URLs. No public multi-user claim is made.
- Kept DealPilot Records, Relations, ledger, Events, Memories, Integrations, and Files desktop-local. Their Supabase row counts remained zero while one membership row existed.
- Live RLS proof returned one membership in the correct Organization, zero in a different Organization, and empty transaction context after commit.
- A runtime password entered through the visible terminal was unexpectedly echoed by the terminal transport. It was immediately rotated to a generated value stored directly in macOS Keychain; the value never entered repository files, shell arguments, or logs.
- Restored AppKit's immutable `NSWorkspace::sharedWorkspace()` API after TASK-012 had broken desktop compilation.
- Made the sidecar declare `desktop-local` residency and `BRIDGE_ENV=production`, so desktop Supabase connections enforce the runtime-role/RLS guard.
- Added migrations `0025`/`0026`: Supabase auto-RLS had enabled 14 policyless server-only catalogs/junctions and blocked runtime boot. Client-role grants are revoked; every table left RLS-enabled has a tracked policy.
- Added create-time sensitive Source Form fields. They render as password inputs and pass directly to the OS-vault API; table rows remain masked and have no credential update path.

## Live DealPilot evidence

- Created a real ETA Thesis and observed a governed Source-discovery proposal.
- Added a rights-attested, spend-capped BizBuySell saved-search Source.
- Created a refined real Thesis; governed discovery found one authorized Source candidate; Human approval materialized the symmetric Source↔Thesis Relation.
- Thesis and Source Record Details both showed the related Record.
- Source Deal discovery reached the real provider gate and failed honestly because Google OAuth is not configured. No fake Deal or provider evidence was created.
- Source table showed the conditional Task column. Relationship stayed absent because `relationshipAuthorized` is false.
- A fresh API process reopened one Source, two Theses, and the Relation from the same Local Plane.
- The active Supabase JWT carried a recent password AMR. Credential session issuance still denied because the Source has no credential owner/value, as required.
- Real browser proof passed at desktop `1440×900` and exact `375×812`; document/body/client widths matched and the real Source, Task column, and credential labels rendered.

## Verification

- DealPilot, Google, DB/RLS, hosted Auth/JWKS, residency, durability, server, and migration-journal tests: 197 passed before the live fixes.
- DB migration/RLS follow-up: 14 passed.
- DealPilot web contract tests: 7 passed.
- Supabase migration-bundle regression: 1 passed.
- Affected API/DB/Google/DealPilot/Tables/web typechecks and production builds passed.
- Desktop sidecar test, strict Clippy, rustfmt, and zero-baseline vocabulary checks passed.
- GitHub Actions run `29770323574` failed all eight runner-backed jobs with zero steps;
  the installer matrix was skipped. This is the payment-blocked runner condition, not
  test execution, and no CI success is claimed.

## Remaining external block

The user does not currently have authorized Source credentials, and no Google OAuth client is configured. Therefore TASK-006 cannot honestly claim:

1. a live permitted Gmail/BizBuySell alert producing a Deal;
2. reveal/copy/revoke of a non-dummy Source credential after Human re-authentication;
3. expiry and wrong-Human denial against a real credential value.

Exact unblock: create authorized Google OAuth credentials with the local callback, connect the pilot Gmail account, and enter a real Source credential directly into the secure Source Form. Then rerun Deal discovery and the value-free credential audit/revoke/expiry checks.

No signing or physical-mobile claim is made.

## Files

- Managed Supabase bundle: `platform/scripts/build-supabase-migration-bundle.mjs`
- RLS alignment: `platform/packages/db/migrations/0025_task006_supabase_root_catalogs.sql`, `0026_task006_supabase_auto_rls_alignment.sql`
- Desktop sidecar boundary: `platform/apps/desktop/src-tauri/src/api_sidecar.rs`
- AppKit provider repair: `platform/apps/desktop/src-tauri/src/providers/apps.rs`
- Secure Source Form: `platform/apps/web/src/app/pages/DealPilotPage.tsx`, `platform/apps/web/src/app/dataviews/views/FormView.tsx`
- Canonical evidence: `docs/TASKS.md`, `docs/BUGS.md`
- Deployment readiness: `outputs/2026-07-19-supabase-cloud-deployment-readiness.md`
