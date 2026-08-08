/**
 * TM3's four model-backed planning Skills, and the Playbooks they run under.
 *
 * The gap these close: the four Skill ids were registered `SkillManifest`s
 * whose `run()` echoed its inputs, and `TASK_MANAGER_PLAYBOOKS` was five names
 * with no content and no consumer.
 *
 * The load-bearing assertions are about what happens when the model is absent
 * or wrong, because that is where a planning Skill is tempted to fabricate:
 *  - no model configured → the Playbook's real questions, ZERO drafted items,
 *    and a note saying why (never an empty list that reads as "found nothing");
 *  - malformed or empty model output → the same honest degrade, never a
 *    partially-invented plan;
 *  - dot-paths for generated children are computed here, never taken from the
 *    model, because the path is the queue's identity and ordering.
 */
import assert from "node:assert/strict";
import test from "node:test";
import {
  TASK_MANAGER_PLAYBOOKS,
  TASK_PLAYBOOKS,
  decomposeTask,
  frameGoalOutcomes,
  generateCandidateTasks,
  nextChildPaths,
  resolveTaskPlaybook,
  runPremortem,
  type ModelProvider,
} from "../src/index.js";

function testModel(reply: string): ModelProvider {
  return {
    id: "test-model",
    plane: "local",
    tiers: ["reasoning"],
    models: { reasoning: "test-model-v1" },
    routingHealth: () => "healthy",
    async complete(req) {
      return {
        text: reply,
        model: "test-model-v1",
        tier: req.tier,
        usage: {
          inputTokens: 40,
          outputTokens: 20,
          cacheCreationInputTokens: 0,
          cacheReadInputTokens: 0,
          source: "provider",
        },
      };
    },
  };
}

test("every registered Playbook carries real content, and the roster derives from it", () => {
  assert.equal(TASK_PLAYBOOKS.length, 5);
  for (const playbook of TASK_PLAYBOOKS) {
    assert.ok(playbook.methodology.length > 0, `${playbook.id} has no methodology`);
    assert.ok(playbook.intent.length > 0, `${playbook.id} has no intent`);
    assert.ok(playbook.guidance.length > 0, `${playbook.id} has no guidance`);
    assert.ok(playbook.prompts.length >= 3, `${playbook.id} has too few prompts to stand alone`);
    assert.ok(playbook.skills.length > 0, `${playbook.id} is consumed by no Skill`);
  }
  // The roster used to be the only thing that existed. It must now be a
  // projection of the content, so the two cannot drift.
  assert.deepEqual(
    TASK_MANAGER_PLAYBOOKS.map((p) => p.id),
    TASK_PLAYBOOKS.map((p) => p.id),
  );

  // Every one of the four Skills is reachable from at least one Playbook.
  const covered = new Set(TASK_PLAYBOOKS.flatMap((p) => p.skills));
  for (const skill of [
    "goal-outcome-framing",
    "candidate-task-generation",
    "premortem-scenario",
    "task-decomposition",
  ] as const) {
    assert.ok(covered.has(skill), `no Playbook supports ${skill}`);
  }
});

test("a Playbook that does not support the Skill is refused, not silently swapped", () => {
  assert.throws(
    () => resolveTaskPlaybook("task-decomposition", "pre-mortem"),
    /does not support task-decomposition/,
  );
  assert.throws(() => resolveTaskPlaybook("premortem-scenario", "no-such-playbook"), /not a registered Playbook/);
});

test("no model configured: every Skill returns the Playbook's questions and drafts NOTHING", async () => {
  const framing = await frameGoalOutcomes({ title: "Ship the pilot" });
  assert.equal(framing.source, "playbook_scaffold");
  assert.deepEqual(framing.outcomes, []);
  // `null`, not `false` — the scaffold has not assessed this, and `false`
  // would read as a considered answer.
  assert.equal(framing.isGoalProposed, null);
  assert.ok(framing.note && framing.note.length > 0);
  assert.ok(framing.prompts.length >= 3);
  assert.equal(framing.modelReceipt, undefined);

  const candidates = await generateCandidateTasks({ parentTitle: "Ship the pilot" });
  assert.equal(candidates.source, "playbook_scaffold");
  assert.deepEqual(candidates.candidates, []);
  assert.ok(candidates.note);

  const premortem = await runPremortem({ title: "Ship the pilot" });
  assert.equal(premortem.source, "playbook_scaffold");
  assert.deepEqual(premortem.failureModes, []);
  assert.ok(premortem.note);

  const decomposition = await decomposeTask({ title: "Ship the pilot", parentPath: "3" });
  assert.equal(decomposition.source, "playbook_scaffold");
  assert.deepEqual(decomposition.children, []);
  assert.ok(decomposition.note);
});

test("goal-outcome-framing parses a model draft, caps it, and allows only one north star", async () => {
  const model = testModel(
    JSON.stringify({
      isGoal: true,
      reason: "It has no single terminal done state.",
      outcomes: [
        { title: "Active pilots", measure: "count", target: "5", indicatorKind: "lagging", northStar: true },
        { title: "Weekly sessions", measure: "count", target: "20", indicatorKind: "leading", northStar: true },
        // Dropped: a result with no measure and no target is what this
        // Playbook exists to prevent.
        { title: "Feels better", measure: "", target: "", indicatorKind: "leading", northStar: false },
      ],
    }),
  );
  const framing = await frameGoalOutcomes({ title: "Grow the pilot", model });
  assert.equal(framing.source, "model");
  assert.equal(framing.isGoalProposed, true);
  assert.equal(framing.outcomes.length, 2);
  assert.equal(framing.outcomes.filter((o) => o.northStar).length, 1);
  assert.equal(framing.outcomes[0]?.northStar, true);
  assert.equal(framing.modelReceipt?.tier, "reasoning");
  assert.equal(framing.modelReceipt?.usage.outputTokens, 20);
});

test("model output that is prose, malformed, or empty degrades to the scaffold — never a partial plan", async () => {
  const prose = await frameGoalOutcomes({ title: "Grow the pilot", model: testModel("Sure! Here are some ideas.") });
  assert.equal(prose.source, "playbook_scaffold");
  assert.deepEqual(prose.outcomes, []);

  const empty = await runPremortem({ title: "Ship it", model: testModel(JSON.stringify({ failureModes: [] })) });
  assert.equal(empty.source, "playbook_scaffold");
  assert.deepEqual(empty.failureModes, []);

  // Every entry is missing a required field, so nothing survives validation
  // and the result must not claim to be a model answer.
  const unusable = await runPremortem({
    title: "Ship it",
    model: testModel(JSON.stringify({ failureModes: [{ cause: "It slipped" }, { mitigation: "Start earlier" }] })),
  });
  assert.equal(unusable.source, "playbook_scaffold");
  assert.deepEqual(unusable.failureModes, []);
});

test("JSON wrapped in a code fence or a sentence is still parsed strictly", async () => {
  const model = testModel(
    "Here you go:\n```json\n" +
      JSON.stringify({
        failureModes: [{ cause: "Scope grew", earlySignal: "Third new must-have", mitigation: "Freeze scope Friday" }],
      }) +
      "\n```",
  );
  const premortem = await runPremortem({ title: "Ship it", horizon: "end of the quarter", model });
  assert.equal(premortem.source, "model");
  assert.equal(premortem.horizon, "end of the quarter");
  assert.equal(premortem.failureModes.length, 1);
  assert.equal(premortem.failureModes[0]?.cause, "Scope grew");
});

test("generated candidates always carry status candidate — the model never chooses it", async () => {
  const model = testModel(
    JSON.stringify({
      candidates: [
        {
          title: "Interview five pilot users",
          rationale: "We are guessing at the blocker.",
          stakeholders: ["Design"],
          dependencies: [],
          risks: ["Nobody replies"],
          // A model claiming a committed status must not be able to promote
          // its own suggestion into the live queue.
          status: "in_progress",
        },
        { title: "No rationale so this is dropped", rationale: "" },
      ],
    }),
  );
  const result = await generateCandidateTasks({ parentTitle: "Fix activation", model });
  assert.equal(result.source, "model");
  assert.equal(result.candidates.length, 1);
  assert.equal(result.candidates[0]?.status, "candidate");
  assert.deepEqual(result.candidates[0]?.stakeholders, ["Design"]);
});

test("decomposition paths are computed from the parent, never taken from the model", async () => {
  const model = testModel(
    JSON.stringify({
      children: [
        { title: "Draft the schema", exitTest: "Migration applies on a clean database", rationale: "", path: "9.9.9" },
        { title: "Wire the endpoint", exitTest: "A request returns a stored row", rationale: "Needed by the UI" },
        // Dropped: the exit test is the most load-bearing field in the plan.
        { title: "Polish", exitTest: "" },
      ],
    }),
  );
  const result = await decomposeTask({
    title: "Build the queue API",
    parentPath: "2.3",
    existingChildPaths: ["2.3.1", "2.3.2", "2.3.2.1"],
    model,
  });
  assert.equal(result.source, "model");
  assert.equal(result.children.length, 2);
  // Continues after the highest DIRECT sibling (2.3.2); the grandchild
  // 2.3.2.1 says nothing about this level.
  assert.deepEqual(
    result.children.map((child) => child.path),
    ["2.3.3", "2.3.4"],
  );
  assert.equal(result.children.every((child) => child.level === 3), true);
  // The model's invented "9.9.9" never reaches the output.
  assert.equal(
    result.children.some((child) => child.path === "9.9.9"),
    false,
  );
});

test("nextChildPaths ignores deeper descendants and requires a parent path", () => {
  assert.deepEqual(nextChildPaths("1", [], 2), ["1.1", "1.2"]);
  assert.deepEqual(nextChildPaths("1", ["1.1", "1.10", "1.10.4"], 1), ["1.11"]);
  // A sibling under a DIFFERENT parent must not advance this parent's index.
  assert.deepEqual(nextChildPaths("1", ["2.7"], 1), ["1.1"]);
  assert.throws(() => nextChildPaths("  ", [], 1), /parentPath is required/);
});

test("decomposeTask refuses to place children with no parent path", async () => {
  await assert.rejects(
    () => decomposeTask({ title: "Anything", parentPath: "   " }),
    /parentPath is required/,
  );
});
