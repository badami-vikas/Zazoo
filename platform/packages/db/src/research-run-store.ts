/**
 * DrizzleResearchRunStore — binds the core `ResearchRunStore` port
 * (@bridge/core's research-run.ts) to `research_runs`/`research_run_steps`
 * (TASK-028 kernel-Run migration, migration 0035).
 *
 * Owner scoping is enforced twice, deliberately: every query carries the
 * explicit organization+owner predicate, AND every operation runs inside
 * `withOrganizationContext` with the owner's user id so the FORCE-RLS
 * policies (0035) apply at the database itself — the chat-store pattern.
 * Steps are append-only (no UPDATE/DELETE grant); a run row's terminal
 * transition is additionally guarded by the 0035 trigger, so a lost CAS here
 * fails loud instead of silently rewriting an outcome.
 */
import { and, asc, desc, eq } from "drizzle-orm";
import { z } from "zod";
import {
  ResearchRunAlreadyTerminalError,
  ResearchRunNotFoundError,
  RESEARCH_STEP_TOOLS,
  RESEARCH_STOP_REASONS,
  type ResearchRunOutcomeUpdate,
  type ResearchRunRecord,
  type ResearchRunStatus,
  type ResearchRunStore,
  type ResearchStepRecord,
  type ResearchStepTool,
  type ResearchStopReason,
} from "@bridge/core";
import type { Database } from "./client.js";
import { researchRunSteps, researchRuns } from "./schema.js";
import { withOrganizationContext } from "./organization-context.js";

const stringArraySchema = z.array(z.string());

function parseStringArray(raw: unknown, column: string): string[] {
  const result = stringArraySchema.safeParse(raw ?? []);
  if (!result.success) {
    throw new Error(`Invalid research_runs.${column} jsonb: ${result.error.message}`);
  }
  return result.data;
}

function parseStopReason(raw: string | null): ResearchStopReason | null {
  if (raw === null) return null;
  if (!(RESEARCH_STOP_REASONS as readonly string[]).includes(raw)) {
    throw new Error(`Invalid research_runs.stop_reason: ${raw}`);
  }
  return raw as ResearchStopReason;
}

function parseTool(raw: string): ResearchStepTool {
  if (!(RESEARCH_STEP_TOOLS as readonly string[]).includes(raw)) {
    throw new Error(`Invalid research_run_steps.tool: ${raw}`);
  }
  return raw as ResearchStepTool;
}

function unpackRun(row: typeof researchRuns.$inferSelect): ResearchRunRecord {
  return {
    id: row.id,
    organizationId: row.organizationId,
    ownerUserId: row.ownerUserId,
    objective: row.objective,
    status: row.status as ResearchRunStatus,
    stopRequested: row.stopRequested,
    parentRunId: row.parentRunId,
    goalId: row.goalId,
    taskId: row.taskId,
    stopReason: parseStopReason(row.stopReason),
    brief: row.brief,
    citations: parseStringArray(row.citations, "citations"),
    blockedActions: parseStringArray(row.blockedActions, "blocked_actions"),
    injectionReports: parseStringArray(row.injectionReports, "injection_reports"),
    stepsTaken: row.stepsTaken,
    startedAt: row.createdAt.toISOString(),
    endedAt: row.endedAt ? row.endedAt.toISOString() : null,
  };
}

function unpackStep(row: typeof researchRunSteps.$inferSelect): ResearchStepRecord {
  return {
    id: row.id,
    runId: row.runId,
    organizationId: row.organizationId,
    ownerUserId: row.ownerUserId,
    stepIndex: row.stepIndex,
    tool: parseTool(row.tool),
    summary: row.summary,
    sourceUrl: row.sourceUrl,
    childRunId: row.childRunId,
    quarantinedText: row.quarantinedText,
    quarantinedSourceUrl: row.quarantinedSourceUrl,
    createdAt: row.createdAt.toISOString(),
  };
}

function ownerPredicate(organizationId: string, ownerUserId: string, id?: string) {
  return and(
    eq(researchRuns.organizationId, organizationId),
    eq(researchRuns.ownerUserId, ownerUserId),
    ...(id ? [eq(researchRuns.id, id)] : []),
  );
}

export class DrizzleResearchRunStore implements ResearchRunStore {
  #db: Database;
  constructor(db: Database) {
    this.#db = db;
  }

  #scoped<T>(
    organizationId: string,
    ownerUserId: string,
    operation: (tx: Database) => Promise<T>,
  ): Promise<T> {
    return withOrganizationContext(
      this.#db,
      { organizationId, userId: ownerUserId },
      operation,
    );
  }

  async create(run: ResearchRunRecord): Promise<ResearchRunRecord> {
    return this.#scoped(run.organizationId, run.ownerUserId, async (tx) => {
      const [row] = await tx
        .insert(researchRuns)
        .values({
          id: run.id,
          organizationId: run.organizationId,
          ownerUserId: run.ownerUserId,
          objective: run.objective,
          status: run.status,
          stopRequested: run.stopRequested,
          parentRunId: run.parentRunId,
          goalId: run.goalId,
          taskId: run.taskId,
          stopReason: run.stopReason,
          brief: run.brief,
          citations: [...run.citations],
          blockedActions: [...run.blockedActions],
          injectionReports: [...run.injectionReports],
          stepsTaken: run.stepsTaken,
          createdAt: new Date(run.startedAt),
          endedAt: run.endedAt ? new Date(run.endedAt) : null,
        })
        .returning();
      if (!row) throw new Error(`failed to insert Research Run ${run.id}`);
      return unpackRun(row);
    });
  }

  async get(
    organizationId: string,
    ownerUserId: string,
    id: string,
  ): Promise<ResearchRunRecord | null> {
    return this.#scoped(organizationId, ownerUserId, async (tx) => {
      const [row] = await tx
        .select()
        .from(researchRuns)
        .where(ownerPredicate(organizationId, ownerUserId, id))
        .limit(1);
      return row ? unpackRun(row) : null;
    });
  }

  async list(
    organizationId: string,
    ownerUserId: string,
    limit: number,
  ): Promise<ResearchRunRecord[]> {
    return this.#scoped(organizationId, ownerUserId, async (tx) => {
      const rows = await tx
        .select()
        .from(researchRuns)
        .where(ownerPredicate(organizationId, ownerUserId))
        .orderBy(desc(researchRuns.createdAt), desc(researchRuns.id))
        .limit(limit);
      return rows.map(unpackRun);
    });
  }

  async requestStop(
    organizationId: string,
    ownerUserId: string,
    id: string,
  ): Promise<ResearchRunRecord> {
    return this.#scoped(organizationId, ownerUserId, async (tx) => {
      // Conditional so a terminal run (frozen by the 0035 trigger) and an
      // already-flagged run are clean no-ops rather than trigger exceptions.
      await tx
        .update(researchRuns)
        .set({ stopRequested: true })
        .where(
          and(
            ownerPredicate(organizationId, ownerUserId, id),
            eq(researchRuns.status, "running"),
            eq(researchRuns.stopRequested, false),
          ),
        );
      const [row] = await tx
        .select()
        .from(researchRuns)
        .where(ownerPredicate(organizationId, ownerUserId, id))
        .limit(1);
      if (!row) throw new ResearchRunNotFoundError(id);
      return unpackRun(row);
    });
  }

  async complete(
    organizationId: string,
    ownerUserId: string,
    id: string,
    outcome: ResearchRunOutcomeUpdate,
    endedAtISO: string,
  ): Promise<ResearchRunRecord> {
    return this.#scoped(organizationId, ownerUserId, async (tx) => {
      const [row] = await tx
        .update(researchRuns)
        .set({
          status: outcome.status,
          stopReason: outcome.stopReason,
          brief: outcome.brief,
          citations: [...outcome.citations],
          blockedActions: [...outcome.blockedActions],
          injectionReports: [...outcome.injectionReports],
          stepsTaken: outcome.stepsTaken,
          endedAt: new Date(endedAtISO),
        })
        .where(
          and(
            ownerPredicate(organizationId, ownerUserId, id),
            eq(researchRuns.status, "running"),
          ),
        )
        .returning();
      if (row) return unpackRun(row);
      // CAS lost: distinguish "gone" from "already terminal" honestly.
      const [current] = await tx
        .select()
        .from(researchRuns)
        .where(ownerPredicate(organizationId, ownerUserId, id))
        .limit(1);
      if (!current) throw new ResearchRunNotFoundError(id);
      throw new ResearchRunAlreadyTerminalError(id, current.status as ResearchRunStatus);
    });
  }

  async appendStep(step: ResearchStepRecord): Promise<ResearchStepRecord> {
    return this.#scoped(step.organizationId, step.ownerUserId, async (tx) => {
      const [run] = await tx
        .select({ status: researchRuns.status })
        .from(researchRuns)
        .where(ownerPredicate(step.organizationId, step.ownerUserId, step.runId))
        .limit(1);
      if (!run) throw new ResearchRunNotFoundError(step.runId);
      if (run.status !== "running") {
        throw new ResearchRunAlreadyTerminalError(
          step.runId,
          run.status as ResearchRunStatus,
        );
      }
      const [row] = await tx
        .insert(researchRunSteps)
        .values({
          id: step.id,
          organizationId: step.organizationId,
          ownerUserId: step.ownerUserId,
          runId: step.runId,
          stepIndex: step.stepIndex,
          tool: step.tool,
          summary: step.summary,
          sourceUrl: step.sourceUrl,
          childRunId: step.childRunId,
          quarantinedText: step.quarantinedText,
          quarantinedSourceUrl: step.quarantinedSourceUrl,
          createdAt: new Date(step.createdAt),
        })
        .returning();
      if (!row) throw new Error(`failed to insert Research Run step ${step.id}`);
      return unpackStep(row);
    });
  }

  async listSteps(
    organizationId: string,
    ownerUserId: string,
    runId: string,
  ): Promise<ResearchStepRecord[]> {
    return this.#scoped(organizationId, ownerUserId, async (tx) => {
      const rows = await tx
        .select()
        .from(researchRunSteps)
        .where(
          and(
            eq(researchRunSteps.organizationId, organizationId),
            eq(researchRunSteps.ownerUserId, ownerUserId),
            eq(researchRunSteps.runId, runId),
          ),
        )
        .orderBy(
          asc(researchRunSteps.stepIndex),
          asc(researchRunSteps.createdAt),
          asc(researchRunSteps.id),
        );
      return rows.map(unpackStep);
    });
  }
}
