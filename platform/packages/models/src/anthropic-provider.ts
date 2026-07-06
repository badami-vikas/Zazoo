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
import type { ModelProvider } from "@bridge/core";
import { defaultFetch, type FetchLike } from "./fetch-types.js";

export interface AnthropicProviderOpts {
  apiKey?: string;
  model?: string;
  baseUrl?: string;
  fetchImpl?: FetchLike;
}

const ANTHROPIC_URL = "https://api.anthropic.com";
const DEFAULT_MODEL = "claude-fable-5";

export class AnthropicProvider implements ModelProvider {
  readonly id = "anthropic";
  readonly plane = "cloud" as const;
  readonly #apiKey: string;
  readonly #model: string;
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
    this.#model = opts.model ?? process.env["ANTHROPIC_MODEL"] ?? DEFAULT_MODEL;
    this.#baseUrl = opts.baseUrl ?? ANTHROPIC_URL;
    this.#fetchImpl = opts.fetchImpl ?? defaultFetch;
  }

  async complete(req: { system?: string; prompt: string; maxTokens?: number }): Promise<{ text: string }> {
    const body = {
      model: this.#model,
      max_tokens: req.maxTokens ?? 1024,
      ...(req.system !== undefined ? { system: req.system } : {}),
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
      throw new Error(`AnthropicProvider.complete: ${res.status} ${await res.text()}`);
    }
    const json = (await res.json()) as { content?: Array<{ type: string; text?: string }> };
    const text = (json.content ?? [])
      .filter((b) => b.type === "text")
      .map((b) => b.text ?? "")
      .join("");
    return { text };
  }
  // No embed(): the Messages API is completion-only; embeddings stay on the
  // local plane (Ollama nomic-embed) per the embedding_models registry default.
}
