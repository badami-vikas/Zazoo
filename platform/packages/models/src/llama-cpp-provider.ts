import { readFileSync } from "node:fs";
import {
  MODEL_TIERS,
  assertModelCompletionRequest,
  modelRequestTaint,
  type ModelCompletion,
  type ModelCompletionRequest,
  type ModelProvider,
  type ModelProviderHealth,
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

export const MANAGED_LLAMA_PROVIDER_ID = "llama.cpp";
export const MANAGED_LLAMA_MODEL_ID = "qwen3-4b-instruct-2507-q4_k_m";

export interface LlamaCppCapability {
  version: 1;
  baseUrl: string;
  apiKey: string;
  model: string;
  runtimeRevision: string;
  pid: number;
}

export interface LlamaCppProviderOpts {
  capabilityFile?: string;
  model?: string;
  timeoutMs?: number;
  fetchImpl?: FetchLike;
  readCapability?: () => unknown;
}

function parseCapability(value: unknown, expectedModel: string): LlamaCppCapability {
  const record = asRecord(value, "LlamaCppProvider capability");
  const baseUrl = requiredString(record["baseUrl"], "LlamaCppProvider capability.baseUrl");
  const parsed = new URL(baseUrl);
  if (
    parsed.protocol !== "http:" ||
    parsed.hostname !== "127.0.0.1" ||
    parsed.username ||
    parsed.password ||
    parsed.pathname !== "/" ||
    parsed.search ||
    parsed.hash
  ) {
    throw new Error("LlamaCppProvider capability.baseUrl must be an uncredentialed IPv4 loopback origin");
  }
  const port = Number(parsed.port);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error("LlamaCppProvider capability.baseUrl must include a valid ephemeral port");
  }
  const model = verifiedProviderModel(
    expectedModel,
    record["model"],
    "LlamaCppProvider capability.model",
  );
  const apiKey = requiredString(record["apiKey"], "LlamaCppProvider capability.apiKey");
  if (apiKey.length < 32 || apiKey.length > 512) {
    throw new Error("LlamaCppProvider capability.apiKey has an invalid length");
  }
  const pid = record["pid"];
  if (!Number.isSafeInteger(pid) || (pid as number) <= 0) {
    throw new Error("LlamaCppProvider capability.pid must be a positive integer");
  }
  if (record["version"] !== 1) {
    throw new Error("LlamaCppProvider capability.version is unsupported");
  }
  return {
    version: 1,
    baseUrl: parsed.origin,
    apiKey,
    model,
    runtimeRevision: requiredString(
      record["runtimeRevision"],
      "LlamaCppProvider capability.runtimeRevision",
    ),
    pid: pid as number,
  };
}

export class LlamaCppProvider implements ModelProvider {
  readonly id = MANAGED_LLAMA_PROVIDER_ID;
  readonly plane = "local" as const;
  readonly tiers = MODEL_TIERS;
  readonly models: Readonly<Record<(typeof MODEL_TIERS)[number], string>>;
  readonly #model: string;
  readonly #fetchImpl: FetchLike;
  readonly #readCapability: () => unknown;
  readonly #timeoutMs: number;
  #lastHealth: ModelProviderHealth = "unknown";

  constructor(opts: LlamaCppProviderOpts = {}) {
    this.#model = configuredModelId(
      opts.model ?? MANAGED_LLAMA_MODEL_ID,
      "LlamaCppProvider model",
    );
    this.models = {
      cheap: this.#model,
      default: this.#model,
      reasoning: this.#model,
    };
    const capabilityFile =
      opts.capabilityFile ?? process.env["BRIDGE_LLAMA_CAPABILITY_FILE"];
    this.#readCapability =
      opts.readCapability ??
      (() => {
        if (!capabilityFile) {
          throw new Error("BRIDGE_LLAMA_CAPABILITY_FILE is not configured");
        }
        return JSON.parse(readFileSync(capabilityFile, "utf8")) as unknown;
      });
    this.#fetchImpl = opts.fetchImpl ?? defaultFetch;
    this.#timeoutMs = opts.timeoutMs ?? 120_000;
  }

  routingHealth(): ModelProviderHealth {
    try {
      parseCapability(this.#readCapability(), this.#model);
      return this.#lastHealth === "unavailable" ? "degraded" : "healthy";
    } catch {
      return "unavailable";
    }
  }

  async probe(): Promise<ModelProviderHealth> {
    let capability: LlamaCppCapability;
    try {
      capability = parseCapability(this.#readCapability(), this.#model);
    } catch {
      this.#lastHealth = "unavailable";
      return this.#lastHealth;
    }
    try {
      const response = await this.#fetchImpl(`${capability.baseUrl}/health`, {
        method: "GET",
        headers: {
          authorization: `Bearer ${capability.apiKey}`,
        },
        signal: AbortSignal.timeout(Math.min(this.#timeoutMs, 5_000)),
      });
      this.#lastHealth = response.ok ? "healthy" : "degraded";
    } catch {
      this.#lastHealth = "unavailable";
    }
    return this.#lastHealth;
  }

  async complete(req: ModelCompletionRequest): Promise<ModelCompletion> {
    assertModelCompletionRequest(req, "LlamaCppProvider.complete");
    const capability = parseCapability(this.#readCapability(), this.#model);
    const timeout = AbortSignal.timeout(this.#timeoutMs);
    const signal = req.signal
      ? AbortSignal.any([req.signal, timeout])
      : timeout;
    const body = {
      model: this.#model,
      messages: [
        ...(req.system !== undefined
          ? [{ role: "system" as const, content: req.system }]
          : []),
        { role: "user" as const, content: req.prompt },
      ],
      stream: false,
      ...(req.maxTokens !== undefined ? { max_tokens: req.maxTokens } : {}),
      ...(req.responseFormat
        ? {
            temperature: 0,
            response_format: {
              type: "json_object",
              schema: req.responseFormat.schema,
            },
          }
        : {}),
    };
    let response;
    try {
      response = await this.#fetchImpl(
        `${capability.baseUrl}/v1/chat/completions`,
        {
          method: "POST",
          headers: {
            authorization: `Bearer ${capability.apiKey}`,
            "content-type": "application/json",
          },
          body: JSON.stringify(body),
          signal,
        },
      );
    } catch (error) {
      this.#lastHealth = "unavailable";
      throw error;
    }
    if (!response.ok) {
      this.#lastHealth = response.status >= 500 ? "degraded" : "healthy";
      throw providerRequestError("LlamaCppProvider.complete", response.status);
    }
    const json = asRecord(
      await response.json(),
      "LlamaCppProvider.complete response",
    );
    const choices = json["choices"];
    if (!Array.isArray(choices) || choices.length !== 1) {
      throw new Error(
        "LlamaCppProvider.complete response.choices: expected exactly one choice",
      );
    }
    const choice = asRecord(
      choices[0],
      "LlamaCppProvider.complete response.choices[0]",
    );
    const message = asRecord(
      choice["message"],
      "LlamaCppProvider.complete response.choices[0].message",
    );
    const usage = asRecord(
      json["usage"],
      "LlamaCppProvider.complete response.usage",
    );
    this.#lastHealth = "healthy";
    return {
      text: requiredString(
        message["content"],
        "LlamaCppProvider.complete response.choices[0].message.content",
      ),
      model: verifiedProviderModel(
        this.#model,
        json["model"],
        "LlamaCppProvider.complete response.model",
      ),
      tier: req.tier,
      usage: {
        inputTokens: requiredTokenCount(
          usage["prompt_tokens"],
          "LlamaCppProvider.complete response.usage.prompt_tokens",
        ),
        outputTokens: requiredTokenCount(
          usage["completion_tokens"],
          "LlamaCppProvider.complete response.usage.completion_tokens",
        ),
        cacheCreationInputTokens: 0,
        cacheReadInputTokens: 0,
        source: "provider",
      },
      taintLabel: modelRequestTaint(req),
    };
  }
}
