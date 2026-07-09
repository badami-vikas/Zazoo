/**
 * GroqProvider — CLOUD-plane ModelProvider implementation. Groq's OpenAI-
 * compatible chat-completions endpoint, chosen for low-latency inference
 * (e.g. Chief of Staff intent classification). Same rules as AnthropicProvider:
 * NO API key on any manifest/capability, key comes from env at construction,
 * two-plane gate applies (capture/sensor plane must never bind this provider —
 * createModelRouter enforces planeDefault, not this class).
 */
import type { ModelProvider } from "@bridge/core";
import { defaultFetch, type FetchLike } from "./fetch-types.js";

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
    this.#model = opts.model ?? process.env["GROQ_MODEL"] ?? DEFAULT_MODEL;
    this.#baseUrl = opts.baseUrl ?? GROQ_URL;
    this.#fetchImpl = opts.fetchImpl ?? defaultFetch;
  }

  async complete(req: { system?: string; prompt: string; maxTokens?: number }): Promise<{ text: string }> {
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
      throw new Error(`GroqProvider.complete: ${res.status} ${await res.text()}`);
    }
    const json = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
    const text = json.choices?.[0]?.message?.content ?? "";
    return { text };
  }
  // No embed(): Groq's public API is chat/completion-focused; embeddings stay
  // on the local plane (Ollama nomic-embed) per the embedding_models registry default.
}
