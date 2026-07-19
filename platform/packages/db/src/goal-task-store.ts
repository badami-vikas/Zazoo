/**
 * DrizzleGoalTaskStore — binds the core `GoalTaskStore` port (@bridge/core's
 * goal-task.ts) to `goals`/`tasks` (schema.ts's LAYER 8). Mirrors
 * DrizzleOrganizationDefinitionStore's shape: a single class, `#db` private
 * field, an `unpack` helper per table.
 *
 * TASK-007 closure requirement: the in-memory `InMemoryGoalTaskStore` stays
 * the dependency-free default (dev/test, mirrors every other in-memory port
 * in this codebase), but a restart must not lose live Goals/Tasks in
 * persistent mode — this binds the SAME `GoalTaskStore` port to real rows so
 * `apps/api`'s persistent wiring can swap it in without touching any caller
 * (router.ts, the Google integrations, the AGS1 pipeline gate).
 */
import { and, eq } from "drizzle-orm";
import type { CreateGoalInput, CreateTaskInput, Goal, GoalTaskIdClock, GoalTaskStore, Task, TaskStatus } from "@bridge/core";
import type { Database } from "./client.js";
import { goals, tasks } from "./schema.js";
import { withOrganizationOnly } from "./organization-context.js";

function unpackGoal(row: typeof goals.$inferSelect): Goal {
  return {
    id: row.id,
    organizationId: row.organizationId,
    type: row.type,
    title: row.title,
    createdAt: row.createdAt.toISOString(),
  };
}

function unpackTask(row: typeof tasks.$inferSelect): Task {
  return {
    id: row.id,
    organizationId: row.organizationId,
    goalId: row.goalId,
    type: row.type,
    assignedAgentId: row.assignedAgentId,
    status: row.status as TaskStatus,
    createdAt: row.createdAt.toISOString(),
  };
}

export class DrizzleGoalTaskStore implements GoalTaskStore {
  #db: Database;
  constructor(db: Database) {
    this.#db = db;
  }

  async createGoal(input: CreateGoalInput, seam: GoalTaskIdClock): Promise<Goal> {
    return withOrganizationOnly(this.#db, input.organizationId, async (tx) => {
    const [inserted] = await tx
      .insert(goals)
      .values({
        id: input.id ?? seam.nextId(),
        organizationId: input.organizationId,
        type: input.type,
        title: input.title,
      })
      .returning();
    if (!inserted) throw new Error("goals: insert returned no row");
    return unpackGoal(inserted);
    });
  }

  async getGoal(organizationId: string, id: string): Promise<Goal | null> {
    return withOrganizationOnly(this.#db, organizationId, async (tx) => {
    const rows = await tx
      .select()
      .from(goals)
      .where(and(eq(goals.organizationId, organizationId), eq(goals.id, id)))
      .limit(1);
    const row = rows[0];
    return row ? unpackGoal(row) : null;
    });
  }

  async listGoals(organizationId: string): Promise<Goal[]> {
    return withOrganizationOnly(this.#db, organizationId, async (tx) => {
      const rows = await tx.select().from(goals).where(eq(goals.organizationId, organizationId));
      return rows.map(unpackGoal);
    });
  }

  async createTask(input: CreateTaskInput, seam: GoalTaskIdClock): Promise<Task> {
    return withOrganizationOnly(this.#db, input.organizationId, async (tx) => {
    const [inserted] = await tx
      .insert(tasks)
      .values({
        id: input.id ?? seam.nextId(),
        organizationId: input.organizationId,
        goalId: input.goalId,
        type: input.type,
        assignedAgentId: input.assignedAgentId,
        status: input.status ?? "open",
      })
      .returning();
    if (!inserted) throw new Error("tasks: insert returned no row");
    return unpackTask(inserted);
    });
  }

  async getTask(organizationId: string, id: string): Promise<Task | null> {
    return withOrganizationOnly(this.#db, organizationId, async (tx) => {
    const rows = await tx
      .select()
      .from(tasks)
      .where(and(eq(tasks.organizationId, organizationId), eq(tasks.id, id)))
      .limit(1);
    const row = rows[0];
    return row ? unpackTask(row) : null;
    });
  }

  async listTasksByGoal(organizationId: string, goalId: string): Promise<Task[]> {
    return withOrganizationOnly(this.#db, organizationId, async (tx) => {
    const rows = await tx
      .select()
      .from(tasks)
      .where(and(eq(tasks.organizationId, organizationId), eq(tasks.goalId, goalId)));
    return rows.map(unpackTask);
    });
  }

  async reassignTask(organizationId: string, id: string, assignedAgentId: string): Promise<Task> {
    return withOrganizationOnly(this.#db, organizationId, async (tx) => {
    const [updated] = await tx
      .update(tasks)
      .set({ assignedAgentId })
      .where(and(eq(tasks.organizationId, organizationId), eq(tasks.id, id)))
      .returning();
    if (!updated) throw new Error(`tasks: unknown task ${id}`);
    return unpackTask(updated);
    });
  }

  async updateTaskStatus(organizationId: string, id: string, status: TaskStatus): Promise<Task> {
    return withOrganizationOnly(this.#db, organizationId, async (tx) => {
    const [updated] = await tx
      .update(tasks)
      .set({ status })
      .where(and(eq(tasks.organizationId, organizationId), eq(tasks.id, id)))
      .returning();
    if (!updated) throw new Error(`tasks: unknown task ${id}`);
    return unpackTask(updated);
    });
  }
}
