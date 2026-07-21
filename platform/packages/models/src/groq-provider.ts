/**
 * GroqProvider — CLOUD-plane ModelProvider implementation. Groq's OpenAI-
 * compatible chat-completions endpoint, chosen for low-latency inference
 * (e.g. Chief of Staff intent classification). Same rules as AnthropicProvider:
 * NO API key on any manifest/capability, key comes from env at construction,
 * two-plane gate applies (capture/sensor plane must never bind this provider —
 * createModelRouter enforces planeDefault, not this class).
 */
import {
  assertModelCompletionRequest,
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

export interface GroqProviderOpts {
  apiKey?: string;
  model?: string;
  baseUrl?: string;
  fetchImpl?: FetchLike;
}

const GROQ_URL = "https://api.groq.com/openai/v1";
const DEFAULT_MODEL = "llama-3.3-70b-versatile";

export class GroqProvider implements ModelProvider {
  readonly id = "groq";
  readonly plane = "cloud" as const;
  readonly tiers = ["cheap", "default"] as const satisfies readonly ModelTier[];
  readonly models: Readonly<Partial<Record<ModelTier, string>>>;
  readonly #apiKey: string;
  readonly #model: string;
  readonly #baseUrl: string;
  readonly #fetchImpl: FetchLike;

  constructor(opts: GroqProviderOpts = {}) {
    const key = opts.apiKey ?? process.env["GROQ_API_KEY"];
    if (!key) {
      // Fail loud at construction, matching AnthropicProvider's convention.
      throw new Error("GroqProvider requires an API key (GROQ_API_KEY)");
    }
    this.#apiKey = key;
    this.#model = configuredModelId(
      opts.model ?? process.env["GROQ_MODEL"] ?? DEFAULT_MODEL,
      "GroqProvider model",
    );
    this.models = { cheap: this.#model, default: this.#model };
    this.#baseUrl = opts.baseUrl ?? GROQ_URL;
    this.#fetchImpl = opts.fetchImpl ?? defaultFetch;
  }

  routingHealth() {
    return "unknown" as const;
  }

  async complete(req: ModelCompletionRequest): Promise<ModelCompletion> {
    assertModelCompletionRequest(req, "GroqProvider.complete");
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
      }),
    });
    if (!res.ok) {
      throw providerRequestError("GroqProvider.complete", res.status);
    }
    const json = asRecord(await res.json(), "GroqProvider.complete response");
    const choices = json["choices"];
    if (!Array.isArray(choices) || choices.length === 0) {
      throw new Error("GroqProvider.complete response.choices: expected a non-empty array");
    }
    const firstChoice = asRecord(choices[0], "GroqProvider.complete response.choices[0]");
    const message = asRecord(firstChoice["message"], "GroqProvider.complete response.choices[0].message");
    const usage = asRecord(json["usage"], "GroqProvider.complete response.usage");
    return {
      text: requiredString(message["content"], "GroqProvider.complete response.choices[0].message.content"),
      model: verifiedProviderModel(
        this.#model,
        json["model"],
        "GroqProvider.complete response.model",
      ),
      tier: req.tier,
      usage: {
        inputTokens: requiredTokenCount(usage["prompt_tokens"], "GroqProvider.complete usage.prompt_tokens"),
        outputTokens: requiredTokenCount(
          usage["completion_tokens"],
          "GroqProvider.complete usage.completion_tokens",
        ),
        cacheCreationInputTokens: 0,
        cacheReadInputTokens: 0,
        source: "provider",
      },
    };
  }
  // No embed(): Groq's public API is chat/completion-focused; embeddings stay
  // on the local plane (Ollama nomic-embed) per the embedding_models registry default.
}
