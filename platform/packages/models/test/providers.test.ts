import { test } from "node:test";
import assert from "node:assert/strict";
import { OllamaProvider } from "../src/ollama-provider.js";
import { AnthropicProvider } from "../src/anthropic-provider.js";
import { GroqProvider } from "../src/groq-provider.js";
import type { FetchLike } from "../src/fetch-types.js";

/** Records requests, returns a canned JSON body. No network ever. */
function fakeFetch(responseBody: unknown) {
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
  const { impl, calls } = fakeFetch({ response: "the answer" });
  const p = new OllamaProvider({ baseUrl: "http://ollama.test:11434", model: "m1", fetchImpl: impl });
  assert.equal(p.plane, "local");

  const out = await p.complete({ system: "sys", prompt: "q", maxTokens: 42 });
  assert.equal(out.text, "the answer");
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
  const { impl, calls } = fakeFetch({ response: "" });
  const p = new OllamaProvider({ baseUrl: "http://x", fetchImpl: impl });
  await p.complete({ prompt: "q" });
  const body = JSON.parse(calls[0]!.init!.body!);
  assert.equal("system" in body, false);
  assert.equal("options" in body, false);
});

test("OllamaProvider shapes /api/embed requests", async () => {
  const { impl, calls } = fakeFetch({ embeddings: [[1, 2], [3, 4]] });
  const p = new OllamaProvider({ baseUrl: "http://x", embedModel: "emb", fetchImpl: impl });
  const vecs = await p.embed(["a", "b"]);
  assert.deepEqual(vecs, [[1, 2], [3, 4]]);
  assert.equal(calls[0]!.url, "http://x/api/embed");
  const body = JSON.parse(calls[0]!.init!.body!);
  assert.equal(body.model, "emb");
  assert.deepEqual(body.input, ["a", "b"]);
});

test("AnthropicProvider shapes /v1/messages requests with headers", async () => {
  const { impl, calls } = fakeFetch({ content: [{ type: "text", text: "hi " }, { type: "text", text: "there" }] });
  const p = new AnthropicProvider({ apiKey: "k-test", model: "claude-fable-5", fetchImpl: impl });
  assert.equal(p.plane, "cloud");

  const out = await p.complete({ system: "sys", prompt: "q" });
  assert.equal(out.text, "hi there");
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
  const { impl, calls } = fakeFetch({ choices: [{ message: { content: "hi there" } }] });
  const p = new GroqProvider({ apiKey: "k-test", model: "llama-3.3-70b-versatile", fetchImpl: impl });
  assert.equal(p.plane, "cloud");

  const out = await p.complete({ system: "sys", prompt: "q" });
  assert.equal(out.text, "hi there");
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

test("GroqProvider fails loud without an API key", () => {
  const prev = process.env["GROQ_API_KEY"];
  delete process.env["GROQ_API_KEY"];
  try {
    assert.throws(() => new GroqProvider({}), /GROQ_API_KEY/);
  } finally {
    if (prev !== undefined) process.env["GROQ_API_KEY"] = prev;
  }
});

test("provider errors surface status + body", async () => {
  const impl: FetchLike = async () => ({
    ok: false,
    status: 500,
    json: async () => ({}),
    text: async () => "boom",
  });
  const p = new OllamaProvider({ baseUrl: "http://x", fetchImpl: impl });
  await assert.rejects(() => p.complete({ prompt: "q" }), /500 boom/);
});
