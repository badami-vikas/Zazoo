ALTER TABLE "edges" ADD COLUMN "evidence_refs" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "edges" ADD COLUMN "confidence" numeric(5, 4) DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "edges" ADD COLUMN "observed_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "edges" ADD COLUMN "valid_from" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "edges" ADD COLUMN "valid_to" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "edges" ADD COLUMN "user_confirmed" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "edges" ADD COLUMN "visibility" text DEFAULT 'private' NOT NULL;--> statement-breakpoint
ALTER TABLE "edges" ADD COLUMN "source" text DEFAULT 'user' NOT NULL;--> statement-breakpoint
ALTER TABLE "edges" ADD COLUMN "source_module" text DEFAULT 'legacy' NOT NULL;--> statement-breakpoint
ALTER TABLE "edges" ADD COLUMN "owner_user_id" uuid;--> statement-breakpoint
ALTER TABLE "node_types" ADD COLUMN "owning_module" text;--> statement-breakpoint
INSERT INTO "node_types" ("type", "plane", "owning_module")
VALUES ('event', 'operational', 'relationship')
ON CONFLICT ("type") DO UPDATE SET "owning_module" = EXCLUDED."owning_module";--> statement-breakpoint
UPDATE "node_types"
SET "owning_module" = 'relationship'
WHERE "type" IN ('person', 'community', 'signal', 'event');--> statement-breakpoint
ALTER TABLE "edges" ADD CONSTRAINT "edges_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "edges_semantic_uq" ON "edges" USING btree ("workspace_id","src_type","src_id","dst_type","dst_id","edge_type","owner_user_id");--> statement-breakpoint
ALTER TABLE "edges" ADD CONSTRAINT "edges_confidence_check" CHECK ("edges"."confidence" >= 0 AND "edges"."confidence" <= 1);--> statement-breakpoint
ALTER TABLE "edges" ADD CONSTRAINT "edges_evidence_refs_array_check" CHECK (jsonb_typeof("edges"."evidence_refs") = 'array');--> statement-breakpoint
ALTER TABLE "edges" ADD CONSTRAINT "edges_valid_range_check" CHECK ("edges"."valid_to" IS NULL OR "edges"."valid_from" IS NULL OR "edges"."valid_to" >= "edges"."valid_from");--> statement-breakpoint
ALTER TABLE "edges" ADD CONSTRAINT "edges_visibility_check" CHECK ("edges"."visibility" IN ('private', 'workspace', 'public'));--> statement-breakpoint
ALTER TABLE "edges" ADD CONSTRAINT "edges_source_module_check" CHECK (length(trim("edges"."source_module")) > 0);