---
name: ship-to-prod
description: Use when the user asks to commit, push, merge, deploy, or "ship" work — including compound asks like "commit, push and merge to main", "push PR and merge", "deploy and close session" — or when finishing work that will land on main or production. Also use when the user reports production breakage right after a merge or deploy ("Something went wrong", blank screen, login broken).
---

# Ship to Prod

## Overview

Shipping is not done when the merge command exits 0. It is done when the deployed
surface is verified working with evidence. This skill exists because 30 days of
history show ~126 ship requests and 24 rounds of "production is broken" reported
back by the user afterward — including one bug reported 5 times.

**Core principle: the person who merges verifies. Never hand the user an unverified deploy.**

## The Pipeline

Run every stage in order. A stage may be skipped only if it does not exist in the
project (e.g. no CI), never because "the change is small".

1. **Preflight** — run the project's build + lint + tests (check `package.json` /
   `Makefile` / project verify skill). Red preflight = stop, fix, rerun.
2. **Scope check** — `git status` + `git diff --stat` BEFORE staging. Stage the
   files this task touched, by name. Never `git add -A` in a dirty tree — history
   includes "do not commit" files getting swept into a merge exactly this way.
3. **Commit** — conventional message; state what was verified, not just what changed.
4. **Push + merge** — follow the project's flow (direct to main vs PR). If in a
   worktree, confirm which branch main is and that the worktree is rebased on it
   before merging. After merge, confirm main actually contains the commit
   (`git log origin/main -1`).
5. **Wait for deploy** — merging is not deploying. Find the deploy mechanism
   (Cloudflare Pages, Vercel, CI job) and wait for THIS commit's deployment to
   finish. Verifying before the deploy completes proves nothing — you're looking
   at the old build.
6. **Verify production, not localhost** — open the real production URL (check
   CLAUDE.md / wrangler.jsonc / vercel.json for it; ask only if truly unknowable).
   Minimum checks:
   - the entry page renders (no "Something went wrong", no blank screen)
   - the login / join flow works if the app has one
   - the specific surface this change touched behaves correctly
   - browser console has no new errors
7. **Evidence** — screenshot or snapshot of the verified surface + the deployed
   commit hash. Report: "merged <sha>, deployed, verified <url>: <what you checked>".

## Compound asks

"Commit, push and merge to main" means the WHOLE pipeline above, including deploy
verification if the repo auto-deploys from main. "…and close session" does not
waive verification — it makes it more important, because nobody is watching after.

## When the user reports production breakage

Treat as a regression of the last ship. Before touching code:
- check the deployed commit vs latest main (is the deploy stale or failed?)
- reproduce on the production URL, capture the console/network error
- check whether the same bug was reported before (search recent session notes) —
  a repeat report means the previous fix was never verified in production; verify
  this one there.

## Red flags — stop and restart the pipeline

- "The merge succeeded, so we're done"
- "I'll verify on localhost, prod is the same build"
- "Deploy takes a while, I'll report success now"
- "It's a one-line change, no need to run tests"
- `git add -A` / `git add .` in a tree with unrelated changes

## Common mistakes

| Mistake | Fix |
|---|---|
| Verifying old deployment | Match deployed hash to merged hash first |
| Verifying only the changed page | Also check entry + login — most reported breakages were app-level ("Something went wrong" on load) |
| Declaring success from CLI output | Success = evidence from the production URL |
| Merging a worktree branch onto stale main | Rebase/merge main into branch first, re-run preflight |
