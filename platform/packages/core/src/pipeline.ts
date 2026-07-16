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
import { evaluateTaintedEgress } from "./policy/taint-egress.js";
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
  PostCommitPolicyResult,
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

export interface ProposeOptions {
  /** Server-owned stable ID for an idempotent proposal. Never expose this to untrusted callers. */
  proposalId?: string;
}

/**
 * Thrown by `decide()` when a proposal has already been resolved (a referencing
 * decision row already exists) — including the race where the DB-level partial
 * unique index (`ledger_ref_ledger_id_resolved_uq`) catches a second concurrent
 * decide that slipped past the in-process check. Maps to HTTP 409 at the API
 * boundary (see router.ts's translation of this error, mirroring the
 * `IntegrationFloorScopeError` → 403 pattern).
 */
export class AlreadyResolvedError extends Error {
  constructor(
    public readonly proposalId: string,
    public readonly existingDecision?: string,
  ) {
    super(
      `decide: proposal ${proposalId} already resolved` +
        (existingDecision ? ` (${existingDecision})` : ""),
    );
    this.name = "AlreadyResolvedError";
  }
}

/**
 * Thrown by `decide()` when the decider is floor-denied (an agent attempting to
 * approve/veto/edit — agents draft, only humans approve). The attempt is still
 * audited (an audited-rejection ledger row is appended before this throws — see
 * below). Maps to HTTP 403 at the API boundary.
 */
export class AgentFloorDeniedError extends Error {
  constructor(public readonly reason: string) {
    super(`decide: ${reason}`);
    this.name = "AgentFloorDeniedError";
  }
}

export class NotPendingProposalError extends Error {
  constructor(public readonly proposalId: string) {
    super(`decide: ledger entry ${proposalId} is an audit row, not a pending proposal`);
    this.name = "NotPendingProposalError";
  }
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

/**
 * Narrows a phase="post" policy evaluation down to `PostCommitPolicyResult[]`
 * — the type that makes `block` unrepresentable at this phase (see
 * `PostCommitEffect` in types.ts). `PolicyStore.evaluate()` itself still
 * returns the wide `PolicyResult[]` (shared across pre/runtime/post so
 * `InMemoryPolicyStore`/`DrizzlePolicyStore` need no changes), so this is the
 * one seam that narrows it for the post-commit call site in `#commit`.
 *
 * By the time `#commit` runs, the ledger row is already appended and (for
 * approve/edit/auto) the action is already committed — there is no longer any
 * runtime hook a `block` (or `require_approval`) effect could act on. If a
 * post-commit policy still emits one, that is a policy-authoring bug, not
 * something the pipeline can honor: we drop it and audit the anomaly via
 * `ctx` isn't available here for a ledger append, so it's logged instead —
 * loud enough to catch in observability without inventing a new runtime
 * remediation/compensation path (out of scope; see decisions-log).
 */
function toPostCommitResults(results: PolicyResult[]): PostCommitPolicyResult[] {
  const out: PostCommitPolicyResult[] = [];
  for (const r of results) {
    if (r.effect === "block" || r.effect === "require_approval") {
      // A post-commit block/require_approval is a policy-authoring bug: the action is
      // already committed, so this must be surfaced even though it cannot be honored.
      console.warn(
        `policy(post): effect "${r.effect}" from policy "${r.policyId}" (${r.reason}) cannot be enforced post-commit — ignored`,
      );
      continue;
    }
    out.push({ ...r, phase: "post", effect: r.effect });
  }
  return out;
}

export class UniversalActionPipeline {
  #deps: PipelineDeps;

  constructor(deps: PipelineDeps) {
    this.#deps = deps;
  }

  /** Phase 1: authority → pre-policy → skill → runtime-policy → review gate. */
  async propose(req: ActionRequest, ctx: RunCtx, options: ProposeOptions = {}): Promise<Proposal> {
    const { authority, policies, skills, ledger } = this.#deps;

    // The turn's effective provenance (PI-2). req.trustOrigin (tagged at the ingest
    // edge) wins; otherwise fall back to ambient ctx.taint. Undefined = kernel/user
    // authored, no untrusted content in play.
    const turnTaint = req.trustOrigin ?? ctx.taint;

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
      ...(turnTaint ? { taint: turnTaint } : {}),
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
      ...(turnTaint ? { taint: turnTaint } : {}),
    });
    const all = [...pre, ...runtime];
    const rtBlock = blocked(runtime);
    if (rtBlock) return this.#reject(req, auth, all, `policy(runtime): ${rtBlock.reason}`, ctx);

    // PI-2 — structural tainted-context egress gate. An always-on kernel guarantee (NOT
    // a deployment-configurable policy): when this turn carries untrusted_external
    // content, external:send/share is forced to human review (pending_review), never
    // auto-applied — the RUNTIME data-flow half of the static lethal-trifecta manifest
    // audit (package/risk.ts::packageHasLethalTrifecta). MCP/tool output is DATA: it can
    // taint a turn but never itself triggers a propose(). See ADR-066.
    const egressGate = evaluateTaintedEgress({
      action: req.action,
      resourceType: req.resourceType,
      taint: turnTaint,
    });
    if (egressGate) all.push(egressGate);

    // 5) Review gate — append ledger row, status by approval requirement.
    if (requiresApproval(req.actor.type, all)) {
      const entry = await this.#appendLedger(req, output, all, null, ctx, options.proposalId);
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
    const entry = await this.#appendLedger(req, output, all, "auto", ctx, options.proposalId);
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

  /** Proposals awaiting a human decision — backs the Approvals inbox. Paginated
   * passthrough to the ledger's `listPending` (see `LedgerStore.listPending` doc). */
  async listPending(
    workspaceId: string,
    opts: { limit: number; offset: number },
  ): Promise<{ items: Array<Proposal & { createdAt: string }>; total: number }> {
    const { ledger } = this.#deps;
    const { items, total } = await ledger.listPending(workspaceId, opts);
    return {
      items: items.map((entry) => ({
        id: entry.id,
        status: "pending_review",
        request: this.#requestFromEntry(entry),
        authority: { allowed: true, reason: "pending review", basis: "principal", dataScope: entry.dataScope ?? "private" },
        policyResults: entry.policyResults,
        output: {
          proposedOutput: entry.proposedOutput,
          ...(entry.diff !== undefined ? { diff: entry.diff } : {}),
        },
        createdAt: entry.createdAt,
      })),
      total,
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
    decisionReason?: string,
  ): Promise<Proposal> {
    const { ledger } = this.#deps;

    const original = await ledger.get(proposalId);
    if (!original) throw new Error(`decide: no ledger entry ${proposalId}`);
    if (
      original.refLedgerId !== undefined ||
      original.userDecision !== null ||
      (typeof original.diff === "object" &&
        original.diff !== null &&
        !Array.isArray(original.diff) &&
        "rejected" in original.diff)
    ) {
      throw new NotPendingProposalError(proposalId);
    }

    // Gate the approver. `approve` on the ledger is agent-floor-protected: agents may
    // never approve/veto/edit a proposal. Humans pass the floor (the inbox is theirs).
    // A blocked attempt is audited BEFORE throwing — previously this threw with no ledger
    // row at all, so a blocked approve attempt left no trace in the append-only spine.
    const floor = agentFloorDeny(decider, "approve", "ledger");
    if (floor) {
      await ledger.append({
        id: ctx.ids.next(),
        workspaceId: original.workspaceId,
        actorType: decider.type,
        actorId: decider.id,
        action: "approve",
        resourceType: "ledger",
        resourceId: proposalId,
        inputs: { proposalId, decision },
        userDecision: null,
        policyResults: [],
        diff: { rejected: floor },
        refLedgerId: original.id,
        createdAt: ctx.clock.nowISO(),
      });
      throw new AgentFloorDeniedError(floor);
    }

    // Append-only: resolution is the existence of a referencing decision row. This
    // check narrows the race window but is NOT itself atomic — two concurrent
    // decide() calls can both pass it (TOCTOU). The real guarantee is downstream:
    // - persistent ledger: a partial unique index on ref_ledger_id (non-null
    //   user_decision only) makes the SECOND append() below fail with a unique
    //   violation, which the store translates into AlreadyResolvedError.
    // - in-memory ledger: append() performs its own atomic (synchronous,
    //   no-await-in-between) check-and-mark, so a second "concurrent" call in
    //   tests/single-process use cannot slip past it either.
    const existing = await ledger.decisionFor(proposalId);
    if (existing) {
      throw new AlreadyResolvedError(proposalId, existing.userDecision ?? undefined);
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
      diff:
        decision === "edit"
          ? { from: original.proposedOutput, to: editedOutput }
          : decision === "veto" && decisionReason
            ? {
                ...(typeof original.diff === "object" && original.diff !== null && !Array.isArray(original.diff)
                  ? original.diff
                  : {}),
                reviewReason: decisionReason,
              }
            : original.diff,
      policyResults: original.policyResults,
      refLedgerId: original.id,
      ...(original.seed ? { seed: original.seed } : {}),
      ...(original.dataScope ? { dataScope: original.dataScope } : {}),
      ...(original.context ? { context: original.context } : {}),
      ...(original.trustOrigin ? { trustOrigin: original.trustOrigin } : {}),
      createdAt: ctx.clock.nowISO(),
    };
    // If a second concurrent decide() raced past the pre-check above, the store
    // itself throws AlreadyResolvedError here: the persistent ledger's partial
    // unique index rejects the second insert (translated by DrizzleLedgerStore),
    // and the in-memory ledger's atomic check-and-mark rejects it directly (see
    // InMemoryLedger.append). Either way callers see one consistent typed error
    // regardless of backing store — left uncaught so it propagates to decide()'s
    // caller (and the tRPC boundary maps it to 409).
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

  /**
   * Post-policy → Variance Adjuster → emit event. The "commit" side effects.
   *
   * Post-policy runs AFTER the ledger row is appended (and, for approve/edit/
   * auto, after the action is already committed) — there is nothing left for a
   * `block` effect to block. `toPostCommitResults` narrows the evaluation down
   * to `PostCommitPolicyResult[]` (see types.ts), whose `effect` excludes
   * `block`/`require_approval` by construction, so this call site can never be
   * mistaken for one that honors blocking. The narrowed, advisory-only results
   * are kept (not just discarded) for observability.
   */
  async #commit(entry: LedgerEntry, ctx: RunCtx): Promise<void> {
    const postResults = await this.#deps.policies.evaluate({
      workspaceId: entry.workspaceId,
      actor: { type: entry.actorType, id: entry.actorId },
      action: entry.action,
      resourceType: entry.resourceType,
      resourceId: entry.resourceId,
      phase: "post",
      inputs: entry.inputs,
      proposedOutput: entry.proposedOutput,
    });
    const postCommitResults: PostCommitPolicyResult[] = toPostCommitResults(postResults);
    void postCommitResults; // advisory-only; no phase="post" policy currently acts on this — kept typed for future use, see toPostCommitResults doc.
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
    proposalId?: string,
  ): Promise<LedgerEntry> {
    const entry: LedgerEntry = {
      id: proposalId ?? ctx.ids.next(),
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
      ...(req.dataScope ? { dataScope: req.dataScope } : {}),
      ...(req.context ? { context: req.context } : {}),
      ...(req.trustOrigin ? { trustOrigin: req.trustOrigin } : {}),
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

  /**
   * Reconstruct the ActionRequest a decision's Proposal echoes back. This used to
   * synthesize `skill: "(replayed)"` and silently drop `context`/`dataScope` from
   * the original ledger entry — breaking audit completeness (you couldn't tell
   * which ritual produced a decision or what data tier it touched, since neither
   * the skill name nor the original context/dataScope were persisted anywhere).
   * Both are now real `LedgerEntry` fields (see schema.ts's `ledger.dataScope`/
   * `ledger.context`), threaded through here unchanged. The skill name itself was
   * never persisted on the ledger row at all (only `inputs`/`proposedOutput`
   * are) — `"(replayed)"` is kept ONLY as the literal skill-name placeholder
   * (decide() never re-invokes a skill), now clearly scoped to that one field
   * rather than silently discarding audit context alongside it.
   */
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
      ...(entry.dataScope ? { dataScope: entry.dataScope } : {}),
      ...(entry.context ? { context: entry.context } : {}),
      ...(entry.trustOrigin ? { trustOrigin: entry.trustOrigin } : {}),
    };
  }
}
