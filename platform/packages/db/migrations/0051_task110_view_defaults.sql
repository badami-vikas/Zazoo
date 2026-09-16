ALTER TABLE "view_configs" ADD COLUMN "is_default" boolean DEFAULT false NOT NULL;--> statement-breakpoint

-- ============================================================================
-- Hand-written tail (TASK-110) — drizzle-kit emits the column, not the rule.
--
-- "Which List does this Database open on?" must have exactly ONE answer per
-- owner per Database. Enforced here rather than in the store: an application
-- that clears the previous default in a second statement is one crash away
-- from two defaults, and the row the UI would then pick is whichever the
-- planner returned first.
-- ============================================================================
CREATE UNIQUE INDEX "view_configs_one_default_uq"
  ON "view_configs" ("organization_id", "owner_user_id", "database_id")
  WHERE "is_default";
