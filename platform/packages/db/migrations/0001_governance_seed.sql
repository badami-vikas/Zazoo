-- Bridge AI — governance seed + enforcement DDL (hand-written; drizzle-kit emits
-- table shape only). Run AFTER 0000_*.sql. Faithful to docs/raw/SCHEMA.sql.
--
-- Three concerns the generated DDL does not cover:
--   (1) node_types registry — powers Mirror/Operational plane separation.
--   (2) append-only enforcement — REVOKE UPDATE/DELETE on the ledgered tables.
--   (3) agent-floor DENY — non-removable denies (also enforced in core's resolver,
--       "explicit deny wins"; seeded here as defense-in-depth at the DB).
--
-- The vector extension and the role_permissions coalesce-NULL unique index
-- (NULL = type-wide grant) are also (re)asserted here. (pgcrypto was previously
-- asserted here too but nothing in this schema calls a pgcrypto-specific function
-- — gen_random_uuid() has been a Postgres-core builtin since PG13 — and pglite's
-- extension bundle doesn't ship pgcrypto the way it ships vector, so asserting it
-- broke the local-plane migration path for no actual functional need. Removed
-- 2026-07-04; if a future column genuinely needs crypt()/digest()/pgp_sym_*, add
-- it back deliberately alongside whatever loads it for pglite.)

create extension if not exists "vector";
--> statement-breakpoint

-- (0) role_permissions: type-wide grants (resource_id NULL) must be unique. The
-- generated constraint (0000: CONSTRAINT "role_permissions_uq" UNIQUE(...)) treats
-- NULLs as distinct, so replace it with the coalesce form. Constraint-backed indexes
-- can't be dropped with DROP INDEX (Postgres: "requires it" — the index is owned by
-- the constraint); ALTER TABLE ... DROP CONSTRAINT is required instead.
alter table "role_permissions" drop constraint if exists "role_permissions_uq";
--> statement-breakpoint
create unique index if not exists "role_permissions_uq" on "role_permissions"
  ("role_id", "resource_type", "action",
   coalesce("resource_id", '00000000-0000-0000-0000-000000000000'::uuid));
--> statement-breakpoint

-- (1) node_types registry (plane tag per node type).
insert into "node_types" ("type", "plane") values
  ('person', 'mirror'),
  ('community', 'mirror'),
  ('initiative', 'operational'),
  ('touchpoint', 'operational'),
  ('ritual', 'operational'),
  ('tool', 'operational'),
  ('agent', 'operational'),
  ('skill', 'operational'),
  ('file', 'operational'),
  ('signal', 'operational'),
  ('integration', 'operational'),
  ('ledger', 'infra')
on conflict ("type") do nothing;
--> statement-breakpoint

-- (2) append-only tables: SELECT + INSERT only. UPDATE/DELETE revoked so history
-- is immutable (decisions are recorded by APPENDING rows, never mutation).
-- `anon`/`authenticated` are Supabase's PostgREST roles — they exist on the cloud
-- canonical target this migration was written for, but NOT on the local plane
-- (pglite: a vanilla, single-role Postgres with no PostgREST roles at all, per
-- client-local.ts). Guard on role existence so this migration applies cleanly to
-- both targets instead of erroring "role does not exist" on the local plane.
do $$
declare t text;
declare r text;
begin
  foreach r in array array['anon', 'authenticated']
  loop
    if not exists (select 1 from pg_catalog.pg_roles where rolname = r) then
      continue;
    end if;
    foreach t in array array['ledger','timeline_entries','events','decision_traces','signal_actions']
    loop
      execute format('revoke update, delete on table %I from %I', t, r);
    end loop;
    -- Signals: user READ-ONLY (derivation role writes via service role).
    execute format('revoke insert, update, delete on table signals from %I', r);
  end loop;
end $$;
--> statement-breakpoint

-- (3) agent-floor DENY — seed a workspace-agnostic deny template. Apply per
-- workspace at provisioning (workspace_id + a stable system actor for agents).
-- Mirrors core/src/authority.ts AGENT_FLOOR_*; the resolver enforces it regardless,
-- this row set makes the intent auditable in the permissions table.
--
-- Example (per workspace :ws, agent class actor :agent):
--   insert into permissions (workspace_id, actor_type, actor_id, resource_type, action, effect, granted_by)
--   select :ws, 'agent', :agent, rt, act, 'deny', null
--   from   (values ('policy'),('policy_param'),('skill'),('agent'),('role'),
--                  ('permission'),('ledger'),('delegation')) as r(rt),
--          (values ('write'),('execute'),('archive')) as a(act);
--   -- plus: ('network_graph:full','read') and ('external:send','share').
--
-- Left as a documented template (not executed) because it requires concrete
-- workspace_id + agent actor_id, which are provisioned at workspace creation.
