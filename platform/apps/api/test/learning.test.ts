/**
 * learning.* (TASK-032) — the observation-loop flight over the real
 * `buildWiring()` composition root.
 *
 * Contract under test:
 *  - flight OFF (default): `learning.status` reports disabled; every other
 *    `learning.*` procedure fails closed with `PRECONDITION_FAILED`;
 *  - flight ON: record decisions → digest proposes (never writes a
 *    preference) → accept mints exactly one preference with provenance →
 *    reject suppresses re-proposal → double-accept is a typed CONFLICT →
 *    another member's private rows are NOT_FOUND to this caller.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { TRPCError } from "@trpc/server";
import {
  SeededRng,
  SystemClock,
  UuidGen,
  acceptSuggestion,
  digestSignals,
  hashTaintValue,
  labelAtSource,
  recordSignal,
  type ModelCompletionRequest,
  type ModelProvider,
  type ModelTier,
  type RunCtx,
} from "@bridge/core";
import { appRouter } from "../src/router.js";
import { deterministicUuid } from "../src/deterministic-uuid.js";
import {
  buildWiring,
  LEARNING_AGENT,
  LEARNING_DIGEST_AUTOMATION_ID,
  OBSERVATION_DIGEST_SKILL_ID,
  PILOT_ORGANIZATION,
  PILOT_USER,
  type Wiring,
} from "../src/wiring.js";
import { makeCaller, makeRun } from "./caller.js";

const ORG = PILOT_ORGANIZATION;

/** Seed generic observed signals directly on the store. K1 deleted the
 * per-module recording procedure — in production, signals come from the
 * ledger miner (exercised end-to-end below) and later from K2's
 * consent-gated emitters; tests whose subject is the DOWNSTREAM machinery
 * seed the store the same way the miner does. */
let seedSequence = 0;
async function seedSignals(wiring: Wiring, count: number, industry = "restaurants") {
  for (let i = 0; i < count; i += 1) {
    seedSequence += 1;
    await recordSignal(wiring.memoryStore, {
      id: deterministicUuid(`test_fixture_signal_${industry}_${seedSequence}`),
      organizationId: ORG,
      ownerUserId: PILOT_USER,
      moduleId: "dealpilot",
      recordKind: "deal",
      recordId: `deal-${industry}-${i}`,
      action: "dismiss",
      attributes: { industry },
    });
  }
}

test("flight OFF: status reports disabled and every other procedure fails closed", async () => {
  const wiring = await buildWiring({ learningObservationEnabled: false }); // flight off (default is ON since AP-182)
  try {
    const caller = await makeCaller(wiring);
    assert.deepEqual(await caller.learning.status({ organizationId: ORG }), { enabled: false });
    await assert.rejects(
      () => caller.learning.digest({ organizationId: ORG }),
      (error: unknown) => error instanceof TRPCError && error.code === "PRECONDITION_FAILED",
    );
    await assert.rejects(
      () => caller.learning.suggestions.list({ organizationId: ORG }),
      (error: unknown) => error instanceof TRPCError && error.code === "PRECONDITION_FAILED",
    );
    await assert.rejects(
      () => caller.learning.preferences.list({ organizationId: ORG }),
      (error: unknown) => error instanceof TRPCError && error.code === "PRECONDITION_FAILED",
    );
  } finally {
    await wiring.close();
  }
});

test("flight ON: signals → digest → accept mints one preference; reject suppresses; conflicts typed", async () => {
  const wiring = await buildWiring({ learningObservationEnabled: true });
  try {
    const caller = await makeCaller(wiring);
    assert.deepEqual(await caller.learning.status({ organizationId: ORG }), { enabled: true });

    await seedSignals(wiring, 3);

    // Digest proposes (3+ same-industry signals) and writes NO preference.
    // No moduleId given: the fan-out discovers "dealpilot" from the signals
    // themselves, never from a default.
    const digested = await caller.learning.digest({ organizationId: ORG });
    assert.ok(digested.suggestions.length >= 1);
    const suggestion = digested.suggestions.find((s) => s.pattern.attributeKey === "industry");
    assert.ok(suggestion, "expected an industry-pattern suggestion");
    assert.equal((await caller.learning.preferences.list({ organizationId: ORG })).preferences.length, 0);

    // Listed as proposed; accept mints exactly one preference with provenance.
    const listed = await caller.learning.suggestions.list({ organizationId: ORG, status: "proposed" });
    assert.ok(listed.suggestions.some((s) => s.memoryId === suggestion.memoryId));
    const accepted = await caller.learning.suggestions.accept({ organizationId: ORG, suggestionMemoryId: suggestion.memoryId });
    const preferences = (await caller.learning.preferences.list({ organizationId: ORG })).preferences;
    assert.equal(preferences.length, 1);
    assert.equal(preferences[0]!.memoryId, accepted.preferenceMemoryId);
    assert.equal(preferences[0]!.provenance.suggestionId, accepted.suggestionMemoryId);
    assert.ok(preferences[0]!.provenance.evidenceSignalIds.length >= 3);

    // Double-accept is a typed CONFLICT, and no second preference appears.
    await assert.rejects(
      () => caller.learning.suggestions.accept({ organizationId: ORG, suggestionMemoryId: suggestion.memoryId }),
      (error: unknown) => error instanceof TRPCError && error.code === "CONFLICT",
    );
    assert.equal((await caller.learning.preferences.list({ organizationId: ORG })).preferences.length, 1);

    // A second repeated pattern: reject it, then confirm more signals never
    // re-propose it and no preference was written for it.
    await seedSignals(wiring, 3, "logging");
    const second = await caller.learning.digest({ organizationId: ORG });
    const loggingSuggestion = second.suggestions.find((s) => s.pattern.attributeValue === "logging");
    assert.ok(loggingSuggestion, "expected a logging-pattern suggestion");
    await caller.learning.suggestions.reject({ organizationId: ORG, suggestionMemoryId: loggingSuggestion.memoryId });
    await seedSignals(wiring, 3, "logging");
    const third = await caller.learning.digest({ organizationId: ORG });
    assert.equal(third.suggestions.filter((s) => s.pattern.attributeValue === "logging").length, 0);
    assert.equal((await caller.learning.preferences.list({ organizationId: ORG })).preferences.length, 1);
  } finally {
    await wiring.close();
  }
});

test("K0 regression: the digest Automation id is a real UUID — the automations table's id column is uuid-typed", () => {
  // The FIRST live boot with BRIDGE_LEARNING_OBSERVATION=1 on the durable
  // Local Plane (AI Harness K0, 2026-08-09) crashed on exactly this: the id
  // was the dotted key "platform.learning.observation-digest", pglite refused
  // it with 22P02, and the API process died — which would have bricked every
  // desktop boot once the sidecar turned the flight on. The suite never saw
  // it because in-memory mode accepts any string as an id.
  assert.match(
    LEARNING_DIGEST_AUTOMATION_ID,
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    "LEARNING_DIGEST_AUTOMATION_ID must be a UUID or the durable automations table refuses the seed at boot",
  );
});

test("flight OFF: the digest Automation does not exist — nothing to trigger", async () => {
  const wiring = await buildWiring({ learningObservationEnabled: false });
  try {
    assert.equal(await wiring.automationRegistry.load(PILOT_ORGANIZATION, LEARNING_DIGEST_AUTOMATION_ID), null);
  } finally {
    await wiring.close();
  }
});

test("flight ON: the digest Automation is registered to the Learning Agent and runs the loop end to end", async () => {
  const wiring = await buildWiring({ learningObservationEnabled: true });
  try {
    // Registered: Learning Agent is the sole actor, one advisory Local step.
    const definition = await wiring.automationRegistry.load(PILOT_ORGANIZATION, LEARNING_DIGEST_AUTOMATION_ID);
    assert.ok(definition, "digest Automation must be registered while the flight is on");
    assert.equal(definition.agentId, LEARNING_AGENT);
    assert.equal(definition.agentPlane, "local");
    assert.equal(definition.steps.length, 1);
    assert.equal(definition.steps[0]!.skill, OBSERVATION_DIGEST_SKILL_ID);
    assert.ok(definition.steps[0]!.goalTaskRef, "the step must bind the Learning Agent's Goal/Task");

    // End to end: repeated dismissals → Automation run → proposed suggestion,
    // and STILL no preference (suggested-then-accepted survives the Automation path).
    const caller = await makeCaller(wiring);
    await seedSignals(wiring, 3, "trucking");
    // Same labeled RunCtx shape the server's scheduled trigger uses — the
    // taint sink gate fails closed on an UNKNOWN label by design.
    const result = await wiring.automationExecutor.runById(
      { organizationId: PILOT_ORGANIZATION, automationId: LEARNING_DIGEST_AUTOMATION_ID },
      {
        ...makeRun(),
        taintLabel: labelAtSource("system_generated", {
          ref: `schedule:${LEARNING_DIGEST_AUTOMATION_ID}`,
          valueHash: hashTaintValue({ automationId: LEARNING_DIGEST_AUTOMATION_ID }),
          sensitivity: "organization",
          instructionRisk: "data",
        }),
      },
    );
    assert.equal(result.status, "completed");
    const proposed = await caller.learning.suggestions.list({ organizationId: PILOT_ORGANIZATION, status: "proposed" });
    assert.ok(
      proposed.suggestions.some((s) => s.pattern.attributeValue === "trucking"),
      "the Automation-run digest must have proposed the trucking pattern",
    );
    assert.equal((await caller.learning.preferences.list({ organizationId: PILOT_ORGANIZATION })).preferences.length, 0);

    // Attributable Run record exists for the Automation.
    const runs = await wiring.automationRunRecorder.list(PILOT_ORGANIZATION, [LEARNING_DIGEST_AUTOMATION_ID], { limit: 5 });
    assert.ok(runs.length >= 1);
    assert.equal(runs[0]!.agentId, LEARNING_AGENT);
  } finally {
    await wiring.close();
  }
});

test("flight ON: another member cannot see or act on the owner's private learning rows", async () => {
  const wiring = await buildWiring({ learningObservationEnabled: true });
  try {
    const owner = await makeCaller(wiring);
    await seedSignals(wiring, 3);
    const [suggestion] = (await owner.learning.digest({ organizationId: ORG })).suggestions;
    assert.ok(suggestion);

    const invited = await owner.organization.inviteMember({
      organizationId: ORG,
      email: `test_fixture_learning_${Date.now()}@example.com`,
    });
    const other = await makeCaller(wiring, { type: "user", id: invited.userId });
    assert.equal((await other.learning.suggestions.list({ organizationId: ORG })).suggestions.length, 0);
    assert.equal((await other.learning.preferences.list({ organizationId: ORG })).preferences.length, 0);
    await assert.rejects(
      () => other.learning.suggestions.accept({ organizationId: ORG, suggestionMemoryId: suggestion.memoryId }),
      (error: unknown) => error instanceof TRPCError && error.code === "NOT_FOUND",
    );
  } finally {
    await wiring.close();
  }
});

class LearningChatModel implements ModelProvider {
  readonly id = "learning-chat-local";
  readonly plane = "local" as const;
  readonly tiers = ["cheap", "default"] as const satisfies readonly ModelTier[];
  readonly models = { cheap: "learning-chat-v1", default: "learning-chat-v1" } as const;
  readonly calls: ModelCompletionRequest[] = [];

  routingHealth() {
    return "healthy" as const;
  }

  async complete(request: ModelCompletionRequest) {
    this.calls.push(request);
    return {
      text: JSON.stringify({ kind: "answer", text: "Understood." }),
      model: "learning-chat-v1",
      tier: request.tier,
      usage: {
        inputTokens: 12,
        outputTokens: 4,
        cacheCreationInputTokens: 0,
        cacheReadInputTokens: 0,
        source: "provider" as const,
      },
      ...(request.taintLabel ? { taintLabel: request.taintLabel } : {}),
    };
  }
}

async function sendLocalChatTurn(wiring: Wiring) {
  const caller = await makeCaller(wiring);
  const { thread } = await caller.chat.thread.create({
    organizationId: ORG,
    plane: "local",
    clientRequestId: "learning-chat",
  });
  await caller.chat.turn.send({
    organizationId: ORG,
    threadId: thread.id,
    clientRequestId: "learning-chat-turn",
    message: "Which deals should I look at today?",
  });
}

test("flight ON: an accepted preference statement reaches the chat system prompt; raw machinery never does", async () => {
  const local = new LearningChatModel();
  const wiring = await buildWiring({ learningObservationEnabled: true, modelProviders: [local] });
  try {
    const caller = await makeCaller(wiring);
    await seedSignals(wiring, 3);
    const digested = await caller.learning.digest({ organizationId: ORG });
    const suggestion = digested.suggestions.find((s) => s.pattern.attributeKey === "industry");
    assert.ok(suggestion, "expected an industry-pattern suggestion");
    await caller.learning.suggestions.accept({ organizationId: ORG, suggestionMemoryId: suggestion.memoryId });

    await sendLocalChatTurn(wiring);
    assert.equal(local.calls.length, 1);
    const system = local.calls[0]!.system ?? "";
    // TASK-032 prototype-test clause: the minted preference's statement
    // reaches projectToSystemPrompt output.
    assert.match(system, /## Retrieved memory/);
    assert.match(system, /Prefers "dismiss" when industry is "restaurants"/);
    // Raw learning machinery (signal/suggestion JSON) never reaches a prompt.
    assert.doesNotMatch(system, /observed_signal/);
    assert.doesNotMatch(system, /learning_suggestion/);
    assert.doesNotMatch(system, /"anchor"/);
  } finally {
    await wiring.close();
  }
});

test("flight OFF: existing preference rows influence nothing — the chat prompt stays clean", async () => {
  const local = new LearningChatModel();
  const wiring = await buildWiring({ modelProviders: [local], learningObservationEnabled: false }); // flight off (default is ON since AP-182)
  try {
    // Rows minted while the flight WAS on still exist in the store — write
    // them through the core loop directly (the tRPC surface fails closed).
    // The persistent adapter's id/lineage columns are uuid-typed, so ids and
    // lineage keys go through deterministicUuid exactly as the API layer does.
    let n = 0;
    const nextId = () => deterministicUuid(`learning-off-${++n}`);
    for (let i = 0; i < 3; i += 1) {
      await recordSignal(wiring.memoryStore, {
        id: nextId(),
        organizationId: ORG,
        ownerUserId: PILOT_USER,
        moduleId: "dealpilot",
        recordKind: "deal",
        recordId: `deal-${i}`,
        action: "dismiss",
        attributes: { industry: "restaurants" },
      });
    }
    const scope = { organizationId: ORG, userId: PILOT_USER };
    const [suggestion] = await digestSignals(wiring.memoryStore, {
      organizationId: ORG,
      ownerUserId: PILOT_USER,
      moduleId: "dealpilot",
      nextId,
      lineageIdFor: deterministicUuid,
    });
    await acceptSuggestion(wiring.memoryStore, scope, suggestion!.memoryId, PILOT_USER, nextId);

    await sendLocalChatTurn(wiring);
    assert.equal(local.calls.length, 1);
    const system = local.calls[0]!.system ?? "";
    // Fail-closed: with the flight off the preference is dormant data, and
    // machinery JSON stays out of the prompt regardless of the flight.
    assert.doesNotMatch(system, /Prefers "dismiss"/);
    assert.doesNotMatch(system, /observed_signal/);
    assert.doesNotMatch(system, /"anchor"/);
  } finally {
    await wiring.close();
  }
});

test("K1 exit test: a governed action with NO module learning code becomes a signal; the miner is private and idempotent", async () => {
  const wiring = await buildWiring({ learningObservationEnabled: true });
  try {
    const caller = await makeCaller(wiring);
    // The flight seeding already bound the Learning Agent's digest Goal/Task
    // — reuse it as the governed action under test. The point being proven:
    // three agent proposals, three Human approvals, ZERO learning-specific
    // plumbing between the pipeline and the suggestion below.
    const digestGoal = (await wiring.goalTasks.listGoals(ORG)).find(
      (goal) => goal.type === "platform.learning_observation",
    );
    assert.ok(digestGoal, "flight seeding must have created the digest Goal");
    const digestTask = (await wiring.goalTasks.listTasksByGoal(ORG, digestGoal.id))[0];
    assert.ok(digestTask, "flight seeding must have created the digest Task");
    for (let i = 0; i < 3; i += 1) {
      const proposal = await wiring.pipeline.propose(
        {
          organizationId: ORG,
          actor: { type: "agent", id: LEARNING_AGENT },
          onBehalfOf: { type: "user", id: PILOT_USER },
          action: "write",
          resourceType: "signal",
          skill: OBSERVATION_DIGEST_SKILL_ID,
          trustOrigin: "user_content",
          goalTaskRef: { goalId: digestGoal.id, taskId: digestTask.id },
          inputs: { organizationId: ORG, note: `test_fixture_private_note_${i}_XYZZY` },
        },
        makeRun(),
      );
      assert.equal(proposal.status, "pending_review", "an agent proposal must halt for the Human");
      await caller.action.decide({ proposalId: proposal.id, decision: "approve" });
    }

    const digested = await caller.learning.digest({ organizationId: ORG });
    const suggestion = digested.suggestions.find(
      (s) => s.pattern.attributeKey === "skill" && s.pattern.attributeValue === OBSERVATION_DIGEST_SKILL_ID,
    );
    assert.ok(suggestion, "three approvals of the same skill must propose a pattern");
    assert.equal(suggestion.pattern.action, "approve");
    assert.ok(suggestion.pattern.count >= 3);
    // Module attribution came from the capability family of the skill id.
    assert.equal(suggestion.moduleId, "learning");

    // Privacy: the mined signals carry the attribution envelope only — the
    // proposal's private inputs never reach a signal row.
    const signals = await wiring.memoryStore.retrieve(
      { type: "episodic", sourceRefType: "feedback" },
      { organizationId: ORG, userId: PILOT_USER },
    );
    assert.ok(signals.length >= 3, "the approvals must exist as inspectable signal Memories");
    for (const row of signals) {
      assert.ok(!row.content.includes("XYZZY"), "a mined signal must never carry proposal payload content");
    }

    // Idempotency: a second pass mines nothing new, and the suggestion
    // lineage suppresses a re-proposal.
    const second = await caller.learning.digest({ organizationId: ORG });
    assert.equal(second.mined.signalCount, 0);
    assert.equal(second.suggestions.length, 0);
  } finally {
    await wiring.close();
  }
});

test("K1: the deleted per-module recording surface is gone — the router exposes no recordDealDecision", () => {
  // The mapping is deleted FOREVER (ADR-210 K1). A re-added procedure would
  // reintroduce per-module learning plumbing; this test names that regression.
  const procedurePaths = Object.keys(
    (appRouter as unknown as { _def: { procedures: Record<string, unknown> } })._def.procedures,
  );
  assert.ok(procedurePaths.some((path) => path.startsWith("learning.")), "sanity: learning procedures exist");
  assert.ok(
    !procedurePaths.includes("learning.recordDealDecision"),
    "recordDealDecision must not return",
  );
});
