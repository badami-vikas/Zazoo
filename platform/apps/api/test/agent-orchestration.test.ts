/**
 * agentOrchestration.* (TASK-007, AGS0-AGS2) — end-to-end over the real
 * `buildWiring()` composition root: typed Goal/Task creation, the fail-closed
 * Goal/Task-bound Skill resolver, invoking a governed Skill through the SAME
 * `action.propose` gate every other mutation uses, and bounded child Agent
 * Runs (authority/budget/taint/review-mode narrowing + depth cap + cancel).
 */
import assert from "node:assert/strict";
import test from "node:test";
import {
  SeededRng,
  SystemClock,
  UuidGen,
  createChildAgentRun,
  type RunCtx,
} from "@bridge/core";
import { appRouter } from "../src/router.js";
import {
  buildWiring,
  PILOT_WORKSPACE,
  PILOT_USER,
  INTERNAL_STRATEGIST_AGENT,
  LEARNING_AGENT,
  GOVERNANCE_AGENT,
  CAPABILITY_BUILDER_AGENT,
  RELATIONSHIP_LEARNING_GOAL_TYPE,
  SYNTHESIZE_RECOMMENDATION_TASK_TYPE,
  type Wiring,
} from "../src/wiring.js";

function makeRun(): RunCtx {
  const clock = new SystemClock();
  const rng = new SeededRng(1);
  return { clock, rng, ids: new UuidGen(clock, rng) };
}

async function makeCaller(
  wiring: Wiring,
  identity: { type: "user" | "team"; id: string } = { type: "user", id: PILOT_USER },
) {
  return appRouter.createCaller({
    wiring,
    run: makeRun(),
    identity,
    authenticated: true,
    verifying: false,
  });
}

async function seedGoalAndTask(caller: Awaited<ReturnType<typeof makeCaller>>, assignedAgentId: string) {
  const goal = await caller.agentOrchestration.goal.create({
    workspaceId: PILOT_WORKSPACE,
    type: RELATIONSHIP_LEARNING_GOAL_TYPE,
    title: "test_fixture goal",
  });
  const task = await caller.agentOrchestration.task.create({
    workspaceId: PILOT_WORKSPACE,
    goalId: goal.id,
    type: SYNTHESIZE_RECOMMENDATION_TASK_TYPE,
    assignedAgentId,
  });
  return { goal, task };
}

test("agentOrchestration: a Task assigned to a non-default eligible Agent (Internal Strategist) resolves the governed skill", async () => {
  const wiring = await buildWiring();
  try {
    const caller = await makeCaller(wiring);
    const { goal, task } = await seedGoalAndTask(caller, INTERNAL_STRATEGIST_AGENT);
    const resolution = await caller.agentOrchestration.skill.resolve({
      workspaceId: PILOT_WORKSPACE,
      goalId: goal.id,
      taskId: task.id,
      agentId: INTERNAL_STRATEGIST_AGENT,
      skillId: "stageStrategicRecommendation",
    });
    assert.equal(resolution.ok, true);
    assert.equal(resolution.manifest?.skillId, "stageStrategicRecommendation");
  } finally {
    await wiring.close();
  }
});

test("agentOrchestration: the SAME governed skill resolves for Learning too, on a DIFFERENT Task assigned to it", async () => {
  const wiring = await buildWiring();
  try {
    const caller = await makeCaller(wiring);
    const { goal, task } = await seedGoalAndTask(caller, LEARNING_AGENT);
    const resolution = await caller.agentOrchestration.skill.resolve({
      workspaceId: PILOT_WORKSPACE,
      goalId: goal.id,
      taskId: task.id,
      agentId: LEARNING_AGENT,
      skillId: "stageStrategicRecommendation",
    });
    assert.equal(resolution.ok, true);
  } finally {
    await wiring.close();
  }
});

test("agentOrchestration: reassigning a Task changes eligibility — the old Agent loses it, the new one gains it", async () => {
  const wiring = await buildWiring();
  try {
    const caller = await makeCaller(wiring);
    const { goal, task } = await seedGoalAndTask(caller, LEARNING_AGENT);
    const before = await caller.agentOrchestration.skill.resolve({
      workspaceId: PILOT_WORKSPACE,
      goalId: goal.id,
      taskId: task.id,
      agentId: INTERNAL_STRATEGIST_AGENT,
      skillId: "stageStrategicRecommendation",
    });
    assert.equal(before.ok, false);
    assert.equal(before.reason, "not-assigned-agent");

    await caller.agentOrchestration.task.reassign({
      workspaceId: PILOT_WORKSPACE,
      taskId: task.id,
      assignedAgentId: INTERNAL_STRATEGIST_AGENT,
    });

    const after = await caller.agentOrchestration.skill.resolve({
      workspaceId: PILOT_WORKSPACE,
      goalId: goal.id,
      taskId: task.id,
      agentId: INTERNAL_STRATEGIST_AGENT,
      skillId: "stageStrategicRecommendation",
    });
    assert.equal(after.ok, true);
  } finally {
    await wiring.close();
  }
});

test("server-owned Agent runtime: an eligible assigned Agent invoking the governed skill via goalTaskRef drafts", async () => {
  const wiring = await buildWiring();
  try {
    const caller = await makeCaller(wiring);
    const { goal, task } = await seedGoalAndTask(caller, INTERNAL_STRATEGIST_AGENT);
    const proposal = await wiring.pipeline.propose({
      workspaceId: PILOT_WORKSPACE,
      actor: { type: "agent", id: INTERNAL_STRATEGIST_AGENT },
      action: "write",
      resourceType: "signal",
      inputs: { text: "a strategic recommendation" },
      skill: "stageStrategicRecommendation",
      goalTaskRef: { goalId: goal.id, taskId: task.id },
    }, makeRun());
    assert.equal(proposal.status, "pending_review");
  } finally {
    await wiring.close();
  }
});

test("action.propose: a Human directly invoking the governed skill fails closed even with a valid goalTaskRef", async () => {
  const wiring = await buildWiring();
  try {
    const caller = await makeCaller(wiring);
    const asHuman = await makeCaller(wiring, { type: "user", id: PILOT_USER }); // PILOT_USER holds a real signal:write grant
    const { goal, task } = await seedGoalAndTask(caller, INTERNAL_STRATEGIST_AGENT);
    await assert.rejects(
      () =>
        Reflect.apply(asHuman.action.propose, asHuman.action, [{
          workspaceId: PILOT_WORKSPACE,
          actor: { type: "user", id: PILOT_USER },
          action: "write",
          resourceType: "signal",
          inputs: { text: "a strategic recommendation" },
          skill: "stageStrategicRecommendation",
          goalTaskRef: { goalId: goal.id, taskId: task.id },
        }]),
      /stageMutation|invalid literal/i,
    );

    test("action.propose handles null inputs without crashing policy evaluation", async () => {
      const wiring = await buildWiring();
      try {
        const caller = await makeCaller(wiring);
        const proposal = await caller.action.propose({
          workspaceId: PILOT_WORKSPACE,
          actor: { type: "user", id: PILOT_USER },
          action: "write",
          resourceType: "person",
          inputs: null,
          skill: "stageMutation",
        });
        assert.equal(proposal.status, "applied");
        assert.equal(proposal.output?.proposedOutput, null);
      } finally {
        await wiring.close();
      }
    });
  } finally {
    await wiring.close();
  }
});

test("server-owned Agent runtime: a governed Skill with no goalTaskRef fails closed", async () => {
  const wiring = await buildWiring();
  try {
    const caller = await makeCaller(wiring);
    const proposal = await wiring.pipeline.propose({
      workspaceId: PILOT_WORKSPACE,
      actor: { type: "agent", id: INTERNAL_STRATEGIST_AGENT },
      action: "write",
      resourceType: "signal",
      inputs: { text: "a strategic recommendation" },
      skill: "stageStrategicRecommendation",
    }, makeRun());
    assert.equal(proposal.status, "rejected");
    assert.match(proposal.rejectionReason ?? "", /requires a resolved Goal\/Task assignment/);
  } finally {
    await wiring.close();
  }
});

test("server-owned child Run creation is inspectable and cancellable through the authenticated workspace-scoped API", async () => {
  const wiring = await buildWiring();
  try {
    const caller = await makeCaller(wiring);
    const { goal, task } = await seedGoalAndTask(caller, INTERNAL_STRATEGIST_AGENT);
    const parentRunId = crypto.randomUUID();
    const run = await createChildAgentRun(
      { store: wiring.childAgentRuns, ledger: wiring.ledger },
      {
        runId: parentRunId,
        agentId: INTERNAL_STRATEGIST_AGENT,
        workspaceId: PILOT_WORKSPACE,
        authorityScope: ["signal:write"],
        eligibleSkills: ["stageStrategicRecommendation"],
        dataScope: "all",
        plane: "local",
        budgetRemaining: { calls: 3, cost: 3 },
        reviewMode: "approve",
        childRunPolicy: "allowed",
        delegationDepth: 0,
      },
      {
        goalId: goal.id,
        taskId: task.id,
        delegatedScope: ["signal:write", "ledger:write"],
        selectedSkills: ["stageStrategicRecommendation"],
        budget: { maxCalls: 3, maxCost: 3 },
        deadline: "2099-01-01T00:00:00.000Z",
        stopCondition: "test_fixture stop condition",
      },
      makeRun(),
    );
    assert.deepEqual(run.authorityScope, ["signal:write"]); // narrowed to the agent's real scope
    assert.deepEqual(run.droppedScope, ["ledger:write"]);
    assert.deepEqual(run.eligibleSkills, ["stageStrategicRecommendation"]);
    assert.equal(run.budget.maxCalls, 3); // narrowed to the (smaller) parent ceiling
    assert.equal(run.depth, 1);

    const fetched = await caller.agentOrchestration.childRun.get({
      workspaceId: PILOT_WORKSPACE,
      childRunId: run.id,
    });
    assert.deepEqual(fetched, run);

    const byParent = await caller.agentOrchestration.childRun.listByParentRun({
      workspaceId: PILOT_WORKSPACE,
      parentRunId,
    });
    assert.equal(byParent.length, 1);

    const cancelled = await caller.agentOrchestration.childRun.cancel({
      workspaceId: PILOT_WORKSPACE,
      childRunId: run.id,
    });
    assert.equal(cancelled.status, "cancelled");
  } finally {
    await wiring.close();
  }
});

test("agentOrchestration exposes no client-controlled child Run creation procedure", async () => {
  const wiring = await buildWiring();
  try {
    const caller = await makeCaller(wiring);
    assert.equal("create" in caller.agentOrchestration.childRun, false);
  } finally {
    await wiring.close();
  }
});

test("agentOrchestration queries require workspace membership", async () => {
  const wiring = await buildWiring();
  try {
    const outsider = await makeCaller(wiring, { type: "user", id: crypto.randomUUID() });
    await assert.rejects(
      () => outsider.agentOrchestration.goal.list({ workspaceId: PILOT_WORKSPACE }),
      /not a member/,
    );
  } finally {
    await wiring.close();
  }
});

test("Agent-backed routes reject non-members before provisioning Tasks", async () => {
  const wiring = await buildWiring();
  try {
    const outsider = await makeCaller(wiring, { type: "user", id: crypto.randomUUID() });
    const before = await wiring.goalTasks.listGoals(PILOT_WORKSPACE);

    await assert.rejects(
      () =>
        outsider.capture.stage({
          workspaceId: PILOT_WORKSPACE,
          localMediaId: "test_fixture_local_media",
          capturedAt: "2026-07-18T12:00:00.000Z",
        }),
      /not a member/,
    );
    await assert.rejects(
      () => outsider.dealpilot.discoverDeals({ workspaceId: PILOT_WORKSPACE, sourceId: "source-1" }),
      /not a member/,
    );
    await assert.rejects(() => outsider.google.syncGmail(), /not a member/);
    await assert.rejects(() => outsider.google.syncCalendar(), /not a member/);
    await assert.rejects(() => outsider.google.listEvents(), /not a member/);
    await assert.rejects(
      () =>
        outsider.onboarding.recommendFromRoleModel({
          workspaceId: PILOT_WORKSPACE,
          figure: "test fixture figure",
          admiredFor: "test fixture trait",
        }),
      /not a member/,
    );

    assert.equal((await wiring.goalTasks.listGoals(PILOT_WORKSPACE)).length, before.length);
  } finally {
    await wiring.close();
  }
});

test("AGS3: all five foundational Agents have durable boundaries — Governance and Capability Builder can ALSO be assigned a Task and resolve a governed Skill (assignment governs, not a fixed 2-agent roster)", async () => {
  const wiring = await buildWiring();
  try {
    const caller = await makeCaller(wiring);
    const goal = await caller.agentOrchestration.goal.create({
      workspaceId: PILOT_WORKSPACE,
      type: RELATIONSHIP_LEARNING_GOAL_TYPE,
      title: "test_fixture AGS3 durable-boundary goal",
    });

    for (const agentId of [GOVERNANCE_AGENT, CAPABILITY_BUILDER_AGENT]) {
      const task = await caller.agentOrchestration.task.create({
        workspaceId: PILOT_WORKSPACE,
        goalId: goal.id,
        type: SYNTHESIZE_RECOMMENDATION_TASK_TYPE,
        assignedAgentId: agentId,
      });
      const resolution = await caller.agentOrchestration.skill.resolve({
        workspaceId: PILOT_WORKSPACE,
        goalId: goal.id,
        taskId: task.id,
        agentId,
        skillId: "stageStrategicRecommendation",
      });
      assert.equal(resolution.ok, true, `expected ${agentId} to resolve the governed skill once assigned its own Task`);
    }
  } finally {
    await wiring.close();
  }
});
