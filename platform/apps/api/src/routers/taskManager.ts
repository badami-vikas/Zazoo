import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { INTERNAL_STRATEGIST_AGENT, GOVERNANCE_AGENT, CHIEF_OF_STAFF_AGENT, TASK_ROUTING_CANDIDATE_AGENTS, resolveLocalPlanningModel } from "../wiring.js";
import { AlreadyResolvedError, emitTasksMarkdown, emitAgentLedgerTemplate, AGENT_LEDGER_TEMPLATE_FILE, TASK_PROJECTION_COMPLETED_CAP, TASK_RECORD_STATUSES, detectTaskProjectionDrift, applyApprovedTaskProjectionReconciliation, mergeEditedPlanningPayload, blockedTasks, TaskDependencyCycleError, MAX_MATERIALIZED_TASKS, evaluateTaskGuards, DEFAULT_STALE_AFTER_DAYS, planCompletedBaySweep, routeTaskByRequiredSkill } from "@bridge/core";
import { transition } from "@bridge/jobpilot";
import { TASK_MANAGER_DRIFT_AUTOMATION_ID, TASK_MANAGER_SWEEP_AUTOMATION_ID, TASK_MANAGER_SCAN_AUTOMATION_ID, TASK_MANAGER_PLANNING_AUTOMATION_ID, TASK_MANAGER_STANDUP_AUTOMATION_ID, TASK_MANAGER_STALE_REVIEW_AUTOMATION_ID, TASK_MANAGER_WIP_BREACH_AUTOMATION_ID, TASK_MANAGER_UNVERIFIED_DONE_AUTOMATION_ID, TASK_MANAGER_GOAL_REVIEW_AUTOMATION_ID, TASK_MANAGER_IMPACT_FIT_AUTOMATION_ID, TASK_MANAGER_RESTRUCTURE_AUTOMATION_ID, TASK_MANAGER_REOPEN_AUTOMATION_ID, TASK_MANAGER_DEPENDENCY_AUTOMATION_ID, TASK_MANAGER_ROUTING_AUTOMATION_ID } from "@bridge/module-manifests";
import { MAX_MODULE_FILE_BYTES, readModuleFileContent, replaceModuleFileContent, withOrganizationFileOperationLock } from "../module-files.js";
import { EDITED_PLANNING_ITEM, TASK_MANAGER_PROJECTION_FILE, authenticatedProcedure, authorizeModelCompletion, createGovernedModelProvider, ensureTaskManagerAutomation, idempotentUuid, moduleFolderLabel, normalizeTaskOutcomes, organizationGuard, procedure, replaceTaskProjectionFile, requireInstalledTaskManager, requireOrganizationNameForFiles, runTaskChangeGate, runTaskManagerAgentAutomation, sha256Content, t, taskOutcomeInput, taskRecordStatusInput, taskRestructureInput, withHumanInputTaint } from "../router-shared.js";

export const taskManagerRouter = t.router({
  list: authenticatedProcedure.input(z.object({ organizationId: z.string().uuid() })).use(organizationGuard).query(async ({ input, ctx }) => {
    return ctx.wiring.taskManager.list(input.organizationId);
  }),
  /**
   * Import the repository's canonical ledger (ADR-271).
   *
   * The caller sends the PROJECTION, not the Markdown: `docs/TASKS.md` is a
   * repository file the API has no path to in a packaged desktop build, and
   * the projection is already generated, already committed, and already in
   * the web bundle. Re-parsing the document server-side would put a second
   * parser in the system that could disagree with the first.
   *
   * Not routed through the governed pipeline: it writes no Skill and invokes
   * no Agent. It is a Human writing Task Records in their own Organization,
   * which is exactly what `taskManager.create` already permits directly. The
   * governance that matters here is idempotence — `recordId` maps to one
   * deterministic uuid, so running it twice re-states statuses instead of
   * minting a second copy of the queue.
   */
  importCanonicalLedger: authenticatedProcedure.input(z.object({
    organizationId: z.string().uuid(),
    entries: z.array(z.object({
      recordId: z.string().trim().min(1).max(80),
      title: z.string().trim().min(1).max(200),
      isGoal: z.boolean(),
      parentRecordId: z.string().trim().min(1).max(80).nullable().optional(),
      status: taskRecordStatusInput,
      priority: z.string().trim().min(1).max(8).optional(),
      estimate: z.string().trim().min(1).max(16).optional(),
      outcome: z.string().trim().min(1).max(4_000).optional(),
      exitTest: z.string().trim().min(1).max(4_000).optional(),
    }).strict()).min(1).max(500),
  }).strict()).use(organizationGuard).mutation(async ({ input, ctx }) => {
    // Ledger identity -> Task identity, derived the same way every time so a
    // re-import updates the rows it created rather than duplicating them.
    const taskIdFor = (recordId: string) =>
      idempotentUuid(`${input.organizationId}:canonical-ledger:${recordId}`);
    const known = new Set(input.entries.map((entry) => entry.recordId));
    const entries = input.entries.map((entry) => {
      if (entry.parentRecordId && !known.has(entry.parentRecordId)) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `ledger entry ${entry.recordId} names an absent parent ${entry.parentRecordId}`,
        });
      }
      return {
        recordId: entry.recordId,
        taskId: taskIdFor(entry.recordId),
        title: entry.title,
        isGoal: entry.isGoal,
        ...(entry.parentRecordId ? { parentTaskId: taskIdFor(entry.parentRecordId) } : {}),
        status: entry.status,
        ...(entry.priority ? { priority: entry.priority } : {}),
        ...(entry.estimate ? { estimate: entry.estimate } : {}),
        ...(entry.outcome ? { outcome: entry.outcome } : {}),
        ...(entry.exitTest ? { exitTest: entry.exitTest } : {}),
      };
    });
    try {
      return await ctx.wiring.taskManager.importCanonicalLedger(
        input.organizationId,
        entries,
        ctx.identity.id,
        { nextId: () => ctx.run.ids.next(), nowISO: () => ctx.run.clock.nowISO() },
      );
    } catch (cause) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: cause instanceof Error ? cause.message : String(cause),
      });
    }
  }),
  get: authenticatedProcedure.input(z.object({
    organizationId: z.string().uuid(),
    taskId: z.string().uuid(),
  })).use(organizationGuard).query(async ({ input, ctx }) => {
    const task = await ctx.wiring.taskManager.get(input.organizationId, input.taskId);
    if (!task) throw new TRPCError({ code: "NOT_FOUND", message: `unknown Task ${input.taskId}` });
    return task;
  }),
  create: authenticatedProcedure.input(z.object({
    organizationId: z.string().uuid(),
    title: z.string().trim().min(1),
    taskType: z.string().trim().min(1).optional(),
    isGoal: z.boolean().optional(),
    outcomes: z.array(taskOutcomeInput).default([]),
    reviewCadence: z.string().trim().min(1).optional(),
    exitTest: z.string().trim().min(1).optional(),
    status: taskRecordStatusInput.optional(),
    priority: z.string().trim().min(1).optional(),
    ownerType: z.enum(["human", "agent"]),
    ownerId: z.string().uuid(),
    assignedAgentId: z.string().uuid().optional(),
    requiredSkillId: z.string().trim().min(1).optional(),
    parentTaskId: z.string().uuid().optional(),
    estimate: z.string().trim().min(1).max(16).optional(),
    scheduledFor: z.string().date().optional(),
  })).use(organizationGuard).mutation(async ({ input, ctx }) => {
    const taskId = ctx.run.ids.next();
    const taskInput = {
      id: taskId,
      organizationId: input.organizationId,
      title: input.title,
      outcomes: normalizeTaskOutcomes(input.outcomes),
      ownerType: input.ownerType,
      ownerId: input.ownerId,
      ...(input.taskType ? { taskType: input.taskType } : {}),
      ...(input.isGoal !== undefined ? { isGoal: input.isGoal } : {}),
      ...(input.reviewCadence ? { reviewCadence: input.reviewCadence } : {}),
      ...(input.exitTest ? { exitTest: input.exitTest } : {}),
      ...(input.status ? { status: input.status } : {}),
      ...(input.priority ? { priority: input.priority } : {}),
      ...(input.assignedAgentId ? { assignedAgentId: input.assignedAgentId } : {}),
      ...(input.requiredSkillId ? { requiredSkillId: input.requiredSkillId } : {}),
      ...(input.parentTaskId ? { parentTaskId: input.parentTaskId } : {}),
      ...(input.estimate ? { estimate: input.estimate } : {}),
      ...(input.scheduledFor ? { scheduledFor: input.scheduledFor } : {}),
    };
    const populated = (await ctx.wiring.taskManager.list(input.organizationId)).length > 0;
    // ADR-203 — the impact analysis is now Internal Strategist's own Run
    // running the real `impact-fit-analysis` Skill, not a kernel-passthrough
    // proposal wearing the Human's name. The queue-side `impact_fit` row and
    // this pipeline proposal share one id, so one decision resolves both.
    const impactRun = populated
      ? await runTaskManagerAgentAutomation(ctx, {
          organizationId: input.organizationId,
          automationId: TASK_MANAGER_IMPACT_FIT_AUTOMATION_ID,
          name: "Task Manager task-created impact analysis",
          agentId: INTERNAL_STRATEGIST_AGENT,
          skill: "task-manager.impact-fit-analysis",
          action: "write",
          params: {
            queue: await ctx.wiring.taskManager.list(input.organizationId),
            // ADR-204 — the edges make the resequence proposal dependency-aware.
            dependencies: await ctx.wiring.taskManager.listDependencies(input.organizationId),
            taskId,
            title: taskInput.title,
            ...(taskInput.exitTest ? { exitTest: taskInput.exitTest } : {}),
            ...(taskInput.parentTaskId ? { parentTaskId: taskInput.parentTaskId } : {}),
          },
          runId: idempotentUuid(`${input.organizationId}:impact_fit_run:${taskId}`),
          proposalId: idempotentUuid(`${input.organizationId}:impact_fit:${taskId}`),
          taintKey: `task-manager:impact-fit:${ctx.identity.id}:${taskId}`,
        })
      : null;
    const governed = impactRun?.proposal ?? null;
    if (governed && governed.status !== "pending_review") {
      throw new TRPCError({
        code: "INTERNAL_SERVER_ERROR",
        message: `Task impact analysis did not halt for Human review (${governed.status}: ${governed.rejectionReason ?? "no reason"})`,
      });
    }
    let proposalIdAvailable = Boolean(governed);
    return ctx.wiring.taskManager.create(taskInput, {
      nextId: () => {
        if (governed && proposalIdAvailable) {
          proposalIdAvailable = false;
          return governed.id;
        }
        return ctx.run.ids.next();
      },
      nowISO: () => ctx.run.clock.nowISO(),
    });
  }),
  transition: authenticatedProcedure.input(z.object({
    organizationId: z.string().uuid(),
    taskId: z.string().uuid(),
    status: taskRecordStatusInput,
  })).use(organizationGuard).mutation(async ({ input, ctx }) => {
    return ctx.wiring.taskManager.transition(input.organizationId, input.taskId, input.status, {
      nextId: () => ctx.run.ids.next(),
      nowISO: () => ctx.run.clock.nowISO(),
    });
  }),
  verify: authenticatedProcedure.input(z.object({
    organizationId: z.string().uuid(),
    taskId: z.string().uuid(),
    evidenceRefs: z.array(z.string().trim().min(1)).min(1),
  })).use(organizationGuard).mutation(async ({ input, ctx }) => {
    return ctx.wiring.taskManager.verify(input.organizationId, input.taskId, {
      verifiedAt: ctx.run.clock.nowISO(),
      verifiedBy: ctx.identity.id,
      evidenceRefs: input.evidenceRefs,
      result: "passed",
    }, { nextId: () => ctx.run.ids.next(), nowISO: () => ctx.run.clock.nowISO() });
  }),
  updateOutcomeTarget: authenticatedProcedure.input(z.object({
    organizationId: z.string().uuid(),
    taskId: z.string().uuid(),
    outcomeId: z.string().min(1),
    target: z.string().trim().min(1),
  })).use(organizationGuard).mutation(async ({ input, ctx }) => {
    const result = await ctx.wiring.taskManager.updateOutcomeTarget(
      input.organizationId,
      input.taskId,
      input.outcomeId,
      input.target,
      { nextId: () => ctx.run.ids.next(), nowISO: () => ctx.run.clock.nowISO() },
    );
    if (result.reopenProposal) {
      // ADR-203 — Internal Strategist's own Run. A moved target is exactly
      // an impact-fit question ("does this Task still fit what we now want"),
      // so the Skill's analysis becomes the REASONING attached to the reopen
      // prompt rather than a prompt with nothing behind it. The Run's
      // proposal shares the reopen proposal's id, so one decision resolves
      // both records.
      const { proposal: governed } = await runTaskManagerAgentAutomation(ctx, {
        organizationId: input.organizationId,
        automationId: TASK_MANAGER_REOPEN_AUTOMATION_ID,
        name: "Task Manager target-change reopen prompt",
        agentId: INTERNAL_STRATEGIST_AGENT,
        skill: "task-manager.impact-fit-analysis",
        action: "write",
        params: {
          queue: await ctx.wiring.taskManager.list(input.organizationId),
          dependencies: await ctx.wiring.taskManager.listDependencies(input.organizationId),
          taskId: input.taskId,
          title: result.task.title,
          ...(result.task.exitTest ? { exitTest: result.task.exitTest } : {}),
          ...(result.task.parentTaskId ? { parentTaskId: result.task.parentTaskId } : {}),
        },
        runId: idempotentUuid(`${input.organizationId}:reopen_run:${result.reopenProposal.id}`),
        proposalId: result.reopenProposal.id,
        taintKey: `task-manager:target-change-reopen:${ctx.identity.id}:${input.taskId}`,
      });
      if (governed.status !== "pending_review") {
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Task reopen did not halt for Human review" });
      }
    }
    return result;
  }),
  proposeRestructure: authenticatedProcedure.input(z.object({
    organizationId: z.string().uuid(),
    operation: taskRestructureInput,
  })).use(organizationGuard).mutation(async ({ input, ctx }) => {
    const operation = input.operation.kind === "insert_ancestor_above"
      ? {
          ...input.operation,
          ancestor: {
            id: input.operation.ancestor.id ?? ctx.run.ids.next(),
            organizationId: input.organizationId,
            title: input.operation.ancestor.title,
            ownerType: input.operation.ancestor.ownerType,
            ownerId: input.operation.ancestor.ownerId,
            ...(input.operation.ancestor.isGoal !== undefined ? { isGoal: input.operation.ancestor.isGoal } : {}),
            ...(input.operation.ancestor.outcomes ? { outcomes: normalizeTaskOutcomes(input.operation.ancestor.outcomes) } : {}),
            ...(input.operation.ancestor.exitTest ? { exitTest: input.operation.ancestor.exitTest } : {}),
          },
        }
      : input.operation;
    // ADR-203 — Internal Strategist's own Run running the real
    // `task-tree-restructure` Skill. The operation is what the Human asked
    // for; what the Skill adds is the recomputed subtree the reviewer is
    // actually approving.
    const { proposal: governed } = await runTaskManagerAgentAutomation(ctx, {
      organizationId: input.organizationId,
      automationId: TASK_MANAGER_RESTRUCTURE_AUTOMATION_ID,
      name: "Task Manager tree restructure proposal",
      agentId: INTERNAL_STRATEGIST_AGENT,
      skill: "task-manager.task-tree-restructure",
      action: "write",
      params: {
        queue: await ctx.wiring.taskManager.list(input.organizationId),
        operation,
      },
      runId: idempotentUuid(`${input.organizationId}:restructure_run:${input.operation.taskId}:${ctx.run.clock.nowISO()}`),
      taintKey: `task-manager:tree-restructure:${ctx.identity.id}:${input.operation.taskId}`,
    });
    if (governed.status !== "pending_review") {
      throw new TRPCError({
        code: "INTERNAL_SERVER_ERROR",
        message: `Task restructure did not halt for Human review (${governed.status}: ${governed.rejectionReason ?? "no reason"})`,
      });
    }
    let proposalIdAvailable = true;
    return ctx.wiring.taskManager.proposeRestructure(
      input.organizationId,
      operation,
      INTERNAL_STRATEGIST_AGENT,
      {
        nextId: () => {
          if (proposalIdAvailable) {
            proposalIdAvailable = false;
            return governed.id;
          }
          return ctx.run.ids.next();
        },
        nowISO: () => ctx.run.clock.nowISO(),
      },
    );
  }),
  /**
   * Read one Task-side proposal.
   *
   * Added with the edit decision (ADR-200) because editing requires seeing
   * what you are editing: `decideProposal` could always be called, but
   * nothing could fetch the drafted payload to show a reviewer first. The
   * pipeline proposal and this row share an id (ADR-199), so a client that
   * has the ledger entry can read the queue-side draft with the same id.
   */
  proposal: authenticatedProcedure.input(z.object({
    organizationId: z.string().uuid(),
    proposalId: z.string().uuid(),
  })).use(organizationGuard).query(async ({ input, ctx }) => {
    return ctx.wiring.taskManager.getProposal(input.organizationId, input.proposalId);
  }),
  decideProposal: authenticatedProcedure.input(z.object({
    organizationId: z.string().uuid(),
    proposalId: z.string().uuid(),
    decision: z.enum(["approve", "edit", "veto"]),
    editedExternalContent: z.string().max(MAX_MODULE_FILE_BYTES).optional(),
    editedPlanningItems: z.array(EDITED_PLANNING_ITEM).min(1).max(MAX_MATERIALIZED_TASKS).optional(),
  })).use(organizationGuard).mutation(async ({ input, ctx }) => {
    if (ctx.identity.type !== "user") throw new TRPCError({ code: "FORBIDDEN", message: "Only a Human may decide a Task proposal" });
    const taskProposal = await ctx.wiring.taskManager.getProposal(input.organizationId, input.proposalId);
    if (!taskProposal) throw new TRPCError({ code: "NOT_FOUND", message: "Task proposal not found" });
    if (
      taskProposal.status === "pending_review" &&
      taskProposal.expiresAt &&
      Date.parse(taskProposal.expiresAt) <= Date.parse(ctx.run.clock.nowISO())
    ) {
      throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Task proposal expired" });
    }
    // ADR-200: `candidate` joins `projection_reconcile` as editable. Every
    // other kind stays approve-or-veto because its payload is a computed
    // PLAN over specific rows and versions (`archive_sweep`'s id/version
    // list, a restructure's operation) — an edited one is a different plan
    // that was never checked for staleness, not a corrected draft.
    if (input.decision === "edit" && !["projection_reconcile", "candidate"].includes(taskProposal.kind)) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: `A ${taskProposal.kind} proposal can be approved or vetoed, not edited`,
      });
    }
    const decidePipeline = async (
      editedPayload?: Readonly<Record<string, unknown>>,
    ): Promise<Readonly<Record<string, unknown>>> => {
      try {
        await ctx.wiring.pipeline.decide(
          input.proposalId,
          input.decision,
          ctx.identity,
          ctx.run,
          editedPayload,
        );
      } catch (error) {
        if (!(error instanceof AlreadyResolvedError)) throw error;
        if (error.existingDecision !== input.decision) {
          throw new TRPCError({
            code: "CONFLICT",
            message: `Pipeline proposal was already resolved as ${error.existingDecision ?? "unknown"}`,
          });
        }
      }
      const decisionEntry = await ctx.wiring.ledger.decisionFor(input.proposalId);
      const payload: Readonly<Record<string, unknown>> = {
        ...(editedPayload ?? taskProposal.payload),
        ...(decisionEntry ? { decisionLedgerId: decisionEntry.id } : {}),
      };
      return payload;
    };
    const applyDecision = (payload: Readonly<Record<string, unknown>>) =>
      ctx.wiring.taskManager.decideProposal(
        input.organizationId,
        input.proposalId,
        input.decision,
        ctx.identity.id,
        { nextId: () => ctx.run.ids.next(), nowISO: () => ctx.run.clock.nowISO() },
        payload,
      );

    if (taskProposal.kind === "projection_reconcile") {
      const installation = await requireInstalledTaskManager(ctx.wiring, input.organizationId);
      const organizationName = await requireOrganizationNameForFiles(
        ctx.wiring,
        input.organizationId,
        ctx.identity.id,
      );
      let editedPayload: Readonly<Record<string, unknown>> | undefined;
      if (input.decision === "edit" && taskProposal.status === "pending_review") {
        const externalContent = input.editedExternalContent;
        if (!externalContent) throw new TRPCError({ code: "BAD_REQUEST", message: "editedExternalContent is required" });
        const [tasks, editEdges] = await Promise.all([
          ctx.wiring.taskManager.list(input.organizationId),
          ctx.wiring.taskManager.listDependencies(input.organizationId),
        ]);
        const currentProjection = emitTasksMarkdown(tasks, 10, editEdges);
        const drift = detectTaskProjectionDrift(currentProjection, externalContent, tasks);
        if (!drift.drifted || drift.reason) {
          throw new TRPCError({ code: "CONFLICT", message: drift.reason ?? "Edited projection has no changes" });
        }
        editedPayload = {
          ...taskProposal.payload,
          externalContent,
          externalContentHash: drift.externalContentHash,
          changes: drift.changes,
        };
      }
      const effectivePayload = await decidePipeline(editedPayload);
      const runIdValue = taskProposal.payload["runId"];
      const runId = typeof runIdValue === "string" ? runIdValue : null;
      let effect;
      if (input.decision === "veto") {
        effect = {
          decided: await applyDecision(effectivePayload),
          runId,
          vetoed: true as const,
        };
      } else {
        let projection: { content: string; contentHash: string };
        if (taskProposal.status === "approved") {
          const existingProjection = taskProposal.result?.["projection"];
          if (
            typeof existingProjection !== "object" ||
            existingProjection === null ||
            typeof (existingProjection as { content?: unknown }).content !== "string"
          ) {
            throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Applied projection has no durable result" });
          }
          projection = existingProjection as { content: string; contentHash: string };
        } else {
          const [currentTasks, appliedEdges] = await Promise.all([
            ctx.wiring.taskManager.list(input.organizationId),
            ctx.wiring.taskManager.listDependencies(input.organizationId),
          ]);
          const externalContent = effectivePayload["externalContent"];
          if (typeof externalContent !== "string") {
            throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Projection proposal has no external content" });
          }
          projection = emitTasksMarkdown(
            applyApprovedTaskProjectionReconciliation(
              currentTasks,
              externalContent,
              ctx.run.clock.nowISO(),
            ),
            10,
            appliedEdges,
          );
        }
        const fileEffect = await withOrganizationFileOperationLock(
          input.organizationId,
          async () => {
            const file = await readModuleFileContent(
              organizationName,
              moduleFolderLabel(installation),
              TASK_MANAGER_PROJECTION_FILE,
              ctx.wiring.moduleFilesBridgeRoot,
            );
            const proposedFileHash = taskProposal.payload["externalFileHash"];
            const replayFileHash = sha256Content(projection.content);
            if (
              !file ||
              ![proposedFileHash, replayFileHash].some(
                (candidate) => typeof candidate === "string" && candidate === file.contentHash,
              )
            ) {
              throw new TRPCError({ code: "CONFLICT", message: "tasks.md changed after reconciliation was proposed" });
            }
            const originalContent = Buffer.from(file.content).toString("utf8");
            const written = await replaceTaskProjectionFile(
              ctx.wiring,
              organizationName,
              moduleFolderLabel(installation),
              file.contentHash,
              projection.content,
            );
            return { written, originalContent };
          },
        );
        let decided;
        try {
          decided = await applyDecision(effectivePayload);
        } catch (error) {
          try {
            await withOrganizationFileOperationLock(
              input.organizationId,
              () => replaceTaskProjectionFile(
                ctx.wiring,
                organizationName,
                moduleFolderLabel(installation),
                fileEffect.written.contentHash,
                fileEffect.originalContent,
              ),
            );
          } catch (rollbackError) {
            throw new AggregateError(
              [error, rollbackError],
              "Projection Database effect failed and tasks.md rollback also failed",
            );
          }
          throw error;
        }
        const durableProjection = decided.result?.["projection"];
        if (
          typeof durableProjection !== "object" ||
          durableProjection === null ||
          (durableProjection as { contentHash?: unknown }).contentHash !== projection.contentHash
        ) {
          throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Projection File and Database result diverged" });
        }
        effect = {
          decided,
          runId,
          vetoed: false as const,
          written: fileEffect.written,
          projection,
        };
      }
      if (effect.vetoed) {
        if (effect.runId) {
          await ctx.wiring.automationRunRecorder.finish({
            runId: effect.runId,
            organizationId: input.organizationId,
            status: "completed",
            output: { decision: "veto", proposalId: input.proposalId },
          }, ctx.run);
        }
        return effect.decided;
      }
      const indexed = await ctx.wiring.graphStore.indexModuleFile({
        organizationId: input.organizationId,
        ownerUserId: ctx.identity.id,
        moduleId: installation.id,
        moduleName: installation.moduleName,
        ...effect.written.item,
      });
      if (effect.runId) {
        await ctx.wiring.automationRunRecorder.finish({
          runId: effect.runId,
          organizationId: input.organizationId,
          status: "completed",
          output: {
            decision: input.decision,
            proposalId: input.proposalId,
            resultId: effect.decided.result?.["resultId"] ?? input.proposalId,
            eventId: effect.decided.result?.["eventId"] ?? null,
            fileId: indexed.id,
            fileHash: effect.written.contentHash,
            projectionHash: effect.projection.contentHash,
          },
        }, ctx.run);
      }
      return {
        ...effect.decided,
        evidence: {
          eventType: "task.projection_reconcile.approved",
          eventId: effect.decided.result?.["eventId"] ?? null,
          resultId: effect.decided.result?.["resultId"] ?? input.proposalId,
          fileId: indexed.id,
          runId: effect.runId,
          fileHash: effect.written.contentHash,
          projectionHash: effect.projection.contentHash,
        },
      };
    }

    // A planning draft the reviewer corrected before approving (ADR-200).
    // The merge is an allow-list over the ONE content key this kind
    // materializes from — see `mergeEditedPlanningPayload` for why `kind`,
    // the run id and the model receipt are never taken from the human.
    let editedPlanningPayload: Readonly<Record<string, unknown>> | undefined;
    if (input.decision === "edit" && taskProposal.kind === "candidate") {
      if (!input.editedPlanningItems) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "editedPlanningItems is required to edit a planning proposal" });
      }
      try {
        editedPlanningPayload = mergeEditedPlanningPayload(taskProposal.payload, input.editedPlanningItems);
      } catch (error) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: error instanceof Error ? error.message : "Edited plan is not materializable",
        });
      }
    }
    const decided = await applyDecision(await decidePipeline(editedPlanningPayload));
    // Both kinds' Runs are already recorded `completed` by the executor when
    // the proposal halted for review; finishing again overwrites that output
    // with what the Human actually decided, so the Run record shows the
    // outcome rather than only that a draft was produced.
    if (taskProposal.kind === "archive_sweep" || taskProposal.kind === "candidate") {
      const runId = taskProposal.payload["runId"];
      if (typeof runId === "string") {
        await ctx.wiring.automationRunRecorder.finish({
          runId,
          organizationId: input.organizationId,
          status: "completed",
          output: {
            decision: input.decision,
            proposalId: input.proposalId,
            result: decided.result ?? null,
          },
        }, ctx.run);
      }
    }
    return decided;
  }),
  projection: authenticatedProcedure.input(z.object({
    organizationId: z.string().uuid(),
    externalContent: z.string().optional(),
  })).use(organizationGuard).query(async ({ input, ctx }) => {
    const [tasks, edges] = await Promise.all([
      ctx.wiring.taskManager.list(input.organizationId),
      ctx.wiring.taskManager.listDependencies(input.organizationId),
    ]);
    const projection = emitTasksMarkdown(tasks, 10, edges);
    return {
      projection,
      ...(input.externalContent ? { drift: detectTaskProjectionDrift(projection, input.externalContent, tasks) } : {}),
      guards: evaluateTaskGuards(tasks),
    };
  }),
  emitProjectionFile: authenticatedProcedure.input(z.object({
    organizationId: z.string().uuid(),
    expectedFileHash: z.string().regex(/^sha256:[0-9a-f]{64}$/).nullable().optional(),
  })).use(organizationGuard).mutation(async ({ input, ctx }) => {
    const installation = await requireInstalledTaskManager(ctx.wiring, input.organizationId);
    const [projectedTasks, projectedEdges] = await Promise.all([
      ctx.wiring.taskManager.list(input.organizationId),
      ctx.wiring.taskManager.listDependencies(input.organizationId),
    ]);
    const projection = emitTasksMarkdown(projectedTasks, 10, projectedEdges);
    const organizationName = await requireOrganizationNameForFiles(
      ctx.wiring,
      input.organizationId,
      ctx.identity.id,
    );
    const written = await withOrganizationFileOperationLock(
      input.organizationId,
      () =>
        replaceTaskProjectionFile(
          ctx.wiring,
          organizationName,
          moduleFolderLabel(installation),
          input.expectedFileHash ?? null,
          projection.content,
        ),
    );
    const indexed = await ctx.wiring.graphStore.indexModuleFile({
      organizationId: input.organizationId,
      ownerUserId: ctx.identity.id,
      moduleId: installation.id,
      moduleName: installation.moduleName,
      ...written.item,
    });

    // The per-repo agent-ledger template (TM6 deliverable, ADR-209), written
    // beside the projection in the same operation.
    //
    // It ships WITH the projection rather than separately because the two are
    // one artifact: `tasks.md` says what the work is, and this says how to
    // work it. TM6's exit test is another repository's coding agent working a
    // full Task from this folder, and that agent arrives knowing nothing about
    // proposals, drift, or evidence — a projection alone teaches it that this
    // is a file it may simply rewrite.
    //
    // Rendered from the same constants that enforce the rules, so it cannot
    // describe a contract the server would then refuse. Its own hash is not
    // checked against a caller expectation: it is generated, never edited,
    // and a stale copy is simply replaced.
    const template = emitAgentLedgerTemplate({
      moduleDisplayName: moduleFolderLabel(installation),
      organizationName,
      projectionFileName: TASK_MANAGER_PROJECTION_FILE,
      completedCap: TASK_PROJECTION_COMPLETED_CAP,
      statuses: TASK_RECORD_STATUSES,
    });
    const writtenTemplate = await withOrganizationFileOperationLock(
      input.organizationId,
      async () => {
        // Read the current hash INSIDE the lock and pass it as the
        // expectation. There is no unconditional-overwrite mode, and there
        // should not be: the template is regenerated rather than edited, but
        // a concurrent writer is still a conflict worth refusing rather than
        // clobbering. `null` means "must be absent", which is only true the
        // first time.
        const existing = await readModuleFileContent(
          organizationName,
          moduleFolderLabel(installation),
          AGENT_LEDGER_TEMPLATE_FILE,
          ctx.wiring.moduleFilesBridgeRoot,
        );
        return replaceModuleFileContent(
          organizationName,
          moduleFolderLabel(installation),
          AGENT_LEDGER_TEMPLATE_FILE,
          existing?.contentHash ?? null,
          Buffer.from(template, "utf8"),
          ctx.wiring.moduleFilesBridgeRoot,
        );
      },
    );
    const indexedTemplate = await ctx.wiring.graphStore.indexModuleFile({
      organizationId: input.organizationId,
      ownerUserId: ctx.identity.id,
      moduleId: installation.id,
      moduleName: installation.moduleName,
      ...writtenTemplate.item,
    });

    return {
      projection,
      file: written.item,
      fileHash: written.contentHash,
      fileId: indexed.id,
      agentTemplate: {
        file: writtenTemplate.item,
        fileHash: writtenTemplate.contentHash,
        fileId: indexedTemplate.id,
      },
    };
  }),
  proposeProjectionReconcile: authenticatedProcedure.input(z.object({
    organizationId: z.string().uuid(),
    externalContent: z.string().max(MAX_MODULE_FILE_BYTES),
    expectedFileHash: z.string().regex(/^sha256:[0-9a-f]{64}$/),
    idempotencyKey: z.string().trim().min(8).max(200),
    expiresAt: z.string().datetime(),
  })).use(organizationGuard).mutation(async ({ input, ctx }) => {
    const expiresAt = Date.parse(input.expiresAt);
    const now = Date.parse(ctx.run.clock.nowISO());
    if (expiresAt <= now || expiresAt > now + 24 * 60 * 60 * 1000) {
      throw new TRPCError({ code: "BAD_REQUEST", message: "Projection proposal expiry must be within the next 24 hours" });
    }
    const installation = await requireInstalledTaskManager(ctx.wiring, input.organizationId);
    const assignment = await ensureTaskManagerAutomation(ctx.wiring, input.organizationId, {
      automationId: TASK_MANAGER_DRIFT_AUTOMATION_ID,
      name: "Task Manager ledger drift detector",
      agentId: INTERNAL_STRATEGIST_AGENT,
      skill: "task-manager.ledger-projection",
      action: "write",
    }, ctx.run);
    const organizationName = await requireOrganizationNameForFiles(
      ctx.wiring,
      input.organizationId,
      ctx.identity.id,
    );
    const file = await withOrganizationFileOperationLock(
      input.organizationId,
      () => readModuleFileContent(
          organizationName,
          moduleFolderLabel(installation),
          TASK_MANAGER_PROJECTION_FILE,
          ctx.wiring.moduleFilesBridgeRoot,
      ),
    );
    if (!file || file.contentHash !== input.expectedFileHash) {
      throw new TRPCError({ code: "CONFLICT", message: "tasks.md does not match expectedFileHash" });
    }
    if (Buffer.from(file.content).toString("utf8") !== input.externalContent) {
      throw new TRPCError({ code: "CONFLICT", message: "Submitted projection is not the current tasks.md File" });
    }
    const [tasks, reconcileEdges] = await Promise.all([
      ctx.wiring.taskManager.list(input.organizationId),
      ctx.wiring.taskManager.listDependencies(input.organizationId),
    ]);
    const projection = emitTasksMarkdown(tasks, 10, reconcileEdges);
    const drift = detectTaskProjectionDrift(projection, input.externalContent, tasks);
    if (!drift.drifted || drift.reason) {
      throw new TRPCError({ code: "CONFLICT", message: drift.reason ?? "tasks.md has no drift" });
    }
    const payload = {
          beforeProjectionHash: projection.contentHash,
          externalContentHash: drift.externalContentHash,
          externalFileHash: input.expectedFileHash,
          recordVersions: projection.recordVersions,
          changes: drift.changes,
          externalContent: input.externalContent,
          assignment,
    };
    const proposalId = idempotentUuid(
          `${input.organizationId}:projection_reconcile:${input.idempotencyKey}`,
    );
    const runId = idempotentUuid(
          `${input.organizationId}:projection_reconcile_run:${input.idempotencyKey}`,
    );
    const staged = await ctx.wiring.taskManager.stageProposal({
          id: proposalId,
          organizationId: input.organizationId,
          kind: "projection_reconcile",
          taskId: drift.changes[0]!.id,
          actorId: INTERNAL_STRATEGIST_AGENT,
          payload: { ...payload, runId },
          idempotencyKey: input.idempotencyKey,
          expiresAt: input.expiresAt,
    }, { nextId: () => ctx.run.ids.next(), nowISO: () => ctx.run.clock.nowISO() });
    if (await ctx.wiring.ledger.get(proposalId)) {
      return { proposal: staged, runId, drift };
    }
    const run = await ctx.wiring.automationExecutor.runById({
          organizationId: input.organizationId,
          automationId: TASK_MANAGER_DRIFT_AUTOMATION_ID,
          onBehalfOf: { type: "user", id: ctx.identity.id },
          params: payload,
          seed: input.idempotencyKey,
          runId,
          proposalId,
    }, withHumanInputTaint(
      ctx.run,
      `task-manager:ledger-drift:${ctx.identity.id}:${runId}`,
      payload,
    ));
    const governed = run.proposals[0];
    if (!governed || governed.id !== proposalId || governed.status !== "pending_review") {
      throw new TRPCError({
        code: "INTERNAL_SERVER_ERROR",
        message: `Ledger drift Automation did not halt for review (${governed?.status ?? "missing"}: ${governed?.rejectionReason ?? "no reason"})`,
      });
    }
    return { proposal: staged, runId, drift };
  }),
  /**
   * TM3 planning Playbooks, run as a governed Automation.
   *
   * Human-triggered on purpose. The other Task Manager Automations fire on a
   * cadence or a Task Event; these Skills answer a question somebody asked
   * ("decompose this", "write me an exit test"), so the trigger is a person.
   * It is an Automation anyway so the invocation gets an attributable
   * Internal Strategist Run and a proposal that halts for review — before
   * this, the planning Skills were reachable only through the registry and
   * nothing had ever actually run one.
   *
   * No `TaskChangeProposal` is staged: `projection_reconcile` and
   * `archive_sweep` stage one because approval APPLIES a concrete mutation,
   * and there is nothing to apply here. The pipeline proposal carrying the
   * draft IS the review artifact.
   */
  runPlanningPlaybook: authenticatedProcedure.input(z.object({
    organizationId: z.string().uuid(),
    taskId: z.string().uuid(),
    skill: z.enum([
      "goal-outcome-framing",
      "candidate-task-generation",
      "premortem-scenario",
      "task-decomposition",
      "exit-test-authoring",
    ]),
    playbookId: z.string().trim().min(1).max(80).optional(),
    horizon: z.string().trim().min(1).max(160).optional(),
    idempotencyKey: z.string().trim().min(8).max(200),
    expiresAt: z.string().datetime(),
  }).strict()).use(organizationGuard).mutation(async ({ input, ctx }) => {
    await requireInstalledTaskManager(ctx.wiring, input.organizationId);

    const task = await ctx.wiring.taskManager.get(input.organizationId, input.taskId);
    if (!task) throw new TRPCError({ code: "NOT_FOUND", message: "Task not found" });
    const queue = await ctx.wiring.taskManager.list(input.organizationId);
    const children = queue.filter((candidate) => candidate.parentTaskId === task.id);

    const skillId = `task-manager.${input.skill}`;
    await ensureTaskManagerAutomation(ctx.wiring, input.organizationId, {
      automationId: TASK_MANAGER_PLANNING_AUTOMATION_ID,
      name: "Task Manager planning Playbook",
      agentId: INTERNAL_STRATEGIST_AGENT,
      skill: skillId,
      action: "write",
    }, ctx.run);

    // Only the fields the chosen Skill can actually use. The Task's own path
    // is the PARENT path for decomposition — children land beneath it — and
    // the existing child paths are what keep generated dot-paths from
    // colliding with live rows.
    const params: Record<string, unknown> = {
      title: task.title,
      outcomes: task.outcomes.map((outcome) => ({
        title: outcome.title,
        measure: outcome.measure,
        target: outcome.target,
      })),
      ...(task.exitTest ? { exitTest: task.exitTest } : {}),
      ...(input.playbookId ? { playbookId: input.playbookId } : {}),
      ...(input.horizon ? { horizon: input.horizon } : {}),
      ...(input.skill === "task-decomposition"
        ? {
            parentPath: task.path,
            existingChildPaths: children.map((child) => child.path),
            existingChildTitles: children.map((child) => child.title),
          }
        : {}),
      ...(input.skill === "candidate-task-generation"
        ? { existingChildTitles: children.map((child) => child.title) }
        : {}),
    };

    const runId = idempotentUuid(
      `${input.organizationId}:planning_playbook_run:${input.skill}:${input.idempotencyKey}`,
    );
    // The model call is governed HERE rather than inside the Skill: this is
    // the only layer with the request context `authorizeModelCompletion`
    // and the receipt append need. Local plane only, matching the Skills'
    // own `plane: "local"` manifests — `resolveLocalPlanningModel` fails
    // closed to `undefined`, and the Skill then returns its Playbook
    // scaffold rather than drafting.
    const planningModel = resolveLocalPlanningModel(ctx.wiring.models);
    const governedModel = planningModel
      ? createGovernedModelProvider(
          ctx,
          input.organizationId,
          planningModel,
          `task-manager:${input.skill}`,
        )
      : undefined;

    // ONE id for both records: the pipeline proposal (ledger) and the
    // Task-Manager-side `candidate` row that approval materializes. That
    // shared id is what lets `taskManager.decideProposal` resolve the
    // pipeline decision and the queue write as a single human decision —
    // the same pairing `projection_reconcile` and `archive_sweep` use.
    const proposalId = idempotentUuid(
      `${input.organizationId}:planning_playbook:${input.skill}:${input.idempotencyKey}`,
    );
    const run = await ctx.wiring.automationExecutor.runById({
      organizationId: input.organizationId,
      automationId: TASK_MANAGER_PLANNING_AUTOMATION_ID,
      onBehalfOf: { type: "user", id: ctx.identity.id },
      params,
      seed: input.idempotencyKey,
      runId,
      proposalId,
    }, {
      ...withHumanInputTaint(
        ctx.run,
        `task-manager:planning-playbook:${ctx.identity.id}:${runId}`,
        params,
      ),
      ...(governedModel ? { modelProvider: governedModel.provider } : {}),
    });
    const governed = run.proposals[0];
    if (!governed || governed.id !== proposalId || governed.status !== "pending_review") {
      throw new TRPCError({
        code: "INTERNAL_SERVER_ERROR",
        message: `Planning Automation did not halt for review (${governed?.status ?? "missing"}: ${governed?.rejectionReason ?? "no reason"})`,
      });
    }

    // Stage the Task-Manager-side proposal that approval materializes
    // (ADR-199). The pipeline proposal above is the governed review record;
    // this is the row `taskManager.decideProposal` turns into Tasks.
    const draft = (governed.output?.proposedOutput ?? {}) as Record<string, unknown>;
    const staged = await ctx.wiring.taskManager.stageProposal({
      id: proposalId,
      organizationId: input.organizationId,
      kind: "candidate",
      taskId: task.id,
      actorId: INTERNAL_STRATEGIST_AGENT,
      payload: { ...draft, runId },
      idempotencyKey: `${input.skill}:${input.idempotencyKey}`,
      expiresAt: input.expiresAt,
    }, { nextId: () => ctx.run.ids.next(), nowISO: () => ctx.run.clock.nowISO() });

    return {
      runId,
      skill: skillId,
      taskId: task.id,
      proposal: governed,
      candidateProposal: staged,
      modelReceiptLedgerId: governedModel?.receiptLedgerId() ?? null,
    };
  }),
  /**
   * `proactive-scan-cadence`, given a runtime binding at last. Declared in
   * the Module manifest since TM0 with no Automation id and no procedure
   * behind it — the same declared-not-built gap the planning Skills had.
   *
   * Proposes candidate Tasks and writes none: `scanForOpportunities` reads
   * the queue and every finding names the row it came from, so approval is
   * where a candidate would ever become real.
   */
  runOpportunityScan: authenticatedProcedure.input(z.object({
    organizationId: z.string().uuid(),
    idempotencyKey: z.string().trim().min(8).max(200),
    expiresAt: z.string().datetime(),
  }).strict()).use(organizationGuard).mutation(async ({ input, ctx }) => {
    await requireInstalledTaskManager(ctx.wiring, input.organizationId);

    const queue = await ctx.wiring.taskManager.list(input.organizationId);
    await ensureTaskManagerAutomation(ctx.wiring, input.organizationId, {
      automationId: TASK_MANAGER_SCAN_AUTOMATION_ID,
      name: "Task Manager proactive opportunity scan",
      agentId: INTERNAL_STRATEGIST_AGENT,
      skill: "task-manager.proactive-opportunity-scan",
      action: "write",
    }, ctx.run);

    const params = { queue };
    const runId = idempotentUuid(
      `${input.organizationId}:opportunity_scan_run:${input.idempotencyKey}`,
    );
    const proposalId = idempotentUuid(
      `${input.organizationId}:opportunity_scan:${input.idempotencyKey}`,
    );
    const run = await ctx.wiring.automationExecutor.runById({
      organizationId: input.organizationId,
      automationId: TASK_MANAGER_SCAN_AUTOMATION_ID,
      onBehalfOf: { type: "user", id: ctx.identity.id },
      params,
      seed: input.idempotencyKey,
      runId,
      proposalId,
    }, withHumanInputTaint(
      ctx.run,
      `task-manager:opportunity-scan:${ctx.identity.id}:${runId}`,
      { taskCount: queue.length },
    ));
    const governed = run.proposals[0];
    if (!governed || governed.id !== proposalId || governed.status !== "pending_review") {
      throw new TRPCError({
        code: "INTERNAL_SERVER_ERROR",
        message: `Opportunity scan Automation did not halt for review (${governed?.status ?? "missing"}: ${governed?.rejectionReason ?? "no reason"})`,
      });
    }

    // The scan's findings become candidate Tasks only on approval
    // (ADR-199), and each lands under the Task its finding named.
    const draft = (governed.output?.proposedOutput ?? {}) as Record<string, unknown>;
    const opportunities = Array.isArray(draft["opportunities"]) ? draft["opportunities"] : [];
    if (opportunities.length === 0) {
      // An honest empty scan raises no proposal at all. Staging one would
      // put "approve this nothing" in the review inbox.
      return { runId, proposal: governed, candidateProposal: null };
    }
    // Anchored on the first finding's own Task: `applyApprovedPlanningProposal`
    // re-homes each candidate under the row its finding named, so this only
    // has to be a real Task the proposal can be attached to.
    const subjectId = (opportunities[0] as { taskId?: unknown }).taskId;
    const staged = await ctx.wiring.taskManager.stageProposal({
      id: proposalId,
      organizationId: input.organizationId,
      kind: "candidate",
      taskId: typeof subjectId === "string" ? subjectId : queue[0]!.id,
      actorId: INTERNAL_STRATEGIST_AGENT,
      payload: { ...draft, runId },
      idempotencyKey: input.idempotencyKey,
      expiresAt: input.expiresAt,
    }, { nextId: () => ctx.run.ids.next(), nowISO: () => ctx.run.clock.nowISO() });

    return { runId, proposal: governed, candidateProposal: staged };
  }),
  /**
   * The two Chief of Staff cadence briefs (ADR-201).
   *
   * Both were declared Automations from TM0 with no runtime id, blocked on
   * the same thing: Chief of Staff had no governed Agent identity, so an
   * Automation it owned had no actor to run as.
   *
   * They REPORT and stop. Neither raises a Task-Manager proposal, because
   * neither proposes a change — a brief's product is what the reader now
   * knows, the same reason an approved pre-mortem writes nothing (ADR-199).
   * They read the queue, so the step's action is `read`: forcing a Human to
   * approve being told about their own Tasks would be governance theatre,
   * and the Run itself is the attributable record.
   *
   * One Skill behind both, on purpose. `progress-synthesis` already answers
   * "what moved and what did not" over a window, and its `stalled` list IS
   * the staleness question asked over a longer one. A nineteenth Skill for
   * the same computation would have been a roster entry, not a capability.
   */
  runQueueBrief: authenticatedProcedure.input(z.object({
    organizationId: z.string().uuid(),
    brief: z.enum(["standup-brief", "stale-task-review"]),
    /** The window each brief looks back over. Defaults differ because the
     * questions differ: a standup asks "since yesterday", a staleness
     * review asks "what has nobody touched in two weeks". */
    windowDays: z.number().int().min(1).max(90).optional(),
    idempotencyKey: z.string().trim().min(8).max(200),
  }).strict()).use(organizationGuard).mutation(async ({ input, ctx }) => {
    await requireInstalledTaskManager(ctx.wiring, input.organizationId);

    const isStaleReview = input.brief === "stale-task-review";
    const windowDays = input.windowDays ?? (isStaleReview ? DEFAULT_STALE_AFTER_DAYS : 1);
    const automationId = isStaleReview
      ? TASK_MANAGER_STALE_REVIEW_AUTOMATION_ID
      : TASK_MANAGER_STANDUP_AUTOMATION_ID;

    const queue = await ctx.wiring.taskManager.list(input.organizationId);
    await ensureTaskManagerAutomation(ctx.wiring, input.organizationId, {
      automationId,
      name: isStaleReview ? "Task Manager stale task review" : "Task Manager standup brief",
      agentId: CHIEF_OF_STAFF_AGENT,
      skill: "task-manager.progress-synthesis",
      action: "read",
    }, ctx.run);

    const until = ctx.run.clock.nowISO();
    const since = new Date(Date.parse(until) - windowDays * 24 * 60 * 60 * 1000).toISOString();
    // `queue` is the dispatcher's authorized-input key for every
    // Task Manager Skill that reads the queue (a Skill invoked without it
    // THROWS rather than reporting an empty brief — ADR-198).
    const params = { queue, since, until };
    const runId = idempotentUuid(
      `${input.organizationId}:queue_brief_run:${input.brief}:${input.idempotencyKey}`,
    );
    const run = await ctx.wiring.automationExecutor.runById({
      organizationId: input.organizationId,
      automationId,
      onBehalfOf: { type: "user", id: ctx.identity.id },
      params,
      seed: input.idempotencyKey,
      runId,
    }, withHumanInputTaint(
      ctx.run,
      `task-manager:${input.brief}:${ctx.identity.id}:${runId}`,
      { taskCount: queue.length, windowDays },
    ));
    const governed = run.proposals[0];
    if (!governed || governed.status === "rejected") {
      throw new TRPCError({
        code: "INTERNAL_SERVER_ERROR",
        message: `${input.brief} Automation did not produce a brief (${governed?.status ?? "missing"}: ${governed?.rejectionReason ?? "no reason"})`,
      });
    }
    const brief = (governed.output?.proposedOutput ?? null) as Record<string, unknown> | null;
    // A staleness review reports ONLY the stalled section: the rest of the
    // synthesis is a standup's answer to a different question, and shipping
    // it here would bury the one list this Automation exists to surface.
    const stalled = Array.isArray(brief?.["stalled"]) ? brief["stalled"] as unknown[] : [];
    return {
      runId,
      proposal: governed,
      window: { since, until, windowDays },
      brief: isStaleReview
        ? { kind: "stale_task_review" as const, stalled, count: stalled.length, basis: brief?.["basis"] ?? null }
        : brief,
    };
  }),
  /**
   * The two Governance guard Automations (ADR-202).
   *
   * `evaluateTaskGuards` has existed since TM0 but was reachable only as
   * read-only data hanging off the `projection` query, so neither
   * `wip-breach-detector` nor `unverified-done-challenger` had anything to
   * run. They now evaluate the queue as attributable Governance Runs.
   *
   * Each Automation reports ONLY its own finding kind. One guard evaluator
   * with several callers is not the same as one Automation that dumps every
   * finding under whichever name you invoked it by — a WIP breach and an
   * unverified `done` are different problems with different remedies, and
   * merging them would make either one easy to miss.
   */
  runQueueGuard: authenticatedProcedure.input(z.object({
    organizationId: z.string().uuid(),
    // `goal-review-cadence` is Internal Strategist's, not Governance's
    // (ADR-107's split: whether a goal is due for review is a planning
    // question, not a control question), so it runs as that Agent over the
    // same evaluator.
    guard: z.enum(["wip-breach-detector", "unverified-done-challenger", "goal-review-cadence"]),
    wipLimit: z.number().int().min(1).max(20).optional(),
    idempotencyKey: z.string().trim().min(8).max(200),
  }).strict()).use(organizationGuard).mutation(async ({ input, ctx }) => {
    await requireInstalledTaskManager(ctx.wiring, input.organizationId);

    const guardBinding = {
      "wip-breach-detector": {
        automationId: TASK_MANAGER_WIP_BREACH_AUTOMATION_ID,
        name: "Task Manager WIP breach detector",
        agentId: GOVERNANCE_AGENT,
        finding: "wip_breach",
      },
      "unverified-done-challenger": {
        automationId: TASK_MANAGER_UNVERIFIED_DONE_AUTOMATION_ID,
        name: "Task Manager unverified done challenger",
        agentId: GOVERNANCE_AGENT,
        finding: "unverified_done",
      },
      "goal-review-cadence": {
        automationId: TASK_MANAGER_GOAL_REVIEW_AUTOMATION_ID,
        name: "Task Manager goal review cadence",
        agentId: INTERNAL_STRATEGIST_AGENT,
        finding: "goal_review_due",
      },
    }[input.guard];
    const automationId = guardBinding.automationId;
    const queue = await ctx.wiring.taskManager.list(input.organizationId);
    await ensureTaskManagerAutomation(ctx.wiring, input.organizationId, {
      automationId,
      name: guardBinding.name,
      agentId: guardBinding.agentId,
      skill: "task-manager.queue-guard",
      action: "read",
    }, ctx.run);

    const runId = idempotentUuid(
      `${input.organizationId}:queue_guard_run:${input.guard}:${input.idempotencyKey}`,
    );
    const run = await ctx.wiring.automationExecutor.runById({
      organizationId: input.organizationId,
      automationId,
      onBehalfOf: { type: "user", id: ctx.identity.id },
      params: { queue, ...(input.wipLimit !== undefined ? { wipLimit: input.wipLimit } : {}) },
      seed: input.idempotencyKey,
      runId,
    }, withHumanInputTaint(
      ctx.run,
      `task-manager:${input.guard}:${ctx.identity.id}:${runId}`,
      { taskCount: queue.length },
    ));
    const governed = run.proposals[0];
    if (!governed || governed.status === "rejected") {
      throw new TRPCError({
        code: "INTERNAL_SERVER_ERROR",
        message: `${input.guard} Automation did not evaluate the queue (${governed?.status ?? "missing"}: ${governed?.rejectionReason ?? "no reason"})`,
      });
    }
    const output = (governed.output?.proposedOutput ?? {}) as Record<string, unknown>;
    const all = Array.isArray(output["findings"]) ? output["findings"] as { kind?: unknown }[] : [];
    const findings = all.filter((finding) => finding.kind === guardBinding.finding);
    return {
      runId,
      proposal: governed,
      guard: input.guard,
      findings,
      // A guard reports; it never transitions a Task. An unverified `done`
      // carries `proposedStatus: "pending"` as the guard's SUGGESTION, and
      // reopening it stays a Human's governed act through `transition`.
      breached: findings.length > 0,
    };
  }),
  /**
   * The deterministic approval gate, shared by `reschedule-approval-gate`
   * and `routing-approval-gate` (ADR-107: "reschedule + routing governance
   * share one mechanism"; ADR-073: the KERNEL decides, the Agent explains).
   *
   * The calibration counts come from REAL vetted decision history, not from
   * the caller. `taskManager.approvalBand` — the read-only query that
   * predates this — takes `approvals`/`vetoes` as client inputs, which
   * means anything calling it could hand itself a calibrated verdict. A gate
   * that trusts the caller's account of its own track record is not a gate.
   */
  runChangeGate: authenticatedProcedure.input(z.object({
    organizationId: z.string().uuid(),
    kind: z.enum(["route", "reschedule"]),
    deltaDays: z.number().int().min(-3650).max(3650).optional(),
    candidateCount: z.number().int().min(0).max(100).optional(),
    crossesModule: z.boolean().optional(),
    idempotencyKey: z.string().trim().min(8).max(200),
  }).strict()).use(organizationGuard).mutation(async ({ input, ctx }) => {
    await requireInstalledTaskManager(ctx.wiring, input.organizationId);
    return runTaskChangeGate(ctx, {
      organizationId: input.organizationId,
      kind: input.kind,
      ...(input.deltaDays !== undefined ? { deltaDays: input.deltaDays } : {}),
      ...(input.candidateCount !== undefined ? { candidateCount: input.candidateCount } : {}),
      ...(input.crossesModule !== undefined ? { crossesModule: input.crossesModule } : {}),
      idempotencyKey: input.idempotencyKey,
    });
  }),
  /**
   * Task dependency Relations (ADR-204) — the `depends_on` edges the plan
   * has specified since TM0 and the schema never had. Every slice since
   * ADR-196 recorded the same residual: `proposeQueueSequence` honoured the
   * `blocked` STATUS, which says someone believed a Task was blocked but not
   * by what, so nothing could ever tell them it had stopped being true.
   */
  dependencies: authenticatedProcedure.input(z.object({
    organizationId: z.string().uuid(),
  })).use(organizationGuard).query(async ({ input, ctx }) => {
    const [queue, edges] = await Promise.all([
      ctx.wiring.taskManager.list(input.organizationId),
      ctx.wiring.taskManager.listDependencies(input.organizationId),
    ]);
    return { dependencies: edges, blocked: blockedTasks(queue, edges) };
  }),
  addDependency: authenticatedProcedure.input(z.object({
    organizationId: z.string().uuid(),
    taskId: z.string().uuid(),
    dependsOnTaskId: z.string().uuid(),
    reason: z.string().trim().min(1).max(2_000).optional(),
  }).strict()).use(organizationGuard).mutation(async ({ input, ctx }) => {
    // Both ends must be real Tasks in THIS Organization. The composite FKs
    // enforce it in Postgres; checking here turns a constraint violation
    // into an answer the caller can act on.
    const [task, blocker] = await Promise.all([
      ctx.wiring.taskManager.get(input.organizationId, input.taskId),
      ctx.wiring.taskManager.get(input.organizationId, input.dependsOnTaskId),
    ]);
    if (!task || !blocker) throw new TRPCError({ code: "NOT_FOUND", message: "Both Tasks must exist in this Organization" });
    try {
      return await ctx.wiring.taskManager.addDependency({
        organizationId: input.organizationId,
        taskId: input.taskId,
        dependsOnTaskId: input.dependsOnTaskId,
        ...(input.reason ? { reason: input.reason } : {}),
      }, { nextId: () => ctx.run.ids.next(), nowISO: () => ctx.run.clock.nowISO() });
    } catch (error) {
      // A cycle is not a bad plan, it is an UNSATISFIABLE one: every Task in
      // it waits forever and no amount of finishing work clears it. 409, not
      // 500 — the request was well-formed and the answer is "no".
      if (error instanceof TaskDependencyCycleError) {
        throw new TRPCError({ code: "CONFLICT", message: error.message });
      }
      throw error;
    }
  }),
  removeDependency: authenticatedProcedure.input(z.object({
    organizationId: z.string().uuid(),
    dependencyId: z.string().uuid(),
  }).strict()).use(organizationGuard).mutation(async ({ input, ctx }) => {
    const removed = await ctx.wiring.taskManager.removeDependency(input.organizationId, input.dependencyId);
    if (!removed) throw new TRPCError({ code: "NOT_FOUND", message: "Dependency not found" });
    return { removed };
  }),
  /**
   * `dependency-unblock-notifier` (ADR-204) — the last Chief of Staff
   * Automation, and the one that was blocked on the SCHEMA rather than on
   * ownership: until now there were no edges whose clearing anyone could
   * notice.
   *
   * It notifies and stops. A blocker landing does not make the dependent
   * Task started, and flipping its status would decide for the Human that
   * the work is now theirs to pick up.
   */
  runDependencyUnblockNotifier: authenticatedProcedure.input(z.object({
    organizationId: z.string().uuid(),
    idempotencyKey: z.string().trim().min(8).max(200),
  }).strict()).use(organizationGuard).mutation(async ({ input, ctx }) => {
    await requireInstalledTaskManager(ctx.wiring, input.organizationId);
    const [queue, dependencies] = await Promise.all([
      ctx.wiring.taskManager.list(input.organizationId),
      ctx.wiring.taskManager.listDependencies(input.organizationId),
    ]);
    const { runId, proposal } = await runTaskManagerAgentAutomation(ctx, {
      organizationId: input.organizationId,
      automationId: TASK_MANAGER_DEPENDENCY_AUTOMATION_ID,
      name: "Task Manager dependency unblock notifier",
      agentId: CHIEF_OF_STAFF_AGENT,
      skill: "task-manager.dependency-analysis",
      action: "read",
      params: { queue, dependencies },
      runId: idempotentUuid(`${input.organizationId}:dependency_unblock_run:${input.idempotencyKey}`),
      taintKey: `task-manager:dependency-unblock:${ctx.identity.id}:${input.idempotencyKey}`,
    });
    const output = (proposal.output?.proposedOutput ?? {}) as Record<string, unknown>;
    return {
      runId,
      proposal,
      unblocked: Array.isArray(output["unblocked"]) ? output["unblocked"] : [],
      blocked: Array.isArray(output["blocked"]) ? output["blocked"] : [],
    };
  }),
  runCompletedBaySweep: authenticatedProcedure.input(z.object({
    organizationId: z.string().uuid(),
    completedCap: z.number().int().min(0).max(100).default(10),
    maxAgeDays: z.number().int().min(0).max(365).default(7),
    idempotencyKey: z.string().trim().min(8).max(200),
    expiresAt: z.string().datetime(),
  })).use(organizationGuard).mutation(async ({ input, ctx }) => {
    const nowIso = ctx.run.clock.nowISO();
    const expiresAt = Date.parse(input.expiresAt);
    const now = Date.parse(nowIso);
    if (expiresAt <= now || expiresAt > now + 24 * 60 * 60 * 1000) {
      throw new TRPCError({ code: "BAD_REQUEST", message: "Sweep proposal expiry must be within the next 24 hours" });
    }
    const proposalId = idempotentUuid(
      `${input.organizationId}:archive_sweep:${input.idempotencyKey}`,
    );
    const existingProposal = await ctx.wiring.taskManager.getProposal(
      input.organizationId,
      proposalId,
    );
    if (existingProposal) {
      const runId = existingProposal.payload["runId"];
      return {
        runId: typeof runId === "string" ? runId : null,
        proposal: existingProposal,
        plan: {
          eligibleTaskIds: existingProposal.payload["taskIds"] ?? [],
          expectedVersions: existingProposal.payload["recordVersions"] ?? {},
          policy: existingProposal.payload["policy"] ?? null,
        },
      };
    }
    const tasks = await ctx.wiring.taskManager.list(input.organizationId);
    const plan = planCompletedBaySweep(tasks, nowIso, input.completedCap, input.maxAgeDays);
    if (plan.eligibleTaskIds.length === 0) {
      const runId = idempotentUuid(
        `${input.organizationId}:archive_sweep_noop:${input.idempotencyKey}`,
      );
      const existingRuns = await ctx.wiring.automationRunRecorder.list(
        input.organizationId,
        [TASK_MANAGER_SWEEP_AUTOMATION_ID],
        { limit: 50 },
      );
      if (existingRuns.some((run) => run.runId === runId)) {
        return { runId, proposal: null, plan };
      }
      await ctx.wiring.automationRunRecorder.start({
        runId,
        automationId: TASK_MANAGER_SWEEP_AUTOMATION_ID,
        organizationId: input.organizationId,
        agentId: GOVERNANCE_AGENT,
      }, ctx.run);
      await ctx.wiring.automationRunRecorder.finish({
        runId,
        organizationId: input.organizationId,
        status: "completed",
        output: { eligibleTaskIds: [], policy: plan.policy },
      }, ctx.run);
      return { runId, proposal: null, plan };
    }
    await ensureTaskManagerAutomation(ctx.wiring, input.organizationId, {
      automationId: TASK_MANAGER_SWEEP_AUTOMATION_ID,
      name: "Task Manager completed bay sweep",
      agentId: GOVERNANCE_AGENT,
      skill: "task-manager.completed-bay-sweep",
      action: "archive",
    }, ctx.run);
    const payload = {
      taskIds: plan.eligibleTaskIds,
      recordVersions: plan.expectedVersions,
      policy: plan.policy,
    };
    const runId = idempotentUuid(
      `${input.organizationId}:archive_sweep_run:${input.idempotencyKey}`,
    );
    const staged = await ctx.wiring.taskManager.stageProposal({
      id: proposalId,
      organizationId: input.organizationId,
      kind: "archive_sweep",
      taskId: plan.eligibleTaskIds[0]!,
      actorId: GOVERNANCE_AGENT,
      payload: { ...payload, runId },
      idempotencyKey: input.idempotencyKey,
      expiresAt: input.expiresAt,
    }, { nextId: () => ctx.run.ids.next(), nowISO: () => ctx.run.clock.nowISO() });
    if (await ctx.wiring.ledger.get(proposalId)) {
      return { runId, proposal: staged, plan };
    }
    const run = await ctx.wiring.automationExecutor.runById({
      organizationId: input.organizationId,
      automationId: TASK_MANAGER_SWEEP_AUTOMATION_ID,
      onBehalfOf: { type: "user", id: ctx.identity.id },
      params: payload,
      seed: input.idempotencyKey,
      runId,
      proposalId,
    }, withHumanInputTaint(
      ctx.run,
      `task-manager:completed-bay-sweep:${ctx.identity.id}:${runId}`,
      payload,
    ));
    const governed = run.proposals[0];
    if (!governed || governed.id !== proposalId || governed.status !== "pending_review") {
      throw new TRPCError({
        code: "INTERNAL_SERVER_ERROR",
        message: `Completed-bay Automation did not halt for review (${governed?.status ?? "missing"}: ${governed?.rejectionReason ?? "no reason"})`,
      });
    }
    return { runId, proposal: staged, plan };
  }),
  /**
   * `agent-task-routing-on-assign` (ADR-207) — the LAST declared Automation
   * to get a runtime binding, and the reason it stayed unbound through eight
   * slices that bound thirteen others.
   *
   * `routeTaskByRequiredSkill` has existed since TM0 and `taskManager.route`
   * below exposes it. But `route` is a QUERY: it answers "who is eligible"
   * and nothing could ever act on the answer, because no write path set
   * `assignedAgentId` after a Task was created. Binding the Automation to
   * that computation would have produced an attributable Run that decided
   * nothing — the declared-not-built shape this workstream exists to end.
   * So the missing piece was a DECISION surface, and this is it.
   *
   * Three deliberate properties:
   *
   *  - The candidate set is `TASK_ROUTING_CANDIDATE_AGENTS`, resolved here,
   *    not passed in. `route`'s caller-supplied `candidateAgentIds` is
   *    harmless for a what-if, but on a path that WRITES it would turn "who
   *    is eligible" into "who did the caller offer" — a caller naming one
   *    Agent would manufacture the unambiguous answer that ADR-107 forbids
   *    anyone from defaulting to.
   *  - Routing to another Module's Skill is `crossesModule`, so it can never
   *    be minor and always stops for a Human however calibrated they are.
   *  - `human_assignment_required` stages NOTHING. There is no proposal to
   *    approve, because the honest output is "no Agent is eligible for this,
   *    a person has to own it" — offering an approve button there would
   *    invite someone to approve an assignment nobody computed.
   */
  assign: authenticatedProcedure.input(z.object({
    organizationId: z.string().uuid(),
    taskId: z.string().uuid(),
    idempotencyKey: z.string().trim().min(8).max(200),
    expiresAt: z.string().datetime(),
  }).strict()).use(organizationGuard).mutation(async ({ input, ctx }) => {
    await requireInstalledTaskManager(ctx.wiring, input.organizationId);

    const task = await ctx.wiring.taskManager.get(input.organizationId, input.taskId);
    if (!task) throw new TRPCError({ code: "NOT_FOUND", message: "Task not found" });
    const requiredSkillId = task.requiredSkillId;
    if (!requiredSkillId) {
      // Not a failure of routing — routing has nothing to answer. A Task
      // that names no required Skill is Human work by construction.
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "This Task names no required Skill, so there is nothing to route on — it is Human work until one is set",
      });
    }

    const skills = ctx.wiring.skillManifests.forSkill(input.organizationId, requiredSkillId);
    const candidates = await Promise.all(TASK_ROUTING_CANDIDATE_AGENTS.map(async (id) => ({
      id,
      active: (await ctx.wiring.agents.organizationId(id)) === input.organizationId
        && await ctx.wiring.agents.isActive(id),
      allowedSkills: await ctx.wiring.agents.allowedSkills(id),
      capabilityScope: await ctx.wiring.agents.capabilityScope(id),
      plane: "local" as const,
      dataScope: await ctx.wiring.agents.dataScope(id),
    })));

    // ONE id for the Chief of Staff Run's governed proposal and the
    // queue-side `route` row, the pairing ADR-199 established.
    const proposalId = idempotentUuid(
      `${input.organizationId}:agent_task_routing:${input.taskId}:${input.idempotencyKey}`,
    );
    const runId = idempotentUuid(
      `${input.organizationId}:agent_task_routing_run:${input.taskId}:${input.idempotencyKey}`,
    );
    const { proposal: governed } = await runTaskManagerAgentAutomation(ctx, {
      organizationId: input.organizationId,
      automationId: TASK_MANAGER_ROUTING_AUTOMATION_ID,
      name: "Task Manager agent-task routing on assign",
      agentId: CHIEF_OF_STAFF_AGENT,
      skill: "task-manager.agent-task-routing",
      action: "read",
      params: {
        requiredSkillId,
        agents: candidates,
        skills: skills.map((manifest) => ({
          skillId: manifest.skillId,
          permissions: manifest.permissions,
          plane: manifest.plane,
          dataScopes: manifest.dataScopes,
        })),
      },
      runId,
      proposalId,
      taintKey: `task-manager:agent-task-routing:${ctx.identity.id}:${runId}`,
    });

    const output = (governed.output?.proposedOutput ?? {}) as Record<string, unknown>;
    const routing = output["routing"] as
      | { kind: "assigned"; agentId: string }
      | { kind: "human_assignment_required"; reason: string; candidates: string[] }
      | undefined;
    if (!routing) {
      throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Routing Run produced no routing result" });
    }
    if (routing.kind !== "assigned") {
      return {
        runId,
        proposal: governed,
        routing,
        gate: null,
        routeProposal: null,
        assigned: null,
      };
    }

    // `routeTaskByRequiredSkill` returns `assigned` only when EXACTLY one
    // Agent was eligible, so the candidate count the band is classified on
    // is 1 by construction rather than by assertion.
    const crossesModule = !requiredSkillId.startsWith("task-manager.");
    const gate = await runTaskChangeGate(ctx, {
      organizationId: input.organizationId,
      kind: "route",
      candidateCount: 1,
      crossesModule,
      idempotencyKey: `assign:${input.taskId}:${input.idempotencyKey}`,
    });

    const staged = await ctx.wiring.taskManager.stageProposal({
      id: proposalId,
      organizationId: input.organizationId,
      kind: "route",
      taskId: task.id,
      actorId: CHIEF_OF_STAFF_AGENT,
      payload: {
        agentId: routing.agentId,
        requiredSkillId,
        // What the assignment was computed against. `applyApprovedRoutingProposal`
        // refuses if the Task moved on while the proposal sat in review.
        expectedVersion: task.version,
        crossesModule,
        band: gate.band ?? null,
        gateDecision: gate.decision ?? null,
        gateRunId: gate.runId,
        runId,
      },
      idempotencyKey: `agent-task-routing:${input.idempotencyKey}`,
      expiresAt: input.expiresAt,
    }, { nextId: () => ctx.run.ids.next(), nowISO: () => ctx.run.clock.nowISO() });

    if (gate.decision !== "auto_apply") {
      return { runId, proposal: governed, routing, gate, routeProposal: staged, assigned: null };
    }

    // The calibrated branch, honoured rather than merely computed. It runs
    // the SAME two steps `taskManager.decideProposal` runs for a clicked
    // approval — the pipeline decision then the queue write — because an
    // auto-applied assignment that skipped either would be a write with no
    // ledger row or a ledger row with no write. What calibration removes is
    // the Human's second click, not the record of the decision, and the
    // payload says so: `calibrated` marks it as standing consent this
    // Human earned, not a decision they made in the moment.
    await ctx.wiring.pipeline.decide(proposalId, "approve", ctx.identity, ctx.run);
    const decisionEntry = await ctx.wiring.ledger.decisionFor(proposalId);
    const decided = await ctx.wiring.taskManager.decideProposal(
      input.organizationId,
      proposalId,
      "approve",
      ctx.identity.id,
      { nextId: () => ctx.run.ids.next(), nowISO: () => ctx.run.clock.nowISO() },
      {
        ...staged.payload,
        calibrated: true,
        calibration: gate.calibration,
        ...(decisionEntry ? { decisionLedgerId: decisionEntry.id } : {}),
      },
    );
    return { runId, proposal: governed, routing, gate, routeProposal: decided.proposal, assigned: decided.result ?? null };
  }),
  route: authenticatedProcedure.input(z.object({
    organizationId: z.string().uuid(),
    requiredSkillId: z.string().trim().min(1),
    candidateAgentIds: z.array(z.string().uuid()).min(1),
  })).use(organizationGuard).query(async ({ input, ctx }) => {
    const manifests = ctx.wiring.skillManifests.forSkill(input.organizationId, input.requiredSkillId);
    const agents = await Promise.all(input.candidateAgentIds.map(async (id) => ({
      id,
      active: (await ctx.wiring.agents.organizationId(id)) === input.organizationId && await ctx.wiring.agents.isActive(id),
      allowedSkills: await ctx.wiring.agents.allowedSkills(id),
      capabilityScope: await ctx.wiring.agents.capabilityScope(id),
      plane: "local" as const,
      dataScope: await ctx.wiring.agents.dataScope(id),
    })));
    return routeTaskByRequiredSkill(input.requiredSkillId, agents, manifests.map((manifest) => ({
      skillId: manifest.skillId,
      permissions: manifest.permissions,
      plane: manifest.plane,
      dataScopes: manifest.dataScopes,
    })));
  }),
});
