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
	"deadline" text NOT NULL,
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
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "skill_manifests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid,
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
	CONSTRAINT "skill_manifests_uq" UNIQUE("skill_id","version")
);
--> statement-breakpoint
CREATE TABLE "tasks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"goal_id" uuid NOT NULL,
	"type" text NOT NULL,
	"assigned_agent_id" uuid NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "child_agent_runs" ADD CONSTRAINT "child_agent_runs_parent_agent_id_agents_id_fk" FOREIGN KEY ("parent_agent_id") REFERENCES "public"."agents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "child_agent_runs" ADD CONSTRAINT "child_agent_runs_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "child_agent_runs" ADD CONSTRAINT "child_agent_runs_goal_id_goals_id_fk" FOREIGN KEY ("goal_id") REFERENCES "public"."goals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "child_agent_runs" ADD CONSTRAINT "child_agent_runs_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "goals" ADD CONSTRAINT "goals_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "skill_manifests" ADD CONSTRAINT "skill_manifests_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_goal_id_goals_id_fk" FOREIGN KEY ("goal_id") REFERENCES "public"."goals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_assigned_agent_id_agents_id_fk" FOREIGN KEY ("assigned_agent_id") REFERENCES "public"."agents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "child_agent_runs_parent_run_idx" ON "child_agent_runs" USING btree ("parent_run_id");--> statement-breakpoint
CREATE INDEX "goals_ws_type_idx" ON "goals" USING btree ("workspace_id","type");--> statement-breakpoint
CREATE INDEX "tasks_goal_idx" ON "tasks" USING btree ("goal_id");--> statement-breakpoint
CREATE INDEX "tasks_assigned_agent_idx" ON "tasks" USING btree ("assigned_agent_id");