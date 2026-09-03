-- Automation Run -> Task anchor.
--
-- `pipeline.propose` already fails closed without a `goalTaskRef`, so every
-- governed Automation step names a Task. But the anchor lived ONLY on the
-- Automation step definition — a mutable row shared by every Run of that
-- Automation — so "which Task did this Run advance" could not be answered
-- from the Run, and answering it from the step gives whatever the step says
-- TODAY, not what it said when the Run happened. An audit that can only read
-- the current definition is not an audit of the Run.
--
-- Nullable on purpose. Runs recorded before this column exists have no Task
-- to name, and a step whose Skill is agent-floor-exempt never carried a
-- `goalTaskRef` to project. NULL says "no anchor recorded"; a backfilled
-- guess would say something the ledger never witnessed (AP-247: "unknown" is
-- first-class, never fabricate a figure).
--
-- Reversible: additive column + index + FK, no backfill and no change to any
-- existing value, so dropping the three restores the prior schema exactly.

ALTER TABLE "automation_runs" ADD COLUMN "task_id" uuid;--> statement-breakpoint
CREATE INDEX "automation_runs_task_idx" ON "automation_runs" USING btree ("organization_id","task_id");--> statement-breakpoint
-- Beyond what drizzle-kit generates from the TypeScript schema:
--
-- The composite FK on (organization_id, id) — a Run can never anchor to a Task
-- in another tenant, the same guarantee `tasks.parent_task_id` and
-- `child_agent_runs.task_id` rely on and one a single-column FK cannot make.
-- Declared here rather than in schema.ts because `automation_runs` (LAYER 4)
-- is defined before `tasks` (LAYER 8) and drizzle evaluates the extras
-- callback at module init. `no action` on delete, not cascade: deleting a Task
-- must not silently erase the Run history that acted on it.
ALTER TABLE "automation_runs" ADD CONSTRAINT "automation_runs_organization_task_fk" FOREIGN KEY ("organization_id","task_id") REFERENCES "public"."tasks"("organization_id","id") ON DELETE no action ON UPDATE no action;
