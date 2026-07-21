import assert from "node:assert/strict";
import test from "node:test";
import { SeededRng, SystemClock, UuidGen, type RunCtx } from "@bridge/core";
import { appRouter } from "../src/router.js";
import { buildWiring, PILOT_ORGANIZATION, PILOT_USER } from "../src/wiring.js";

function run(): RunCtx {
  const clock = new SystemClock();
  return { clock, rng: new SeededRng(21), ids: new UuidGen(clock, new SeededRng(21)) };
}

test("Task Manager API creates through impact review and applies governed restructure", async () => {
  const wiring = await buildWiring({ allowEphemeralLocalPlane: true });
  const caller = appRouter.createCaller({
    wiring,
    run: run(),
    identity: { type: "user", id: PILOT_USER },
    authenticated: true,
    verifying: false,
  });
  try {
    const root = await caller.taskManager.create({
      organizationId: PILOT_ORGANIZATION,
      title: "Certify Task Manager",
      isGoal: true,
      outcomes: [{
        id: "use",
        title: "Use the queue",
        measure: "completed flow",
        target: "1",
        indicatorKind: "lagging",
      }],
      reviewCadence: "weekly",
      ownerType: "human",
      ownerId: PILOT_USER,
    });
    const child = await caller.taskManager.create({
      organizationId: PILOT_ORGANIZATION,
      title: "Exercise API",
      parentTaskId: root.task.id,
      exitTest: "API returns governed evidence",
      ownerType: "human",
      ownerId: PILOT_USER,
    });
    const vetoed = await caller.taskManager.create({
      organizationId: PILOT_ORGANIZATION,
      title: "Veto conflict proof",
      parentTaskId: root.task.id,
      exitTest: "A veto cannot be overwritten",
      ownerType: "human",
      ownerId: PILOT_USER,
    });
    await caller.action.decide({ proposalId: vetoed.impactFitProposal!.id, decision: "veto" });
    await assert.rejects(
      () => caller.taskManager.decideProposal({
        organizationId: PILOT_ORGANIZATION,
        proposalId: vetoed.impactFitProposal!.id,
        decision: "approve",
      }),
      /already resolved as veto/,
    );
    assert.equal(child.task.status, "candidate");
    assert.equal(child.impactFitProposal?.status, "pending_review");
    await caller.taskManager.decideProposal({
      organizationId: PILOT_ORGANIZATION,
      proposalId: child.impactFitProposal!.id,
      decision: "approve",
    });
    assert.equal((await caller.taskManager.get({
      organizationId: PILOT_ORGANIZATION,
      taskId: child.task.id,
    })).status, "pending");

    const move = await caller.taskManager.proposeRestructure({
      organizationId: PILOT_ORGANIZATION,
      operation: { kind: "promote", taskId: child.task.id },
    });
    await caller.taskManager.decideProposal({
      organizationId: PILOT_ORGANIZATION,
      proposalId: move.id,
      decision: "approve",
    });
    const promoted = await caller.taskManager.get({
      organizationId: PILOT_ORGANIZATION,
      taskId: child.task.id,
    });
    assert.equal(promoted.parentTaskId, undefined);
    assert.equal(promoted.path, "2");
    const projection = await caller.taskManager.projection({ organizationId: PILOT_ORGANIZATION });
    assert.match(projection.projection.content, /Record ID:/);
  } finally {
    await wiring.close();
  }
});
