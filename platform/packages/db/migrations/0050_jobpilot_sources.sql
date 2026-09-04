CREATE TABLE "jobpilot_sources" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"source_id" text NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	"last_checked_at" timestamp with time zone,
	"last_fetched" integer,
	"last_kept" integer,
	"last_error" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "jobpilot_sources_org_source_uq" UNIQUE("organization_id","source_id")
);
--> statement-breakpoint
ALTER TABLE "jobpilot_sources" ADD CONSTRAINT "jobpilot_sources_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
-- Pre-existing duplicates must be cleared BEFORE the constraint, or this
-- migration fails on any database that already holds two jobs sharing a url.
-- A fresh install can never surface that, which is exactly why it is handled
-- here rather than discovered on someone's populated machine.
--
-- Non-destructive on purpose: the newer duplicates keep their row, their
-- tracking application and their stage — only the url is released, and NULL
-- urls are exempt from the constraint. Deleting the row would throw away a job
-- the user may already be tracking, to enforce a guard that exists to reduce
-- clutter. The cost is that such a row can be re-added once by a later sweep.
UPDATE "jobpilot_jobs" SET "url" = NULL
WHERE "id" IN (
	SELECT "id" FROM (
		SELECT "id", ROW_NUMBER() OVER (
			PARTITION BY "organization_id", "url" ORDER BY "created_at", "id"
		) AS rn
		FROM "jobpilot_jobs"
		WHERE "url" IS NOT NULL
	) ranked WHERE ranked.rn > 1
);--> statement-breakpoint
ALTER TABLE "jobpilot_jobs" ADD CONSTRAINT "jobpilot_jobs_org_url_uq" UNIQUE("organization_id","url");