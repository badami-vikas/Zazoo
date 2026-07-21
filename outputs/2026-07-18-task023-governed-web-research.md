# TASK-023 governed web research

## Outcome

Learning Agent can run a bounded `web-research` Skill through the existing
Goal/Task/SkillManifest resolver. The server owns Agent selection. Runtime
authority is Cloud Plane + public data scope + `external:fetch:read`.

The provider stack is independent of Learning Agent:

- `SearchProvider` port in `@bridge/core`
- Tier-1/free-direct-only attributable router in `@bridge/models`
- shared `@bridge/net-guard` with HTTPS/origin allowlist, public-unicast DNS
  validation/pinning, connected-socket verification, manual redirect limits,
  DNS/request deadlines, cancellation, request/response byte caps, strict
  content types, identity encoding, and UTF-8
- anonymous Parallel Search MCP adapter with live terms/privacy drift gate

The signed Relationship Module owns the Skill and exposes it only beneath the
Learning Agent. Before egress, the route verifies installed Module binding,
Organization membership, active Agent, Goal/Task assignment, SkillManifest,
public scope, cloud Plane, explicit objective/budget, and governed Run.

Raw provider titles/excerpts are `untrusted_external` on adapter entry and pass
through a local-only ContentGuard quarantine. Only bounded typed summaries and
entities cross. The pipeline joins output taint with ambient taint before policy.
The append-only Ledger proposal/output is the Result; a private semantic Memory
links to that Result; a persistent Event links Result, Memory, Task, Module,
citations, provider attempts, hashes, and rights metadata. No raw provider text
reaches those sinks or any prompt outside the local quarantine boundary.

## Candidate reconciliation

- Candidate A preserved at `458f747fdc1dbf432897ac5d4b799c6ea5c0799e`.
- Candidate B (`b44e7514-4f2d-4e57-a4c7-e2b9b06be88d`,
  `manishsbhoopalam8498-implement-web-research`) was inspected read-only and
  remains untouched.
- A won on rights intake, policy-drift checks, network regressions, live
  evidence, and prior security review.
- B's explicit provider-attempt budget and richer retrieval metadata were
  retained.
- B's duplicate research/network package, DuckDuckGo registration, and
  superseded Onboarding migration were rejected.
- Candidate A was normally merged with
  `origin/main@5122695d8dbf3a9b74bebd79e89618771126af92`; current
  Organization/Module/Event/Result/File/Task Manager/ModelProvider contracts
  won every reconciliation.

## Provider rights

Verified 2026-07-18 and retained after current-main reconciliation:

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

- Focused regression surfaces cover SearchProvider bounds/health/failover,
  no-paid escalation, Parallel MCP protocol, shared net-guard POST/DNS/SSRF/
  redirect/bytes/time/cancellation, ContentGuard quarantine, monotonic taint,
  Learning Agent/Goal/Task/Module authority, durable Result/Memory/Event
  evidence, provider unavailability, unsafe-quarantine rejection without Result
  or Memory writes, and Learning-only manifest ownership.
- Final targeted tests passed: core 68/68, net-guard 26/26, models 35/35,
  DB 13/13, manifests 4/4, and API/culture-research 74/74. The affected
  dependency graph build/typecheck, changed-file lint, frozen lockfile,
  vocabulary, no-runtime-dummy, generated Task Manager data, and diff checks
  also passed.
- The independent changed-scope security review found no high-confidence
  vulnerability. Its only code-level residual was latent request-body replay if
  a future shared-net-guard caller enabled redirects; body-bearing requests now
  fail before connecting unless `maxRedirects` is exactly zero.
- A durable Local Plane smoke invoked the real authenticated Organization route
  with one anonymous Parallel query, a local tool-less quarantine adapter, two
  results, one provider attempt, a 96 KiB aggregate response cap, and a 12-second
  deadline. It returned one official Node.js citation plus one public secondary
  citation. Provider request `search_84944da447be439db66ea162fc302c8a`;
  Result hash
  `sha256:f0d0bbb1ec4c8e13d21a1abe5f68d65afa593c9745b5bfcc65b2580cfa3019c9`.
  Result, Memory, and Event all retained `untrusted_external`; Memory linked back
  to the Result ledger id. The first live attempt exposed date-only provider
  metadata; ISO normalization was added and the repeated governed invocation
  passed.
- Landing validation and final review evidence are recorded in the TASK-023
  commit/PR and coordinator report.

## Closure

TASK-023 is `done` under AP-069. Implementation source
`6e33f051b7e001efe25c949d4038730aee6a1292` landed through PR #44 at normal
merge `b8e1db0b808806d45dd904270902dd77b132541c`. The exact real Organization
prototype passed with durable governed Parallel citations, provenance, and
`untrusted_external` Result/Memory/Event taint. Parallel has no access blocker.
Jina and DuckDuckGo remain unregistered at rights gates. Candidate B remains
superseded and untouched. GitHub Actions run `29844324937` had no runner and
zero steps; no CI success is claimed.

## Files

- [TASK-023](../docs/TASKS.md)
- [Learning Agent wiki](../docs/wiki/learning-agent.md)
- [LA3 roadmap §7](../docs/raw/learning-agent-roadmap-2026-07.md)
- [ADR-141](../docs/raw/decisions-log.md)
- [Provider survey](2026-07-17-learning-agent-recon-search-integrations.md)
