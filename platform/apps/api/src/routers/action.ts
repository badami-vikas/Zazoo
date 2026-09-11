import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { databaseUuidSchema } from "@bridge/db";
import { applyApprovedRelationshipMaterialization, isRelationshipSignalEvidence, proposalFromResolvedRelationshipLedger, relationshipOwnerFromLedger, relationshipSignalEvidencePayloadSchema } from "../relationship-materializer.js";
import { isRelationshipMutation, validateRelationshipMutationEdit } from "../relationship-record-materializer.js";
import { isGoogleLinkedInteractionIntake, parseGoogleLinkedInteractionIntake, validateGoogleInteractionEdit } from "../relationship-intake-materializer.js";
import { OUTREACH_AGENT, PILOT_ORGANIZATION } from "../wiring.js";
import { type Action, type DataScope, type ResourceType, AgentFloorDeniedError, AlreadyResolvedError, KERNEL_PASSTHROUGH_SKILL, NotPendingProposalError, labelFromLegacyTrustOrigin, declassifyTaintLabel, deriveDeclassifiedLabel, hashTaintValue, labelAtSource, type Proposal, type LedgerEntry } from "@bridge/core";
import { t, type OutreachDraftResult, outreachDraftsInFlight, stableOutreachProposalId, emitGoogleCaptureSignals, procedure, resolveClientOnBehalfOf, cleanContext, assertPilotOrganization, isPrivateProposalInputs, provisionOutreachDraftTask, assertMembership, proposeInput, decideInput, captureProposalInputSchema, captureProposalOutputSchema, isCaptureProposal, assertPrivateProposalOwner, materializeApprovedCapture, recordRejectedCapture, outreachDraftInput, chatCreateTaskOutputSchema, moduleInstallIdFromProposal, activateApprovedModuleInstallation, validateDealPilotDecision, materializeDealPilotApproval, assertCultureProposalBindingValid, reconcileApprovedExternalEffect, chatOwnerScope, recordChatTaskResult, entryClaimsChatTaskProposal, requireChatTaskProposalBinding, finishChatTaskDecision } from "../router-shared.js";

export const actionRouter = t.router({
  /** Propose a governed mutation → Proposal (pending_review | applied | rejected). */
  propose: procedure.input(proposeInput).mutation(async ({ input, ctx }) => {
    if (ctx.wiring.publicCloudOnly && input.dataScope !== "public") {
      throw new TRPCError({
        code: "PRECONDITION_FAILED",
        message:
          "The public cloud API accepts governed Actions only with explicit public data scope",
      });
    }
    if (input.actor.type === "agent") {
      throw new TRPCError({
        code: "FORBIDDEN",
        message: "Agent proposals must enter through the server-owned Agent runtime",
      });
    }
    // Human identity is SERVER-RESOLVED (ctx.identity), never taken from the request.
    // Agent services invoke the pipeline behind server-owned runtime boundaries rather
    // than allowing a browser to choose an Agent id.
    const actor = {
      type: ctx.identity.type,
      id: ctx.identity.id,
      plane: ctx.wiring.publicCloudOnly ? "cloud" as const : "local" as const,
    };
    const onBehalfOf = resolveClientOnBehalfOf(ctx.identity, input.onBehalfOf);
    return ctx.wiring.pipeline.propose(
      {
        organizationId: input.organizationId,
        actor,
        ...(onBehalfOf ? { onBehalfOf } : {}),
        action: input.action as Action,
        resourceType: input.resourceType as ResourceType,
        ...(input.resourceId ? { resourceId: input.resourceId } : {}),
        inputs: input.inputs,
        taintLabel: labelAtSource("human_input", {
          ref: `action.propose:${ctx.identity.id}:${input.seed ?? "unseeded"}`,
          valueHash: hashTaintValue(input.inputs),
          sensitivity:
            input.dataScope === "public" ? "public" : "organization",
          instructionRisk: "instruction_like",
        }),
        skill: KERNEL_PASSTHROUGH_SKILL,
        ...(input.dataScope ? { dataScope: input.dataScope as DataScope } : {}),
        ...(cleanContext(input.context) ? { context: cleanContext(input.context)! } : {}),
        ...(input.seed ? { seed: input.seed } : {}),
        ...(input.goalTaskRef ? { goalTaskRef: input.goalTaskRef } : {}),
      },
      ctx.run,
    );
  }),

  /** A constrained browser request for the server-owned Outreach Agent to draft
   * one relationship Event. The caller controls the content, never Agent
   * identity, Skill, governed resource/action, or approval policy. */
  proposeOutreachDraft: procedure
    .input(outreachDraftInput)
    .mutation(async ({ input, ctx }) => {
      if (ctx.identity.type !== "user") {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "Only a user can request an Outreach Agent draft",
        });
      }

      const idempotencyKey = `${input.organizationId}:${ctx.identity.id}:${input.sourceId}`;
      const proposalId = stableOutreachProposalId(idempotencyKey);
      const active = outreachDraftsInFlight.get(idempotencyKey);
      if (active) return active;

      const operation = (async (): Promise<OutreachDraftResult> => {
        let offset = 0;
        while (true) {
          const pending = await ctx.wiring.pipeline.listPending(input.organizationId, {
            limit: 200,
            offset,
          });
          const existing = pending.items.find((proposal) => {
            const inputs = proposal.request.inputs;
            return (
              typeof inputs === "object" &&
              inputs !== null &&
              "sourceId" in inputs &&
              inputs.sourceId === input.sourceId &&
              proposal.request.actor.type === "agent" &&
              proposal.request.actor.id === OUTREACH_AGENT &&
              proposal.request.onBehalfOf?.type === "user" &&
              proposal.request.onBehalfOf.id === ctx.identity.id
            );
          });
          if (existing) return existing;
          offset += pending.items.length;
          if (pending.items.length === 0 || offset >= pending.total) break;
        }

        const goalTaskRef = await provisionOutreachDraftTask(
          ctx.wiring,
          input.organizationId,
        );
        try {
          return await ctx.wiring.pipeline.propose(
            {
              organizationId: input.organizationId,
              actor: { type: "agent", id: OUTREACH_AGENT },
              onBehalfOf: { type: "user", id: ctx.identity.id },
              action: "write",
              resourceType: "event",
              inputs: {
                text: input.proposed,
                sourceId: input.sourceId,
                runId: input.runId ?? null,
                display: {
                  action: input.label,
                  actor: "Outreach Agent",
                  actorKind: "agent",
                  onBehalfOf: "You",
                  resource: input.resource,
                  policy: "Agent-authored relationship drafts require Human approval",
                  channel: input.channel,
                  prior: input.prior ?? null,
                  trace: input.trace,
                },
              },
              skill: "outreach.stageDraft",
              dataScope: "public",
              goalTaskRef,
              ...(input.runId
                ? { context: { type: "automation", id: input.runId, runId: input.runId } }
                : {}),
              seed: input.sourceId,
              trustOrigin: "user_content",
            },
            ctx.run,
            { proposalId },
          );
        } catch (cause) {
          // The ledger primary key is the cross-process idempotency gate. A loser
          // of the insert race returns the winner's pending proposal.
          let offset = 0;
          while (true) {
            const pending = await ctx.wiring.pipeline.listPending(input.organizationId, {
              limit: 200,
              offset,
            });
            const winner = pending.items.find((proposal) => proposal.id === proposalId);
            if (winner) return winner;
            offset += pending.items.length;
            if (pending.items.length === 0 || offset >= pending.total) break;
          }
          const existing = await ctx.wiring.ledger.get(proposalId);
          if (existing) {
            const decision = await ctx.wiring.ledger.decisionFor(proposalId);
            const terminalDecision = decision?.userDecision ?? existing.userDecision;
            if (terminalDecision !== null) {
              return {
                id: proposalId,
                status: "already_resolved" as const,
                decision: terminalDecision,
              };
            }
          }
          throw cause;
        }
      })();
      outreachDraftsInFlight.set(idempotencyKey, operation);
      try {
        return await operation;
      } finally {
        if (outreachDraftsInFlight.get(idempotencyKey) === operation) {
          outreachDraftsInFlight.delete(idempotencyKey);
        }
      }
    }),

  /**
   * Pending proposals awaiting a human decision — backs the Approvals inbox
   * (frontend-migration-scoping.md Phase 2: `action.decide` existed with nothing
   * enumerating what's awaiting approval). Paginated per this repo's list-endpoint
   * convention (dealpilot.list/integration.list). TASK-010 review round-4 item 2:
   * a PRIVATE proposal (`inputs.visibility === "private"`, e.g. a red-flag
   * correction) is filtered out entirely unless it was raised `onBehalfOf`
   * the CALLER — team-visible semantics are completely unchanged for every
   * other (non-private) proposal. Since private-filtering can only be
   * applied after fetching, this loops through the underlying ledger's own
   * pages (the same accumulate-until-exhausted idiom already used by
   * `proposeOutreachDraft`'s idempotency search below) so `total`/`hasMore`
   * describe the CALLER'S actually-visible set, not a page that could
   * under-fill once private proposals exist.
   */
  listPending: procedure
    .input(
      z
        .object({
          organizationId: z.string().min(1),
          limit: z.number().int().min(1).max(200).default(50),
          offset: z.number().int().min(0).default(0),
        })
        .default({ organizationId: PILOT_ORGANIZATION }),
    )
    .query(async ({ input, ctx }) => {
      // TASK-010 review round-4 item 2 + TASK-008 RM4: `privateOwnerUserId`
      // is enforced at the STORE level (`privateProposalOwnerScope` in
      // packages/db/src/ledger-store.ts / `ledgerEntryVisibleToPrivateOwner`
      // in packages/core/src/memory/stores.ts) — widened to cover BOTH
      // RM4's relation-resourceType rows AND TASK-010's own
      // `inputs.visibility === "private"` marker (red-flag correction
      // proposals), so a single query-level filter now protects every
      // private proposal shape without the app-side accumulate-and-filter
      // loop this endpoint previously needed.
      const { items, total } = await ctx.wiring.pipeline.listPending(input.organizationId, {
        limit: input.limit,
        offset: input.offset,
        privateOwnerUserId: ctx.identity.id,
      });
      return { items, total, hasMore: input.offset + items.length < total };
    }),

  /** Bounded Execution Ledger history through the authenticated server seam.
   * Relation rows retain owner isolation after direct browser table access is revoked;
   * TASK-010 review round-5/6: also the replacement for `apps/web/src/app/data/ledger.ts`'s
   * `loadLedger()` direct-Supabase read (docs/BUGS.md 2026-07-17) — the SAME
   * `privateOwnerUserId` store-level filter protects red-flag correction proposals here too. */
  listHistory: procedure
    .input(
      z.object({
        organizationId: z.string().min(1),
        limit: z.number().int().min(1).max(100).default(100),
        offset: z.number().int().min(0).default(0),
      }),
    )
    .query(async ({ input, ctx }) => {
      const { items, total } = await ctx.wiring.ledger.listHistory(
        input.organizationId,
        {
          limit: input.limit,
          offset: input.offset,
          privateOwnerUserId: ctx.identity.id,
        },
      );
      return { items, total, hasMore: input.offset + items.length < total };
    }),

  /** Read the append-only resolution state for idempotent review reconciliation.
   * TASK-010 review round-4 item 2 (closing a gap a fresh independent review
   * found): a PRIVATE proposal's resolution state/decision must be exactly as
   * invisible to a non-owner as `listPending`/`decide` already make it —
   * otherwise a member could infer a private red-flag correction's existence
   * and eventual approve/veto decision just by guessing/observing its
   * proposalId, even though they could never see or resolve it themselves. */
  resolution: procedure
    .input(z.object({ proposalId: z.string().min(1) }))
    .query(async ({ input, ctx }) => {
      const proposal = await ctx.wiring.ledger.get(input.proposalId);
      if (!proposal) throw new TRPCError({ code: "NOT_FOUND", message: "proposal not found" });
      assertPilotOrganization(proposal.organizationId);
      await assertMembership(ctx.wiring.organizationStore, proposal.organizationId, ctx.identity.id);
      assertPrivateProposalOwner(proposal, ctx.identity, ctx.wiring.google);
      const decision = await ctx.wiring.ledger.decisionFor(input.proposalId);
      if (decision) {
        return { status: "resolved" as const, decision: decision.userDecision };
      }
      const rejected =
        typeof proposal.diff === "object" &&
        proposal.diff !== null &&
        !Array.isArray(proposal.diff) &&
        "rejected" in proposal.diff;
      if (proposal.refLedgerId !== undefined || proposal.userDecision !== null || rejected) {
        return { status: "terminal" as const, decision: proposal.userDecision };
      }
      return { status: "pending" as const, decision: null };
    }),

  taintTrace: procedure
    .input(z.object({ proposalId: databaseUuidSchema }))
    .query(async ({ input, ctx }) => {
      const proposal = await ctx.wiring.ledger.get(input.proposalId);
      if (!proposal) {
        throw new TRPCError({ code: "NOT_FOUND", message: "proposal not found" });
      }
      assertPilotOrganization(proposal.organizationId);
      await assertMembership(
        ctx.wiring.organizationStore,
        proposal.organizationId,
        ctx.identity.id,
      );
      assertPrivateProposalOwner(proposal, ctx.identity, ctx.wiring.google);
      const label =
        proposal.taintLabel ??
        labelFromLegacyTrustOrigin(
          proposal.trustOrigin,
          `ledger:${proposal.id}`,
        );
      const [sinkTraces, declassifications] = await Promise.all([
        ctx.wiring.taintAudit.listSinkTraces(
          proposal.organizationId,
          proposal.id,
        ),
        ctx.wiring.taintAudit.listDeclassifications(
          proposal.organizationId,
          label.provenanceHash,
        ),
      ]);
      return {
        label,
        sinkTraces,
        declassifications,
        influencedByUntrusted:
          label.trust === "untrusted" || label.trust === "unknown",
      };
    }),

  declassifyInstructionRisk: procedure
    .input(
      z.object({
        proposalId: z.string().uuid(),
        reason: z.string().trim().min(1).max(500),
        evidenceHash: z.string().regex(/^sha256:[a-f0-9]{64}$/),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      if (ctx.identity.type !== "user") {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "Only an authenticated Human may declassify runtime data",
        });
      }
      const proposal = await ctx.wiring.ledger.get(input.proposalId);
      if (!proposal) {
        throw new TRPCError({ code: "NOT_FOUND", message: "proposal not found" });
      }
      assertPilotOrganization(proposal.organizationId);
      await assertMembership(
        ctx.wiring.organizationStore,
        proposal.organizationId,
        ctx.identity.id,
      );
      assertPrivateProposalOwner(proposal, ctx.identity, ctx.wiring.google);
      const accountableHumanId =
        proposal.onBehalfOfType === "user"
          ? proposal.onBehalfOfId
          : proposal.actorType === "user"
            ? proposal.actorId
            : null;
      if (accountableHumanId !== ctx.identity.id) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message:
            "Only the accountable Human for this proposal may declassify it",
        });
      }
      const decision = await ctx.wiring.ledger.decisionFor(input.proposalId);
      if (
        !decision ||
        (decision.userDecision !== "approve" &&
          decision.userDecision !== "edit")
      ) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message:
            "Declassification requires an explicit approved Human Decision",
        });
      }
      const before =
        decision.taintLabel ??
        proposal.taintLabel ??
        labelFromLegacyTrustOrigin(
          decision.trustOrigin ?? proposal.trustOrigin,
          `ledger:${decision.id}`,
        );
      const after = deriveDeclassifiedLabel(before, {
        instructionRisk: "data",
      });
      let record;
      try {
        record = declassifyTaintLabel({
          id: ctx.run.ids.next(),
          organizationId: proposal.organizationId,
          before,
          after,
          reason: input.reason,
          evidenceHash: input.evidenceHash,
          actor: {
            type: "user",
            id: ctx.identity.id,
            decisionLedgerId: decision.id,
          },
          createdAt: ctx.run.clock.nowISO(),
          plane: proposal.dataScope === "public" ? "cloud" : "local",
        });
      } catch (cause) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: cause instanceof Error ? cause.message : String(cause),
          cause,
        });
      }
      await ctx.wiring.taintAudit.appendDeclassification(record);
      return record;
    }),

  /** Resolve a pending proposal: approve | veto | edit. TASK-010 review
   * round-4 item 2: a PRIVATE proposal may only be decided by the user it
   * was raised `onBehalfOf` — a non-owning member (even though they pass
   * the ordinary organization-membership gate) is rejected FORBIDDEN, never
   * merely filtered from a list. */
  decide: procedure.input(decideInput).mutation(async ({ input, ctx }) => {
    // Decider is the SERVER-RESOLVED identity (ctx.identity), never the client's
    // claimed actor — the agent-floor in decide() blocks any agent from approving.
    const original = await ctx.wiring.ledger.get(input.proposalId);
    if (!original) throw new TRPCError({ code: "NOT_FOUND", message: "proposal not found" });
    assertPilotOrganization(original.organizationId);
    await assertMembership(ctx.wiring.organizationStore, original.organizationId, ctx.identity.id);
    // TASK-011 remediation (2026-07-19 coordinator distributed-defects
    // RE-review round 2, issue 6) — fail-closed backstop BEFORE any
    // decision is resolved: a proposal shaped like a culture-research/
    // synthesis output must carry a valid durable binding.
    await assertCultureProposalBindingValid(ctx.wiring, original);
    // TASK-010: same non-relation-scoped private-proposal guard as
    // `resolution` above — a red-flag correction proposal may only be
    // decided by the user it was raised `onBehalfOf`, even though it
    // passes the ordinary organization-membership gate.
    if (
      original.resourceType !== "relation" &&
      isPrivateProposalInputs(original.inputs) &&
      original.onBehalfOfId !== ctx.identity.id
    ) {
      throw new TRPCError({
        code: "FORBIDDEN",
        message: "This proposal is private to its own owner",
      });
    }
    assertPrivateProposalOwner(original, ctx.identity, ctx.wiring.google);
    const claimsChatTaskProposal = entryClaimsChatTaskProposal(original);
    if (
      claimsChatTaskProposal &&
      (!input.chatThreadId || !input.chatTurnId)
    ) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "Chat Task decisions require their Chat thread and turn ids",
      });
    }
    const chatTaskInput = claimsChatTaskProposal
      ? await requireChatTaskProposalBinding(
          ctx.wiring,
          original,
          ctx.identity.id,
        )
      : null;
    if (input.chatThreadId && input.chatTurnId) {
      if (
        !chatTaskInput ||
        chatTaskInput.chatThreadId !== input.chatThreadId ||
        chatTaskInput.chatTurnId !== input.chatTurnId
      ) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "The Chat lifecycle reference does not match this proposal",
        });
      }
      const chatScope = chatOwnerScope(original.organizationId, ctx.identity.id);
      const refs = await ctx.wiring.chatStore.listTurnRefs(
        chatScope,
        input.chatThreadId,
        input.chatTurnId,
      );
      if (!refs.some((ref) => ref.kind === "proposal" && ref.refId === original.id)) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "The Chat turn is not linked to this proposal",
        });
      }
    }
    const isSignalEvidenceProposal =
      original.resourceType === "relation" &&
      isRelationshipSignalEvidence(original.inputs);
    const isRecordMutationProposal = isRelationshipMutation(original.inputs);
    const isGoogleInteractionIntakeProposal =
      original.dataScope === "private" &&
      isGoogleLinkedInteractionIntake(original.inputs);
    const isCaptureIntakeProposal = isCaptureProposal(original);
    const isRelationshipProposal =
      isSignalEvidenceProposal ||
      isRecordMutationProposal ||
      isGoogleInteractionIntakeProposal;
    const isRetryablePostDecisionProposal =
      isRelationshipProposal || isCaptureIntakeProposal || chatTaskInput !== null;
    let resolved: Proposal | null = null;
    let postDecisionPipelineError: unknown;
    let relationshipDecision: LedgerEntry | null = null;
    let ownerInitiatedRelationshipRetry = false;
    let recordedDecision = input.decision;
    if (isRetryablePostDecisionProposal) {
      const existingDecision = await ctx.wiring.ledger.decisionFor(
        input.proposalId,
      );
      if (existingDecision) {
        if (
          existingDecision.userDecision !== "approve" &&
          existingDecision.userDecision !== "edit"
        ) {
          throw new TRPCError({
            code: "CONFLICT",
            message: `proposal ${input.proposalId} is already resolved`,
          });
        }
        resolved = proposalFromResolvedRelationshipLedger(
          original,
          existingDecision,
        );
        relationshipDecision = existingDecision;
        recordedDecision = existingDecision.userDecision;
        ownerInitiatedRelationshipRetry = true;
      }
    }
    let committedEditedOutput = input.editedOutput;
    if (input.decision === "edit") {
      const originalInputs =
        typeof original.inputs === "object" &&
        original.inputs !== null &&
        !Array.isArray(original.inputs)
          ? (original.inputs as Record<string, unknown>)
          : null;
      if (originalInputs?.kind === "learning_recommendation") {
        if (
          typeof committedEditedOutput !== "object" ||
          committedEditedOutput === null ||
          Array.isArray(committedEditedOutput) ||
          (committedEditedOutput as Record<string, unknown>).kind !==
            "learning_recommendation"
        ) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message:
              "edited Learning output must remain a learning recommendation object",
          });
        }
        const canonical = {
          ...(committedEditedOutput as Record<string, unknown>),
        };
        if (originalInputs.commonsInvocation === undefined) {
          delete canonical.commonsInvocation;
        } else {
          canonical.commonsInvocation = originalInputs.commonsInvocation;
        }
        committedEditedOutput = canonical;
      }
      if (chatTaskInput) {
        const editedTask = chatCreateTaskOutputSchema.safeParse(committedEditedOutput);
        if (!editedTask.success || editedTask.data.taskId !== chatTaskInput.taskId) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message:
              "edited Chat Task output must satisfy the Task contract and cannot retarget the Task",
          });
        }
        committedEditedOutput = editedTask.data;
      }
    }
    if (
      !resolved &&
      input.decision === "edit" &&
      isSignalEvidenceProposal
    ) {
      try {
        const originalPayload =
          relationshipSignalEvidencePayloadSchema.safeParse(original.inputs);
        const editedPayload =
          relationshipSignalEvidencePayloadSchema.safeParse(input.editedOutput);
        if (!originalPayload.success || !editedPayload.success) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message:
              "edited Relationship output must satisfy the Signal evidence Relation contract",
          });
        }
        if (
          editedPayload.data.signalId !== originalPayload.data.signalId ||
          editedPayload.data.sourceEventId !== originalPayload.data.sourceEventId
        ) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message:
              "a Relationship review edit cannot retarget the Signal or source Event",
          });
        }
        committedEditedOutput = editedPayload.data;
        const ownerUserId = relationshipOwnerFromLedger(original);
        if (!ownerUserId) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "edited Relationship output requires a user-owned proposal",
          });
        }
        const detail = await ctx.wiring.graphStore.getSignalEvidenceAnchor(
          original.organizationId,
          ownerUserId,
          editedPayload.data.signalId,
          editedPayload.data.sourceEventId,
        );
        if (
          !detail?.sourceEvent ||
          detail.sourceEvent.id !== editedPayload.data.sourceEventId ||
          !editedPayload.data.participants.some(
            (participant) =>
              participant.recordType === detail.signal.subjectType &&
              participant.recordId === detail.signal.subjectId,
          )
        ) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message:
              "edited Relationship output must retain its accessible Signal subject and source Event",
          });
        }
        const editedParticipantsAccessible =
          await ctx.wiring.graphStore.areRelationshipRecordsAccessible(
            original.organizationId,
            ownerUserId,
            editedPayload.data.participants,
          );
        if (!editedParticipantsAccessible) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message:
              "edited Relationship output contains an inaccessible participant",
          });
        }
      } catch (validationCause) {
        const racedDecision = await ctx.wiring.ledger.decisionFor(
          input.proposalId,
        );
        if (
          racedDecision?.userDecision === "approve" ||
          racedDecision?.userDecision === "edit"
        ) {
          resolved = proposalFromResolvedRelationshipLedger(
            original,
            racedDecision,
          );
          relationshipDecision = racedDecision;
          recordedDecision = racedDecision.userDecision;
          ownerInitiatedRelationshipRetry = true;
        } else if (racedDecision) {
          throw new TRPCError({
            code: "CONFLICT",
            message: `proposal ${input.proposalId} is already resolved`,
          });
        } else {
          throw validationCause;
        }
      }
    }
    if (
      !resolved &&
      input.decision === "edit" &&
      isRecordMutationProposal
    ) {
      try {
        committedEditedOutput = validateRelationshipMutationEdit(
          original.inputs,
          input.editedOutput,
        );
      } catch (cause) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: cause instanceof Error
            ? cause.message
            : "Edited Relationship output is invalid",
        });
      }
    }
    if (
      !resolved &&
      input.decision === "edit" &&
      isGoogleInteractionIntakeProposal
    ) {
      try {
        committedEditedOutput = validateGoogleInteractionEdit(
          original.inputs,
          input.editedOutput,
        );
        const edited = parseGoogleLinkedInteractionIntake(
          committedEditedOutput,
        );
        const participant = await ctx.wiring.graphStore.getPerson(
          original.organizationId,
          ctx.identity.id,
          edited.event.personId,
        );
        if (
          !participant &&
          edited.person?.localPersonId !== edited.event.personId
        ) {
          throw new Error(
            "Google intake review requires an accessible Person participant",
          );
        }
      } catch (cause) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message:
            cause instanceof Error
              ? cause.message
              : "Edited Google intake output is invalid",
        });
      }
    }
    if (
      !resolved &&
      input.decision === "edit" &&
      isCaptureIntakeProposal
    ) {
      try {
        const edited = captureProposalOutputSchema.parse(input.editedOutput);
        const originalCapture = captureProposalInputSchema.parse(original.inputs);
        if (edited.local_media_id !== originalCapture.local_media_id) {
          throw new Error("Capture review cannot retarget Local Media");
        }
        committedEditedOutput = edited;
      } catch (cause) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message:
            cause instanceof Error
              ? cause.message
              : "Edited capture output is invalid",
        });
      }
    }
    if (!resolved) {
      await validateDealPilotDecision(
        ctx.wiring,
        input.proposalId,
        input.decision,
        committedEditedOutput,
      );
      try {
        resolved = await ctx.wiring.pipeline.decide(
          input.proposalId,
          input.decision,
          ctx.identity,
          ctx.run,
          committedEditedOutput,
          input.reason,
        );
      } catch (err) {
        if (err instanceof AlreadyResolvedError) {
          const persistedDecision =
            isRetryablePostDecisionProposal
              ? await ctx.wiring.ledger.decisionFor(input.proposalId)
              : null;
          if (
            persistedDecision?.userDecision !== "approve" &&
            persistedDecision?.userDecision !== "edit"
          ) {
            throw new TRPCError({ code: "CONFLICT", message: err.message });
          }
          resolved = proposalFromResolvedRelationshipLedger(
            original,
            persistedDecision,
          );
          relationshipDecision = persistedDecision;
          recordedDecision = persistedDecision.userDecision;
          ownerInitiatedRelationshipRetry = true;
        } else {
          if (err instanceof NotPendingProposalError) {
            throw new TRPCError({ code: "BAD_REQUEST", message: err.message });
          }
          if (err instanceof AgentFloorDeniedError) {
            throw new TRPCError({ code: "FORBIDDEN", message: err.message });
          }
          const persistedDecision =
            isRetryablePostDecisionProposal
              ? await ctx.wiring.ledger.decisionFor(input.proposalId)
              : null;
          if (
            persistedDecision?.userDecision !== "approve" &&
            persistedDecision?.userDecision !== "edit"
          ) {
            throw err;
          }
          resolved = proposalFromResolvedRelationshipLedger(
            original,
            persistedDecision,
          );
          relationshipDecision = persistedDecision;
          recordedDecision = persistedDecision.userDecision;
          postDecisionPipelineError = err;
          ownerInitiatedRelationshipRetry = true;
        }
      }
    }
    if (!resolved) {
      throw new TRPCError({
        code: "INTERNAL_SERVER_ERROR",
        message: "Action decision did not resolve",
      });
    }
    // Post-approval Google side effects (no-op for unrelated proposals):
    // materialize an intake proposal to the LOCAL graph, or execute an approved
    // external:send through the gate. Runs ONLY after the governed decision.
    let relationshipEffect: Awaited<
      ReturnType<typeof applyApprovedRelationshipMaterialization>
    > | null = null;
    let persistedRelationshipDecision: LedgerEntry | null = null;
    let relationshipApplicationReturned = false;
    let relationshipRecordMaterialization: unknown = null;
    try {
      const relationshipDecisionCandidate =
        isRelationshipProposal
          ? relationshipDecision ??
            await ctx.wiring.ledger.decisionFor(input.proposalId)
          : null;
      if (
        relationshipDecisionCandidate?.userDecision === "approve" ||
        relationshipDecisionCandidate?.userDecision === "edit" ||
        relationshipDecisionCandidate?.userDecision === "veto"
      ) {
        recordedDecision = relationshipDecisionCandidate.userDecision;
      }
      persistedRelationshipDecision =
        relationshipDecisionCandidate?.userDecision === "approve" ||
        relationshipDecisionCandidate?.userDecision === "edit"
          ? relationshipDecisionCandidate
          : null;
      const moduleInstallationId = moduleInstallIdFromProposal(original);
      const moduleInstallation =
        moduleInstallationId && input.decision !== "veto"
          ? await activateApprovedModuleInstallation(
              ctx.wiring,
              original.organizationId,
              moduleInstallationId,
            )
          : undefined;
      relationshipEffect =
        persistedRelationshipDecision && isRelationshipProposal
          ? await applyApprovedRelationshipMaterialization(
              ctx.wiring.graphStore,
              ctx.wiring.relationMaterializations,
              original,
              persistedRelationshipDecision,
              new Date(ctx.run.clock.nowISO()),
              {
                allowExhausted: ownerInitiatedRelationshipRetry,
              },
              ctx.wiring.memoryStore,
            )
          : null;
      relationshipRecordMaterialization =
        persistedRelationshipDecision && isRecordMutationProposal
          ? relationshipEffect?.materialization ?? null
          : null;
      relationshipApplicationReturned =
        persistedRelationshipDecision !== null && isRelationshipProposal;
      const captureDecisionCandidate =
        isCaptureIntakeProposal
          ? relationshipDecision ??
            await ctx.wiring.ledger.decisionFor(input.proposalId)
          : null;
      if (
        captureDecisionCandidate?.userDecision === "approve" ||
        captureDecisionCandidate?.userDecision === "edit"
      ) {
        recordedDecision = captureDecisionCandidate.userDecision;
        await materializeApprovedCapture(
          ctx.wiring,
          original,
          resolved,
          ctx.run,
        );
      } else if (captureDecisionCandidate?.userDecision === "veto") {
        recordedDecision = "veto";
        await recordRejectedCapture(
          ctx.wiring,
          original,
          captureDecisionCandidate,
        );
      }
      const persistedChatDecision = chatTaskInput
        ? await ctx.wiring.ledger.decisionFor(input.proposalId)
        : null;
      const chatDecision =
        persistedChatDecision?.userDecision === "approve" ||
        persistedChatDecision?.userDecision === "edit" ||
        persistedChatDecision?.userDecision === "veto"
          ? persistedChatDecision.userDecision
          : null;
      const chatTaskResult = chatDecision && chatTaskInput
        ? await finishChatTaskDecision(
            ctx.wiring,
            original,
            chatTaskInput,
            persistedChatDecision?.proposedOutput,
            chatDecision,
            ctx.identity.id,
            ctx.run,
          )
        : null;
      if (chatTaskInput && chatTaskResult) {
        const scope = chatOwnerScope(original.organizationId, ctx.identity.id);
        await recordChatTaskResult(
          ctx.wiring,
          scope,
          chatTaskInput,
          chatTaskResult.runId,
        );
      }
      const effects = await ctx.wiring.google.onApproved(input.proposalId, resolved, ctx.run);
      if (effects.materialized) await emitGoogleCaptureSignals(ctx.wiring, resolved);
      const dealPilotEffects =
        resolved.status === "applied"
          ? await materializeDealPilotApproval(ctx.wiring, resolved)
          : [];
      if (postDecisionPipelineError) throw postDecisionPipelineError;
      if (
        relationshipEffect &&
        relationshipEffect.effect.status !== "applied"
      ) {
        const effectsError =
          relationshipEffect.effect.lastError ??
          "Relationship application is already in progress";
        return {
          ...resolved,
          recordedDecision,
          effects,
          dealPilotEffects,
          ...(chatTaskResult ? { chatTaskResult } : {}),
          effectsStatus: "failed" as const,
          effectsError,
          effectsAuditId: undefined,
          ...(moduleInstallation ? { moduleInstallation } : {}),
          relationshipMaterialization: {
            status: relationshipEffect.effect.status,
            error: effectsError,
            reconcileable: true,
            attempts: relationshipEffect.effect.attemptCount,
            maxAttempts: relationshipEffect.effect.maxAttempts,
            leaseRecoveries:
              relationshipEffect.effect.leaseRecoveryCount,
            maxLeaseRecoveries:
              relationshipEffect.effect.maxLeaseRecoveries,
            nextRetryAt:
              relationshipEffect.effect.nextRetryAt?.toISOString() ?? null,
            leaseExpiresAt:
              relationshipEffect.effect.leaseExpiresAt?.toISOString() ??
              null,
          },
        };
      }
      return {
        ...resolved,
        recordedDecision,
        effects,
        dealPilotEffects,
        ...(chatTaskResult ? { chatTaskResult } : {}),
        effectsStatus: "confirmed" as const,
        ...(moduleInstallation ? { moduleInstallation } : {}),
        ...(relationshipEffect?.effect.status === "applied"
          ? {
              relationshipMaterialization: {
               status: "confirmed" as const,
               relationCount: relationshipEffect.effect.relationCount ?? 0,
              },
            }
          : {}),
        ...(relationshipRecordMaterialization !== null
          ? { relationshipRecordMaterialization }
          : {}),
      };
    } catch (cause) {
      const causeMessage = cause instanceof Error ? cause.message : String(cause);
      const pipelineMessage =
        postDecisionPipelineError instanceof Error
          ? postDecisionPipelineError.message
          : postDecisionPipelineError
            ? String(postDecisionPipelineError)
            : null;
      const effectsError =
        pipelineMessage && cause !== postDecisionPipelineError
          ? `Post-decision pipeline failed: ${pipelineMessage}; subsequent approved effect failed: ${causeMessage}`
          : causeMessage;
      const relationshipOwnerUserId = relationshipOwnerFromLedger(original);
      const persistedRelationshipEffect =
        relationshipOwnerUserId &&
        isRelationshipProposal
          ? await ctx.wiring.relationMaterializations.getByProposal(
            original.organizationId,
            relationshipOwnerUserId,
            original.id,
          )
          : null;
      if (
        persistedRelationshipEffect?.status === "applied" &&
        !relationshipApplicationReturned &&
        !postDecisionPipelineError
      ) {
        return {
          ...resolved,
          recordedDecision,
          effects: { materialized: false, sent: false },
          dealPilotEffects: [],
          effectsStatus: "confirmed" as const,
          relationshipMaterialization: {
            status: "confirmed" as const,
            relationCount: persistedRelationshipEffect.relationCount ?? 0,
          },
        };
      }
      let effectsAuditId: string | undefined;
      try {
        const auditId = ctx.run.ids.next();
        await ctx.wiring.ledger.append({
          id: auditId,
          organizationId: resolved.request.organizationId,
          actorType: resolved.request.actor.type,
          actorId: resolved.request.actor.id,
          action: resolved.request.action,
          resourceType: resolved.request.resourceType,
          ...(resolved.request.resourceId ? { resourceId: resolved.request.resourceId } : {}),
          inputs: {
            originalProposalId: input.proposalId,
            display: {
              actor: `${resolved.request.actor.type} · ${resolved.request.actor.id}`,
              resource: `${resolved.request.resourceType}${resolved.request.resourceId ? ` · ${resolved.request.resourceId}` : ""}`,
              policy: "Post-decision effect failed",
            },
          },
          proposedOutput: {
            text: `Approved effect failed: ${effectsError}`,
            executed: false,
            error: effectsError,
          },
          userDecision: "auto",
          policyResults: [],
          diff: { executionFailed: effectsError },
          createdAt: ctx.run.clock.nowISO(),
        });
        effectsAuditId = auditId;
      } catch (auditCause) {
        // An irreversible decision plus a failed effect must stay visible even when
        // the failure-audit append also fails.
        console.error("action.decide: failed to append post-decision effect audit", auditCause);
      }
      return {
        ...resolved,
        recordedDecision,
        effects: { materialized: false, sent: false },
        dealPilotEffects: [],
        effectsStatus: "failed" as const,
        effectsError,
        ...(effectsAuditId ? { effectsAuditId } : {}),
        ...(persistedRelationshipEffect?.status === "applied"
          ? {
              relationshipMaterialization: {
                status: "confirmed" as const,
                relationCount: persistedRelationshipEffect.relationCount ?? 0,
              },
            }
          : isRelationshipProposal &&
              persistedRelationshipDecision !== null
            ? {
                relationshipMaterialization: {
                  status:
                    persistedRelationshipEffect?.status === "pending"
                      ? "pending" as const
                      : "failed" as const,
                  error:
                    persistedRelationshipEffect?.lastError ?? effectsError,
                  reconcileable: true,
                  attempts: persistedRelationshipEffect?.attemptCount ?? 0,
                  maxAttempts: persistedRelationshipEffect?.maxAttempts ?? 5,
                  leaseRecoveries:
                    persistedRelationshipEffect?.leaseRecoveryCount ?? 0,
                  maxLeaseRecoveries:
                    persistedRelationshipEffect?.maxLeaseRecoveries ?? 3,
                  nextRetryAt:
                    persistedRelationshipEffect?.nextRetryAt?.toISOString() ??
                    null,
                  leaseExpiresAt:
                    persistedRelationshipEffect?.leaseExpiresAt?.toISOString() ??
                    null,
                },
              }
            : {}),
      };
    }
  }),

  /** D8 — durable idempotent retry for a post-decision effect that
   * `action.decide` reported `effectsStatus: "failed"` for, when the
   * proposal is NOT a Relationship approval (`relationship.reconcileApproved`)
   * or a Module install approval (`packages.reconcileApproved`) — see
   * `reconcileApprovedExternalEffect` above for the full rationale. Never
   * creates a second review decision; the human approval is immutable. */
  reconcileApproved: procedure
    .input(z.object({ proposalId: z.string().min(1) }))
    .mutation(async ({ input, ctx }) => {
      const original = await ctx.wiring.ledger.get(input.proposalId);
      if (!original) throw new TRPCError({ code: "NOT_FOUND", message: "proposal not found" });
      assertPilotOrganization(original.organizationId);
      await assertMembership(ctx.wiring.organizationStore, original.organizationId, ctx.identity.id);
      return reconcileApprovedExternalEffect(ctx, input.proposalId);
    }),
});
