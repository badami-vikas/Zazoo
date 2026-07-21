ALTER TABLE "task_change_proposals"
  ADD COLUMN "idempotency_key" text,
  ADD COLUMN "expires_at" timestamp with time zone,
  ADD COLUMN "result" jsonb,
  ADD COLUMN "applied_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "task_change_proposals"
  ADD CONSTRAINT "task_change_proposals_org_kind_idempotency_uq"
  UNIQUE ("organization_id", "kind", "idempotency_key");--> statement-breakpoint
ALTER TABLE "task_change_proposals"
  ADD CONSTRAINT "task_change_proposals_expiry_valid"
  CHECK ("expires_at" IS NULL OR "expires_at" > "created_at");--> statement-breakpoint
ALTER TABLE "module_installations"
  ADD COLUMN "commons_source" jsonb;--> statement-breakpoint
ALTER TABLE "module_installations"
  ADD CONSTRAINT "module_installations_commons_source_valid"
  CHECK (
    "commons_source" IS NULL OR (
      jsonb_typeof("commons_source") = 'object'
      AND ("commons_source"->>'contentHash') ~ '^sha256:[0-9a-f]{64}$'
      AND jsonb_typeof("commons_source"->'entry') = 'object'
    )
  );
