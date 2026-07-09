CREATE TABLE "capability_manifests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"capability_type" text NOT NULL,
	"name" text NOT NULL,
	"version" text DEFAULT '1.0.0' NOT NULL,
	"origin" text DEFAULT 'user_code' NOT NULL,
	"audience" text DEFAULT 'private' NOT NULL,
	"manifest" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"computed_risk" text DEFAULT 'informational' NOT NULL,
	"dependencies" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"lineage_manifest_id" uuid,
	"owner_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone,
	CONSTRAINT "capability_manifests_uq" UNIQUE("workspace_id","name","version")
);
--> statement-breakpoint
CREATE TABLE "capability_states" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"manifest_id" uuid NOT NULL,
	"workspace_id" uuid NOT NULL,
	"state" text DEFAULT 'draft' NOT NULL,
	"trusted_until" timestamp with time zone,
	"suspended" boolean DEFAULT false NOT NULL,
	"suspend_reason" text,
	"evidence" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "capability_states_manifest_uq" UNIQUE("manifest_id")
);
--> statement-breakpoint
CREATE TABLE "trust_grants" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"capability_class" text NOT NULL,
	"scope" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"granted_by" uuid,
	"risk_band" text NOT NULL,
	"auto_activate" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revoked_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "workspace_definitions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"blueprint" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "capability_manifests" ADD CONSTRAINT "capability_manifests_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "capability_manifests" ADD CONSTRAINT "capability_manifests_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "capability_states" ADD CONSTRAINT "capability_states_manifest_id_capability_manifests_id_fk" FOREIGN KEY ("manifest_id") REFERENCES "public"."capability_manifests"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "capability_states" ADD CONSTRAINT "capability_states_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trust_grants" ADD CONSTRAINT "trust_grants_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trust_grants" ADD CONSTRAINT "trust_grants_granted_by_users_id_fk" FOREIGN KEY ("granted_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_definitions" ADD CONSTRAINT "workspace_definitions_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_definitions" ADD CONSTRAINT "workspace_definitions_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "capability_manifests_ws_idx" ON "capability_manifests" USING btree ("workspace_id","capability_type");--> statement-breakpoint
CREATE INDEX "trust_grants_ws_class_idx" ON "trust_grants" USING btree ("workspace_id","capability_class");--> statement-breakpoint
CREATE INDEX "workspace_definitions_ws_idx" ON "workspace_definitions" USING btree ("workspace_id","version");