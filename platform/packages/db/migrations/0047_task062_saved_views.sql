CREATE TABLE "view_configs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"owner_user_id" uuid NOT NULL,
	"database_id" text NOT NULL,
	"name" text NOT NULL,
	"scope" text DEFAULT 'personal' NOT NULL,
	"config" jsonb NOT NULL,
	"hidden_columns" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "view_configs_owner_name_uq" UNIQUE("organization_id","owner_user_id","database_id","name"),
	CONSTRAINT "view_configs_name_check" CHECK (length(btrim("view_configs"."name")) > 0),
	CONSTRAINT "view_configs_scope_check" CHECK ("view_configs"."scope" IN ('personal', 'organization')),
	CONSTRAINT "view_configs_database_check" CHECK (length(btrim("view_configs"."database_id")) > 0),
	CONSTRAINT "view_configs_config_check" CHECK (jsonb_typeof("view_configs"."config") = 'object'),
	CONSTRAINT "view_configs_hidden_columns_check" CHECK (jsonb_typeof("view_configs"."hidden_columns") = 'array')
);
--> statement-breakpoint
ALTER TABLE "view_configs" ADD CONSTRAINT "view_configs_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "view_configs" ADD CONSTRAINT "view_configs_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "view_configs_database_idx" ON "view_configs" USING btree ("organization_id","database_id","name");
--> statement-breakpoint

-- ============================================================================
-- Hand-written security tail (TASK-062) — drizzle-kit emits table shape only.
--
-- A saved View is owner-scoped like a Chat thread, with ONE widening the whole
-- task exists to enable: a View saved at `organization` scope is READABLE by
-- every member of that organization, and still writable only by the human who
-- saved it. Read and write are therefore different predicates here, which is
-- precisely the seam scoped share grants (TASK-064) extend — a shared View that
-- anyone could rewrite would not be a share, it would be a free-for-all.
-- ============================================================================

ALTER TABLE "view_configs" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "view_configs" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "view_configs_read"
  ON "view_configs" FOR SELECT
  USING (
    app_private.same_organization("organization_id")
    AND (
      "owner_user_id" = app_private.current_user_id()
      OR "scope" = 'organization'
    )
  );
--> statement-breakpoint
CREATE POLICY "view_configs_owner_insert"
  ON "view_configs" FOR INSERT
  WITH CHECK (
    app_private.same_organization("organization_id")
    AND "owner_user_id" = app_private.current_user_id()
  );
--> statement-breakpoint
CREATE POLICY "view_configs_owner_update"
  ON "view_configs" FOR UPDATE
  USING (
    app_private.same_organization("organization_id")
    AND "owner_user_id" = app_private.current_user_id()
  )
  WITH CHECK (
    app_private.same_organization("organization_id")
    AND "owner_user_id" = app_private.current_user_id()
  );
--> statement-breakpoint
-- Unlike Runs and turns, a saved View is configuration rather than evidence:
-- deleting one destroys no history, so DELETE exists — for its owner only.
CREATE POLICY "view_configs_owner_delete"
  ON "view_configs" FOR DELETE
  USING (
    app_private.same_organization("organization_id")
    AND "owner_user_id" = app_private.current_user_id()
  );
