/**
 * Universal Action Pipeline — the ONE path every mutation takes (ARCHITECTURE):
 *
 *   Request → Authority → Policy(pre) → Agent+Skill → Policy(runtime)
 *           → User Review(approve|veto|edit) → Ledger(append) → Policy(post)
 *           → Variance Adjuster → Output/Event
 *
 * Draft-then-approve: `propose()` runs authority → pre-policy → skill → runtime-policy
 * and STOPS at a `pending_review` proposal (a ledger row, userDecision=null) unless the
 * action is auto-approvable. `decide()` resolves it: approve/edit commits + emits an
 * event; veto records the decision and feeds the Variance Adjuster. The ledger is
 * append-only — a decision is a NEW row referencing the proposal, never an update.
 */
import { agentFloorDeny, resolveAuthority, type AuthorityDeps } from "./authority.js";
import type {
  EventBus,
  LedgerStore,
  PolicyStore,
  RunCtx,
  SkillRegistry,
  VarianceAdjuster,
} from "./ports.js";
import type {
  ActionRequest,
  Actor,
  Decision,
  LedgerEntry,
  PolicyResult,
  Proposal,
  SkillOutput,
} from "./types.js";

export interface PipelineDeps {
  authority: AuthorityDeps;
  policies: PolicyStore;
  skills: SkillRegistry;
  ledger: LedgerStore;
  events: EventBus;
  variance: VarianceAdjuster;
}

/** Approval is required if any pre/runtime policy says so, OR the actor is an agent
 * (governed agentic execution: agents always draft, humans approve). */
function requiresApproval(actorType: string, results: PolicyResult[]): boolean {
  if (results.some((r) => r.effect === "require_approval")) return true;
  return actorType === "agent";
}

function blocked(results: PolicyResult[]): PolicyResult | undefined {
  return results.find((r) => r.effect === "block");
}

export class UniversalActionPipeline {
  #deps: PipelineDeps;

  constructor(deps: PipelineDeps) {
    this.#deps = deps;
  }

  /** Phase 1: authority → pre-policy → skill → runtime-policy → review gate. */
  async propose(req: ActionRequest, ctx: RunCtx): Promise<Proposal> {
    const { authority, policies, skills, ledger } = this.#deps;

    // 1) Authority (deny-default). nowISO injected for ephemeral expiry checks.
    const auth = await resolveAuthority(
      {
        workspaceId: req.workspaceId,
        actor: req.actor,
        action: req.action,
        resourceType: req.resourceType,
        ...(req.resourceId ? { resourceId: req.resourceId } : {}),
        ...(req.context ? { context: req.context } : {}),
        ...(req.onBehalfOf ? { onBehalfOf: { type: req.onBehalfOf.type, id: req.onBehalfOf.id } } : {}),
        ...(req.dataScope ? { requestedDataScope: req.dataScope } : {}),
      },
      { ...authority, nowISO: ctx.clock.nowISO() },
    );
    if (!auth.allowed) {
      return this.#reject(req, auth, [], `authority: ${auth.reason}`, ctx);
    }

    // 2) Policy(pre)
    const pre = await policies.evaluate({
      workspaceId: req.workspaceId,
      actor: req.actor,
      action: req.action,
      resourceType: req.resourceType,
      resourceId: req.resourceId,
      phase: "pre",
      inputs: req.inputs,
    });
    const preBlock = blocked(pre);
    if (preBlock) return this.#reject(req, auth, pre, `policy(pre): ${preBlock.reason}`, ctx);

    // 3) Agent + Skill — produce the proposed output (NOT yet committed).
    const skill = skills.get(req.skill);
    if (!skill) return this.#reject(req, auth, pre, `unknown skill "${req.skill}"`, ctx);

    // Skills catalog allow-list: an agent may only run skills in its (non-empty)
    // allowed_skills set. Empty = unrestricted. Humans are not gated here.
    if (req.actor.type === "agent") {
      const allowed = await authority.agents.allowedSkills(req.actor.id);
      if (allowed.length > 0 && !allowed.includes(req.skill)) {
        return this.#reject(req, auth, pre, `skill "${req.skill}" not in agent allow-list`, ctx);
      }
    }

    const output = await skill.run(req.inputs, ctx);

    // 4) Policy(runtime) — evaluate the produced output.
    const runtime = await policies.evaluate({
      workspaceId: req.workspaceId,
      actor: req.actor,
      action: req.action,
      resourceType: req.resourceType,
      resourceId: req.resourceId,
      phase: "runtime",
      inputs: req.inputs,
      proposedOutput: output.proposedOutput,
    });
    const all = [...pre, ...runtime];
    const rtBlock = blocked(runtime);
    if (rtBlock) return this.#reject(req, auth, all, `policy(runtime): ${rtBlock.reason}`, ctx);

    // 5) Review gate — append ledger row, status by approval requirement.
    if (requiresApproval(req.actor.type, all)) {
      const entry = await this.#appendLedger(req, output, all, null, ctx);
      return {
        id: entry.id,
        status: "pending_review",
        request: req,
        authority: auth,
        policyResults: all,
        output,
      };
    }

    // Auto-approve path (human + allow policies): commit immediately.
    const entry = await this.#appendLedger(req, output, all, "auto", ctx);
    await this.#commit(entry, ctx);
    return {
      id: entry.id,
      status: "applied",
      request: req,
      authority: auth,
      policyResults: all,
      output,
    };
  }

  /** Phase 2: resolve a pending proposal. Appends a decision row (append-only).
   *
   * `decider` is the actor making the approve/veto/edit call — resolved SERVER-SIDE
   * (never client-asserted) so the gate is meaningful. Agents DRAFT, humans APPROVE:
   * the non-removable agent-floor denies any agent from resolving a proposal, so an
   * in-platform agent can never reach the Approvals decision even with grants. */
  async decide(
    proposalId: string,
    decision: Decision,
    decider: Actor,
    ctx: RunCtx,
    editedOutput?: unknown,
  ): Promise<Proposal> {
    const { ledger } = this.#deps;

    // Gate the approver. `approve` on the ledger is agent-floor-protected: agents may
    // never approve/veto/edit a proposal. Humans pass the floor (the inbox is theirs).
    const floor = agentFloorDeny(decider, "approve", "ledger");
    if (floor) throw new Error(`decide: ${floor}`);

    const original = await ledger.get(proposalId);
    if (!original) throw new Error(`decide: no ledger entry ${proposalId}`);
    if (original.userDecision !== null) {
      throw new Error(`decide: ${proposalId} is not a pending proposal (${original.userDecision})`);
    }
    // Append-only: resolution is the existence of a referencing decision row.
    const existing = await ledger.decisionFor(proposalId);
    if (existing) {
      throw new Error(`decide: proposal ${proposalId} already resolved (${existing.userDecision})`);
    }

    const committedOutput =
      decision === "edit" ? editedOutput : original.proposedOutput;

    // Append a NEW decision row referencing the proposal (never mutate the original).
    const decisionRow: LedgerEntry = {
      id: ctx.ids.next(),
      workspaceId: original.workspaceId,
      actorType: original.actorType,
      actorId: original.actorId,
      ...(original.onBehalfOfType ? { onBehalfOfType: original.onBehalfOfType } : {}),
      ...(original.onBehalfOfId ? { onBehalfOfId: original.onBehalfOfId } : {}),
      ...(original.delegationId ? { delegationId: original.delegationId } : {}),
      action: original.action,
      resourceType: original.resourceType,
      ...(original.resourceId ? { resourceId: original.resourceId } : {}),
      inputs: original.inputs,
      proposedOutput: committedOutput,
      userDecision: decision,
      diff: decision === "edit" ? { from: original.proposedOutput, to: editedOutput } : original.diff,
      policyResults: original.policyResults,
      refLedgerId: original.id,
      ...(original.seed ? { seed: original.seed } : {}),
      createdAt: ctx.clock.nowISO(),
    };
    const persisted = await ledger.append(decisionRow);

    if (decision === "veto") {
      // No commit. Variance Adjuster learns from the veto (tunes params, not code).
      await this.#deps.variance.observe(persisted, ctx);
      return {
        id: persisted.id,
        status: "rejected",
        request: this.#requestFromEntry(original),
        authority: { allowed: true, reason: "authorized; vetoed at review", basis: "role", dataScope: "all" },
        policyResults: original.policyResults,
        rejectionReason: "vetoed by reviewer",
      };
    }

    // approve | edit → commit, post-policy, variance, event.
    await this.#commit(persisted, ctx);
    return {
      id: persisted.id,
      status: "applied",
      request: this.#requestFromEntry(original),
      authority: { allowed: true, reason: "authorized; approved at review", basis: "role", dataScope: "all" },
      policyResults: original.policyResults,
      output: { proposedOutput: committedOutput, ...(persisted.diff ? { diff: persisted.diff } : {}) },
    };
  }

  /** Post-policy → Variance Adjuster → emit event. The "commit" side effects. */
  async #commit(entry: LedgerEntry, ctx: RunCtx): Promise<void> {
    await this.#deps.policies.evaluate({
      workspaceId: entry.workspaceId,
      actor: { type: entry.actorType, id: entry.actorId },
      action: entry.action,
      resourceType: entry.resourceType,
      resourceId: entry.resourceId,
      phase: "post",
      inputs: entry.inputs,
      proposedOutput: entry.proposedOutput,
    });
    await this.#deps.variance.observe(entry, ctx);
    await this.#deps.events.emit({
      id: ctx.ids.next(),
      workspaceId: entry.workspaceId,
      type: `${entry.resourceType}.${entry.action}`,
      entityType: entry.resourceType,
      ...(entry.resourceId ? { entityId: entry.resourceId } : {}),
      payload: { ledgerId: entry.id, decision: entry.userDecision },
      createdAt: ctx.clock.nowISO(),
    });
  }

  async #appendLedger(
    req: ActionRequest,
    output: SkillOutput,
    policyResults: PolicyResult[],
    decision: LedgerEntry["userDecision"],
    ctx: RunCtx,
  ): Promise<LedgerEntry> {
    const entry: LedgerEntry = {
      id: ctx.ids.next(),
      workspaceId: req.workspaceId,
      actorType: req.actor.type,
      actorId: req.actor.id,
      ...(req.onBehalfOf ? { onBehalfOfType: req.onBehalfOf.type, onBehalfOfId: req.onBehalfOf.id } : {}),
      ...(req.onBehalfOf?.delegationId ? { delegationId: req.onBehalfOf.delegationId } : {}),
      action: req.action,
      resourceType: req.resourceType,
      ...(req.resourceId ? { resourceId: req.resourceId } : {}),
      inputs: req.inputs,
      proposedOutput: output.proposedOutput,
      userDecision: decision,
      ...(output.diff ? { diff: output.diff } : {}),
      policyResults,
      ...(req.seed ? { seed: req.seed } : {}),
      createdAt: ctx.clock.nowISO(),
    };
    return this.#deps.ledger.append(entry);
  }

  async #reject(
    req: ActionRequest,
    auth: Proposal["authority"],
    policyResults: PolicyResult[],
    reason: string,
    ctx: RunCtx,
  ): Promise<Proposal> {
    // Even rejections are audited — append a ledger row with no commit.
    const entry: LedgerEntry = {
      id: ctx.ids.next(),
      workspaceId: req.workspaceId,
      actorType: req.actor.type,
      actorId: req.actor.id,
      ...(req.onBehalfOf ? { onBehalfOfType: req.onBehalfOf.type, onBehalfOfId: req.onBehalfOf.id } : {}),
      action: req.action,
      resourceType: req.resourceType,
      ...(req.resourceId ? { resourceId: req.resourceId } : {}),
      inputs: req.inputs,
      userDecision: null,
      policyResults,
      diff: { rejected: reason },
      ...(req.seed ? { seed: req.seed } : {}),
      createdAt: ctx.clock.nowISO(),
    };
    await this.#deps.ledger.append(entry);
    return {
      id: entry.id,
      status: "rejected",
      request: req,
      authority: auth,
      policyResults,
      rejectionReason: reason,
    };
  }

  #requestFromEntry(entry: LedgerEntry): ActionRequest {
    return {
      workspaceId: entry.workspaceId,
      actor: { type: entry.actorType, id: entry.actorId },
      ...(entry.onBehalfOfType && entry.onBehalfOfId
        ? { onBehalfOf: { type: entry.onBehalfOfType, id: entry.onBehalfOfId } }
        : {}),
      action: entry.action,
      resourceType: entry.resourceType,
      ...(entry.resourceId ? { resourceId: entry.resourceId } : {}),
      inputs: entry.inputs,
      skill: "(replayed)",
      ...(entry.seed ? { seed: entry.seed } : {}),
    };
  }
}
