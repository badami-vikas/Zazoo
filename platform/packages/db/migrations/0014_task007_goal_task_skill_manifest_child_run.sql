ALTER TABLE "agents" ADD CONSTRAINT "agents_workspace_id_id_uq" UNIQUE("workspace_id","id");--> statement-breakpoint
CREATE TABLE "child_agent_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"parent_run_id" uuid NOT NULL,
	"parent_agent_id" uuid NOT NULL,
	"workspace_id" uuid NOT NULL,
	"goal_id" uuid NOT NULL,
	"task_id" uuid NOT NULL,
	"depth" integer NOT NULL,
	"authority_scope" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"dropped_scope" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"eligible_skills" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"data_scope" text NOT NULL,
	"plane" text NOT NULL,
	"budget" jsonb NOT NULL,
	"calls_used" integer DEFAULT 0 NOT NULL,
	"cost_used" double precision DEFAULT 0 NOT NULL,
	"deadline" timestamp with time zone NOT NULL,
	"stop_condition" text NOT NULL,
	"review_mode" text NOT NULL,
	"taint" text,
	"status" text DEFAULT 'running' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "goals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"type" text NOT NULL,
	"title" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "goals_workspace_id_id_uq" UNIQUE("workspace_id","id")
);
--> statement-breakpoint
CREATE TABLE "skill_manifests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"skill_id" text NOT NULL,
	"version" text DEFAULT '1.0.0' NOT NULL,
	"goal_types" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"task_types" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"input_schema" jsonb,
	"output_schema" jsonb,
	"permissions" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"plane" text NOT NULL,
	"data_scopes" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"risk_band" text NOT NULL,
	"budget" jsonb,
	"eval_version" text NOT NULL,
	"default_agents" jsonb,
	"required_integrations" jsonb,
	"child_run_policy" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "skill_manifests_uq" UNIQUE("workspace_id","skill_id","version")
);
--> statement-breakpoint
CREATE TABLE "tasks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"goal_id" uuid NOT NULL,
	"type" text NOT NULL,
	"assigned_agent_id" uuid NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tasks_workspace_id_id_uq" UNIQUE("workspace_id","id")
);
--> statement-breakpoint
ALTER TABLE "child_agent_runs" ADD CONSTRAINT "child_agent_runs_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "child_agent_runs" ADD CONSTRAINT "child_agent_runs_workspace_agent_fk" FOREIGN KEY ("workspace_id","parent_agent_id") REFERENCES "public"."agents"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "child_agent_runs" ADD CONSTRAINT "child_agent_runs_workspace_goal_fk" FOREIGN KEY ("workspace_id","goal_id") REFERENCES "public"."goals"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "child_agent_runs" ADD CONSTRAINT "child_agent_runs_workspace_task_fk" FOREIGN KEY ("workspace_id","task_id") REFERENCES "public"."tasks"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "goals" ADD CONSTRAINT "goals_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "skill_manifests" ADD CONSTRAINT "skill_manifests_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_workspace_goal_fk" FOREIGN KEY ("workspace_id","goal_id") REFERENCES "public"."goals"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_workspace_agent_fk" FOREIGN KEY ("workspace_id","assigned_agent_id") REFERENCES "public"."agents"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "child_agent_runs_parent_run_idx" ON "child_agent_runs" USING btree ("workspace_id","parent_run_id");--> statement-breakpoint
CREATE INDEX "goals_ws_type_idx" ON "goals" USING btree ("workspace_id","type");--> statement-breakpoint
CREATE INDEX "tasks_goal_idx" ON "tasks" USING btree ("goal_id");--> statement-breakpoint
CREATE INDEX "tasks_assigned_agent_idx" ON "tasks" USING btree ("assigned_agent_id");--> statement-breakpoint
ALTER TABLE "goals" ADD CONSTRAINT "goals_type_nonempty" CHECK (length(trim("type")) > 0);--> statement-breakpoint
ALTER TABLE "goals" ADD CONSTRAINT "goals_title_nonempty" CHECK (length(trim("title")) > 0);--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_type_nonempty" CHECK (length(trim("type")) > 0);--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_status_valid" CHECK ("status" IN ('open','in_progress','done','blocked','cancelled'));--> statement-breakpoint
ALTER TABLE "skill_manifests" ADD CONSTRAINT "skill_manifests_skill_nonempty" CHECK (length(trim("skill_id")) > 0);--> statement-breakpoint
ALTER TABLE "skill_manifests" ADD CONSTRAINT "skill_manifests_plane_valid" CHECK ("plane" IN ('local','cloud'));--> statement-breakpoint
ALTER TABLE "skill_manifests" ADD CONSTRAINT "skill_manifests_child_policy_valid" CHECK ("child_run_policy" IS NULL OR "child_run_policy" IN ('allowed','forbidden'));--> statement-breakpoint
ALTER TABLE "child_agent_runs" ADD CONSTRAINT "child_agent_runs_depth_valid" CHECK ("depth" BETWEEN 1 AND 3);--> statement-breakpoint
ALTER TABLE "child_agent_runs" ADD CONSTRAINT "child_agent_runs_authority_nonempty" CHECK (jsonb_typeof("authority_scope") = 'array' AND jsonb_array_length("authority_scope") > 0);--> statement-breakpoint
ALTER TABLE "child_agent_runs" ADD CONSTRAINT "child_agent_runs_skills_nonempty" CHECK (jsonb_typeof("eligible_skills") = 'array' AND jsonb_array_length("eligible_skills") > 0);--> statement-breakpoint
ALTER TABLE "child_agent_runs" ADD CONSTRAINT "child_agent_runs_data_scope_valid" CHECK ("data_scope" IN ('public','private','all'));--> statement-breakpoint
ALTER TABLE "child_agent_runs" ADD CONSTRAINT "child_agent_runs_plane_valid" CHECK ("plane" IN ('local','cloud'));--> statement-breakpoint
ALTER TABLE "child_agent_runs" ADD CONSTRAINT "child_agent_runs_budget_valid" CHECK (
	jsonb_typeof("budget") = 'object'
	AND ("budget"->>'maxCalls')::integer > 0
	AND ("budget"->>'maxCost')::double precision >= 0
);--> statement-breakpoint
ALTER TABLE "child_agent_runs" ADD CONSTRAINT "child_agent_runs_usage_valid" CHECK ("calls_used" >= 0 AND "cost_used" >= 0);--> statement-breakpoint
ALTER TABLE "child_agent_runs" ADD CONSTRAINT "child_agent_runs_deadline_valid" CHECK ("deadline" > "created_at");--> statement-breakpoint
ALTER TABLE "child_agent_runs" ADD CONSTRAINT "child_agent_runs_stop_nonempty" CHECK (length(trim("stop_condition")) > 0);--> statement-breakpoint
ALTER TABLE "child_agent_runs" ADD CONSTRAINT "child_agent_runs_review_mode_valid" CHECK ("review_mode" IN ('auto','notify','approve','quorum'));--> statement-breakpoint
ALTER TABLE "child_agent_runs" ADD CONSTRAINT "child_agent_runs_taint_valid" CHECK ("taint" IS NULL OR "taint" IN ('operator','user_content','untrusted_external'));--> statement-breakpoint
ALTER TABLE "child_agent_runs" ADD CONSTRAINT "child_agent_runs_status_valid" CHECK ("status" IN ('running','completed','failed','cancelled'));--> statement-breakpoint
ALTER TABLE "goals" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "goals" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "goals_tenant_all" ON "goals" FOR ALL USING (app_private.same_workspace("workspace_id")) WITH CHECK (app_private.same_workspace("workspace_id"));--> statement-breakpoint
ALTER TABLE "tasks" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "tasks" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "tasks_tenant_all" ON "tasks" FOR ALL USING (app_private.same_workspace("workspace_id")) WITH CHECK (app_private.same_workspace("workspace_id"));--> statement-breakpoint
ALTER TABLE "skill_manifests" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "skill_manifests" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "skill_manifests_tenant_all" ON "skill_manifests" FOR ALL USING (app_private.same_workspace("workspace_id")) WITH CHECK (app_private.same_workspace("workspace_id"));--> statement-breakpoint
ALTER TABLE "child_agent_runs" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "child_agent_runs" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "child_agent_runs_tenant_all" ON "child_agent_runs" FOR ALL USING (app_private.same_workspace("workspace_id")) WITH CHECK (app_private.same_workspace("workspace_id"));