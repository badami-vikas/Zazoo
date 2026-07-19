# Supabase cloud deployment readiness

## Status

Repository-side Supabase pilot blockers are remediated:

- migration `0020_supabase_runtime_role.sql` creates a login-capable `bridge_app`
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
- the API has a Turbo-pruned, production-only, non-root Node 22 image and CI build,
  fail-closed production boot, liveness, and readiness probes.

Supabase provides Postgres/Auth and optional Storage/Realtime. It does not host this
repository's long-running Fastify process. The pilot topology is one persistent API
container, one static web deployment, and one Supabase project in the same region.

Private Local Plane content lives on the API host only when the owner explicitly accepts
an encrypted persistent cloud volume. If private data must stay on the user's device,
deploy the desktop sidecar topology instead of the hosted-browser topology.

## Deployment procedure

1. **Choose the pilot boundary.**
   - Use one approved pilot account and one API replica.
   - Select the Supabase, API, and web regions.
   - Explicitly approve either an encrypted API-host volume or desktop-local residency.
   - Do not describe this pilot-only admission model as a public multi-user launch.

2. **Create the Supabase project.**
   - Record its project URL, project ref, region, and web publishable key.
   - Enable `vector` before applying migrations.
   - Keep RLS enabled.
   - Prefer asymmetric JWT signing; the API verifies the project's JWKS from
     `SUPABASE_URL`.

3. **Install and apply migrations with an owner connection.**

   ```bash
   cd platform
   corepack enable
   corepack prepare pnpm@10.33.3 --activate
   pnpm install --frozen-lockfile

   export MIGRATION_DATABASE_URL='<Supabase direct owner URI>'
   pnpm --filter @bridge/db migrate
   ```

   Use the direct endpoint for migrations, as Supabase recommends. If the migration host
   cannot reach IPv6, use an owner session-pooler URI. Never inject
   `MIGRATION_DATABASE_URL` into the running API.

4. **Set the runtime-role password outside migrations.**

   Migration `0020` deliberately creates `bridge_app` without a committed password. Use
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

   Mount one host-encrypted, durable volume at `/var/lib/bridge`; keep one replica. Use a
   direct database URI for an IPv6-capable persistent host, or the shared Supavisor session
   pooler on port 5432 for an IPv4-only persistent host. Transaction mode on port 6543 also
   works because prepared statements are disabled and every RLS context is transaction-local.

   Required API configuration:

   ```text
   NODE_ENV=production
   API_HOST=0.0.0.0
   PORT=<host-assigned-port-or-4000>
   API_ALLOWED_ORIGINS=https://<web-host>

   DATABASE_URL=postgresql://bridge_app[.<project-ref>]:<password>@<database-host>:<port>/postgres?sslmode=require
   SUPABASE_URL=https://<project-ref>.supabase.co
   BRIDGE_PILOT_USER_ID=<supabase-auth-user-uuid>
   BRIDGE_PILOT_USER_EMAIL=<pilot-email>

   BRIDGE_LOCAL_DIR=/var/lib/bridge/local
   BRIDGE_FILES_ROOT=/var/lib/bridge/files
   BRIDGE_LOCAL_RESIDENCY=encrypted-host-volume

   BRIDGE_DEALPILOT_CREDENTIAL_VAULT=encrypted-file
   BRIDGE_CREDENTIAL_VAULT_KEY_ID=<current-key-id>
   BRIDGE_CREDENTIAL_VAULT_KEY=<base64-encoded-32-byte-key>
   ```

   Generate the vault key directly into the host secret manager:

   ```bash
   openssl rand -base64 32
   ```

   During rotation, configure the new current pair and the former pair as
   `BRIDGE_CREDENTIAL_VAULT_PREVIOUS_KEY_ID` and
   `BRIDGE_CREDENTIAL_VAULT_PREVIOUS_KEY`. Do not remove the previous pair until all
   credential entries have been rewritten.

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
   - API restart preserves Local Plane data and encrypted Source credentials;
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
2. API host, static web host, final API/web domains, and DNS owner.
3. Explicit approval that private Local Plane data may live on a host-encrypted cloud
   volume, or a requirement to keep it desktop-local.
4. Pilot email and Supabase Auth UUID.
5. Direct, session-pooler, or transaction-pooler runtime connectivity from the chosen host.
6. Whether Google, Commons, and external model providers are in the first release.

Enter these directly into Supabase or the hosting secret manager, not chat:

- owner migration URI;
- generated `bridge_app` password and runtime URI;
- vault current key ID/key and any temporary previous rotation pair;
- hosting/DNS credentials;
- Google/model/Commons secrets when enabled.

The web publishable key is intentionally public but is still required as a build input.

## Verification evidence and remaining external gates

- Full workspace typecheck/build: 42/42 tasks.
- Changed packages: DB 173/173, DealPilot 93/93, API 323/323 with 74.50% line
  coverage, web 102/102.
- RLS, encrypted vault, and residency routing focused tests: 12/12.
- Turbo-pruned clean builder simulation produced a 225 MB production-only API bundle,
  retained DB migrations, excluded TypeScript, started from durable Local Plane paths,
  passed `/health` and `/health/ready`, and failed closed without production configuration.
- This machine has no Docker daemon, so the literal image launch remains delegated to the
  new CI container job.
- The existing unrelated `@bridge/sensors` aggregate coverage gate remains open under
  TASK-017: 7/7 tests pass, but 35.76% is below its 38% line floor.
- No live Supabase project was mutated and no cloud service was provisioned because owner
  project/hosting inputs and secrets have not been supplied.

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
