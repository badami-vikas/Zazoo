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
- API/static hostnames derive across Blueprint services, so CORS and `VITE_API_URL` do not require hardcoded URLs.

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
- Docker CLI is unavailable on this machine; Render performs the literal container build.

## Provider status

Repository configuration is ready. Live Render authentication, private-repository connection,
secret entry, deploy, URL configuration, cold-start certification, and live browser/API evidence
remain to be completed through the visible provider flow.
