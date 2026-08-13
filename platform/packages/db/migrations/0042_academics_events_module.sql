CREATE TABLE "academics_assignments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"subject_id" uuid NOT NULL,
	"title" text NOT NULL,
	"type" text,
	"due_at" timestamp with time zone,
	"weight" integer,
	"status" text DEFAULT 'not_started' NOT NULL,
	"risk" text,
	"submitted_at" timestamp with time zone,
	"grade" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "academics_lecture_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"subject_id" uuid NOT NULL,
	"session_date" timestamp with time zone,
	"topic" text,
	"status" text DEFAULT 'scheduled' NOT NULL,
	"my_notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "academics_subjects" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"code" text,
	"title" text NOT NULL,
	"term" text,
	"instructor" text,
	"credits" integer,
	"status" text DEFAULT 'planned' NOT NULL,
	"grade" text,
	"target_grade" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "conference_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"name" text NOT NULL,
	"url" text,
	"type" text,
	"starts_at" timestamp with time zone,
	"ends_at" timestamp with time zone,
	"location" text,
	"status" text DEFAULT 'watching' NOT NULL,
	"extraction_status" text DEFAULT 'not_run' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "academics_assignments" ADD CONSTRAINT "academics_assignments_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "academics_assignments" ADD CONSTRAINT "academics_assignments_subject_id_academics_subjects_id_fk" FOREIGN KEY ("subject_id") REFERENCES "public"."academics_subjects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "academics_lecture_sessions" ADD CONSTRAINT "academics_lecture_sessions_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "academics_lecture_sessions" ADD CONSTRAINT "academics_lecture_sessions_subject_id_academics_subjects_id_fk" FOREIGN KEY ("subject_id") REFERENCES "public"."academics_subjects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "academics_subjects" ADD CONSTRAINT "academics_subjects_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conference_events" ADD CONSTRAINT "conference_events_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "academics_assignments_org_idx" ON "academics_assignments" USING btree ("organization_id","subject_id");--> statement-breakpoint
CREATE INDEX "academics_lecture_sessions_org_idx" ON "academics_lecture_sessions" USING btree ("organization_id","subject_id");--> statement-breakpoint
CREATE INDEX "academics_subjects_org_idx" ON "academics_subjects" USING btree ("organization_id","created_at");--> statement-breakpoint
CREATE INDEX "conference_events_org_idx" ON "conference_events" USING btree ("organization_id","created_at");