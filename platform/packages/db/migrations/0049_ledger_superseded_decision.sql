-- ADR 2026-09-04 "Approvals belong to Tasks": a pending proposal the machine withdraws because a
-- newer identical one from the same Automation replaced it resolves with user_decision
-- 'superseded' (never executed, never a Human decision). The 0015 check predates that value, so
-- on a migrated Local Plane every sweep insert failed and the scheduler tick died with it
-- (BUGS 2026-09-05 "the approvals pile survived the fix"). Fresh test databases never saw this
-- because their stores were in-memory.
ALTER TABLE "ledger" DROP CONSTRAINT IF EXISTS "ledger_user_decision_check";--> statement-breakpoint
ALTER TABLE "ledger" ADD CONSTRAINT "ledger_user_decision_check" CHECK ("user_decision" IS NULL OR "user_decision" IN ('approve', 'veto', 'edit', 'auto', 'superseded'));
