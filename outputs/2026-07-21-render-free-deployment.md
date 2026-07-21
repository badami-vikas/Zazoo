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
- Official Render CLI v2.21 authenticated successfully. Its validator accepts the
  Blueprint structure and reaches only the private-repository branch lookup.
- Docker CLI is unavailable on this machine; Render performs the literal container build.
- GitHub Actions run `29814901057` failed all eight runner-backed jobs with zero steps and
  skipped installer aggregation, matching the payment-blocked runner condition; no CI success
  is claimed.

## Provider status

Repository configuration and Render authentication are ready. No Render resource or secret was
created.

Deployment is externally blocked before Blueprint creation: the authenticated GitHub collaborator
has push/triage but no admin/maintain permission on the private repository. Installing the Render
GitHub App under the collaborator's account does not expose an owner-account repository, so Render
reports no repositories and official validation cannot resolve `main`.

Exact unblock: a `badami-vikas/relationship-os` repository owner/admin must configure the Render
GitHub App for “Only select repositories” → `relationship-os`. Then refresh New Blueprint, enter
the `sync: false` values directly, and continue the live deployment/certification.
