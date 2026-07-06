CREATE TABLE "package_installations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"package_name" text NOT NULL,
	"package_version" text NOT NULL,
	"manifest" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"computed_risk" text DEFAULT 'informational' NOT NULL,
	"state" text DEFAULT 'private' NOT NULL,
	"status" text DEFAULT 'pending_review' NOT NULL,
	"lineage_manifest_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "package_installations" ADD CONSTRAINT "package_installations_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "package_installations_ws_name_idx" ON "package_installations" USING btree ("workspace_id","package_name");--> statement-breakpoint
CREATE INDEX "package_installations_ws_state_idx" ON "package_installations" USING btree ("workspace_id","package_name","state");