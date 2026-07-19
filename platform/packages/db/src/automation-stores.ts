/** Drizzle bindings for canonical Automation definitions and attributable Runs. */
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import type {
  AutomationDefinition,
  AutomationRegistry,
  AutomationRunRecorder,
  AutomationStepDef,
  RunCtx,
} from "@bridge/core";
import type { Database } from "./client.js";
import { agents, automationRuns, automations } from "./schema.js";
import { withWorkspaceOnly } from "./workspace-context.js";

/**
 * Mirrors `AutomationStepDef`. This is the only gate an Automation step's
 * jsonb passes through in either direction. Malformed steps never reach
 * `automations.skill_pipeline`, and a malformed stored row fails closed instead
 * of silently dropping work. If malformed data is already present (pre-fix
 * data, another process, or a raw SQL insert bypassing
 * `saveSteps`), reading it back must throw rather than silently dropping the
 * step. A silently-dropped step means an Automation "succeeds" while quietly
 * running fewer steps than configured — worse than a crash.
 *
 * Before adding this: searched for an existing zod schema for this shape
 * (`grep -rn "z.object" packages/core`, `grep -rn "AutomationStepDef"`) — none
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
  "automation",
  "module",
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

// NOTE: not asserted `satisfies z.ZodType<AutomationStepDef>` — with this repo's
// `exactOptionalPropertyTypes: true`, zod's `.optional()` types the field as
// `T | undefined` (an explicit undefined), which the plain `field?: T`
// optional-property shape of `AutomationStepDef` rejects. `normalizeStep` below
// strips explicit-undefined keys so the returned objects satisfy the real
// (exact-optional) `AutomationStepDef` shape.
export const automationStepDefSchema = z.object({
  skill: z.string().min(1),
  action: actionSchema,
  resourceType: resourceTypeSchema,
  resourceId: z.string().min(1).optional(),
  inputs: z.record(z.unknown()).optional(),
  dataScope: dataScopeSchema.optional(),
  // AGS1/TASK-007 — see AutomationStepDef.goalTaskRef's doc comment.
  goalTaskRef: z.object({ goalId: z.string().min(1), taskId: z.string().min(1) }).optional(),
});

export const automationStepListSchema = z.array(automationStepDefSchema);

/** Drop explicit-`undefined` optional keys so the object satisfies `exactOptionalPropertyTypes`. */
function normalizeStep(parsed: z.infer<typeof automationStepDefSchema>): AutomationStepDef {
  const step: AutomationStepDef = {
    skill: parsed.skill,
    action: parsed.action,
    resourceType: parsed.resourceType,
  };
  if (parsed.resourceId !== undefined) step.resourceId = parsed.resourceId;
  if (parsed.inputs !== undefined) step.inputs = parsed.inputs;
  if (parsed.dataScope !== undefined) step.dataScope = parsed.dataScope;
  if (parsed.goalTaskRef !== undefined) step.goalTaskRef = parsed.goalTaskRef;
  return step;
}

/** Validate `automations.skill_pipeline` at both read and write boundaries. */
export function parseAutomationSteps(raw: unknown): AutomationStepDef[] {
  const result = automationStepListSchema.safeParse(raw ?? []);
  if (!result.success) {
    throw new Error(`Invalid Automation skill_pipeline jsonb: ${result.error.message}`);
  }
  return result.data.map(normalizeStep);
}

export class DrizzleAutomationRegistry implements AutomationRegistry {
  #db: Database;
  constructor(db: Database) {
    this.#db = db;
  }

  async load(workspaceId: string, automationId: string): Promise<AutomationDefinition | null> {
    return withWorkspaceOnly(this.#db, workspaceId, async (tx) => {
      const rows = await tx
        .select({
          id: automations.id,
          name: automations.name,
          agentId: automations.agentId,
          agentPlane: automations.agentPlane,
          pipeline: automations.skillPipeline,
        })
        .from(automations)
        .where(
          and(
            eq(automations.workspaceId, workspaceId),
            eq(automations.id, automationId),
            eq(automations.status, "active"),
          ),
        )
        .limit(1);
      const row = rows[0];
      if (!row) return null;
      if (row.agentPlane !== "local" && row.agentPlane !== "cloud") {
        throw new Error(
          `Invalid Automation Agent Plane for ${automationId}: ${row.agentPlane}`,
        );
      }
      const steps = parseAutomationSteps(row.pipeline);
      return {
        id: row.id,
        name: row.name,
        workspaceId,
        agentId: row.agentId,
        agentPlane: row.agentPlane,
        steps,
      };
    });
  }

  async save(definition: AutomationDefinition): Promise<void> {
    const { agentId, agentPlane } = definition;
    await withWorkspaceOnly(this.#db, definition.workspaceId, async (tx) => {
      const [owningAgent] = await tx
        .select({ id: agents.id })
        .from(agents)
        .where(
          and(
            eq(agents.id, agentId),
            eq(agents.workspaceId, definition.workspaceId),
          ),
        )
        .limit(1);
      if (!owningAgent) {
        throw new Error(
          "AutomationRegistry.save: owning Agent must belong to the Automation workspace",
        );
      }
      const steps = parseAutomationSteps(definition.steps);
      await tx
        .insert(automations)
        .values({
          id: definition.id,
          workspaceId: definition.workspaceId,
          name: definition.name,
          agentId,
          agentPlane,
          skillPipeline: steps,
          trigger: {},
        })
        .onConflictDoUpdate({
          target: automations.id,
          set: {
            name: definition.name,
            agentId,
            agentPlane,
            skillPipeline: steps,
            status: "active",
          },
        });
    });
  }

  /** Write-time gate: validates the full pipeline and throws before anything is persisted. */
  async saveSteps(workspaceId: string, automationId: string, steps: unknown): Promise<void> {
    const validated = parseAutomationSteps(steps);
    await withWorkspaceOnly(this.#db, workspaceId, async (tx) => {
      await tx
        .update(automations)
        .set({ skillPipeline: validated })
        .where(
          and(eq(automations.workspaceId, workspaceId), eq(automations.id, automationId)),
        );
    });
  }
}

export class DrizzleAutomationRunRecorder implements AutomationRunRecorder {
  #db: Database;
  constructor(db: Database) {
    this.#db = db;
  }

  async start(
    run: { runId: string; automationId: string; workspaceId: string; agentId: string },
    _ctx: RunCtx,
  ): Promise<void> {
    await withWorkspaceOnly(this.#db, run.workspaceId, async (tx) => {
      await tx.insert(automationRuns).values({
        id: run.runId,
        workspaceId: run.workspaceId,
        automationId: run.automationId,
        agentId: run.agentId,
        runId: run.runId,
        status: "running",
      });
    });
  }

  async finish(
    run: { runId: string; workspaceId: string; status: "completed" | "halted"; output: unknown },
    _ctx: RunCtx,
  ): Promise<void> {
    await withWorkspaceOnly(this.#db, run.workspaceId, async (tx) => {
      const rows = await tx
        .update(automationRuns)
        .set({ status: run.status, output: run.output, finishedAt: new Date() })
        .where(
          and(
            eq(automationRuns.id, run.runId),
            eq(automationRuns.workspaceId, run.workspaceId),
          ),
        )
        .returning();
      if (rows.length !== 1) {
        throw new Error(
          `AutomationRunRecorder.finish: Run ${run.runId} not found in organization ${run.workspaceId}`,
        );
      }
    });
  }
}
