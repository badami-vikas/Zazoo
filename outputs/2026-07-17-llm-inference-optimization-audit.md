# LLM Inference Optimization Audit — 2026-07-17

**Question (user):** Do we have serving-level optimizations (speculative decoding, KV caching, prefix caching, CUDA graphs, flash/paged attention, tensor parallel, prefill disaggregation, function calling)? Are prompts optimized before sending or sent raw? Is there market research on infra best practices? Is text→image conversion a cheaper way to send prompts? What free/paid modular options exist, and what has no free alternative?

## Verdict in one paragraph

Bridge sends prompts **raw** — assembled deterministically and passed straight to `ModelProvider.complete()` with zero runtime optimization: no prompt caching, no batching, no compression/truncation, no token counting/budgeting, no cost-based model routing (model choice is literally `providers[0]` after filtering out the echo provider). The serving-level mechanisms in the question live **inside** the inference engines we call — Anthropic/Groq handle them server-side; locally we get whatever llama.cpp-via-Ollama implements (flash attention, KV cache) — they are not ours to build. Our layer's levers (prompt caching, batching, tier routing, semantic caching, compression) are all unimplemented; the biggest single win — Anthropic `cache_control` (~90% discount on cached prefix reads) — is a small change to one file. A runtime Optimizations plan exists in docs (`docs/raw/optimizations-memory-vm-dealpilot-plan-2026-07.md`, status **proposed**) but nothing is built, and no formal market survey exists.

## Current state (verified in code)

- Port: `platform/packages/core/src/ports.ts:180` — `ModelProvider.complete()/embed()`, non-streaming, single-shot.
- Providers: Ollama (local, `llama3.1`, `nomic-embed-text`), Anthropic (`claude-fable-5`, bare Messages API body — no `cache_control`), Groq. Wired in `platform/apps/api/src/wiring.ts:962`.
- Router (`platform/packages/models/src/router.ts`): routes by **plane/privacy only** (local never falls to cloud). No cost/capability tiering.
- Call sites all direct: CoS intent classification (`chief-of-staff.ts:210`), CoS converse (`api/src/router.ts:4517–4680`, model = `registeredModels[0]`), foundational agents (`agents.ts:277`), eval judge, content guard.
- Context assembly: `run-context.ts` `projectToPrompt()` — pure string template; Mem0 retrieval slot exists but empty.
- No: prompt caching, Batches API, semantic/embeddings cache, token counting, vLLM/llama.cpp direct, LiteLLM/AI-SDK gateway, Mastra/Mem0/Hatchet/BullMQ in the model path.
- Capture is genuinely local: faster-whisper + Ollama in the recorder sidecar; local content guard refuses cloud providers.

## The serving-mechanism table, mapped to Bridge

| Mechanism | Whose job | Bridge status |
|---|---|---|
| Speculative decoding, CUDA graphs, tensor parallel, prefill disaggregation, paged attention | Inference engine (vLLM/SGLang/provider infra) | Provider-side for Anthropic/Groq; N/A locally unless we adopt vLLM (only worth it for multi-user GPU serving — not our shape) |
| Flash attention, KV caching | Inference engine | Present in llama.cpp/Ollama already; provider-side for cloud |
| Prefix caching | **Split: engine + caller** | ❌ our half missing — Anthropic `cache_control` not sent; Ollama keeps KV per session but our prompts aren't ordered stable-prefix-first |
| Function calling | **Caller (us)** | ❌ not using native tool-use API; CoS classifies intent via a text completion (`maxTokens:32`) instead of structured tool calls |

## Text-as-image "hack" — rejected

Converting prompts to images to save tokens **costs more, not less**, on the APIs we use. Claude bills images at roughly (width×height)/750 tokens; a full-resolution page (~1,500–4,800 image tokens on current models) carries less reliably-readable text than the same content as ~700 plain-text tokens. Vision adds lossiness, breaks prompt caching granularity, and disqualifies structured outputs. The research that inspired this idea (DeepSeek-OCR-style "optical compression", ~7–10× in lab settings) requires a model trained with an optical decoder — not applicable to Anthropic/OpenAI/Groq endpoints. The legitimate equivalent lever is **prompt caching**: cached prefix reads bill at ~0.1× input price — better than any compression trick and lossless.

## Recommended stack (free-first, swappable paid backup)

| Layer | Free / prototype | Paid swap-in | Status |
|---|---|---|---|
| Cloud inference | Groq free tier; Gemini free tier | Anthropic (Fable/Opus/Sonnet/Haiku), OpenAI | ✅ port exists |
| Local inference | Ollama (llama3.1, nomic-embed) | vLLM on rented GPU (only if multi-user serving) | ✅ |
| Prompt caching | Anthropic `cache_control` — free feature, ~0.1× reads / 1.25× writes | — | ❌ **top priority** |
| Batch/offline work | Anthropic Batches API — 50% off everything | — | ❌ unused |
| Model tier routing | Extend `createModelRouter` with tiers (cheap/default/reasoning); Haiku $1/$5 vs Fable $10/$50 = up to ~10× spread | LiteLLM proxy / Portkey / OpenRouter | ❌ (`providers[0]` today) |
| Token/cost accounting | `count_tokens` endpoint + usage fields → receipts (per Optimizations plan) | — | ❌ |
| Observability/tracing | Langfuse or Helicone (both OSS, self-host) | Langfuse Cloud, Braintrust, LangSmith | ❌ |
| Semantic cache | pgvector we already run + content-hash table; GPTCache | Redis Cloud semantic cache | ❌ |
| Embeddings cache | Postgres table keyed on sha256(content, model) | — | ❌ (re-embeds live) |
| Prompt compression | LLMLingua-2 (OSS) — behind eval gates per plan phase 3 | — | ❌, later |
| Evals/gates | promptfoo (OSS) + existing LLM-judge | Braintrust | judge ✅, harness partial |
| Queues/workflows | BullMQ/Hatchet OSS self-host (already planned behind ports) | Hatchet Cloud | ports only |

**Gaps with no real free alternative:** (1) frontier-model quality itself — no free model matches Claude-class reasoning; local llama3.1-8B is the free fallback with a real quality cliff; (2) GPU capacity if we ever need vLLM-class multi-user serving — no free tier anywhere; Bridge's local-first design is precisely the mitigation. Everything else in the stack has a credible OSS/self-host path.

## Ordered next steps (proposal — not queued in TASKS without approval)

1. **Prompt caching** in `anthropic-provider.ts` + reorder `projectToPrompt()` stable-prefix-first (system/persona/capability registry before volatile turn content). Hours of work, up to ~90% input-cost cut on repeated CoS turns.
2. **Extend `ModelProvider.complete()`** to return `usage` and accept `tier` hint; router resolves tier→provider/model. Keeps everything modular/swappable behind the existing port.
3. **Token/cost receipts** per run (Optimizations plan phase 1) — Langfuse or a simple pg table.
4. **Native tool-use** for CoS routing instead of text classification.
5. Batches API for any offline enrichment; semantic/embeddings cache on pgvector; LLMLingua-class compression only behind eval gates (plan phases 2–3).

Related docs: [docs/wiki/optimizations.md](../docs/wiki/optimizations.md) · [docs/raw/optimizations-memory-vm-dealpilot-plan-2026-07.md](../docs/raw/optimizations-memory-vm-dealpilot-plan-2026-07.md) · [docs/wiki/stack.md](../docs/wiki/stack.md)
