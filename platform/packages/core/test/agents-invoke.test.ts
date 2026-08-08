import { test } from "node:test";
import assert from "node:assert/strict";

import {
  invokeAgent,
  buildAgentPersona,
  DIRECT_REPLY_OUTPUT_CONTRACT,
  KERNEL_INVARIANTS,
  FixedClock,
  UuidGen,
  type AgentInvocationResult,
  type ModelProvider,
  type RunCtx,
} from "../src/index.js";

/** A minimal in-test ModelProvider adapter — returns fixed text, records the
 * system prompt it was called with. No network, deterministic. */
function testProvider(reply: string): ModelProvider & { lastSystem: string | undefined; lastTier: string | undefined } {
  const m: ModelProvider & { lastSystem: string | undefined; lastTier: string | undefined } = {
    id: "test-model",
    plane: "local",
    tiers: ["reasoning"],
    models: { reasoning: "test-model-v1" },
    routingHealth: () => "unknown",
    lastSystem: undefined,
    lastTier: undefined,
    async complete(req) {
      m.lastSystem = req.system;
      m.lastTier = req.tier;
      return {
        text: reply,
        model: "test-model-v1",
        tier: req.tier,
        usage: {
          inputTokens: 3,
          outputTokens: 2,
          cacheCreationInputTokens: 0,
          cacheReadInputTokens: 0,
          source: "provider",
        },
      };
    },
  };
  return m;
}

/** Deterministic RunCtx double (run-context.test.ts's pattern). */
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

/** AI Harness K0: a provider can only be handed to invokeAgent WITH the
 * determinism seams — the pair is the shape the one context door demands. */
function testModel(reply: string): {
  provider: ModelProvider & { lastSystem: string | undefined; lastTier: string | undefined };
  runCtx: RunCtx;
} {
  return { provider: testProvider(reply), runCtx: test_fixture_run_ctx() };
}

test("AGENTS-1: invokeAgent(learning) yields information — a neverExecutes agent never drafts", async () => {
  const result = await invokeAgent({ agentId: "learning", message: "what did you learn?", model: testModel("insight X") });
  assert.equal(result.kind, "information");
  assert.equal(result.agentId, "learning");
  assert.equal(result.text, "insight X");
  assert.equal(result.source, "model");
});

test("AGENTS-1: invokeAgent(governance) yields information", async () => {
  const result = await invokeAgent({ agentId: "governance", message: "assess this", model: testModel("risk: low") });
  assert.equal(result.kind, "information");
});

test("AGENTS-1: invokeAgent(capability_builder) yields exactly one governed draft, never an execution", async () => {
  const result = await invokeAgent({ agentId: "capability_builder", message: "build a skill", model: testModel("here is a clean draft") });
  assert.equal(result.kind, "draft");
  assert.equal(result.agentId, "capability_builder");
  // Structural "no independent write": the union has no "executed" variant, so
  // the strongest thing a Builder turn can return is a draft the CALLER must
  // still propose — never a report of having written anything.
  assert.ok(result.kind === "draft" && Array.isArray(result.constraintViolations));
});

test("AGENTS-1: the design-constraint check surfaces on a draft (flag, not gate — still a draft)", async () => {
  const result = await invokeAgent({
    agentId: "capability_builder",
    message: "build it",
    model: testModel("this uses dummy data to fill the table"),
  });
  assert.equal(result.kind, "draft");
  assert.ok(result.kind === "draft" && result.constraintViolations.length > 0, "dummy-data language should be flagged for the approver");
});

test("AGENTS-1: offline (no model) still returns a well-formed result with source=offline", async () => {
  const result = await invokeAgent({ agentId: "learning", message: "anything?" });
  assert.equal(result.kind, "information");
  assert.equal(result.source, "offline");
  assert.match(result.text, /offline mode/);
});

test("AGENTS-1: invokeAgent result is one of exactly two kinds (structural — no executed variant)", async () => {
  const kinds = new Set<AgentInvocationResult["kind"]>();
  for (const id of ["learning", "governance", "capability_builder"] as const) {
    const r = await invokeAgent({ agentId: id, message: "x", model: testModel("ok") });
    kinds.add(r.kind);
  }
  for (const k of kinds) assert.ok(k === "information" || k === "draft", `unexpected invocation kind ${k}`);
});

test("AGENTS-1: the assembled system prompt carries the non-omittable kernel-invariants layer (layer 1)", async () => {
  const model = testModel("ok");
  await invokeAgent({ agentId: "governance", message: "x", model });
  assert.ok(model.provider.lastSystem, "model should have been called with a system prompt");
  assert.match(model.provider.lastSystem ?? "", /Kernel invariants \(non-negotiable\)/);
  assert.equal(model.provider.lastTier, "reasoning");
  // Every KERNEL_INVARIANT line is present — layer 1 is prepended in full.
  for (const inv of KERNEL_INVARIANTS) assert.ok((model.provider.lastSystem ?? "").includes(inv));
});

test("AI Harness K0: the system prompt is a PROJECTION of an assembled run context, not a hand-rolled string", async () => {
  // The proof the one door was used: sections only projectToSystemPrompt
  // renders. The retired buildAgentSystemPrompt appended the closing
  // instruction as a loose line — through the door it arrives as the
  // "## Output contract" section, so its presence AS A SECTION is the tell.
  const model = testModel("ok");
  await invokeAgent({ agentId: "learning", message: "x", model });
  const system = model.provider.lastSystem ?? "";
  assert.match(system, /## Output contract/);
  assert.ok(system.includes(DIRECT_REPLY_OUTPUT_CONTRACT));
  assert.match(system, /## Governance/);
  assert.match(system, /Approval mode: explicit_human/);
});

test("AI Harness K0/K4: the memory slot exists on a directly-addressed agent turn and renders when filled", async () => {
  const model = testModel("ok");
  await invokeAgent({
    agentId: "learning",
    message: "x",
    model,
    memory: [{ source: "memory:test_fixture_1", text: "prefers short weekly summaries", score: 0.9 }],
  });
  const system = model.provider.lastSystem ?? "";
  assert.match(system, /## Retrieved memory/);
  assert.match(system, /prefers short weekly summaries/);
  // And absent memory renders NO section — empty slots are omitted, not faked.
  const bare = testModel("ok");
  await invokeAgent({ agentId: "learning", message: "x", model: bare });
  assert.doesNotMatch(bare.provider.lastSystem ?? "", /## Retrieved memory/);
});

test("AGENTS-1: buildAgentPersona carries responsibilities + identity guardrails; Builder adds design constraints", () => {
  const learning = buildAgentPersona("learning");
  assert.equal(learning.name, "Bridge's Learning Agent");
  assert.ok((learning.responsibilities?.length ?? 0) > 0);
  assert.ok(learning.guardrails?.some((g) => /never execute/i.test(g)));

  const builder = buildAgentPersona("capability_builder");
  assert.ok(builder.guardrails?.some((g) => /governed approval pipeline/i.test(g)));
  assert.ok(builder.guardrails?.some((g) => /Kernel boundary/i.test(g)), "Builder persona should carry the standing design constraints");
});

test("AGENTS-1: tone threads into the agent identity layer only when supplied", async () => {
  const bare = testModel("ok");
  await invokeAgent({ agentId: "learning", message: "x", model: bare });
  assert.doesNotMatch(bare.provider.lastSystem ?? "", /Match this tone/);

  const toned = testModel("ok");
  await invokeAgent({ agentId: "learning", message: "x", model: toned, tone: "wise and calm" });
  assert.match(toned.provider.lastSystem ?? "", /Match this tone in how you write.*wise and calm/);
});
