-- Automation Run -> Task anchor, Task estimate, and per-Organization Module
-- display name. THREE migrations on the branch (0044/0045/0046), squashed into
-- one on merge: origin/main had independently claimed 0044 and 0045 for the
-- chat backend and per-Module chat sessions. None of the three had ever been
-- applied anywhere, so re-cutting them at the correct index is honest;
-- renumbering an applied migration would not be.
--
-- 1. `automation_runs.task_id` — `pipeline.propose` already fails closed
--    without a `goalTaskRef`, so every governed Automation step names a Task.
--    But the anchor lived ONLY on the Automation step definition, a mutable row
--    shared by every Run, so "which Task did this Run advance" could only be
--    answered with whatever the step says TODAY. Nullable on purpose: Runs
--    recorded before this column, and steps whose Skill is agent-floor-exempt,
--    have no Task to name. NULL says "no anchor recorded"; a backfilled guess
--    would say something the ledger never witnessed (AP-247).
-- 2. `tasks.estimate` — TEXT, because the unit is part of the judgement; NULL
--    rather than 0, because "nobody has estimated this" is not an estimate of
--    none.
-- 3. `module_installations.display_name_override` — what one Organization calls
--    a Module. Not in the manifest: `seedBuiltInModules` rewrites a built-in
--    Module's stored manifest on every boot, so a rename written there is
--    reverted at next start.
--
-- Reversible: three additive columns, one index and one FK, no backfill and no
-- change to any existing value.

ALTER TABLE "automation_runs" ADD COLUMN "task_id" uuid;--> statement-breakpoint
ALTER TABLE "module_installations" ADD COLUMN "display_name_override" text;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "estimate" text;--> statement-breakpoint
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
