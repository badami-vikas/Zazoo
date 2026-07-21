import assert from "node:assert/strict";
import test from "node:test";
import { SeededRng, SystemClock, UuidGen, type RunCtx } from "@bridge/core";
import { appRouter } from "../src/router.js";
import {
  DEALPILOT_SOURCE_AUTOMATION_ID,
  DEALPILOT_SOURCE_AUTOMATION_KEY,
  DEALPILOT_SOURCING_AGENT_ID,
} from "../src/built-in-modules.js";
import {
  DRAFT_OUTREACH_TASK_TYPE,
  RELATIONSHIP_OUTREACH_GOAL_TYPE,
  buildWiring,
  PILOT_USER,
  PILOT_ORGANIZATION,
  type Wiring,
} from "../src/wiring.js";

function makeRun(): RunCtx {
  const clock = new SystemClock();
  const rng = new SeededRng(41);
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

async function seedOutreachGoalTask(caller: ReturnType<typeof makeCaller>, agentId: string) {
  const goal = await caller.agentOrchestration.goal.create({
    organizationId: PILOT_ORGANIZATION,
    type: RELATIONSHIP_OUTREACH_GOAL_TYPE,
    title: "Ownership test goal",
  });
  const task = await caller.agentOrchestration.task.create({
    organizationId: PILOT_ORGANIZATION,
    goalId: goal.id,
    type: DRAFT_OUTREACH_TASK_TYPE,
    assignedAgentId: agentId,
  });
  return { goal, task };
}

test("automation.runById derives its actor from the stored owning Agent", async () => {
  const wiring = await buildWiring();
  try {
    const caller = makeCaller(wiring);
    const agent = await caller.agent.create({
      organizationId: PILOT_ORGANIZATION,
      name: "Ownership test Agent",
      roleTemplateId: "outreach",
    });
    const { goal, task } = await seedOutreachGoalTask(caller, agent.agentId);
    const created = await caller.automation.create({
      organizationId: PILOT_ORGANIZATION,
      name: "Ownership test Automation",
      agentId: agent.agentId,
      steps: [{
        skill: "outreach.stageDraft",
        action: "write",
        resourceType: "event",
        inputs: { title: "Prepare governed draft" },
        goalTaskRef: { goalId: goal.id, taskId: task.id },
      }],
    });
    assert.equal(created.ok, true);
    if (!created.ok) return;

    const result = await caller.automation.runById({
      organizationId: PILOT_ORGANIZATION,
      automationId: created.automationId,
    });
    assert.equal(result.proposals[0]?.request.actor.type, "agent");
    assert.equal(result.proposals[0]?.request.actor.id, agent.agentId);
    assert.equal(result.proposals[0]?.request.actor.plane, "local");
  } finally {
    await wiring.close();
  }
});

test("the API exposes no caller-supplied step execution or product-composition execution route", () => {
  const procedures = Object.keys(appRouter._def.procedures);
  assert.deepEqual(
    procedures
      .filter((name) => name.startsWith("automation."))
      .map((name) => name.slice("automation.".length))
      .sort(),
    ["create", "runById"],
  );
});

test("automation.create rejects an inactive or unknown owning Agent", async () => {
  const wiring = await buildWiring();
  try {
    const caller = makeCaller(wiring);
    const agent = await caller.agent.create({
      organizationId: PILOT_ORGANIZATION,
      name: "Inactive ownership test Agent",
      roleTemplateId: "outreach",
    });
    assert.ok(wiring.memory);
    wiring.memory.agents.statuses.set(agent.agentId, "paused");
    const input = {
      organizationId: PILOT_ORGANIZATION,
      name: "Invalid owner Automation",
      steps: [{
        skill: "outreach.stageDraft",
        action: "write" as const,
        resourceType: "event" as const,
        inputs: {},
      }],
    };

    await assert.rejects(
      caller.automation.create({ ...input, agentId: agent.agentId }),
      /active Agent in the Organization/,
    );
    await assert.rejects(
      caller.automation.create({
        ...input,
        agentId: "00000000-0000-4000-8000-000000000099",
      }),
      /active Agent in the Organization/,
    );
  } finally {
    await wiring.close();
  }
});

test("manifest-declared DealPilot Automation registers its cloud owning Agent", async () => {
  const wiring = await buildWiring();
  try {
    const definition = await wiring.automationRegistry.load(
      PILOT_ORGANIZATION,
      DEALPILOT_SOURCE_AUTOMATION_ID,
    );
    assert.equal(definition?.agentId, DEALPILOT_SOURCING_AGENT_ID);
    assert.equal(definition?.agentPlane, "cloud");
    assert.equal(definition?.steps[0]?.skill, "dealpilot.source");
    assert.equal(definition?.steps[0]?.resourceType, "external:fetch");
    assert.equal(definition?.steps[0]?.dataScope, "public");
    assert.ok(definition?.steps[0]?.goalTaskRef);
    const goalTaskRef = definition.steps[0]!.goalTaskRef!;
    const [goal, task] = await Promise.all([
      wiring.goalTasks.getGoal(PILOT_ORGANIZATION, goalTaskRef.goalId),
      wiring.goalTasks.getTask(PILOT_ORGANIZATION, goalTaskRef.taskId),
    ]);
    assert.ok(goal);
    assert.equal(task?.assignedAgentId, DEALPILOT_SOURCING_AGENT_ID);
    assert.equal(task?.status, "open");
  } finally {
    await wiring.close();
  }
});

test("manifest Automation keys resolve only through their installed owning Module", async () => {
  const wiring = await buildWiring();
  try {
    const caller = makeCaller(wiring);
    const modules = await caller.modules.list({
      organizationId: PILOT_ORGANIZATION,
      limit: 100,
      offset: 0,
    });
    const dealPilot = modules.items.find((item) => item.moduleName === "deal-pilot");
    assert.ok(dealPilot?.runtimeAutomationIds.length);

    await assert.rejects(
      () =>
        caller.automation.runById({
          organizationId: PILOT_ORGANIZATION,
          automationId: DEALPILOT_SOURCE_AUTOMATION_KEY,
          moduleName: "job-pilot",
        }),
      /no verified runtime binding/,
    );
    await assert.rejects(
      () =>
        caller.automation.runById({
          organizationId: PILOT_ORGANIZATION,
          automationId: DEALPILOT_SOURCE_AUTOMATION_ID,
        }),
      /manifest key and Module binding/,
    );
  } finally {
    await wiring.close();
  }
});

test("automation routes reject authenticated nonmembers before loading definitions", async () => {
  const wiring = await buildWiring();
  try {
    const outsider = appRouter.createCaller({
      wiring,
      run: makeRun(),
      identity: {
        type: "user" as const,
        id: "b0000000-0000-4000-a000-00000000ffff",
      },
      authenticated: true,
      verifying: false,
    });
    await assert.rejects(
      () =>
        outsider.automation.runById({
          organizationId: PILOT_ORGANIZATION,
          automationId: DEALPILOT_SOURCE_AUTOMATION_KEY,
          moduleName: "deal-pilot",
        }),
      /not a member of organization/,
    );
    await assert.rejects(
      () =>
        outsider.automation.create({
          organizationId: PILOT_ORGANIZATION,
          name: "Unauthorized Automation",
          agentId: DEALPILOT_SOURCING_AGENT_ID,
          steps: [{
            skill: "dealpilot.source",
            action: "read",
            resourceType: "external:fetch",
            inputs: {},
          }],
        }),
      /not a member of organization/,
    );
  } finally {
    await wiring.close();
  }
});
