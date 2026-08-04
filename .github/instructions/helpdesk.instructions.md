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

## Current implementation patterns

- Keep `routeHelpRequest()` deterministic and offline-safe: normalize request/topic tokens, deduplicate repeated topics and matched tokens, exclude zero-match candidates, score by matched request-token fraction, and use `personId` as the stable tie-break. Return `[]` rather than weakening the threshold.
- Keep `draftHelpOffer()` pure. It returns proposal inputs with route evidence and rejects a blank body; it never sends, persists, or approves.
- Preserve the dual API/store trust paths. Public create/read/reply uses an opaque token; authenticated inbox/reply uses workspace membership and server identity. Unknown tokens and missing tickets remain indistinguishable.
- Hash access tokens as SHA-256 before storage. The legacy plaintext fallback may migrate a matching row once, but hashes themselves must never authenticate as bearer tokens and new plaintext storage is forbidden.
- Require a caller operation UUID for public writes. Derive stable record IDs, use conflict-safe inserts, return the prior result for an identical replay, and reject reuse with changed content.
- Validate and bound all public strings, candidate/topic counts, and route limits at the API seam. The Fastify sensitive/global rate-limit buckets remain in force; do not bypass them with a side server.
- Resolve candidate People through the workspace graph and permission-prune inaccessible records before routing. Mark current caller-supplied topic evidence honestly; do not relabel it as demonstrated capability until TASK-015 derives/validates it.
- Stage an offer through `pipeline.propose()` with the server-owned Agent actor and Human `onBehalfOf`; proposal creation is not delivery or a completed Relationship Action.

## Validation

- Cover deterministic ranking/dedup/ties/limits/honest-empty and blank-offer rejection in `@bridge/helpdesk`.
- Cover token hashing and legacy migration, replay idempotency, changed-input rejection, public/auth separation, workspace isolation, moderation, rate-limit routing, and proposal attribution in affected DB/API tests.
