ALTER TABLE "dealpilot_deals" ADD COLUMN "rag" text;--> statement-breakpoint
ALTER TABLE "dealpilot_deals" ADD COLUMN "fit_score" integer;--> statement-breakpoint
ALTER TABLE "dealpilot_deals" ADD COLUMN "evidence_score" integer;--> statement-breakpoint
ALTER TABLE "dealpilot_deals" ADD COLUMN "p0_flags" integer;--> statement-breakpoint
ALTER TABLE "dealpilot_deals" ADD COLUMN "thesis_tag" text;--> statement-breakpoint
ALTER TABLE "dealpilot_deals" ADD COLUMN "source_channel" text;