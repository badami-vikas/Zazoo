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
import { LEARNING_AGENT, PILOT_WORKSPACE, type Wiring } from "./wiring.js";
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
  compareRuns,
  buildWhyBetterCard,
  resolveGates,
  classifyApprovalBand,
  canGovernanceAutoApprove,
  rollupOrgHealth,
  InvalidTransitionError as CapabilityInvalidTransitionError,
  EvidenceThresholdError,
  compileBlueprint,
  BlueprintCompileError,
  classifyIntent,
  assertChainDepth,
  MAX_CHAIN_DEPTH,
  parseMention,
  parseSkillMention,
  invokeAgent,
  buildCommunicationsSystemPrompt,
  COMMUNICATIONS_SKILL,
  findFoundationalAgent,
  buildChiefOfStaffPersona,
  profileFromRow,
  resolveAnimalTone,
  parsePackageManifest,
  PackageManifestValidationError,
  computePackageRisk,
  evaluateSandboxRequirement,
  isUntrustedOrigin,
  trustGrantsForOrigin,
  advancePackageState,
  promoteToAvailable,
  rollbackFromHistory,
  InvalidPackageTransitionError,
  type CapabilityManifest,
  type CapabilityManifestRow,
  type CapabilityOrigin,
  type TrustGrantView,
  type WhyBetterCard,
  type CapabilityHealthRecord,
  type PendingProposalRecord,
  type WorkspaceBlueprint,
  type RoutableCapability,
  type PackageInstallationRow,
  type LedgerEntry,
  type Proposal,
  type CommonsListQuery,
  type CommonsPackageDetail,
  uuidv7,
} from "@bridge/core";
import { authUrl } from "@bridge/integrations-google";
import { routeHelpRequest, draftHelpOffer, type HelpResponderCandidate } from "@bridge/helpdesk";
import { scoreThesisFit, type ThesisProfile } from "@bridge/dealpilot";
import { scoreJobFit, transition, InvalidTransitionError, type ApplicationStage, type CandidateProfile, type JobProfile } from "@bridge/jobpilot";
import { getIntegrationStore } from "./social/integration-service.js";
import { BUILT_IN_PACKAGES } from "./built-in-packages.js";
import { listProviderIds, oauthScopesFor } from "./social/registry.js";
import {
  isRelationshipSignalEvidence,
  materializeApprovedRelationshipProposal,
  parseRelationshipSignalEvidence,
} from "./relationship-materializer.js";

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

/**
 * SEC-1 — every MUTATION must carry a verified identity, closing the silent
 * pilot-user fallback (identity.ts) on any persistent/prod deploy. Queries are left
 * open (read paths are already workspace-scoped and non-mutating); only `type ===
 * "mutation"` is gated, so a single middleware protects all current AND future
 * mutations with zero per-procedure wiring — no mutation can forget to opt in.
 *
 * A request is allowed to mutate iff it is genuinely authenticated, OR the process is
 * pure in-memory dev with no verifier configured (so local/no-auth work keeps flowing):
 *   - verifier + valid token .......... ALLOW  (authenticated)
 *   - verifier + no/again-invalid token REJECT (the anonymous-under-verifier hole)
 *   - no verifier + persistent/prod ... REJECT (the H1 "acts as pilot" hole)
 *   - no verifier + in-memory dev ..... ALLOW  (unchanged local DX)
 * `persistent` folds in NODE_ENV==='production' so a prod boot without DATABASE_URL
 * (already refused by assertProductionEnv) can't widen this either.
 *
 * Chained BEFORE `withPilotWorkspaceGuard` so authentication is checked before
 * workspace authorization — a 401 (who are you?) precedes a 403 (not your workspace).
 */
const requireAuthOnMutation = t.middleware(async ({ ctx, type, next }) => {
  if (type === "mutation") {
    const persistent = ctx.wiring.persistent || process.env.NODE_ENV === "production";
    const allowed = ctx.authenticated || (!ctx.verifying && !persistent);
    if (!allowed) {
      throw new TRPCError({
        code: "UNAUTHORIZED",
        message:
          "authentication required: this deployment verifies identities (or persists data), " +
          "but the request presented no verified credentials",
      });
    }
  }
  return next();
});

const procedure = t.procedure.use(requireAuthOnMutation).use(withPilotWorkspaceGuard);

type LearningMemoryContent =
  | { kind: "onboarding_preference"; figure: string; admiredFor: string }
  | { kind: "reflection_schedule"; dueAt: string; status: "scheduled" | "snoozed" | "paused" | "skipped" };

function parseLearningMemory(content: string): LearningMemoryContent | null {
  try {
    const parsed = JSON.parse(content) as LearningMemoryContent;
    return parsed?.kind === "onboarding_preference" || parsed?.kind === "reflection_schedule" ? parsed : null;
  } catch {
    return null;
  }
}

async function researchPublicFigure(figure: string): Promise<{ title: string; extract: string; url: string }> {
  const params = new URLSearchParams({
    action: "query",
    generator: "search",
    gsrsearch: figure,
    gsrlimit: "1",
    prop: "extracts|info",
    exintro: "1",
    explaintext: "1",
    inprop: "url",
    format: "json",
    origin: "*",
  });
  const response = await fetch(`https://en.wikipedia.org/w/api.php?${params}`, {
    headers: { "user-agent": "Bridge/0.1 onboarding-research" },
    signal: AbortSignal.timeout(8_000),
  });
  if (!response.ok) throw new TRPCError({ code: "BAD_GATEWAY", message: "Public-source research is unavailable." });
  const body = (await response.json()) as {
    query?: { pages?: Record<string, { title?: string; extract?: string }> };
  };
  const page = Object.values(body.query?.pages ?? {})[0];
  if (!page?.title || !page.extract) {
    throw new TRPCError({ code: "NOT_FOUND", message: `No unambiguous public source found for "${figure}".` });
  }
  const article = encodeURIComponent(page.title.replaceAll(" ", "_"));
  const url = new URL(`/wiki/${article}`, "https://en.wikipedia.org").toString();
  return { title: page.title, extract: page.extract.slice(0, 4_000), url };
}

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

/**
 * SEC-6: a workspace-scoped procedure must confirm the caller is actually a MEMBER
 * of the workspace, not merely that the id is the pilot workspace. `assertPilotWorkspace`
 * stays as the first (single-tenancy) layer; this membership check is the second, so
 * the guarantee survives multi-tenancy. `ctx.identity` is server-resolved, never
 * client-asserted. Applied to the membership surface (invite / listMembers / help route)
 * now; extend to every workspace-scoped procedure as the test harness seeds member
 * identities for its fixtures (see docs/raw/decisions-log.md, SEC-6).
 */
async function assertMembership(
  workspaceStore: Wiring["workspaceStore"],
  workspaceId: string,
  userId: string,
): Promise<void> {
  if (!(await workspaceStore.isMember(workspaceId, userId))) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: `actor "${userId}" is not a member of workspace "${workspaceId}"`,
    });
  }
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
const relationshipNodeTypeEnum = z.enum(["person", "community", "signal", "event"]);
const relationshipVisibilityEnum = z.enum(["private", "workspace", "public"]);

function proposalFromResolvedLedger(original: LedgerEntry, decision: LedgerEntry): Proposal {
  return {
    id: decision.id,
    status: "applied",
    request: {
      workspaceId: original.workspaceId,
      actor: { type: original.actorType, id: original.actorId },
      ...(original.onBehalfOfType && original.onBehalfOfId
        ? {
            onBehalfOf: {
              type: original.onBehalfOfType,
              id: original.onBehalfOfId,
              ...(original.delegationId ? { delegationId: original.delegationId } : {}),
            },
          }
        : {}),
      action: original.action,
      resourceType: original.resourceType,
      ...(original.resourceId ? { resourceId: original.resourceId } : {}),
      inputs: original.inputs,
      skill: "stageMutation",
      ...(original.dataScope ? { dataScope: original.dataScope } : {}),
      ...(original.context ? { context: original.context } : {}),
      ...(original.seed ? { seed: original.seed } : {}),
      ...(original.trustOrigin ? { trustOrigin: original.trustOrigin } : {}),
    },
    authority: {
      allowed: true,
      reason: "authorized; approved at review",
      basis: "role",
      dataScope: original.dataScope ?? "all",
    },
    policyResults: original.policyResults,
    output: { proposedOutput: decision.proposedOutput },
  };
}

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
  /** The user's chosen spirit animal (avatar-store.ts SPIRIT_ANIMALS id),
   * client-supplied — client-local preference today, not yet kernel data
   * (ADR-033's open item). Optional and additive: omitting it just means no
   * tone flavoring, never an error. */
  animal: z.string().optional(),
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
      const pendingEntry = await ctx.wiring.ledger.get(input.proposalId);
      if (
        input.decision === "edit" &&
        pendingEntry?.resourceType === "relation" &&
        isRelationshipSignalEvidence(pendingEntry.inputs)
      ) {
        try {
          parseRelationshipSignalEvidence(input.editedOutput);
        } catch (error) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: `Invalid edited Relationship evidence: ${error instanceof Error ? error.message : String(error)}`,
          });
        }
      }
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
      try {
        const relationshipRelations = await materializeApprovedRelationshipProposal(
          ctx.wiring.graphStore,
          resolved,
        );
        return relationshipRelations
          ? {
              ...resolved,
              effects: {
                ...effects,
                relationshipMaterialization: { status: "materialized" as const, relations: relationshipRelations },
              },
            }
          : { ...resolved, effects };
      } catch (error) {
        return {
          ...resolved,
          effects: {
            ...effects,
            relationshipMaterialization: {
              status: "failed" as const,
              reason: error instanceof Error ? error.message : String(error),
              retryProcedure: "relationship.reconcileApproved" as const,
            },
          },
        };
      }
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
  /**
   * Onboarding (ADR-033/R-030) — the server-side home for onboarding
   * personalization that used to live ONLY in browser localStorage
   * (avatar-store.ts). `verifyPhoneOtp` is an explicit, user-authorized DUMMY
   * flow (2026-07-08 ruling: "use dummy flow for now" — no real SMS provider
   * is wired) — it accepts any 6-digit code and is labeled as demo/test mode
   * in the client copy so it's never presented as a working integration.
   */
  onboarding: t.router({
    getProfile: procedure
      .input(z.object({ workspaceId: z.string().min(1) }))
      .query(async ({ input, ctx }) => {
        assertPilotWorkspace(input.workspaceId);
        return { profile: await ctx.wiring.onboardingProfileStore.get(input.workspaceId) };
      }),

    saveProfile: procedure
      .input(
        z.object({
          workspaceId: z.string().min(1),
          animal: z.string().min(1),
          answers: z.record(z.union([z.string(), z.array(z.string())])).default({}),
          // SEC-7: `linkedin` was removed from this trust-bearing enum. There is no
          // real LinkedIn OAuth proof wired, so accepting a client-asserted
          // `verificationMethod:"linkedin"` would let the browser fabricate a
          // verification/trust signal. Only `phone` (the explicitly-dummy OTP flow
          // below) is accepted until a real OAuth proof exists.
          verificationMethod: z.enum(["phone"]).nullable().default(null),
          connectedSourceIds: z.array(z.string()).default([]),
        }),
      )
      .mutation(async ({ input, ctx }) => {
        assertPilotWorkspace(input.workspaceId);
        const existing = await ctx.wiring.onboardingProfileStore.get(input.workspaceId);
        const row = {
          workspaceId: input.workspaceId,
          animal: input.animal,
          answers: input.answers,
          phoneVerified: input.verificationMethod === "phone" ? true : (existing?.phoneVerified ?? false),
          verificationMethod: input.verificationMethod ?? existing?.verificationMethod ?? null,
          connectedSourceIds: input.connectedSourceIds,
          updatedAtISO: new Date().toISOString(),
        };
        await ctx.wiring.onboardingProfileStore.save(row);
        return { profile: row };
      }),

    learningState: procedure
        .input(z.object({ workspaceId: z.string().min(1) }))
        .query(async ({ input, ctx }) => {
          assertPilotWorkspace(input.workspaceId);
          const rows = await ctx.wiring.memoryStore.retrieve(
            { limit: 100 },
            { workspaceId: input.workspaceId, userId: ctx.wiring.pilotUserId },
          );
          return {
            memories: rows
              .map((row) => ({ row, value: parseLearningMemory(row.content) }))
              .filter((item): item is typeof item & { value: LearningMemoryContent } => item.value !== null),
          };
        }),

    recommendFromRoleModel: procedure
        .input(
          z.object({
            workspaceId: z.string().min(1),
            figure: z.string().trim().min(2).max(120),
            admiredFor: z.string().trim().min(2).max(500),
          }),
        )
        .mutation(async ({ input, ctx }) => {
          assertPilotWorkspace(input.workspaceId);
          const source = await researchPublicFigure(input.figure);
          const recommendation = {
            kind: "learning_recommendation" as const,
            title: `Practice ${input.admiredFor} deliberately`,
            summary:
              `Once a week, choose one upcoming decision and write how "${input.admiredFor}" should change ` +
              "your preparation or communication. Review the outcome before repeating it.",
            documentedContext: source.extract.split(/\n|(?<=\.)\s+/).slice(0, 2).join(" "),
            interpretation:
              `The public source documents ${source.title}; the link to "${input.admiredFor}" is your stated preference, not a claim about the person's whole character.`,
            citation: { label: source.title, url: source.url },
            cadence: "weekly",
            stopCondition: "Pause or remove it whenever it stops being useful.",
          };
          const proposal = await ctx.wiring.pipeline.propose(
            {
              workspaceId: input.workspaceId,
              actor: { type: "agent", id: LEARNING_AGENT },
              onBehalfOf: { type: "user", id: ctx.identity.id },
              action: "write",
              resourceType: "signal",
              inputs: recommendation,
              skill: "stageLearningRecommendation",
              trustOrigin: "untrusted_external",
            },
            ctx.run,
          );
          const existing = await ctx.wiring.memoryStore.retrieve(
            { limit: 100 },
            { workspaceId: input.workspaceId, userId: ctx.wiring.pilotUserId },
          );
          if (!existing.some((row) => parseLearningMemory(row.content)?.kind === "onboarding_preference")) {
            await ctx.wiring.memoryStore.write({
              id: uuidv7(),
              workspaceId: input.workspaceId,
              type: "preference",
              scope: "private",
              content: JSON.stringify({ kind: "onboarding_preference", figure: input.figure, admiredFor: input.admiredFor }),
              confidence: 1,
              trustOrigin: "user_content",
              plane: "local",
              createdBy: ctx.identity.id,
              ownerUserId: ctx.wiring.pilotUserId,
            });
          }
          if (!existing.some((row) => parseLearningMemory(row.content)?.kind === "reflection_schedule")) {
            const dueAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1_000).toISOString();
            await ctx.wiring.memoryStore.write({
              id: uuidv7(),
              workspaceId: input.workspaceId,
              type: "procedural",
              scope: "private",
              content: JSON.stringify({ kind: "reflection_schedule", dueAt, status: "scheduled" }),
              confidence: 1,
              trustOrigin: "operator",
              plane: "local",
              createdBy: "learning",
              ownerUserId: ctx.wiring.pilotUserId,
            });
          }
          return { recommendation, proposal };
        }),

    correctMemory: procedure
        .input(z.object({ workspaceId: z.string().min(1), memoryId: z.string().uuid(), content: z.string().trim().min(1).max(500) }))
        .mutation(async ({ input, ctx }) => {
          assertPilotWorkspace(input.workspaceId);
          const auth = { workspaceId: input.workspaceId, userId: ctx.wiring.pilotUserId };
          const current = await ctx.wiring.memoryStore.get(input.memoryId, auth);
          const value = current && parseLearningMemory(current.content);
          if (!current || value?.kind !== "onboarding_preference") throw new TRPCError({ code: "NOT_FOUND" });
          return ctx.wiring.memoryStore.supersede(input.memoryId, {
            ...current,
            id: uuidv7(),
            content: JSON.stringify({ ...value, admiredFor: input.content }),
            trustOrigin: "user_content",
            createdBy: ctx.identity.id,
          });
        }),

    forgetMemory: procedure
        .input(z.object({ workspaceId: z.string().min(1), memoryId: z.string().uuid() }))
        .mutation(async ({ input, ctx }) => {
          assertPilotWorkspace(input.workspaceId);
          return {
            forgotten: await ctx.wiring.memoryStore.forget(input.memoryId, {
              workspaceId: input.workspaceId,
              userId: ctx.wiring.pilotUserId,
            }),
          };
        }),

    setReflection: procedure
        .input(
          z.object({
            workspaceId: z.string().min(1),
            memoryId: z.string().uuid(),
            action: z.enum(["snooze", "pause", "resume", "skip"]),
          }),
        )
        .mutation(async ({ input, ctx }) => {
          assertPilotWorkspace(input.workspaceId);
          const auth = { workspaceId: input.workspaceId, userId: ctx.wiring.pilotUserId };
          const current = await ctx.wiring.memoryStore.get(input.memoryId, auth);
          const value = current && parseLearningMemory(current.content);
          if (!current || value?.kind !== "reflection_schedule") throw new TRPCError({ code: "NOT_FOUND" });
          const status = input.action === "resume" ? "scheduled" : input.action === "snooze" ? "snoozed" : input.action === "pause" ? "paused" : "skipped";
          const dueAt = input.action === "snooze"
            ? new Date(Date.now() + 24 * 60 * 60 * 1_000).toISOString()
            : input.action === "resume"
              ? new Date(Date.now() + 7 * 24 * 60 * 60 * 1_000).toISOString()
              : value.dueAt;
          return ctx.wiring.memoryStore.supersede(input.memoryId, {
            ...current,
            id: uuidv7(),
            content: JSON.stringify({ ...value, dueAt, status }),
            trustOrigin: "user_content",
            createdBy: ctx.identity.id,
          });
        }),

    /** DUMMY — see router-level doc comment above. Any 6-digit code passes. */
    verifyPhoneOtp: procedure
      .input(z.object({ phone: z.string().min(3), code: z.string() }))
      .mutation(async ({ input }) => {
        const verified = /^\d{6}$/.test(input.code.trim());
        return {
          verified,
          dummy: true as const,
          verificationSource: "dummy" as const,
          message: verified
            ? "Demo verification passed — no SMS was actually sent."
            : "Enter any 6-digit code (demo mode — no real SMS is sent).",
        };
      }),
  }),

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
        await assertMembership(ctx.wiring.workspaceStore, input.workspaceId, ctx.identity.id);
        return ctx.wiring.workspaceStore.inviteMember(input.workspaceId, input.email);
      }),

    listMembers: procedure
      .input(z.object({ workspaceId: z.string().min(1) }))
      .query(async ({ input, ctx }) => {
        assertPilotWorkspace(input.workspaceId);
        await assertMembership(ctx.wiring.workspaceStore, input.workspaceId, ctx.identity.id);
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
   * TASK-008 Relationship Relation contract. Reads are always bounded to one
   * accessible anchor node; no full-network traversal exists here.
   */
  relationship: t.router({
    nodeTypeOwner: procedure
      .input(z.object({ workspaceId: z.string().min(1), nodeType: z.string().min(1) }))
      .query(async ({ input, ctx }) => {
        assertPilotWorkspace(input.workspaceId);
        await assertMembership(ctx.wiring.workspaceStore, input.workspaceId, ctx.identity.id);
        return ctx.wiring.graphStore.getNodeTypeOwner(input.nodeType);
      }),

    listRelations: procedure
      .input(
        paginatedInput.extend({
          nodeType: relationshipNodeTypeEnum,
          nodeId: z.string().uuid(),
          limit: z.number().int().min(1).max(100).default(50),
        }),
      )
      .query(async ({ input, ctx }) => {
        assertPilotWorkspace(input.workspaceId);
        await assertMembership(ctx.wiring.workspaceStore, input.workspaceId, ctx.identity.id);
        const { items, total } = await ctx.wiring.graphStore.listRelations(
          input.workspaceId,
          ctx.identity.id,
          { nodeType: input.nodeType, nodeId: input.nodeId },
          { limit: input.limit, offset: input.offset },
        );
        return { items, total, hasMore: input.offset + items.length < total };
      }),

    linkSignalEvidence: procedure
      .input(
        z.object({
          workspaceId: z.string().min(1),
          signalId: z.string().uuid(),
          sourceEventId: z.string().uuid(),
          visibility: relationshipVisibilityEnum.default("private"),
          userConfirmed: z.boolean().default(false),
          participants: z
            .array(
              z.object({
                recordType: z.enum(["person", "community"]),
                recordId: z.string().uuid(),
                role: z.string().trim().min(1).max(100).optional(),
                confidence: z.number().min(0).max(1),
              }),
            )
            .min(1)
            .max(100),
        }),
      )
      .mutation(async ({ input, ctx }) => {
        assertPilotWorkspace(input.workspaceId);
        await assertMembership(ctx.wiring.workspaceStore, input.workspaceId, ctx.identity.id);
        const detail = await ctx.wiring.graphStore.getSignalDetail(
          input.workspaceId,
          ctx.identity.id,
          input.signalId,
        );
        if (!detail) throw new TRPCError({ code: "NOT_FOUND", message: "Signal not found or not accessible" });
        if (!detail.sourceEvent || detail.sourceEvent.id !== input.sourceEventId) {
          throw new TRPCError({
            code: "PRECONDITION_FAILED",
            message: "The source Event must be the accessible Event associated with the Signal.",
          });
        }
        if (
          !input.participants.some(
            (participant) =>
              participant.recordType === detail.signal.subjectType &&
              participant.recordId === detail.signal.subjectId,
          )
        ) {
          throw new TRPCError({
            code: "PRECONDITION_FAILED",
            message: "Signal evidence participants must include the Signal subject.",
          });
        }
        const participantKeys = input.participants.map(
          (participant) => `${participant.recordType}:${participant.recordId}`,
        );
        if (new Set(participantKeys).size !== participantKeys.length) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "Signal evidence participants must be unique by Record.",
          });
        }
        for (const participant of input.participants) {
          const record =
            participant.recordType === "person"
              ? await ctx.wiring.graphStore.getPerson(input.workspaceId, ctx.identity.id, participant.recordId)
              : await ctx.wiring.graphStore.getCommunity(input.workspaceId, ctx.identity.id, participant.recordId);
          if (!record) {
            throw new TRPCError({
              code: "NOT_FOUND",
              message: `Participant ${participant.recordType}:${participant.recordId} is not accessible`,
            });
          }
        }
        const proposal = await ctx.wiring.pipeline.propose(
          {
            workspaceId: input.workspaceId,
            actor: { type: ctx.identity.type, id: ctx.identity.id, plane: "local" },
            action: "write",
            resourceType: "relation",
            inputs: {
              kind: "relationship_signal_evidence",
              signalId: detail.signal.id,
              sourceEventId: detail.sourceEvent.id,
              visibility: input.visibility,
              userConfirmed: input.userConfirmed,
              participants: input.participants,
            },
            skill: "stageMutation",
            dataScope: "private",
            seed: detail.sourceEvent.id,
          },
          ctx.run,
        );
        try {
          const relations = await materializeApprovedRelationshipProposal(
            ctx.wiring.graphStore,
            proposal,
          );
          return {
            proposal,
            relations,
            materialization: relations
              ? { status: "materialized" as const }
              : { status: "pending" as const },
          };
        } catch (error) {
          return {
            proposal,
            relations: null,
            materialization: {
              status: "failed" as const,
              reason: error instanceof Error ? error.message : String(error),
              retryProcedure: "relationship.reconcileApproved" as const,
            },
          };
        }
      }),

    reconcileApproved: procedure
      .input(z.object({ workspaceId: z.string().min(1), proposalId: z.string().min(1) }))
      .mutation(async ({ input, ctx }) => {
        assertPilotWorkspace(input.workspaceId);
        await assertMembership(ctx.wiring.workspaceStore, input.workspaceId, ctx.identity.id);
        const original = await ctx.wiring.ledger.get(input.proposalId);
        if (
          !original ||
          original.workspaceId !== input.workspaceId ||
          original.resourceType !== "relation" ||
          !isRelationshipSignalEvidence(original.inputs)
        ) {
          throw new TRPCError({ code: "NOT_FOUND", message: "Relationship proposal not found" });
        }
        const decision = await ctx.wiring.ledger.decisionFor(input.proposalId);
        if (!decision || (decision.userDecision !== "approve" && decision.userDecision !== "edit" && decision.userDecision !== "auto")) {
          throw new TRPCError({
            code: "PRECONDITION_FAILED",
            message: "Relationship proposal has not been approved",
          });
        }
        const proposal = proposalFromResolvedLedger(original, decision);
        const relations = await materializeApprovedRelationshipProposal(ctx.wiring.graphStore, proposal);
        if (!relations) {
          throw new TRPCError({
            code: "PRECONDITION_FAILED",
            message: "Approved proposal does not contain Relationship evidence",
          });
        }
        return { proposalId: input.proposalId, status: "materialized" as const, relations };
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
        await assertMembership(ctx.wiring.workspaceStore, input.workspaceId, ctx.identity.id);
        const { items, total } = await ctx.wiring.graphStore.listSignals(
          input.workspaceId,
          ctx.identity.id,
          { limit: input.limit, offset: input.offset },
        );
        return { items, total, hasMore: input.offset + items.length < total };
      }),

    listPeople: procedure
      .input(paginatedInput)
      .query(async ({ input, ctx }) => {
        assertPilotWorkspace(input.workspaceId);
        await assertMembership(ctx.wiring.workspaceStore, input.workspaceId, ctx.identity.id);
        const { items, total } = await ctx.wiring.graphStore.listPeople(
          input.workspaceId,
          ctx.identity.id,
          { limit: input.limit, offset: input.offset },
        );
        return { items, total, hasMore: input.offset + items.length < total };
      }),

    getPerson: procedure
      .input(z.object({ workspaceId: z.string().min(1), id: z.string().uuid() }))
      .query(async ({ input, ctx }) => {
        assertPilotWorkspace(input.workspaceId);
        await assertMembership(ctx.wiring.workspaceStore, input.workspaceId, ctx.identity.id);
        return ctx.wiring.graphStore.getPerson(input.workspaceId, ctx.identity.id, input.id);
      }),

    listCommunities: procedure
      .input(paginatedInput)
      .query(async ({ input, ctx }) => {
        assertPilotWorkspace(input.workspaceId);
        await assertMembership(ctx.wiring.workspaceStore, input.workspaceId, ctx.identity.id);
        const { items, total } = await ctx.wiring.graphStore.listCommunities(
          input.workspaceId,
          ctx.identity.id,
          { limit: input.limit, offset: input.offset },
        );
        return { items, total, hasMore: input.offset + items.length < total };
      }),

    getCommunity: procedure
      .input(z.object({ workspaceId: z.string().min(1), id: z.string().uuid() }))
      .query(async ({ input, ctx }) => {
        assertPilotWorkspace(input.workspaceId);
        await assertMembership(ctx.wiring.workspaceStore, input.workspaceId, ctx.identity.id);
        return ctx.wiring.graphStore.getCommunity(input.workspaceId, ctx.identity.id, input.id);
      }),

    getSignalDetail: procedure
      .input(z.object({ workspaceId: z.string().min(1), signalId: z.string().uuid() }))
      .query(async ({ input, ctx }) => {
        assertPilotWorkspace(input.workspaceId);
        await assertMembership(ctx.wiring.workspaceStore, input.workspaceId, ctx.identity.id);
        return ctx.wiring.graphStore.getSignalDetail(input.workspaceId, ctx.identity.id, input.signalId);
      }),

    proposeSignalAction: procedure
      .input(z.object({ workspaceId: z.string().min(1), signalId: z.string().uuid() }))
      .mutation(async ({ input, ctx }) => {
        assertPilotWorkspace(input.workspaceId);
        await assertMembership(ctx.wiring.workspaceStore, input.workspaceId, ctx.identity.id);
        const detail = await ctx.wiring.graphStore.getSignalDetail(input.workspaceId, ctx.identity.id, input.signalId);
        if (!detail) {
          throw new TRPCError({ code: "NOT_FOUND", message: "Signal not found" });
        }
        if (detail.participants.length === 0 || !detail.sourceEvent) {
          throw new TRPCError({
            code: "PRECONDITION_FAILED",
            message: "A governed Relationship Action requires an accessible participant Relation and source Event.",
          });
        }

        const proposal = await ctx.wiring.pipeline.propose(
          {
            workspaceId: input.workspaceId,
            actor: { type: ctx.identity.type, id: ctx.identity.id, plane: "local" },
            action: "write",
            resourceType: "signal",
            resourceId: detail.signal.id,
            inputs: {
              kind: "relationship_signal_action",
              signalId: detail.signal.id,
              sourceEventId: detail.sourceEvent.id,
              participantRefs: detail.participants.map((participant) => ({
                relationId: participant.relationId,
                recordType: participant.recordType,
                recordId: participant.recordId,
              })),
              recommendation: detail.signal.recommendedAction,
            },
            skill: "stageMutation",
            dataScope: "private",
            seed: detail.sourceEvent.id,
          },
          ctx.run,
        );
        if (proposal.status !== "rejected") {
          await ctx.wiring.graphStore.recordSignalAction({
            workspaceId: input.workspaceId,
            signalId: input.signalId,
            userId: ctx.identity.id,
            verb: "act",
          });
        }
        return proposal;
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
        await assertMembership(ctx.wiring.workspaceStore, input.workspaceId, ctx.identity.id);
        const detail = await ctx.wiring.graphStore.getSignalDetail(input.workspaceId, ctx.identity.id, input.signalId);
        if (!detail) {
          throw new TRPCError({ code: "NOT_FOUND", message: "Signal not found or not accessible" });
        }
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
        await assertMembership(ctx.wiring.workspaceStore, input.workspaceId, ctx.identity.id);
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
        await assertMembership(ctx.wiring.workspaceStore, input.workspaceId, ctx.identity.id);
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
        await assertMembership(ctx.wiring.workspaceStore, input.workspaceId, ctx.identity.id);
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
        await assertMembership(ctx.wiring.workspaceStore, input.workspaceId, ctx.identity.id);
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
        await assertMembership(ctx.wiring.workspaceStore, input.workspaceId, ctx.identity.id);
        const routedPerson = await ctx.wiring.graphStore.getPerson(
          input.workspaceId,
          ctx.identity.id,
          input.routedToPersonId,
        );
        if (!routedPerson) {
          throw new TRPCError({ code: "NOT_FOUND", message: "routed Person not found or not accessible" });
        }
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
            const gates = resolveGates(await ctx.wiring.policyParams.get(state.workspaceId));
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
        workspaceId: state.workspaceId,
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
        workspaceId: state.workspaceId,
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
     * view over the workspace's REAL capability manifests + states. Pending
     * proposals are the capabilities awaiting a governed approve/activate
     * decision (state validated|approved), risk = computedRisk. `violationSeries`
     * is an honest empty until a violation-history view lands (no fabricated
     * data — see CLAUDE.md's no-dummy-data rule). Renders for a workspace.
     */
    orgHealth: procedure.input(paginatedInput).query(async ({ input, ctx }) => {
      assertPilotWorkspace(input.workspaceId);
      const nowMs = Date.parse(ctx.run.clock.nowISO());
      const { items } = await ctx.wiring.capabilityStore.listManifests(input.workspaceId, {
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

      // PKG-1 sandbox floor (Month-6): an executable capability may only install
      // when its declared isolation satisfies the sandbox gate — no
      // `isolation: "none"`, and any capability whose sandbox grants network/
      // filesystem needs a real container/VM boundary (process isolation is not
      // a boundary). A half-declared executable is rejected here rather than
      // reaching Active unsandboxed. Declarative capabilities pass trivially.
      for (const cap of installation.manifest.capabilities) {
        const sandbox = evaluateSandboxRequirement(cap);
        if (!sandbox.satisfied) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: `capability "${cap.name}" cannot be installed: ${sandbox.reason} (declared isolation "${sandbox.isolation}")`,
          });
        }
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

      // PKG-2 community-origin floor input: a package is treated at its
      // LEAST-trusted capability origin — if any bundled capability is
      // community/user_code (untrusted), the whole install is floored there.
      const resolvedTrustGrants: TrustGrantView[] = []; // store-layer follow-up (same gap capability.activate has)
      const floorOrigin: CapabilityOrigin = installation.manifest.capabilities.some((c) => isUntrustedOrigin(c.origin))
        ? "community"
        : "built_in";

      const decision = await resolveActivationApproval({
        workspaceId: input.workspaceId,
        riskBand: risk.effectiveRisk,
        audience,
        // PKG-2 community-origin floor: an untrusted origin (community/user_code)
        // never receives trust-grant auto-activation — community is pinned to the
        // same tier as unreviewed local code, so it can never auto-trust above it.
        trustGrants: trustGrantsForOrigin(floorOrigin, resolvedTrustGrants),
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

  // ---------------------------------------------------------------------------
  // CM0 — Universal Commons registry tRPC surface (egg-commons-feature-roadmap
  // §CM0). Wires the CommonsRegistry port (wiring.commonsRegistry, backed by
  // HttpCommonsClient → services/commons :4780) as tRPC procedures so the web
  // app can browse, fetch, and initiate governed installs from the registry
  // without importing HTTP client code directly.
  //
  // Governance notes:
  //  - list/get/getVersion are read queries, no auth guard needed (same policy
  //    as every other .query in this router).
  //  - installPropose is a mutation → requireAuthOnMutation applies (SEC-1).
  //    It fetches from the registry (PKG-2 verify-on-install via HttpCommonsClient),
  //    registers the manifest in the workspace package store (state=private), and
  //    returns the installationId. The caller then calls `packages.install` for the
  //    full governed proposal → pipeline → approval flow — no logic duplication.
  //  - publishBuiltins is a mutation → same auth gate. Pushes the four built-in
  //    workspace-definition packages to the running Commons service. Idempotent:
  //    already-published versions are skipped, not failed.
  //  - ALL mutations still go through requireAuthOnMutation (pipe middleware) and
  //    withPilotWorkspaceGuard (error translation).
  // ---------------------------------------------------------------------------

  commons: t.router({
    /** Browse the registry — filterable by kind and/or tag, paginated. */
    list: procedure
      .input(
        z.object({
          kind: z.enum(["workspace_definition", "skill", "workflow", "agent", "tool", "view", "integration_bundle"]).optional(),
          tag: z.string().optional(),
          limit: z.number().int().min(1).max(100).optional(),
          offset: z.number().int().min(0).optional(),
        }),
      )
      .query(async ({ input, ctx }) => {
        const query: CommonsListQuery = {};
        if (input.kind !== undefined) query.kind = input.kind;
        if (input.tag !== undefined) query.tag = input.tag;
        if (input.limit !== undefined) query.limit = input.limit;
        if (input.offset !== undefined) query.offset = input.offset;
        return ctx.wiring.commonsRegistry.listAvailable(query);
      }),

    /** Package detail (latest + version history) for one package by name. */
    get: procedure
      .input(z.object({ name: z.string().min(1) }))
      .query(async ({ input, ctx }) => {
        const detail: CommonsPackageDetail | null = await ctx.wiring.commonsRegistry.get(input.name);
        if (!detail) throw new TRPCError({ code: "NOT_FOUND", message: `commons: package "${input.name}" not found` });
        return detail;
      }),

    /** One exact published version's full entry. */
    getVersion: procedure
      .input(z.object({ name: z.string().min(1), version: z.string().min(1) }))
      .query(async ({ input, ctx }) => {
        const entry = await ctx.wiring.commonsRegistry.getVersion(input.name, input.version);
        if (!entry) {
          throw new TRPCError({ code: "NOT_FOUND", message: `commons: ${input.name}@${input.version} not found` });
        }
        return entry;
      }),

    /**
     * Install-from-Commons Step 1: fetch a package from the registry (PKG-2
     * verify-on-install happens inside HttpCommonsClient.get/getVersion), validate
     * its manifest, and register it in the workspace package store as a private
     * installation. Returns the installationId so the caller can then drive the
     * governed install flow via `packages.install(installationId, todayKey)`.
     *
     * Separating fetch+register from install keeps the governed proposal logic
     * inside the existing `packages.install` handler — no duplication.
     */
    installPropose: procedure
      .input(
        z.object({
          workspaceId: z.string().min(1),
          name: z.string().min(1),
          /** Omit to install the latest version. */
          version: z.string().optional(),
        }),
      )
      .mutation(async ({ input, ctx }) => {
        assertPilotWorkspace(input.workspaceId);

        // Fetch from registry — HttpCommonsClient verifies the publisher signature (PKG-2).
        const entry = input.version
          ? await ctx.wiring.commonsRegistry.getVersion(input.name, input.version)
          : await ctx.wiring.commonsRegistry.get(input.name).then((d) => d?.latest ?? null);

        if (!entry) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: input.version
              ? `commons: ${input.name}@${input.version} not found`
              : `commons: package "${input.name}" not found`,
          });
        }

        // Re-validate the manifest at this seam (same guard packages.register uses).
        let manifest;
        try {
          manifest = parsePackageManifest({ package: entry.manifest });
        } catch (err) {
          if (err instanceof PackageManifestValidationError) {
            throw new TRPCError({ code: "BAD_REQUEST", message: `commons manifest invalid: ${err.message}` });
          }
          throw err;
        }

        // Register as a private installation — same as packages.register, but the
        // manifest source is the verified Commons entry, not a user-supplied object.
        const created = await ctx.wiring.packageStore.create({
          workspaceId: input.workspaceId,
          packageName: manifest.name,
          packageVersion: manifest.version,
          manifest,
          computedRisk: "informational", // packages.install recomputes over the full closure
          state: "private",
          status: "pending_review",
          lineageManifestId: manifest.lineageManifestId,
        });

        return { installation: created };
      }),

    /**
     * Publish the four built-in workspace-definition packages to the running
     * Commons service. Idempotent: already-published versions are skipped.
     * This is the runtime equivalent of `pnpm --filter @bridge/api publish-builtins`.
     * Requires authentication (mutation guard) to prevent arbitrary callers from
     * flooding the registry.
     */
    publishBuiltins: procedure.mutation(async ({ ctx }) => {
      const published: string[] = [];
      const skipped: string[] = [];
      const failed: { name: string; reason: string }[] = [];

      for (const { manifest } of BUILT_IN_PACKAGES) {
        try {
          await ctx.wiring.commonsRegistry.publish(manifest, ["built-in", manifest.kind]);
          published.push(`${manifest.name}@${manifest.version}`);
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          if (message.includes("already published")) {
            skipped.push(`${manifest.name}@${manifest.version}`);
          } else {
            failed.push({ name: manifest.name, reason: message });
          }
        }
      }

      if (failed.length > 0) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: `commons.publishBuiltins: ${failed.length} failure(s) — ${failed.map((f) => `${f.name}: ${f.reason}`).join("; ")}`,
        });
      }

      return { published, skipped };
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

      // AGENTS-2: resolve the spirit-animal tone + Chief-of-Staff persona
      // SERVER-SIDE from the stored onboarding profile rather than trusting the
      // client-supplied `input.animal`. The persisted profile's animal wins; the
      // client field is only a fallback for a workspace that hasn't saved a
      // profile yet (progressive onboarding). `profileFromRow` maps only what the
      // row actually carries — a missing profile just yields a generic persona,
      // same ZERO-input graceful default the kernel uses everywhere.
      const profileRow = await ctx.wiring.onboardingProfileStore.get(input.workspaceId);
      const profile = profileRow ? profileFromRow(profileRow) : undefined;
      const resolvedAnimalId = profile?.chosenAnimalId ?? input.animal;
      const tone = resolveAnimalTone(resolvedAnimalId);
      const cosPersona = buildChiefOfStaffPersona(profile ?? { workspaceId: input.workspaceId, source: "onboarding" });
      // Additive, display-only projection of the resolved CoS identity so the
      // client/avatar can reflect it — two different profiles yield two different
      // persona cards, observable at the API boundary. Never carries authority.
      const personaCard = { id: cosPersona.id, name: cosPersona.name, ...(cosPersona.tone ? { tone: cosPersona.tone } : {}) };

      // A leading "@communications"/"@comms" mention resolves to the
      // Communications SKILL (ADR-046), not an agent — no identity, no
      // capability_scope, just a direct model-backed drafting reply. Checked
      // before the agent-mention branch since the two mention sets are
      // disjoint (COMMUNICATIONS_SKILL.mentions was removed from
      // FOUNDATIONAL_AGENTS' registry).
      const skillMention = parseSkillMention(input.message);
      if (skillMention.skill === "communications") {
        const registeredModels = [...ctx.wiring.models.providers().values()].filter((p) => p.id !== "echo");
        const model = registeredModels[0];
        const system = buildCommunicationsSystemPrompt(tone);
        const text = model
          ? (await model.complete({ system, prompt: skillMention.rest || input.message, maxTokens: 512 })).text
          : `${COMMUNICATIONS_SKILL.mission} (offline mode — no model configured, so I can't draft this yet, but I've recorded the request.)`;
        return {
          reply: text,
          decision: { kind: "direct_reply" as const, confidence: 1, reason: "directly addressed via @communications skill", source: "model" as const },
          proposal: null,
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
        const registeredModels = [...ctx.wiring.models.providers().values()].filter((p) => p.id !== "echo");
        const model = registeredModels[0];

        // AGENTS-1: invoke the addressed agent as a first-class peer through the
        // @bridge/core `invokeAgent` seam (system-prompt assembly + model call +
        // offline fallback + the design-constraint check all live in core). The
        // result is a DISCRIMINATED UNION with no "executed" variant, so the
        // strongest thing a chat reply can carry is a draft this procedure must
        // still propose — the "no independent write" guarantee is structural,
        // not a convention re-checked here.
        const result = await invokeAgent({ agentId, message: rest || input.message, ...(model ? { model } : {}), ...(tone ? { tone } : {}) });

        if (result.kind === "information") {
          return {
            reply: result.text,
            decision: { kind: "direct_reply" as const, confidence: 1, reason: `directly addressed via @${agentId}`, source: "model" as const },
            proposal: null,
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
            workspaceId: input.workspaceId,
            actor: { type: ctx.identity.type, id: ctx.identity.id },
            action: "execute",
            resourceType: "skill",
            inputs: { agent: agentId, message: input.message, draft: result.text, designConstraintViolations: constraintViolations },
            skill: "stageMutation",
          },
          ctx.run,
        );
        return {
          reply: `${replyText}\n\nDrafted via ${agent.name} — proposed for review, not yet executed.`,
          decision: { kind: "route" as const, route: agentId, confidence: 1, reason: `directly addressed via @${agentId}`, source: "model" as const },
          proposal,
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
          agent: "chief_of_staff" as const,
          persona: personaCard,
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
        agent: "chief_of_staff" as const,
        persona: personaCard,
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
