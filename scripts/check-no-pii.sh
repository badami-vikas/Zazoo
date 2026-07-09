#!/usr/bin/env bash
# Pre-commit guard: blocks committing network.ts if it looks like real PII instead of the
# tracked dummy_ stub. Run by .git hooks/pre-commit (installed via `git config core.hooksPath`
# or copied to .git/hooks/pre-commit). See known-issues.md 2026-07-03.
set -euo pipefail

FILE="Design Bridge AI Interface (Copy)/src/app/data/network.ts"
BLOCKED_FILES="Design Bridge AI Interface (Copy)/data/Connections.csv
Design Bridge AI Interface (Copy)/data/Invitations.csv
Design Bridge AI Interface (Copy)/data/seed_canonical.sql
Design Bridge AI Interface (Copy)/src/app/data/dbSignals.ts
Design Bridge AI Interface (Copy)/src/app/data/reconStaging.ts"

staged=$(git diff --cached --name-only)

for f in $BLOCKED_FILES; do
  if echo "$staged" | grep -qxF "$f"; then
    echo "BLOCKED: '$f' is a PII-derived file and must never be committed. Unstage it: git restore --staged \"$f\"" >&2
    exit 1
  fi
done

if echo "$staged" | grep -qxF "$FILE"; then
  # network.ts IS meant to be tracked (dummy_ stub), but only the stub — every people/company
  # row must be dummy_-prefixed. A real regenerated export won't be.
  content=$(git show ":$FILE" 2>/dev/null || cat "$FILE")
  total_rows=$(echo "$content" | grep -cE "id: '[^']+'" || true)
  dummy_rows=$(echo "$content" | grep -cE "id: 'dummy_" || true)
  if [ "$total_rows" -gt 0 ] && [ "$dummy_rows" -lt "$total_rows" ]; then
    echo "BLOCKED: '$FILE' has $((total_rows - dummy_rows)) row(s) without a dummy_ id — looks like real data, not the stub. Refusing commit." >&2
    exit 1
  fi
fi

exit 0
