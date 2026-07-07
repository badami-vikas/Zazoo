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
  computeRisk,
  advance,
  demoteOnDependencyChange,
  suspendOnFailure,
  resolveActivationApproval,
  InvalidTransitionError as CapabilityInvalidTransitionError,
  EvidenceThresholdError,
  compileBlueprint,
  BlueprintCompileError,
  classifyIntent,
  assertChainDepth,
  MAX_CHAIN_DEPTH,
  parsePackageManifest,
  PackageManifestValidationError,
  computePackageRisk,
  advancePackageState,
  promoteToAvailable,
  rollbackFromHistory,
  InvalidPackageTransitionError,
  type CapabilityManifest,
  type CapabilityManifestRow,
  type WorkspaceBlueprint,
  type RoutableCapability,
  type PackageInstallationRow,
} from "@bridge/core";
import { authUrl } from "@bridge/integrations-google";
import { routeHelpRequest, draftHelpOffer, type HelpResponderCandidate } from "@bridge/helpdesk";
import { scoreThesisFit, type ThesisProfile } from "@bridge/dealpilot";
import { scoreJobFit, transition, InvalidTransitionError, type ApplicationStage, type CandidateProfile, type JobProfile } from "@bridge/jobpilot";
import { getIntegrationStore } from "./social/integration-service.js";
import { listProviderIds, oauthScopesFor } from "./social/registry.js";

const t = initTRPC.context<ApiContext>().create();

/**
 * Translate `NonPilotWorkspaceError` → `TRPCError({code:"FORBIDDEN"})` in ONE place
 * (a middleware every procedure below runs through) rather than repeating the
 * `IntegrationFloorScopeError`/`AlreadyResolvedError` try/catch pattern at every one
 * of the dozen-plus call sites that now call `assertPilotWorkspace`. The typed error
 * is still the thing procedures throw (matching the existing pattern); only the
 * translation step is centralized to avoid duplicating the same three-line catch
 * block everywhere.
 */
const withPilotWorkspaceGuard = t.middleware(async ({ next }) => {
  const result = await next();
  // tRPC v11's `next()` does NOT throw when the resolver throws — `callRecursive`
  // catches it internally (converting it to a generic TRPCError via
  // `getTRPCErrorFromUnknown`, which loses the original error's identity) and
  // RETURNS `{ ok: false, error }` instead. A try/catch around `next()` here would
  // never fire; the result's `.ok`/`.error` must be checked explicitly, and the
  // ORIGINAL cause (not the already-generic-wrapped `error`) is what still carries
  // the real `NonPilotWorkspaceError` instance, via `error.cause`.
  if (!result.ok && result.error.cause instanceof NonPilotWorkspaceError) {
    throw new TRPCError({ code: "FORBIDDEN", message: result.error.cause.message });
  }
  return result;
});

const procedure = t.procedure.use(withPilotWorkspaceGuard);

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

/** Shared list-endpoint shape (dealpilot.list/integration.list/action.listPending
 * convention) — workspaceId + limit/offset. */
const paginatedInput = z.object({
  workspaceId: z.string().min(1),
  limit: z.number().int().min(1).max(200).default(50),
  offset: z.number().int().min(0).default(0),
});
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

// ---------------------------------------------------------------------------
// Capability Trust Model (docs/wiki/vision.md "Capability Trust Model" +
// "Promotion defaults"). Zod-validated at this seam like every other router
// namespace; governance (approve) routes through the pipeline's decide()
// semantics — human identity from ctx.identity, agents blocked by the floor.
// ---------------------------------------------------------------------------
const capabilityTypeEnum = z.enum(["skill", "workflow", "agent", "tool", "integration", "view", "dashboard"]);
const capabilityOriginEnum = z.enum(["built_in", "template", "community", "ai_generated", "user_code"]);
const capabilityAudienceEnum = z.enum(["private", "team", "external_visible"]);

const capabilityPermissionSchema = z.object({
  resourceType: z.string().min(1),
  action: z.enum(["read", "write", "send"]),
  dataScope: z.enum(["public", "private", "all"]),
  egress: z.boolean(),
});
const capabilityConnectorSchema = z.object({ id: z.string().min(1), externalSend: z.boolean().default(false) });
const capabilityDependencySchema = z.object({ manifestId: z.string().min(1), versionRange: z.string().min(1) });

const capabilityRegisterInput = z.object({
  workspaceId: z.string().min(1),
  capabilityType: capabilityTypeEnum,
  name: z.string().min(1),
  version: z.string().min(1).default("1.0.0"),
  origin: capabilityOriginEnum.default("user_code"),
  audience: capabilityAudienceEnum.default("private"),
  permissions: z.array(capabilityPermissionSchema).default([]),
  connectors: z.array(capabilityConnectorSchema).default([]),
  dependencies: z.array(capabilityDependencySchema).default([]),
  manifest: z.unknown().optional(),
});

const capabilityIdInput = z.object({ manifestId: z.string().min(1) });
const capabilitySuspendInput = z.object({ manifestId: z.string().min(1), reason: z.string().min(1) });
const capabilityActivateInput = z.object({
  workspaceId: z.string().min(1),
  manifestId: z.string().min(1),
  /** Calendar-day key for the auto-activation budget (UTC "YYYY-MM-DD"). Caller-
   * injected so the router stays a determinism-seam consumer, not a wall-clock reader. */
  todayKey: z.string().min(1),
});

// ---------------------------------------------------------------------------
// P2 Capability packages (docs/raw/capability-package-format.md, ADR-018) — the
// shipping unit above one capability_manifests row. `register` parses+validates
// a raw package.yaml-shaped object (accepts either already-parsed YAML or a
// plain JSON body) and stores it as a `private`-state installation row, no risk
// computed yet (register != propose-for-install, mirrors capability.register's
// "generation only ever creates draft"). `install` computes package risk over
// the full bundled+dependency closure, applies the lethal-trifecta union
// check, and routes through the SAME pipeline propose/decide semantics
// `capability.approve`/`workspace.blueprint.activate` use — external band is
// the same non-removable hard floor, no trust grant can shortcut it.
// ---------------------------------------------------------------------------

const packageRegisterInput = z.object({
  workspaceId: z.string().min(1),
  /** Already-parsed package.yaml (or an equivalent plain object) — parsed+
   * validated by parsePackageManifest at this seam. */
  manifest: z.unknown(),
});

const packageIdInput = z.object({ installationId: z.string().min(1) });

const packageInstallInput = z.object({
  workspaceId: z.string().min(1),
  installationId: z.string().min(1),
  /** Calendar-day key for the auto-activation budget (mirrors capability.activate's todayKey). */
  todayKey: z.string().min(1),
});

const packagePromoteInput = z.object({
  workspaceId: z.string().min(1),
  installationId: z.string().min(1),
});

const packageRollbackInput = z.object({
  workspaceId: z.string().min(1),
  /** The historical installation row (any state) to fork a new draft from. */
  rollbackTargetId: z.string().min(1),
});

// ---------------------------------------------------------------------------
// P1 Workspace Generator — blueprint -> view grammar (docs/wiki/vision.md "View
// grammar"). Blueprint changes are GOVERNED PROPOSALS: propose() writes a DRAFT
// workspace_definition (no direct activation), activate() is the governed step
// (routes through the SAME pipeline propose/decide semantics `capability.approve`
// uses — human identity only, agent-floor applies unchanged).
// ---------------------------------------------------------------------------

/** Kernel node-type registry compileBlueprint validates entities against.
 * Reuses `resourceTypeEnum`'s values (the same governed-pipeline vocabulary)
 * plus "edge" — the actual relationship-shaped table in schema.ts (no
 * standalone "relationship" ResourceType/table exists yet; edges IS the
 * relationship data). Kept as a single source of truth here rather than
 * duplicated per-procedure. */
const BLUEPRINT_NODE_TYPE_REGISTRY = [...resourceTypeEnum.options, "edge"] as const;
const BLUEPRINT_RELATIONSHIP_NODE_TYPES = ["edge"] as const;

const blueprintFieldInput = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  kind: z.enum(["text", "number", "select", "multiselect", "date", "checkbox", "url", "relation", "formula", "tool", "location"]),
  options: z.array(z.string()).optional(),
  toolId: z.string().optional(),
});

const blueprintEntityInput = z.object({
  nodeType: z.string().min(1),
  label: z.string().min(1),
  fields: z.array(blueprintFieldInput),
});

const blueprintViewInput = z.object({
  entity: z.string().min(1),
  kind: z.enum(["table", "gallery", "kanban", "calendar", "map", "network", "chatbot", "dashboard", "canvas"]),
  config: z
    .object({
      sorts: z.array(z.object({ id: z.string(), dir: z.enum(["asc", "desc"]) })).optional(),
      rowFilters: z
        .array(
          z.object({
            field: z.string(),
            op: z.enum(["contains", "is", "is_not", "is_empty", "is_not_empty", "starts_with"]),
            value: z.string(),
          }),
        )
        .optional(),
      filterMatch: z.enum(["all", "any"]).optional(),
      groupBy: z.string().nullable().optional(),
    })
    .optional(),
});

const workspaceBlueprintInput = z.object({
  vocabulary: z.record(z.string(), z.string()),
  entities: z.array(blueprintEntityInput),
  views: z.array(blueprintViewInput),
  capabilities: z.array(z.string()),
});

/** Strip zod-optional `undefined` keys so the payload satisfies WorkspaceBlueprint's
 * exactOptionalPropertyTypes shape (same reasoning as cleanOnBehalfOf/cleanContext
 * above) before it reaches compileBlueprint or the store. */
function toWorkspaceBlueprint(input: z.infer<typeof workspaceBlueprintInput>): WorkspaceBlueprint {
  return {
    vocabulary: input.vocabulary,
    capabilities: input.capabilities,
    entities: input.entities.map((e) => ({
      nodeType: e.nodeType,
      label: e.label,
      fields: e.fields.map((f) => ({
        id: f.id,
        label: f.label,
        kind: f.kind,
        ...(f.options ? { options: f.options } : {}),
        ...(f.toolId ? { toolId: f.toolId } : {}),
      })),
    })),
    views: input.views.map((v) => ({
      entity: v.entity,
      kind: v.kind,
      ...(v.config
        ? {
            config: {
              ...(v.config.sorts ? { sorts: v.config.sorts } : {}),
              ...(v.config.rowFilters ? { rowFilters: v.config.rowFilters } : {}),
              ...(v.config.filterMatch ? { filterMatch: v.config.filterMatch } : {}),
              ...(v.config.groupBy !== undefined ? { groupBy: v.config.groupBy } : {}),
            },
          }
        : {}),
    })),
  };
}

const blueprintGetInput = z.object({ workspaceId: z.string().min(1) });
const blueprintGetByIdInput = z.object({
  workspaceId: z.string().min(1),
  definitionId: z.string().min(1),
});
const blueprintProposeInput = z.object({
  workspaceId: z.string().min(1),
  blueprint: workspaceBlueprintInput,
});
const blueprintActivateInput = z.object({
  workspaceId: z.string().min(1),
  definitionId: z.string().min(1),
});

// ---------------------------------------------------------------------------
// Chief of Staff v1 (docs/wiki/roadmap.md P1) — the closed registry of
// downstream capabilities it may route ONE turn to (star topology: no peer
// handoffs, so this list is exhaustive and hand-maintained here, mirroring
// BLUEPRINT_NODE_TYPE_REGISTRY's "single source of truth, kept in sync by
// hand" pattern above). Honest about what's routable today — capabilities not
// yet built (e.g. a dedicated recon/helpdesk skill) are deliberately omitted
// rather than listed as routable and then failing at execution time.
// ---------------------------------------------------------------------------
const CHIEF_OF_STAFF_REGISTRY: RoutableCapability[] = [
  {
    id: "jobpilot",
    description: "track job applications and their stage",
    keywords: ["job", "jobs", "application", "applications", "apply", "interview", "offer"],
  },
  {
    id: "dealpilot",
    description: "browse and score acquisition/deal candidates",
    keywords: ["deal", "deals", "acquisition", "listing", "business", "buy"],
  },
  {
    id: "calendar",
    description: "view or schedule calendar events",
    keywords: ["calendar", "schedule", "meeting", "event", "availability"],
  },
  {
    id: "helpdesk",
    description: "look up or respond to helpdesk tickets",
    keywords: ["ticket", "helpdesk", "support", "issue"],
  },
  {
    id: "resources",
    description: "find a saved resource (book, podcast, vlog)",
    keywords: ["resource", "book", "podcast", "vlog", "read", "watch"],
  },
];

const chiefOfStaffConverseInput = z.object({
  workspaceId: z.string().min(1),
  message: z.string().min(1),
  /** How many routing hops this conversation has already taken — the caller
   * (frontend chat panel) tracks this per-conversation and passes it back each
   * turn so the hard chain-depth cap (assertChainDepth) can be enforced
   * server-side, not just trusted client-side. Defaults to 0 (a fresh
   * conversation's first turn). */
  chainDepth: z.number().int().min(0).default(0),
});

/** Build the core `CapabilityManifest` shape (risk-computation input) from a
 * `capabilityRegisterInput`-validated payload + the id assigned at creation. */
function toCoreManifest(id: string, input: z.infer<typeof capabilityRegisterInput>): CapabilityManifest {
  return {
    id,
    name: input.name,
    version: input.version,
    capabilityType: input.capabilityType,
    origin: input.origin,
    audience: input.audience,
    permissions: input.permissions,
    connectors: input.connectors,
    dependencies: input.dependencies,
  };
}

/** Resolve a dependency manifest id to its core `CapabilityManifest` shape via
 * the store — the seam computeRisk()'s `ResolveDependency` needs. Synchronous
 * by contract (risk.ts is pure/sync), so callers pre-fetch the closure's rows
 * before invoking computeRisk (single round trip per registration/re-risk). */
function resolverFrom(rows: Map<string, CapabilityManifestRow>): (id: string) => CapabilityManifest | undefined {
  return (id: string) => {
    const row = rows.get(id);
    if (!row) return undefined;
    return {
      id: row.id,
      name: row.name,
      version: row.version,
      capabilityType: row.capabilityType,
      origin: row.origin,
      audience: row.audience,
      permissions: (row.manifest as { permissions?: CapabilityManifest["permissions"] } | null)?.permissions ?? [],
      connectors: (row.manifest as { connectors?: CapabilityManifest["connectors"] } | null)?.connectors ?? [],
      dependencies: row.dependencies,
    };
  };
}

export const appRouter = t.router({
  health: procedure.query(() => ({ ok: true, service: "bridge-api" })),

  action: t.router({
    /** Propose a governed mutation → Proposal (pending_review | applied | rejected). */
    propose: procedure.input(proposeInput).mutation(async ({ input, ctx }) => {
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

    /**
     * Pending proposals awaiting a human decision — backs the Approvals inbox
     * (frontend-migration-scoping.md Phase 2: `action.decide` existed with nothing
     * enumerating what's awaiting approval). Paginated per this repo's list-endpoint
     * convention (dealpilot.list/integration.list).
     */
    listPending: procedure
      .input(
        z
          .object({
            workspaceId: z.string().min(1),
            limit: z.number().int().min(1).max(200).default(50),
            offset: z.number().int().min(0).default(0),
          })
          .default({ workspaceId: PILOT_WORKSPACE }),
      )
      .query(async ({ input, ctx }) => {
        assertPilotWorkspace(input.workspaceId);
        const { items, total } = await ctx.wiring.pipeline.listPending(input.workspaceId, {
          limit: input.limit,
          offset: input.offset,
        });
        return { items, total, hasMore: input.offset + items.length < total };
      }),

    /** Resolve a pending proposal: approve | veto | edit. */
    decide: procedure.input(decideInput).mutation(async ({ input, ctx }) => {
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
   * generic `integration` router below (social providers + governed scopes).
   *
   * Single-tenant note (All fixes.md Phase 3 item 11a): these procedures take NO
   * `workspaceId` param at all — they are workspace-IMPLICIT, always resolving
   * through `ctx.wiring.google`, which is itself pinned to `PILOT_WORKSPACE` inside
   * `buildWiring()`. We deliberately did NOT add an optional `workspaceId` param here
   * (unlike `dealpilot.list`): no frontend caller (`Design Bridge AI Interface
   * (Copy)/src/app/data/api.ts`) ever attempts to pass a workspace context to any
   * `google.*` call, so there is no existing behavior that silently ignores a
   * client-supplied workspace id to fix — these procedures never claimed
   * multi-tenancy in the first place. Adding an unused, always-optional param would
   * only add surface area without closing a real gap; if a caller ever needs
   * multi-workspace Google integration, that's the same Phase 5 multi-tenancy work
   * the rest of this fix explicitly defers, not a one-off param here. */
  google: t.router({
    /** Connection + manifest surfaces for the Integrations UI. */
    list: procedure.query(async ({ ctx }) => {
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
    connectUrl: procedure.mutation(async ({ ctx }) => {
      if (!ctx.wiring.googleOAuth) {
        return { url: null as string | null, error: "oauth_not_configured" as const };
      }
      return { url: authUrl(ctx.wiring.googleOAuth, ctx.wiring.google.integrationId) };
    }),

    /** Revoke locally (delete the local token). */
    disconnect: procedure.mutation(async ({ ctx }) => {
      await ctx.wiring.google.disconnect();
      return { ok: true };
    }),

    /** Source Gmail through the gate → propose Touchpoints/Memories/Signals. */
    syncGmail: procedure
      .input(z.object({ maxResults: z.number().int().positive().max(100).optional(), query: z.string().optional() }).optional())
      .mutation(async ({ input, ctx }) => {
        return ctx.wiring.google.syncGmail(ctx.run, {
          ...(input?.maxResults ? { maxResults: input.maxResults } : {}),
          ...(input?.query ? { query: input.query } : {}),
        });
      }),

    /** Source Calendar through the gate → propose Touchpoints. */
    syncCalendar: procedure
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
    listEvents: procedure
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
    proposeSend: procedure
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
    create: procedure.input(agentCreateInput).mutation(async ({ input, ctx }) => {
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

    update: procedure.input(agentUpdateInput).mutation(async ({ input, ctx }) => {
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
    create: procedure.input(ritualCreateInput).mutation(async ({ input, ctx }) => {
      assertPilotWorkspace(input.workspaceId);
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
    run: procedure.input(ritualRunInput).mutation(async ({ input, ctx }) => {
      assertPilotWorkspace(input.workspaceId);
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
    runById: procedure.input(ritualRunByIdInput).mutation(async ({ input, ctx }) => {
      assertPilotWorkspace(input.workspaceId);
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
    source: procedure
      .input(z.object({ workspaceId: z.string().min(1) }))
      .mutation(async ({ input, ctx }) => {
        assertPilotWorkspace(input.workspaceId);
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

    commit: procedure.input(z.object({ captureId: z.string().min(1) })).mutation(async ({ input, ctx }) => {
      return ctx.wiring.dealpilot.materializer.add(input.captureId);
    }),

    /** Quarantined-but-not-yet-committed captures waiting for human review/"Add". */
    captures: procedure.query(({ ctx }) => {
      return ctx.wiring.dealpilot.captures.list("dealpilot");
    }),

    getThesis: procedure.query(({ ctx }) => {
      return ctx.wiring.dealpilot.thesis;
    }),

    setThesis: procedure
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
     *
     * `workspaceId` is OPTIONAL and, if present, must be the pilot workspace (interim
     * single-tenant safety fix, All fixes.md Phase 3 item 11a) — this procedure has no
     * per-workspace backing store yet (candidateIds is one process-wide in-memory
     * array), so silently proceeding for a non-pilot id would be a real cross-tenant
     * leak the moment a second workspace existed. No current caller sends this param
     * (the prototype only sends limit/offset); it's accepted defensively so a future
     * caller can't slip a non-pilot id through unnoticed.
     */
    list: procedure
      .input(
        z
          .object({
            workspaceId: z.string().min(1).optional(),
            limit: z.number().int().min(1).max(200).default(50),
            offset: z.number().int().min(0).default(0),
          })
          .default({}),
      )
      .query(({ input, ctx }) => {
        if (input.workspaceId) assertPilotWorkspace(input.workspaceId);
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
    run: procedure.input(ritualRunByIdInput).mutation(async ({ input, ctx }) => {
      assertPilotWorkspace(input.workspaceId);
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
    providers: procedure.query(() =>
      listProviderIds().map((id) => ({ id, oauthScopes: oauthScopesFor(id) })),
    ),

    /**
     * Paginated (offset/limit): `store.list` returns the full connected-integrations
     * array with no store-level pagination support, so the router slices after the
     * fetch. Same shape as `dealpilot.list` (All fixes.md §3 P1 "No pagination on any
     * list surface").
     */
    list: procedure
      .input(
        z.object({
          workspaceId: z.string().min(1),
          limit: z.number().int().min(1).max(200).default(50),
          offset: z.number().int().min(0).default(0),
        }),
      )
      .query(async ({ input }) => {
        assertPilotWorkspace(input.workspaceId);
        const { store } = await getIntegrationStore();
        const all = await store.list(input.workspaceId);
        const total = all.length;
        const items = all.slice(input.offset, input.offset + input.limit);
        return { items, total, hasMore: input.offset + items.length < total };
      }),

    connect: procedure
      .input(
        z.object({
          workspaceId: z.string().min(1),
          provider: z.enum(["x", "instagram", "facebook", "linkedin"]),
        }),
      )
      .mutation(async ({ input }) => {
        assertPilotWorkspace(input.workspaceId);
        const { store } = await getIntegrationStore();
        return store.connect(input.workspaceId, input.provider, oauthScopesFor(input.provider));
      }),

    disconnect: procedure
      .input(z.object({ workspaceId: z.string().min(1), integrationId: z.string().uuid() }))
      .mutation(async ({ input }) => {
        assertPilotWorkspace(input.workspaceId);
        const { store } = await getIntegrationStore();
        await store.disconnect(input.workspaceId, input.integrationId);
        return { ok: true };
      }),

    listScopes: procedure
      .input(z.object({ workspaceId: z.string().min(1), integrationId: z.string().uuid() }))
      .query(async ({ input }) => {
        assertPilotWorkspace(input.workspaceId);
        const { store } = await getIntegrationStore();
        return store.listScopes(input.workspaceId, input.integrationId);
      }),

    grantScope: procedure
      .input(
        z.object({
          workspaceId: z.string().min(1),
          integrationId: z.string().uuid(),
          resourceType: z.string().min(1),
          action: actionEnum,
        }),
      )
      .mutation(async ({ input }) => {
        assertPilotWorkspace(input.workspaceId);
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

    revokeScope: procedure
      .input(z.object({ workspaceId: z.string().min(1), permissionId: z.string().uuid() }))
      .mutation(async ({ input }) => {
        assertPilotWorkspace(input.workspaceId);
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
    create: procedure
      .input(z.object({ name: z.string().min(1) }))
      .mutation(async ({ input, ctx }) => {
        return ctx.wiring.workspaceStore.createWorkspace(input.name, ctx.identity.id);
      }),

    list: procedure.query(async ({ ctx }) => {
      return ctx.wiring.workspaceStore.listWorkspaces(ctx.identity.id);
    }),

    inviteMember: procedure
      .input(z.object({ workspaceId: z.string().min(1), email: z.string().email() }))
      .mutation(async ({ input, ctx }) => {
        assertPilotWorkspace(input.workspaceId);
        return ctx.wiring.workspaceStore.inviteMember(input.workspaceId, input.email);
      }),

    listMembers: procedure
      .input(z.object({ workspaceId: z.string().min(1) }))
      .query(async ({ input, ctx }) => {
        assertPilotWorkspace(input.workspaceId);
        return ctx.wiring.workspaceStore.listMembers(input.workspaceId);
      }),

    /**
     * P1 Workspace Generator (docs/wiki/vision.md "View grammar" + roadmap.md
     * P1): the blueprint -> view grammar compiler's governed surface. `get`
     * returns the current active workspace_definition (or null — no demo/dummy
     * fallback: an un-onboarded workspace honestly has none yet). `propose`
     * always writes a DRAFT row (mirrors capability.register's "generation
     * only ever creates draft" — the Capability Lifecycle Platform's core
     * principle: everything is proposed, governed, continuously evolved).
     * `activate` is the governed step: it round-trips through the SAME
     * pipeline propose/decide semantics `capability.approve` uses, so a human
     * decision (never an agent, agent-floor applies unchanged) resolves it and
     * the attempt is audited either way; on approval it bumps the version and
     * archives the prior active row in the same operation (the one place
     * "only one active row" is enforced).
     */
    blueprint: t.router({
      get: procedure.input(blueprintGetInput).query(async ({ input, ctx }) => {
        assertPilotWorkspace(input.workspaceId);
        const active = await ctx.wiring.workspaceDefinitionStore.getActive(input.workspaceId);
        return { definition: active };
      }),

      /**
       * getById (ADR-023/ADR-024): returns a workspace_definition by id
       * REGARDLESS of status (draft/active/archived) — `get` above only ever
       * returns the currently-active row, so a draft that hasn't been
       * activated yet (the common ApprovalsPage diff-preview case) was
       * previously unreachable. Identity-scoped like every sibling endpoint:
       * the row's own `workspaceId` must match the caller-supplied
       * `workspaceId`, so a definitionId from another workspace 404s rather
       * than leaking cross-workspace data.
       */
      getById: procedure.input(blueprintGetByIdInput).query(async ({ input, ctx }) => {
        assertPilotWorkspace(input.workspaceId);
        const definition = await ctx.wiring.workspaceDefinitionStore.get(input.definitionId);
        if (!definition || definition.workspaceId !== input.workspaceId) {
          throw new TRPCError({ code: "NOT_FOUND", message: "unknown workspace_definition" });
        }
        return { definition };
      }),

      /** Always creates a DRAFT workspace_definition — never activates it. The
       * blueprint is validated against the grammar (compileBlueprint) BEFORE
       * being persisted, so an invalid draft is rejected here rather than
       * silently stored and only failing later at activation/render time. */
      propose: procedure.input(blueprintProposeInput).mutation(async ({ input, ctx }) => {
        assertPilotWorkspace(input.workspaceId);
        const blueprint = toWorkspaceBlueprint(input.blueprint);
        try {
          compileBlueprint(blueprint, BLUEPRINT_NODE_TYPE_REGISTRY, BLUEPRINT_RELATIONSHIP_NODE_TYPES);
        } catch (err) {
          if (err instanceof BlueprintCompileError) {
            throw new TRPCError({ code: "BAD_REQUEST", message: err.message });
          }
          throw err;
        }

        const priorDrafts = await ctx.wiring.workspaceDefinitionStore.listDrafts(input.workspaceId);
        const active = await ctx.wiring.workspaceDefinitionStore.getActive(input.workspaceId);
        const nextVersion = 1 + Math.max(active?.version ?? 0, ...priorDrafts.map((d) => d.version), 0);

        const id = ctx.run.ids.next();
        const created = await ctx.wiring.workspaceDefinitionStore.create({
          id,
          workspaceId: input.workspaceId,
          blueprint,
          version: nextVersion,
          status: "draft",
          createdBy: ctx.identity.type === "user" ? ctx.identity.id : null,
        });
        return { definition: created };
      }),

      /**
       * Activate a draft: proposes the activation through the governed
       * pipeline (same round trip capability.approve makes) so an agent can
       * never resolve it and every attempt is ledgered, whether it ends up
       * auto-resolved or parked pending_review. On resolution, flips the draft
       * to `active` and archives whatever was previously active — the only
       * place two rows are ever active for the same workspace at once is
       * disallowed.
       */
      activate: procedure.input(blueprintActivateInput).mutation(async ({ input, ctx }) => {
        assertPilotWorkspace(input.workspaceId);
        const draft = await ctx.wiring.workspaceDefinitionStore.get(input.definitionId);
        if (!draft || draft.workspaceId !== input.workspaceId) {
          throw new TRPCError({ code: "NOT_FOUND", message: "unknown workspace_definition draft" });
        }
        if (draft.status !== "draft") {
          throw new TRPCError({ code: "BAD_REQUEST", message: `workspace_definition ${draft.id} is "${draft.status}", not "draft"` });
        }

        const proposal = await ctx.wiring.pipeline.propose(
          {
            workspaceId: input.workspaceId,
            actor: { type: ctx.identity.type, id: ctx.identity.id },
            action: "approve",
            resourceType: "skill", // workspace_definitions has no dedicated ResourceType yet — same interim token capability.approve uses
            resourceId: input.definitionId,
            inputs: { definitionId: input.definitionId, fromStatus: draft.status },
            skill: "stageMutation",
          },
          ctx.run,
        );
        if (proposal.status === "pending_review") {
          return { activated: false, proposal, definition: draft };
        }

        const priorActive = await ctx.wiring.workspaceDefinitionStore.getActive(input.workspaceId);
        if (priorActive) {
          await ctx.wiring.workspaceDefinitionStore.setStatus(priorActive.id, "archived");
        }
        const activated = await ctx.wiring.workspaceDefinitionStore.setStatus(draft.id, "active");
        return { activated: true, proposal, definition: activated };
      }),
    }),
  }),

  /**
   * Read surface for Bridge's core vocabulary nouns — Initiative/Touchpoint/Signal
   * had ZERO tRPC coverage before this (frontend-migration-scoping.md Phase 3).
   * WRITES already flow through the generic `action.propose` (resourceType
   * "initiative" | "touchpoint" — see resourceTypeEnum above); this router only
   * adds the query-back path the pipeline itself doesn't provide (same reason
   * `dealpilot`/`integration` needed their own `.list`). `listPeople`/
   * `listCommunities` were added later for KnowledgeBasePage's People/Communities
   * tabs — same pattern, same store.
   */
  graph: t.router({
    listInitiatives: procedure
      .input(paginatedInput)
      .query(async ({ input, ctx }) => {
        assertPilotWorkspace(input.workspaceId);
        const { items, total } = await ctx.wiring.graphStore.listInitiatives(input.workspaceId, {
          limit: input.limit,
          offset: input.offset,
        });
        return { items, total, hasMore: input.offset + items.length < total };
      }),

    getInitiative: procedure.input(z.object({ id: z.string().uuid() })).query(async ({ input, ctx }) => {
      return ctx.wiring.graphStore.getInitiative(input.id);
    }),

    listTouchpoints: procedure
      .input(paginatedInput.extend({ initiativeId: z.string().uuid().optional() }))
      .query(async ({ input, ctx }) => {
        assertPilotWorkspace(input.workspaceId);
        const { items, total } = await ctx.wiring.graphStore.listTouchpoints(input.workspaceId, {
          limit: input.limit,
          offset: input.offset,
          ...(input.initiativeId ? { initiativeId: input.initiativeId } : {}),
        });
        return { items, total, hasMore: input.offset + items.length < total };
      }),

    listSignals: procedure
      .input(paginatedInput)
      .query(async ({ input, ctx }) => {
        assertPilotWorkspace(input.workspaceId);
        const { items, total } = await ctx.wiring.graphStore.listSignals(input.workspaceId, {
          limit: input.limit,
          offset: input.offset,
        });
        return { items, total, hasMore: input.offset + items.length < total };
      }),

    listPeople: procedure
      .input(paginatedInput)
      .query(async ({ input, ctx }) => {
        assertPilotWorkspace(input.workspaceId);
        const { items, total } = await ctx.wiring.graphStore.listPeople(input.workspaceId, {
          limit: input.limit,
          offset: input.offset,
        });
        return { items, total, hasMore: input.offset + items.length < total };
      }),

    listCommunities: procedure
      .input(paginatedInput)
      .query(async ({ input, ctx }) => {
        assertPilotWorkspace(input.workspaceId);
        const { items, total } = await ctx.wiring.graphStore.listCommunities(input.workspaceId, {
          limit: input.limit,
          offset: input.offset,
        });
        return { items, total, hasMore: input.offset + items.length < total };
      }),

    /** Records the user's reaction to a Signal (act|dismiss|save) — bookkeeping,
     * not a governed mutation; see graph-store.ts's header comment for why this
     * is a direct write rather than routed through action.propose. */
    recordSignalAction: procedure
      .input(
        z.object({
          workspaceId: z.string().min(1),
          signalId: z.string().uuid(),
          verb: z.enum(["act", "dismiss", "save"]),
        }),
      )
      .mutation(async ({ input, ctx }) => {
        assertPilotWorkspace(input.workspaceId);
        await ctx.wiring.graphStore.recordSignalAction({
          workspaceId: input.workspaceId,
          signalId: input.signalId,
          userId: ctx.identity.id,
          verb: input.verb,
        });
        return { ok: true };
      }),
  }),

  /**
   * JobPilot — wires the pure `@bridge/jobpilot` package (scoring, state-machine,
   * table spec) to real persistence for the first time (frontend-migration-
   * scoping.md Phase 4). Job/application CRUD is workspace-authenticated, not
   * routed through the governed pipeline — tracking a job posting has no
   * external effect requiring approval, same tier as workspace membership.
   * `transition` validates against @bridge/jobpilot's own state machine BEFORE
   * persisting, so an invalid stage jump is rejected here, not silently written.
   */
  jobpilot: t.router({
    create: procedure
      .input(
        z.object({
          workspaceId: z.string().min(1),
          title: z.string().min(1),
          company: z.string().min(1),
          location: z.string().optional(),
          salaryMax: z.number().int().positive().optional(),
          url: z.string().url().optional(),
          source: z.string().optional(),
          isRemote: z.boolean().optional(),
          descriptionKeywords: z.array(z.string()).optional(),
          candidate: z.object({
            categories: z.array(z.string()),
            skills: z.array(z.string()),
            minSalary: z.number().optional(),
            locations: z.array(z.string()).optional(),
          }),
        }),
      )
      .mutation(async ({ input, ctx }) => {
        assertPilotWorkspace(input.workspaceId);
        const job: JobProfile = {
          title: input.title,
          company: input.company,
          ...(input.location ? { location: input.location } : {}),
          ...(input.salaryMax != null ? { salaryMax: input.salaryMax } : {}),
          ...(input.isRemote != null ? { isRemote: input.isRemote } : {}),
          ...(input.descriptionKeywords ? { descriptionKeywords: input.descriptionKeywords } : {}),
        };
        const candidate: CandidateProfile = {
          categories: input.candidate.categories,
          skills: input.candidate.skills,
          ...(input.candidate.minSalary != null ? { minSalary: input.candidate.minSalary } : {}),
          ...(input.candidate.locations ? { locations: input.candidate.locations } : {}),
        };
        const fit = scoreJobFit(job, candidate);
        const { job: jobRow, application } = await ctx.wiring.jobpilotStore.createJob({
          workspaceId: input.workspaceId,
          title: input.title,
          company: input.company,
          ...(input.location ? { location: input.location } : {}),
          ...(input.salaryMax != null ? { salaryMax: input.salaryMax } : {}),
          ...(input.url ? { url: input.url } : {}),
          ...(input.source ? { source: input.source } : {}),
        });
        const scored = await ctx.wiring.jobpilotStore.updateApplication(application.id, { fitScore: fit.score, flag: fit.flag });
        return { job: jobRow, application: scored ?? application, fit };
      }),

    list: procedure
      .input(paginatedInput)
      .query(async ({ input, ctx }) => {
        assertPilotWorkspace(input.workspaceId);
        const { items, total } = await ctx.wiring.jobpilotStore.listJobs(input.workspaceId, {
          limit: input.limit,
          offset: input.offset,
        });
        return { items, total, hasMore: input.offset + items.length < total };
      }),

    /** Moves an application's stage — rejects invalid jumps via @bridge/jobpilot's
     * own transition() BEFORE writing (queued->tailoring->evaluating->... only). */
    transition: procedure
      .input(
        z.object({
          workspaceId: z.string().min(1),
          applicationId: z.string().uuid(),
          from: z.string(),
          to: z.string(),
        }),
      )
      .mutation(async ({ input, ctx }) => {
        assertPilotWorkspace(input.workspaceId);
        const application = await ctx.wiring.jobpilotStore.getApplication(input.applicationId, input.workspaceId);
        if (!application) throw new TRPCError({ code: "NOT_FOUND", message: "unknown application" });
        try {
          transition(application.stage as ApplicationStage, input.to as ApplicationStage, application.id, "user");
        } catch (err) {
          if (err instanceof InvalidTransitionError) {
            throw new TRPCError({ code: "BAD_REQUEST", message: err.message });
          }
          throw err;
        }
        const updated = await ctx.wiring.jobpilotStore.updateApplication(application.id, { stage: input.to });
        return updated;
      }),
  }),

  /**
   * Helpdesk — the one workspace tool with a genuine public/unauthenticated
   * surface (frontend-migration-scoping.md gap #3). The `public` sub-router's
   * three procedures NEVER read `ctx.identity`; a submitter's only credential
   * is possession of the opaque `accessToken` returned by `createTicket` (the
   * same trust model as a password-reset link) — see helpdesk-store.ts's
   * header comment and docs/raw/decisions-log.md for why this avoided adding a
   * new Actor type / identity-resolution change. The top-level procedures below
   * are the authenticated support-agent inbox (workspace members only).
   */
  helpdesk: t.router({
    public: t.router({
      createTicket: procedure
        .input(
          z.object({
            workspaceId: z.string().min(1),
            subject: z.string().min(1),
            submitterEmail: z.string().email(),
            submitterName: z.string().optional(),
            body: z.string().min(1),
          }),
        )
        .mutation(async ({ input, ctx }) => {
          assertPilotWorkspace(input.workspaceId);
          const { ticket, message } = await ctx.wiring.helpdeskStore.createTicket({
            workspaceId: input.workspaceId,
            subject: input.subject,
            submitterEmail: input.submitterEmail,
            body: input.body,
            ...(input.submitterName ? { submitterName: input.submitterName } : {}),
          });
          return { ticket, message };
        }),

      getThread: procedure
        .input(z.object({ accessToken: z.string().min(1) }))
        .query(async ({ input, ctx }) => {
          const result = await ctx.wiring.helpdeskStore.getTicketByToken(input.accessToken);
          if (!result) throw new TRPCError({ code: "NOT_FOUND", message: "unknown ticket" });
          return result;
        }),

      reply: procedure
        .input(z.object({ accessToken: z.string().min(1), body: z.string().min(1) }))
        .mutation(async ({ input, ctx }) => {
          const message = await ctx.wiring.helpdeskStore.replyByToken(input.accessToken, input.body);
          if (!message) throw new TRPCError({ code: "NOT_FOUND", message: "unknown ticket" });
          return message;
        }),
    }),

    /** Support-agent inbox — workspace-authenticated. */
    list: procedure
      .input(paginatedInput)
      .query(async ({ input, ctx }) => {
        assertPilotWorkspace(input.workspaceId);
        const { items, total } = await ctx.wiring.helpdeskStore.listTickets(input.workspaceId, {
          limit: input.limit,
          offset: input.offset,
        });
        return { items, total, hasMore: input.offset + items.length < total };
      }),

    get: procedure
      .input(z.object({ workspaceId: z.string().min(1), ticketId: z.string().uuid() }))
      .query(async ({ input, ctx }) => {
        assertPilotWorkspace(input.workspaceId);
        const result = await ctx.wiring.helpdeskStore.getTicket(input.workspaceId, input.ticketId);
        if (!result) throw new TRPCError({ code: "NOT_FOUND", message: "unknown ticket" });
        return result;
      }),

    reply: procedure
      .input(
        z.object({
          workspaceId: z.string().min(1),
          ticketId: z.string().uuid(),
          body: z.string().min(1),
          status: z.enum(["open", "pending", "resolved", "closed"]).optional(),
        }),
      )
      .mutation(async ({ input, ctx }) => {
        assertPilotWorkspace(input.workspaceId);
        const message = await ctx.wiring.helpdeskStore.replyAsAgent(
          input.workspaceId,
          input.ticketId,
          ctx.identity.id,
          input.body,
          input.status,
        );
        if (!message) throw new TRPCError({ code: "NOT_FOUND", message: "unknown ticket" });
        return message;
      }),

    /**
     * Help Request routing (P2 Helpdesk package, ADR-021 — the
     * `helpdesk.capability-routing` capability in tools/helpdesk/package.yaml).
     * Routes a help request over the workspace graph: candidates default to
     * the workspace's members; topic tags may be supplied by the caller (the
     * graph carries no per-person topic tags yet — with none supplied the
     * result is an HONEST empty route list, never a fabricated match).
     */
    route: procedure
      .input(
        z.object({
          workspaceId: z.string().min(1),
          subject: z.string().min(1),
          body: z.string().default(""),
          /** Optional per-person topic tags ({personId -> topics[]}) until the
           * graph carries real topic/skill data (see docs/BUGS.md). */
          topicsByPerson: z.record(z.array(z.string())).optional(),
          limit: z.number().int().min(1).max(10).default(3),
        }),
      )
      .query(async ({ input, ctx }) => {
        assertPilotWorkspace(input.workspaceId);
        const members = await ctx.wiring.workspaceStore.listMembers(input.workspaceId);
        const candidates: HelpResponderCandidate[] = members.map((m) => ({
          personId: m.userId,
          displayName: m.name ?? m.email,
          topics: input.topicsByPerson?.[m.userId] ?? [],
        }));
        const routes = routeHelpRequest({ subject: input.subject, body: input.body }, candidates, input.limit);
        return { routes };
      }),

    /**
     * Help Offer staging (the `helpdesk.offer-drafting` capability) — the
     * answer is STAGED as a governed proposal through the SAME pipeline
     * propose/decide path every other draft-then-approve surface uses; this
     * procedure never sends or commits the answer itself. resourceType
     * "signal": a Help Offer is a Signal-shaped recommendation (every Signal
     * -> an action), decided by a human on the approvals surface.
     */
    stageAnswer: procedure
      .input(
        z.object({
          workspaceId: z.string().min(1),
          subject: z.string().min(1),
          body: z.string().default(""),
          routedToPersonId: z.string().min(1),
          routedToDisplayName: z.string().min(1),
          draftBody: z.string().min(1),
        }),
      )
      .mutation(async ({ input, ctx }) => {
        assertPilotWorkspace(input.workspaceId);
        const offer = draftHelpOffer(
          { subject: input.subject, body: input.body },
          { personId: input.routedToPersonId, displayName: input.routedToDisplayName, score: 0, matchedTopics: [] },
          input.draftBody,
        );
        const proposal = await ctx.wiring.pipeline.propose(
          {
            workspaceId: input.workspaceId,
            actor: { type: ctx.identity.type, id: ctx.identity.id },
            action: "write",
            resourceType: "signal",
            resourceId: input.routedToPersonId,
            inputs: { ...offer },
            skill: "stageMutation",
          },
          ctx.run,
        );
        return { proposal, offer };
      }),
  }),

  /**
   * Resources — replaces the prototype's Supabase-direct `resources_canonical`
   * read (frontend-migration-scoping.md gap #4) with a governed, workspace-
   * scoped catalog. Plain authenticated CRUD, not a pipeline action.
   */
  resources: t.router({
    create: procedure
      .input(
        z.object({
          workspaceId: z.string().min(1),
          title: z.string().min(1),
          kind: z.enum(["book", "podcast", "vlog", "article", "other"]),
          url: z.string().url().optional(),
          notes: z.string().optional(),
          tags: z.array(z.string()).optional(),
        }),
      )
      .mutation(async ({ input, ctx }) => {
        assertPilotWorkspace(input.workspaceId);
        return ctx.wiring.resourcesStore.create({
          workspaceId: input.workspaceId,
          title: input.title,
          kind: input.kind,
          ...(input.url ? { url: input.url } : {}),
          ...(input.notes ? { notes: input.notes } : {}),
          ...(input.tags ? { tags: input.tags } : {}),
        });
      }),

    list: procedure
      .input(paginatedInput)
      .query(async ({ input, ctx }) => {
        assertPilotWorkspace(input.workspaceId);
        const { items, total } = await ctx.wiring.resourcesStore.list(input.workspaceId, {
          limit: input.limit,
          offset: input.offset,
        });
        return { items, total, hasMore: input.offset + items.length < total };
      }),
  }),

  /**
   * Capability Trust Model (docs/wiki/vision.md). Register creates a `draft`
   * manifest with a COMPUTED risk band (never client-declared). Approve routes
   * a lifecycle transition through the pipeline's own decide() semantics — the
   * decider is ctx.identity (server-resolved), never the request body, and the
   * agent-floor blocks any agent from approving, same guarantee action.decide
   * relies on. Activate enforces requiredApproval + the daily auto-activation
   * budgets + the kill switch before flipping active/trusted.
   */
  capability: t.router({
    /** Register a new capability manifest. Always creates state=draft — "generation
     * only ever creates draft" (Capability Builder never activates). */
    register: procedure.input(capabilityRegisterInput).mutation(async ({ input, ctx }) => {
      assertPilotWorkspace(input.workspaceId);
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
        workspaceId: input.workspaceId,
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
        workspaceId: input.workspaceId,
        state: "draft",
        suspended: false,
        evidence: {},
      });
      return { manifest: created, state };
    }),

    /** draft -> validated. A plain forward step; no evidence gate at this stage. */
    submitForValidation: procedure.input(capabilityIdInput).mutation(async ({ input, ctx }) => {
      const state = await ctx.wiring.capabilityStore.getState(input.manifestId);
      if (!state) throw new TRPCError({ code: "NOT_FOUND", message: "unknown capability manifest" });
      try {
        const result = advance(state.state, toEvidence(state.evidence), ctx.run.clock.nowISO(), {
          creationRequiredApproval: false,
        });
        return ctx.wiring.capabilityStore.upsertState({
          manifestId: input.manifestId,
          workspaceId: state.workspaceId,
          state: result.nextState,
          ...(result.trustedUntil ? { trustedUntil: result.trustedUntil } : {}),
          suspended: state.suspended,
          ...(state.suspendReason ? { suspendReason: state.suspendReason } : {}),
          evidence: state.evidence,
        });
      } catch (err) {
        if (err instanceof CapabilityInvalidTransitionError) {
          throw new TRPCError({ code: "BAD_REQUEST", message: err.message });
        }
        throw err;
      }
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
          workspaceId: state.workspaceId,
          actor: { type: ctx.identity.type, id: ctx.identity.id },
          action: "approve",
          resourceType: "skill", // capability rows are not yet their own ResourceType; skill is the closest governed registry token
          resourceId: input.manifestId,
          inputs: { manifestId: input.manifestId, fromState: state.state },
          skill: "stageMutation",
        },
        ctx.run,
      );
      if (proposal.status === "pending_review") {
        return { proposal, state };
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
        workspaceId: state.workspaceId,
        state: result.nextState,
        ...(result.trustedUntil ? { trustedUntil: result.trustedUntil } : {}),
        suspended: state.suspended,
        ...(state.suspendReason ? { suspendReason: state.suspendReason } : {}),
        evidence: state.evidence,
      });
      return { proposal, state: nextState };
    }),

    /**
     * Activate: enforces requiredApproval (risk band x audience x trust grants)
     * + the daily auto-activation budgets + the workspace kill switch before
     * treating an activation as auto-approved. A non-"auto" outcome does NOT
     * activate here — it reports the required approval band back to the
     * caller, which routes to `approve` (governance/explicit_human) or a
     * user-pref confirmation UI, matching "Generation != activation."
     */
    activate: procedure.input(capabilityActivateInput).mutation(async ({ input, ctx }) => {
      assertPilotWorkspace(input.workspaceId);
      const manifestRow = await ctx.wiring.capabilityStore.getManifest(input.manifestId);
      if (!manifestRow) throw new TRPCError({ code: "NOT_FOUND", message: "unknown capability manifest" });
      const state = await ctx.wiring.capabilityStore.getState(input.manifestId);
      if (!state) throw new TRPCError({ code: "NOT_FOUND", message: "unknown capability manifest state" });

      const decision = await resolveActivationApproval({
        workspaceId: input.workspaceId,
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
        await ctx.wiring.capabilityBudgets.recordAutoActivation(input.workspaceId, manifestRow.computedRisk, input.todayKey);
      }
      const nextState = await ctx.wiring.capabilityStore.upsertState({
        manifestId: input.manifestId,
        workspaceId: input.workspaceId,
        state: "active",
        suspended: false,
        evidence: state.evidence,
      });
      return { activated: true, decision, state: nextState };
    }),

    /** Failure -> suspend immediately. No approval needed — safety never queues. */
    suspend: procedure.input(capabilitySuspendInput).mutation(async ({ input, ctx }) => {
      const state = await ctx.wiring.capabilityStore.getState(input.manifestId);
      if (!state) throw new TRPCError({ code: "NOT_FOUND", message: "unknown capability manifest" });
      const result = suspendOnFailure(input.reason);
      return ctx.wiring.capabilityStore.upsertState({
        manifestId: input.manifestId,
        workspaceId: state.workspaceId,
        state: state.state,
        ...(state.trustedUntil ? { trustedUntil: state.trustedUntil } : {}),
        suspended: result.suspended,
        suspendReason: result.reason,
        evidence: state.evidence,
      });
    }),

    /** A dependency changed — demote trusted -> validated (no-op otherwise). */
    demoteOnDependencyChange: procedure.input(capabilityIdInput).mutation(async ({ input, ctx }) => {
      const state = await ctx.wiring.capabilityStore.getState(input.manifestId);
      if (!state) throw new TRPCError({ code: "NOT_FOUND", message: "unknown capability manifest" });
      const result = demoteOnDependencyChange(state.state, { creationRequiredApproval: false });
      return ctx.wiring.capabilityStore.upsertState({
        manifestId: input.manifestId,
        workspaceId: state.workspaceId,
        state: result.nextState,
        suspended: state.suspended,
        ...(state.suspendReason ? { suspendReason: state.suspendReason } : {}),
        evidence: state.evidence,
      });
    }),

    list: procedure.input(paginatedInput).query(async ({ input, ctx }) => {
      assertPilotWorkspace(input.workspaceId);
      const { items, total } = await ctx.wiring.capabilityStore.listManifests(input.workspaceId, {
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
  }),

  /**
   * P2 Capability packages (docs/raw/capability-package-format.md, ADR-018) —
   * the shipping unit ABOVE one capability_manifests row. Mirrors the
   * `capability` router's shape one level up: `register` always creates a
   * `private`-state installation row (generation != activation, same
   * invariant); `install` is the governed step — computes risk over the FULL
   * bundled+dependency closure (computePackageRisk), applies the lethal-
   * trifecta union check, then routes through the SAME pipeline
   * propose/decide semantics `capability.approve`/`workspace.blueprint.activate`
   * use (external band = same non-removable hard floor). `promote`/`rollback`
   * enforce single-live-version-per-workspace (packages/core/src/package/
   * lifecycle.ts) — promoting auto-demotes the prior available version;
   * rollback forks a NEW draft from history, never an in-place revert.
   */
  packages: t.router({
    /** Register a package manifest. Always creates state=private, status=
     * pending_review — no risk computed yet (that happens at `install`). */
    register: procedure.input(packageRegisterInput).mutation(async ({ input, ctx }) => {
      assertPilotWorkspace(input.workspaceId);
      let manifest;
      try {
        manifest = parsePackageManifest(input.manifest);
      } catch (err) {
        if (err instanceof PackageManifestValidationError) {
          throw new TRPCError({ code: "BAD_REQUEST", message: err.message });
        }
        throw err;
      }
      const created = await ctx.wiring.packageStore.create({
        workspaceId: input.workspaceId,
        packageName: manifest.name,
        packageVersion: manifest.version,
        manifest,
        computedRisk: "informational", // not yet computed — install() computes it
        state: "private",
        status: "pending_review",
        lineageManifestId: manifest.lineageManifestId,
      });
      return { installation: created };
    }),

    /**
     * Install = a governed proposal through the EXISTING pipeline, exactly
     * like `capability.approve` (docs/raw/capability-package-format.md §2).
     * Computes risk over the package's own capabilities AND every resolvable
     * package dependency's capabilities, applies the lethal-trifecta union
     * check (private-read + untrusted-ingest + egress ACROSS different bundled
     * capabilities still escalates to `external`), then defers to
     * requiredApproval/resolveActivationApproval via the same pipeline round
     * trip `capability.approve` uses — an agent can never resolve this, and
     * every attempt is audited whether auto-resolved or parked pending_review.
     */
    install: procedure.input(packageInstallInput).mutation(async ({ input, ctx }) => {
      assertPilotWorkspace(input.workspaceId);
      const installation = await ctx.wiring.packageStore.get(input.installationId);
      if (!installation || installation.workspaceId !== input.workspaceId) {
        throw new TRPCError({ code: "NOT_FOUND", message: "unknown package installation" });
      }

      // Resolve capability dependencies (by manifestId, ignoring versionRange —
      // capability-level dependency resolution is unversioned in the existing
      // capability.register path too) via the workspace's registered capability
      // manifests, and package dependencies via other installations of this
      // workspace's package store (name+version exact match, per the no-ranges rule).
      const capDepRows = new Map<string, CapabilityManifestRow>();
      for (const cap of installation.manifest.capabilities) {
        for (const dep of cap.dependencies) {
          const row = await ctx.wiring.capabilityStore.getManifest(dep.manifestId);
          if (row) capDepRows.set(dep.manifestId, row);
        }
      }
      const resolveCapabilityDependency = (id: string): CapabilityManifest | undefined => {
        const row = capDepRows.get(id);
        if (!row) return undefined;
        return {
          id: row.id,
          name: row.name,
          version: row.version,
          capabilityType: row.capabilityType,
          origin: row.origin,
          audience: row.audience,
          permissions: (row.manifest as { permissions?: CapabilityManifest["permissions"] } | null)?.permissions ?? [],
          connectors: (row.manifest as { connectors?: CapabilityManifest["connectors"] } | null)?.connectors ?? [],
          dependencies: row.dependencies,
        };
      };
      const { items: allInstallations } = await ctx.wiring.packageStore.list(input.workspaceId, { limit: 10000, offset: 0 });
      const resolvePackageDependency = (name: string, version: string) =>
        allInstallations.find((i) => i.packageName === name && i.packageVersion === version)?.manifest;

      const risk = computePackageRisk(installation.manifest, resolveCapabilityDependency, resolvePackageDependency);

      // Package-wide audience: the strictest (most-restrictive-raising) audience
      // across its own bundled capabilities — mirrors raiseForAudience's
      // "audience only ever raises, never lowers" contract at the package level.
      const audiences = installation.manifest.capabilities.map((c) => c.audience);
      const audience = audiences.includes("external_visible")
        ? "external_visible"
        : audiences.includes("team")
          ? "team"
          : "private";

      const decision = await resolveActivationApproval({
        workspaceId: input.workspaceId,
        riskBand: risk.effectiveRisk,
        audience,
        trustGrants: [], // trust_grants lookup is a store-layer follow-up — same gap capability.activate has
        killSwitch: ctx.wiring.capabilityKillSwitch,
        budgets: ctx.wiring.capabilityBudgets,
        todayKey: input.todayKey,
      });

      // Every capability in the package is registered via the EXISTING
      // capability.register path's semantics (draft state, never active) —
      // registration != activation, same invariant capability.register itself
      // enforces. This happens regardless of the approval outcome, mirroring
      // "install_flow.1_propose" in the format doc (registration precedes the
      // approval decision).
      //
      // Idempotency (ADR-024): re-installing a package version whose bundled
      // capability keeps the SAME (name, version) must not collide with
      // `capability_manifests_uq`. Check-before-insert via
      // `getManifestByNameVersion` (the natural key the unique constraint
      // enforces) and reuse the existing manifest row instead of re-creating
      // it — a second install of the identical capability is a no-op
      // re-registration, not a new manifest.
      const registeredManifestIds: string[] = [];
      for (const cap of installation.manifest.capabilities) {
        const existingManifest = await ctx.wiring.capabilityStore.getManifestByNameVersion(
          input.workspaceId,
          cap.name,
          cap.version,
        );
        const capId = existingManifest?.id ?? ctx.run.ids.next();
        if (!existingManifest) {
          await ctx.wiring.capabilityStore.createManifest({
            id: capId,
            workspaceId: input.workspaceId,
            capabilityType: cap.capabilityType,
            name: cap.name,
            version: cap.version,
            origin: cap.origin,
            audience: cap.audience,
            manifest: { permissions: cap.permissions, connectors: cap.connectors },
            computedRisk: risk.effectiveRisk,
            dependencies: cap.dependencies,
          });
        }
        await ctx.wiring.capabilityStore.upsertState({
          manifestId: capId,
          workspaceId: input.workspaceId,
          state: "draft",
          suspended: false,
          evidence: {},
        });
        registeredManifestIds.push(capId);
      }

      const withRisk = await ctx.wiring.packageStore.setState(installation.id, installation.state);
      const rerisked: PackageInstallationRow = { ...withRisk, computedRisk: risk.effectiveRisk };

      if (decision.requirement !== "auto") {
        // Not auto-approved — proposal parked pending_review via the SAME
        // pipeline round trip capability.approve uses, human decides, agent-floor applies.
        const proposal = await ctx.wiring.pipeline.propose(
          {
            workspaceId: input.workspaceId,
            actor: { type: ctx.identity.type, id: ctx.identity.id },
            action: "approve",
            resourceType: "skill", // package_installations has no dedicated ResourceType yet — same interim token capability.approve uses
            resourceId: installation.id,
            inputs: { installationId: installation.id, packageName: installation.packageName, effectiveRisk: risk.effectiveRisk },
            skill: "stageMutation",
          },
          ctx.run,
        );
        return { installed: false, decision, risk, proposal, installation: rerisked, registeredManifestIds };
      }

      if (decision.budgeted && (risk.effectiveRisk === "informational" || risk.effectiveRisk === "advisory")) {
        await ctx.wiring.capabilityBudgets.recordAutoActivation(input.workspaceId, risk.effectiveRisk, input.todayKey);
      }

      const installed = await ctx.wiring.packageStore.setStatus(installation.id, "installed");
      const installedWithRisk: PackageInstallationRow = { ...installed, computedRisk: risk.effectiveRisk };
      const advanced = await ctx.wiring.packageStore.setState(installation.id, advancePackageState(installation.state));
      return {
        installed: true,
        decision,
        risk,
        installation: { ...advanced, computedRisk: risk.effectiveRisk, status: installedWithRisk.status },
        registeredManifestIds,
      };
    }),

    list: procedure.input(paginatedInput).query(async ({ input, ctx }) => {
      assertPilotWorkspace(input.workspaceId);
      const { items, total } = await ctx.wiring.packageStore.list(input.workspaceId, {
        limit: input.limit,
        offset: input.offset,
      });
      return { items, total, hasMore: input.offset + items.length < total };
    }),

    get: procedure.input(packageIdInput).query(async ({ input, ctx }) => {
      const installation = await ctx.wiring.packageStore.get(input.installationId);
      if (!installation) throw new TRPCError({ code: "NOT_FOUND", message: "unknown package installation" });
      return { installation };
    }),

    /**
     * Promote a `promoted`-state installation to `available`, auto-demoting
     * whatever installation is currently `available` for the same package
     * name in this workspace — never two live versions side by side
     * (packages/core/src/package/lifecycle.ts's promoteToAvailable).
     */
    promote: procedure.input(packagePromoteInput).mutation(async ({ input, ctx }) => {
      assertPilotWorkspace(input.workspaceId);
      const target = await ctx.wiring.packageStore.get(input.installationId);
      if (!target || target.workspaceId !== input.workspaceId) {
        throw new TRPCError({ code: "NOT_FOUND", message: "unknown package installation" });
      }
      const currentlyAvailable = await ctx.wiring.packageStore.getAvailable(input.workspaceId, target.packageName);
      let result;
      try {
        result = promoteToAvailable(target, currentlyAvailable);
      } catch (err) {
        if (err instanceof InvalidPackageTransitionError || err instanceof Error) {
          throw new TRPCError({ code: "BAD_REQUEST", message: err.message });
        }
        throw err;
      }
      const promoted = await ctx.wiring.packageStore.setState(result.promoted.installationId, result.promoted.nextState);
      if (result.demoted) {
        await ctx.wiring.packageStore.setState(result.demoted.installationId, result.demoted.nextState);
      }
      return { installation: promoted };
    }),

    /**
     * Rollback = fork a NEW draft installation from a historical version,
     * never an in-place revert (append-only-ledger invariant, matches every
     * other Bridge mutation). The forked row still needs its own `install` to
     * go live — rollback alone does not activate it.
     */
    rollback: procedure.input(packageRollbackInput).mutation(async ({ input, ctx }) => {
      assertPilotWorkspace(input.workspaceId);
      const rollbackTarget = await ctx.wiring.packageStore.get(input.rollbackTargetId);
      if (!rollbackTarget || rollbackTarget.workspaceId !== input.workspaceId) {
        throw new TRPCError({ code: "NOT_FOUND", message: "unknown rollback target installation" });
      }
      const currentAvailable = await ctx.wiring.packageStore.getAvailable(input.workspaceId, rollbackTarget.packageName);
      if (!currentAvailable) {
        throw new TRPCError({ code: "BAD_REQUEST", message: `package "${rollbackTarget.packageName}" has no currently-available version to roll back from` });
      }
      const forked = rollbackFromHistory({ currentAvailable, rollbackTarget });
      const created = await ctx.wiring.packageStore.create(forked);
      return { installation: created };
    }),
  }),

  chiefOfStaff: t.router({
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
    converse: procedure.input(chiefOfStaffConverseInput).mutation(async ({ input, ctx }) => {
      assertPilotWorkspace(input.workspaceId);

      let chainOk = true;
      try {
        assertChainDepth(input.chainDepth);
      } catch {
        chainOk = false;
      }

      // The "echo" provider (in-memory mode's network-free ModelProvider double,
      // @bridge/core's EchoModelProvider) echoes its prompt back verbatim — it is
      // not a real classifier, so classifyIntent's model path would always fail
      // to parse a registered route id from it and degrade to "clarify" on every
      // turn. Excluding it here means in-memory mode genuinely exercises the
      // DETERMINISTIC KEYWORD FALLBACK (the offline-required path) rather than a
      // model path that can never succeed; any other registered provider
      // (Ollama/Anthropic in persistent mode) is used normally.
      const registeredModels = [...ctx.wiring.models.providers().values()].filter((p) => p.id !== "echo");
      const model = registeredModels[0];

      const decision = chainOk
        ? await classifyIntent({ message: input.message, registry: CHIEF_OF_STAFF_REGISTRY, ...(model ? { model } : {}) })
        : {
            kind: "direct_reply" as const,
            confidence: 0,
            reason: `chain depth ${input.chainDepth} hit the hard cap (${MAX_CHAIN_DEPTH}) — replying directly instead of routing further (best-so-far fallback)`,
            source: "keyword_fallback" as const,
          };

      if (decision.kind !== "route" || !decision.route) {
        return {
          reply:
            decision.kind === "clarify"
              ? "I'm not confident which capability handles that yet — could you say more about what you're trying to do?"
              : "Noted — I don't have a capability to route that to yet, but I've recorded the request.",
          decision,
          proposal: null,
        };
      }

      const target = CHIEF_OF_STAFF_REGISTRY.find((c) => c.id === decision.route);
      const proposal = await ctx.wiring.pipeline.propose(
        {
          workspaceId: input.workspaceId,
          actor: { type: ctx.identity.type, id: ctx.identity.id },
          action: "execute",
          resourceType: "skill",
          inputs: { route: decision.route, message: input.message },
          skill: "stageMutation",
        },
        ctx.run,
      );

      return {
        reply: `Routing this to "${decision.route}"${target ? ` (${target.description})` : ""} — proposed for review, not yet executed.`,
        decision,
        proposal,
      };
    }),
  }),
});

/** Normalize a persisted state row's `evidence` jsonb into the core
 * `CapabilityEvidence` shape lifecycle.ts's guards expect (defaults for any
 * field not yet recorded). */
function toEvidence(evidence: {
  activeRunCount?: number | undefined;
  successRate?: number | undefined;
  violationCount?: number | undefined;
  ageDays?: number | undefined;
}): {
  activeRunCount: number;
  successRate: number;
  violationCount: number;
  ageDays: number;
} {
  return {
    activeRunCount: evidence.activeRunCount ?? 0,
    successRate: evidence.successRate ?? 0,
    violationCount: evidence.violationCount ?? 0,
    ageDays: evidence.ageDays ?? 0,
  };
}

export type AppRouter = typeof appRouter;
