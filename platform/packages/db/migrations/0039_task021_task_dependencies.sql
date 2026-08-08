-- ADR-204 — Task dependency Relations.
--
-- The Task Manager plan has specified `depends_on`/`blocked_by` Relations
-- since TM0 and the schema never had them. Every slice since ADR-196 recorded
-- the same residual in the same words, and `proposeQueueSequence` said so in
-- its own doc comment: it honoured the `blocked` STATUS instead, which records
-- that someone believed a Task was blocked but not by WHAT — so nothing could
-- ever tell them it had stopped being true.
--
-- ONE edge kind, not two. `blocked_by` is the same edge read from the other
-- end; storing both directions would let them disagree, and a queue whose two
-- halves disagree about what blocks what is worse than one that models no
-- dependencies at all.
--
-- Reversible: a purely additive table with no backfill and no change to
-- `tasks`, so `DROP TABLE "task_dependencies"` restores the prior schema
-- exactly. Nothing reads it until a dependency is deliberately created.

CREATE TABLE "task_dependencies" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"task_id" uuid NOT NULL,
	"depends_on_task_id" uuid NOT NULL,
	"reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "task_dependencies_org_task_blocker_uq" UNIQUE("organization_id","task_id","depends_on_task_id")
);
--> statement-breakpoint
ALTER TABLE "task_dependencies" ADD CONSTRAINT "task_dependencies_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "task_dependencies_task_idx" ON "task_dependencies" USING btree ("organization_id","task_id");--> statement-breakpoint
CREATE INDEX "task_dependencies_blocker_idx" ON "task_dependencies" USING btree ("organization_id","depends_on_task_id");
--> statement-breakpoint
-- Beyond what drizzle-kit generates from the TypeScript schema:
--
-- 1. Composite FKs on (organization_id, id). An edge can never point at a Task
--    in another tenant — the same guarantee `tasks.parent_task_id` relies on,
--    and one a plain single-column FK cannot make. The cascade is deliberate:
--    a deleted Task's edges are meaningless, and leaving them would strand
--    dependents on a row nobody can act on.
ALTER TABLE "task_dependencies" ADD CONSTRAINT "task_dependencies_task_fk" FOREIGN KEY ("organization_id","task_id") REFERENCES "public"."tasks"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_dependencies" ADD CONSTRAINT "task_dependencies_blocker_fk" FOREIGN KEY ("organization_id","depends_on_task_id") REFERENCES "public"."tasks"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
-- 2. A Task waiting on itself can never be satisfied. The transitive case
--    needs a graph walk and is enforced in the store (`assertNoDependencyCycle`),
--    but the one-hop case is cheap to make structurally impossible.
ALTER TABLE "task_dependencies" ADD CONSTRAINT "task_dependencies_no_self_edge" CHECK ("task_id" <> "depends_on_task_id");--> statement-breakpoint
-- 3. RLS, same tenant predicate every other Module-owned table uses.
ALTER TABLE "task_dependencies" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "task_dependencies" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "task_dependencies_tenant_all" ON "task_dependencies"
  FOR ALL
  USING (app_private.same_organization("organization_id"))
  WITH CHECK (app_private.same_organization("organization_id"));
