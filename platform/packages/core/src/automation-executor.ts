/**
 * Automation execution seam. An Automation starts an attributable Agent Run whose
 * ordered Skill steps all pass through the Universal Action Pipeline.
 */
import type { UniversalActionPipeline } from "./pipeline.js";
import type { AutomationDefinition, AutomationRegistry, AutomationRunRecorder, RunCtx } from "./ports.js";
import type { OnBehalfOf, Proposal, ResourceType } from "./types.js";

export interface AutomationStep {
  skill: string;
  action: import("./types.js").Action;
  resourceType: ResourceType;
  resourceId?: string;
  inputs: unknown;
  /** Data tier this step may touch (the per-step access dropdown). Absent = 'all'. */
  dataScope?: import("./data-scope.js").DataScope;
  /** AGS1/TASK-007 — see `AutomationStepDef.goalTaskRef`'s doc comment (ports.ts).
   * Threaded unchanged into this step's `pipeline.propose` call. */
  goalTaskRef?: { goalId: string; taskId: string };
}

export interface AutomationRunResult {
  runId: string;
  automationId: string;
  status: "completed" | "halted";
  /** One proposal per executed step, in order. */
  proposals: Proposal[];
  /** Set when status='halted' — the step index that stopped the run. */
  haltedAtStep?: number;
}

/** Run an Automation by id, loading its Agent and steps from the registry. */
export interface AutomationRunByIdRequest {
  organizationId: string;
  automationId: string;
  onBehalfOf?: OnBehalfOf;
  /** Run-time params shallow-merged into each step's static inputs. */
  params?: Record<string, unknown>;
  seed?: string;
  /** Server-derived idempotent identities for durable trigger retries. */
  runId?: string;
  proposalId?: string;
}

export interface AutomationExecutor {
  runById(req: AutomationRunByIdRequest, ctx: RunCtx): Promise<AutomationRunResult>;
}

export interface AutomationExecutorOpts {
  registry: AutomationRegistry;
  /** Records Automation Runs. Optional for isolated core tests. */
  recorder?: AutomationRunRecorder;
}

/**
 * In-process executor. The stored owning Agent is the only actor: neither a Human
 * nor an Automation can invoke a Skill directly or supply replacement authority.
 */
export class InProcessAutomationExecutor implements AutomationExecutor {
  #pipeline: UniversalActionPipeline;
  #registry: AutomationRegistry;
  #recorder: AutomationRunRecorder | undefined;

  constructor(pipeline: UniversalActionPipeline, opts: AutomationExecutorOpts) {
    this.#pipeline = pipeline;
    this.#registry = opts.registry;
    this.#recorder = opts.recorder;
  }

  async runById(req: AutomationRunByIdRequest, ctx: RunCtx): Promise<AutomationRunResult> {
    const def = await this.#registry.load(req.organizationId, req.automationId);
    if (!def) throw new Error(`runById: Automation ${req.automationId} not found`);
    return this.#runDefinition(def, req, ctx);
  }

  async #runDefinition(
    def: AutomationDefinition,
    req: AutomationRunByIdRequest,
    ctx: RunCtx,
  ): Promise<AutomationRunResult> {
    const steps: AutomationStep[] = def.steps.map((s) => ({
      skill: s.skill,
      action: s.action,
      resourceType: s.resourceType,
      ...(s.resourceId ? { resourceId: s.resourceId } : {}),
      // Run-time params shallow-merge over the step's static config inputs.
      inputs: req.params ? { ...(s.inputs ?? {}), ...req.params } : (s.inputs ?? {}),
      ...(s.dataScope ? { dataScope: s.dataScope } : {}),
      ...(s.goalTaskRef ? { goalTaskRef: s.goalTaskRef } : {}),
    }));
    const runId = req.runId ?? ctx.ids.next();
    return this.#execute(
      runId,
      req.organizationId,
      def.id,
      { id: def.agentId, plane: def.agentPlane },
      req.onBehalfOf,
      steps,
      req.seed,
      req.proposalId,
      ctx,
    );
  }

  async #execute(
    runId: string,
    organizationId: string,
    automationId: string,
    agent: { id: string; plane: import("./types.js").Plane },
    onBehalfOf: OnBehalfOf | undefined,
    steps: AutomationStep[],
    seed: string | undefined,
    proposalId: string | undefined,
    ctx: RunCtx,
  ): Promise<AutomationRunResult> {
    await this.#recorder?.start({ runId, automationId, organizationId, agentId: agent.id }, ctx);
    const proposals: Proposal[] = [];

    for (let i = 0; i < steps.length; i++) {
      const step = steps[i]!;
      const proposal = await this.#pipeline.propose(
        {
          organizationId,
          actor: { type: "agent", id: agent.id, plane: agent.plane },
          ...(onBehalfOf ? { onBehalfOf } : {}),
          action: step.action,
          resourceType: step.resourceType,
          ...(step.resourceId ? { resourceId: step.resourceId } : {}),
          inputs: step.inputs,
          skill: step.skill,
          ...(step.dataScope ? { dataScope: step.dataScope } : {}),
          context: { type: "automation", id: automationId, runId },
          ...(seed ? { seed } : {}),
          ...(step.goalTaskRef ? { goalTaskRef: step.goalTaskRef } : {}),
        },
        ctx,
        i === 0 && proposalId ? { proposalId } : {},
      );
      proposals.push(proposal);

      if (proposal.status === "rejected") {
        const result: AutomationRunResult = {
          runId,
          automationId,
          status: "halted",
          proposals,
          haltedAtStep: i,
        };
        await this.#recorder?.finish({ runId, organizationId, status: "halted", output: { haltedAtStep: i } }, ctx);
        return result;
      }
    }

    await this.#recorder?.finish(
      { runId, organizationId, status: "completed", output: { steps: proposals.length } },
      ctx,
    );
    return { runId, automationId, status: "completed", proposals };
  }
}
