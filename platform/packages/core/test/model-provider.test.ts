import { test } from "node:test";
import assert from "node:assert/strict";
import {
  EchoModelProvider,
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

test("createModelCallReceipt rejects a non-finite cost estimate", () => {
  const provider: ModelProvider = {
    id: "priced",
    plane: "cloud",
    tiers: ["cheap"],
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
    /invalid cost estimate/,
  );
});
