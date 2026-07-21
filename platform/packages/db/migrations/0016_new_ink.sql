-- TASK-010 review round-4/9 + round-6: backfill legacy green/yellow/red
-- values BEFORE the CHECK constraint below so any pre-existing row (written
-- before TASK-010's original green/yellow/red -> pursue/review/pass rename)
-- does not fail the migration. Exact SQL as planned in
-- outputs/2026-07-17-task010-review-remediation.md item 9.
UPDATE "jobpilot_applications" SET "flag" = 'pursue' WHERE "flag" = 'green';--> statement-breakpoint
UPDATE "jobpilot_applications" SET "flag" = 'review' WHERE "flag" = 'yellow';--> statement-breakpoint
UPDATE "jobpilot_applications" SET "flag" = 'pass' WHERE "flag" = 'red';--> statement-breakpoint
ALTER TABLE "memories" ADD COLUMN "lineage_revision" bigint;--> statement-breakpoint
ALTER TABLE "jobpilot_applications" ADD CONSTRAINT "jobpilot_applications_flag_valid_ck" CHECK ("jobpilot_applications"."flag" IS NULL OR "jobpilot_applications"."flag" IN ('pursue', 'review', 'pass'));--> statement-breakpoint

-- TASK-010 review round-5/6 — owner-aware RLS for private red-flag
-- correction/preference-adjustment Memories and proposals (docs/BUGS.md
-- 2026-07-17 "loadLedger direct Supabase read" + the broader "owner-aware
-- ledger/memories RLS" ask). Mirrors the EXACT existing pattern
-- `app_private.visible_relationship_row` already established for
-- communities/people (migration 0008) and `edges` (migration 0015) — a new
-- Postgres role never gets its own bespoke authorization model, it reuses
-- the same current_workspace_id()/current_user_id() session-GUC mechanism
-- every other visibility-narrowed table already trusts.

-- Mirrors @bridge/db's DrizzleMemoryStore OPEN_SCOPES=[public,workspace] /
-- OWNER_SCOPES=[team,private,restricted] app-side visibility exactly — a
-- Memory's `scope` column is the ONLY input; `public`/`workspace` stay
-- workspace-visible, `team`/`private`/`restricted` narrow to their owner.
CREATE OR REPLACE FUNCTION app_private.visible_memory_row(row_workspace_id uuid, row_scope text, row_owner_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
AS $$
  SELECT app_private.same_workspace(row_workspace_id)
    AND CASE row_scope
      WHEN 'public' THEN true
      WHEN 'workspace' THEN true
      WHEN 'team' THEN row_owner_user_id = app_private.current_user_id()
      WHEN 'private' THEN row_owner_user_id = app_private.current_user_id()
      WHEN 'restricted' THEN row_owner_user_id = app_private.current_user_id()
      ELSE false
    END;
$$;
--> statement-breakpoint

DROP POLICY IF EXISTS "memories_tenant_select" ON "memories";--> statement-breakpoint
DROP POLICY IF EXISTS "memories_tenant_update" ON "memories";--> statement-breakpoint
DROP POLICY IF EXISTS "memories_tenant_delete" ON "memories";--> statement-breakpoint
CREATE POLICY "memories_tenant_select" ON "memories" FOR SELECT USING (app_private.visible_memory_row("workspace_id", "scope", "owner_user_id"));--> statement-breakpoint
CREATE POLICY "memories_tenant_update" ON "memories" FOR UPDATE USING (app_private.visible_memory_row("workspace_id", "scope", "owner_user_id")) WITH CHECK (app_private.same_workspace("workspace_id"));--> statement-breakpoint
CREATE POLICY "memories_tenant_delete" ON "memories" FOR DELETE USING (app_private.visible_memory_row("workspace_id", "scope", "owner_user_id"));--> statement-breakpoint
-- INSERT stays same_workspace-only (unchanged) — a NEW row's own scope/owner
-- is set by the inserting caller, exactly like `edges`'/`ledger`'s existing
-- convention; the API server's trusted connection remains the only writer
-- in practice (see the REVOKE below for anon/authenticated).
--
-- `DrizzleMemoryStore` (packages/db/src/memory-store.ts) now sets BOTH
-- app.workspace_id AND app.user_id on every method (write/supersede/get/
-- retrieve/forget/currentForLineage/casSupersede), derived from parameters
-- already available at each call site (MemoryAuthScope.userId for reads,
-- MemoryWrite.ownerUserId for writes) — required for this widened policy
-- to resolve `current_user_id()` correctly, INCLUDING for the API server's
-- own writes' `INSERT ... RETURNING` (an inserted row must also pass the
-- SELECT policy to see itself back). Verified via the full existing
-- memory-store test suite (no regression) plus the new migration-0016
-- tests.
--
-- `ledger`'s OWN SELECT policy is DELIBERATELY left at migration 0008's
-- original `same_workspace`-only (not narrowed the same way): `LedgerStore`
-- ports `get(id)`/`decisionFor(proposalId)` take no caller-identity
-- parameter at all (unlike `memories`' `authScope`-carrying methods), and
-- `ledger` is read from dozens of unrelated call sites across the whole
-- app (DealPilot, Helpdesk, onboarding, package installs, relation
-- materialization, red-flag corrections, …) — safely threading a viewer
-- identity through every one of them is a real, broad `LedgerStore` port
-- signature change, not a surgical fix, and attempting a narrower version
-- surfaced a genuine regression during testing (a restricted-role
-- `DrizzleLedgerStore.append()`'s own `INSERT ... RETURNING` failed
-- because the just-inserted private row could not pass its OWN new SELECT
-- policy without `app.user_id` being set to its rightful owner — fixed for
-- `append()` specifically, by deriving the viewer from the entry's own
-- onBehalfOf/actor fields, but `get`/`decisionFor` have no equivalent
-- signal to derive from). This exactly matches TASK-008 RM4's OWN
-- considered precedent: migration 0015 added owner-aware SELECT/UPDATE/
-- DELETE policies for `edges` (which has a simple `visibility`/
-- `owner_user_id` column pair and a narrow, `RelationStore`-only caller
-- surface) but deliberately did NOT do the same for `ledger`, relying
-- instead on the REVOKE below as `ledger`'s sole RLS-adjacent hardening.
-- TASK-010's own private red-flag proposals remain protected at the QUERY
-- level instead (`packages/db/src/ledger-store.ts`'s
-- `privateProposalOwnerScope` / `packages/core/src/memory/stores.ts`'s
-- `isPrivateLedgerEntry`, both already widened and tested this round,
-- enforced by `action.listPending`/`action.listHistory` passing the
-- caller's REAL `ctx.identity.id` as an explicit query parameter — entirely
-- independent of RLS/session GUCs) — and by the REVOKE immediately below,
-- which blocks a direct anon/authenticated Supabase client from touching
-- `ledger` at all, regardless of any policy's content.

-- TASK-010 review round-6: extends migration 0015's OWN
-- `REVOKE ALL PRIVILEGES ON TABLE public.edges, public.ledger FROM anon,
-- authenticated` to ALSO cover `public.memories` — a direct Supabase client
-- (anon/authenticated role) now has NO grant at all on any of these three
-- tables, the same defense-in-depth RM4 already established for
-- edges/ledger. The `IF EXISTS` role-existence guard is copied verbatim
-- from 0015 so this remains a no-op (not an error) in pglite/local test
-- environments where the `anon`/`authenticated` roles never exist.
DO $$
DECLARE
  role_name text;
BEGIN
  FOREACH role_name IN ARRAY ARRAY['anon', 'authenticated']
  LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = role_name) THEN
      EXECUTE format(
        'REVOKE ALL PRIVILEGES ON TABLE public.memories FROM %I',
        role_name
      );
    END IF;
  END LOOP;
END
$$;