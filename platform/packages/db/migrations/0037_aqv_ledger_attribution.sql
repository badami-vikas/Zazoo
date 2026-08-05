-- A1-R1 / F2 — give the Agent Quality Vector real production episodes to score.
--
--   skill              the capability attribution key. `ActionRequest.skill` is
--                      mandatory on every request but was never persisted, so no
--                      ledger row could be attributed to the capability that
--                      produced it. For a Skill capability the Skill id and the
--                      Commons manifest id are the same string, so grouping by
--                      this column scores a real capability.
--
--   execution_snapshot what the pipeline observed while producing the row
--                      (terminal state, policy violation count, wall-clock
--                      bounds). The AQV reliability and safety axes read it.
--
-- Both NULLABLE on purpose. Rows appended before this migration genuinely have no
-- attribution and no snapshot; backfilling a guess would feed the capability
-- promotion gate fabricated evidence. LedgerAqvSource excludes NULL-skill rows.
ALTER TABLE "ledger" ADD COLUMN "skill" text;--> statement-breakpoint
ALTER TABLE "ledger" ADD COLUMN "execution_snapshot" jsonb;--> statement-breakpoint

-- AQV reads one capability's episodes over a time window. Without this the scorer
-- degenerates into a full scan of an append-only, high-write table.
CREATE INDEX IF NOT EXISTS "ledger_skill_created_idx"
  ON "ledger" ("organization_id", "skill", "created_at" DESC)
  WHERE "skill" IS NOT NULL;