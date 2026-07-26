# Token-efficient agent workflow

Date: 2026-07-26
Task: TASK-025
Approval: AP-076, AP-077
Decision: ADR-146

## Outcome

Bridge now spends repository context according to risk:

- Tier A read-only questions use targeted reads and make no tracker, ledger, output, test, or agent
  calls by default.
- Tier B isolated changes read the compact active-task index and only directly relevant docs/code,
  run targeted validation, and inspect direct neighbours.
- Tier C security, privacy, Auth, schema, production, canon, cross-plane, and broad changes retain
  the full existing governance and evidence protocol.

Uncertainty escalates to Tier C. No safety, residency, approval, or mutation boundary was weakened.

## Measured context

```yaml
before:
  claude_md: 10972 bytes / 1343 words
  always_loaded_guidance: 11732 bytes
  task_navigation: 78436 bytes
after:
  claude_md: 7211 bytes / 878 words
  always_loaded_guidance: 7971 bytes
  approximate_always_loaded_tokens: 1993
  active_task_navigation: 767 bytes
reduction:
  always_loaded_guidance: 32.1 percent
  routine_guidance_plus_task_navigation: 90.3 percent
```

The current resumed Copilot session had 78,078,128 input tokens across 533 measured turns, about
146,000 per turn. That cumulative conversation cost requires a fresh session for unrelated work;
repository rules cannot erase prior chat context.

## Behavior benchmark

- A fresh GPT Tier-A lookup read `CLAUDE.md` plus only API context, identity, and router files. It did
  not read TASKS/BUGS/log, run tests, invoke another agent, or modify the worktree.
- The first Claude-compatible classifier treated a test-only rename as possibly Tier A. The contract
  was tightened to make every repository edit at least Tier B. Its fresh recheck read only
  `CLAUDE.md`, classified the rename Tier B, and required the targeted test.
- The Auth-refresh plus production-deploy scenario remained Tier C and retained task, affected-
  neighbour, decision, evidence, approval, and deployment verification requirements.

Standalone `copilot` and `claude` executables were not available in this environment, so no
comparable fresh-runtime total-token reduction is claimed. The deterministic repository-context
proxy exceeded the 60% target; runtime totals remain a future observational metric, not fabricated
evidence.

## Configuration and PR disposition

- Main now tracks one `.claude/settings.json`.
- 111 off-project skills and four ceremony-heavy plugins are disabled.
- Claude session/worktree/log state remains ignored.
- No project skill pack is vendored.
- PR #17 is conflicting, duplicates canonical Module policy, and carries a stale TASK-024 meaning.
- PR #48's settings list informed the fix, but its 406-file skill bundle, stale launch data, and
  failing checks are not merged.
- Neither PR's GitHub state changed.

AP-077 later authorized committing and pushing this completed change set directly to `main`, while
leaving the separate right-chat-panel working-tree audit uncommitted.

## Enforcement

`pnpm check:agent-context` tests and enforces:

- `CLAUDE.md` byte/word limits;
- the `AGENTS.md` pointer limit;
- compact active-task projection size;
- path-instruction per-file/combined/pointer-only limits;
- project-skill count/byte limits;
- total always-loaded guidance.

The existing CI platform job runs this gate before vocabulary and platform checks.

## Files

- `CLAUDE.md`
- `.claude/settings.json`
- `.gitignore`
- `docs/CODEMAPS/current-tasks.md`
- `platform/scripts/task-doc-parser.mjs`
- `platform/scripts/check-agent-context-budget.mjs`
- `.github/workflows/ci.yml`
