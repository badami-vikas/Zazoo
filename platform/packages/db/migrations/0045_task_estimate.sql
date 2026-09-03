-- Coarse effort estimate on a Task.
--
-- TEXT, not numeric. The unit is part of the judgement a human wrote ("2d",
-- "0.5d"), and normalizing it to a number at write time throws away the only
-- signal that says how coarse the estimate is. NULL means nobody has estimated
-- this Task — distinct from an estimate of zero, which nothing in the ledger
-- ever asserts (AP-247: "unknown" is first-class, never fabricate a figure).
--
-- Reversible: one additive nullable column, no backfill and no change to any
-- existing value, so `ALTER TABLE "tasks" DROP COLUMN "estimate"` restores the
-- prior schema exactly.

ALTER TABLE "tasks" ADD COLUMN "estimate" text;
