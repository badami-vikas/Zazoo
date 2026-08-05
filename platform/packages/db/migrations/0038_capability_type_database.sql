-- ADR-180 — `capability_type: 'view'` becomes `'database'`.
--
-- The member was never a View. Every capability that carried it declared a
-- Database and its record permissions; the built-in manifests described them
-- literally as "Deals database and views". A View (table, board, calendar,
-- form) is a UI element the user picks at render time — it holds no
-- permissions and has no trust lifecycle, so it could never have been a
-- capability. The Database is the governed thing.
--
-- This is a pure value rename on a free-text column: no constraint, no index,
-- and no shape change, so it is reversible by inverting the UPDATE. It is a
-- data migration rather than a code-only change because the value is
-- PERSISTED — leaving stale 'view' rows would make the manifest parser reject
-- an already-installed Module's page bindings on the next read.
UPDATE capability_manifests SET capability_type = 'database' WHERE capability_type = 'view';
--> statement-breakpoint

-- `capability_type: 'dashboard'` was dead as a capability type (the real
-- dashboard concept lives in BlueprintViewKind, a View kind). Any row carrying
-- it is a mislabelled Database for the same reason as above.
UPDATE capability_manifests SET capability_type = 'database' WHERE capability_type = 'dashboard';
--> statement-breakpoint

-- Eval datasets are keyed by capability type too, so they must move with it or
-- a dataset would silently stop matching its capability.
UPDATE eval_datasets SET capability_type = 'database' WHERE capability_type IN ('view', 'dashboard');
