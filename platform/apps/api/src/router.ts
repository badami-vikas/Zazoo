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
import type { Action, ActorType, DataScope, OnBehalfOf, ResourceType, RunContext } from "@bridge/core";
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
  resourceId: z.string().optional(),
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
  resourceId: z.string().optional(),
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

export const appRouter = t.router({
  health: t.procedure.query(() => ({ ok: true, service: "bridge-api" })),

  action: t.router({
    /** Propose a governed mutation → Proposal (pending_review | applied | rejected). */
    propose: t.procedure.input(proposeInput).mutation(async ({ input, ctx }) => {
      return ctx.wiring.pipeline.propose(
        {
          workspaceId: input.workspaceId,
          actor: {
            type: input.actor.type as ActorType,
            id: input.actor.id,
            ...(input.actor.plane ? { plane: input.actor.plane } : {}),
          },
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
      return ctx.wiring.pipeline.decide(
        input.proposalId,
        input.decision,
        ctx.run,
        input.editedOutput,
      );
    }),
  }),

  ritual: t.router({
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

    list: t.procedure
      .input(z.object({ workspaceId: z.string().min(1) }))
      .query(async ({ input }) => {
        const { store } = await getIntegrationStore();
        return store.list(input.workspaceId);
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
});

export type AppRouter = typeof appRouter;
