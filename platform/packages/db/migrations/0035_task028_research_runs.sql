CREATE TABLE "research_run_steps" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"owner_user_id" uuid NOT NULL,
	"run_id" uuid NOT NULL,
	"step_index" integer NOT NULL,
	"tool" text NOT NULL,
	"summary" text NOT NULL,
	"source_url" text,
	"child_run_id" uuid,
	"quarantined_text" text,
	"quarantined_source_url" text,
	"created_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "research_run_steps_step_index_check" CHECK ("research_run_steps"."step_index" >= 0),
	CONSTRAINT "research_run_steps_tool_check" CHECK ("research_run_steps"."tool" IN ('search', 'read', 'find', 'click', 'type', 'note')),
	CONSTRAINT "research_run_steps_summary_check" CHECK (length(btrim("research_run_steps"."summary")) > 0),
	CONSTRAINT "research_run_steps_quarantine_check" CHECK ("research_run_steps"."quarantined_text" IS NULL OR "research_run_steps"."quarantined_source_url" IS NOT NULL)
);
--> statement-breakpoint
CREATE TABLE "research_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"owner_user_id" uuid NOT NULL,
	"objective" text NOT NULL,
	"status" text DEFAULT 'running' NOT NULL,
	"stop_requested" boolean DEFAULT false NOT NULL,
	"parent_run_id" uuid NOT NULL,
	"goal_id" uuid NOT NULL,
	"task_id" uuid NOT NULL,
	"stop_reason" text,
	"brief" text,
	"citations" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"blocked_actions" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"injection_reports" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"steps_taken" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"ended_at" timestamp (3) with time zone,
	CONSTRAINT "research_runs_organization_owner_id_uq" UNIQUE("organization_id","owner_user_id","id"),
	CONSTRAINT "research_runs_objective_check" CHECK (length(btrim("research_runs"."objective")) > 0),
	CONSTRAINT "research_runs_status_check" CHECK ("research_runs"."status" IN ('running', 'completed', 'cancelled', 'failed')),
	CONSTRAINT "research_runs_stop_reason_check" CHECK ("research_runs"."stop_reason" IS NULL OR "research_runs"."stop_reason" IN (
        'planner_finished',
        'bound_steps',
        'bound_pages',
        'bound_wall_clock',
        'bound_bytes',
        'cancelled',
        'refused_red_action',
        'injection_detected',
        'planner_failed',
        'executor_error'
      )),
	CONSTRAINT "research_runs_terminal_check" CHECK (("research_runs"."status" = 'running' AND "research_runs"."stop_reason" IS NULL AND "research_runs"."ended_at" IS NULL)
          OR ("research_runs"."status" <> 'running' AND "research_runs"."stop_reason" IS NOT NULL AND "research_runs"."ended_at" IS NOT NULL)),
	CONSTRAINT "research_runs_ended_check" CHECK ("research_runs"."ended_at" IS NULL OR "research_runs"."ended_at" >= "research_runs"."created_at"),
	CONSTRAINT "research_runs_steps_taken_check" CHECK ("research_runs"."steps_taken" >= 0),
	CONSTRAINT "research_runs_citations_check" CHECK (jsonb_typeof("research_runs"."citations") = 'array'),
	CONSTRAINT "research_runs_blocked_actions_check" CHECK (jsonb_typeof("research_runs"."blocked_actions") = 'array'),
	CONSTRAINT "research_runs_injection_reports_check" CHECK (jsonb_typeof("research_runs"."injection_reports") = 'array')
);
--> statement-breakpoint
ALTER TABLE "research_run_steps" ADD CONSTRAINT "research_run_steps_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "research_run_steps" ADD CONSTRAINT "research_run_steps_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "research_run_steps" ADD CONSTRAINT "research_run_steps_run_id_research_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."research_runs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "research_runs" ADD CONSTRAINT "research_runs_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "research_runs" ADD CONSTRAINT "research_runs_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "research_run_steps_run_idx" ON "research_run_steps" USING btree ("organization_id","owner_user_id","run_id","step_index");--> statement-breakpoint
CREATE INDEX "research_runs_owner_created_idx" ON "research_runs" USING btree ("organization_id","owner_user_id","created_at","id");--> statement-breakpoint

-- ============================================================================
-- Hand-written security tail (TASK-028) — drizzle-kit emits table shape only.
-- Research Runs are OWNER-scoped (the chat_threads rule): visible and mutable
-- only inside the caller's organization AND only to the human who started the
-- Run. Steps are append-only evidence.
-- ============================================================================

ALTER TABLE "research_runs" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "research_runs" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "research_runs_owner_select"
  ON "research_runs" FOR SELECT
  USING (
    app_private.same_organization("organization_id")
    AND "owner_user_id" = app_private.current_user_id()
  );
--> statement-breakpoint
CREATE POLICY "research_runs_owner_insert"
  ON "research_runs" FOR INSERT
  WITH CHECK (
    app_private.same_organization("organization_id")
    AND "owner_user_id" = app_private.current_user_id()
  );
--> statement-breakpoint
CREATE POLICY "research_runs_owner_update"
  ON "research_runs" FOR UPDATE
  USING (
    app_private.same_organization("organization_id")
    AND "owner_user_id" = app_private.current_user_id()
  )
  WITH CHECK (
    app_private.same_organization("organization_id")
    AND "owner_user_id" = app_private.current_user_id()
  );
--> statement-breakpoint

ALTER TABLE "research_run_steps" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "research_run_steps" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "research_run_steps_owner_select"
  ON "research_run_steps" FOR SELECT
  USING (
    app_private.same_organization("organization_id")
    AND "owner_user_id" = app_private.current_user_id()
  );
--> statement-breakpoint
CREATE POLICY "research_run_steps_owner_insert"
  ON "research_run_steps" FOR INSERT
  WITH CHECK (
    app_private.same_organization("organization_id")
    AND "owner_user_id" = app_private.current_user_id()
  );
--> statement-breakpoint

-- No DELETE policy on either table and no UPDATE policy on steps: Research Run
-- history is retained evidence. The runtime role is narrowed the same way
-- chat_turns was (0031): steps are fully append-only; a run row may update only
-- its lifecycle/outcome columns, never identity or provenance.
REVOKE UPDATE, DELETE ON TABLE "research_runs" FROM bridge_app;
--> statement-breakpoint
GRANT UPDATE (
  "status",
  "stop_requested",
  "stop_reason",
  "brief",
  "citations",
  "blocked_actions",
  "injection_reports",
  "steps_taken",
  "ended_at"
) ON TABLE "research_runs" TO bridge_app;
--> statement-breakpoint
REVOKE UPDATE, DELETE ON TABLE "research_run_steps" FROM bridge_app;
--> statement-breakpoint

-- Lifecycle guard: identity is immutable, a terminal Run is frozen, and the
-- cooperative stop flag can be raised but never lowered.
CREATE OR REPLACE FUNCTION app_private.enforce_research_run_update()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF (
    NEW.id,
    NEW.organization_id,
    NEW.owner_user_id,
    NEW.objective,
    NEW.parent_run_id,
    NEW.goal_id,
    NEW.task_id,
    NEW.created_at
  ) IS DISTINCT FROM (
    OLD.id,
    OLD.organization_id,
    OLD.owner_user_id,
    OLD.objective,
    OLD.parent_run_id,
    OLD.goal_id,
    OLD.task_id,
    OLD.created_at
  ) THEN
    RAISE EXCEPTION 'research run identity and provenance are immutable'
      USING ERRCODE = '23000';
  END IF;

  IF OLD.status <> 'running' THEN
    RAISE EXCEPTION 'terminal research run % is immutable', OLD.id
      USING ERRCODE = '23000';
  END IF;

  IF OLD.stop_requested AND NOT NEW.stop_requested THEN
    RAISE EXCEPTION 'research run stop_requested cannot be lowered'
      USING ERRCODE = '23000';
  END IF;

  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER research_runs_update_guard
  BEFORE UPDATE ON "research_runs"
  FOR EACH ROW
  EXECUTE FUNCTION app_private.enforce_research_run_update();
