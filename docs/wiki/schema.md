# Schema (wiki) — v2

full: [../raw/SCHEMA.sql](../raw/SCHEMA.sql)

Postgres/Supabase. RLS deny-default. soft-delete. append-only ledger/timeline/events/signal_actions.

**Layers**:
- Tenancy: users · workspaces · **workspace_settings(default_visibility)** · workspace_members(role_id) · teams · team_members.
- Two-tier network: people_canonical/communities_canonical (platform, global, dedup_key, public only) · people/communities (per-(workspace,user); overrides via COALESCE + **visibility** + warmth/ring/dormancy) · community_members · **node_types(plane)** · edges (mirror + whitelisted cross-plane).
- Operational: initiatives(**goal**, decomposition_strategy) · initiative_participants/communities · touchpoints(**parent_touchpoint_id, sort_order, depth, alignment_score** = Taskade tree) · timeline_entries(+refs) · files(+refs).
- Embeddings: **central `embeddings` table** (entity_type, entity_id, model, version, vector(768)) — OFF entity tables; nomic-768 v1; `embedding_models` tracks active; diff-dim model → sibling table.
- Registries: skills · agents(**assumes_role_id**; capability_scope = ceiling) · rituals(`is_template` = former "playbook") · **ritual_runs** · tools · integrations · integration_sync_state · external_records.
- Governance: **roles** + **role_permissions** · permissions(expanded resource_type · **effect default DENY** · granted_by/expires/revoked) · **ephemeral_grants** · **delegations** · policies · policy_params · ledger(+**on_behalf_of/delegation_id**) · decision_traces.
- Bus: events · signals(+**saved**; content user-read-only) · **signal_actions** (append-only: act/dismiss/save).

**Authority** = (role_grants ∩ agent.capability_scope) ∪ active ephemeral_grants − explicit deny; for on-behalf-of also ∩ principal authority. Seeded agent-floor DENY (no edit of policy/skill/agent/role/ledger · no full-graph read · no external send) → closes self-mod escape.

**RLS — APPLIED & PROVEN** (live DB: Supabase *Bridge AI* `emtbimowmqqhixqlxhzb`; migrations `replace_with_schema_v2`+`rls_policies_v1`+`harden_helper_grants`): workspace isolation · relationship-tier visibility (private/team/workspace, owner-only writes) · join parent-scoping · append-only (UPDATE/DELETE revoked) · signals read-only · canonical shared-read · embeddings deny-all-client. SECURITY DEFINER helpers (my_workspace_ids/my_team_ids/shares_*). Live JWT-impersonation test PASSED → cross-workspace=0 · co-member-private=0 · team=1 · workspace=1 · canonical=1 · cross-owner-update=0. Advisors: **0 rls_disabled**. Known WARN (SOC2 hardening): vector/pg_trgm in public · helper RPC exposure (→ move to private schema).

**Pending**: seed agent-floor DENY rows · design-fix UI build (F1–F5, see [design](design.md)) · pilot enrichment (public sources) · E2EE (P6).
