-- Bridge AI — Schema v2 (for refinement)
-- Target: Postgres / Supabase. Conventions:
--   * uuid PKs (gen_random_uuid); ULIDs at app layer acceptable
--   * every tenant-scoped table carries workspace_id + RLS (deny-by-default)
--   * soft-delete via archived_at (NEVER hard delete)
--   * append-only tables (events, ledger, timeline, signal_actions) revoke UPDATE/DELETE
--   * TWO TIERS: canonical (platform, global, public facts) vs relationship (per-user, private)
--   * GOVERNANCE: roles -> permissions (CBAC), delegations (on-behalf-of), ephemeral grants, append-only ledger

create extension if not exists "pgcrypto";
create extension if not exists "vector";

-- =====================================================================
-- LAYER 1 — TENANCY (infrastructure; kept OUT of the Mirror)
-- =====================================================================
create table users (
  id uuid primary key default gen_random_uuid(),
  email text unique not null, name text, created_at timestamptz not null default now()
);
create table workspaces (
  id uuid primary key default gen_random_uuid(),
  name text not null, created_at timestamptz not null default now(), archived_at timestamptz
);
create table workspace_settings (                 -- v2: workspace-admin controls
  workspace_id uuid primary key references workspaces(id),
  default_visibility text not null default 'private',  -- private | team | workspace : default for new relationship rows
  settings jsonb not null default '{}'
);
create table workspace_members (
  workspace_id uuid not null references workspaces(id),
  user_id uuid not null references users(id),
  role_id uuid,                                   -- v2: -> roles(id)
  primary key (workspace_id, user_id)
);
create table teams (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id), name text not null, archived_at timestamptz
);
create table team_members (
  team_id uuid not null references teams(id), user_id uuid not null references users(id),
  primary key (team_id, user_id)
);

-- =====================================================================
-- LAYER 2 — TWO-TIER NETWORK  (canonical = platform/global; relationship = per-user/private)
-- =====================================================================
create table people_canonical (                   -- AI-enriched PUBLIC facts. Global, deduped, no tenant linkage.
  id uuid primary key default gen_random_uuid(),
  full_name text, preferred_name text, current_title text, current_company_name text, bio text,
  linkedin_url text, twitter_handle text, github_handle text, website_url text, emails text[],
  location_city text, location_country text, avatar_url text,
  enrichment_source text, last_enriched_at timestamptz, enrichment_confidence numeric,
  dedup_key text unique                            -- normalized linkedin_url / primary email (identity resolution)
);
create table communities_canonical (
  id uuid primary key default gen_random_uuid(),
  name text, kind text, description text, website_url text, logo_url text, linkedin_url text,
  member_count_approx int, headquarters_city text, headquarters_country text, dedup_key text unique
);

create table communities (                        -- created before people: people.current_community_id -> communities(id)
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id), user_id uuid not null references users(id),
  visibility text not null default 'private',
  canonical_community_id uuid references communities_canonical(id),
  name_override text, description_override text, kind text, primary_place_id uuid,
  warmth_avg numeric, is_user_confirmed boolean not null default false,
  source text not null default 'user', archived_at timestamptz
);
create table people (                             -- RELATIONSHIP tier: per-(workspace,user), private. The LOCAL/E2EE tier.
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id),
  user_id uuid not null references users(id),                 -- whose relationship view (author/owner)
  visibility text not null default 'private',                 -- private | team | workspace (default from workspace_settings)
  canonical_person_id uuid references people_canonical(id),   -- nullable: may exist before enrichment match
  full_name_override text, current_title_override text, bio_override text, avatar_url_override text, emails_override text[],
  current_community_id uuid references communities(id),
  source text,                                                -- gmail | gcal | manual | import ...
  ring_placement int, warmth_score numeric, reciprocity_score numeric, dormancy_risk numeric,
  last_interaction_at timestamptz, context_freshness_at timestamptz,
  is_pinned_to_inner boolean not null default false, is_muted boolean not null default false,
  created_at timestamptz not null default now(), archived_at timestamptz
);
create index on people (workspace_id, user_id);
create index on people (canonical_person_id);

create table community_members (
  community_id uuid not null references communities(id), person_id uuid not null references people(id),
  role text, confidence numeric, primary key (community_id, person_id)
);

-- Unified graph fabric: person<->person (KNOWS/INTRODUCED) + cross-plane links. ONE traversable graph.
create table node_types (                         -- v2: registry powering plane separation
  type text primary key,                          -- person | community | initiative | touchpoint | automation | module | agent | skill | file | signal | integration
  plane text not null                             -- mirror | operational | infra
);
create table edges (
  id uuid primary key default gen_random_uuid(), workspace_id uuid not null references workspaces(id),
  src_type text not null, src_id uuid not null, dst_type text not null, dst_id uuid not null,
  edge_type text not null,                         -- KNOWS|MEMBER_OF|INTRODUCED (mirror) ; PARTICIPATES_IN|ASSIGNED_TO|GENERATED_BY|DERIVED_FROM|REFERENCES|SUPPORTS|ALIGNS_TO (cross-plane, whitelisted)
  properties jsonb not null default '{}', created_at timestamptz not null default now()
);
create index on edges (workspace_id, src_type, src_id);
create index on edges (workspace_id, dst_type, dst_id);
-- INVARIANT (app-enforced at write): Mirror<->Operational edges allowed ONLY for the whitelisted cross-plane edge_types above;
-- KNOWS/MEMBER_OF live only between mirror nodes. Keeps the Mirror exportable + unpolluted.

-- =====================================================================
-- LAYER 3 — OPERATIONAL PLANE
-- =====================================================================
create table initiatives (
  id uuid primary key default gen_random_uuid(), workspace_id uuid not null references workspaces(id),
  title text not null, goal text,                          -- v2: structured goal (distinct from description) for decomposition
  description text, decomposition_strategy jsonb,           -- v2: Planner agent config
  status text default 'active', start_date date, target_date date,
  created_at timestamptz not null default now(), archived_at timestamptz
);
create table initiative_participants (
  initiative_id uuid not null references initiatives(id), person_id uuid not null references people(id),
  role text, primary key (initiative_id, person_id)
);
create table initiative_communities (
  initiative_id uuid not null references initiatives(id), community_id uuid not null references communities(id),
  primary key (initiative_id, community_id)
);
create table touchpoints (                        -- v2: hierarchical (Taskade-style goal cascade)
  id uuid primary key default gen_random_uuid(), workspace_id uuid not null references workspaces(id),
  initiative_id uuid references initiatives(id),
  parent_touchpoint_id uuid references touchpoints(id),    -- v2: tree; null = root
  sort_order int not null default 0, depth int not null default 0,  -- v2
  touchpoint_kind text, alignment_score numeric,           -- v2: how well this serves the parent/goal
  assignee_type text not null, assignee_id uuid not null,  -- person | community | agent | user | team
  context text, due_date timestamptz, status text not null default 'open',
  created_at timestamptz not null default now()
);
create index on touchpoints (initiative_id, parent_touchpoint_id);

create table timeline_entries (                   -- append-only continuity (embeddings now in central table)
  id uuid primary key default gen_random_uuid(), workspace_id uuid not null references workspaces(id),
  occurred_at timestamptz not null, type text not null, content text,
  created_by text not null, created_at timestamptz not null default now()
);
create table timeline_entry_refs (
  entry_id uuid not null references timeline_entries(id), entity_type text not null, entity_id uuid not null,
  primary key (entry_id, entity_type, entity_id)
);
create table files (
  id uuid primary key default gen_random_uuid(), workspace_id uuid not null references workspaces(id),
  source text not null, storage_ref text, content_text text, metadata jsonb not null default '{}',
  created_at timestamptz not null default now(), archived_at timestamptz
);
create table file_refs (
  file_id uuid not null references files(id), entity_type text not null, entity_id uuid not null,
  primary key (file_id, entity_type, entity_id)
);

-- =====================================================================
-- LAYER 3b — CENTRAL EMBEDDINGS (decoupled from entity tables)
-- pgvector dim is FIXED per column. v1 = nomic-embed-text-v1.5 (768).
-- Same-dim models -> add rows here (distinct embedding_model). Different-dim model -> sibling table embeddings_<model>(vector(dim)) + flip embedding_models.is_active.
-- =====================================================================
create table embeddings (
  id uuid primary key default gen_random_uuid(),
  entity_type text not null, entity_id uuid not null,       -- polymorphic ref (person|community|timeline_entry|file|initiative|signal|note...)
  embedding_model text not null default 'nomic-embed-text-v1.5',
  embedding_version text not null default '1',
  embedding vector(768) not null,
  created_at timestamptz not null default now(),
  unique (entity_type, entity_id, embedding_model)
);
create index on embeddings using hnsw (embedding vector_cosine_ops);
create index on embeddings (entity_type, entity_id);
create table embedding_models (                   -- which model/table is active for reads
  embedding_model text primary key, dim int not null, table_name text not null, is_active boolean not null default false
);

-- =====================================================================
-- LAYER 4 — CAPABILITY REGISTRIES
-- =====================================================================
create table skills (
  id uuid primary key default gen_random_uuid(), workspace_id uuid references workspaces(id),
  name text not null, version text not null default '1.0.0', input_schema jsonb, output_schema jsonb,
  impl_ref text, status text not null default 'active', unique (workspace_id, name, version)
);
create table agents (
  id uuid primary key default gen_random_uuid(), workspace_id uuid not null references workspaces(id),
  name text not null, identity_type text not null default 'service_principal', owner_user_id uuid references users(id),
  assumes_role_id uuid,                            -- v2: agent INHERITS from this role
  goal text, allowed_skills uuid[] not null default '{}',
  capability_scope jsonb not null default '{}',    -- v2: a CEILING; effective authority = role_grants INTERSECT capability_scope
  status text not null default 'active'
);
create table automations (                        -- stored Agent-owned execution definition
  id uuid primary key default gen_random_uuid(), workspace_id uuid not null references workspaces(id),
  name text not null, trigger jsonb not null, cadence text,
  agent_id uuid not null, agent_plane text not null check (agent_plane in ('local', 'cloud')),
  skill_pipeline jsonb not null default '[]', policy_scope_id uuid, output_surface text,
  supports_initiative uuid references initiatives(id), is_template boolean not null default false,
  status text not null default 'active', archived_at timestamptz,
  unique (workspace_id, id), unique (workspace_id, id, agent_id),
  foreign key (workspace_id, agent_id) references agents(workspace_id, id)
);
create table automation_runs (                    -- attributable Agent Run (feeds the ledger)
  id uuid primary key default gen_random_uuid(), workspace_id uuid not null references workspaces(id),
  automation_id uuid not null, agent_id uuid not null, run_id text,
  status text not null default 'running',
  started_at timestamptz not null default now(), finished_at timestamptz, output jsonb, ledger_id uuid,
  foreign key (workspace_id, automation_id, agent_id)
    references automations(workspace_id, id, agent_id)
);
create table integrations (
  id uuid primary key default gen_random_uuid(), workspace_id uuid not null references workspaces(id),
  provider text not null, auth_ref text, scopes text[], status text not null default 'active'
);
create table integration_sync_state (
  integration_id uuid not null references integrations(id), source text not null, last_cursor text,
  updated_at timestamptz not null default now(), primary key (integration_id, source)
);
create table external_records (                   -- idempotent ingestion (reuses existing gmail/gcal importer keys)
  id uuid primary key default gen_random_uuid(), workspace_id uuid not null references workspaces(id),
  source text not null, source_record_id text not null, entity_type text not null, entity_id uuid not null,
  created_at timestamptz not null default now(), unique (workspace_id, source, source_record_id)
);

-- =====================================================================
-- LAYER 5 — GOVERNANCE SPINE  (v2: roles + delegation + ephemeral + hard-deny)
-- Effective authority = (role_grants INTERSECT agent.capability_scope) UNION (active ephemeral_grants) MINUS explicit deny.
-- For agents acting for a principal: also INTERSECT the principal's authority (delegation).
-- =====================================================================
create table roles (                              -- v2: agents inherit permissions from a ROLE (like human orgs)
  id uuid primary key default gen_random_uuid(), workspace_id uuid not null references workspaces(id),
  name text not null, kind text not null default 'human',  -- human | agent
  description text
);
create table role_permissions (                   -- v2.1: surrogate PK (a composite PK forced resource_id NOT NULL, blocking NULL = type-wide grants)
  id uuid primary key default gen_random_uuid(),
  role_id uuid not null references roles(id),
  resource_type text not null, resource_id uuid,  -- null => type-wide (now allowed)
  action text not null,                            -- read | write | execute | share | archive
  effect text not null default 'allow'             -- allow | deny
);
create unique index role_permissions_uq on role_permissions
  (role_id, resource_type, action, coalesce(resource_id, '00000000-0000-0000-0000-000000000000'::uuid));
create table permissions (                        -- direct CBAC grants; deny-by-default
  id uuid primary key default gen_random_uuid(), workspace_id uuid not null references workspaces(id),
  actor_type text not null, actor_id uuid not null,
  resource_type text not null,                    -- person|community|initiative|automation|module|file | policy|skill|agent|role|permission|ledger|delegation
  resource_id uuid, action text not null,
  effect text not null default 'deny',             -- v2: default DENY (was allow). explicit deny always wins.
  granted_by uuid, expires_at timestamptz, revoked_at timestamptz,  -- v2: revocation hygiene
  created_at timestamptz not null default now()
);
create index on permissions (workspace_id, actor_type, actor_id, resource_type);
-- v2 SEED (app/migration): non-removable agent-floor DENY for actor_type='agent' on write/execute/archive of
--   {policy, policy_param, skill, agent, role, permission, ledger, delegation} + on 'network_graph:full' read + on send/share-external.
--   Enforced in requirePermission() so no grant overrides ("explicit deny wins"). Closes the self-modification escape.

create table ephemeral_grants (                   -- v2: context-scoped, EXPIRING (no persistence beyond a run)
  id uuid primary key default gen_random_uuid(), workspace_id uuid not null references workspaces(id),
  actor_type text not null, actor_id uuid not null,
  context_type text not null, context_id uuid not null,   -- initiative | community | ritual
  run_id text, resource_type text not null, resource_id uuid, action text not null,
  granted_by uuid, expires_at timestamptz not null, consumed_at timestamptz
);
create index on ephemeral_grants (workspace_id, actor_type, actor_id) where consumed_at is null;

create table delegations (                        -- v2: "on whose behalf" — an agent acts FOR a principal
  id uuid primary key default gen_random_uuid(), workspace_id uuid not null references workspaces(id),
  principal_type text not null, principal_id uuid not null,   -- user | team
  delegate_agent_id uuid not null references agents(id),
  scope jsonb not null default '{}', granted_by uuid,
  valid_from timestamptz not null default now(), expires_at timestamptz, revoked_at timestamptz
);
create table policies (
  id uuid primary key default gen_random_uuid(), workspace_id uuid not null references workspaces(id),
  scope_type text not null, scope_id uuid, name text not null, rule jsonb not null,
  evaluation_phase text not null default 'pre',    -- pre | runtime | post
  effect text not null default 'require_approval', -- allow | block | require_approval
  priority int not null default 100, active boolean not null default true
);
create table policy_params (                      -- Variance Adjuster writes here (vetoes -> thresholds)
  id uuid primary key default gen_random_uuid(), workspace_id uuid not null references workspaces(id),
  policy_id uuid references policies(id), param_key text not null, value jsonb not null,
  updated_at timestamptz not null default now(), unique (workspace_id, policy_id, param_key)
);
create table ledger (                             -- APPEND-ONLY (revoke UPDATE/DELETE in prod)
  id uuid primary key default gen_random_uuid(), workspace_id uuid not null references workspaces(id),
  actor_type text not null, actor_id uuid not null,
  on_behalf_of_type text, on_behalf_of_id uuid, delegation_id uuid references delegations(id),  -- v2: answers "on whose behalf"
  action text not null, resource_type text not null, resource_id uuid,
  inputs jsonb, proposed_output jsonb, user_decision text,  -- approve | veto | edit
  diff jsonb, policy_results jsonb, created_at timestamptz not null default now()
);
create table decision_traces (
  id uuid primary key default gen_random_uuid(), ledger_id uuid not null references ledger(id),
  signals jsonb, context jsonb, reasoning jsonb, outcome jsonb
);

-- =====================================================================
-- LAYER 6 — EVENT / SIGNAL BUS
-- =====================================================================
create table events (
  id uuid primary key default gen_random_uuid(), workspace_id uuid not null references workspaces(id),
  type text not null, entity_type text not null, entity_id uuid not null,
  payload jsonb not null default '{}', created_at timestamptz not null default now()
);
create index on events (workspace_id, created_at);
create table signals (                            -- user READ-ONLY (content); every signal carries an action
  id uuid primary key default gen_random_uuid(), workspace_id uuid not null references workspaces(id),
  type text not null, subject_type text not null, subject_id uuid not null,
  payload jsonb not null default '{}', recommended_action jsonb not null,   -- NOT NULL: no passive signals
  status text not null default 'new',              -- v2: new | surfaced | actioned | dismissed | saved
  created_at timestamptz not null default now()
);
-- v2: revoke UPDATE/INSERT on signals content cols from user/app role (derivation role only).
create table signal_actions (                     -- v2: append-only user reactions (act|dismiss|save)
  id uuid primary key default gen_random_uuid(), workspace_id uuid not null references workspaces(id),
  signal_id uuid not null references signals(id), user_id uuid not null references users(id),
  verb text not null, created_at timestamptz not null default now()  -- act | dismiss | save
);

-- =====================================================================
-- LAYER 8 — CAPABILITY TRUST MODEL (vision pivot 2026-07-06; docs/wiki/vision.md
-- "Capability Trust Model" + "Promotion defaults"). NOTE: schema.ts (Drizzle) is
-- ahead of this file on jobpilot_*/helpdesk_*/resources (LAYER 7) — those are not
-- yet mirrored here either; this pass only adds LAYER 8's new tables in the same
-- terse style as the layers above.
-- =====================================================================
create table capability_manifests (              -- one row per registered capability (skill|automation|agent|integration|view|dashboard)
  id uuid primary key default gen_random_uuid(), workspace_id uuid not null references workspaces(id),
  capability_type text not null, name text not null, version text not null default '1.0.0',
  origin text not null default 'user_code',       -- built_in | template | community | ai_generated | user_code
  audience text not null default 'private',       -- private | team | external_visible
  manifest jsonb not null default '{}',            -- inputs/outputs/permissions/connectors/evidence/rollback/evaluation
  computed_risk text not null default 'informational', -- COMPUTED, never self-declared: informational|advisory|transformational|operational|external
  dependencies jsonb not null default '[]',        -- [{manifestId, versionRange}] — the closure computeRisk() walks (composite = max over closure)
  lineage_manifest_id uuid,                        -- self-FK: a Fork/copy points back at its origin
  owner_user_id uuid references users(id),
  created_at timestamptz not null default now(), archived_at timestamptz,
  unique (workspace_id, name, version)
);
create index on capability_manifests (workspace_id, capability_type);

create table capability_states (                  -- ONE current-state row per manifest (unique manifest_id) — the ledger is the history
  id uuid primary key default gen_random_uuid(), manifest_id uuid not null references capability_manifests(id),
  workspace_id uuid not null references workspaces(id),
  state text not null default 'draft',             -- draft|validated|approved|active|trusted|deprecated|archived
  trusted_until timestamptz,                        -- set on entering trusted: now + 90d (PROMOTION_DEFAULTS.trusted.trustedTtlDays)
  suspended boolean not null default false, suspend_reason text,  -- orthogonal to `state`: failure suspends immediately, no approval
  evidence jsonb not null default '{}',             -- { activeRunCount, successRate, violationCount, ageDays } — trusted-promotion thresholds read this
  updated_at timestamptz not null default now(),
  unique (manifest_id)
);

create table trust_grants (                        -- workspace/user-scoped auto-activation trust for a capability CLASS (not one manifest instance)
  id uuid primary key default gen_random_uuid(), workspace_id uuid not null references workspaces(id),
  capability_class text not null, scope jsonb not null default '{}',   -- { workspaceId?, userId? }
  granted_by uuid references users(id),
  risk_band text not null,                          -- informational|advisory|transformational|operational|external (external can never auto-activate — hard floor)
  auto_activate boolean not null default false,
  created_at timestamptz not null default now(), revoked_at timestamptz
);
create index on trust_grants (workspace_id, capability_class);

create table workspace_definitions (                -- generated workspace blueprint (vocabulary/node types/views/capabilities); P1 onboarding writes these
  id uuid primary key default gen_random_uuid(), workspace_id uuid not null references workspaces(id),
  blueprint jsonb not null default '{}', version int not null default 1,
  status text not null default 'draft',              -- draft | active | archived
  created_by uuid references users(id), created_at timestamptz not null default now()
);
create index on workspace_definitions (workspace_id, version);

-- P2 package runtime (ADR-021/ADR-023): one row per (workspace, package name, version) install —
-- the shipping unit ABOVE one capability_manifests row (a package bundles >=1 capability manifests).
-- NOT unique on (workspace_id, package_name, package_version) via a DB constraint — re-registration
-- idempotency (same name+version returns the existing row) is enforced at the store layer
-- (package-store.ts's create()), not the database, since a package manifest can legitimately be
-- re-registered unchanged during iterative local dev before its first real install.
create table package_installations (
  id uuid primary key default gen_random_uuid(), workspace_id uuid not null references workspaces(id),
  package_name text not null, package_version text not null,
  manifest jsonb not null default '{}',              -- full parsed PackageManifest (name/version/kind/capabilities[]/dependencies/etc)
  computed_risk text not null default 'informational', -- COMPUTED at install time (computePackageRisk), same vocabulary as capability_manifests.computed_risk
  state text not null default 'private',             -- private|promoted|available|legacy|deprecating|deprecated (package/lifecycle.ts)
  status text not null default 'pending_review',     -- pending_review|installed|rejected — orthogonal to `state`
  lineage_manifest_id uuid,                           -- self-FK: a rollback fork points back at the historical row it forked from
  created_at timestamptz not null default now()
);
create index on package_installations (workspace_id, package_name);
create index on package_installations (workspace_id, package_name, state);

-- =====================================================================
-- RLS — APPLIED (Supabase project Bridge AI; migration `rls_policies_v1`). Isolation PROVEN 2026-05-31 via JWT-impersonation test.
-- Helpers (SECURITY DEFINER, search_path=public) break policy recursion; EXECUTE locked to `authenticated` (migration `harden_helper_grants`):
--   my_workspace_ids() · my_team_ids() · shares_workspace_with(uuid) · shares_team_with(uuid)
-- Model:
--   * Tenant tables: USING/CHECK (workspace_id in (select my_workspace_ids())) — deny-by-default once RLS on.
--   * Relationship tier (people, communities): SELECT if workspace member AND
--       (user_id = auth.uid() OR visibility='workspace' OR (visibility='team' AND shares_team_with(user_id)));
--       INSERT/UPDATE/DELETE owner-only (user_id = auth.uid()).
--   * Join tables scoped via parent's workspace (community_members->communities, *_refs->parent, role_permissions->roles, integration_sync_state->integrations, initiative_* ->initiatives).
--   * Append-only (timeline_entries, events, ledger, decision_traces, signal_actions): SELECT+INSERT only; UPDATE/DELETE REVOKED from anon+authenticated.
--   * Signals: user READ-ONLY (INSERT/UPDATE/DELETE revoked; derivation writes via service role).
--   * Canonical/reference (people_canonical, communities_canonical, node_types, embedding_models): shared SELECT (true); client writes revoked.
--   * Embeddings: RLS on, NO client policy (service-role/RPC only; carry no workspace_id).
-- Agents: service-principal identity; authority resolved in requireAuthority() (role ∩ capability_scope ∪ ephemeral − deny), NOT raw service-role bypass.
-- PROVEN: cross-workspace hidden=0 · co-member-private hidden=0 · team-visible=1 · workspace-visible=1 · canonical-shared=1 · cross-owner-update=0.
-- Full policy DDL lives in the applied migrations (Supabase). Advisors after apply: 0 rls_disabled errors.
-- =====================================================================
