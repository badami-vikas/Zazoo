ALTER TABLE "edges" NO FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "ledger" NO FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "edges" ADD COLUMN "evidence_refs" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "edges" ADD COLUMN "confidence" numeric(5, 4) DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "edges" ADD COLUMN "observed_at" timestamp with time zone;--> statement-breakpoint
UPDATE "edges" SET "observed_at" = "created_at";--> statement-breakpoint
ALTER TABLE "edges" ALTER COLUMN "observed_at" SET DEFAULT now();--> statement-breakpoint
ALTER TABLE "edges" ALTER COLUMN "observed_at" SET NOT NULL;--> statement-breakpoint
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
WITH "ledger_watermark" AS (
  SELECT MAX(
    floor(EXTRACT(epoch FROM "created_at") * 1000)::bigint * 1024 + 1023
  ) AS "value"
  FROM "ledger"
)
SELECT setval(
  'ledger_append_sequence_seq',
  COALESCE("value", 1),
  "value" IS NOT NULL
)
FROM "ledger_watermark";--> statement-breakpoint
WITH "legacy_candidates" AS (
  SELECT
    "id",
    "workspace_id",
    COALESCE(
      NULLIF("inputs"->>'proposalId', ''),
      NULLIF("inputs"->>'proposal_id', '')
    ) AS "proposal_id",
    "created_at"
  FROM "ledger"
  WHERE "ref_ledger_id" IS NULL
    AND "user_decision" IS NOT NULL
    AND jsonb_typeof("inputs") = 'object'
),
"legacy_ranked" AS (
  SELECT
    "id",
    "workspace_id",
    lower("proposal_id")::uuid AS "proposal_id",
    row_number() OVER (
      PARTITION BY "workspace_id", lower("proposal_id")::uuid
      ORDER BY "created_at", "id"
    ) AS "decision_rank"
  FROM "legacy_candidates"
  WHERE "proposal_id" ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
),
"legacy_backfill" AS (
  SELECT "legacy_ranked"."id", "legacy_ranked"."proposal_id"
  FROM "legacy_ranked"
  JOIN "ledger" AS "proposal"
    ON "proposal"."id" = "legacy_ranked"."proposal_id"
   AND "proposal"."workspace_id" = "legacy_ranked"."workspace_id"
   AND "proposal"."user_decision" IS NULL
  WHERE "legacy_ranked"."decision_rank" = 1
    AND NOT EXISTS (
      SELECT 1
      FROM "ledger" AS "resolved"
      WHERE "resolved"."ref_ledger_id" = "legacy_ranked"."proposal_id"
        AND "resolved"."user_decision" IS NOT NULL
    )
)
UPDATE "ledger" AS "decision"
SET "ref_ledger_id" = "legacy_backfill"."proposal_id"
FROM "legacy_backfill"
WHERE "decision"."id" = "legacy_backfill"."id";--> statement-breakpoint
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
$$;