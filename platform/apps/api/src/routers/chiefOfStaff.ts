import { TRPCError } from "@trpc/server";
import { join } from "node:path";
import { classifyIntent, assertChainDepth, MAX_CHAIN_DEPTH, parseMention, parseSkillMention, invokeAgent, buildCommunicationsPersona, DIRECT_REPLY_OUTPUT_CONTRACT, COMMUNICATIONS_SKILL, findFoundationalAgent, buildChiefOfStaffPersona, profileFromRow, type RunCtx, assembleRunContext, projectToSystemPrompt } from "@bridge/core";
import type { RetrievedMemorySnippet } from "@bridge/core";
import { fusedChatMemory } from "../retrieval-fusion.js";
import { CHIEF_OF_STAFF_REGISTRY, chiefOfStaffConverseInput, createGovernedModelProvider, organizationGuard, procedure, resolveConfiguredModel, t } from "../router-shared.js";

export const chiefOfStaffRouter = t.router({
  /**
   * Chief of Staff v1 (docs/wiki/roadmap.md P1) — the default interlocutor.
   * Classifies the message with @bridge/core's classifyIntent (model-backed
   * when a provider is registered, deterministic keyword fallback otherwise
   * — offline/in-memory mode must still answer) and, when it routes, ALWAYS
   * proposes the routed action through the SAME governed pipeline
   * `action.propose` uses — never executes anything directly. Star topology:
   * at most ONE downstream route per turn, hard chain-depth cap enforced via
   * `assertChainDepth` BEFORE attempting to route (falls back to a direct
   * reply, "best-so-far", once the cap is hit rather than erroring the turn).
   */
  converse: procedure.input(chiefOfStaffConverseInput).use(organizationGuard).mutation(async ({ input, ctx }) => {
    if (input.cloudModelEgress) {
      throw new TRPCError({
        code: "PRECONDITION_FAILED",
        message:
          "Caller-confirmed cloud egress is retired. Use chat.turn.prepareCloud and a single-use exact-context grant.",
      });
    }

    // Resolve the Chief-of-Staff persona server-side from stored onboarding
    // context. Avatar style is intentionally absent: visual choice never
    // changes an Agent's tone, authority, or behavior.
    const profileRow = await ctx.wiring.onboardingProfileStore.get(input.organizationId);
    const profile = profileRow ? profileFromRow(profileRow) : undefined;
    const cosPersona = buildChiefOfStaffPersona(profile ?? { organizationId: input.organizationId, source: "onboarding" });
    // Additive, display-only projection of the resolved CoS identity so the
    // client/avatar can reflect it — two different profiles yield two different
    // persona cards, observable at the API boundary. Never carries authority.
    const personaCard = { id: cosPersona.id, name: cosPersona.name, ...(cosPersona.tone ? { tone: cosPersona.tone } : {}) };

    // AI Harness K4: retrieval fusion feeds EVERY run through the context
    // door, not just chat.turn.send — the @communications and @agent paths
    // below fill the memory slot K0 reserved. Gated per-run on the flight
    // AND on the resolved provider's plane: local-plane private memory
    // never rides into a cloud model's prompt (the same per-turn provider-
    // plane gate chat.turn.send applies). Best-effort — a run never fails
    // because retrieval did; the Layer B budget is enforced at the door.
    const fusedConverseMemory = async (
      providerPlane: "local" | "cloud" | undefined,
      query: string,
    ): Promise<RetrievedMemorySnippet[]> => {
      if (!ctx.wiring.retrievalFusionEnabled || providerPlane !== "local") return [];
      try {
        const fused = await fusedChatMemory({
          memoryStore: ctx.wiring.memoryStore,
          vectorIndex: ctx.wiring.vectorIndex,
          graphStore: ctx.wiring.graphStore,
          ...(ctx.wiring.claimSubstrateEnabled ? { claimStore: ctx.wiring.claimStore } : {}),
          organizationId: input.organizationId,
          ownerUserId: ctx.identity.id,
          query,
          ...(ctx.wiring.semanticEmbedder ? { embedder: ctx.wiring.semanticEmbedder } : {}),
        });
        return fused.snippets;
      } catch {
        return [];
      }
    };

    // A leading "@communications"/"@comms" mention resolves to the
    // Communications SKILL (ADR-046), not an agent — no identity, no
    // capability_scope, just a direct model-backed drafting reply. Checked
    // before the agent-mention branch since the two mention sets are
    // disjoint (COMMUNICATIONS_SKILL.mentions was removed from
    // FOUNDATIONAL_AGENTS' registry).
    const skillMention = parseSkillMention(input.message);
    if (skillMention.skill === "communications") {
      const configuredModel = resolveConfiguredModel(
        ctx.wiring.models,
        "default",
        input.cloudModelEgress,
      );
      const governedModel = configuredModel
        ? createGovernedModelProvider(
            ctx,
            input.organizationId,
            configuredModel,
            "communications_draft",
            input.cloudModelEgress,
          )
        : undefined;
      // AI Harness K0 (ADR-211): the Communications turn assembles a real
      // ModelRunContext — the system prompt is a projection, never a
      // hand-rolled string, so the kernel invariants and the K4 memory
      // slot exist here exactly as they do for every other model run.
      // K4: the Communications run retrieves like every other run — same
      // fusion, same provider-plane gate, same Layer B budget at the door.
      const communicationsMemory = await fusedConverseMemory(
        configuredModel?.plane,
        skillMention.rest || input.message,
      );
      const communicationsContext = assembleRunContext(
        {
          persona: buildCommunicationsPersona(
            { type: ctx.identity.type, id: ctx.identity.id },
            configuredModel?.plane === "cloud" ? undefined : cosPersona.tone,
          ),
          request: skillMention.rest || input.message,
          governance: { approvalRequirement: "explicit_human", trustGrants: [] },
          ...(communicationsMemory.length > 0 ? { memory: communicationsMemory } : {}),
          outputContract: { description: DIRECT_REPLY_OUTPUT_CONTRACT },
        },
        ctx.run,
      );
      const text = governedModel
        ? (
            await governedModel.provider.complete({
              system: projectToSystemPrompt(communicationsContext),
              prompt: communicationsContext.request,
              maxTokens: 512,
              tier: "default",
              cache: { strategy: "stable_system_prefix", ttl: "5m" },
            })
          ).text
        : `${COMMUNICATIONS_SKILL.mission} (offline mode — no model configured, so I can't draft this yet, but I've recorded the request.)`;
      return {
        reply: text,
        decision: { kind: "direct_reply" as const, confidence: 1, reason: "directly addressed via @communications skill", source: "model" as const },
        proposal: null,
        modelReceiptLedgerId: governedModel?.receiptLedgerId() ?? null,
        // Display-only label, not a FoundationalAgentId — Communications
        // has no identity/capability-scope row (ADR-046), this string
        // exists purely so AgentPanel.tsx can badge the reply the same
        // way it badges an actual agent's.
        agent: "communications" as const,
        persona: personaCard,
      };
    }

    // A leading "@agent" mention (ADR-033/046) bypasses star-topology
    // classification for THIS turn only — a human directly addressing one
    // of the three foundational agents, not agent-to-agent handoff.
    // Learning/Governance answer directly (no side effects); Capability
    // Builder always drafts through the same governed pipeline every routed
    // action uses, per its `requiresApproval` flag — it never ships live from
    // a chat reply.
    const { agentId, rest } = parseMention(input.message);
    if (agentId) {
      const agent = findFoundationalAgent(agentId);
      const configuredModel = resolveConfiguredModel(
        ctx.wiring.models,
        "reasoning",
        input.cloudModelEgress,
      );
      const governedModel = configuredModel
        ? createGovernedModelProvider(
            ctx,
            input.organizationId,
            configuredModel,
            `foundational_agent:${agentId}`,
            input.cloudModelEgress,
          )
        : undefined;

      // AGENTS-1: invoke the addressed agent as a first-class peer through the
      // @bridge/core `invokeAgent` seam (system-prompt assembly + model call +
      // offline fallback + the design-constraint check all live in core). The
      // result is a DISCRIMINATED UNION with no "executed" variant, so the
      // strongest thing a chat reply can carry is a draft this procedure must
      // still propose — the "no independent write" guarantee is structural,
      // not a convention re-checked here.
      // K4: an addressed foundational Agent retrieves like every other run —
      // the memory slot K0 reserved on invokeAgent is finally fed.
      const agentMemory = await fusedConverseMemory(
        configuredModel?.plane,
        rest || input.message,
      );
      const result = await invokeAgent({
        agentId,
        message: rest || input.message,
        // The RunCtx rides with the provider (AI Harness K0): invokeAgent
        // assembles its ModelRunContext through the one context door, and
        // cannot be handed a model without the seams to do so.
        ...(governedModel
          ? { model: { provider: governedModel.provider, runCtx: ctx.run } }
          : {}),
        ...(agentMemory.length > 0 ? { memory: agentMemory } : {}),
        ...(cosPersona.tone && configuredModel?.plane !== "cloud"
          ? { tone: cosPersona.tone }
          : {}),
      });
      const modelReceiptLedgerId = governedModel?.receiptLedgerId() ?? null;

      if (result.kind === "information") {
        return {
          reply: result.text,
          decision: { kind: "direct_reply" as const, confidence: 1, reason: `directly addressed via @${agentId}`, source: "model" as const },
          proposal: null,
          modelReceiptLedgerId,
          agent: agentId,
          persona: personaCard,
        };
      }

      // result.kind === "draft" (Capability Builder, `requiresApproval`). The
      // core-computed design-constraint violations are surfaced to the human
      // approver — never a gate, same draft-then-approve pattern as every
      // other governance signal.
      const constraintViolations = result.constraintViolations;
      const replyText = constraintViolations.length
        ? `${result.text}\n\n⚠ Design-constraint check flagged ${constraintViolations.length} item(s) for the approver:\n${constraintViolations.map((v) => `- ${v}`).join("\n")}`
        : result.text;

      const proposal = await ctx.wiring.pipeline.propose(
        {
          organizationId: input.organizationId,
          actor: { type: ctx.identity.type, id: ctx.identity.id },
          action: "execute",
          resourceType: "skill",
          inputs: {
            agent: agentId,
            message: input.message,
            draft: result.text,
            designConstraintViolations: constraintViolations,
            ...(modelReceiptLedgerId ? { modelReceiptLedgerId } : {}),
          },
          skill: "stageMutation",
        },
        ctx.run,
      );
      return {
        reply: `${replyText}\n\nDrafted via ${agent.name} — proposed for review, not yet executed.`,
        decision: { kind: "route" as const, route: agentId, confidence: 1, reason: `directly addressed via @${agentId}`, source: "model" as const },
        proposal,
        modelReceiptLedgerId,
        agent: agentId,
        persona: personaCard,
      };
    }

    let chainOk = true;
    try {
      assertChainDepth(input.chainDepth);
    } catch {
      chainOk = false;
    }

    // In-memory mode exposes only the deterministic echo adapter, which is not
    // a classifier. A configured deployment resolves the explicit cheap tier;
    // no provider is ever selected by registration position.
    const configuredModel = resolveConfiguredModel(
      ctx.wiring.models,
      "cheap",
      input.cloudModelEgress,
    );
    const governedModel =
      chainOk && configuredModel
        ? createGovernedModelProvider(
            ctx,
            input.organizationId,
            configuredModel,
            "intent_classification",
            input.cloudModelEgress,
          )
        : undefined;

    const decision = chainOk
      ? await classifyIntent({
          message: input.message,
          registry: CHIEF_OF_STAFF_REGISTRY,
          ...(governedModel
            ? { model: { provider: governedModel.provider, runCtx: ctx.run } }
            : {}),
        })
      : {
          kind: "direct_reply" as const,
          confidence: 0,
          reason: `chain depth ${input.chainDepth} hit the hard cap (${MAX_CHAIN_DEPTH}) — replying directly instead of routing further (best-so-far fallback)`,
          source: "keyword_fallback" as const,
        };
    const modelReceiptLedgerId = governedModel?.receiptLedgerId() ?? null;

    if (decision.kind !== "route" || !decision.route) {
      return {
        reply:
          decision.kind === "clarify"
            ? "I'm not confident which capability handles that yet — could you say more about what you're trying to do?"
            : "Noted — I don't have a capability to route that to yet, but I've recorded the request.",
        decision,
        modelReceiptLedgerId,
        proposal: null,
        agent: "chief_of_staff" as const,
        persona: personaCard,
      };
    }

    const target = CHIEF_OF_STAFF_REGISTRY.find((c) => c.id === decision.route);
    const proposal = await ctx.wiring.pipeline.propose(
      {
        organizationId: input.organizationId,
        actor: { type: ctx.identity.type, id: ctx.identity.id },
        action: "execute",
        resourceType: "skill",
        inputs: {
          route: decision.route,
          message: input.message,
          ...(modelReceiptLedgerId ? { modelReceiptLedgerId } : {}),
        },
        skill: "stageMutation",
      },
      ctx.run,
    );

    return {
      reply: `Routing this to "${decision.route}"${target ? ` (${target.description})` : ""} — proposed for review, not yet executed.`,
      decision,
      modelReceiptLedgerId,
      proposal,
      agent: "chief_of_staff" as const,
      persona: personaCard,
    };
  }),
});
