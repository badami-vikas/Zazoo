import { and, eq } from "drizzle-orm";
import {
  applyApprovedTaskProjectionReconciliation,
  applyApprovedPlanningProposal,
  applyApprovedRoutingProposal,
  applyTaskRestructure,
  assertNoDependencyCycle,
  canonicalizeJson,
  draftTaskCreate,
  emitTasksMarkdown,
  taskProjectionContentHash,
  withAppendedOutcome,
  withOutcomeTarget,
  withTaskStatus,
  type CreateTaskRecordInput,
  type RestructureOperation,
  type TaskChangeProposal,
  type TaskCreateDraft,
  type TaskDependency,
  type TaskManagerIdClock,
  type TaskManagerStore,
  type TaskOutcome,
  type TaskRecord,
  type TaskRecordStatus,
  type TaskVerification,
} from "@bridge/core";
import type { Database } from "./client.js";
import { events, taskChangeProposals, taskDependencies, tasks } from "./schema.js";
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
    ...(row.idempotencyKey ? { idempotencyKey: row.idempotencyKey } : {}),
    ...(row.expiresAt ? { expiresAt: row.expiresAt.toISOString() } : {}),
    ...(row.result ? { result: row.result as Readonly<Record<string, unknown>> } : {}),
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

  // ADR-204 — dependency Relations. Read whole rather than per Task: the
  // sequencer, the blockage report and the unblock notifier all need the
  // graph, and fetching it edge by edge would have each ask a different
  // question of the same data.
  async listDependencies(organizationId: string): Promise<TaskDependency[]> {
    return this.scoped(organizationId, async (tx) => {
      const rows = await tx.select().from(taskDependencies)
        .where(eq(taskDependencies.organizationId, organizationId));
      return rows.map((row) => ({
        id: row.id,
        organizationId: row.organizationId,
        taskId: row.taskId,
        dependsOnTaskId: row.dependsOnTaskId,
        ...(row.reason ? { reason: row.reason } : {}),
        createdAt: row.createdAt.toISOString(),
      }));
    });
  }

  async addDependency(
    input: { organizationId: string; taskId: string; dependsOnTaskId: string; reason?: string },
    seam: TaskManagerIdClock,
  ): Promise<TaskDependency> {
    return this.scoped(input.organizationId, async (tx) => {
      const rows = await tx.select().from(taskDependencies)
        .where(eq(taskDependencies.organizationId, input.organizationId))
        // Locked for the cycle check: the graph this validates against has to
        // be the graph being written to, or two concurrent edges could each
        // look acyclic alone and close a loop together.
        .for("update");
      const existing: TaskDependency[] = rows.map((row) => ({
        id: row.id,
        organizationId: row.organizationId,
        taskId: row.taskId,
        dependsOnTaskId: row.dependsOnTaskId,
        ...(row.reason ? { reason: row.reason } : {}),
        createdAt: row.createdAt.toISOString(),
      }));
      const duplicate = existing.find(
        (edge) => edge.taskId === input.taskId && edge.dependsOnTaskId === input.dependsOnTaskId,
      );
      if (duplicate) return duplicate;
      // The SAME core function the in-memory store calls, so the two
      // durability backends cannot disagree about what a cycle is.
      assertNoDependencyCycle(existing, input);
      const [row] = await tx.insert(taskDependencies).values({
        id: seam.nextId(),
        organizationId: input.organizationId,
        taskId: input.taskId,
        dependsOnTaskId: input.dependsOnTaskId,
        reason: input.reason ?? null,
        createdAt: new Date(seam.nowISO()),
      }).returning();
      if (!row) throw new Error("task-manager: dependency insert returned no row");
      return {
        id: row.id,
        organizationId: row.organizationId,
        taskId: row.taskId,
        dependsOnTaskId: row.dependsOnTaskId,
        ...(row.reason ? { reason: row.reason } : {}),
        createdAt: row.createdAt.toISOString(),
      };
    });
  }

  async removeDependency(organizationId: string, dependencyId: string): Promise<boolean> {
    return this.scoped(organizationId, async (tx) => {
      const removed = await tx.delete(taskDependencies).where(and(
        eq(taskDependencies.organizationId, organizationId),
        eq(taskDependencies.id, dependencyId),
      )).returning();
      return removed.length > 0;
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

  async appendOutcome(
    organizationId: string,
    taskId: string,
    outcome: TaskOutcome,
    seam: TaskManagerIdClock,
  ): Promise<TaskRecord> {
    return this.scoped(organizationId, async (tx) => {
      const [row] = await tx.select().from(tasks)
        .where(and(eq(tasks.organizationId, organizationId), eq(tasks.id, taskId)))
        .limit(1);
      if (!row) throw new Error(`task-manager: unknown Task ${taskId}`);
      const current = unpack(row);
      const updated = withAppendedOutcome(current, outcome, seam.nowISO());
      if (updated === current) return current;
      const [saved] = await tx.update(tasks).set({
        outcomes: [...updated.outcomes],
        version: updated.version,
        updatedAt: new Date(updated.updatedAt),
      }).where(and(
        eq(tasks.organizationId, organizationId),
        eq(tasks.id, taskId),
        eq(tasks.version, current.version),
      )).returning();
      if (!saved) throw new Error(`task-manager: Task ${taskId} changed during Outcome append`);
      return unpack(saved);
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

  async getProposal(organizationId: string, proposalId: string): Promise<TaskChangeProposal | null> {
    return this.scoped(organizationId, async (tx) => {
      const [row] = await tx.select().from(taskChangeProposals)
        .where(and(
          eq(taskChangeProposals.organizationId, organizationId),
          eq(taskChangeProposals.id, proposalId),
        ))
        .limit(1);
      return row ? proposal(row) : null;
    });
  }

  async stageProposal(
    input: {
      id: string;
      organizationId: string;
      /** `candidate` carries an approved planning Playbook or scan draft —
       * materialized by `applyApprovedPlanningProposal` (ADR-199).
       * `route` carries an eligible-Agent assignment the ADR-202 gate would
       * not let apply unattended — materialized by
       * `applyApprovedRoutingProposal` (ADR-207). */
      kind: "projection_reconcile" | "archive_sweep" | "candidate" | "route";
      taskId: string;
      actorId: string;
      payload: Readonly<Record<string, unknown>>;
      idempotencyKey: string;
      expiresAt: string;
    },
    seam: TaskManagerIdClock,
  ): Promise<TaskChangeProposal> {
    return this.scoped(input.organizationId, async (tx) => {
      const [existingRow] = await tx.select().from(taskChangeProposals)
        .where(and(
          eq(taskChangeProposals.organizationId, input.organizationId),
          eq(taskChangeProposals.kind, input.kind),
          eq(taskChangeProposals.idempotencyKey, input.idempotencyKey),
        ))
        .limit(1);
      if (existingRow) {
        if (canonicalizeJson(existingRow.payload) !== canonicalizeJson(input.payload)) {
          throw new Error("task-manager: idempotency key conflicts with different proposal content");
        }
        return proposal(existingRow);
      }
      const [inserted] = await tx.insert(taskChangeProposals).values({
        id: input.id,
        organizationId: input.organizationId,
        kind: input.kind,
        taskId: input.taskId,
        actorId: input.actorId,
        payload: input.payload,
        status: "pending_review",
        idempotencyKey: input.idempotencyKey,
        expiresAt: new Date(input.expiresAt),
        createdAt: new Date(seam.nowISO()),
      }).onConflictDoNothing().returning();
      if (inserted) return proposal(inserted);
      const [raced] = await tx.select().from(taskChangeProposals)
        .where(and(
          eq(taskChangeProposals.organizationId, input.organizationId),
          eq(taskChangeProposals.kind, input.kind),
          eq(taskChangeProposals.idempotencyKey, input.idempotencyKey),
        ))
        .limit(1);
      if (!raced || canonicalizeJson(raced.payload) !== canonicalizeJson(input.payload)) {
        throw new Error("task-manager: concurrent idempotency conflict");
      }
      return proposal(raced);
    });
  }

  async decideProposal(
    organizationId: string,
    proposalId: string,
    decision: "approve" | "edit" | "veto",
    deciderId: string,
    seam: TaskManagerIdClock,
    editedPayload?: Readonly<Record<string, unknown>>,
  ): Promise<{ proposal: TaskChangeProposal; tasks: TaskRecord[]; result?: Readonly<Record<string, unknown>> }> {
    return this.scoped(organizationId, async (tx) => {
      const [row] = await tx.select().from(taskChangeProposals)
        .where(and(eq(taskChangeProposals.organizationId, organizationId), eq(taskChangeProposals.id, proposalId)))
        .for("update")
        .limit(1);
      if (!row) throw new Error(`task-manager: unknown proposal ${proposalId}`);
      if (row.status !== "pending_review") {
        const existing = proposal(row);
        const currentTasks = (await tx.select().from(tasks)
          .where(eq(tasks.organizationId, organizationId))).map(unpack).sort(comparePaths);
        return {
          proposal: existing,
          tasks: currentTasks,
          ...(existing.result ? { result: existing.result } : {}),
        };
      }
      if (row.expiresAt && row.expiresAt.getTime() <= Date.parse(seam.nowISO())) {
        throw new Error(`task-manager: proposal ${proposalId} expired`);
      }
      if (row.actorId === deciderId) throw new Error("task-manager: proposal author cannot approve its own change");
      const lockedRows = await tx.select().from(tasks)
        .where(eq(tasks.organizationId, organizationId))
        .for("update");
      const current = lockedRows.map(unpack).sort(comparePaths);
      let updated = current;
      const effectivePayload = editedPayload ?? row.payload as Readonly<Record<string, unknown>>;
      let result: Readonly<Record<string, unknown>> | undefined;
      if (decision !== "veto") {
        const operation = (effectivePayload as { operation?: RestructureOperation }).operation;
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
        } else if (row.kind === "projection_reconcile") {
          const externalContent = effectivePayload["externalContent"];
          const externalContentHash = effectivePayload["externalContentHash"];
          const beforeProjectionHash = effectivePayload["beforeProjectionHash"];
          const recordVersions = effectivePayload["recordVersions"];
          if (
            typeof externalContent !== "string" ||
            typeof externalContentHash !== "string" ||
            typeof beforeProjectionHash !== "string" ||
            typeof recordVersions !== "object" ||
            recordVersions === null
          ) {
            throw new Error("task-manager: projection proposal payload is invalid");
          }
          if (taskProjectionContentHash(externalContent) !== externalContentHash) {
            throw new Error("task-manager: projection proposal content hash changed");
          }
          const currentProjection = emitTasksMarkdown(current);
          if (currentProjection.contentHash !== beforeProjectionHash) {
            throw new Error("task-manager: projection proposal is stale against the current Database");
          }
          const expectedVersions = recordVersions as Record<string, number>;
          for (const task of current) {
            if (expectedVersions[task.id] !== task.version) {
              throw new Error(`task-manager: projection proposal is stale for Task ${task.id}`);
            }
          }
          updated = applyApprovedTaskProjectionReconciliation(current, externalContent, seam.nowISO());
          const currentById = new Map(current.map((task) => [task.id, task]));
          for (const task of updated) {
            const before = currentById.get(task.id)!;
            if (before.version === task.version) continue;
            const [saved] = await tx.update(tasks).set({
              ...values(task),
              anchorTaskId: resolvedAnchorId(task, updated),
              parentTaskId: task.parentTaskId ?? null,
            }).where(and(
              eq(tasks.organizationId, organizationId),
              eq(tasks.id, task.id),
              eq(tasks.version, before.version),
            )).returning();
            if (!saved) throw new Error(`task-manager: Task ${task.id} changed during projection reconcile`);
          }
          result = {
            projection: emitTasksMarkdown(updated),
            beforeProjectionHash,
            externalContentHash,
            decision,
          };
        } else if (row.kind === "archive_sweep") {
          const taskIds = effectivePayload["taskIds"];
          const recordVersions = effectivePayload["recordVersions"];
          if (!Array.isArray(taskIds) || typeof recordVersions !== "object" || recordVersions === null) {
            throw new Error("task-manager: archive sweep proposal payload is invalid");
          }
          const expectedVersions = recordVersions as Record<string, number>;
          const archivedTaskIds: string[] = [];
          for (const taskId of taskIds) {
            if (typeof taskId !== "string") throw new Error("task-manager: archive sweep Task id is invalid");
            const target = updated.find((task) => task.id === taskId);
            if (!target || target.status !== "done" || expectedVersions[taskId] !== target.version) {
              throw new Error(`task-manager: archive sweep proposal is stale for Task ${taskId}`);
            }
            const archived = withTaskStatus(target, "archived", seam.nowISO());
            const [saved] = await tx.update(tasks).set({
              status: archived.status,
              version: archived.version,
              updatedAt: new Date(archived.updatedAt),
            }).where(and(
              eq(tasks.organizationId, organizationId),
              eq(tasks.id, taskId),
              eq(tasks.version, target.version),
              eq(tasks.status, "done"),
            )).returning();
            if (!saved) throw new Error(`task-manager: Task ${taskId} changed during completed-bay sweep`);
            updated = updated.map((task) => task.id === taskId ? archived : task);
            archivedTaskIds.push(taskId);
          }
          result = { archivedTaskIds, decision };
        } else if (row.kind === "candidate") {
          // The third step of draft-then-approve (ADR-199), computed by the
          // SAME core function the in-memory store calls so the two
          // durability backends cannot materialize an approved plan
          // differently. The rows are already locked `for update` above, so
          // the read this plans against is the one being written.
          const materialized = applyApprovedPlanningProposal({
            tasks: updated,
            payload: effectivePayload,
            taskId: row.taskId,
            organizationId,
            // The APPROVER owns generated Tasks, never the drafting Agent.
            ownerId: deciderId,
            now: seam.nowISO(),
            nextId: () => seam.nextId(),
          });
          const beforeById = new Map(updated.map((task) => [task.id, task]));
          for (const task of materialized.tasks) {
            const before = beforeById.get(task.id);
            if (!before) {
              await tx.insert(tasks).values({
                ...values(task),
                anchorTaskId: resolvedAnchorId(task, [...materialized.tasks]),
              });
              continue;
            }
            if (before.version === task.version) continue;
            const [saved] = await tx.update(tasks).set({
              ...values(task),
              anchorTaskId: resolvedAnchorId(task, [...materialized.tasks]),
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
            if (!saved) throw new Error(`task-manager: Task ${task.id} changed while a planning proposal was approved`);
          }
          updated = [...materialized.tasks].sort(comparePaths);
          result = {
            createdTaskIds: materialized.createdTaskIds,
            updatedTaskIds: materialized.updatedTaskIds,
            note: materialized.note,
            decision,
          };
        } else if (row.kind === "route") {
          // ADR-207 — the same one core function the in-memory store calls,
          // for the same anti-drift reason. Its version check and the
          // optimistic `eq(tasks.version, before.version)` below are two
          // different guards: the first refuses a decision made against a
          // Task that changed before the Human decided, the second refuses a
          // write against a Task that changed while they were deciding.
          const routed = applyApprovedRoutingProposal({
            tasks: updated,
            payload: effectivePayload,
            taskId: row.taskId,
            now: seam.nowISO(),
          });
          const before = updated.find((task) => task.id === routed.assignedTaskId)!;
          const assigned = routed.tasks.find((task) => task.id === routed.assignedTaskId)!;
          if (assigned.version !== before.version) {
            const [saved] = await tx.update(tasks).set({
              assignedAgentId: assigned.assignedAgentId ?? null,
              version: assigned.version,
              updatedAt: new Date(assigned.updatedAt),
            }).where(and(
              eq(tasks.organizationId, organizationId),
              eq(tasks.id, assigned.id),
              eq(tasks.version, before.version),
            )).returning();
            if (!saved) throw new Error(`task-manager: Task ${assigned.id} changed while a routing proposal was approved`);
          }
          updated = [...routed.tasks].sort(comparePaths);
          result = {
            assignedTaskId: routed.assignedTaskId,
            agentId: routed.agentId,
            note: routed.note,
            decision,
          };
        } else if (row.kind === "impact_fit" || row.kind === "reopen") {
          const proposedStatus = (effectivePayload as { proposedStatus?: TaskRecordStatus }).proposedStatus;
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
      const resolvedStatus = decision === "veto" ? "vetoed" : "approved";
      const [event] = await tx.insert(events).values({
        organizationId,
        type: `task.${row.kind}.${resolvedStatus}`,
        entityType: "task",
        entityId: row.taskId,
        payload: {
          proposalId,
          decision,
          deciderId,
          operation: (effectivePayload as { operation?: unknown }).operation ?? null,
          result: result ?? null,
        },
        createdAt: new Date(seam.nowISO()),
      }).returning();
      if (!event) throw new Error("task-manager: Event insert returned no row");
      const decisionLedgerId = effectivePayload["decisionLedgerId"];
      if (result) {
        result = {
          ...result,
          eventId: event.id,
          ...(typeof decisionLedgerId === "string" ? { resultId: decisionLedgerId } : {}),
        };
      }
      const [resolvedRow] = await tx.update(taskChangeProposals).set({
        payload: effectivePayload,
        status: resolvedStatus,
        decidedBy: deciderId,
        decidedAt: new Date(seam.nowISO()),
        ...(result ? { result, appliedAt: new Date(seam.nowISO()) } : {}),
      }).where(and(
        eq(taskChangeProposals.organizationId, organizationId),
        eq(taskChangeProposals.id, proposalId),
        eq(taskChangeProposals.status, "pending_review"),
      )).returning();
      if (!resolvedRow) throw new Error(`task-manager: proposal ${proposalId} lost a concurrent decision race`);
      const resolved = proposal(resolvedRow);
      return { proposal: resolved, tasks: updated, ...(result ? { result } : {}) };
    });
  }
}
