---
name: session-checkpoint
description: Use for long-running or multi-phase work — autonomous builds, overnight runs, multi-agent orchestration, or anything likely to span a "continue"/"retry"/"relaunch" restart. Also use when the user says "continue", "retry", "relaunch", "where were we", or "what's left to be done" and no ledger exists yet for the current work.
---

# Session Checkpoint

## Overview

Long runs die or get interrupted, and resuming from memory ("what was I doing?")
wastes a turn and risks redoing or missing work. Write state to a file as you go;
resume from the file, not from recollection.

## When starting multi-phase or long-running work

Create (or update) a ledger at the project root: `.claude/PROGRESS-<task-slug>.md`
(gitignored if the repo doesn't want it committed) with:

```markdown
# <task> — checkpoint

## Goal
<one-line objective>

## Done
- [x] step 1 — <what was verified, not just what was attempted>

## In progress
- [ ] step 2 — <exact next action>

## Blocked / decisions needed
- <anything waiting on the user>

## Last verified state
<build/test/deploy status as of last checkpoint, with command output or "not run">
```

Update it after each meaningful step — not after every tool call, but after
each checkpoint-worthy unit (a phase, a merged piece, a verified gate).

Prefer TaskCreate/TaskUpdate for in-session step tracking; use the file ledger
specifically for anything that might outlive the current session (a fresh
session, a different agent, tomorrow).

## When resuming ("continue", "retry", "relaunch", "what's left?")

1. Look for `.claude/PROGRESS-*.md` before asking the user anything or
   re-deriving state from git log/diff guesswork.
2. Read "Last verified state" — if it says a gate wasn't run, run it before
   trusting "Done" items are actually still true (code may have moved on).
3. Resume from "In progress", not from the top.
4. If no ledger exists for genuinely long/complex work that got interrupted,
   reconstruct one from `git log`, `git diff`, and TaskList before proceeding —
   then start maintaining it going forward.

## Not for

Short, single-turn tasks — the ledger overhead isn't worth it for something
finishing in one exchange. Use TaskCreate/TaskUpdate alone for same-session
multi-step work that won't span a restart.
