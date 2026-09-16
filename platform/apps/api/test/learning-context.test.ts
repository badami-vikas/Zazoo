/**
 * AI Harness K4 (TASK-048) — retrieval fusion feeds EVERY run through the one
 * context door, and the semantic embedder is the Local-Plane default.
 *
 * Invariants under test:
 *  - an @agent (invokeAgent) run's projected system prompt carries the fused
 *    retrieval output — including an accepted claim (one substrate, every run);
 *  - the @communications run does too;
 *  - with the fusion flight OFF neither does — retrieval influence is
 *    flight-gated per run, not ambient;
 *  - local mode resolves a semantic embedder BY DEFAULT (Ollama registered on
 *    the Local Plane), while a provider set without Ollama yields none (the
 *    lexical hashing fallback engages downstream per ADR-213).
 */
import assert from "node:assert/strict";
import test from "node:test";
import {
  HASHING_EMBEDDER_ID,
  SeededRng,
  SystemClock,
  UuidGen,
  type ModelCompletionRequest,
  type ModelProvider,
  type ModelTier,
  type RunCtx,
} from "@bridge/core";
import { appRouter } from "../src/router.js";
import { buildWiring, PILOT_ORGANIZATION, PILOT_USER, type Wiring } from "../src/wiring.js";
import { makeCaller } from "./caller.js";

const ORG = PILOT_ORGANIZATION;

/** Local-plane capture double — records every completion request so tests can
 * assert what actually reached the model's system prompt. */
class CaptureLocalModel implements ModelProvider {
  readonly id = "capture-local-k4";
  readonly plane = "local" as const;
  readonly tiers = ["cheap", "default", "reasoning"] as const satisfies readonly ModelTier[];
  readonly models = { cheap: "k4-v1", default: "k4-v1", reasoning: "k4-v1" } as const;
  readonly calls: ModelCompletionRequest[] = [];

  routingHealth() {
    return "healthy" as const;
  }

  async complete(request: ModelCompletionRequest) {
    this.calls.push(request);
    return {
      text: "Noted.",
      model: "k4-v1",
      tier: request.tier,
      usage: { inputTokens: 10, outputTokens: 2, cacheCreationInputTokens: 0, cacheReadInputTokens: 0, source: "provider" as const },
      ...(request.taintLabel ? { taintLabel: request.taintLabel } : {}),
    };
  }
}

async function acceptPriyaClaim(caller: ReturnType<typeof makeCaller>) {
  const proposed = await caller.learning.claims.proposeClaim({
    organizationId: ORG,
    entity: { kind: "person", name: "Priya Sharma" },
    field: "timezone",
    value: "CET",
    claimClass: "stated_fact",
    evidence: [{ kind: "memory", id: "3f1c0000-0000-4000-8000-000000000001" }],
  });
  assert.ok(proposed.proposed);
  const accepted = await caller.learning.claims.acceptClaim({
    organizationId: ORG,
    suggestionMemoryId: proposed.proposed ? proposed.suggestion.memoryId : "",
  });
  assert.ok(accepted.materialized);
}

test("an @agent run's system prompt carries the fused accepted claim (fusion feeds every run)", async () => {
  const model = new CaptureLocalModel();
  const wiring = await buildWiring({
    retrievalFusionEnabled: true,
    claimSubstrateEnabled: true,
    modelProviders: [model],
  });
  try {
    const caller = makeCaller(wiring);
    await acceptPriyaClaim(caller);
    const reply = await caller.chiefOfStaff.converse({
      organizationId: ORG,
      message: "@learning What timezone is Priya Sharma in?",
    });
    assert.equal(reply.reply, "Noted.");
    const agentCall = model.calls.at(-1);
    assert.ok(agentCall?.system, "the agent run projected a system prompt");
    assert.match(
      agentCall.system!,
      /Accepted claim — Priya Sharma: timezone is CET\./,
      "the fused claim reached the agent run's context",
    );
  } finally {
    await wiring.close();
  }
});

test("an @communications run's system prompt carries the fused accepted claim", async () => {
  const model = new CaptureLocalModel();
  const wiring = await buildWiring({
    retrievalFusionEnabled: true,
    claimSubstrateEnabled: true,
    modelProviders: [model],
  });
  try {
    const caller = makeCaller(wiring);
    await acceptPriyaClaim(caller);
    await caller.chiefOfStaff.converse({
      organizationId: ORG,
      message: "@communications Draft a note to Priya Sharma about the timezone change.",
    });
    const call = model.calls.at(-1);
    assert.ok(call?.system);
    assert.match(call.system!, /Accepted claim — Priya Sharma: timezone is CET\./);
  } finally {
    await wiring.close();
  }
});

test("fusion flight OFF: the same runs carry NO retrieval — influence is flight-gated per run", async () => {
  const model = new CaptureLocalModel();
  const wiring = await buildWiring({
    claimSubstrateEnabled: true,
    retrievalFusionEnabled: false, // the default is ON since AP-182
    modelProviders: [model],
  });
  try {
    const caller = makeCaller(wiring);
    await acceptPriyaClaim(caller);
    await caller.chiefOfStaff.converse({
      organizationId: ORG,
      message: "@learning What timezone is Priya Sharma in?",
    });
    const call = model.calls.at(-1);
    assert.ok(call?.system);
    assert.doesNotMatch(call.system!, /timezone is CET/);
  } finally {
    await wiring.close();
  }
});

test("local mode resolves a semantic embedder BY DEFAULT; a provider set without Ollama yields none", async () => {
  const withDefaults = await buildWiring();
  try {
    assert.ok(withDefaults.semanticEmbedder, "Ollama is registered on the Local Plane by default (K4)");
    assert.notEqual(withDefaults.semanticEmbedder?.id, HASHING_EMBEDDER_ID);
  } finally {
    await withDefaults.close();
  }
  const withoutOllama = await buildWiring({ modelProviders: [new CaptureLocalModel()] });
  try {
    assert.equal(withoutOllama.semanticEmbedder, undefined, "no Ollama registered → the lexical fallback space engages downstream (ADR-213)");
  } finally {
    await withoutOllama.close();
  }
});
