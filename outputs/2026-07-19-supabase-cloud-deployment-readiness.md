# Supabase cloud deployment readiness

## Status

Repository-side Supabase pilot blockers are remediated:

- migration `0022_supabase_runtime_role.sql` creates a login-capable `bridge_app`
  role with no superuser, database-create, role-create, inheritance, replication, or
  RLS-bypass capability and grants the runtime schema/table/sequence/function access;
- every RLS-backed runtime store enters transaction-local Organization/user context,
  safe under direct Postgres, Supavisor session mode, or transaction mode;
- hosted API reads and writes require a verified Supabase JWT and admit only the exact
  configured pilot subject;
- web includes sign-in, sign-up, recovery, password-reset, activation, protected-shell,
  refresh, and logout states with no live-project fallback;
- private, all-scope, and legacy-unscoped ledger roots remain in Local Plane storage;
  only explicitly public roots reach Supabase, and decisions/audits follow their parent;
- DealPilot has an AES-256-GCM encrypted, Organization/Source-bound file vault with
  restart durability, deletion, wrong-key failure, and current/previous-key rotation;
- the desktop sidecar explicitly declares `desktop-local` residency, uses the OS
  keyring, and sets `BRIDGE_ENV=production` so a Supabase runtime connection cannot
  skip the least-privilege/RLS boot guard;
- migrations `0025`/`0026` align Supabase automatic RLS with tracked policy ownership:
  client roles lose every policyless table grant, and every table left RLS-enabled has
  at least one tracked policy;
- the API has a Turbo-pruned, production-only, non-root Node 22 image and CI build,
  fail-closed production boot, liveness, and readiness probes.

Supabase provides Postgres/Auth and optional Storage/Realtime. It does not host this
repository's long-running Fastify process. AP-063 adds a free Render public API/static
web boundary in Virginia while private Local Plane data and Source credentials stay on
the device.

Render uses `public-cloud`: no disk, no vault, no credential keys, empty ephemeral
scratch only, and private procedures fail closed as desktop-required. The prior
encrypted-host-volume topology remains an unapproved paid alternative.

## Recovered session and integration

- Session `0f3e2f14-7fd2-4d07-8f3e-9c86c7c5480a` shared the central `main` checkout; it
  had no separate branch to merge.
- Its parent process was defunct. The five displayed background tasks were stale UI state:
  four read-only deployment mappers and one vocabulary-reconciliation worker that died with
  the parent.
- Completed work was preserved in `6590c71`, then normally reconciled with
  `origin/main@5ab4568`. Canonical upstream Organization/Module/Record vocabulary won shared
  conflicts; only the deployment-specific behavior was re-ported.
- Landed migrations `0020_vocab2_automation_engine` and
  `0021_vocab3_organization_module_record` were retained unchanged. The runtime-role
  migration is the next allocation, `0022_supabase_runtime_role`.
- This integration is local only. Nothing was pushed and no Supabase or hosting resource was
  provisioned.

## Deployment procedure

1. **Choose the pilot boundary.**
   - Use one approved pilot account and one API replica.
   - Use Supabase `us-east-1`; run API/web through the desktop-local sidecar topology.
   - Keep private/all-scope/legacy-unscoped roots and Source credentials on the device.
   - Do not describe this pilot-only admission model as a public multi-user launch.

2. **Create the Supabase project.**
   - Record its project URL, project ref, region, and web publishable key.
   - Enable `vector` before applying migrations.
   - Enable Data API only with automatic table exposure disabled.
   - Keep tracked RLS policies enabled. Migrations `0025`/`0026` remove Supabase's
     automatic-RLS side effect only from server-only tables that have no policy.
   - Prefer asymmetric JWT signing; the API verifies the project's JWKS from
     `SUPABASE_URL`.

3. **Install and apply migrations with an owner connection.**

   ```bash
   cd platform
   corepack enable
   corepack prepare pnpm@10.33.3 --activate
   pnpm install --frozen-lockfile

   node scripts/build-supabase-migration-bundle.mjs \
     packages/db/migrations \
     "$TMPDIR/bridge-supabase-migrations.sql"
   npx -y supabase@latest db query --linked \
     --file "$TMPDIR/bridge-supabase-migrations.sql"
   rm "$TMPDIR/bridge-supabase-migrations.sql"
   ```

   The generated bundle preserves every released Drizzle hash and applies two
   transaction-scoped managed-Postgres compatibility transforms: PostgreSQL 17 aggregate
   inspection and Supabase's non-superuser `postgres` role. It refuses any non-empty
   Drizzle history and removes its temporary compatibility function before commit.
   Never inject owner access into the running API.

4. **Set the runtime-role password outside migrations.**

   Migration `0022` deliberately creates `bridge_app` without a committed password. Use
   `psql`'s interactive password command so the password is not placed in shell history:

   ```bash
   psql "$MIGRATION_DATABASE_URL"
   ```

   Then run:

   ```text
   \password bridge_app
   \q
   ```

   Generate and store the password in the API host's secret manager. For a direct
   connection the username is `bridge_app`. For the shared Supavisor pooler it is
   `bridge_app.<project-ref>`.

5. **Create the approved Supabase Auth user.**
   - Create or invite the pilot from Supabase Authentication.
   - Copy the resulting Auth user UUID and email.
   - Set the production Site URL to the final web origin.
   - Allow exact redirects for `/auth/sign-in` and `/auth/reset-password` on that origin.
   - Public sign-up may remain disabled for a private pilot. If enabled, new accounts are
     still denied by the API until their UUID becomes the configured pilot UUID.

6. **Build and deploy the API image.**

   ```bash
   docker build \
     --file platform/Dockerfile \
     --tag bridge-api:<git-sha> \
     platform
   ```

   Render free uses the repository `render.yaml`: one replica, no disk. Use the shared
   Supavisor session pooler on port 5432. Every RLS context is transaction-local.

   Required API configuration:

   ```text
   NODE_ENV=production
   API_HOST=0.0.0.0
   PORT=<host-assigned-port-or-4000>
   BRIDGE_RENDER_WEB_HOST=<render-static-host>

   DATABASE_URL=postgresql://bridge_app[.<project-ref>]:<password>@<database-host>:<port>/postgres?sslmode=require
   SUPABASE_URL=https://<project-ref>.supabase.co
   BRIDGE_PILOT_USER_ID=<supabase-auth-user-uuid>
   BRIDGE_PILOT_USER_EMAIL=<pilot-email>

   BRIDGE_LOCAL_DIR=/tmp/bridge-public-only/local
   BRIDGE_FILES_ROOT=/tmp/bridge-public-only/files
   BRIDGE_LOCAL_RESIDENCY=public-cloud
   BRIDGE_DEALPILOT_CREDENTIAL_VAULT=disabled
   ```

   Do not configure a disk, vault key, or private Local Plane value on Render.

7. **Build and deploy the web client.**

   ```bash
   cd platform
   VITE_API_URL='https://<api-host>' \
   VITE_SUPABASE_URL='https://<project-ref>.supabase.co' \
   VITE_SUPABASE_PUBLISHABLE_KEY='<publishable-key>' \
   pnpm --filter @bridge/web build
   ```

   Publish `platform/apps/web/dist` on a static host. Configure SPA fallback to
   `index.html`, HTTPS, and the final domain before setting Supabase Auth redirects.

8. **Probe and certify before DNS cutover.**

   ```bash
   curl --fail https://<api-host>/health
   curl --fail https://<api-host>/health/ready
   ```

   Then verify:
   - approved pilot sign-in, refresh, reset, activation, and logout;
   - a different valid Supabase account receives `403`;
   - one governed read and write;
   - API restart loses only empty scratch; desktop restart preserves Local Plane data;
   - Supabase owner/service roles are rejected as runtime identities;
   - cross-Organization RLS isolation;
   - volume backup and restore;
   - no credential plaintext in Postgres, logs, image layers, or persisted files.

9. **Add optional capabilities only after the base pilot is healthy.**
   - Google requires OAuth credentials, exact callback URL, consent-screen users, and
     `BRIDGE_SELF_EMAILS`.
   - Commons requires a separate HTTPS service, durable data, stable Ed25519 signing key,
     publish token, `COMMONS_URL`, and the matching trusted public key in the API.
   - Model providers require their separately governed keys/endpoints.

## Information needed from the owner

Provide these non-secret decisions in chat:

1. Existing Supabase project or a new project, plus project URL/ref and region.
2. Render-generated API/static hosts and any later DNS owner.
3. Desktop-local residency (AP-063); no cloud private-data volume.
4. Pilot email and Supabase Auth UUID.
5. Direct, session-pooler, or transaction-pooler runtime connectivity from the chosen host.
6. Whether Google, Commons, and external model providers are in the first release.

Enter these directly into Supabase or the hosting secret manager, not chat:

- owner migration URI;
- generated `bridge_app` password and runtime URI;
- hosting/DNS credentials;
- Google/model/Commons secrets when enabled.

The web publishable key is intentionally public but is still required as a build input.

## Verification evidence and remaining external gates

- The recovered pre-reconciliation snapshot reported a 42/42 workspace typecheck/build,
  DB 173/173, DealPilot 93/93, API 323/323, web 102/102, and 12/12 focused
  RLS/vault/residency tests.
- After reconciling with the Organization-era `main`, API and web typechecks pass and the
  focused hosted-Auth, wiring, residency, runtime-role/migration, RLS, and encrypted-vault
  command passes 55/55.
- A Turbo-pruned clean builder simulation produced a 225 MB production-only API bundle,
  retained DB migrations, excluded TypeScript, started from durable Local Plane paths,
  passed `/health` and `/health/ready`, and failed closed without production configuration.
- This machine has no Docker daemon, so the literal image launch remains delegated to the
  new CI container job.
- The existing unrelated `@bridge/sensors` aggregate coverage gate remains open under
  TASK-017: 7/7 tests pass, but 35.76% is below its 38% line floor.
- On 2026-07-20, current `main@922ca52` was re-audited for the desktop-local boundary.
  The audit restored the real AppKit `NSWorkspace` framework API after VOCAB3 had made
  desktop compilation impossible, made desktop residency explicit, and forced the
  production RLS posture check through `BRIDGE_ENV=production`. Affected TypeScript
  build/typecheck, 197 API/DB/Google/DealPilot tests, 7 web contract tests, Rust test,
  strict Clippy, rustfmt, and zero-baseline vocabulary checks passed.
- A live free `us-east-1` project now carries 26 Drizzle migrations, `vector 0.8.2`,
  39 policy-backed RLS tables, zero policyless RLS tables, and one exact activated
  pilot subject. `bridge_app` live login, exact JWT admission, service-key rejection,
  cross-Organization denial, transaction-context reset, restart durability, and zero
  cloud rows for private Local Plane surfaces are proven.
- Remaining TASK-006 gates are external: authorized Source credentials and a Google
  OAuth client/account are unavailable, so no live BizBuySell Deal or credential
  reveal/copy/revoke/expiry result is claimed.

## References

- API environment template:
  [`platform/apps/api/.env.example`](../platform/apps/api/.env.example)
- Web environment template:
  [`platform/apps/web/.env.example`](../platform/apps/web/.env.example)
- Supabase database connections:
  <https://supabase.com/docs/guides/database/connecting-to-postgres>
- Supabase database migrations:
  <https://supabase.com/docs/guides/deployment/database-migrations>
- Supabase Auth redirect URLs:
  <https://supabase.com/docs/guides/auth/redirect-urls>
- Supabase JWT/JWKS:
  <https://supabase.com/docs/guides/auth/jwts>
