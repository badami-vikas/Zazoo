/**
 * Drizzle bindings for the P2 ritual runtime. A ritual is config — `rituals.skill_pipeline`
 * jsonb holds the ordered steps; `runById` loads it and runs each step through the
 * Universal Action Pipeline. Runs are recorded in `ritual_runs`.
 */
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import type {
  RitualDefinition,
  RitualRegistry,
  RitualRunRecorder,
  RitualStepDef,
  RunCtx,
  ToolRegistry,
} from "@bridge/core";
import type { Database } from "./client.js";
import { ritualRuns, rituals, tools } from "./schema.js";

/**
 * Mirrors `RitualStepDef` (@bridge/core/src/ports.ts:166). This is the ONLY
 * gate a ritual/tool step's jsonb passes through in either direction —
 * malformed steps must never reach `rituals.skill_pipeline` /
 * `tools.composition` (write time throws), and if a bad step is somehow
 * already present (pre-fix data, another process, a raw SQL insert bypassing
 * `saveSteps`), reading it back must throw rather than silently dropping the
 * step. A silently-dropped step means a ritual "succeeds" while quietly
 * running fewer steps than configured — worse than a crash.
 *
 * Before adding this: searched for an existing zod schema for this shape
 * (`grep -rn "z.object" packages/core`, `grep -rn "RitualStepDef"`) — none
 * exists. `@bridge/core` is declared "Zero runtime dependencies" (see its
 * package.json description), so a zod schema cannot live there; it is
 * colocated here in `@bridge/db`, the only place that validates this jsonb at
 * the read/write boundary.
 */
const actionSchema = z.enum(["read", "write", "execute", "share", "archive", "approve"]);

const resourceTypeSchema = z.enum([
  "person",
  "community",
  "initiative",
  "touchpoint",
  "ritual",
  "tool",
  "file",
  "signal",
  "policy",
  "policy_param",
  "skill",
  "agent",
  "role",
  "permission",
  "ledger",
  "delegation",
  "integration",
  "network_graph:full",
  "external:send",
  "external:fetch",
]);

const dataScopeSchema = z.enum(["all", "public", "private"]);

// NOTE: not asserted `satisfies z.ZodType<RitualStepDef>` — with this repo's
// `exactOptionalPropertyTypes: true`, zod's `.optional()` types the field as
// `T | undefined` (an explicit undefined), which the plain `field?: T`
// optional-property shape of `RitualStepDef` rejects. `normalizeStep` below
// strips explicit-undefined keys so the returned objects satisfy the real
// (exact-optional) `RitualStepDef` shape.
export const ritualStepDefSchema = z.object({
  skill: z.string().min(1),
  action: actionSchema,
  resourceType: resourceTypeSchema,
  resourceId: z.string().min(1).optional(),
  inputs: z.record(z.unknown()).optional(),
  dataScope: dataScopeSchema.optional(),
});

export const ritualStepListSchema = z.array(ritualStepDefSchema);

/** Composition jsonb shape for `tools.composition` = `{ steps: RitualStepDef[] }`. */
export const toolCompositionSchema = z.object({
  steps: ritualStepListSchema.default([]),
});

/** Drop explicit-`undefined` optional keys so the object satisfies `exactOptionalPropertyTypes`. */
function normalizeStep(parsed: z.infer<typeof ritualStepDefSchema>): RitualStepDef {
  const step: RitualStepDef = {
    skill: parsed.skill,
    action: parsed.action,
    resourceType: parsed.resourceType,
  };
  if (parsed.resourceId !== undefined) step.resourceId = parsed.resourceId;
  if (parsed.inputs !== undefined) step.inputs = parsed.inputs;
  if (parsed.dataScope !== undefined) step.dataScope = parsed.dataScope;
  return step;
}

/** Validate a full `rituals.skill_pipeline` array at read OR write time. Throws on the first bad step. */
export function parseRitualSteps(raw: unknown): RitualStepDef[] {
  const result = ritualStepListSchema.safeParse(raw ?? []);
  if (!result.success) {
    throw new Error(`Invalid ritual skill_pipeline jsonb: ${result.error.message}`);
  }
  return result.data.map(normalizeStep);
}

/** Validate a full `tools.composition` object at read OR write time. Throws on the first bad step. */
export function parseToolComposition(raw: unknown): { steps: RitualStepDef[] } {
  const result = toolCompositionSchema.safeParse(raw ?? {});
  if (!result.success) {
    throw new Error(`Invalid tool composition jsonb: ${result.error.message}`);
  }
  return { steps: result.data.steps.map(normalizeStep) };
}

export class DrizzleRitualRegistry implements RitualRegistry {
  #db: Database;
  constructor(db: Database) {
    this.#db = db;
  }

  async load(workspaceId: string, ritualId: string): Promise<RitualDefinition | null> {
    const rows = await this.#db
      .select({
        id: rituals.id,
        name: rituals.name,
        agentId: rituals.agentId,
        agentPlane: rituals.agentPlane,
        legacyAgentIds: rituals.agentIds,
        pipeline: rituals.skillPipeline,
      })
      .from(rituals)
      .where(and(eq(rituals.workspaceId, workspaceId), eq(rituals.id, ritualId), eq(rituals.status, "active")))
      .limit(1);
    const row = rows[0];
    if (!row) return null;
    // Read-time validation: if a step fails to parse (pre-existing bad row,
    // another process, a raw insert bypassing `saveSteps`), throw loudly
    // rather than silently dropping the step.
    const steps = parseRitualSteps(row.pipeline);
    const agentId = row.agentId ?? (row.legacyAgentIds.length === 1 ? row.legacyAgentIds[0] : undefined);
    return {
      id: row.id,
      name: row.name,
      workspaceId,
      ...(agentId ? { agentId } : {}),
      ...(row.agentPlane === "local" || row.agentPlane === "cloud" ? { agentPlane: row.agentPlane } : {}),
      steps,
    };
  }

  async save(definition: RitualDefinition): Promise<void> {
    if (!definition.agentId) throw new Error("RitualRegistry.save: owning agentId is required");
    const steps = parseRitualSteps(definition.steps);
    await this.#db.insert(rituals).values({
      id: definition.id,
      workspaceId: definition.workspaceId,
      name: definition.name,
      trigger: {},
      agentId: definition.agentId,
      agentPlane: definition.agentPlane ?? null,
      agentIds: [definition.agentId],
      skillPipeline: steps,
    }).onConflictDoUpdate({
      target: rituals.id,
      set: {
        name: definition.name,
        agentId: definition.agentId,
        agentPlane: definition.agentPlane ?? null,
        agentIds: [definition.agentId],
        skillPipeline: steps,
        status: "active",
      },
    });
  }

  /** Write-time gate: validates the full pipeline and throws before anything is persisted. */
  async saveSteps(workspaceId: string, ritualId: string, steps: unknown): Promise<void> {
    const validated = parseRitualSteps(steps);
    await this.#db
      .update(rituals)
      .set({ skillPipeline: validated })
      .where(and(eq(rituals.workspaceId, workspaceId), eq(rituals.id, ritualId)));
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
    // Read-time validation: throw loudly on a malformed composition instead of
    // silently dropping steps (see DrizzleRitualRegistry.load for rationale).
    const { steps } = parseToolComposition(row.composition ?? {});
    return { id: row.id, name: row.name, workspaceId, steps };
  }

  /** Write-time gate: validates the full composition and throws before anything is persisted. */
  async saveSteps(workspaceId: string, toolId: string, steps: unknown): Promise<void> {
    const validated = parseToolComposition({ steps });
    await this.#db
      .update(tools)
      .set({ composition: validated })
      .where(and(eq(tools.workspaceId, workspaceId), eq(tools.id, toolId)));
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
