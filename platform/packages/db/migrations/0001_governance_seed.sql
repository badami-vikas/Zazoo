-- Bridge AI — governance seed + enforcement DDL (hand-written; drizzle-kit emits
-- table shape only). Run AFTER 0000_*.sql. Faithful to docs/raw/SCHEMA.sql.
--
-- Three concerns the generated DDL does not cover:
--   (1) node_types registry — powers Mirror/Operational plane separation.
--   (2) append-only enforcement — REVOKE UPDATE/DELETE on the ledgered tables.
--   (3) agent-floor DENY — non-removable denies (also enforced in core's resolver,
--       "explicit deny wins"; seeded here as defense-in-depth at the DB).
--
-- The pgcrypto + vector extensions and the role_permissions coalesce-NULL unique
-- index (NULL = type-wide grant) are also (re)asserted here.

create extension if not exists "pgcrypto";
create extension if not exists "vector";

-- (0) role_permissions: type-wide grants (resource_id NULL) must be unique. The
-- generated index treats NULLs as distinct, so replace it with the coalesce form.
drop index if exists "role_permissions_uq";
create unique index if not exists "role_permissions_uq" on "role_permissions"
  ("role_id", "resource_type", "action",
   coalesce("resource_id", '00000000-0000-0000-0000-000000000000'::uuid));

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

-- (2) append-only tables: SELECT + INSERT only. UPDATE/DELETE revoked so history
-- is immutable (decisions are recorded by APPENDING rows, never mutation).
do $$
declare t text;
begin
  foreach t in array array['ledger','timeline_entries','events','decision_traces','signal_actions']
  loop
    execute format('revoke update, delete on table %I from anon, authenticated', t);
  end loop;
  -- Signals: user READ-ONLY (derivation role writes via service role).
  execute 'revoke insert, update, delete on table signals from anon, authenticated';
end $$;

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
