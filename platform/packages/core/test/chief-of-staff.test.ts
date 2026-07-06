import { test } from "node:test";
import assert from "node:assert/strict";

import {
  classifyIntent,
  assertChainDepth,
  ChainDepthExceededError,
  MAX_CHAIN_DEPTH,
  type RoutableCapability,
  type ModelProvider,
} from "../src/index.js";

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

function fakeModel(reply: string): ModelProvider {
  return {
    id: "fake",
    plane: "cloud",
    async complete() {
      return { text: reply };
    },
  };
}

test("model path: valid registered id from provider routes correctly", async () => {
  const decision = await classifyIntent({ message: "any message", registry: REGISTRY, model: fakeModel("calendar.schedule") });
  assert.equal(decision.kind, "route");
  assert.equal(decision.route, "calendar.schedule");
  assert.equal(decision.source, "model");
});

test("model path: CLARIFY token from provider produces a clarify decision", async () => {
  const decision = await classifyIntent({ message: "any message", registry: REGISTRY, model: fakeModel("CLARIFY") });
  assert.equal(decision.kind, "clarify");
  assert.equal(decision.source, "model");
});

test("model path: hallucinated/unregistered id degrades to clarify, never an invented route", async () => {
  const decision = await classifyIntent({ message: "any message", registry: REGISTRY, model: fakeModel("some.made.up.capability") });
  assert.equal(decision.kind, "clarify");
  assert.equal(decision.route, undefined);
  assert.equal(decision.source, "model");
});

test("model path: a throwing provider degrades to the keyword fallback instead of throwing", async () => {
  const throwingModel: ModelProvider = {
    id: "throws",
    plane: "cloud",
    async complete() {
      throw new Error("network error");
    },
  };
  const decision = await classifyIntent({ message: "help me apply to this job posting", registry: REGISTRY, model: throwingModel });
  assert.equal(decision.kind, "route");
  assert.equal(decision.route, "jobpilot.search");
  assert.equal(decision.source, "keyword_fallback");
});

test("assertChainDepth passes below the cap", () => {
  assertChainDepth(0);
  assertChainDepth(MAX_CHAIN_DEPTH - 1);
});

test("assertChainDepth throws ChainDepthExceededError at/above the hard cap", () => {
  assert.throws(() => assertChainDepth(MAX_CHAIN_DEPTH), ChainDepthExceededError);
  assert.throws(() => assertChainDepth(MAX_CHAIN_DEPTH + 1), ChainDepthExceededError);
});
