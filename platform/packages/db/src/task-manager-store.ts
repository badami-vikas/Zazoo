import { and, eq } from "drizzle-orm";
import {
  applyTaskRestructure,
  draftTaskCreate,
  withOutcomeTarget,
  withTaskStatus,
  type CreateTaskRecordInput,
  type RestructureOperation,
  type TaskChangeProposal,
  type TaskCreateDraft,
  type TaskManagerIdClock,
  type TaskManagerStore,
  type TaskOutcome,
  type TaskRecord,
  type TaskRecordStatus,
  type TaskVerification,
} from "@bridge/core";
import type { Database } from "./client.js";
import { events, taskChangeProposals, tasks } from "./schema.js";
import { withOrganizationContext, withOrganizationOnly } from "./organization-context.js";

function parseArray<T>(value: unknown, column: string): T[] {
  if (!Array.isArray(value)) throw new Error(`tasks.${column} must be a JSON array`);
  return value as T[];
}

function unpack(row: typeof tasks.$inferSelect): TaskRecord {
  return {
    id: row.id,
    organizationId: row.organizationId,
    path: row.path,
    level: row.level,
    sortOrder: row.sortOrder,
    title: row.title,
    taskType: row.type,
    isGoal: row.isGoal,
    outcomes: parseArray<TaskOutcome>(row.outcomes, "outcomes"),
    anchor: row.anchor,
    ...(row.reviewCadence ? { reviewCadence: row.reviewCadence } : {}),
    ...(row.lastReviewedAt ? { lastReviewedAt: row.lastReviewedAt.toISOString() } : {}),
    ...(row.exitTest ? { exitTest: row.exitTest } : {}),
    status: row.status as TaskRecordStatus,
    priority: row.priority,
    ownerType: row.ownerType as TaskRecord["ownerType"],
    ownerId: row.ownerId ?? "",
    ...(row.assignedAgentId ? { assignedAgentId: row.assignedAgentId } : {}),
    ...(row.requiredSkillId ? { requiredSkillId: row.requiredSkillId } : {}),
    ...(row.parentTaskId ? { parentTaskId: row.parentTaskId } : {}),
    ...(row.scheduledFor ? { scheduledFor: row.scheduledFor } : {}),
    evidenceRefs: parseArray<string>(row.evidenceRefs, "evidence_refs"),
    ...(row.verification ? { verification: row.verification as TaskVerification } : {}),
    visibility: row.visibility as TaskRecord["visibility"],
    version: row.version,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function proposal(row: typeof taskChangeProposals.$inferSelect): TaskChangeProposal {
  return {
    id: row.id,
    organizationId: row.organizationId,
    kind: row.kind as TaskChangeProposal["kind"],
    taskId: row.taskId,
    actorId: row.actorId,
    payload: row.payload as Readonly<Record<string, unknown>>,
    status: row.status as TaskChangeProposal["status"],
    createdAt: row.createdAt.toISOString(),
  };
}

function values(task: TaskRecord): typeof tasks.$inferInsert {
  return {
    id: task.id,
    organizationId: task.organizationId,
    anchorTaskId: task.isGoal ? task.id : undefined,
    parentTaskId: task.parentTaskId,
    path: task.path,
    level: task.level,
    sortOrder: task.sortOrder,
    title: task.title,
    type: task.taskType,
    isGoal: task.isGoal,
    outcomes: [...task.outcomes],
    anchor: task.anchor,
    reviewCadence: task.reviewCadence,
    lastReviewedAt: task.lastReviewedAt ? new Date(task.lastReviewedAt) : undefined,
    exitTest: task.exitTest,
    priority: task.priority,
    ownerType: task.ownerType,
    ownerId: task.ownerId || undefined,
    requiredSkillId: task.requiredSkillId,
    scheduledFor: task.scheduledFor,
    evidenceRefs: [...task.evidenceRefs],
    verification: task.verification,
    visibility: task.visibility,
    version: task.version,
    assignedAgentId: task.assignedAgentId,
    status: task.status,
    updatedAt: new Date(task.updatedAt),
    createdAt: new Date(task.createdAt),
  };
}

function comparePaths(left: TaskRecord, right: TaskRecord): number {
  const leftParts = left.path.split(".").map(Number);
  const rightParts = right.path.split(".").map(Number);
  for (let index = 0; index < Math.max(leftParts.length, rightParts.length); index += 1) {
    const difference = (leftParts[index] ?? -1) - (rightParts[index] ?? -1);
    if (difference !== 0) return difference;
  }
  return left.id.localeCompare(right.id);
}

function resolvedAnchorId(task: TaskRecord, all: readonly TaskRecord[]): string | null {
  if (task.isGoal) return task.id;
  let cursor = task.parentTaskId ? all.find((candidate) => candidate.id === task.parentTaskId) : undefined;
  const visited = new Set<string>();
  while (cursor && !visited.has(cursor.id)) {
    if (cursor.isGoal) return cursor.id;
    visited.add(cursor.id);
    cursor = cursor.parentTaskId ? all.find((candidate) => candidate.id === cursor!.parentTaskId) : undefined;
  }
  return null;
}

export class DrizzleTaskManagerStore implements TaskManagerStore {
  constructor(
    private readonly db: Database,
    private readonly userId?: string,
  ) {}

  private scoped<T>(organizationId: string, operation: (tx: Database) => Promise<T>): Promise<T> {
    return this.userId
      ? withOrganizationContext(this.db, { organizationId, userId: this.userId }, operation)
      : withOrganizationOnly(this.db, organizationId, operation);
  }

  async list(organizationId: string): Promise<TaskRecord[]> {
    return this.scoped(organizationId, async (tx) => {
      const rows = await tx.select().from(tasks)
        .where(eq(tasks.organizationId, organizationId));
      return rows.map(unpack).sort(comparePaths);
    });
  }

  async get(organizationId: string, taskId: string): Promise<TaskRecord | null> {
    return this.scoped(organizationId, async (tx) => {
      const [row] = await tx.select().from(tasks)
        .where(and(eq(tasks.organizationId, organizationId), eq(tasks.id, taskId)))
        .limit(1);
      return row ? unpack(row) : null;
    });
  }

  async create(
    input: Omit<CreateTaskRecordInput, "id"> & { id?: string },
    seam: TaskManagerIdClock,
  ): Promise<TaskCreateDraft> {
    return this.scoped(input.organizationId, async (tx) => {
      const queue = (await tx.select().from(tasks)
        .where(eq(tasks.organizationId, input.organizationId))).map(unpack).sort(comparePaths);
      const drafted = draftTaskCreate(
        { ...input, id: input.id ?? seam.nextId() },
        queue,
        seam.nowISO(),
        seam.nextId(),
      );
      await tx.insert(tasks).values({
        ...values(drafted.task),
        anchorTaskId: resolvedAnchorId(drafted.task, [...queue, drafted.task]),
      });
      if (drafted.impactFitProposal) {
        await tx.insert(taskChangeProposals).values({
          id: drafted.impactFitProposal.id,
          organizationId: input.organizationId,
          kind: drafted.impactFitProposal.kind,
          taskId: drafted.task.id,
          actorId: drafted.impactFitProposal.actorId,
          payload: drafted.impactFitProposal.payload,
          status: drafted.impactFitProposal.status,
          createdAt: new Date(drafted.impactFitProposal.createdAt),
        });
      }
      return drafted;
    });
  }

  async transition(
    organizationId: string,
    taskId: string,
    status: TaskRecordStatus,
    seam: TaskManagerIdClock,
  ): Promise<TaskRecord> {
    return this.scoped(organizationId, async (tx) => {
      const [row] = await tx.select().from(tasks)
        .where(and(eq(tasks.organizationId, organizationId), eq(tasks.id, taskId)))
        .limit(1);
      if (!row) throw new Error(`task-manager: unknown Task ${taskId}`);
      const updated = withTaskStatus(unpack(row), status, seam.nowISO());
      const [saved] = await tx.update(tasks).set({
        status: updated.status,
        version: updated.version,
        updatedAt: new Date(updated.updatedAt),
      }).where(and(eq(tasks.organizationId, organizationId), eq(tasks.id, taskId))).returning();
      if (!saved) throw new Error(`task-manager: Task ${taskId} disappeared during transition`);
      return unpack(saved);
    });
  }

  async verify(
    organizationId: string,
    taskId: string,
    verification: TaskVerification,
    seam: TaskManagerIdClock,
  ): Promise<TaskRecord> {
    if (verification.evidenceRefs.length === 0) throw new Error("task-manager: verification needs evidence");
    return this.scoped(organizationId, async (tx) => {
      const [row] = await tx.select().from(tasks)
        .where(and(eq(tasks.organizationId, organizationId), eq(tasks.id, taskId)))
        .limit(1);
      if (!row) throw new Error(`task-manager: unknown Task ${taskId}`);
      const current = unpack(row);
      const [saved] = await tx.update(tasks).set({
        verification,
        evidenceRefs: [...new Set([...current.evidenceRefs, ...verification.evidenceRefs])],
        version: current.version + 1,
        updatedAt: new Date(seam.nowISO()),
      }).where(and(eq(tasks.organizationId, organizationId), eq(tasks.id, taskId))).returning();
      if (!saved) throw new Error(`task-manager: Task ${taskId} disappeared during verification`);
      return unpack(saved);
    });
  }

  async updateOutcomeTarget(
    organizationId: string,
    taskId: string,
    outcomeId: string,
    target: string,
    seam: TaskManagerIdClock,
  ): Promise<{ task: TaskRecord; reopenProposal?: TaskChangeProposal }> {
    return this.scoped(organizationId, async (tx) => {
      const [row] = await tx.select().from(tasks)
        .where(and(eq(tasks.organizationId, organizationId), eq(tasks.id, taskId)))
        .limit(1);
      if (!row) throw new Error(`task-manager: unknown Task ${taskId}`);
      const result = withOutcomeTarget(unpack(row), outcomeId, target, seam.nowISO());
      const [saved] = await tx.update(tasks).set({
        outcomes: [...result.task.outcomes],
        version: result.task.version,
        updatedAt: new Date(result.task.updatedAt),
      }).where(and(eq(tasks.organizationId, organizationId), eq(tasks.id, taskId))).returning();
      if (!saved) throw new Error(`task-manager: Task ${taskId} disappeared during outcome update`);
      if (result.reopenProposal) {
        const reopenProposal = { ...result.reopenProposal, id: seam.nextId() };
        await tx.insert(taskChangeProposals).values({
          id: reopenProposal.id,
          organizationId,
          kind: reopenProposal.kind,
          taskId,
          actorId: reopenProposal.actorId,
          payload: reopenProposal.payload,
          status: reopenProposal.status,
          createdAt: new Date(reopenProposal.createdAt),
        });
        return { task: unpack(saved), reopenProposal };
      }
      return { task: unpack(saved) };
    });
  }

  async proposeRestructure(
    organizationId: string,
    operation: RestructureOperation,
    actorId: string,
    seam: TaskManagerIdClock,
  ): Promise<TaskChangeProposal> {
    return this.scoped(organizationId, async (tx) => {
      const [target] = await tx.select({ id: tasks.id }).from(tasks)
        .where(and(eq(tasks.organizationId, organizationId), eq(tasks.id, operation.taskId)))
        .limit(1);
      if (!target) throw new Error(`task-manager: unknown Task ${operation.taskId}`);
      const row = {
        id: seam.nextId(),
        organizationId,
        kind: operation.kind,
        taskId: operation.taskId,
        actorId,
        payload: { operation },
        status: "pending_review",
        createdAt: new Date(seam.nowISO()),
      };
      const [inserted] = await tx.insert(taskChangeProposals).values(row).returning();
      if (!inserted) throw new Error("task-manager: proposal insert returned no row");
      return proposal(inserted);
    });
  }

  async decideProposal(
    organizationId: string,
    proposalId: string,
    decision: "approve" | "veto",
    deciderId: string,
    seam: TaskManagerIdClock,
  ): Promise<{ proposal: TaskChangeProposal; tasks: TaskRecord[] }> {
    return this.scoped(organizationId, async (tx) => {
      const [row] = await tx.select().from(taskChangeProposals)
        .where(and(eq(taskChangeProposals.organizationId, organizationId), eq(taskChangeProposals.id, proposalId)))
        .limit(1);
      if (!row) throw new Error(`task-manager: unknown proposal ${proposalId}`);
      if (row.status !== "pending_review") throw new Error(`task-manager: proposal ${proposalId} already resolved`);
      if (row.actorId === deciderId) throw new Error("task-manager: proposal author cannot approve its own change");
      const resolvedStatus = decision === "approve" ? "approved" : "vetoed";
      const [resolvedRow] = await tx.update(taskChangeProposals).set({
        status: resolvedStatus,
        decidedBy: deciderId,
        decidedAt: new Date(seam.nowISO()),
      }).where(and(
        eq(taskChangeProposals.organizationId, organizationId),
        eq(taskChangeProposals.id, proposalId),
        eq(taskChangeProposals.status, "pending_review"),
      )).returning();
      if (!resolvedRow) throw new Error(`task-manager: proposal ${proposalId} lost a concurrent decision race`);
      const resolved = proposal(resolvedRow);
      const lockedRows = await tx.select().from(tasks)
        .where(eq(tasks.organizationId, organizationId))
        .for("update");
      const current = lockedRows.map(unpack).sort(comparePaths);
      let updated = current;
      if (decision === "approve") {
        const operation = (row.payload as { operation?: RestructureOperation }).operation;
        if (operation) {
          updated = applyTaskRestructure(updated, operation, seam.nowISO());
          const currentById = new Map(current.map((task) => [task.id, task]));
          for (const task of updated) {
            const before = currentById.get(task.id);
            if (!before) {
              await tx.insert(tasks).values({
                ...values(task),
                anchorTaskId: resolvedAnchorId(task, updated),
              });
              continue;
            }
            if (before.version === task.version) continue;
            const [saved] = await tx.update(tasks).set({
              ...values(task),
              anchorTaskId: resolvedAnchorId(task, updated),
              parentTaskId: task.parentTaskId ?? null,
              assignedAgentId: task.assignedAgentId ?? null,
              requiredSkillId: task.requiredSkillId ?? null,
              reviewCadence: task.reviewCadence ?? null,
              exitTest: task.exitTest ?? null,
              verification: task.verification ?? null,
            }).where(and(
              eq(tasks.organizationId, organizationId),
              eq(tasks.id, task.id),
              eq(tasks.version, before.version),
            )).returning();
            if (!saved) throw new Error(`task-manager: Task ${task.id} changed during restructure`);
          }
        } else if (row.kind === "impact_fit" || row.kind === "reopen") {
          const proposedStatus = (row.payload as { proposedStatus?: TaskRecordStatus }).proposedStatus;
          const target = updated.find((task) => task.id === row.taskId);
          if (proposedStatus && target) {
            const settled = withTaskStatus(target, proposedStatus, seam.nowISO());
            await tx.update(tasks).set({
              status: settled.status,
              version: settled.version,
              updatedAt: new Date(settled.updatedAt),
            }).where(and(eq(tasks.organizationId, organizationId), eq(tasks.id, target.id)));
            updated = updated.map((task) => task.id === target.id ? settled : task);
          }
        }
      }
      await tx.insert(events).values({
        organizationId,
        type: `task.${row.kind}.${resolvedStatus}`,
        entityType: "task",
        entityId: row.taskId,
        payload: {
          proposalId,
          decision,
          deciderId,
          operation: (row.payload as { operation?: unknown }).operation ?? null,
        },
        createdAt: new Date(seam.nowISO()),
      });
      return { proposal: resolved, tasks: updated };
    });
  }
}
