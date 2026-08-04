CREATE TABLE "eval_comparisons" (
	"id" text NOT NULL,
	"organization_id" uuid NOT NULL,
	"baseline" jsonb NOT NULL,
	"candidate" jsonb NOT NULL,
	"deltas" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"verdict" text NOT NULL,
	"significance" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "eval_comparisons_pk" PRIMARY KEY("organization_id","id")
);
--> statement-breakpoint
CREATE TABLE "eval_datasets" (
	"id" text NOT NULL,
	"organization_id" uuid NOT NULL,
	"capability_type" text NOT NULL,
	"version" text NOT NULL,
	"cases" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "eval_datasets_pk" PRIMARY KEY("organization_id","id")
);
--> statement-breakpoint
CREATE TABLE "eval_runs" (
	"id" text NOT NULL,
	"organization_id" uuid NOT NULL,
	"capability_id" text NOT NULL,
	"capability_version" text NOT NULL,
	"dataset_id" text NOT NULL,
	"per_case" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"aggregate" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"model_version" text,
	"started_at" text NOT NULL,
	"finished_at" text NOT NULL,
	CONSTRAINT "eval_runs_pk" PRIMARY KEY("organization_id","id")
);
--> statement-breakpoint
ALTER TABLE "eval_comparisons" ADD CONSTRAINT "eval_comparisons_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "eval_datasets" ADD CONSTRAINT "eval_datasets_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "eval_runs" ADD CONSTRAINT "eval_runs_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "eval_runs_capability_idx" ON "eval_runs" USING btree ("organization_id","capability_id","started_at");