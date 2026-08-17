CREATE TABLE "jobpilot_candidate_profiles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"resume_file_name" text,
	"selected_functions" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "jobpilot_candidate_profiles_organization_id_unique" UNIQUE("organization_id")
);
--> statement-breakpoint
ALTER TABLE "jobpilot_candidate_profiles" ADD CONSTRAINT "jobpilot_candidate_profiles_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;