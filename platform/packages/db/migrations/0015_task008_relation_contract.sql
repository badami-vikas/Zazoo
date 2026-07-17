ALTER TABLE "edges" NO FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "ledger" NO FORCE ROW LEVEL SECURITY;--> statement-breakpoint
WITH "ref_column_migration" AS (
  SELECT "migration".xmin::text::bigint AS "migration_txid"
  FROM "drizzle"."__drizzle_migrations" AS "migration"
  WHERE "migration"."created_at" = 1780342914819
  ORDER BY "migration"."id"
  LIMIT 1
),
"legacy_candidates" AS (
  SELECT
    "decision"."id",
    "decision"."workspace_id",
    COALESCE(
      NULLIF("decision"."inputs"->>'proposalId', ''),
      NULLIF("decision"."inputs"->>'proposal_id', '')
    ) AS "proposal_id",
    "decision"."actor_type",
    "decision"."actor_id",
    "decision"."on_behalf_of_type",
    "decision"."on_behalf_of_id",
    "decision"."delegation_id",
    "decision"."action",
    "decision"."resource_type",
    "decision"."resource_id",
    "decision".xmin::text::bigint AS "decision_txid",
    "ref_column_migration"."migration_txid"
  FROM "ledger" AS "decision"
  CROSS JOIN "ref_column_migration"
  WHERE "decision"."ref_ledger_id" IS NULL
    AND "decision"."user_decision" IN ('approve', 'veto', 'edit')
    -- Only physical rows committed before 0003 introduced authoritative references qualify.
    AND "decision".xmin::text::bigint < "ref_column_migration"."migration_txid"
    AND NOT COALESCE(("decision"."diff" ? 'rejected'), false)
    AND jsonb_typeof("decision"."inputs") = 'object'
    AND (
      SELECT count(*)
      FROM jsonb_object_keys("decision"."inputs")
    ) = 1
    AND (
      ("decision"."inputs" ? 'proposalId')
      <> ("decision"."inputs" ? 'proposal_id')
    )
    AND jsonb_typeof(
      COALESCE(
        "decision"."inputs"->'proposalId',
        "decision"."inputs"->'proposal_id'
      )
    ) = 'string'
),
"legacy_grouped" AS (
  SELECT
    "legacy_candidates".*,
    lower("proposal_id")::uuid AS "verified_proposal_id",
    count(*) OVER (
      PARTITION BY "workspace_id", lower("proposal_id")::uuid
    ) AS "candidate_count"
  FROM "legacy_candidates"
  WHERE "proposal_id" ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
),
"legacy_backfill" AS (
  SELECT "legacy_grouped"."id", "legacy_grouped"."verified_proposal_id"
  FROM "legacy_grouped"
  JOIN "ledger" AS "proposal"
    ON "proposal"."id" = "legacy_grouped"."verified_proposal_id"
   AND "proposal"."workspace_id" = "legacy_grouped"."workspace_id"
   AND "proposal"."user_decision" IS NULL
   AND "proposal"."ref_ledger_id" IS NULL
   AND "proposal".xmin::text::bigint < "legacy_grouped"."migration_txid"
   AND "proposal".xmin::text::bigint <= "legacy_grouped"."decision_txid"
   AND "proposal"."actor_type" = "legacy_grouped"."actor_type"
   AND "proposal"."actor_id" = "legacy_grouped"."actor_id"
   AND "proposal"."on_behalf_of_type" IS NOT DISTINCT FROM "legacy_grouped"."on_behalf_of_type"
   AND "proposal"."on_behalf_of_id" IS NOT DISTINCT FROM "legacy_grouped"."on_behalf_of_id"
   AND "proposal"."delegation_id" IS NOT DISTINCT FROM "legacy_grouped"."delegation_id"
   AND "proposal"."action" = "legacy_grouped"."action"
   AND "proposal"."resource_type" = "legacy_grouped"."resource_type"
   AND "proposal"."resource_id" IS NOT DISTINCT FROM "legacy_grouped"."resource_id"
   AND NOT COALESCE(("proposal"."diff" ? 'rejected'), false)
  WHERE "legacy_grouped"."candidate_count" = 1
    AND NOT EXISTS (
      SELECT 1
      FROM "ledger" AS "resolved"
      WHERE "resolved"."ref_ledger_id" = "legacy_grouped"."verified_proposal_id"
        AND "resolved"."workspace_id" = "legacy_grouped"."workspace_id"
        AND "resolved"."user_decision" IS NOT NULL
    )
)
UPDATE "ledger" AS "decision"
SET "ref_ledger_id" = "legacy_backfill"."verified_proposal_id"
FROM "legacy_backfill"
WHERE "decision"."id" = "legacy_backfill"."id";--> statement-breakpoint
ALTER TABLE "ledger" DROP CONSTRAINT IF EXISTS "ledger_user_decision_check";--> statement-breakpoint
ALTER TABLE "ledger" ADD CONSTRAINT "ledger_user_decision_check" CHECK ("user_decision" IS NULL OR "user_decision" IN ('approve', 'veto', 'edit', 'auto'));--> statement-breakpoint
ALTER TABLE "edges" ADD COLUMN "evidence_refs" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "edges" ADD COLUMN "confidence" numeric(5, 4) DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "edges" ADD COLUMN "observed_at" timestamp with time zone;--> statement-breakpoint
UPDATE "edges" SET "observed_at" = date_trunc('milliseconds', "created_at");--> statement-breakpoint
ALTER TABLE "edges" ALTER COLUMN "observed_at" SET DEFAULT now();--> statement-breakpoint
ALTER TABLE "edges" ALTER COLUMN "observed_at" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "edges" ALTER COLUMN "observed_at" TYPE timestamp(3) with time zone USING date_trunc('milliseconds', "observed_at");--> statement-breakpoint
ALTER TABLE "edges" ALTER COLUMN "created_at" TYPE timestamp(3) with time zone USING date_trunc('milliseconds', "created_at");--> statement-breakpoint
ALTER TABLE "edges" ADD COLUMN "valid_from" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "edges" ADD COLUMN "valid_to" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "edges" ADD COLUMN "user_confirmed" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "edges" ADD COLUMN "visibility" text DEFAULT 'private' NOT NULL;--> statement-breakpoint
ALTER TABLE "edges" ADD COLUMN "source" text DEFAULT 'user' NOT NULL;--> statement-breakpoint
ALTER TABLE "edges" ADD COLUMN "source_module" text DEFAULT 'legacy' NOT NULL;--> statement-breakpoint
ALTER TABLE "edges" ADD COLUMN "owner_user_id" uuid;--> statement-breakpoint
ALTER TABLE "edges" ADD COLUMN "decision_ledger_id" uuid;--> statement-breakpoint
ALTER TABLE "edges" ADD COLUMN "decision_sequence" bigint;--> statement-breakpoint
ALTER TABLE "edges" ADD COLUMN "decision_at" timestamp with time zone;--> statement-breakpoint
CREATE SEQUENCE "ledger_append_sequence_seq" AS bigint;--> statement-breakpoint
ALTER TABLE "ledger" ADD COLUMN "append_sequence" bigint;--> statement-breakpoint
ALTER SEQUENCE "ledger_append_sequence_seq" OWNED BY "ledger"."append_sequence";--> statement-breakpoint
ALTER TABLE "ledger" ALTER COLUMN "append_sequence" SET DEFAULT nextval('ledger_append_sequence_seq'::regclass);--> statement-breakpoint
WITH "ordered_legacy_ledger" AS (
  SELECT
    "id",
    row_number() OVER (ORDER BY "created_at", "id")::bigint AS "append_sequence"
  FROM "ledger"
)
UPDATE "ledger" AS "target"
SET "append_sequence" = "ordered_legacy_ledger"."append_sequence"
FROM "ordered_legacy_ledger"
WHERE "target"."id" = "ordered_legacy_ledger"."id";--> statement-breakpoint
WITH "ledger_watermark" AS (
  SELECT MAX("append_sequence") AS "value"
  FROM "ledger"
)
SELECT setval(
  'ledger_append_sequence_seq',
  COALESCE("value", 1),
  "value" IS NOT NULL
)
FROM "ledger_watermark";--> statement-breakpoint
ALTER TABLE "ledger" ALTER COLUMN "append_sequence" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "ledger" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "node_types" ADD COLUMN "owning_module" text;--> statement-breakpoint
INSERT INTO "node_types" ("type", "plane", "owning_module")
VALUES ('event', 'operational', 'relationship')
ON CONFLICT ("type") DO UPDATE SET "owning_module" = EXCLUDED."owning_module";--> statement-breakpoint
UPDATE "node_types"
SET "owning_module" = 'relationship'
WHERE "type" IN ('person', 'community', 'signal', 'event');--> statement-breakpoint
UPDATE "edges"
SET "visibility" = 'workspace'
WHERE "owner_user_id" IS NULL AND "source_module" = 'legacy';--> statement-breakpoint
ALTER TABLE "edges" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "edges" ADD CONSTRAINT "edges_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "edges_semantic_uq" ON "edges" USING btree ("workspace_id","src_type","src_id","dst_type","dst_id","edge_type","owner_user_id");--> statement-breakpoint
ALTER TABLE "edges" ADD CONSTRAINT "edges_confidence_check" CHECK ("edges"."confidence" >= 0 AND "edges"."confidence" <= 1);--> statement-breakpoint
ALTER TABLE "edges" ADD CONSTRAINT "edges_evidence_refs_array_check" CHECK (jsonb_typeof("edges"."evidence_refs") = 'array');--> statement-breakpoint
ALTER TABLE "edges" ADD CONSTRAINT "edges_valid_range_check" CHECK ("edges"."valid_to" IS NULL OR "edges"."valid_from" IS NULL OR "edges"."valid_to" >= "edges"."valid_from");--> statement-breakpoint
ALTER TABLE "edges" ADD CONSTRAINT "edges_visibility_check" CHECK ("edges"."visibility" IN ('private', 'workspace', 'public'));--> statement-breakpoint
ALTER TABLE "edges" ADD CONSTRAINT "edges_source_module_check" CHECK (length(trim("edges"."source_module")) > 0);--> statement-breakpoint
ALTER TABLE "edges" ADD CONSTRAINT "edges_decision_provenance_check" CHECK (("edges"."decision_ledger_id" IS NULL AND "edges"."decision_sequence" IS NULL AND "edges"."decision_at" IS NULL) OR ("edges"."decision_ledger_id" IS NOT NULL AND "edges"."decision_sequence" IS NOT NULL AND "edges"."decision_at" IS NOT NULL));--> statement-breakpoint
DROP POLICY IF EXISTS "edges_tenant_select" ON "edges";--> statement-breakpoint
DROP POLICY IF EXISTS "edges_tenant_insert" ON "edges";--> statement-breakpoint
DROP POLICY IF EXISTS "edges_tenant_update" ON "edges";--> statement-breakpoint
DROP POLICY IF EXISTS "edges_tenant_delete" ON "edges";--> statement-breakpoint
CREATE POLICY "edges_tenant_select" ON "edges" FOR SELECT USING (
  app_private.same_workspace("workspace_id")
  AND (
    "owner_user_id" = app_private.current_user_id()
    OR "visibility" IN ('workspace', 'public')
  )
);--> statement-breakpoint
CREATE POLICY "edges_tenant_insert" ON "edges" FOR INSERT WITH CHECK (
  app_private.same_workspace("workspace_id")
  AND "owner_user_id" = app_private.current_user_id()
);--> statement-breakpoint
CREATE POLICY "edges_tenant_update" ON "edges" FOR UPDATE USING (
  app_private.same_workspace("workspace_id")
  AND "owner_user_id" = app_private.current_user_id()
) WITH CHECK (
  app_private.same_workspace("workspace_id")
  AND "owner_user_id" = app_private.current_user_id()
);--> statement-breakpoint
CREATE POLICY "edges_tenant_delete" ON "edges" FOR DELETE USING (
  app_private.same_workspace("workspace_id")
  AND "owner_user_id" = app_private.current_user_id()
);--> statement-breakpoint
DO $$
DECLARE
  role_name text;
BEGIN
  FOREACH role_name IN ARRAY ARRAY['anon', 'authenticated']
  LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = role_name) THEN
      EXECUTE format(
        'REVOKE ALL PRIVILEGES ON TABLE public.edges, public.ledger FROM %I',
        role_name
      );
      EXECUTE format(
        'REVOKE ALL PRIVILEGES ON SEQUENCE public.ledger_append_sequence_seq FROM %I',
        role_name
      );
    END IF;
  END LOOP;
END
$$;--> statement-breakpoint
CREATE TABLE "relation_materialization_effects" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"owner_user_id" uuid NOT NULL,
	"proposal_ledger_id" uuid NOT NULL,
	"decision_ledger_id" uuid NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"attempt_count" integer DEFAULT 0 NOT NULL,
	"max_attempts" integer DEFAULT 5 NOT NULL,
	"lease_recovery_count" integer DEFAULT 0 NOT NULL,
	"max_lease_recoveries" integer DEFAULT 3 NOT NULL,
	"relation_count" integer,
	"last_attempted_at" timestamp with time zone,
	"next_retry_at" timestamp with time zone,
	"lease_token" uuid,
	"lease_expires_at" timestamp with time zone,
	"last_error" text,
	"applied_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "relation_materialization_effects_proposal_uq" UNIQUE("workspace_id","proposal_ledger_id"),
	CONSTRAINT "relation_materialization_effects_decision_uq" UNIQUE("workspace_id","decision_ledger_id"),
	CONSTRAINT "relation_materialization_effects_status_check" CHECK ("relation_materialization_effects"."status" IN ('pending', 'applied', 'failed')),
	CONSTRAINT "relation_materialization_effects_attempts_check" CHECK ("relation_materialization_effects"."attempt_count" >= 0 AND "relation_materialization_effects"."max_attempts" > 0 AND "relation_materialization_effects"."attempt_count" <= "relation_materialization_effects"."max_attempts" AND "relation_materialization_effects"."lease_recovery_count" >= 0 AND "relation_materialization_effects"."max_lease_recoveries" > 0 AND "relation_materialization_effects"."lease_recovery_count" <= "relation_materialization_effects"."max_lease_recoveries"),
	CONSTRAINT "relation_materialization_effects_relation_count_check" CHECK ("relation_materialization_effects"."relation_count" IS NULL OR "relation_materialization_effects"."relation_count" >= 0),
	CONSTRAINT "relation_materialization_effects_decision_check" CHECK ("relation_materialization_effects"."proposal_ledger_id" <> "relation_materialization_effects"."decision_ledger_id"),
	CONSTRAINT "relation_materialization_effects_state_check" CHECK (("relation_materialization_effects"."status" = 'pending' AND "relation_materialization_effects"."applied_at" IS NULL AND "relation_materialization_effects"."last_error" IS NULL AND (("relation_materialization_effects"."lease_token" IS NULL AND "relation_materialization_effects"."lease_expires_at" IS NULL) OR ("relation_materialization_effects"."lease_token" IS NOT NULL AND "relation_materialization_effects"."lease_expires_at" IS NOT NULL))) OR ("relation_materialization_effects"."status" = 'failed' AND "relation_materialization_effects"."applied_at" IS NULL AND "relation_materialization_effects"."last_error" IS NOT NULL AND "relation_materialization_effects"."lease_token" IS NULL AND "relation_materialization_effects"."lease_expires_at" IS NULL) OR ("relation_materialization_effects"."status" = 'applied' AND "relation_materialization_effects"."applied_at" IS NOT NULL AND "relation_materialization_effects"."last_error" IS NULL AND "relation_materialization_effects"."next_retry_at" IS NULL AND "relation_materialization_effects"."relation_count" IS NOT NULL AND "relation_materialization_effects"."lease_token" IS NULL AND "relation_materialization_effects"."lease_expires_at" IS NULL))
);--> statement-breakpoint
ALTER TABLE "relation_materialization_effects" ADD CONSTRAINT "relation_materialization_effects_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "relation_materialization_effects" ADD CONSTRAINT "relation_materialization_effects_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "relation_materialization_effects_retry_idx" ON "relation_materialization_effects" USING btree ("workspace_id","owner_user_id","status","next_retry_at","lease_expires_at");--> statement-breakpoint
CREATE INDEX "relation_materialization_effects_outstanding_idx" ON "relation_materialization_effects" USING btree ("workspace_id","owner_user_id","id") WHERE "status" IN ('pending', 'failed');--> statement-breakpoint
CREATE INDEX "edges_relation_page_idx" ON "edges" USING btree ("workspace_id","observed_at","created_at","id");--> statement-breakpoint
ALTER TABLE "relation_materialization_effects" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "relation_materialization_effects" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "relation_materialization_effects_tenant_select" ON "relation_materialization_effects"
  FOR SELECT USING (
    app_private.same_workspace("workspace_id")
    AND "owner_user_id" = app_private.current_user_id()
  );--> statement-breakpoint
CREATE POLICY "relation_materialization_effects_tenant_insert" ON "relation_materialization_effects"
  FOR INSERT WITH CHECK (
    app_private.same_workspace("workspace_id")
    AND "owner_user_id" = app_private.current_user_id()
  );--> statement-breakpoint
CREATE POLICY "relation_materialization_effects_tenant_update" ON "relation_materialization_effects"
  FOR UPDATE USING (
    app_private.same_workspace("workspace_id")
    AND "owner_user_id" = app_private.current_user_id()
  ) WITH CHECK (
    app_private.same_workspace("workspace_id")
    AND "owner_user_id" = app_private.current_user_id()
  );--> statement-breakpoint
DO $$
DECLARE
  role_name text;
BEGIN
  FOREACH role_name IN ARRAY ARRAY['anon', 'authenticated']
  LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = role_name) THEN
      EXECUTE format(
        'REVOKE ALL PRIVILEGES ON TABLE public.relation_materialization_effects FROM %I',
        role_name
      );
    END IF;
  END LOOP;
END
$$;