# TASK-022 — Inference cost optimization

Date: 2026-07-18; reconciled with current main 2026-07-21

## Status

The code milestone is implemented and reviewed. TASK-022 remains `blocked` under AP-067 because this environment has neither an authorized Anthropic credential nor explicit live-test spend authorization. No live provider/cache/billing claim is made.

Exact unblock: authorize the secure opt-in test, then run two sequential real public-safe Chief-of-Staff `@builder` turns and retain a second prompt-free ledger receipt with non-zero `cacheReadInputTokens`.

Landing source: `61e85c39ecbbe8003f9ffe5853450ce14c164a1b`; focused PR #43.

## Outcome

`ModelProvider.complete()` requires `cheap | default | reasoning`. Providers must declare supported tiers, exact configured model identities, and routing health. Completions return normalized input/output/cache-write/cache-read usage. Request size, output tokens, usage, pricing metadata, and persisted estimates are bounded.

`createModelRouter` selects by Plane, tier, availability/health, and server-owned provider hint. It never uses registration position. Local bindings never fall through to cloud. CoS inference is Local Plane by default; cloud is eligible only when the authenticated caller explicitly declares the turn public and confirms egress. Authority and policy must still allow it.

Anthropic places `cache_control` only on the stable system block. The volatile user turn stays outside the breakpoint. Cheap defaults to pinned Haiku 4.5; default/reasoning use Fable 5 unless explicit configuration pins another exact identity.

Every configured CoS completion passes one governed wrapper. Cloud runs as public-scope `external:fetch` by the Egress Agent on behalf of the member. Local runs as local-principal `module:read`. Successful classification, Communications, and foundational-Agent calls append a prompt-free receipt with a model-call Run ID, Organization, Agent attribution, Plane, model, tier, authoritative usage, bounded cost/provenance, Authority basis, and policy results.

## Contract and implementation files

- `platform/packages/core/src/{ports,memory/stores,chief-of-staff,agents,eval/judge,guard/content-guard}.ts`
- `platform/packages/models/src/{anthropic-provider,groq-provider,ollama-provider,router,usage}.ts`
- `platform/apps/api/src/{router,wiring}.ts`

## Deterministic evidence

- A protocol-faithful Anthropic adapter enforces the model cache threshold. First call reports creation; the same stable system plus a different user turn reports non-zero cache read.
- Router tests prove cheap classification versus reasoning selection, health ordering, unavailable exclusion, exact hints, and Local fail-closed behavior.
- Anthropic, Groq, and Ollama propagate authoritative usage and reject omitted usage or relabeled models.
- CoS tests prove Local-default/no-cloud-fallback, explicit public cloud confirmation, Authority/policy denial before provider access, tier routing, profile exclusion, Run/Agent/Organization receipt attribution, and prompt absence.
- A secure opt-in CoS test uses the real Anthropic adapter only when `BRIDGE_RUN_LIVE_ANTHROPIC_CACHE_TEST=1` and an authorized `ANTHROPIC_API_KEY` are already present. It never prints either value.

## Verification

- Targeted affected tests: 99 passed, 1 credential-gated live test skipped (core 59; models 27; API 13).
- `@bridge/core`, `@bridge/models`, and `@bridge/api`: build and typecheck pass.
- All 23 changed TypeScript files pass ESLint.
- Vocabulary: 12 scanner tests plus zero-retired-term ratchet pass.
- Runtime no-dummy and Git diff-integrity checks pass.

## Independent review

The recovered branch reconciled eight earlier authority, identity, fallback, protocol, pricing, error-content, and overflow findings. Landing review found one additional high-severity defect: arbitrary user text could be sent to cloud while being labeled public. CoS now defaults Local and requires explicit authenticated public-data confirmation before cloud becomes eligible. The correctness re-review and a separate bounded security review found no remaining issues.

## External-provider evidence limit

No Anthropic, Groq, or Ollama endpoint was called. Deterministic evidence proves request/response protocol and governed accounting, not provider uptime, account entitlement, invoice reconciliation, or live cache retention. Prefix thresholds and the five-minute TTL still apply.

## Related records

- `docs/TASKS.md` TASK-022
- `docs/APPROVALS.md` AP-067
- `docs/raw/decisions-log.md` ADR-140
- `docs/wiki/optimizations.md`
- `docs/dummy.md`
- `outputs/2026-07-17-llm-inference-optimization-audit.md`
