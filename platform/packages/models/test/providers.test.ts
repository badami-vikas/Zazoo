import { test } from "node:test";
import assert from "node:assert/strict";
import { OllamaProvider } from "../src/ollama-provider.js";
import { AnthropicProvider } from "../src/anthropic-provider.js";
import { GroqProvider } from "../src/groq-provider.js";
import {
  LlamaCppProvider,
  MANAGED_LLAMA_MODEL_ID,
} from "../src/llama-cpp-provider.js";
import type { FetchLike } from "../src/fetch-types.js";

/** Records requests, returns a caller-supplied protocol response. No network. */
function recordingFetch(responseBody: unknown) {
  const calls: Array<{ url: string; init?: Parameters<FetchLike>[1] }> = [];
  const impl: FetchLike = async (url, init) => {
    calls.push({ url, ...(init !== undefined ? { init } : {}) });
    return {
      ok: true,
      status: 200,
      json: async () => responseBody,
      text: async () => JSON.stringify(responseBody),
    };
  };
  return { impl, calls };
}

test("OllamaProvider shapes /api/generate requests and parses response", async () => {
  const { impl, calls } = recordingFetch({
    model: "m1",
    response: "the answer",
    prompt_eval_count: 7,
    eval_count: 3,
  });
  const p = new OllamaProvider({ baseUrl: "http://ollama.test:11434", model: "m1", fetchImpl: impl });
  assert.equal(p.plane, "local");

  const out = await p.complete({ system: "sys", prompt: "q", maxTokens: 42, tier: "default" });
  assert.equal(out.text, "the answer");
  assert.deepEqual(out.usage, {
    inputTokens: 7,
    outputTokens: 3,
    cacheCreationInputTokens: 0,
    cacheReadInputTokens: 0,
    source: "provider",
  });
  assert.equal(calls.length, 1);
  assert.equal(calls[0]!.url, "http://ollama.test:11434/api/generate");
  const body = JSON.parse(calls[0]!.init!.body!);
  assert.equal(body.model, "m1");
  assert.equal(body.prompt, "q");
  assert.equal(body.system, "sys");
  assert.equal(body.stream, false);
  assert.equal(body.options.num_predict, 42);
});

test("OllamaProvider omits system/options when absent", async () => {
  const { impl, calls } = recordingFetch({
    model: "llama3.1",
    response: "",
    prompt_eval_count: 1,
    eval_count: 0,
  });
  const p = new OllamaProvider({ baseUrl: "http://x", fetchImpl: impl });
  await p.complete({ prompt: "q", tier: "cheap" });
  const body = JSON.parse(calls[0]!.init!.body!);
  assert.equal("system" in body, false);
  assert.equal("options" in body, false);
});

test("LlamaCppProvider uses the capability file boundary and binds constrained JSON", async () => {
  const { impl, calls } = recordingFetch({
    model: MANAGED_LLAMA_MODEL_ID,
    choices: [{ message: { content: "{\"type\":\"answer\",\"text\":\"ready\"}" } }],
    usage: { prompt_tokens: 11, completion_tokens: 7 },
  });
  const provider = new LlamaCppProvider({
    readCapability: () => ({
      version: 1,
      baseUrl: "http://127.0.0.1:49152",
      apiKey: "a".repeat(64),
      model: MANAGED_LLAMA_MODEL_ID,
      runtimeRevision: "b10107",
      pid: 123,
    }),
    fetchImpl: impl,
  });
  const schema = {
    type: "object",
    properties: { type: { const: "answer" }, text: { type: "string" } },
    required: ["type", "text"],
    additionalProperties: false,
  };

  const completion = await provider.complete({
    system: "system",
    prompt: "hello",
    maxTokens: 128,
    tier: "cheap",
    responseFormat: {
      type: "json_schema",
      name: "chat_envelope",
      schema,
      strict: true,
    },
  });

  assert.equal(completion.model, MANAGED_LLAMA_MODEL_ID);
  assert.equal(completion.usage.inputTokens, 11);
  assert.equal(calls[0]!.url, "http://127.0.0.1:49152/v1/chat/completions");
  assert.equal(calls[0]!.init!.headers!.authorization, `Bearer ${"a".repeat(64)}`);
  const body = JSON.parse(calls[0]!.init!.body!);
  assert.deepEqual(body.messages, [
    { role: "system", content: "system" },
    { role: "user", content: "hello" },
  ]);
  assert.equal(body.max_tokens, 128);
  assert.equal(body.temperature, 0);
  assert.deepEqual(body.response_format, {
    type: "json_object",
    schema,
  });
});

test("LlamaCppProvider rejects stale, non-loopback, and relabeled capabilities", async () => {
  for (const capability of [
    {
      version: 1,
      baseUrl: "http://localhost:49152",
      apiKey: "a".repeat(64),
      model: MANAGED_LLAMA_MODEL_ID,
      runtimeRevision: "b10107",
      pid: 1,
    },
    {
      version: 1,
      baseUrl: "http://127.0.0.1:49152",
      apiKey: "a".repeat(64),
      model: "wrong-model",
      runtimeRevision: "b10107",
      pid: 1,
    },
  ]) {
    const provider = new LlamaCppProvider({
      readCapability: () => capability,
      fetchImpl: recordingFetch({}).impl,
    });
    assert.equal(provider.routingHealth(), "unavailable");
    await assert.rejects(
      () => provider.complete({ prompt: "q", tier: "cheap" }),
      /loopback|unexpected model identity/,
    );
  }
});

test("OllamaProvider shapes /api/embed requests", async () => {
  const { impl, calls } = recordingFetch({ embeddings: [[1, 2], [3, 4]] });
  const p = new OllamaProvider({ baseUrl: "http://x", embedModel: "emb", fetchImpl: impl });
  const vecs = await p.embed(["a", "b"]);
  assert.deepEqual(vecs, [[1, 2], [3, 4]]);
  assert.equal(calls[0]!.url, "http://x/api/embed");
  const body = JSON.parse(calls[0]!.init!.body!);
  assert.equal(body.model, "emb");
  assert.deepEqual(body.input, ["a", "b"]);
});

test("LlamaCppProvider authenticates health probes", async () => {
  const { impl, calls } = recordingFetch({});
  const provider = new LlamaCppProvider({
    readCapability: () => ({
      version: 1,
      baseUrl: "http://127.0.0.1:49152",
      apiKey: "a".repeat(64),
      model: MANAGED_LLAMA_MODEL_ID,
      runtimeRevision: "b9000",
      pid: 123,
    }),
    fetchImpl: impl,
  });

  assert.equal(await provider.probe(), "healthy");
  assert.equal(calls[0]!.url, "http://127.0.0.1:49152/health");
  assert.equal(
    calls[0]!.init!.headers!.authorization,
    `Bearer ${"a".repeat(64)}`,
  );
});

test("AnthropicProvider shapes /v1/messages requests with headers", async () => {
  const { impl, calls } = recordingFetch({
    model: "claude-fable-5",
    content: [{ type: "text", text: "hi " }, { type: "text", text: "there" }],
    usage: {
      input_tokens: 9,
      output_tokens: 2,
      cache_creation_input_tokens: 0,
      cache_read_input_tokens: 0,
    },
  });
  const p = new AnthropicProvider({ apiKey: "k-test", model: "claude-fable-5", fetchImpl: impl });
  assert.equal(p.plane, "cloud");

  const out = await p.complete({ system: "sys", prompt: "q", tier: "reasoning" });
  assert.equal(out.text, "hi there");
  assert.equal(out.model, "claude-fable-5");
  assert.equal(out.usage.inputTokens, 9);
  assert.equal(calls[0]!.url, "https://api.anthropic.com/v1/messages");
  const headers = calls[0]!.init!.headers!;
  assert.equal(headers["x-api-key"], "k-test");
  assert.equal(headers["anthropic-version"], "2023-06-01");
  const body = JSON.parse(calls[0]!.init!.body!);
  assert.equal(body.model, "claude-fable-5");
  assert.equal(body.system, "sys");
  assert.equal(body.max_tokens, 1024);
  assert.deepEqual(body.messages, [{ role: "user", content: "q" }]);
});

test("AnthropicProvider forces and returns a schema-constrained response", async () => {
  const response = recordingFetch({
    model: "claude-haiku-4-5-20251001",
    content: [{
      type: "tool_use",
      id: "call-1",
      name: "BridgeChatTurn",
      input: { kind: "answer", answer: "Ready." },
    }],
    usage: {
      input_tokens: 9,
      output_tokens: 4,
      cache_creation_input_tokens: 0,
      cache_read_input_tokens: 0,
    },
  });
  const provider = new AnthropicProvider({ apiKey: "k-test", fetchImpl: response.impl });
  const schema = {
    type: "object",
    additionalProperties: false,
    required: ["kind", "answer"],
    properties: {
      kind: { const: "answer" },
      answer: { type: "string" },
    },
  };

  const out = await provider.complete({
    prompt: "q",
    tier: "cheap",
    responseFormat: { type: "json_schema", name: "BridgeChatTurn", schema },
  });

  assert.deepEqual(JSON.parse(out.text), { kind: "answer", answer: "Ready." });
  const body = JSON.parse(response.calls[0]!.init!.body!);
  assert.deepEqual(body.tools, [{
    name: "BridgeChatTurn",
    description: "Return the response as this schema-valid object.",
    strict: true,
    input_schema: schema,
  }]);
  assert.deepEqual(body.tool_choice, {
    type: "tool",
    name: "BridgeChatTurn",
    disable_parallel_tool_use: true,
  });
});

test("AnthropicProvider normalizes protocol-null cache counts but rejects omitted counts", async () => {
  const response = {
    model: "claude-haiku-4-5-20251001",
    content: [{ type: "text", text: "hi" }],
    usage: {
      input_tokens: 9,
      output_tokens: 2,
      cache_creation_input_tokens: null,
      cache_read_input_tokens: null,
    },
  };
  const nullable = recordingFetch(response);
  const provider = new AnthropicProvider({ apiKey: "k-test", fetchImpl: nullable.impl });
  const completion = await provider.complete({ prompt: "q", tier: "cheap" });
  assert.equal(completion.usage.cacheCreationInputTokens, 0);
  assert.equal(completion.usage.cacheReadInputTokens, 0);

  const omitted = recordingFetch({
    ...response,
    usage: { input_tokens: 9, output_tokens: 2, cache_read_input_tokens: null },
  });
  const invalidProvider = new AnthropicProvider({ apiKey: "k-test", fetchImpl: omitted.impl });
  await assert.rejects(
    () => invalidProvider.complete({ prompt: "q", tier: "cheap" }),
    /cache_creation_input_tokens/,
  );
});

function anthropicPromptCacheProtocol() {
  const calls: Array<{ url: string; init?: Parameters<FetchLike>[1] }> = [];
  const cachedPrefixes = new Set<string>();
  const minimumTokens: Record<string, number> = {
    "claude-haiku-4-5": 4_096,
    "claude-haiku-4-5-20251001": 4_096,
    "claude-fable-5": 512,
  };
  const impl: FetchLike = async (url, init) => {
    calls.push({ url, ...(init !== undefined ? { init } : {}) });
    const body = JSON.parse(init?.body ?? "{}") as Record<string, unknown>;
    const model = typeof body.model === "string" ? body.model : "";
    const system = Array.isArray(body.system) ? body.system : [];
    const cachedBlock = system.find(
      (block): block is { type: string; text: string; cache_control: { type: string; ttl?: string } } =>
        typeof block === "object" &&
        block !== null &&
        (block as Record<string, unknown>)["type"] === "text" &&
        typeof (block as Record<string, unknown>)["text"] === "string" &&
        typeof (block as Record<string, unknown>)["cache_control"] === "object",
    );
    const prefixTokens = cachedBlock?.text.trim().split(/\s+/).filter(Boolean).length ?? 0;
    const cacheEligible = Boolean(cachedBlock) && prefixTokens >= (minimumTokens[model] ?? Number.POSITIVE_INFINITY);
    const prefixKey = JSON.stringify({ model, system });
    const cacheHit = cacheEligible && cachedPrefixes.has(prefixKey);
    if (cacheEligible) cachedPrefixes.add(prefixKey);

    return {
      ok: true,
      status: 200,
      json: async () => ({
        model,
        content: [{ type: "text", text: "jobpilot" }],
        usage: {
          input_tokens: 3,
          output_tokens: 1,
          cache_creation_input_tokens: cacheEligible && !cacheHit ? prefixTokens : 0,
          cache_read_input_tokens: cacheHit ? prefixTokens : 0,
        },
      }),
      text: async () => "",
    };
  };
  return { impl, calls };
}

test("AnthropicProvider caches only the stable system prefix and reports a second-call cache read", async () => {
  const { impl, calls } = anthropicPromptCacheProtocol();
  const provider = new AnthropicProvider({ apiKey: "k-test", fetchImpl: impl });
  const stablePrefix = Array.from({ length: 4_096 }, (_, index) => `policy-${index}`).join(" ");
  const request = {
    system: stablePrefix,
    prompt: "classify the first CoS turn",
    tier: "cheap" as const,
    cache: { strategy: "stable_system_prefix" as const, ttl: "5m" as const },
  };

  const first = await provider.complete(request);
  const second = await provider.complete({ ...request, prompt: "classify the second CoS turn" });

  assert.ok(first.usage.cacheCreationInputTokens > 0);
  assert.equal(first.usage.cacheReadInputTokens, 0);
  assert.ok(second.usage.cacheReadInputTokens > 0);
  assert.equal(second.usage.cacheCreationInputTokens, 0);
  const firstBody = JSON.parse(calls[0]!.init!.body!);
  const secondBody = JSON.parse(calls[1]!.init!.body!);
  assert.deepEqual(firstBody.system, secondBody.system, "the cache breakpoint must stay byte-identical");
  assert.notDeepEqual(firstBody.messages, secondBody.messages, "the volatile turn must remain outside the cached prefix");
  assert.deepEqual(firstBody.system[0].cache_control, { type: "ephemeral" });
});

test("AnthropicProvider fails loud without an API key", () => {
  const prev = process.env["ANTHROPIC_API_KEY"];
  delete process.env["ANTHROPIC_API_KEY"];
  try {
    assert.throws(() => new AnthropicProvider({}), /ANTHROPIC_API_KEY/);
  } finally {
    if (prev !== undefined) process.env["ANTHROPIC_API_KEY"] = prev;
  }
});

test("GroqProvider shapes /chat/completions requests with bearer auth", async () => {
  const { impl, calls } = recordingFetch({
    model: "llama-3.3-70b-versatile",
    choices: [{ message: { content: "hi there" } }],
    usage: { prompt_tokens: 5, completion_tokens: 2, total_tokens: 7 },
  });
  const p = new GroqProvider({ apiKey: "k-test", model: "llama-3.3-70b-versatile", fetchImpl: impl });
  assert.equal(p.plane, "cloud");

  const out = await p.complete({ system: "sys", prompt: "q", tier: "cheap" });
  assert.equal(out.text, "hi there");
  assert.equal(out.usage.inputTokens, 5);
  assert.equal(out.usage.outputTokens, 2);
  assert.equal(calls[0]!.url, "https://api.groq.com/openai/v1/chat/completions");
  const headers = calls[0]!.init!.headers!;
  assert.equal(headers["authorization"], "Bearer k-test");
  const body = JSON.parse(calls[0]!.init!.body!);
  assert.equal(body.model, "llama-3.3-70b-versatile");
  assert.equal(body.max_tokens, 1024);
  assert.deepEqual(body.messages, [
    { role: "system", content: "sys" },
    { role: "user", content: "q" },
  ]);
});

test("GroqProvider forwards strict JSON Schema output", async () => {
  const response = recordingFetch({
    model: "openai/gpt-oss-20b",
    choices: [{ message: { content: "{\"kind\":\"answer\",\"answer\":\"Ready.\"}" } }],
    usage: { prompt_tokens: 5, completion_tokens: 2 },
  });
  const provider = new GroqProvider({ apiKey: "k-test", fetchImpl: response.impl });
  const schema = {
    type: "object",
    required: ["kind", "answer"],
    properties: { kind: { const: "answer" }, answer: { type: "string" } },
  };

  await provider.complete({
    prompt: "q",
    tier: "cheap",
    responseFormat: { type: "json_schema", name: "BridgeChatTurn", schema },
  });

  const body = JSON.parse(response.calls[0]!.init!.body!);
  assert.deepEqual(body.response_format, {
    type: "json_schema",
    json_schema: { name: "BridgeChatTurn", schema, strict: true },
  });
});

test("GroqProvider rejects JSON Schema output on incompatible configured models", async () => {
  const provider = new GroqProvider({
    apiKey: "k-test",
    model: "llama-3.3-70b-versatile",
    fetchImpl: recordingFetch({}).impl,
  });

  await assert.rejects(
    () =>
      provider.complete({
        prompt: "q",
        tier: "cheap",
        responseFormat: {
          type: "json_schema",
          name: "BridgeChatTurn",
          schema: { type: "object" },
        },
      }),
    /does not support strict JSON Schema output/,
  );
});

test("GroqProvider fails loud without an API key", () => {
  const prev = process.env["GROQ_API_KEY"];
  delete process.env["GROQ_API_KEY"];
  try {
    assert.throws(() => new GroqProvider({}), /GROQ_API_KEY/);
  } finally {
    if (prev !== undefined) process.env["GROQ_API_KEY"] = prev;
  }
});

test("provider errors surface status without retaining provider response content", async () => {
  let bodyReads = 0;
  const impl: FetchLike = async () => ({
    ok: false,
    status: 503,
    json: async () => ({}),
    text: async () => {
      bodyReads += 1;
      return "sensitive-provider-response";
    },
  });
  const providers = [
    new AnthropicProvider({ apiKey: "k-test", fetchImpl: impl }),
    new GroqProvider({ apiKey: "k-test", fetchImpl: impl }),
    new OllamaProvider({ baseUrl: "http://x", fetchImpl: impl }),
  ];
  for (const provider of providers) {
    await assert.rejects(
      () => provider.complete({ prompt: "q", tier: "cheap" }),
      (error: unknown) =>
        error instanceof Error &&
        error.message.includes("status 503") &&
        !error.message.includes("sensitive-provider-response"),
    );
  }
  assert.equal(bodyReads, 0);
});

test("providers fail loud when authoritative usage counts are absent", async () => {
  const { impl } = recordingFetch({ model: "llama3.1", response: "answer" });
  const provider = new OllamaProvider({ baseUrl: "http://x", fetchImpl: impl });
  await assert.rejects(
    () => provider.complete({ prompt: "q", tier: "default" }),
    /prompt_eval_count/,
  );
});

test("providers reject a response that relabels the configured model", async () => {
  const anthropic = recordingFetch({
    model: "provider-spoof",
    content: [{ type: "text", text: "answer" }],
    usage: {
      input_tokens: 1,
      output_tokens: 1,
      cache_creation_input_tokens: 0,
      cache_read_input_tokens: 0,
    },
  });
  await assert.rejects(
    () =>
      new AnthropicProvider({
        apiKey: "k-test",
        model: "claude-fable-5",
        fetchImpl: anthropic.impl,
      }).complete({ prompt: "q", tier: "default" }),
    /unexpected model identity/,
  );

  const groq = recordingFetch({
    model: "provider-spoof",
    choices: [{ message: { content: "answer" } }],
    usage: { prompt_tokens: 1, completion_tokens: 1 },
  });
  await assert.rejects(
    () =>
      new GroqProvider({
        apiKey: "k-test",
        model: "llama-3.3-70b-versatile",
        fetchImpl: groq.impl,
      }).complete({ prompt: "q", tier: "cheap" }),
    /unexpected model identity/,
  );

  const ollama = recordingFetch({
    model: "provider-spoof",
    response: "answer",
    prompt_eval_count: 1,
    eval_count: 1,
  });
  await assert.rejects(
    () =>
      new OllamaProvider({
        baseUrl: "http://x",
        model: "llama3.1",
        fetchImpl: ollama.impl,
      }).complete({ prompt: "q", tier: "default" }),
    /unexpected model identity/,
  );
});
