import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { INTERNAL_STRATEGIST_AGENT, CHIEF_OF_STAFF_AGENT, chatCaptureSignalId } from "../wiring.js";
import { ChatCloudGrantError, ChatStoreConflictError, captureAllowed, chatTurnCaptureSignal, detectCommitmentCandidates, proposeCommitmentSuggestions, recordSignal as recordCaptureSignal } from "@bridge/core";
import { MANAGED_LLAMA_PROVIDER_ID } from "@bridge/models";
import { deterministicUuid } from "../deterministic-uuid.js";
import { t, readCaptureConsentState, procedure, type PublicCloudModelEgress, createGovernedModelProvider, chatAssistantEnvelopeSchema, chatSendInput, idempotentUuid, CHAT_MODULE_SKILL_ID, CHAT_MODEL_TIER, chatTurnAbortControllers, chatTurnProposalStaging, chatOwnerScope, chatHumanTaint, resolveChatModel, assembleChatCompletion, parseChatAssistantEnvelope, addChatTurnRef, appendChatRoutingDecision, stageChatTaskProposal, stageChatModuleProposal, resolveChatRetryPair, loadChatThreadView, chatLedgerEntryIsProposal } from "../router-shared.js";

export const chatRouter = t.router({
  model: t.router({
    status: procedure
      .input(z.object({ organizationId: z.string().uuid() }).strict())
      .query(async ({ input, ctx }) => {
        const local = await ctx.wiring.managedModel.status();
        const cloud = resolveChatModel(ctx.wiring, "cloud");
        // Reuse ModelProviderKeyStore.list's own configured/active bits
        // (ADR-181/AP-104) rather than re-deriving "is a key saved" here —
        // this is the same read Settings -> API Keys shows, just folded
        // into the status Chat already polls so the composer can offer
        // Cloud as a real choice instead of only a forced local-model path.
        const keyStatuses = await ctx.wiring.modelProviderKeys.list(input.organizationId, {
          env: process.env,
          activeProviderIds: new Set(ctx.wiring.models.providers().keys()),
        });
        const cloudKey = keyStatuses.find((status) => status.providerId === "groq");
        const cloudKeySaved = Boolean(cloudKey?.configured || cloudKey?.fromEnvironment);
        return {
          local,
          cloud: cloud
            ? {
                available: true as const,
                providerId: cloud.id,
                modelTier: CHAT_MODEL_TIER,
                configured: true,
                restartRequired: false,
              }
            : {
                available: false as const,
                providerId: null,
                modelTier: CHAT_MODEL_TIER,
                // A key can be saved (Settings -> API Keys) but not yet
                // active in THIS process — `createModelRouter` snapshots
                // providers at construction (ADR-181). Distinguishing the
                // two lets Chat say "restart to activate" instead of the
                // misleading "no key configured" for both cases.
                configured: cloudKeySaved,
                restartRequired: cloudKeySaved,
              },
        };
      }),
    install: procedure
      .input(z.object({ organizationId: z.string().uuid() }).strict())
      .mutation(async ({ input, ctx }) => {
        return ctx.wiring.managedModel.install();
      }),
    cancelInstall: procedure
      .input(z.object({ organizationId: z.string().uuid() }).strict())
      .mutation(async ({ input, ctx }) => {
        return ctx.wiring.managedModel.cancelInstall();
      }),
    start: procedure
      .input(z.object({ organizationId: z.string().uuid() }).strict())
      .mutation(async ({ input, ctx }) => {
        await ctx.wiring.managedModel.requestStart();
        return ctx.wiring.managedModel.status();
      }),
    stop: procedure
      .input(z.object({ organizationId: z.string().uuid() }).strict())
      .mutation(async ({ input, ctx }) => {
        await ctx.wiring.managedModel.requestStop();
        return ctx.wiring.managedModel.status();
      }),
  }),

  thread: t.router({
    create: procedure
      .input(z.object({
        organizationId: z.string().uuid(),
        plane: z.enum(["local", "cloud"]).optional(),
        title: z.string().trim().min(1).max(200).optional(),
        clientRequestId: z.string().trim().min(1).max(200).optional(),
      }).strict())
      .mutation(async ({ input, ctx }) => {
        if (ctx.wiring.publicCloudOnly && input.plane === "local") {
          throw new TRPCError({
            code: "FORBIDDEN",
            message: "The hosted web deployment cannot create Local Plane Chat threads",
          });
        }
        const plane = ctx.wiring.publicCloudOnly ? "cloud" : input.plane ?? "local";
        const scope = chatOwnerScope(input.organizationId, ctx.identity.id);
        const thread = await ctx.wiring.chatStore.createThread(scope, {
          id: input.clientRequestId
            ? idempotentUuid(
                `${input.organizationId}:${ctx.identity.id}:chat-thread:${plane}:${input.clientRequestId}`,
              )
            : ctx.run.ids.next(),
          plane,
          dataScope: plane === "local" ? "private" : "public",
          ...(input.title ? { title: input.title } : {}),
        });
        return loadChatThreadView(ctx.wiring, scope, thread.id, ctx.run);
      }),
    list: procedure
      .input(z.object({
        organizationId: z.string().uuid(),
        status: z.enum(["active", "archived"]).optional(),
        cursor: z.object({
          updatedAt: z.string().datetime(),
          id: z.string().uuid(),
        }).strict().optional(),
        limit: z.number().int().min(1).max(100).optional(),
      }).strict())
      .query(async ({ input, ctx }) => {
        return ctx.wiring.chatStore.listThreads(
          chatOwnerScope(input.organizationId, ctx.identity.id),
          {
            ...(input.status ? { status: input.status } : {}),
            ...(input.cursor ? { cursor: input.cursor } : {}),
            ...(input.limit ? { limit: input.limit } : {}),
          },
        );
      }),
    get: procedure
      .input(z.object({
        organizationId: z.string().uuid(),
        threadId: z.string().uuid(),
        cursor: z.object({
          sequence: z.number().int().positive(),
        }).strict().optional(),
      }).strict())
      .query(async ({ input, ctx }) => {
        return loadChatThreadView(
          ctx.wiring,
          chatOwnerScope(input.organizationId, ctx.identity.id),
          input.threadId,
          ctx.run,
          input.cursor,
        );
      }),
    archive: procedure
      .input(z.object({
        organizationId: z.string().uuid(),
        threadId: z.string().uuid(),
      }).strict())
      .mutation(async ({ input, ctx }) => {
        const archived = await ctx.wiring.chatStore.archiveThread(
          chatOwnerScope(input.organizationId, ctx.identity.id),
          input.threadId,
        );
        if (!archived) {
          throw new TRPCError({ code: "NOT_FOUND", message: "Chat thread not found" });
        }
        return archived;
      }),
    delete: procedure
      .input(z.object({
        organizationId: z.string().uuid(),
        threadId: z.string().uuid(),
      }).strict())
      .mutation(async ({ input, ctx }) => {
        const deleted = await ctx.wiring.chatStore.deleteThread(
          chatOwnerScope(input.organizationId, ctx.identity.id),
          input.threadId,
        );
        if (!deleted) {
          throw new TRPCError({ code: "NOT_FOUND", message: "Chat thread not found" });
        }
        return { deleted: true as const };
      }),
  }),

  turn: t.router({
    prepareCloud: procedure
      .input(chatSendInput.omit({ clientRequestId: true, cloudGrantId: true }))
      .mutation(async ({ input, ctx }) => {
        const scope = chatOwnerScope(input.organizationId, ctx.identity.id);
        const thread = await ctx.wiring.chatStore.getThread(scope, input.threadId);
        if (!thread) {
          throw new TRPCError({ code: "NOT_FOUND", message: "Chat thread not found" });
        }
        if (thread.plane !== "cloud" || thread.dataScope !== "public") {
          throw new TRPCError({
            code: "FORBIDDEN",
            message: "Cloud consent is available only for a public Cloud Plane thread",
          });
        }
        const provider = resolveChatModel(ctx.wiring, "cloud");
        if (!provider) {
          throw new TRPCError({
            code: "PRECONDITION_FAILED",
            message: "No authorized cloud model provider is configured",
          });
        }
        const retryPair = input.retryTurnId
          ? await resolveChatRetryPair(
              ctx.wiring,
              scope,
              thread.id,
              input.retryTurnId,
            )
          : null;
        if (retryPair && retryPair.user.content !== input.message) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "Retry content must match the original user request",
          });
        }
        const prepared = await assembleChatCompletion(
          ctx,
          thread,
          input.message,
          input.surface,
          provider,
          retryPair
            ? [retryPair.user.id, retryPair.assistant.id]
            : [],
        );
        const grantId = ctx.run.ids.next();
        const expiresAt = new Date(
          new Date(ctx.run.clock.nowISO()).getTime() + 5 * 60_000,
        ).toISOString();
        await ctx.wiring.chatStore.createCloudGrant(scope, {
          id: grantId,
          threadId: thread.id,
          contextDigest: prepared.contextDigest,
          providerId: provider.id,
          modelTier: CHAT_MODEL_TIER,
          expiresAt,
        });
        return {
          grantId,
          expiresAt,
          contextDigest: prepared.contextDigest,
          disclosure: prepared.disclosure,
        };
      }),

    send: procedure
      .input(chatSendInput)
      .mutation(async ({ input, ctx }) => {
        const scope = chatOwnerScope(input.organizationId, ctx.identity.id);
        const thread = await ctx.wiring.chatStore.getThread(scope, input.threadId);
        if (!thread) {
          throw new TRPCError({ code: "NOT_FOUND", message: "Chat thread not found" });
        }
        const userTurnId = idempotentUuid(
          `${thread.id}:${input.clientRequestId}:user`,
        );
        const assistantTurnId = idempotentUuid(
          `${thread.id}:${input.clientRequestId}:assistant`,
        );
        if (input.retryTurnId) {
          const retryPair = await resolveChatRetryPair(
            ctx.wiring,
            scope,
            thread.id,
            input.retryTurnId,
          );
          if (
            retryPair.assistant.id !== assistantTurnId ||
            retryPair.user.clientRequestId !== input.clientRequestId ||
            retryPair.user.content !== input.message
          ) {
            throw new TRPCError({
              code: "BAD_REQUEST",
              message: "Retry must preserve the original Chat turn identity and content",
            });
          }
        }
        const taintLabel = chatHumanTaint(
          thread,
          `chat:${thread.id}:${input.clientRequestId}`,
          input.message,
        );
        await ctx.wiring.chatStore.appendTurn(scope, {
          id: userTurnId,
          threadId: thread.id,
          role: "user",
          actorType: "human",
          actorId: thread.ownerUserId,
          content: input.message,
          state: "completed",
          clientRequestId: input.clientRequestId,
          taintLabel,
        });
        // AI Harness K2 (TASK-046): the owner's own turn becomes an
        // envelope-only learning signal — flight on, LOCAL thread, and the
        // chat source's consent explicitly ON (default off). The mapper's
        // envelope type cannot express `content`, so the message text has
        // no path into the signal row; the deterministic id makes a
        // replayed clientRequestId a no-op. Same durability plane as the
        // turn write above, so no catch: if the Memory store is down the
        // request is already failing.
        if (ctx.wiring.learningObservationEnabled && thread.plane === "local") {
          const consent = await readCaptureConsentState(ctx.wiring, input.organizationId);
          if (captureAllowed(consent, "chat")) {
            const signalId = chatCaptureSignalId(userTurnId);
            const owner = { organizationId: input.organizationId, userId: thread.ownerUserId };
            if (!(await ctx.wiring.memoryStore.get(signalId, owner))) {
              const signal = chatTurnCaptureSignal(
                {
                  turnId: userTurnId,
                  threadId: thread.id,
                  plane: thread.plane,
                  surface: input.surface?.kind ?? "chat_panel",
                  sentAt: new Date().toISOString(),
                  taintLabel,
                },
                owner,
                signalId,
              );
              if (signal) await recordCaptureSignal(ctx.wiring.memoryStore, signal);
            }
          }
          // AI Harness K6 (TASK-050): commitment detection over the owner's
          // OWN turn on the conversation surface the assistant is already
          // reading — an in-conversation capability, not ambient capture,
          // so it rides the learning flight rather than the K2 chat
          // capture toggle (whose contract is envelope-only SIGNALS; this
          // writes none — it writes a suggestion quoting the user's own
          // sentence back for a human decision, and only acceptance
          // materializes a Commitment through the governed pipeline).
          // Deterministic lineage per normalized sentence + the annoyance
          // cap keep a re-sent message from re-asking. Same durability
          // plane as the turn write, so no catch.
          const candidates = detectCommitmentCandidates(
            input.message,
            new Date().toISOString(),
          );
          if (candidates.length > 0) {
            await proposeCommitmentSuggestions(ctx.wiring.memoryStore, {
              organizationId: input.organizationId,
              ownerUserId: thread.ownerUserId,
              candidates,
              nextId: () => ctx.run.ids.next(),
              lineageIdFor: deterministicUuid,
              taintLabel,
            });
          }
        }
        const assistantTurn = await ctx.wiring.chatStore.appendTurn(scope, {
          id: assistantTurnId,
          threadId: thread.id,
          role: "assistant",
          actorType: "agent",
          actorId: INTERNAL_STRATEGIST_AGENT,
          content: "",
          state: "queued",
          clientRequestId: `${input.clientRequestId}:assistant`,
          taintLabel,
        });
        const loadSendResponse = () =>
          loadChatThreadView(
            ctx.wiring,
            scope,
            thread.id,
            ctx.run,
            input.retryTurnId
              ? { sequence: assistantTurn.sequence + 1 }
              : undefined,
          );
        try {
          if (assistantTurn.state === "queued") {
            await ctx.wiring.chatStore.updateTurn(scope, {
              threadId: thread.id,
              turnId: assistantTurnId,
              expectedState: "queued",
              state: "processing",
            });
          } else if (assistantTurn.state === "failed") {
            await ctx.wiring.chatStore.updateTurn(scope, {
              threadId: thread.id,
              turnId: assistantTurnId,
              expectedState: "failed",
              state: "processing",
              content: "",
              errorCode: null,
            });
          } else {
            return loadSendResponse();
          }
        } catch (error) {
          if (error instanceof ChatStoreConflictError) {
            return loadSendResponse();
          }
          throw error;
        }

        const controller = new AbortController();
        chatTurnAbortControllers.set(assistantTurnId, controller);
        try {
          const provider = resolveChatModel(ctx.wiring, thread.plane);
          if (!provider) {
            throw new TRPCError({
              code: "PRECONDITION_FAILED",
              message: thread.plane === "local"
                ? "No local model provider is configured"
                : "No authorized cloud model provider is configured",
            });
          }
          if (thread.plane === "local") {
            const status = await ctx.wiring.managedModel.status();
            if (
              provider.id === MANAGED_LLAMA_PROVIDER_ID &&
              status.state !== "ready"
            ) {
              throw new TRPCError({
                code: "PRECONDITION_FAILED",
                message: `The local model is ${status.state}; finish setup before sending`,
              });
            }
            if (input.cloudGrantId) {
              throw new TRPCError({
                code: "BAD_REQUEST",
                message: "A cloud grant cannot be used for a Local Plane thread",
              });
            }
          }

          const prepared = await assembleChatCompletion(
            ctx,
            thread,
            input.message,
            input.surface,
            provider,
            [userTurnId, assistantTurnId],
          );
          let cloudEgress: PublicCloudModelEgress | undefined;
          if (thread.plane === "cloud") {
            if (!input.cloudGrantId) {
              throw new TRPCError({
                code: "PRECONDITION_FAILED",
                message: "This public cloud turn needs fresh exact-context consent",
              });
            }
            await ctx.wiring.chatStore.consumeCloudGrant(scope, {
              id: input.cloudGrantId,
              threadId: thread.id,
              contextDigest: prepared.contextDigest,
              providerId: provider.id,
              modelTier: CHAT_MODEL_TIER,
            });
            cloudEgress = { dataScope: "public", userConfirmed: true };
          }
          const governed = createGovernedModelProvider(
            ctx,
            thread.organizationId,
            provider,
            "governed_chat_turn",
            cloudEgress,
          );
          const completion = await governed.provider.complete({
            ...prepared.request,
            signal: controller.signal,
          });
          const receiptLedgerId = governed.receiptLedgerId();
          if (receiptLedgerId) {
            await addChatTurnRef(
              ctx.wiring,
              scope,
              thread.id,
              assistantTurnId,
              "model_receipt",
              receiptLedgerId,
            );
          }

          let envelope: z.infer<typeof chatAssistantEnvelopeSchema>;
          try {
            envelope = parseChatAssistantEnvelope(completion.text);
          } catch (parseError) {
            if (thread.plane === "cloud") throw parseError;
            const repair = createGovernedModelProvider(
              ctx,
              thread.organizationId,
              provider,
              "governed_chat_turn_repair",
            );
            const repaired = await repair.provider.complete({
              ...prepared.request,
              prompt:
                `${input.message}\n\nThe prior output was invalid. Return only one JSON object matching the response schema.`,
              signal: controller.signal,
            });
            const repairReceipt = repair.receiptLedgerId();
            if (repairReceipt) {
              await addChatTurnRef(
                ctx.wiring,
                scope,
                thread.id,
                assistantTurnId,
                "model_receipt",
                repairReceipt,
              );
            }
            envelope = parseChatAssistantEnvelope(repaired.text);
          }

          if (envelope.kind === "create_module") {
            if (!prepared.canAuthorModule) {
              throw new Error("The model selected a capability that was not disclosed");
            }
            chatTurnProposalStaging.add(assistantTurnId);
            let stagedModule: Awaited<ReturnType<typeof stageChatModuleProposal>>;
            try {
              stagedModule = await stageChatModuleProposal(
                ctx,
                thread,
                assistantTurnId,
                envelope,
              );
            } finally {
              chatTurnProposalStaging.delete(assistantTurnId);
            }
            if (stagedModule.proposal.status !== "pending_review") {
              // Carry the pipeline's own reason. "did not stop for review"
              // alone says a gate refused and nothing about which one.
              throw new Error(
                `The governed Module proposal did not stop for Human review (${stagedModule.proposal.status}: ${stagedModule.proposal.rejectionReason ?? "no reason given"})`,
              );
            }
            const routingId = await appendChatRoutingDecision(
              ctx,
              thread,
              assistantTurnId,
              {
                kind: "skill",
                selectedSkillId: CHAT_MODULE_SKILL_ID,
                selectedAgentId: CHIEF_OF_STAFF_AGENT,
              },
            );
            await addChatTurnRef(
              ctx.wiring,
              scope,
              thread.id,
              assistantTurnId,
              "routing_decision",
              routingId,
            );
            await ctx.wiring.chatStore.updateTurn(scope, {
              threadId: thread.id,
              turnId: assistantTurnId,
              expectedState: "processing",
              state: "awaiting_decision",
              content: envelope.text,
            });
          } else if (envelope.kind === "create_task") {
            if (!prepared.canCreateTask) {
              throw new Error("The model selected a capability that was not disclosed");
            }
            chatTurnProposalStaging.add(assistantTurnId);
            let staged: Awaited<ReturnType<typeof stageChatTaskProposal>>;
            try {
              staged = await stageChatTaskProposal(
                ctx,
                thread,
                assistantTurnId,
                envelope,
              );
            } finally {
              chatTurnProposalStaging.delete(assistantTurnId);
            }
            if (staged.proposal.status !== "pending_review") {
              throw new Error("The governed Task proposal did not stop for Human review");
            }
            const routingId = await appendChatRoutingDecision(
              ctx,
              thread,
              assistantTurnId,
              { kind: "skill", ...staged.resolution },
            );
            await Promise.all([
              addChatTurnRef(
                ctx.wiring,
                scope,
                thread.id,
                assistantTurnId,
                "routing_decision",
                routingId,
              ),
              addChatTurnRef(
                ctx.wiring,
                scope,
                thread.id,
                assistantTurnId,
                "proposal",
                staged.proposal.id,
              ),
              addChatTurnRef(
                ctx.wiring,
                scope,
                thread.id,
                assistantTurnId,
                "automation_run",
                staged.runId,
              ),
            ]);
            await ctx.wiring.chatStore.updateTurn(scope, {
              threadId: thread.id,
              turnId: assistantTurnId,
              expectedState: "processing",
              state: "awaiting_decision",
              content: envelope.text,
            });
          } else {
            const routingId = await appendChatRoutingDecision(
              ctx,
              thread,
              assistantTurnId,
              {
                kind: envelope.kind === "answer" ? "direct_answer" : "clarification",
              },
            );
            await addChatTurnRef(
              ctx.wiring,
              scope,
              thread.id,
              assistantTurnId,
              "routing_decision",
              routingId,
            );
            await ctx.wiring.chatStore.updateTurn(scope, {
              threadId: thread.id,
              turnId: assistantTurnId,
              expectedState: "processing",
              state: "completed",
              content: envelope.text,
            });
          }
          return loadSendResponse();
        } catch (error) {
          const current = await ctx.wiring.chatStore.getTurn(
            scope,
            thread.id,
            assistantTurnId,
          );
          if (current?.state === "cancelled") {
            return loadSendResponse();
          }
          if (current?.state === "processing") {
            const refs = await ctx.wiring.chatStore.listTurnRefs(
              scope,
              thread.id,
              assistantTurnId,
            );
            const proposalRef = refs.find((ref) => ref.kind === "proposal");
            const proposal = proposalRef
              ? await ctx.wiring.ledger.get(proposalRef.refId)
              : null;
            if (proposal && chatLedgerEntryIsProposal(proposal)) {
              await ctx.wiring.chatStore.updateTurn(scope, {
                threadId: thread.id,
                turnId: assistantTurnId,
                expectedState: "processing",
                state: "awaiting_decision",
                ...(current.content
                  ? {}
                  : { content: "This Task proposal is ready for your review." }),
              });
              return loadSendResponse();
            }
            await ctx.wiring.chatStore.updateTurn(scope, {
              threadId: thread.id,
              turnId: assistantTurnId,
              expectedState: "processing",
              state: "failed",
              content: "I couldn't complete this turn. You can retry it safely.",
              errorCode: error instanceof ChatCloudGrantError
                ? "cloud_grant_invalid"
                : error instanceof DOMException && error.name === "AbortError"
                  ? "cancelled"
                  : "chat_turn_failed",
            });
            const runRef = refs.find((ref) => ref.kind === "automation_run");
            const automationRun = runRef
              ? await ctx.wiring.automationRunRecorder.get(
                  thread.organizationId,
                  runRef.refId,
                )
              : null;
            if (automationRun?.status === "running") {
              await ctx.wiring.automationRunRecorder.finish(
                {
                  runId: automationRun.runId,
                  organizationId: thread.organizationId,
                  status: "halted",
                  output: {
                    kind: "error",
                    errorCode: "proposal_staging_failed",
                  },
                },
                ctx.run,
              );
            }
          }
          if (error instanceof TRPCError) throw error;
          if (error instanceof ChatCloudGrantError) {
            throw new TRPCError({ code: "FORBIDDEN", message: error.message });
          }
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: error instanceof Error ? error.message : "Chat turn failed",
          });
        } finally {
          chatTurnAbortControllers.delete(assistantTurnId);
        }
      }),

    cancel: procedure
      .input(z.object({
        organizationId: z.string().uuid(),
        threadId: z.string().uuid(),
        turnId: z.string().uuid(),
      }).strict())
      .mutation(async ({ input, ctx }) => {
        const scope = chatOwnerScope(input.organizationId, ctx.identity.id);
        const turn = await ctx.wiring.chatStore.getTurn(
          scope,
          input.threadId,
          input.turnId,
        );
        if (!turn) {
          throw new TRPCError({ code: "NOT_FOUND", message: "Chat turn not found" });
        }
        if (turn.state !== "processing") {
          throw new TRPCError({
            code: "CONFLICT",
            message: `Chat turn is ${turn.state}, not processing`,
          });
        }
        if (chatTurnProposalStaging.has(turn.id)) {
          throw new TRPCError({
            code: "CONFLICT",
            message: "This turn is staging a governed proposal and can no longer be stopped",
          });
        }
        const refs = await ctx.wiring.chatStore.listTurnRefs(
          scope,
          input.threadId,
          turn.id,
        );
        const proposalRef = refs.find((ref) => ref.kind === "proposal");
        const proposal = proposalRef
          ? await ctx.wiring.ledger.get(proposalRef.refId)
          : null;
        if (proposal && chatLedgerEntryIsProposal(proposal)) {
          await ctx.wiring.chatStore.updateTurn(scope, {
            threadId: input.threadId,
            turnId: turn.id,
            expectedState: "processing",
            state: "awaiting_decision",
            ...(turn.content
              ? {}
              : { content: "This Task proposal is ready for your review." }),
          });
          return loadChatThreadView(
            ctx.wiring,
            scope,
            input.threadId,
            ctx.run,
          );
        }
        chatTurnAbortControllers.get(turn.id)?.abort(
          new DOMException("Chat turn cancelled", "AbortError"),
        );
        await ctx.wiring.chatStore.updateTurn(scope, {
          threadId: input.threadId,
          turnId: input.turnId,
          expectedState: "processing",
          state: "cancelled",
          content: "Stopped.",
          errorCode: "cancelled",
        });
        return loadChatThreadView(
          ctx.wiring,
          scope,
          input.threadId,
          ctx.run,
        );
      }),
  }),
});
