# Resilience patterns (wiki)

full: [../raw/RESILIENCE-PATTERNS.md](../raw/RESILIENCE-PATTERNS.md)

Source: PeopleGamez post-mortem (Firebase game → Durable-Objects+Postgres). 14 failure classes. Bridge assess.

**Core**: ritual run = Bridge "authoritative actor". Same shape as PeopleGamez root bug (truth smeared across DB+triggers+cron → 2 code paths diverge). Fix = build ritual executor as deterministic reducer over append-only ledger. **Replay = audit** (fold log → same state = explain why agent did X for free).

**Already dodged/validated** (locked calls confirmed):
- #7 authz drift → single `workspace_members` + `requireAuthority` + perms-from-DB-not-JWT. See [authz-hardening](../raw/AUTHZ-HARDENING.md) / [decisions](decisions.md).
- #2 ledger drift → append-only locked. RULE: no writable aggregate beside event log; derive by fold.
- #5 timing → Hatchet precise per-job sched, not coarse cron.
- #12 info leak → two-tier + scoped AI release = per-role projection.
- #14 Firebase modes → Postgres+RLS day 0. "DB+triggers ≠ coordination server" → don't run rituals on pg_cron.

**Adopt now** (cheap pre-code, dear later):
- #8 DETERMINISM: inject ctx.now + seeded RNG; lint-ban Date.now/Math.random in engine/agent. → ledger replayable = auditable.
- #13 CONFORMANCE: broaden authz-conformance → **Governance Conformance Suite** (authz + replay-equality + projection no-leak + lifecycle + policy phases), CI-gated. Ritual can't ship till pass.
- #3 ONE VALIDATE CHOKEPOINT: Zod at `data/db.ts` seam; strip undefined, coerce non-finite, loud NaN test. (warmth/trust derived numerics → silent NaN mislabel risk.)
- #4 STATE MACHINES: `ritual_runs` + decisions as machines (intro-consent already is). Illegal transition impossible.

**Lighter** (track, apply in build): #1 canonical write = idempotent upsert by `dedup_key` (append-only enrich, no in-place RMW) · #9 stable ids (fix db.ts `SB-i` fallback) · #10 files→Supabase Storage (id not bytes) · #6 ritual ownership = reassignable+audited handover · #11 renderers low-relevance (B2B).

**Refinement to prior call**: RLS = COARSE defense-in-depth (workspace + visibility tier) ONLY. Fine policy (role∩ceiling∪ephemeral−deny, delegation) lives ONLY in `requireAuthority`. Re-encode fine policy in SQL = recreate multi-source drift. Don't.

**Roadmap**: all P1/P2 (governance spine + runtime) constraints = the runtime that makes functional rituals run. This guide = ritual-executor spec. Commit determinism+conformance+projection in ARCHITECTURE.md now.
