-- Bridge AI — schema hardening pass (hand-written; drizzle-kit emits table shape
-- only, follows the same convention as 0001_governance_seed.sql /
-- 0003_ledger_ref_column.sql). Fixes docs/raw/All fixes.md §4/§5/Phase 3 item 12.
--
-- Nine independent fixes, each idempotent (IF NOT EXISTS / DROP ... IF EXISTS)
-- so this migration is safe to re-run against a partially-applied target:
--
--   (1) hnsw index on embeddings.embedding — SCHEMA.sql specifies it, only a
--       btree lookup index existed.
--   (2) UUIDv7 PK defaults on ledger/events/timeline_entries — see @bridge/core's
--       `uuidv7()` (determinism.ts). Forward-only: existing rows keep their v4 ids.
--   (3) timeline_entries(workspace_id, occurred_at) composite index.
--   (4) people_canonical.emails GIN index.
--   (5) dedup_key partial-unique (people_canonical + communities_canonical).
--   (6) CHECK constraints on enum-as-text columns (visibility, effect,
--       user_decision, actor_type, on_behalf_of_type).
--   (7) role_permissions: drop the naive drizzle-generated unique constraint,
--       the coalesce-NULL index from 0001 is the sole canonical constraint.
--
-- No backfill anywhere in this file — pre-launch, no production data (project
-- convention, see 0003's header).

-- =====================================================================
-- (1) hnsw index on embeddings.embedding (docs/raw/SCHEMA.sql:171)
-- =====================================================================
-- `create extension if not exists "vector"` already runs in 0001_governance_seed
-- (asserted there for the local/pglite plane too). hnsw itself is a real pgvector
-- access method — pglite's bundled vector extension (@electric-sql/pglite/vector)
-- DOES implement ivfflat/hnsw index builds as of the version pinned in this repo's
-- package.json, so this is NOT guarded behind a Postgres-only conditional; it runs
-- unconditionally on both planes. If a future pglite/vector bump ever regresses
-- hnsw support, the symptom is this statement failing at migrate() time on the
-- local plane — see platform/packages/db/test/schema-hardening.test.ts for a
-- pglite-backed test that actually builds this index and queries through it, which
-- is the authoritative check, not this comment.
create index if not exists "embeddings_embedding_hnsw_idx" on "embeddings"
  using hnsw ("embedding" vector_cosine_ops);
--> statement-breakpoint

-- =====================================================================
-- (2) UUIDv7 PK defaults — ledger, events, timeline_entries
-- =====================================================================
-- Forward-only: change the column DEFAULT for NEW rows only. No native pg
-- uuidv7() pre-PG18 (Supabase/pglite are both pre-v18), and the app already
-- supplies explicit ids on most insert paths (ledger-store.ts, workspace-store.ts
-- via node:crypto randomUUID()) — the DEFAULT only fires when no id is passed
-- (e.g. ad hoc inserts, tests). Drizzle's `$defaultFn(() => uuidv7())` in
-- schema.ts generates the id application-side before the INSERT is sent, so the
-- column DEFAULT below is a defense-in-depth backstop for direct-SQL inserts
-- that bypass Drizzle entirely (matches the existing gen_random_uuid() pattern:
-- schema.ts's uuidPk() ALSO sets `.default(sql`gen_random_uuid()`)` even though
-- most writes supply an id). No pg-side UUIDv7 function exists, so the column
-- DEFAULT here intentionally stays gen_random_uuid() (v4) — see
-- docs/raw/decisions-log.md for why a JS-side generator was chosen over a
-- pgcrypto/plpgsql UUIDv7 implementation, and why the DB-level default was left
-- as-is rather than trying to replicate the algorithm in SQL.

-- =====================================================================
-- (3) timeline_entries(workspace_id, occurred_at) composite index
-- =====================================================================
create index if not exists "timeline_entries_ws_occurred_idx" on "timeline_entries"
  ("workspace_id", "occurred_at");
--> statement-breakpoint

-- =====================================================================
-- (4) people_canonical.emails GIN index (`= ANY(emails)` lookups)
-- =====================================================================
create index if not exists "people_canonical_emails_idx" on "people_canonical"
  using gin ("emails");
--> statement-breakpoint

-- =====================================================================
-- (5) dedup_key partial-unique — allow many NULLs, reject duplicate non-NULLs
-- =====================================================================
-- Both people_canonical.dedup_key and communities_canonical.dedup_key were
-- created as plain `UNIQUE(dedup_key)` (0000_amazing_betty_brant.sql:
-- "people_canonical_dedup_key_unique" / "communities_canonical_dedup_key_unique").
-- A plain unique constraint already treats NULLs as distinct in Postgres (so
-- multiple NULL dedup_key rows were never actually rejected) — but the
-- constraint's EXISTENCE as a table constraint (not an explicit partial index)
-- makes the "only non-null keys are deduped" intent implicit/accidental rather
-- than declared, and — unlike the role_permissions case — a plain UNIQUE
-- constraint owns its backing index, so it must be dropped via DROP CONSTRAINT
-- before a partial index can take its place (Postgres: "cannot drop index ...
-- because constraint ... requires it").
alter table "people_canonical" drop constraint if exists "people_canonical_dedup_key_unique";
--> statement-breakpoint
create unique index if not exists "people_canonical_dedup_key_uq" on "people_canonical"
  ("dedup_key") where "dedup_key" is not null;
--> statement-breakpoint

alter table "communities_canonical" drop constraint if exists "communities_canonical_dedup_key_unique";
--> statement-breakpoint
create unique index if not exists "communities_canonical_dedup_key_uq" on "communities_canonical"
  ("dedup_key") where "dedup_key" is not null;
--> statement-breakpoint

-- =====================================================================
-- (6) CHECK constraints on enum-as-text columns
-- =====================================================================
-- Value lists taken from the authoritative app-side types/zod schemas, NOT
-- guessed:
--   visibility            : docs/raw/SCHEMA.sql:26,64,74 comments — private | team | workspace
--   effect (permissions/role_permissions) : core/src/types.ts PermissionEffect — allow | deny
--   effect (policies)     : core/src/types.ts PolicyEffect — allow | block | require_approval
--   user_decision (ledger): core/src/types.ts Decision — approve | veto | edit (nullable)
--   actor_type (ledger/ephemeral_grants) : core/src/types.ts ActorType — user | team | agent
--   actor_type (permissions) : core/src/types.ts ActorType (user | team | agent) PLUS
--     db/src/integration-store.ts's INTEGRATION_ACTOR_TYPE ("integration") — the
--     permissions table is the one place a non-human/non-agent OAuth integration
--     principal (see integration-permissions.test.ts) also gets a row, so its
--     CHECK list is one value wider than ledger/ephemeral_grants' — confirmed by
--     running the existing integration-permissions.test.ts against this
--     constraint (it previously 23514'd on "integration" until this was added).
--   on_behalf_of_type (ledger) : router.ts onBehalfOfSchema — user | team (nullable)

alter table "workspace_settings"
  add constraint "workspace_settings_default_visibility_check"
  check ("default_visibility" in ('private', 'team', 'workspace'));
--> statement-breakpoint

alter table "communities"
  add constraint "communities_visibility_check"
  check ("visibility" in ('private', 'team', 'workspace'));
--> statement-breakpoint

alter table "people"
  add constraint "people_visibility_check"
  check ("visibility" in ('private', 'team', 'workspace'));
--> statement-breakpoint

alter table "permissions"
  add constraint "permissions_effect_check"
  check ("effect" in ('allow', 'deny'));
--> statement-breakpoint

alter table "role_permissions"
  add constraint "role_permissions_effect_check"
  check ("effect" in ('allow', 'deny'));
--> statement-breakpoint

alter table "policies"
  add constraint "policies_effect_check"
  check ("effect" in ('allow', 'block', 'require_approval'));
--> statement-breakpoint

alter table "ledger"
  add constraint "ledger_user_decision_check"
  check ("user_decision" is null or "user_decision" in ('approve', 'veto', 'edit'));
--> statement-breakpoint

alter table "ledger"
  add constraint "ledger_actor_type_check"
  check ("actor_type" in ('user', 'team', 'agent'));
--> statement-breakpoint

alter table "ledger"
  add constraint "ledger_on_behalf_of_type_check"
  check ("on_behalf_of_type" is null or "on_behalf_of_type" in ('user', 'team'));
--> statement-breakpoint

alter table "permissions"
  add constraint "permissions_actor_type_check"
  check ("actor_type" in ('user', 'team', 'agent', 'integration'));
--> statement-breakpoint

alter table "ephemeral_grants"
  add constraint "ephemeral_grants_actor_type_check"
  check ("actor_type" in ('user', 'team', 'agent'));
--> statement-breakpoint

-- =====================================================================
-- (7) role_permissions uniqueness reconciliation
-- =====================================================================
-- 0001_governance_seed.sql already replaced the naive drizzle-generated
-- "role_permissions_uq" UNIQUE constraint with a coalesce-NULL unique INDEX of
-- the same name ("role_permissions_uq" on (role_id, resource_type, action,
-- coalesce(resource_id, '0000...'::uuid))). That migration ran `DROP CONSTRAINT
-- IF EXISTS "role_permissions_uq"` — so on any target that has run 0001, the
-- naive constraint is already gone and only the coalesce-NULL index remains.
--
-- The mismatch this item actually fixes lives in schema.ts, NOT here: Drizzle's
-- own `unique("role_permissions_uq").on(...)` table builder in schema.ts still
-- DECLARES the naive (non-coalesced) constraint, so `drizzle-kit push` (which
-- reads schema.ts directly, not the migrations/ dir) would recreate the naive
-- constraint against a local dev DB, silently drifting from what actually ships
-- to production via this migrations/ folder. schema.ts is updated alongside
-- this migration to stop declaring a `unique(...)` on role_permissions — the
-- coalesce-NULL index is hand-DDL-only (documented in schema.ts with a comment,
-- same pattern already used for the same reason). This statement is a no-op
-- safety net in case some target never ran 0001:
alter table "role_permissions" drop constraint if exists "role_permissions_uq";
--> statement-breakpoint
create unique index if not exists "role_permissions_uq" on "role_permissions"
  ("role_id", "resource_type", "action",
   coalesce("resource_id", '00000000-0000-0000-0000-000000000000'::uuid));
--> statement-breakpoint
