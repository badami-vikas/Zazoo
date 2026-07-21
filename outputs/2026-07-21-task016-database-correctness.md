# TASK-016 database correctness

Source: exact `origin/main@5857cb95d98c53928103df801cfc4ff30a73e8e3`.

## Outcome

- One exported field-kind tuple drives core parsing and API validation. `location` round-trips through `DrizzleOrganizationDefinitionStore` and `organization.blueprint`.
- Canonical Person identity upsert matches `people_canonical_dedup_key_uq WHERE dedup_key IS NOT NULL`. Same keys converge without changing stored identity data; null keys remain multiple; eight concurrent writers return one canonical ID.
- Drizzle tooling generated current snapshots for `0029` and `0030`. Normal generation emits no migration. Real migration `0030_task016_schema_alignment` adds the runtime-missing `events(organization_id, created_at)` index; no historical migration changed.
- One typed UUID schema/error rejects malformed Organization/user/definition/Relationship identifiers before SQL. Public calls return BAD_REQUEST; direct stores fail predictably; PGlite remains usable.
- `@bridge/db` officially supports four concurrent test files. Two waves of four concurrent fresh migrations close cleanly.

## Evidence

- `@bridge/db`: 198/198, three consecutive official runs at `--test-concurrency=4`.
- Core blueprint: 32/32.
- Targeted location/UUID API: 2/2.
- TASK-015 file-backed restart: 1/1.
- Direct RLS/runtime-role checks: 5/5.
- Fresh/upgrade/replay: migrations 0013, 0023, 0029, 0030 plus journal/no-op generation.
- Changed-scope correctness review: no findings.

GitHub Actions is billing/payment blocked. No CI success is claimed.

## Files

- [TASK-016](../docs/TASKS.md)
- [BUG evidence](../docs/BUGS.md)
- [ADR-143](../docs/raw/decisions-log.md)
- [Schema wiki](../docs/wiki/schema.md)
