import assert from "node:assert/strict";
import test from "node:test";
import { SeededRng, SystemClock, UuidGen, type RunCtx } from "@bridge/core";
import { appRouter } from "../src/router.js";
import {
  DEALPILOT_SOURCE_RITUAL_ID,
  DEALPILOT_SOURCE_RITUAL_KEY,
  DEALPILOT_SOURCING_AGENT_ID,
} from "../src/built-in-packages.js";
import {
  DRAFT_OUTREACH_TASK_TYPE,
  RELATIONSHIP_OUTREACH_GOAL_TYPE,
  buildWiring,
  PILOT_USER,
  PILOT_WORKSPACE,
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
    workspaceId: PILOT_WORKSPACE,
    type: RELATIONSHIP_OUTREACH_GOAL_TYPE,
    title: "Ownership test goal",
  });
  const task = await caller.agentOrchestration.task.create({
    workspaceId: PILOT_WORKSPACE,
    goalId: goal.id,
    type: DRAFT_OUTREACH_TASK_TYPE,
    assignedAgentId: agentId,
  });
  return { goal, task };
}

test("ritual.runById derives the actor from the stored owning Agent", async () => {
  const wiring = await buildWiring();
  try {
    const caller = makeCaller(wiring);
    const agent = await caller.agent.create({
      workspaceId: PILOT_WORKSPACE,
      name: "Ownership test Agent",
      roleTemplateId: "outreach",
    });
    const { goal, task } = await seedOutreachGoalTask(caller, agent.agentId);
    const created = await caller.ritual.create({
      workspaceId: PILOT_WORKSPACE,
      name: "Ownership test Automation",
      agentIds: [agent.agentId],
      steps: [{
        skill: "outreach.stageDraft",
        action: "write",
        resourceType: "touchpoint",
        inputs: { title: "Prepare governed draft" },
        goalTaskRef: { goalId: goal.id, taskId: task.id },
      }],
    });
    assert.equal(created.ok, true);
    if (!created.ok) return;

    const result = await caller.ritual.runById({
      workspaceId: PILOT_WORKSPACE,
      ritualId: created.ritualId,
    });
    assert.equal(result.proposals[0]?.request.actor.type, "agent");
    assert.equal(result.proposals[0]?.request.actor.id, agent.agentId);
    assert.equal(result.proposals[0]?.request.actor.plane, "local");
  } finally {
    await wiring.close();
  }
});

test("ritual.runById rejects an arbitrary caller-supplied actor", async () => {
  const wiring = await buildWiring();
  try {
    const caller = makeCaller(wiring);
    const agent = await caller.agent.create({
      workspaceId: PILOT_WORKSPACE,
      name: "Bound test Agent",
      roleTemplateId: "outreach",
    });
    const { goal, task } = await seedOutreachGoalTask(caller, agent.agentId);
    const created = await caller.ritual.create({
      workspaceId: PILOT_WORKSPACE,
      name: "Bound test Automation",
      agentIds: [agent.agentId],
      steps: [{
        skill: "outreach.stageDraft",
        action: "write",
        resourceType: "touchpoint",
        inputs: {},
        goalTaskRef: { goalId: goal.id, taskId: task.id },
      }],
    });
    assert.equal(created.ok, true);
    if (!created.ok) return;

    await assert.rejects(
      () =>
        caller.ritual.runById({
          workspaceId: PILOT_WORKSPACE,
          ritualId: created.ritualId,
          actor: { type: "user", id: PILOT_USER },
        }),
      /does not match owning Agent/,
    );
  } finally {
    await wiring.close();
  }
});

test("ritual.create rejects ambiguous multi-Agent ownership", async () => {
  const wiring = await buildWiring();
  try {
    const caller = makeCaller(wiring);
    await assert.rejects(
      () =>
        caller.ritual.create({
          workspaceId: PILOT_WORKSPACE,
          name: "Ambiguous test Automation",
          agentIds: ["agent-one", "agent-two"],
          steps: [{
            skill: "stageMutation",
            action: "write",
            resourceType: "touchpoint",
            inputs: {},
          }],
        }),
      /exactly one owning Agent/,
    );
  } finally {
    await wiring.close();
  }
});

test("tool.run rejects caller-selected or nonmember authority before loading a Tool", async () => {
  const wiring = await buildWiring();
  try {
    const caller = makeCaller(wiring);
    await assert.rejects(
      () =>
        caller.tool.run({
          workspaceId: PILOT_WORKSPACE,
          ritualId: "test_fixture_tool",
          actor: { type: "user", id: "b0000000-0000-4000-a000-00000000ffff", plane: "cloud" },
        }),
      /actor must match the authenticated workspace member/,
    );
    const outsider = appRouter.createCaller({
      wiring,
      run: makeRun(),
      identity: { type: "user" as const, id: "b0000000-0000-4000-a000-00000000ffff" },
      authenticated: true,
      verifying: false,
    });
    await assert.rejects(
      () =>
        outsider.tool.run({
          workspaceId: PILOT_WORKSPACE,
          ritualId: "test_fixture_tool",
          actor: { type: "user", id: "b0000000-0000-4000-a000-00000000ffff" },
        }),
      /not a member of workspace/,
    );
  } finally {
    await wiring.close();
  }
});

test("manifest-declared DealPilot Automation registers its cloud owning Agent in the Ritual runtime", async () => {
  const wiring = await buildWiring();
  try {
    const definition = await wiring.ritualRegistry.load(PILOT_WORKSPACE, DEALPILOT_SOURCE_RITUAL_ID);
    assert.equal(definition?.agentId, DEALPILOT_SOURCING_AGENT_ID);
    assert.equal(definition?.agentPlane, "cloud");
    assert.equal(definition?.steps[0]?.skill, "dealpilot.source");
    assert.equal(definition?.steps[0]?.resourceType, "external:fetch");
    assert.equal(definition?.steps[0]?.dataScope, "public");
    assert.ok(definition?.steps[0]?.goalTaskRef);
    const goalTaskRef = definition.steps[0]!.goalTaskRef!;
    const [goal, task] = await Promise.all([
      wiring.goalTasks.getGoal(PILOT_WORKSPACE, goalTaskRef.goalId),
      wiring.goalTasks.getTask(PILOT_WORKSPACE, goalTaskRef.taskId),
    ]);
    assert.ok(goal);
    assert.equal(task?.assignedAgentId, DEALPILOT_SOURCING_AGENT_ID);
    assert.equal(task?.status, "open");
  } finally {
    await wiring.close();
  }
});

test("manifest Ritual keys resolve only through their installed owning Module", async () => {
  const wiring = await buildWiring();
  try {
    const caller = makeCaller(wiring);
    await assert.rejects(
      () =>
        caller.ritual.runById({
          workspaceId: PILOT_WORKSPACE,
          ritualId: DEALPILOT_SOURCE_RITUAL_KEY,
          modulePackageName: "deal-pilot",
          actor: { type: "user", id: PILOT_USER },
        }),
      /does not match owning Agent/,
    );

    await assert.rejects(
      () =>
        caller.ritual.runById({
          workspaceId: PILOT_WORKSPACE,
          ritualId: DEALPILOT_SOURCE_RITUAL_KEY,
          modulePackageName: "job-pilot",
        }),
      /no verified runtime binding/,
    );
  } finally {
    await wiring.close();
  }
});

test("ritual.runById rejects authenticated nonmembers before deriving the owning Agent", async () => {
  const wiring = await buildWiring();
  try {
    const caller = appRouter.createCaller({
      wiring,
      run: makeRun(),
      identity: { type: "user" as const, id: "b0000000-0000-4000-a000-00000000ffff" },
      authenticated: true,
      verifying: false,
    });

    test("ritual.create and direct ritual.run reject nonmember or caller-selected authority", async () => {
      const wiring = await buildWiring();
      try {
        const caller = makeCaller(wiring);
        await assert.rejects(
          () =>
            caller.ritual.run({
              workspaceId: PILOT_WORKSPACE,
              ritualId: "caller-selected",
              actor: { type: "user", id: "b0000000-0000-4000-a000-00000000ffff" },
              steps: [{
                skill: "stageMutation",
                action: "write",
                resourceType: "touchpoint",
                inputs: {},
              }],
            }),
          /actor must match the authenticated workspace member/,
        );

        const outsider = appRouter.createCaller({
          wiring,
          run: makeRun(),
          identity: { type: "user" as const, id: "b0000000-0000-4000-a000-00000000ffff" },
          authenticated: true,
          verifying: false,
        });
        await assert.rejects(
          () =>
            outsider.ritual.create({
              workspaceId: PILOT_WORKSPACE,
              name: "Unauthorized Automation",
              agentIds: [DEALPILOT_SOURCING_AGENT_ID],
              steps: [{
                skill: "dealpilot.source",
                action: "read",
                resourceType: "external:fetch",
                inputs: {},
              }],
            }),
          /not a member of workspace/,
        );
      } finally {
        await wiring.close();
      }
    });

    test("module-owned runtime Ritual UUID cannot bypass package binding", async () => {
      const wiring = await buildWiring();
      try {
        const caller = makeCaller(wiring);
        await assert.rejects(
          () =>
            caller.ritual.runById({
              workspaceId: PILOT_WORKSPACE,
              ritualId: DEALPILOT_SOURCE_RITUAL_ID,
            }),
          /manifest Ritual key and package binding/,
        );
      } finally {
        await wiring.close();
      }
    });
    await assert.rejects(
      () =>
        caller.ritual.runById({
          workspaceId: PILOT_WORKSPACE,
          ritualId: DEALPILOT_SOURCE_RITUAL_KEY,
          modulePackageName: "deal-pilot",
        }),
      /FORBIDDEN|not a member of workspace/i,
    );
  } finally {
    await wiring.close();
  }
});
