/** Drizzle bindings for canonical Automation definitions and attributable Runs. */
import { and, desc, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import type {
  AutomationDefinition,
  AutomationRegistry,
  AutomationRunRecord,
  AutomationRunRecorder,
  AutomationStepDef,
  RunCtx,
} from "@bridge/core";
import { canonicalizeJson } from "@bridge/core";
import type { Database } from "./client.js";
import { agents, automationRuns, automations } from "./schema.js";
import { withOrganizationOnly } from "./organization-context.js";

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
 * npm manifest description), so a zod schema cannot live there; it is
 * colocated here in `@bridge/db`, the only place that validates this jsonb at
 * the read/write boundary.
 */
const actionSchema = z.enum(["read", "write", "execute", "share", "archive", "approve"]);

const resourceTypeSchema = z.enum([
  "person",
  "community",
  "record",
  "event",
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

function isPreliminaryCompletedOutput(output: unknown): boolean {
  if (typeof output !== "object" || output === null || Array.isArray(output)) return false;
  const keys = Object.keys(output);
  return keys.length === 1 && keys[0] === "steps" &&
    typeof (output as { steps?: unknown }).steps === "number";
}

export class DrizzleAutomationRegistry implements AutomationRegistry {
  #db: Database;
  constructor(db: Database) {
    this.#db = db;
  }

  async load(organizationId: string, automationId: string): Promise<AutomationDefinition | null> {
    return withOrganizationOnly(this.#db, organizationId, async (tx) => {
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
          eq(automations.organizationId, organizationId),
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
      organizationId,
      agentId: row.agentId,
      agentPlane: row.agentPlane,
      steps,
    };
    });
  }

  async save(definition: AutomationDefinition): Promise<void> {
    await withOrganizationOnly(this.#db, definition.organizationId, async (tx) => {
    const { agentId, agentPlane } = definition;
    const [owningAgent] = await tx
      .select({ id: agents.id })
      .from(agents)
      .where(
        and(
          eq(agents.id, agentId),
          eq(agents.organizationId, definition.organizationId),
        ),
      )
      .limit(1);
    if (!owningAgent) {
      throw new Error(
        "AutomationRegistry.save: owning Agent must belong to the Automation organization",
      );
    }
    const steps = parseAutomationSteps(definition.steps);
    await tx
      .insert(automations)
      .values({
        id: definition.id,
        organizationId: definition.organizationId,
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
  async saveSteps(organizationId: string, automationId: string, steps: unknown): Promise<void> {
    const validated = parseAutomationSteps(steps);
    await withOrganizationOnly(this.#db, organizationId, async (tx) => {
      await tx
      .update(automations)
      .set({ skillPipeline: validated })
      .where(
        and(eq(automations.organizationId, organizationId), eq(automations.id, automationId)),
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
    run: { runId: string; automationId: string; organizationId: string; agentId: string },
    ctx: RunCtx,
  ): Promise<void> {
    await withOrganizationOnly(this.#db, run.organizationId, async (tx) => {
      const [inserted] = await tx.insert(automationRuns).values({
      id: run.runId,
      organizationId: run.organizationId,
      automationId: run.automationId,
      agentId: run.agentId,
      runId: run.runId,
      status: "running",
      startedAt: new Date(ctx.clock.nowISO()),
      }).onConflictDoNothing().returning();
      if (inserted) return;
      const [existing] = await tx.select().from(automationRuns).where(and(
        eq(automationRuns.id, run.runId),
        eq(automationRuns.organizationId, run.organizationId),
      )).limit(1);
      if (
        !existing ||
        existing.automationId !== run.automationId ||
        existing.agentId !== run.agentId
      ) {
        throw new Error(`AutomationRunRecorder.start: Run ${run.runId} conflicts with existing attribution`);
      }
    });
  }

  async finish(
    run: { runId: string; organizationId: string; status: "completed" | "halted"; output: unknown },
    ctx: RunCtx,
  ): Promise<void> {
    await withOrganizationOnly(this.#db, run.organizationId, async (tx) => {
    const [updated] = await tx
      .update(automationRuns)
      .set({
        status: run.status,
        output: run.output,
        finishedAt: new Date(ctx.clock.nowISO()),
      })
      .where(
        and(
          eq(automationRuns.id, run.runId),
          eq(automationRuns.organizationId, run.organizationId),
          eq(automationRuns.status, "running"),
        ),
      )
      .returning();
    if (updated) return;

    const [existing] = await tx
      .select({
        status: automationRuns.status,
        output: automationRuns.output,
      })
      .from(automationRuns)
      .where(
        and(
          eq(automationRuns.id, run.runId),
          eq(automationRuns.organizationId, run.organizationId),
        ),
      )
      .for("update")
      .limit(1);
    if (!existing) {
      throw new Error(
        `AutomationRunRecorder.finish: Run ${run.runId} not found in organization ${run.organizationId}`,
      );
    }
    if (existing.status === "completed" && run.status === "completed" &&
      isPreliminaryCompletedOutput(existing.output) &&
      !isPreliminaryCompletedOutput(run.output)) {
      await tx
        .update(automationRuns)
        .set({
          output: run.output,
          finishedAt: new Date(ctx.clock.nowISO()),
        })
        .where(
          and(
            eq(automationRuns.id, run.runId),
            eq(automationRuns.organizationId, run.organizationId),
            eq(automationRuns.status, "completed"),
          ),
        );
      return;
    }
    if (existing.status !== run.status ||
      canonicalizeJson(existing.output) !== canonicalizeJson(run.output)) {
      throw new Error(
        `AutomationRunRecorder.finish: Run ${run.runId} conflicts with existing terminal result`,
      );
    }
    });
  }

  async list(
    organizationId: string,
    automationIds: string[],
    opts: { limit: number },
  ): Promise<AutomationRunRecord[]> {
    if (automationIds.length === 0) return [];
    const limit = Math.min(50, Math.max(1, opts.limit));
    return withOrganizationOnly(this.#db, organizationId, async (tx) => {
      const rows = await tx
        .select({
          runId: automationRuns.runId,
          id: automationRuns.id,
          automationId: automationRuns.automationId,
          organizationId: automationRuns.organizationId,
          agentId: automationRuns.agentId,
          status: automationRuns.status,
          startedAt: automationRuns.startedAt,
          finishedAt: automationRuns.finishedAt,
        })
        .from(automationRuns)
        .where(and(
          eq(automationRuns.organizationId, organizationId),
          inArray(automationRuns.automationId, automationIds),
        ))
        .orderBy(desc(automationRuns.startedAt), desc(automationRuns.id))
        .limit(limit);
      return rows.map((row) => {
        if (row.status !== "running" && row.status !== "completed" && row.status !== "halted") {
          throw new Error(`Invalid Automation Run status: ${row.status}`);
        }
        return {
          runId: row.runId ?? row.id,
          automationId: row.automationId,
          organizationId: row.organizationId,
          agentId: row.agentId,
          status: row.status,
          startedAt: row.startedAt.toISOString(),
          ...(row.finishedAt ? { finishedAt: row.finishedAt.toISOString() } : {}),
        };
      });
    });
  }
}
