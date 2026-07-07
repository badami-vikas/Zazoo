# Dummy-Data Ledger

**Default: do not create dummy data.** Real-data-only policy stands (CLAUDE.md, ADR-026/027) — runtime
product surfaces render real connected data or an honest empty state, never a placeholder.

**If dummy data is genuinely unavoidable** (e.g. a UI needs *something* on screen to be reviewable before
its real data source exists, and an empty state would hide the thing being reviewed), the protocol is:

1. **Stop and state the reason before writing it** — what real element *should* eventually go there, why
   it can't yet (no backend procedure / no seeded workspace / third-party API not connected), and what
   would need to exist for the dummy value to be replaced by the real one. Get that in front of the user
   — this file assumes that conversation already happened, it doesn't replace it.
2. **Prefix the value** `test_fixture_` if it's test-only, or leave a `// DUMMY:` comment at the call site
   if it's runtime-visible (should be rare enough that it's always a deliberate, flagged exception).
3. **Append a row below** — file, reason, real element it stands in for, removal condition.
4. **Remove the row** (mark done, keep for history) once the real data source lands and the dummy is gone.

---

## Open

*(none — nothing dummy currently in the runtime tree as of 2026-07-07; see [BUGS.md](BUGS.md) for the
2026-07-06 purge history that got the tree to this state)*

## Resolved

*(entries move here, struck through, once removed — none yet)*
