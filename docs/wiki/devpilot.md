# DevPilot

Plan: [../raw/devpilot-module-plan-2026-08-13.md](../raw/devpilot-module-plan-2026-08-13.md) (ADR-235/237, AP-153/155, TASK-067/068/071)

- Software-engineering-assist Module, gated dark behind `BRIDGE_DEVPILOT` — with the flight off every `devpilot.*` procedure except `status` throws `PRECONDITION_FAILED` and the Module is absent from nav.
- D0 (TASK-067): skeleton — nav entry, three Pages (Pull Requests / Issues / Repos) over the standard `ModuleSurfaceLayout`/`DataViews` shell, one Agent, one scheduled Automation.
- D1 (TASK-068): a fine-grained GitHub PAT (masked, never logged) syncs tracked repos' PRs and Issues on a 15-minute Automation or manual "run sync now" — idempotent upsert on `(organization_id, source, source_id)`, and GitHub's `/issues` response items carrying a `pull_request` key are filtered out rather than becoming duplicate issue rows.
- D2 (TASK-071): three governed Skills — `devpilot.reviewPr`, `devpilot.suggestPractice` (over a tracked PR's live diff), `devpilot.analyzeIssue` (over a tracked Issue's live body) — drafts are proposals through the normal Approvals pipeline; tracking writes (sync upserts) are direct. Nothing is ever posted back to GitHub. No model configured → an honest "not drafted" scaffold, never a guess.
