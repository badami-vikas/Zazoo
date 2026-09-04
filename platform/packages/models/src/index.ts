/**
 * @bridge/models — networked ModelProvider/SearchProvider implementations and
 * their governed routers. @bridge/core stays zero-deps; HTTP adapters live here.
 */
export { OllamaProvider, type OllamaProviderOpts } from "./ollama-provider.js";
export {
  LlamaCppProvider,
  MANAGED_LLAMA_MODEL_ID,
  MANAGED_LLAMA_PROVIDER_ID,
  type LlamaCppCapability,
  type LlamaCppProviderOpts,
} from "./llama-cpp-provider.js";
export { AnthropicProvider, type AnthropicProviderOpts } from "./anthropic-provider.js";
export { GroqProvider, type GroqProviderOpts } from "./groq-provider.js";
export { OpenRouterProvider, type OpenRouterProviderOpts } from "./openrouter-provider.js";
export { createModelRouter, type ModelRouter } from "./router.js";
export { createLocalContentGuard, CloudContentGuardError } from "./local-content-guard.js";
export { defaultFetch, type FetchLike } from "./fetch-types.js";
export * from "./search-provider-router.js";
export * from "./parallel-search-shared.js";
export * from "./parallel-search-provider.js";
export * from "./parallel-search-api-provider.js";
