/**
 * OllamaProvider — LOCAL-plane ModelProvider implementation. Ollama is the
 * dev-default per CLAUDE.md ("Models: `ModelProvider` seam (Ollama dev,
 * configurable prod, Claude default; capture/sensor plane = local models
 * default)"). Talks to Ollama's HTTP API (`/api/generate`, `/api/embed`) —
 * never any other model SDK — so swapping the local runtime later only means
 * swapping this one file.
 */
import {
  MODEL_TIERS,
  assertModelCompletionRequest,
  type ModelCompletion,
  type ModelCompletionRequest,
  type ModelProvider,
} from "@bridge/core";
import { defaultFetch, type FetchLike } from "./fetch-types.js";
import {
  asRecord,
  configuredModelId,
  providerRequestError,
  requiredString,
  requiredTokenCount,
  verifiedProviderModel,
} from "./usage.js";

export interface OllamaProviderOpts {
  /** Base URL for the Ollama daemon. Defaults to OLLAMA_URL env or the
   * standard local port — this is the ONE place in the kernel a literal
   * localhost default is acceptable, since Ollama is inherently a local-plane
   * daemon (never reached across the egress gate). */
  baseUrl?: string;
  model?: string;
  embedModel?: string;
  fetchImpl?: FetchLike;
}

const DEFAULT_OLLAMA_URL = "http://localhost:11434";

export class OllamaProvider implements ModelProvider {
  readonly id = "ollama";
  readonly plane = "local" as const;
  readonly tiers = MODEL_TIERS;
  readonly models: Readonly<Record<(typeof MODEL_TIERS)[number], string>>;
  readonly #baseUrl: string;
  readonly #model: string;
  readonly #embedModel: string;
  readonly #fetchImpl: FetchLike;

  constructor(opts: OllamaProviderOpts = {}) {
    this.#baseUrl = opts.baseUrl ?? process.env["OLLAMA_URL"] ?? DEFAULT_OLLAMA_URL;
    this.#model = configuredModelId(
      opts.model ?? process.env["OLLAMA_MODEL"] ?? "llama3.1",
      "OllamaProvider model",
    );
    this.models = {
      cheap: this.#model,
      default: this.#model,
      reasoning: this.#model,
    };
    this.#embedModel = configuredModelId(
      opts.embedModel ?? process.env["OLLAMA_EMBED_MODEL"] ?? "nomic-embed-text",
      "OllamaProvider embed model",
    );
    this.#fetchImpl = opts.fetchImpl ?? defaultFetch;
  }

  routingHealth() {
    return "unknown" as const;
  }

  async complete(req: ModelCompletionRequest): Promise<ModelCompletion> {
    assertModelCompletionRequest(req, "OllamaProvider.complete");
    const body = {
      model: this.#model,
      prompt: req.prompt,
      ...(req.system !== undefined ? { system: req.system } : {}),
      stream: false,
      ...(req.maxTokens !== undefined ? { options: { num_predict: req.maxTokens } } : {}),
    };
    const res = await this.#fetchImpl(`${this.#baseUrl}/api/generate`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      throw providerRequestError("OllamaProvider.complete", res.status);
    }
    const json = asRecord(await res.json(), "OllamaProvider.complete response");
    return {
      text: requiredString(json["response"], "OllamaProvider.complete response.response"),
      model: verifiedProviderModel(
        this.#model,
        json["model"],
        "OllamaProvider.complete response.model",
      ),
      tier: req.tier,
      usage: {
        inputTokens: requiredTokenCount(
          json["prompt_eval_count"],
          "OllamaProvider.complete response.prompt_eval_count",
        ),
        outputTokens: requiredTokenCount(json["eval_count"], "OllamaProvider.complete response.eval_count"),
        cacheCreationInputTokens: 0,
        cacheReadInputTokens: 0,
        source: "provider",
      },
    };
  }

  async embed(texts: string[]): Promise<number[][]> {
    const body = { model: this.#embedModel, input: texts };
    const res = await this.#fetchImpl(`${this.#baseUrl}/api/embed`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      throw providerRequestError("OllamaProvider.embed", res.status);
    }
    const json = asRecord(await res.json(), "OllamaProvider.embed response");
    const embeddings = json["embeddings"];
    if (!Array.isArray(embeddings)) throw new Error("OllamaProvider.embed response.embeddings: expected an array");
    return embeddings.map((vector, index) => {
      if (!Array.isArray(vector) || !vector.every((value) => typeof value === "number" && Number.isFinite(value))) {
        throw new Error(`OllamaProvider.embed response.embeddings[${index}]: expected finite numbers`);
      }
      return vector;
    });
  }
}
