# TASK-023 governed web research

## Outcome

Learning Agent can run a bounded `web-research` Skill through the existing
Goal/Task/SkillManifest resolver. The server owns Agent selection. Runtime
authority is Cloud Plane + public data scope + `external:fetch:read`.

The provider stack is independent of Learning Agent:

- `SearchProvider` port in `@bridge/core`
- Tier-1/free-direct-only attributable router in `@bridge/models`
- DNS-pinned safe HTTP client with HTTPS/origin allowlist, public-unicast DNS
  enforcement, connected-socket verification, redirect limits, total deadlines,
  request/response byte caps, strict content types, identity encoding, and UTF-8
- anonymous Parallel Search MCP adapter with live terms/privacy drift gate

Results carry citation-level and Result-level `untrusted_external` taint,
provider request provenance, terms/privacy URLs, and attributable attempts.
The pipeline combines Skill-output taint with input/context taint before runtime
policy and persists it in the Ledger. This slice deliberately has no
research-to-Memory or research-to-prompt sink.

## Provider rights

Verified 2026-07-18:

- **Shipped:** Parallel Search MCP anonymous `web_search`
  (`https://search.parallel.ai/mcp`). Official docs state anonymous access; a
  live production-adapter call completed with three bounded citations and
  `x-parallel-terms: https://parallel.ai/customer-terms` /
  `x-parallel-privacy: https://parallel.ai/privacy-policy`.
- **Blocked:** Jina keyless. Current published access path requires
  registration/key and does not verify the assumed generic keyless automated
  client use.
- **Blocked:** DuckDuckGo Instant Answer. Current automated/commercial
  permission could not be verified; the API-domain robots policy blocks the
  assumed path.

No Tier-2, Tier-3, credentialed, paid, or self-hosted adapter is registered.
The router rejects those classes at construction. Parallel rights metadata
expires after 90 days and changed policy headers stop execution.

## Verification

- Full 22-package platform build and full 22-package typecheck passed.
- Full affected suites passed: core 425/425, models 34/34, database
  124/124, and API 176/176 (759 tests total).
- Changed-file ESLint, no-dummy runtime, frozen-lockfile install, and
  `git diff --check` passed.
- A final live production-adapter smoke returned three bounded Parallel
  citations; Result and every citation carried `untrusted_external`.
- Independent security review found no high-confidence vulnerability.

Regression surfaces cover network safety/provider protocol, output taint,
Learning Agent attribution/authority, persistent governance, unavailable and
degraded providers, and structural rejection of paid escalation.

## Files

- [TASK-023](../docs/TASKS.md)
- [Learning Agent wiki](../docs/wiki/learning-agent.md)
- [LA3 roadmap §7](../docs/raw/learning-agent-roadmap-2026-07.md)
- [ADR-113](../docs/raw/decisions-log.md)
- [Provider survey](2026-07-17-learning-agent-recon-search-integrations.md)
