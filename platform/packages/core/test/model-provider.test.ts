import { test } from "node:test";
import assert from "node:assert/strict";
import {
  EchoModelProvider,
  MAX_MODEL_OUTPUT_TOKENS,
  MAX_MODEL_PROMPT_CHARS,
  assertModelCompletionRequest,
  createModelCallReceipt,
  type ModelCompletion,
  type ModelProvider,
} from "../src/index.js";

test("EchoModelProvider echoes system+prompt and defaults to local plane", async () => {
  const p: ModelProvider = new EchoModelProvider();
  assert.equal(p.plane, "local");
  const out = await p.complete({ system: "sys", prompt: "hello", tier: "cheap" });
  assert.equal(out.text, "sys\nhello");
  assert.equal(out.tier, "cheap");
  assert.equal(out.usage.source, "estimated");
});

test("EchoModelProvider omits system cleanly", async () => {
  const p = new EchoModelProvider();
  const out = await p.complete({ prompt: "hi", tier: "default" });
  assert.equal(out.text, "hi");
});

test("EchoModelProvider can simulate a cloud-plane provider", async () => {
  const p = new EchoModelProvider("cloud-echo", "cloud");
  assert.equal(p.plane, "cloud");
  assert.equal(p.id, "cloud-echo");
});

test("model completion requests reject unbounded prompt and output spend before provider access", () => {
  assert.throws(
    () =>
      assertModelCompletionRequest({
        prompt: "x".repeat(MAX_MODEL_PROMPT_CHARS + 1),
        tier: "cheap",
      }),
    /bounded request size/,
  );
  assert.throws(
    () =>
      assertModelCompletionRequest({
        prompt: "bounded",
        maxTokens: MAX_MODEL_OUTPUT_TOKENS + 1,
        tier: "cheap",
      }),
    /bounded output size/,
  );
});

test("EchoModelProvider.embed is deterministic for the same input", async () => {
  const p = new EchoModelProvider();
  const a = await p.embed!(["hello", "world"]);
  const b = await p.embed!(["hello", "world"]);
  assert.deepEqual(a, b);
  assert.equal(a.length, 2);
  assert.equal(a[0]!.length, 8);
});

function completion(overrides: Partial<ModelCompletion> = {}): ModelCompletion {
  return {
    text: "ok",
    model: "model-v1",
    tier: "cheap",
    usage: {
      inputTokens: 10,
      outputTokens: 2,
      cacheCreationInputTokens: 0,
      cacheReadInputTokens: 0,
      source: "provider",
    },
    ...overrides,
  };
}

test("createModelCallReceipt rejects a provider response for a different requested tier", () => {
  const provider = new EchoModelProvider();
  assert.throws(
    () => createModelCallReceipt(provider, completion({ tier: "default" }), "cheap"),
    /returned tier default for cheap request/,
  );
});

test("createModelCallReceipt rejects unbounded pricing metadata", () => {
  const provider: ModelProvider = {
    id: "priced",
    plane: "cloud",
    tiers: ["cheap"],
    models: { cheap: "model-v1" },
    routingHealth: () => "unknown",
    pricing: {
      cheap: {
        inputUsdPerMillion: Number.MAX_VALUE,
        outputUsdPerMillion: 0,
        cacheCreationInputUsdPerMillion: 0,
        cacheReadInputUsdPerMillion: 0,
        source: "bounded-test-catalog",
        asOf: "2026-07-18",
      },
    },
    async complete() {
      return completion();
    },
  };
  assert.throws(
    () =>
      createModelCallReceipt(
        provider,
        completion({
          usage: {
            inputTokens: 2,
            outputTokens: 0,
            cacheCreationInputTokens: 0,
            cacheReadInputTokens: 0,
            source: "provider",
          },
        }),
        "cheap",
      ),
    /invalid pricing/,
  );
});

test("createModelCallReceipt rejects a finite cost above the persistence cap", () => {
  const provider: ModelProvider = {
    id: "priced",
    plane: "cloud",
    tiers: ["cheap"],
    models: { cheap: "model-v1" },
    routingHealth: () => "unknown",
    pricing: {
      cheap: {
        inputUsdPerMillion: 10_000,
        outputUsdPerMillion: 10_000,
        cacheCreationInputUsdPerMillion: 0,
        cacheReadInputUsdPerMillion: 0,
        source: "bounded-test-catalog",
        asOf: "2026-07-21",
      },
    },
    async complete() {
      return completion();
    },
  };
  assert.throws(
    () =>
      createModelCallReceipt(
        provider,
        completion({
          usage: {
            inputTokens: 10_000_000,
            outputTokens: 1,
            cacheCreationInputTokens: 0,
            cacheReadInputTokens: 0,
            source: "provider",
          },
        }),
        "cheap",
      ),
    /invalid cost estimate/,
  );
});

test("createModelCallReceipt rejects undeclared model identity and oversized usage", () => {
  const provider = new EchoModelProvider("declared-model", "cloud", ["cheap"]);
  assert.throws(
    () => createModelCallReceipt(provider, completion(), "cheap"),
    /undeclared model identity/,
  );
  assert.throws(
    () =>
      createModelCallReceipt(
        provider,
        completion({
          model: "declared-model",
          usage: {
            inputTokens: 10_000_001,
            outputTokens: 0,
            cacheCreationInputTokens: 0,
            cacheReadInputTokens: 0,
            source: "provider",
          },
        }),
        "cheap",
      ),
    /invalid token usage/,
  );
});
