/**
 * Composition root — assembles the Universal Action Pipeline + the Google
 * integration from ports.
 *
 * Governance: in-memory adapters by default (zero infra); Drizzle/Supabase when
 * DATABASE_URL is set — via the two typed factories below, `buildPersistentPorts()`
 * and `buildInMemoryPorts()`. Each returns one fully-typed `ModePorts` object; there
 * is no conditional reassignment of individual ports.
 *
 * Ledger residency (KNOWN OPEN GAP, All fixes.md Phase 1 item 7 — needs a product
 * decision, not resolved here): even in persistent mode the ledger binds to whatever
 * `DATABASE_URL` points at, which may be cloud Supabase. That means private-proposal
 * ledger rows (bodies/diffs for Gmail/Calendar-derived actions) CAN land in a cloud
 * ledger despite this file historically claiming "the ledger MUST stay local." We do
 * NOT silently keep that claim — `buildPersistentPorts()` logs a loud warning at boot
 * instead, so the gap is visible rather than papered over. Fixing it for real means
 * either splitting the ledger by `data_scope` (local vs cloud) or formally dropping
 * the guarantee; that decision is explicitly deferred to the user (see decisions-log).
 *
 * Capture store (DealPilot's `ToolCaptureStore`): no persistent (Drizzle/pglite)
 * implementation exists yet anywhere in the codebase (All fixes.md Phase 3 item 11b,
 * "persist tool_captures to a real table — still open"). `buildPersistentPorts()`
 * therefore ALSO keeps this one in-memory even when `DATABASE_URL` is set, and logs a
 * loud warning identifying exactly this gap, rather than faking persistence that
 * doesn't exist. Restart in persistent mode still drops quarantined-but-uncommitted
 * DealPilot captures.
 *
 * Canonical identity store: this one IS genuinely fixed here.
 * `DrizzleCanonicalIdentityStore` already exists (@bridge/db) and is now wired in
 * persistent mode instead of the in-memory fake — no more silent lie there.
 *
 * LOCAL plane: pglite (@bridge/local) — OAuth tokens + raw bodies + derived
 * Touchpoints/Memories/Signals persist here, never Supabase. The residency fix.
 *
 * Google egress adapter: the real googleapis gateway when GOOGLE_CLIENT_ID/SECRET
 * are configured; otherwise a fail-closed factory (no fake/dummy data — the platform
 * sources only real data).
 */
import {
  InMemoryAgentStore,
  InMemoryEphemeralStore,
  InMemoryEventBus,
  InMemoryLedger,
  InMemoryPolicyStore,
  InMemoryRoleStore,
  InMemoryRitualRegistry,
  InMemoryRitualRunRecorder,
  InMemoryToolRegistry,
  InMemoryMediaStore,
  InMemorySkillRegistry,
  InProcessRitualExecutor,
  RecordingVarianceAdjuster,
  UniversalActionPipeline,
  KERNEL_PASSTHROUGH_SKILL,
  stageCapture,
  InMemoryCapabilityStore,
  InMemoryAutoActivationBudgetStore,
  InMemoryKillSwitch,
  InMemoryCredentialBroker,
  InMemoryWorkspaceDefinitionStore,
  InMemoryPackageStore,
  InMemoryOnboardingProfileStore,
  type MemoryStore,
  InMemoryEvalStore,
  InMemoryPolicyParamStore,
  InMemoryGoalTaskStore,
  InMemorySkillManifestRegistry,
  InMemoryChildAgentRunStore,
  EchoModelProvider,
  type ModelProvider,
  type AgentQuery,
  type EphemeralQuery,
  type LedgerStore,
  type LocalMediaStore,
  type PolicyFn,
  type PolicyStore,
  type RitualRegistry,
  type RitualRunRecorder,
  type RoleQuery,
  type Skill,
  type SkillOutput,
  type ToolRegistry,
  type CapabilityStore,
  type AutoActivationBudgetStore,
  type Action,
  type KillSwitchPort,
  type CredentialBroker,
  type WorkspaceDefinitionStore,
  type PackageStore,
  type OnboardingProfileStore,
  type EvalStore,
  type PolicyParamStore,
  type ResourceType,
  type GoalTaskStore,
  type SkillManifestRegistry,
  type ChildAgentRunStore,
  type SkillManifest,
  uuidv7,
} from "@bridge/core";
import { HttpCommonsClient, commonsUrlFromEnv, trustedCommonsPublicKeysFromEnv } from "./commons-client.js";
import type { CommonsRegistry } from "@bridge/core";
import {
  assertRlsPosture,
  createDb,
  createDrizzlePorts,
  createLocalDb,
  createLocalMediaStore,
  DrizzleCanonicalIdentityStore,
  DrizzleWorkspaceStore,
  DrizzleGraphStore,
  DrizzleJobPilotStore,
  DrizzleHelpdeskStore,
  DrizzleResourcesStore,
  DrizzleCapabilityStore,
  DrizzleWorkspaceDefinitionStore,
  DrizzlePackageStore,
  DrizzleMemoryStore,
  DrizzleLedgerStore,
  DrizzleRelationMaterializationStore,
  DrizzleGoalTaskStore,
  DrizzleSkillManifestRegistry,
  DrizzleChildAgentRunStore,
  seedSkillManifests,
  ensureLearningAgentGovernance,
  ensureOutreachAgentGovernance,
  ensureEgressAgentGovernance,
  ensureIntakeAgentGovernance,
  ensureDealPilotPrincipalGovernance,
  InMemoryCanonicalIdentityStore,
  ensureInternalStrategistGovernance,
  ensureGovernanceAgentGovernance,
  ensureCapabilityBuilderGovernance,
  ensureRelationshipUserGovernance,
  type CanonicalIdentityStore,
} from "@bridge/db";
import { createMemoryLocalPlane, createPgliteLocalPlane, type LocalPlane } from "@bridge/local";
import { AnthropicProvider, GroqProvider, OllamaProvider, createModelRouter, type ModelRouter } from "@bridge/models";
import {
  EgressExecutor,
  GoogleApiGatewayFactory,
  GoogleService,
  GOOGLE_MANIFEST,
  googleSkills,
  IntakeMaterializer,
  IntakeService,
  MissingGoogleGatewayFactory,
  oauthConfigFromEnv,
  SKILL_SOURCE_GMAIL,
  SKILL_SOURCE_CALENDAR,
  SKILL_LIST_CALENDAR,
  SKILL_STAGE,
  type GoogleGatewayFactory,
  type GoogleOAuthConfig,
  type ToolManifest,
} from "@bridge/integrations-google";
import { createInMemoryCaptureStore, ToolIntakeMaterializer, type ToolCaptureStore } from "@bridge/tool-kit";
import { createFactStore, type FactStore } from "@bridge/facts";
import {
  HumanReauthentication,
  InMemoryCredentialAuditSink,
  InMemoryDealPilotStore,
  InMemorySourceCredentialVault,
  SourceCredentialService,
  assertSourceDiscoveryAllowed,
  createBizBuySellAlertConnector,
  createGmailFetchMessages,
  type DealPilotBindings,
  type DealPilotRecord,
  type DealPilotStore,
} from "@bridge/dealpilot";
import { matchCompany } from "@bridge/company-sourcing";
import type { DedupeCandidate } from "@bridge/dedupe";
import {
  BUILT_IN_PACKAGES,
  CITED_ROLE_MODEL_PRACTICE_VERSION,
  DEALPILOT_SOURCING_AGENT_ID,
  LEARNING_AGENT_RUNTIME_ID,
  LEARNING_RECOMMENDATION_SKILL_ID,
  resolveModuleAgentRuntimeId,
  resolveModuleRitualRuntimeId,
} from "./built-in-packages.js";
import {
  defaultBridgeFilesRoot,
  renameOrganizationFilesRoot,
} from "./module-files.js";

// Pilot identities (uuids) — structural constants the system needs to run (the
// workspace + its service agents + the signed-in pilot user). Not demo/dummy data.
// Exported: router.ts's `assertPilotWorkspace` uses it to explicitly REJECT any
// other workspaceId (interim single-tenant safety fix, All fixes.md Phase 3 item 11a
// — full multi-tenancy is out of scope for this pass).
export const PILOT_WORKSPACE = "b0000000-0000-4000-a000-000000000001";
export const OUTREACH_AGENT = "b0000000-0000-4000-a000-0000000000d1";
export const OUTREACH_ROLE = "b0000000-0000-4000-a000-0000000000f1";
const OUTREACH_TOUCHPOINT_PERMISSION = "b0000000-0000-4000-a000-0000000000c1";
export const LEARNING_AGENT = LEARNING_AGENT_RUNTIME_ID;
export const EGRESS_AGENT = DEALPILOT_SOURCING_AGENT_ID;
const EGRESS_ROLE = "b0000000-0000-4000-a000-0000000000c1";
const EGRESS_PRINCIPAL_PERMISSION = "b0000000-0000-4000-a000-0000000000c7";
export const LEARNING_ROLE = "b0000000-0000-4000-a000-0000000000f2";
const LEARNING_SIGNAL_PERMISSION = "b0000000-0000-4000-a000-0000000000c2";
const INTAKE_AGENT = "b0000000-0000-4000-a000-0000000000e2";
const INTAKE_ROLE = "b0000000-0000-4000-a000-0000000000f6";
const INTAKE_PRINCIPAL_PERMISSION = "b0000000-0000-4000-a000-0000000000c8";
// AGS0 (TASK-007) — Internal Strategist's physical governed-pipeline identity
// (the id `AgentQuery`/the ledger key off of). Distinct from the chat-routing
// `FoundationalAgentId` string "internal_strategist" (@bridge/core's agents.ts)
// the same way LEARNING_AGENT above is distinct from "learning" — @mention
// routing and pipeline authority are two different identity spaces that
// happen to share a display name.
export const INTERNAL_STRATEGIST_AGENT = "b0000000-0000-4000-a000-0000000000d3";
// TASK-007 (AGS3 closure) — the remaining two of the five permanent
// foundational Agents (docs/raw/agent-goal-skill-orchestration-plan-2026-07.md
// responsibility_map) get REAL physical governed-pipeline identities too, not
// only prompt-level personas — otherwise a Task could never actually be
// assigned to Governance or Capability Builder (resolveSkillForTask requires
// Task.assignedAgentId to be a real, capability-scoped Agent id). Chief of
// Staff deliberately has NO physical identity here — per docs/glossary.md
// "Its routing role is a product composition, not an architectural
// requirement" — it never itself invokes a governed Skill as an actor.
export const GOVERNANCE_AGENT = "b0000000-0000-4000-a000-0000000000d4";
export const CAPABILITY_BUILDER_AGENT = "b0000000-0000-4000-a000-0000000000d5";
// TASK-007 persistent-mode governance seed ids (ensureInternalStrategistGovernance)
// — mirror LEARNING_ROLE/LEARNING_SIGNAL_PERMISSION's id-space convention for
// the coordinator's parallel ensureLearningAgentGovernance.
export const INTERNAL_STRATEGIST_ROLE = "b0000000-0000-4000-a000-0000000000f3";
const INTERNAL_STRATEGIST_SIGNAL_PERMISSION = "b0000000-0000-4000-a000-0000000000c4";
export const GOVERNANCE_ROLE = "b0000000-0000-4000-a000-0000000000f4";
const GOVERNANCE_SIGNAL_PERMISSION = "b0000000-0000-4000-a000-0000000000c5";
export const CAPABILITY_BUILDER_ROLE = "b0000000-0000-4000-a000-0000000000f5";
const CAPABILITY_BUILDER_SIGNAL_PERMISSION = "b0000000-0000-4000-a000-0000000000c6";
// Exported: apps/api/test/blueprint.test.ts (ADR-023/ADR-024) needs a real
// seeded user id — workspace_definitions.created_by is a real FK to `users`,
// so an arbitrary placeholder caller id would violate that constraint.
export const PILOT_USER = "e0f0053b-fc44-476e-be27-1371e179e958";

export async function migrateLegacyPilotOrganization(
  workspaceStore: DrizzleWorkspaceStore,
  moduleFilesBridgeRoot: string,
): Promise<void> {
  await workspaceStore.withWorkspaceRenameLock(
    PILOT_WORKSPACE,
    async (current, persistName, registerRollback) => {
      if (current.name !== "Pilot workspace") return;
      const rollback = await renameOrganizationFilesRoot(
        current.name,
        "Pilot Organization",
        moduleFilesBridgeRoot,
      );
      if (rollback) registerRollback(rollback);
      await persistName("Pilot Organization");
    },
  );
}

export async function retireSupersededBuiltIns(
  packageStore: PackageStore,
  workspaceId: string,
): Promise<void> {
  for (const row of await packageStore.listVersions(workspaceId, "helpdesk")) {
    if (row.state === "available") {
      await packageStore.setState(row.id, "legacy");
    }
  }
}

export interface Wiring {
  pipeline: UniversalActionPipeline;
  ritualExecutor: InProcessRitualExecutor;
  roles: RoleQuery;
  agents: AgentQuery;
  ephemeral: EphemeralQuery;
  policies: PolicyStore;
  ledger: LedgerStore;
  relationMaterializations: DrizzleRelationMaterializationStore;
  events: InMemoryEventBus;
  /** LOCAL-plane media store (bytea blobs). Pglite when LOCAL_MEDIA_DIR set, else in-memory. Never cloud. */
  localMedia: LocalMediaStore;
  /** True when bound to Postgres (DATABASE_URL set). */
  persistent: boolean;
  /** Local Files root; injectable so tests never touch the user's home directory. */
  moduleFilesBridgeRoot: string;
  /** The LOCAL plane (pglite) — private tier. */
  localPlane: LocalPlane;
  /** The Google integration surface. */
  google: GoogleService;
  /** OAuth config (null = not configured → fail-closed gateway). */
  googleOAuth: GoogleOAuthConfig | null;
  /** Whether the real googleapis gateway is in use, or Google is unconfigured. */
  googleGatewayKind: "google" | "unconfigured";
  googleManifest: ToolManifest;
  /** The server-chosen pilot user id — the default authenticated identity (Phase C
   * replaces this pin with a verified Supabase session). */
  pilotUserId: string;
  /** Ritual registry (config rows) — used by ritual.create to register new workflows. */
  ritualRegistry: RitualRegistry;
  /** Workspace + team-member CRUD — direct DB writes, not a governed pipeline skill. */
  workspaceStore: DrizzleWorkspaceStore;
  /** Read surface for Initiative/Touchpoint/Signal (see graph-store.ts). */
  graphStore: DrizzleGraphStore;
  /** JobPilot's persistence (Phase 4 — @bridge/jobpilot is pure logic, no store). */
  jobpilotStore: DrizzleJobPilotStore;
  /** Helpdesk tickets/messages, incl. the public token-authenticated submitter path. */
  helpdeskStore: DrizzleHelpdeskStore;
  /** Resources catalog (replaces the prototype's Supabase-direct read). */
  resourcesStore: DrizzleResourcesStore;
  /** Capability Trust Model — capability_manifests + capability_states (docs/wiki/vision.md). */
  capabilityStore: CapabilityStore;
  /** P1 Workspace Generator — workspace_definitions (blueprint/version/status), the
   * governed-proposal artifact workspace.blueprint.* compiles via @bridge/core's
   * compileBlueprint (docs/wiki/vision.md "View grammar"). */
  workspaceDefinitionStore: WorkspaceDefinitionStore;
  /** P2 capability packages (docs/raw/capability-package-format.md, ADR-018) —
   * package_installations-shaped rows. Real DrizzlePackageStore in persistent
   * mode (ADR-023); InMemoryPackageStore in in-memory mode — same split every
   * other Drizzle-backed store in this file already follows. */
  packageStore: PackageStore;
  /** Daily auto-activation budget counters (informational/advisory bands). In-memory in both
   * modes for now — no persistent implementation exists yet (mirrors the ledger-residency-gap
   * pattern: a real budget counter is future work, not silently faked as durable). */
  capabilityBudgets: AutoActivationBudgetStore;
  /** Workspace-level kill switch forcing every capability activation to explicit approval. */
  capabilityKillSwitch: KillSwitchPort;
  /** Capabilities never receive raw secrets — they request scoped, time-boxed grant references. */
  credentialBroker: CredentialBroker;
  /** Universal Commons client — reads/publishes against the local Commons registry
   * (services/commons at :4780 by default; COMMONS_URL for Bridge Cloud swap).
   * Implements CommonsRegistry port from @bridge/core; the tRPC commons.* router
   * delegates here so no HTTP client code leaks into the router. */
  commonsRegistry: CommonsRegistry;
  /** EVAL-1/2/3 eval runs + comparisons (agent-quality-eval-model). In-memory in
   * both modes for now — no Drizzle EvalStore binding exists yet (mirrors the
   * capabilityBudgets residency-gap pattern). capability.approve's Validated->Active
   * gate reads the candidate's + baseline-lineage's latest run from here. */
  evalStore: EvalStore;
  /** policy_params tunable space (EVAL-3 promotion gates + VAR-1 nudges). In-memory in
   * both modes for now — defaults-only until a governed nudge is approved and a Drizzle
   * binding lands. */
  policyParams: PolicyParamStore;
  /** Onboarding personalization profile (ADR-033/R-030) — animal, answers, phone/LinkedIn
   * verification method, connected sources. In-memory in both modes for now (see
   * onboarding-profile.ts's header comment for scope vs. the general Memory/Knowledge gap). */
  onboardingProfileStore: OnboardingProfileStore;
  /** AGS1 (TASK-007) — Goal/Task catalog Skills resolve against. In-memory
   * default in both modes for dev/test (mirrors every other in-memory port's
   * dependency-free default); `buildPersistentPorts` binds the real,
   * restart-durable `DrizzleGoalTaskStore` instead. */
  goalTasks: GoalTaskStore;
  /** AGS1 (TASK-007) — registered governed Skill manifests (`resolveSkillForTask`'s
   * candidate catalog). In-memory default; `buildPersistentPorts` binds the real
   * `DrizzleSkillManifestRegistry` (backed by `skill_manifests`, seeded from the
   * SAME code-declared `GOVERNED_SKILL_MANIFEST_CATALOG` via `ensureSkillManifestCatalog`). */
  skillManifests: SkillManifestRegistry;
  /** AGS2 (TASK-007) — bounded child Agent Runs a parent Agent has spawned.
   * In-memory default; `buildPersistentPorts` binds the real, restart-durable
   * `DrizzleChildAgentRunStore` instead. */
  childAgentRuns: ChildAgentRunStore;
  /** Inspectable, correctable, deletable learned preferences. */
  memoryStore: MemoryStore;
  /** ModelProvider registry/router (@bridge/models): resolves tool-kit modelBindings to
   * providers, honoring planeDefault (capture/sensor plane = local models, never cloud
   * fallback). In-memory mode registers the network-free echo double; persistent mode
   * registers Ollama (local) + Anthropic + Groq (cloud, only when their respective
   * API keys are set). */
  models: ModelRouter;
  /** DealPilot's quarantine/commit surface (first tool on the generic intake seam). */
  dealpilot: {
    captures: ToolCaptureStore;
    facts: FactStore;
    materializer: ToolIntakeMaterializer;
    integrationId: string;
    store: DealPilotStore;
    /** Compatibility read index for the legacy candidate list endpoint. */
    candidateIds: string[];
    credentials: SourceCredentialService;
    credentialVault: InMemorySourceCredentialVault;
    credentialAudit: InMemoryCredentialAuditSink;
    captureSources: Map<string, string>;
    committedCaptureIds: Set<string>;
    committingCaptureIds: Set<string>;
    bindings: DealPilotBindings;
  };
  /** In-memory governance stores for seeding in dev; undefined when persistent. */
  memory?: {
    roles: InMemoryRoleStore;
    agents: InMemoryAgentStore;
    ephemeral: InMemoryEphemeralStore;
  };
  close(): Promise<void>;
}

/** A first skill: stage an entity mutation (echo inputs as the proposed change). */
/** The kernel's reserved passthrough — see @bridge/core's `KERNEL_PASSTHROUGH_SKILL`
 * doc comment (pipeline.ts) for exactly why Human-authored mutations may use it
 * without turning it into a Skill catalog entry. Agents get no such bypass.
 * `name` MUST equal that constant. */
const stageMutation: Skill = {
  name: KERNEL_PASSTHROUGH_SKILL,
  async run(inputs) {
    return { proposedOutput: inputs, diff: { to: inputs } };
  },
};

const stageLearningRecommendation: Skill = {
  name: LEARNING_RECOMMENDATION_SKILL_ID,
  async run(inputs) {
    return { proposedOutput: inputs, diff: { to: inputs } };
  },
};

/**
 * AGS1 (TASK-007) demo governed Skill — Internal Strategist's (or, per the
 * SAME manifest, Learning's) analytical-synthesis output. Registered with a
 * `SkillManifest` below (`AGENT_ORCHESTRATION_SKILL_MANIFEST`), so — like
 * every other governed skill in this catalog after the fail-closed-by-default
 * migration — this skill may ONLY be invoked by an Agent actor resolved via a
 * real Goal/Task assignment; see pipeline.ts's `PipelineDeps.skillManifests`
 * doc comment for the two narrow, principled (never a maintained allowlist)
 * exemptions from that rule.
 */
const stageStrategicRecommendation: Skill = {
  name: "stageStrategicRecommendation",
  async run(inputs) {
    return { proposedOutput: inputs, diff: { to: inputs } };
  },
};

/** AGS1 Goal/Task types this demo manifest matches — kept as named constants
 * so the seeded Task in `agentOrchestration` procedures and this manifest
 * cannot silently drift apart. */
export const RELATIONSHIP_LEARNING_GOAL_TYPE = "relationship.learning";
export const SYNTHESIZE_RECOMMENDATION_TASK_TYPE = "synthesize_recommendation";

export const AGENT_ORCHESTRATION_SKILL_MANIFEST = {
  workspaceId: PILOT_WORKSPACE,
  skillId: "stageStrategicRecommendation",
  version: "1.0.0",
  goalTypes: [RELATIONSHIP_LEARNING_GOAL_TYPE],
  taskTypes: [SYNTHESIZE_RECOMMENDATION_TASK_TYPE],
  permissions: ["signal:write"],
  plane: "local",
  dataScopes: ["all"],
  riskBand: "advisory",
  evalVersion: "1.0.0",
  // Preferences ONLY (AGS1) — resolveSkillForTask never reads this field; the
  // Task's assignedAgentId is what actually authorizes an eligible Agent.
  defaultAgents: ["learning", "internal_strategist"],
  childRunPolicy: "allowed",
} as const;

/**
 * AGS1 real-catalog migration (TASK-007 closure) — `stageLearningRecommendation`
 * (used only by `chiefOfStaff.recommendFromRoleModel`, always invoked with
 * `actor: {type:"agent", id: LEARNING_AGENT}` already — see router.ts) is
 * migrated onto a real governed manifest rather than left in the legacy
 * allowlist below. This changes NO runtime behavior (the call site was already
 * agent-actor-only, so it already always drafted/`pending_review`) — it only
 * ADDS the requirement that the call site supply a real `goalTaskRef`, which
 * `chiefOfStaff.recommendFromRoleModel` now provisions inline (one bounded
 * Task per recommendation request).
 */
export const LEARNING_ROLE_MODEL_GOAL_TYPE = "learning.role_model_recommendation";
export const PRODUCE_RECOMMENDATION_TASK_TYPE = "produce_recommendation";

export const LEARNING_RECOMMENDATION_SKILL_MANIFEST = {
  workspaceId: PILOT_WORKSPACE,
  skillId: LEARNING_RECOMMENDATION_SKILL_ID,
  version: CITED_ROLE_MODEL_PRACTICE_VERSION,
  goalTypes: [LEARNING_ROLE_MODEL_GOAL_TYPE],
  taskTypes: [PRODUCE_RECOMMENDATION_TASK_TYPE],
  permissions: ["signal:write"],
  plane: "local",
  dataScopes: ["private"],
  riskBand: "advisory",
  evalVersion: "1.0.0",
  defaultAgents: ["learning"],
} as const;

/**
 * AGS1 real-catalog migration (TASK-007 closure) — Help Offer drafting was
 * previously staged via the generic `stageMutation` kernel passthrough
 * (resourceType `"signal"`, action `"write"`, a Human actor) — the ONE
 * `stageMutation` call site whose (action, resourceType) is NOT agent-floor-
 * protected (every other `stageMutation` call targets `action:"approve"`/
 * `"execute"` on the protected `"skill"` resourceType and is therefore
 * structurally exempt from the AGS1 gate — see pipeline.ts's
 * `PipelineDeps.skillManifests` doc comment; no manifest needed there, and
 * giving `stageMutation` itself a manifest would incorrectly gate those
 * agent-floor-protected human-approval sites too). This ONE site gets its OWN
 * dedicated Skill + manifest instead of overloading `stageMutation`.
 */
const stageHelpdeskAnswer: Skill = {
  name: "helpdesk.stageAnswer",
  async run(inputs) {
    return { proposedOutput: inputs, diff: { to: inputs } };
  },
};
const stageOutreachDraft: Skill = {
  name: "outreach.stageDraft",
  async run(inputs) {
    return { proposedOutput: inputs, diff: { to: inputs } };
  },
};
export const RELATIONSHIP_OUTREACH_GOAL_TYPE = "relationship.outreach";
export const DRAFT_OUTREACH_TASK_TYPE = "draft_outreach";
export const OUTREACH_DRAFT_SKILL_MANIFEST = {
  workspaceId: PILOT_WORKSPACE,
  skillId: "outreach.stageDraft",
  version: "1.0.0",
  goalTypes: [RELATIONSHIP_OUTREACH_GOAL_TYPE],
  taskTypes: [DRAFT_OUTREACH_TASK_TYPE],
  permissions: ["touchpoint:write"],
  plane: "local",
  dataScopes: ["public"],
  riskBand: "advisory",
  evalVersion: "1.0.0",
  defaultAgents: ["outreach"],
  childRunPolicy: "forbidden",
} as const;
export const HELPDESK_ROUTING_GOAL_TYPE = "helpdesk.routing";
export const DRAFT_HELP_OFFER_TASK_TYPE = "draft_help_offer";
export const HELPDESK_ANSWER_SKILL_MANIFEST = {
  workspaceId: PILOT_WORKSPACE,
  skillId: "helpdesk.stageAnswer",
  version: "1.0.0",
  goalTypes: [HELPDESK_ROUTING_GOAL_TYPE],
  taskTypes: [DRAFT_HELP_OFFER_TASK_TYPE],
  permissions: ["signal:write"],
  plane: "local",
  dataScopes: ["all"],
  riskBand: "advisory",
  evalVersion: "1.0.0",
  defaultAgents: ["learning"],
} as const;

/**
 * AGS1 real-catalog migration (TASK-007 closure) — DealPilot's "Source" fetch
 * was previously a synchronous, immediately-applied Human action. Migrated
 * onto the EGRESS_AGENT identity (already the cloud/egress actor every Google
 * external:fetch flow uses) — matches this platform's own plane-gate
 * philosophy ("local agents REQUEST data; a cloud agent SOURCES it",
 * authority.ts's `planeGate` doc comment) rather than a raw Human external
 * fetch. The frontend (`apps/web/src/app/data/api.ts`'s `apiDealPilotSource`)
 * already branches on `pending_review`/`applied`/`rejected` and reads
 * `output.proposedOutput` regardless of status (the Skill still RUNS and
 * returns its output before any human decides) — no frontend change was
 * needed; DealPilot's separate `dealpilot.commit` step (quarantine → human
 * "Add") is independent of ledger-approval status already, so the visible
 * feature behavior is unchanged even though the ledger row now always drafts.
 */
export const DEALPILOT_SOURCING_GOAL_TYPE = "dealpilot.sourcing";
export const SOURCE_CANDIDATES_TASK_TYPE = "source_candidates";
export const DEALPILOT_SOURCE_SKILL_MANIFEST = {
  workspaceId: PILOT_WORKSPACE,
  skillId: "dealpilot.source",
  version: "1.0.0",
  goalTypes: [DEALPILOT_SOURCING_GOAL_TYPE],
  taskTypes: [SOURCE_CANDIDATES_TASK_TYPE],
  permissions: ["external:fetch:read"],
  plane: "cloud",
  dataScopes: ["public"],
  riskBand: "advisory",
  evalVersion: "1.0.0",
  defaultAgents: ["egress"],
} as const;

/**
 * AGS1 real-catalog migration (TASK-007 closure) — the camera-capture tool
 * (`apps/web/src/app/components/tools/camera/CameraCaptures.tsx`) previously
 * called the generic `action.propose` endpoint directly from the client with
 * a raw `actor:{type:"user"}` + `skill:"stageCapture"`. Migrated behind a
 * dedicated `capture.stage` procedure (mirrors `chiefOfStaff.
 * recommendFromRoleModel`'s inline Goal/Task provisioning) so the SERVER,
 * never the client, decides the invoking Agent — a capture is modeled as
 * Learning "observing authorized evidence" (its stated mandate), reviewed
 * before becoming a committed Touchpoint, consistent with every other
 * governed Skill's draft-then-approve shape.
 */
export const RELATIONSHIP_CAPTURE_GOAL_TYPE = "relationship.capture";
export const STAGE_CAPTURE_TASK_TYPE = "stage_capture";
export const STAGE_CAPTURE_SKILL_MANIFEST = {
  workspaceId: PILOT_WORKSPACE,
  skillId: "stageCapture",
  version: "1.0.0",
  goalTypes: [RELATIONSHIP_CAPTURE_GOAL_TYPE],
  taskTypes: [STAGE_CAPTURE_TASK_TYPE],
  permissions: ["touchpoint:write", "signal:write"],
  plane: "local",
  dataScopes: ["all", "private"],
  riskBand: "advisory",
  evalVersion: "1.0.0",
  defaultAgents: ["learning"],
} as const;

/**
 * AGS1 real-catalog migration (TASK-007 closure) — the 8 `google.*` skills
 * (`@bridge/integrations-google`) were already Agent-actor-only at every call
 * site (`EGRESS_AGENT`/`INTAKE_AGENT`, never Human/Automation-direct), so
 * AGS1's core "no direct non-Agent invocation" concern was already satisfied
 * structurally — what was missing was a registered manifest + `goalTaskRef`.
 * `IntakeService`/`GoogleService`/`EgressExecutor` (`@bridge/integrations-
 * google`) gained an optional `goalTasks?: GoalTaskStore` dependency; each
 * method that proposes one of these skills provisions (find-or-create) ONE
 * durable Goal for the workspace + one bounded Task per call, assigned to
 * whichever physical identity already invokes it. Same manifest shape
 * (`permissions`/`plane`/`dataScopes`) mirrors what each call site's own
 * `pipeline.propose` request already declares.
 */
export const GOOGLE_SYNC_GOAL_TYPE = "google.sync";
export const GOOGLE_SOURCE_TASK_TYPE = "source_google_data";
export const GOOGLE_STAGE_TASK_TYPE = "stage_google_data";

function googleSkillManifest(skillId: string, taskType: string, plane: "local" | "cloud", permissions: readonly string[]): {
  workspaceId: string;
  skillId: string;
  version: string;
  goalTypes: readonly string[];
  taskTypes: readonly string[];
  permissions: readonly string[];
  plane: "local" | "cloud";
  dataScopes: readonly ("all" | "public" | "private")[];
  riskBand: "informational" | "advisory" | "transformational" | "operational" | "external";
  evalVersion: string;
  defaultAgents: readonly string[];
} {
  return {
    workspaceId: PILOT_WORKSPACE,
    skillId,
    version: "1.0.0",
    goalTypes: [GOOGLE_SYNC_GOAL_TYPE],
    taskTypes: [taskType],
    permissions,
    plane,
    dataScopes: ["public", "private", "all"],
    riskBand: "advisory",
    evalVersion: "1.0.0",
    defaultAgents: ["learning"],
  };
}

/**
 * NOTE: `SKILL_COMPOSE_EMAIL`/`SKILL_COMPOSE_EVENT`/`SKILL_COMPOSE_UPDATE_EVENT`/
 * `SKILL_COMPOSE_DELETE_EVENT` are deliberately NOT registered here — every
 * call site (`GoogleService.proposeSend`) targets `resourceType:"external:send"`,
 * which `isAgentFloorDenied` already, unconditionally denies for ANY agent
 * (agent-floor.ts) — they are structurally exempt from the AGS1 gate (see
 * pipeline.ts's `PipelineDeps.skillManifests` doc comment) and registering a
 * manifest for them would be actively wrong (it would force an Agent+Task
 * requirement onto an action no Agent could ever perform, at which point the
 * ONLY actor that could invoke it — a Human — would ALSO be rejected once a
 * manifest exists, since a governed Skill requires an Agent actor). Human-
 * initiated compose/send stays exactly as designed: a Human proposes the
 * draft, `external:send`'s hard agent-floor + `pol-external-approval` policy
 * gate the actual send.
 */
export const GOOGLE_SKILL_MANIFESTS = [
  googleSkillManifest(SKILL_SOURCE_GMAIL, GOOGLE_SOURCE_TASK_TYPE, "cloud", ["external:fetch:read"]),
  googleSkillManifest(SKILL_SOURCE_CALENDAR, GOOGLE_SOURCE_TASK_TYPE, "cloud", ["external:fetch:read"]),
  googleSkillManifest(SKILL_LIST_CALENDAR, GOOGLE_SOURCE_TASK_TYPE, "cloud", ["external:fetch:read"]),
  googleSkillManifest(SKILL_STAGE, GOOGLE_STAGE_TASK_TYPE, "local", ["touchpoint:write", "signal:write"]),
];

/**
 * The FULL registered governed Skill manifest catalog — the single source of
 * truth both `buildInMemoryPorts` (registers these synchronously into an
 * `InMemorySkillManifestRegistry`) and `buildPersistentPorts` (idempotently
 * seeds these into `skill_manifests` via `seedSkillManifests`, then
 * `refresh()`es a `DrizzleSkillManifestRegistry` from that table) resolve
 * against — one list, two durability backends, never drift between them.
 */
export const GOVERNED_SKILL_MANIFEST_CATALOG: readonly SkillManifest[] = [
  AGENT_ORCHESTRATION_SKILL_MANIFEST,
  LEARNING_RECOMMENDATION_SKILL_MANIFEST,
  HELPDESK_ANSWER_SKILL_MANIFEST,
  OUTREACH_DRAFT_SKILL_MANIFEST,
  DEALPILOT_SOURCE_SKILL_MANIFEST,
  STAGE_CAPTURE_SKILL_MANIFEST,
  ...GOOGLE_SKILL_MANIFESTS,
];

const policies: PolicyFn[] = [
  (i) =>
    i.phase === "pre" &&
    typeof i.inputs === "object" &&
    i.inputs !== null &&
    (i.inputs as { kind?: unknown }).kind === "thesis_source_discovery"
      ? {
          policyId: "pol-dealpilot-source-discovery-approval",
          phase: "pre",
          effect: "require_approval",
          reason: "Attaching discovered Sources to a Thesis requires Human review",
        }
      : null,
  (i) =>
    i.phase === "pre" &&
    typeof i.inputs === "object" &&
    i.inputs !== null &&
    (i.inputs as { kind?: unknown }).kind === "help_offer"
      ? {
          policyId: "pol-help-offer-approval",
          phase: "pre",
          effect: "require_approval",
          reason: "Help Offers remain drafts until a human approves them",
        }
      : null,
  (i) =>
    i.phase === "pre" &&
    typeof i.inputs === "object" &&
    i.inputs !== null &&
    (i.inputs as { kind?: unknown }).kind === "learning_recommendation"
      ? {
          policyId: "pol-learning-recommendation-approval",
          phase: "pre",
          effect: "require_approval",
          reason: "Learned recommendations require human approval before becoming active",
        }
      : null,
  // Sending/sharing externally always requires a human approval (governed agentic).
  (i) =>
    i.resourceType === "external:send" || i.action === "share"
      ? {
          policyId: "pol-external-approval",
          phase: "pre",
          effect: "require_approval",
          reason: "external send/share requires approval",
        }
      : null,
];

/** Seed the in-memory governance so the Google egress/intake agents are authorized. */
function seedGovernance(roles: InMemoryRoleStore, agents: InMemoryAgentStore): void {
  for (const agentId of [
    OUTREACH_AGENT,
    LEARNING_AGENT,
    INTERNAL_STRATEGIST_AGENT,
    GOVERNANCE_AGENT,
    CAPABILITY_BUILDER_AGENT,
    EGRESS_AGENT,
    INTAKE_AGENT,
  ]) {
    agents.workspaces.set(agentId, PILOT_WORKSPACE);
    agents.statuses.set(agentId, "active");
  }
  // Outreach Agent (existing pilot) — touchpoint:write + reads.
  agents.assumed.set(OUTREACH_AGENT, "role-outreach");
  agents.scope.set(OUTREACH_AGENT, ["touchpoint:write", "person:read", "initiative:read", "file:read"]);
  agents.tiers.set(OUTREACH_AGENT, "public");
  agents.skills.set(OUTREACH_AGENT, ["outreach.stageDraft"]);
  roles.roleGrants.set("role-outreach", [
    { resourceType: "touchpoint", resourceId: null, action: "write", effect: "allow" },
    { resourceType: "person", resourceId: null, action: "read", effect: "allow" },
  ]);

  agents.assumed.set(LEARNING_AGENT, "role-learning");
  agents.scope.set(LEARNING_AGENT, ["signal:write", "touchpoint:write"]);
  agents.tiers.set(LEARNING_AGENT, "all");
  agents.skills.set(LEARNING_AGENT, [
    LEARNING_RECOMMENDATION_SKILL_ID,
    "stageStrategicRecommendation",
    "helpdesk.stageAnswer",
    "stageCapture",
  ]);
  roles.roleGrants.set("role-learning", [
    { resourceType: "signal", resourceId: null, action: "write", effect: "allow" },
    { resourceType: "touchpoint", resourceId: null, action: "write", effect: "allow" },
  ]);

  // Internal Strategist (AGS0/AGS1, TASK-007) — local, analysis/synthesis only.
  // Shares "signal:write" with Learning so the SAME governed Skill
  // (stageStrategicRecommendation) can resolve for either, depending only on
  // which Agent a Task is actually assigned to (AGS1 acceptance: "same Skill
  // can be selected for two eligible Agents assigned to same Task").
  agents.assumed.set(INTERNAL_STRATEGIST_AGENT, "role-internal-strategist");
  agents.scope.set(INTERNAL_STRATEGIST_AGENT, ["signal:write"]);
  roles.roleGrants.set("role-internal-strategist", [
    { resourceType: "signal", resourceId: null, action: "write", effect: "allow" },
  ]);

  // Governance (AGS3, TASK-007) — reviews/explains/audits only; the
  // deterministic kernel (agent-floor + resolveAuthority), never this Agent's
  // own opinion, decides authority. Its capability scope is deliberately the
  // SAME narrow shape as Learning/Internal Strategist (signal:write, for
  // writing inspectable risk-assessment/audit-summary Signals) — it holds NO
  // broader scope, and agent-floor's non-removable protected-resource DENY
  // (policy/policy_param/skill/agent/role/permission/ledger/delegation) still
  // applies to it exactly as to any other agent; Governance's real authority
  // to actually enact anything routes through the separate, Human-decided
  // capability.approve/action.decide surfaces, never through this scope.
  agents.assumed.set(GOVERNANCE_AGENT, "role-governance");
  agents.scope.set(GOVERNANCE_AGENT, ["signal:write"]);
  roles.roleGrants.set("role-governance", [
    { resourceType: "signal", resourceId: null, action: "write", effect: "allow" },
  ]);

  // Capability Builder (AGS3, TASK-007) — drafts only; every output still
  // routes through the governed pipeline (draft, propose, approve, execute)
  // and this Agent can never activate its own output (capability.approve is
  // itself agent-floor-protected — see agent-floor.ts). Same minimal
  // signal:write scope for the same reason as Governance above.
  agents.assumed.set(CAPABILITY_BUILDER_AGENT, "role-capability-builder");
  agents.scope.set(CAPABILITY_BUILDER_AGENT, ["signal:write"]);
  roles.roleGrants.set("role-capability-builder", [
    { resourceType: "signal", resourceId: null, action: "write", effect: "allow" },
  ]);

  // Egress agent (cloud) — SOURCES the internet (external:fetch read).
  agents.assumed.set(EGRESS_AGENT, "role-egress");
  agents.scope.set(EGRESS_AGENT, ["external:fetch:read"]);
  agents.tiers.set(EGRESS_AGENT, "public");
  agents.skills.set(EGRESS_AGENT, [
    "dealpilot.source",
    SKILL_SOURCE_GMAIL,
    SKILL_SOURCE_CALENDAR,
    SKILL_LIST_CALENDAR,
  ]);
  roles.roleGrants.set("role-egress", [
    { resourceType: "external:fetch", resourceId: null, action: "read", effect: "allow" },
  ]);

  // Intake agent (local) — DRAFTS graph proposals.
  agents.assumed.set(INTAKE_AGENT, "role-intake");
  agents.scope.set(INTAKE_AGENT, ["touchpoint:write", "signal:write", "person:write"]);
  agents.skills.set(INTAKE_AGENT, [SKILL_STAGE]);
  roles.roleGrants.set("role-intake", [
    { resourceType: "touchpoint", resourceId: null, action: "write", effect: "allow" },
    { resourceType: "signal", resourceId: null, action: "write", effect: "allow" },
    { resourceType: "person", resourceId: null, action: "write", effect: "allow" },
  ]);

  // The signed-in user the agents act on behalf of (delegation ∩ principal authority).
  roles.direct.set(`user:${PILOT_USER}`, [
    { resourceType: "touchpoint", resourceId: null, action: "write", effect: "allow" },
    { resourceType: "person", resourceId: null, action: "write", effect: "allow" },
    { resourceType: "person", resourceId: null, action: "read", effect: "allow" },
    { resourceType: "signal", resourceId: null, action: "write", effect: "allow" },
    { resourceType: "tool", resourceId: null, action: "read", effect: "allow" },
    { resourceType: "tool", resourceId: null, action: "write", effect: "allow" },
    { resourceType: "relation", resourceId: null, action: "read", effect: "allow" },
    { resourceType: "relation", resourceId: null, action: "write", effect: "allow" },
    { resourceType: "external:fetch", resourceId: null, action: "read", effect: "allow" },
    { resourceType: "external:send", resourceId: null, action: "share", effect: "allow" },
  ]);
}

/** The governance + ledger + registry ports a mode (persistent/in-memory) selects. */
export interface ModePorts {
  roles: RoleQuery;
  agents: AgentQuery;
  ephemeral: EphemeralQuery;
  policyStore: PolicyStore;
  ledger: LedgerStore;
  relationMaterializations: DrizzleRelationMaterializationStore;
  ritualRegistry: RitualRegistry;
  toolRegistry: ToolRegistry;
  ritualRunRecorder: RitualRunRecorder;
  canonical: CanonicalIdentityStore;
  dealPilotCaptures: ToolCaptureStore;
  workspaceStore: DrizzleWorkspaceStore;
  /** Read surface for Initiative/Touchpoint/Signal — see graph-store.ts's header
   * comment (frontend-migration-scoping.md Phase 3: these had zero tRPC coverage).
   * Same `DrizzleGraphStore` class binds to either the real Postgres `db` or the
   * local pglite `localDb` — both are the same schema.ts tables. */
  graphStore: DrizzleGraphStore;
  jobpilotStore: DrizzleJobPilotStore;
  helpdeskStore: DrizzleHelpdeskStore;
  resourcesStore: DrizzleResourcesStore;
  capabilityStore: CapabilityStore;
  workspaceDefinitionStore: WorkspaceDefinitionStore;
  /** P2 capability packages (docs/raw/capability-package-format.md, ADR-018/ADR-023) —
   * package_installations-shaped rows. Real Drizzle-backed table in persistent mode
   * (ADR-023); in-memory in in-memory mode, mirroring capabilityStore's split. */
  packageStore: PackageStore;
  memoryStore: MemoryStore;
  /** AGS1 (TASK-007) — Goal/Task catalog Skills resolve against. In-memory
   * default (dev/test); `buildPersistentPorts` binds the real, restart-durable
   * `DrizzleGoalTaskStore` instead. */
  goalTasks: GoalTaskStore;
  /** AGS1 (TASK-007) — registered governed Skill manifests (`resolveSkillForTask`'s
   * candidate catalog). In-memory default; `buildPersistentPorts` binds the real
   * `DrizzleSkillManifestRegistry`, seeded via `ensureSkillManifestCatalog`. */
  skillManifests: SkillManifestRegistry;
  /** AGS2 (TASK-007) — bounded child Agent Runs a parent Agent has spawned.
   * In-memory default; `buildPersistentPorts` binds the real, restart-durable
   * `DrizzleChildAgentRunStore` instead. */
  childAgentRuns: ChildAgentRunStore;
  /** ModelProviders this mode registers (echo double in-memory; Ollama/Anthropic persistent). */
  modelProviders: ModelProvider[];
  memory?: Wiring["memory"];
  closeDb: () => Promise<void>;
  /** SEC-5 — persistent mode only. Asserts the connected Postgres role cannot
   *  bypass RLS (superuser / BYPASSRLS) in production; self-gates to a no-op
   *  outside prod. `buildWiring()` awaits this before the server serves traffic. */
  verifyRlsPosture?: () => Promise<void>;
  /**
   * TASK-007 (AGS0/AGS1/AGS3) — persistent-mode only. Idempotently provisions
   * each foundational Agent's real governance rows (role/agent/grants) before
   * the server serves traffic, mirroring `verifyRlsPosture`'s "awaited once at
   * boot" shape. In-memory mode seeds the equivalent via `seedGovernance`
   * instead — these hooks are no-ops (absent) there.
   */
  ensureInternalStrategistGovernance?: () => Promise<void>;
  ensureGovernanceAgentGovernance?: () => Promise<void>;
  ensureCapabilityBuilderGovernance?: () => Promise<void>;
  ensureRelationshipUserGovernance?: () => Promise<void>;
  /**
   * TASK-007 (AGS1) — persistent-mode only. Idempotently seeds the code-declared
   * `GOVERNED_SKILL_MANIFEST_CATALOG` into `skill_manifests`, then refreshes the
   * `DrizzleSkillManifestRegistry`'s read cache, before the server serves traffic —
   * mirrors the `ensure*Governance` hooks' "awaited once at boot" shape. In-memory
   * mode registers the identical catalog synchronously instead; this hook is a
   * no-op (absent) there.
   */
  ensureSkillManifestCatalog?: () => Promise<void>;
  /** Persistent-mode boot provisioning + verification for the attributable Learning Agent grant. */
  ensureLearningGovernance?: () => Promise<void>;
  /** Persistent-mode boot provisioning + verification for the server-owned Outreach Agent. */
  ensureOutreachGovernance?: () => Promise<void>;
  ensureEgressGovernance?: () => Promise<void>;
  ensureIntakeGovernance?: () => Promise<void>;
  ensureDealPilotPrincipalGovernance?: () => Promise<void>;
}

/**
 * Persistent mode (`DATABASE_URL` set) — binds governance/ledger/registries to
 * Drizzle/Postgres via `createDrizzlePorts`, and the canonical identity store to the
 * real `DrizzleCanonicalIdentityStore` (no more in-memory fake once persistence is
 * requested).
 *
 * Two ports CANNOT yet be made real and are kept in-memory on purpose, each with a
 * loud boot-time warning instead of a silent fallback:
 *  - the ledger residency question is still open (Phase 1 item 7 — needs a product
 *    decision on local-vs-cloud split); the ledger itself IS the real Drizzle ledger
 *    here, but which physical database it points at is whatever `DATABASE_URL` says,
 *    which may be cloud — so the historical "ledger MUST stay local" guarantee is not
 *    actually enforced. We warn rather than silently uphold a promise we don't keep.
 *  - `ToolCaptureStore` (DealPilot's quarantine store) has no persistent
 *    implementation anywhere in the codebase yet (Phase 3 item 11b) — it stays
 *    in-memory even here, and we say so loudly at boot.
 */
export function buildPersistentPorts(env: { url: string }): ModePorts {
  const { db, close } = createDb({ url: env.url });
  const ports = createDrizzlePorts(db, {
    defaultWorkspaceId: PILOT_WORKSPACE,
  });
  // TASK-007 — real, restart-durable Goal/Task/Skill-manifest/child-Run stores
  // once DATABASE_URL is set. `skillManifestRegistry`'s `refresh()` is awaited
  // inside `ensureSkillManifestCatalog` below (called once at boot, before the
  // server serves traffic), not here — constructing it here just binds the db.
  const goalTaskStore = new DrizzleGoalTaskStore(db);
  const skillManifestRegistry = new DrizzleSkillManifestRegistry(db);
  const childAgentRunStore = new DrizzleChildAgentRunStore(db);

  console.warn(
    "[wiring] DATABASE_URL is set, but the ledger residency guarantee (\"ledger MUST " +
      "stay local\") is NOT enforced: the ledger is bound to whatever DATABASE_URL " +
      "points at, which may be a cloud Supabase instance. Private-proposal ledger rows " +
      "(Gmail/Calendar-derived diffs) can therefore reach cloud canonical. This is a " +
      "known open gap (All fixes.md Phase 1 item 7) awaiting a product decision " +
      "(split-by-data_scope vs. drop the guarantee) — not silently upheld.",
  );
  console.warn(
    "[wiring] DATABASE_URL is set, but DealPilot's ToolCaptureStore has NO persistent " +
      "implementation yet (All fixes.md Phase 3 item 11b) — quarantined-but-uncommitted " +
      "captures remain in-memory and are LOST on restart despite persistent mode being " +
      "requested. This is an explicit, logged gap, not a silent one.",
  );

  return {
    roles: ports.roles,
    agents: ports.agents,
    ephemeral: ports.ephemeral,
    policyStore: ports.policies,
    ledger: ports.ledger,
    relationMaterializations: ports.relationMaterializations,
    ritualRegistry: ports.ritualRegistry,
    toolRegistry: ports.toolRegistry,
    ritualRunRecorder: ports.ritualRunRecorder,
    // The one genuinely-fixed lie: canonical identity now really persists to Postgres
    // instead of an in-memory fake, once DATABASE_URL is set.
    canonical: new DrizzleCanonicalIdentityStore(db),
    dealPilotCaptures: createInMemoryCaptureStore(),
    workspaceStore: ports.workspaceStore,
    graphStore: new DrizzleGraphStore(db),
    jobpilotStore: new DrizzleJobPilotStore(db),
    helpdeskStore: new DrizzleHelpdeskStore(db),
    resourcesStore: new DrizzleResourcesStore(db),
    capabilityStore: new DrizzleCapabilityStore(db),
    workspaceDefinitionStore: new DrizzleWorkspaceDefinitionStore(db),
    // P2 packages: real Drizzle-backed store in persistent mode (ADR-023) — no
    // longer in-memory-only once DATABASE_URL is set.
    packageStore: new DrizzlePackageStore(db),
    memoryStore: new DrizzleMemoryStore(db),
    // TASK-007 — real, restart-durable bindings (see the field's doc comment
    // on ModePorts for why these are no longer in-memory once DATABASE_URL is set).
    goalTasks: goalTaskStore,
    skillManifests: skillManifestRegistry,
    childAgentRuns: childAgentRunStore,
    // Real providers in persistent mode: Ollama is always registered (local plane,
    // dev-default per CLAUDE.md); Anthropic/Groq only when their keys are configured —
    // no fake fallback, same fail-closed posture as the Google gateway.
    modelProviders: [
      new OllamaProvider(),
      ...(process.env.ANTHROPIC_API_KEY ? [new AnthropicProvider()] : []),
      ...(process.env.GROQ_API_KEY ? [new GroqProvider()] : []),
    ],
    closeDb: close,
    verifyRlsPosture: () => assertRlsPosture(db, { env: process.env }),
    ensureEgressGovernance: () =>
      ensureEgressAgentGovernance(db, {
        workspaceId: PILOT_WORKSPACE,
        userId: PILOT_USER,
        agentId: EGRESS_AGENT,
        roleId: EGRESS_ROLE,
        permissionId: EGRESS_PRINCIPAL_PERMISSION,
      }),
    ensureIntakeGovernance: () =>
      ensureIntakeAgentGovernance(db, {
        workspaceId: PILOT_WORKSPACE,
        userId: PILOT_USER,
        agentId: INTAKE_AGENT,
        roleId: INTAKE_ROLE,
        permissionId: INTAKE_PRINCIPAL_PERMISSION,
      }),
    ensureDealPilotPrincipalGovernance: () =>
      ensureDealPilotPrincipalGovernance(db, {
        workspaceId: PILOT_WORKSPACE,
        userId: PILOT_USER,
      }),
    ensureInternalStrategistGovernance: () =>
      ensureInternalStrategistGovernance(db, {
        workspaceId: PILOT_WORKSPACE,
        userId: PILOT_USER,
        agentId: INTERNAL_STRATEGIST_AGENT,
        roleId: INTERNAL_STRATEGIST_ROLE,
        permissionId: INTERNAL_STRATEGIST_SIGNAL_PERMISSION,
      }),
    ensureGovernanceAgentGovernance: () =>
      ensureGovernanceAgentGovernance(db, {
        workspaceId: PILOT_WORKSPACE,
        userId: PILOT_USER,
        agentId: GOVERNANCE_AGENT,
        roleId: GOVERNANCE_ROLE,
        permissionId: GOVERNANCE_SIGNAL_PERMISSION,
      }),
    ensureCapabilityBuilderGovernance: () =>
      ensureCapabilityBuilderGovernance(db, {
        workspaceId: PILOT_WORKSPACE,
        userId: PILOT_USER,
        agentId: CAPABILITY_BUILDER_AGENT,
        roleId: CAPABILITY_BUILDER_ROLE,
        permissionId: CAPABILITY_BUILDER_SIGNAL_PERMISSION,
      }),
    ensureRelationshipUserGovernance: () =>
      ensureRelationshipUserGovernance(db, {
        workspaceId: PILOT_WORKSPACE,
        userId: PILOT_USER,
      }),
    ensureSkillManifestCatalog: async () => {
      await seedSkillManifests(db, GOVERNED_SKILL_MANIFEST_CATALOG);
      await skillManifestRegistry.refresh();
    },
    ensureLearningGovernance: () =>
      ensureLearningAgentGovernance(db, {
        workspaceId: PILOT_WORKSPACE,
        userId: PILOT_USER,
        agentId: LEARNING_AGENT,
        roleId: LEARNING_ROLE,
        permissionId: LEARNING_SIGNAL_PERMISSION,
      }),
    ensureOutreachGovernance: () =>
      ensureOutreachAgentGovernance(db, {
        workspaceId: PILOT_WORKSPACE,
        userId: PILOT_USER,
        agentId: OUTREACH_AGENT,
        roleId: OUTREACH_ROLE,
        permissionId: OUTREACH_TOUCHPOINT_PERMISSION,
      }),
  };
}

/**
 * In-memory mode (`DATABASE_URL` unset) — zero-infra dev/test default. Seeds
 * governance so the Google egress/intake agents are authorized, and binds workspace
 * CRUD to the LOCAL pglite plane (same pattern as
 * apps/api/src/social/integration-service.ts) since workspace/team rows are real
 * relational data, not governance config with an in-memory port.
 */
export async function buildInMemoryPorts(env: { localDir: string | undefined }): Promise<ModePorts> {
  const mRoles = new InMemoryRoleStore();
  const mAgents = new InMemoryAgentStore();
  const mEphemeral = new InMemoryEphemeralStore();
  seedGovernance(mRoles, mAgents);

  const { db: localDb, close: closeLocalDb } = await createLocalDb(
    env.localDir ? { dataDir: env.localDir } : {},
  );
  const graphStore = new DrizzleGraphStore(localDb);
  const relationDecisionSequenceFloor =
    await graphStore.getMaxRelationDecisionSequence();
  const ledger: LedgerStore = env.localDir
    ? new DrizzleLedgerStore(localDb, {
        defaultWorkspaceId: PILOT_WORKSPACE,
      })
    : new InMemoryLedger(relationDecisionSequenceFloor);
  if (ledger instanceof DrizzleLedgerStore) {
    await ledger.ensureAppendSequenceFloor(relationDecisionSequenceFloor);
  }

  return {
    roles: mRoles,
    agents: mAgents,
    ephemeral: mEphemeral,
    policyStore: new InMemoryPolicyStore(policies),
    ledger,
    relationMaterializations: new DrizzleRelationMaterializationStore(localDb),
    // Registries start EMPTY — no demo rituals/tools. Real workflows are created via
    // ritual.create (validated ritual ⊆ agent) and persist here for the session.
    ritualRegistry: new InMemoryRitualRegistry(),
    toolRegistry: new InMemoryToolRegistry(),
    ritualRunRecorder: new InMemoryRitualRunRecorder(),
    canonical: new InMemoryCanonicalIdentityStore(),
    dealPilotCaptures: createInMemoryCaptureStore(),
    workspaceStore: new DrizzleWorkspaceStore(localDb),
    graphStore,
    jobpilotStore: new DrizzleJobPilotStore(localDb),
    helpdeskStore: new DrizzleHelpdeskStore(localDb),
    resourcesStore: new DrizzleResourcesStore(localDb),
    capabilityStore: new DrizzleCapabilityStore(localDb),
    workspaceDefinitionStore: new DrizzleWorkspaceDefinitionStore(localDb),
    // In-memory mode keeps packages in-memory (no persistent backing store needed
    // for zero-infra dev/test) — persistent mode uses the real DrizzlePackageStore.
    packageStore: new InMemoryPackageStore(),
    memoryStore: new DrizzleMemoryStore(localDb),
    // TASK-007 — dependency-free in-memory default (dev/test). The SAME
    // GOVERNED_SKILL_MANIFEST_CATALOG code-declared list `buildPersistentPorts`
    // seeds into `skill_manifests` is registered here synchronously — one
    // source of truth for what's governed, two durability backends.
    goalTasks: new InMemoryGoalTaskStore(),
    skillManifests: (() => {
      const registry = new InMemorySkillManifestRegistry();
      for (const m of GOVERNED_SKILL_MANIFEST_CATALOG) registry.register(m);
      return registry;
    })(),
    childAgentRuns: new InMemoryChildAgentRunStore(),
    // Echo double (local plane) — zero-infra mode makes no network calls, model
    // calls included; anything needing a real model runs in persistent mode.
    modelProviders: [new EchoModelProvider()],
    memory: { roles: mRoles, agents: mAgents, ephemeral: mEphemeral },
    closeDb: closeLocalDb,
  };
}

export async function buildWiring(
  options: { moduleFilesBridgeRoot?: string } = {},
): Promise<Wiring> {
  const events = new InMemoryEventBus();
  const skillRegistry = new InMemorySkillRegistry()
    .register(stageMutation)
    .register(stageCapture)
    .register(stageLearningRecommendation)
    .register(stageStrategicRecommendation)
    .register(stageHelpdeskAnswer)
    .register(stageOutreachDraft);
  const variance = new RecordingVarianceAdjuster();

  const url = process.env.DATABASE_URL;
  const moduleFilesBridgeRoot =
    options.moduleFilesBridgeRoot
    ?? process.env.BRIDGE_FILES_ROOT
    ?? defaultBridgeFilesRoot();

  // LOCAL plane — pglite (file-backed if BRIDGE_LOCAL_DIR set, else in-memory).
  const localDir = process.env.BRIDGE_LOCAL_DIR;
  const localPlane: LocalPlane = localDir
    ? await createPgliteLocalPlane({ dataDir: localDir })
    : await createPgliteLocalPlane();

  // Google egress adapter: real googleapis when configured. NO fake fallback — the
  // platform sources only real data; if unconfigured, Google calls fail closed.
  const googleOAuth = oauthConfigFromEnv();
  const gateways: GoogleGatewayFactory = googleOAuth
    ? new GoogleApiGatewayFactory(googleOAuth, localPlane.secrets)
    : new MissingGoogleGatewayFactory();
  const googleGatewayKind: "google" | "unconfigured" = googleOAuth ? "google" : "unconfigured";

  // Register the Google skills (source/stage/compose) into the pipeline registry.
  for (const s of googleSkills({ gateways, bodies: localPlane.bodies })) skillRegistry.register(s);

  // Mode ports: one fully-typed object per mode, no let-sprawl reassignment.
  const modePorts: ModePorts = url
    ? buildPersistentPorts({ url })
    : await buildInMemoryPorts({ localDir });
  // SEC-5 boot guard: in persistent (prod) mode, refuse to serve if the DB role can
  // bypass RLS. No-op in in-memory mode and outside production (guard self-gates).
  await modePorts.verifyRlsPosture?.();
  const {
    roles,
    agents,
    ephemeral,
    policyStore,
    ledger,
    relationMaterializations,
    ritualRegistry,
    toolRegistry,
    ritualRunRecorder,
    canonical,
    dealPilotCaptures,
    workspaceStore,
    graphStore,
    jobpilotStore,
    helpdeskStore,
    resourcesStore,
    capabilityStore,
    workspaceDefinitionStore,
    packageStore,
    memoryStore,
    goalTasks,
    skillManifests,
    childAgentRuns,
    modelProviders,
    memory,
    closeDb,
  } = modePorts;
  // Kernel policies are deployment-invariant safety rules. Persistent mode also
  // evaluates workspace policies from Postgres; it must not replace these rules.
  const staticPolicyStore = new InMemoryPolicyStore(policies);
  const effectivePolicyStore: PolicyStore = url
    ? {
        async evaluate(input) {
          const [staticResults, persistedResults] = await Promise.all([
            staticPolicyStore.evaluate(input),
            policyStore.evaluate(input),
          ]);
          return [...staticResults, ...persistedResults];
        },
      }
    : policyStore;

  // ModelProvider registry/router — resolves tool-kit modelBindings honoring
  // planeDefault (local-default bindings NEVER fall through to a cloud provider).
  const models = createModelRouter(modelProviders);

  // Capability Trust Model support ports (docs/wiki/vision.md): budgets + kill
  // switch stay in-memory in BOTH modes for now — no persistent implementation
  // exists yet anywhere in the codebase, mirroring how ToolCaptureStore is kept
  // in-memory even in persistent mode (see buildPersistentPorts's loud warning
  // pattern above) rather than silently faking durability that doesn't exist.
  const capabilityBudgets = new InMemoryAutoActivationBudgetStore();
  const capabilityKillSwitch = new InMemoryKillSwitch();
  const credentialBroker = new InMemoryCredentialBroker();
  // Onboarding personalization profile (ADR-033/R-030) — in-memory in both
  // modes for now, same honest-gap pattern as capabilityBudgets above: no
  // persistent implementation exists yet, this is the onboarding-scoped slice
  // of the still-absent general Memory/Knowledge kernel primitive.
  const onboardingProfileStore = new InMemoryOnboardingProfileStore();
  // P2 capability packages — now backed by DrizzlePackageStore in persistent mode
  // (ADR-023); `packageStore` comes from modePorts (see above), same split every
  // other per-mode port already follows.

  // DealPilot: the first tool wired through the generic manifest intake seam
  // (@bridge/tool-kit createToolSourceSkill/ToolIntakeMaterializer) — sourcing quarantines
  // through the pipeline as `external:fetch`; commit is a separate human "Add" (capture ≠
  // commit, same pattern as Camera). BusinessBroker.net has no live connector yet (its
  // robots.txt blocks the paths a fetcher needs — see docs/wiki/known-issues.md), so only
  // BizBuySell is registered.
  const dealPilotFacts: FactStore = createFactStore();
  const dealPilotStore = new InMemoryDealPilotStore();
  const dealPilotCredentialVault = new InMemorySourceCredentialVault();
  const dealPilotCredentialAudit = new InMemoryCredentialAuditSink();
  const dealPilotCredentials = new SourceCredentialService(
    dealPilotCredentialVault,
    new HumanReauthentication(),
    dealPilotCredentialAudit,
  );
  if (url) {
    console.warn(
      "DealPilot DP0 prototype: Records and Source credential-vault references are process-local until the approved Local Plane persistence/keychain adapters land; restart discards them.",
    );
  }
  const dealPilotCaptureSources = new Map<string, string>();
  const dealPilotCommittedCaptureIds = new Set<string>();
  const dealPilotCommittingCaptureIds = new Set<string>();
  const dealPilotCandidateIds: string[] = [];
  const dealPilotBindings: DealPilotBindings = {
    relationshipAuthorized: false,
    tasksAuthorized: true,
  };
  const dealPilotIntegrationId = `${PILOT_WORKSPACE}:google`;
  const dealPilotSourceConnector = createBizBuySellAlertConnector(
    createGmailFetchMessages(gateways, dealPilotIntegrationId),
  );
  const dealPilotDiscoveryLocks = new Map<string, Promise<SkillOutput>>();
  skillRegistry.register({
    name: "dealpilot.source",
    async run(inputs, ctx) {
      const request = inputs as { workspaceId?: unknown; sourceId?: unknown };
      if (typeof request.workspaceId !== "string" || typeof request.sourceId !== "string") {
        throw new Error("DealPilot Source discovery requires workspaceId and sourceId");
      }
      const lockKey = `${request.workspaceId}:${request.sourceId}`;
      const active = dealPilotDiscoveryLocks.get(lockKey);
      if (active) return active;
      const operation = (async (): Promise<SkillOutput> => {
        const source = await dealPilotStore.get("source", request.workspaceId as string, request.sourceId as string);
        if (!source || source.kind !== "source") throw new Error("DealPilot Source Record not found");
        const discoveryStartedAt = ctx.clock.nowISO();
        const baseQuery = {
          kind: "company" as const,
          hints: {
            sourceId: source.id,
            ...(source.lastCheckedAt ? { after: source.lastCheckedAt } : {}),
          },
        };
        const estimate = dealPilotSourceConnector.estimateCost(baseQuery);
        assertSourceDiscoveryAllowed(source, estimate);
        const hostname = new URL(source.link).hostname.toLowerCase();
        if (
          source.connectionType !== "email_alert" ||
          (hostname !== "bizbuysell.com" && !hostname.endsWith(".bizbuysell.com"))
        ) {
          throw new Error("This prototype supports Deal discovery only for an authorized BizBuySell email-alert Source");
        }
        const remaining = source.spendCap - source.spendToDate;
        const maxResults = Math.max(1, Math.floor(remaining / estimate));
        const query = {
          kind: "company" as const,
          hints: {
            sourceId: source.id,
            maxResults: String(maxResults),
            scanStartedAt: discoveryStartedAt,
            ...(source.lastCheckedAt ? { after: source.lastCheckedAt } : {}),
          },
        };
        let batch;
        try {
          batch = await dealPilotSourceConnector.fetchWithSummary(query);
        } catch (error) {
          await dealPilotStore.updateSource(source.id, source.workspaceId, { health: "degraded" });
          throw error;
        }

        try {
          const actualSpend = batch.summary.attempted * estimate;
          if (actualSpend > remaining) {
            await dealPilotStore.updateSource(source.id, source.workspaceId, { health: "paused" });
            throw new Error("Source connector exceeded its bounded fetch budget");
          }
          let droppedForBudget = 0;
          const captureIds: string[] = [];
          const sample: Record<string, unknown>[] = [];
          let capturedSpend = 0;
          for (const envelope of batch.envelopes) {
            if (capturedSpend + envelope.costUnits > actualSpend) {
              droppedForBudget += 1;
              continue;
            }
            capturedSpend += envelope.costUnits;
            const captureId = ctx.ids.next();
            await dealPilotCaptures.put({
              ...envelope,
              captureId,
              toolId: "dealpilot",
              trustOrigin: envelope.trustOrigin ?? "untrusted_external",
            });
            dealPilotCaptureSources.set(captureId, source.id);
            captureIds.push(captureId);
            if (sample.length < 3) sample.push(envelope.payload);
          }
          await dealPilotStore.updateSource(source.id, source.workspaceId, {
            ...(batch.summary.complete
              ? { lastCheckedAt: batch.summary.checkpointAt ?? discoveryStartedAt }
              : {}),
            spendToDate: source.spendToDate + actualSpend,
            health:
              droppedForBudget > 0
                ? "paused"
                : batch.summary.complete
                  ? "ready"
                  : "degraded",
          });
          dealPilotSourceConnector.acknowledge(query);
          return {
            proposedOutput: {
              toolId: "dealpilot",
              count: captureIds.length,
              captureIds,
              sample,
              attempted: batch.summary.attempted,
              parsed: batch.summary.parsed,
              scanComplete: batch.summary.complete,
              droppedForBudget,
              spend: {
                estimated: estimate,
                actual: actualSpend,
                cap: source.spendCap,
                exceeded: false,
              },
            },
            diff: { quarantined: captureIds.length, droppedForBudget },
          };
        } catch (error) {
          dealPilotSourceConnector.discard(query);
          throw error;
        }
      })();
      dealPilotDiscoveryLocks.set(lockKey, operation);
      try {
        return await operation;
      } finally {
        if (dealPilotDiscoveryLocks.get(lockKey) === operation) {
          dealPilotDiscoveryLocks.delete(lockKey);
        }
      }
    },
  });
  let dealPilotCommitQueue = Promise.resolve();
  const dealPilotMaterializer = new ToolIntakeMaterializer({
    captures: dealPilotCaptures,
    commit: async (capture) => {
      const waitForPriorCommit = dealPilotCommitQueue;
      let releaseNextCommit: () => void = () => {};
      dealPilotCommitQueue = new Promise<void>((resolve) => {
        releaseNextCommit = resolve;
      });
      await waitForPriorCommit;
      try {
      // Dedupe-on-commit: reuse `@bridge/company-sourcing`'s matchCompany (same helper
      // `processDealCandidate` uses) so two captures of the same company merge into one
      // candidate instead of piling up duplicate rows. A "strong" match merges facts into
      // the existing candidate; anything weaker commits as its own new candidate.
      const existingRecords: DealPilotRecord[] = [];
      let recordOffset = 0;
      while (true) {
        const page = await dealPilotStore.list("deals", PILOT_WORKSPACE, {
          limit: 200,
          offset: recordOffset,
        });
        existingRecords.push(...page.items);
        if (!page.hasMore || page.items.length === 0) break;
        recordOffset += page.items.length;
      }
      const existingDealPilotCandidates: DedupeCandidate[] = existingRecords
        .filter((record) => record.kind === "deal")
        .map((record) => {
          const profile = dealPilotFacts.livingProfile(record.id);
          const domain = profile.domain?.value;
          const industry = profile.industry?.value;
          return {
            id: record.id,
            name: record.company,
            ...(typeof domain === "string" ? { domain } : {}),
            ...(typeof industry === "string" ? { industry } : {}),
          };
        });
      const captureDomain = capture.payload.domain;
      const captureIndustry = capture.payload.industry;
      const candidateForMatch: DedupeCandidate = {
        id: capture.captureId,
        name: String(capture.payload.name ?? capture.captureId),
        ...(typeof captureDomain === "string" ? { domain: captureDomain } : {}),
        ...(typeof captureIndustry === "string" ? { industry: captureIndustry } : {}),
      };
      const match = matchCompany(candidateForMatch, existingDealPilotCandidates);
      const candidateId = match.tier === "strong" ? match.targetId : capture.captureId;

      for (const [field, value] of Object.entries(capture.payload)) {
        dealPilotFacts.append({ entityId: candidateId, field, value, provenance: "listing", confidence: capture.confidence });
      }
      if (candidateId === capture.captureId) {
        await dealPilotStore.createDeal({
          id: candidateId,
          workspaceId: PILOT_WORKSPACE,
          company: String(capture.payload.name ?? candidateId),
          ...(typeof capture.payload.revenue === "number" ? { revenue: capture.payload.revenue } : {}),
          ...(typeof capture.payload.sde === "number" ? { sde: capture.payload.sde } : {}),
          ...(typeof capture.payload.askPrice === "number" ? { askingPrice: capture.payload.askPrice } : {}),
        });
        dealPilotCandidateIds.push(candidateId);
      } else {
        await dealPilotStore.updateDeal(candidateId, PILOT_WORKSPACE, {
          company: String(capture.payload.name ?? candidateId),
          ...(typeof capture.payload.revenue === "number" ? { revenue: capture.payload.revenue } : {}),
          ...(typeof capture.payload.sde === "number" ? { sde: capture.payload.sde } : {}),
          ...(typeof capture.payload.askPrice === "number" ? { askingPrice: capture.payload.askPrice } : {}),
        });
      }
      const sourceId = dealPilotCaptureSources.get(capture.captureId);
      if (sourceId) {
        await dealPilotStore.link({
          workspaceId: PILOT_WORKSPACE,
          kind: "deal_source",
          fromId: candidateId,
          toId: sourceId,
          confidence: capture.confidence,
          provenance: capture.sourceToolId,
          evidenceRefs: [capture.captureId],
        });
        const sourceRelations = await dealPilotStore.relations(PILOT_WORKSPACE, sourceId);
        for (const relation of sourceRelations.filter((row) => row.kind === "source_thesis")) {
          await dealPilotStore.link({
            workspaceId: PILOT_WORKSPACE,
            kind: "deal_thesis",
            fromId: candidateId,
            toId: relation.toId,
            confidence: Math.min(capture.confidence, relation.confidence),
            provenance: `source:${sourceId}`,
            evidenceRefs: [capture.captureId, relation.id],
          });
        }
      }
      dealPilotCommittedCaptureIds.add(capture.captureId);
      } finally {
        releaseNextCommit();
      }
    },
  });

  // Idempotent bootstrap: the pilot workspace/user are structural constants (not
  // migration seed data), but real DB writes FK-reference `workspaces.id`/`users.id`
  // (e.g. `integration.connect` → `integrations.workspace_id`, `workspace.create` →
  // `workspace_members.user_id`). Without this, any such write against a real/
  // persistent DB throws a raw Postgres FK violation (23503) the first time it runs,
  // because nothing ever inserts these rows. Safe to call every boot (no-op if present).
  await workspaceStore.bootstrapPilotIdentities({
    workspaceId: PILOT_WORKSPACE,
    userId: PILOT_USER,
    userEmail: process.env.BRIDGE_PILOT_USER_EMAIL ?? "pilot@bridge.local",
  });
  await migrateLegacyPilotOrganization(workspaceStore, moduleFilesBridgeRoot);
  // Persistent governance rows reference the pilot workspace and owner, so
  // provision them only after those identities exist.
  await modePorts.ensureLearningGovernance?.();
  await modePorts.ensureOutreachGovernance?.();
  await modePorts.ensureInternalStrategistGovernance?.();
  await modePorts.ensureGovernanceAgentGovernance?.();
  await modePorts.ensureCapabilityBuilderGovernance?.();
  await modePorts.ensureRelationshipUserGovernance?.();
  await modePorts.ensureEgressGovernance?.();
  await modePorts.ensureIntakeGovernance?.();
  await modePorts.ensureDealPilotPrincipalGovernance?.();
  // Refresh the persistent manifest registry before constructing the pipeline.
  // In-memory mode registers the same catalog synchronously in its port factory.
  await modePorts.ensureSkillManifestCatalog?.();

  // Helpdesk is now a nested Relationship sub-module. Preserve historical
  // installation rows and data, but remove the retired standalone Module from
  // installed navigation before seeding the replacement.
  await retireSupersededBuiltIns(packageStore, PILOT_WORKSPACE);

  // Seed built-in workspace-definition packages as available+installed.
  // Idempotent: checks existing rows before inserting so a restart doesn't duplicate.
  const existing = await packageStore.list(PILOT_WORKSPACE, { limit: 100, offset: 0 });
  for (const pkg of BUILT_IN_PACKAGES) {
    const versions = existing.items.filter((row) => row.packageName === pkg.manifest.name);
    const current = versions.find((row) => row.packageVersion === pkg.manifest.version);
    if (!current) {
      for (const previous of versions.filter((row) => row.state === "available")) {
        await packageStore.setState(previous.id, "legacy");
      }
      await packageStore.create({
        workspaceId: PILOT_WORKSPACE,
        packageName: pkg.manifest.name,
        packageVersion: pkg.manifest.version,
        manifest: pkg.manifest,
        computedRisk: pkg.computedRisk,
        state: "available",
        status: "installed",
        lineageManifestId: null,
      });
    }
  }

  // Signed Module manifests opt individual Automations into the executable
  // runtime with a stable Ritual id. Inventory-only rows remain non-clickable.
  for (const pkg of BUILT_IN_PACKAGES) {
    const moduleAgents = new Map((pkg.manifest.module?.agents ?? []).map((agent) => [agent.id, agent]));
    for (const automation of pkg.manifest.module?.automations ?? []) {
      if (!automation.ritualId) continue;
      const capability = pkg.manifest.capabilities.find((item) => item.id === automation.capabilityId);
      const permission = capability?.permissions[0];
      const agent = moduleAgents.get(automation.agentId);
      const ritualId = resolveModuleRitualRuntimeId(pkg.manifest.name, automation.ritualId);
      const agentId = resolveModuleAgentRuntimeId(pkg.manifest.name, automation.agentId);
      if (!permission || !agent || !ritualId || !agentId) continue;
      if (!agent.plane) throw new Error(`Module Automation ${automation.id} has no owning Agent Plane`);
      const manifest = skillManifests.forSkill(PILOT_WORKSPACE, automation.procedure)[0];
      let goalTaskRef: { goalId: string; taskId: string } | undefined;
      if (manifest) {
        const goalType = manifest.goalTypes[0];
        const taskType = manifest.taskTypes[0];
        if (!goalType || !taskType) {
          throw new Error(`Governed Automation ${automation.id} has an incomplete Skill manifest`);
        }
        const seam = { nextId: () => uuidv7(), nowISO: () => new Date().toISOString() };
        const goal =
          (await goalTasks.listGoals(PILOT_WORKSPACE)).find((row) => row.type === goalType) ??
          (await goalTasks.createGoal(
            {
              workspaceId: PILOT_WORKSPACE,
              type: goalType,
              title: `${automation.name} outcome`,
            },
            seam,
          ));
        const task =
          (await goalTasks.listTasksByGoal(PILOT_WORKSPACE, goal.id)).find(
            (row) =>
              row.type === taskType &&
              row.assignedAgentId === agentId &&
              row.status !== "cancelled",
          ) ??
          (await goalTasks.createTask(
            {
              workspaceId: PILOT_WORKSPACE,
              goalId: goal.id,
              type: taskType,
              assignedAgentId: agentId,
            },
            seam,
          ));
        goalTaskRef = { goalId: goal.id, taskId: task.id };
      }
      await ritualRegistry.save({
        id: ritualId,
        name: automation.name,
        workspaceId: PILOT_WORKSPACE,
        agentId,
        agentPlane: agent.plane,
        steps: [{
          skill: automation.procedure,
          action: permission.action as Action,
          resourceType: permission.resourceType as ResourceType,
          dataScope: permission.dataScope,
          ...(goalTaskRef ? { goalTaskRef } : {}),
        }],
      });
    }
  }

  // LOCAL-plane media store (the priority track). bytea blobs live here, never cloud.
  // LOCAL_MEDIA_DIR set => persistent pglite on disk; unset => in-memory (zero-infra).
  const localMediaDir = process.env.LOCAL_MEDIA_DIR;
  const localMedia: LocalMediaStore = localMediaDir
    ? await createLocalMediaStore(localMediaDir)
    : new InMemoryMediaStore();

  const pipeline = new UniversalActionPipeline({
    authority: { roles, agents, ephemeral, nowISO: "" },
    policies: effectivePolicyStore,
    skills: skillRegistry,
    ledger,
    events,
    variance,
    skillManifests,
    goalTasks,
  });

  // Google integration surface.
  const intake = new IntakeService({ pipeline, bodies: localPlane.bodies, graph: localPlane.graph, goalTasks });
  const materializer = new IntakeMaterializer({ graph: localPlane.graph, canonical });
  const egress = new EgressExecutor({ ledger, gateways, graph: localPlane.graph });
  const selfEmails = (process.env.BRIDGE_SELF_EMAILS ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const google = new GoogleService({
    pipeline,
    intake,
    materializer,
    egress,
    secrets: localPlane.secrets,
    identities: { workspaceId: PILOT_WORKSPACE, egressAgentId: EGRESS_AGENT, intakeAgentId: INTAKE_AGENT, userId: PILOT_USER },
    selfEmails,
    goalTasks,
  });

  // EVAL-3 + VAR-1 substrate — in-memory both modes (no Drizzle binding yet).
  const evalStore = new InMemoryEvalStore();
  const policyParams = new InMemoryPolicyParamStore();

  // Universal Commons client — binds CommonsRegistry port to the local Commons
  // service (COMMONS_URL env, default http://localhost:4780). loopback HTTP is
  // permitted by assertCommonsUrlTls; a remote plaintext URL is rejected.
  // Signature verification fails closed unless the publisher key is explicitly
  // pinned. The service may not be running in dev; tRPC procedures handle fetch
  // errors gracefully.
  const commonsRegistry: CommonsRegistry = new HttpCommonsClient(commonsUrlFromEnv(), {
    trustedPublicKeys: trustedCommonsPublicKeysFromEnv(),
    ...(process.env.COMMONS_PUBLISH_TOKEN ? { publishToken: process.env.COMMONS_PUBLISH_TOKEN } : {}),
  });

  return {
    pipeline,
    localMedia,
    ritualExecutor: new InProcessRitualExecutor(pipeline, {
      registry: ritualRegistry,
      toolRegistry,
      recorder: ritualRunRecorder,
    }),
    roles,
    agents,
    ephemeral,
    policies: effectivePolicyStore,
    ledger,
    relationMaterializations,
    events,
    persistent: Boolean(url),
    moduleFilesBridgeRoot,
    localPlane,
    google,
    googleOAuth,
    googleGatewayKind,
    googleManifest: GOOGLE_MANIFEST,
    pilotUserId: PILOT_USER,
    dealpilot: {
      captures: dealPilotCaptures,
      facts: dealPilotFacts,
      materializer: dealPilotMaterializer,
      integrationId: dealPilotIntegrationId,
      store: dealPilotStore,
      candidateIds: dealPilotCandidateIds,
      credentials: dealPilotCredentials,
      credentialVault: dealPilotCredentialVault,
      credentialAudit: dealPilotCredentialAudit,
      captureSources: dealPilotCaptureSources,
      committedCaptureIds: dealPilotCommittedCaptureIds,
      committingCaptureIds: dealPilotCommittingCaptureIds,
      bindings: dealPilotBindings,
    },
    ritualRegistry,
    workspaceStore,
    graphStore,
    jobpilotStore,
    helpdeskStore,
    resourcesStore,
    capabilityStore,
    workspaceDefinitionStore,
    packageStore,
    capabilityBudgets,
    capabilityKillSwitch,
    credentialBroker,
    commonsRegistry,
    onboardingProfileStore,
    goalTasks,
    skillManifests,
    childAgentRuns,
    memoryStore,
    evalStore,
    policyParams,
    models,
    ...(memory ? { memory } : {}),
    close: async () => {
      await localPlane.close();
      await closeDb();
    },
  };
}
