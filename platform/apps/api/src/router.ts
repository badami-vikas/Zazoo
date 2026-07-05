/**
 * tRPC router — the wire surface over the Universal Action Pipeline.
 *
 * Zod schemas here are the single validate+sanitize chokepoint at the seam
 * (backlog #24): nothing reaches the pipeline unvalidated. Procedures are thin —
 * all governance lives in the pipeline, not here.
 */
import { initTRPC, TRPCError } from "@trpc/server";
import { z } from "zod";
import { IntegrationFloorScopeError } from "@bridge/db";
import type { ApiContext } from "./context.js";
import { PILOT_WORKSPACE } from "./wiring.js";
import type {
  Action,
  ActorType,
  DataScope,
  EgressTier,
  OnBehalfOf,
  ResourceType,
  RitualDefinition,
  RunContext,
} from "@bridge/core";
import {
  AgentFloorDeniedError,
  AlreadyResolvedError,
  buildAgentCapability,
  validateRitualWithinAgents,
} from "@bridge/core";
import { authUrl } from "@bridge/integrations-google";
import { scoreThesisFit, type ThesisProfile } from "@bridge/dealpilot";
import { getIntegrationStore } from "./social/integration-service.js";
import { listProviderIds, oauthScopesFor } from "./social/registry.js";

const t = initTRPC.context<ApiContext>().create();

/** Strip `undefined` so exactOptionalPropertyTypes is satisfied at the seam. */
function cleanOnBehalfOf(
  o: { type: "user" | "team"; id: string; delegationId?: string | undefined } | undefined,
): OnBehalfOf | undefined {
  if (!o) return undefined;
  return { type: o.type, id: o.id, ...(o.delegationId ? { delegationId: o.delegationId } : {}) };
}

function cleanContext(
  c: { type: "initiative" | "community" | "ritual"; id: string; runId?: string | undefined } | undefined,
): RunContext | undefined {
  if (!c) return undefined;
  return { type: c.type, id: c.id, ...(c.runId ? { runId: c.runId } : {}) };
}

/**
 * Interim single-tenant safety fix (All fixes.md Phase 3 item 11a): the platform is
 * single-tenant by construction (`PILOT_WORKSPACE` baked into `buildWiring()`), but
 * several procedures accepted a `workspaceId` param and either silently ignored it
 * (`dealpilot.list`, pre-fix) or never had the param to begin with (`google.*`).
 * Full multi-tenancy is out of scope for this pass (Phase 5, pilot-recruitment-
 * driven) — so instead of threading real per-tenant scoping through every store,
 * every workspace-scoped procedure now EXPLICITLY REJECTS any workspaceId that isn't
 * the pilot workspace, rather than silently proceeding as if it were. This turns a
 * silent cross-tenant leak (if a second workspace id were ever passed) into a loud,
 * typed 403 — an honest reflection of "this platform only serves one workspace right
 * now," not a promise of real isolation.
 */
class NonPilotWorkspaceError extends Error {
  constructor(readonly workspaceId: string) {
    super(`workspaceId "${workspaceId}" is not the pilot workspace — multi-tenancy is not yet supported`);
    this.name = "NonPilotWorkspaceError";
  }
}

function assertPilotWorkspace(workspaceId: string): void {
  if (workspaceId !== PILOT_WORKSPACE) throw new NonPilotWorkspaceError(workspaceId);
}

const actionEnum = z.enum(["read", "write", "execute", "share", "archive"]);
const actorTypeEnum = z.enum(["user", "team", "agent"]);
const resourceTypeEnum = z.enum([
  "person",
  "community",
  "initiative",
  "touchpoint",
  "ritual",
  "tool",
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

/** The access dropdown: which data tier this action/agent/step may touch. */
const dataScopeEnum = z.enum(["all", "public", "private"]);
/** The local-first gate plane an actor runs on. Absent = local (private-first). */
const planeEnum = z.enum(["local", "cloud"]);

const actorSchema = z.object({ type: actorTypeEnum, id: z.string().min(1), plane: planeEnum.optional() });
const onBehalfOfSchema = z.object({
  type: z.enum(["user", "team"]),
  id: z.string().min(1),
  delegationId: z.string().optional(),
});

const proposeInput = z.object({
  workspaceId: z.string().min(1),
  actor: actorSchema,
  onBehalfOf: onBehalfOfSchema.optional(),
  action: actionEnum,
  resourceType: resourceTypeEnum,
  resourceId: z.string().uuid().optional(),
  inputs: z.unknown(),
  skill: z.string().min(1),
  dataScope: dataScopeEnum.optional(),
  context: z
    .object({
      type: z.enum(["initiative", "community", "ritual"]),
      id: z.string().min(1),
      runId: z.string().optional(),
    })
    .optional(),
  seed: z.string().optional(),
});

const decideInput = z.object({
  proposalId: z.string().min(1),
  decision: z.enum(["approve", "veto", "edit"]),
  editedOutput: z.unknown().optional(),
});

const ritualStep = z.object({
  skill: z.string().min(1),
  action: actionEnum,
  resourceType: resourceTypeEnum,
  resourceId: z.string().uuid().optional(),
  inputs: z.unknown(),
  dataScope: dataScopeEnum.optional(),
});

const ritualRunInput = z.object({
  workspaceId: z.string().min(1),
  ritualId: z.string().min(1),
  actor: actorSchema,
  onBehalfOf: onBehalfOfSchema.optional(),
  steps: z.array(ritualStep).min(1),
  seed: z.string().optional(),
});

const ritualRunByIdInput = z.object({
  workspaceId: z.string().min(1),
  ritualId: z.string().min(1),
  actor: actorSchema,
  onBehalfOf: onBehalfOfSchema.optional(),
  params: z.record(z.unknown()).optional(),
  seed: z.string().optional(),
});

/** Layered, gated agent permissions (least-privilege; cf. Google incremental scopes).
 * `send` is intentionally NOT an egress tier — agents may never send (human-only). */
const egressTierEnum = z.enum(["none", "read-graph", "draft-graph", "source-internet"]);

const agentCreateInput = z.object({
  workspaceId: z.string().min(1),
  name: z.string().min(1),
  capabilityScope: z.array(z.string()).default([]),
  allowedSkills: z.array(z.string()).default([]),
  dataScope: dataScopeEnum.default("public"),
  egressTier: egressTierEnum.default("none"),
});

const agentUpdateInput = z.object({
  agentId: z.string().min(1),
  name: z.string().min(1).optional(),
  capabilityScope: z.array(z.string()).optional(),
  allowedSkills: z.array(z.string()).optional(),
  dataScope: dataScopeEnum.optional(),
  egressTier: egressTierEnum.optional(),
});

const ritualCreateInput = z.object({
  workspaceId: z.string().min(1),
  name: z.string().min(1),
  agentIds: z.array(z.string().min(1)).min(1),
  steps: z.array(ritualStep).min(1),
});

export const appRouter = t.router({
  health: t.procedure.query(() => ({ ok: true, service: "bridge-api" })),

  action: t.router({
    /** Propose a governed mutation → Proposal (pending_review | applied | rejected). */
    propose: t.procedure.input(proposeInput).mutation(async ({ input, ctx }) => {
      assertPilotWorkspace(input.workspaceId);
      // Human identity is SERVER-RESOLVED (ctx.identity), never taken from the request
      // body. An agent actor keeps its requested service identity but always drafts and
      // still requires a human approval downstream (agent-floor + require_approval).
      const actor =
        input.actor.type === "agent"
          ? {
              type: "agent" as ActorType,
              id: input.actor.id,
              ...(input.actor.plane ? { plane: input.actor.plane } : {}),
            }
          : {
              type: ctx.identity.type,
              id: ctx.identity.id,
              ...(input.actor.plane ? { plane: input.actor.plane } : {}),
            };
      return ctx.wiring.pipeline.propose(
        {
          workspaceId: input.workspaceId,
          actor,
          ...(cleanOnBehalfOf(input.onBehalfOf) ? { onBehalfOf: cleanOnBehalfOf(input.onBehalfOf)! } : {}),
          action: input.action as Action,
          resourceType: input.resourceType as ResourceType,
          ...(input.resourceId ? { resourceId: input.resourceId } : {}),
          inputs: input.inputs,
          skill: input.skill,
          ...(input.dataScope ? { dataScope: input.dataScope as DataScope } : {}),
          ...(cleanContext(input.context) ? { context: cleanContext(input.context)! } : {}),
          ...(input.seed ? { seed: input.seed } : {}),
        },
        ctx.run,
      );
    }),

    /** Resolve a pending proposal: approve | veto | edit. */
    decide: t.procedure.input(decideInput).mutation(async ({ input, ctx }) => {
      // Decider is the SERVER-RESOLVED identity (ctx.identity), never the client's
      // claimed actor — the agent-floor in decide() blocks any agent from approving.
      let resolved;
      try {
        resolved = await ctx.wiring.pipeline.decide(
          input.proposalId,
          input.decision,
          ctx.identity,
          ctx.run,
          input.editedOutput,
        );
      } catch (err) {
        // Double-approve / already-resolved (including the persistent ledger's
        // partial-unique-index race guard) → 409, not a generic 500.
        if (err instanceof AlreadyResolvedError) {
          throw new TRPCError({ code: "CONFLICT", message: err.message });
        }
        // Agent-floor DENY at the review gate (an agent attempted to approve) → 403,
        // matching the IntegrationFloorScopeError → FORBIDDEN pattern above.
        if (err instanceof AgentFloorDeniedError) {
          throw new TRPCError({ code: "FORBIDDEN", message: err.message });
        }
        throw err;
      }
      // Post-approval Google side effects (no-op for unrelated proposals):
      // materialize an intake proposal to the LOCAL graph, or execute an approved
      // external:send through the gate. Runs ONLY after the governed decision.
      const effects = await ctx.wiring.google.onApproved(input.proposalId, resolved, ctx.run);
      return { ...resolved, effects };
    }),
  }),

  /** Gmail + Google Calendar integration — connect, sync (read), send (write). */
  /** Gmail + Google Calendar — connect, sync (read), draft (write). Distinct from the
   * generic `integration` router below (social providers + governed scopes). */
  google: t.router({
    /** Connection + manifest surfaces for the Integrations UI. */
    list: t.procedure.query(async ({ ctx }) => {
      const info = await ctx.wiring.google.connectionInfo();
      const m = ctx.wiring.googleManifest;
      return {
        oauthConfigured: ctx.wiring.googleOAuth !== null,
        gatewayKind: ctx.wiring.googleGatewayKind,
        integrationId: ctx.wiring.google.integrationId,
        connection: info,
        surfaces: [
          { provider: "gmail", name: "Gmail" },
          { provider: "google-calendar", name: "Google Calendar" },
        ],
        manifest: { capabilities: m.capabilities, output_contract: m.output_contract, intake_policy: m.intake_policy },
      };
    }),

    /** The Google consent URL (read AND write scopes, offline). */
    connectUrl: t.procedure.mutation(async ({ ctx }) => {
      if (!ctx.wiring.googleOAuth) {
        return { url: null as string | null, error: "oauth_not_configured" as const };
      }
      return { url: authUrl(ctx.wiring.googleOAuth, ctx.wiring.google.integrationId) };
    }),

    /** Revoke locally (delete the local token). */
    disconnect: t.procedure.mutation(async ({ ctx }) => {
      await ctx.wiring.google.disconnect();
      return { ok: true };
    }),

    /** Source Gmail through the gate → propose Touchpoints/Memories/Signals. */
    syncGmail: t.procedure
      .input(z.object({ maxResults: z.number().int().positive().max(100).optional(), query: z.string().optional() }).optional())
      .mutation(async ({ input, ctx }) => {
        return ctx.wiring.google.syncGmail(ctx.run, {
          ...(input?.maxResults ? { maxResults: input.maxResults } : {}),
          ...(input?.query ? { query: input.query } : {}),
        });
      }),

    /** Source Calendar through the gate → propose Touchpoints. */
    syncCalendar: t.procedure
      .input(
        z
          .object({
            maxResults: z.number().int().positive().max(100).optional(),
            timeMin: z.string().optional(),
            timeMax: z.string().optional(),
          })
          .optional(),
      )
      .mutation(async ({ input, ctx }) => {
        return ctx.wiring.google.syncCalendar(ctx.run, {
          ...(input?.maxResults ? { maxResults: input.maxResults } : {}),
          ...(input?.timeMin ? { timeMin: input.timeMin } : {}),
          ...(input?.timeMax ? { timeMax: input.timeMax } : {}),
        });
      }),

    /** Read-only projection: FULL Calendar events for the Calendar surface (gated
     * external:fetch, auto-approved as the user's own view). No Touchpoint proposals. */
    listEvents: t.procedure
      .input(
        z
          .object({
            maxResults: z.number().int().positive().max(250).optional(),
            timeMin: z.string().optional(),
            timeMax: z.string().optional(),
          })
          .optional(),
      )
      .mutation(async ({ input, ctx }) => {
        const events = await ctx.wiring.google.listCalendarEvents(ctx.run, {
          ...(input?.maxResults ? { maxResults: input.maxResults } : {}),
          ...(input?.timeMin ? { timeMin: input.timeMin } : {}),
          ...(input?.timeMax ? { timeMax: input.timeMax } : {}),
        });
        return { events };
      }),

    /** Compose an outbound email/event as a DRAFT → external:send proposal (>= L2).
     * For calendar, `action` = create (default) | update | delete. The real Google
     * write runs in the EgressExecutor only after a human approves. */
    proposeSend: t.procedure
      .input(
        z.object({
          kind: z.enum(["email", "calendar"]),
          action: z.enum(["create", "update", "delete"]).optional(),
          envelope: z.record(z.unknown()),
        }),
      )
      .mutation(async ({ input, ctx }) => {
        return ctx.wiring.google.proposeSend(ctx.run, {
          kind: input.kind,
          ...(input.action ? { action: input.action } : {}),
          envelope: input.envelope as never,
        });
      }),
  }),

  /** Agent governance — create/update an agent with LAYERED, least-privilege scopes.
   * Escalating capability (external:send, governance, full-graph, '*') is stripped at
   * the seam; agents can never be created able to send or approve. */
  agent: t.router({
    create: t.procedure.input(agentCreateInput).mutation(async ({ input, ctx }) => {
      const mem = ctx.wiring.memory;
      if (!mem) throw new Error("agent.create: in-memory governance store required (persistent agent CRUD pending)");
      const built = buildAgentCapability({ capabilityScope: input.capabilityScope, egressTier: input.egressTier as EgressTier });
      const agentId = ctx.run.ids.next();
      mem.agents.scope.set(agentId, built.scope);
      mem.agents.tiers.set(agentId, input.dataScope as DataScope);
      mem.agents.skills.set(agentId, input.allowedSkills);
      mem.agents.assumed.set(agentId, null);
      return {
        agentId,
        name: input.name,
        scope: built.scope,
        dropped: built.dropped, // escalating tokens we refused to grant (shown in UI)
        dataScope: input.dataScope,
        egressTier: input.egressTier,
        // Non-removable, always-true facts about an in-platform agent:
        floor: { canSend: false, canApprove: false },
      };
    }),

    update: t.procedure.input(agentUpdateInput).mutation(async ({ input, ctx }) => {
      const mem = ctx.wiring.memory;
      if (!mem) throw new Error("agent.update: in-memory governance store required (persistent agent CRUD pending)");
      if (!mem.agents.scope.has(input.agentId)) throw new Error(`agent.update: unknown agent ${input.agentId}`);
      let dropped: string[] = [];
      if (input.capabilityScope !== undefined || input.egressTier !== undefined) {
        const built = buildAgentCapability({
          capabilityScope: input.capabilityScope ?? mem.agents.scope.get(input.agentId) ?? [],
          egressTier: (input.egressTier ?? "none") as EgressTier,
        });
        mem.agents.scope.set(input.agentId, built.scope);
        dropped = built.dropped;
      }
      if (input.dataScope !== undefined) mem.agents.tiers.set(input.agentId, input.dataScope as DataScope);
      if (input.allowedSkills !== undefined) mem.agents.skills.set(input.agentId, input.allowedSkills);
      return {
        agentId: input.agentId,
        scope: mem.agents.scope.get(input.agentId) ?? [],
        dropped,
        dataScope: mem.agents.tiers.get(input.agentId) ?? "all",
        floor: { canSend: false, canApprove: false },
      };
    }),
  }),

  ritual: t.router({
    /** Create a ritual/workflow — REJECTED if any step exceeds its assigned agents'
     * authority (ritual ⊆ agent). The gate cannot be widened by a workflow. */
    create: t.procedure.input(ritualCreateInput).mutation(async ({ input, ctx }) => {
      const mem = ctx.wiring.memory;
      if (!mem) throw new Error("ritual.create: in-memory governance store required (persistent ritual CRUD pending)");
      const agentViews = input.agentIds.map((id) => ({
        id,
        scope: mem.agents.scope.get(id) ?? [],
        dataScope: mem.agents.tiers.get(id) ?? ("all" as DataScope),
      }));
      const violations = validateRitualWithinAgents(
        input.steps.map((s) => ({
          action: s.action as Action,
          resourceType: s.resourceType as ResourceType,
          ...(s.dataScope ? { dataScope: s.dataScope as DataScope } : {}),
        })),
        agentViews,
      );
      if (violations.length > 0) {
        return { ok: false as const, violations, reason: "ritual exceeds assigned agents' authority (ritual ⊆ agent)" };
      }
      const reg = ctx.wiring.ritualRegistry as { register?: (d: RitualDefinition) => unknown };
      if (!reg.register) throw new Error("ritual.create: persistent ritual CRUD pending");
      const ritualId = ctx.run.ids.next();
      reg.register({
        id: ritualId,
        name: input.name,
        workspaceId: input.workspaceId,
        steps: input.steps.map((s) => ({
          skill: s.skill,
          action: s.action as Action,
          resourceType: s.resourceType as ResourceType,
          ...(s.resourceId ? { resourceId: s.resourceId } : {}),
          ...(s.inputs !== undefined ? { inputs: s.inputs as Record<string, unknown> } : {}),
          ...(s.dataScope ? { dataScope: s.dataScope as DataScope } : {}),
        })),
      });
      return { ok: true as const, ritualId, agentIds: input.agentIds };
    }),

    /** Run a ritual: ordered, governed steps through the pipeline. */
    run: t.procedure.input(ritualRunInput).mutation(async ({ input, ctx }) => {
      return ctx.wiring.ritualExecutor.run(
        {
          workspaceId: input.workspaceId,
          ritualId: input.ritualId,
          actor: {
            type: input.actor.type as ActorType,
            id: input.actor.id,
            ...(input.actor.plane ? { plane: input.actor.plane } : {}),
          },
          ...(cleanOnBehalfOf(input.onBehalfOf) ? { onBehalfOf: cleanOnBehalfOf(input.onBehalfOf)! } : {}),
          steps: input.steps.map((s) => ({
            skill: s.skill,
            action: s.action as Action,
            resourceType: s.resourceType as ResourceType,
            ...(s.resourceId ? { resourceId: s.resourceId } : {}),
            inputs: s.inputs,
            ...(s.dataScope ? { dataScope: s.dataScope as DataScope } : {}),
          })),
          ...(input.seed ? { seed: input.seed } : {}),
        },
        ctx.run,
      );
    }),

    /** Run a ritual by id — loads its step config from the registry (P2). */
    runById: t.procedure.input(ritualRunByIdInput).mutation(async ({ input, ctx }) => {
      return ctx.wiring.ritualExecutor.runById(
        {
          workspaceId: input.workspaceId,
          ritualId: input.ritualId,
          actor: {
            type: input.actor.type as ActorType,
            id: input.actor.id,
            ...(input.actor.plane ? { plane: input.actor.plane } : {}),
          },
          ...(cleanOnBehalfOf(input.onBehalfOf) ? { onBehalfOf: cleanOnBehalfOf(input.onBehalfOf)! } : {}),
          ...(input.params ? { params: input.params } : {}),
          ...(input.seed ? { seed: input.seed } : {}),
        },
        ctx.run,
      );
    }),
  }),

  /**
   * DealPilot — the first tool on the generic manifest intake seam (@bridge/tool-kit).
   * `source` quarantines through the pipeline as `external:fetch` (audited, policy-gated);
   * `commit` is the human "Add" that materializes ONE quarantined capture into DealPilot's
   * facts + candidate list (capture ≠ commit). Thesis storage is basic get/set, in-memory
   * (wiring.ts) — no thesis-management UI yet, that's a separate future item.
   */
  dealpilot: t.router({
    source: t.procedure
      .input(z.object({ workspaceId: z.string().min(1) }))
      .mutation(async ({ input, ctx }) => {
        return ctx.wiring.pipeline.propose(
          {
            workspaceId: input.workspaceId,
            actor: { type: ctx.identity.type, id: ctx.identity.id },
            action: "read" as Action,
            resourceType: "external:fetch" as ResourceType,
            skill: "dealpilot.source",
            inputs: { kind: "company", hints: {} },
          },
          ctx.run,
        );
      }),

    commit: t.procedure.input(z.object({ captureId: z.string().min(1) })).mutation(async ({ input, ctx }) => {
      return ctx.wiring.dealpilot.materializer.add(input.captureId);
    }),

    /** Quarantined-but-not-yet-committed captures waiting for human review/"Add". */
    captures: t.procedure.query(({ ctx }) => {
      return ctx.wiring.dealpilot.captures.list("dealpilot");
    }),

    getThesis: t.procedure.query(({ ctx }) => {
      return ctx.wiring.dealpilot.thesis;
    }),

    setThesis: t.procedure
      .input(
        z.object({
          industries: z.array(z.string()),
          geo: z.array(z.string()),
          sdeMin: z.number().optional(),
          sdeMax: z.number().optional(),
          revenueMin: z.number().optional(),
          revenueMax: z.number().optional(),
        }),
      )
      .mutation(({ input, ctx }) => {
        const next: ThesisProfile = {
          industries: input.industries,
          geo: input.geo,
          ...(input.sdeMin != null ? { sdeMin: input.sdeMin } : {}),
          ...(input.sdeMax != null ? { sdeMax: input.sdeMax } : {}),
          ...(input.revenueMin != null ? { revenueMin: input.revenueMin } : {}),
          ...(input.revenueMax != null ? { revenueMax: input.revenueMax } : {}),
        };
        ctx.wiring.dealpilot.setThesis(next);
        return ctx.wiring.dealpilot.thesis;
      }),

    /**
     * Paginated (offset/limit): `candidateIds` is an in-memory array (wiring.ts), so a
     * simple offset slice is correct and avoids over-engineering a cursor scheme for a
     * backing store with no stable ordering keys yet. Default limit keeps this from
     * mapping the entire candidate set through `facts.livingProfile()` on every call
     * (All fixes.md §3 P1 "No pagination on any list surface").
     */
    list: t.procedure
      .input(
        z
          .object({
            limit: z.number().int().min(1).max(200).default(50),
            offset: z.number().int().min(0).default(0),
          })
          .default({}),
      )
      .query(({ input, ctx }) => {
        const { facts, candidateIds, thesis } = ctx.wiring.dealpilot;
        const total = candidateIds.length;
        const page = candidateIds.slice(input.offset, input.offset + input.limit);
        const items = page.map((id) => {
          const profile = facts.livingProfile(id);
          const flat = Object.fromEntries(Object.entries(profile).map(([k, v]) => [k, v.value]));
          return { id, profile: flat, fit: scoreThesisFit(flat, thesis) };
        });
        return { items, total, hasMore: input.offset + items.length < total };
      }),
  }),

  tool: t.router({
    /** Invoke a tool — its composition runs through the pipeline (config → pipeline). */
    run: t.procedure.input(ritualRunByIdInput).mutation(async ({ input, ctx }) => {
      return ctx.wiring.ritualExecutor.runTool(
        {
          workspaceId: input.workspaceId,
          ritualId: input.ritualId,
          actor: {
            type: input.actor.type as ActorType,
            id: input.actor.id,
            ...(input.actor.plane ? { plane: input.actor.plane } : {}),
          },
          ...(cleanOnBehalfOf(input.onBehalfOf) ? { onBehalfOf: cleanOnBehalfOf(input.onBehalfOf)! } : {}),
          ...(input.params ? { params: input.params } : {}),
          ...(input.seed ? { seed: input.seed } : {}),
        },
        ctx.run,
      );
    }),
  }),

  /**
   * Integration management — connected providers and their USER-EDITABLE scopes.
   * Backed by the governed integration store on the LOCAL plane. Granting an
   * agent-floor DENY scope (external:send, network_graph:full) is refused here.
   */
  integration: t.router({
    /** The platforms Bridge can connect, with their declared OAuth scopes. */
    providers: t.procedure.query(() =>
      listProviderIds().map((id) => ({ id, oauthScopes: oauthScopesFor(id) })),
    ),

    /**
     * Paginated (offset/limit): `store.list` returns the full connected-integrations
     * array with no store-level pagination support, so the router slices after the
     * fetch. Same shape as `dealpilot.list` (All fixes.md §3 P1 "No pagination on any
     * list surface").
     */
    list: t.procedure
      .input(
        z.object({
          workspaceId: z.string().min(1),
          limit: z.number().int().min(1).max(200).default(50),
          offset: z.number().int().min(0).default(0),
        }),
      )
      .query(async ({ input }) => {
        const { store } = await getIntegrationStore();
        const all = await store.list(input.workspaceId);
        const total = all.length;
        const items = all.slice(input.offset, input.offset + input.limit);
        return { items, total, hasMore: input.offset + items.length < total };
      }),

    connect: t.procedure
      .input(
        z.object({
          workspaceId: z.string().min(1),
          provider: z.enum(["x", "instagram", "facebook", "linkedin"]),
        }),
      )
      .mutation(async ({ input }) => {
        const { store } = await getIntegrationStore();
        return store.connect(input.workspaceId, input.provider, oauthScopesFor(input.provider));
      }),

    disconnect: t.procedure
      .input(z.object({ workspaceId: z.string().min(1), integrationId: z.string().uuid() }))
      .mutation(async ({ input }) => {
        const { store } = await getIntegrationStore();
        await store.disconnect(input.workspaceId, input.integrationId);
        return { ok: true };
      }),

    listScopes: t.procedure
      .input(z.object({ workspaceId: z.string().min(1), integrationId: z.string().uuid() }))
      .query(async ({ input }) => {
        const { store } = await getIntegrationStore();
        return store.listScopes(input.workspaceId, input.integrationId);
      }),

    grantScope: t.procedure
      .input(
        z.object({
          workspaceId: z.string().min(1),
          integrationId: z.string().uuid(),
          resourceType: z.string().min(1),
          action: actionEnum,
        }),
      )
      .mutation(async ({ input }) => {
        const { store } = await getIntegrationStore();
        try {
          return await store.grantScope({
            workspaceId: input.workspaceId,
            integrationId: input.integrationId,
            resourceType: input.resourceType,
            action: input.action,
          });
        } catch (err) {
          if (err instanceof IntegrationFloorScopeError) {
            // Agent-floor DENY: surfaced as always-approval, never a standing grant.
            throw new TRPCError({ code: "FORBIDDEN", message: err.message });
          }
          throw err;
        }
      }),

    revokeScope: t.procedure
      .input(z.object({ workspaceId: z.string().min(1), permissionId: z.string().uuid() }))
      .mutation(async ({ input }) => {
        const { store } = await getIntegrationStore();
        await store.revokeScope(input.workspaceId, input.permissionId);
        return { ok: true };
      }),
  }),

  /**
   * Workspace + team-member management — plain authenticated CRUD (direct DB
   * writes), NOT a governed pipeline action. Creating a workspace or inviting a
   * teammate doesn't have an external effect requiring approval, so this bypasses
   * pipeline.propose() and calls the store directly.
   */
  workspace: t.router({
    create: t.procedure
      .input(z.object({ name: z.string().min(1) }))
      .mutation(async ({ input, ctx }) => {
        return ctx.wiring.workspaceStore.createWorkspace(input.name, ctx.identity.id);
      }),

    list: t.procedure.query(async ({ ctx }) => {
      return ctx.wiring.workspaceStore.listWorkspaces(ctx.identity.id);
    }),

    inviteMember: t.procedure
      .input(z.object({ workspaceId: z.string().min(1), email: z.string().email() }))
      .mutation(async ({ input, ctx }) => {
        return ctx.wiring.workspaceStore.inviteMember(input.workspaceId, input.email);
      }),

    listMembers: t.procedure
      .input(z.object({ workspaceId: z.string().min(1) }))
      .query(async ({ input, ctx }) => {
        return ctx.wiring.workspaceStore.listMembers(input.workspaceId);
      }),
  }),
});

export type AppRouter = typeof appRouter;
