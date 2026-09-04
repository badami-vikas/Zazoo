CREATE TABLE "academics_documents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"subject_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"title" text NOT NULL,
	"content" text,
	"url" text,
	"summary" text,
	"summarized_at" timestamp with time zone,
	"source" text,
	"source_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "academics_documents" ADD CONSTRAINT "academics_documents_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "academics_documents" ADD CONSTRAINT "academics_documents_subject_id_academics_subjects_id_fk" FOREIGN KEY ("subject_id") REFERENCES "public"."academics_subjects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "academics_documents_org_idx" ON "academics_documents" USING btree ("organization_id","subject_id");--> statement-breakpoint
CREATE INDEX "academics_documents_source_idx" ON "academics_documents" USING btree ("organization_id","source","source_id");