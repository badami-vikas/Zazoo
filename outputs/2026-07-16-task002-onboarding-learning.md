# TASK-002 — onboarding and controlled learning

## Delivered
- Every onboarding question explains why it is asked and what changes.
- Public-role-model input is optional and paired with the behavior the user admires.
- Learning checks a bounded Wikipedia source, cites it, separates documented context from interpretation, and proposes a recommendation as a pending-review Signal.
- Direct onboarding preferences persist as private Local Plane Memory.
- The day-7 qualities reflection is scheduled and can be snoozed, paused, resumed, or skipped.
- Settings exposes onboarding re-entry plus preference inspect, correct, and delete controls. Start over clears only draft answers.
- Memory deletion removes the complete correction lineage.

## Verification
- Changed-file ESLint: pass.
- API role-model/approval/Memory control regression: pass.
- DB Memory forget-lineage regression: test passes; isolated package command remains red only because its aggregate coverage is 51.52% against 54%.
- Full API suite: pass.
- Full production build: pass.
- Changed source lint and final focused API/DB regressions: pass.
- Web typecheck reaches only the pre-existing missing `Link` import in `IntelligencePage.tsx`.
- Full lint reaches only the pre-existing `ZazooAvatar.tsx` unregistered-rule failure.
- Full test reaches the already-open `@bridge/sensors` aggregate coverage-floor defect (all seven sensor tests pass; 35.26% measured vs 38% floor).
- Baseline full tests and production build passed before edits; final full verification follows in the task session.

## Still open
- Live desktop and 375px prototype evidence.
- Browser automation is unavailable in this session because the browser MCP requires interactive OAuth; live viewport proof remains open.
- Full onboarding ceremony permission/live-value beat.
- General research remains blocked on the SSRF-hardened research client and runtime taint propagation.
- Persistent production governance must provision the Learning Agent Signal grant; zero-infrastructure mode is wired now.

## Files
- [TASKS](../docs/TASKS.md)
- [Learning wiki](../docs/wiki/learning-agent.md)
- [ADR-095](../docs/raw/decisions-log.md)
