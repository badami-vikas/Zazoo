CREATE SCHEMA IF NOT EXISTS app_private;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION app_private.current_workspace_id()
RETURNS uuid
LANGUAGE sql
STABLE
AS $$
  SELECT NULLIF(current_setting('app.workspace_id', true), '')::uuid;
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION app_private.current_user_id()
RETURNS uuid
LANGUAGE sql
STABLE
AS $$
  SELECT NULLIF(current_setting('app.user_id', true), '')::uuid;
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION app_private.same_workspace(row_workspace_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
AS $$
  SELECT row_workspace_id = app_private.current_workspace_id();
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION app_private.visible_relationship_row(row_workspace_id uuid, row_visibility text, row_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
AS $$
  SELECT app_private.same_workspace(row_workspace_id)
    AND CASE row_visibility
      WHEN 'workspace' THEN true
      WHEN 'private' THEN row_user_id = app_private.current_user_id()
      WHEN 'team' THEN row_user_id = app_private.current_user_id()
      ELSE false
    END;
$$;
--> statement-breakpoint
ALTER TABLE "agents" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "agents" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "agents_tenant_select" ON "agents" FOR SELECT USING (app_private.same_workspace("workspace_id"));
--> statement-breakpoint
CREATE POLICY "agents_tenant_insert" ON "agents" FOR INSERT WITH CHECK (app_private.same_workspace("workspace_id"));
--> statement-breakpoint
CREATE POLICY "agents_tenant_update" ON "agents" FOR UPDATE USING (app_private.same_workspace("workspace_id")) WITH CHECK (app_private.same_workspace("workspace_id"));
--> statement-breakpoint
CREATE POLICY "agents_tenant_delete" ON "agents" FOR DELETE USING (app_private.same_workspace("workspace_id"));
--> statement-breakpoint
ALTER TABLE "capability_manifests" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "capability_manifests" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "capability_manifests_tenant_select" ON "capability_manifests" FOR SELECT USING (app_private.same_workspace("workspace_id"));
--> statement-breakpoint
CREATE POLICY "capability_manifests_tenant_insert" ON "capability_manifests" FOR INSERT WITH CHECK (app_private.same_workspace("workspace_id"));
--> statement-breakpoint
CREATE POLICY "capability_manifests_tenant_update" ON "capability_manifests" FOR UPDATE USING (app_private.same_workspace("workspace_id")) WITH CHECK (app_private.same_workspace("workspace_id"));
--> statement-breakpoint
CREATE POLICY "capability_manifests_tenant_delete" ON "capability_manifests" FOR DELETE USING (app_private.same_workspace("workspace_id"));
--> statement-breakpoint
ALTER TABLE "capability_states" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "capability_states" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "capability_states_tenant_select" ON "capability_states" FOR SELECT USING (app_private.same_workspace("workspace_id"));
--> statement-breakpoint
CREATE POLICY "capability_states_tenant_insert" ON "capability_states" FOR INSERT WITH CHECK (app_private.same_workspace("workspace_id"));
--> statement-breakpoint
CREATE POLICY "capability_states_tenant_update" ON "capability_states" FOR UPDATE USING (app_private.same_workspace("workspace_id")) WITH CHECK (app_private.same_workspace("workspace_id"));
--> statement-breakpoint
CREATE POLICY "capability_states_tenant_delete" ON "capability_states" FOR DELETE USING (app_private.same_workspace("workspace_id"));
--> statement-breakpoint
ALTER TABLE "communities" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "communities" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "communities_tenant_select" ON "communities" FOR SELECT USING (app_private.visible_relationship_row("workspace_id", "visibility", "user_id"));
--> statement-breakpoint
CREATE POLICY "communities_tenant_insert" ON "communities" FOR INSERT WITH CHECK (app_private.same_workspace("workspace_id"));
--> statement-breakpoint
CREATE POLICY "communities_tenant_update" ON "communities" FOR UPDATE USING (app_private.visible_relationship_row("workspace_id", "visibility", "user_id")) WITH CHECK (app_private.same_workspace("workspace_id"));
--> statement-breakpoint
CREATE POLICY "communities_tenant_delete" ON "communities" FOR DELETE USING (app_private.visible_relationship_row("workspace_id", "visibility", "user_id"));
--> statement-breakpoint
ALTER TABLE "delegations" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "delegations" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "delegations_tenant_select" ON "delegations" FOR SELECT USING (app_private.same_workspace("workspace_id"));
--> statement-breakpoint
CREATE POLICY "delegations_tenant_insert" ON "delegations" FOR INSERT WITH CHECK (app_private.same_workspace("workspace_id"));
--> statement-breakpoint
CREATE POLICY "delegations_tenant_update" ON "delegations" FOR UPDATE USING (app_private.same_workspace("workspace_id")) WITH CHECK (app_private.same_workspace("workspace_id"));
--> statement-breakpoint
CREATE POLICY "delegations_tenant_delete" ON "delegations" FOR DELETE USING (app_private.same_workspace("workspace_id"));
--> statement-breakpoint
ALTER TABLE "edges" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "edges" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "edges_tenant_select" ON "edges" FOR SELECT USING (app_private.same_workspace("workspace_id"));
--> statement-breakpoint
CREATE POLICY "edges_tenant_insert" ON "edges" FOR INSERT WITH CHECK (app_private.same_workspace("workspace_id"));
--> statement-breakpoint
CREATE POLICY "edges_tenant_update" ON "edges" FOR UPDATE USING (app_private.same_workspace("workspace_id")) WITH CHECK (app_private.same_workspace("workspace_id"));
--> statement-breakpoint
CREATE POLICY "edges_tenant_delete" ON "edges" FOR DELETE USING (app_private.same_workspace("workspace_id"));
--> statement-breakpoint
ALTER TABLE "ephemeral_grants" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "ephemeral_grants" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "ephemeral_grants_tenant_select" ON "ephemeral_grants" FOR SELECT USING (app_private.same_workspace("workspace_id"));
--> statement-breakpoint
CREATE POLICY "ephemeral_grants_tenant_insert" ON "ephemeral_grants" FOR INSERT WITH CHECK (app_private.same_workspace("workspace_id"));
--> statement-breakpoint
CREATE POLICY "ephemeral_grants_tenant_update" ON "ephemeral_grants" FOR UPDATE USING (app_private.same_workspace("workspace_id")) WITH CHECK (app_private.same_workspace("workspace_id"));
--> statement-breakpoint
CREATE POLICY "ephemeral_grants_tenant_delete" ON "ephemeral_grants" FOR DELETE USING (app_private.same_workspace("workspace_id"));
--> statement-breakpoint
ALTER TABLE "events" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "events" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "events_tenant_select" ON "events" FOR SELECT USING (app_private.same_workspace("workspace_id"));
--> statement-breakpoint
CREATE POLICY "events_tenant_insert" ON "events" FOR INSERT WITH CHECK (app_private.same_workspace("workspace_id"));
--> statement-breakpoint
CREATE POLICY "events_tenant_update" ON "events" FOR UPDATE USING (app_private.same_workspace("workspace_id")) WITH CHECK (app_private.same_workspace("workspace_id"));
--> statement-breakpoint
CREATE POLICY "events_tenant_delete" ON "events" FOR DELETE USING (app_private.same_workspace("workspace_id"));
--> statement-breakpoint
ALTER TABLE "external_records" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "external_records" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "external_records_tenant_select" ON "external_records" FOR SELECT USING (app_private.same_workspace("workspace_id"));
--> statement-breakpoint
CREATE POLICY "external_records_tenant_insert" ON "external_records" FOR INSERT WITH CHECK (app_private.same_workspace("workspace_id"));
--> statement-breakpoint
CREATE POLICY "external_records_tenant_update" ON "external_records" FOR UPDATE USING (app_private.same_workspace("workspace_id")) WITH CHECK (app_private.same_workspace("workspace_id"));
--> statement-breakpoint
CREATE POLICY "external_records_tenant_delete" ON "external_records" FOR DELETE USING (app_private.same_workspace("workspace_id"));
--> statement-breakpoint
ALTER TABLE "files" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "files" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "files_tenant_select" ON "files" FOR SELECT USING (app_private.same_workspace("workspace_id"));
--> statement-breakpoint
CREATE POLICY "files_tenant_insert" ON "files" FOR INSERT WITH CHECK (app_private.same_workspace("workspace_id"));
--> statement-breakpoint
CREATE POLICY "files_tenant_update" ON "files" FOR UPDATE USING (app_private.same_workspace("workspace_id")) WITH CHECK (app_private.same_workspace("workspace_id"));
--> statement-breakpoint
CREATE POLICY "files_tenant_delete" ON "files" FOR DELETE USING (app_private.same_workspace("workspace_id"));
--> statement-breakpoint
ALTER TABLE "helpdesk_messages" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "helpdesk_messages" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "helpdesk_messages_tenant_select" ON "helpdesk_messages" FOR SELECT USING (app_private.same_workspace("workspace_id"));
--> statement-breakpoint
CREATE POLICY "helpdesk_messages_tenant_insert" ON "helpdesk_messages" FOR INSERT WITH CHECK (app_private.same_workspace("workspace_id"));
--> statement-breakpoint
CREATE POLICY "helpdesk_messages_tenant_update" ON "helpdesk_messages" FOR UPDATE USING (app_private.same_workspace("workspace_id")) WITH CHECK (app_private.same_workspace("workspace_id"));
--> statement-breakpoint
CREATE POLICY "helpdesk_messages_tenant_delete" ON "helpdesk_messages" FOR DELETE USING (app_private.same_workspace("workspace_id"));
--> statement-breakpoint
ALTER TABLE "helpdesk_tickets" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "helpdesk_tickets" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "helpdesk_tickets_tenant_select" ON "helpdesk_tickets" FOR SELECT USING (app_private.same_workspace("workspace_id"));
--> statement-breakpoint
CREATE POLICY "helpdesk_tickets_tenant_insert" ON "helpdesk_tickets" FOR INSERT WITH CHECK (app_private.same_workspace("workspace_id"));
--> statement-breakpoint
CREATE POLICY "helpdesk_tickets_tenant_update" ON "helpdesk_tickets" FOR UPDATE USING (app_private.same_workspace("workspace_id")) WITH CHECK (app_private.same_workspace("workspace_id"));
--> statement-breakpoint
CREATE POLICY "helpdesk_tickets_tenant_delete" ON "helpdesk_tickets" FOR DELETE USING (app_private.same_workspace("workspace_id"));
--> statement-breakpoint
ALTER TABLE "initiatives" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "initiatives" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "initiatives_tenant_select" ON "initiatives" FOR SELECT USING (app_private.same_workspace("workspace_id"));
--> statement-breakpoint
CREATE POLICY "initiatives_tenant_insert" ON "initiatives" FOR INSERT WITH CHECK (app_private.same_workspace("workspace_id"));
--> statement-breakpoint
CREATE POLICY "initiatives_tenant_update" ON "initiatives" FOR UPDATE USING (app_private.same_workspace("workspace_id")) WITH CHECK (app_private.same_workspace("workspace_id"));
--> statement-breakpoint
CREATE POLICY "initiatives_tenant_delete" ON "initiatives" FOR DELETE USING (app_private.same_workspace("workspace_id"));
--> statement-breakpoint
ALTER TABLE "integrations" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "integrations" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "integrations_tenant_select" ON "integrations" FOR SELECT USING (app_private.same_workspace("workspace_id"));
--> statement-breakpoint
CREATE POLICY "integrations_tenant_insert" ON "integrations" FOR INSERT WITH CHECK (app_private.same_workspace("workspace_id"));
--> statement-breakpoint
CREATE POLICY "integrations_tenant_update" ON "integrations" FOR UPDATE USING (app_private.same_workspace("workspace_id")) WITH CHECK (app_private.same_workspace("workspace_id"));
--> statement-breakpoint
CREATE POLICY "integrations_tenant_delete" ON "integrations" FOR DELETE USING (app_private.same_workspace("workspace_id"));
--> statement-breakpoint
ALTER TABLE "jobpilot_applications" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "jobpilot_applications" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "jobpilot_applications_tenant_select" ON "jobpilot_applications" FOR SELECT USING (app_private.same_workspace("workspace_id"));
--> statement-breakpoint
CREATE POLICY "jobpilot_applications_tenant_insert" ON "jobpilot_applications" FOR INSERT WITH CHECK (app_private.same_workspace("workspace_id"));
--> statement-breakpoint
CREATE POLICY "jobpilot_applications_tenant_update" ON "jobpilot_applications" FOR UPDATE USING (app_private.same_workspace("workspace_id")) WITH CHECK (app_private.same_workspace("workspace_id"));
--> statement-breakpoint
CREATE POLICY "jobpilot_applications_tenant_delete" ON "jobpilot_applications" FOR DELETE USING (app_private.same_workspace("workspace_id"));
--> statement-breakpoint
ALTER TABLE "jobpilot_jobs" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "jobpilot_jobs" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "jobpilot_jobs_tenant_select" ON "jobpilot_jobs" FOR SELECT USING (app_private.same_workspace("workspace_id"));
--> statement-breakpoint
CREATE POLICY "jobpilot_jobs_tenant_insert" ON "jobpilot_jobs" FOR INSERT WITH CHECK (app_private.same_workspace("workspace_id"));
--> statement-breakpoint
CREATE POLICY "jobpilot_jobs_tenant_update" ON "jobpilot_jobs" FOR UPDATE USING (app_private.same_workspace("workspace_id")) WITH CHECK (app_private.same_workspace("workspace_id"));
--> statement-breakpoint
CREATE POLICY "jobpilot_jobs_tenant_delete" ON "jobpilot_jobs" FOR DELETE USING (app_private.same_workspace("workspace_id"));
--> statement-breakpoint
ALTER TABLE "ledger" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "ledger" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "ledger_tenant_select" ON "ledger" FOR SELECT USING (app_private.same_workspace("workspace_id"));
--> statement-breakpoint
CREATE POLICY "ledger_tenant_insert" ON "ledger" FOR INSERT WITH CHECK (app_private.same_workspace("workspace_id"));
--> statement-breakpoint
CREATE POLICY "ledger_tenant_update" ON "ledger" FOR UPDATE USING (app_private.same_workspace("workspace_id")) WITH CHECK (app_private.same_workspace("workspace_id"));
--> statement-breakpoint
CREATE POLICY "ledger_tenant_delete" ON "ledger" FOR DELETE USING (app_private.same_workspace("workspace_id"));
--> statement-breakpoint
ALTER TABLE "package_installations" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "package_installations" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "package_installations_tenant_select" ON "package_installations" FOR SELECT USING (app_private.same_workspace("workspace_id"));
--> statement-breakpoint
CREATE POLICY "package_installations_tenant_insert" ON "package_installations" FOR INSERT WITH CHECK (app_private.same_workspace("workspace_id"));
--> statement-breakpoint
CREATE POLICY "package_installations_tenant_update" ON "package_installations" FOR UPDATE USING (app_private.same_workspace("workspace_id")) WITH CHECK (app_private.same_workspace("workspace_id"));
--> statement-breakpoint
CREATE POLICY "package_installations_tenant_delete" ON "package_installations" FOR DELETE USING (app_private.same_workspace("workspace_id"));
--> statement-breakpoint
ALTER TABLE "people" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "people" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "people_tenant_select" ON "people" FOR SELECT USING (app_private.visible_relationship_row("workspace_id", "visibility", "user_id"));
--> statement-breakpoint
CREATE POLICY "people_tenant_insert" ON "people" FOR INSERT WITH CHECK (app_private.same_workspace("workspace_id"));
--> statement-breakpoint
CREATE POLICY "people_tenant_update" ON "people" FOR UPDATE USING (app_private.visible_relationship_row("workspace_id", "visibility", "user_id")) WITH CHECK (app_private.same_workspace("workspace_id"));
--> statement-breakpoint
CREATE POLICY "people_tenant_delete" ON "people" FOR DELETE USING (app_private.visible_relationship_row("workspace_id", "visibility", "user_id"));
--> statement-breakpoint
ALTER TABLE "permissions" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "permissions" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "permissions_tenant_select" ON "permissions" FOR SELECT USING (app_private.same_workspace("workspace_id"));
--> statement-breakpoint
CREATE POLICY "permissions_tenant_insert" ON "permissions" FOR INSERT WITH CHECK (app_private.same_workspace("workspace_id"));
--> statement-breakpoint
CREATE POLICY "permissions_tenant_update" ON "permissions" FOR UPDATE USING (app_private.same_workspace("workspace_id")) WITH CHECK (app_private.same_workspace("workspace_id"));
--> statement-breakpoint
CREATE POLICY "permissions_tenant_delete" ON "permissions" FOR DELETE USING (app_private.same_workspace("workspace_id"));
--> statement-breakpoint
ALTER TABLE "policies" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "policies" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "policies_tenant_select" ON "policies" FOR SELECT USING (app_private.same_workspace("workspace_id"));
--> statement-breakpoint
CREATE POLICY "policies_tenant_insert" ON "policies" FOR INSERT WITH CHECK (app_private.same_workspace("workspace_id"));
--> statement-breakpoint
CREATE POLICY "policies_tenant_update" ON "policies" FOR UPDATE USING (app_private.same_workspace("workspace_id")) WITH CHECK (app_private.same_workspace("workspace_id"));
--> statement-breakpoint
CREATE POLICY "policies_tenant_delete" ON "policies" FOR DELETE USING (app_private.same_workspace("workspace_id"));
--> statement-breakpoint
ALTER TABLE "policy_params" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "policy_params" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "policy_params_tenant_select" ON "policy_params" FOR SELECT USING (app_private.same_workspace("workspace_id"));
--> statement-breakpoint
CREATE POLICY "policy_params_tenant_insert" ON "policy_params" FOR INSERT WITH CHECK (app_private.same_workspace("workspace_id"));
--> statement-breakpoint
CREATE POLICY "policy_params_tenant_update" ON "policy_params" FOR UPDATE USING (app_private.same_workspace("workspace_id")) WITH CHECK (app_private.same_workspace("workspace_id"));
--> statement-breakpoint
CREATE POLICY "policy_params_tenant_delete" ON "policy_params" FOR DELETE USING (app_private.same_workspace("workspace_id"));
--> statement-breakpoint
ALTER TABLE "resources" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "resources" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "resources_tenant_select" ON "resources" FOR SELECT USING (app_private.same_workspace("workspace_id"));
--> statement-breakpoint
CREATE POLICY "resources_tenant_insert" ON "resources" FOR INSERT WITH CHECK (app_private.same_workspace("workspace_id"));
--> statement-breakpoint
CREATE POLICY "resources_tenant_update" ON "resources" FOR UPDATE USING (app_private.same_workspace("workspace_id")) WITH CHECK (app_private.same_workspace("workspace_id"));
--> statement-breakpoint
CREATE POLICY "resources_tenant_delete" ON "resources" FOR DELETE USING (app_private.same_workspace("workspace_id"));
--> statement-breakpoint
ALTER TABLE "ritual_runs" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "ritual_runs" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "ritual_runs_tenant_select" ON "ritual_runs" FOR SELECT USING (app_private.same_workspace("workspace_id"));
--> statement-breakpoint
CREATE POLICY "ritual_runs_tenant_insert" ON "ritual_runs" FOR INSERT WITH CHECK (app_private.same_workspace("workspace_id"));
--> statement-breakpoint
CREATE POLICY "ritual_runs_tenant_update" ON "ritual_runs" FOR UPDATE USING (app_private.same_workspace("workspace_id")) WITH CHECK (app_private.same_workspace("workspace_id"));
--> statement-breakpoint
CREATE POLICY "ritual_runs_tenant_delete" ON "ritual_runs" FOR DELETE USING (app_private.same_workspace("workspace_id"));
--> statement-breakpoint
ALTER TABLE "rituals" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "rituals" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "rituals_tenant_select" ON "rituals" FOR SELECT USING (app_private.same_workspace("workspace_id"));
--> statement-breakpoint
CREATE POLICY "rituals_tenant_insert" ON "rituals" FOR INSERT WITH CHECK (app_private.same_workspace("workspace_id"));
--> statement-breakpoint
CREATE POLICY "rituals_tenant_update" ON "rituals" FOR UPDATE USING (app_private.same_workspace("workspace_id")) WITH CHECK (app_private.same_workspace("workspace_id"));
--> statement-breakpoint
CREATE POLICY "rituals_tenant_delete" ON "rituals" FOR DELETE USING (app_private.same_workspace("workspace_id"));
--> statement-breakpoint
ALTER TABLE "roles" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "roles" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "roles_tenant_select" ON "roles" FOR SELECT USING (app_private.same_workspace("workspace_id"));
--> statement-breakpoint
CREATE POLICY "roles_tenant_insert" ON "roles" FOR INSERT WITH CHECK (app_private.same_workspace("workspace_id"));
--> statement-breakpoint
CREATE POLICY "roles_tenant_update" ON "roles" FOR UPDATE USING (app_private.same_workspace("workspace_id")) WITH CHECK (app_private.same_workspace("workspace_id"));
--> statement-breakpoint
CREATE POLICY "roles_tenant_delete" ON "roles" FOR DELETE USING (app_private.same_workspace("workspace_id"));
--> statement-breakpoint
ALTER TABLE "signal_actions" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "signal_actions" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "signal_actions_tenant_select" ON "signal_actions" FOR SELECT USING (app_private.same_workspace("workspace_id"));
--> statement-breakpoint
CREATE POLICY "signal_actions_tenant_insert" ON "signal_actions" FOR INSERT WITH CHECK (app_private.same_workspace("workspace_id"));
--> statement-breakpoint
CREATE POLICY "signal_actions_tenant_update" ON "signal_actions" FOR UPDATE USING (app_private.same_workspace("workspace_id")) WITH CHECK (app_private.same_workspace("workspace_id"));
--> statement-breakpoint
CREATE POLICY "signal_actions_tenant_delete" ON "signal_actions" FOR DELETE USING (app_private.same_workspace("workspace_id"));
--> statement-breakpoint
ALTER TABLE "signals" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "signals" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "signals_tenant_select" ON "signals" FOR SELECT USING (app_private.same_workspace("workspace_id"));
--> statement-breakpoint
CREATE POLICY "signals_tenant_insert" ON "signals" FOR INSERT WITH CHECK (app_private.same_workspace("workspace_id"));
--> statement-breakpoint
CREATE POLICY "signals_tenant_update" ON "signals" FOR UPDATE USING (app_private.same_workspace("workspace_id")) WITH CHECK (app_private.same_workspace("workspace_id"));
--> statement-breakpoint
CREATE POLICY "signals_tenant_delete" ON "signals" FOR DELETE USING (app_private.same_workspace("workspace_id"));
--> statement-breakpoint
ALTER TABLE "skills" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "skills" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "skills_tenant_select" ON "skills" FOR SELECT USING ((("workspace_id" IS NULL) OR app_private.same_workspace("workspace_id")));
--> statement-breakpoint
CREATE POLICY "skills_tenant_insert" ON "skills" FOR INSERT WITH CHECK ((("workspace_id" IS NULL) OR app_private.same_workspace("workspace_id")));
--> statement-breakpoint
CREATE POLICY "skills_tenant_update" ON "skills" FOR UPDATE USING ((("workspace_id" IS NULL) OR app_private.same_workspace("workspace_id"))) WITH CHECK ((("workspace_id" IS NULL) OR app_private.same_workspace("workspace_id")));
--> statement-breakpoint
CREATE POLICY "skills_tenant_delete" ON "skills" FOR DELETE USING ((("workspace_id" IS NULL) OR app_private.same_workspace("workspace_id")));
--> statement-breakpoint
ALTER TABLE "teams" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "teams" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "teams_tenant_select" ON "teams" FOR SELECT USING (app_private.same_workspace("workspace_id"));
--> statement-breakpoint
CREATE POLICY "teams_tenant_insert" ON "teams" FOR INSERT WITH CHECK (app_private.same_workspace("workspace_id"));
--> statement-breakpoint
CREATE POLICY "teams_tenant_update" ON "teams" FOR UPDATE USING (app_private.same_workspace("workspace_id")) WITH CHECK (app_private.same_workspace("workspace_id"));
--> statement-breakpoint
CREATE POLICY "teams_tenant_delete" ON "teams" FOR DELETE USING (app_private.same_workspace("workspace_id"));
--> statement-breakpoint
ALTER TABLE "timeline_entries" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "timeline_entries" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "timeline_entries_tenant_select" ON "timeline_entries" FOR SELECT USING (app_private.same_workspace("workspace_id"));
--> statement-breakpoint
CREATE POLICY "timeline_entries_tenant_insert" ON "timeline_entries" FOR INSERT WITH CHECK (app_private.same_workspace("workspace_id"));
--> statement-breakpoint
CREATE POLICY "timeline_entries_tenant_update" ON "timeline_entries" FOR UPDATE USING (app_private.same_workspace("workspace_id")) WITH CHECK (app_private.same_workspace("workspace_id"));
--> statement-breakpoint
CREATE POLICY "timeline_entries_tenant_delete" ON "timeline_entries" FOR DELETE USING (app_private.same_workspace("workspace_id"));
--> statement-breakpoint
ALTER TABLE "tools" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "tools" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "tools_tenant_select" ON "tools" FOR SELECT USING (app_private.same_workspace("workspace_id"));
--> statement-breakpoint
CREATE POLICY "tools_tenant_insert" ON "tools" FOR INSERT WITH CHECK (app_private.same_workspace("workspace_id"));
--> statement-breakpoint
CREATE POLICY "tools_tenant_update" ON "tools" FOR UPDATE USING (app_private.same_workspace("workspace_id")) WITH CHECK (app_private.same_workspace("workspace_id"));
--> statement-breakpoint
CREATE POLICY "tools_tenant_delete" ON "tools" FOR DELETE USING (app_private.same_workspace("workspace_id"));
--> statement-breakpoint
ALTER TABLE "touchpoints" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "touchpoints" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "touchpoints_tenant_select" ON "touchpoints" FOR SELECT USING (app_private.same_workspace("workspace_id"));
--> statement-breakpoint
CREATE POLICY "touchpoints_tenant_insert" ON "touchpoints" FOR INSERT WITH CHECK (app_private.same_workspace("workspace_id"));
--> statement-breakpoint
CREATE POLICY "touchpoints_tenant_update" ON "touchpoints" FOR UPDATE USING (app_private.same_workspace("workspace_id")) WITH CHECK (app_private.same_workspace("workspace_id"));
--> statement-breakpoint
CREATE POLICY "touchpoints_tenant_delete" ON "touchpoints" FOR DELETE USING (app_private.same_workspace("workspace_id"));
--> statement-breakpoint
ALTER TABLE "trust_grants" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "trust_grants" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "trust_grants_tenant_select" ON "trust_grants" FOR SELECT USING (app_private.same_workspace("workspace_id"));
--> statement-breakpoint
CREATE POLICY "trust_grants_tenant_insert" ON "trust_grants" FOR INSERT WITH CHECK (app_private.same_workspace("workspace_id"));
--> statement-breakpoint
CREATE POLICY "trust_grants_tenant_update" ON "trust_grants" FOR UPDATE USING (app_private.same_workspace("workspace_id")) WITH CHECK (app_private.same_workspace("workspace_id"));
--> statement-breakpoint
CREATE POLICY "trust_grants_tenant_delete" ON "trust_grants" FOR DELETE USING (app_private.same_workspace("workspace_id"));
--> statement-breakpoint
ALTER TABLE "workspace_definitions" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "workspace_definitions" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "workspace_definitions_tenant_select" ON "workspace_definitions" FOR SELECT USING (app_private.same_workspace("workspace_id"));
--> statement-breakpoint
CREATE POLICY "workspace_definitions_tenant_insert" ON "workspace_definitions" FOR INSERT WITH CHECK (app_private.same_workspace("workspace_id"));
--> statement-breakpoint
CREATE POLICY "workspace_definitions_tenant_update" ON "workspace_definitions" FOR UPDATE USING (app_private.same_workspace("workspace_id")) WITH CHECK (app_private.same_workspace("workspace_id"));
--> statement-breakpoint
CREATE POLICY "workspace_definitions_tenant_delete" ON "workspace_definitions" FOR DELETE USING (app_private.same_workspace("workspace_id"));
--> statement-breakpoint
ALTER TABLE "workspace_members" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "workspace_members" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "workspace_members_tenant_select" ON "workspace_members" FOR SELECT USING (app_private.same_workspace("workspace_id"));
--> statement-breakpoint
CREATE POLICY "workspace_members_tenant_insert" ON "workspace_members" FOR INSERT WITH CHECK (app_private.same_workspace("workspace_id"));
--> statement-breakpoint
CREATE POLICY "workspace_members_tenant_update" ON "workspace_members" FOR UPDATE USING (app_private.same_workspace("workspace_id")) WITH CHECK (app_private.same_workspace("workspace_id"));
--> statement-breakpoint
CREATE POLICY "workspace_members_tenant_delete" ON "workspace_members" FOR DELETE USING (app_private.same_workspace("workspace_id"));
--> statement-breakpoint
ALTER TABLE "workspace_settings" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "workspace_settings" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "workspace_settings_tenant_select" ON "workspace_settings" FOR SELECT USING (app_private.same_workspace("workspace_id"));
--> statement-breakpoint
CREATE POLICY "workspace_settings_tenant_insert" ON "workspace_settings" FOR INSERT WITH CHECK (app_private.same_workspace("workspace_id"));
--> statement-breakpoint
CREATE POLICY "workspace_settings_tenant_update" ON "workspace_settings" FOR UPDATE USING (app_private.same_workspace("workspace_id")) WITH CHECK (app_private.same_workspace("workspace_id"));
--> statement-breakpoint
CREATE POLICY "workspace_settings_tenant_delete" ON "workspace_settings" FOR DELETE USING (app_private.same_workspace("workspace_id"));
