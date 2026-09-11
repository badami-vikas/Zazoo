-- Infra tables for a multi-instance API (Render zero-downtime deploys run old+new
-- briefly): a lease ROW per scheduled job (the pooler runs in transaction mode with
-- prepare:false, so session advisory locks are unusable) and a shared rate-limit
-- counter. Neither is tenant data — no organization column, RLS stays off exactly
-- like the canonical/infra tables in 0026. bridge_app reaches both through the
-- 0022 default privileges.
CREATE TABLE "job_leases" (
	"name" text PRIMARY KEY NOT NULL,
	"holder" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE UNLOGGED TABLE "rate_limit_buckets" (
	"key" text PRIMARY KEY NOT NULL,
	"count" integer NOT NULL,
	"reset_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "job_leases" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "rate_limit_buckets" DISABLE ROW LEVEL SECURITY;
