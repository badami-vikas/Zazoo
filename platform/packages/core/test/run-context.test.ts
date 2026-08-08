import { test } from "node:test";
import assert from "node:assert/strict";

import {
  assembleRunContext,
  compactConversationHistory,
  COMPACT_TRIGGER_SEGMENTS,
  COMPACT_KEEP_SEGMENTS,
  projectToPrompt,
  FixedClock,
  UuidGen,
  type AssembleRunContextInput,
  type ContextItem,
  type ModelConversationSegment,
  type ModelRunContext,
  type RunCtx,
} from "../src/index.js";

/** Deterministic RunCtx test double — FixedClock/UuidGen (determinism.ts) plus a
 * throwing Rng stub, since run-context assembly never touches randomness. */
function test_fixture_run_ctx(): RunCtx {
  return {
    clock: new FixedClock("2026-07-06T12:00:00.000Z"),
    rng: {
      next(): number {
        throw new Error("test_fixture_run_ctx: rng.next() should never be called by run-context assembly");
      },
    },
    ids: new UuidGen(new FixedClock("2026-07-06T12:00:00.000Z"), {
      next(): number {
        return 0.5;
      },
    }),
  };
}

function test_fixture_context_item(overrides: Partial<ContextItem> = {}): ContextItem {
  return {
    provider: "clipboard",
    kind: "selection",
    permission: "test_fixture_grant_1",
    dataScope: "private",
    retention: "session",
    provenance: { source: "test_fixture_desktop_shell", capturedAt: "2026-07-06T11:59:00.000Z" },
    payload: { text: "test_fixture_payload" },
    ...overrides,
  };
}

function test_fixture_input(overrides: Partial<AssembleRunContextInput> = {}): AssembleRunContextInput {
  return {
    persona: {
      id: "chief_of_staff",
      name: "Chief of Staff",
      role: "You triage requests and route them to the right capability.",
      actorType: "agent",
      actorId: "test_fixture_agent_1",
    },
    request: "What deals are stalled this week?",
    governance: {
      approvalRequirement: "auto",
      trustGrants: [],
    },
    outputContract: {
      description: "A short natural-language reply plus an optional routing decision.",
    },
    ...overrides,
  };
}

test("assembleRunContext: fills every ModelRunContext section from a minimal input", () => {
  const ctx = assembleRunContext(test_fixture_input(), test_fixture_run_ctx());

  assert.equal(ctx.persona.name, "Chief of Staff");
  assert.equal(ctx.request, "What deals are stalled this week?");
  assert.equal(ctx.surface, undefined);
  assert.deepEqual(ctx.contextItems, []);
  assert.deepEqual(ctx.disclosedCapabilities, []);
  assert.equal(ctx.governance.approvalRequirement, "auto");
  assert.deepEqual(ctx.memory, []);
  assert.deepEqual(ctx.conversationHistory, []);
  assert.equal(ctx.outputContract.description, "A short natural-language reply plus an optional routing decision.");
});

test("assembleRunContext: trace.runId/assembledAt come from the injected RunCtx, never a raw clock/random call", () => {
  const runCtx = test_fixture_run_ctx();
  const ctx = assembleRunContext(test_fixture_input(), runCtx);

  assert.equal(ctx.trace.assembledAt, "2026-07-06T12:00:00.000Z");
  assert.equal(typeof ctx.trace.runId, "string");
  assert.ok(ctx.trace.runId.length > 0);
  assert.deepEqual(ctx.trace.ledgerEntryIds, []);
});

test("assembleRunContext: same RunCtx state yields the same runId (deterministic, replayable)", () => {
  const a = assembleRunContext(test_fixture_input(), test_fixture_run_ctx());
  const b = assembleRunContext(test_fixture_input(), test_fixture_run_ctx());
  assert.equal(a.trace.runId, b.trace.runId);
});

test("assembleRunContext: carries surface, contextItems, disclosedCapabilities, memory, ledgerEntryIds through unchanged", () => {
  const item = test_fixture_context_item();
  const ctx = assembleRunContext(
    test_fixture_input({
      surface: { kind: "record", id: "init_1", label: "Acme Corp acquisition" },
      contextItems: [item],
      disclosedCapabilities: [
        {
          manifestId: "cap_1",
          name: "dealpilot.score",
          capabilityType: "skill",
          audience: "private",
          reason: "message mentions deals",
        },
      ],
      memory: [{ source: "test_fixture_memory_store", text: "Acme Corp deal opened 2026-06-01", score: 0.9 }],
      conversationHistory: [
        {
          role: "user",
          content: "Earlier question",
          dataScope: "private",
          taintLabel: {
            version: 1,
            trust: "authenticated_human",
            source: "human",
            sensitivity: "private",
            instructionRisk: "data",
            provenanceHash: "sha256:test",
            originChain: [],
            originsTruncated: false,
          },
        },
      ],
      ledgerEntryIds: ["ledger_1"],
    }),
    test_fixture_run_ctx(),
  );

  assert.deepEqual(ctx.surface, { kind: "record", id: "init_1", label: "Acme Corp acquisition" });
  assert.equal(ctx.contextItems.length, 1);
  assert.equal(ctx.contextItems[0]?.payload && (ctx.contextItems[0].payload as { text: string }).text, "test_fixture_payload");
  assert.equal(ctx.disclosedCapabilities.length, 1);
  assert.equal(ctx.disclosedCapabilities[0]?.name, "dealpilot.score");
  assert.equal(ctx.memory.length, 1);
  assert.equal(ctx.memory[0]?.score, 0.9);
  assert.equal(ctx.conversationHistory[0]?.role, "user");
  assert.deepEqual(ctx.trace.ledgerEntryIds, ["ledger_1"]);
});

test("assembleRunContext: composes the existing ephemeral RunContext (types.ts) unchanged under governance.ephemeralContext", () => {
  const ctx = assembleRunContext(
    test_fixture_input({
      governance: {
        approvalRequirement: "governance",
        trustGrants: [{ capabilityClass: "skill", riskBand: "operational", autoActivate: false }],
        ephemeralContext: { type: "record", id: "init_1", runId: "run_abc" },
      },
    }),
    test_fixture_run_ctx(),
  );

  assert.equal(ctx.governance.approvalRequirement, "governance");
  assert.equal(ctx.governance.trustGrants.length, 1);
  assert.deepEqual(ctx.governance.ephemeralContext, { type: "record", id: "init_1", runId: "run_abc" });
});

test("projectToPrompt: minimal context projects a compact prompt with no empty sections", () => {
  const ctx = assembleRunContext(test_fixture_input(), test_fixture_run_ctx());
  const prompt = projectToPrompt(ctx);

  assert.ok(prompt.includes("You are Chief of Staff."));
  assert.ok(prompt.includes("## Request"));
  assert.ok(prompt.includes("What deals are stalled this week?"));
  assert.ok(prompt.includes("## Governance"));
  assert.ok(prompt.includes("Approval mode: auto"));
  assert.ok(prompt.includes("## Output contract"));
  assert.ok(!prompt.includes("## Current surface"));
  assert.ok(!prompt.includes("## Context"));
  assert.ok(!prompt.includes("## Available capabilities"));
  assert.ok(!prompt.includes("## Retrieved memory"));
});

test("projectToPrompt: a fully-populated context renders every section in ADR-027 order", () => {
  const ctx: ModelRunContext = assembleRunContext(
    test_fixture_input({
      surface: { kind: "record", id: "init_1", label: "Acme Corp acquisition" },
      contextItems: [test_fixture_context_item()],
      disclosedCapabilities: [
        {
          manifestId: "cap_1",
          name: "dealpilot.score",
          capabilityType: "skill",
          audience: "private",
          reason: "message mentions deals",
        },
      ],
      governance: {
        approvalRequirement: "user_pref",
        trustGrants: [],
        ephemeralContext: { type: "automation", id: "automation_1", runId: "run_xyz" },
      },
      memory: [{ source: "test_fixture_memory_store", text: "Acme Corp deal opened 2026-06-01" }],
      conversationHistory: [
        {
          role: "assistant",
          content: "I found the prior thread.",
          dataScope: "private",
          taintLabel: {
            version: 1,
            trust: "verified_system",
            source: "system",
            sensitivity: "private",
            instructionRisk: "none",
            provenanceHash: "sha256:test-history",
            originChain: [],
            originsTruncated: false,
          },
        },
      ],
    }),
    test_fixture_run_ctx(),
  );
  const prompt = projectToPrompt(ctx);

  const sectionOrder = [
    "## Request",
    "## Current surface",
    "## Context",
    "## Available capabilities",
    "## Governance",
    "## Retrieved memory",
    "## Conversation history",
    "## Output contract",
  ];
  let lastIndex = -1;
  for (const heading of sectionOrder) {
    const index = prompt.indexOf(heading);
    assert.ok(index > lastIndex, `expected "${heading}" to appear after the previous section`);
    lastIndex = index;
  }

  assert.ok(prompt.includes("record:init_1 (Acme Corp acquisition)"));
  assert.ok(prompt.includes("[clipboard/selection]"));
  assert.ok(prompt.includes("dealpilot.score (skill, private) — message mentions deals"));
  assert.ok(prompt.includes("Approval mode: user_pref"));
  assert.ok(prompt.includes("Ephemeral run scope: automation:automation_1 (run run_xyz)"));
  assert.ok(prompt.includes("[test_fixture_memory_store] Acme Corp deal opened 2026-06-01"));
});

test("projectToPrompt: is a pure deterministic template — same context always yields the same string", () => {
  const ctx = assembleRunContext(test_fixture_input(), test_fixture_run_ctx());
  assert.equal(projectToPrompt(ctx), projectToPrompt(ctx));
});

function test_fixture_conversation_segment(content: string): ModelConversationSegment {
  return {
    role: "user",
    dataScope: "private",
    content,
    taintLabel: {
      version: 1,
      trust: "verified_system",
      source: "operator",
      sensitivity: "private",
      instructionRisk: "none",
      provenanceHash: "sha256:test",
      originChain: [],
      originsTruncated: false,
    },
  };
}

test("assembleRunContext: throws when history exceeds MAX_CONVERSATION_SEGMENTS (compaction must happen before)", () => {
  const history = Array.from({ length: 25 }, (_, i) => test_fixture_conversation_segment(`msg_${i}`));
  assert.throws(
    () => assembleRunContext({ ...test_fixture_input(), conversationHistory: history }, test_fixture_run_ctx()),
    /exceeds 24 segments/,
  );
});

test("assembleRunContext: single oversized segment (> 16k chars) still throws", () => {
  const tooBig = test_fixture_conversation_segment("x".repeat(17_000));
  assert.throws(
    () => assembleRunContext({ ...test_fixture_input(), conversationHistory: [tooBig] }, test_fixture_run_ctx()),
    /invalid conversation-history segment/,
  );
});

test("compactConversationHistory: returns history unchanged when within COMPACT_TRIGGER_SEGMENTS", async () => {
  const history = Array.from({ length: COMPACT_TRIGGER_SEGMENTS }, (_, i) =>
    test_fixture_conversation_segment(`msg_${i}`),
  );
  const result = await compactConversationHistory(history, {
    complete: async () => { throw new Error("model should not be called"); },
  });
  assert.equal(result.length, COMPACT_TRIGGER_SEGMENTS);
  assert.equal(result[0]!.content, "msg_0");
});

test("compactConversationHistory: summarises oldest segments and keeps COMPACT_KEEP_SEGMENTS verbatim", async () => {
  const total = COMPACT_TRIGGER_SEGMENTS + 4; // e.g. 24
  const history = Array.from({ length: total }, (_, i) =>
    test_fixture_conversation_segment(`msg_${i}`),
  );
  let capturedPrompt = "";
  const result = await compactConversationHistory(history, {
    complete: async (req) => {
      capturedPrompt = req.prompt;
      return { text: "Summary of earlier turns.", model: "test-model", tier: "cheap", usage: { inputTokens: 10, outputTokens: 20, cacheCreationInputTokens: 0, cacheReadInputTokens: 0, source: "estimated" as const } };
    },
  });

  // Result: 1 summary segment + COMPACT_KEEP_SEGMENTS verbatim
  assert.equal(result.length, COMPACT_KEEP_SEGMENTS + 1);
  assert.ok(result[0]!.content.includes("Summary of earlier turns."));
  assert.equal(result[0]!.role, "assistant");
  // The COMPACT_KEEP_SEGMENTS most recent segments are preserved verbatim
  assert.equal(result[1]!.content, `msg_${total - COMPACT_KEEP_SEGMENTS}`);
  assert.equal(result[result.length - 1]!.content, `msg_${total - 1}`);
  // Prompt contains the older segments
  assert.ok(capturedPrompt.includes("msg_0"));
  assert.ok(!capturedPrompt.includes(`msg_${total - 1}`));
});
