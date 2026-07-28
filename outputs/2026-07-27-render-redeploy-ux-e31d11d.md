# Render redeploy of shell/nav UX (e31d11d); Supabase no-op

Date: 2026-07-27 (UTC deploy window 18:39–18:41Z)
Deployment source: `e31d11d1c88e4abebdd1aae5c81ae2cd6a4170b9` (`main`)

## Request

"Deploy to Render and Supabase" after merging the AP-081 shell/nav/panel/page-anatomy UX
realignment to `main`.

## Outcome

Both free Render services were manually redeployed from `main@e31d11d` and went live and healthy.
Supabase required no action: HEAD's migration high-water (`0032`) was already applied to the pilot
database on 2026-07-27 when the TASK-026 chat commit (`1c5340d`) went live. Everything merged
between `1c5340d` and HEAD is web/docs only — no schema change.

## Deployment

- Web static deploy `dep-d9jqbi6rnols7398jm30`: live at `e31d11d`, finished 2026-07-27T18:40:10Z.
- API Docker deploy `dep-d9jqbkbeo5us73btn5k0`: live at `e31d11d`, finished 2026-07-27T18:41:08Z.
- Trigger: Render REST API `POST /v1/services/{id}/deploys` (`clearCache: do_not_clear`) using the
  local Render CLI session key; `autoDeploy` remains `no` on both services.
- Services connect to `github.com/manishsbhoopalam8498/relationship-os@main`, whose `main` was
  verified equal to local HEAD before triggering.

## Live certification

- Web root: HTTP `200` in 0.35s.
- API `/health`: HTTP `200` in 0.35s.
- API `/health/ready`: HTTP `200` — `{"ready":true,"persistent":true,"boundary":"public-cloud",
  "checks":{"ledger":"ok","localPlane":"ok"}}`. The healthy `ledger` probe exercises the live
  Supabase connection.

## Supabase

- No migration applied or needed. Pilot high-water is `0032` (advanced `0030 → 0032` on 2026-07-27
  per the TASK-026 rollout log entry); HEAD high-water is also `0032`.
- Not independently re-verified this session: the Supabase MCP available here is authenticated to a
  different account (only project `CorpSim` / `whtvssedmrglfrbhrlsa`, us-west-2 is visible). The
  pilot project `bridge-dealpilot-pilot` (us-east-1) was not reachable, no `supabase` CLI is
  installed, and no owner URI was handled. The "already at 0032" conclusion rests on the live API
  commit, the prior log entry, and the healthy readiness ledger probe.

## Boundaries and follow-ups

- No provider tier, secret, Supabase setting, or production row changed. No Render disk, database,
  Key Value, or paid resource created.
- The API had no code change from its previously-live commit `1c5340d`; its redeploy only aligns the
  live commit to `e31d11d` and is behaviorally identical.
- `render.yaml` still names the old repo `badami-vikas/relationship-os`; the live services are
  connected to `manishsbhoopalam8498/relationship-os`. Manual deploys use the service connection, so
  this was not blocking, but the blueprint file is stale and should be corrected.
- Pre-existing, unrelated: web `typecheck` reports 29 `trpc.chat` type errors from stale local
  `@bridge/api` build output (see `docs/BUGS.md`). Type-only; the web bundle is `vite build` (no
  typecheck gate), so it did not affect this deploy.
