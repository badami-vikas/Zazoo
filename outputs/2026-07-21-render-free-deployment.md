# Render free deployment

## Approved topology

- Existing Supabase project: Postgres/Auth, US East.
- Render: one free Docker web service in Virginia plus one free static site.
- Private repository connection: provider UI only.
- Free sleep/wake and ephemeral restart behavior accepted.
- No Render database, Key Value, persistent disk, private-data volume, or paid resource.

## Repository delivery

- Root `render.yaml` defines only the API and static web services.
- API reuses `platform/Dockerfile`; static site reuses the existing Vite build.
- Secret/private configuration is `sync: false`; no pilot identifiers, database URI, password, or key is committed.
- API/static use their created public `onrender.com` hostnames. Render's cross-service `host`
  property is a private service name and is not valid for browser CORS or `VITE_API_URL`.

## Public-cloud boundary

`BRIDGE_LOCAL_RESIDENCY=public-cloud` is an explicit fail-closed mode:

- scratch paths must stay under `/tmp/bridge-public-only`;
- Source vault is `disabled`; credential keys are rejected;
- private/all/unscoped procedures, Module Files, DealPilot, Google OAuth callback, Helpdesk, Relationship, JobPilot, Task Manager, and background private Relation reconciliation do not run;
- allowed surface: health/readiness, exact pilot activation/Organization list, installed Module list, and governed Actions only when `dataScope=public`;
- Supabase JWT/JWKS exact-pilot admission and `bridge_app` RLS posture remain mandatory.

Render free spin-down loses only empty scratch. Desktop Local Plane behavior is unchanged.

## Verification before provider deployment

- API typecheck/build passed.
- Focused public-cloud, server/Auth, and Google callback tests passed.
- Render Blueprint contract test and YAML parse passed.
- Official Render CLI v2.21 authenticated successfully. Its validator accepts the
  Blueprint structure and reaches only the private-repository branch lookup.
- Docker CLI is unavailable on this machine; Render performs the literal container build.
- GitHub Actions run `29814901057` failed all eight runner-backed jobs with zero steps and
  skipped installer aggregation, matching the payment-blocked runner condition; no CI success
  is claimed.

## Provider status

The repository owner granted the Render GitHub App access to only this private repository.
The prior authorization blocker is resolved.

## Resumed provider deployment

- Repository owner/admin access was confirmed and the Render GitHub App grant succeeded.
- Blueprint validation passed and created free service IDs `srv-d9ft13n7f7vs739aqh1g` (API,
  Virginia) and `srv-d9ft1477f7vs739aqi40` (static), with no disk/database/Key Value.
- Initial deploys targeted canonical `main@ba8ccc1`.
- API image clean build reached 18/18 dependency tasks and image export.
- Static deploy `dep-d9ft14n7f7vs739aqimg` failed because the build skipped workspace dependency
  outputs. The dependency-inclusive Turbo command passed 19/19 from a clean Git archive.
- Static deploy `dep-d9ft382f2o0s73cela1g` first went live at `main@9e3c26c`.
- Render cross-service host references produced private service names. PR #50 replaced them with
  public hosts (`202fcbc`, merge `76ad7ab`).
- Turbo then proved it had stripped every public Vite build input. PR #51 declares and hashes the
  three inputs (`cb93c0c`, merge `163562a`); live static deploy
  `dep-d9ftfe0okrbs738r5c1g` completed at 2026-07-21T20:35:18Z.
- The API reached Supabase and exposed schema drift from `0026` to current `0030`. The official
  linked Supabase CLI applied canonical `0027`–`0030` without handling an owner URI in chat,
  files, or shell history. Live Drizzle history reaches `0030`.

## Live services

- API: <https://bridge-pilot-api.onrender.com>
- Web: <https://bridge-pilot-web.onrender.com>
- API service: `srv-d9ft13n7f7vs739aqh1g`, Render Virginia, Free, Docker.
- Static service: `srv-d9ft1477f7vs739aqi40`, Render Static/Free.
- No Render disk, database, Key Value, paid plan, or new spend.
- API restart deploy `dep-d9ftmk8okrbs738rkf00` completed at
  2026-07-21T20:52:28Z on `main@163562a`; post-restart health and readiness returned `200`.

## Live certification

- `/health` → `200`; `/health/ready` → `200`, persistent ledger, `public-cloud` boundary,
  Local Plane check OK.
- CORS preflight from the exact static origin → `204` with that origin; an untrusted origin gets
  no allow-origin header.
- Exact pilot sign-in, Organization activation, token refresh, protected API read, reload,
  and logout passed. The Supabase publishable/anonymous credential is rejected as a runtime
  identity. Password reset was not executed because it would mutate the active pilot account.
- Authenticated `organization.list` → `200`. Authenticated `dealpilot.module` →
  `412 desktop-required`, proving the cloud API cannot operate the private prototype.
- Runtime connection is `bridge_app`; it has no superuser, role-create, RLS-bypass, or public-schema
  create capability. Own-Organization tenant rows are visible, a different transaction-local
  Organization sees none, and pooled Organization/user settings reset after each transaction.
- Cloud Organization scope has zero operational Records, zero Local Plane Memories, and zero
  credential columns. Render logs and tracked files contain none of the runtime URI or private
  pilot values. Recursive static-asset scan finds no database URI, vault key, Local Plane path,
  or desktop Documents path.
- Authenticated Chrome at exact 375px reports `innerWidth=375`, `scrollWidth=375`, zero overflow
  elements, zero page-load console errors/exceptions/network failures, public API success, and
  private-route denial.
- Free service idle sleep after about 15 minutes and wake delay remain accepted provider behavior.
  A separate 15-minute idle wake was not timed; the full API redeploy/restart and post-restart
  probes passed.

TASK-006 remains `blocked` under AP-060. Render completion does not supply the authorized real
Source credential or configured/authorized Google OAuth required for live BizBuySell Deal
discovery and credential reveal/copy/revoke/expiry/wrong-Human proof.
