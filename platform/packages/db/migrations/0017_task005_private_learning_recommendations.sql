-- Existing Learning Agent recommendations predate ledger.data_scope. They were
-- always user-private, so preserve that authority boundary during upgrade.
UPDATE "ledger"
SET "data_scope" = 'private'
WHERE "data_scope" IS NULL
  AND "resource_type" = 'signal'
  AND "inputs"->>'kind' = 'learning_recommendation';
--> statement-breakpoint
-- Resolution and blocked-attempt rows reference the private proposal. Carry its
-- owner and scope forward so history projection cannot expose linked metadata.
UPDATE "ledger" AS "child"
SET
  "data_scope" = 'private',
  "on_behalf_of_type" = CASE
    WHEN "proposal"."on_behalf_of_type" = 'user' THEN 'user'
    WHEN "proposal"."actor_type" = 'user' THEN 'user'
    ELSE "child"."on_behalf_of_type"
  END,
  "on_behalf_of_id" = CASE
    WHEN "proposal"."on_behalf_of_type" = 'user' THEN "proposal"."on_behalf_of_id"
    WHEN "proposal"."actor_type" = 'user' THEN "proposal"."actor_id"
    ELSE "child"."on_behalf_of_id"
  END
FROM "ledger" AS "proposal"
WHERE "child"."ref_ledger_id" = "proposal"."id"
  AND "proposal"."resource_type" = 'signal'
  AND "proposal"."inputs"->>'kind' = 'learning_recommendation';
