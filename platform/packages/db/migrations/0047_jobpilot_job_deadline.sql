ALTER TABLE "jobpilot_jobs" ADD COLUMN "deadline" date;--> statement-breakpoint
CREATE INDEX "jobpilot_jobs_org_deadline_idx" ON "jobpilot_jobs" USING btree ("organization_id","deadline");
