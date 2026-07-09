-- Bridge AI — real `ref_ledger_id`/`seed`/`data_scope`/`context` columns on the
-- ledger table (hand-written; drizzle-kit emits table shape only, follows the
-- same convention as 0001_governance_seed.sql).
--
-- Fixes two related P0/P1 governance-spine bugs (docs/raw/All fixes.md Phase 1
-- items 4 and 5):
--
--   (1) `ref_ledger_id` previously only existed as a reserved key inside the
--       `diff` jsonb column (`__refLedgerId`), with no real column, no index, and
--       no constraint — so `decide()`'s double-approve check (`decisionFor()`)
--       was a plain SELECT with no atomicity guarantee: two concurrent decides
--       could both pass the check and both commit (TOCTOU), e.g. double-sending
--       an approved email. A real column + a partial unique index closes this at
--       the database: at most one NON-REJECTED decision row may reference a given
--       proposal. (A rejected/floor-denied audit row does NOT count as "resolved"
--       and is excluded from the index so a blocked attempt never blocks a later
--       legitimate decision.)
--   (2) `seed`/`data_scope`/`context` previously had no columns at all — audit
--       completeness (which ritual produced a decision, what data tier it
--       touched) required round-tripping through ad hoc jsonb keys or was
--       dropped entirely on replay. Real columns fix this at the source.
--
-- No backfill needed — pre-launch, no production data (per project convention).
-- Existing local/dev jsonb rows (if any) are NOT migrated because nothing writes
-- through the old jsonb path anymore once this ships alongside the code change in
-- the same commit.

alter table "ledger"
  add column if not exists "ref_ledger_id" uuid references "ledger"("id"),
  add column if not exists "seed" text,
  add column if not exists "data_scope" text,
  add column if not exists "context" jsonb;
--> statement-breakpoint

-- Partial unique index: at most one NON-NULL user_decision row may reference a
-- given proposal via ref_ledger_id. NULL user_decision (a rejected/floor-denied
-- audit row — see pipeline.ts decide()'s floor-deny branch) is excluded by the
-- partial predicate, so an audited-but-blocked attempt never collides with the
-- real resolution. This is the DB-level backstop for decide()'s TOCTOU: a second
-- concurrent decide racing to insert a second non-null-decision row for the same
-- ref_ledger_id now fails with a unique_violation (23505) instead of silently
-- succeeding.
create unique index if not exists "ledger_ref_ledger_id_resolved_uq" on "ledger"
  ("ref_ledger_id")
  where "ref_ledger_id" is not null and "user_decision" is not null;
--> statement-breakpoint
