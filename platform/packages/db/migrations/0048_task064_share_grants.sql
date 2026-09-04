CREATE TABLE "share_grants" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"target_kind" text DEFAULT 'view' NOT NULL,
	"target_id" uuid NOT NULL,
	"grantee_user_id" uuid,
	"access_token" text,
	"access_level" text DEFAULT 'view' NOT NULL,
	"expires_at" timestamp (3) with time zone,
	"revoked_at" timestamp (3) with time zone,
	"created_by_user_id" uuid NOT NULL,
	"created_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "share_grants_access_token_unique" UNIQUE("access_token"),
	CONSTRAINT "share_grants_target_kind_check" CHECK ("share_grants"."target_kind" IN ('view', 'form')),
	CONSTRAINT "share_grants_access_level_check" CHECK ("share_grants"."access_level" IN ('view', 'edit', 'coowner')),
	CONSTRAINT "share_grants_holder_check" CHECK (("share_grants"."grantee_user_id" IS NULL) <> ("share_grants"."access_token" IS NULL))
);
--> statement-breakpoint
ALTER TABLE "share_grants" ADD CONSTRAINT "share_grants_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "share_grants" ADD CONSTRAINT "share_grants_target_id_view_configs_id_fk" FOREIGN KEY ("target_id") REFERENCES "public"."view_configs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "share_grants" ADD CONSTRAINT "share_grants_grantee_user_id_users_id_fk" FOREIGN KEY ("grantee_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "share_grants" ADD CONSTRAINT "share_grants_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "share_grants_target_idx" ON "share_grants" USING btree ("organization_id","target_kind","target_id");--> statement-breakpoint
CREATE INDEX "share_grants_grantee_idx" ON "share_grants" USING btree ("organization_id","grantee_user_id");
--> statement-breakpoint
-- SECURITY TAIL (hand-written; the generator does not emit policies).
--
-- A share grant is the record of who may reach someone else's View, so it is
-- FORCE RLS like every other organization-scoped table: even the table owner
-- reads it through the policies.
ALTER TABLE "share_grants" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "share_grants" FORCE ROW LEVEL SECURITY;--> statement-breakpoint

-- READ is wider than WRITE, deliberately: the person who created the grant and
-- the member it names both need to see it — one to manage the share, the other
-- to know they have it. Everyone else in the Organization sees nothing.
CREATE POLICY "share_grants_read"
  ON "share_grants" FOR SELECT
  USING (
    app_private.same_organization("organization_id")
    AND (
      "created_by_user_id" = app_private.current_user_id()
      OR "grantee_user_id" = app_private.current_user_id()
    )
  );
--> statement-breakpoint

-- Only the person doing the sharing writes the row, and only as themselves —
-- a grant attributed to someone else is a forged share.
CREATE POLICY "share_grants_creator_insert"
  ON "share_grants" FOR INSERT
  WITH CHECK (
    app_private.same_organization("organization_id")
    AND "created_by_user_id" = app_private.current_user_id()
  );
--> statement-breakpoint

-- UPDATE exists for exactly one transition: revocation. There is no DELETE
-- policy, because a grant that vanished cannot be audited — "who could see this
-- last week" is the question a share ledger exists to answer.
CREATE POLICY "share_grants_creator_revoke"
  ON "share_grants" FOR UPDATE
  USING (
    app_private.same_organization("organization_id")
    AND "created_by_user_id" = app_private.current_user_id()
  )
  WITH CHECK (
    app_private.same_organization("organization_id")
    AND "created_by_user_id" = app_private.current_user_id()
  );
--> statement-breakpoint

-- A shared View has to be READABLE by the person it was shared with, or the
-- grant is a row that grants nothing. `view_configs_read` (migration 0047) let
-- a member read their own Views and the `organization`-scoped ones; it now also
-- admits a row that a LIVE grant names them on. Expiry and revocation are part
-- of the predicate, so access ends at the database rather than at whichever
-- caller remembers to check.
DROP POLICY "view_configs_read" ON "view_configs";--> statement-breakpoint
CREATE POLICY "view_configs_read"
  ON "view_configs" FOR SELECT
  USING (
    app_private.same_organization("organization_id")
    AND (
      "owner_user_id" = app_private.current_user_id()
      OR "scope" = 'organization'
      OR EXISTS (
        SELECT 1
        FROM "share_grants" g
        WHERE g."target_id" = "view_configs"."id"
          AND g."grantee_user_id" = app_private.current_user_id()
          AND g."revoked_at" IS NULL
          AND (g."expires_at" IS NULL OR g."expires_at" > now())
      )
    )
  );
