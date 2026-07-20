UPDATE "ledger"
SET "proposed_output" =
  ("proposed_output" - 'artifactHashes')
  || jsonb_build_object('resultHashes', "proposed_output" -> 'artifactHashes')
WHERE jsonb_typeof("proposed_output") = 'object'
  AND "proposed_output" ? 'artifactHashes'
  AND NOT "proposed_output" ? 'resultHashes';
