import { test } from "node:test";
import assert from "node:assert/strict";

import {
  invokeAgent,
  buildAgentPersona,
  buildAgentSystemPrompt,
  KERNEL_INVARIANTS,
  type AgentInvocationResult,
  type ModelProvider,
} from "../src/index.js";

/** A minimal in-test ModelProvider double — returns a fixed text, records the
 * system prompt it was called with. No network, deterministic. */
function fakeModel(reply: string): ModelProvider & { lastSystem: string | undefined } {
  const m: ModelProvider & { lastSystem: string | undefined } = {
    id: "fake",
    plane: "local",
    lastSystem: undefined,
    async complete(req: { system?: string; prompt: string; maxTokens?: number }) {
      m.lastSystem = req.system;
      return { text: reply };
    },
  };
  return m;
}

test("AGENTS-1: invokeAgent(learning) yields information — a neverExecutes agent never drafts", async () => {
  const result = await invokeAgent({ agentId: "learning", message: "what did you learn?", model: fakeModel("insight X") });
  assert.equal(result.kind, "information");
  assert.equal(result.agentId, "learning");
  assert.equal(result.text, "insight X");
  assert.equal(result.source, "model");
});

test("AGENTS-1: invokeAgent(governance) yields information", async () => {
  const result = await invokeAgent({ agentId: "governance", message: "assess this", model: fakeModel("risk: low") });
  assert.equal(result.kind, "information");
});

test("AGENTS-1: invokeAgent(capability_builder) yields exactly one governed draft, never an execution", async () => {
  const result = await invokeAgent({ agentId: "capability_builder", message: "build a skill", model: fakeModel("here is a clean draft") });
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
    model: fakeModel("this uses dummy data to fill the table"),
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
    const r = await invokeAgent({ agentId: id, message: "x", model: fakeModel("ok") });
    kinds.add(r.kind);
  }
  for (const k of kinds) assert.ok(k === "information" || k === "draft", `unexpected invocation kind ${k}`);
});

test("AGENTS-1: the assembled system prompt carries the non-omittable kernel-invariants layer (layer 1)", async () => {
  const model = fakeModel("ok");
  await invokeAgent({ agentId: "governance", message: "x", model });
  assert.ok(model.lastSystem, "model should have been called with a system prompt");
  assert.match(model.lastSystem ?? "", /Kernel invariants \(non-negotiable\)/);
  // Every KERNEL_INVARIANT line is present — layer 1 is prepended in full.
  for (const inv of KERNEL_INVARIANTS) assert.ok((model.lastSystem ?? "").includes(inv));
});

test("AGENTS-1: buildAgentPersona carries responsibilities + identity guardrails; Builder adds design constraints", () => {
  const learning = buildAgentPersona("learning");
  assert.equal(learning.name, "Bridge's Learning Agent");
  assert.ok((learning.responsibilities?.length ?? 0) > 0);
  assert.ok(learning.guardrails?.some((g) => /never execute/i.test(g)));

  const builder = buildAgentPersona("capability_builder");
  assert.ok(builder.guardrails?.some((g) => /governed approval pipeline/i.test(g)));
  assert.ok(builder.guardrails?.some((g) => /Minimal-egg boundary/i.test(g)), "Builder persona should carry the standing design constraints");
});

test("AGENTS-1: tone threads into the agent identity layer only when supplied", () => {
  assert.doesNotMatch(buildAgentSystemPrompt("learning"), /Match this tone/);
  assert.match(buildAgentSystemPrompt("learning", "wise and calm"), /Match this tone in how you write.*wise and calm/);
});
