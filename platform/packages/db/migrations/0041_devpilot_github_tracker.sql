CREATE TABLE "devpilot_issues" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"source" text NOT NULL,
	"source_id" text NOT NULL,
	"repo_id" uuid,
	"repo_full_name" text,
	"number" integer NOT NULL,
	"title" text NOT NULL,
	"state" text NOT NULL,
	"labels" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"assignee" text,
	"priority" text,
	"url" text NOT NULL,
	"external_updated_at" timestamp with time zone NOT NULL,
	"synced_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "devpilot_issues_org_source_uq" UNIQUE("organization_id","source","source_id")
);
--> statement-breakpoint
CREATE TABLE "devpilot_pulls" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"source" text NOT NULL,
	"source_id" text NOT NULL,
	"repo_id" uuid,
	"repo_full_name" text NOT NULL,
	"number" integer NOT NULL,
	"title" text NOT NULL,
	"state" text NOT NULL,
	"review_state" text DEFAULT 'pending' NOT NULL,
	"author" text,
	"is_draft" boolean DEFAULT false NOT NULL,
	"additions" integer,
	"deletions" integer,
	"url" text NOT NULL,
	"external_updated_at" timestamp with time zone NOT NULL,
	"synced_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "devpilot_pulls_org_source_uq" UNIQUE("organization_id","source","source_id")
);
--> statement-breakpoint
CREATE TABLE "devpilot_repos" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"source" text NOT NULL,
	"source_id" text NOT NULL,
	"full_name" text NOT NULL,
	"private" boolean DEFAULT false NOT NULL,
	"default_branch" text NOT NULL,
	"archived" boolean DEFAULT false NOT NULL,
	"tracked" boolean DEFAULT false NOT NULL,
	"pushed_at" timestamp with time zone,
	"url" text NOT NULL,
	"synced_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "devpilot_repos_org_source_uq" UNIQUE("organization_id","source","source_id")
);
--> statement-breakpoint
ALTER TABLE "devpilot_issues" ADD CONSTRAINT "devpilot_issues_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "devpilot_issues" ADD CONSTRAINT "devpilot_issues_repo_id_devpilot_repos_id_fk" FOREIGN KEY ("repo_id") REFERENCES "public"."devpilot_repos"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "devpilot_pulls" ADD CONSTRAINT "devpilot_pulls_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "devpilot_pulls" ADD CONSTRAINT "devpilot_pulls_repo_id_devpilot_repos_id_fk" FOREIGN KEY ("repo_id") REFERENCES "public"."devpilot_repos"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "devpilot_repos" ADD CONSTRAINT "devpilot_repos_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "devpilot_issues_org_updated_idx" ON "devpilot_issues" USING btree ("organization_id","external_updated_at");--> statement-breakpoint
CREATE INDEX "devpilot_pulls_org_updated_idx" ON "devpilot_pulls" USING btree ("organization_id","external_updated_at");--> statement-breakpoint
CREATE INDEX "devpilot_repos_org_tracked_idx" ON "devpilot_repos" USING btree ("organization_id","tracked");