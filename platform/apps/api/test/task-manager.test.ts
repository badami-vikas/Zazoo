import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { SeededRng, SystemClock, UuidGen, type RunCtx } from "@bridge/core";
import {
  DrizzleAutomationRegistry,
  DrizzleAutomationRunRecorder,
  DrizzleModuleStore,
} from "@bridge/db";
import { appRouter } from "../src/router.js";
import { buildWiring, PILOT_ORGANIZATION, PILOT_USER, type Wiring } from "../src/wiring.js";
import { moduleFilesRoot } from "../src/module-files.js";
import {
  TASK_MANAGER_DRIFT_AUTOMATION_ID,
  TASK_MANAGER_SWEEP_AUTOMATION_ID,
} from "../src/built-in-modules.js";

function run(): RunCtx {
  const clock = new SystemClock();
  return { clock, rng: new SeededRng(21), ids: new UuidGen(clock, new SeededRng(21)) };
}

function caller(wiring: Wiring) {
  return appRouter.createCaller({
    wiring,
    run: run(),
    identity: { type: "user", id: PILOT_USER },
    authenticated: true,
    verifying: false,
  });
}

test("Task Manager API creates through impact review and applies governed restructure", async () => {
  const wiring = await buildWiring({ allowEphemeralLocalPlane: true });
  const api = caller(wiring);
  try {
    const root = await api.taskManager.create({
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
    const child = await api.taskManager.create({
      organizationId: PILOT_ORGANIZATION,
      title: "Exercise API",
      parentTaskId: root.task.id,
      exitTest: "API returns governed evidence",
      ownerType: "human",
      ownerId: PILOT_USER,
    });
    const vetoed = await api.taskManager.create({
      organizationId: PILOT_ORGANIZATION,
      title: "Veto conflict proof",
      parentTaskId: root.task.id,
      exitTest: "A veto cannot be overwritten",
      ownerType: "human",
      ownerId: PILOT_USER,
    });
    await api.action.decide({ proposalId: vetoed.impactFitProposal!.id, decision: "veto" });
    await assert.rejects(
      () => api.taskManager.decideProposal({
        organizationId: PILOT_ORGANIZATION,
        proposalId: vetoed.impactFitProposal!.id,
        decision: "approve",
      }),
      /already resolved as veto/,
    );
    assert.equal(child.task.status, "candidate");
    await api.taskManager.decideProposal({
      organizationId: PILOT_ORGANIZATION,
      proposalId: child.impactFitProposal!.id,
      decision: "approve",
    });
    const move = await api.taskManager.proposeRestructure({
      organizationId: PILOT_ORGANIZATION,
      operation: { kind: "promote", taskId: child.task.id },
    });
    await api.taskManager.decideProposal({
      organizationId: PILOT_ORGANIZATION,
      proposalId: move.id,
      decision: "approve",
    });
    const promoted = await api.taskManager.get({
      organizationId: PILOT_ORGANIZATION,
      taskId: child.task.id,
    });
    assert.equal(promoted.parentTaskId, undefined);
    assert.equal(promoted.path, "2");
  } finally {
    await wiring.close();
  }
});

test("Task Manager API durably reconciles a real projection File and runs completed-bay sweep", async () => {
  const filesRoot = await mkdtemp(join(tmpdir(), "bridge-task-manager-recert-"));
  const localDir = await mkdtemp(join(tmpdir(), "bridge-task-manager-local-"));
  let wiring: Wiring | undefined = await buildWiring({
    localDir,
    moduleFilesBridgeRoot: filesRoot,
  });
  let api = caller(wiring);
  try {
    assert.ok(wiring.automationRegistry instanceof DrizzleAutomationRegistry);
    assert.ok(wiring.automationRunRecorder instanceof DrizzleAutomationRunRecorder);
    assert.ok(wiring.moduleStore instanceof DrizzleModuleStore);
    const untouchedDraft = await api.taskManager.create({
      organizationId: PILOT_ORGANIZATION,
      title: "Historical completed Task",
      isGoal: true,
      outcomes: [],
      reviewCadence: "weekly",
      ownerType: "human",
      ownerId: PILOT_USER,
    });
    await api.taskManager.verify({
      organizationId: PILOT_ORGANIZATION,
      taskId: untouchedDraft.task.id,
      evidenceRefs: ["10000000-0000-4000-a000-000000000001"],
    });
    await api.taskManager.transition({
      organizationId: PILOT_ORGANIZATION,
      taskId: untouchedDraft.task.id,
      status: "done",
    });
    const untouchedBefore = await api.taskManager.get({
      organizationId: PILOT_ORGANIZATION,
      taskId: untouchedDraft.task.id,
    });
    const task = await api.taskManager.create({
      organizationId: PILOT_ORGANIZATION,
      title: "Projection certification",
      isGoal: true,
      outcomes: [],
      reviewCadence: "weekly",
      ownerType: "human",
      ownerId: PILOT_USER,
    });
    if (task.impactFitProposal) {
      await api.taskManager.decideProposal({
        organizationId: PILOT_ORGANIZATION,
        proposalId: task.impactFitProposal.id,
        decision: "approve",
      });
    }
    const emitted = await api.taskManager.emitProjectionFile({
      organizationId: PILOT_ORGANIZATION,
      expectedFileHash: null,
    });
    const path = join(
      moduleFilesRoot("Pilot Organization", "Task Manager", filesRoot),
      "tasks.md",
    );
    const externalContent = emitted.projection.content.replace(
      "Projection certification",
      "Projection certification reconciled",
    );
    await writeFile(path, externalContent, "utf8");
    const externalHash = `sha256:${createHash("sha256").update(externalContent).digest("hex")}`;
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    const proposed = await api.taskManager.proposeProjectionReconcile({
      organizationId: PILOT_ORGANIZATION,
      externalContent,
      expectedFileHash: externalHash,
      idempotencyKey: "projection-reconcile-api-1",
      expiresAt,
    });
    assert.match(proposed.proposal.id, /^[0-9a-f-]{36}$/);
    const repeated = await api.taskManager.proposeProjectionReconcile({
      organizationId: PILOT_ORGANIZATION,
      externalContent,
      expectedFileHash: externalHash,
      idempotencyKey: "projection-reconcile-api-1",
      expiresAt,
    });
    assert.equal(repeated.proposal.id, proposed.proposal.id);
    const firstInstanceRuns = await wiring.automationRunRecorder.list(
      PILOT_ORGANIZATION,
      [TASK_MANAGER_DRIFT_AUTOMATION_ID],
      { limit: 10 },
    );
    assert.ok(firstInstanceRuns.some((entry) => entry.runId === proposed.runId));
    await wiring.close();
    wiring = undefined;

    wiring = await buildWiring({
      localDir,
      moduleFilesBridgeRoot: filesRoot,
    });
    api = caller(wiring);
    assert.ok(wiring.automationRegistry instanceof DrizzleAutomationRegistry);
    assert.ok(wiring.automationRunRecorder instanceof DrizzleAutomationRunRecorder);
    assert.ok(wiring.moduleStore instanceof DrizzleModuleStore);
    const restartedRuns = await wiring.automationRunRecorder.list(
      PILOT_ORGANIZATION,
      [TASK_MANAGER_DRIFT_AUTOMATION_ID],
      { limit: 10 },
    );
    assert.ok(restartedRuns.some((entry) => entry.runId === proposed.runId));
    const restartedReplay = await api.taskManager.proposeProjectionReconcile({
      organizationId: PILOT_ORGANIZATION,
      externalContent,
      expectedFileHash: externalHash,
      idempotencyKey: "projection-reconcile-api-1",
      expiresAt,
    });
    assert.equal(restartedReplay.proposal.id, proposed.proposal.id);
    assert.equal(restartedReplay.runId, proposed.runId);
    const editedContent = externalContent.replace(
      "Projection certification reconciled",
      "Projection certification Human edit",
    );
    const reconciled = await api.taskManager.decideProposal({
      organizationId: PILOT_ORGANIZATION,
      proposalId: proposed.proposal.id,
      decision: "edit",
      editedExternalContent: editedContent,
    });
    assert.ok("evidence" in reconciled);
    const evidence = (reconciled as typeof reconciled & {
      evidence: { fileHash: string; fileId: string };
    }).evidence;
    assert.equal(
      (await api.taskManager.get({
        organizationId: PILOT_ORGANIZATION,
        taskId: task.task.id,
      })).title,
      "Projection certification Human edit",
    );
    assert.match(await readFile(path, "utf8"), /Projection certification Human edit/);
    const untouchedAfter = await api.taskManager.get({
      organizationId: PILOT_ORGANIZATION,
      taskId: untouchedDraft.task.id,
    });
    assert.equal(untouchedAfter.version, untouchedBefore.version);
    assert.equal(untouchedAfter.updatedAt, untouchedBefore.updatedAt);
    assert.equal(untouchedAfter.status, untouchedBefore.status);
    assert.deepEqual(untouchedAfter.evidenceRefs, untouchedBefore.evidenceRefs);
    const replay = await api.taskManager.decideProposal({
      organizationId: PILOT_ORGANIZATION,
      proposalId: proposed.proposal.id,
      decision: "edit",
      editedExternalContent: editedContent,
    });
    assert.ok("evidence" in replay);

    const currentFileHash = (replay as typeof replay & {
      evidence: { fileHash: string };
    }).evidence.fileHash;
    const vetoContent = (await readFile(path, "utf8")).replace(
      "Projection certification Human edit",
      "Projection certification vetoed edit",
    );
    await writeFile(path, vetoContent, "utf8");
    const vetoFileHash = `sha256:${createHash("sha256").update(vetoContent).digest("hex")}`;
    const vetoProposal = await api.taskManager.proposeProjectionReconcile({
      organizationId: PILOT_ORGANIZATION,
      externalContent: vetoContent,
      expectedFileHash: vetoFileHash,
      idempotencyKey: "projection-reconcile-api-veto",
      expiresAt,
    });
    await api.taskManager.decideProposal({
      organizationId: PILOT_ORGANIZATION,
      proposalId: vetoProposal.proposal.id,
      decision: "veto",
    });
    assert.equal(
      (await api.taskManager.get({
        organizationId: PILOT_ORGANIZATION,
        taskId: task.task.id,
      })).title,
      "Projection certification Human edit",
    );
    assert.equal(await readFile(path, "utf8"), vetoContent);
    const restored = await api.taskManager.emitProjectionFile({
      organizationId: PILOT_ORGANIZATION,
      expectedFileHash: vetoFileHash,
    });
    assert.equal(restored.fileHash, currentFileHash);

    const staleContent = restored.projection.content.replace(
      "Projection certification Human edit",
      "Projection certification stale edit",
    );
    await writeFile(path, staleContent, "utf8");
    const staleFileHash = `sha256:${createHash("sha256").update(staleContent).digest("hex")}`;
    const staleProposal = await api.taskManager.proposeProjectionReconcile({
      organizationId: PILOT_ORGANIZATION,
      externalContent: staleContent,
      expectedFileHash: staleFileHash,
      idempotencyKey: "projection-reconcile-api-stale",
      expiresAt,
    });
    await api.taskManager.create({
      organizationId: PILOT_ORGANIZATION,
      title: "Concurrent Task",
      isGoal: true,
      outcomes: [],
      reviewCadence: "weekly",
      ownerType: "human",
      ownerId: PILOT_USER,
    });
    await assert.rejects(
      () => api.taskManager.decideProposal({
        organizationId: PILOT_ORGANIZATION,
        proposalId: staleProposal.proposal.id,
        decision: "approve",
      }),
      /stale/i,
    );
    assert.equal(await readFile(path, "utf8"), staleContent);
    await api.taskManager.emitProjectionFile({
      organizationId: PILOT_ORGANIZATION,
      expectedFileHash: staleFileHash,
    });

    await api.taskManager.verify({
      organizationId: PILOT_ORGANIZATION,
      taskId: task.task.id,
      evidenceRefs: [evidence.fileId],
    });
    await api.taskManager.transition({
      organizationId: PILOT_ORGANIZATION,
      taskId: task.task.id,
      status: "done",
    });
    const capSweep = await api.taskManager.runCompletedBaySweep({
      organizationId: PILOT_ORGANIZATION,
      completedCap: 1,
      maxAgeDays: 365,
      idempotencyKey: "completed-bay-cap-api-1",
      expiresAt,
    });
    assert.ok(capSweep.proposal);
    assert.ok(Array.isArray(capSweep.plan.eligibleTaskIds));
    assert.equal(capSweep.plan.eligibleTaskIds.length, 1);
    await api.taskManager.decideProposal({
      organizationId: PILOT_ORGANIZATION,
      proposalId: capSweep.proposal.id,
      decision: "approve",
    });
    const afterCap = await Promise.all([
      api.taskManager.get({
        organizationId: PILOT_ORGANIZATION,
        taskId: task.task.id,
      }),
      api.taskManager.get({
        organizationId: PILOT_ORGANIZATION,
        taskId: untouchedDraft.task.id,
      }),
    ]);
    assert.equal(afterCap.filter((entry) => entry.status === "archived").length, 1);

    const ageSweep = await api.taskManager.runCompletedBaySweep({
      organizationId: PILOT_ORGANIZATION,
      completedCap: 100,
      maxAgeDays: 0,
      idempotencyKey: "completed-bay-age-api-1",
      expiresAt,
    });
    assert.ok(ageSweep.proposal);
    await api.taskManager.decideProposal({
      organizationId: PILOT_ORGANIZATION,
      proposalId: ageSweep.proposal.id,
      decision: "approve",
    });
    const archived = await api.taskManager.get({
      organizationId: PILOT_ORGANIZATION,
      taskId: task.task.id,
    });
    assert.equal(archived.status, "archived");
    assert.ok(archived.evidenceRefs.includes(evidence.fileId));
    const untouchedArchived = await api.taskManager.get({
      organizationId: PILOT_ORGANIZATION,
      taskId: untouchedDraft.task.id,
    });
    assert.equal(untouchedArchived.status, "archived");
    assert.deepEqual(untouchedArchived.evidenceRefs, untouchedBefore.evidenceRefs);
    const sweepRetry = await api.taskManager.runCompletedBaySweep({
      organizationId: PILOT_ORGANIZATION,
      completedCap: 0,
      maxAgeDays: 365,
      idempotencyKey: "completed-bay-age-api-1",
      expiresAt,
    });
    assert.equal(sweepRetry.runId, ageSweep.runId);
    assert.equal(sweepRetry.proposal?.id, ageSweep.proposal.id);
    const runs = await wiring.automationRunRecorder.list(
      PILOT_ORGANIZATION,
      [TASK_MANAGER_SWEEP_AUTOMATION_ID],
      { limit: 10 },
    );
    assert.ok(runs.some((entry) => entry.runId === capSweep.runId && entry.status === "completed"));
    assert.ok(runs.some((entry) => entry.runId === ageSweep.runId && entry.status === "completed"));
  } finally {
    await wiring?.close();
    await rm(filesRoot, { recursive: true, force: true });
    await rm(localDir, { recursive: true, force: true });
  }
});
