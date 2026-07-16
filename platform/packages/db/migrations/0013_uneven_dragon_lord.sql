ALTER TABLE "agents" ALTER COLUMN "allowed_skills" SET DATA TYPE text[] USING "allowed_skills"::text[];--> statement-breakpoint
ALTER TABLE "agents" ALTER COLUMN "allowed_skills" SET DEFAULT '{}';--> statement-breakpoint
ALTER TABLE "rituals" ADD COLUMN "agent_id" uuid;--> statement-breakpoint
ALTER TABLE "rituals" ADD COLUMN "agent_plane" text;--> statement-breakpoint
UPDATE "rituals"
SET "agent_id" = "rituals"."agent_ids"[1]
FROM "agents"
WHERE cardinality("rituals"."agent_ids") = 1
  AND "agents"."id" = "rituals"."agent_ids"[1];--> statement-breakpoint
ALTER TABLE "rituals" ADD CONSTRAINT "rituals_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE no action ON UPDATE no action;