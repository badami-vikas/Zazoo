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
} from "@bridge/module-manifests";

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
      // The folder is named by the Module's DISPLAY name (ADR-178 renamed it
      // "Task Manager" → "TaskManager"), so this path must track the manifest.
      moduleFilesRoot("Pilot Organization", "TaskManager", filesRoot),
      "tasks.md",
    );

    // TM6's per-repo agent-ledger template (ADR-209), written beside the
    // projection in the same operation. `tasks.md` says what the work IS; an
    // external coding agent arriving with no Bridge context also needs to know
    // that this is a projection it may edit but not overwrite, and that `done`
    // requires evidence. A projection alone teaches it neither.
    assert.ok(emitted.agentTemplate, "the projection ships with its agent template");
    const templatePath = join(
      moduleFilesRoot("Pilot Organization", "TaskManager", filesRoot),
      "AGENTS.md",
    );
    const templateContent = await readFile(templatePath, "utf8");
    assert.match(templateContent, /Database is authoritative/i);
    assert.match(templateContent, /aged out of the projection/);
    assert.match(templateContent, /`not read` means the edges were not loaded/);
    // Regenerating is idempotent, not a conflict: the template is generated
    // and never edited, so a second emit replaces it in place.
    const reEmitted = await api.taskManager.emitProjectionFile({
      organizationId: PILOT_ORGANIZATION,
      expectedFileHash: emitted.fileHash,
    });
    assert.equal(
      reEmitted.agentTemplate.fileHash,
      emitted.agentTemplate.fileHash,
      "the template is deterministic across emissions",
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

test("the canonical ledger imports as a tree, at its stated statuses, and re-importing is not a second queue", async () => {
  const wiring = await buildWiring({ allowEphemeralLocalPlane: true });
  const api = caller(wiring);
  try {
    const entries = [
      { recordId: "HORIZON-prototype", title: "Prototype", isGoal: true, status: "pending" as const },
      { recordId: "HORIZON-hardening", title: "Hardening", isGoal: true, status: "pending" as const },
      {
        recordId: "TASK-001",
        title: "TASK-001 — Shipped work",
        isGoal: false,
        parentRecordId: "HORIZON-prototype",
        status: "done" as const,
        priority: "P0",
        estimate: "0.5d",
        outcome: "One coherent shell",
        exitTest: "Modules open",
      },
      {
        recordId: "TASK-002",
        title: "TASK-002 — Live work",
        isGoal: false,
        parentRecordId: "HORIZON-prototype",
        status: "in_progress" as const,
        priority: "P1",
        outcome: "The queue runs",
        exitTest: "A Task completes",
      },
      {
        recordId: "TASK-003",
        title: "TASK-003 — Later work",
        isGoal: false,
        parentRecordId: "HORIZON-hardening",
        status: "pending" as const,
        priority: "P2",
        outcome: "Hardened",
        exitTest: "Gates pass",
      },
    ];

    const plan = await api.taskManager.importCanonicalLedger({
      organizationId: PILOT_ORGANIZATION,
      entries,
    });
    assert.equal(plan.created.length, 5);
    assert.equal(plan.transitions.length, 0);
    assert.equal(plan.downgraded.length, 0);

    const tasks = await api.taskManager.list({ organizationId: PILOT_ORGANIZATION });
    assert.equal(tasks.length, 5);
    const byTitle = new Map(tasks.map((task) => [task.title, task]));
    const prototype = byTitle.get("Prototype")!;
    const shipped = byTitle.get("TASK-001 — Shipped work")!;
    const live = byTitle.get("TASK-002 — Live work")!;
    const later = byTitle.get("TASK-003 — Later work")!;

    // The whole point of a separate import path: `draftTaskCreate` would have
    // forced every one of these but the first to `candidate`.
    assert.equal(shipped.status, "done");
    assert.equal(live.status, "in_progress");
    assert.equal(later.status, "pending");

    // The tree, not a flat list.
    assert.equal(prototype.isGoal, true);
    assert.equal(prototype.level, 0);
    assert.equal(prototype.path, "1");
    assert.equal(shipped.parentTaskId, prototype.id);
    assert.equal(shipped.path, "1.1");
    assert.equal(live.path, "1.2");
    assert.equal(later.path, "2.1");
    assert.equal(shipped.level, 1);
    assert.equal(shipped.priority, "P0");
    assert.equal(shipped.estimate, "0.5d");
    // Un-estimated work reads as absent, never as zero (AP-247).
    assert.equal(live.estimate, undefined);
    assert.equal(shipped.exitTest, "Modules open");
    assert.equal(shipped.outcomes[0]?.title, "One coherent shell");

    // Re-import: same ids, so a moved status is re-stated and nothing is minted.
    const second = await api.taskManager.importCanonicalLedger({
      organizationId: PILOT_ORGANIZATION,
      entries: entries.map((entry) =>
        entry.recordId === "TASK-003" ? { ...entry, status: "blocked" as const } : entry,
      ),
    });
    assert.equal(second.created.length, 0);
    assert.deepEqual(second.transitions, [{ taskId: later.id, status: "blocked" }]);
    assert.equal(second.unchangedTaskIds.length, 4);

    const after = await api.taskManager.list({ organizationId: PILOT_ORGANIZATION });
    assert.equal(after.length, 5, "re-importing must not mint a second copy of the queue");
    assert.equal(after.find((task) => task.id === later.id)?.status, "blocked");
  } finally {
    await wiring.close();
  }
});

test("an import naming an absent parent is refused whole, not written half", async () => {
  const wiring = await buildWiring({ allowEphemeralLocalPlane: true });
  const api = caller(wiring);
  try {
    await assert.rejects(
      api.taskManager.importCanonicalLedger({
        organizationId: PILOT_ORGANIZATION,
        entries: [
          { recordId: "HORIZON-prototype", title: "Prototype", isGoal: true, status: "pending" as const },
          {
            recordId: "TASK-001",
            title: "TASK-001 — Orphan",
            isGoal: false,
            parentRecordId: "HORIZON-missing",
            status: "pending" as const,
          },
        ],
      }),
      /absent parent HORIZON-missing/,
    );
    assert.deepEqual(
      await api.taskManager.list({ organizationId: PILOT_ORGANIZATION }),
      [],
      "a refused import leaves no rows behind",
    );
  } finally {
    await wiring.close();
  }
});
