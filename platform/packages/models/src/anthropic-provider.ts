/**
 * AnthropicProvider — CLOUD-plane ModelProvider implementation (Claude is the
 * configurable-prod default per CLAUDE.md). Talks straight to the Messages
 * API over the injected fetch. Being `plane: "cloud"` means the two-plane
 * gate applies to any action routed here: capture/sensor-plane work must NOT
 * bind this provider (createModelRouter enforces the planeDefault), and
 * binding it never grants egress by itself — the Authority resolver still
 * gates the surrounding pipeline action.
 *
 * NO API key is stored on the manifest or in any capability — the key comes
 * from env at construction (credential-broker territory later), consistent
 * with "tools never own OAuth/secrets".
 */
import {
  MODEL_TIERS,
  type ModelCompletion,
  type ModelCompletionRequest,
  type ModelProvider,
  type ModelTier,
  type ModelTokenPricing,
} from "@bridge/core";
import { defaultFetch, type FetchLike } from "./fetch-types.js";
import {
  asRecord,
  nullableTokenCount,
  providerRequestError,
  requiredString,
  requiredTokenCount,
} from "./usage.js";

export interface AnthropicProviderOpts {
  apiKey?: string;
  /** Backward-compatible global override: when set, every tier uses this model. */
  model?: string;
  /** Tier-specific overrides take precedence over `model`. */
  models?: Partial<Record<ModelTier, string>>;
  baseUrl?: string;
  fetchImpl?: FetchLike;
}

const ANTHROPIC_URL = "https://api.anthropic.com";
const DEFAULT_MODEL = "claude-fable-5";
const DEFAULT_MODELS: Record<ModelTier, string> = {
  cheap: "claude-haiku-4-5",
  default: DEFAULT_MODEL,
  reasoning: DEFAULT_MODEL,
};
const PRICING_SOURCE = "https://platform.claude.com/docs/en/build-with-claude/prompt-caching";
const PRICING_AS_OF = "2026-07-18";
const KNOWN_PRICING: Readonly<Record<string, Omit<ModelTokenPricing, "source" | "asOf">>> = {
  "claude-haiku-4-5": {
    inputUsdPerMillion: 1,
    outputUsdPerMillion: 5,
    cacheCreationInputUsdPerMillion: 1.25,
    cacheReadInputUsdPerMillion: 0.1,
  },
  "claude-fable-5": {
    inputUsdPerMillion: 10,
    outputUsdPerMillion: 50,
    cacheCreationInputUsdPerMillion: 12.5,
    cacheReadInputUsdPerMillion: 1,
  },
};

export class AnthropicProvider implements ModelProvider {
  readonly id = "anthropic";
  readonly plane = "cloud" as const;
  readonly tiers = MODEL_TIERS;
  readonly pricing: Readonly<Partial<Record<ModelTier, ModelTokenPricing>>>;
  readonly #apiKey: string;
  readonly #models: Readonly<Record<ModelTier, string>>;
  readonly #baseUrl: string;
  readonly #fetchImpl: FetchLike;

  constructor(opts: AnthropicProviderOpts = {}) {
    const key = opts.apiKey ?? process.env["ANTHROPIC_API_KEY"];
    if (!key) {
      // Fail loud at construction, not at first call — same "env-bound, fail
      // loud" rule the recorder sidecar port applies to its base URL.
      throw new Error("AnthropicProvider requires an API key (ANTHROPIC_API_KEY)");
    }
    this.#apiKey = key;
    const globalModel = opts.model ?? process.env["ANTHROPIC_MODEL"];
    this.#models = {
      cheap: opts.models?.cheap ?? process.env["ANTHROPIC_CHEAP_MODEL"] ?? globalModel ?? DEFAULT_MODELS.cheap,
      default: opts.models?.default ?? globalModel ?? DEFAULT_MODELS.default,
      reasoning:
        opts.models?.reasoning ??
        process.env["ANTHROPIC_REASONING_MODEL"] ??
        globalModel ??
        DEFAULT_MODELS.reasoning,
    };
    const pricing: Partial<Record<ModelTier, ModelTokenPricing>> = {};
    for (const tier of MODEL_TIERS) {
      const rates = KNOWN_PRICING[this.#models[tier]];
      if (rates) pricing[tier] = { ...rates, source: PRICING_SOURCE, asOf: PRICING_AS_OF };
    }
    this.pricing = pricing;
    this.#baseUrl = opts.baseUrl ?? ANTHROPIC_URL;
    this.#fetchImpl = opts.fetchImpl ?? defaultFetch;
  }

  async complete(req: ModelCompletionRequest): Promise<ModelCompletion> {
    if (req.cache && req.system === undefined) {
      throw new Error("AnthropicProvider.complete: stable-system-prefix caching requires a system prompt");
    }
    const model = this.#models[req.tier];
    const system =
      req.system === undefined
        ? undefined
        : req.cache
          ? [
              {
                type: "text",
                text: req.system,
                cache_control: {
                  type: "ephemeral",
                },
              },
            ]
          : req.system;
    const body = {
      model,
      max_tokens: req.maxTokens ?? 1024,
      ...(system !== undefined ? { system } : {}),
      messages: [{ role: "user", content: req.prompt }],
    };
    const res = await this.#fetchImpl(`${this.#baseUrl}/v1/messages`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": this.#apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      throw providerRequestError("AnthropicProvider.complete", res.status);
    }
    const json = asRecord(await res.json(), "AnthropicProvider.complete response");
    const content = json["content"];
    if (!Array.isArray(content)) throw new Error("AnthropicProvider.complete response.content: expected an array");
    const text = content
      .map((block) => asRecord(block, "AnthropicProvider.complete response.content block"))
      .filter((block) => block["type"] === "text")
      .map((block) => requiredString(block["text"], "AnthropicProvider.complete response.content.text"))
      .join("");
    const usage = asRecord(json["usage"], "AnthropicProvider.complete response.usage");
    return {
      text,
      model: requiredString(json["model"], "AnthropicProvider.complete response.model"),
      tier: req.tier,
      usage: {
        inputTokens: requiredTokenCount(usage["input_tokens"], "AnthropicProvider.complete usage.input_tokens"),
        outputTokens: requiredTokenCount(usage["output_tokens"], "AnthropicProvider.complete usage.output_tokens"),
        cacheCreationInputTokens: nullableTokenCount(
          usage["cache_creation_input_tokens"],
          "AnthropicProvider.complete usage.cache_creation_input_tokens",
        ),
        cacheReadInputTokens: nullableTokenCount(
          usage["cache_read_input_tokens"],
          "AnthropicProvider.complete usage.cache_read_input_tokens",
        ),
        source: "provider",
      },
    };
  }
  // No embed(): the Messages API is completion-only; embeddings stay on the
  // local plane (Ollama nomic-embed) per the embedding_models registry default.
}
