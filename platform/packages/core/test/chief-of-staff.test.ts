import { test } from "node:test";
import assert from "node:assert/strict";

import {
  classifyIntent,
  assertChainDepth,
  ChainDepthExceededError,
  MAX_CHAIN_DEPTH,
  FixedClock,
  UuidGen,
  type RoutableCapability,
  type ModelProvider,
  type RunCtx,
} from "../src/index.js";

/** Deterministic RunCtx double (run-context.test.ts's pattern) — the seams a
 * model-backed classification needs to assemble its run context (AI Harness
 * K0: the provider cannot be supplied without them). */
function test_fixture_run_ctx(): RunCtx {
  return {
    clock: new FixedClock("2026-08-09T12:00:00.000Z"),
    rng: {
      next(): number {
        throw new Error("test_fixture_run_ctx: rng should never be called by context assembly");
      },
    },
    ids: new UuidGen(new FixedClock("2026-08-09T12:00:00.000Z"), { next: () => 0.5 }),
  };
}

const REGISTRY: RoutableCapability[] = [
  { id: "jobpilot.search", description: "search job applications tracker", keywords: ["job", "application", "apply"] },
  { id: "dealpilot.list", description: "browse deal pipeline candidates", keywords: ["deal", "acquisition", "listing"] },
  { id: "calendar.schedule", description: "schedule a meeting", keywords: ["schedule", "meeting", "calendar"] },
];

test("keyword fallback (no model) routes to the best keyword match", async () => {
  const decision = await classifyIntent({ message: "help me apply to this job posting", registry: REGISTRY });
  assert.equal(decision.kind, "route");
  assert.equal(decision.route, "jobpilot.search");
  assert.equal(decision.source, "keyword_fallback");
  assert.ok(decision.confidence > 0);
});

test("keyword fallback clarifies on total miss — never invents a route", async () => {
  const decision = await classifyIntent({ message: "what is the weather like", registry: REGISTRY });
  assert.equal(decision.kind, "clarify");
  assert.equal(decision.route, undefined);
  assert.equal(decision.source, "keyword_fallback");
});

test("keyword fallback works with zero registry entries (kernel runs with ZERO providers/capabilities)", async () => {
  const decision = await classifyIntent({ message: "anything", registry: [] });
  assert.equal(decision.kind, "clarify");
});

test("classifyIntent never returns more than one route (star topology, no peer handoffs) — type only carries a single route field", async () => {
  const decision = await classifyIntent({ message: "schedule a meeting about a job application", registry: REGISTRY });
  assert.equal(decision.kind, "route");
  assert.equal(typeof decision.route, "string");
  // RoutingDecision has no array/list field for routes — this assertion documents
  // the structural guarantee (there is nothing else to check at runtime since
  // the type itself has no second route to smuggle in).
  assert.equal(Object.keys(decision).includes("routes"), false);
});

function testModel(reply: string): { provider: ModelProvider & { lastSystem: string | undefined }; runCtx: RunCtx } {
  const provider: ModelProvider & { lastSystem: string | undefined } = {
    id: "test-model",
    plane: "cloud",
    tiers: ["cheap"],
    models: { cheap: "test-model-v1" },
    routingHealth: () => "unknown",
    lastSystem: undefined,
    async complete(req) {
      provider.lastSystem = req.system;
      return {
        text: reply,
        model: "test-model-v1",
        tier: req.tier,
        usage: {
          inputTokens: 12,
          outputTokens: 1,
          cacheCreationInputTokens: 0,
          cacheReadInputTokens: 0,
          source: "provider",
        },
      };
    },
  };
  return { provider, runCtx: test_fixture_run_ctx() };
}

test("model path: valid registered id from provider routes correctly", async () => {
  const model = testModel("calendar.schedule");
  const decision = await classifyIntent({ message: "any message", registry: REGISTRY, model });
  assert.equal(decision.kind, "route");
  assert.equal(decision.route, "calendar.schedule");
  assert.equal(decision.source, "model");
  assert.equal(decision.modelReceipt?.tier, "cheap");
  assert.equal(decision.modelReceipt?.usage.inputTokens, 12);
});

test("AI Harness K0: the classifier's system prompt is a projection of an assembled run context", async () => {
  // The registry renders inside the output contract (the closed answer set IS
  // the run's contract), and the kernel-invariants layer — which the retired
  // hand-rolled classifier prompt never carried — is now non-omittable here.
  const model = testModel("CLARIFY");
  await classifyIntent({ message: "any message", registry: REGISTRY, model });
  const system = model.provider.lastSystem ?? "";
  assert.match(system, /Kernel invariants \(non-negotiable\)/);
  assert.match(system, /## Output contract/);
  for (const cap of REGISTRY) assert.ok(system.includes(`- ${cap.id}: ${cap.description}`), `registry option ${cap.id} must be disclosed`);
  assert.match(system, /EXACTLY ONE bare capability id/);
});

test("model path: CLARIFY token from provider produces a clarify decision", async () => {
  const decision = await classifyIntent({ message: "any message", registry: REGISTRY, model: testModel("CLARIFY") });
  assert.equal(decision.kind, "clarify");
  assert.equal(decision.source, "model");
});

test("model path: hallucinated/unregistered id degrades to clarify, never an invented route", async () => {
  const decision = await classifyIntent({ message: "any message", registry: REGISTRY, model: testModel("some.made.up.capability") });
  assert.equal(decision.kind, "clarify");
  assert.equal(decision.route, undefined);
  assert.equal(decision.source, "model");
});

test("model path: a throwing provider fails closed instead of producing an unreceipted keyword result", async () => {
  const throwingModel: ModelProvider = {
    id: "throws",
    plane: "cloud",
    tiers: ["cheap"],
    models: { cheap: "throws-v1" },
    routingHealth: () => "unknown",
    async complete() {
      throw new Error("network error");
    },
  };
  await assert.rejects(
    () =>
      classifyIntent({
        message: "help me apply to this job posting",
        registry: REGISTRY,
        model: { provider: throwingModel, runCtx: test_fixture_run_ctx() },
      }),
    /network error/,
  );
});

test("assertChainDepth passes below the cap", () => {
  assertChainDepth(0);
  assertChainDepth(MAX_CHAIN_DEPTH - 1);
});

test("assertChainDepth throws ChainDepthExceededError at/above the hard cap", () => {
  assert.throws(() => assertChainDepth(MAX_CHAIN_DEPTH), ChainDepthExceededError);
  assert.throws(() => assertChainDepth(MAX_CHAIN_DEPTH + 1), ChainDepthExceededError);
});
