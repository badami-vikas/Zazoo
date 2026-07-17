/**
 * tRPC router — the wire surface over the Universal Action Pipeline.
 *
 * Zod schemas here are the single validate+sanitize chokepoint at the seam
 * (backlog #24): nothing reaches the pipeline unvalidated. Procedures are thin —
 * all governance lives in the pipeline, not here.
 */
import { initTRPC, TRPCError } from "@trpc/server";
import { createHash } from "node:crypto";
import { z } from "zod";
import { IntegrationFloorScopeError } from "@bridge/db";
import type { ApiContext } from "./context.js";
import {
  LEARNING_AGENT,
  OUTREACH_AGENT,
  INTERNAL_STRATEGIST_AGENT,
  PILOT_WORKSPACE,
  LEARNING_ROLE_MODEL_GOAL_TYPE,
  PRODUCE_RECOMMENDATION_TASK_TYPE,
  HELPDESK_ROUTING_GOAL_TYPE,
  DRAFT_HELP_OFFER_TASK_TYPE,
  RELATIONSHIP_CAPTURE_GOAL_TYPE,
  STAGE_CAPTURE_TASK_TYPE,
  RELATIONSHIP_OUTREACH_GOAL_TYPE,
  DRAFT_OUTREACH_TASK_TYPE,
  JOBPILOT_CULTURE_RESEARCH_GOAL_TYPE,
  RESEARCH_CULTURE_SOURCE_TASK_TYPE,
  SYNTHESIZE_CULTURE_PROFILE_TASK_TYPE,
  resolveAuthorizedCultureSource,
  computeSourcePolicyHash,
  materializeCultureSourceFetch,
  cancelCultureSourceFetch,
  reconcileIntentChildConsistency,
  selfHealDeadSynthesisPointer,
  isArtifactExpired,
  CULTURE_SOURCE_REGISTRY,
  type SynthesizeCultureProfileOutput,
  type Wiring,
} from "./wiring.js";
import { resolveAuthorizedAgentRoleTemplate } from "./agent-role-templates.js";
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
  NotPendingProposalError,
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
  canonicalizeJson,
  normalizeCommonsTags,
  COMMUNICATIONS_SKILL,
  findFoundationalAgent,
  buildChiefOfStaffPersona,
  profileFromRow,
  resolveAnimalTone,
  parsePackageManifest,
  PackageManifestValidationError,
  computePackageRisk,
  maxRisk,
  evaluateSandboxRequirement,
  isUntrustedOrigin,
  trustGrantsForOrigin,
  advancePackageState,
  promoteToAvailable,
  rollbackFromHistory,
  InvalidPackageTransitionError,
  resolveSkillForTask,
  cancelChildAgentRun,
  completeChildAgentRun,
  createChildAgentRun,
  validateActionWithinChildRun,
  type ParentRunEnvelope,
  type CapabilityManifest,
  type CapabilityManifestRow,
  type CapabilityOrigin,
  type TrustGrantView,
  type WhyBetterCard,
  type CapabilityHealthRecord,
  type PendingProposalRecord,
  type Proposal,
  type WorkspaceBlueprint,
  type RoutableCapability,
  type PackageInstallationRow,
  type PackageManifest,
  type CommonsPackageEntry,
  type CommonsListQuery,
  type CommonsPackageDetail,
  type LedgerEntry,
  uuidv7,
} from "@bridge/core";
import { authUrl } from "@bridge/integrations-google";
import { routeHelpRequest, draftHelpOffer, type HelpResponderCandidate } from "@bridge/helpdesk";
import {
  CredentialAccessError,
  SourceDiscoveryGateError,
  applyThesisSourceDiscovery,
  dealPilotModuleManifest,
  proposeThesisSourceDiscovery,
  scoreThesisFit,
  type ThesisSourceDiscoveryProposal,
} from "@bridge/dealpilot";
import {
  scoreJobFit,
  transition,
  InvalidTransitionError,
  classifyCultureSource,
  MAX_CULTURE_SOURCES_PER_RUN,
  type ApplicationStage,
  type CandidateProfile,
  type JobProfile,
  type GroundedClaimInput,
} from "@bridge/jobpilot";
import { getIntegrationStore } from "./social/integration-service.js";
import {
  COMMONS_BUILT_IN_PACKAGES,
  DEALPILOT_SOURCE_RITUAL_ID,
  isModuleRuntimeRitualId,
  resolveModuleAgentRuntimeId,
  resolveModuleRitualRuntimeId,
} from "./built-in-packages.js";
import { assertCommonsEntryContentTrusted } from "./commons-client.js";
import { listModuleFiles, ModuleFilesPathError } from "./module-files.js";
import { listProviderIds, oauthScopesFor } from "./social/registry.js";

const t = initTRPC.context<ApiContext>().create();
type OutreachDraftResult =
  | Proposal
  | {
      id: string;
      status: "already_resolved";
      decision: "approve" | "veto" | "edit" | "auto";
    };
const outreachDraftsInFlight = new Map<string, Promise<OutreachDraftResult>>();

function stableProposalId(key: string): string {
  const hex = createHash("sha256").update(key).digest("hex").slice(0, 32).split("");
  hex[12] = "5";
  hex[16] = ((Number.parseInt(hex[16]!, 16) & 0x3) | 0x8).toString(16);
  const value = hex.join("");
  return `${value.slice(0, 8)}-${value.slice(8, 12)}-${value.slice(12, 16)}-${value.slice(16, 20)}-${value.slice(20)}`;
}

function stableOutreachProposalId(key: string): string {
  return stableProposalId(key);
}

function stablePackageInstallProposalId(workspaceId: string, installationId: string): string {
  return stableProposalId(`package-install:${workspaceId}:${installationId}`);
}

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

const requireAuthenticatedIdentity = t.middleware(async ({ ctx, next }) => {
  const persistent = ctx.wiring.persistent || process.env.NODE_ENV === "production";
  const allowed = ctx.authenticated || (!ctx.verifying && !persistent);
  if (!allowed) {
    throw new TRPCError({
      code: "UNAUTHORIZED",
      message:
        "authentication required: verified authentication is required because this deployment verifies identities (or persists data), " +
        "but the request presented no verified credentials",
    });
  }
  return next();
});

const procedure = t.procedure.use(requireAuthOnMutation).use(withPilotWorkspaceGuard);
const authenticatedProcedure = t.procedure.use(requireAuthenticatedIdentity).use(withPilotWorkspaceGuard);
const publicProcedure = t.procedure.use(withPilotWorkspaceGuard);

type LearningMemoryContent =
  | { kind: "onboarding_preference"; figure: string; admiredFor: string }
  | { kind: "reflection_schedule"; dueAt: string; status: "scheduled" | "snoozed" | "paused" | "skipped" }
  | { kind: "trust_capture"; appName: string; bundleId?: string; capturedAt: string };

function parseLearningMemory(content: string): LearningMemoryContent | null {
  try {
    const parsed = JSON.parse(content) as LearningMemoryContent;
    return parsed?.kind === "onboarding_preference" ||
      parsed?.kind === "reflection_schedule" ||
      parsed?.kind === "trust_capture"
      ? parsed
      : null;
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
  const endpoint = new URL("/w/api.php", "https://en.wikipedia.org");
  endpoint.search = params.toString();
  const response = await fetch(endpoint, {
    headers: { "user-agent": "Bridge/0.1 onboarding-research" },
    // This bounded lane never follows a redirect to a caller-controlled or
    // private address. General research remains in TASK-015.
    redirect: "error",
    signal: AbortSignal.timeout(8_000),
  });
  if (response.url && new URL(response.url).origin !== endpoint.origin) {
    throw new TRPCError({ code: "BAD_GATEWAY", message: "Public-source research left its allowlisted origin." });
  }
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
  c: { type: "initiative" | "community" | "ritual" | "child_agent_run"; id: string; runId?: string | undefined } | undefined,
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
 * AGS1 (TASK-007) real-catalog migration — `stageLearningRecommendation` is a
 * governed Skill now (see wiring.ts's `LEARNING_RECOMMENDATION_SKILL_MANIFEST`),
 * so every `pipeline.propose` call naming it needs a resolved Goal/Task. This
 * find-or-create helper keeps ONE durable Goal per workspace (reused across
 * calls — a Goal is a durable intended outcome, not reminted per request) and
 * mints one bounded Task per recommendation request (each recommendation IS
 * its own bounded unit of work), assigned to `LEARNING_AGENT`.
 */
/**
 * AGS1 (TASK-007) shared find-or-create Goal/Task provisioning — a Goal is a
 * durable intended outcome reused across calls (find-or-create by type); a
 * Task is a bounded unit of work minted fresh per call. Shared by every
 * router procedure that must supply a real `goalTaskRef` to a governed Skill.
 */
async function provisionGoalTask(
  wiring: Wiring,
  workspaceId: string,
  goalType: string,
  goalTitle: string,
  taskType: string,
  assignedAgentId: string,
): Promise<{ goalId: string; taskId: string }> {
  const seam = { nextId: () => uuidv7(), nowISO: () => new Date().toISOString() };
  const existingGoals = await wiring.goalTasks.listGoals(workspaceId);
  const goal =
    existingGoals.find((g) => g.type === goalType) ??
    (await wiring.goalTasks.createGoal({ workspaceId, type: goalType, title: goalTitle }, seam));
  const task = await wiring.goalTasks.createTask({ workspaceId, goalId: goal.id, type: taskType, assignedAgentId }, seam);
  return { goalId: goal.id, taskId: task.id };
}

async function provisionRoleModelRecommendationTask(
  wiring: Wiring,
  workspaceId: string,
): Promise<{ goalId: string; taskId: string }> {
  return provisionGoalTask(
    wiring,
    workspaceId,
    LEARNING_ROLE_MODEL_GOAL_TYPE,
    "Role-model deliberate-practice recommendations",
    PRODUCE_RECOMMENDATION_TASK_TYPE,
    LEARNING_AGENT,
  );
}

/** AGS1 (TASK-007 closure) — Help Offer drafting is LEARNING_AGENT's Task. */
async function provisionHelpdeskAnswerTask(wiring: Wiring, workspaceId: string): Promise<{ goalId: string; taskId: string }> {
  return provisionGoalTask(
    wiring,
    workspaceId,
    HELPDESK_ROUTING_GOAL_TYPE,
    "Helpdesk routing and Help Offer drafting",
    DRAFT_HELP_OFFER_TASK_TYPE,
    LEARNING_AGENT,
  );
}

/** AGS1 (TASK-007 closure) — a raw human capture is modeled as Learning
 * "observing authorized evidence" (its stated mandate). */
async function provisionCaptureTask(wiring: Wiring, workspaceId: string): Promise<{ goalId: string; taskId: string }> {
  return provisionGoalTask(
    wiring,
    workspaceId,
    RELATIONSHIP_CAPTURE_GOAL_TYPE,
    "Relationship evidence capture",
    STAGE_CAPTURE_TASK_TYPE,
    LEARNING_AGENT,
  );
}

async function provisionOutreachDraftTask(
  wiring: Wiring,
  workspaceId: string,
): Promise<{ goalId: string; taskId: string }> {
  return provisionGoalTask(
    wiring,
    workspaceId,
    RELATIONSHIP_OUTREACH_GOAL_TYPE,
    "Relationship outreach drafting",
    DRAFT_OUTREACH_TASK_TYPE,
    OUTREACH_AGENT,
  );
}

/** TASK-011 (JP3B) — one durable culture-research Goal per workspace; one bounded
 * research Task per company, assigned to LEARNING_AGENT (the source-gathering half). */
async function provisionCultureResearchTask(wiring: Wiring, workspaceId: string): Promise<{ goalId: string; taskId: string }> {
  return provisionGoalTask(
    wiring,
    workspaceId,
    JOBPILOT_CULTURE_RESEARCH_GOAL_TYPE,
    "JobPilot company-culture research",
    RESEARCH_CULTURE_SOURCE_TASK_TYPE,
    LEARNING_AGENT,
  );
}

/** TASK-011 (JP3B) — the synthesis half, assigned to INTERNAL_STRATEGIST_AGENT,
 * sharing the SAME durable culture-research Goal (one Goal, two Task types). */
async function provisionCultureSynthesisTask(wiring: Wiring, workspaceId: string): Promise<{ goalId: string; taskId: string }> {
  return provisionGoalTask(
    wiring,
    workspaceId,
    JOBPILOT_CULTURE_RESEARCH_GOAL_TYPE,
    "JobPilot company-culture research",
    SYNTHESIZE_CULTURE_PROFILE_TASK_TYPE,
    INTERNAL_STRATEGIST_AGENT,
  );
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

const dealpilotProcedure = procedure.use(async ({ ctx, next }) => {
  const authenticationRequired =
    ctx.verifying || ctx.wiring.persistent || process.env.NODE_ENV === "production";
  if (authenticationRequired && !ctx.authenticated) {
    throw new TRPCError({ code: "UNAUTHORIZED", message: "authentication required for DealPilot" });
  }
  await assertMembership(ctx.wiring.workspaceStore, PILOT_WORKSPACE, ctx.identity.id);
  return next();
});

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
      type: z.enum(["initiative", "community", "ritual", "child_agent_run"]),
      id: z.string().min(1),
      runId: z.string().optional(),
    })
    .optional(),
  seed: z.string().optional(),
  /** AGS1 (TASK-007) — binds this proposal to a resolved Goal/Task assignment.
   * Required only for skills that have a registered SkillManifest; see
   * `PipelineDeps.skillManifests`'s doc comment in @bridge/core's pipeline.ts. */
  goalTaskRef: z.object({ goalId: z.string().min(1), taskId: z.string().min(1) }).optional(),
});

const decideInput = z.object({
  proposalId: z.string().min(1),
  decision: z.enum(["approve", "veto", "edit"]),
  editedOutput: z.unknown().optional(),
  reason: z.string().trim().min(1).max(500).optional(),
});

const outreachDraftInput = z.object({
  workspaceId: z.string().min(1),
  sourceId: z.string().trim().min(1).max(500),
  label: z.string().trim().min(1).max(200),
  resource: z.string().trim().min(1).max(500),
  proposed: z.string().trim().min(1).max(20_000),
  channel: z.string().trim().min(1).max(100).optional(),
  prior: z.string().max(20_000).nullable().optional(),
  runId: z.string().trim().min(1).max(500).optional(),
  trace: z.object({
    signals: z.array(z.string().trim().min(1).max(500)).max(50),
    context: z.string().trim().min(1).max(5_000),
    reasoning: z.string().trim().min(1).max(5_000),
  }),
});

// ---------------------------------------------------------------------------
// AGS0-AGS2 (TASK-007) — Goal/Task-bound Skill resolution + bounded child
// Agent Runs. See @bridge/core's goal-task.ts / skill-manifest.ts /
// child-agent-run.ts for the governed primitives these procedures wrap.
// ---------------------------------------------------------------------------
const goalCreateInput = z.object({
  workspaceId: z.string().min(1),
  type: z.string().min(1),
  title: z.string().min(1),
});

const taskCreateInput = z.object({
  workspaceId: z.string().min(1),
  goalId: z.string().min(1),
  type: z.string().min(1),
  assignedAgentId: z.string().min(1),
});

const taskReassignInput = z.object({
  workspaceId: z.string().min(1),
  taskId: z.string().min(1),
  assignedAgentId: z.string().min(1),
});

const resolveSkillInput = z.object({
  workspaceId: z.string().min(1),
  goalId: z.string().min(1),
  taskId: z.string().min(1),
  /** The Agent attempting to use a Skill for this Task — server-resolved
   * authority (capabilityScope/plane/dataScope) always comes from
   * `ctx.wiring.agents`, never client-asserted. */
  agentId: z.string().min(1),
  skillId: z.string().min(1).optional(),
  requestedDataScope: dataScopeEnum.optional(),
});

const ritualStep = z.object({
  skill: z.string().min(1),
  action: actionEnum,
  resourceType: resourceTypeEnum,
  resourceId: z.string().uuid().optional(),
  inputs: z.unknown(),
  dataScope: dataScopeEnum.optional(),
  /** AGS1/TASK-007 — see RitualStepDef.goalTaskRef's doc comment (@bridge/core's ports.ts). */
  goalTaskRef: z.object({ goalId: z.string().min(1), taskId: z.string().min(1) }).optional(),
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
  modulePackageName: z.string().min(1).optional(),
  actor: actorSchema.optional(),
  onBehalfOf: onBehalfOfSchema.optional(),
  params: z.record(z.unknown()).optional(),
  seed: z.string().optional(),
});

const toolRunInput = ritualRunByIdInput.extend({ actor: actorSchema });

/** Layered, gated agent permissions (least-privilege; cf. Google incremental scopes).
 * `send` is intentionally NOT an egress tier — agents may never send (human-only). */
const egressTierEnum = z.enum(["none", "read-graph", "draft-graph", "source-internet"]);

const agentCreateInput = z.object({
  workspaceId: z.string().min(1),
  name: z.string().min(1),
  roleTemplateId: z.string().min(1),
});

const agentUpdateInput = z.object({
  agentId: z.string().min(1),
  name: z.string().min(1).optional(),
  roleTemplateId: z.string().min(1).optional(),
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

function packageInstallIdFromProposal(entry: LedgerEntry): string | undefined {
  if (typeof entry.inputs !== "object" || entry.inputs === null || Array.isArray(entry.inputs)) return undefined;
  const inputs = entry.inputs as Record<string, unknown>;
  if (inputs.operation !== "package_install" || typeof inputs.installationId !== "string") return undefined;
  if (entry.resourceId !== inputs.installationId) return undefined;
  if (entry.id !== stablePackageInstallProposalId(entry.workspaceId, inputs.installationId)) return undefined;
  return inputs.installationId;
}

async function findPendingProposalById(
  wiring: Wiring,
  workspaceId: string,
  proposalId: string,
): Promise<(Proposal & { createdAt: string }) | null> {
  let offset = 0;
  while (true) {
    const page = await wiring.pipeline.listPending(workspaceId, { limit: 200, offset });
    const found = page.items.find((proposal) => proposal.id === proposalId);
    if (found) return found;
    offset += page.items.length;
    if (page.items.length === 0 || offset >= page.total) return null;
  }
}

async function assertCurrentCommonsAttachment(
  wiring: Wiring,
  installation: PackageInstallationRow,
): Promise<CommonsPackageEntry | null> {
  const attachment = installation.moduleAttachment;
  if (!attachment) return null;
  const ownerModule = await wiring.packageStore.getAvailable(
    installation.workspaceId,
    attachment.modulePackageName,
  );
  if (!ownerModule || ownerModule.status !== "installed" || !ownerModule.manifest.module) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: `owning Module "${attachment.modulePackageName}" is no longer installed`,
    });
  }
  const need = ownerModule.manifest.module.commonsNeeds?.find(
    (candidate) => candidate.id === attachment.needId,
  );
  if (!need || need.agentId !== attachment.agentId) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Commons capability need is no longer owned by the attached Module Agent",
    });
  }
  const entry = await wiring.commonsRegistry.getVersion(
    installation.packageName,
    installation.packageVersion,
  );
  if (!entry || entry.integrity.value !== attachment.contentHash) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Commons installation no longer matches its pinned root artifact",
    });
  }
  try {
    assertCommonsEntryContentTrusted(entry);
  } catch (error) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: error instanceof Error ? error.message : "Commons root artifact failed trust verification",
    });
  }
  if (entry.kind !== need.kind || !need.tags.every((tag) => entry.tags.includes(tag))) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Commons package no longer satisfies the declared Module need",
    });
  }
  if (
    entry.manifest.capabilities.length === 0 ||
    entry.manifest.capabilities.some((capability) => capability.capabilityType !== "skill")
  ) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Only Skill packages can remain attached beneath a Module Agent",
    });
  }
  return entry;
}

async function verifiedCommonsDependencyInstallations(
  wiring: Wiring,
  root: PackageInstallationRow,
  rootEntry: CommonsPackageEntry | null,
): Promise<PackageInstallationRow[]> {
  if (!root.moduleAttachment || !rootEntry) return [];
  const { items } = await wiring.packageStore.list(root.workspaceId, { limit: 10_000, offset: 0 });
  const pins = new Map<string, string>(
    (rootEntry.securityScan.dependencyPins ?? []).map(
      (pin) => [`${pin.name}@${pin.version}`, pin.contentHash] as const,
    ),
  );
  const found = new Map<string, PackageInstallationRow>();
  const visited = new Set<string>();
  const visit = async (entry: CommonsPackageEntry): Promise<void> => {
    for (const dependency of entry.manifest.dependencies) {
      const key = `${dependency.manifestId}@${dependency.version}`;
      if (visited.has(key)) continue;
      visited.add(key);
      const expectedHash = pins.get(key);
      const dependencyEntry = await wiring.commonsRegistry.getVersion(
        dependency.manifestId,
        dependency.version,
      );
      if (!dependencyEntry || !expectedHash || dependencyEntry.integrity.value !== expectedHash) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `Commons dependency "${key}" does not match its signed content-hash pin`,
        });
      }
      try {
        assertCommonsEntryContentTrusted(dependencyEntry);
      } catch (error) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: error instanceof Error ? error.message : `Commons dependency "${key}" failed trust verification`,
        });
      }
      const local = items.find(
        (candidate) =>
          candidate.packageName === dependency.manifestId &&
          candidate.packageVersion === dependency.version &&
          candidate.moduleAttachment?.source === "commons" &&
          candidate.moduleAttachment.modulePackageName === root.moduleAttachment?.modulePackageName &&
          candidate.moduleAttachment.agentId === root.moduleAttachment?.agentId &&
          candidate.moduleAttachment.needId === root.moduleAttachment?.needId &&
          candidate.moduleAttachment.contentHash === expectedHash,
      );
      if (!local || !["private", "promoted", "available"].includes(local.state)) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `Commons dependency "${key}" is not staged in an activatable state`,
        });
      }
      found.set(local.id, local);
      for (const pin of dependencyEntry.securityScan.dependencyPins ?? []) {
        pins.set(`${pin.name}@${pin.version}`, pin.contentHash);
      }
      await visit(dependencyEntry);
    }
  };
  await visit(rootEntry);
  return [...found.values()];
}

async function activateApprovedPackageInstallation(
  wiring: Wiring,
  workspaceId: string,
  installationId: string,
): Promise<PackageInstallationRow> {
  let installation = await wiring.packageStore.get(installationId);
  if (!installation || installation.workspaceId !== workspaceId) {
    throw new TRPCError({ code: "NOT_FOUND", message: "unknown package installation" });
  }
  const rootEntry = await assertCurrentCommonsAttachment(wiring, installation);
  const dependencies = await verifiedCommonsDependencyInstallations(wiring, installation, rootEntry);
  for (const dependency of dependencies) {
    await wiring.packageStore.setComputedRisk(
      dependency.id,
      maxRisk(dependency.computedRisk, installation.computedRisk),
    );
    await wiring.packageStore.setStatus(dependency.id, "installed");
    let current = (await wiring.packageStore.get(dependency.id))!;
    if (current.state === "private") current = await wiring.packageStore.setState(current.id, "promoted");
    if (current.state === "promoted") {
      const available = await wiring.packageStore.getAvailable(
        workspaceId,
        current.packageName,
        current.moduleAttachment,
      );
      const promotion = promoteToAvailable(current, available);
      await wiring.packageStore.setState(promotion.promoted.installationId, promotion.promoted.nextState);
      if (promotion.demoted) {
        await wiring.packageStore.setState(promotion.demoted.installationId, promotion.demoted.nextState);
      }
    } else if (current.state !== "available") {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: `Commons dependency cannot activate from state "${current.state}"`,
      });
    }
  }
  if (installation.status !== "installed") {
    installation = await wiring.packageStore.setStatus(installation.id, "installed");
  }
  if (installation.state === "private") {
    installation = await wiring.packageStore.setState(installation.id, "promoted");
  } else if (installation.state !== "promoted" && installation.state !== "available") {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: `package installation cannot activate from state "${installation.state}"`,
    });
  }
  return installation;
}

async function validateDealPilotDiscoveryOutput(wiring: Wiring, inputs: unknown, output: unknown) {
  const request = inputs as {
    kind?: unknown;
    workspaceId?: unknown;
    thesisId?: unknown;
  };
  if (request.kind !== "thesis_source_discovery") return null;
  const proposed = output as ThesisSourceDiscoveryProposal | undefined;
  if (
    proposed?.kind !== "thesis_source_discovery" ||
    typeof request.workspaceId !== "string" ||
    typeof request.thesisId !== "string" ||
    proposed.workspaceId !== request.workspaceId ||
    proposed.thesisId !== request.thesisId ||
    !Array.isArray(proposed.relations)
  ) {
    throw new TRPCError({ code: "PRECONDITION_FAILED", message: "DealPilot discovery proposal binding is invalid" });
  }
  const thesis = await wiring.dealpilot.store.get("thesis", request.workspaceId, request.thesisId);
  if (!thesis || thesis.kind !== "thesis") {
    throw new TRPCError({ code: "PRECONDITION_FAILED", message: "DealPilot discovery Thesis is unavailable" });
  }
  const authorizedRelations: ThesisSourceDiscoveryProposal["relations"] = [];
  for (const relation of proposed.relations) {
    if (
      typeof relation !== "object" ||
      relation === null ||
      relation.thesisId !== request.thesisId ||
      typeof relation.sourceId !== "string"
    ) {
      throw new TRPCError({ code: "PRECONDITION_FAILED", message: "DealPilot discovery Relation is invalid" });
    }
    const source = await wiring.dealpilot.store.get("source", request.workspaceId, relation.sourceId);
    if (!source || source.kind !== "source" || source.rightsState !== "attested") {
      throw new TRPCError({
        code: "PRECONDITION_FAILED",
        message: `Source "${relation.sourceId}" is no longer authorized for discovery`,
      });
    }
    authorizedRelations.push({
      sourceId: source.id,
      thesisId: thesis.id,
      confidence: 0,
      provenance: "authorized_source_inventory",
      reason: "Authorized Source inventory candidate; Thesis fit is not scored",
    });
  }
  return {
    kind: "thesis_source_discovery",
    workspaceId: request.workspaceId,
    thesisId: request.thesisId,
    relations: authorizedRelations,
  } satisfies ThesisSourceDiscoveryProposal;
}

async function validateDealPilotDecision(
  wiring: Wiring,
  proposalId: string,
  decision: "approve" | "veto" | "edit",
  editedOutput?: unknown,
) {
  if (decision === "veto") return;
  const original = await wiring.ledger.get(proposalId);
  if (!original) return;
  await validateDealPilotDiscoveryOutput(
    wiring,
    original.inputs,
    decision === "edit" ? editedOutput : original.proposedOutput,
  );
}

async function materializeDealPilotApproval(wiring: Wiring, proposal: Proposal) {
  const validated = await validateDealPilotDiscoveryOutput(
    wiring,
    proposal.request.inputs,
    proposal.output?.proposedOutput,
  );
  if (!validated) return [];
  return applyThesisSourceDiscovery(wiring.dealpilot.store, validated);
}

/**
 * TASK-011 remediation (2026-07-19 coordinator distributed-defects review,
 * issue 9) — a STRICT output schema for `jobpilot.synthesizeCultureProfile`.
 * `synthesisResult` parses the persisted ledger row's `proposedOutput`
 * through this before ever rendering it: an arbitrary APPROVED proposal (of
 * ANY skill) whose output happens to be object-shaped, or a
 * `jobpilot.researchCultureSource` fetch-intent output, must be REJECTED
 * (never rendered) rather than blindly cast and served to the client. This
 * is in addition to, not instead of, cross-validating `resourceType`/
 * `action`/`parentRunId`/artifact provenance at the call site.
 */
const cultureEvidenceSchema = z.object({
  id: z.string().min(1),
  claimType: z.enum(["fact", "opinion", "theme", "contradiction", "inference"]),
  claimText: z.string(),
  sourceLabel: z.string(),
  sourceUrl: z.string(),
  // TASK-011 remediation (2026-07-19 coordinator distributed-defects
  // RE-review, issue 10) — `internal_derived_synthesis` is the distinct
  // provenance marker `groundClaims` now assigns to theme/inference/
  // contradiction evidence (never a real fetchable source type); the
  // strict output schema must accept it or every synthesis containing a
  // derived claim would be wrongly rejected as malformed.
  sourceType: z.enum(["company_official_page", "public_blog_or_press", "reddit", "google_reviews", "glassdoor", "internal_derived_synthesis"]),
  retrievedAt: z.string(),
  authorContext: z.string().nullable(),
  agentInference: z.boolean(),
  contradicts: z.array(z.string()).optional(),
});

const synthesizeCultureProfileOutputSchema = z.object({
  parentRunId: z.string().min(1),
  artifactHashes: z.array(z.object({ sourceId: z.string().min(1), contentHash: z.string().min(1) })),
  partition: z.object({
    facts: z.array(cultureEvidenceSchema),
    opinions: z.array(cultureEvidenceSchema),
    themes: z.array(cultureEvidenceSchema),
    contradictions: z.array(cultureEvidenceSchema),
    inferences: z.array(cultureEvidenceSchema),
  }),
  disclosure: z.object({
    used: z.array(z.object({ sourceLabel: z.string(), sourceUrl: z.string(), sourceType: z.string(), retrievedAt: z.string() })),
    skipped: z.array(z.object({ sourceLabel: z.string(), sourceType: z.string(), reason: z.string() })),
  }),
});

/**
 * TASK-011 remediation (2026-07-19 coordinator distributed-defects RE-review
 * round 2, issue 6) — the generic `action.decide` fail-closed backstop: a
 * ledger row that is SHAPED like a culture-research or culture-synthesis
 * proposal (by its distinctive `resourceType`/`context`/`inputs`
 * combination — the ONLY code paths in this router that produce these exact
 * shapes are `jobpilot.cultureResearch.propose`/`.synthesize` themselves)
 * must have a durable binding that agrees with the ledger row's OWN id
 * before a human decision may resolve it. Since propose() now preallocates
 * and binds BEFORE ever creating a real ledger row (see the `propose`
 * handler above), a legitimate proposal ALWAYS satisfies this; a proposal
 * that fails it can only be a corrupted/forged/out-of-band row that never
 * went through the real propose() path — reject it rather than letting
 * `pipeline.decide` (which has no knowledge of this binding at all) resolve
 * it anyway.
 */
async function assertCultureProposalBindingValid(wiring: Wiring, original: LedgerEntry): Promise<void> {
  if (original.resourceType === "external:fetch" && original.context?.type === "child_agent_run") {
    const childRunId = original.context.id;
    const record = await wiring.cultureFetchStore.get(original.workspaceId, childRunId);
    if (!record || record.proposalId !== original.id) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: `culture-research proposal "${original.id}" lacks a valid durable binding to its culture-fetch intent record — refusing to decide`,
      });
    }
    return;
  }
  const inputs = original.inputs as { parentRunId?: unknown; claims?: unknown } | null;
  if (original.resourceType === "signal" && original.action === "write" && typeof inputs?.parentRunId === "string" && Array.isArray(inputs.claims)) {
    const pointer = await wiring.cultureSynthesisPointerStore.getForParentRun(original.workspaceId, inputs.parentRunId);
    if (!pointer || pointer.proposalId !== original.id) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: `culture-synthesis proposal "${original.id}" lacks a valid durable binding to its synthesis pointer record — refusing to decide`,
      });
    }
  }
}

export const appRouter = t.router({
  health: procedure.query(() => ({ ok: true, service: "bridge-api" })),

  action: t.router({
    /** Propose a governed mutation → Proposal (pending_review | applied | rejected). */
    propose: procedure.input(proposeInput).mutation(async ({ input, ctx }) => {
      assertPilotWorkspace(input.workspaceId);
      await assertMembership(ctx.wiring.workspaceStore, input.workspaceId, ctx.identity.id);
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
          ...(input.goalTaskRef ? { goalTaskRef: input.goalTaskRef } : {}),
        },
        ctx.run,
      );
    }),

    /** A constrained browser request for the server-owned Outreach Agent to draft
     * one relationship Touchpoint. The caller controls the content, never Agent
     * identity, Skill, governed resource/action, or approval policy. */
    proposeOutreachDraft: authenticatedProcedure
      .input(outreachDraftInput)
      .mutation(async ({ input, ctx }) => {
        assertPilotWorkspace(input.workspaceId);
        await assertMembership(ctx.wiring.workspaceStore, input.workspaceId, ctx.identity.id);
        if (ctx.identity.type !== "user") {
          throw new TRPCError({
            code: "FORBIDDEN",
            message: "Only a user can request an Outreach Agent draft",
          });
        }

        const idempotencyKey = `${input.workspaceId}:${ctx.identity.id}:${input.sourceId}`;
        const proposalId = stableOutreachProposalId(idempotencyKey);
        const active = outreachDraftsInFlight.get(idempotencyKey);
        if (active) return active;

        const operation = (async (): Promise<OutreachDraftResult> => {
          let offset = 0;
          while (true) {
            const pending = await ctx.wiring.pipeline.listPending(input.workspaceId, {
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
            input.workspaceId,
          );
          try {
            return await ctx.wiring.pipeline.propose(
              {
                workspaceId: input.workspaceId,
                actor: { type: "agent", id: OUTREACH_AGENT },
                onBehalfOf: { type: "user", id: ctx.identity.id },
                action: "write",
                resourceType: "touchpoint",
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
                  ? { context: { type: "ritual", id: input.runId, runId: input.runId } }
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
              const pending = await ctx.wiring.pipeline.listPending(input.workspaceId, {
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
     * convention (dealpilot.list/integration.list).
     */
    listPending: authenticatedProcedure
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
        await assertMembership(ctx.wiring.workspaceStore, input.workspaceId, ctx.identity.id);
        const { items, total } = await ctx.wiring.pipeline.listPending(input.workspaceId, {
          limit: input.limit,
          offset: input.offset,
        });
        return { items, total, hasMore: input.offset + items.length < total };
      }),

    /** Read the append-only resolution state for idempotent review reconciliation. */
    resolution: authenticatedProcedure
      .input(z.object({ proposalId: z.string().min(1) }))
      .query(async ({ input, ctx }) => {
        const proposal = await ctx.wiring.ledger.get(input.proposalId);
        if (!proposal) throw new TRPCError({ code: "NOT_FOUND", message: "proposal not found" });
        assertPilotWorkspace(proposal.workspaceId);
        await assertMembership(ctx.wiring.workspaceStore, proposal.workspaceId, ctx.identity.id);
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

    /** Resolve a pending proposal: approve | veto | edit. */
    decide: authenticatedProcedure.input(decideInput).mutation(async ({ input, ctx }) => {
      // Decider is the SERVER-RESOLVED identity (ctx.identity), never the client's
      // claimed actor — the agent-floor in decide() blocks any agent from approving.
      const original = await ctx.wiring.ledger.get(input.proposalId);
      if (!original) throw new TRPCError({ code: "NOT_FOUND", message: "proposal not found" });
      assertPilotWorkspace(original.workspaceId);
      await assertMembership(ctx.wiring.workspaceStore, original.workspaceId, ctx.identity.id);
      // TASK-011 remediation (2026-07-19 coordinator distributed-defects
      // RE-review round 2, issue 6) — fail-closed backstop BEFORE any
      // decision is resolved: a proposal shaped like a culture-research/
      // synthesis output must carry a valid durable binding.
      await assertCultureProposalBindingValid(ctx.wiring, original);
      let resolved;
      try {
        const original = await ctx.wiring.ledger.get(input.proposalId);
        if (original && ctx.identity.type !== "agent") {
          await assertMembership(ctx.wiring.workspaceStore, original.workspaceId, ctx.identity.id);
        }
        await validateDealPilotDecision(
          ctx.wiring,
          input.proposalId,
          input.decision,
          input.editedOutput,
        );
        resolved = await ctx.wiring.pipeline.decide(
          input.proposalId,
          input.decision,
          ctx.identity,
          ctx.run,
          input.editedOutput,
          input.reason,
        );
      } catch (err) {
        // Double-approve / already-resolved (including the persistent ledger's
        // partial-unique-index race guard) → 409, not a generic 500.
        if (err instanceof AlreadyResolvedError) {
          throw new TRPCError({ code: "CONFLICT", message: err.message });
        }
        if (err instanceof NotPendingProposalError) {
          throw new TRPCError({ code: "BAD_REQUEST", message: err.message });
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
      try {
        const packageInstallationId = packageInstallIdFromProposal(original);
        const packageInstallation =
          packageInstallationId && input.decision !== "veto"
            ? await activateApprovedPackageInstallation(
                ctx.wiring,
                original.workspaceId,
                packageInstallationId,
              )
            : undefined;
        const effects = await ctx.wiring.google.onApproved(input.proposalId, resolved, ctx.run);
        const dealPilotEffects =
          resolved.status === "applied"
            ? await materializeDealPilotApproval(ctx.wiring, resolved)
            : [];
        return {
          ...resolved,
          effects,
          dealPilotEffects,
          effectsStatus: "confirmed" as const,
          ...(packageInstallation ? { packageInstallation } : {}),
        };
      } catch (cause) {
        const effectsError = cause instanceof Error ? cause.message : String(cause);
        let effectsAuditId: string | undefined;
        try {
          const auditId = ctx.run.ids.next();
          await ctx.wiring.ledger.append({
            id: auditId,
            workspaceId: resolved.request.workspaceId,
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
          effects: { materialized: false, sent: false },
          dealPilotEffects: [],
          effectsStatus: "failed" as const,
          effectsError,
          ...(effectsAuditId ? { effectsAuditId } : {}),
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
  /**
   * AGS1 (TASK-007 closure) — raw human capture (camera tool), migrated off a
   * client-constructed `action.propose` call (which previously sent a raw
   * `actor:{type:"user"}` for `skill:"stageCapture"`) onto a dedicated
   * procedure: the SERVER, never the client, decides the invoking Agent
   * (LEARNING_AGENT — "observes authorized evidence") and provisions the
   * Goal/Task `stageCapture`'s manifest requires (see wiring.ts's
   * STAGE_CAPTURE_SKILL_MANIFEST).
   */
  capture: t.router({
    stage: authenticatedProcedure
      .input(
        z.object({
          workspaceId: z.string().min(1),
          localMediaId: z.string().min(1),
          kind: z.enum(["photo", "video"]).optional(),
          caption: z.string().optional(),
          ocrText: z.string().optional(),
        }),
      )
      .mutation(async ({ input, ctx }) => {
        assertPilotWorkspace(input.workspaceId);
        await assertMembership(ctx.wiring.workspaceStore, input.workspaceId, ctx.identity.id);
        const goalTaskRef = await provisionCaptureTask(ctx.wiring, input.workspaceId);
        return ctx.wiring.pipeline.propose(
          {
            workspaceId: input.workspaceId,
            actor: { type: "agent", id: LEARNING_AGENT, plane: "local" },
            onBehalfOf: { type: "user", id: ctx.identity.id },
            action: "write",
            resourceType: "touchpoint",
            dataScope: "private" as DataScope,
            skill: "stageCapture",
            inputs: {
              local_media_id: input.localMediaId,
              ...(input.kind ? { kind: input.kind } : {}),
              ...(input.caption ? { caption: input.caption } : {}),
              ...(input.ocrText ? { ocrText: input.ocrText } : {}),
            },
            goalTaskRef,
          },
          ctx.run,
        );
      }),
  }),

  google: t.router({
    /** Connection + manifest surfaces for the Integrations UI. */
    list: authenticatedProcedure.query(async ({ ctx }) => {
      await assertMembership(ctx.wiring.workspaceStore, PILOT_WORKSPACE, ctx.identity.id);
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
    connectUrl: authenticatedProcedure.mutation(async ({ ctx }) => {
      await assertMembership(ctx.wiring.workspaceStore, PILOT_WORKSPACE, ctx.identity.id);
      if (!ctx.wiring.googleOAuth) {
        return { url: null as string | null, error: "oauth_not_configured" as const };
      }
      return { url: authUrl(ctx.wiring.googleOAuth, ctx.wiring.google.integrationId) };
    }),

    /** Revoke locally (delete the local token). */
    disconnect: authenticatedProcedure.mutation(async ({ ctx }) => {
      await assertMembership(ctx.wiring.workspaceStore, PILOT_WORKSPACE, ctx.identity.id);
      await ctx.wiring.google.disconnect();
      return { ok: true };
    }),

    /** Source Gmail through the gate → propose Touchpoints/Memories/Signals. */
    syncGmail: authenticatedProcedure
      .input(z.object({ maxResults: z.number().int().positive().max(100).optional(), query: z.string().optional() }).optional())
      .mutation(async ({ input, ctx }) => {
        await assertMembership(ctx.wiring.workspaceStore, PILOT_WORKSPACE, ctx.identity.id);
        return ctx.wiring.google.syncGmail(ctx.run, {
          ...(input?.maxResults ? { maxResults: input.maxResults } : {}),
          ...(input?.query ? { query: input.query } : {}),
        });
      }),

    /** Source Calendar through the gate → propose Touchpoints. */
    syncCalendar: authenticatedProcedure
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
        await assertMembership(ctx.wiring.workspaceStore, PILOT_WORKSPACE, ctx.identity.id);
        return ctx.wiring.google.syncCalendar(ctx.run, {
          ...(input?.maxResults ? { maxResults: input.maxResults } : {}),
          ...(input?.timeMin ? { timeMin: input.timeMin } : {}),
          ...(input?.timeMax ? { timeMax: input.timeMax } : {}),
        });
      }),

    /** Read-only projection: FULL Calendar events for the Calendar surface (gated
     * external:fetch, auto-approved as the user's own view). No Touchpoint proposals. */
    listEvents: authenticatedProcedure
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
        await assertMembership(ctx.wiring.workspaceStore, PILOT_WORKSPACE, ctx.identity.id);
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
    proposeSend: authenticatedProcedure
      .input(
        z.object({
          kind: z.enum(["email", "calendar"]),
          action: z.enum(["create", "update", "delete"]).optional(),
          envelope: z.record(z.unknown()),
        }),
      )
      .mutation(async ({ input, ctx }) => {
        await assertMembership(ctx.wiring.workspaceStore, PILOT_WORKSPACE, ctx.identity.id);
        return ctx.wiring.google.proposeSend(ctx.run, {
          kind: input.kind,
          ...(input.action ? { action: input.action } : {}),
          envelope: input.envelope as never,
        });
      }),
  }),

  /** Agent governance — create/update an agent from SERVER-OWNED role templates only.
   * Escalating capability (external:send, governance, full-graph, '*') is still
   * stripped at the seam as defense in depth; agents can never be created able to
   * send or approve, nor may callers name arbitrary capability or skill bundles. */
  agent: t.router({
    create: procedure.input(agentCreateInput).mutation(async ({ input, ctx }) => {
      // TASK-011 remediation (2026-07-18 coordinator final review, issue 5) —
      // membership/authority checks apply to agent creation like every other
      // workspace-scoped mutation; a caller may not mint an Agent into a
      // workspace they don't belong to.
      assertPilotWorkspace(input.workspaceId);
      await assertMembership(ctx.wiring.workspaceStore, input.workspaceId, ctx.identity.id);
      const mem = ctx.wiring.memory;
      if (!mem) throw new Error("agent.create: in-memory governance store required (persistent agent CRUD pending)");
      const template = resolveAuthorizedAgentRoleTemplate(input.workspaceId, input.roleTemplateId);
      if (!template) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `unknown or unauthorized agent role template "${input.roleTemplateId}" for this workspace`,
        });
      }
      const built = buildAgentCapability({
        capabilityScope: [...template.capabilityScope],
        egressTier: template.egressTier as EgressTier,
      });
      const agentId = ctx.run.ids.next();
      mem.roles.roleGrants.set(template.roleId, [...template.roleGrants]);
      mem.agents.scope.set(agentId, built.scope);
      mem.agents.tiers.set(agentId, template.dataScope as DataScope);
      mem.agents.skills.set(agentId, [...template.allowedSkills]);
      mem.agents.assumed.set(agentId, template.roleId);
      // TASK-011 remediation (2026-07-18 final review, issue 5) — `AgentQuery`
      // now requires `workspaceId`/`isActive` (added alongside relationship-
      // module trust boundaries; `InMemoryAgentStore`'s own implementation is
      // fail-closed: unset = unknown workspace / inactive). Before this fix,
      // an agent created here was PERMANENTLY unusable — it could never pass
      // the AGS1 workspace-match check, nor any "must be active" gate — a
      // silent, total break of `agent.create`'s own contract. A freshly
      // created agent is bound to the workspace it was created in and made
      // active immediately (this endpoint IS the explicit, governed creation
      // act — there is no separate "activate" step for API-created agents
      // elsewhere in this codebase); unknown/paused/retired agents remain
      // fail-closed exactly as before.
      mem.agents.workspaces.set(agentId, input.workspaceId);
      mem.agents.statuses.set(agentId, "active");
      return {
        agentId,
        name: input.name,
        roleTemplateId: template.id,
        scope: built.scope,
        allowedSkills: [...template.allowedSkills],
        dropped: built.dropped, // escalating tokens we refused to grant (shown in UI)
        dataScope: template.dataScope,
        egressTier: template.egressTier,
        // Non-removable, always-true facts about an in-platform agent:
        floor: { canSend: false, canApprove: false },
      };
    }),

    update: procedure.input(agentUpdateInput).mutation(async ({ input, ctx }) => {
      const mem = ctx.wiring.memory;
      if (!mem) throw new Error("agent.update: in-memory governance store required (persistent agent CRUD pending)");
      if (!mem.agents.scope.has(input.agentId)) throw new Error(`agent.update: unknown agent ${input.agentId}`);
      const workspaceId = await ctx.wiring.agents.workspaceId(input.agentId);
      if (!workspaceId) throw new Error(`agent.update: agent ${input.agentId} has no workspace binding`);
      assertPilotWorkspace(workspaceId);
      await assertMembership(ctx.wiring.workspaceStore, workspaceId, ctx.identity.id);
      let dropped: string[] = [];
      let roleTemplateId: string | undefined;
      let allowedSkills = mem.agents.skills.get(input.agentId) ?? [];
      let egressTier: EgressTier | undefined;
      if (input.roleTemplateId !== undefined) {
        const template = resolveAuthorizedAgentRoleTemplate(workspaceId, input.roleTemplateId);
        if (!template) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: `unknown or unauthorized agent role template "${input.roleTemplateId}" for this workspace`,
          });
        }
        const built = buildAgentCapability({
          capabilityScope: [...template.capabilityScope],
          egressTier: template.egressTier as EgressTier,
        });
        mem.roles.roleGrants.set(template.roleId, [...template.roleGrants]);
        mem.agents.assumed.set(input.agentId, template.roleId);
        mem.agents.scope.set(input.agentId, built.scope);
        mem.agents.tiers.set(input.agentId, template.dataScope as DataScope);
        mem.agents.skills.set(input.agentId, [...template.allowedSkills]);
        dropped = built.dropped;
        roleTemplateId = template.id;
        allowedSkills = [...template.allowedSkills];
        egressTier = template.egressTier as EgressTier;
      }
      return {
        agentId: input.agentId,
        ...(roleTemplateId ? { roleTemplateId } : {}),
        scope: mem.agents.scope.get(input.agentId) ?? [],
        allowedSkills,
        dropped,
        dataScope: mem.agents.tiers.get(input.agentId) ?? "all",
        ...(egressTier ? { egressTier } : {}),
        floor: { canSend: false, canApprove: false },
      };
    }),
  }),

  ritual: t.router({
    /** Create a ritual/workflow — REJECTED if any step exceeds its assigned agents'
     * authority (ritual ⊆ agent). The gate cannot be widened by a workflow. */
    create: procedure.input(ritualCreateInput).mutation(async ({ input, ctx }) => {
      assertPilotWorkspace(input.workspaceId);
      await assertMembership(ctx.wiring.workspaceStore, input.workspaceId, ctx.identity.id);
      if (input.agentIds.length !== 1) {
        throw new Error("ritual.create: exactly one owning Agent is required");
      }
      const agentId = input.agentIds[0]!;
      const agentViews = await Promise.all(
        input.agentIds.map(async (id) => ({
          id,
          scope: await ctx.wiring.agents.capabilityScope(id),
          dataScope: await ctx.wiring.agents.dataScope(id),
        })),
      );
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
      const ritualId = ctx.run.ids.next();
      await ctx.wiring.ritualRegistry.save({
        id: ritualId,
        name: input.name,
        workspaceId: input.workspaceId,
        agentId,
        agentPlane: "local",
        steps: input.steps.map((s) => ({
          skill: s.skill,
          action: s.action as Action,
          resourceType: s.resourceType as ResourceType,
          ...(s.resourceId ? { resourceId: s.resourceId } : {}),
          ...(s.inputs !== undefined ? { inputs: s.inputs as Record<string, unknown> } : {}),
          ...(s.dataScope ? { dataScope: s.dataScope as DataScope } : {}),
          ...(s.goalTaskRef ? { goalTaskRef: s.goalTaskRef } : {}),
        })),
      });
      return { ok: true as const, ritualId, agentId, agentIds: [agentId] };
    }),

    /** Run a ritual: ordered, governed steps through the pipeline. */
    run: procedure.input(ritualRunInput).mutation(async ({ input, ctx }) => {
      assertPilotWorkspace(input.workspaceId);
      await assertMembership(ctx.wiring.workspaceStore, input.workspaceId, ctx.identity.id);
      if (input.actor.type !== ctx.identity.type || input.actor.id !== ctx.identity.id) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "ritual.run actor must match the authenticated workspace member",
        });
      }
      return ctx.wiring.ritualExecutor.run(
        {
          workspaceId: input.workspaceId,
          ritualId: input.ritualId,
          actor: {
            type: input.actor.type as ActorType,
            id: input.actor.id,
            plane: "local",
          },
          ...(cleanOnBehalfOf(input.onBehalfOf) ? { onBehalfOf: cleanOnBehalfOf(input.onBehalfOf)! } : {}),
          steps: input.steps.map((s) => ({
            skill: s.skill,
            action: s.action as Action,
            resourceType: s.resourceType as ResourceType,
            ...(s.resourceId ? { resourceId: s.resourceId } : {}),
            inputs: s.inputs,
            ...(s.dataScope ? { dataScope: s.dataScope as DataScope } : {}),
            ...(s.goalTaskRef ? { goalTaskRef: s.goalTaskRef } : {}),
          })),
          ...(input.seed ? { seed: input.seed } : {}),
        },
        ctx.run,
      );
    }),

    /** Run a ritual by id — loads its step config from the registry (P2). */
    runById: procedure.input(ritualRunByIdInput).mutation(async ({ input, ctx }) => {
      assertPilotWorkspace(input.workspaceId);
      await assertMembership(ctx.wiring.workspaceStore, input.workspaceId, ctx.identity.id);
      if (isModuleRuntimeRitualId(input.ritualId)) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Module Automations must run through their manifest Ritual key and package binding",
        });
      }
      let ritualId = input.ritualId;
      if (input.modulePackageName) {
        const moduleInstallation = await ctx.wiring.packageStore.getAvailable(
          input.workspaceId,
          input.modulePackageName,
        );
        const automation = moduleInstallation?.manifest.module?.automations.find(
          (candidate) => candidate.ritualId === input.ritualId,
        );
        const runtimeAgentId = automation
          ? resolveModuleAgentRuntimeId(input.modulePackageName, automation.agentId)
          : undefined;
        const runtimeRitualId = resolveModuleRitualRuntimeId(input.modulePackageName, input.ritualId);
        const definition = runtimeRitualId
          ? await ctx.wiring.ritualRegistry.load(input.workspaceId, runtimeRitualId)
          : null;
        if (!automation || !runtimeAgentId || !runtimeRitualId || definition?.agentId !== runtimeAgentId) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "Module Automation has no verified runtime binding",
          });
        }
        ritualId = runtimeRitualId;
      }
      return ctx.wiring.ritualExecutor.runById(
        {
          workspaceId: input.workspaceId,
          ritualId,
          ...(input.actor
            ? {
                actor: {
                  type: input.actor.type as ActorType,
                  id: input.actor.id,
                  ...(input.actor.plane ? { plane: input.actor.plane } : {}),
                },
              }
            : {}),
          ...(cleanOnBehalfOf(input.onBehalfOf) ? { onBehalfOf: cleanOnBehalfOf(input.onBehalfOf)! } : {}),
          ...(input.params ? { params: input.params } : {}),
          ...(input.seed ? { seed: input.seed } : {}),
        },
        ctx.run,
      );
    }),
  }),

  /** DealPilot DP0-DP1 — three Databases, governed discovery, and secret-safe credentials. */
  dealpilot: t.router({
    module: dealpilotProcedure
      .input(z.object({ workspaceId: z.string().min(1) }))
      .query(({ input, ctx }) => {
        assertPilotWorkspace(input.workspaceId);
        return dealPilotModuleManifest(ctx.wiring.dealpilot.bindings);
      }),

    records: dealpilotProcedure
      .input(
        z.object({
          workspaceId: z.string().min(1),
          page: z.enum(["deals", "sources", "theses"]),
          limit: z.number().int().min(1).max(200).default(50),
          offset: z.number().int().min(0).default(0),
        }),
      )
      .query(async ({ input, ctx }) => {
        assertPilotWorkspace(input.workspaceId);
        return ctx.wiring.dealpilot.store.list(input.page, input.workspaceId, {
          limit: input.limit,
          offset: input.offset,
        });
      }),

    /** Compatibility endpoint for callers migrating from the pre-DP0 candidate feed. */
    list: dealpilotProcedure
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
        const { facts, candidateIds } = ctx.wiring.dealpilot;
        const total = candidateIds.length;
        const ids = candidateIds.slice(input.offset, input.offset + input.limit);
        const items = ids.map((id) => {
          const profile = facts.livingProfile(id);
          const flat = Object.fromEntries(Object.entries(profile).map(([key, value]) => [key, value.value]));
          return { id, profile: flat, fit: scoreThesisFit(flat, { industries: [], geo: [] }) };
        });
        return { items, total, hasMore: input.offset + items.length < total };
      }),

    detail: dealpilotProcedure
      .input(
        z.object({
          workspaceId: z.string().min(1),
          kind: z.enum(["deal", "source", "thesis"]),
          id: z.string().min(1),
        }),
      )
      .query(async ({ input, ctx }) => {
        assertPilotWorkspace(input.workspaceId);
        const detail = await ctx.wiring.dealpilot.store.detail(
          input.kind,
          input.workspaceId,
          input.id,
          ctx.wiring.dealpilot.bindings,
        );
        if (!detail) throw new TRPCError({ code: "NOT_FOUND", message: `${input.kind} Record not found` });
        if (detail.record.kind !== "source") return detail;
        return {
          ...detail,
          credentialProjection: await ctx.wiring.dealpilot.credentials.project(detail.record.credentialRef),
        };
      }),

    createDeal: dealpilotProcedure
      .input(
        z.object({
          workspaceId: z.string().min(1),
          company: z.string().trim().min(1).max(300),
          revenue: z.number().nonnegative().optional(),
          ebitda: z.number().optional(),
          sde: z.number().optional(),
          askingPrice: z.number().nonnegative().optional(),
        }),
      )
      .mutation(async ({ input, ctx }) => {
        assertPilotWorkspace(input.workspaceId);
        return ctx.wiring.dealpilot.store.createDeal({
          workspaceId: input.workspaceId,
          company: input.company,
          ...(input.revenue != null ? { revenue: input.revenue } : {}),
          ...(input.ebitda != null ? { ebitda: input.ebitda } : {}),
          ...(input.sde != null ? { sde: input.sde } : {}),
          ...(input.askingPrice != null ? { askingPrice: input.askingPrice } : {}),
        });
      }),

    createSource: dealpilotProcedure
      .input(
        z.object({
          workspaceId: z.string().min(1),
          name: z.string().trim().min(1).max(300),
          link: z.string().url(),
          connectionType: z.enum(["url", "email_alert", "api", "account"]),
          spendCap: z.number().nonnegative(),
          rightsAttested: z.boolean(),
          userId: z.string().max(500).optional(),
          password: z.string().max(2_000).optional(),
        }),
      )
      .mutation(async ({ input, ctx }) => {
        assertPilotWorkspace(input.workspaceId);
        const source = await ctx.wiring.dealpilot.store.createSource({
          workspaceId: input.workspaceId,
          name: input.name,
          link: input.link,
          connectionType: input.connectionType,
          spendCap: input.spendCap,
          rightsState: input.rightsAttested ? "attested" : "unattested",
          ...(input.rightsAttested ? { rightsAttestedBy: ctx.identity.id } : {}),
          ...(input.userId || input.password ? { credentialOwnerId: ctx.identity.id } : {}),
        });
        if (!input.userId && !input.password) return source;
        const credentialRef = await ctx.wiring.dealpilot.credentialVault.put(source.id, {
          ...(input.userId ? { userId: input.userId } : {}),
          ...(input.password ? { password: input.password } : {}),
        });
        return ctx.wiring.dealpilot.store.updateSource(source.id, input.workspaceId, { credentialRef });
      }),

    createThesis: dealpilotProcedure
      .input(
        z.object({
          workspaceId: z.string().min(1),
          name: z.string().trim().min(1).max(300),
          focus: z.string().trim().min(1).max(1_000),
          targetCagr: z.number().optional(),
          criteria: z.array(z.string().trim().min(1)).default([]),
          exclusions: z.array(z.string().trim().min(1)).default([]),
          sourcingStrategy: z.string().trim().max(2_000).optional(),
        }),
      )
      .mutation(async ({ input, ctx }) => {
        assertPilotWorkspace(input.workspaceId);
        const thesis = await ctx.wiring.dealpilot.store.createThesis({
          workspaceId: input.workspaceId,
          name: input.name,
          focus: input.focus,
          criteria: input.criteria,
          exclusions: input.exclusions,
          ...(input.targetCagr != null ? { targetCagr: input.targetCagr } : {}),
          ...(input.sourcingStrategy ? { sourcingStrategy: input.sourcingStrategy } : {}),
        });
        const discoveryTask = await proposeThesisSourceDiscovery(
          ctx.wiring.dealpilot.store,
          input.workspaceId,
          thesis.id,
        );
        const discovery = await ctx.wiring.pipeline.propose(
          {
            workspaceId: input.workspaceId,
            actor: { type: ctx.identity.type, id: ctx.identity.id },
            action: "read",
            resourceType: "tool",
            skill: "stageMutation",
            inputs: discoveryTask,
          },
          ctx.run,
        );
        return { thesis, discovery };
      }),

    discoverDeals: dealpilotProcedure
      .input(
        z.object({
          workspaceId: z.string().min(1),
          sourceId: z.string().min(1),
        }),
      )
      .mutation(async ({ input, ctx }) => {
        assertPilotWorkspace(input.workspaceId);
        let proposal;
        try {
          const result = await ctx.wiring.ritualExecutor.runById(
            {
              workspaceId: input.workspaceId,
              ritualId: DEALPILOT_SOURCE_RITUAL_ID,
              onBehalfOf: { type: ctx.identity.type === "team" ? "team" : "user", id: ctx.identity.id },
              params: { workspaceId: input.workspaceId, sourceId: input.sourceId },
            },
            ctx.run,
          );
          proposal = result.proposals[0];
          if (!proposal) throw new Error("DealPilot discovery Automation produced no proposal");
        } catch (error) {
          if (error instanceof SourceDiscoveryGateError) {
            throw new TRPCError({ code: "PRECONDITION_FAILED", message: error.message });
          }
          throw new TRPCError({
            code:
              error instanceof Error &&
              (error.message.includes("supports Deal discovery only") || error.message.includes("Source Record not found"))
                ? "PRECONDITION_FAILED"
                : "BAD_GATEWAY",
            message: error instanceof Error ? error.message : "Source connector failed",
          });
        }
        const output = proposal.output?.proposedOutput as {
          spend?: { estimated: number; actual: number; cap: number; exceeded: boolean };
        } | undefined;
        return {
          ...proposal,
          spend: output?.spend ?? { estimated: 0, actual: 0, cap: 0, exceeded: false },
        };
      }),

    captures: dealpilotProcedure
      .input(z.object({ workspaceId: z.string().min(1) }))
      .query(async ({ input, ctx }) => {
        assertPilotWorkspace(input.workspaceId);
        const captures = await ctx.wiring.dealpilot.captures.list("dealpilot");
        return captures
          .filter((capture) => !ctx.wiring.dealpilot.committedCaptureIds.has(capture.captureId))
          .map((capture) => ({
            ...capture,
            sourceId: ctx.wiring.dealpilot.captureSources.get(capture.captureId) ?? null,
          }));
      }),

    commit: dealpilotProcedure
      .input(z.object({ workspaceId: z.string().min(1), captureId: z.string().min(1) }))
      .mutation(async ({ input, ctx }) => {
        assertPilotWorkspace(input.workspaceId);
        if (ctx.wiring.dealpilot.committedCaptureIds.has(input.captureId)) {
          return { committed: false, alreadyCommitted: true as const };
        }
        if (ctx.wiring.dealpilot.committingCaptureIds.has(input.captureId)) {
          throw new TRPCError({ code: "CONFLICT", message: "Capture commit is already in progress" });
        }
        ctx.wiring.dealpilot.committingCaptureIds.add(input.captureId);
        try {
          const capture = await ctx.wiring.dealpilot.captures.get(input.captureId);
          if (!capture) throw new TRPCError({ code: "NOT_FOUND", message: "Quarantined capture not found" });
          const proposal = await ctx.wiring.pipeline.propose(
            {
              workspaceId: input.workspaceId,
              actor: { type: ctx.identity.type, id: ctx.identity.id },
              action: "write",
              resourceType: "tool",
              skill: "stageMutation",
              inputs: { kind: "dealpilot_capture_commit", captureId: input.captureId },
              trustOrigin: capture.trustOrigin ?? "untrusted_external",
            },
            ctx.run,
          );
          if (proposal.status !== "applied") return { committed: false, proposal };
          return {
            ...(await ctx.wiring.dealpilot.materializer.add(input.captureId)),
            proposal,
          };
        } finally {
          ctx.wiring.dealpilot.committingCaptureIds.delete(input.captureId);
        }
      }),

    reauthenticateCredential: dealpilotProcedure
      .input(z.object({ workspaceId: z.string().min(1), sourceId: z.string().min(1) }))
      .mutation(async ({ input, ctx }) => {
        assertPilotWorkspace(input.workspaceId);
        const source = await ctx.wiring.dealpilot.store.get("source", input.workspaceId, input.sourceId);
        if (!source) throw new TRPCError({ code: "NOT_FOUND", message: "Source Record not found" });
        if (source.kind !== "source" || source.credentialOwnerId !== ctx.identity.id) {
          throw new TRPCError({ code: "FORBIDDEN", message: "Source credential access is not authorized" });
        }
        try {
          return ctx.wiring.dealpilot.credentials.reauthenticate({
            actorType: ctx.identity.type,
            actorId: ctx.identity.id,
            sourceId: input.sourceId,
            ...(ctx.reauthenticatedAt != null ? { reauthenticatedAt: ctx.reauthenticatedAt } : {}),
          });
        } catch (error) {
          if (error instanceof CredentialAccessError) {
            throw new TRPCError({ code: "UNAUTHORIZED", message: error.message });
          }
          throw error;
        }
      }),

    accessCredential: dealpilotProcedure
      .input(
        z.object({
          workspaceId: z.string().min(1),
          sourceId: z.string().min(1),
          token: z.string().min(1),
          field: z.enum(["userId", "password"]),
          action: z.enum(["reveal", "copy"]),
        }),
      )
      .mutation(async ({ input, ctx }) => {
        assertPilotWorkspace(input.workspaceId);
        const source = await ctx.wiring.dealpilot.store.get("source", input.workspaceId, input.sourceId);
        if (!source || source.kind !== "source") {
          throw new TRPCError({ code: "NOT_FOUND", message: "Source Record not found" });
        }
        if (source.credentialOwnerId !== ctx.identity.id) {
          throw new TRPCError({ code: "FORBIDDEN", message: "Source credential access is not authorized" });
        }
        try {
          return await ctx.wiring.dealpilot.credentials.access({
            reference: source.credentialRef,
            sourceId: source.id,
            actorType: ctx.identity.type,
            actorId: ctx.identity.id,
            token: input.token,
            field: input.field,
            action: input.action,
          });
        } catch (error) {
          if (error instanceof CredentialAccessError) {
            throw new TRPCError({ code: "UNAUTHORIZED", message: error.message });
          }
          throw error;
        }
      }),
  }),

  tool: t.router({
    /** Invoke a tool — its composition runs through the pipeline (config → pipeline). */
    run: procedure.input(toolRunInput).mutation(async ({ input, ctx }) => {
      assertPilotWorkspace(input.workspaceId);
      await assertMembership(ctx.wiring.workspaceStore, input.workspaceId, ctx.identity.id);
      if (input.actor.type !== ctx.identity.type || input.actor.id !== ctx.identity.id) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "tool.run actor must match the authenticated workspace member",
        });
      }
      return ctx.wiring.ritualExecutor.runTool(
        {
          workspaceId: input.workspaceId,
          ritualId: input.ritualId,
          actor: {
            type: input.actor.type as ActorType,
            id: input.actor.id,
            plane: "local",
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
        const existingMemories = await ctx.wiring.memoryStore.retrieve(
          { limit: 100 },
          { workspaceId: input.workspaceId, userId: ctx.wiring.pilotUserId },
        );
        if (!existingMemories.some((memory) => parseLearningMemory(memory.content)?.kind === "reflection_schedule")) {
          await ctx.wiring.memoryStore.write({
            id: uuidv7(),
            workspaceId: input.workspaceId,
            type: "procedural",
            scope: "private",
            content: JSON.stringify({
              kind: "reflection_schedule",
              dueAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1_000).toISOString(),
              status: "scheduled",
            }),
            confidence: 1,
            trustOrigin: "operator",
            plane: "local",
            createdBy: "learning",
            ownerUserId: ctx.wiring.pilotUserId,
          });
        }
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

    recordTrustCapture: procedure
      .input(
        z.object({
          workspaceId: z.string().min(1),
          appName: z.string().trim().min(1).max(200),
          bundleId: z.string().trim().min(1).max(300).optional(),
          capturedAt: z.string().datetime(),
        }),
      )
      .mutation(async ({ input, ctx }) => {
        assertPilotWorkspace(input.workspaceId);
        const memory = await ctx.wiring.memoryStore.write({
          id: uuidv7(),
          workspaceId: input.workspaceId,
          type: "episodic",
          scope: "private",
          content: JSON.stringify({
            kind: "trust_capture",
            appName: input.appName,
            ...(input.bundleId ? { bundleId: input.bundleId } : {}),
            capturedAt: input.capturedAt,
          }),
          confidence: 1,
          trustOrigin: "untrusted_external",
          plane: "local",
          createdBy: "desktop:apps",
          ownerUserId: ctx.wiring.pilotUserId,
        });
        return { memory };
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
          await assertMembership(ctx.wiring.workspaceStore, input.workspaceId, ctx.identity.id);
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
              goalTaskRef: await provisionRoleModelRecommendationTask(ctx.wiring, input.workspaceId),
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

    listSignals: authenticatedProcedure
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

    listPeople: authenticatedProcedure
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

    getPerson: authenticatedProcedure
      .input(z.object({ workspaceId: z.string().min(1), id: z.string().uuid() }))
      .query(async ({ input, ctx }) => {
        assertPilotWorkspace(input.workspaceId);
        await assertMembership(ctx.wiring.workspaceStore, input.workspaceId, ctx.identity.id);
        return ctx.wiring.graphStore.getPerson(input.workspaceId, ctx.identity.id, input.id);
      }),

    listCommunities: authenticatedProcedure
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

    getCommunity: authenticatedProcedure
      .input(z.object({ workspaceId: z.string().min(1), id: z.string().uuid() }))
      .query(async ({ input, ctx }) => {
        assertPilotWorkspace(input.workspaceId);
        await assertMembership(ctx.wiring.workspaceStore, input.workspaceId, ctx.identity.id);
        return ctx.wiring.graphStore.getCommunity(input.workspaceId, ctx.identity.id, input.id);
      }),

    getSignalDetail: authenticatedProcedure
      .input(z.object({ workspaceId: z.string().min(1), signalId: z.string().uuid() }))
      .query(async ({ input, ctx }) => {
        assertPilotWorkspace(input.workspaceId);
        await assertMembership(ctx.wiring.workspaceStore, input.workspaceId, ctx.identity.id);
        return ctx.wiring.graphStore.getSignalDetail(input.workspaceId, ctx.identity.id, input.signalId);
      }),

    proposeSignalAction: authenticatedProcedure
      .input(z.object({ workspaceId: z.string().min(1), signalId: z.string().uuid() }))
      .mutation(async ({ input, ctx }) => {
        assertPilotWorkspace(input.workspaceId);
        await assertMembership(ctx.wiring.workspaceStore, input.workspaceId, ctx.identity.id);
        const detail = await ctx.wiring.graphStore.getSignalDetail(input.workspaceId, ctx.identity.id, input.signalId);
        if (!detail) {
          throw new TRPCError({ code: "NOT_FOUND", message: "Signal not found" });
        }
        if (
          !detail.sourceEvent ||
          !detail.participants.some(
            (participant) => participant.relationType === "participant" && participant.relationId,
          )
        ) {
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
    recordSignalAction: authenticatedProcedure
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

    /**
     * JP3B (TASK-011) — cited company-culture research, TWO-PHASE (remediated
     * 2026-07-17, see outputs/2026-07-17-jobpilot-culture-research-task011.md).
     *
     * `propose` resolves ONLY server-owned `sourceId`s (never a client-supplied
     * URL/type/label — see `resolveAuthorizedCultureSource`), gates every
     * non-`permitted` source type before any child Run or network access, and
     * creates a genuinely side-effect-free pipeline proposal per permitted
     * source (the Skill's `run()` is pure). NOTHING is fetched yet.
     *
     * A human decision (`action.decide`) must approve a specific proposal
     * before `materialize` will perform the real, guarded fetch for it — a
     * vetoed or never-decided proposal can never reach the network. `cancel`
     * aborts an in-flight fetch for real (or, before any fetch starts, simply
     * guarantees one never will). `synthesize` only accepts claims that
     * `groundClaims` can verify against the artifacts THIS run actually
     * fetched — an absent/mutated quote or a forged contradiction reference
     * fails the whole batch closed.
     */
    cultureResearch: t.router({
      /** Lists the server-owned authorized sources for a company — the ONLY
       * way a client learns which `sourceId`s exist to propose. Never
       * exposes the underlying URL (irrelevant to the client until fetched
       * and disclosed) — just enough to render a source picker and an
       * honest "why is Glassdoor/Reddit/Google reviews skipped" explanation
       * for ineligible sources, matching the disclosure the propose/synthesize
       * flow already builds server-side. */
      sources: authenticatedProcedure
        .input(z.object({ workspaceId: z.string().min(1), company: z.string().min(1) }))
        .query(async ({ input, ctx }) => {
          assertPilotWorkspace(input.workspaceId);
          await assertMembership(ctx.wiring.workspaceStore, input.workspaceId, ctx.identity.id);
          return CULTURE_SOURCE_REGISTRY.filter((s) => s.workspaceId === input.workspaceId && s.company === input.company).map((s) => {
            const classification = classifyCultureSource(s.sourceType);
            return { id: s.id, sourceLabel: s.sourceLabel, sourceType: s.sourceType, eligibility: classification.eligibility, reason: classification.reason };
          });
        }),

      propose: authenticatedProcedure
        .input(
          z.object({
            workspaceId: z.string().min(1),
            company: z.string().min(1),
            sourceIds: z.array(z.string().min(1)).min(1),
          }),
        )
        .mutation(async ({ input, ctx }) => {
          assertPilotWorkspace(input.workspaceId);
          await assertMembership(ctx.wiring.workspaceStore, input.workspaceId, ctx.identity.id);

          // Dedupe before anything else — a caller listing the same id many
          // times must not reserve many times the budget/fan-out.
          const dedupedIds = Array.from(new Set(input.sourceIds));
          if (dedupedIds.length > MAX_CULTURE_SOURCES_PER_RUN) {
            throw new TRPCError({
              code: "BAD_REQUEST",
              message: `at most ${MAX_CULTURE_SOURCES_PER_RUN} sources may be researched per run (received ${dedupedIds.length} distinct ids)`,
            });
          }

          // Resolve every id server-side. ANY unknown, or cross-workspace/
          // cross-company, id fails the WHOLE request closed — a forged id in
          // the batch is treated as a misuse signal, not a partial skip.
          const resolved = dedupedIds.map((id) => ({ id, source: resolveAuthorizedCultureSource(input.workspaceId, input.company, id) }));
          const unknown = resolved.filter((r) => !r.source);
          if (unknown.length > 0) {
            throw new TRPCError({
              code: "BAD_REQUEST",
              message: `unknown or unauthorized source id(s) for this workspace/company: ${unknown.map((u) => u.id).join(", ")}`,
            });
          }
          const sources = resolved.map((r) => r.source!);

          const permitted = sources.filter((s) => classifyCultureSource(s.sourceType).eligibility === "permitted");
          const skipped = sources
            .filter((s) => classifyCultureSource(s.sourceType).eligibility !== "permitted")
            .map((s) => {
              const classification = classifyCultureSource(s.sourceType);
              return { sourceId: s.id, sourceType: s.sourceType, sourceLabel: s.sourceLabel, eligibility: classification.eligibility, reason: classification.reason };
            });

          const onBehalfOf = { type: (ctx.identity.type === "team" ? "team" : "user") as "user" | "team", id: ctx.identity.id };
          const researchGoalTask = await provisionCultureResearchTask(ctx.wiring, input.workspaceId);

          const [learningScope, learningDataScope] = await Promise.all([
            ctx.wiring.agents.capabilityScope(LEARNING_AGENT),
            ctx.wiring.agents.dataScope(LEARNING_AGENT),
          ]);
          const parentRunId = uuidv7();
          // FIXED budget from the server-owned cap — NEVER derived from the
          // caller's request length (TASK-011 remediation #4).
          const parentEnvelope: ParentRunEnvelope = {
            runId: parentRunId,
            agentId: LEARNING_AGENT,
            workspaceId: input.workspaceId,
            authorityScope: learningScope,
            eligibleSkills: ["jobpilot.researchCultureSource"],
            dataScope: learningDataScope,
            plane: "cloud",
            budgetRemaining: { calls: MAX_CULTURE_SOURCES_PER_RUN, cost: MAX_CULTURE_SOURCES_PER_RUN },
            reviewMode: "approve",
            childRunPolicy: "allowed",
            delegationDepth: 0,
            onBehalfOf,
          };

          const pending: Array<{ proposalId: string; childRunId: string; sourceId: string; sourceType: string; sourceLabel: string }> = [];
          for (const source of permitted) {
            const childRun = await createChildAgentRun(
              { store: ctx.wiring.childAgentRuns, ledger: ctx.wiring.ledger },
              parentEnvelope,
              {
                goalId: researchGoalTask.goalId,
                taskId: researchGoalTask.taskId,
                delegatedScope: ["external:fetch:read"],
                selectedSkills: ["jobpilot.researchCultureSource"],
                budget: { maxCalls: 1, maxCost: 1 },
                deadline: new Date(Date.now() + 5 * 60_000).toISOString(),
                stopCondition: `fetch "${source.sourceLabel}" once, only after human approval, and stop`,
                requestedDataScope: "public",
                touchesExternalRisk: true,
              },
              ctx.run,
            );

            // TASK-011 remediation (2026-07-18 final review, issue 1) —
            // create the DURABLE culture-fetch intent record BEFORE the
            // ledger proposal exists, pinning the canonical URL/redirect-
            // origin allowlist/goal+task/skill/actor from the SERVER-owned
            // registry right now. `materialize`/`cancel` will re-resolve the
            // registry fresh again later and refuse to proceed if it no
            // longer matches — this pin is what a restart or a race can
            // never silently bypass.
            await ctx.wiring.cultureFetchStore.create({
              childRunId: childRun.id,
              parentRunId,
              workspaceId: input.workspaceId,
              company: input.company,
              sourceId: source.id,
              sourceType: source.sourceType,
              sourceLabel: source.sourceLabel,
              canonicalUrl: source.url,
              allowedRedirectOrigins: source.allowedRedirectOrigins,
              // TASK-011 remediation (2026-07-19, issue 7) — pin the FULL
              // security-policy snapshot, not just the URL, so materialize
              // can detect an eligibility/redirect-origin change at the SAME
              // URL between propose and materialize.
              policySnapshot: {
                registryVersion: computeSourcePolicyHash(source),
                eligibility: classifyCultureSource(source.sourceType).eligibility,
              },
              goalId: researchGoalTask.goalId,
              taskId: researchGoalTask.taskId,
              skill: "jobpilot.researchCultureSource",
              action: "read",
              actorId: LEARNING_AGENT,
            });

            // TASK-011 remediation (2026-07-19 coordinator distributed-
            // defects RE-review round 2, issue 6) — PREALLOCATE the
            // proposal's id and durably BIND it to the intent record BEFORE
            // any real ledger proposal can exist bearing that id. This
            // eliminates the "approvable orphan" crash window entirely
            // (rather than merely arguing a post-hoc window is inert): the
            // ONLY way `pipeline.propose` can produce an approvable
            // (`pending_review`) or auto-applied ledger row is via
            // `#appendLedger`, which honors `options.proposalId` — so by
            // construction, a real ledger row can only ever bear an id this
            // intent record was ALREADY bound to before propose() was even
            // called. `pipeline.propose`'s own internal rejection path
            // (`#reject`) always mints its OWN fresh id and never reaches
            // `pending_review`/`applied`, so a rejection leaves this bound
            // id permanently pointing at nothing — inert dead weight, never
            // approvable, never visible in `action.listPending`.
            const proposalId = ctx.run.ids.next();
            await ctx.wiring.cultureFetchStore.attachProposal(input.workspaceId, childRun.id, proposalId);

            // PURE — no network access. Proposing this is genuinely side-effect-free.
            const proposal = await ctx.wiring.pipeline.propose(
              {
                workspaceId: input.workspaceId,
                actor: { type: "agent", id: LEARNING_AGENT, plane: "cloud" },
                onBehalfOf,
                action: "read" as Action,
                resourceType: "external:fetch" as ResourceType,
                skill: "jobpilot.researchCultureSource",
                dataScope: "public" as DataScope,
                inputs: { sourceId: source.id, workspaceId: input.workspaceId, company: input.company },
                goalTaskRef: { goalId: researchGoalTask.goalId, taskId: researchGoalTask.taskId },
                context: { type: "child_agent_run", id: childRun.id, runId: parentRunId },
                // TASK-011 remediation (2026-07-19 coordinator distributed-
                // defects RE-review round 2, issue 9) — this Run's whole
                // purpose is to fetch UNTRUSTED external content (a company's
                // own public page, never operator/user-authored) — tag the
                // turn's provenance accordingly (PI-1) so it is threaded
                // through the persisted ledger row and any downstream taint
                // checks, never defaulting to an implicit "trusted" origin.
                trustOrigin: "untrusted_external",
              },
              ctx.run,
              { proposalId },
            );
            if (proposal.status === "rejected") {
              throw new TRPCError({ code: "BAD_REQUEST", message: proposal.rejectionReason ?? "culture-research proposal was rejected" });
            }
            pending.push({ proposalId: proposal.id, childRunId: childRun.id, sourceId: source.id, sourceType: source.sourceType, sourceLabel: source.sourceLabel });
          }

          // TASK-011 remediation (2026-07-19 coordinator distributed-defects
          // RE-review, issue 13) — record this run as the LATEST for this
          // company via the durable O(1) pointer, replacing the workspace-
          // wide scan `listByCompany` previously used by `latestRun`.
          await ctx.wiring.cultureLatestRunPointerStore.recordLatestRun(input.workspaceId, input.company, parentRunId);

          return { parentRunId, pending, skipped };
        }),

      /** Real, guarded fetch — invoked ONLY after `action.decide` has approved
       * `proposalId` (re-checked from the ledger here, never trusted from the
       * caller). Idempotent: re-materializing an already-resolved source
       * returns the stored record instead of refetching. */
      materialize: authenticatedProcedure
        .input(z.object({ workspaceId: z.string().min(1), proposalId: z.string().min(1), childRunId: z.string().min(1) }))
        .mutation(async ({ input, ctx }) => {
          assertPilotWorkspace(input.workspaceId);
          await assertMembership(ctx.wiring.workspaceStore, input.workspaceId, ctx.identity.id);
          try {
            const record = await materializeCultureSourceFetch(
              {
                childAgentRuns: ctx.wiring.childAgentRuns,
                ledger: ctx.wiring.ledger,
                fetchStore: ctx.wiring.cultureFetchStore,
                abortControllers: ctx.wiring.cultureFetchAbortControllers,
              },
              input.workspaceId,
              input.proposalId,
              input.childRunId,
              ctx.run,
            );
            return record;
          } catch (error) {
            throw new TRPCError({ code: "BAD_REQUEST", message: error instanceof Error ? error.message : String(error) });
          }
        }),

      /** Cancels a pending/in-flight source fetch — aborts a REAL in-flight
       * request when one is running, or guarantees one never starts. */
      cancel: authenticatedProcedure
        .input(z.object({ workspaceId: z.string().min(1), proposalId: z.string().min(1), childRunId: z.string().min(1) }))
        .mutation(async ({ input, ctx }) => {
          assertPilotWorkspace(input.workspaceId);
          await assertMembership(ctx.wiring.workspaceStore, input.workspaceId, ctx.identity.id);
          try {
            const record = await cancelCultureSourceFetch(
              {
                childAgentRuns: ctx.wiring.childAgentRuns,
                ledger: ctx.wiring.ledger,
                fetchStore: ctx.wiring.cultureFetchStore,
                abortControllers: ctx.wiring.cultureFetchAbortControllers,
              },
              input.workspaceId,
              input.proposalId,
              input.childRunId,
              { type: ctx.identity.type, id: ctx.identity.id },
              ctx.run,
            );
            return record;
          } catch (error) {
            throw new TRPCError({ code: "BAD_REQUEST", message: error instanceof Error ? error.message : String(error) });
          }
        }),

      status: authenticatedProcedure
        .input(z.object({ workspaceId: z.string().min(1), proposalId: z.string().min(1), childRunId: z.string().min(1) }))
        .query(async ({ input, ctx }) => {
          assertPilotWorkspace(input.workspaceId);
          await assertMembership(ctx.wiring.workspaceStore, input.workspaceId, ctx.identity.id);
          const record = await ctx.wiring.cultureFetchStore.getByProposal(input.workspaceId, input.proposalId, input.childRunId);
          if (!record) {
            throw new TRPCError({ code: "NOT_FOUND", message: "unknown culture-research proposal" });
          }
          // TASK-011 remediation (2026-07-19 coordinator distributed-defects
          // RE-review, issue 3) — self-repair any intent/child terminal
          // inconsistency on every read a client polls, not only inside
          // `materialize`'s own retry path.
          await reconcileIntentChildConsistency(ctx.wiring, input.workspaceId, record, ctx.run);
          // TASK-011 remediation (2026-07-19 coordinator distributed-defects
          // RE-review, issue 7) — never serve expired evidence: purge an
          // expired artifact's raw content on this read (idempotent,
          // metadata-preserving) and return the (possibly just-purged)
          // current record rather than the pre-purge snapshot.
          const purged = await ctx.wiring.cultureFetchStore.purgeExpiredArtifactContentIfNeeded(input.workspaceId, input.childRunId, ctx.run.clock.nowISO());
          return purged ?? record;
        }),

      /**
       * Internal Strategist's synthesis — claims must GROUND against artifacts
       * this run actually fetched (`groundClaims`, invoked inside the Skill).
       * Skipped sources are recomputed SERVER-SIDE from the registry (never
       * trusted from the client) so the disclosure is authoritative.
       */
      synthesize: authenticatedProcedure
        .input(
          z.object({
            workspaceId: z.string().min(1),
            company: z.string().min(1),
            /** TASK-011 remediation (2026-07-18 final review, issue 6) — the
             * EXACT parent Agent Run this synthesis is scoped to. Fetched
             * artifacts are resolved ONLY from this run's own child Runs,
             * never pooled across historical/concurrent runs for the same
             * company. */
            parentRunId: z.string().min(1),
            claims: z.array(
              z.object({
                id: z.string().min(1),
                claimType: z.enum(["fact", "opinion", "theme", "contradiction", "inference"]),
                quote: z.string().optional(),
                sourceId: z.string().optional(),
                contentHash: z.string().optional(),
                // TASK-011 remediation (2026-07-19 coordinator distributed-
                // defects RE-review, issue 11) — `authorContext` REMOVED
                // from the accepted input shape entirely. Accepting
                // arbitrary caller text here and rendering it verbatim as
                // "who said it" attribution was a genuine fabrication
                // vector; this slice's Tier-1 sources carry no
                // server-extracted per-claim author metadata to derive it
                // from honestly. `groundClaims` never assigns anything but
                // `null` to this field now regardless.
                supportingClaimIds: z.array(z.string()).optional(),
                contradicts: z.array(z.string()).optional(),
              }),
            ),
          }),
        )
        .mutation(async ({ input, ctx }) => {
          assertPilotWorkspace(input.workspaceId);
          await assertMembership(ctx.wiring.workspaceStore, input.workspaceId, ctx.identity.id);

          // TASK-011 remediation (2026-07-18 final review, issue 6) — resolve
          // fetched artifacts from THIS EXACT parent Run's own child Runs
          // only, via the durable `cultureFetchStore`, never by scanning
          // every fetch this workspace/company has ever made (which would
          // silently pool evidence across historical or concurrent runs).
          const childRuns = await ctx.wiring.childAgentRuns.listByParentRun(input.workspaceId, input.parentRunId);
          if (childRuns.length === 0) {
            throw new TRPCError({ code: "BAD_REQUEST", message: `unknown parent Run "${input.parentRunId}" for this workspace` });
          }
          const intentRecords = (
            await Promise.all(childRuns.map((childRun) => ctx.wiring.cultureFetchStore.get(input.workspaceId, childRun.id)))
          ).filter((r): r is NonNullable<typeof r> => r != null);
          const mismatchedCompany = intentRecords.find((r) => r.company !== input.company);
          if (mismatchedCompany) {
            throw new TRPCError({ code: "BAD_REQUEST", message: `parent Run "${input.parentRunId}" does not belong to company "${input.company}"` });
          }
          const fetchedIntents = intentRecords.filter((r) => r.status === "fetched" && r.artifact);
          // TASK-011 remediation (2026-07-19 coordinator distributed-defects
          // RE-review, issues 7/8) — an EXPIRED artifact must never be
          // consumed by a NEW synthesis attempt ("never serve expired
          // evidence" applies to synthesis input, not just direct reads).
          // Treat an expired source as NOT fetched for this purpose —
          // `groundClaims` will then correctly reject any claim citing it
          // as `unknown-source`, rather than confusingly failing quote
          // verification against silently-blanked content.
          const nowISO = ctx.run.clock.nowISO();
          const unexpiredFetchedIntents = fetchedIntents.filter((r) => !isArtifactExpired(r.artifact!, nowISO));
          const seenSourceIds = new Set<string>();
          for (const r of unexpiredFetchedIntents) {
            if (seenSourceIds.has(r.sourceId)) {
              throw new TRPCError({ code: "BAD_REQUEST", message: `duplicate fetched artifact for source "${r.sourceId}" under this run` });
            }
            seenSourceIds.add(r.sourceId);
          }
          const fetchedArtifacts = unexpiredFetchedIntents.map((r) => r.artifact!);
          // TASK-011 remediation (2026-07-19 coordinator distributed-defects
          // RE-review, issue 8) — reject an EMPTY submission BEFORE ever
          // calling `pipeline.propose`/recording the synthesis pointer.
          // Without this, a caller could submit zero claims and/or find
          // zero unexpired fetched artifacts, and STILL have a synthesis
          // proposal created and durably pointed to — poisoning the
          // first-write-wins synthesis pointer for this parentRunId with a
          // worthless/empty result BEFORE any real fetch has even
          // completed, permanently blocking a later legitimate synthesis
          // attempt from ever winning that pointer.
          if (input.claims.length === 0) {
            throw new TRPCError({ code: "BAD_REQUEST", message: "synthesize requires at least one claim — an empty submission is rejected before any proposal is created" });
          }
          if (fetchedArtifacts.length === 0) {
            throw new TRPCError({ code: "BAD_REQUEST", message: "synthesize requires at least one unexpired fetched artifact for this parent Run — no claim can ground against zero evidence" });
          }
          const skippedSources = CULTURE_SOURCE_REGISTRY.filter(
            (s) => s.workspaceId === input.workspaceId && s.company === input.company && classifyCultureSource(s.sourceType).eligibility !== "permitted",
          ).map((s) => {
            const classification = classifyCultureSource(s.sourceType);
            return { sourceLabel: s.sourceLabel, sourceType: s.sourceType, reason: classification.reason };
          });

          const onBehalfOf = { type: (ctx.identity.type === "team" ? "team" : "user") as "user" | "team", id: ctx.identity.id };
          const synthesisGoalTask = await provisionCultureSynthesisTask(ctx.wiring, input.workspaceId);

          // TASK-011 remediation (2026-07-19 coordinator distributed-defects
          // RE-review round 2, issue 7) — self-heal a STALE pointer before
          // preallocating a new one. Preallocating the pointer before
          // `propose` (below) closes the "append-without-pointer orphan"
          // window, but introduces its mirror: a genuine process crash
          // strictly BETWEEN `recordProposal` succeeding and `propose` ever
          // creating a real ledger row would otherwise leave a dead pointer
          // that permanently blocks every future synthesis attempt for this
          // parentRunId (recordProposal is first-write-wins and would keep
          // refusing to rebind it). Detect this specific case — a pointer
          // whose proposalId does NOT resolve to any real ledger row at
          // all — and release it before this attempt's own preallocation. A
          // pointer whose proposalId DOES resolve (however that proposal was
          // ultimately decided) is left untouched here; that case is a live,
          // real synthesis and is not this function's concern.
          // TASK-011 remediation (2026-07-19 coordinator distributed-defects
          // RE-review round 2, issue 7 — hardened after a fresh independent
          // review found the original inline self-heal check unsafe: a bare
          // "ledger.get returned null" check cannot distinguish a genuinely
          // dead pointer (crash between recordProposal and propose) from a
          // live, in-flight concurrent synthesize() call for the SAME
          // parentRunId that simply hasn't reached #appendLedger yet — the
          // ORIGINAL version could self-heal (release + rebind) a still-live
          // winner's pointer out from under it, permanently orphaning their
          // soon-to-exist valid ledger row against the NEW
          // assertCultureProposalBindingValid backstop. `selfHealDeadSynthesisPointer`
          // additionally requires the pointer to be older than a grace
          // period before ever releasing it — see its own doc comment.
          await selfHealDeadSynthesisPointer(
            { cultureSynthesisPointerStore: ctx.wiring.cultureSynthesisPointerStore, ledger: ctx.wiring.ledger },
            input.workspaceId,
            input.parentRunId,
            ctx.run.clock.nowISO(),
          );

          // PREALLOCATE the proposal id and durably record the (parentRunId
          // -> proposalId) pointer BEFORE any real ledger proposal can exist
          // bearing that id — the same preallocation pattern as the research
          // `propose` handler (issue 6). This closes the "append-without-
          // pointer orphan" crash window structurally rather than relying
          // solely on `synthesisResult`'s own self-repair (which still
          // requires a client-supplied proposalId and remains as defense in
          // depth for any pointer later lost/corrupted). `recordProposal` is
          // first-write-wins (`writeIfAbsent`): a losing concurrent
          // `synthesize` call for the SAME parentRunId now fails BEFORE ever
          // creating a real ledger proposal at all, rather than after.
          const proposalId = ctx.run.ids.next();
          try {
            await ctx.wiring.cultureSynthesisPointerStore.recordProposal(input.workspaceId, input.parentRunId, input.company, proposalId);
          } catch (error) {
            throw new TRPCError({ code: "CONFLICT", message: error instanceof Error ? error.message : String(error) });
          }

          let synthesisProposal;
          try {
            synthesisProposal = await ctx.wiring.pipeline.propose(
              {
                workspaceId: input.workspaceId,
                actor: { type: "agent", id: INTERNAL_STRATEGIST_AGENT },
                onBehalfOf,
                action: "write" as Action,
                resourceType: "signal" as ResourceType,
                skill: "jobpilot.synthesizeCultureProfile",
                dataScope: "all" as DataScope,
                // TASK-011 remediation (2026-07-19 coordinator distributed-
                // defects RE-review round 2, issue 8) — NO artifact bodies
                // here. `req.inputs` is persisted VERBATIM into the
                // immutable ledger row by `pipeline.propose`; the Skill
                // resolves its own artifacts internally (see
                // `createSynthesizeCultureProfileSkill`) so the ledger never
                // durably retains full raw fetched content.
                inputs: { workspaceId: input.workspaceId, parentRunId: input.parentRunId, claims: input.claims as GroundedClaimInput[], skippedSources },
                goalTaskRef: { goalId: synthesisGoalTask.goalId, taskId: synthesisGoalTask.taskId },
                // TASK-011 remediation (2026-07-19 coordinator distributed-
                // defects RE-review round 2, issue 9) — Internal Strategist
                // is reasoning DIRECTLY over untrusted external evidence
                // (the fetched artifacts) here, even though the claims
                // themselves are grounded/validated — the turn's provenance
                // (PI-1) must reflect that, threaded through the persisted
                // ledger row, `action.decide`, and `synthesisResult`'s own
                // response (never silently defaulting to a trusted origin
                // just because the OUTPUT happens to be schema-validated).
                trustOrigin: "untrusted_external",
              },
              ctx.run,
              { proposalId },
            );
          } catch (error) {
            // The Skill threw synchronously (e.g. a claim-grounding failure)
            // BEFORE any real ledger row was ever created — release OUR OWN
            // preallocated pointer binding (never a different, concurrently-
            // won one) so a legitimate retry for this parentRunId is not
            // permanently blocked by a doomed attempt.
            await ctx.wiring.cultureSynthesisPointerStore.releaseIfMatching(input.workspaceId, input.parentRunId, proposalId).catch(() => {});
            throw new TRPCError({ code: "BAD_REQUEST", message: error instanceof Error ? error.message : String(error) });
          }
          if (synthesisProposal.status === "rejected") {
            // `#reject`'s ledger row bears its OWN auto-generated id, never
            // OUR preallocated one — release it the same way, for the same
            // reason (an authority/policy rejection must not permanently
            // consume the pointer for this parentRunId either).
            await ctx.wiring.cultureSynthesisPointerStore.releaseIfMatching(input.workspaceId, input.parentRunId, proposalId).catch(() => {});
            throw new TRPCError({ code: "BAD_REQUEST", message: synthesisProposal.rejectionReason ?? "culture-research synthesis was rejected" });
          }
          return { proposalId: synthesisProposal.id, status: synthesisProposal.status };
        }),

      /**
       * TASK-011 remediation (2026-07-19 coordinator distributed-defects
       * review, issue 13) — the SERVER-AUTHORITATIVE resume query. Returns
       * the latest culture-research parent Run (and its pending sources +
       * synthesis proposal id, if any) for one (workspaceId, company),
       * derived entirely from durable server state via
       * `DurableCultureFetchStore.listByCompany` +
       * `DurableCultureSynthesisPointerStore` — NEVER from anything the
       * client supplies. The web UI calls this on every mount and treats its
       * result as authoritative; any local `localStorage` pointer is only a
       * paint-ahead cache, overwritten by whatever this query returns
       * (including `null`, if the server has no record — e.g. storage from a
       * stale/foreign workspace). This is what makes "clear storage / change
       * device, still see pending/completed research" possible.
       */
      latestRun: authenticatedProcedure
        .input(z.object({ workspaceId: z.string().min(1), company: z.string().min(1) }))
        .query(async ({ input, ctx }) => {
          assertPilotWorkspace(input.workspaceId);
          await assertMembership(ctx.wiring.workspaceStore, input.workspaceId, ctx.identity.id);
          // TASK-011 remediation (2026-07-19 coordinator distributed-defects
          // RE-review, issue 13) — an O(1) durable pointer lookup, NOT a
          // workspace-wide scan-then-limit-then-filter (the prior
          // `listByCompany` approach, which could silently hide the real
          // latest run behind enough unrelated Memories at scale). The
          // pointer names the exact `parentRunId`; its pending sources are
          // then resolved via `childAgentRuns.listByParentRun` (already
          // indexed by workspace+parentRunId) rather than any broad scan.
          const pointer = await ctx.wiring.cultureLatestRunPointerStore.getLatestRun(input.workspaceId, input.company);
          if (!pointer) return null;
          const childRuns = await ctx.wiring.childAgentRuns.listByParentRun(input.workspaceId, pointer.parentRunId);
          const intentRecords = (
            await Promise.all(childRuns.map((childRun) => ctx.wiring.cultureFetchStore.get(input.workspaceId, childRun.id)))
          ).filter((r): r is NonNullable<typeof r> => r != null && r.company === input.company);
          const pending = intentRecords
            .filter((r) => r.proposalId)
            .map((r) => ({ proposalId: r.proposalId!, childRunId: r.childRunId, sourceId: r.sourceId, sourceType: r.sourceType, sourceLabel: r.sourceLabel }));
          const synthesisPointer = await ctx.wiring.cultureSynthesisPointerStore.getForParentRun(input.workspaceId, pointer.parentRunId);
          return {
            parentRunId: pointer.parentRunId,
            pending,
            ...(synthesisPointer ? { synthesisProposalId: synthesisPointer.proposalId } : {}),
          };
        }),

      /**
       * Reads the PERSISTED, APPROVED synthesis result — TASK-011 remediation
       * (2026-07-18 final review, issue 7; hardened 2026-07-19 coordinator
       * distributed-defects review, issue 9). The web UI polls this instead of
       * holding any hand-authored culture data: before a synthesis proposal
       * is approved, this returns `{ status: "not_available" }`, an honest
       * empty state the UI must render as such, never as a placeholder claim.
       * Only an `approve` decision unlocks the real, grounded, cited
       * partition/disclosure the Skill produced — and only if the proposal
       * is GENUINELY a `jobpilot.synthesizeCultureProfile` output bound to
       * the caller's own (workspaceId, company, parentRunId): an arbitrary
       * OTHER approved proposal (any skill), or a synthesis proposal for a
       * DIFFERENT run/company, is rejected as `not_available` rather than
       * rendered — never trust `resourceType`/`action`/a loose shape match
       * alone; the strict `synthesizeCultureProfileOutputSchema` AND a
       * re-derivation of the run's real fetched artifacts must both agree.
       */
      synthesisResult: authenticatedProcedure
        .input(z.object({ workspaceId: z.string().min(1), company: z.string().min(1), proposalId: z.string().min(1), parentRunId: z.string().min(1) }))
        .query(async ({ input, ctx }) => {
          assertPilotWorkspace(input.workspaceId);
          await assertMembership(ctx.wiring.workspaceStore, input.workspaceId, ctx.identity.id);
          const proposal = await ctx.wiring.ledger.get(input.proposalId);
          if (!proposal || proposal.workspaceId !== input.workspaceId) {
            return { status: "not_available" as const };
          }
          // Corroborate the Skill's identity via its declared action/resourceType
          // (LedgerEntry has no `skill` field of its own) — a proposal from ANY
          // other skill that happens to also be action:"write"/resourceType:"signal"
          // is still filtered out below by the strict output-schema parse plus
          // the parentRunId/artifact cross-check, but this is a cheap first gate.
          if (proposal.action !== "write" || proposal.resourceType !== "signal") {
            return { status: "not_available" as const };
          }
          // TASK-011 remediation (2026-07-19 coordinator distributed-defects
          // RE-review, issue 8) — the ACTOR must be the real Internal
          // Strategist Agent identity, not merely "some agent that happened
          // to write a signal". Corroborates the "exact persisted actor
          // binding" requirement directly from the immutable ledger row.
          if (proposal.actorType !== "agent" || proposal.actorId !== INTERNAL_STRATEGIST_AGENT) {
            return { status: "not_available" as const };
          }
          const decision = await ctx.wiring.ledger.decisionFor(input.proposalId);
          if (!decision || decision.userDecision !== "approve") {
            return { status: "not_available" as const };
          }
          const parsed = synthesizeCultureProfileOutputSchema.safeParse(proposal.proposedOutput);
          if (!parsed.success) {
            // NOT a jobpilot.synthesizeCultureProfile output at all (or a
            // malformed/foreign one) — fail closed, never render it.
            return { status: "not_available" as const };
          }
          const result = parsed.data as SynthesizeCultureProfileOutput;
          if (result.parentRunId !== input.parentRunId) {
            return { status: "not_available" as const };
          }
          // Re-derive this run's REAL fetched artifacts and cross-check every
          // `artifactHashes` entry against them — a persisted result whose
          // hashes no longer match the run's own durable fetch records (e.g.
          // stale/tampered) must not be rendered as if it were still valid.
          const childRuns = await ctx.wiring.childAgentRuns.listByParentRun(input.workspaceId, input.parentRunId);
          const intentRecords = (
            await Promise.all(childRuns.map((childRun) => ctx.wiring.cultureFetchStore.get(input.workspaceId, childRun.id)))
          ).filter((r): r is NonNullable<typeof r> => r != null);
          const realCompanyMatch = intentRecords.every((r) => r.company === input.company);
          if (childRuns.length === 0 || !realCompanyMatch) {
            return { status: "not_available" as const };
          }
          const realHashesBySourceId = new Map(
            intentRecords.filter((r) => r.status === "fetched" && r.artifact).map((r) => [r.sourceId, r.artifact!.contentHash]),
          );
          const hashesMatch = result.artifactHashes.every((a) => realHashesBySourceId.get(a.sourceId) === a.contentHash);
          if (!hashesMatch) {
            return { status: "not_available" as const };
          }
          // TASK-011 remediation (2026-07-19 coordinator distributed-defects
          // RE-review, issue 5) — self-repair the "propose crashed AFTER the
          // ledger append succeeded but BEFORE recordProposal ever ran"
          // window: this proposal is genuinely valid/approved/well-formed
          // (every check above already passed), so if the durable
          // synthesis-pointer binding for its parentRunId is missing or
          // stale, repair it now rather than leaving `latestRun`'s "resume"
          // flow permanently unable to discover an otherwise-perfectly-good
          // synthesis result. Idempotent and best-effort: a genuine
          // concurrent winner for the SAME parentRunId is left alone.
          const pointer = await ctx.wiring.cultureSynthesisPointerStore.getForParentRun(input.workspaceId, input.parentRunId);
          if (!pointer || pointer.proposalId !== input.proposalId) {
            await ctx.wiring.cultureSynthesisPointerStore.recordProposal(input.workspaceId, input.parentRunId, input.company, input.proposalId).catch(() => {
              // Another (also valid) proposal already legitimately holds
              // the pointer for this parentRunId — that is a real,
              // resolved outcome, not a bug to surface here; this read
              // path's job is only to REPAIR a missing binding, never to
              // fight over who owns it.
            });
          }
          return { status: "available" as const, proposalId: input.proposalId, approvedAt: decision.createdAt, result, trustOrigin: proposal.trustOrigin ?? null };
        }),
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
      createTicket: publicProcedure
        .input(
          z.object({
            workspaceId: z.string().min(1),
            subject: z.string().trim().min(1).max(200),
            submitterEmail: z.string().trim().email().max(320),
            submitterName: z.string().trim().max(120).optional(),
            body: z.string().trim().min(1).max(10_000),
            operationId: z.string().uuid(),
            accessToken: z.string().regex(/^[A-Za-z0-9_-]{32,128}$/),
          }),
        )
        .mutation(async ({ input, ctx }) => {
          assertPilotWorkspace(input.workspaceId);
          const { ticket, message } = await ctx.wiring.helpdeskStore.createTicket({
            workspaceId: input.workspaceId,
            subject: input.subject,
            submitterEmail: input.submitterEmail,
            body: input.body,
            operationId: input.operationId,
            accessToken: input.accessToken,
            ...(input.submitterName ? { submitterName: input.submitterName } : {}),
          });
          return { ticket, message };
        }),

      getThread: publicProcedure
        .input(z.object({ accessToken: z.string().regex(/^[A-Za-z0-9_-]{32,128}$/) }))
        .query(async ({ input, ctx }) => {
          const result = await ctx.wiring.helpdeskStore.getTicketByToken(input.accessToken);
          if (!result) throw new TRPCError({ code: "NOT_FOUND", message: "unknown ticket" });
          return result;
        }),

      reply: publicProcedure
        .input(
          z.object({
            accessToken: z.string().regex(/^[A-Za-z0-9_-]{32,128}$/),
            body: z.string().trim().min(1).max(10_000),
            operationId: z.string().uuid(),
          }),
        )
        .mutation(async ({ input, ctx }) => {
          const message = await ctx.wiring.helpdeskStore.replyByToken(
            input.accessToken,
            input.body,
            input.operationId,
          );
          if (!message) throw new TRPCError({ code: "NOT_FOUND", message: "unknown ticket" });
          return message;
        }),
    }),

    /** Support-agent inbox — workspace-authenticated. */
    list: authenticatedProcedure
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

    get: authenticatedProcedure
      .input(z.object({ workspaceId: z.string().min(1), ticketId: z.string().uuid() }))
      .query(async ({ input, ctx }) => {
        assertPilotWorkspace(input.workspaceId);
        await assertMembership(ctx.wiring.workspaceStore, input.workspaceId, ctx.identity.id);
        const result = await ctx.wiring.helpdeskStore.getTicket(input.workspaceId, input.ticketId);
        if (!result) throw new TRPCError({ code: "NOT_FOUND", message: "unknown ticket" });
        return result;
      }),

    reply: authenticatedProcedure
      .input(
        z.object({
          workspaceId: z.string().min(1),
          ticketId: z.string().uuid(),
          body: z.string().trim().min(1).max(10_000),
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
     * Routes a help request over the accessible Relationship graph: candidates
     * are Person Records, not workspace-user identities. Topic tags may be
     * supplied by the caller (the
     * graph carries no per-person topic tags yet — with none supplied the
     * result is an HONEST empty route list, never a fabricated match).
     */
    route: authenticatedProcedure
      .input(
        z.object({
          workspaceId: z.string().min(1),
          subject: z.string().min(1),
          body: z.string().default(""),
          /** Optional per-person topic tags ({personId -> topics[]}) until the
           * graph carries real topic/skill data (see docs/BUGS.md). */
          topicsByPerson: z
            .record(z.array(z.string().min(1)).max(50))
            .refine(
              (value) => Object.keys(value).every((id) => z.string().uuid().safeParse(id).success),
              "candidate Person ids must be UUIDs",
            )
            .refine((value) => Object.keys(value).length <= 500, "at most 500 candidate People may be routed")
            .optional(),
          limit: z.number().int().min(1).max(10).default(3),
        }),
      )
      .query(async ({ input, ctx }) => {
        assertPilotWorkspace(input.workspaceId);
        await assertMembership(ctx.wiring.workspaceStore, input.workspaceId, ctx.identity.id);
        const candidates = (
          await Promise.all(
            Object.entries(input.topicsByPerson ?? {}).map(async ([personId, topics]) => {
              const person = await ctx.wiring.graphStore.getPerson(
                input.workspaceId,
                ctx.identity.id,
                personId,
              );
              return person
                ? {
                    personId: person.id,
                    displayName: person.displayName ?? "Unnamed person",
                    topics,
                  } satisfies HelpResponderCandidate
                : null;
            }),
          )
        ).filter((candidate): candidate is HelpResponderCandidate => candidate !== null);
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
    stageAnswer: authenticatedProcedure
      .input(
        z.object({
          workspaceId: z.string().min(1),
          subject: z.string().min(1),
          body: z.string().default(""),
          routedToPersonId: z.string().uuid(),
          candidateTopics: z.array(z.string().min(1)).max(50),
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
        const [route] = routeHelpRequest(
          { subject: input.subject, body: input.body },
          [{
            personId: routedPerson.id,
            displayName: routedPerson.displayName ?? "Unnamed person",
            topics: input.candidateTopics,
          }],
          1,
        );
        if (!route) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "the selected Person no longer matches the supplied routing topics",
          });
        }
        const offer = draftHelpOffer(
          { subject: input.subject, body: input.body },
          route,
          input.draftBody,
        );
        // AGS1 (TASK-007 closure) — a real governed Skill: LEARNING_AGENT drafts
        // the Help Offer, never the Human directly (helpdesk.stageAnswer's own
        // manifest requires it — see wiring.ts's HELPDESK_ANSWER_SKILL_MANIFEST).
        const goalTaskRef = await provisionHelpdeskAnswerTask(ctx.wiring, input.workspaceId);
        const proposal = await ctx.wiring.pipeline.propose(
          {
            workspaceId: input.workspaceId,
            actor: { type: "agent", id: LEARNING_AGENT },
            onBehalfOf: { type: "user", id: ctx.identity.id },
            action: "write",
            resourceType: "signal",
            resourceId: input.routedToPersonId,
            inputs: { ...offer },
            skill: "helpdesk.stageAnswer",
            goalTaskRef,
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
    /** Real local-plane File inventory for one installed Module. */
    files: authenticatedProcedure
      .input(z.object({ workspaceId: z.string().min(1), moduleName: z.string().min(1) }))
      .query(async ({ input, ctx }) => {
        assertPilotWorkspace(input.workspaceId);
        await assertMembership(ctx.wiring.workspaceStore, input.workspaceId, ctx.identity.id);
        const installation = await ctx.wiring.packageStore.getAvailable(input.workspaceId, input.moduleName);
        if (!installation || installation.status !== "installed") {
          throw new TRPCError({ code: "NOT_FOUND", message: `installed Module "${input.moduleName}" not found` });
        }
        const workspaces = await ctx.wiring.workspaceStore.listWorkspaces(ctx.identity.id);
        const organization = workspaces.find((workspace) => workspace.id === input.workspaceId);
        if (!organization) {
          throw new TRPCError({ code: "FORBIDDEN", message: "workspace membership required" });
        }
        try {
          return await listModuleFiles(
            organization.name,
            installation.manifest.module?.displayName ?? installation.packageName,
          );
        } catch (error) {
          if (error instanceof ModuleFilesPathError) {
            throw new TRPCError({ code: "BAD_REQUEST", message: error.message });
          }
          throw error;
        }
      }),

    /** Register a package manifest. Always creates state=private, status=
     * pending_review — no risk computed yet (that happens at `install`). */
    register: procedure.input(packageRegisterInput).mutation(async ({ input, ctx }) => {
      assertPilotWorkspace(input.workspaceId);
      await assertMembership(ctx.wiring.workspaceStore, input.workspaceId, ctx.identity.id);
      let manifest: PackageManifest;
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
      await assertMembership(ctx.wiring.workspaceStore, input.workspaceId, ctx.identity.id);
      const installation = await ctx.wiring.packageStore.get(input.installationId);
      if (!installation || installation.workspaceId !== input.workspaceId) {
        throw new TRPCError({ code: "NOT_FOUND", message: "unknown package installation" });
      }
      if (installation.state !== "private") {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `package installation must be private before install, got ${installation.state}`,
        });
      }
      const currentCommonsEntry = await assertCurrentCommonsAttachment(ctx.wiring, installation);

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
      const bundledCapabilities = new Map<string, CapabilityManifest>();
      for (const capability of installation.manifest.capabilities) {
        bundledCapabilities.set(capability.id, capability);
        bundledCapabilities.set(capability.name, capability);
      }
      for (const cap of installation.manifest.capabilities) {
        for (const dep of cap.dependencies) {
          if (bundledCapabilities.has(dep.manifestId)) continue;
          if (!z.string().uuid().safeParse(dep.manifestId).success) continue;
          const row = await ctx.wiring.capabilityStore.getManifest(dep.manifestId);
          if (row) capDepRows.set(dep.manifestId, row);
        }
      }
      const resolveCapabilityDependency = (id: string): CapabilityManifest | undefined => {
        const bundled = bundledCapabilities.get(id);
        if (bundled) return bundled;
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
      const verifiedCommonsDependencies = new Map<string, PackageManifest>();
      const verifiedDependencyInstallations = new Map<string, PackageInstallationRow>();
      if (installation.moduleAttachment) {
        const rootEntry = currentCommonsEntry!;
        const pins = new Map<string, string>(
          rootEntry.securityScan.dependencyPins
            ?.map((pin) => [`${pin.name}@${pin.version}`, pin.contentHash] as const) ?? [],
        );
        const visited = new Set<string>();
        const verifyDependencyClosure = async (manifest: PackageManifest): Promise<void> => {
          for (const dependency of manifest.dependencies) {
            const key = `${dependency.manifestId}@${dependency.version}`;
            if (visited.has(key)) continue;
            visited.add(key);
            const expectedHash = pins.get(key);
            const entry = await ctx.wiring.commonsRegistry.getVersion(dependency.manifestId, dependency.version);
            if (!entry || !expectedHash || entry.integrity.value !== expectedHash) {
              throw new TRPCError({
                code: "BAD_REQUEST",
                message: `Commons dependency "${key}" does not match its signed content-hash pin`,
              });
            }
            try {
              assertCommonsEntryContentTrusted(entry);
            } catch (err) {
              throw new TRPCError({
                code: "BAD_REQUEST",
                message: err instanceof Error ? err.message : `Commons dependency "${key}" failed trust verification`,
              });
            }
            const local = allInstallations.find(
              (candidate) =>
                candidate.packageName === dependency.manifestId &&
                candidate.packageVersion === dependency.version &&
                candidate.moduleAttachment?.source === "commons" &&
                candidate.moduleAttachment.modulePackageName === installation.moduleAttachment?.modulePackageName &&
                candidate.moduleAttachment.agentId === installation.moduleAttachment?.agentId &&
                candidate.moduleAttachment.needId === installation.moduleAttachment?.needId &&
                candidate.moduleAttachment.contentHash === expectedHash,
            );
            if (!local) {
              throw new TRPCError({
                code: "BAD_REQUEST",
                message: `Commons dependency "${key}" was not staged from its pinned artifact`,
              });
            }
            if (!["private", "promoted", "available"].includes(local.state)) {
              throw new TRPCError({
                code: "BAD_REQUEST",
                message: `Commons dependency "${key}" cannot activate from state "${local.state}"`,
              });
            }
            verifiedCommonsDependencies.set(key, entry.manifest);
            verifiedDependencyInstallations.set(key, local);
            for (const pin of entry.securityScan.dependencyPins ?? []) {
              pins.set(`${pin.name}@${pin.version}`, pin.contentHash);
            }
            await verifyDependencyClosure(entry.manifest);
          }
        };
        await verifyDependencyClosure(installation.manifest);
      }
      const installManifests = [installation.manifest, ...verifiedCommonsDependencies.values()];
      const installCapabilities = installManifests.flatMap((manifest) => manifest.capabilities);
      for (const capability of installCapabilities) {
        bundledCapabilities.set(capability.id, capability);
        bundledCapabilities.set(capability.name, capability);
        for (const dependency of capability.dependencies) {
          if (bundledCapabilities.has(dependency.manifestId)) continue;
          if (!z.string().uuid().safeParse(dependency.manifestId).success) continue;
          const row = await ctx.wiring.capabilityStore.getManifest(dependency.manifestId);
          if (row) capDepRows.set(dependency.manifestId, row);
        }
      }
      const resolvePackageDependency = (name: string, version: string) =>
        installation.moduleAttachment
          ? verifiedCommonsDependencies.get(`${name}@${version}`)
          : allInstallations.find((i) => i.packageName === name && i.packageVersion === version)?.manifest;

      const computedRisk = computePackageRisk(
        installation.manifest,
        resolveCapabilityDependency,
        resolvePackageDependency,
      );
      const signedRiskFloor = installation.moduleAttachment
        ? installation.computedRisk
        : "informational";
      const risk = {
        ...computedRisk,
        compositeRisk: maxRisk(computedRisk.compositeRisk, signedRiskFloor),
        effectiveRisk: maxRisk(computedRisk.effectiveRisk, signedRiskFloor),
      };

      // Package-wide audience: the strictest (most-restrictive-raising) audience
      // across its own bundled capabilities — mirrors raiseForAudience's
      // "audience only ever raises, never lowers" contract at the package level.
      const audiences = installCapabilities.map((c) => c.audience);
      const audience = audiences.includes("external_visible")
        ? "external_visible"
        : audiences.includes("team")
          ? "team"
          : "private";

      // PKG-2 community-origin floor input: a package is treated at its
      // LEAST-trusted capability origin — if any bundled capability is
      // community/user_code (untrusted), the whole install is floored there.
      const resolvedTrustGrants: TrustGrantView[] = []; // store-layer follow-up (same gap capability.activate has)
      const floorOrigin: CapabilityOrigin = installCapabilities.some((c) => isUntrustedOrigin(c.origin))
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
      for (const cap of installCapabilities) {
        const existingManifest = await ctx.wiring.capabilityStore.getManifestByNameVersion(
          input.workspaceId,
          cap.name,
          cap.version,
        );
        const capId = existingManifest?.id ?? ctx.run.ids.next();
        if (
          existingManifest &&
          canonicalizeJson({
            capabilityType: existingManifest.capabilityType,
            name: existingManifest.name,
            version: existingManifest.version,
            origin: existingManifest.origin,
            audience: existingManifest.audience,
            manifest: existingManifest.manifest,
            dependencies: existingManifest.dependencies,
          }) !== canonicalizeJson({
            capabilityType: cap.capabilityType,
            name: cap.name,
            version: cap.version,
            origin: cap.origin,
            audience: cap.audience,
            manifest: { permissions: cap.permissions, connectors: cap.connectors },
            dependencies: cap.dependencies,
          })
        ) {
          throw new TRPCError({
            code: "CONFLICT",
            message: `capability "${cap.name}" v${cap.version} already exists with different signed content`,
          });
        }
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
        const existingState = existingManifest
          ? await ctx.wiring.capabilityStore.getState(capId)
          : null;
        if (!existingState) {
          await ctx.wiring.capabilityStore.upsertState({
            manifestId: capId,
            workspaceId: input.workspaceId,
            state: "draft",
            suspended: false,
            evidence: {},
          });
        }
        registeredManifestIds.push(capId);
      }

      const rerisked = await ctx.wiring.packageStore.setComputedRisk(installation.id, risk.effectiveRisk);

      if (decision.requirement !== "auto") {
        const proposalId = stablePackageInstallProposalId(input.workspaceId, installation.id);
        const priorDecision = await ctx.wiring.ledger.decisionFor(proposalId);
        if (priorDecision) {
          if (priorDecision.userDecision === "approve" || priorDecision.userDecision === "edit") {
            const finalized = await activateApprovedPackageInstallation(
              ctx.wiring,
              input.workspaceId,
              installation.id,
            );
            return {
              installed: true,
              decision,
              risk,
              installation: finalized,
              registeredManifestIds,
              reconciled: true as const,
            };
          }
          throw new TRPCError({
            code: "CONFLICT",
            message: "package install proposal was vetoed; stage a new signed package version to retry",
          });
        }
        let proposal: Proposal | null = await findPendingProposalById(
          ctx.wiring,
          input.workspaceId,
          proposalId,
        );
        if (!proposal) {
          try {
            proposal = await ctx.wiring.pipeline.propose(
              {
                workspaceId: input.workspaceId,
                actor: { type: ctx.identity.type, id: ctx.identity.id },
                action: "write",
                resourceType: "signal", // governed install intent; package_installation is not yet a kernel ResourceType
                resourceId: installation.id,
                inputs: {
                  operation: "package_install",
                  installationId: installation.id,
                  packageName: installation.packageName,
                  effectiveRisk: risk.effectiveRisk,
                },
                skill: "stageMutation",
              },
              ctx.run,
              { proposalId, requireHumanReview: true },
            );
          } catch (cause) {
            proposal = await findPendingProposalById(ctx.wiring, input.workspaceId, proposalId);
            if (!proposal) throw cause;
          }
        }
        if (proposal.status !== "pending_review") {
          throw new TRPCError({
            code: "FORBIDDEN",
            message: proposal.rejectionReason ?? "package install proposal did not reach Human review",
          });
        }
        return { installed: false, decision, risk, proposal, installation: rerisked, registeredManifestIds };
      }

      if (decision.budgeted && (risk.effectiveRisk === "informational" || risk.effectiveRisk === "advisory")) {
        await ctx.wiring.capabilityBudgets.recordAutoActivation(input.workspaceId, risk.effectiveRisk, input.todayKey);
      }

      await assertCurrentCommonsAttachment(ctx.wiring, installation);
      const installed = await ctx.wiring.packageStore.setStatus(installation.id, "installed");
      const installedWithRisk: PackageInstallationRow = { ...installed, computedRisk: risk.effectiveRisk };
      for (const dependency of verifiedDependencyInstallations.values()) {
        await ctx.wiring.packageStore.setComputedRisk(
          dependency.id,
          maxRisk(dependency.computedRisk, risk.effectiveRisk),
        );
        await ctx.wiring.packageStore.setStatus(dependency.id, "installed");
        let promotable = dependency;
        if (promotable.state === "private") {
          promotable = await ctx.wiring.packageStore.setState(promotable.id, "promoted");
        }
        if (promotable.state === "promoted") {
          const currentAvailable = await ctx.wiring.packageStore.getAvailable(
            input.workspaceId,
            promotable.packageName,
            promotable.moduleAttachment,
          );
          const promotion = promoteToAvailable(promotable, currentAvailable);
          await ctx.wiring.packageStore.setState(
            promotion.promoted.installationId,
            promotion.promoted.nextState,
          );
          if (promotion.demoted) {
            await ctx.wiring.packageStore.setState(
              promotion.demoted.installationId,
              promotion.demoted.nextState,
            );
          }
        }
      }
      const advanced = await ctx.wiring.packageStore.setState(installation.id, advancePackageState(installation.state));
      return {
        installed: true,
        decision,
        risk,
        installation: { ...advanced, computedRisk: risk.effectiveRisk, status: installedWithRisk.status },
        registeredManifestIds,
      };
    }),

    reconcileApproved: authenticatedProcedure
      .input(z.object({ proposalId: z.string().min(1) }))
      .mutation(async ({ input, ctx }) => {
        const proposal = await ctx.wiring.ledger.get(input.proposalId);
        if (!proposal) throw new TRPCError({ code: "NOT_FOUND", message: "proposal not found" });
        assertPilotWorkspace(proposal.workspaceId);
        await assertMembership(ctx.wiring.workspaceStore, proposal.workspaceId, ctx.identity.id);
        const installationId = packageInstallIdFromProposal(proposal);
        if (!installationId) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "proposal is not a package install approval" });
        }
        const decision = await ctx.wiring.ledger.decisionFor(input.proposalId);
        if (decision?.userDecision !== "approve" && decision?.userDecision !== "edit") {
          throw new TRPCError({ code: "BAD_REQUEST", message: "package install proposal is not approved" });
        }
        const installation = await activateApprovedPackageInstallation(
          ctx.wiring,
          proposal.workspaceId,
          installationId,
        );
        return { installation, proposalId: input.proposalId };
      }),

    list: authenticatedProcedure.input(paginatedInput).query(async ({ input, ctx }) => {
      assertPilotWorkspace(input.workspaceId);
      await assertMembership(ctx.wiring.workspaceStore, input.workspaceId, ctx.identity.id);
      const { items, total } = await ctx.wiring.packageStore.list(input.workspaceId, {
        limit: input.limit,
        offset: input.offset,
      });
      const itemsWithRuntimeBindings = await Promise.all(
        items.map(async (installation) => {
          const runtimeAutomationIds: string[] = [];
          for (const automation of installation.manifest.module?.automations ?? []) {
            if (!automation.ritualId) continue;
            const ritualId = resolveModuleRitualRuntimeId(installation.packageName, automation.ritualId);
            const agentId = resolveModuleAgentRuntimeId(installation.packageName, automation.agentId);
            const definition = ritualId
              ? await ctx.wiring.ritualRegistry.load(input.workspaceId, ritualId)
              : null;
            if (ritualId && agentId && definition?.agentId === agentId) {
              runtimeAutomationIds.push(automation.id);
            }
          }
          return { ...installation, runtimeAutomationIds };
        }),
      );
      return {
        items: itemsWithRuntimeBindings,
        total,
        hasMore: input.offset + itemsWithRuntimeBindings.length < total,
      };
    }),

    get: authenticatedProcedure.input(packageIdInput).query(async ({ input, ctx }) => {
      const installation = await ctx.wiring.packageStore.get(input.installationId);
      if (!installation) throw new TRPCError({ code: "NOT_FOUND", message: "unknown package installation" });
      await assertMembership(ctx.wiring.workspaceStore, installation.workspaceId, ctx.identity.id);
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
      await assertMembership(ctx.wiring.workspaceStore, input.workspaceId, ctx.identity.id);
      const target = await ctx.wiring.packageStore.get(input.installationId);
      if (!target || target.workspaceId !== input.workspaceId) {
        throw new TRPCError({ code: "NOT_FOUND", message: "unknown package installation" });
      }
      const currentCommonsEntry = await assertCurrentCommonsAttachment(ctx.wiring, target);
      await verifiedCommonsDependencyInstallations(ctx.wiring, target, currentCommonsEntry);
      const currentlyAvailable = await ctx.wiring.packageStore.getAvailable(
        input.workspaceId,
        target.packageName,
        target.moduleAttachment,
      );
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
      await assertMembership(ctx.wiring.workspaceStore, input.workspaceId, ctx.identity.id);
      const rollbackTarget = await ctx.wiring.packageStore.get(input.rollbackTargetId);
      if (!rollbackTarget || rollbackTarget.workspaceId !== input.workspaceId) {
        throw new TRPCError({ code: "NOT_FOUND", message: "unknown rollback target installation" });
      }
      const currentAvailable = await ctx.wiring.packageStore.getAvailable(
        input.workspaceId,
        rollbackTarget.packageName,
        rollbackTarget.moduleAttachment,
      );
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
  //  - publishBuiltins is a mutation → same auth gate. Pushes curated built-in
  //    packages to the running Commons service. Idempotent:
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
          search: z.string().trim().min(1).optional(),
          limit: z.number().int().min(1).max(100).optional(),
          offset: z.number().int().min(0).optional(),
        }),
      )
      .query(async ({ input, ctx }) => {
        const query: CommonsListQuery = {};
        if (input.kind !== undefined) query.kind = input.kind;
        if (input.tag !== undefined) query.tag = input.tag;
        if (input.search !== undefined) query.search = input.search;
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
          modulePackageName: z.string().min(1),
          agentId: z.string().min(1),
          needId: z.string().min(1),
        }),
      )
      .mutation(async ({ input, ctx }) => {
        assertPilotWorkspace(input.workspaceId);
        await assertMembership(ctx.wiring.workspaceStore, input.workspaceId, ctx.identity.id);

        const ownerModule = await ctx.wiring.packageStore.getAvailable(input.workspaceId, input.modulePackageName);
        if (!ownerModule || ownerModule.status !== "installed" || !ownerModule.manifest.module) {
          throw new TRPCError({ code: "NOT_FOUND", message: `installed Module "${input.modulePackageName}" not found` });
        }
        const need = ownerModule.manifest.module.commonsNeeds?.find((candidate) => candidate.id === input.needId);
        if (!need || need.agentId !== input.agentId) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "Commons capability need is not owned by the selected Module Agent" });
        }

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
        try {
          assertCommonsEntryContentTrusted(entry);
        } catch (err) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: err instanceof Error ? err.message : "Commons entry failed install-time trust verification",
          });
        }
        if (entry.kind !== need.kind || !need.tags.every((tag) => entry.tags.includes(tag))) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "Commons package does not satisfy the declared Module need" });
        }

        // Re-validate the manifest at this seam (same guard packages.register uses).
        let manifest: PackageManifest;
        try {
          manifest = parsePackageManifest({ package: entry.manifest });
        } catch (err) {
          if (err instanceof PackageManifestValidationError) {
            throw new TRPCError({ code: "BAD_REQUEST", message: `commons manifest invalid: ${err.message}` });
          }
          throw err;
        }
        if (manifest.capabilities.length === 0 || manifest.capabilities.some((capability) => capability.capabilityType !== "skill")) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "Only Skill packages can attach beneath a Module Agent" });
        }

        const dependencyPins = new Map<string, string>(
          (entry.securityScan.dependencyPins ?? []).map(
            (pin) => [`${pin.name}@${pin.version}`, pin.contentHash] as const,
          ),
        );
        const staged = new Set<string>();
        const stageDependencies = async (parent: PackageManifest): Promise<void> => {
          for (const dependency of parent.dependencies) {
            const key = `${dependency.manifestId}@${dependency.version}`;
            if (staged.has(key)) continue;
            staged.add(key);
            const dependencyEntry = await ctx.wiring.commonsRegistry.getVersion(
              dependency.manifestId,
              dependency.version,
            );
            const expectedHash = dependencyPins.get(key);
            if (!dependencyEntry || !expectedHash || dependencyEntry.integrity.value !== expectedHash) {
              throw new TRPCError({
                code: "BAD_REQUEST",
                message: `Commons dependency "${key}" does not match its signed content-hash pin`,
              });
            }
            try {
              assertCommonsEntryContentTrusted(dependencyEntry);
            } catch (err) {
              throw new TRPCError({
                code: "BAD_REQUEST",
                message: err instanceof Error ? err.message : `Commons dependency "${key}" failed trust verification`,
              });
            }
            await ctx.wiring.packageStore.create({
              workspaceId: input.workspaceId,
              packageName: dependencyEntry.manifest.name,
              packageVersion: dependencyEntry.manifest.version,
              manifest: dependencyEntry.manifest,
              computedRisk: dependencyEntry.securityScan.riskBand,
              state: "private",
              status: "pending_review",
              lineageManifestId: dependencyEntry.manifest.lineageManifestId,
              moduleAttachment: {
                source: "commons",
                modulePackageName: ownerModule.packageName,
                agentId: input.agentId,
                needId: input.needId,
                contentHash: dependencyEntry.integrity.value,
              },
            });
            for (const pin of dependencyEntry.securityScan.dependencyPins ?? []) {
              dependencyPins.set(`${pin.name}@${pin.version}`, pin.contentHash);
            }
            await stageDependencies(dependencyEntry.manifest);
          }
        };
        await stageDependencies(manifest);

        // Register as a private installation — same as packages.register, but the
        // manifest source is the verified Commons entry, not a user-supplied object.
        const created = await ctx.wiring.packageStore.create({
          workspaceId: input.workspaceId,
          packageName: manifest.name,
          packageVersion: manifest.version,
          manifest,
          computedRisk: entry.securityScan.riskBand,
          state: "private",
          status: "pending_review",
          lineageManifestId: manifest.lineageManifestId,
          moduleAttachment: {
            source: "commons",
            modulePackageName: ownerModule.packageName,
            agentId: input.agentId,
            needId: input.needId,
            contentHash: entry.integrity.value,
          },
        });

        return { installation: created };
      }),

    /**
     * Publish curated built-in packages to the running
     * Commons service. Idempotent: already-published versions are skipped.
     * This is the runtime equivalent of `pnpm --filter @bridge/api publish-builtins`.
     * Requires authentication (mutation guard) to prevent arbitrary callers from
     * flooding the registry.
     */
    publishBuiltins: procedure.mutation(async ({ ctx }) => {
      const published: string[] = [];
      const skipped: string[] = [];
      const failed: { name: string; reason: string }[] = [];

      for (const { manifest, commons } of COMMONS_BUILT_IN_PACKAGES) {
        try {
          await ctx.wiring.commonsRegistry.publish(manifest, {
            tags: commons.tags,
            provenance: commons.provenance,
          });
          published.push(`${manifest.name}@${manifest.version}`);
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          if (message.includes("already published")) {
            const existing = await ctx.wiring.commonsRegistry.getVersion(manifest.name, manifest.version);
            const expectedIdentity = canonicalizeJson({
              manifest,
              tags: normalizeCommonsTags(commons.tags),
              provenance: commons.provenance,
            });
            const existingIdentity = existing
              ? canonicalizeJson({
                  manifest: existing.manifest,
                  tags: normalizeCommonsTags(existing.tags),
                  provenance: existing.provenance,
                })
              : null;
            if (existingIdentity === expectedIdentity) {
              skipped.push(`${manifest.name}@${manifest.version}`);
            } else {
              failed.push({
                name: manifest.name,
                reason: "published version has different immutable manifest, tags, or provenance",
              });
            }
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

  /**
   * AGS0-AGS2 (TASK-007) — typed Goals/Tasks, the fail-closed Goal/Task-bound
   * Skill resolver, and bounded child Agent Runs. `skill.resolve` is a
   * read-only preview (never invokes anything); `skill.invoke` is the real
   * governed call — it goes through the SAME `pipeline.propose` every other
   * mutation uses, so a direct Human/Automation invocation of a governed
   * Skill fails closed there exactly as it would through `action.propose`
   * (see pipeline.ts's AGS1 gate) — this router adds no separate enforcement
   * path, only a more ergonomic Goal/Task-shaped surface over the same gate.
   */
  agentOrchestration: t.router({
    goal: t.router({
      create: authenticatedProcedure.input(goalCreateInput).mutation(async ({ input, ctx }) => {
        assertPilotWorkspace(input.workspaceId);
        await assertMembership(ctx.wiring.workspaceStore, input.workspaceId, ctx.identity.id);
        return ctx.wiring.goalTasks.createGoal(
          { workspaceId: input.workspaceId, type: input.type, title: input.title },
          { nextId: () => ctx.run.ids.next(), nowISO: () => ctx.run.clock.nowISO() },
        );
      }),
      list: authenticatedProcedure
        .input(z.object({ workspaceId: z.string().min(1) }))
        .query(async ({ input, ctx }) => {
        assertPilotWorkspace(input.workspaceId);
        await assertMembership(ctx.wiring.workspaceStore, input.workspaceId, ctx.identity.id);
        return ctx.wiring.goalTasks.listGoals(input.workspaceId);
      }),
    }),

    task: t.router({
      create: authenticatedProcedure.input(taskCreateInput).mutation(async ({ input, ctx }) => {
        assertPilotWorkspace(input.workspaceId);
        await assertMembership(ctx.wiring.workspaceStore, input.workspaceId, ctx.identity.id);
        const goal = await ctx.wiring.goalTasks.getGoal(input.workspaceId, input.goalId);
        const [agentWorkspaceId, agentActive] = await Promise.all([
          ctx.wiring.agents.workspaceId(input.assignedAgentId),
          ctx.wiring.agents.isActive(input.assignedAgentId),
        ]);
        if (!goal) {
          throw new TRPCError({ code: "NOT_FOUND", message: `unknown goal ${input.goalId}` });
        }
        if (agentWorkspaceId !== input.workspaceId || !agentActive) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "assigned Agent is not active in this workspace" });
        }
        return ctx.wiring.goalTasks.createTask(
          {
            workspaceId: input.workspaceId,
            goalId: input.goalId,
            type: input.type,
            assignedAgentId: input.assignedAgentId,
          },
          { nextId: () => ctx.run.ids.next(), nowISO: () => ctx.run.clock.nowISO() },
        );
      }),
      listByGoal: authenticatedProcedure
        .input(z.object({ workspaceId: z.string().min(1), goalId: z.string().min(1) }))
        .query(async ({ input, ctx }) => {
          assertPilotWorkspace(input.workspaceId);
          await assertMembership(ctx.wiring.workspaceStore, input.workspaceId, ctx.identity.id);
          return ctx.wiring.goalTasks.listTasksByGoal(input.workspaceId, input.goalId);
        }),
      /** The ONLY thing that changes governed-Skill eligibility for a Task —
       * never a Skill manifest's `defaultAgents` preference list. */
      reassign: authenticatedProcedure.input(taskReassignInput).mutation(async ({ input, ctx }) => {
        assertPilotWorkspace(input.workspaceId);
        await assertMembership(ctx.wiring.workspaceStore, input.workspaceId, ctx.identity.id);
        const [agentWorkspaceId, agentActive] = await Promise.all([
          ctx.wiring.agents.workspaceId(input.assignedAgentId),
          ctx.wiring.agents.isActive(input.assignedAgentId),
        ]);
        if (agentWorkspaceId !== input.workspaceId || !agentActive) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "assigned Agent is not active in this workspace" });
        }
        return ctx.wiring.goalTasks.reassignTask(
          input.workspaceId,
          input.taskId,
          input.assignedAgentId,
        );
      }),
    }),

    skill: t.router({
      /** Read-only preview of AGS1 resolution — never invokes the Skill. Lets
       * the UI show WHY an Agent is (or is not) eligible before a real call. */
      resolve: authenticatedProcedure.input(resolveSkillInput).query(async ({ input, ctx }) => {
        assertPilotWorkspace(input.workspaceId);
        await assertMembership(ctx.wiring.workspaceStore, input.workspaceId, ctx.identity.id);
        const goal = await ctx.wiring.goalTasks.getGoal(input.workspaceId, input.goalId);
        const task = await ctx.wiring.goalTasks.getTask(input.workspaceId, input.taskId);
        if (!goal || !task || task.goalId !== goal.id) {
          throw new TRPCError({ code: "NOT_FOUND", message: "unknown or mismatched Goal/Task" });
        }
        const [agentScope, agentDataScope, agentWorkspaceId, agentActive] = await Promise.all([
          ctx.wiring.agents.capabilityScope(input.agentId),
          ctx.wiring.agents.dataScope(input.agentId),
          ctx.wiring.agents.workspaceId(input.agentId),
          ctx.wiring.agents.isActive(input.agentId),
        ]);
        const candidates = input.skillId
          ? ctx.wiring.skillManifests.forSkill(input.workspaceId, input.skillId)
          : ctx.wiring.skillManifests.all(input.workspaceId);
        return resolveSkillForTask(candidates, {
          goal,
          task,
          agent: {
            id: input.agentId,
            workspaceId: agentWorkspaceId,
            active: agentActive,
            capabilityScope: agentScope,
            plane: "local",
            dataScope: agentDataScope,
          },
          ...(input.skillId ? { skillId: input.skillId } : {}),
          ...(input.requestedDataScope ? { requestedDataScope: input.requestedDataScope as DataScope } : {}),
        });
      }),
    }),

    childRun: t.router({
      get: authenticatedProcedure
        .input(z.object({ workspaceId: z.string().min(1), childRunId: z.string().min(1) }))
        .query(async ({ input, ctx }) => {
          assertPilotWorkspace(input.workspaceId);
          await assertMembership(ctx.wiring.workspaceStore, input.workspaceId, ctx.identity.id);
          return ctx.wiring.childAgentRuns.get(input.workspaceId, input.childRunId);
        }),

      listByParentRun: authenticatedProcedure
        .input(z.object({ workspaceId: z.string().min(1), parentRunId: z.string().min(1) }))
        .query(async ({ input, ctx }) => {
          assertPilotWorkspace(input.workspaceId);
          await assertMembership(ctx.wiring.workspaceStore, input.workspaceId, ctx.identity.id);
          return ctx.wiring.childAgentRuns.listByParentRun(input.workspaceId, input.parentRunId);
        }),

      /** Governance/Human may stop any child Run within policy. The acting
       * identity is SERVER-RESOLVED (`ctx.identity`), never client-asserted —
       * same rule every mutation in this router follows.
       *
       * TASK-011 remediation (2026-07-19 coordinator distributed-defects
       * RE-review round 2, issue 5) — a culture-research fetch's cancellation
       * is NOT just a child-Run status flip: it has its OWN durable
       * cancellation mechanism (`DurableCultureFetchStore.requestCancel` +
       * the in-flight `AbortController`) that actually stops the real
       * outbound socket, cross-instance-safe via the durable
       * `cancelRequested` flag `materializeCultureSourceFetch`'s own poll
       * loop watches. Calling `cancelChildAgentRun` directly here (as this
       * generic endpoint used to, unconditionally) would race that
       * mechanism: the child Run could be marked "cancelled" while the
       * underlying fetch keeps running, unaware, eventually landing
       * "fetched"/"failed" against an already-terminal child Run — a
       * fetched/cancelled mismatch this endpoint must not create. Route
       * THROUGH the registered per-operation cancellation for any child Run
       * that IS a culture-research fetch; only fall back to the generic
       * child-Run-only transition for every other (non-culture) child Run.
       */
      cancel: authenticatedProcedure
        .input(z.object({ workspaceId: z.string().min(1), childRunId: z.string().min(1) }))
        .mutation(async ({ input, ctx }) => {
        assertPilotWorkspace(input.workspaceId);
        await assertMembership(ctx.wiring.workspaceStore, input.workspaceId, ctx.identity.id);
        const cultureFetchRecord = await ctx.wiring.cultureFetchStore.get(input.workspaceId, input.childRunId);
        if (cultureFetchRecord && cultureFetchRecord.proposalId) {
          await cancelCultureSourceFetch(
            {
              childAgentRuns: ctx.wiring.childAgentRuns,
              ledger: ctx.wiring.ledger,
              fetchStore: ctx.wiring.cultureFetchStore,
              abortControllers: ctx.wiring.cultureFetchAbortControllers,
            },
            input.workspaceId,
            cultureFetchRecord.proposalId,
            input.childRunId,
            { type: ctx.identity.type, id: ctx.identity.id },
            ctx.run,
          );
          // `cancelCultureSourceFetch` already transitions the child Run
          // itself (via its own fenced/lease-aware path) whenever its own
          // durable write actually commits. Whether that happened just now,
          // already happened earlier, or the fetch had already reached a
          // DIFFERENT terminal outcome (fetched/failed) before this request
          // arrived, the child Run's CURRENT, authoritative record is always
          // the correct thing to return here — never a stale optimistic
          // "cancelled" that might not match what the fetch actually
          // resolved to (no fetched/cancelled mismatch is swallowed; the
          // caller sees the real converged state).
          const current = await ctx.wiring.childAgentRuns.get(input.workspaceId, input.childRunId);
          if (!current) throw new TRPCError({ code: "NOT_FOUND", message: "unknown child Run" });
          return current;
        }
        return cancelChildAgentRun(
          { store: ctx.wiring.childAgentRuns, ledger: ctx.wiring.ledger },
          input.workspaceId,
          input.childRunId,
          { type: ctx.identity.type, id: ctx.identity.id },
          ctx.run,
        );
      }),
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
