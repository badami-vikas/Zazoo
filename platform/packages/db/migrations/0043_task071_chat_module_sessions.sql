ALTER TABLE "chat_threads" ADD COLUMN "module_id" uuid;--> statement-breakpoint
ALTER TABLE "chat_threads" ADD COLUMN "last_opened_at" timestamp (3) with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
CREATE INDEX "chat_threads_owner_module_last_opened_idx" ON "chat_threads" USING btree ("organization_id","owner_user_id","module_id","last_opened_at");