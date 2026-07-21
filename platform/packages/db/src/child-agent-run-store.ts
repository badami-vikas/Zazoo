/**
 * DrizzleChildAgentRunStore — binds the core `ChildAgentRunStore` port
 * (@bridge/core's child-agent-run.ts) to `child_agent_runs` (schema.ts's
 * LAYER 8). Mirrors DrizzleOrganizationDefinitionStore's shape: a single class,
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
import { and, eq, gt, sql } from "drizzle-orm";
import { z } from "zod";
import {
  ChildRunBudgetExceededError,
  ChildRunAlreadyTerminalError,
  labelFromLegacyTrustOrigin,
  storedTaintLabelOrUnknown,
} from "@bridge/core";
import type { ChildAgentRun, ChildAgentRunStatus, ChildAgentRunStore, DataScope, Plane, ReviewMode, TrustOrigin } from "@bridge/core";
import type { Database } from "./client.js";
import { childAgentRuns } from "./schema.js";
import { withOrganizationOnly } from "./organization-context.js";

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
    organizationId: row.organizationId,
    goalId: row.anchorTaskId,
    taskId: row.taskId,
    depth: row.depth,
    authorityScope: parseStringArray(row.authorityScope, "authority_scope"),
    droppedScope: parseStringArray(row.droppedScope, "dropped_scope"),
    eligibleSkills: parseStringArray(row.eligibleSkills, "eligible_skills"),
    dataScope: row.dataScope as DataScope,
    plane: row.plane as Plane,
    budget: parseBudget(row.budget),
    callsUsed: row.callsUsed,
    costUsed: row.costUsed,
    deadline: row.deadline.toISOString(),
    stopCondition: row.stopCondition,
    reviewMode: row.reviewMode as ReviewMode,
    ...(row.taint ? { taint: row.taint as TrustOrigin } : {}),
    taintLabel: storedTaintLabelOrUnknown(row.taintLabel).label,
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
    return withOrganizationOnly(this.#db, run.organizationId, async (tx) => {
    const [inserted] = await tx
      .insert(childAgentRuns)
      .values({
        id: run.id,
        parentRunId: run.parentRunId,
        parentAgentId: run.parentAgentId,
        organizationId: run.organizationId,
        anchorTaskId: run.goalId,
        taskId: run.taskId,
        depth: run.depth,
        authorityScope: [...run.authorityScope],
        droppedScope: [...run.droppedScope],
        eligibleSkills: [...run.eligibleSkills],
        dataScope: run.dataScope,
        plane: run.plane,
        budget: run.budget,
        callsUsed: run.callsUsed,
        costUsed: run.costUsed,
        deadline: new Date(run.deadline),
        stopCondition: run.stopCondition,
        reviewMode: run.reviewMode,
        taint: run.taint ?? null,
        taintLabel:
          run.taintLabel ??
          labelFromLegacyTrustOrigin(run.taint, `child-run:${run.id}`),
        status: run.status,
      })
      .returning();
    if (!inserted) throw new Error("child_agent_runs: insert returned no row");
    return unpack(inserted);
    });
  }

  async get(organizationId: string, id: string): Promise<ChildAgentRun | null> {
    return withOrganizationOnly(this.#db, organizationId, async (tx) => {
    const rows = await tx
      .select()
      .from(childAgentRuns)
      .where(and(eq(childAgentRuns.organizationId, organizationId), eq(childAgentRuns.id, id)))
      .limit(1);
    const row = rows[0];
    return row ? unpack(row) : null;
    });
  }

  async listByParentRun(organizationId: string, parentRunId: string): Promise<ChildAgentRun[]> {
    return withOrganizationOnly(this.#db, organizationId, async (tx) => {
    const rows = await tx
      .select()
      .from(childAgentRuns)
      .where(
        and(
          eq(childAgentRuns.organizationId, organizationId),
          eq(childAgentRuns.parentRunId, parentRunId),
        ),
      );
    return rows.map(unpack);
    });
  }

  async updateStatus(
    organizationId: string,
    id: string,
    expectedStatus: ChildAgentRunStatus,
    status: ChildAgentRunStatus,
  ): Promise<ChildAgentRun> {
    return withOrganizationOnly(this.#db, organizationId, async (tx) => {
    const [updated] = await tx
      .update(childAgentRuns)
      .set({ status })
      .where(
        and(
          eq(childAgentRuns.organizationId, organizationId),
          eq(childAgentRuns.id, id),
          eq(childAgentRuns.status, expectedStatus),
        ),
      )
      .returning();
    if (!updated) {
      // TASK-011 remediation (2026-07-18 fresh review) — the UPDATE's WHERE
      // clause can miss for two different reasons (unknown run vs. a real
      // CAS mismatch); distinguish them with one follow-up read so a genuine
      // race throws the SAME typed `ChildRunAlreadyTerminalError` the
      // in-memory store throws, not a generic Error. Callers throughout
      // apps/api specifically catch `instanceof ChildRunAlreadyTerminalError`
      // to swallow ONLY an expected already-terminal race — before this fix,
      // the real CAS-mismatch path here threw a plain Error that such
      // callers would incorrectly rethrow as an unexpected failure.
      const [current] = await tx
        .select()
        .from(childAgentRuns)
        .where(and(eq(childAgentRuns.organizationId, organizationId), eq(childAgentRuns.id, id)));
      if (!current) throw new Error(`child_agent_runs: unknown run ${id}`);
      throw new ChildRunAlreadyTerminalError(id, current.status as ChildAgentRunStatus);
    }
    return unpack(updated);
    });
  }

  async consumeBudget(
    organizationId: string,
    id: string,
    cost: number,
    nowISO: string,
  ): Promise<ChildAgentRun> {
    if (!Number.isFinite(cost) || cost < 0) {
      throw new Error("child_agent_runs: cost must be a non-negative finite number");
    }
    return withOrganizationOnly(this.#db, organizationId, async (tx) => {
    const [updated] = await tx
      .update(childAgentRuns)
      .set({
        callsUsed: sql`${childAgentRuns.callsUsed} + 1`,
        costUsed: sql`${childAgentRuns.costUsed} + ${cost}`,
      })
      .where(
        and(
          eq(childAgentRuns.organizationId, organizationId),
          eq(childAgentRuns.id, id),
          eq(childAgentRuns.status, "running"),
          gt(childAgentRuns.deadline, new Date(nowISO)),
          sql`${childAgentRuns.callsUsed} < (${childAgentRuns.budget}->>'maxCalls')::integer`,
          sql`${childAgentRuns.costUsed} + ${cost} <= (${childAgentRuns.budget}->>'maxCost')::double precision`,
        ),
      )
      .returning();
    if (!updated) {
      throw new ChildRunBudgetExceededError(`run ${id} has no budget or time remaining`);
    }
    return unpack(updated);
    });
  }
}
