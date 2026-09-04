ALTER TABLE "academics_assignments" ADD COLUMN "source" text;--> statement-breakpoint
ALTER TABLE "academics_assignments" ADD COLUMN "source_id" text;--> statement-breakpoint
ALTER TABLE "academics_subjects" ADD COLUMN "source" text;--> statement-breakpoint
ALTER TABLE "academics_subjects" ADD COLUMN "source_id" text;--> statement-breakpoint
CREATE INDEX "academics_assignments_source_idx" ON "academics_assignments" USING btree ("organization_id","source","source_id");--> statement-breakpoint
CREATE INDEX "academics_subjects_source_idx" ON "academics_subjects" USING btree ("organization_id","source","source_id");