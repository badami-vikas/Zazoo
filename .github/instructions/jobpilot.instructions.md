---
applyTo: "platform/tools/jobpilot/**,platform/apps/web/src/app/pages/JobPilot*.tsx,platform/apps/web/src/app/data/jobpilot.ts,platform/apps/api/**/*jobpilot*,platform/packages/db/**/*jobpilot*"
---

# JobPilot Module

- Read `CLAUDE.md`, `docs/wiki/jobpilot.md`, and TASK-011 in `docs/TASKS.md`; use the linked BRD/delivery plan only when needed.
- Keep one installable JobPilot Module. Evolve `platform/tools/jobpilot`; compose shared sourcing, people/company enrichment, dedupe, facts, and tables instead of cloning them.
- Store real Job/Application Records. Tailored claims must resolve to verified Candidate Profile evidence; separate facts, opinions, themes, contradictions, and inference.
- Prefer authorized structured Sources. Respect access, license, terms, pacing, provenance, taint, and credential boundaries.
- Agents may research, score, and draft through Goal/Task-bound Skills. Never auto-submit, mass-apply, fabricate qualifications, or bypass explicit Human approval at launch.
- Use explicit Pursue/Review/Dismiss governed Actions and the platform red flag for negative feedback; do not revive green/yellow recommendation semantics.
- Preserve the standard manifest-driven Module inventory and shared View/Record Detail grammar; use real data or honest empty states.

## Current implementation patterns

- Keep `platform/tools/jobpilot` as pure policy/domain logic. Inject fetchers, stores, clocks, and executors; connector factories may classify/normalize external data but must not own OAuth, hidden network calls, DB writes, browser automation, or submission.
- Compose `@bridge/sourcing`, company/people sourcing, dedupe, facts, and tables. Reuse the shared fuzzy threshold rather than declaring a JobPilot-specific near-match rule.
- Treat Candidate Profile compilation as evidence reconciliation: retain field provenance/confidence, surface contradictions as `NeedsHuman`, and require all unresolved fields plus a non-empty Human identity before `approveProfile()` creates the opaque `ApprovedProfile`. Downstream entry points assert that wrapper.
- Keep application progression in the one `ALLOWED_TRANSITIONS` map. `transition()` validates and returns an immutable `StageEvent`; the persistence/Automation layer must atomically store the new stage and event rather than updating status through another path.
- Run deterministic fit/evaluation gates before model work. Tailoring change-log entries cite evidence present in the approved profile; protected employer/title/date/degree fields cannot use evidence-free keyword additions.
- The Answer Bank normalizes, checks exact then shared-threshold fuzzy matches, and raises `NeedsHuman` for unknown questions. SSN, national-ID, bank, routing, card, and payment questions always stop for a Human even if an answer exists.
- Keep the apply waterfall as policy: resolve the starting ATS tier, map known answers, require an approved evaluator verdict before submit, stop expired postings, park CAPTCHA/login issues, and escalate only ordinary failures. Actual external submission remains a governed Integration/Agent Action.
- Enforce pacing with check-before-record counters and defer work when daily or ATS-domain caps are reached; never silently drop or exceed work.
- Existing `FitResult.flag` green/yellow naming and legacy Application stages are migration seams, not extension patterns. New UI/control flow uses Pursue/Review/Dismiss plus the platform Red Flag contract.

## Validation

- Preserve package `node:test` coverage and its 70% line floor. Cover every state edge, approval-wrapper rejection, unresolved/sensitive Answer Bank paths, protected-field fabrication guards, scoring boundaries, pacing caps, ATS waterfall outcomes, and injected connector failures.
- Exercise affected API persistence/governance and web Profile/Application/empty-state flows in addition to `@bridge/jobpilot`.
