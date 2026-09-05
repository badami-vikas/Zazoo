import { TRPCError } from "@trpc/server";
import { mkdir } from "node:fs/promises";
import { z } from "zod";
import { INTERNAL_STRATEGIST_AGENT, chatCaptureSignalId } from "../wiring.js";
import { ChatCloudGrantError, ChatStoreConflictError, ChatStoreScopeError, CHAT_BACKEND_IDS, type ChatBackendTurn } from "@bridge/core";
import { createModelRouter, MANAGED_LLAMA_PROVIDER_ID } from "@bridge/models";
import { captureAllowed, chatTurnCaptureSignal, detectCommitmentCandidates, proposeCommitmentSuggestions, recordSignal as recordCaptureSignal } from "@bridge/core";
import { MAX_TRANSCRIPTION_AUDIO_BYTES, transcribeAudio, VoiceTranscriptionError } from "../voice-transcription.js";
import { organizationFilesRoot } from "../module-files.js";
import { relative, sep } from "node:path";
import { BUILT_IN_MODULES } from "@bridge/module-manifests";
import { commonsPriorArt, installedModulesForBriefing, moduleBuildBriefing, organizationFoldersForBriefing } from "../builder/run.js";
import { readModuleManifestFile, registerModuleManifest } from "../module-register.js";
import { ClaudeSignInRequiredError } from "../chat/claude-code-backend.js";
import { deterministicUuid } from "../deterministic-uuid.js";
import { CHAT_MODEL_TIER, addChatTurnRef, appendChatBackendChangedFiles, appendChatRoutingDecision, assembleChatCompletion, authenticatedProcedure, chatAssistantEnvelopeSchema, chatHumanTaint, chatLedgerEntryIsProposal, chatOwnerScope, chatSendInput, chatTurnAbortControllers, chatTurnProposalStaging, composerCapability, createGovernedModelProvider, idempotentUuid, loadChatThreadView, organizationGuard, parseChatAssistantEnvelope, priorTurnsTranscript, readCaptureConsentState, requireOrganizationNameForFiles, resolveChatModel, resolveChatRetryPair, stageChatTaskProposal, t, transcriptionApiKey, type PublicCloudModelEgress } from "../router-shared.js";

export const chatRouter = t.router({
  model: t.router({
    status: authenticatedProcedure
      .input(z.object({ organizationId: z.string().uuid() }).strict())
      .use(organizationGuard).query(async ({ input, ctx }) => {
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
        // Agentic backends the composer may offer. Readiness is asked of the
        // backend itself rather than inferred here, so "needs sign-in" comes
        // from the thing that would actually fail.
        const backends = await Promise.all(
          ctx.wiring.chatBackends.list().map(async (backend) => ({
            id: backend.id,
            label: backend.label,
            plane: backend.plane,
            agentic: backend.agentic,
            ...(await backend.readiness(input.organizationId)),
          })),
        );
        return {
          local,
          backends,
          // TASK-082: the same key read, reused a third time, to say whether
          // the composer's paperclip and mic can actually act here.
          composer: composerCapability({
            publicCloudOnly: ctx.wiring.publicCloudOnly,
            groqKeySaved: cloudKeySaved,
          }),
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
    install: authenticatedProcedure
      .input(z.object({ organizationId: z.string().uuid() }).strict())
      .use(organizationGuard).mutation(async ({ input, ctx }) => {
        return ctx.wiring.managedModel.install();
      }),
    /**
     * Claude sign-in for the agentic backend — the browser does the
     * authenticating and Bridge never sees a password. `begin` returns the
     * URL to open; the Claude callback page shows a `code#state` string the
     * user pastes into `complete`. Tokens land in the Local Plane vault, so
     * these three procedures never return or accept a secret Bridge could
     * leak: an authorization code is single-use and useless without the
     * PKCE verifier held in this process.
     */
    claudeSignIn: t.router({
      status: authenticatedProcedure
        .input(z.object({ organizationId: z.string().uuid() }).strict())
        .use(organizationGuard).query(async ({ input, ctx }) => {
          return ctx.wiring.claudeOAuth.status(input.organizationId);
        }),
      begin: authenticatedProcedure
        .input(z.object({ organizationId: z.string().uuid() }).strict())
        .use(organizationGuard).mutation(async ({ input, ctx }) => {
          return { url: ctx.wiring.claudeOAuth.beginLogin(input.organizationId) };
        }),
      complete: authenticatedProcedure
        .input(z.object({
          organizationId: z.string().uuid(),
          code: z.string().trim().min(1).max(2_000),
        }).strict())
        .use(organizationGuard).mutation(async ({ input, ctx }) => {
          await ctx.wiring.claudeOAuth.finishLogin(input.organizationId, input.code);
          return ctx.wiring.claudeOAuth.status(input.organizationId);
        }),
      signOut: authenticatedProcedure
        .input(z.object({ organizationId: z.string().uuid() }).strict())
        .use(organizationGuard).mutation(async ({ input, ctx }) => {
          await ctx.wiring.claudeOAuth.signOut(input.organizationId);
          return ctx.wiring.claudeOAuth.status(input.organizationId);
        }),
    }),
    cancelInstall: authenticatedProcedure
      .input(z.object({ organizationId: z.string().uuid() }).strict())
      .use(organizationGuard).mutation(async ({ input, ctx }) => {
        return ctx.wiring.managedModel.cancelInstall();
      }),
    start: authenticatedProcedure
      .input(z.object({ organizationId: z.string().uuid() }).strict())
      .use(organizationGuard).mutation(async ({ input, ctx }) => {
        await ctx.wiring.managedModel.requestStart();
        return ctx.wiring.managedModel.status();
      }),
    stop: authenticatedProcedure
      .input(z.object({ organizationId: z.string().uuid() }).strict())
      .use(organizationGuard).mutation(async ({ input, ctx }) => {
        await ctx.wiring.managedModel.requestStop();
        return ctx.wiring.managedModel.status();
      }),
  }),

  thread: t.router({
    create: authenticatedProcedure
      .input(z.object({
        organizationId: z.string().uuid(),
        plane: z.enum(["local", "cloud"]).optional(),
        backend: z.enum(CHAT_BACKEND_IDS).optional(),
        title: z.string().trim().min(1).max(200).optional(),
        clientRequestId: z.string().trim().min(1).max(200).optional(),
      }).strict())
      .use(organizationGuard).mutation(async ({ input, ctx }) => {
        if (ctx.wiring.publicCloudOnly && input.plane === "local") {
          throw new TRPCError({
            code: "FORBIDDEN",
            message: "The hosted web deployment cannot create Local Plane Chat threads",
          });
        }
        const backend = input.backend ?? "bridge";
        // An agentic backend declares its own residency (it ships file
        // contents to a hosted model), so the thread's plane follows the
        // BACKEND rather than the caller's plane hint. Getting this wrong in
        // the permissive direction would file cloud egress under a Local
        // Plane thread, which is the one mislabelling the residency model
        // cannot absorb.
        const registered = backend === "bridge" ? null : ctx.wiring.chatBackends.get(backend);
        if (backend !== "bridge" && !registered) {
          throw new TRPCError({
            code: "PRECONDITION_FAILED",
            message: `The ${backend} backend is not available in this deployment`,
          });
        }
        const plane = registered
          ? registered.plane
          : ctx.wiring.publicCloudOnly
            ? "cloud"
            : input.plane ?? "local";
        const scope = chatOwnerScope(input.organizationId, ctx.identity.id);
        const thread = await ctx.wiring.chatStore.createThread(scope, {
          id: input.clientRequestId
            ? idempotentUuid(
                `${input.organizationId}:${ctx.identity.id}:chat-thread:${plane}:${backend}:${input.clientRequestId}`,
              )
            : ctx.run.ids.next(),
          plane,
          dataScope: plane === "local" ? "private" : "public",
          backend,
          ...(input.title ? { title: input.title } : {}),
        });
        return loadChatThreadView(ctx.wiring, scope, thread.id, ctx.run);
      }),
    /**
     * Change which engine answers a LIVE thread, keeping every turn. The
     * conversation is Bridge's; the model is a setting on it, not a reason to
     * start over (user directive, 2026-09-02: "the chat should remain
     * consistent since Bridge is managing context and should direct the chat
     * to a given model").
     *
     * The plane follows the backend, so switching a private Local thread onto
     * a cloud backend relabels its stored turns — a declassification the
     * store records. The user directed that this happen without a prompt;
     * `chatBackendDeclassification` writes the ledger row regardless, so the
     * export is auditable even though it is not interrupted.
     */
    setBackend: authenticatedProcedure
      .input(z.object({
        organizationId: z.string().uuid(),
        threadId: z.string().uuid(),
        backend: z.enum(CHAT_BACKEND_IDS),
        plane: z.enum(["local", "cloud"]).optional(),
      }).strict())
      .use(organizationGuard).mutation(async ({ input, ctx }) => {
        const scope = chatOwnerScope(input.organizationId, ctx.identity.id);
        const thread = await ctx.wiring.chatStore.getThread(scope, input.threadId);
        if (!thread) {
          throw new TRPCError({ code: "NOT_FOUND", message: "Chat thread not found" });
        }
        if (thread.backend === input.backend) {
          return loadChatThreadView(ctx.wiring, scope, thread.id, ctx.run);
        }
        const registered =
          input.backend === "bridge" ? null : ctx.wiring.chatBackends.get(input.backend);
        if (input.backend !== "bridge" && !registered) {
          throw new TRPCError({
            code: "PRECONDITION_FAILED",
            message: `The ${input.backend} backend is not available in this deployment`,
          });
        }
        const plane = registered
          ? registered.plane
          : ctx.wiring.publicCloudOnly
            ? "cloud"
            : input.plane ?? thread.plane;
        try {
          await ctx.wiring.chatStore.setThreadBackend(scope, {
            threadId: thread.id,
            backend: input.backend,
            plane,
            dataScope: plane === "local" ? "private" : "public",
          });
        } catch (error) {
          if (error instanceof ChatStoreScopeError) {
            throw new TRPCError({ code: "PRECONDITION_FAILED", message: error.message });
          }
          throw error;
        }
        return loadChatThreadView(ctx.wiring, scope, thread.id, ctx.run);
      }),
    /**
     * The Module's live conversation — reopened, not restarted. Opening a
     * Module resumes its most recent active thread with full history; the
     * first visit creates it. A Module that has never been talked to gets a
     * fresh thread bound to it, so the next visit resumes THAT.
     */
    forModule: authenticatedProcedure
      .input(z.object({
        organizationId: z.string().uuid(),
        moduleName: z.string().trim().min(1).max(120),
        backend: z.enum(CHAT_BACKEND_IDS).optional(),
      }).strict())
      .use(organizationGuard).mutation(async ({ input, ctx }) => {
        const scope = chatOwnerScope(input.organizationId, ctx.identity.id);
        const existing = await ctx.wiring.chatStore.liveModuleThread(scope, input.moduleName);
        if (existing) {
          return loadChatThreadView(ctx.wiring, scope, existing.id, ctx.run);
        }
        const backend = input.backend ?? "bridge";
        const registered =
          backend === "bridge" ? null : ctx.wiring.chatBackends.get(backend);
        if (backend !== "bridge" && !registered) {
          throw new TRPCError({
            code: "PRECONDITION_FAILED",
            message: `The ${backend} backend is not available in this deployment`,
          });
        }
        const plane = registered
          ? registered.plane
          : ctx.wiring.publicCloudOnly
            ? "cloud"
            : "local";
        const created = await ctx.wiring.chatStore.createThread(scope, {
          id: ctx.run.ids.next(),
          plane,
          dataScope: plane === "local" ? "private" : "public",
          backend,
          moduleName: input.moduleName,
        });
        return loadChatThreadView(ctx.wiring, scope, created.id, ctx.run);
      }),
    /** Pull a second Module into this same conversation — one session, several
     * Modules, the way a coding session can hold more than one project. */
    attachModule: authenticatedProcedure
      .input(z.object({
        organizationId: z.string().uuid(),
        threadId: z.string().uuid(),
        moduleName: z.string().trim().min(1).max(120),
      }).strict())
      .use(organizationGuard).mutation(async ({ input, ctx }) => {
        const scope = chatOwnerScope(input.organizationId, ctx.identity.id);
        await ctx.wiring.chatStore.attachModule(scope, input.threadId, input.moduleName);
        return loadChatThreadView(ctx.wiring, scope, input.threadId, ctx.run);
      }),
    list: authenticatedProcedure
      .input(z.object({
        organizationId: z.string().uuid(),
        status: z.enum(["active", "archived"]).optional(),
        cursor: z.object({
          updatedAt: z.string().datetime(),
          id: z.string().uuid(),
        }).strict().optional(),
        limit: z.number().int().min(1).max(100).optional(),
      }).strict())
      .use(organizationGuard).query(async ({ input, ctx }) => {
        return ctx.wiring.chatStore.listThreads(
          chatOwnerScope(input.organizationId, ctx.identity.id),
          {
            ...(input.status ? { status: input.status } : {}),
            ...(input.cursor ? { cursor: input.cursor } : {}),
            ...(input.limit ? { limit: input.limit } : {}),
          },
        );
      }),
    get: authenticatedProcedure
      .input(z.object({
        organizationId: z.string().uuid(),
        threadId: z.string().uuid(),
        cursor: z.object({
          sequence: z.number().int().positive(),
        }).strict().optional(),
      }).strict())
      .use(organizationGuard).query(async ({ input, ctx }) => {
        return loadChatThreadView(
          ctx.wiring,
          chatOwnerScope(input.organizationId, ctx.identity.id),
          input.threadId,
          ctx.run,
          input.cursor,
        );
      }),
    archive: authenticatedProcedure
      .input(z.object({
        organizationId: z.string().uuid(),
        threadId: z.string().uuid(),
      }).strict())
      .use(organizationGuard).mutation(async ({ input, ctx }) => {
        const archived = await ctx.wiring.chatStore.archiveThread(
          chatOwnerScope(input.organizationId, ctx.identity.id),
          input.threadId,
        );
        if (!archived) {
          throw new TRPCError({ code: "NOT_FOUND", message: "Chat thread not found" });
        }
        return archived;
      }),
    delete: authenticatedProcedure
      .input(z.object({
        organizationId: z.string().uuid(),
        threadId: z.string().uuid(),
      }).strict())
      .use(organizationGuard).mutation(async ({ input, ctx }) => {
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
    prepareCloud: authenticatedProcedure
      .input(chatSendInput.omit({ clientRequestId: true, cloudGrantId: true }))
      .use(organizationGuard).mutation(async ({ input, ctx }) => {
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

    send: authenticatedProcedure
      .input(chatSendInput)
      .use(organizationGuard).mutation(async ({ input, ctx }) => {
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
          // Agentic backend (Claude Code and, later, Codex/Cursor): the
          // backend runs its OWN tool loop in a subprocess against the
          // user's Bridge documents and returns prose. There is no prompt to
          // assemble, no envelope to parse, and no cloud grant to consume —
          // the backend never saw Bridge's response schema, and the exact
          // context it sends is chosen by that agent rather than by this
          // router, so recording an exact-context consent here would be a
          // false disclosure. What this path DOES keep is the rest of the
          // governed shape: the same turn lifecycle, the same
          // routing-decision ledger row, the same taint label, the same
          // cancellation path.
          if (thread.backend !== "bridge") {
            const backend = ctx.wiring.chatBackends.get(thread.backend);
            if (!backend) {
              throw new TRPCError({
                code: "PRECONDITION_FAILED",
                message: `The ${thread.backend} backend is not available in this deployment`,
              });
            }
            const organizationName = await requireOrganizationNameForFiles(
              ctx.wiring,
              thread.organizationId,
              ctx.identity.id,
            );
            const workingDirectory = organizationFilesRoot(
              organizationName,
              ctx.wiring.moduleFilesBridgeRoot,
            );
            await mkdir(workingDirectory, { recursive: true });

            // Bridge owns the conversation; the backend only owns its own
            // session. When an engine takes over a thread mid-conversation
            // — a model switch, or its first turn after a restart that lost
            // the handle — it has no session to resume, so Bridge hands it
            // what was already said. Without this the user would watch a
            // "continued" chat answer as if the previous turns never
            // happened, which is worse than clearing the thread outright.
            const carriedContext =
              thread.backendSessionId
                ? null
                : await priorTurnsTranscript(ctx.wiring, scope, thread.id);
            const backendPrompt = carriedContext
              ? `${carriedContext}\n\n---\nContinue that conversation. The user now says:\n${input.message}`
              : input.message;

            // The agent gets Bridge's own briefing — what a Module is and how one
            // is built — not just a folder and a sentence (TASK-098). Prior art
            // from Commons rides along as data; an unreachable registry is noted.
            const attachedModule = thread.moduleName ?? null;
            const isNewModule =
              attachedModule !== null &&
              !BUILT_IN_MODULES.some((entry) => entry.manifest.name === attachedModule) &&
              (await ctx.wiring.moduleStore.listVersions(thread.organizationId, attachedModule)).length === 0;
            // What already exists rides along as data too (ADR-247): the
            // Organization's Modules from the store and its folders from disk,
            // each section saying "unavailable" when its read fails.
            const [priorArt, installedModules, folders] = await Promise.all([
              commonsPriorArt(ctx.wiring.commonsRegistry, attachedModule ?? "", input.message),
              installedModulesForBriefing(ctx.wiring.moduleStore, thread.organizationId),
              organizationFoldersForBriefing(workingDirectory),
            ]);
            const system = moduleBuildBriefing({
              organizationRoot: workingDirectory,
              moduleName: attachedModule,
              isNewModule,
              priorArt: priorArt.items,
              priorArtUnavailable: priorArt.unavailable,
              installedModules,
              folders,
            });

            let backendTurn: ChatBackendTurn;
            try {
              backendTurn = await backend.send({
                text: backendPrompt,
                backendSessionId: thread.backendSessionId ?? null,
                workingDirectory,
                organizationId: thread.organizationId,
                signal: controller.signal,
                system,
              });
            } catch (error) {
              if (error instanceof ClaudeSignInRequiredError) {
                throw new TRPCError({
                  code: "UNAUTHORIZED",
                  message: "Claude needs sign-in — open Settings → Claude to sign in",
                });
              }
              throw error;
            }

            // A module.yaml the agent wrote for a Module Bridge does not know yet
            // enters the governed lifecycle here, the same way a Builder Run's
            // does (ADR 2026-09-04): registered private and pending review;
            // `modules.install` stays the proposal that decides whether it runs.
            const registrationNotes: string[] = [];
            for (const changed of backendTurn.changedPaths ?? []) {
              const rel = relative(workingDirectory, changed).split(sep);
              const [moduleName, file] = rel;
              if (rel.length !== 2 || file !== "module.yaml" || !moduleName || !/^[a-z0-9]+(-[a-z0-9]+)*$/.test(moduleName)) continue;
              if (BUILT_IN_MODULES.some((entry) => entry.manifest.name === moduleName)) continue;
              if ((await ctx.wiring.moduleStore.listVersions(thread.organizationId, moduleName)).length > 0) continue;
              try {
                const raw = await readModuleManifestFile(ctx.wiring, organizationName, moduleName);
                if (raw === null) continue;
                const installation = await registerModuleManifest(ctx.wiring, thread.organizationId, raw);
                registrationNotes.push(`Registered the Module "${moduleName}" (${installation.status}) — install it from Modules to make it live.`);
              } catch (error) {
                registrationNotes.push(`Could not register ${moduleName}/module.yaml: ${error instanceof Error ? error.message : String(error)}`);
              }
            }
            if (registrationNotes.length > 0) {
              backendTurn = { ...backendTurn, reply: `${backendTurn.reply}\n\n${registrationNotes.join("\n")}` };
            }

            if (backendTurn.backendSessionId) {
              await ctx.wiring.chatStore.setThreadBackendSession(
                scope,
                thread.id,
                backendTurn.backendSessionId,
              );
            }
            const backendRoutingId = await appendChatRoutingDecision(
              ctx,
              thread,
              assistantTurnId,
              { kind: "direct_answer" },
            );
            await addChatTurnRef(
              ctx.wiring,
              scope,
              thread.id,
              assistantTurnId,
              "routing_decision",
              backendRoutingId,
            );
            if (backendTurn.changedPaths && backendTurn.changedPaths.length > 0) {
              const changedFilesId = await appendChatBackendChangedFiles(
                ctx,
                thread,
                assistantTurnId,
                backendTurn.changedPaths,
              );
              await addChatTurnRef(
                ctx.wiring,
                scope,
                thread.id,
                assistantTurnId,
                "result",
                changedFilesId,
              );
            }
            await ctx.wiring.chatStore.updateTurn(scope, {
              threadId: thread.id,
              turnId: assistantTurnId,
              expectedState: "processing",
              state: "completed",
              content: backendTurn.reply.slice(0, 8_000),
            });
            return loadSendResponse();
          }

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

          if (envelope.kind === "create_task") {
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

    cancel: authenticatedProcedure
      .input(z.object({
        organizationId: z.string().uuid(),
        threadId: z.string().uuid(),
        turnId: z.string().uuid(),
      }).strict())
      .use(organizationGuard).mutation(async ({ input, ctx }) => {
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

  /**
   * TASK-082 — dictation for every surface.
   *
   * The Chat mic used to call `companion_transcribe`, a Tauri command, so it
   * only existed inside the desktop shell and honestly disabled itself in a
   * browser. This is the same Groq Whisper call from the API process, which
   * every surface already talks to, so web and mobile get the identical
   * behaviour instead of a permanently-disabled control.
   *
   * LOCAL PLANE (see `deployment-boundary.ts`): the recording is raw capture.
   * It is decoded, forwarded once, and never persisted. A public-cloud shell
   * refuses — `chat.model.status.composer.voice` says so before the user
   * records anything.
   *
   * The transcript is RETURNED, never sent. The caller puts it in the
   * composer for the human to review, because a Chat turn can start governed
   * Task proposals (AP-168 explicitly did not approve auto-send here).
   */
  voice: t.router({
    transcribe: authenticatedProcedure
      .input(
        z.object({
          organizationId: z.string().uuid(),
          audioBase64: z.string().min(1).max(
            Math.ceil(MAX_TRANSCRIPTION_AUDIO_BYTES * 4 / 3) + 4,
          ),
          mime: z.string().min(1).max(128),
        }).strict(),
      )
      .use(organizationGuard).mutation(async ({ input, ctx }) => {
        const apiKey = await transcriptionApiKey(ctx.wiring, input.organizationId);
        if (!apiKey) {
          throw new TRPCError({
            code: "PRECONDITION_FAILED",
            message: "Voice input needs a Groq key (Settings → API Keys)",
          });
        }
        try {
          return {
            text: await transcribeAudio({
              apiKey,
              audio: Buffer.from(input.audioBase64, "base64"),
              mime: input.mime,
            }),
          };
        } catch (error) {
          if (error instanceof VoiceTranscriptionError) {
            throw new TRPCError({ code: "BAD_REQUEST", message: error.message });
          }
          throw error;
        }
      }),
  }),
});
