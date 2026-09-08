CREATE TABLE "authored_databases" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"module_name" text NOT NULL,
	"database_id" text NOT NULL,
	"capability_id" text NOT NULL,
	"label" text NOT NULL,
	"columns" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "authored_records" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"database_row_id" uuid NOT NULL,
	"properties" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "authored_databases" ADD CONSTRAINT "authored_databases_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "authored_records" ADD CONSTRAINT "authored_records_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "authored_records" ADD CONSTRAINT "authored_records_database_row_id_authored_databases_id_fk" FOREIGN KEY ("database_row_id") REFERENCES "public"."authored_databases"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "authored_databases_module_database_uq" ON "authored_databases" USING btree ("organization_id","module_name","database_id");--> statement-breakpoint
CREATE INDEX "authored_databases_organization_idx" ON "authored_databases" USING btree ("organization_id","module_name");--> statement-breakpoint
CREATE INDEX "authored_records_database_idx" ON "authored_records" USING btree ("organization_id","database_row_id");
