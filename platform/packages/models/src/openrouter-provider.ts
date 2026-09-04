/**
 * OpenRouterProvider — CLOUD-plane ModelProvider implementation. OpenRouter's
 * OpenAI-compatible chat-completions endpoint, currently pointed at the
 * stealth "Ox Alpha" preview model. Same rules as GroqProvider/
 * AnthropicProvider: NO API key on any manifest/capability, key comes from
 * env or the Settings vault at construction, the two-plane gate applies
 * (createModelRouter enforces planeDefault, not this class) and every call
 * still goes through the existing cloud-egress consent gate in router.ts —
 * this file only adds a provider, it does not change how cloud calls are
 * authorized.
 */
import {
  assertModelCompletionRequest,
  modelRequestTaint,
  type ModelCompletion,
  type ModelCompletionRequest,
  type ModelProvider,
  type ModelTier,
} from "@bridge/core";
import { defaultFetch, type FetchLike } from "./fetch-types.js";
import {
  asRecord,
  assertTierSupported,
  configuredModelId,
  providerRequestError,
  requiredString,
  requiredTokenCount,
  verifiedProviderModel,
} from "./usage.js";

export interface OpenRouterProviderOpts {
  apiKey?: string;
  model?: string;
  baseUrl?: string;
  fetchImpl?: FetchLike;
}

const OPENROUTER_URL = "https://openrouter.ai/api/v1";
const DEFAULT_MODEL = "stealth/ox-alpha";

export class OpenRouterProvider implements ModelProvider {
  readonly id = "openrouter";
  readonly plane = "cloud" as const;
  readonly tiers = ["cheap", "default"] as const satisfies readonly ModelTier[];
  readonly models: Readonly<Partial<Record<ModelTier, string>>>;
  readonly #apiKey: string;
  readonly #model: string;
  readonly #baseUrl: string;
  readonly #fetchImpl: FetchLike;

  constructor(opts: OpenRouterProviderOpts = {}) {
    const key = opts.apiKey ?? process.env["OPENROUTER_API_KEY"];
    if (!key) {
      throw new Error("OpenRouterProvider requires an API key (OPENROUTER_API_KEY)");
    }
    this.#apiKey = key;
    this.#model = configuredModelId(
      opts.model ?? process.env["OPENROUTER_MODEL"] ?? DEFAULT_MODEL,
      "OpenRouterProvider model",
    );
    this.models = { cheap: this.#model, default: this.#model };
    this.#baseUrl = opts.baseUrl ?? OPENROUTER_URL;
    this.#fetchImpl = opts.fetchImpl ?? defaultFetch;
  }

  routingHealth() {
    return "unknown" as const;
  }

  async complete(req: ModelCompletionRequest): Promise<ModelCompletion> {
    assertModelCompletionRequest(req, "OpenRouterProvider.complete");
    assertTierSupported(this.id, this.tiers, req.tier);
    const messages = [
      ...(req.system !== undefined ? [{ role: "system", content: req.system }] : []),
      { role: "user", content: req.prompt },
    ];
    const res = await this.#fetchImpl(`${this.#baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${this.#apiKey}`,
      },
      body: JSON.stringify({
        model: this.#model,
        max_tokens: req.maxTokens ?? 1024,
        messages,
        // OpenRouter routes structured output to schema-capable providers;
        // an unsupported model fails the request loudly rather than silently
        // dropping the schema.
        ...(req.responseFormat
          ? {
              response_format: {
                type: "json_schema",
                json_schema: {
                  name: req.responseFormat.name,
                  schema: req.responseFormat.schema,
                  strict: req.responseFormat.strict ?? true,
                },
              },
            }
          : {}),
      }),
      ...(req.signal ? { signal: req.signal } : {}),
    });
    if (!res.ok) {
      throw providerRequestError("OpenRouterProvider.complete", res.status);
    }
    const json = asRecord(await res.json(), "OpenRouterProvider.complete response");
    const choices = json["choices"];
    if (!Array.isArray(choices) || choices.length === 0) {
      throw new Error("OpenRouterProvider.complete response.choices: expected a non-empty array");
    }
    const firstChoice = asRecord(choices[0], "OpenRouterProvider.complete response.choices[0]");
    const message = asRecord(firstChoice["message"], "OpenRouterProvider.complete response.choices[0].message");
    const usage = asRecord(json["usage"], "OpenRouterProvider.complete response.usage");
    return {
      text: requiredString(message["content"], "OpenRouterProvider.complete response.choices[0].message.content"),
      model: verifiedProviderModel(
        this.#model,
        json["model"],
        "OpenRouterProvider.complete response.model",
      ),
      tier: req.tier,
      usage: {
        inputTokens: requiredTokenCount(usage["prompt_tokens"], "OpenRouterProvider.complete usage.prompt_tokens"),
        outputTokens: requiredTokenCount(
          usage["completion_tokens"],
          "OpenRouterProvider.complete usage.completion_tokens",
        ),
        cacheCreationInputTokens: 0,
        cacheReadInputTokens: 0,
        source: "provider",
      },
      taintLabel: modelRequestTaint(req),
    };
  }
  // No embed(): embeddings stay on the local plane (Ollama nomic-embed) per
  // the embedding_models registry default, same as GroqProvider.
}
