---
name: verification-loop
description: Use before claiming any code change is complete, before creating a PR, and before merging — when a feature/fix/refactor is "done" but has not yet been proven with build, types, lint, and tests. Also use when the user asks "is this ready?", "run the checks", or reports that a previously "fixed" issue is still broken.
origin: ECC
---

# Verification Loop

Run the project's own quality gates and report evidence, not vibes. "Done" claims
without a verification report are not done.

## Detect the project first

Do not assume npm. In order:
1. Check for `pnpm-lock.yaml` / `bun.lockb` / `yarn.lock` / `package-lock.json` → use that package manager.
2. Check `package.json` scripts (or `Makefile` / `pyproject.toml`) for the project's
   OWN `build` / `typecheck` / `lint` / `test` commands and use those verbatim.
3. Monorepo (`pnpm-workspace.yaml`, `turbo.json`): run gates from the workspace root
   (`pnpm -w ...`) — package-local runs miss cross-package breakage and workspace
   lint rules (e.g. unused-var rules that tsc doesn't catch).

## Gates (in order, stop on first failure)

1. **Build** — project build script. Fail → fix before anything else.
2. **Types** — `tsc --noEmit` (or pyright/mypy). Zero new errors.
3. **Lint** — project lint script, from the root in monorepos.
4. **Tests** — project test script. If the change has no covering test, say so
   explicitly in the report; don't silently skip.
5. **Diff review** — `git diff --stat` + read each changed hunk. Flag files changed
   that the task didn't require (accidental `add -A` sweep, formatter churn).
6. **Secrets check** — only high-signal patterns (`sk-ant-`, `sk-live`, `AKIA`,
   `-----BEGIN`, `SUPABASE_SERVICE_ROLE`) in the DIFF, not the whole repo — repo-wide
   greps for `api_key` are noise.

## Report format

```
VERIFY: build PASS | types PASS | lint PASS (0 warn) | tests 42/42 | diff 5 files (all in scope)
NOT verified: <anything skipped and why>
```

Overall verdict is READY only if every gate ran and passed. A skipped gate makes the
verdict NOT READY, even if everything that ran was green.

## Edge cases this loop must not fumble

- **No test script exists** → say "no test suite; verified by <manual check>" — never report tests PASS.
- **Long-running test suites** → run the affected package's tests first, then the full suite; don't sample and call it complete.
- **Worktrees** → verify in the worktree you edited, and re-verify after merging onto main if main moved.
- **Generated files in diff** → identify them (lockfiles, codegen) and exclude from review noise, but confirm they were regenerated intentionally.

## Not this skill's job

Deploy and production verification — that is ship-to-prod. This loop proves the
code is ready to ship; ship-to-prod proves it actually shipped.
