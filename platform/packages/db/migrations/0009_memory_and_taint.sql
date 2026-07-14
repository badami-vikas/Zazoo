-- PI-1: provenance / taint tag on the append-only audit spine. Nullable +
-- additive; existing rows keep NULL (untagged = not ingested from a source).
ALTER TABLE "ledger" ADD COLUMN "trust_origin" text;
--> statement-breakpoint
-- MEM-1: the Memory table — a derived, classified layer of confirmed/superseded
-- learned facts ALONGSIDE timeline_entries (not a fork). Self-FK models a
-- correction superseding an earlier fact (append-only; prior row retained).
CREATE TABLE "memories" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "workspace_id" uuid NOT NULL REFERENCES "workspaces"("id"),
  "type" text NOT NULL,
  "subject_element_id" uuid,
  "scope" text NOT NULL,
  "content" text NOT NULL,
  "source_ref_type" text,
  "source_ref_id" uuid,
  "confidence" numeric NOT NULL,
  "supersedes_id" uuid REFERENCES "memories"("id"),
  "trust_origin" text NOT NULL,
  "plane" text NOT NULL,
  "created_by" text NOT NULL,
  "owner_user_id" uuid,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "memories_ws_subject_idx" ON "memories" ("workspace_id","subject_element_id");
--> statement-breakpoint
-- RLS: tenant isolation (defense-in-depth beneath the store-boundary authority
-- scoping). Mirrors timeline_entries' same_workspace policies from 0008; the
-- app_private.same_workspace() helper is created there.
ALTER TABLE "memories" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "memories" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "memories_tenant_select" ON "memories" FOR SELECT USING (app_private.same_workspace("workspace_id"));
--> statement-breakpoint
CREATE POLICY "memories_tenant_insert" ON "memories" FOR INSERT WITH CHECK (app_private.same_workspace("workspace_id"));
--> statement-breakpoint
CREATE POLICY "memories_tenant_update" ON "memories" FOR UPDATE USING (app_private.same_workspace("workspace_id")) WITH CHECK (app_private.same_workspace("workspace_id"));
--> statement-breakpoint
CREATE POLICY "memories_tenant_delete" ON "memories" FOR DELETE USING (app_private.same_workspace("workspace_id"));
