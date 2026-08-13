CREATE TABLE "event_outreach_drafts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"event_id" uuid NOT NULL,
	"speaker_draft_id" uuid NOT NULL,
	"person_id" uuid NOT NULL,
	"note_text" text NOT NULL,
	"status" text DEFAULT 'drafted' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "event_outreach_drafts_speaker_uq" UNIQUE("speaker_draft_id")
);
--> statement-breakpoint
CREATE TABLE "event_speaker_drafts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"event_id" uuid NOT NULL,
	"run_id" text NOT NULL,
	"name" text NOT NULL,
	"affiliation" text,
	"talk_title" text,
	"open_alex_id" text,
	"orcid" text,
	"tier" text NOT NULL,
	"score" numeric(5, 4) DEFAULT 0 NOT NULL,
	"matched_person_id" uuid,
	"status" text DEFAULT 'pending' NOT NULL,
	"resolved_person_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"decided_at" timestamp with time zone,
	CONSTRAINT "event_speaker_drafts_run_name_uq" UNIQUE("event_id","run_id","name")
);
--> statement-breakpoint
ALTER TABLE "event_outreach_drafts" ADD CONSTRAINT "event_outreach_drafts_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_outreach_drafts" ADD CONSTRAINT "event_outreach_drafts_event_id_conference_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."conference_events"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_outreach_drafts" ADD CONSTRAINT "event_outreach_drafts_speaker_draft_id_event_speaker_drafts_id_fk" FOREIGN KEY ("speaker_draft_id") REFERENCES "public"."event_speaker_drafts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_speaker_drafts" ADD CONSTRAINT "event_speaker_drafts_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_speaker_drafts" ADD CONSTRAINT "event_speaker_drafts_event_id_conference_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."conference_events"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "event_outreach_drafts_event_idx" ON "event_outreach_drafts" USING btree ("event_id","status");--> statement-breakpoint
CREATE INDEX "event_speaker_drafts_event_idx" ON "event_speaker_drafts" USING btree ("event_id","status");