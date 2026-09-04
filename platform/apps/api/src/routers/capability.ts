import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { computeRisk, advance, resolveActivationApproval, compareRuns, computeAqv, buildWhyBetterCard, resolveGates, classifyApprovalBand, canGovernanceAutoApprove, rollupOrgHealth, InvalidTransitionError as CapabilityInvalidTransitionError, EvidenceThresholdError, type CapabilityManifestRow, type WhyBetterCard, type CapabilityHealthRecord, type PendingProposalRecord } from "@bridge/core";
import { transition } from "@bridge/jobpilot";
import { assertPilotOrganization, capabilityActivateInput, capabilityIdInput, capabilityRegisterInput, paginatedInput, procedure, resolverFrom, t, toCoreManifest, toEvidence } from "../router-shared.js";

/**
 * Capability Trust Model (docs/wiki/vision.md). Register creates a `draft`
 * manifest with a COMPUTED risk band (never client-declared). Approve routes
 * a lifecycle transition through the pipeline's own decide() semantics — the
 * decider is ctx.identity (server-resolved), never the request body, and the
 * agent-floor blocks any agent from approving, same guarantee action.decide
 * relies on. Activate enforces requiredApproval + the daily auto-activation
 * budgets + the kill switch before flipping active/trusted.
 */
export const capabilityRouter = t.router({
  /** Register a new capability manifest. Always creates state=draft — "generation
   * only ever creates draft" (Capability Builder never activates). */
  register: procedure.input(capabilityRegisterInput).mutation(async ({ input, ctx }) => {
    assertPilotOrganization(input.organizationId);
    const id = ctx.run.ids.next();

    // Pre-fetch the dependency closure's rows so computeRisk's resolver is a
    // plain synchronous lookup (risk.ts is deliberately store-free/pure).
    const depRows = new Map<string, CapabilityManifestRow>();
    for (const dep of input.dependencies) {
      const row = await ctx.wiring.capabilityStore.getManifest(dep.manifestId);
      if (row) depRows.set(dep.manifestId, row);
    }
    const coreManifest = toCoreManifest(id, input);
    const computedRisk = computeRisk(coreManifest, resolverFrom(depRows));

    const created = await ctx.wiring.capabilityStore.createManifest({
      id,
      organizationId: input.organizationId,
      capabilityType: input.capabilityType,
      name: input.name,
      version: input.version,
      origin: input.origin,
      audience: input.audience,
      manifest: input.manifest ?? { permissions: input.permissions, connectors: input.connectors },
      computedRisk,
      dependencies: input.dependencies,
    });
    const state = await ctx.wiring.capabilityStore.upsertState({
      manifestId: created.id,
      organizationId: input.organizationId,
      state: "draft",
      suspended: false,
      evidence: {},
    });
    return { manifest: created, state };
  }),

  /**
   * The Agent Quality Vector for one capability, computed from the governed
   * episodes it actually produced (A1-R1/F2).
   *
   * Read-only and deterministic: no model call, no write, no promotion side
   * effect. `reliability` and `efficiency` are nullable BY DESIGN — null means
   * "not measured", which is not the same as 0 ("measured and bad"), and callers
   * must render the difference rather than collapsing it.
   */
  quality: procedure
    .input(
      capabilityIdInput.extend({
        from: z.string().datetime().optional(),
        to: z.string().datetime().optional(),
      }),
    )
    .query(async ({ input, ctx }) => {
      const window = {
        ...(input.from ? { from: input.from } : {}),
        ...(input.to ? { to: input.to } : {}),
      };
      const { records, evidence } = await ctx.wiring.aqvSource.listAqvRecords(
        input.manifestId,
        window,
      );
      const aqv = computeAqv(records, window, evidence ?? {});
      return {
        ...aqv,
        capabilityId: input.manifestId,
        /** How many scored episodes carried an execution snapshot. Lets a caller
         * say "3 of 40 episodes instrumented" instead of implying full coverage. */
        instrumentedEpisodes: records.filter((r) => r.executionSnapshot !== undefined).length,
      };
    }),

  /**
   * Advance validated -> approved -> active -> trusted. This is the governed
   * step: it goes through the SAME pipeline decide() semantics action.decide
   * uses — approve is proposed as a pipeline action so a human decision (never
   * an agent) resolves it, and the attempt is audited either way. Entering
   * `trusted` additionally requires the evidence thresholds (lifecycle.ts);
   * an EvidenceThresholdError maps to 400, not a generic 500.
   */
  approve: procedure.input(capabilityIdInput).mutation(async ({ input, ctx }) => {
    const state = await ctx.wiring.capabilityStore.getState(input.manifestId);
    if (!state) throw new TRPCError({ code: "NOT_FOUND", message: "unknown capability manifest" });

    // Agents are blocked from approving a capability the same way they are
    // blocked from resolving any other proposal — resolve via the pipeline's
    // own propose/decide round trip so the agent-floor + audit trail apply
    // unchanged (additive use of the existing pipeline, not a bypass of it).
    const proposal = await ctx.wiring.pipeline.propose(
      {
        organizationId: state.organizationId,
        actor: { type: ctx.identity.type, id: ctx.identity.id },
        action: "approve",
        resourceType: "capability",
        resourceId: input.manifestId,
        inputs: { manifestId: input.manifestId, fromState: state.state },
        skill: "stageMutation",
      },
      ctx.run,
    );
    if (proposal.status === "pending_review") {
      return { proposal, state };
    }
    // Hard-stop on anything other than an authority-granted, auto-applied
    // decision — notably `"rejected"` (authority denied the action or the
    // agent-floor blocked it). Without this, every non-pending status fell
    // through into the state-advance mutation below, so a DENIED approve
    // still mutated (docs/BUGS.md "capability.approve ... mutate even when
    // the governed decision is rejected"). `ProposalStatus` is exactly
    // `"pending_review" | "applied" | "rejected"`, so this only ever
    // catches `"rejected"` here.
    if (proposal.status !== "applied") {
      throw new TRPCError({
        code: "FORBIDDEN",
        message: proposal.rejectionReason ?? "approval was not authorized",
      });
    }

    // EVAL-3 (§4.2): the baseline-vs-candidate "is it better than what we
    // already run?" gate, fired only on the promotion OUT of `validated`.
    // Gates come from policy_params (never hard-coded); the baseline is the
    // active predecessor of the same lineage. Absent a lineage baseline or
    // eval runs on both sides, the gate is not applicable and approve proceeds
    // unchanged (first-of-lineage has nothing to beat).
    let whyBetter: WhyBetterCard | undefined;
    if (state.state === "validated") {
      const manifestRow = await ctx.wiring.capabilityStore.getManifest(input.manifestId);
      const baselineId = manifestRow?.lineageManifestId ?? null;
      if (baselineId) {
        const [candRuns, baseRuns] = await Promise.all([
          ctx.wiring.evalStore.listRuns(input.manifestId, { limit: 1000, offset: 0 }),
          ctx.wiring.evalStore.listRuns(baselineId, { limit: 1000, offset: 0 }),
        ]);
        const candidate = candRuns.items.at(-1);
        const baseline = baseRuns.items.at(-1);
        if (candidate && baseline) {
          const gates = resolveGates(await ctx.wiring.policyParams.get(state.organizationId));
          const comparison = compareRuns(baseline, candidate, gates);
          whyBetter = buildWhyBetterCard(comparison, gates);
          if (comparison.verdict === "reject") {
            throw new TRPCError({
              code: "BAD_REQUEST",
              message: `capability.approve: candidate does not beat baseline — ${whyBetter.headline}`,
              cause: whyBetter,
            });
          }
          if (comparison.verdict !== "promote") {
            // coexist / needs-human: the automated gate declines to auto-advance;
            // the candidate stays validated pending an explicit human decision.
            return { proposal, state, comparison: whyBetter, advanced: false };
          }
        }
      }
    }

    let result;
    try {
      result = advance(state.state, toEvidence(state.evidence), ctx.run.clock.nowISO(), {
        creationRequiredApproval: false,
      });
    } catch (err) {
      if (err instanceof CapabilityInvalidTransitionError || err instanceof EvidenceThresholdError) {
        throw new TRPCError({ code: "BAD_REQUEST", message: err.message });
      }
      throw err;
    }
    const nextState = await ctx.wiring.capabilityStore.upsertState({
      manifestId: input.manifestId,
      organizationId: state.organizationId,
      state: result.nextState,
      ...(result.trustedUntil ? { trustedUntil: result.trustedUntil } : {}),
      suspended: state.suspended,
      ...(state.suspendReason ? { suspendReason: state.suspendReason } : {}),
      evidence: state.evidence,
    });
    return { proposal, state: nextState, ...(whyBetter ? { comparison: whyBetter } : {}) };
  }),

  /**
   * Activate: enforces requiredApproval (risk band x audience x trust grants)
   * + the daily auto-activation budgets + the organization kill switch before
   * treating an activation as auto-approved. A non-"auto" outcome does NOT
   * activate here — it reports the required approval band back to the
   * caller, which routes to `approve` (governance/explicit_human) or a
   * user-pref confirmation UI, matching "Generation != activation."
   */
  activate: procedure.input(capabilityActivateInput).mutation(async ({ input, ctx }) => {
    assertPilotOrganization(input.organizationId);
    const manifestRow = await ctx.wiring.capabilityStore.getManifest(input.manifestId);
    if (!manifestRow) throw new TRPCError({ code: "NOT_FOUND", message: "unknown capability manifest" });
    const state = await ctx.wiring.capabilityStore.getState(input.manifestId);
    if (!state) throw new TRPCError({ code: "NOT_FOUND", message: "unknown capability manifest state" });

    const decision = await resolveActivationApproval({
      organizationId: input.organizationId,
      riskBand: manifestRow.computedRisk,
      audience: manifestRow.audience,
      trustGrants: [], // trust_grants lookup is a store-layer follow-up; none in force yet
      killSwitch: ctx.wiring.capabilityKillSwitch,
      budgets: ctx.wiring.capabilityBudgets,
      todayKey: input.todayKey,
    });

    if (decision.requirement !== "auto") {
      return { activated: false, decision, state };
    }

    if (decision.budgeted && (manifestRow.computedRisk === "informational" || manifestRow.computedRisk === "advisory")) {
      await ctx.wiring.capabilityBudgets.recordAutoActivation(input.organizationId, manifestRow.computedRisk, input.todayKey);
    }
    const nextState = await ctx.wiring.capabilityStore.upsertState({
      manifestId: input.manifestId,
      organizationId: input.organizationId,
      state: "active",
      suspended: false,
      evidence: state.evidence,
    });
    return { activated: true, decision, state: nextState };
  }),

  list: procedure.input(paginatedInput).query(async ({ input, ctx }) => {
    assertPilotOrganization(input.organizationId);
    const { items, total } = await ctx.wiring.capabilityStore.listManifests(input.organizationId, {
      limit: input.limit,
      offset: input.offset,
    });
    return { items, total, hasMore: input.offset + items.length < total };
  }),

  get: procedure.input(capabilityIdInput).query(async ({ input, ctx }) => {
    const manifest = await ctx.wiring.capabilityStore.getManifest(input.manifestId);
    if (!manifest) throw new TRPCError({ code: "NOT_FOUND", message: "unknown capability manifest" });
    const state = await ctx.wiring.capabilityStore.getState(input.manifestId);
    return { manifest, state };
  }),

  /**
   * GOV-1 — the Governance Agent's AUTOMATED approval, gated to the `minor`
   * band ONLY (classifyApprovalBand: the two lowest risk bands AND a built-in/
   * template origin). Moderate/major always route to a human — the Governance
   * Agent never auto-approves them. This encodes the system policy for which
   * capabilities may advance without a human; it does NOT make an agent the
   * ledger decider (the agent-floor forbids that unconditionally — see
   * pipeline.ts). A minor capability advances validated -> approved through the
   * SAME advance()+upsertState the human `approve` path uses.
   */
  governanceAutoApprove: procedure.input(capabilityIdInput).mutation(async ({ input, ctx }) => {
    const manifestRow = await ctx.wiring.capabilityStore.getManifest(input.manifestId);
    if (!manifestRow) throw new TRPCError({ code: "NOT_FOUND", message: "unknown capability manifest" });
    const state = await ctx.wiring.capabilityStore.getState(input.manifestId);
    if (!state) throw new TRPCError({ code: "NOT_FOUND", message: "unknown capability manifest state" });

    const band = classifyApprovalBand({ risk: manifestRow.computedRisk, origin: manifestRow.origin });
    if (!canGovernanceAutoApprove(band)) {
      // moderate / major → the Governance Agent refuses; a human must decide.
      return { autoApproved: false as const, band, state };
    }

    let result;
    try {
      result = advance(state.state, toEvidence(state.evidence), ctx.run.clock.nowISO(), {
        creationRequiredApproval: false,
      });
    } catch (err) {
      if (err instanceof CapabilityInvalidTransitionError || err instanceof EvidenceThresholdError) {
        throw new TRPCError({ code: "BAD_REQUEST", message: err.message });
      }
      throw err;
    }
    const nextState = await ctx.wiring.capabilityStore.upsertState({
      manifestId: input.manifestId,
      organizationId: state.organizationId,
      state: result.nextState,
      ...(result.trustedUntil ? { trustedUntil: result.trustedUntil } : {}),
      suspended: state.suspended,
      ...(state.suspendReason ? { suspendReason: state.suspendReason } : {}),
      evidence: state.evidence,
    });
    return { autoApproved: true as const, band, state: nextState };
  }),

  /**
   * GOV-1 — Governance Agent org-health rollup (agent-quality doc §7):
   * autonomy-pressure / trust-debt / approval-load / violation-trend as a pure
   * view over the organization's REAL capability manifests + states. Pending
   * proposals are the capabilities awaiting a governed approve/activate
   * decision (state validated|approved), risk = computedRisk. `violationSeries`
   * is an honest empty until a violation-history view lands (no fabricated
   * data — see CLAUDE.md's no-dummy-data rule). Renders for a organization.
   */
  orgHealth: procedure.input(paginatedInput).query(async ({ input, ctx }) => {
    assertPilotOrganization(input.organizationId);
    const nowMs = Date.parse(ctx.run.clock.nowISO());
    const { items } = await ctx.wiring.capabilityStore.listManifests(input.organizationId, {
      limit: input.limit,
      offset: input.offset,
    });
    const capabilities: CapabilityHealthRecord[] = [];
    const pendingProposals: PendingProposalRecord[] = [];
    for (const manifest of items) {
      const state = await ctx.wiring.capabilityStore.getState(manifest.id);
      if (!state) continue;
      capabilities.push({
        manifestId: manifest.id,
        state: state.state,
        successRate: state.evidence.successRate ?? 1,
        ...(state.trustedUntil
          ? { trustExpiresInDays: Math.ceil((Date.parse(state.trustedUntil) - nowMs) / 86_400_000) }
          : {}),
      });
      if (state.state === "validated" || state.state === "approved") {
        pendingProposals.push({
          proposalId: manifest.id,
          risk: manifest.computedRisk,
          ageHours: Math.max(0, (nowMs - Date.parse(state.updatedAt)) / 3_600_000),
        });
      }
    }
    return rollupOrgHealth({ capabilities, pendingProposals, violationSeries: [] });
  }),
});
