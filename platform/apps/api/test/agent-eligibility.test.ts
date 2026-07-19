import assert from "node:assert/strict";
import test from "node:test";
import { TRPCError } from "@trpc/server";
import { SeededRng, SystemClock, UuidGen, resolveSkillForTask, type RunCtx } from "@bridge/core";
import { appRouter } from "../src/router.js";
import { AGENT_ROLE_TEMPLATES } from "../src/agent-role-templates.js";
import {
  PILOT_USER,
  PILOT_WORKSPACE,
  RELATIONSHIP_LEARNING_GOAL_TYPE,
  SYNTHESIZE_RECOMMENDATION_TASK_TYPE,
  buildWiring,
  type Wiring,
} from "../src/wiring.js";

const NON_PILOT_WORKSPACE = "d0000000-0000-4000-a000-00000000dead";

function makeRun(seed = 1): RunCtx {
  const clock = new SystemClock();
  const rng = new SeededRng(seed);
  return { clock, rng, ids: new UuidGen(clock, rng) };
}

function makeCaller(wiring: Wiring) {
  return appRouter.createCaller({
    wiring,
    run: makeRun(),
    identity: { type: "user" as const, id: PILOT_USER },
    authenticated: true,
    verifying: false,
  });
}

function templateById(id: string) {
  const template = AGENT_ROLE_TEMPLATES.find((candidate) => candidate.id === id);
  assert.ok(template, `expected agent role template "${id}" to exist`);
  return template;
}

test("agent.create: a role-template Agent is role-bound, active, and can execute only its governed skills in its workspace", async () => {
  const wiring = await buildWiring();
  try {
    const caller = makeCaller(wiring);
    const template = templateById("internal-strategist");
    const agent = await caller.agent.create({
      workspaceId: PILOT_WORKSPACE,
      name: "Eligibility test Agent",
      roleTemplateId: template.id,
    });

    assert.equal(await wiring.agents.workspaceId(agent.agentId), PILOT_WORKSPACE);
    assert.equal(await wiring.agents.isActive(agent.agentId), true);
    assert.equal(await wiring.agents.assumedRole(agent.agentId), template.roleId);
    assert.deepEqual(await wiring.agents.capabilityScope(agent.agentId), [...template.capabilityScope]);
    assert.deepEqual(await wiring.agents.allowedSkills(agent.agentId), [...template.allowedSkills]);
    assert.equal(await wiring.agents.dataScope(agent.agentId), template.dataScope);
    assert.equal(agent.roleTemplateId, template.id);
    assert.deepEqual(agent.scope, [...template.capabilityScope]);
    assert.deepEqual(agent.allowedSkills, [...template.allowedSkills]);
    assert.equal(agent.dataScope, template.dataScope);
    assert.equal(agent.egressTier, template.egressTier);
    assert.deepEqual(agent.dropped, []);

    const goal = await caller.agentOrchestration.goal.create({
      workspaceId: PILOT_WORKSPACE,
      type: RELATIONSHIP_LEARNING_GOAL_TYPE,
      title: "Eligibility test goal",
    });
    const task = await caller.agentOrchestration.task.create({
      workspaceId: PILOT_WORKSPACE,
      goalId: goal.id,
      type: SYNTHESIZE_RECOMMENDATION_TASK_TYPE,
      assignedAgentId: agent.agentId,
    });
    assert.equal(task.assignedAgentId, agent.agentId);

    const allowed = await wiring.pipeline.propose(
      {
        workspaceId: PILOT_WORKSPACE,
        actor: { type: "agent", id: agent.agentId, plane: "local" },
        action: "write",
        resourceType: "signal",
        inputs: { text: "a strategic recommendation" },
        skill: "stageStrategicRecommendation",
        goalTaskRef: { goalId: goal.id, taskId: task.id },
      },
      makeRun(),
    );
    assert.equal(allowed.status, "pending_review");

    const disallowed = await wiring.pipeline.propose(
      {
        workspaceId: PILOT_WORKSPACE,
        actor: { type: "agent", id: agent.agentId, plane: "local" },
        action: "write",
        resourceType: "signal",
        inputs: { text: "a learning recommendation" },
        skill: "stageLearningRecommendation",
        goalTaskRef: { goalId: goal.id, taskId: task.id },
      },
      makeRun(2),
    );
    assert.equal(disallowed.status, "rejected");
    assert.match(disallowed.rejectionReason ?? "", /not in agent allow-list/);

    const foreignGoal = await wiring.goalTasks.createGoal(
      {
        workspaceId: NON_PILOT_WORKSPACE,
        type: RELATIONSHIP_LEARNING_GOAL_TYPE,
        title: "Foreign workspace goal",
      },
      { nextId: () => crypto.randomUUID(), nowISO: () => new Date().toISOString() },
    );
    const foreignTask = await wiring.goalTasks.createTask(
      {
        workspaceId: NON_PILOT_WORKSPACE,
        goalId: foreignGoal.id,
        type: SYNTHESIZE_RECOMMENDATION_TASK_TYPE,
        assignedAgentId: agent.agentId,
      },
      { nextId: () => crypto.randomUUID(), nowISO: () => new Date().toISOString() },
    );
    const crossWorkspace = await resolveSkillForTask(
      wiring.skillManifests.forSkill(PILOT_WORKSPACE, "stageStrategicRecommendation"),
      {
        goal: foreignGoal,
        task: foreignTask,
        skillId: "stageStrategicRecommendation",
        agent: {
          id: agent.agentId,
          workspaceId: await wiring.agents.workspaceId(agent.agentId),
          active: await wiring.agents.isActive(agent.agentId),
          capabilityScope: await wiring.agents.capabilityScope(agent.agentId),
          plane: "local",
          dataScope: await wiring.agents.dataScope(agent.agentId),
        },
      },
    );
    assert.equal(crossWorkspace.ok, false);
    assert.equal(crossWorkspace.reason, "workspace-mismatch");
  } finally {
    await wiring.close();
  }
});

test("agent.create: an unknown roleTemplateId is rejected with BAD_REQUEST", async () => {
  const wiring = await buildWiring();
  try {
    const caller = makeCaller(wiring);
    await assert.rejects(
      () =>
        caller.agent.create({
          workspaceId: PILOT_WORKSPACE,
          name: "Unknown role Agent",
          roleTemplateId: "definitely-not-a-real-role-template",
        }),
      (error: unknown) => error instanceof TRPCError && error.code === "BAD_REQUEST",
    );
  } finally {
    await wiring.close();
  }
});

test("agent.create: a non-pilot workspaceId is rejected with FORBIDDEN", async () => {
  const wiring = await buildWiring();
  try {
    const caller = makeCaller(wiring);
    await assert.rejects(
      () =>
        caller.agent.create({
          workspaceId: NON_PILOT_WORKSPACE,
          name: "Wrong workspace Agent",
          roleTemplateId: "internal-strategist",
        }),
      (error: unknown) => error instanceof TRPCError && error.code === "FORBIDDEN",
    );
  } finally {
    await wiring.close();
  }
});
