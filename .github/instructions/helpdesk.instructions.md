---
applyTo: "platform/tools/helpdesk/**,platform/apps/web/src/app/pages/*Helpdesk*.tsx,platform/apps/web/src/app/components/helpdesk/**,platform/apps/web/src/app/data/helpdesk*,platform/packages/db/**/*helpdesk*"
---

# Relationship Helpdesk sub-module

- Read `CLAUDE.md`, `docs/wiki/relationships.md`, and `docs/wiki/helpdesk.md`; current Relationship canon overrides the helpdesk wiki's historical standalone Tool/nav and dummy-data passages.
- Helpdesk is nested under Relationship. Help Request is a domain Record; helping produces a governed relationship Action/Event, not a new kernel primitive or tenant workspace.
- Keep `platform/tools/helpdesk` pure domain logic. Persistence belongs in `@bridge/db`; API governance belongs in the shared proposal/decision pipeline; UI consumes those seams.
- Route by demonstrated capability over permitted People/Community Relations, not topic/feed similarity alone. No qualified match means an honest empty result.
- Stage routes, offers, replies, contact reveal, and external sends as attributable governed proposals. Preserve consent and never leak private decline reasons or contact details.
- Public endpoints must stay bounded, rate-limited, moderation-gated, retry-safe, and privacy-minimized. Store token hashes rather than raw recovery tokens.
- Do not add placeholder asks, reputation, streaks, impact numbers, or people. Use real connected data or honest empty states under the repository dummy-data policy.
