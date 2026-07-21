import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { SeededRng, SystemClock, UuidGen, type RunCtx } from "@bridge/core";
import { appRouter } from "../src/router.js";
import { buildWiring, PILOT_ORGANIZATION, PILOT_USER, type Wiring } from "../src/wiring.js";
import { moduleFilesRoot } from "../src/module-files.js";
import { TASK_MANAGER_SWEEP_AUTOMATION_ID } from "../src/built-in-modules.js";

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
  const wiring = await buildWiring({
    allowEphemeralLocalPlane: true,
    moduleFilesBridgeRoot: filesRoot,
  });
  const api = caller(wiring);
  try {
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
    const sweep = await api.taskManager.runCompletedBaySweep({
      organizationId: PILOT_ORGANIZATION,
      completedCap: 0,
      maxAgeDays: 7,
      idempotencyKey: "completed-bay-sweep-api-1",
      expiresAt,
    });
    assert.ok(sweep.proposal);
    await api.taskManager.decideProposal({
      organizationId: PILOT_ORGANIZATION,
      proposalId: sweep.proposal.id,
      decision: "approve",
    });
    const archived = await api.taskManager.get({
      organizationId: PILOT_ORGANIZATION,
      taskId: task.task.id,
    });
    assert.equal(archived.status, "archived");
    assert.ok(archived.evidenceRefs.includes(evidence.fileId));
    const sweepRetry = await api.taskManager.runCompletedBaySweep({
      organizationId: PILOT_ORGANIZATION,
      completedCap: 99,
      maxAgeDays: 365,
      idempotencyKey: "completed-bay-sweep-api-1",
      expiresAt,
    });
    assert.equal(sweepRetry.runId, sweep.runId);
    assert.equal(sweepRetry.proposal?.id, sweep.proposal.id);
    const runs = await wiring.automationRunRecorder.list(
      PILOT_ORGANIZATION,
      [TASK_MANAGER_SWEEP_AUTOMATION_ID],
      { limit: 10 },
    );
    assert.ok(runs.some((entry) => entry.runId === sweep.runId && entry.status === "completed"));
  } finally {
    await wiring.close();
    await rm(filesRoot, { recursive: true, force: true });
  }
});
