ALTER TABLE "ledger" ADD COLUMN "taint_label" jsonb;--> statement-breakpoint
ALTER TABLE "memories" ADD COLUMN "taint_label" jsonb;--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN "taint_label" jsonb;--> statement-breakpoint
ALTER TABLE "files" ADD COLUMN "taint_label" jsonb;--> statement-breakpoint
ALTER TABLE "automation_runs" ADD COLUMN "taint_label" jsonb;--> statement-breakpoint
ALTER TABLE "child_agent_runs" ADD COLUMN "taint_label" jsonb;--> statement-breakpoint

CREATE TEMP TABLE "task015_taint_labels" (
  "legacy" text PRIMARY KEY,
  "label" jsonb NOT NULL
) ON COMMIT DROP;--> statement-breakpoint

INSERT INTO "task015_taint_labels" ("legacy", "label") VALUES
('unknown', '{"version":1,"trust":"unknown","source":"unknown","sensitivity":"unknown","instructionRisk":"unknown","originChain":[{"source":"unknown","ref":"legacy-or-malformed","hash":"sha256:eb8bf0d80db323992f6b634aab492b1e6d9e96a8e87a511c2a0db75ab929452c","transform":"fail_closed"}],"originsTruncated":false,"provenanceHash":"sha256:185d587e26cad0f6d1e53466b52d19a13a36ddd3a7b8f6f979ac826acc0dca71"}'),
('operator', '{"version":1,"trust":"verified_system","source":"operator","sensitivity":"organization","instructionRisk":"none","originChain":[{"source":"operator","ref":"migration:0029:operator","hash":"sha256:d5fa414adfcea344c78f9dc848fe0eabe5b258e5a5f15ed29da8f5837307e052","transform":"legacy_v0_compatibility"}],"originsTruncated":false,"provenanceHash":"sha256:5c5597bc44862eb431aba2c4650e444ca3c94ae76f8cfc6fd9ee1ecb606cd2cd"}'),
('user_content', '{"version":1,"trust":"authenticated_human","source":"human","sensitivity":"organization","instructionRisk":"instruction_like","originChain":[{"source":"human","ref":"migration:0029:user_content","hash":"sha256:eccf877420a92c1b64eb3d3359d7b7be32ec8786c5c89a675c4963e5819db68b","transform":"legacy_v0_compatibility"}],"originsTruncated":false,"provenanceHash":"sha256:c3c603f638fff8f5c5190e064703f8d209c055454ce9dc04500f191d73168bb7"}'),
('untrusted_external', '{"version":1,"trust":"untrusted","source":"unknown","sensitivity":"unknown","instructionRisk":"unknown","originChain":[{"source":"unknown","ref":"migration:0029:untrusted_external","hash":"sha256:690da628a5e2de4a6b68915dfb635ab89a450ce0fd801495069798e93b8dc9b4","transform":"legacy_v0_compatibility"}],"originsTruncated":false,"provenanceHash":"sha256:9290eb5ec66fe35bf9d716ba7578e85286fc04cb550d13a3e1c88f82560db881"}');--> statement-breakpoint

UPDATE "ledger"
SET "taint_label" = COALESCE(
  (SELECT "label" FROM "task015_taint_labels" WHERE "legacy" = "ledger"."trust_origin"),
  (SELECT "label" FROM "task015_taint_labels" WHERE "legacy" = 'unknown')
);--> statement-breakpoint
UPDATE "memories"
SET "taint_label" = COALESCE(
  (SELECT "label" FROM "task015_taint_labels" WHERE "legacy" = "memories"."trust_origin"),
  (SELECT "label" FROM "task015_taint_labels" WHERE "legacy" = 'unknown')
);--> statement-breakpoint
UPDATE "events"
SET "taint_label" = COALESCE(
  (SELECT "label" FROM "task015_taint_labels" WHERE "legacy" = "events"."payload" ->> 'trustOrigin'),
  (SELECT "label" FROM "task015_taint_labels" WHERE "legacy" = 'unknown')
);--> statement-breakpoint
UPDATE "files"
SET "taint_label" = COALESCE(
  (SELECT "label" FROM "task015_taint_labels" WHERE "legacy" = "files"."metadata" ->> 'trustOrigin'),
  (SELECT "label" FROM "task015_taint_labels" WHERE "legacy" = 'unknown')
);--> statement-breakpoint
UPDATE "child_agent_runs"
SET "taint_label" = COALESCE(
  (SELECT "label" FROM "task015_taint_labels" WHERE "legacy" = "child_agent_runs"."taint"),
  (SELECT "label" FROM "task015_taint_labels" WHERE "legacy" = 'unknown')
);--> statement-breakpoint
UPDATE "automation_runs" AS "run"
SET "taint_label" = COALESCE(
  (
    SELECT "ledger"."taint_label"
    FROM "ledger"
    WHERE "ledger"."id" = "run"."ledger_id"
  ),
  (SELECT "label" FROM "task015_taint_labels" WHERE "legacy" = 'unknown')
);--> statement-breakpoint

ALTER TABLE "ledger" ALTER COLUMN "taint_label" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "memories" ALTER COLUMN "taint_label" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "events" ALTER COLUMN "taint_label" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "files" ALTER COLUMN "taint_label" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "automation_runs" ALTER COLUMN "taint_label" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "child_agent_runs" ALTER COLUMN "taint_label" SET NOT NULL;--> statement-breakpoint

ALTER TABLE "ledger" ALTER COLUMN "taint_label" SET DEFAULT '{"version":1,"trust":"unknown","source":"unknown","sensitivity":"unknown","instructionRisk":"unknown","originChain":[{"source":"unknown","ref":"legacy-or-malformed","hash":"sha256:eb8bf0d80db323992f6b634aab492b1e6d9e96a8e87a511c2a0db75ab929452c","transform":"fail_closed"}],"originsTruncated":false,"provenanceHash":"sha256:185d587e26cad0f6d1e53466b52d19a13a36ddd3a7b8f6f979ac826acc0dca71"}'::jsonb;--> statement-breakpoint
ALTER TABLE "memories" ALTER COLUMN "taint_label" SET DEFAULT '{"version":1,"trust":"unknown","source":"unknown","sensitivity":"unknown","instructionRisk":"unknown","originChain":[{"source":"unknown","ref":"legacy-or-malformed","hash":"sha256:eb8bf0d80db323992f6b634aab492b1e6d9e96a8e87a511c2a0db75ab929452c","transform":"fail_closed"}],"originsTruncated":false,"provenanceHash":"sha256:185d587e26cad0f6d1e53466b52d19a13a36ddd3a7b8f6f979ac826acc0dca71"}'::jsonb;--> statement-breakpoint
ALTER TABLE "events" ALTER COLUMN "taint_label" SET DEFAULT '{"version":1,"trust":"unknown","source":"unknown","sensitivity":"unknown","instructionRisk":"unknown","originChain":[{"source":"unknown","ref":"legacy-or-malformed","hash":"sha256:eb8bf0d80db323992f6b634aab492b1e6d9e96a8e87a511c2a0db75ab929452c","transform":"fail_closed"}],"originsTruncated":false,"provenanceHash":"sha256:185d587e26cad0f6d1e53466b52d19a13a36ddd3a7b8f6f979ac826acc0dca71"}'::jsonb;--> statement-breakpoint
ALTER TABLE "files" ALTER COLUMN "taint_label" SET DEFAULT '{"version":1,"trust":"unknown","source":"unknown","sensitivity":"unknown","instructionRisk":"unknown","originChain":[{"source":"unknown","ref":"legacy-or-malformed","hash":"sha256:eb8bf0d80db323992f6b634aab492b1e6d9e96a8e87a511c2a0db75ab929452c","transform":"fail_closed"}],"originsTruncated":false,"provenanceHash":"sha256:185d587e26cad0f6d1e53466b52d19a13a36ddd3a7b8f6f979ac826acc0dca71"}'::jsonb;--> statement-breakpoint
ALTER TABLE "automation_runs" ALTER COLUMN "taint_label" SET DEFAULT '{"version":1,"trust":"unknown","source":"unknown","sensitivity":"unknown","instructionRisk":"unknown","originChain":[{"source":"unknown","ref":"legacy-or-malformed","hash":"sha256:eb8bf0d80db323992f6b634aab492b1e6d9e96a8e87a511c2a0db75ab929452c","transform":"fail_closed"}],"originsTruncated":false,"provenanceHash":"sha256:185d587e26cad0f6d1e53466b52d19a13a36ddd3a7b8f6f979ac826acc0dca71"}'::jsonb;--> statement-breakpoint
ALTER TABLE "child_agent_runs" ALTER COLUMN "taint_label" SET DEFAULT '{"version":1,"trust":"unknown","source":"unknown","sensitivity":"unknown","instructionRisk":"unknown","originChain":[{"source":"unknown","ref":"legacy-or-malformed","hash":"sha256:eb8bf0d80db323992f6b634aab492b1e6d9e96a8e87a511c2a0db75ab929452c","transform":"fail_closed"}],"originsTruncated":false,"provenanceHash":"sha256:185d587e26cad0f6d1e53466b52d19a13a36ddd3a7b8f6f979ac826acc0dca71"}'::jsonb;--> statement-breakpoint

ALTER TABLE "ledger" ADD CONSTRAINT "ledger_taint_label_v1" CHECK (("taint_label" ->> 'version')::integer = 1);--> statement-breakpoint
ALTER TABLE "memories" ADD CONSTRAINT "memories_taint_label_v1" CHECK (("taint_label" ->> 'version')::integer = 1);--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_taint_label_v1" CHECK (("taint_label" ->> 'version')::integer = 1);--> statement-breakpoint
ALTER TABLE "files" ADD CONSTRAINT "files_taint_label_v1" CHECK (("taint_label" ->> 'version')::integer = 1);--> statement-breakpoint
ALTER TABLE "automation_runs" ADD CONSTRAINT "automation_runs_taint_label_v1" CHECK (("taint_label" ->> 'version')::integer = 1);--> statement-breakpoint
ALTER TABLE "child_agent_runs" ADD CONSTRAINT "child_agent_runs_taint_label_v1" CHECK (("taint_label" ->> 'version')::integer = 1);--> statement-breakpoint

CREATE TABLE "taint_sink_traces" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "organization_id" uuid NOT NULL REFERENCES "organizations"("id"),
  "ledger_id" uuid,
  "sink" text NOT NULL,
  "taint_label" jsonb NOT NULL,
  "source_chain" jsonb NOT NULL,
  "policy" text NOT NULL,
  "reason" text NOT NULL,
  "trace_hash" text NOT NULL,
  "plane" text NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "taint_sink_traces_hash_uq" UNIQUE ("organization_id", "ledger_id", "sink", "trace_hash"),
  CONSTRAINT "taint_sink_traces_policy_valid" CHECK ("policy" IN ('allow','require_human','block')),
  CONSTRAINT "taint_sink_traces_plane_valid" CHECK ("plane" IN ('local','cloud'))
);--> statement-breakpoint
CREATE INDEX "taint_sink_traces_ledger_idx" ON "taint_sink_traces" ("organization_id", "ledger_id");--> statement-breakpoint

CREATE TABLE "taint_declassifications" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "organization_id" uuid NOT NULL REFERENCES "organizations"("id"),
  "before_label" jsonb NOT NULL,
  "after_label" jsonb NOT NULL,
  "reason" text NOT NULL,
  "evidence_hash" text NOT NULL,
  "actor_type" text NOT NULL,
  "actor_id" text NOT NULL,
  "decision_ledger_id" uuid,
  "rule_id" text,
  "rule_version" text,
  "parent_trace_hash" text NOT NULL,
  "plane" text NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "taint_declassifications_actor_valid" CHECK (
    ("actor_type" = 'user' AND "decision_ledger_id" IS NOT NULL AND "rule_id" IS NULL AND "rule_version" IS NULL)
    OR
    ("actor_type" = 'validator' AND "decision_ledger_id" IS NULL AND "rule_id" IS NOT NULL AND "rule_version" IS NOT NULL)
  ),
  CONSTRAINT "taint_declassifications_plane_valid" CHECK ("plane" IN ('local','cloud'))
);--> statement-breakpoint
CREATE INDEX "taint_declassifications_org_created_idx" ON "taint_declassifications" ("organization_id", "created_at");--> statement-breakpoint

ALTER TABLE "taint_sink_traces" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "taint_sink_traces" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "taint_sink_traces_tenant_all" ON "taint_sink_traces"
  FOR ALL USING (app_private.same_organization("organization_id"))
  WITH CHECK (app_private.same_organization("organization_id"));--> statement-breakpoint
ALTER TABLE "taint_declassifications" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "taint_declassifications" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "taint_declassifications_tenant_all" ON "taint_declassifications"
  FOR ALL USING (app_private.same_organization("organization_id"))
  WITH CHECK (app_private.same_organization("organization_id"));
