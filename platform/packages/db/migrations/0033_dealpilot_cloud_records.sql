CREATE TABLE "dealpilot_deals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"company" text NOT NULL,
	"stage" text DEFAULT 'sourced' NOT NULL,
	"revenue" double precision,
	"ebitda" double precision,
	"sde" double precision,
	"asking_price" double precision,
	"evidence_health" text,
	"owner_id" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "dealpilot_deals_org_id_uq" UNIQUE("organization_id","id")
);
--> statement-breakpoint
CREATE TABLE "dealpilot_relations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"from_id" uuid NOT NULL,
	"to_id" uuid NOT NULL,
	"confidence" double precision DEFAULT 0 NOT NULL,
	"provenance" text NOT NULL,
	"evidence_refs" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "dealpilot_relations_org_kind_from_to_uq" UNIQUE("organization_id","kind","from_id","to_id")
);
--> statement-breakpoint
CREATE TABLE "dealpilot_sources" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"name" text NOT NULL,
	"link" text NOT NULL,
	"connection_type" text NOT NULL,
	"credential_ref" text,
	"credential_owner_id" text,
	"last_checked_at" timestamp with time zone,
	"spend_cap" double precision DEFAULT 0 NOT NULL,
	"spend_to_date" double precision DEFAULT 0 NOT NULL,
	"health" text DEFAULT 'ready' NOT NULL,
	"schedule" text,
	"yield" double precision,
	"rights_state" text DEFAULT 'unattested' NOT NULL,
	"rights_attested_at" timestamp with time zone,
	"rights_attested_by" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "dealpilot_sources_org_id_uq" UNIQUE("organization_id","id")
);
--> statement-breakpoint
CREATE TABLE "dealpilot_theses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"name" text NOT NULL,
	"focus" text NOT NULL,
	"target_cagr" double precision,
	"criteria" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"exclusions" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"sourcing_strategy" text,
	"version" integer DEFAULT 1 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "dealpilot_theses_org_id_uq" UNIQUE("organization_id","id")
);
--> statement-breakpoint
ALTER TABLE "dealpilot_deals" ADD CONSTRAINT "dealpilot_deals_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dealpilot_relations" ADD CONSTRAINT "dealpilot_relations_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dealpilot_sources" ADD CONSTRAINT "dealpilot_sources_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dealpilot_theses" ADD CONSTRAINT "dealpilot_theses_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "dealpilot_deals_org_created_idx" ON "dealpilot_deals" USING btree ("organization_id","created_at");--> statement-breakpoint
CREATE INDEX "dealpilot_relations_from_idx" ON "dealpilot_relations" USING btree ("organization_id","from_id");--> statement-breakpoint
CREATE INDEX "dealpilot_relations_to_idx" ON "dealpilot_relations" USING btree ("organization_id","to_id");--> statement-breakpoint
CREATE INDEX "dealpilot_sources_org_created_idx" ON "dealpilot_sources" USING btree ("organization_id","created_at");--> statement-breakpoint
CREATE INDEX "dealpilot_theses_org_created_idx" ON "dealpilot_theses" USING btree ("organization_id","created_at");--> statement-breakpoint
-- RLS — DealPilot Cloud-Plane Records are tenant-scoped (ADR-151/AP-083).
-- Table privileges are granted to bridge_app by the ALTER DEFAULT PRIVILEGES in
-- 0022_supabase_runtime_role.sql; FORCE keeps the policy in effect for the
-- table owner too. Credential/raw-capture columns are never written here.
ALTER TABLE "dealpilot_deals" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "dealpilot_deals" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "dealpilot_deals_tenant_all" ON "dealpilot_deals"
  FOR ALL
  USING (app_private.same_organization("organization_id"))
  WITH CHECK (app_private.same_organization("organization_id"));--> statement-breakpoint
ALTER TABLE "dealpilot_sources" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "dealpilot_sources" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "dealpilot_sources_tenant_all" ON "dealpilot_sources"
  FOR ALL
  USING (app_private.same_organization("organization_id"))
  WITH CHECK (app_private.same_organization("organization_id"));--> statement-breakpoint
ALTER TABLE "dealpilot_theses" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "dealpilot_theses" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "dealpilot_theses_tenant_all" ON "dealpilot_theses"
  FOR ALL
  USING (app_private.same_organization("organization_id"))
  WITH CHECK (app_private.same_organization("organization_id"));--> statement-breakpoint
ALTER TABLE "dealpilot_relations" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "dealpilot_relations" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "dealpilot_relations_tenant_all" ON "dealpilot_relations"
  FOR ALL
  USING (app_private.same_organization("organization_id"))
  WITH CHECK (app_private.same_organization("organization_id"));