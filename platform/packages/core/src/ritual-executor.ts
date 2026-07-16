/**
 * RitualExecutor seam (STACK.md: "RitualExecutor seam, Temporal deferred").
 *
 * A Ritual is the ONE execution primitive — a trigger + an ordered skill_pipeline
 * run through the Universal Action Pipeline. This interface is the swap point:
 * the in-process executor here covers dev + the P2 thin runtime; Hatchet (Postgres
 * ritual engine) and, later, Temporal bind the same interface without touching
 * callers.
 *
 * Each step is a governed mutation — it does NOT bypass the pipeline. The executor
 * mints an ephemeral grant context per run so step authority lapses when the run ends.
 */
import type { UniversalActionPipeline } from "./pipeline.js";
import type { RitualDefinition, RitualRegistry, RitualRunRecorder, RunCtx, ToolRegistry } from "./ports.js";
import type { Actor, OnBehalfOf, Proposal, ResourceType } from "./types.js";

export interface RitualStep {
  skill: string;
  action: import("./types.js").Action;
  resourceType: ResourceType;
  resourceId?: string;
  inputs: unknown;
  /** Data tier this step may touch (the per-step access dropdown). Absent = 'all'. */
  dataScope?: import("./data-scope.js").DataScope;
}

export interface RitualRunRequest {
  workspaceId: string;
  ritualId: string;
  actor: Actor;
  onBehalfOf?: OnBehalfOf;
  steps: RitualStep[];
  seed?: string;
}

export interface RitualRunResult {
  runId: string;
  ritualId: string;
  status: "completed" | "halted";
  /** One proposal per executed step, in order. */
  proposals: Proposal[];
  /** Set when status='halted' — the step index that stopped the run. */
  haltedAtStep?: number;
}

/** Run a ritual by id, loading its step config from the registry (P2). */
export interface RitualRunByIdRequest {
  workspaceId: string;
  ritualId: string;
  /** Deprecated compatibility assertion. The stored Ritual owner is authoritative. */
  actor?: Actor;
  onBehalfOf?: OnBehalfOf;
  /** Run-time params shallow-merged into each step's static inputs. */
  params?: Record<string, unknown>;
  seed?: string;
}

export interface RitualExecutor {
  run(req: RitualRunRequest, ctx: RunCtx): Promise<RitualRunResult>;
  runById(req: RitualRunByIdRequest, ctx: RunCtx): Promise<RitualRunResult>;
  runTool(req: RitualRunByIdRequest, ctx: RunCtx): Promise<RitualRunResult>;
}

export interface RitualExecutorOpts {
  /** Loads ritual configs for runById. Required for runById; optional otherwise. */
  registry?: RitualRegistry;
  /** Loads tool configs for runTool. Required for runTool; optional otherwise. */
  toolRegistry?: ToolRegistry;
  /** Records ritual_runs (start/finish). Optional. */
  recorder?: RitualRunRecorder;
}

/**
 * In-process executor. Runs steps sequentially through the pipeline. A step that
 * is rejected (authority/policy block) HALTS the run — draft-then-approve means a
 * `pending_review` step still counts as produced (it awaits a human), not a halt.
 */
export class InProcessRitualExecutor implements RitualExecutor {
  #pipeline: UniversalActionPipeline;
  #registry: RitualRegistry | undefined;
  #toolRegistry: ToolRegistry | undefined;
  #recorder: RitualRunRecorder | undefined;

  constructor(pipeline: UniversalActionPipeline, opts: RitualExecutorOpts = {}) {
    this.#pipeline = pipeline;
    this.#registry = opts.registry;
    this.#toolRegistry = opts.toolRegistry;
    this.#recorder = opts.recorder;
  }

  async run(req: RitualRunRequest, ctx: RunCtx): Promise<RitualRunResult> {
    const runId = ctx.ids.next();
    return this.#execute(runId, req.workspaceId, req.ritualId, req.actor, req.onBehalfOf, req.steps, req.seed, ctx);
  }

  async runById(req: RitualRunByIdRequest, ctx: RunCtx): Promise<RitualRunResult> {
    if (!this.#registry) throw new Error("runById: no RitualRegistry configured");
    const def = await this.#registry.load(req.workspaceId, req.ritualId);
    if (!def) throw new Error(`runById: ritual ${req.ritualId} not found`);
    if (!def.agentId) throw new Error(`runById: ritual ${req.ritualId} has no owning Agent binding`);
    if (req.actor && (req.actor.type !== "agent" || req.actor.id !== def.agentId)) {
      throw new Error(`runById: caller actor does not match owning Agent ${def.agentId}`);
    }
    return this.#runDefinition(
      def,
      req,
      { type: "agent", id: def.agentId, ...(def.agentPlane ? { plane: def.agentPlane } : {}) },
      ctx,
    );
  }

  /** Invoke a Tool — its composition runs through the pipeline like a ritual. */
  async runTool(req: RitualRunByIdRequest, ctx: RunCtx): Promise<RitualRunResult> {
    if (!this.#toolRegistry) throw new Error("runTool: no ToolRegistry configured");
    const def = await this.#toolRegistry.load(req.workspaceId, req.ritualId);
    if (!def) throw new Error(`runTool: tool ${req.ritualId} not found`);
    if (!req.actor) throw new Error(`runTool: tool ${req.ritualId} requires an actor`);
    return this.#runDefinition(def, req, req.actor, ctx);
  }

  async #runDefinition(
    def: RitualDefinition,
    req: RitualRunByIdRequest,
    actor: Actor,
    ctx: RunCtx,
  ): Promise<RitualRunResult> {
    const steps: RitualStep[] = def.steps.map((s) => ({
      skill: s.skill,
      action: s.action,
      resourceType: s.resourceType,
      ...(s.resourceId ? { resourceId: s.resourceId } : {}),
      // Run-time params shallow-merge over the step's static config inputs.
      inputs: req.params ? { ...(s.inputs ?? {}), ...req.params } : (s.inputs ?? {}),
      ...(s.dataScope ? { dataScope: s.dataScope } : {}),
    }));
    const runId = ctx.ids.next();
    return this.#execute(runId, req.workspaceId, def.id, actor, req.onBehalfOf, steps, req.seed, ctx);
  }

  async #execute(
    runId: string,
    workspaceId: string,
    ritualId: string,
    actor: Actor,
    onBehalfOf: OnBehalfOf | undefined,
    steps: RitualStep[],
    seed: string | undefined,
    ctx: RunCtx,
  ): Promise<RitualRunResult> {
    await this.#recorder?.start({ runId, ritualId, workspaceId, actorId: actor.id }, ctx);
    const proposals: Proposal[] = [];

    for (let i = 0; i < steps.length; i++) {
      const step = steps[i]!;
      const proposal = await this.#pipeline.propose(
        {
          workspaceId,
          actor,
          ...(onBehalfOf ? { onBehalfOf } : {}),
          action: step.action,
          resourceType: step.resourceType,
          ...(step.resourceId ? { resourceId: step.resourceId } : {}),
          inputs: step.inputs,
          skill: step.skill,
          ...(step.dataScope ? { dataScope: step.dataScope } : {}),
          context: { type: "ritual", id: ritualId, runId },
          ...(seed ? { seed } : {}),
        },
        ctx,
      );
      proposals.push(proposal);

      if (proposal.status === "rejected") {
        const result: RitualRunResult = { runId, ritualId, status: "halted", proposals, haltedAtStep: i };
        await this.#recorder?.finish({ runId, status: "halted", output: { haltedAtStep: i } }, ctx);
        return result;
      }
    }

    await this.#recorder?.finish(
      { runId, status: "completed", output: { steps: proposals.length } },
      ctx,
    );
    return { runId, ritualId, status: "completed", proposals };
  }
}
