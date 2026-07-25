# Hosted natural cold wake and Auth refresh

Date: 2026-07-25
Web source: `c0353e7a1bf3cef10a3595da1d1e780a0a200ed7`
Web deploy: `dep-d9i6ojjrjlhs73ef2380`
API source: `015716c8ed2aaa176756a0c92d8afb615d3de99e`

## Outcome

The remaining hosted reliability checks are closed. Bridge now wakes the remote API before it reads
the Supabase session and constructs the bearer header. Duplicate initial and token-refresh Auth
events share one Organization activation. Queries retain bounded replay; sent mutations remain
non-replayed.

## Natural cold wake

This was a provider-correlated hibernation test, not a rollout or slow warm request:

- last old-instance provider health: `2026-07-25T07:59:21Z`;
- no user/API traffic crossed the idle window;
- different Render instance began listening: `08:01:38Z`;
- deployed browser `/health`: `200` at `08:01:43Z`;
- exact-origin activation preflight: `204`;
- refreshed-bearer `organization.activateSession`: `200` at `08:01:44Z`;
- Module/Organization batch followed successfully.

The first checker run incorrectly selected the preflight `204` instead of the following activation
`200`; Render's request logs showed the product path succeeded. The harness predicate was corrected,
and the warm rerun completed in 1.606 seconds.

## Live Auth and 375px

- One exact Auth user was present.
- Refresh preserved the subject and rotated both access and refresh tokens.
- Refreshed session lifetime: 3,600 seconds.
- Events: `INITIAL_SESSION`, `SIGNED_IN`, `TOKEN_REFRESHED`, `SIGNED_OUT`.
- The browser's first API request was `GET /health`.
- The waking banner rendered.
- Organization activation returned `200`.
- Final route: `/`.
- `innerWidth=375`; `scrollWidth=375`.
- Supabase project: `ACTIVE_HEALTHY`.
- Authenticated GoTrue health: `200`.
- Post-wake Render error logs: empty.

## Boundaries

No provider tier, secret, Supabase configuration, or application row changed. The certification
created only bounded exact-pilot Auth sessions and signed them out. TASK-006 remains blocked on its
separate authorized Google OAuth and real Source-credential prototype gate.

## Files

- `platform/apps/web/src/app/lib/api-authorization.ts`
- `platform/apps/web/src/app/lib/api-transport.ts`
- `platform/apps/web/src/app/lib/trpc.ts`
- `platform/apps/web/src/app/auth/AuthSession.tsx`
- `platform/apps/web/src/app/auth/session-activation.ts`
- `docs/BUGS.md`
- `docs/TASKS.md`
