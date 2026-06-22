# Known Issues

Cross-session ledger of bugs / gaps / abnormalities. Persist across sessions. Agents:
spot something off → add row here, do NOT wait for user ask. Fix → mark RESOLVED + date.
Full rationale of decisions → [../raw/decisions-log.md](../raw/decisions-log.md).

Status: OPEN | IN PROGRESS | RESOLVED. Newest first.

---

- **IN PROGRESS — Identity client-asserted on `propose`.** API trusts request-body actor
  for non-decide paths. `decide` now uses server `ctx.identity` (pinned pilot user). Full
  fix = Supabase JWT verify → real per-user identity + bind human actor on propose +
  constrain client-chosen agent actors. Decider pin closes approve-spoof now. See
  decisions-log 2026-06-22 (identity).

- **OPEN — Denied approval attempts not audited.** `pipeline.decide()` throws on
  agent-floor deny BEFORE ledger append → no audit row for a blocked approve try. Add
  audited-rejection row in auth-binding pass. Append-only spine else intact.

- **OPEN — No per-human approval RBAC.** Floor blocks agents from approving; ANY human
  passes (no `ledger:approve` grant required yet). Layer human approval roles via full
  `resolveAuthority(approve, ledger)` later. Intentional, tracked.

- **OPEN — Dummy purge pending.** Hard-purge decided (remove FakeGoogleGateway + all
  dummy_ + fixtures; tests need live creds). Not yet executed. See decisions-log
  2026-06-22 (dummy). Until done, `dummy_` data still in `integrations-google` gateway +
  tests + wiring seeds.
