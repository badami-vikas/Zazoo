/**
 * @bridge/models — real ModelProvider implementations behind @bridge/core's
 * `ModelProvider` port (the seam CLAUDE.md's stack section names: "Ollama dev,
 * configurable prod, Claude default; capture/sensor plane = local models
 * default"). @bridge/core stays zero-deps; the HTTP goes here.
 */
export { OllamaProvider, type OllamaProviderOpts } from "./ollama-provider.js";
export { AnthropicProvider, type AnthropicProviderOpts } from "./anthropic-provider.js";
export { GroqProvider, type GroqProviderOpts } from "./groq-provider.js";
export { createModelRouter, type ModelRouter } from "./router.js";
export { defaultFetch, type FetchLike } from "./fetch-types.js";
