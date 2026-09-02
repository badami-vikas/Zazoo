ALTER TABLE "chat_threads" ADD COLUMN "backend" text DEFAULT 'bridge' NOT NULL;--> statement-breakpoint
ALTER TABLE "chat_threads" ADD COLUMN "backend_session_id" text;--> statement-breakpoint
ALTER TABLE "chat_threads" ADD CONSTRAINT "chat_threads_backend_check" CHECK ("chat_threads"."backend" IN ('bridge', 'claude_code'));--> statement-breakpoint
ALTER TABLE "chat_threads" ADD CONSTRAINT "chat_threads_backend_session_check" CHECK ("chat_threads"."backend_session_id" IS NULL OR ("chat_threads"."backend" <> 'bridge' AND length(btrim("chat_threads"."backend_session_id")) > 0));