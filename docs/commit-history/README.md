# Commit history — business edition

This archive translates the repository’s complete visible git history into simple business language. It explains what changed and which part of the business or product it affected; it does not replace git as the engineering audit record.

## Coverage

- 512 unique commits visible from all local refs
- 463 commits in the checked-out product lineage
- 49 commits preserved on other branches or archive refs
- 2 monthly files

## History files

| Month | Commits | Current lineage | Other refs | File |
|---|---:|---:|---:|---|
| 2026-06 | 78 | 44 | 34 | [Open](./2026-06.md) |
| 2026-07 | 434 | 419 | 15 | [Open](./2026-07.md) |

## How to read this

- Start with the monthly files for the chronological story.
- Use the short hash to find the exact engineering record with `git show <hash>`.
- Treat merge commits as integration milestones; the underlying commits carry the detailed work.
- “Preserved on another ref” is not automatically discarded work. It may be an archive checkpoint, a parallel branch, or superseded work retained for audit.

## Regeneration

Run `node docs/commit-history/generate-business-history.mjs` from anywhere inside this repository. The generator reads local refs only and makes no network calls.

