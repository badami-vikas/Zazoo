/**
 * OllamaProvider — LOCAL-plane ModelProvider implementation. Ollama is the
 * dev-default per CLAUDE.md ("Models: `ModelProvider` seam (Ollama dev,
 * configurable prod, Claude default; capture/sensor plane = local models
 * default)"). Talks to Ollama's HTTP API (`/api/generate`, `/api/embed`) —
 * never any other model SDK — so swapping the local runtime later only means
 * swapping this one file.
 */
import type { ModelProvider } from "@bridge/core";
import { defaultFetch, type FetchLike } from "./fetch-types.js";

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
  readonly #baseUrl: string;
  readonly #model: string;
  readonly #embedModel: string;
  readonly #fetchImpl: FetchLike;

  constructor(opts: OllamaProviderOpts = {}) {
    this.#baseUrl = opts.baseUrl ?? process.env["OLLAMA_URL"] ?? DEFAULT_OLLAMA_URL;
    this.#model = opts.model ?? process.env["OLLAMA_MODEL"] ?? "llama3.1";
    this.#embedModel = opts.embedModel ?? process.env["OLLAMA_EMBED_MODEL"] ?? "nomic-embed-text";
    this.#fetchImpl = opts.fetchImpl ?? defaultFetch;
  }

  async complete(req: { system?: string; prompt: string; maxTokens?: number }): Promise<{ text: string }> {
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
      throw new Error(`OllamaProvider.complete: ${res.status} ${await res.text()}`);
    }
    const json = (await res.json()) as { response?: string };
    return { text: json.response ?? "" };
  }

  async embed(texts: string[]): Promise<number[][]> {
    const body = { model: this.#embedModel, input: texts };
    const res = await this.#fetchImpl(`${this.#baseUrl}/api/embed`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      throw new Error(`OllamaProvider.embed: ${res.status} ${await res.text()}`);
    }
    const json = (await res.json()) as { embeddings?: number[][] };
    return json.embeddings ?? [];
  }
}
