import assert from "node:assert/strict";
import test from "node:test";
import { TRPCError } from "@trpc/server";
import { SeededRng, SystemClock, UuidGen, type RunCtx } from "@bridge/core";
import { appRouter } from "../src/router.js";
import { PILOT_USER, PILOT_WORKSPACE, buildWiring, type Wiring } from "../src/wiring.js";

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

test("agent.create: a freshly created Agent is active in its workspace and immediately eligible for task assignment", async () => {
  const wiring = await buildWiring();
  try {
    const caller = makeCaller(wiring);
    const agent = await caller.agent.create({
      workspaceId: PILOT_WORKSPACE,
      name: "Eligibility test Agent",
      capabilityScope: [],
      allowedSkills: [],
      dataScope: "public",
      egressTier: "none",
    });

    assert.equal(await wiring.agents.workspaceId(agent.agentId), PILOT_WORKSPACE);
    assert.equal(await wiring.agents.isActive(agent.agentId), true);

    const goal = await caller.agentOrchestration.goal.create({
      workspaceId: PILOT_WORKSPACE,
      type: "jobpilot.culture_research",
      title: "Eligibility test goal",
    });
    const task = await caller.agentOrchestration.task.create({
      workspaceId: PILOT_WORKSPACE,
      goalId: goal.id,
      type: "research_culture_source",
      assignedAgentId: agent.agentId,
    });
    assert.equal(task.assignedAgentId, agent.agentId);
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
          capabilityScope: [],
          allowedSkills: [],
          dataScope: "public",
          egressTier: "none",
        }),
      (error: unknown) => error instanceof TRPCError && error.code === "FORBIDDEN",
    );
  } finally {
    await wiring.close();
  }
});
