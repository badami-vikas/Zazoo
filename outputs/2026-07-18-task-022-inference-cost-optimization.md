# TASK-022 — Inference cost optimization

Date: 2026-07-18

## Outcome

`ModelProvider.complete()` now requires an explicit `cheap | default | reasoning` tier and returns normalized model plus token usage, including Anthropic cache-write/cache-read counts. Providers declare which tiers they satisfy. `createModelRouter` selects by Plane, tier, and provider hints instead of registration position; a Local-Plane binding still fails closed when no local provider exists.

Anthropic requests place `cache_control` only on the stable system text block. The changing user turn remains outside the cache breakpoint. Cheap Anthropic calls default to Haiku 4.5; default/reasoning calls preserve Fable 5 unless environment overrides pin another model. Known Anthropic prices produce dated estimated USD receipt values; unknown pricing is explicit.

Every configured Chief-of-Staff completion passes a shared governed wrapper before provider access. Cloud calls resolve as public-scope `external:fetch` by the governed Egress Agent on behalf of the authenticated member; local calls resolve as local principal `tool:read`. Authority denial, blocking/approval policy, or tainted cloud context stops before the provider call. Cloud prompts contain only static instructions plus the explicit user turn; profile-derived tone stays local. Classification resolves cheap, Communications default, and foundational Agents reasoning. Each successful branch records an append-only prompt-free receipt containing provider, Plane, model, tier, usage, cost status, Authority basis, and policy results.

## Contract and implementation files

- `platform/packages/core/src/ports.ts`
- `platform/packages/core/src/memory/stores.ts`
- `platform/packages/core/src/chief-of-staff.ts`
- `platform/packages/core/src/agents.ts`
- `platform/packages/core/src/{eval/judge,guard/content-guard}.ts`
- `platform/packages/models/src/{anthropic-provider,groq-provider,ollama-provider,router,usage}.ts`
- `platform/apps/api/src/{wiring,router}.ts`

## Deterministic evidence

- The Anthropic protocol adapter uses an explicit system-block breakpoint and enforces the documented 4,096-token Haiku 4.5 minimum. The first call reports cache creation; a second call with the same system and different user turn reports non-zero cache-read input tokens.
- Router tests register reasoning before cheap and still select cheap for CoS and reasoning for a reasoning-tagged call.
- Anthropic, Groq, and Ollama adapters propagate authoritative token fields and reject missing usage instead of returning success-shaped zeros.
- Provider failures retain only operation plus HTTP status, never arbitrary provider response content. Receipts reject tier mismatches, oversized identifiers, and non-finite cost.
- CoS integration tests persist Egress-Agent/on-behalf-of-member receipts for cheap classification, default Communications, and reasoning foundational-Agent calls; the volatile prompt body is absent.
- A non-member and a member without model-egress authority both fail before provider access.
- Local-default routing with only cloud providers throws; no cloud fallback exists.

## Verification

- `@bridge/core`, `@bridge/models`, and `@bridge/api`: build and typecheck pass.
- Complete affected-package suites: 623/623 tests pass (core 424, models 23, API 176).
- All 24 changed TypeScript files pass ESLint.
- Runtime no-dummy check and Git whitespace/error check pass.

## Independent review

Independent correctness/security review and the final blast-radius scan found eight pre-commit defects: missing workspace membership before model egress, non-UUID ledger identities, a broad unreceipted model-failure fallback, reversed Anthropic null/omission handling, underpriced one-hour cache writes, configured CoS calls bypassing Authority/Plane/policy despite membership, provider response bodies retained in errors, and unbounded cost overflow. All eight are resolved: configured calls use the governed wrapper described above, cloud receipts use the real Egress Agent UUID on behalf of the caller, failures propagate without retaining response content, Anthropic's required nullable schema is preserved, only the accurately priced five-minute TTL is exposed, tiers must match the request, and cost must remain finite. The corresponding regressions are part of the counts above.

## External-provider evidence limit

No live Anthropic, Groq, or Ollama endpoint was called. The repository has no approved non-production credentials or spend budget for this task. Cache hits also depend on provider TTL and minimum prefix length (Haiku 4.5: 4,096 tokens; Fable 5: 512), so short production prefixes may correctly report zero cache tokens. The deterministic adapter verifies request/response protocol and routing behavior, not provider uptime, account entitlements, billing reconciliation, or live cache retention.

## Related records

- `docs/TASKS.md` TASK-022
- `docs/raw/decisions-log.md` ADR-113
- `docs/wiki/optimizations.md`
- `docs/dummy.md`
- `outputs/2026-07-17-llm-inference-optimization-audit.md`
