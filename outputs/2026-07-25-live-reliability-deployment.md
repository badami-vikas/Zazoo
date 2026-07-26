# Live reliability deployment and Supabase check

Date: 2026-07-25
Deployment source: `015716c8ed2aaa176756a0c92d8afb615d3de99e`

## Outcome

The hosted reliability changes are live on the existing free Render pilot. The connected Supabase
project is healthy, small, policy-backed, and not capacity-bound. Cheap Render liveness no longer
creates database work.

## Deployment

- API deploy `dep-d9i6bbt0kf9s73baeuc0`: live.
- Web deploy `dep-d9i6bbq4hv7c73bmsrvg`: live.
- Both deploys use exact commit `015716c`.
- Web returned `200` in 0.444 seconds.
- API `/health` returned `200` in 0.324 seconds.
- API `/health/ready` returned `200` in 1.306 seconds with persistent `public-cloud` checks.
- Exact web-origin CORS returned `204`.
- Post-deploy API logs contained no error-level entries.
- The deployed web bundle contains the waking and reconnect banners.

## Live Supabase

- Project: `bridge-dealpilot-pilot`, `us-east-1`, `ACTIVE_HEALTHY`.
- PostgreSQL: 17.6.
- Database size: 15,060,115 bytes.
- Public tables: 55.
- Estimated public rows: 108.
- Observed `bridge_app` connections: 2.
- RLS-enabled public tables: 41.
- RLS-enabled tables without a policy: 0.
- Public policies: 141.
- GoTrue Auth health: `200`.
- `bridge_app`: login enabled; no superuser, inheritance, database-create, role-create, replication,
  or RLS-bypass attributes.

Retained cumulative `bridge_app` statistics were 35,684 statements, 56,710 rows, and 10.89 seconds
total execution. Those cumulative values include activity before this deployment and are not a
post-deploy rate.

## Pressure remeasurement

A 65-second post-deploy sample contained 19 Render `/health` requests. Over the same interval:

- statement delta: 0;
- row delta: 0;
- execution-time delta: 0 ms.

This directly proves that the new `/health` liveness path does not consume Supabase statements.

## Boundaries

- No provider tier, secret, Supabase setting, or production row changed.
- At this deployment checkpoint, natural cold wake, exact-375px recovery, and live Auth refresh
  remained open. They are now closed by
  [the AP-075 follow-up](2026-07-25-hosted-cold-wake-auth-refresh.md).
- The clean full API suite still has 13 unrelated baseline contract failures; changed-surface
  security, web, Local Plane, core, Rust, bundle, build, vocabulary, and runtime checks passed.

## Files

- Hosted transport: `platform/apps/web/src/app/lib/api-transport.ts`,
  `platform/apps/web/src/app/lib/trpc.ts`
- Provider liveness: `render.yaml`
- Evidence: `docs/BUGS.md`, `docs/TASKS.md`, `docs/log.md`
