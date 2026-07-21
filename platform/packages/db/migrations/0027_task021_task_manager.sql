ALTER TABLE "tasks" DROP CONSTRAINT IF EXISTS "tasks_organization_goal_fk";--> statement-breakpoint
ALTER TABLE "child_agent_runs" DROP CONSTRAINT IF EXISTS "child_agent_runs_organization_goal_fk";--> statement-breakpoint
ALTER TABLE "tasks" DROP CONSTRAINT IF EXISTS "tasks_status_valid";--> statement-breakpoint
ALTER TABLE "tasks" ALTER COLUMN "assigned_agent_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "tasks" ALTER COLUMN "goal_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "anchor_task_id" uuid;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "parent_task_id" uuid;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "path" text;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "level" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "sort_order" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "title" text;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "is_goal" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "outcomes" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "anchor" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "review_cadence" text;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "last_reviewed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "exit_test" text;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "priority" text DEFAULT 'P2' NOT NULL;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "owner_type" text DEFAULT 'human' NOT NULL;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "owner_id" uuid;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "required_skill_id" text;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "scheduled_for" date;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "evidence_refs" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "verification" jsonb;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "visibility" text DEFAULT 'organization' NOT NULL;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "version" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "updated_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
WITH ranked_goals AS (
  SELECT id, organization_id, type, title, created_at,
         row_number() OVER (PARTITION BY organization_id ORDER BY created_at, id) AS root_order
  FROM goals
)
INSERT INTO tasks (
  id, organization_id, type, title, is_goal, path, level, sort_order, status,
  owner_type, created_at, updated_at
)
SELECT
  id, organization_id, type, title, true, root_order::text, 0, root_order, 'pending',
  'human', created_at, created_at
FROM ranked_goals
ON CONFLICT (id) DO NOTHING;--> statement-breakpoint
WITH ranked_children AS (
  SELECT
    child.id,
    parent.path AS parent_path,
    row_number() OVER (
      PARTITION BY child.organization_id, child.goal_id
      ORDER BY child.created_at, child.id
    ) AS child_order
  FROM tasks child
  JOIN tasks parent
    ON parent.organization_id = child.organization_id
   AND parent.id = child.goal_id
  WHERE child.is_goal = false
)
UPDATE tasks AS target
SET
  anchor_task_id = target.goal_id,
  parent_task_id = target.goal_id,
  title = coalesce(target.title, target.type),
  path = ranked_children.parent_path || '.' || ranked_children.child_order::text,
  level = 1,
  sort_order = ranked_children.child_order,
  status = CASE WHEN target.status = 'open' THEN 'pending' ELSE target.status END,
  updated_at = target.created_at
FROM ranked_children
WHERE target.id = ranked_children.id;--> statement-breakpoint
UPDATE tasks
SET title = coalesce(title, type), path = coalesce(path, '1')
WHERE title IS NULL OR path IS NULL;--> statement-breakpoint
ALTER TABLE "child_agent_runs" ADD COLUMN "anchor_task_id" uuid;--> statement-breakpoint
UPDATE "child_agent_runs" SET "anchor_task_id" = "goal_id";--> statement-breakpoint
ALTER TABLE "child_agent_runs" ALTER COLUMN "anchor_task_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "tasks" ALTER COLUMN "title" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "tasks" ALTER COLUMN "path" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "tasks" DROP COLUMN "goal_id";--> statement-breakpoint
ALTER TABLE "child_agent_runs" DROP COLUMN "goal_id";--> statement-breakpoint
DROP TABLE "goals";--> statement-breakpoint
DROP INDEX IF EXISTS "tasks_goal_idx";--> statement-breakpoint
CREATE INDEX "tasks_anchor_idx" ON "tasks" ("anchor_task_id");--> statement-breakpoint
CREATE INDEX "tasks_parent_idx" ON "tasks" ("organization_id", "parent_task_id", "sort_order");--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_organization_path_uq" UNIQUE ("organization_id", "path") DEFERRABLE INITIALLY DEFERRED;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_organization_anchor_fk"
  FOREIGN KEY ("organization_id", "anchor_task_id")
  REFERENCES "tasks" ("organization_id", "id")
  DEFERRABLE INITIALLY DEFERRED;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_organization_parent_fk"
  FOREIGN KEY ("organization_id", "parent_task_id")
  REFERENCES "tasks" ("organization_id", "id")
  DEFERRABLE INITIALLY DEFERRED;--> statement-breakpoint
ALTER TABLE "child_agent_runs" ADD CONSTRAINT "child_agent_runs_organization_anchor_fk"
  FOREIGN KEY ("organization_id", "anchor_task_id")
  REFERENCES "tasks" ("organization_id", "id");--> statement-breakpoint
ALTER TABLE "tasks" DROP CONSTRAINT IF EXISTS "tasks_status_valid";--> statement-breakpoint
ALTER TABLE "tasks" ALTER COLUMN "status" SET DEFAULT 'pending';--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_status_valid" CHECK (
  "status" IN ('candidate','committed','pending','in_progress','blocked','done','parked','abandoned','archived','cancelled')
);--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_path_valid" CHECK ("path" ~ '^[1-9][0-9]*(\.[1-9][0-9]*)*$');--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_level_valid" CHECK ("level" >= 0 AND "level" = array_length(string_to_array("path", '.'), 1) - 1);--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_owner_type_valid" CHECK ("owner_type" IN ('human','agent'));--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_visibility_valid" CHECK ("visibility" IN ('private','organization'));--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_outcomes_array" CHECK (jsonb_typeof("outcomes") = 'array');--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_evidence_array" CHECK (jsonb_typeof("evidence_refs") = 'array');--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_exit_test_before_progress" CHECK (
  "is_goal" OR "status" <> 'in_progress' OR length(trim(coalesce("exit_test", ''))) > 0
);--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_done_verified" CHECK (
  "status" <> 'done' OR "verification" IS NOT NULL
);--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_private_owner_valid" CHECK (
  "visibility" <> 'private' OR ("owner_type" = 'human' AND "owner_id" IS NOT NULL)
);--> statement-breakpoint
DROP POLICY IF EXISTS "tasks_tenant_all" ON "tasks";--> statement-breakpoint
DROP POLICY IF EXISTS "tasks_organization_all" ON "tasks";--> statement-breakpoint
CREATE POLICY "tasks_visibility_all" ON "tasks"
  FOR ALL
  USING (
    app_private.same_organization("organization_id")
    AND (
      "visibility" = 'organization'
      OR ("owner_type" = 'human' AND "owner_id" = app_private.current_user_id())
    )
  )
  WITH CHECK (
    app_private.same_organization("organization_id")
    AND (
      "visibility" = 'organization'
      OR ("owner_type" = 'human' AND "owner_id" = app_private.current_user_id())
    )
  );--> statement-breakpoint
CREATE TABLE "task_change_proposals" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "organization_id" uuid NOT NULL REFERENCES "organizations"("id"),
  "kind" text NOT NULL,
  "task_id" uuid NOT NULL,
  "actor_id" text NOT NULL,
  "payload" jsonb NOT NULL,
  "status" text DEFAULT 'pending_review' NOT NULL,
  "decided_by" text,
  "decided_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "task_change_proposals_organization_task_fk"
    FOREIGN KEY ("organization_id", "task_id")
    REFERENCES "tasks" ("organization_id", "id"),
  CONSTRAINT "task_change_proposals_status_valid"
    CHECK ("status" IN ('pending_review','approved','vetoed'))
);--> statement-breakpoint
CREATE INDEX "task_change_proposals_org_status_idx"
  ON "task_change_proposals" ("organization_id", "status", "created_at");--> statement-breakpoint
ALTER TABLE "task_change_proposals" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "task_change_proposals" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "task_change_proposals_tenant_all" ON "task_change_proposals"
  FOR ALL USING (
    app_private.same_organization("organization_id")
    AND EXISTS (
      SELECT 1 FROM "tasks"
      WHERE "tasks"."organization_id" = "task_change_proposals"."organization_id"
        AND "tasks"."id" = "task_change_proposals"."task_id"
    )
  )
  WITH CHECK (
    app_private.same_organization("organization_id")
    AND EXISTS (
      SELECT 1 FROM "tasks"
      WHERE "tasks"."organization_id" = "task_change_proposals"."organization_id"
        AND "tasks"."id" = "task_change_proposals"."task_id"
    )
  );
