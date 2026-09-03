ALTER TABLE "chat_threads" ADD COLUMN "module_name" text;--> statement-breakpoint
ALTER TABLE "chat_threads" ADD COLUMN "attached_modules" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
CREATE INDEX "chat_threads_module_live_idx" ON "chat_threads" USING btree ("organization_id","owner_user_id","module_name","status","updated_at");--> statement-breakpoint
ALTER TABLE "chat_threads" ADD CONSTRAINT "chat_threads_module_name_check" CHECK ("chat_threads"."module_name" IS NULL OR length(btrim("chat_threads"."module_name")) > 0);--> statement-breakpoint
ALTER TABLE "chat_threads" ADD CONSTRAINT "chat_threads_attached_modules_check" CHECK (jsonb_typeof("chat_threads"."attached_modules") = 'array');