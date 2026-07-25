# Hosted, Supabase, and desktop reliability diagnosis

Date: 2026-07-24
Source baseline: `main@cbffa3edec921da112e46ee249546a46d76e9714`
Deployed web/API source: `163562a` (`autoDeploy: no`)

> Remediation follow-up: [hosted and desktop reliability remediation](2026-07-24-hosted-desktop-reliability-remediation.md).
> The desktop/Local Plane findings are resolved in the working tree; the hosted issue remains open
> until reviewed source is manually deployed and certified.

## Verdict

- **Hosted:** the static site is independently available, but API-dependent pages have no recovery UX for the free Render service's sleep/wake boundary. The API has started 11 times since deployment. A warm readiness request passed in 0.947 seconds; historical provider windows, not that warm sample, establish the intermittent wake boundary. The deployment is also manually stale relative to current `main`.
- **Supabase:** no capacity or quota incident was found. The project is healthy and small. Render readiness is the largest avoidable Bridge database statement family, but its absolute execution cost is tiny.
- **Desktop:** the user's current release first fails on a pre-VOCAB Local Plane compatibility regression. Development and clean-installed release paths also depend on manually prepared services or machine-local tools that are not packaged.

No production configuration/data, provider tier, task status/order, source code, deployment, or personal Local Plane data was changed.

## Hosted evidence

- Free Render Docker API: `https://bridge-pilot-api.onrender.com`
- Static site: `https://bridge-pilot-web.onrender.com`
- Both resources remain free-only with no Render database, disk, Key Value, or paid resource.
- Render logs show 11 API starts since the July 22 deployment and repeated awake windows near the free idle boundary.
- An active page was issuing tRPC requests during the final sample, so it kept the API warm. The one timed `/health/ready` request returned `200` in 0.947 seconds.
- `platform/apps/web/src/app/lib/trpc.ts` and `platform/apps/web/src/app/data/api.ts` use one-shot fetches. They have no bounded retry/readiness wait or explicit waking state, so the first API request can fail while a refresh succeeds.
- Render remains pinned to source `163562a`; current `main` is `cbffa3ed`. Manual deployment is intentional (`autoDeploy: no`) but creates visible source drift.

## Supabase attribution

- Project state: `ACTIVE_HEALTHY`
- Database size: 15,060,115 bytes
- Public schema: 55 tables, about 106 live rows
- Observed application pressure: one `bridge_app` connection; other observed connections were Supabase-managed
- July 20–24 direct services: Auth 73 requests, REST 7, Storage 3, Realtime 0
- Cumulative `bridge_app`: 25,179 statements, 43,524 rows, 9.78 seconds total execution
- Retrieved Render windows: 2,573 readiness probes, proving at least 10,292 transaction/context/read statements, or 40.9% of cumulative `bridge_app` statements
- Health-shaped zero-row ledger read: 3,513 calls, 0 rows, 32.20 ms total execution. The retained normalized count is larger than the provider-window count, but its parameters are unavailable, so only the provider-proven lower bound is assigned to readiness.
- Two 65-second global-stat samples while the API was warm advanced by 39 commits/2,055 returned tuples and 68 commits/2,181 returned tuples. Readiness and active-page traffic were present, and the counters combine every role, so these samples cannot isolate Bridge from Supabase-managed activity.

The evidence rules out database size, Auth MAU, direct API-request volume, and connection saturation as the reported limit problem. Readiness is the largest avoidable Bridge statement family by confirmed call count, not an expensive workload by execution time. Exact organization-billing egress by service/day requires an authenticated Supabase Dashboard billing session and was not available through the CLI PAT.

## Desktop evidence

### Development

`pnpm --filter @bridge/desktop dev` starts only Tauri. `beforeDevCommand` is empty.

1. The first launch rendered blank because Vite returned `500`: `@bridge/module-manifests` was not linked/built.
2. A frozen workspace install plus the targeted manifest build restored the shell.
3. With no API, the shell reported `Modules unavailable`.
4. With a separately started persistent API, transport existed but reads remained unauthenticated. Debug Tauri does not spawn the sidecar or inject its capability token.

### Release on the current machine

The sidecar stopped before reporting a port:

```text
external_records exists with an unsupported schema
```

`prepareLegacyLocalExternalRecords()` runs before migrations. It recognizes UUID `organization_id`, but the original canonical migration created UUID `workspace_id`. Migration `0021_vocab3_organization_module_record.sql` would rename that column, but the guard rejects the database first. This is the first current failure against the existing Local Plane.

### Clean installation

The current macOS bundle is about 11 MB and contains only `icon.icns` under Resources. It contains neither `api/server.js` nor a Node runtime.

- With the repository API build temporarily absent, the bundle logged: `no API build found`.
- With a Finder-like PATH, it found the compile-time repository path but logged: `failed to spawn node`.
- All temporarily moved build output was restored.

The installer is therefore not portable to a machine without this repository and a discoverable system Node.

## Smallest safe remediation order

1. Add a pre-VOCAB canonical `external_records.workspace_id uuid` compatibility case and an upgrade/reopen regression before running anything against a copy of the user's Local Plane.
2. Package a pinned API runtime with the desktop app; remove production reliance on a compile-time repository path and system Node.
3. Make one development command prepare dependencies, Vite, API, and verified local identity.
4. Add a bounded idempotency-aware Render wake/readiness state in the web client. Keep mutations from being blindly retried.
5. Move provider health to cheap liveness and run persistent readiness at a lower explicit cadence, then re-measure `bridge_app` statements and Dashboard egress.
6. Review and manually deploy current `main`; remain on free resources unless the user separately approves a paid availability target.

## Records

- Bugs: [`docs/BUGS.md`](../docs/BUGS.md)
- Canonical tasks: [`docs/TASKS.md`](../docs/TASKS.md) (TASK-006, TASK-018)
- Deployment baseline: [`outputs/2026-07-21-render-free-deployment.md`](2026-07-21-render-free-deployment.md)
