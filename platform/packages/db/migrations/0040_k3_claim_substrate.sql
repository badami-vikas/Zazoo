CREATE TABLE "claim_entities" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"owner_user_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"name" text NOT NULL,
	"ref_record_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "claims" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"owner_user_id" uuid NOT NULL,
	"entity_id" uuid NOT NULL,
	"field" text NOT NULL,
	"value" text NOT NULL,
	"claim_class" text NOT NULL,
	"sensitivity" text NOT NULL,
	"evidence" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"taint_label" jsonb,
	"valid_from" timestamp with time zone NOT NULL,
	"valid_to" timestamp with time zone,
	"recorded_at" timestamp with time zone DEFAULT now() NOT NULL,
	"invalidated_at" timestamp with time zone,
	"superseded_by" uuid,
	"decision_ref" uuid NOT NULL,
	"created_by" text NOT NULL,
	"archived_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "claim_entities" ADD CONSTRAINT "claim_entities_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "claims" ADD CONSTRAINT "claims_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "claims" ADD CONSTRAINT "claims_entity_id_claim_entities_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."claim_entities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "claims" ADD CONSTRAINT "claims_superseded_by_fk" FOREIGN KEY ("superseded_by") REFERENCES "public"."claims"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "claim_entities_owner_kind_name_uq" ON "claim_entities" USING btree ("organization_id","owner_user_id","kind","name");--> statement-breakpoint
CREATE INDEX "claim_entities_owner_idx" ON "claim_entities" USING btree ("organization_id","owner_user_id");--> statement-breakpoint
CREATE INDEX "claims_entity_field_idx" ON "claims" USING btree ("organization_id","owner_user_id","entity_id","field");--> statement-breakpoint
CREATE INDEX "claims_owner_live_idx" ON "claims" USING btree ("organization_id","owner_user_id");