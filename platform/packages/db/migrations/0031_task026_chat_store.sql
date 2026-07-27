CREATE TABLE "chat_threads" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"owner_user_id" uuid NOT NULL,
	"plane" text NOT NULL,
	"data_scope" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"title" text,
	"created_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "chat_threads_organization_owner_id_uq" UNIQUE("organization_id","owner_user_id","id"),
	CONSTRAINT "chat_threads_plane_check" CHECK ("chat_threads"."plane" IN ('local', 'cloud')),
	CONSTRAINT "chat_threads_data_scope_check" CHECK ("chat_threads"."data_scope" IN ('private', 'public')),
	CONSTRAINT "chat_threads_status_check" CHECK ("chat_threads"."status" IN ('active', 'archived')),
	CONSTRAINT "chat_threads_plane_scope_check" CHECK (("chat_threads"."plane" = 'local' AND "chat_threads"."data_scope" = 'private')
          OR ("chat_threads"."plane" = 'cloud' AND "chat_threads"."data_scope" = 'public')),
	CONSTRAINT "chat_threads_title_check" CHECK ("chat_threads"."title" IS NULL OR length(btrim("chat_threads"."title")) > 0),
	CONSTRAINT "chat_threads_updated_check" CHECK ("chat_threads"."updated_at" >= "chat_threads"."created_at")
);
--> statement-breakpoint
CREATE TABLE "chat_turn_refs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"owner_user_id" uuid NOT NULL,
	"thread_id" uuid NOT NULL,
	"turn_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"ref_id" text NOT NULL,
	"created_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "chat_turn_refs_turn_kind_ref_uq" UNIQUE("turn_id","kind","ref_id"),
	CONSTRAINT "chat_turn_refs_kind_check" CHECK ("chat_turn_refs"."kind" IN (
        'routing_decision',
        'model_receipt',
        'proposal',
        'agent_run',
        'automation_run',
        'result',
        'event',
        'file',
        'error'
      )),
	CONSTRAINT "chat_turn_refs_ref_id_check" CHECK (length(btrim("chat_turn_refs"."ref_id")) > 0)
);
--> statement-breakpoint
CREATE TABLE "chat_turns" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"owner_user_id" uuid NOT NULL,
	"thread_id" uuid NOT NULL,
	"sequence" bigint NOT NULL,
	"role" text NOT NULL,
	"actor_type" text NOT NULL,
	"actor_id" text,
	"content" text NOT NULL,
	"state" text NOT NULL,
	"client_request_id" text NOT NULL,
	"request_fingerprint" text NOT NULL,
	"taint_label" jsonb DEFAULT '{"version":1,"trust":"unknown","source":"unknown","sensitivity":"unknown","instructionRisk":"unknown","originChain":[{"source":"unknown","ref":"legacy-or-malformed","hash":"sha256:eb8bf0d80db323992f6b634aab492b1e6d9e96a8e87a511c2a0db75ab929452c","transform":"fail_closed"}],"originsTruncated":false,"provenanceHash":"sha256:185d587e26cad0f6d1e53466b52d19a13a36ddd3a7b8f6f979ac826acc0dca71"}'::jsonb NOT NULL,
	"error_code" text,
	"created_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "chat_turns_thread_sequence_uq" UNIQUE("thread_id","sequence"),
	CONSTRAINT "chat_turns_thread_client_request_uq" UNIQUE("thread_id","client_request_id"),
	CONSTRAINT "chat_turns_organization_owner_thread_id_uq" UNIQUE("organization_id","owner_user_id","thread_id","id"),
	CONSTRAINT "chat_turns_sequence_check" CHECK ("chat_turns"."sequence" > 0),
	CONSTRAINT "chat_turns_role_check" CHECK ("chat_turns"."role" IN ('system', 'user', 'assistant', 'skill')),
	CONSTRAINT "chat_turns_actor_type_check" CHECK ("chat_turns"."actor_type" IN ('human', 'agent', 'system', 'skill')),
	CONSTRAINT "chat_turns_state_check" CHECK ("chat_turns"."state" IN (
        'queued',
        'processing',
        'awaiting_consent',
        'awaiting_decision',
        'completed',
        'failed',
        'cancelled'
      )),
	CONSTRAINT "chat_turns_user_content_check" CHECK ("chat_turns"."role" <> 'user' OR length(btrim("chat_turns"."content")) > 0),
	CONSTRAINT "chat_turns_client_request_check" CHECK (length(btrim("chat_turns"."client_request_id")) > 0),
	CONSTRAINT "chat_turns_request_fingerprint_check" CHECK ("chat_turns"."request_fingerprint" ~ '^sha256:[0-9a-f]{64}$'),
	CONSTRAINT "chat_turns_error_code_check" CHECK ("chat_turns"."error_code" IS NULL OR length(btrim("chat_turns"."error_code")) > 0),
	CONSTRAINT "chat_turns_updated_check" CHECK ("chat_turns"."updated_at" >= "chat_turns"."created_at")
);
--> statement-breakpoint
ALTER TABLE "chat_threads" ADD CONSTRAINT "chat_threads_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_threads" ADD CONSTRAINT "chat_threads_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_turn_refs" ADD CONSTRAINT "chat_turn_refs_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_turn_refs" ADD CONSTRAINT "chat_turn_refs_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_turn_refs" ADD CONSTRAINT "chat_turn_refs_organization_owner_turn_fk" FOREIGN KEY ("organization_id","owner_user_id","thread_id","turn_id") REFERENCES "public"."chat_turns"("organization_id","owner_user_id","thread_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_turns" ADD CONSTRAINT "chat_turns_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_turns" ADD CONSTRAINT "chat_turns_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chat_turns" ADD CONSTRAINT "chat_turns_organization_owner_thread_fk" FOREIGN KEY ("organization_id","owner_user_id","thread_id") REFERENCES "public"."chat_threads"("organization_id","owner_user_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "chat_threads_owner_updated_idx" ON "chat_threads" USING btree ("organization_id","owner_user_id","status","updated_at","id");--> statement-breakpoint
CREATE INDEX "chat_turn_refs_owner_turn_created_idx" ON "chat_turn_refs" USING btree ("organization_id","owner_user_id","thread_id","turn_id","created_at");--> statement-breakpoint
CREATE INDEX "chat_turns_owner_thread_sequence_idx" ON "chat_turns" USING btree ("organization_id","owner_user_id","thread_id","sequence");
--> statement-breakpoint

ALTER TABLE "chat_threads" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "chat_threads" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "chat_threads_owner_select"
  ON "chat_threads" FOR SELECT
  USING (
    app_private.same_organization("organization_id")
    AND "owner_user_id" = app_private.current_user_id()
  );
--> statement-breakpoint
CREATE POLICY "chat_threads_owner_insert"
  ON "chat_threads" FOR INSERT
  WITH CHECK (
    app_private.same_organization("organization_id")
    AND "owner_user_id" = app_private.current_user_id()
  );
--> statement-breakpoint
CREATE POLICY "chat_threads_owner_update"
  ON "chat_threads" FOR UPDATE
  USING (
    app_private.same_organization("organization_id")
    AND "owner_user_id" = app_private.current_user_id()
  )
  WITH CHECK (
    app_private.same_organization("organization_id")
    AND "owner_user_id" = app_private.current_user_id()
  );
--> statement-breakpoint
CREATE POLICY "chat_threads_owner_delete"
  ON "chat_threads" FOR DELETE
  USING (
    app_private.same_organization("organization_id")
    AND "owner_user_id" = app_private.current_user_id()
  );
--> statement-breakpoint

ALTER TABLE "chat_turns" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "chat_turns" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "chat_turns_owner_select"
  ON "chat_turns" FOR SELECT
  USING (
    app_private.same_organization("organization_id")
    AND "owner_user_id" = app_private.current_user_id()
  );
--> statement-breakpoint
CREATE POLICY "chat_turns_owner_insert"
  ON "chat_turns" FOR INSERT
  WITH CHECK (
    app_private.same_organization("organization_id")
    AND "owner_user_id" = app_private.current_user_id()
  );
--> statement-breakpoint
CREATE POLICY "chat_turns_owner_update"
  ON "chat_turns" FOR UPDATE
  USING (
    app_private.same_organization("organization_id")
    AND "owner_user_id" = app_private.current_user_id()
  )
  WITH CHECK (
    app_private.same_organization("organization_id")
    AND "owner_user_id" = app_private.current_user_id()
  );
--> statement-breakpoint
CREATE POLICY "chat_turns_owner_delete"
  ON "chat_turns" FOR DELETE
  USING (
    app_private.same_organization("organization_id")
    AND "owner_user_id" = app_private.current_user_id()
  );
--> statement-breakpoint

ALTER TABLE "chat_turn_refs" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "chat_turn_refs" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "chat_turn_refs_owner_select"
  ON "chat_turn_refs" FOR SELECT
  USING (
    app_private.same_organization("organization_id")
    AND "owner_user_id" = app_private.current_user_id()
  );
--> statement-breakpoint
CREATE POLICY "chat_turn_refs_owner_insert"
  ON "chat_turn_refs" FOR INSERT
  WITH CHECK (
    app_private.same_organization("organization_id")
    AND "owner_user_id" = app_private.current_user_id()
  );
--> statement-breakpoint
CREATE POLICY "chat_turn_refs_owner_delete"
  ON "chat_turn_refs" FOR DELETE
  USING (
    app_private.same_organization("organization_id")
    AND "owner_user_id" = app_private.current_user_id()
  );
--> statement-breakpoint

CREATE OR REPLACE FUNCTION app_private.enforce_chat_turn_update()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF (
    NEW.id,
    NEW.organization_id,
    NEW.owner_user_id,
    NEW.thread_id,
    NEW.sequence,
    NEW.role,
    NEW.actor_type,
    NEW.actor_id,
    NEW.client_request_id,
    NEW.request_fingerprint,
    NEW.taint_label,
    NEW.created_at
  ) IS DISTINCT FROM (
    OLD.id,
    OLD.organization_id,
    OLD.owner_user_id,
    OLD.thread_id,
    OLD.sequence,
    OLD.role,
    OLD.actor_type,
    OLD.actor_id,
    OLD.client_request_id,
    OLD.request_fingerprint,
    OLD.taint_label,
    OLD.created_at
  ) THEN
    RAISE EXCEPTION 'chat turn identity and provenance are immutable'
      USING ERRCODE = '23000';
  END IF;

  IF OLD.state IN ('completed', 'cancelled') THEN
    RAISE EXCEPTION 'terminal chat turn % is immutable', OLD.id
      USING ERRCODE = '23000';
  END IF;

  IF OLD.state <> NEW.state AND NOT (
    (OLD.state = 'queued' AND NEW.state IN ('processing', 'completed', 'failed', 'cancelled'))
    OR (
      OLD.state = 'processing'
      AND NEW.state IN ('awaiting_consent', 'awaiting_decision', 'completed', 'failed', 'cancelled')
    )
    OR (
      OLD.state = 'awaiting_consent'
      AND NEW.state IN ('processing', 'failed', 'cancelled')
    )
    OR (
      OLD.state = 'awaiting_decision'
      AND NEW.state IN ('processing', 'completed', 'failed', 'cancelled')
    )
    OR (OLD.state = 'failed' AND NEW.state = 'processing')
  ) THEN
    RAISE EXCEPTION 'invalid chat turn transition % -> %', OLD.state, NEW.state
      USING ERRCODE = '23000';
  END IF;

  IF NEW.updated_at < OLD.updated_at THEN
    RAISE EXCEPTION 'chat turn updated_at cannot move backwards'
      USING ERRCODE = '23000';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint

CREATE TRIGGER "chat_turns_enforce_update"
BEFORE UPDATE ON "chat_turns"
FOR EACH ROW
EXECUTE FUNCTION app_private.enforce_chat_turn_update();
--> statement-breakpoint

REVOKE UPDATE, DELETE ON TABLE "chat_turns" FROM bridge_app;
--> statement-breakpoint
GRANT UPDATE ("state", "content", "error_code", "updated_at")
ON TABLE "chat_turns" TO bridge_app;
--> statement-breakpoint
REVOKE UPDATE, DELETE ON TABLE "chat_turn_refs" FROM bridge_app;