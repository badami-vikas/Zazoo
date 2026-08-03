#!/usr/bin/env bash
# Pre-commit guard: blocks committing PII-derived files.
#
# Restored 2026-08-03. The original (deleted by 41d3b37 along with the files it
# guarded) only knew about the "Design Bridge AI Interface (Copy)" prototype, so
# restoring it verbatim would have exited 0 while checking nothing. The blocked
# set below is the CURRENT one; the prototype paths are kept because that folder
# is recoverable from history and may return.
#
# Run via .githooks/pre-commit (git config core.hooksPath .githooks).
set -euo pipefail

# Exact paths that must never be committed.
BLOCKED_FILES="Design Bridge AI Interface (Copy)/data/Connections.csv
Design Bridge AI Interface (Copy)/data/Invitations.csv
Design Bridge AI Interface (Copy)/data/seed_canonical.sql
Design Bridge AI Interface (Copy)/src/app/data/dbSignals.ts
Design Bridge AI Interface (Copy)/src/app/data/reconStaging.ts
Connections.csv"

# Path patterns that must never be committed, matched against staged names.
#  - any .env.local holds live API keys
#  - recon data/ holds real enriched person profiles
#  - staging/permanent/enriched-* JSONL are the recon store's PII rows
BLOCKED_PATTERNS='(^|/)\.env\.local$
Tools/[^/]*recon[^/]*/data/
(^|/)(staging|permanent|enriched-[^/]*)\.jsonl$'

STUB_FILE="Design Bridge AI Interface (Copy)/src/app/data/network.ts"

staged=$(git diff --cached --name-only)

fail=0

for f in $BLOCKED_FILES; do
  if echo "$staged" | grep -qxF "$f"; then
    echo "BLOCKED: '$f' is a PII-derived file and must never be committed." >&2
    echo "  Unstage it: git restore --staged \"$f\"" >&2
    fail=1
  fi
done

while IFS= read -r pattern; do
  [ -z "$pattern" ] && continue
  matches=$(echo "$staged" | grep -E "$pattern" || true)
  if [ -n "$matches" ]; then
    echo "BLOCKED: staged path(s) match a PII/secret rule ($pattern):" >&2
    echo "$matches" | sed 's/^/  /' >&2
    fail=1
  fi
done <<< "$BLOCKED_PATTERNS"

# network.ts IS meant to be tracked, but only as the dummy_ stub — every row must
# carry a dummy_ id. A real regenerated export will not.
if echo "$staged" | grep -qxF "$STUB_FILE"; then
  content=$(git show ":$STUB_FILE" 2>/dev/null || cat "$STUB_FILE")
  total_rows=$(echo "$content" | grep -cE "id: '[^']+'" || true)
  dummy_rows=$(echo "$content" | grep -cE "id: 'dummy_" || true)
  if [ "$total_rows" -gt 0 ] && [ "$dummy_rows" -lt "$total_rows" ]; then
    echo "BLOCKED: '$STUB_FILE' has $((total_rows - dummy_rows)) row(s) without a dummy_ id — looks like real data, not the stub." >&2
    fail=1
  fi
fi

exit "$fail"
