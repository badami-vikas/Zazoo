/**
 * Drizzle bindings for the P2 ritual runtime. A ritual is config — `rituals.skill_pipeline`
 * jsonb holds the ordered steps; `runById` loads it and runs each step through the
 * Universal Action Pipeline. Runs are recorded in `ritual_runs`.
 */
import { and, eq } from "drizzle-orm";
import type {
  Action,
  ResourceType,
  RitualDefinition,
  RitualRegistry,
  RitualRunRecorder,
  RitualStepDef,
  RunCtx,
  ToolRegistry,
} from "@bridge/core";
import type { Database } from "./client.js";
import { ritualRuns, rituals, tools } from "./schema.js";

function asStep(raw: unknown): RitualStepDef | null {
  if (!raw || typeof raw !== "object") return null;
  const s = raw as Record<string, unknown>;
  if (typeof s.skill !== "string" || typeof s.action !== "string" || typeof s.resourceType !== "string") {
    return null;
  }
  const ds = s.dataScope;
  return {
    skill: s.skill,
    action: s.action as Action,
    resourceType: s.resourceType as ResourceType,
    ...(typeof s.resourceId === "string" ? { resourceId: s.resourceId } : {}),
    ...(s.inputs && typeof s.inputs === "object" ? { inputs: s.inputs as Record<string, unknown> } : {}),
    ...(ds === "all" || ds === "public" || ds === "private" ? { dataScope: ds } : {}),
  };
}

export class DrizzleRitualRegistry implements RitualRegistry {
  #db: Database;
  constructor(db: Database) {
    this.#db = db;
  }

  async load(workspaceId: string, ritualId: string): Promise<RitualDefinition | null> {
    const rows = await this.#db
      .select({ id: rituals.id, name: rituals.name, pipeline: rituals.skillPipeline })
      .from(rituals)
      .where(and(eq(rituals.workspaceId, workspaceId), eq(rituals.id, ritualId), eq(rituals.status, "active")))
      .limit(1);
    const row = rows[0];
    if (!row) return null;
    const raw = Array.isArray(row.pipeline) ? row.pipeline : [];
    const steps = raw.map(asStep).filter((s): s is RitualStepDef => s !== null);
    return { id: row.id, name: row.name, workspaceId, steps };
  }
}

export class DrizzleToolRegistry implements ToolRegistry {
  #db: Database;
  constructor(db: Database) {
    this.#db = db;
  }

  async load(workspaceId: string, toolId: string): Promise<RitualDefinition | null> {
    const rows = await this.#db
      .select({ id: tools.id, name: tools.name, composition: tools.composition })
      .from(tools)
      .where(and(eq(tools.workspaceId, workspaceId), eq(tools.id, toolId), eq(tools.status, "active")))
      .limit(1);
    const row = rows[0];
    if (!row) return null;
    // composition jsonb = { "steps": [ {skill, action, resourceType, ...}, ... ] }.
    const comp = (row.composition ?? {}) as { steps?: unknown };
    const raw = Array.isArray(comp.steps) ? comp.steps : [];
    const steps = raw.map(asStep).filter((s): s is RitualStepDef => s !== null);
    return { id: row.id, name: row.name, workspaceId, steps };
  }
}

export class DrizzleRitualRunRecorder implements RitualRunRecorder {
  #db: Database;
  constructor(db: Database) {
    this.#db = db;
  }

  async start(
    run: { runId: string; ritualId: string; workspaceId: string; actorId: string },
    _ctx: RunCtx,
  ): Promise<void> {
    await this.#db.insert(ritualRuns).values({
      id: run.runId,
      workspaceId: run.workspaceId,
      ritualId: run.ritualId,
      runId: run.runId,
      status: "running",
    });
  }

  async finish(
    run: { runId: string; status: "completed" | "halted"; output: unknown },
    _ctx: RunCtx,
  ): Promise<void> {
    await this.#db
      .update(ritualRuns)
      .set({ status: run.status, output: run.output, finishedAt: new Date() })
      .where(eq(ritualRuns.id, run.runId));
  }
}
