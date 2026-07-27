CREATE TABLE "chat_cloud_grants" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"owner_user_id" uuid NOT NULL,
	"thread_id" uuid NOT NULL,
	"context_digest" text NOT NULL,
	"provider_id" text NOT NULL,
	"model_tier" text NOT NULL,
	"expires_at" timestamp (3) with time zone NOT NULL,
	"consumed_at" timestamp (3) with time zone,
	"created_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "chat_cloud_grants_organization_owner_thread_id_uq" UNIQUE("organization_id","owner_user_id","thread_id","id"),
	CONSTRAINT "chat_cloud_grants_digest_check" CHECK ("chat_cloud_grants"."context_digest" ~ '^sha256:[0-9a-f]{64}$'),
	CONSTRAINT "chat_cloud_grants_provider_check" CHECK (length(btrim("chat_cloud_grants"."provider_id")) > 0),
	CONSTRAINT "chat_cloud_grants_tier_check" CHECK (length(btrim("chat_cloud_grants"."model_tier")) > 0),
	CONSTRAINT "chat_cloud_grants_expiry_check" CHECK ("chat_cloud_grants"."expires_at" > "chat_cloud_grants"."created_at"),
	CONSTRAINT "chat_cloud_grants_consumed_check" CHECK ("chat_cloud_grants"."consumed_at" IS NULL OR "chat_cloud_grants"."consumed_at" >= "chat_cloud_grants"."created_at")
);
--> statement-breakpoint
ALTER TABLE "chat_cloud_grants" ADD CONSTRAINT "chat_cloud_grants_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_cloud_grants" ADD CONSTRAINT "chat_cloud_grants_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_cloud_grants" ADD CONSTRAINT "chat_cloud_grants_organization_owner_thread_fk" FOREIGN KEY ("organization_id","owner_user_id","thread_id") REFERENCES "public"."chat_threads"("organization_id","owner_user_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "chat_cloud_grants_owner_thread_idx" ON "chat_cloud_grants" USING btree ("organization_id","owner_user_id","thread_id","created_at");
--> statement-breakpoint

ALTER TABLE "chat_cloud_grants" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "chat_cloud_grants" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "chat_cloud_grants_owner_select"
  ON "chat_cloud_grants" FOR SELECT
  USING (
    app_private.same_organization("organization_id")
    AND "owner_user_id" = app_private.current_user_id()
  );
--> statement-breakpoint
CREATE POLICY "chat_cloud_grants_owner_insert"
  ON "chat_cloud_grants" FOR INSERT
  WITH CHECK (
    app_private.same_organization("organization_id")
    AND "owner_user_id" = app_private.current_user_id()
  );
--> statement-breakpoint
CREATE POLICY "chat_cloud_grants_owner_update"
  ON "chat_cloud_grants" FOR UPDATE
  USING (
    app_private.same_organization("organization_id")
    AND "owner_user_id" = app_private.current_user_id()
  )
  WITH CHECK (
    app_private.same_organization("organization_id")
    AND "owner_user_id" = app_private.current_user_id()
  );
--> statement-breakpoint
CREATE OR REPLACE FUNCTION app_private.enforce_chat_cloud_grant_consumption()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.id IS DISTINCT FROM OLD.id
    OR NEW.organization_id IS DISTINCT FROM OLD.organization_id
    OR NEW.owner_user_id IS DISTINCT FROM OLD.owner_user_id
    OR NEW.thread_id IS DISTINCT FROM OLD.thread_id
    OR NEW.context_digest IS DISTINCT FROM OLD.context_digest
    OR NEW.provider_id IS DISTINCT FROM OLD.provider_id
    OR NEW.model_tier IS DISTINCT FROM OLD.model_tier
    OR NEW.expires_at IS DISTINCT FROM OLD.expires_at
    OR NEW.created_at IS DISTINCT FROM OLD.created_at
  THEN
    RAISE EXCEPTION 'chat cloud grant binding fields are immutable'
      USING ERRCODE = '23514';
  END IF;
  IF OLD.consumed_at IS NOT NULL
    OR NEW.consumed_at IS NULL
    OR NEW.consumed_at < OLD.created_at
  THEN
    RAISE EXCEPTION 'chat cloud grants may only transition from unconsumed to consumed'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER "chat_cloud_grants_consume_only"
  BEFORE UPDATE ON "chat_cloud_grants"
  FOR EACH ROW
  EXECUTE FUNCTION app_private.enforce_chat_cloud_grant_consumption();
--> statement-breakpoint
REVOKE DELETE ON TABLE "chat_cloud_grants" FROM PUBLIC;
--> statement-breakpoint
REVOKE UPDATE, DELETE ON TABLE "chat_cloud_grants" FROM bridge_app;
--> statement-breakpoint
GRANT UPDATE ("consumed_at") ON TABLE "chat_cloud_grants" TO bridge_app;