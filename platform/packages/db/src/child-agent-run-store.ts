/**
 * DrizzleChildAgentRunStore — binds the core `ChildAgentRunStore` port
 * (@bridge/core's child-agent-run.ts) to `child_agent_runs` (schema.ts's
 * LAYER 8). Mirrors DrizzleWorkspaceDefinitionStore's shape: a single class,
 * `#db` private field, an `unpack` helper, jsonb string-array columns
 * validated at the read boundary (same reasoning as skill-manifest-store.ts's
 * `parseStringArray`: a corrupted `authorityScope`/`eligibleSkills` must fail
 * loud, never silently widen to "no restriction" via an emptied array).
 *
 * The append-only lifecycle AUDIT trail already lives in `ledger`
 * (`recordChildAgentRunTransition` in @bridge/core's child-agent-run.ts) —
 * this table is the separate CURRENT-STATE projection (`get`/`listByParentRun`/
 * `updateStatus`) that a restart must not lose; it does not replace the ledger.
 */
import { eq } from "drizzle-orm";
import { z } from "zod";
import type { ChildAgentRun, ChildAgentRunStatus, ChildAgentRunStore, DataScope, Plane, ReviewMode, TrustOrigin } from "@bridge/core";
import type { Database } from "./client.js";
import { childAgentRuns } from "./schema.js";

const stringArraySchema = z.array(z.string());

function parseStringArray(raw: unknown, column: string): string[] {
  const result = stringArraySchema.safeParse(raw ?? []);
  if (!result.success) {
    throw new Error(`Invalid child_agent_runs.${column} jsonb: ${result.error.message}`);
  }
  return result.data;
}

const budgetSchema = z.object({ maxCalls: z.number(), maxCost: z.number() });

function parseBudget(raw: unknown): ChildAgentRun["budget"] {
  const result = budgetSchema.safeParse(raw);
  if (!result.success) {
    throw new Error(`Invalid child_agent_runs.budget jsonb: ${result.error.message}`);
  }
  return result.data;
}

function unpack(row: typeof childAgentRuns.$inferSelect): ChildAgentRun {
  return {
    id: row.id,
    parentRunId: row.parentRunId,
    parentAgentId: row.parentAgentId,
    workspaceId: row.workspaceId,
    goalId: row.goalId,
    taskId: row.taskId,
    depth: row.depth,
    authorityScope: parseStringArray(row.authorityScope, "authority_scope"),
    droppedScope: parseStringArray(row.droppedScope, "dropped_scope"),
    eligibleSkills: parseStringArray(row.eligibleSkills, "eligible_skills"),
    dataScope: row.dataScope as DataScope,
    plane: row.plane as Plane,
    budget: parseBudget(row.budget),
    deadline: row.deadline,
    stopCondition: row.stopCondition,
    reviewMode: row.reviewMode as ReviewMode,
    ...(row.taint ? { taint: row.taint as TrustOrigin } : {}),
    status: row.status as ChildAgentRunStatus,
    createdAt: row.createdAt.toISOString(),
  };
}

export class DrizzleChildAgentRunStore implements ChildAgentRunStore {
  #db: Database;
  constructor(db: Database) {
    this.#db = db;
  }

  async create(run: ChildAgentRun): Promise<ChildAgentRun> {
    const [inserted] = await this.#db
      .insert(childAgentRuns)
      .values({
        id: run.id,
        parentRunId: run.parentRunId,
        parentAgentId: run.parentAgentId,
        workspaceId: run.workspaceId,
        goalId: run.goalId,
        taskId: run.taskId,
        depth: run.depth,
        authorityScope: [...run.authorityScope],
        droppedScope: [...run.droppedScope],
        eligibleSkills: [...run.eligibleSkills],
        dataScope: run.dataScope,
        plane: run.plane,
        budget: run.budget,
        deadline: run.deadline,
        stopCondition: run.stopCondition,
        reviewMode: run.reviewMode,
        taint: run.taint ?? null,
        status: run.status,
      })
      .returning();
    if (!inserted) throw new Error("child_agent_runs: insert returned no row");
    return unpack(inserted);
  }

  async get(id: string): Promise<ChildAgentRun | null> {
    const rows = await this.#db.select().from(childAgentRuns).where(eq(childAgentRuns.id, id)).limit(1);
    const row = rows[0];
    return row ? unpack(row) : null;
  }

  async listByParentRun(parentRunId: string): Promise<ChildAgentRun[]> {
    const rows = await this.#db.select().from(childAgentRuns).where(eq(childAgentRuns.parentRunId, parentRunId));
    return rows.map(unpack);
  }

  async updateStatus(id: string, status: ChildAgentRunStatus): Promise<ChildAgentRun> {
    const [updated] = await this.#db.update(childAgentRuns).set({ status }).where(eq(childAgentRuns.id, id)).returning();
    if (!updated) throw new Error(`child_agent_runs: unknown run ${id}`);
    return unpack(updated);
  }
}
