/**
 * Composition root — assembles the Universal Action Pipeline + the Google
 * integration from ports.
 *
 * Governance: in-memory adapters by default (zero infra); Drizzle/Supabase when
 * DATABASE_URL is set — via the two typed factories below, `buildPersistentPorts()`
 * and `buildInMemoryPorts()`. Each returns one fully-typed `ModePorts` object; there
 * is no conditional reassignment of individual ports.
 *
 * Ledger residency: private/all/unscoped roots and their decision descendants stay
 * in the Local Plane. Only explicitly public roots are written to cloud Postgres.
 *
 * Canonical identity store: this one IS genuinely fixed here.
 * `DrizzleCanonicalIdentityStore` already exists (@bridge/db) and is now wired in
 * persistent mode instead of the in-memory fake — no more silent lie there.
 *
 * LOCAL plane: pglite (@bridge/local) — OAuth tokens + raw bodies + derived
 * Events/Memories/Signals persist here, never Supabase. The residency fix.
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
  InMemoryAutomationRegistry,
  InMemoryAutomationRunRecorder,
  InMemoryMediaStore,
  InMemorySkillRegistry,
  InProcessAutomationExecutor,
  RecordingVarianceAdjuster,
  UniversalActionPipeline,
  digestSignals,
  KERNEL_PASSTHROUGH_SKILL,
  stageCapture,
  InMemoryCapabilityStore,
  InMemoryAutoActivationBudgetStore,
  InMemoryKillSwitch,
  InMemoryCredentialBroker,
  InMemoryOrganizationDefinitionStore,
  InMemoryModuleStore,
  InMemoryOnboardingProfileStore,
  MemoryBackedOnboardingProfileStore,
  type MemoryStore,
  type SkillRegistry,
  type TextEmbedder,
  type VectorIndex,
  type MemoryAuthScope,
  type MemoryEntry,
  InMemoryGoalTaskStore,
  InMemoryTaskManagerStore,
  InMemorySkillManifestRegistry,
  InMemoryChildAgentRunStore,
  InMemoryResearchRunStore,
  InMemoryChatStore,
  InMemoryTaintAuditStore,
  PlaneRoutingTaintAuditStore,
  EchoModelProvider,
  type ModelProvider,
  type AgentQuery,
  type EphemeralQuery,
  type LedgerStore,
  type LocalMediaStore,
  type PolicyFn,
  type PolicyStore,
  type AutomationRegistry,
  type AutomationRunRecorder,
  type RoleQuery,
  type Skill,
  type SkillOutput,
  type CapabilityStore,
  type AutoActivationBudgetStore,
  type Action,
  type KillSwitchPort,
  type CredentialBroker,
  type OrganizationDefinitionStore,
  type ModuleStore,
  type OnboardingProfileStore,
  type EvalStore,
  LedgerAqvSource,
  type PolicyParamStore,
  type ResourceType,
  type GoalTaskStore,
  type TaskManagerStore,
  type SkillManifestRegistry,
  type ChildAgentRunStore,
  type ResearchRunStore,
  type ChatStore,
  type SkillManifest,
  type TaintAuditStore,
  FREE_CREDENTIALED_SEARCH_ADMISSION,
  type SearchProviderRouter,
  type ContentGuard,
  type GeocodingProvider,
  type Actor,
  type RunCtx,
  reserveChildRunAction,
  validateActionWithinChildRun,
  completeChildAgentRun,
  cancelChildAgentRun,
  failChildAgentRun,
  ChildRunAlreadyTerminalError,
  ChildRunTerminalAuditPendingError,
  MemoryConflictError,
  canonicalizeManifest,
  parseModuleManifest,
  uuidv7,
  hashTaintValue,
  labelAtSource,
} from "@bridge/core";
import { guardedFetch } from "@bridge/net-guard";
import {
  classifyCultureSource,
  partitionCultureEvidence,
  buildSourceDisclosure,
  assertNoFabricatedAffinityOrInsiderClaim,
  groundClaims,
  MAX_CULTURE_SOURCES_PER_RUN,
  type CultureSourceType,
  type CultureSourceEligibility,
  type CultureSkippedSource,
  type CultureSourceDisclosure,
  type CultureResultRef,
  type GroundedClaimInput,
  type ClaimGroundingFailure,
} from "@bridge/jobpilot";
import { createHash, randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { HttpCommonsClient, commonsUrlFromEnv, trustedCommonsPublicKeysFromEnv } from "./commons-client.js";
import { localGeocodingProviderFromEnv } from "./geocoding-provider.js";
import { GoogleOAuthStateStore } from "./google-oauth-state.js";
import { ResidencyRoutingLedgerStore } from "./residency-ledger.js";
import type { CommonsRegistry } from "@bridge/core";
import {
  assertRlsPosture,
  createDb,
  createDrizzlePorts,
  createLocalDb,
  LocalDbInitializationCleanupError,
  createLocalMediaStore,
  DrizzleCanonicalIdentityStore,
  DrizzleOrganizationStore,
  type OrganizationRenameCoordinator,
  DrizzleGraphStore,
  DrizzleJobPilotStore,
  DrizzleHelpdeskStore,
  DrizzleResourcesStore,
  DrizzleCapabilityStore,
  DrizzleEvalStore,
  DrizzlePolicyParamStore,
  DrizzleOrganizationDefinitionStore,
  DrizzleModuleStore,
  DrizzleMemoryStore,
  DrizzleVectorIndex,
  DrizzleLedgerStore,
  DrizzleTaintAuditStore,
  DrizzleRelationMaterializationStore,
  DrizzleAutomationRegistry,
  DrizzleAutomationRunRecorder,
  DrizzleGoalTaskStore,
  DrizzleTaskManagerStore,
  DrizzleSkillManifestRegistry,
  DrizzleChildAgentRunStore,
  DrizzleResearchRunStore,
  DrizzleChatStore,
  DrizzleIntegrationStore,
  seedSkillManifests,
  ensureLearningAgentGovernance,
  ensureOutreachAgentGovernance,
  ensureEgressAgentGovernance,
  ensureIntakeAgentGovernance,
  ensureDealPilotPrincipalGovernance,
  ensureCapabilityApprovalPrincipalGovernance,
  InMemoryCanonicalIdentityStore,
  ensureInternalStrategistGovernance,
  ensureGovernanceAgentGovernance,
  ensureCapabilityBuilderGovernance,
  ensureRelationshipUserGovernance,
  type CanonicalIdentityStore,
} from "@bridge/db";
import {
  acquirePgliteDirectoryOwnership,
  createPgliteLocalPlane,
  type LocalPlane,
} from "@bridge/local";
import {
  AnthropicProvider,
  GroqProvider,
  OllamaProvider,
  LlamaCppProvider,
  MANAGED_LLAMA_PROVIDER_ID,
  ParallelSearchApiProvider,
  ParallelSearchProvider,
  RightsVerifiedSearchProviderRouter,
  createLocalContentGuard,
  createModelRouter,
  type ModelRouter,
} from "@bridge/models";
import { ManagedModelService } from "./chat/model-manager.js";
import { ResidencyRoutingChatStore } from "./chat/residency-chat-store.js";
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
  type IntegrationManifest,
} from "@bridge/integrations-google";
import {
  credentialVaultKeyFromBase64,
  EncryptedFileSourceCredentialVault,
  HumanReauthentication,
  KeyringSourceCredentialVault,
  LocalDealPilotStore,
  SourceCredentialService,
  assertSourceDiscoveryAllowed,
  createBizBuySellAlertConnector,
  createGmailFetchMessages,
  reconcileCredentialOperations,
  type CredentialAuditSink,
  type DealPilotBindings,
  type DealRecord,
  type DealPilotRuntimeStore,
  type DealPilotStore,
  type SourceCredentialVault,
} from "@bridge/dealpilot";
import { DrizzleDealPilotStore, cloudRecordsDealPilotStore } from "./dealpilot-store.js";
import type { QuarantinedCapture } from "@bridge/capability-kit";
import {
  BUILT_IN_MODULES,
  CITED_ROLE_MODEL_PRACTICE_VERSION,
  DEALPILOT_SOURCING_AGENT_ID,
  GOVERNANCE_AGENT_RUNTIME_ID,
  INTERNAL_STRATEGIST_AGENT_RUNTIME_ID,
  LEARNING_AGENT_RUNTIME_ID,
  LEARNING_RECOMMENDATION_SKILL_ID,
  resolveModuleAgentRuntimeId,
  resolveModuleAutomationRuntimeId,
} from "./built-in-modules.js";
import { deterministicUuid } from "./deterministic-uuid.js";
import {
  createOrganizationRenameLease,
  defaultBridgeFilesRoot,
} from "./module-files.js";
import { isPublicCloudOnly } from "./deployment-boundary.js";
import {
  WEB_RESEARCH_SKILL_ID,
  createWebResearchSkill,
} from "./web-research-skill.js";

// Pilot identities (uuids) — structural constants the system needs to run (the
// organization + its service agents + the signed-in pilot user). Not demo/dummy data.
// Exported: router.ts's `assertPilotOrganization` uses it to explicitly REJECT any
// other organizationId (interim single-tenant safety fix, All fixes.md Phase 3 item 11a
// — full multi-tenancy is out of scope for this pass).
export const PILOT_ORGANIZATION = "b0000000-0000-4000-a000-000000000001";
export const OUTREACH_AGENT = "b0000000-0000-4000-a000-0000000000d1";
export const OUTREACH_ROLE = "b0000000-0000-4000-a000-0000000000f1";
const OUTREACH_EVENT_PERMISSION = "b0000000-0000-4000-a000-0000000000c1";
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
export const INTERNAL_STRATEGIST_AGENT = INTERNAL_STRATEGIST_AGENT_RUNTIME_ID;
// TASK-007 (AGS3 closure) — the remaining two of the five permanent
// foundational Agents (docs/raw/agent-goal-skill-orchestration-plan-2026-07.md
// responsibility_map) get REAL physical governed-pipeline identities too, not
// only prompt-level personas — otherwise a Task could never actually be
// assigned to Governance or Capability Builder (resolveSkillForTask requires
// Task.assignedAgentId to be a real, capability-scoped Agent id). Chief of
// Staff deliberately has NO physical identity here — per docs/glossary.md
// "Its routing role is a product composition, not an architectural
// requirement" — it never itself invokes a governed Skill as an actor.
export const GOVERNANCE_AGENT = GOVERNANCE_AGENT_RUNTIME_ID;
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
// seeded user id — organization_definitions.created_by is a real FK to `users`,
// so an arbitrary placeholder caller id would violate that constraint.
export const PILOT_USER = "e0f0053b-fc44-476e-be27-1371e179e958";
export const PILOT_USER_EMAIL = "pilot@bridge.local";

export async function migrateLegacyPilotOrganization(
  organizationStore: DrizzleOrganizationStore,
): Promise<void> {
  await organizationStore.renameOrganization(
    PILOT_ORGANIZATION,
    "Pilot Organization",
    { ifCurrentName: "Pilot organization" },
  );
}

export async function retireSupersededBuiltIns(
  moduleStore: ModuleStore,
  organizationId: string,
): Promise<void> {
  for (const row of await moduleStore.listVersions(organizationId, "helpdesk")) {
    if (row.state === "available") {
      await moduleStore.setState(row.id, "legacy");
    }
  }
  for (const row of await moduleStore.listVersions(organizationId, "calendar")) {
    if (row.state !== "legacy") {
      await moduleStore.setState(row.id, "legacy");
    }
  }
}

export interface Wiring {
  pipeline: UniversalActionPipeline;
  automationExecutor: InProcessAutomationExecutor;
  roles: RoleQuery;
  agents: AgentQuery;
  ephemeral: EphemeralQuery;
  policies: PolicyStore;
  ledger: LedgerStore;
  taintAudit: TaintAuditStore;
  relationMaterializations: DrizzleRelationMaterializationStore;
  events: InMemoryEventBus;
  /** LOCAL-plane media store (bytea blobs). Pglite when LOCAL_MEDIA_DIR set, else in-memory. Never cloud. */
  localMedia: LocalMediaStore;
  /** True when any durable store is active (DATABASE_URL or file-backed Local Plane). */
  persistent: boolean;
  /** Cloud-hosted API boundary: only explicit Supabase-backed shell procedures may run. */
  publicCloudOnly: boolean;
  /** Local Files root; injectable so tests never touch the user's home directory. */
  moduleFilesBridgeRoot: string;
  /** The LOCAL plane (pglite) — private tier. */
  localPlane: LocalPlane;
  /** The Google integration surface. */
  google: GoogleService;
  /** OAuth config (null = not configured → fail-closed gateway). */
  googleOAuth: GoogleOAuthConfig | null;
  /** Durable, hashed, single-use OAuth CSRF states. */
  googleOAuthStates: GoogleOAuthStateStore;
  /** Whether the real googleapis gateway is in use, or Google is unconfigured. */
  googleGatewayKind: "google" | "unconfigured";
  googleManifest: IntegrationManifest;
  /** The server-chosen pilot user id — the default authenticated identity (Phase C
   * replaces this pin with a verified Supabase session). */
  pilotUserId: string;
  /** Email paired with the approved Supabase Auth pilot subject. */
  pilotUserEmail: string;
  /** Feature flight for the TASK-032 learning observation loop (`learning.*`
   * router). OFF by default; enabled via `BRIDGE_LEARNING_OBSERVATION=1` (or a
   * test override). Disabled means every `learning.*` procedure fails closed
   * with a typed error and `learning.status` reports `{ enabled: false }` so
   * clients can honestly hide the surface instead of showing dead controls. */
  learningObservationEnabled: boolean;
  /** Canonical Automation definitions used by Automation creation and execution. */
  automationRegistry: AutomationRegistry;
  /** Attributable Automation Run history used by Module Detail. */
  automationRunRecorder: AutomationRunRecorder;
  /** Organization + team-member CRUD — direct DB writes, not a governed pipeline skill. */
  organizationStore: DrizzleOrganizationStore;
  /** Read surface for Record/Event/Signal (see graph-store.ts). */
  graphStore: DrizzleGraphStore;
  /** JobPilot's persistence (Phase 4 — @bridge/jobpilot is pure logic, no store). */
  jobpilotStore: DrizzleJobPilotStore;
  /** Helpdesk tickets/messages, incl. the public token-authenticated submitter path. */
  helpdeskStore: DrizzleHelpdeskStore;
  /** Resources catalog (replaces the prototype's Supabase-direct read). */
  resourcesStore: DrizzleResourcesStore;
  /** Capability Trust Model — capability_manifests + capability_states (docs/wiki/vision.md). */
  capabilityStore: CapabilityStore;
  /** P1 Organization Generator — organization_definitions (blueprint/version/status), the
   * governed-proposal result organization.blueprint.* compiles via @bridge/core's
   * compileBlueprint (docs/wiki/vision.md "View grammar"). */
  organizationDefinitionStore: OrganizationDefinitionStore;
  /** P2 capability modules (docs/raw/capability-module-format.md, ADR-018) —
   * module_installations-shaped rows. Real DrizzleModuleStore in persistent
   * mode (ADR-023); InMemoryModuleStore in in-memory mode — same split every
   * other Drizzle-backed store in this file already follows. */
  moduleStore: ModuleStore;
  /** Daily auto-activation budget counters (informational/advisory bands). In-memory in both
   * modes for now — no persistent implementation exists yet (mirrors the ledger-residency-gap
   * pattern: a real budget counter is future work, not silently faked as durable). */
  capabilityBudgets: AutoActivationBudgetStore;
  /** Organization-level kill switch forcing every capability activation to explicit approval. */
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
  /** A1-R1/F2 — Agent Quality Vector source over the append-only ledger. Scores a
   * capability from the governed episodes it actually produced (attribution key:
   * `LedgerEntry.skill`, migration 0037) rather than from a synthetic dataset.
   * Ledger-backed in BOTH modes. */
  aqvSource: LedgerAqvSource;
  /** policy_params tunable space (EVAL-3 promotion gates + VAR-1 nudges). In-memory in
   * both modes for now — defaults-only until a governed nudge is approved and a Drizzle
   * binding lands. */
  policyParams: PolicyParamStore;
  /** Onboarding personalization profile (ADR-033/R-030) — Avatar style, answers, phone/LinkedIn
   * verification method, connected sources. In-memory in both modes for now (see
   * onboarding-profile.ts's header comment for scope vs. the general Memory/Knowledge gap). */
  onboardingProfileStore: OnboardingProfileStore;
  /** AGS1 (TASK-007) — Goal/Task catalog Skills resolve against. In-memory
   * default in both modes for dev/test (mirrors every other in-memory port's
   * dependency-free default); `buildPersistentPorts` binds the real,
   * restart-durable `DrizzleGoalTaskStore` instead. */
  goalTasks: GoalTaskStore;
  taskManager: TaskManagerStore;
  /** AGS1 (TASK-007) — registered governed Skill manifests (`resolveSkillForTask`'s
   * candidate catalog). In-memory default; `buildPersistentPorts` binds the real
   * `DrizzleSkillManifestRegistry` (backed by `skill_manifests`, seeded from the
   * SAME code-declared `GOVERNED_SKILL_MANIFEST_CATALOG` via `ensureSkillManifestCatalog`). */
  skillManifests: SkillManifestRegistry;
  /** AGS2 (TASK-007) — bounded child Agent Runs a parent Agent has spawned.
   * In-memory default; `buildPersistentPorts` binds the real, restart-durable
   * `DrizzleChildAgentRunStore` instead. */
  childAgentRuns: ChildAgentRunStore;
  /** TASK-028 — durable, owner-scoped Research Run records + step evidence
   * (the kernel projection of an @bridge/research engine loop; step child
   * Runs live in `childAgentRuns`). In-memory default; `buildPersistentPorts`
   * and the local-durable path bind `DrizzleResearchRunStore`. */
  researchRuns: ResearchRunStore;
  /** Plane-bound durable Chat threads, turns, and lifecycle references. */
  chatStore: ChatStore;
  /** Human-triggered managed local-model install/start lifecycle. */
  managedModel: ManagedModelService;
  /** TASK-011 — durable culture-research fetch-intent records (see
   * `DurableCultureFetchStore`'s doc comment), keyed by childRunId and backed
   * by `memoryStore` — restart-durable in both persistent and zero-infra/
   * local-SQLite dev modes, unlike the process-local `Map` this replaced. */
  cultureFetchStore: DurableCultureFetchStore;
  /** TASK-011 remediation (2026-07-19 coordinator distributed-defects review,
   * issue 13) — durable pointer from a culture-research parent Run to its
   * synthesis proposal id (see `DurableCultureSynthesisPointerStore`), so the
   * server-authoritative `cultureResearch.latestRun` query can resolve
   * synthesis state without a client-supplied pointer. */
  cultureSynthesisPointerStore: DurableCultureSynthesisPointerStore;
  /** TASK-011 remediation (2026-07-19 coordinator distributed-defects
   * RE-review, issue 13) — durable, O(1) (organizationId, company) -> latest
   * parentRunId pointer (see `DurableCultureLatestRunPointerStore`),
   * replacing the organization-wide scan `DurableCultureFetchStore.listByCompany`
   * previously used for this — a scan-then-limit approach that could
   * silently hide the real latest run behind enough unrelated Memories at
   * scale. */
  cultureLatestRunPointerStore: DurableCultureLatestRunPointerStore;
  /** Process-local-only live `AbortController`s for in-flight culture-
   * research fetches, keyed by childRunId — intentionally NOT durable (an
   * abort handle cannot survive a restart, and after a restart there is no
   * live fetch in THIS process to abort anyway; `cultureFetchStore` itself
   * remains the durable source of truth for status). */
  cultureFetchAbortControllers: Map<string, AbortController>;
  /** Inspectable, correctable, deletable learned preferences. */
  memoryStore: MemoryStore;
  /** LA5 vector lane storage (refs + vectors only, rebuildable) — same db as
   * `memoryStore` so vector hits always hydrate from the store they index. */
  vectorIndex: VectorIndex;
  /** Semantic embedder for the LA5 vector lane, when a local embed-capable
   * model is available (Ollama nomic-embed today). Absent = the deterministic
   * lexical hashing fallback; indexer and chat query ALWAYS share whichever
   * embedder this resolves to (one embedding space). */
  semanticEmbedder?: TextEmbedder;
  /** The pipeline's own skill registry — read-only lookups for surfaces that
   * statically validate a skill reference (e.g. Automation-draft activation)
   * before the pipeline's run-time gates ever see it. */
  skillRegistry: SkillRegistry;
  /** Feature flight for LA5 retrieval fusion (chat memory slot filled by
   * structured+vector+graph RRF fusion; scheduled embedding indexer). OFF by
   * default; enabled via `BRIDGE_RETRIEVAL_FUSION=1` (or a test override).
   * Disabled means chat keeps the pre-fusion recency slice and no indexer
   * runs — nothing new is stored or read. */
  retrievalFusionEnabled: boolean;
  /** Feature flight for Commons capability archetypes (roadmap-v2 Phase 4:
   * generalize accepted preferences → contribute; seed suggestions from
   * Commons archetypes). OFF by default; `BRIDGE_COMMONS_ARCHETYPES=1` (or a
   * test override). Every `learning.archetypes.*` procedure fails closed
   * while off — nothing is generalized, published, or seeded. */
  commonsArchetypesEnabled: boolean;
  /** ModelProvider registry/router (@bridge/models): resolves capability manifest modelBindings to
   * providers, honoring planeDefault (capture/sensor plane = local models, never cloud
   * fallback). In-memory mode registers the network-free echo double; persistent mode
   * registers Ollama (local) + Anthropic + Groq (cloud, only when their respective
   * API keys are set). */
  models: ModelRouter;
  /** TASK-023 public-web SearchProvider router. Phase 1 accepts only
   * rights-verified Tier-1 free-direct providers and has no paid escalation path. */
  searchProviders: SearchProviderRouter;
  /** Local-plane quarantine that reduces web results to typed data before any sink. */
  webResearchContentGuard: ContentGuard;
  /** Explicitly configured Local Plane geocoder. `null` means place labels stay
   * local and Map plots only Records that already carry coordinates. */
  geocodingProvider: GeocodingProvider | null;
  /** DealPilot's quarantine/commit surface (first Module on the generic intake seam). */
  dealpilot: {
    integrationId: string;
    store: DealPilotRuntimeStore;
    credentials: SourceCredentialService;
    credentialVault: SourceCredentialVault;
    credentialAudit: CredentialAuditSink;
    bindings: DealPilotBindings;
    validateSourceDiscovery(
      organizationId: string,
      sourceId: string,
    ): Promise<void>;
  };
  /** Local-plane social Integration and permission records. */
  integrationStore: DrizzleIntegrationStore;
  /** In-memory governance stores for seeding in dev; undefined when persistent. */
  memory?: {
    roles: InMemoryRoleStore;
    agents: InMemoryAgentStore;
    ephemeral: InMemoryEphemeralStore;
  };
  close(): Promise<void>;
}

export interface BuildWiringOptions {
  /** Test/deployment override for the learning observation flight. Omitted
   * means the environment decides (`BRIDGE_LEARNING_OBSERVATION`), default OFF. */
  learningObservationEnabled?: boolean;
  /** Test/deployment override for the LA5 retrieval-fusion flight. Omitted
   * means the environment decides (`BRIDGE_RETRIEVAL_FUSION`), default OFF. */
  retrievalFusionEnabled?: boolean;
  /** Test/deployment override for the Commons-archetypes flight. Omitted
   * means the environment decides (`BRIDGE_COMMONS_ARCHETYPES`), default OFF. */
  commonsArchetypesEnabled?: boolean;
  /** Explicit semantic embedder for the LA5 vector lane (tests/deployments).
   * Omitted means the wiring resolves one from the registered local
   * providers (Ollama when present); none found = lexical hashing fallback. */
  semanticEmbedder?: TextEmbedder;
  /** Explicit provider set for composition tests or alternate deployments.
   * Omitted means the normal environment-bound providers for the selected mode. */
  modelProviders?: readonly ModelProvider[];
  /** Explicit SearchProvider router for composition tests or deployments. */
  searchProviders?: SearchProviderRouter;
  /** Explicit local ContentGuard for composition tests or alternate deployments. */
  webResearchContentGuard?: ContentGuard;
  /** Test-only adapter injection. Runtime defaults to the real OS keyring. */
  dealPilotCredentialVault?: SourceCredentialVault;
  /** Test-only opt-in; runtime must name a durable Local Plane directory. */
  allowEphemeralLocalPlane?: boolean;
  localDir?: string;
  /** Test or host injection. Runtime only auto-binds BRIDGE_LOCAL_GEOCODER_URL,
   * which is restricted to loopback by the adapter. */
  geocodingProvider?: GeocodingProvider;
  /** Local Files root; injectable so tests never touch the user's home directory. */
  moduleFilesBridgeRoot?: string;
  /** Pinned local runtime manifest; injectable for isolated model-manager tests. */
  modelRuntimeManifestPath?: string;
  /** Managed model state root, kept outside the PGlite database directory. */
  modelRuntimeDir?: string;
}

/** A first skill: stage an entity mutation (echo inputs as the proposed change). */
/** The kernel's reserved passthrough — see @bridge/core's `KERNEL_PASSTHROUGH_SKILL`
 * doc comment (pipeline.ts) for exactly why Human-authored mutations may use it
 * without turning it into a Skill catalog entry. Agents get no such bypass.
 * `name` MUST equal that constant. */
const stageMutation: Skill = {
  name: KERNEL_PASSTHROUGH_SKILL,
  executionClass: "pure_data",
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
  organizationId: PILOT_ORGANIZATION,
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
export const LEARNING_WEB_RESEARCH_GOAL_TYPE = "learning.web_research";
export const RESEARCH_PUBLIC_WEB_TASK_TYPE = "research_public_web";
/** TASK-028 — one durable Goal for background Research Runs; each Run mints
 * its own bounded Task (the same durable-Goal/fresh-Task split every other
 * governed lane uses). */
export const LEARNING_RESEARCH_RUN_GOAL_TYPE = "learning.research_run";
export const RESEARCH_RUN_TASK_TYPE = "research_run";

export const LEARNING_RECOMMENDATION_SKILL_MANIFEST = {
  organizationId: PILOT_ORGANIZATION,
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

// ---------------------------------------------------------------------------
// The governed capability-build chain (ADR-181) — one Skill per junction of
// @bridge/core's `capability/build-chain.ts`.
//
// Before this, Capability Builder held ZERO Skills: it had an identity, a role,
// and a governance row, and no way to do anything with them. These three Skills
// are what make "the Builder builds capabilities" a fact rather than a mission
// statement — and, equally, what bound it, since a Skill is the only thing an
// Agent can be attributed for.
//
// Each Skill is granted to EXACTLY ONE Agent below. The chain's actor checks
// already refuse a mismatched agent in pure code; the grants make the same rule
// true one layer down, at Skill resolution, so neither layer is the sole guard.
//
// Note what is NOT here: no Skill activates anything. All three declare
// `signal:write` — the scope all three Agents already held — so wiring the
// chain widened no Agent's authority by a single permission. Activation stays
// on the Human-only `capability.approve` path it was always on.
// ---------------------------------------------------------------------------

/** One durable Goal for the whole chain; each request mints its own bounded
 * Tasks, the same durable-Goal/fresh-Task split every other governed lane uses. */
export const CAPABILITY_BUILD_GOAL_TYPE = "capability.build";
export const RECOMMEND_CAPABILITY_BUILD_TASK_TYPE = "recommend_capability_build";
export const DRAFT_CAPABILITY_TASK_TYPE = "draft_capability";
export const REVIEW_CAPABILITY_DRAFT_TASK_TYPE = "review_capability_draft";

export const RECOMMEND_CAPABILITY_BUILD_SKILL_ID = "capability.recommendBuild";
export const DRAFT_CAPABILITY_SKILL_ID = "capability.draft";
export const REVIEW_CAPABILITY_DRAFT_SKILL_ID = "capability.reviewDraft";

/** Junction 1 — Internal Strategist names a capability that should exist. */
const stageCapabilityBuildRecommendation: Skill = {
  name: RECOMMEND_CAPABILITY_BUILD_SKILL_ID,
  async run(inputs) {
    return { proposedOutput: inputs, diff: { to: inputs } };
  },
};

/** Junction 2 — Capability Builder turns that into a draft manifest. */
const stageCapabilityDraft: Skill = {
  name: DRAFT_CAPABILITY_SKILL_ID,
  async run(inputs) {
    return { proposedOutput: inputs, diff: { to: inputs } };
  },
};

/** Junction 3 — Governance's computed verdict on the draft. */
const stageCapabilityDraftReview: Skill = {
  name: REVIEW_CAPABILITY_DRAFT_SKILL_ID,
  async run(inputs) {
    return { proposedOutput: inputs, diff: { to: inputs } };
  },
};

const CAPABILITY_BUILD_SKILL_MANIFEST_BASE = {
  organizationId: PILOT_ORGANIZATION,
  version: "1.0.0",
  goalTypes: [CAPABILITY_BUILD_GOAL_TYPE],
  permissions: ["signal:write"],
  plane: "local",
  dataScopes: ["all"],
  riskBand: "advisory",
  evalVersion: "1.0.0",
  childRunPolicy: "allowed",
} as const;

export const RECOMMEND_CAPABILITY_BUILD_SKILL_MANIFEST = {
  ...CAPABILITY_BUILD_SKILL_MANIFEST_BASE,
  skillId: RECOMMEND_CAPABILITY_BUILD_SKILL_ID,
  taskTypes: [RECOMMEND_CAPABILITY_BUILD_TASK_TYPE],
  defaultAgents: ["internal_strategist"],
} as const;

export const DRAFT_CAPABILITY_SKILL_MANIFEST = {
  ...CAPABILITY_BUILD_SKILL_MANIFEST_BASE,
  skillId: DRAFT_CAPABILITY_SKILL_ID,
  taskTypes: [DRAFT_CAPABILITY_TASK_TYPE],
  defaultAgents: ["capability_builder"],
} as const;

export const REVIEW_CAPABILITY_DRAFT_SKILL_MANIFEST = {
  ...CAPABILITY_BUILD_SKILL_MANIFEST_BASE,
  skillId: REVIEW_CAPABILITY_DRAFT_SKILL_ID,
  taskTypes: [REVIEW_CAPABILITY_DRAFT_TASK_TYPE],
  defaultAgents: ["governance"],
} as const;

/**
 * TASK-010 (platform red-flag correction feedback, docs/raw/ui-architecture-
 * rules-2026-07.md §5d) — the ONE governed step in the red-flag flow. The
 * Human's own correction Memory (`redFlag.create` in router.ts) is a plain
 * `memoryStore.write` and never touches this Skill or the pipeline at all
 * (TASK-007's TASK-010 handoff §1: "do NOT route this through the Agent/Skill
 * pipeline"). This Skill is the SEPARATE, attributable step where Learning
 * proposes a Memory/ranking/preference change citing accumulated red flags as
 * evidence — resourceType stays "signal" (never "policy"/"policy_param",
 * which `agent-floor.ts` denies to every Agent unconditionally, checked
 * before Skill resolution ever runs); its `proposedOutput` carries the
 * proposed change as DATA (`governed: true, applied: false`, mirroring
 * `policy/variance-adjuster.ts`'s `VarianceProposal` shape) for a Human to
 * review in the existing Approvals surface — no separate enactment path is
 * wired here; TASK-010's own scope is the flag/undo/inspect UI, not policy
 * application.
 */
const stagePreferenceAdjustmentProposal: Skill = {
  name: "learning.proposePreferenceAdjustment",
  async run(inputs) {
    return { proposedOutput: inputs, diff: { to: inputs } };
  },
};

export const PLATFORM_RED_FLAG_LEARNING_GOAL_TYPE = "platform.red_flag_learning";
export const PROPOSE_PREFERENCE_ADJUSTMENT_TASK_TYPE = "propose_preference_adjustment";

export const RED_FLAG_LEARNING_SKILL_MANIFEST = {
  organizationId: PILOT_ORGANIZATION,
  skillId: "learning.proposePreferenceAdjustment",
  version: "1.0.0",
  goalTypes: [PLATFORM_RED_FLAG_LEARNING_GOAL_TYPE],
  taskTypes: [PROPOSE_PREFERENCE_ADJUSTMENT_TASK_TYPE],
  permissions: ["signal:write"],
  plane: "local",
  dataScopes: ["all"],
  riskBand: "advisory",
  evalVersion: "1.0.0",
  defaultAgents: ["learning"],
  childRunPolicy: "forbidden",
} as const;

/** TASK-032 — the scheduled observation digest. One governed Skill the
 * Learning Agent runs (advisory, Local Plane, signal:write only): it batches
 * recorded decision signals into SUGGESTED preference Memories via the
 * kernel's `digestSignals`. Suggested-then-accepted holds by construction —
 * the digest can only propose; minting a preference stays behind the Human
 * `learning.suggestions.accept` mutation. Registered and seeded ONLY while
 * the learning observation flight is on. */
export const LEARNING_OBSERVATION_GOAL_TYPE = "platform.learning_observation";
export const OBSERVATION_DIGEST_TASK_TYPE = "observation_digest";
export const OBSERVATION_DIGEST_SKILL_ID = "learning.observationDigest";
export const LEARNING_DIGEST_AUTOMATION_ID = "platform.learning.observation-digest";

export const OBSERVATION_DIGEST_SKILL_MANIFEST = {
  organizationId: PILOT_ORGANIZATION,
  skillId: OBSERVATION_DIGEST_SKILL_ID,
  version: "1.0.0",
  goalTypes: [LEARNING_OBSERVATION_GOAL_TYPE],
  taskTypes: [OBSERVATION_DIGEST_TASK_TYPE],
  permissions: ["signal:write"],
  plane: "local",
  dataScopes: ["all"],
  riskBand: "advisory",
  evalVersion: "1.0.0",
  defaultAgents: ["learning"],
  childRunPolicy: "forbidden",
} as const;

function createObservationDigestSkill(deps: {
  memoryStore: MemoryStore;
  pilotUserId: string;
  enabled: () => boolean;
}): Skill {
  return {
    name: OBSERVATION_DIGEST_SKILL_ID,
    async run(inputs, ctx) {
      // Defense in depth: the Automation is only seeded while the flight is
      // on, but the Skill itself also fails closed if invoked another way.
      if (!deps.enabled()) {
        throw new Error("learning observation flight is disabled (BRIDGE_LEARNING_OBSERVATION)");
      }
      const params = (typeof inputs === "object" && inputs !== null ? inputs : {}) as Record<string, unknown>;
      const organizationId = typeof params.organizationId === "string" ? params.organizationId : PILOT_ORGANIZATION;
      const moduleId = typeof params.moduleId === "string" ? params.moduleId : "dealpilot";
      const created = await digestSignals(deps.memoryStore, {
        organizationId,
        ownerUserId: deps.pilotUserId,
        moduleId,
        nextId: () => ctx.ids.next(),
        lineageIdFor: deterministicUuid,
      });
      const proposedOutput = {
        kind: "learning_observation_digest",
        moduleId,
        proposedSuggestionCount: created.length,
        suggestionMemoryIds: created.map((s) => s.memoryId),
      };
      return { proposedOutput, diff: { to: proposedOutput } };
    },
  };
}

export const WEB_RESEARCH_SKILL_MANIFEST = {
  organizationId: PILOT_ORGANIZATION,
  skillId: WEB_RESEARCH_SKILL_ID,
  version: "1.0.0",
  goalTypes: [LEARNING_WEB_RESEARCH_GOAL_TYPE],
  taskTypes: [RESEARCH_PUBLIC_WEB_TASK_TYPE],
  permissions: ["external:fetch:read"],
  plane: "cloud",
  dataScopes: ["public"],
  riskBand: "advisory",
  evalVersion: "1.0.0",
  defaultAgents: ["learning"],
  childRunPolicy: "forbidden",
} as const;

/**
 * TASK-011 (JP3B) — JobPilot culture research. Per the TASK-007 handoff
 * ("TASK-011 handoff" section of
 * outputs/2026-07-16-task007-agent-skill-child-run-orchestration.md), these
 * are JobPilot's OWN Goal/Task types and governed Skills, wired against the
 * SAME reusable Goal/Task/SkillManifest/child-Agent-Run primitives every
 * other governed Skill in this file uses — no new pipeline mechanism, no new
 * physical Agent identity (reuses LEARNING_AGENT/INTERNAL_STRATEGIST_AGENT).
 *
 * REMEDIATED 2026-07-17 (independent security review of the first pass, see
 * outputs/2026-07-17-jobpilot-culture-research-task011.md) — the first pass
 * had `jobpilot.researchCultureSource`'s `run()` perform the REAL network
 * fetch, which pipeline.propose() calls unconditionally BEFORE the
 * pending_review/approve decision is made — meaning "review" was cosmetic;
 * the side effect had already happened. It also trusted client-supplied
 * source URL/type/label, sized its budget off the caller's own array length,
 * accepted arbitrary claim text, and left no way to cancel an in-flight
 * fetch. This block is a full two-phase redesign:
 *
 *  1. `jobpilot.researchCultureSource.run()` is now PURE — no network access
 *     at all. It only re-resolves the requested source from the SERVER-OWNED
 *     `CULTURE_SOURCE_REGISTRY` (never trusting client-supplied url/type/
 *     label) and returns an intent descriptor. Calling `pipeline.propose()`
 *     for it is therefore genuinely side-effect-free, matching every other
 *     governed Skill's "propose = draft, not yet committed" contract.
 *  2. The REAL, guarded fetch happens only in `materializeCultureSourceFetch`
 *     (below), invoked by the router ONLY after `action.decide` has recorded
 *     an "approve" decision for that specific proposal — re-checked from the
 *     ledger every time, never trusted from the caller. A vetoed/never-
 *     decided proposal can never reach a fetch: zero network calls.
 *  3. `reserveChildRunAction` atomically validates AND consumes the child
 *     Run's budget immediately before the fetch (not earlier, since propose
 *     has no effect to gate, and not later, since that would let two racing
 *     materialize calls both proceed). Any exception during materialization
 *     calls `failChildAgentRun` with audit evidence; success calls
 *     `completeChildAgentRun` only once the result is durably stored.
 *     Materializing an already-fetched/failed/cancelled source is a no-op
 *     that returns the stored record — idempotent, never a silent refetch.
 *  4. Fan-out is bounded by a FIXED constant
 *     (`@bridge/jobpilot`'s `MAX_CULTURE_SOURCES_PER_RUN`), independent of how
 *     many source ids a caller lists; ids are deduped before any reservation.
 *  5. `guardedFetch` (`@bridge/net-guard`) is the ONLY network call site —
 *     TOCTOU-safe pinned DNS resolution, validated redirects, a hard
 *     streamed byte cap, and a real `AbortSignal` wired to
 *     `cancelCultureSourceFetch` for genuine mid-fetch cancellation.
 *  6. `jobpilot.synthesizeCultureProfile` now requires every claim to ground
 *     against an immutable fetched result (`groundClaims`) — a quote must
 *     be a real substring of the result this run actually fetched, bound
 *     by a server-computed content hash so a claim can't cite content that
 *     was never actually retrieved (or has since been superseded).
 *
 * Two Skills, matching BRD `agents.Learning.default_skills`/
 * `agents.Internal_Strategist.default_skills`:
 *  - `jobpilot.researchCultureSource` (Learning) — pure intent only; see (1).
 *  - `jobpilot.synthesizeCultureProfile` (Internal Strategist, local plane,
 *    no network access of its own) — partitions GROUNDED evidence into
 *    fact/opinion/theme/contradiction/inference and builds the source-rights
 *    disclosure, per Internal Strategist's `agents.ts` boundary ("never
 *    invents evidence").
 */
export const JOBPILOT_CULTURE_RESEARCH_GOAL_TYPE = "jobpilot.culture_research";
export const RESEARCH_CULTURE_SOURCE_TASK_TYPE = "research_culture_source";
export const SYNTHESIZE_CULTURE_PROFILE_TASK_TYPE = "synthesize_culture_profile";

/**
 * Server-owned authorized culture-research source catalog (TASK-011
 * remediation #2 — "rights classification is caller-forgeable"). A client
 * may select ONLY a `sourceId` from this registry; the server resolves
 * company, URL, source type, and rights classification entirely from this
 * table — a client can never supply or relabel a URL/sourceType directly, so
 * a Glassdoor URL mislabeled "official page" has no code path to reach a
 * fetch. Scoped by (organizationId, company); an id from a different organization
 * or company is rejected as unknown for THAT request (see
 * `resolveAuthorizedCultureSource`). In-memory/hardcoded for this pilot slice
 * — same known-gap shape as `goalTasks`/`skillManifests`/`childAgentRuns`
 * (no restart-durable store yet); a real admin surface to manage this
 * catalog is future work, not silently faked as durable here.
 */
export interface AuthorizedCultureSource {
  id: string;
  organizationId: string;
  company: string;
  sourceType: CultureSourceType;
  sourceLabel: string;
  url: string;
  /** The origin set a redirect chain from `url` may traverse WITHOUT losing
   * this source's rights classification — TASK-011 remediation (2026-07-18
   * coordinator final review, issue 3). Always includes `url`'s own origin;
   * a source with no additional legitimate redirect targets should list
   * exactly that one origin. `materializeCultureSourceFetch` passes this
   * straight through to `guardedFetch`'s `allowedRedirectOrigins`, which
   * rejects (rather than silently downgrading trust for) any hop that lands
   * outside it. */
  allowedRedirectOrigins: readonly string[];
}

export const CULTURE_SOURCE_REGISTRY: AuthorizedCultureSource[] = [
  {
    id: "bcg-careers-interview-process",
    organizationId: PILOT_ORGANIZATION,
    company: "Boston Consulting Group",
    sourceType: "company_official_page",
    sourceLabel: "BCG Careers — Interview Process",
    url: "https://careers.bcg.com/global/en/interview-process",
    allowedRedirectOrigins: ["https://careers.bcg.com"],
  },
  {
    id: "bcg-glassdoor-reviews",
    organizationId: PILOT_ORGANIZATION,
    company: "Boston Consulting Group",
    sourceType: "glassdoor",
    sourceLabel: "Glassdoor — BCG reviews",
    url: "https://www.glassdoor.com/Reviews/BCG-Reviews-E3854.htm",
    allowedRedirectOrigins: ["https://www.glassdoor.com"],
  },
  {
    id: "bcg-reddit-consulting",
    organizationId: PILOT_ORGANIZATION,
    company: "Boston Consulting Group",
    sourceType: "reddit",
    sourceLabel: "r/consulting — BCG threads",
    url: "https://www.reddit.com/r/consulting/",
    allowedRedirectOrigins: ["https://www.reddit.com"],
  },
  {
    id: "bcg-google-reviews",
    organizationId: PILOT_ORGANIZATION,
    company: "Boston Consulting Group",
    sourceType: "google_reviews",
    sourceLabel: "Google reviews — BCG",
    url: "https://www.google.com/maps/place/Boston+Consulting+Group",
    allowedRedirectOrigins: ["https://www.google.com"],
  },
];

/** TEST-ONLY escape hatch: appends an additional authorized source to the
 * registry for a single test process. Production code must NEVER call this —
 * the `unsafe` prefix makes misuse obvious at every call site. It exists so
 * an integration test can point a REAL `materializeCultureSourceFetch` call
 * at a local test server it controls (proving the real reservation/fetch/
 * idempotency/completion logic end-to-end) without weakening authorization
 * for any of the real entries above. */
export function unsafeRegisterTestOnlyCultureSource(source: AuthorizedCultureSource): void {
  CULTURE_SOURCE_REGISTRY.push(source);
}

/** Resolves a client-supplied `sourceId` against the registry, scoped to the
 * REQUESTING organization and company — an id that exists but belongs to a
 * different organization or company is treated as unknown for this request
 * (never leaked as "found, but not yours"). Returns `null` for any mismatch. */
export function resolveAuthorizedCultureSource(
  organizationId: string,
  company: string,
  sourceId: string,
): AuthorizedCultureSource | null {
  const found = CULTURE_SOURCE_REGISTRY.find((s) => s.id === sourceId);
  if (!found) return null;
  if (found.organizationId !== organizationId || found.company !== company) return null;
  return found;
}

const CULTURE_RESEARCH_USER_AGENT =
  "Bridge/0.1 jobpilot-culture-research (research; see docs/raw/brd-jobpilot-2026-07.md)";
const MAX_CULTURE_EXCERPT_CHARS = 6_000;
/** Hard byte cap for a culture-research fetch — well within net-guard's own
 * default, kept explicit here so this call site's bound is self-documenting. */
const MAX_CULTURE_FETCH_BYTES = 500_000;
const CULTURE_FETCH_TIMEOUT_MS = 8_000;
/** TASK-011 remediation (2026-07-19 coordinator distributed-defects review,
 * issue 3) — how long a materialize call's lease on a source-fetch intent is
 * valid before another attempt may reclaim it as orphaned (e.g. the process
 * holding it crashed mid-fetch). Comfortably longer than
 * `CULTURE_FETCH_TIMEOUT_MS` so a live, well-behaved fetch never has its own
 * lease reclaimed out from under it. */
const CULTURE_FETCH_LEASE_MS = 30_000;
/** How often `materializeCultureSourceFetch` polls the DURABLE record for a
 * `cancelRequested` flag raised by a DIFFERENT process/instance while this
 * one holds the live socket — issue 2's distributed-cancellation mechanism.
 * The process-local `AbortController` map is an optimization only; this poll
 * is what makes cancellation authoritative across instances. */
const CULTURE_CANCEL_POLL_MS = 400;
/** TASK-011 remediation (2026-07-19 coordinator distributed-defects
 * RE-review) — bounds `DurableCultureFetchStore.requestCancel`'s CAS-retry
 * loop. Two or three retries is enough to converge against any realistic
 * concurrent lease-reclaim race; this cap only guards against pathological,
 * sustained contention turning into an infinite loop. */
const CULTURE_CANCEL_CAS_MAX_RETRIES = 5;
/** How long a fetched result's raw content is retained before it is
 * considered stale/expired for synthesis grounding — issue 8 (external
 * trust/retention). Bounded, not indefinite. */
const CULTURE_RESULT_RETENTION_MS = 24 * 60 * 60 * 1000;
/** TASK-011 remediation (2026-07-19 coordinator distributed-defects
 * RE-review round 2, issue 7 — hardened after a fresh independent review
 * found the ORIGINAL self-heal check unsafe). A synthesis-pointer's
 * proposalId not YET resolving in the ledger is NOT, by itself, proof the
 * pointer is dead — a genuinely live, in-flight `pipeline.propose` call
 * (authority/policy checks, the Skill's own result resolution, the
 * fabrication guard) can legitimately still be running when a SECOND,
 * concurrent `synthesize()` request for the SAME parentRunId reads this
 * pointer. Without an age check, that second request could self-heal
 * (release + rebind) the still-live winner's pointer out from under it,
 * permanently orphaning the first caller's soon-to-exist, perfectly valid
 * ledger row (their proposalId, once decided, would fail the NEW
 * `assertCultureProposalBindingValid` backstop). Only a pointer OLDER than
 * this grace period is self-healed — comfortably longer than any realistic
 * `pipeline.propose` call for this Skill (which does no network access). */
const CULTURE_SYNTHESIS_POINTER_DEAD_GRACE_MS = 30_000;
/** TASK-011 remediation (2026-07-19 coordinator distributed-defects review,
 * issue 13) — the max number of historical culture-fetch intent rows
 * `DurableCultureFetchStore.listByCompany` will scan to find the latest
 * parent Run for one (organizationId, company). Fixed, not derived from any
 * caller input — the server-authoritative "resume" query must stay bounded
 * regardless of how many research runs a company has accumulated over time. */
const CULTURE_RESEARCH_HISTORY_SCAN_LIMIT = 2_000;

/** TASK-011 remediation (2026-07-19 coordinator distributed-defects
 * RE-review, issue 7) — the ONE predicate every read/synthesis path must
 * use to decide whether a fetched result's raw content may still be
 * relied on. Never serve/consume expired evidence past
 * `CULTURE_RESULT_RETENTION_MS`. */
export function isResultExpired(result: CultureResultRef, nowISO: string): boolean {
  return Date.parse(nowISO) >= Date.parse(result.expiresAt);
}

/**
 * The `MemoryStore.redactLineageContent` redact callback for culture-fetch
 * intent records — TASK-011 remediation (coordinator central-merge review,
 * issue 2). MUST be a pure function of its input (same `MemoryEntry` ->
 * same result, always) — see `redactLineageContent`'s own doc comment for
 * why. Returns `null` (leave this row's content untouched) unless the row
 * is genuinely a `culture_fetch_intent` record carrying a non-empty,
 * NOW-expired result — in which case it returns the SAME redacted shape
 * `purgeExpiredResultContentIfNeeded` already produces for the current
 * view (result content blanked, every other field — hash/URL/timestamps/
 * expiry, plus the record's own `updatedAt`/other fields — left exactly as
 * this specific row already had them, since this is redacting a HISTORICAL
 * row, not advancing it to a new "current" state).
 */
function redactExpiredCultureFetchResult(entry: MemoryEntry, nowISO: string): string | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(entry.content);
  } catch {
    return null; // not JSON this store understands — never touch it
  }
  if (typeof parsed !== "object" || parsed === null) return null;
  const record = parsed as Partial<CultureFetchIntentRecord>;
  if (record.kind !== "culture_fetch_intent") return null; // a different record type happens to share this lineage's key space
  const result = record.result;
  if (!result || result.content === "") return null; // nothing to redact — absent or already purged
  if (!isResultExpired(result, nowISO)) return null; // not yet past retention — never redact live evidence
  return JSON.stringify({ ...record, result: { ...result, content: "" } });
}

function stripHtmlToText(html: string): string {
  return html
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function computeContentHash(content: string): string {
  return createHash("sha256").update(content, "utf8").digest("hex");
}

/**
 * TASK-011 remediation (2026-07-19, issue 7 — source policy snapshot). A
 * stable hash of every security-relevant field of a registry entry, taken at
 * `propose()` time and pinned into the durable intent record. `materialize`
 * re-resolves the CURRENT registry entry and recomputes this hash fresh — if
 * they no longer match (the source's eligibility/type/URL/redirect-origin
 * policy changed between propose and materialize, e.g. an operator
 * reclassified a source from `permitted` to `do_not_use`), materialize fails
 * closed and requires a fresh proposal/approval rather than trusting a
 * URL-only comparison (which cannot detect an eligibility/redirect-origin
 * change at the SAME URL).
 */
export function computeSourcePolicyHash(source: AuthorizedCultureSource): string {
  const classification = classifyCultureSource(source.sourceType);
  const canonical = JSON.stringify({
    sourceType: source.sourceType,
    url: source.url,
    allowedRedirectOrigins: [...source.allowedRedirectOrigins].sort(),
    eligibility: classification.eligibility,
  });
  return createHash("sha256").update(canonical, "utf8").digest("hex");
}

export interface ResearchCultureSourceInput {
  sourceId: string;
  organizationId: string;
  company: string;
}

/** PURE intent descriptor — proves nothing was fetched yet. No excerpt, no
 * result, no network access; just "this is what would be fetched, for
 * which permitted source." */
export interface ResearchCultureSourceIntentOutput {
  sourceId: string;
  sourceType: CultureSourceType;
  sourceLabel: string;
  url: string;
  plannedAt: string;
}

/**
 * Learning's culture-source-research Skill — PURE (TASK-011 remediation #3).
 * Re-resolves the source from the registry itself (defense in depth — never
 * trusts that the caller already did this) and re-checks eligibility, but
 * performs NO fetch. The real fetch is `materializeCultureSourceFetch`,
 * called only after this proposal is approved.
 */
export function createResearchCultureSourceSkill(): Skill {
  return {
    name: "jobpilot.researchCultureSource",
    async run(inputs) {
      const input = inputs as ResearchCultureSourceInput;
      const source = resolveAuthorizedCultureSource(input.organizationId, input.company, input.sourceId);
      if (!source) {
        throw new Error(`jobpilot.researchCultureSource: "${input.sourceId}" is not an authorized source for this organization/company`);
      }
      const classification = classifyCultureSource(source.sourceType);
      if (classification.eligibility !== "permitted") {
        throw new Error(
          `jobpilot.researchCultureSource: source type "${source.sourceType}" is "${classification.eligibility}" — ${classification.reason}`,
        );
      }
      const output: ResearchCultureSourceIntentOutput = {
        sourceId: source.id,
        sourceType: source.sourceType,
        sourceLabel: source.sourceLabel,
        url: source.url,
        plannedAt: new Date().toISOString(),
      };
      return { proposedOutput: output, diff: { to: output } };
    },
  };
}

export type CultureFetchStatus = "pending" | "fetching" | "fetched" | "failed" | "cancelled";

/**
 * The durable, restart-surviving record binding ONE culture-research
 * source-fetch intent to its exact organization/company/parent+child Run/
 * source/canonical URL/goal+task/skill/actor/proposal, hardened across
 * multiple TASK-011 remediation rounds:
 *  - 2026-07-18 final review, issue 1: durable (MemoryStore-backed, not
 *    process-local), keyed by `childRunId` (stable before any ledger
 *    proposal exists); `getByProposal` fail-closed lookup, no reconstruction.
 *  - 2026-07-19 distributed-defects review: `MemoryStore.compareAndSupersede`
 *    (a REAL cross-instance mutex via a Postgres advisory lock — see
 *    `@bridge/db`'s `DrizzleMemoryStore`) replaces the old process-local
 *    `KeyedAsyncMutex`, so two API instances sharing one database can never
 *    fork a "current" state (issue 1). `leaseOwner`/`leaseExpiresAt`/
 *    `attempt` implement a reclaimable lease so a crashed/expired `fetching`
 *    lease is never permanently orphaned (issue 3). `cancelRequested` is a
 *    DURABLE flag independent of any process-local `AbortController` — the
 *    fetch worker (whichever process holds the live socket) polls this flag
 *    during streaming and aborts its own socket, so cancellation issued from
 *    a DIFFERENT API instance still stops the live fetch (issue 2).
 *    `policySnapshot` pins every security-relevant registry field (not just
 *    the URL) so materialize can detect a policy change between propose and
 *    materialize even at the SAME URL (issue 7).
 */
export interface CultureFetchIntentRecord {
  /** TASK-011 remediation (2026-07-19, issue 13) — a cheap, explicit
   * discriminator so `DurableCultureFetchStore`/`DurableCultureSynthesisPointerStore`
   * (which share the SAME underlying `MemoryStore` and both key rows by a
   * caller-chosen UUID `subjectRecordId`) can never misinterpret the
   * other's row even in the astronomically unlikely event a `parentRunId`
   * and an unrelated `childRunId` collide. Every reader checks this before
   * trusting the parsed content. */
  kind: "culture_fetch_intent";
  childRunId: string;
  proposalId: string | null;
  parentRunId: string;
  organizationId: string;
  company: string;
  sourceId: string;
  sourceType: CultureSourceType;
  sourceLabel: string;
  /** Pinned from the registry at record-creation time. `materialize`
   * re-resolves the CURRENT registry entry and rejects if `policySnapshot`
   * no longer matches — never trusts this value alone as "still authorized". */
  canonicalUrl: string;
  allowedRedirectOrigins: readonly string[];
  /** TASK-011 remediation (2026-07-19, issue 7) — full security-policy
   * snapshot taken at propose() time; see `computeSourcePolicyHash`. */
  policySnapshot: {
    registryVersion: string;
    eligibility: CultureSourceEligibility;
  };
  goalId: string;
  taskId: string;
  skill: "jobpilot.researchCultureSource";
  action: "read";
  actorId: string;
  status: CultureFetchStatus;
  /** TASK-011 remediation (2026-07-19, issue 2) — durable cancellation
   * intent, set regardless of which process is holding (or ever held) the
   * live fetch. */
  cancelRequested: boolean;
  /** TASK-011 remediation (2026-07-19, issue 3) — lease/reclaim fields. A
   * `fetching` record is only "live" while `leaseOwner` is set and
   * `leaseExpiresAt` is in the future; otherwise it is an orphan another
   * attempt may reclaim. */
  leaseOwner: string | null;
  leaseExpiresAt: string | null;
  attempt: number;
  result?: CultureResultRef;
  error?: string;
  createdAt: string;
  updatedAt: string;
}

/** A transition attempted against a record that is not in one of the
 * expected `fromStatuses` — TASK-011 remediation (2026-07-18 final review,
 * issue 4). Distinct from a generic Error so callers can swallow ONLY this
 * specific, expected race (e.g. cancel racing an already-terminal fetch)
 * and surface everything else. */
export class CultureFetchAlreadyTerminalError extends Error {
  constructor(
    public readonly childRunId: string,
    public readonly currentStatus: CultureFetchStatus,
  ) {
    super(`culture-fetch intent for child Run ${childRunId} is already "${currentStatus}"`);
    this.name = "CultureFetchAlreadyTerminalError";
  }
}

/** Thrown when a lease-guarded transition finds the record is currently
 * held by a DIFFERENT, still-live lease (`leaseOwner` set and
 * `leaseExpiresAt` in the future) — a genuinely different failure mode from
 * "already terminal": the fetch is legitimately in flight elsewhere and this
 * caller may not act on it (yet). */
export class CultureFetchLeaseHeldError extends Error {
  constructor(
    public readonly childRunId: string,
    public readonly leaseOwner: string,
    public readonly leaseExpiresAt: string,
  ) {
    super(`culture-fetch intent for child Run ${childRunId} is held by a live lease (${leaseOwner}, expires ${leaseExpiresAt})`);
    this.name = "CultureFetchLeaseHeldError";
  }
}

/**
 * Thrown when a lease-FENCED terminal transition (`transition(..., fence)`)
 * finds the record's CURRENT `leaseOwner`/`attempt` no longer matches the
 * caller's own — TASK-011 remediation (2026-07-19 coordinator
 * distributed-defects RE-review, issue 1). This is DIFFERENT from
 * `CultureFetchAlreadyTerminalError` (status mismatch) and
 * `CultureFetchLeaseHeldError` (a live lease blocks a NEW acquire): the
 * record may still legitimately read "fetching" — status alone is NOT
 * enough to prove this caller still owns the fetch. A stale/reclaimed
 * worker (its lease expired and a LATER attempt already reclaimed and is
 * now fetching, or has already resolved the record) must never be allowed
 * to write a terminal outcome merely because the status field happens to
 * still say "fetching" — that would let a zombie worker race a legitimate
 * one and non-deterministically clobber its result. */
export class CultureFetchStaleLeaseError extends Error {
  constructor(
    public readonly childRunId: string,
    public readonly expectedLeaseOwner: string,
    public readonly expectedAttempt: number,
    public readonly currentRecord: CultureFetchIntentRecord,
  ) {
    super(
      `culture-fetch intent for child Run ${childRunId}: lease fence mismatch — caller expected leaseOwner "${expectedLeaseOwner}" attempt ${expectedAttempt}, but the current record is leaseOwner "${currentRecord.leaseOwner}" attempt ${currentRecord.attempt} status "${currentRecord.status}" (this worker's lease was reclaimed or the record already resolved; its terminal write must be refused)`,
    );
    this.name = "CultureFetchStaleLeaseError";
  }
}

/**
 * Thrown when a fenced terminal transition to "fetched" or "failed" finds
 * `cancelRequested` is ALREADY true at COMMIT time — TASK-011 remediation
 * (2026-07-19 coordinator distributed-defects RE-review round 2, issue 3).
 * `materializeCultureSourceFetch`'s own `finalCheck` (a plain read of
 * `cancelRequested` right before declaring success) is NOT atomic with the
 * transition's CAS write: a cancel can land in the gap between that read
 * and this call. Folding `cancelRequested === false` INTO the CAS predicate
 * itself (checked atomically alongside the lease fence, and re-checked
 * against the reloaded record on every lost race) closes that TOCTOU
 * window completely — a "fetched"/"failed" write can never durably commit
 * over a cancellation that raced it, however narrow the window. */
export class CultureFetchCancelledRaceError extends Error {
  constructor(
    public readonly childRunId: string,
    public readonly currentRecord: CultureFetchIntentRecord,
  ) {
    super(
      `culture-fetch intent for child Run ${childRunId}: a cancellation was durably requested before this terminal write could commit — refusing to overwrite it with "${currentRecord.status === "fetching" ? "a non-cancel outcome" : currentRecord.status}"`,
    );
    this.name = "CultureFetchCancelledRaceError";
  }
}

/**
 * Durable adapter over `MemoryStore` for culture-fetch intent records.
 * `subjectRecordId` is repurposed as this store's lookup key (`childRunId`)
 * — `MemoryStore` has no arbitrary-field query, but `retrieve({
 * subjectRecordId, includeSuperseded: false })` gives an O(1)-ish current-
 * row lookup, and `supersede`/`compareAndSupersede` give an append-only,
 * auditable revision history for free (every prior status transition
 * remains readable via `includeSuperseded: true`). TASK-011 remediation
 * (2026-07-19 distributed-defects review, issue 1): every mutation now goes
 * through `MemoryStore.compareAndSupersede` — a REAL cross-instance mutex
 * (Postgres advisory lock in the Drizzle adapter) — instead of a
 * process-local `KeyedAsyncMutex`, so two API instances sharing one database
 * can never both win a race and fork a "current" state for the same
 * childRunId. A `MemoryConflictError` from a lost race is treated the same
 * way a lost `KeyedAsyncMutex` race was: reload and report the (now current)
 * terminal/lease state rather than surfacing a raw conflict to callers who
 * don't need to know the storage-level mechanism.
 */
export class DurableCultureFetchStore {
  #memory: MemoryStore;

  constructor(memory: MemoryStore) {
    this.#memory = memory;
  }

  #authScope(organizationId: string): MemoryAuthScope {
    return { organizationId };
  }

  async #loadRow(organizationId: string, childRunId: string): Promise<{ memoryId: string; record: CultureFetchIntentRecord } | null> {
    const rows = await this.#memory.retrieve(
      { subjectRecordId: childRunId, includeSuperseded: false, limit: 1 },
      this.#authScope(organizationId),
    );
    const row = rows[0];
    if (!row) return null;
    const parsed = JSON.parse(row.content) as CultureFetchIntentRecord;
    if (parsed.kind !== "culture_fetch_intent") return null; // a different record type happens to share this subjectRecordId
    return { memoryId: row.id, record: parsed };
  }

  #buildWrite(next: CultureFetchIntentRecord): Parameters<MemoryStore["write"]>[0] {
    return {
      // MUST be a real UUID — `memories.id` is UUID-typed (migrations/000x);
      // a composite string id (an earlier bug this comment replaces) fails
      // every write with a Postgres 22P02 "invalid input syntax for type
      // uuid" error. `childRunId` is kept as `subjectRecordId` (also
      // UUID-typed, but every child-Run id in this codebase already IS a
      // real UUID via `ctx.run.ids.next()`/`uuidv7()`) for the lookup key.
      id: randomUUID(),
      organizationId: next.organizationId,
      type: "episodic",
      subjectRecordId: next.childRunId,
      scope: "organization",
      content: JSON.stringify(next),
      sourceRefType: "ledger",
      sourceRefId: next.proposalId ?? next.childRunId,
      confidence: 1,
      // TASK-011 remediation (2026-07-19 coordinator distributed-defects
      // RE-review, issue 7) — the OUTER `memories` row's own `trustOrigin`
      // column must NEVER read "operator" once its `content` blob embeds
      // real fetched external bytes: a generic Memory-reading caller (one
      // that has no idea this specific store nests an untrusted result
      // inside its JSON content) would otherwise see "operator" and could
      // treat the whole row — bytes included — as trusted/operator-authored,
      // a silent declassification of exactly the taint this field exists to
      // prevent. Before any fetch completes (no `result` yet), the row
      // genuinely IS pure operator/system-authored governance metadata
      // ("a fetch was requested/leased/cancelled") — "operator" is honest
      // then. The moment `result` is populated, the row's OWN trustOrigin
      // flips to `untrusted_external` to match its actual contents.
      trustOrigin: next.result ? "untrusted_external" : "operator",
      taintLabel: next.result
        ? labelAtSource("web_search", {
            ref: next.result.sourceUrl,
            valueHash: next.result.contentHash,
            sensitivity: "public",
            instructionRisk: "data",
          })
        : labelAtSource("system_generated", {
            ref: `culture-fetch-intent:${next.childRunId}`,
            valueHash: hashTaintValue({
              sourceId: next.sourceId,
              status: next.status,
            }),
            sensitivity: "organization",
            instructionRisk: "none",
          }),
      plane: "local",
      createdBy: next.actorId,
    };
  }

  /** Fail-closed lookup by childRunId alone — returns null (never throws) so
   * callers render a uniform "unknown" rather than distinguishing missing
   * from unauthorized. */
  async get(organizationId: string, childRunId: string): Promise<CultureFetchIntentRecord | null> {
    const row = await this.#loadRow(organizationId, childRunId);
    return row?.record ?? null;
  }

  /** The ONE lookup a router caller's (proposalId, childRunId) pair may use.
   * A childRunId whose durable record's OWN `proposalId` does not match the
   * caller-supplied `proposalId` is treated as unknown — never "found, but
   * mismatched", closing the door on pairing an arbitrary proposalId with an
   * unrelated real childRunId. */
  async getByProposal(organizationId: string, proposalId: string, childRunId: string): Promise<CultureFetchIntentRecord | null> {
    const record = await this.get(organizationId, childRunId);
    if (!record || record.proposalId !== proposalId) return null;
    return record;
  }

  /** Creates the durable intent record BEFORE any ledger proposal exists —
   * idempotent: a retry for a childRunId that already has a record returns
   * the EXISTING record unchanged (never duplicates or silently overwrites).
   * TASK-011 remediation (2026-07-19 coordinator distributed-defects
   * RE-review) — uses `MemoryStore.writeIfAbsent` (a real cross-instance
   * lock keyed by `(organizationId, childRunId)`), NOT a plain `write()`: an
   * independent reviewer proved a plain `write()` here cannot detect a
   * concurrent creator racing the SAME childRunId (it has no uniqueness
   * constraint to conflict against), so two racers could both insert a
   * "current" row, breaking the idempotent-create contract this doc comment
   * has always promised. */
  async create(
    input: Omit<
      CultureFetchIntentRecord,
      "kind" | "proposalId" | "status" | "result" | "error" | "createdAt" | "updatedAt" | "cancelRequested" | "leaseOwner" | "leaseExpiresAt" | "attempt"
    >,
  ): Promise<CultureFetchIntentRecord> {
    const now = new Date().toISOString();
    const record: CultureFetchIntentRecord = {
      ...input,
      kind: "culture_fetch_intent",
      proposalId: null,
      status: "pending",
      cancelRequested: false,
      leaseOwner: null,
      leaseExpiresAt: null,
      attempt: 0,
      createdAt: now,
      updatedAt: now,
    };
    const stored = await this.#memory.writeIfAbsent(this.#buildWrite(record));
    return JSON.parse(stored.content) as CultureFetchIntentRecord;
  }

  /** Attaches the ledger `proposalId` once `pipeline.propose()` returns it —
   * the only field this call may change. Idempotent for the SAME id; rejects
   * (fail closed) an attempt to rebind an already-bound record to a
   * DIFFERENT proposal. Cross-instance-safe via `compareAndSupersede`. */
  async attachProposal(organizationId: string, childRunId: string, proposalId: string): Promise<CultureFetchIntentRecord> {
    const existing = await this.#loadRow(organizationId, childRunId);
    if (!existing) throw new Error(`DurableCultureFetchStore: unknown intent record for child Run ${childRunId}`);
    if (existing.record.proposalId === proposalId) return existing.record;
    if (existing.record.proposalId !== null) {
      throw new Error(`DurableCultureFetchStore: child Run ${childRunId} is already bound to a different proposal`);
    }
    const next: CultureFetchIntentRecord = { ...existing.record, proposalId, updatedAt: new Date().toISOString() };
    try {
      await this.#memory.compareAndSupersede(existing.memoryId, this.#buildWrite(next));
    } catch (e) {
      if (e instanceof MemoryConflictError) {
        const reloaded = await this.#loadRow(organizationId, childRunId);
        if (reloaded?.record.proposalId === proposalId) return reloaded.record;
      }
      throw e;
    }
    return next;
  }

  /** Cross-instance-safe compare-and-set: loads the current record, verifies
   * its status is one of `fromStatuses`, applies `mutate`, and persists via
   * `compareAndSupersede`. Throws `CultureFetchAlreadyTerminalError` (never a
   * generic Error) when the record exists but is not in an expected status —
   * whether that was already true when we loaded it, OR a concurrent writer
   * (in this process or another instance) won the race between our load and
   * our write.
   *
   * TASK-011 remediation (2026-07-19 coordinator distributed-defects
   * RE-review, issue 1) — an optional `fence` makes this LEASE-FENCED: when
   * provided, the CAS predicate ALSO requires the record's CURRENT
   * `leaseOwner`/`attempt` to match exactly, not just its status. Status
   * alone ("fetching") cannot prove the caller still legitimately owns the
   * fetch — a stale worker whose lease already expired and was reclaimed by
   * a LATER attempt would otherwise still see "fetching" and be allowed to
   * write a terminal outcome, racing the legitimate current holder
   * non-deterministically. Every terminal write in
   * `materializeCultureSourceFetch` (fetched/failed/cancelled) MUST pass its
   * own `{ leaseOwner, attempt }` here; a fence mismatch throws
   * `CultureFetchStaleLeaseError`, distinct from a plain status mismatch. */
  async transition(
    organizationId: string,
    childRunId: string,
    fromStatuses: readonly CultureFetchStatus[],
    mutate: (record: CultureFetchIntentRecord) => CultureFetchIntentRecord,
    fence?: { leaseOwner: string; attempt: number; requireCancelNotRequested?: boolean },
  ): Promise<CultureFetchIntentRecord> {
    const existing = await this.#loadRow(organizationId, childRunId);
    if (!existing) throw new Error(`DurableCultureFetchStore: unknown intent record for child Run ${childRunId}`);
    if (!fromStatuses.includes(existing.record.status)) {
      throw new CultureFetchAlreadyTerminalError(childRunId, existing.record.status);
    }
    if (fence && (existing.record.leaseOwner !== fence.leaseOwner || existing.record.attempt !== fence.attempt)) {
      throw new CultureFetchStaleLeaseError(childRunId, fence.leaseOwner, fence.attempt, existing.record);
    }
    // TASK-011 remediation (2026-07-19 coordinator distributed-defects
    // RE-review round 2, issue 3) — fold `cancelRequested === false` INTO
    // the SAME atomic CAS predicate as the lease fence, not a separate
    // earlier read. `materializeCultureSourceFetch`'s own `finalCheck` (a
    // plain read right before this call) cannot be atomic with the write
    // that follows it — a cancel landing in that gap must still be able to
    // block this commit, which is only possible if the check happens HERE,
    // at commit time, not before.
    if (fence?.requireCancelNotRequested && existing.record.cancelRequested) {
      throw new CultureFetchCancelledRaceError(childRunId, existing.record);
    }
    const next: CultureFetchIntentRecord = { ...mutate(existing.record), updatedAt: new Date().toISOString() };
    try {
      await this.#memory.compareAndSupersede(existing.memoryId, this.#buildWrite(next));
    } catch (e) {
      if (e instanceof MemoryConflictError) {
        const reloaded = await this.#loadRow(organizationId, childRunId);
        // A lost race here means SOMEONE ELSE'S write won — re-derive the
        // MOST SPECIFIC error against the fresh state: a fence mismatch or
        // a cancellation race is more informative than a generic terminal
        // error when either condition no longer holds.
        if (fence && reloaded && (reloaded.record.leaseOwner !== fence.leaseOwner || reloaded.record.attempt !== fence.attempt)) {
          throw new CultureFetchStaleLeaseError(childRunId, fence.leaseOwner, fence.attempt, reloaded.record);
        }
        if (fence?.requireCancelNotRequested && reloaded?.record.cancelRequested) {
          throw new CultureFetchCancelledRaceError(childRunId, reloaded.record);
        }
        throw new CultureFetchAlreadyTerminalError(childRunId, reloaded?.record.status ?? existing.record.status);
      }
      throw e;
    }
    return next;
  }

  /**
   * TASK-011 remediation (2026-07-19, issue 3) — atomically acquires a
   * fetch lease: succeeds if the record is `pending`, OR if it is `fetching`
   * but the PRIOR lease has EXPIRED (`leaseExpiresAt` in the past — the
   * process that held it crashed or was killed mid-fetch without ever
   * reaching a terminal state). A record with a still-live lease throws
   * `CultureFetchLeaseHeldError` (a different, non-terminal failure mode —
   * the fetch is legitimately in progress elsewhere). Increments `attempt`
   * every time a lease is (re)acquired, for audit/diagnostics. Cross-
   * instance-safe via `compareAndSupersede` — two processes racing to
   * reclaim the SAME expired lease can only ever have one winner.
   */
  async acquireLease(
    organizationId: string,
    childRunId: string,
    leaseOwner: string,
    nowISO: string,
  ): Promise<CultureFetchIntentRecord> {
    const existing = await this.#loadRow(organizationId, childRunId);
    if (!existing) throw new Error(`DurableCultureFetchStore: unknown intent record for child Run ${childRunId}`);
    const record = existing.record;
    if (record.status === "fetching") {
      const leaseLive = record.leaseExpiresAt != null && Date.parse(record.leaseExpiresAt) > Date.parse(nowISO);
      if (leaseLive) {
        throw new CultureFetchLeaseHeldError(childRunId, record.leaseOwner ?? "unknown", record.leaseExpiresAt!);
      }
      // else: expired lease, orphaned — fall through and reclaim it.
    } else if (record.status !== "pending") {
      throw new CultureFetchAlreadyTerminalError(childRunId, record.status);
    }
    if (record.cancelRequested) {
      // A cancel landed before any worker ever claimed this record (or
      // between an expired lease and this reclaim attempt) — honor it
      // immediately rather than starting a doomed fetch.
      throw new CultureFetchAlreadyTerminalError(childRunId, "cancelled");
    }
    const next: CultureFetchIntentRecord = {
      ...record,
      status: "fetching",
      leaseOwner,
      leaseExpiresAt: new Date(Date.parse(nowISO) + CULTURE_FETCH_LEASE_MS).toISOString(),
      attempt: record.attempt + 1,
      updatedAt: nowISO,
    };
    try {
      await this.#memory.compareAndSupersede(existing.memoryId, this.#buildWrite(next));
    } catch (e) {
      if (e instanceof MemoryConflictError) {
        const reloaded = await this.#loadRow(organizationId, childRunId);
        if (reloaded) {
          if (reloaded.record.status === "fetching" && reloaded.record.leaseExpiresAt && Date.parse(reloaded.record.leaseExpiresAt) > Date.now()) {
            throw new CultureFetchLeaseHeldError(childRunId, reloaded.record.leaseOwner ?? "unknown", reloaded.record.leaseExpiresAt);
          }
          throw new CultureFetchAlreadyTerminalError(childRunId, reloaded.record.status);
        }
      }
      throw e;
    }
    return next;
  }

  /** Durably requests cancellation — TASK-011 remediation (2026-07-19,
   * issue 2). Independent of which process (if any) holds the live lease: if
   * the record is still `pending` (no worker has ever claimed it) or its
   * `fetching` lease has already expired (orphaned), cancellation is
   * immediate (transitions straight to `cancelled`). If a lease is
   * currently LIVE, this only sets the durable `cancelRequested` flag — the
   * WORKER holding that lease (in this process or a different one) is
   * responsible for polling this flag and aborting its own socket; see
   * `materializeCultureSourceFetch`'s poll loop. Refuses to rewrite an
   * already-terminal record (no-op, returns it unchanged).
   *
   * TASK-011 remediation (2026-07-19 coordinator distributed-defects
   * RE-review) — this is now a bounded CAS-retry loop, not a single
   * best-effort attempt. An independent reviewer found: if `requestCancel`
   * computes its decision (immediate-cancel vs flag-only) against a
   * snapshot that a CONCURRENT `acquireLease` reclaim then invalidates (the
   * lease was expired/orphaned when read here, but a recovering worker wins
   * the race to reclaim it first), the OLD single-attempt version's
   * `MemoryConflictError` handler just returned the winner's record — a
   * FRESH `fetching` record with `cancelRequested` still false, inherited
   * unmodified from the pre-cancel snapshot — silently dropping the cancel
   * request entirely. Now: on a lost race, RELOAD and RECOMPUTE the decision
   * against the new current record and retry, up to
   * `CULTURE_CANCEL_CAS_MAX_RETRIES` times — exactly the retry-on-conflict
   * pattern the rest of this store's design already relies on elsewhere. */
  async requestCancel(organizationId: string, childRunId: string, nowISO: string): Promise<CultureFetchIntentRecord> {
    let existing = await this.#loadRow(organizationId, childRunId);
    if (!existing) throw new Error(`DurableCultureFetchStore: unknown intent record for child Run ${childRunId}`);
    for (let attempt = 0; attempt < CULTURE_CANCEL_CAS_MAX_RETRIES; attempt++) {
      const record = existing.record;
      if (record.status === "fetched" || record.status === "failed" || record.status === "cancelled") {
        return record; // terminal — cancellation of a resolved source is a no-op
      }
      const leaseLive = record.status === "fetching" && record.leaseExpiresAt != null && Date.parse(record.leaseExpiresAt) > Date.parse(nowISO);
      const next: CultureFetchIntentRecord = leaseLive
        ? { ...record, cancelRequested: true, updatedAt: nowISO }
        : { ...record, status: "cancelled", cancelRequested: true, updatedAt: nowISO };
      try {
        await this.#memory.compareAndSupersede(existing.memoryId, this.#buildWrite(next));
        return next;
      } catch (e) {
        if (!(e instanceof MemoryConflictError)) throw e;
        // Lost the race — RELOAD and RECOMPUTE against the new current
        // record (it may now be terminal, or have a freshly-reclaimed
        // live lease, or already carry cancelRequested from a racing
        // cancel) rather than trusting whatever the winner produced.
        const reloaded = await this.#loadRow(organizationId, childRunId);
        if (!reloaded) throw new Error(`DurableCultureFetchStore: unknown intent record for child Run ${childRunId}`);
        existing = reloaded;
      }
    }
    // Pathological, sustained contention — surface rather than silently
    // dropping the cancel request after exhausting retries.
    throw new Error(`DurableCultureFetchStore: requestCancel could not win the CAS for child Run ${childRunId} after ${CULTURE_CANCEL_CAS_MAX_RETRIES} attempts`);
  }

  /**
   * TASK-011 remediation (2026-07-19 coordinator distributed-defects
   * RE-review, issue 7) — lazily purges an EXPIRED result's raw `content`
   * (keeping `contentHash`/`sourceUrl`/`retrievedAt`/`expiresAt` metadata,
   * which citations/audit still need) the next time this record is READ.
   * There is no background cleanup job in this prototype; purging
   * on-read is what makes "cleanup expired content" a real, enforced
   * property rather than an unenforced doc comment — the very next status
   * read or synthesis attempt after expiry durably clears the bytes,
   * regardless of whether anyone ever explicitly asks for cleanup.
   * Idempotent: a no-op if the result is absent, unexpired, or already
   * purged (empty content).
   *
   * TASK-011 remediation (coordinator central-merge review, issue 2) — the
   * `compareAndSupersede` call below only ever rewrites the CURRENT view
   * (a NEW row, with the OLD "fetched" row — the one that ever held the
   * full raw result bytes — retained as a superseded ancestor). That
   * ancestor row remained durably readable, bytes and all, via
   * `retrieve({ includeSuperseded: true })` forever — a genuine retention
   * gap for exactly the untrusted external content this slice's own
   * expiry/purge design is meant to bound. `redactLineageContent` (called
   * below, in ADDITION to — not instead of — the existing
   * `compareAndSupersede`) walks the WHOLE lineage rooted at this record's
   * current memory row and, for every row whose content still embeds a
   * NOW-expired, non-empty result, rewrites that row's content IN PLACE
   * to the same redacted shape — so no physical row in this record's
   * history can ever again leak the purged bytes, regardless of whether a
   * caller reads the current view or the superseded history.
   */
  async purgeExpiredResultContentIfNeeded(organizationId: string, childRunId: string, nowISO: string): Promise<CultureFetchIntentRecord | null> {
    const existing = await this.#loadRow(organizationId, childRunId);
    if (!existing) return null;
    const { result } = existing.record;
    if (!result || result.content === "" || !isResultExpired(result, nowISO)) return existing.record;
    const next: CultureFetchIntentRecord = {
      ...existing.record,
      result: { ...result, content: "" },
      updatedAt: nowISO,
    };
    try {
      await this.#memory.compareAndSupersede(existing.memoryId, this.#buildWrite(next));
    } catch (e) {
      if (e instanceof MemoryConflictError) {
        // A concurrent writer already changed this record (e.g. a genuine
        // re-fetch reset it, or another purge won) — reload and return
        // whatever is current rather than fighting over a best-effort
        // cleanup. Still attempt the full-lineage redaction below
        // (best-effort, never fatal here) — a concurrent winner may not
        // itself have redacted every ancestor row.
        const reloaded = await this.#loadRow(organizationId, childRunId);
        await this.#redactExpiredResultLineage(organizationId, existing.memoryId, nowISO).catch(() => {});
        return reloaded?.record ?? null;
      }
      throw e;
    }
    await this.#redactExpiredResultLineage(organizationId, existing.memoryId, nowISO);
    return next;
  }

  /** Shared by both the success and `MemoryConflictError` paths above — see
   * `purgeExpiredResultContentIfNeeded`'s own doc comment for the full
   * rationale. `redact` is a PURE function of its input (same entry always
   * produces the same redacted content or the same `null`), which is what
   * makes this safe to call from a losing/conflicting caller too — every
   * caller converges on the identical, correct final state. */
  async #redactExpiredResultLineage(organizationId: string, memoryId: string, nowISO: string): Promise<number> {
    return this.#memory.redactLineageContent(memoryId, this.#authScope(organizationId), (entry) =>
      redactExpiredCultureFetchResult(entry, nowISO),
    );
  }

  /**
   * TASK-011 remediation (2026-07-19 coordinator distributed-defects review,
   * issue 13) — DEPRECATED as of the 2026-07-19 RE-review: this scanned
   * every current `type: "episodic"` Memory in the organization, filtered by
   * `kind`/`company`, and applied a fixed `limit` BEFORE that filter — at
   * scale, enough unrelated episodic Memories (Learning captures, Outreach
   * drafts, anything else sharing this type) could crowd the real latest
   * run entirely out of the scan window, silently hiding it even though it
   * durably exists. Replaced by `DurableCultureLatestRunPointerStore`, an
   * O(1) direct (organizationId, company) -> parentRunId pointer maintained by
   * `propose()` — no scan, no limit-before-filter, no way for unrelated
   * Memories to hide anything. Kept only as a documented historical marker
   * of the superseded approach; no production call site uses this anymore.
   */
  async listByCompany(organizationId: string, company: string): Promise<CultureFetchIntentRecord[]> {
    const rows = await this.#memory.retrieve(
      { type: "episodic", includeSuperseded: false, limit: CULTURE_RESEARCH_HISTORY_SCAN_LIMIT },
      this.#authScope(organizationId),
    );
    const records: CultureFetchIntentRecord[] = [];
    for (const row of rows) {
      let parsed: CultureFetchIntentRecord;
      try {
        parsed = JSON.parse(row.content) as CultureFetchIntentRecord;
      } catch {
        continue; // foreign/corrupt content sharing this organization+type — skip, never throw
      }
      if (parsed.kind === "culture_fetch_intent" && parsed.company === company) records.push(parsed);
    }
    return records;
  }
}

/**
 * TASK-011 remediation (2026-07-19 coordinator distributed-defects review,
 * issue 13) — a tiny durable pointer from a culture-research parent Run to
 * its (at most one, per this slice's flow) synthesis proposal id, so the web
 * UI can resume "synthesis already proposed/approved" state without a
 * client-supplied pointer. Shares the SAME `MemoryStore` as
 * `DurableCultureFetchStore` (no new migration), keyed by `parentRunId`
 * (already a real UUID — `uuidv7()` in `propose()`) rather than a composite
 * string, since `subjectRecordId` is UUID-typed in the persistent adapter.
 * The `kind` discriminator prevents ever misreading a `CultureFetchIntentRecord`
 * that happens to share the same `subjectRecordId` value (see that type's
 * doc comment) — vanishingly unlikely, but checked rather than assumed.
 */
export interface CultureSynthesisPointerRecord {
  kind: "culture_synthesis_pointer";
  parentRunId: string;
  organizationId: string;
  company: string;
  proposalId: string;
  createdAt: string;
}

export class DurableCultureSynthesisPointerStore {
  #memory: MemoryStore;

  constructor(memory: MemoryStore) {
    this.#memory = memory;
  }

  #authScope(organizationId: string): MemoryAuthScope {
    return { organizationId };
  }

  /** Records (idempotently — first write wins) the synthesis proposal id for
   * one parent Run. A caller attempting to bind a DIFFERENT proposalId to an
   * already-pointed parentRunId is rejected — a parent Run has at most one
   * live synthesis proposal in this slice's flow; re-synthesizing the same
   * run is not a supported path yet, so silently overwriting the pointer
   * would let a stale client resume the WRONG proposal.
   * TASK-011 remediation (2026-07-19 coordinator distributed-defects
   * RE-review) — uses `MemoryStore.writeIfAbsent` (cross-instance-safe,
   * keyed by `(organizationId, parentRunId)`), NOT a plain read-then-write: an
   * independent reviewer proved the original read-then-write here was a
   * genuine TOCTOU — two ordinary concurrent `synthesize` calls for the SAME
   * parentRunId (e.g. a user double-submitting, or two open tabs) could both
   * observe "nothing exists yet" and both insert a "current" pointer row,
   * silently orphaning one of the two synthesis proposals from the
   * server-authoritative resume flow. `writeIfAbsent` guarantees exactly one
   * insert wins; the loser's proposal is still a REAL, valid ledger entry
   * (nothing here corrupts it) — it is simply not the one `latestRun`
   * resolves, matching the documented "at most one live pointer" invariant. */
  async recordProposal(organizationId: string, parentRunId: string, company: string, proposalId: string): Promise<void> {
    const record: CultureSynthesisPointerRecord = {
      kind: "culture_synthesis_pointer",
      parentRunId,
      organizationId,
      company,
      proposalId,
      createdAt: new Date().toISOString(),
    };
    const stored = await this.#memory.writeIfAbsent({
      id: randomUUID(),
      organizationId,
      type: "episodic",
      subjectRecordId: parentRunId,
      scope: "organization",
      content: JSON.stringify(record),
      sourceRefType: "ledger",
      sourceRefId: proposalId,
      confidence: 1,
      trustOrigin: "operator",
      plane: "local",
      createdBy: "internal_strategist",
    });
    const won = JSON.parse(stored.content) as CultureSynthesisPointerRecord;
    if (won.proposalId !== proposalId) {
      // A concurrent caller's write won the race for this parentRunId — the
      // CALLER's own proposal is still real and durable in the ledger, just
      // not the one the pointer resolves to. Fail closed rather than
      // silently pretending this call's proposal is now the resolvable one.
      throw new Error(`DurableCultureSynthesisPointerStore: parent Run ${parentRunId} is already pointed at a different synthesis proposal`);
    }
  }

  async getForParentRun(organizationId: string, parentRunId: string): Promise<CultureSynthesisPointerRecord | null> {
    const rows = await this.#memory.retrieve(
      { subjectRecordId: parentRunId, includeSuperseded: false, limit: 1 },
      this.#authScope(organizationId),
    );
    const row = rows[0];
    if (!row) return null;
    let parsed: CultureSynthesisPointerRecord;
    try {
      parsed = JSON.parse(row.content) as CultureSynthesisPointerRecord;
    } catch {
      return null;
    }
    return parsed.kind === "culture_synthesis_pointer" ? parsed : null;
  }

  /**
   * Compensates a `recordProposal` call whose corresponding `pipeline.propose`
   * never actually produced a usable ledger proposal (e.g. the Skill threw
   * synchronously — a claim-grounding failure — before any ledger append, or
   * `propose` returned a `#reject`-path rejection whose real ledger row bears
   * a DIFFERENT, auto-generated id). Without this, preallocating the pointer
   * BEFORE `propose` (issue 7's fix for the append-without-pointer crash
   * window) would let one failed synthesis attempt permanently poison the
   * first-write-wins pointer for that parentRunId, blocking every future
   * legitimate retry. Only releases the row if it STILL points to exactly
   * the id this caller itself just bound — never a different (later, or
   * concurrently-won) pointer — so a genuine race winner is never disturbed.
   *
   * TASK-011 remediation (2026-07-19 coordinator distributed-defects
   * RE-review round 2, issue 7 — hardened AGAIN after a second independent
   * review found even the grace-period fix left a narrow gap: the caller's
   * own separate `ledger.get(...)` check and this method's row-fetch are two
   * independent round-trips, so a `pipeline.propose` call that happens to
   * complete in the microsecond window between them could still have its
   * pointer wrongly released. The `ledger` param below makes THIS method
   * perform its OWN final `ledger.get` check, immediately adjacent to the
   * actual `forget()` write — minimizing (not eliminating; these are two
   * genuinely separate stores with no shared transaction) the window to the
   * smallest achievable without a cross-store distributed lock, which is
   * disproportionate for a race this narrow.
   */
  async releaseIfMatching(organizationId: string, parentRunId: string, proposalId: string, ledger: LedgerStore): Promise<void> {
    const rows = await this.#memory.retrieve(
      { subjectRecordId: parentRunId, includeSuperseded: false, limit: 1 },
      this.#authScope(organizationId),
    );
    const row = rows[0];
    if (!row) return;
    let parsed: CultureSynthesisPointerRecord;
    try {
      parsed = JSON.parse(row.content) as CultureSynthesisPointerRecord;
    } catch {
      return;
    }
    if (parsed.kind !== "culture_synthesis_pointer" || parsed.proposalId !== proposalId) return;
    // Final, last-possible-moment re-check — the proposal may have been
    // created by its owner's `pipeline.propose` call in the time since the
    // caller's own earlier check.
    if (await ledger.get(proposalId)) return;
    await this.#memory.forget(row.id, this.#authScope(organizationId));
  }
}

/**
 * TASK-011 remediation (2026-07-19 coordinator distributed-defects RE-review
 * round 2, issue 7 — hardened after a fresh independent review found the
 * original self-heal check unsafe). Releases a synthesis-pointer ONLY when
 * its proposalId genuinely appears dead: it does not resolve in the ledger
 * AND the pointer itself is older than `CULTURE_SYNTHESIS_POINTER_DEAD_GRACE_MS`.
 * The age check is essential — see the constant's own doc comment for why a
 * bare "ledger.get returned null" check is unsafe (it cannot distinguish a
 * genuinely dead pointer from a live, in-flight `pipeline.propose` call that
 * simply hasn't reached `#appendLedger` yet). Call this BEFORE preallocating
 * a new pointer for the same parentRunId; a pointer that is not (yet)
 * eligible for release is left completely untouched, and `recordProposal`'s
 * own first-write-wins semantics correctly reject the new attempt in that
 * case (the ordinary, expected "someone else is already synthesizing this
 * run" outcome).
 */
export async function selfHealDeadSynthesisPointer(
  deps: { cultureSynthesisPointerStore: DurableCultureSynthesisPointerStore; ledger: LedgerStore },
  organizationId: string,
  parentRunId: string,
  nowISO: string,
): Promise<void> {
  const existingPointer = await deps.cultureSynthesisPointerStore.getForParentRun(organizationId, parentRunId);
  if (!existingPointer) return;
  const ageMs = Date.parse(nowISO) - Date.parse(existingPointer.createdAt);
  if (ageMs < CULTURE_SYNTHESIS_POINTER_DEAD_GRACE_MS) return; // too young to safely presume dead — a live propose() may still be in flight
  if (await deps.ledger.get(existingPointer.proposalId)) return; // resolves in the ledger — genuinely live (or was already properly decided), not dead
  // `releaseIfMatching` performs its OWN final ledger re-check immediately
  // before the actual release write — see its doc comment.
  await deps.cultureSynthesisPointerStore.releaseIfMatching(organizationId, parentRunId, existingPointer.proposalId, deps.ledger).catch(() => {});
}

/**
 * Deterministic (NOT random/unpredictable) UUID derived from an arbitrary
 * string via SHA-256, with RFC 4122 version/variant bits set so it is
 * always syntactically a valid UUID — TASK-011 remediation (2026-07-19
 * coordinator distributed-defects RE-review, issue 13). Used ONLY to derive
 * a stable `subjectRecordId` key from a non-UUID business key (a company
 * name) for `DurableCultureLatestRunPointerStore`, whose backing
 * `memories.subject_record_id` column is UUID-typed. NEVER use this where
 * unpredictability matters (e.g. a real record id) — it is a pure,
 * repeatable hash, by design (the whole point is that the SAME
 * (organizationId, company) always derives the SAME lookup key).
 */
function deterministicUuidFromString(input: string): string {
  const hex = createHash("sha256").update(input).digest("hex");
  const versionNibble = "5"; // marks this as a derived/non-random UUID, not a real v4 id
  const variantNibble = ((parseInt(hex[16]!, 16) & 0x3) | 0x8).toString(16);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${versionNibble}${hex.slice(13, 16)}-${variantNibble}${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

/**
 * TASK-011 remediation (2026-07-19 coordinator distributed-defects
 * RE-review, issue 13) — a durable, O(1)-lookup pointer from
 * (organizationId, company) directly to the LATEST culture-research parent
 * Run id, replacing `DurableCultureFetchStore.listByCompany`'s organization-
 * wide scan-then-filter-then-limit approach. That approach filtered
 * `kind`/`company` AFTER applying a fixed `limit` to a broad `type:
 * "episodic"` query — at scale, with enough UNRELATED episodic Memories
 * (Learning captures, Outreach drafts, anything else sharing this type),
 * the real latest run could be crowded out of the scan window entirely
 * and silently "hidden" from `latestRun`, even though it durably exists.
 * This pointer sidesteps scanning altogether: `propose()` updates it
 * (via `compareAndSupersede` — the newest run legitimately SUPERSEDES the
 * pointer, unlike the synthesis pointer's first-write-wins semantics)
 * every time a new parent Run is created for a company, so `latestRun` is
 * a direct, indexed lookup keyed by a deterministic UUID derived from
 * `(organizationId, company)` — never a broad table scan.
 */
export interface CultureLatestRunPointerRecord {
  kind: "culture_latest_run_pointer";
  organizationId: string;
  company: string;
  parentRunId: string;
  updatedAt: string;
}

export class DurableCultureLatestRunPointerStore {
  #memory: MemoryStore;

  constructor(memory: MemoryStore) {
    this.#memory = memory;
  }

  #authScope(organizationId: string): MemoryAuthScope {
    return { organizationId };
  }

  #key(organizationId: string, company: string): string {
    return deterministicUuidFromString(`culture_latest_run_pointer:${organizationId}:${company}`);
  }

  #buildWrite(record: CultureLatestRunPointerRecord, subjectRecordId: string): Parameters<MemoryStore["write"]>[0] {
    return {
      id: randomUUID(),
      organizationId: record.organizationId,
      type: "episodic",
      subjectRecordId,
      scope: "organization",
      content: JSON.stringify(record),
      sourceRefType: "ledger",
      sourceRefId: record.parentRunId,
      confidence: 1,
      trustOrigin: "operator",
      plane: "local",
      createdBy: "internal_strategist",
    };
  }

  /** Records `parentRunId` as the latest run for this (organizationId,
   * company), superseding whatever pointer existed before (a NEWER run
   * legitimately replaces an older pointer — unlike the synthesis
   * pointer's first-write-wins invariant). Cross-instance-safe: uses
   * `writeIfAbsent` for the FIRST-ever pointer, then `compareAndSupersede`
   * to advance it. A lost race here is benign — whichever concurrent
   * `propose()` call's run is genuinely newer should win, but even if the
   * "wrong" of two near-simultaneous proposals wins the pointer, both
   * runs remain fully durable and independently resumable by their own
   * `parentRunId`; only the resume-shortcut pointer is affected. */
  async recordLatestRun(organizationId: string, company: string, parentRunId: string): Promise<void> {
    const subjectRecordId = this.#key(organizationId, company);
    const record: CultureLatestRunPointerRecord = {
      kind: "culture_latest_run_pointer",
      organizationId,
      company,
      parentRunId,
      updatedAt: new Date().toISOString(),
    };
    const rows = await this.#memory.retrieve({ subjectRecordId, includeSuperseded: false, limit: 1 }, this.#authScope(organizationId));
    const existing = rows[0];
    if (!existing) {
      await this.#memory.writeIfAbsent(this.#buildWrite(record, subjectRecordId));
      return;
    }
    try {
      await this.#memory.compareAndSupersede(existing.id, this.#buildWrite(record, subjectRecordId));
    } catch (e) {
      if (e instanceof MemoryConflictError) return; // a concurrent, equally-valid advance already won — benign
      throw e;
    }
  }

  async getLatestRun(organizationId: string, company: string): Promise<CultureLatestRunPointerRecord | null> {
    const subjectRecordId = this.#key(organizationId, company);
    const rows = await this.#memory.retrieve({ subjectRecordId, includeSuperseded: false, limit: 1 }, this.#authScope(organizationId));
    const row = rows[0];
    if (!row) return null;
    let parsed: CultureLatestRunPointerRecord;
    try {
      parsed = JSON.parse(row.content) as CultureLatestRunPointerRecord;
    } catch {
      return null;
    }
    return parsed.kind === "culture_latest_run_pointer" && parsed.company === company ? parsed : null;
  }
}

/**
 * Attempts a LEASE-FENCED (and, when requested, cancellation-fenced)
 * terminal transition (see `DurableCultureFetchStore.transition`'s `fence`
 * param) — TASK-011 remediation (2026-07-19 coordinator distributed-defects
 * RE-review, issue 1; hardened again round 2, issues 3/4). If the fence no
 * longer matches (a concurrent cancel, OR — critically — a DIFFERENT
 * attempt that reclaimed this lease after this caller's own lease silently
 * expired, already resolved, or a cancellation raced the commit), this
 * caller has NO authority to write a terminal outcome OR to touch the
 * child Run's own lifecycle.
 *
 * Returns `{ committed, record }` rather than the record alone — TASK-011
 * remediation (round 2, issue 4): a caller that only inspected "is the
 * returned record non-null" could not tell whether IT won the CAS or was
 * merely observing a DIFFERENT winner's result, and would go on to call
 * `completeChildAgentRun`/`failChildAgentRun`/`cancelChildAgentRun`
 * regardless — a genuinely possible race where a STALE loser's child-Run
 * lifecycle call could still win the CHILD RUN's own (separate) CAS before
 * the true winner gets to it, leaving the child Run "completed" even
 * though the real winning intent transition had not yet happened (or could
 * still fail). Every caller MUST gate its own child-Run lifecycle call on
 * `committed === true`.
 */
async function attemptFencedTerminalTransition(
  fetchStore: DurableCultureFetchStore,
  organizationId: string,
  childRunId: string,
  mutate: (record: CultureFetchIntentRecord) => CultureFetchIntentRecord,
  fence: { leaseOwner: string; attempt: number; requireCancelNotRequested?: boolean },
): Promise<{ committed: boolean; record: CultureFetchIntentRecord | null }> {
  try {
    const record = await fetchStore.transition(organizationId, childRunId, ["fetching"], mutate, fence);
    return { committed: true, record };
  } catch (e) {
    if (e instanceof CultureFetchAlreadyTerminalError || e instanceof CultureFetchStaleLeaseError || e instanceof CultureFetchCancelledRaceError) {
      return { committed: false, record: await fetchStore.get(organizationId, childRunId) };
    }
    throw e;
  }
}

/**
 * TASK-011 remediation (2026-07-19 coordinator distributed-defects
 * RE-review, issue 3) — the culture-fetch intent record (`MemoryStore`-
 * backed) and its child Run (`ChildAgentRunStore`-backed) are TWO SEPARATE
 * durable writes with no shared transaction linking them (different
 * backing stores). A crash between the intent's terminal write and the
 * child Run's corresponding terminal write leaves them durably
 * inconsistent — e.g. a "fetched" intent whose child Run still reads
 * "running", or a "failed" intent whose child Run was somehow left
 * "completed". Rather than a background reconciliation job (no such
 * infrastructure exists in this prototype), this SELF-REPAIRS
 * deterministically on every read that matters: call this before trusting
 * an intent's terminal status for anything (a `materialize` retry hitting
 * the already-terminal early-return, or the `status` router query a client
 * polls). Idempotent — re-driving an already-consistent pair is a no-op
 * (the underlying `ChildRunAlreadyTerminalError` races are swallowed, exactly
 * as the live-fetch completion path already does).
 */
export async function reconcileIntentChildConsistency(
  deps: { childAgentRuns: ChildAgentRunStore; ledger: LedgerStore },
  organizationId: string,
  intent: CultureFetchIntentRecord,
  ctx: RunCtx,
): Promise<void> {
  if (intent.status !== "fetched" && intent.status !== "failed" && intent.status !== "cancelled") {
    return; // not yet terminal — nothing to reconcile
  }
  const childRun = await deps.childAgentRuns.get(organizationId, intent.childRunId);
  if (!childRun) return; // nothing to reconcile against
  const desiredChildStatus = intent.status === "fetched" ? "completed" : intent.status === "failed" ? "failed" : "cancelled";
  if (childRun.status === desiredChildStatus) return; // already consistent
  const actor: Actor = { type: "agent", id: LEARNING_AGENT };
  const repair =
    desiredChildStatus === "completed"
      ? completeChildAgentRun({ store: deps.childAgentRuns, ledger: deps.ledger }, organizationId, intent.childRunId, actor, ctx)
      : desiredChildStatus === "failed"
        ? failChildAgentRun({ store: deps.childAgentRuns, ledger: deps.ledger }, organizationId, intent.childRunId, actor, ctx)
        : cancelChildAgentRun({ store: deps.childAgentRuns, ledger: deps.ledger }, organizationId, intent.childRunId, actor, ctx);
  await repair.catch((e) => {
    // The child Run may have reached SOME OTHER terminal status via a
    // legitimate concurrent transition (e.g. a genuine cancel racing this
    // repair) — that is itself a resolved, consistent-enough state; only an
    // unexpected error needs to surface. TASK-011 remediation (coordinator
    // central-merge review, issue 1): also swallow
    // `ChildRunTerminalAuditPendingError` — it means the underlying
    // transition genuinely SUCCEEDED and only its confirming audit append
    // is pending (self-heals the next time this run is touched); treating
    // it as a real failure here would wrongly surface a successful effect
    // as an error.
    if (!(e instanceof ChildRunAlreadyTerminalError) && !(e instanceof ChildRunTerminalAuditPendingError)) throw e;
  });
}

/**
 * Performs the REAL, guarded fetch for one already-approved culture-research
 * proposal. Hardened across multiple TASK-011 remediation rounds; as of the
 * 2026-07-19 coordinator distributed-defects review:
 *  - acquires a durable, reclaimable LEASE (`DurableCultureFetchStore.acquireLease`)
 *    instead of a bare status flip — a crashed/expired lease is reclaimable
 *    by a later attempt, never permanently orphaned (issue 3).
 *  - re-validates the source's CURRENT security policy against the
 *    `policySnapshot` pinned at propose() time — a registry change (e.g. a
 *    source reclassified from `permitted` to `do_not_use`) fails closed even
 *    at the SAME URL, never trusted via a URL-only comparison (issue 7).
 *  - polls the DURABLE `cancelRequested` flag WHILE streaming so a
 *    cancellation issued through a DIFFERENT API instance still aborts this
 *    process's live socket — the process-local `AbortController` is an
 *    optimization, not the authority (issue 2).
 *  - tags the fetched result `trustOrigin: "untrusted_external"` with a
 *    bounded retention window — fetched bytes are untrusted external data,
 *    never silently declassified as operator-authored (issue 8).
 *  - EVERY terminal write (fetched/failed/cancelled) is LEASE-FENCED: it
 *    only succeeds if this caller's own `{leaseOwner, attempt}` is still the
 *    record's current one, so a stale/reclaimed worker can never clobber a
 *    later legitimate attempt's outcome merely because the status field
 *    still happened to read "fetching" (RE-review issue 1).
 *  - budget reservation is IDEMPOTENT per child Run: if `childRun.callsUsed`
 *    already shows a reservation (a prior, possibly-crashed attempt already
 *    consumed it), a reclaiming attempt reuses it — validate-only, never
 *    reserve twice — so a crash-after-reserve can never permanently exhaust
 *    the fixed `maxCalls: 1` budget and block every future retry
 *    (RE-review issue 2).
 * Never called during `propose()`; only the router calls this, and only
 * after confirming the ledger holds an "approve" decision for `proposalId`.
 * Idempotent: a proposal whose fetch already resolved (fetched/failed/
 * cancelled) returns the stored record rather than re-fetching.
 */
export async function materializeCultureSourceFetch(
  deps: {
    childAgentRuns: ChildAgentRunStore;
    ledger: LedgerStore;
    fetchStore: DurableCultureFetchStore;
    abortControllers: Map<string, AbortController>;
  },
  organizationId: string,
  proposalId: string,
  childRunId: string,
  ctx: RunCtx,
  /** TEST-ONLY passthrough to `guardedFetch`'s block-list override — NEVER
   * wired through the router (production callers never supply this); exists
   * so tests can exercise this function's real reservation/idempotency/
   * completion logic against a real local test server instead of the live
   * internet, without weakening the guard for any real call site. */
  unsafeTestOverrides?: import("@bridge/net-guard").UnsafeTestOverrides,
): Promise<CultureFetchIntentRecord> {
  // Fail-closed load — the ONLY source of truth. No fallback reconstructs a
  // record from `proposedOutput`; an unknown or mismatched (proposalId,
  // childRunId) pair is rejected outright (TASK-011 remediation, issue 1).
  const record = await deps.fetchStore.getByProposal(organizationId, proposalId, childRunId);
  if (!record) {
    throw new Error(`materializeCultureSourceFetch: unknown or mismatched culture-fetch intent for proposal "${proposalId}" / child Run "${childRunId}"`);
  }
  if (record.status !== "pending" && record.status !== "fetching") {
    // TASK-011 remediation (2026-07-19 RE-review, issue 3) — self-repair any
    // intent/child inconsistency BEFORE trusting this terminal record.
    await reconcileIntentChildConsistency(deps, organizationId, record, ctx);
    return record; // idempotent — already terminally resolved
  }

  const decisionRow = await deps.ledger.decisionFor(proposalId);
  if (!decisionRow || decisionRow.userDecision !== "approve") {
    throw new Error(`materializeCultureSourceFetch: proposal ${proposalId} is not in an approved state`);
  }
  const proposalRow = await deps.ledger.get(proposalId);
  if (!proposalRow) {
    throw new Error(`materializeCultureSourceFetch: unknown proposal ${proposalId}`);
  }
  // Cross-validate the IMMUTABLE ledger proposal against the durable
  // record's OWN binding — the proposal's `inputs`/`proposedOutput`/context
  // must agree with what the intent record already knows; the ledger row is
  // corroborating evidence, never the primary source of truth for what gets
  // fetched (that is `record.canonicalUrl`, re-checked against the registry
  // below). `LedgerEntry` has no `skill` field of its own, so the Skill's
  // identity is corroborated via its declared `action`/`resourceType`
  // instead.
  const proposedIntent = proposalRow.proposedOutput as ResearchCultureSourceIntentOutput;
  const proposalInputs = proposalRow.inputs as Partial<ResearchCultureSourceInput> | null;
  if (
    proposalRow.organizationId !== organizationId ||
    proposalRow.action !== record.action ||
    proposalRow.resourceType !== "external:fetch" ||
    !proposalInputs ||
    proposalInputs.sourceId !== record.sourceId ||
    proposalInputs.company !== record.company ||
    proposedIntent.sourceId !== record.sourceId ||
    proposalRow.context?.type !== "child_agent_run" ||
    proposalRow.context.id !== childRunId
  ) {
    throw new Error(`materializeCultureSourceFetch: proposal ${proposalId} does not match its bound culture-fetch intent record`);
  }

  // TASK-011 remediation (2026-07-19, issue 7) — re-resolve the CURRENT
  // registry entry fresh and recompute its FULL security-policy hash; a
  // URL-only comparison cannot detect an eligibility/redirect-origin policy
  // change at the SAME URL (e.g. a source reclassified permitted ->
  // do_not_use after propose() but before materialize()) — fail closed and
  // require a fresh proposal/approval rather than trusting the stale pin.
  const currentSource = resolveAuthorizedCultureSource(organizationId, record.company, record.sourceId);
  if (!currentSource || currentSource.url !== record.canonicalUrl) {
    throw new Error(`materializeCultureSourceFetch: source "${record.sourceId}" is no longer authorized with its pinned canonical URL`);
  }
  const currentPolicyHash = computeSourcePolicyHash(currentSource);
  if (currentPolicyHash !== record.policySnapshot.registryVersion) {
    throw new Error(
      `materializeCultureSourceFetch: source "${record.sourceId}"'s security policy changed since this proposal was approved (registry version drift) — a fresh proposal/approval is required`,
    );
  }

  // TASK-011 remediation (2026-07-19, issue 3) — acquire a reclaimable
  // lease instead of a bare status CAS. A concurrent acquirer (this
  // process racing itself, or a DIFFERENT API instance) can only ever have
  // ONE winner, cross-instance-safe via `compareAndSupersede`.
  const leaseOwner = randomUUID();
  let fetching: CultureFetchIntentRecord;
  try {
    fetching = await deps.fetchStore.acquireLease(organizationId, childRunId, leaseOwner, ctx.clock.nowISO());
  } catch (error) {
    if (error instanceof CultureFetchAlreadyTerminalError) {
      const current = await deps.fetchStore.get(organizationId, childRunId);
      if (current) return current;
    }
    if (error instanceof CultureFetchLeaseHeldError) {
      // A DIFFERENT worker (this process or another instance) genuinely
      // holds a live lease right now — this is not an error condition for
      // the caller; report the current (in-flight) record rather than
      // throwing, since nothing is actually wrong.
      const current = await deps.fetchStore.get(organizationId, childRunId);
      if (current) return current;
    }
    throw error;
  }

  // TASK-011 remediation (2026-07-18 fresh review) — register the
  // AbortController IMMEDIATELY after the lease is acquired, with NO
  // intervening `await`, and BEFORE `reserveChildRunAction` (a genuine
  // suspension point) — closes the "cancel finds nothing to abort yet"
  // window from earlier rounds.
  const abortController = new AbortController();
  deps.abortControllers.set(childRunId, abortController);

  // TASK-011 remediation (2026-07-19, issue 2) — distributed-cancellation
  // poll: the process-local AbortController map is only ever populated in
  // THIS process, so a cancel durably recorded via a DIFFERENT API instance
  // would never reach it directly. Poll the DURABLE record's
  // `cancelRequested` flag while the fetch is in flight and abort our own
  // local socket the moment we observe it — this is what makes cancellation
  // authoritative across instances, not merely within one process.
  const cancelPoll = setInterval(() => {
    if (abortController.signal.aborted) return;
    deps.fetchStore
      .get(organizationId, childRunId)
      .then((current) => {
        if (current?.cancelRequested && !abortController.signal.aborted) {
          abortController.abort();
        }
      })
      .catch(() => {
        // Best-effort — a transient poll failure must never crash the fetch;
        // the NEXT poll tick (or the final pre-completion check below) will
        // catch a durable cancellation either way.
      });
  }, CULTURE_CANCEL_POLL_MS);

  try {
    // TASK-011 remediation (2026-07-19 coordinator distributed-defects
    // RE-review, issue 2) — IDEMPOTENT budget reservation. `budget:
    // {maxCalls:1, maxCost:1}` is fixed per child Run (one Run == one
    // source's single fetch attempt), so the child Run's OWN durable
    // `callsUsed` field IS the natural idempotency key — no new token is
    // needed. If a PRIOR (possibly crashed) attempt already reserved
    // (`callsUsed > 0`), this reclaiming attempt must REUSE that
    // reservation — validate-only (`validateActionWithinChildRun`, no
    // consume) — rather than calling `reserveChildRunAction` again, which
    // would either double-charge (impossible here since `consumeBudget` is
    // itself atomically guarded) or, far worse, FAIL with
    // budget-exhausted and permanently strand every future retry even
    // though the real network fetch has never yet succeeded.
    const childRunBeforeReserve = await deps.childAgentRuns.get(organizationId, childRunId);
    if (!childRunBeforeReserve) {
      throw new Error(`materializeCultureSourceFetch: unknown child Run ${childRunId}`);
    }
    const actionCheck = { action: "read", resourceType: "external:fetch", skill: "jobpilot.researchCultureSource", dataScope: "public" as const };
    const violation =
      childRunBeforeReserve.callsUsed > 0
        ? validateActionWithinChildRun(actionCheck, childRunBeforeReserve, ctx.clock.nowISO(), 0, { reusingExistingReservation: true })
        : await reserveChildRunAction(deps.childAgentRuns, organizationId, childRunId, actionCheck, 1, ctx.clock.nowISO());
    if (violation) {
      deps.abortControllers.delete(childRunId);
      const afterViolation = await attemptFencedTerminalTransition(
        deps.fetchStore,
        organizationId,
        childRunId,
        (r) => ({ ...r, status: "failed", error: `${violation.reason}: ${violation.detail}` }),
        { leaseOwner, attempt: fetching.attempt },
      );
      // The violation (e.g. "run-not-active") can itself be a SYMPTOM of a
      // concurrent cancel/reclaim having already resolved this record —
      // that outcome must win; return it rather than throwing a "rejected"
      // error that would mask it.
      if (afterViolation.record) return afterViolation.record;
      throw new Error(`materializeCultureSourceFetch: child Run rejected the fetch — ${violation.reason}: ${violation.detail}`);
    }
    // TASK-011 remediation (2026-07-18, fifth review) — re-check the
    // DURABLE record's status directly (not `abortController.signal.aborted`)
    // as the authoritative pre-flight gate before ever calling
    // `guardedFetch`. Reading the durable record fresh here is authoritative
    // and independent of AbortController-map timing: if it no longer reads
    // "fetching" (this call no longer "owns" the fetch), bail out without
    // ever starting the real network request.
    const preFlight = await deps.fetchStore.get(organizationId, childRunId);
    if (!preFlight) {
      throw new Error(`materializeCultureSourceFetch: culture-fetch intent for child Run ${childRunId} vanished unexpectedly`);
    }
    if (preFlight.status !== "fetching" || preFlight.leaseOwner !== leaseOwner) {
      deps.abortControllers.delete(childRunId);
      return preFlight;
    }

    try {
      const response = await guardedFetch(fetching.canonicalUrl, {
        headers: { "user-agent": CULTURE_RESEARCH_USER_AGENT },
        timeoutMs: CULTURE_FETCH_TIMEOUT_MS,
        maxBytes: MAX_CULTURE_FETCH_BYTES,
        signal: abortController.signal,
        allowedRedirectOrigins: fetching.allowedRedirectOrigins,
        ...(unsafeTestOverrides ? { unsafeTestOverrides } : {}),
      });
      if (response.status < 200 || response.status >= 300) {
        throw new Error(`fetch failed with HTTP ${response.status}`);
      }
      const contentType = String(response.headers["content-type"] ?? "").toLowerCase();
      if (contentType && !contentType.startsWith("text/") && !contentType.includes("xhtml") && !contentType.includes("xml")) {
        throw new Error(`fetch returned a non-text content-type ("${contentType}") — culture-research sources must be textual web content`);
      }
      const content = stripHtmlToText(response.body.toString("utf8")).slice(0, MAX_CULTURE_EXCERPT_CHARS);
      const retrievedAt = new Date().toISOString();
      const result: CultureResultRef = {
        sourceId: record.sourceId,
        sourceType: record.sourceType,
        sourceLabel: record.sourceLabel,
        sourceUrl: response.finalUrl,
        content,
        contentHash: computeContentHash(content),
        retrievedAt,
        // TASK-011 remediation (2026-07-19, issue 8) — fetched bytes are
        // UNTRUSTED EXTERNAL data, never operator-authored; propagate this
        // taint into the result (and, downstream, into synthesis) rather
        // than silently declassifying it. Retention is bounded, not
        // indefinite.
        trustOrigin: "untrusted_external",
        expiresAt: new Date(Date.parse(retrievedAt) + CULTURE_RESULT_RETENTION_MS).toISOString(),
      };
      deps.abortControllers.delete(childRunId);
      // A cancel may have durably landed (poll caught it, or arrived in the
      // instant between our last poll tick and here) WHILE the fetch was
      // completing — check the authoritative flag one final time before
      // ever declaring "fetched"; a race that let the bytes arrive anyway
      // must still result in "cancelled", discarding the result. This
      // `finalCheck` is a fast-path optimism only — the ACTUAL guarantee
      // against a cancel racing the commit is `requireCancelNotRequested`
      // on the fenced "fetched" transition below, which re-checks
      // `cancelRequested` atomically at commit time, closing the gap this
      // plain read cannot.
      const finalCheck = await deps.fetchStore.get(organizationId, childRunId);
      if (finalCheck?.cancelRequested) {
        const { committed, record: current } = await attemptFencedTerminalTransition(
          deps.fetchStore,
          organizationId,
          childRunId,
          (r) => ({ ...r, status: "cancelled" }),
          { leaseOwner, attempt: fetching.attempt },
        );
        // TASK-011 remediation (round 2, issue 4) — only the worker that
        // ACTUALLY committed this transition may touch the child Run's own
        // lifecycle; a refused (stale) attempt must never call
        // `cancelChildAgentRun` — the true winner (whoever that is) owns
        // that responsibility instead.
        if (committed) {
          await cancelChildAgentRun({ store: deps.childAgentRuns, ledger: deps.ledger }, organizationId, childRunId, { type: "agent", id: LEARNING_AGENT }, ctx).catch((e) => {
            if (!(e instanceof ChildRunAlreadyTerminalError) && !(e instanceof ChildRunTerminalAuditPendingError)) throw e;
          });
        }
        if (current) return current;
      }
      const fetchedResult = await attemptFencedTerminalTransition(
        deps.fetchStore,
        organizationId,
        childRunId,
        (r) => ({ ...r, status: "fetched", result }),
        // TASK-011 remediation (2026-07-19 coordinator distributed-defects
        // RE-review round 2, issue 3) — the CAS itself refuses to commit
        // "fetched" if `cancelRequested` is true at commit time, closing
        // the TOCTOU window between `finalCheck` (above) and this write.
        { leaseOwner, attempt: fetching.attempt, requireCancelNotRequested: true },
      );
      if (fetchedResult.committed) {
        await completeChildAgentRun({ store: deps.childAgentRuns, ledger: deps.ledger }, organizationId, childRunId, { type: "agent", id: LEARNING_AGENT }, ctx).catch((e) => {
          if (!(e instanceof ChildRunAlreadyTerminalError) && !(e instanceof ChildRunTerminalAuditPendingError)) throw e;
        });
        if (fetchedResult.record) return fetchedResult.record;
      }
      // The "fetched" write was refused. Two distinct reasons look
      // identical from the caller's perspective but need DIFFERENT
      // handling:
      //  (a) a cancellation raced the commit (`CultureFetchCancelledRaceError`)
      //      — THIS worker still holds the live lease (its own
      //      `leaseOwner`/`attempt` still match the returned record), so it
      //      is the ONLY one who can legitimately transition the record to
      //      "cancelled" now — no one else will ever do it.
      //  (b) the lease itself was reclaimed by a genuinely different,
      //      later attempt (`CultureFetchStaleLeaseError`) — this worker
      //      has no authority over the record at all anymore; the owning
      //      attempt (whichever process that is) is responsible for its
      //      own terminal write.
      if (fetchedResult.record?.status === "fetching" && fetchedResult.record.leaseOwner === leaseOwner && fetchedResult.record.attempt === fetching.attempt) {
        const { committed: cancelCommitted, record: cancelledRecord } = await attemptFencedTerminalTransition(
          deps.fetchStore,
          organizationId,
          childRunId,
          (r) => ({ ...r, status: "cancelled" }),
          { leaseOwner, attempt: fetching.attempt },
        );
        if (cancelCommitted) {
          await cancelChildAgentRun({ store: deps.childAgentRuns, ledger: deps.ledger }, organizationId, childRunId, { type: "agent", id: LEARNING_AGENT }, ctx).catch((e) => {
            if (!(e instanceof ChildRunAlreadyTerminalError) && !(e instanceof ChildRunTerminalAuditPendingError)) throw e;
          });
        }
        if (cancelledRecord) return cancelledRecord;
      }
      if (fetchedResult.record) return fetchedResult.record;
      // The fenced write was refused (a concurrent cancel/reclaim already
      // resolved this record) — `attemptFencedTerminalTransition` already
      // fell back to `get()`, so a null here means the record itself is
      // unexpectedly missing, not a normal race outcome.
      throw new Error(`materializeCultureSourceFetch: culture-fetch intent for child Run ${childRunId} vanished unexpectedly after a fenced write was refused`);
    } catch (error) {
      deps.abortControllers.delete(childRunId);
      // Was this abort CAUSED by cancellation (our own AbortController, set
      // either by the local `cancelCultureSourceFetch` path OR by this
      // function's own distributed-cancellation poll noticing a REMOTE
      // instance's durable flag), as opposed to a timeout or any other
      // failure? If so, do NOT clobber "cancelled" with "failed" (TASK-011
      // remediation, issue 4: "abort caused by cancellation must remain
      // cancelled").
      if (abortController.signal.aborted) {
        const current = await deps.fetchStore.get(organizationId, childRunId);
        if (current?.status === "cancelled") return current;
        // The signal was aborted (by our own poll observing cancelRequested)
        // but the durable record hasn't been flipped to "cancelled" yet —
        // do it now, ourselves, rather than leaving an inconsistent "aborted
        // but still fetching" state.
        if (current?.cancelRequested) {
          const { committed, record: cancelled } = await attemptFencedTerminalTransition(
            deps.fetchStore,
            organizationId,
            childRunId,
            (r) => ({ ...r, status: "cancelled" }),
            { leaseOwner, attempt: fetching.attempt },
          );
          if (committed) {
            await cancelChildAgentRun({ store: deps.childAgentRuns, ledger: deps.ledger }, organizationId, childRunId, { type: "agent", id: LEARNING_AGENT }, ctx).catch((e) => {
              if (!(e instanceof ChildRunAlreadyTerminalError) && !(e instanceof ChildRunTerminalAuditPendingError)) throw e;
            });
          }
          if (cancelled) return cancelled;
        }
      }
      const failedResult = await attemptFencedTerminalTransition(
        deps.fetchStore,
        organizationId,
        childRunId,
        (r) => ({
          ...r,
          status: "failed",
          error: error instanceof Error ? error.message : String(error),
        }),
        // Same cancellation-race guard as "fetched" above — a cancel that
        // raced this failure must still win, never be overwritten with "failed".
        { leaseOwner, attempt: fetching.attempt, requireCancelNotRequested: true },
      );
      // `failedResult.committed` may be false (fence/cancellation-race
      // refused — a concurrent cancel/reclaim already resolved the record
      // terminally) — that outcome is correct and does not need surfacing
      // as a bug; only the ORIGINAL fetch error below is what callers need
      // to see when this write DID win. Only the winner may touch the
      // child Run's own lifecycle.
      if (failedResult.committed) {
        await failChildAgentRun({ store: deps.childAgentRuns, ledger: deps.ledger }, organizationId, childRunId, { type: "agent", id: LEARNING_AGENT }, ctx).catch((e) => {
          // The child Run may already be terminal (e.g. concurrently cancelled) —
          // that is itself a legitimate terminal state, not a reason to mask the
          // original fetch failure below. Surface any OTHER failure.
          if (!(e instanceof ChildRunAlreadyTerminalError) && !(e instanceof ChildRunTerminalAuditPendingError)) throw e;
        });
      } else if (
        failedResult.record?.status === "fetching" &&
        failedResult.record.leaseOwner === leaseOwner &&
        failedResult.record.attempt === fetching.attempt
      ) {
        // Same reasoning as the "fetched" branch above — this worker still
        // holds the live lease (a cancellation raced the "failed" commit,
        // not a lease reclaim), so it is the only one who can legitimately
        // transition the record to "cancelled" now.
        const { committed: cancelCommitted } = await attemptFencedTerminalTransition(
          deps.fetchStore,
          organizationId,
          childRunId,
          (r) => ({ ...r, status: "cancelled" }),
          { leaseOwner, attempt: fetching.attempt },
        );
        if (cancelCommitted) {
          await cancelChildAgentRun({ store: deps.childAgentRuns, ledger: deps.ledger }, organizationId, childRunId, { type: "agent", id: LEARNING_AGENT }, ctx).catch((e) => {
            if (!(e instanceof ChildRunAlreadyTerminalError) && !(e instanceof ChildRunTerminalAuditPendingError)) throw e;
          });
        }
      }
      throw error;
    }
  } finally {
    clearInterval(cancelPoll);
  }
}

/**
 * Cancels a culture-research source's fetch — TASK-011 remediation #7,
 * hardened again across later rounds (durable fail-closed record load,
 * refuses to rewrite an already-terminal record). As of the 2026-07-19
 * distributed-defects review (issue 2): the DURABLE `cancelRequested` flag
 * (`DurableCultureFetchStore.requestCancel`) is now the AUTHORITATIVE
 * cancellation mechanism — it works even when a DIFFERENT API instance
 * (not this process) holds the live lease/socket, because that OTHER
 * process's `materializeCultureSourceFetch` call polls this same durable
 * flag. The process-local `AbortController` map is only an optimization:
 * if THIS process happens to hold the live fetch, we abort it immediately
 * for lower latency; otherwise the remote holder's own poll loop is what
 * actually stops it, typically within `CULTURE_CANCEL_POLL_MS`.
 */
export async function cancelCultureSourceFetch(
  deps: {
    childAgentRuns: ChildAgentRunStore;
    ledger: LedgerStore;
    fetchStore: DurableCultureFetchStore;
    abortControllers: Map<string, AbortController>;
  },
  organizationId: string,
  proposalId: string,
  childRunId: string,
  actor: Actor,
  ctx: RunCtx,
): Promise<CultureFetchIntentRecord> {
  const record = await deps.fetchStore.getByProposal(organizationId, proposalId, childRunId);
  if (!record) {
    throw new Error(`cancelCultureSourceFetch: unknown or mismatched culture-fetch intent for proposal "${proposalId}" / child Run "${childRunId}"`);
  }

  // Optimization only (see doc comment above) — abort a real in-flight
  // fetch immediately if THIS process happens to hold it, before flipping
  // the durable status, so a local `materializeCultureSourceFetch`'s own
  // catch block observes `abortController.signal.aborted` right away rather
  // than waiting for its next poll tick.
  const earlyController = deps.abortControllers.get(childRunId);
  if (earlyController) earlyController.abort();

  // The AUTHORITATIVE, cross-instance-safe cancellation write. Immediate if
  // no live lease is held (pending, or an expired/orphaned "fetching"
  // lease); otherwise durably flags `cancelRequested` for the (possibly
  // remote) lease holder's poll loop to discover.
  const result = await deps.fetchStore.requestCancel(organizationId, childRunId, ctx.clock.nowISO());

  // Best-effort second check: if a controller appeared AFTER our early
  // check above (materialize's own registration racing this call), abort it
  // too — defense in depth, not required for correctness (the durable flag
  // + poll loop is what guarantees this across instances).
  if (result.status === "cancelled" || result.cancelRequested) {
    const lateController = deps.abortControllers.get(childRunId);
    if (lateController && lateController !== earlyController) lateController.abort();
  }

  if (result.status === "cancelled") {
    await cancelChildAgentRun({ store: deps.childAgentRuns, ledger: deps.ledger }, organizationId, childRunId, actor, ctx).catch((error) => {
      // Already terminal (completed/failed/cancelled) — fine, cancellation is
      // idempotent. Surface any OTHER failure (e.g. a ledger append error).
      if (!(error instanceof ChildRunAlreadyTerminalError) && !(error instanceof ChildRunTerminalAuditPendingError)) throw error;
    });
  }
  return result;
}

export interface SynthesizeCultureProfileInput {
  /** Needed to independently re-resolve this run's own fetched results
   * from the durable stores below — TASK-011 remediation (2026-07-19
   * coordinator distributed-defects RE-review round 2, issue 8). */
  organizationId: string;
  /** The EXACT parent Agent Run this synthesis is scoped to — TASK-011
   * remediation (2026-07-18 final review, issue 6). The Skill resolves
   * `results`/`skippedSources` from this run's own fetched intent records
   * ONLY, never pooled across historical/concurrent runs for the company. */
  parentRunId: string;
  claims: GroundedClaimInput[];
  skippedSources: CultureSkippedSource[];
}

export interface SynthesizeCultureProfileOutput {
  parentRunId: string;
  /** The exact fetched results (by sourceId + their real contentHash) this
   * synthesis was grounded against — persisted so a later reader can verify
   * (or a stale/superseded synthesis can be detected) without re-deriving it
   * from the run's live state. */
  resultHashes: ReadonlyArray<{ sourceId: string; contentHash: string }>;
  partition: ReturnType<typeof partitionCultureEvidence>;
  disclosure: CultureSourceDisclosure;
}

export class ClaimGroundingError extends Error {
  constructor(public readonly failures: ClaimGroundingFailure[]) {
    super(`jobpilot.synthesizeCultureProfile: ${failures.length} claim(s) failed to ground: ${failures.map((f) => `${f.claimId} (${f.reason})`).join(", ")}`);
    this.name = "ClaimGroundingError";
  }
}

/**
 * Internal Strategist's synthesis Skill — no network access, no invented
 * evidence. TASK-011 remediation #5: claims must GROUND against the
 * immutable fetched results this run actually produced (`groundClaims`) —
 * an absent quote, a quote from the wrong result, a stale/mismatched
 * content hash, a duplicate claim id, a dangling/self-referencing/cyclic
 * contradiction/support reference, or a claim that does not transitively
 * trace back to a real fact/opinion fails the WHOLE batch closed
 * (`ClaimGroundingError`). Only once every claim grounds does the
 * fabrication/insider-claim guard run over the resulting evidence text, and
 * only then are evidence partitioned + the disclosure built. TASK-011
 * remediation (2026-07-18, issue 6): the output embeds `parentRunId` and
 * each grounded result's real hash, so the persisted ledger row can be
 * independently verified against exactly the run/results it claims.
 *
 * TASK-011 remediation (2026-07-19 coordinator distributed-defects
 * RE-review round 2, issue 8) — a FACTORY, not a plain object: this Skill
 * now resolves the run's fetched results ITSELF, directly from the durable
 * `childAgentRuns`/`fetchStore` (the SAME stores the router's own pre-checks
 * read), rather than trusting full `CultureResultRef[]` (including raw
 * fetched page bodies) passed in via `inputs`. `req.inputs` is exactly what
 * `pipeline.propose` persists VERBATIM into the immutable ledger row — so
 * the previous design durably embedded every fetched result's FULL raw
 * content into every synthesis proposal's ledger entry, forever, bypassing
 * this slice's own result-expiry/purge mechanism entirely (an expired
 * result's raw body was purged from `cultureFetchStore` but remained
 * fully readable, unexpired, inside the ledger row). `inputs` now carries
 * only `organizationId`/`parentRunId`/`claims`/`skippedSources` — no result
 * bodies at all; the Skill independently re-derives (and re-validates,
 * including expiry) the results it grounds against, exactly mirroring the
 * checks the router performs for its own earlier fail-fast validation.
 */
export function createSynthesizeCultureProfileSkill(deps: { childAgentRuns: ChildAgentRunStore; fetchStore: DurableCultureFetchStore }): Skill {
  return {
    name: "jobpilot.synthesizeCultureProfile",
    async run(inputs, ctx) {
      const input = inputs as SynthesizeCultureProfileInput;
      const nowISO = ctx.clock.nowISO();
      const childRuns = await deps.childAgentRuns.listByParentRun(input.organizationId, input.parentRunId);
      const intentRecords = (
        await Promise.all(childRuns.map((childRun) => deps.fetchStore.get(input.organizationId, childRun.id)))
      ).filter((r): r is NonNullable<typeof r> => r != null);
      // Last-write-wins per sourceId would silently mask a duplicate — this
      // Skill fails closed instead, exactly like the router's own
      // (independent, non-authoritative) pre-check.
      const bySourceId = new Map<string, CultureResultRef>();
      for (const r of intentRecords) {
        if (r.status !== "fetched" || !r.result || isResultExpired(r.result, nowISO)) continue;
        if (bySourceId.has(r.sourceId)) {
          throw new Error(`jobpilot.synthesizeCultureProfile: duplicate fetched result for source "${r.sourceId}" under parent Run "${input.parentRunId}"`);
        }
        bySourceId.set(r.sourceId, r.result);
      }
      const grounded = groundClaims(input.claims, bySourceId);
      if (!grounded.ok) {
        throw new ClaimGroundingError(grounded.failures);
      }
      for (const item of grounded.evidence) {
        const check = assertNoFabricatedAffinityOrInsiderClaim(item.claimText);
        if (!check.clean) {
          throw new Error(
            `jobpilot.synthesizeCultureProfile: claim "${item.id}" failed the fabrication/insider-claim guard: ${check.violations.join(", ")}`,
          );
        }
      }
      const partition = partitionCultureEvidence(grounded.evidence);
      const disclosure = buildSourceDisclosure(grounded.evidence, input.skippedSources);
      const output: SynthesizeCultureProfileOutput = {
        parentRunId: input.parentRunId,
        resultHashes: [...bySourceId.entries()].map(([sourceId, a]) => ({ sourceId, contentHash: a.contentHash })),
        partition,
        disclosure,
      };
      return { proposedOutput: output, diff: { to: output } };
    },
  };
}

export const JOBPILOT_RESEARCH_CULTURE_SOURCE_SKILL_MANIFEST = {
  organizationId: PILOT_ORGANIZATION,
  skillId: "jobpilot.researchCultureSource",
  version: "1.0.0",
  goalTypes: [JOBPILOT_CULTURE_RESEARCH_GOAL_TYPE],
  taskTypes: [RESEARCH_CULTURE_SOURCE_TASK_TYPE],
  // NOTE: this Skill's run() is now PURE (no network) — it still declares
  // external:fetch:read/cloud/external because that is the REAL authority
  // its approval unlocks for the subsequent materialize step, and the
  // manifest is what makes riskBand:"external" force explicit_human review
  // before that real effect may ever occur.
  permissions: ["external:fetch:read"],
  plane: "cloud",
  dataScopes: ["public"],
  riskBand: "external",
  evalVersion: "1.0.0",
  defaultAgents: ["learning"],
  childRunPolicy: "allowed",
} as const;

export const JOBPILOT_SYNTHESIZE_CULTURE_PROFILE_SKILL_MANIFEST = {
  organizationId: PILOT_ORGANIZATION,
  skillId: "jobpilot.synthesizeCultureProfile",
  version: "1.0.0",
  goalTypes: [JOBPILOT_CULTURE_RESEARCH_GOAL_TYPE],
  taskTypes: [SYNTHESIZE_CULTURE_PROFILE_TASK_TYPE],
  permissions: ["signal:write"],
  plane: "local",
  dataScopes: ["all"],
  riskBand: "advisory",
  evalVersion: "1.0.0",
  defaultAgents: ["internal_strategist"],
  childRunPolicy: "forbidden",
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
const stageHelpRequestOffer: Skill = {
  name: "relationship.help-request.stage-offer",
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
  organizationId: PILOT_ORGANIZATION,
  skillId: "outreach.stageDraft",
  version: "1.0.0",
  goalTypes: [RELATIONSHIP_OUTREACH_GOAL_TYPE],
  taskTypes: [DRAFT_OUTREACH_TASK_TYPE],
  permissions: ["event:write"],
  plane: "local",
  dataScopes: ["public"],
  riskBand: "advisory",
  evalVersion: "1.0.0",
  defaultAgents: ["outreach"],
  childRunPolicy: "forbidden",
} as const;
export const RELATIONSHIP_HELP_ROUTING_GOAL_TYPE = "relationship.help-request.routing";
export const DRAFT_HELP_OFFER_TASK_TYPE = "draft_help_offer";
export const RELATIONSHIP_HELP_OFFER_SKILL_MANIFEST = {
  organizationId: PILOT_ORGANIZATION,
  skillId: "relationship.help-request.stage-offer",
  version: "1.0.0",
  goalTypes: [RELATIONSHIP_HELP_ROUTING_GOAL_TYPE],
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
  organizationId: PILOT_ORGANIZATION,
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
 * before becoming a committed Event, consistent with every other
 * governed Skill's draft-then-approve shape.
 */
export const RELATIONSHIP_CAPTURE_GOAL_TYPE = "relationship.capture";
export const STAGE_CAPTURE_TASK_TYPE = "stage_capture";
export const STAGE_CAPTURE_SKILL_MANIFEST = {
  organizationId: PILOT_ORGANIZATION,
  skillId: "stageCapture",
  version: "1.0.0",
  goalTypes: [RELATIONSHIP_CAPTURE_GOAL_TYPE],
  taskTypes: [STAGE_CAPTURE_TASK_TYPE],
  permissions: ["event:write", "signal:write"],
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
 * durable Goal for the organization + one bounded Task per call, assigned to
 * whichever physical identity already invokes it. Same manifest shape
 * (`permissions`/`plane`/`dataScopes`) mirrors what each call site's own
 * `pipeline.propose` request already declares.
 */
export const GOOGLE_SYNC_GOAL_TYPE = "google.sync";
export const GOOGLE_SOURCE_TASK_TYPE = "source_google_data";
export const GOOGLE_STAGE_TASK_TYPE = "stage_google_data";

function googleSkillManifest(skillId: string, taskType: string, plane: "local" | "cloud", permissions: readonly string[]): {
  organizationId: string;
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
    organizationId: PILOT_ORGANIZATION,
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
  googleSkillManifest(SKILL_STAGE, GOOGLE_STAGE_TASK_TYPE, "local", ["event:write", "signal:write"]),
];

const TASK_MANAGER_SKILL_OWNERS: Readonly<Record<string, string>> = {
  "task-manager.create-task": "internal-strategist",
  "task-manager.goal-outcome-framing": "internal-strategist",
  "task-manager.candidate-task-generation": "internal-strategist",
  "task-manager.premortem-scenario": "internal-strategist",
  "task-manager.task-decomposition": "internal-strategist",
  "task-manager.task-tree-restructure": "internal-strategist",
  "task-manager.exit-test-authoring": "internal-strategist",
  "task-manager.task-reconciliation": "internal-strategist",
  "task-manager.queue-sequencing": "internal-strategist",
  "task-manager.impact-fit-analysis": "internal-strategist",
  "task-manager.agent-task-routing": "chief-of-staff",
  "task-manager.reschedule-confidence-calibration": "learning",
  "task-manager.proactive-opportunity-scan": "internal-strategist",
  "task-manager.ledger-projection": "internal-strategist",
  "task-manager.evidence-verification": "internal-strategist",
  "task-manager.progress-synthesis": "chief-of-staff",
  "task-manager.habit-scaffolding": "chief-of-staff",
  "task-manager.completed-bay-sweep": "governance",
};

const TASK_MANAGER_CREATE_TASK_INPUT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: [
    "kind",
    "taskId",
    "title",
    "outcome",
    "exitTest",
    "visibility",
    "chatThreadId",
    "chatTurnId",
  ],
  properties: {
    kind: { const: "task_create" },
    taskId: { type: "string", format: "uuid" },
    title: { type: "string", minLength: 1, maxLength: 160 },
    outcome: { type: "string", minLength: 1, maxLength: 2_000 },
    exitTest: { type: "string", minLength: 1, maxLength: 2_000 },
    visibility: { const: "private" },
    chatThreadId: { type: "string", format: "uuid" },
    chatTurnId: { type: "string", format: "uuid" },
  },
} as const;

const TASK_MANAGER_CREATE_TASK_OUTPUT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["kind", "taskId", "title", "outcome", "exitTest", "status"],
  properties: {
    kind: { const: "task_create" },
    taskId: { type: "string", format: "uuid" },
    title: { type: "string" },
    outcome: { type: "string" },
    exitTest: { type: "string" },
    status: { const: "proposed" },
  },
} as const;

export const TASK_MANAGER_SKILL_MANIFESTS: readonly SkillManifest[] = Object.entries(TASK_MANAGER_SKILL_OWNERS)
  .map(([skillId, owner]) => ({
    organizationId: PILOT_ORGANIZATION,
    skillId,
    version: "1.0.0",
    goalTypes: ["task-manager"],
    taskTypes: ["task"],
    ...(skillId === "task-manager.create-task"
      ? {
          inputSchema: TASK_MANAGER_CREATE_TASK_INPUT_SCHEMA,
          outputSchema: TASK_MANAGER_CREATE_TASK_OUTPUT_SCHEMA,
        }
      : {}),
    permissions: skillId === "task-manager.completed-bay-sweep"
      ? ["record:read", "record:archive"]
      : ["record:read", "record:write"],
    plane: "local",
    dataScopes: ["all"],
    riskBand: "advisory",
    evalVersion: "1.0.0",
    defaultAgents: [owner],
    childRunPolicy: "forbidden",
  }));

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
  WEB_RESEARCH_SKILL_MANIFEST,
  RED_FLAG_LEARNING_SKILL_MANIFEST,
  OBSERVATION_DIGEST_SKILL_MANIFEST,
  RELATIONSHIP_HELP_OFFER_SKILL_MANIFEST,
  OUTREACH_DRAFT_SKILL_MANIFEST,
  DEALPILOT_SOURCE_SKILL_MANIFEST,
  STAGE_CAPTURE_SKILL_MANIFEST,
  JOBPILOT_RESEARCH_CULTURE_SOURCE_SKILL_MANIFEST,
  JOBPILOT_SYNTHESIZE_CULTURE_PROFILE_SKILL_MANIFEST,
  RECOMMEND_CAPABILITY_BUILD_SKILL_MANIFEST,
  DRAFT_CAPABILITY_SKILL_MANIFEST,
  REVIEW_CAPABILITY_DRAFT_SKILL_MANIFEST,
  ...TASK_MANAGER_SKILL_MANIFESTS,
  ...GOOGLE_SKILL_MANIFESTS,
];

const policies: PolicyFn[] = [
  (i) => {
    if (
      i.phase !== "pre" ||
      typeof i.inputs !== "object" ||
      i.inputs === null ||
      (i.inputs as { operation?: unknown }).operation !== "model_completion"
    ) {
      return null;
    }
    const input = i.inputs as {
      providerPlane?: unknown;
      dataScope?: unknown;
      cloudEgressConfirmed?: unknown;
    };
    const cloudAllowed =
      input.providerPlane === "cloud" &&
      input.dataScope === "public" &&
      input.cloudEgressConfirmed === true &&
      i.actor.type === "agent" &&
      i.actor.plane === "cloud" &&
      i.resourceType === "external:fetch" &&
      i.action === "read" &&
      i.taint !== "untrusted_external";
    const localAllowed =
      input.providerPlane === "local" &&
      input.dataScope === "all" &&
      (i.actor.plane ?? "local") === "local" &&
      i.resourceType === "module" &&
      i.action === "read";
    return {
      policyId: "pol-model-execution-plane",
      phase: "pre",
      effect: cloudAllowed || localAllowed ? "allow" : "block",
      reason:
        cloudAllowed || localAllowed
          ? "model execution matches its Authority-approved Plane and data scope"
          : "model execution Plane, data scope, actor, or trust provenance is not permitted",
    };
  },
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
function seedGovernance(
  roles: InMemoryRoleStore,
  agents: InMemoryAgentStore,
  pilotUserId: string = PILOT_USER,
): void {
  for (const agentId of [
    OUTREACH_AGENT,
    LEARNING_AGENT,
    INTERNAL_STRATEGIST_AGENT,
    GOVERNANCE_AGENT,
    CAPABILITY_BUILDER_AGENT,
    EGRESS_AGENT,
    INTAKE_AGENT,
  ]) {
    agents.organizations.set(agentId, PILOT_ORGANIZATION);
    agents.statuses.set(agentId, "active");
  }
  // Outreach Agent (existing pilot) — event:write + reads.
  agents.assumed.set(OUTREACH_AGENT, "role-outreach");
  agents.scope.set(OUTREACH_AGENT, ["event:write", "person:read", "record:read", "file:read"]);
  agents.tiers.set(OUTREACH_AGENT, "public");
  agents.skills.set(OUTREACH_AGENT, ["outreach.stageDraft"]);
  roles.roleGrants.set("role-outreach", [
    { resourceType: "event", resourceId: null, action: "write", effect: "allow" },
    { resourceType: "person", resourceId: null, action: "read", effect: "allow" },
  ]);

  agents.assumed.set(LEARNING_AGENT, "role-learning");
  // AGS1 (TASK-011) — "external:fetch:read" added so Learning may perform its
  // OWN culture-research sourcing (BRD agents.Learning: "research company,
  // culture... with provenance and rights controls"), the same permission
  // shape EGRESS_AGENT already holds for DealPilot/Google sourcing. Learning
  // still only reaches "cloud" plane for this ONE Task type when the actor
  // itself declares plane:"cloud" on the call (see
  // JOBPILOT_RESEARCH_CULTURE_SOURCE_SKILL_MANIFEST) — it gains no standing
  // internet access for anything else.
  agents.scope.set(LEARNING_AGENT, ["signal:write", "event:write", "external:fetch:read"]);
  agents.tiers.set(LEARNING_AGENT, "all");
  agents.skills.set(LEARNING_AGENT, [
    LEARNING_RECOMMENDATION_SKILL_ID,
    "stageStrategicRecommendation",
    "relationship.help-request.stage-offer",
    "stageCapture",
    WEB_RESEARCH_SKILL_ID,
    "jobpilot.researchCultureSource",
    "learning.proposePreferenceAdjustment",
    // TASK-032: the flight-gated observation digest. Allow-listed
    // unconditionally (the list is static agent capability scope); with the
    // flight off the Skill is never registered and the Automation never
    // seeded, so the entry is inert.
    OBSERVATION_DIGEST_SKILL_ID,
  ]);
  roles.roleGrants.set("role-learning", [
    { resourceType: "signal", resourceId: null, action: "write", effect: "allow" },
    { resourceType: "event", resourceId: null, action: "write", effect: "allow" },
    { resourceType: "external:fetch", resourceId: null, action: "read", effect: "allow" },
  ]);

  // Internal Strategist (AGS0/AGS1, TASK-007) — local, analysis/synthesis only.
  // Shares "signal:write" with Learning so the SAME governed Skill
  // (stageStrategicRecommendation) can resolve for either, depending only on
  // which Agent a Task is actually assigned to (AGS1 acceptance: "same Skill
  // can be selected for two eligible Agents assigned to same Task").
  agents.assumed.set(INTERNAL_STRATEGIST_AGENT, "role-internal-strategist");
  agents.scope.set(INTERNAL_STRATEGIST_AGENT, ["signal:write", "record:read", "record:write"]);
  agents.skills.set(INTERNAL_STRATEGIST_AGENT, [
    "stageStrategicRecommendation",
    "jobpilot.synthesizeCultureProfile",
    "task-manager.ledger-projection",
    "task-manager.create-task",
    // ADR-181 junction 1: the Strategist is the only Agent that may say a
    // capability should exist. It still cannot build one — there is no draft
    // Skill in this list, and `draftCapability` refuses it in core besides.
    RECOMMEND_CAPABILITY_BUILD_SKILL_ID,
  ]);
  roles.roleGrants.set("role-internal-strategist", [
    { resourceType: "signal", resourceId: null, action: "write", effect: "allow" },
    { resourceType: "record", resourceId: null, action: "read", effect: "allow" },
    { resourceType: "record", resourceId: null, action: "write", effect: "allow" },
    { resourceType: "record", resourceId: null, action: "archive", effect: "allow" },
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
  agents.scope.set(GOVERNANCE_AGENT, ["signal:write", "record:read", "record:archive"]);
  // ADR-181 junction 3: Governance is the only Agent that may review a draft.
  // The Skill stages the verdict; the verdict itself is COMPUTED by
  // `reviewDraft` from computeRisk/trifecta/sandbox — this Agent contributes no
  // opinion the pipeline would act on, which is why reviewing needs no scope
  // beyond the signal:write it already had.
  agents.skills.set(GOVERNANCE_AGENT, [
    "task-manager.completed-bay-sweep",
    REVIEW_CAPABILITY_DRAFT_SKILL_ID,
  ]);
  roles.roleGrants.set("role-governance", [
    { resourceType: "signal", resourceId: null, action: "write", effect: "allow" },
    { resourceType: "record", resourceId: null, action: "read", effect: "allow" },
    { resourceType: "record", resourceId: null, action: "archive", effect: "allow" },
  ]);

  // Capability Builder (AGS3, TASK-007) — drafts only; every output still
  // routes through the governed pipeline (draft, propose, approve, execute)
  // and this Agent can never activate its own output (capability.approve is
  // itself agent-floor-protected — see agent-floor.ts). Same minimal
  // signal:write scope for the same reason as Governance above.
  agents.assumed.set(CAPABILITY_BUILDER_AGENT, "role-capability-builder");
  agents.scope.set(CAPABILITY_BUILDER_AGENT, ["signal:write"]);
  // ADR-181 junction 2 — the first Skill this Agent has ever held. It can now
  // produce a real CapabilityManifest for any of the five governed Capability
  // types (skill / automation / agent / integration / database), which is the
  // whole of what "the Builder builds capabilities" means today.
  //
  // What it still cannot do, stated rather than implied: it holds NO builder-
  // primitive grant (file:read/write/edit, shell:execute — capability/
  // builder-primitives.ts). Those primitives are implemented and tested but
  // granted to nobody, so the Builder writes manifests, not files, and runs no
  // code. A draft that declares `shell:execute` without containment is blocked
  // at junction 3 rather than quietly honoured.
  agents.skills.set(CAPABILITY_BUILDER_AGENT, [DRAFT_CAPABILITY_SKILL_ID]);
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
  agents.scope.set(INTAKE_AGENT, ["event:write", "signal:write", "person:write"]);
  agents.skills.set(INTAKE_AGENT, [SKILL_STAGE]);
  roles.roleGrants.set("role-intake", [
    { resourceType: "event", resourceId: null, action: "write", effect: "allow" },
    { resourceType: "signal", resourceId: null, action: "write", effect: "allow" },
    { resourceType: "person", resourceId: null, action: "write", effect: "allow" },
  ]);

  // The signed-in user the agents act on behalf of (delegation ∩ principal authority).
  roles.direct.set(`user:${pilotUserId}`, [
    { resourceType: "event", resourceId: null, action: "write", effect: "allow" },
    { resourceType: "event", resourceId: null, action: "read", effect: "allow" },
    { resourceType: "person", resourceId: null, action: "write", effect: "allow" },
    { resourceType: "person", resourceId: null, action: "read", effect: "allow" },
    { resourceType: "person", resourceId: null, action: "archive", effect: "allow" },
    { resourceType: "community", resourceId: null, action: "write", effect: "allow" },
    { resourceType: "community", resourceId: null, action: "read", effect: "allow" },
    { resourceType: "community", resourceId: null, action: "archive", effect: "allow" },
    { resourceType: "signal", resourceId: null, action: "write", effect: "allow" },
    { resourceType: "module", resourceId: null, action: "read", effect: "allow" },
    { resourceType: "module", resourceId: null, action: "write", effect: "allow" },
    // modules.install's governed propose() call moved off the interim
    // "signal" token onto its own dedicated resourceType (D5/TASK-017) —
    // carries the SAME write grant "signal" held so authority for the
    // module-install proposal is unchanged.
    { resourceType: "module_installation", resourceId: null, action: "write", effect: "allow" },
    { resourceType: "relation", resourceId: null, action: "read", effect: "allow" },
    { resourceType: "relation", resourceId: null, action: "write", effect: "allow" },
    { resourceType: "record", resourceId: null, action: "read", effect: "allow" },
    { resourceType: "record", resourceId: null, action: "write", effect: "allow" },
    { resourceType: "record", resourceId: null, action: "archive", effect: "allow" },
    { resourceType: "external:fetch", resourceId: null, action: "read", effect: "allow" },
    { resourceType: "external:send", resourceId: null, action: "share", effect: "allow" },
    // docs/BUGS.md "capability.approve/organization.blueprint.activate mutate
    // even when the governed decision is rejected" (2026-07-22) — both
    // handlers propose an action:"approve" request through the SAME governed
    // pipeline capability.approve/action.decide use, specifically so a human
    // (never an agent — the agent-floor still blocks that unconditionally)
    // resolves it. Before this grant, the pilot user had NO capability:approve
    // or organization_definition:approve authority, so `resolveAuthority`
    // denied every proposal (status "rejected") and the only reason those
    // endpoints ever mutated was a since-fixed fall-through bug that ignored
    // the rejection. This is the intended human approver's real authority —
    // it must NEVER be granted to an Agent.
    { resourceType: "capability", resourceId: null, action: "approve", effect: "allow" },
    { resourceType: "organization_definition", resourceId: null, action: "approve", effect: "allow" },
  ]);
}

/** The governance + ledger + registry ports a mode (persistent/in-memory) selects. */
export interface ModePorts {
  roles: RoleQuery;
  agents: AgentQuery;
  ephemeral: EphemeralQuery;
  policyStore: PolicyStore;
  ledger: LedgerStore;
  taintAudit: TaintAuditStore;
  relationMaterializations: DrizzleRelationMaterializationStore;
  automationRegistry: AutomationRegistry;
  automationRunRecorder: AutomationRunRecorder;
  canonical: CanonicalIdentityStore;
  organizationStore: DrizzleOrganizationStore;
  /** Read surface for Record/Event/Signal — see graph-store.ts's header
   * comment (frontend-migration-scoping.md Phase 3: these had zero tRPC coverage).
   * Same `DrizzleGraphStore` class binds to either the real Postgres `db` or the
   * local pglite `localDb` — both are the same schema.ts tables. */
  graphStore: DrizzleGraphStore;
  jobpilotStore: DrizzleJobPilotStore;
  /** DealPilot Deal/Source/Thesis Records + Relations backed by the Cloud Plane
   * (Supabase) — persistent mode only (ADR-151, AP-083). Undefined in in-memory
   * mode, where records stay on the Local-Plane `LocalDealPilotStore`. Composed
   * into `wiring.dealpilot.store` ONLY in public-cloud mode; on desktop the
   * capture pipeline keeps its all-Local store so Records and captures stay
   * co-located. Never holds credentials or raw capture bodies. */
  dealPilotRecordStore?: DealPilotStore;
  helpdeskStore: DrizzleHelpdeskStore;
  resourcesStore: DrizzleResourcesStore;
  capabilityStore: CapabilityStore;
  /** VAR-1 tunable space (ADR-169) — Drizzle-backed in BOTH modes. Its consumer
   * is the promotion gate's resolveGates(); a defaults-only store silently
   * ignores an Organization's own thresholds. */
  policyParams: PolicyParamStore;
  /** EVAL-2/3 datasets, runs, comparisons (ADR-168). Drizzle-backed in BOTH
   * modes — both resolve a real Drizzle database, and an amnesiac eval store
   * silently disables the capability promotion gate rather than loosening it. */
  evalStore: EvalStore;
  organizationDefinitionStore: OrganizationDefinitionStore;
  /** P2 capability modules (docs/raw/capability-module-format.md, ADR-018/ADR-023) —
   * module_installations-shaped rows. Real Drizzle-backed table in persistent mode
   * (ADR-023); in-memory in in-memory mode, mirroring capabilityStore's split. */
  moduleStore: ModuleStore;
  memoryStore: MemoryStore;
  /** LA5 vector lane — always over the SAME db as `memoryStore` (vector hits
   * are refs that must hydrate from the store they index). */
  vectorIndex: VectorIndex;
  /** AGS1 (TASK-007) — Goal/Task catalog Skills resolve against. In-memory
   * default (dev/test); `buildPersistentPorts` binds the real, restart-durable
   * `DrizzleGoalTaskStore` instead. */
  goalTasks: GoalTaskStore;
  taskManager: TaskManagerStore;
  /** AGS1 (TASK-007) — registered governed Skill manifests (`resolveSkillForTask`'s
   * candidate catalog). In-memory default; `buildPersistentPorts` binds the real
   * `DrizzleSkillManifestRegistry`, seeded via `ensureSkillManifestCatalog`. */
  skillManifests: SkillManifestRegistry;
  /** AGS2 (TASK-007) — bounded child Agent Runs a parent Agent has spawned.
   * In-memory default; `buildPersistentPorts` binds the real, restart-durable
   * `DrizzleChildAgentRunStore` instead. */
  childAgentRuns: ChildAgentRunStore;
  /** TASK-028 — Research Run records/steps. In-memory default;
   * `buildPersistentPorts` binds `DrizzleResearchRunStore`. */
  researchRuns: ResearchRunStore;
  chatStore: ChatStore;
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
  /**
   * docs/BUGS.md "capability.approve/organization.blueprint.activate mutate
   * even when the governed decision is rejected" (2026-07-22 RESOLVED) —
   * persistent-mode-only counterpart to `seedGovernance`'s in-memory pilot
   * `capability:approve`/`organization_definition:approve` grants, mirroring
   * `ensureDealPilotPrincipalGovernance`'s shape exactly. In-memory mode
   * needs no hook here — `seedGovernance` seeds the equivalent directly.
   */
  ensureCapabilityApprovalGovernance?: () => Promise<void>;
}

/**
 * Persistent mode (`DATABASE_URL` set) — binds governance/ledger/registries to
 * Drizzle/Postgres via `createDrizzlePorts`, and the canonical identity store to the
 * real `DrizzleCanonicalIdentityStore` (no more in-memory fake once persistence is
 * requested).
 *
 * The ledger returned here is the Cloud Plane half. `buildWiring()` combines it
 * with the Local Plane ledger through `ResidencyRoutingLedgerStore`.
 */
export function buildPersistentPorts(env: {
  url: string;
  pilotUserId?: string;
  organizationRenameCoordinator?: OrganizationRenameCoordinator;
}): ModePorts {
  const pilotUserId = env.pilotUserId ?? PILOT_USER;
  const { db, close } = createDb({ url: env.url });
  const ports = createDrizzlePorts(db, {
    defaultOrganizationId: PILOT_ORGANIZATION,
    defaultUserId: pilotUserId,
    ...(env.organizationRenameCoordinator
      ? { organizationRenameCoordinator: env.organizationRenameCoordinator }
      : {}),
  });
  // TASK-007 — real, restart-durable Goal/Task/Skill-manifest/child-Run stores
  // once DATABASE_URL is set. `skillManifestRegistry`'s `refresh()` is awaited
  // inside `ensureSkillManifestCatalog` below (called once at boot, before the
  // server serves traffic), not here — constructing it here just binds the db.
  const goalTaskStore = new DrizzleGoalTaskStore(db);
  const taskManagerStore = new DrizzleTaskManagerStore(db, pilotUserId);
  const skillManifestRegistry = new DrizzleSkillManifestRegistry(
    db,
    PILOT_ORGANIZATION,
  );
  const childAgentRunStore = new DrizzleChildAgentRunStore(db);
  const researchRunStore = new DrizzleResearchRunStore(db);

  return {
    roles: ports.roles,
    agents: ports.agents,
    ephemeral: ports.ephemeral,
    policyStore: ports.policies,
    ledger: ports.ledger,
    taintAudit: new DrizzleTaintAuditStore(db),
    relationMaterializations: ports.relationMaterializations,
    automationRegistry: ports.automationRegistry,
    automationRunRecorder: ports.automationRunRecorder,
    // The one genuinely-fixed lie: canonical identity now really persists to Postgres
    // instead of an in-memory fake, once DATABASE_URL is set.
    canonical: new DrizzleCanonicalIdentityStore(db),
    organizationStore: ports.organizationStore,
    graphStore: new DrizzleGraphStore(db),
    jobpilotStore: new DrizzleJobPilotStore(db, PILOT_ORGANIZATION),
    dealPilotRecordStore: new DrizzleDealPilotStore(db),
    helpdeskStore: new DrizzleHelpdeskStore(db, PILOT_ORGANIZATION),
    resourcesStore: new DrizzleResourcesStore(db),
    capabilityStore: new DrizzleCapabilityStore(db, PILOT_ORGANIZATION),
    evalStore: new DrizzleEvalStore(db, PILOT_ORGANIZATION),
    policyParams: new DrizzlePolicyParamStore(db),
    organizationDefinitionStore: new DrizzleOrganizationDefinitionStore(
      db,
      PILOT_ORGANIZATION,
    ),
    // P2 modules: real Drizzle-backed store in persistent mode (ADR-023) — no
    // longer in-memory-only once DATABASE_URL is set.
    moduleStore: new DrizzleModuleStore(db, PILOT_ORGANIZATION),
    memoryStore: new DrizzleMemoryStore(db),
    vectorIndex: new DrizzleVectorIndex(db),
    // TASK-007 — real, restart-durable bindings (see the field's doc comment
    // on ModePorts for why these are no longer in-memory once DATABASE_URL is set).
    goalTasks: goalTaskStore,
    taskManager: taskManagerStore,
    skillManifests: skillManifestRegistry,
    childAgentRuns: childAgentRunStore,
    researchRuns: researchRunStore,
    chatStore: new DrizzleChatStore(db),
    // Real providers in persistent mode: Ollama is always registered (local plane,
    // dev-default per CLAUDE.md); Anthropic/Groq only when their keys are configured —
    // no fake fallback, same fail-closed posture as the Google gateway.
    modelProviders: [
      new LlamaCppProvider(),
      new OllamaProvider(),
      ...(process.env.ANTHROPIC_API_KEY ? [new AnthropicProvider()] : []),
      ...(process.env.GROQ_API_KEY ? [new GroqProvider()] : []),
    ],
    closeDb: close,
    verifyRlsPosture: () => assertRlsPosture(db, { env: process.env }),
    ensureEgressGovernance: () =>
      ensureEgressAgentGovernance(db, {
        organizationId: PILOT_ORGANIZATION,
        userId: pilotUserId,
        agentId: EGRESS_AGENT,
        roleId: EGRESS_ROLE,
        permissionId: EGRESS_PRINCIPAL_PERMISSION,
      }),
    ensureIntakeGovernance: () =>
      ensureIntakeAgentGovernance(db, {
        organizationId: PILOT_ORGANIZATION,
        userId: pilotUserId,
        agentId: INTAKE_AGENT,
        roleId: INTAKE_ROLE,
        permissionId: INTAKE_PRINCIPAL_PERMISSION,
      }),
    ensureDealPilotPrincipalGovernance: () =>
      ensureDealPilotPrincipalGovernance(db, {
        organizationId: PILOT_ORGANIZATION,
        userId: pilotUserId,
      }),
    ensureCapabilityApprovalGovernance: () =>
      ensureCapabilityApprovalPrincipalGovernance(db, {
        organizationId: PILOT_ORGANIZATION,
        userId: pilotUserId,
      }),
    ensureInternalStrategistGovernance: () =>
      ensureInternalStrategistGovernance(db, {
        organizationId: PILOT_ORGANIZATION,
        userId: pilotUserId,
        agentId: INTERNAL_STRATEGIST_AGENT,
        roleId: INTERNAL_STRATEGIST_ROLE,
        permissionId: INTERNAL_STRATEGIST_SIGNAL_PERMISSION,
      }),
    ensureGovernanceAgentGovernance: () =>
      ensureGovernanceAgentGovernance(db, {
        organizationId: PILOT_ORGANIZATION,
        userId: pilotUserId,
        agentId: GOVERNANCE_AGENT,
        roleId: GOVERNANCE_ROLE,
        permissionId: GOVERNANCE_SIGNAL_PERMISSION,
      }),
    ensureCapabilityBuilderGovernance: () =>
      ensureCapabilityBuilderGovernance(db, {
        organizationId: PILOT_ORGANIZATION,
        userId: pilotUserId,
        agentId: CAPABILITY_BUILDER_AGENT,
        roleId: CAPABILITY_BUILDER_ROLE,
        permissionId: CAPABILITY_BUILDER_SIGNAL_PERMISSION,
      }),
    ensureRelationshipUserGovernance: () =>
      ensureRelationshipUserGovernance(db, {
        organizationId: PILOT_ORGANIZATION,
        userId: pilotUserId,
      }),
    ensureSkillManifestCatalog: async () => {
      await seedSkillManifests(db, GOVERNED_SKILL_MANIFEST_CATALOG);
      await skillManifestRegistry.refresh();
    },
    ensureLearningGovernance: () =>
      ensureLearningAgentGovernance(db, {
        organizationId: PILOT_ORGANIZATION,
        userId: pilotUserId,
        agentId: LEARNING_AGENT,
        roleId: LEARNING_ROLE,
        permissionId: LEARNING_SIGNAL_PERMISSION,
      }),
    ensureOutreachGovernance: () =>
      ensureOutreachAgentGovernance(db, {
        organizationId: PILOT_ORGANIZATION,
        userId: pilotUserId,
        agentId: OUTREACH_AGENT,
        roleId: OUTREACH_ROLE,
        permissionId: OUTREACH_EVENT_PERMISSION,
      }),
  };
}

/**
 * In-memory mode (`DATABASE_URL` unset) — zero-infra dev/test default. Seeds
 * governance so the Google egress/intake agents are authorized, and binds organization
 * CRUD to the same LOCAL pglite client used by the generic Local Plane since
 * organization/team rows are real relational data, not in-memory governance config.
 */
export async function buildInMemoryPorts(env: {
  localDir: string | undefined;
  pilotUserId?: string;
  organizationRenameCoordinator?: OrganizationRenameCoordinator;
  localDatabase?: Awaited<ReturnType<typeof createLocalDb>>;
}): Promise<ModePorts> {
  const pilotUserId = env.pilotUserId ?? PILOT_USER;
  const mRoles = new InMemoryRoleStore();
  const mAgents = new InMemoryAgentStore();
  const mEphemeral = new InMemoryEphemeralStore();
  seedGovernance(mRoles, mAgents, pilotUserId);

  const localDatabase =
    env.localDatabase ??
    (await createLocalDb(env.localDir ? { dataDir: env.localDir } : {}));
  const { db: localDb } = localDatabase;
  const graphStore = new DrizzleGraphStore(localDb);
  const relationDecisionSequenceFloor =
    await graphStore.getMaxRelationDecisionSequence();
  const ledger: LedgerStore = env.localDir
    ? new DrizzleLedgerStore(localDb, {
        defaultOrganizationId: PILOT_ORGANIZATION,
        defaultUserId: pilotUserId,
      })
    : new InMemoryLedger(relationDecisionSequenceFloor);
  if (ledger instanceof DrizzleLedgerStore) {
    await ledger.ensureAppendSequenceFloor(relationDecisionSequenceFloor);
  }

  // TASK-011 remediation (2026-07-19 coordinator distributed-defects
  // RE-review, issue 6; landed originally without `ledger`) —
  // `ledger`/`goalTasks`/`childAgentRuns` were pure in-memory JS objects
  // EVEN WHEN `BRIDGE_LOCAL_DIR` is set, unlike every other store here
  // (`organizationStore`/`graphStore`/`jobpilotStore`/etc, already always
  // Drizzle-backed against `localDb`) and unlike `memoryStore` (the
  // culture-fetch/synthesis-pointer durability this whole feature's restart
  // guarantees were built on). This meant a REAL process restart with
  // `BRIDGE_LOCAL_DIR` set — the explicit signal an operator wants
  // local-plane durability — still silently lost every pending decision,
  // child-Run status/budget, and Goal/Task binding: the culture-fetch
  // INTENT record would durably resume, but the ledger proposal/decision
  // and child-Run state it depends on would not, leaving an orphaned
  // intent no caller could ever act on again.
  //
  // Scoped fix (this round): bind `goalTasks`/`childAgentRuns` to their
  // real Drizzle-backed equivalents (the SAME ones `buildPersistentPorts`
  // uses) ONLY when `env.localDir` is actually set. When it is NOT set (the
  // default for the vast majority of existing tests, which call
  // `buildWiring()`/`buildInMemoryPorts()` with no `BRIDGE_LOCAL_DIR`),
  // behavior is COMPLETELY UNCHANGED — pure in-memory objects, zero risk to
  // existing test timing/semantics. This mirrors the exact pattern
  // `createLocalDb` itself already uses (in-memory pglite vs file-backed
  // pglite) for the SAME `localDb` instance both branches share.
  //
  // `ledger` was DELIBERATELY excluded from that original fix: a genuine,
  // pre-existing, unrelated bug was found while testing it —
  // `DrizzleLedgerStore.append` writes `userDecision` verbatim, but
  // migration 0004's `ledger_user_decision_check` constraint only permitted
  // NULL/'approve'/'veto'/'edit' — NOT 'auto', a value the CORE
  // `LedgerEntry.userDecision` type (`Decision | "auto" | null`) has always
  // legitimately allowed (used e.g. by `recordChildAgentRunTransition` and
  // Relationship's signal-action flow). Switching `ledger` to Drizzle-backed
  // then made every existing `BRIDGE_LOCAL_DIR`-mode caller that
  // legitimately writes `userDecision: "auto"` fail with a real constraint
  // violation — a genuine regression, disclosed as an explicit follow-up
  // blocker pending a schema migration, rather than silently worked around.
  //
  // TASK-008 (RM4, migration `0015_task008_relation_contract`) has SINCE
  // landed exactly that constraint fix — `ledger_user_decision_check` now
  // permits `'approve' | 'veto' | 'edit' | 'auto'` — and, independently,
  // needed `ledger` itself to be genuinely restart-durable under
  // `BRIDGE_LOCAL_DIR` for its OWN relationship-materialization retry/
  // reconciliation flow, so `ledger` above is now unconditionally bound to
  // `DrizzleLedgerStore` whenever `env.localDir` is set (mirroring
  // `goalTasks`/`childAgentRuns`) — the ONE remaining blocker this fix's
  // own doc history disclosed is now closed. TASK-011's own
  // restart-durability tests (see `jobpilot-culture-research.test.ts`)
  // verify the SAME guarantee holds for a pending research-proposal
  // approval and an approved-but-unmaterialized fetch specifically, not
  // just the generic relation-decision case RM4's own tests cover.
  const localDirDurable = Boolean(env.localDir);

  return {
    roles: mRoles,
    agents: mAgents,
    ephemeral: mEphemeral,
    policyStore: new InMemoryPolicyStore(policies),
    ledger,
    taintAudit: localDirDurable
      ? new DrizzleTaintAuditStore(localDb)
      : new InMemoryTaintAuditStore(),
    relationMaterializations: new DrizzleRelationMaterializationStore(localDb),
    automationRegistry: localDirDurable
      ? new DrizzleAutomationRegistry(localDb)
      : new InMemoryAutomationRegistry(),
    automationRunRecorder: localDirDurable
      ? new DrizzleAutomationRunRecorder(localDb)
      : new InMemoryAutomationRunRecorder(),
    canonical: new InMemoryCanonicalIdentityStore(),
    organizationStore: new DrizzleOrganizationStore(localDb, env.organizationRenameCoordinator),
    graphStore,
    jobpilotStore: new DrizzleJobPilotStore(localDb, PILOT_ORGANIZATION),
    helpdeskStore: new DrizzleHelpdeskStore(localDb, PILOT_ORGANIZATION),
    resourcesStore: new DrizzleResourcesStore(localDb),
    capabilityStore: new DrizzleCapabilityStore(localDb, PILOT_ORGANIZATION),
    evalStore: new DrizzleEvalStore(localDb, PILOT_ORGANIZATION),
    policyParams: new DrizzlePolicyParamStore(localDb),
    organizationDefinitionStore: new DrizzleOrganizationDefinitionStore(
      localDb,
      PILOT_ORGANIZATION,
    ),
    moduleStore: localDirDurable
      ? new DrizzleModuleStore(localDb, PILOT_ORGANIZATION)
      : new InMemoryModuleStore(),
    memoryStore: new DrizzleMemoryStore(localDb),
    vectorIndex: new DrizzleVectorIndex(localDb),
    // TASK-007 — dependency-free in-memory default (dev/test). The SAME
    // GOVERNED_SKILL_MANIFEST_CATALOG code-declared list `buildPersistentPorts`
    // seeds into `skill_manifests` is registered here synchronously — one
    // source of truth for what's governed, two durability backends.
    goalTasks: localDirDurable ? new DrizzleGoalTaskStore(localDb) : new InMemoryGoalTaskStore(),
    taskManager: localDirDurable ? new DrizzleTaskManagerStore(localDb, pilotUserId) : new InMemoryTaskManagerStore(),
    skillManifests: (() => {
      const registry = new InMemorySkillManifestRegistry();
      for (const m of GOVERNED_SKILL_MANIFEST_CATALOG) registry.register(m);
      return registry;
    })(),
    childAgentRuns: localDirDurable ? new DrizzleChildAgentRunStore(localDb) : new InMemoryChildAgentRunStore(),
    researchRuns: localDirDurable ? new DrizzleResearchRunStore(localDb) : new InMemoryResearchRunStore(),
    chatStore: localDirDurable
      ? new DrizzleChatStore(localDb)
      : new InMemoryChatStore(),
    // Echo double (local plane) — zero-infra mode makes no network calls, model
    // calls included; anything needing a real model runs in persistent mode.
    modelProviders: [new LlamaCppProvider(), new EchoModelProvider()],
    memory: { roles: mRoles, agents: mAgents, ephemeral: mEphemeral },
    // origin/main (TASK-010/restart-test infra) — when the caller supplies its
    // OWN already-open `env.localDatabase` (to avoid re-running migrations
    // twice against the same on-disk directory within one process — the exact
    // limitation TASK-011's own restart tests document), closing it here is
    // the CALLER's responsibility, not this function's; only close the
    // connection this function itself opened.
    closeDb: env.localDatabase ? async () => {} : localDatabase.close,
    // TASK-011 remediation (2026-07-19 coordinator distributed-defects
    // RE-review, issue 6) — when `BRIDGE_LOCAL_DIR` is set,
    // `DrizzleGoalTaskStore`/`DrizzleChildAgentRunStore` enforce REAL
    // foreign-key integrity against the `agents`/`organizations` tables (e.g.
    // `tasks.assigned_agent_id -> agents.id`). `organizationStore` here is
    // ALREADY always Drizzle-backed (`bootstrapPilotIdentities` below
    // already creates the real organization/user rows regardless of mode),
    // but the governed AGENT rows themselves were never seeded into the
    // real `agents` table in this mode — every FK insert referencing them
    // would fail closed with a constraint violation the moment
    // `goalTasks`/`childAgentRuns` became real. Seed the SAME rows
    // `buildPersistentPorts` seeds, via the SAME idempotent
    // `ensure*Governance` helpers, so referential integrity holds. This
    // does NOT change which store AUTHORITY/capability decisions are read
    // from (still `InMemoryAgentStore`/`InMemoryRoleStore`, via
    // `seedGovernance` above) — it only ensures the REAL DB rows those
    // decisions' FK-referencing writes depend on actually exist. A no-op
    // when `BRIDGE_LOCAL_DIR` is unset (the hooks are simply absent, exactly
    // as before this fix).
    ...(localDirDurable
      ? {
          ensureLearningGovernance: () =>
            ensureLearningAgentGovernance(localDb, {
              organizationId: PILOT_ORGANIZATION,
              userId: pilotUserId,
              agentId: LEARNING_AGENT,
              roleId: LEARNING_ROLE,
              permissionId: LEARNING_SIGNAL_PERMISSION,
            }),
          ensureOutreachGovernance: () =>
            ensureOutreachAgentGovernance(localDb, {
              organizationId: PILOT_ORGANIZATION,
              userId: pilotUserId,
              agentId: OUTREACH_AGENT,
              roleId: OUTREACH_ROLE,
              permissionId: OUTREACH_EVENT_PERMISSION,
            }),
          ensureInternalStrategistGovernance: () =>
            ensureInternalStrategistGovernance(localDb, {
              organizationId: PILOT_ORGANIZATION,
              userId: pilotUserId,
              agentId: INTERNAL_STRATEGIST_AGENT,
              roleId: INTERNAL_STRATEGIST_ROLE,
              permissionId: INTERNAL_STRATEGIST_SIGNAL_PERMISSION,
            }),
          ensureGovernanceAgentGovernance: () =>
            ensureGovernanceAgentGovernance(localDb, {
              organizationId: PILOT_ORGANIZATION,
              userId: pilotUserId,
              agentId: GOVERNANCE_AGENT,
              roleId: GOVERNANCE_ROLE,
              permissionId: GOVERNANCE_SIGNAL_PERMISSION,
            }),
          ensureCapabilityBuilderGovernance: () =>
            ensureCapabilityBuilderGovernance(localDb, {
              organizationId: PILOT_ORGANIZATION,
              userId: pilotUserId,
              agentId: CAPABILITY_BUILDER_AGENT,
              roleId: CAPABILITY_BUILDER_ROLE,
              permissionId: CAPABILITY_BUILDER_SIGNAL_PERMISSION,
            }),
          ensureEgressGovernance: () =>
            ensureEgressAgentGovernance(localDb, {
              organizationId: PILOT_ORGANIZATION,
              userId: pilotUserId,
              agentId: EGRESS_AGENT,
              roleId: EGRESS_ROLE,
              permissionId: EGRESS_PRINCIPAL_PERMISSION,
            }),
          ensureIntakeGovernance: () =>
            ensureIntakeAgentGovernance(localDb, {
              organizationId: PILOT_ORGANIZATION,
              userId: pilotUserId,
              agentId: INTAKE_AGENT,
              roleId: INTAKE_ROLE,
              permissionId: INTAKE_PRINCIPAL_PERMISSION,
            }),
          ensureDealPilotPrincipalGovernance: () =>
            ensureDealPilotPrincipalGovernance(localDb, {
              organizationId: PILOT_ORGANIZATION,
              userId: pilotUserId,
            }),
          ensureCapabilityApprovalGovernance: () =>
            ensureCapabilityApprovalPrincipalGovernance(localDb, {
              organizationId: PILOT_ORGANIZATION,
              userId: pilotUserId,
            }),
        }
      : {}),
  };
}

export function encryptedCredentialVaultFromEnv(
  directory: string,
  env: NodeJS.ProcessEnv = process.env,
): EncryptedFileSourceCredentialVault {
  const currentId = env.BRIDGE_CREDENTIAL_VAULT_KEY_ID?.trim();
  const currentKey = env.BRIDGE_CREDENTIAL_VAULT_KEY?.trim();
  if (!currentId || !currentKey) {
    throw new Error(
      "BRIDGE_CREDENTIAL_VAULT_KEY_ID and BRIDGE_CREDENTIAL_VAULT_KEY are required for the encrypted-file credential vault",
    );
  }

  const previousId = env.BRIDGE_CREDENTIAL_VAULT_PREVIOUS_KEY_ID?.trim();
  const previousKey = env.BRIDGE_CREDENTIAL_VAULT_PREVIOUS_KEY?.trim();
  if (Boolean(previousId) !== Boolean(previousKey)) {
    throw new Error(
      "BRIDGE_CREDENTIAL_VAULT_PREVIOUS_KEY_ID and BRIDGE_CREDENTIAL_VAULT_PREVIOUS_KEY must be configured together",
    );
  }
  return new EncryptedFileSourceCredentialVault({
    directory,
    current: credentialVaultKeyFromBase64(currentId, currentKey),
    ...(previousId && previousKey
      ? { previous: credentialVaultKeyFromBase64(previousId, previousKey) }
      : {}),
  });
}

function publicCloudCredentialVault(): SourceCredentialVault {
  const unavailable = () =>
    new Error(
      "Source credentials require the desktop Local Plane and are unavailable in public-cloud mode",
    );
  return {
    reserve() {
      throw unavailable();
    },
    async write() {
      throw unavailable();
    },
    async put() {
      throw unavailable();
    },
    async metadata() {
      throw unavailable();
    },
    async read() {
      throw unavailable();
    },
    async delete() {
      throw unavailable();
    },
  };
}

export async function seedBuiltInModules(
  moduleStore: ModuleStore,
  organizationId: string,
): Promise<void> {
  for (const builtIn of BUILT_IN_MODULES) {
    const manifest = parseModuleManifest({ module: builtIn.manifest });
    const versions = await moduleStore.listVersions(organizationId, manifest.name);
    const current = versions.find((row) => row.moduleVersion === manifest.version);
    if (current) {
      if (canonicalizeManifest(current.manifest) !== canonicalizeManifest(manifest)) {
        await moduleStore.setNormalizedManifest(current.id, manifest);
      }
      continue;
    }
    for (const previous of versions.filter((row) => row.state === "available")) {
      await moduleStore.setState(previous.id, "legacy");
    }
    await moduleStore.create({
      organizationId,
      moduleName: manifest.name,
      moduleVersion: manifest.version,
      manifest,
      computedRisk: builtIn.computedRisk,
      state: "available",
      status: "installed",
      lineageManifestId: null,
    });
  }
}

/** One demo Deal: economics in `base`, triage signals (AP-087/ADR-155) in
 * `signals` so a legacy row can be signal-backfilled without touching economics. */
type DemoDeal = {
  company: string;
  base: Pick<DealRecord, "stage" | "revenue" | "ebitda" | "sde" | "askingPrice">;
  signals: Pick<
    DealRecord,
    "rag" | "fitScore" | "evidenceScore" | "p0Flags" | "thesisTag" | "sourceChannel"
  >;
};

/**
 * The pilot demo Deal set (AP-087/ADR-155). The first three are the original
 * AP-083 companies (kept so existing hosted rows enrich in place by name); the
 * rest fill out an eight-deal pipeline that exercises every signal — RAG bands,
 * fit/evidence spreads, P0 flags, and thesis/source tags. Illustrative demo data,
 * tracked in docs/dummy.md; all values are user-editable and removed once real
 * pilot Deals exist.
 */
const DEMO_DEALS: readonly DemoDeal[] = [
  {
    company: "Northwind Traders",
    base: { stage: "diligence", revenue: 4_200_000, ebitda: 780_000, askingPrice: 6_500_000 },
    signals: { rag: "green", fitScore: 82, evidenceScore: 74, p0Flags: 0, thesisTag: "LMM Logistics", sourceChannel: "Broker — BizBuySell" },
  },
  {
    company: "Cascade Logistics",
    base: { stage: "triage", revenue: 12_500_000, ebitda: 1_900_000, askingPrice: 15_000_000 },
    signals: { rag: "yellow", fitScore: 68, evidenceScore: 52, p0Flags: 1, thesisTag: "LMM Logistics", sourceChannel: "Network" },
  },
  {
    company: "Alpine Dental Group",
    base: { stage: "sourced", revenue: 2_100_000, sde: 620_000, askingPrice: 2_900_000 },
    signals: { rag: "yellow", fitScore: 61, evidenceScore: 40, p0Flags: 2, thesisTag: "Healthcare Services", sourceChannel: "Proprietary" },
  },
  {
    company: "Meridian Systems",
    base: { stage: "ic", revenue: 14_200_000, ebitda: 4_100_000, askingPrice: 42_000_000 },
    signals: { rag: "green", fitScore: 87, evidenceScore: 78, p0Flags: 1, thesisTag: "B2B SaaS", sourceChannel: "Proprietary" },
  },
  {
    company: "Clearfield Analytics",
    base: { stage: "diligence", revenue: 8_700_000, ebitda: 2_300_000, askingPrice: 28_000_000 },
    signals: { rag: "yellow", fitScore: 73, evidenceScore: 55, p0Flags: 2, thesisTag: "Data Infra", sourceChannel: "Broker — Baird" },
  },
  {
    company: "NorthBridge HR",
    base: { stage: "closing", revenue: 18_600_000, ebitda: 6_200_000, askingPrice: 68_000_000 },
    signals: { rag: "green", fitScore: 91, evidenceScore: 88, p0Flags: 0, thesisTag: "B2B SaaS", sourceChannel: "Proprietary" },
  },
  {
    company: "RoofTech Pro",
    base: { stage: "diligence", revenue: 11_400_000, ebitda: 2_900_000, askingPrice: 31_000_000 },
    signals: { rag: "red", fitScore: 55, evidenceScore: 58, p0Flags: 3, thesisTag: "V-SMB", sourceChannel: "Broker — Raymond J." },
  },
  {
    company: "Silo Data",
    base: { stage: "passed", revenue: 6_000_000, ebitda: 400_000, askingPrice: 19_000_000 },
    signals: { rag: "red", fitScore: 32, evidenceScore: 24, p0Flags: 2, thesisTag: "Data Infra", sourceChannel: "Broker — GS" },
  },
];

/**
 * AP-083 — idempotent Cloud-Plane demo data for the pilot Organization so the
 * deployed web app's modules aren't empty. Seeds ONLY governed Records via the
 * stores (which enforce RLS + valid row construction), guarded on an empty
 * surface so re-boots never duplicate. NEVER seeds Source credentials or raw
 * capture — those stay on the Local Plane (docs/dummy.md tracks removal).
 */
async function seedPilotDemoData(
  dealpilot: DealPilotStore,
  jobpilot: DrizzleJobPilotStore,
): Promise<void> {
  // Demo Deals (AP-087/ADR-155). Idempotent AND edit-safe: a demo company that
  // does not exist is created with its triage signals; a legacy demo row (seeded
  // before the signal columns existed) is backfilled ONCE; a row a human has
  // already scored/edited is never overwritten. `sde`-only deals (e.g. Alpine)
  // leave EBITDA/Multiple honestly empty.
  const existingDeals = await dealpilot.list("deals", PILOT_ORGANIZATION, { limit: 200, offset: 0 });
  const dealByCompany = new Map(
    existingDeals.items
      .filter((record): record is DealRecord => record.kind === "deal")
      .map((deal) => [deal.company, deal] as const),
  );
  let northwind: DealRecord | undefined;
  for (const spec of DEMO_DEALS) {
    const { company, signals, ...base } = spec;
    const current = dealByCompany.get(company);
    if (!current) {
      const created = await dealpilot.createDeal({
        organizationId: PILOT_ORGANIZATION,
        company,
        ...base,
        ...signals,
      });
      if (company === "Northwind Traders") northwind = created;
      continue;
    }
    // Backfill signals only when the row carries none yet (never clobber edits).
    const unscored =
      current.rag == null &&
      current.fitScore == null &&
      current.evidenceScore == null &&
      current.p0Flags == null &&
      current.thesisTag == null &&
      current.sourceChannel == null;
    if (unscored) {
      await dealpilot.updateDeal(current.id, PILOT_ORGANIZATION, { ...signals });
    }
    if (company === "Northwind Traders") northwind = current;
  }

  // Sources + Theses + one Relation seed once, on a fresh Sources table.
  const sources = await dealpilot.list("sources", PILOT_ORGANIZATION, { limit: 1, offset: 0 });
  if (sources.total === 0) {
    const bizbuysell = await dealpilot.createSource({
      organizationId: PILOT_ORGANIZATION,
      name: "BizBuySell Weekly Alert",
      link: "https://www.bizbuysell.com/",
      connectionType: "email_alert",
      spendCap: 100,
      rightsState: "attested",
      rightsAttestedBy: PILOT_USER,
    });
    await dealpilot.createSource({
      organizationId: PILOT_ORGANIZATION,
      name: "Axial Deal Network",
      link: "https://www.axial.net/",
      connectionType: "account",
      spendCap: 250,
      rightsState: "unattested",
    });
    await dealpilot.createThesis({
      organizationId: PILOT_ORGANIZATION,
      name: "Lower-Middle-Market Logistics",
      focus: "Asset-light 3PL and last-mile rollups",
      targetCagr: 0.18,
      criteria: ["EBITDA $1M-$3M", "Recurring contract revenue", "Fragmented regional market"],
      exclusions: ["Owner-operator dependent", "Single-customer concentration"],
      sourcingStrategy: "Broker alerts + proprietary outreach",
    });
    await dealpilot.createThesis({
      organizationId: PILOT_ORGANIZATION,
      name: "Healthcare Services Consolidation",
      focus: "Multi-site dental and dermatology platforms",
      targetCagr: 0.22,
      criteria: ["2+ existing locations", "Insurance + private-pay mix"],
      exclusions: ["Single-provider practices", "Pending litigation"],
      sourcingStrategy: "Thesis-led sourcing via authorized inventory",
    });
    if (northwind) {
      await dealpilot.link({
        organizationId: PILOT_ORGANIZATION,
        kind: "deal_source",
        fromId: northwind.id,
        toId: bizbuysell.id,
        confidence: 0.8,
        provenance: "seed",
        evidenceRefs: [],
      });
    }
  }

  const jobs = await jobpilot.listJobs(PILOT_ORGANIZATION, { limit: 1, offset: 0 });
  if (jobs.total === 0) {
    const platform = await jobpilot.createJob({
      organizationId: PILOT_ORGANIZATION,
      title: "Senior Platform Engineer",
      company: "Vercel",
      location: "Remote (US)",
      salaryMax: 210_000,
      url: "https://example.com/jobs/1",
      source: "greenhouse",
    });
    await jobpilot.updateApplication(platform.application.id, {
      stage: "evaluating",
      flag: "pursue",
      fitScore: 0.86,
    });
    const manager = await jobpilot.createJob({
      organizationId: PILOT_ORGANIZATION,
      title: "Engineering Manager",
      company: "Ramp",
      location: "New York, NY",
      salaryMax: 260_000,
      url: "https://example.com/jobs/3",
      source: "lever",
    });
    await jobpilot.updateApplication(manager.application.id, {
      stage: "tailoring",
      flag: "review",
      fitScore: 0.71,
    });
    await jobpilot.createJob({
      organizationId: PILOT_ORGANIZATION,
      title: "Staff Product Designer",
      company: "Linear",
      location: "Remote",
      salaryMax: 190_000,
      url: "https://example.com/jobs/2",
      source: "ashby",
    });
  }
}

function runningUnderNodeTest(): boolean {
  return process.env.NODE_TEST_CONTEXT !== undefined;
}
export async function buildWiring(options: BuildWiringOptions = {}): Promise<Wiring> {
  const publicCloudOnly = isPublicCloudOnly();
  const pilotUserId = process.env.BRIDGE_PILOT_USER_ID?.trim() || PILOT_USER;
  const pilotUserEmail =
    process.env.BRIDGE_PILOT_USER_EMAIL?.trim() || PILOT_USER_EMAIL;
  const geocodingProvider =
    options.geocodingProvider ?? localGeocodingProviderFromEnv(process.env);
  const events = new InMemoryEventBus();
  // LA3 Phase 1 always ships the anonymous Parallel Search MCP adapter. Phase 2
  // adds the credentialed REST adapter ONLY when a key is configured, and
  // widens the admission policy to match. With no key the deployment keeps the
  // original anonymous-only posture — the policy never widens on its own.
  const parallelSearchApiKey = process.env.PARALLEL_API_KEY?.trim();
  const searchProviders =
    options.searchProviders ??
    new RightsVerifiedSearchProviderRouter(
      [
        new ParallelSearchProvider(),
        ...(parallelSearchApiKey
          ? [new ParallelSearchApiProvider({ apiKey: parallelSearchApiKey })]
          : []),
      ],
      parallelSearchApiKey
        ? { admission: FREE_CREDENTIALED_SEARCH_ADMISSION }
        : {},
    );
  const skillRegistry = new InMemorySkillRegistry()
    .register(stageMutation)
    .register(stageCapture)
    .register(stageLearningRecommendation)
    .register(stageStrategicRecommendation)
    .register(stageHelpRequestOffer)
    .register(stageOutreachDraft)
    .register(createResearchCultureSourceSkill())
    .register(stagePreferenceAdjustmentProposal)
    .register(stageCapabilityBuildRecommendation)
    .register(stageCapabilityDraft)
    .register(stageCapabilityDraftReview);
  for (const manifest of TASK_MANAGER_SKILL_MANIFESTS) {
    skillRegistry.register({
      name: manifest.skillId,
      async run(inputs, ctx) {
        if (manifest.skillId === "task-manager.create-task") {
          const values = inputs as Record<string, unknown>;
          const proposedOutput = {
            kind: "task_create",
            taskId: values.taskId,
            title: values.title,
            outcome: values.outcome,
            exitTest: values.exitTest,
            status: "proposed",
          };
          return { proposedOutput, diff: { to: proposedOutput } };
        }
        return { proposedOutput: inputs, diff: { to: inputs } };
      },
    });
  }
  const variance = new RecordingVarianceAdjuster();

  const url = process.env.DATABASE_URL;
  const moduleFilesBridgeRoot =
    options.moduleFilesBridgeRoot
    ?? process.env.BRIDGE_FILES_ROOT
    ?? defaultBridgeFilesRoot();

  // Runtime Local Plane is file-backed. Only the isolated Node test runner may
  // opt into ephemeral PGlite; web/server launches otherwise fail loudly.
  const localDir = options.localDir ?? process.env.BRIDGE_LOCAL_DIR;
  if (options.allowEphemeralLocalPlane === true && !runningUnderNodeTest()) {
    throw new Error(
      "allowEphemeralLocalPlane is restricted to the isolated Node test runner",
    );
  }
  const allowEphemeralLocalPlane =
    runningUnderNodeTest() && options.allowEphemeralLocalPlane !== false;
  if (!localDir && !allowEphemeralLocalPlane) {
    throw new Error(
      "BRIDGE_LOCAL_DIR is required: DealPilot Records, captures, and continuation state cannot use process-local runtime storage",
    );
  }
  // TASK-032 flight — options override wins (tests/deployments); otherwise
  // the environment decides; absent both, the loop is OFF.
  const learningObservationEnabled =
    options.learningObservationEnabled ??
    ["1", "true"].includes((process.env.BRIDGE_LEARNING_OBSERVATION ?? "").trim().toLowerCase());
  // LA5 flight — same override-then-environment resolution, default OFF.
  const retrievalFusionEnabled =
    options.retrievalFusionEnabled ??
    ["1", "true"].includes((process.env.BRIDGE_RETRIEVAL_FUSION ?? "").trim().toLowerCase());
  // Commons-archetypes flight (roadmap-v2 Phase 4) — same resolution, default OFF.
  const commonsArchetypesEnabled =
    options.commonsArchetypesEnabled ??
    ["1", "true"].includes((process.env.BRIDGE_COMMONS_ARCHETYPES ?? "").trim().toLowerCase());
  // LA5 semantic embedder — explicit override wins; otherwise the ONLY
  // provider trusted for real semantics today is Ollama (its embed hits a
  // genuine embedding model). The Echo double's pseudo-embed is a test
  // artifact and must never be mistaken for semantics, so resolution is an
  // id allowlist, not duck-typing on `embed`.
  const resolveSemanticEmbedder = (providers: readonly ModelProvider[]): TextEmbedder | undefined => {
    const ollama = providers.find(
      (provider) => provider.id === "ollama" && provider.plane === "local" && typeof provider.embed === "function",
    );
    if (!ollama?.embed) return undefined;
    const embed = ollama.embed.bind(ollama);
    const embedModelId = (ollama as ModelProvider & { embedModelId?: unknown }).embedModelId;
    return { id: typeof embedModelId === "string" ? embedModelId : "ollama:embed", embed };
  };
  const credentialProvider =
    process.env.BRIDGE_DEALPILOT_CREDENTIAL_VAULT ??
    (runningUnderNodeTest() ? "os-keyring" : undefined);
  if (
    !options.dealPilotCredentialVault &&
    credentialProvider !== "os-keyring" &&
    credentialProvider !== "encrypted-file" &&
    !(publicCloudOnly && credentialProvider === "disabled")
  ) {
    throw new Error(
      credentialProvider
        ? `Unsupported BRIDGE_DEALPILOT_CREDENTIAL_VAULT "${credentialProvider}"; configure an approved secure provider`
        : "BRIDGE_DEALPILOT_CREDENTIAL_VAULT must explicitly name an approved secure provider",
    );
  }
  const localOwnership = localDir
    ? await acquirePgliteDirectoryOwnership(localDir)
    : undefined;
  const effectiveLocalDir = localOwnership?.dataDir;
  let localDatabase: Awaited<ReturnType<typeof createLocalDb>>;
  let localPlane: LocalPlane;
  try {
    const created = await createLocalDb(effectiveLocalDir ? { dataDir: effectiveLocalDir } : {});
    try {
      localPlane = await createPgliteLocalPlane({ client: created.client });
      localDatabase = created;
    } catch (error) {
      try {
        await created.close();
      } catch (closeError) {
        throw new LocalDbInitializationCleanupError(error, closeError);
      }
      throw error;
    }
  } catch (error) {
    if (!(error instanceof LocalDbInitializationCleanupError)) {
      await localOwnership?.release();
    }
    throw error;
  }

  let modePortsForCleanup: ModePorts | undefined;
  let managedModelForCleanup: ManagedModelService | undefined;
  let closePromise: Promise<void> | undefined;
  const closeResources = (): Promise<void> => {
    closePromise ??= (async () => {
      const errors: unknown[] = [];
      managedModelForCleanup?.close();
      try {
        await localPlane.close();
      } catch (error) {
        errors.push(error);
      }
      try {
        await modePortsForCleanup?.closeDb();
      } catch (error) {
        errors.push(error);
      }
      let localDatabaseClosed = false;
      try {
        await localDatabase.close();
        localDatabaseClosed = true;
      } catch (error) {
        errors.push(error);
      }
      if (localDatabaseClosed) {
        try {
          await localOwnership?.release();
        } catch (error) {
          errors.push(error);
        }
      } else if (localOwnership) {
        errors.push(
          new Error("Exclusive Local Plane ownership was retained because its PGlite client did not close"),
        );
      }
      if (errors.length > 0) {
        throw new AggregateError(errors, "One or more wiring resources failed to close");
      }
    })();
    return closePromise;
  };

  try {
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
  const organizationRenameCoordinator: OrganizationRenameCoordinator = {
    createLease: (organizationId) =>
      createOrganizationRenameLease(
        organizationId,
        moduleFilesBridgeRoot,
      ),
  };
  const modePorts: ModePorts = url
    ? buildPersistentPorts({ url, pilotUserId, organizationRenameCoordinator })
    : await buildInMemoryPorts({
        localDir,
        pilotUserId,
        localDatabase,
        organizationRenameCoordinator,
      });
  modePortsForCleanup = modePorts;
  // SEC-5 boot guard: in persistent (prod) mode, refuse to serve if the DB role can
  // bypass RLS. No-op in in-memory mode and outside production (guard self-gates).
  await modePorts.verifyRlsPosture?.();
  // TASK-011 remediation (2026-07-18) — the durable culture-fetch intent
  // store needs `modePorts.memoryStore`, which is only available once the
  // mode-specific ports are resolved (Drizzle-backed in BOTH persistent and
  // zero-infra/local-SQLite dev modes — see `buildPersistentPorts`/
  // `buildInMemoryPorts`). The abort-controller map stays process-local and
  // is intentionally NOT part of `modePorts`.
  const cultureFetchStore = new DurableCultureFetchStore(modePorts.memoryStore);
  const cultureSynthesisPointerStore = new DurableCultureSynthesisPointerStore(modePorts.memoryStore);
  const cultureLatestRunPointerStore = new DurableCultureLatestRunPointerStore(modePorts.memoryStore);
  const cultureFetchAbortControllers = new Map<string, AbortController>();
  // TASK-011 remediation (2026-07-19 coordinator distributed-defects
  // RE-review round 2, issue 8) — registered HERE (not at `skillRegistry`'s
  // initial construction above) because this Skill needs
  // `modePorts.childAgentRuns`/`cultureFetchStore` to resolve its own
  // fetched results internally, rather than trusting full raw content
  // passed in via `inputs` (see `createSynthesizeCultureProfileSkill`'s doc
  // comment for why).
  skillRegistry.register(createSynthesizeCultureProfileSkill({ childAgentRuns: modePorts.childAgentRuns, fetchStore: cultureFetchStore }));
  const {
    roles,
    agents,
    ephemeral,
    policyStore,
    ledger: modeLedger,
    taintAudit: modeTaintAudit,
    relationMaterializations,
    automationRegistry,
    automationRunRecorder,
    canonical,
    organizationStore,
    graphStore,
    jobpilotStore,
    helpdeskStore,
    resourcesStore,
    capabilityStore,
    organizationDefinitionStore,
    moduleStore,
    memoryStore,
    vectorIndex,
    goalTasks,
    taskManager,
    skillManifests,
    childAgentRuns,
    researchRuns,
    chatStore: modeChatStore,
    modelProviders: modeModelProviders,
    memory,
  } = modePorts;
  const ledger: LedgerStore = url
    ? new ResidencyRoutingLedgerStore(
        new DrizzleLedgerStore(localDatabase.db, {
          defaultOrganizationId: PILOT_ORGANIZATION,
          defaultUserId: pilotUserId,
        }),
        modeLedger,
      )
    : modeLedger;
  const chatStore: ChatStore = url
    ? new ResidencyRoutingChatStore(
        publicCloudOnly ? null : new DrizzleChatStore(localDatabase.db),
        modeChatStore,
      )
    : modeChatStore;
  const taintAudit: TaintAuditStore = url
    ? new PlaneRoutingTaintAuditStore(
        localDir
          ? new DrizzleTaintAuditStore(localDatabase.db)
          : new InMemoryTaintAuditStore(),
        modeTaintAudit,
      )
    : modeTaintAudit;
  const modelProviders = options.modelProviders ? [...options.modelProviders] : modeModelProviders;
  const semanticEmbedder = options.semanticEmbedder ?? resolveSemanticEmbedder(modelProviders);
  // Kernel policies are deployment-invariant safety rules. Persistent mode also
  // evaluates organization policies from Postgres; it must not replace these rules.
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

  // ModelProvider registry/router — resolves capability manifest modelBindings honoring
  // planeDefault (local-default bindings NEVER fall through to a cloud provider).
  const models = createModelRouter(modelProviders);
  const managedLlamaProvider = modelProviders.find(
    (provider): provider is LlamaCppProvider =>
      provider.id === MANAGED_LLAMA_PROVIDER_ID &&
      provider instanceof LlamaCppProvider,
  );
  const manifestCandidates = [
    fileURLToPath(
      new URL("../../../model-runtime-manifest.json", import.meta.url),
    ),
    fileURLToPath(
      new URL("../../../desktop/model-runtime-manifest.json", import.meta.url),
    ),
  ];
  const modelRuntimeManifestPath =
    options.modelRuntimeManifestPath ??
    process.env.BRIDGE_MODEL_RUNTIME_MANIFEST ??
    manifestCandidates.find(existsSync);
  const modelRuntimeDir =
    options.modelRuntimeDir ??
    process.env.BRIDGE_MODEL_RUNTIME_DIR ??
    (!publicCloudOnly && localDir ? `${localDir}.model-runtime` : undefined);
  const managedModel = new ManagedModelService({
    ...(modelRuntimeDir ? { runtimeDir: modelRuntimeDir } : {}),
    ...(modelRuntimeManifestPath ? { manifestPath: modelRuntimeManifestPath } : {}),
    ...(managedLlamaProvider ? { provider: managedLlamaProvider } : {}),
  });
  managedModelForCleanup = managedModel;
  // Resolved PER INSPECTION, not at boot: on desktop the managed local model
  // becomes healthy ~30s after this wiring runs (the supervisor clears its
  // endpoint capability on start and republishes it only after the model
  // passes health), so a boot-time snapshot would leave the guard dead for
  // the whole process lifetime. Lazy resolution adds RECOVERY only — an
  // unavailable local model still fails closed exactly as before.
  const findLocalGuardProvider = () =>
    modelProviders.find(
      (provider) =>
        provider.plane === "local" &&
        provider.tiers.includes("cheap") &&
        provider.routingHealth() !== "unavailable",
    );
  let localGuard: { provider: ModelProvider; guard: ContentGuard } | null = null;
  const webResearchContentGuard =
    options.webResearchContentGuard ?? {
      async inspect(input: Parameters<ContentGuard["inspect"]>[0]) {
        const provider = findLocalGuardProvider();
        if (!provider) {
          return {
            safe: false,
            categories: ["local_content_guard_unavailable"],
            extraction: { summary: "", entities: [] },
            reason:
              "No healthy Local Plane content guard is configured; untrusted content remains quarantined",
          };
        }
        if (!localGuard || localGuard.provider !== provider) {
          localGuard = { provider, guard: createLocalContentGuard(provider) };
        }
        return localGuard.guard.inspect(input);
      },
    };
  skillRegistry.register(
    createWebResearchSkill(searchProviders, webResearchContentGuard),
  );

  // Capability Trust Model support ports (docs/wiki/vision.md): budgets + kill
  // switch stay in-memory in BOTH modes for now — no persistent implementation
  // exists yet anywhere in the codebase. Keep that explicit rather than silently
  // faking durability that doesn't exist.
  const capabilityBudgets = new InMemoryAutoActivationBudgetStore();
  const capabilityKillSwitch = new InMemoryKillSwitch();
  const credentialBroker = new InMemoryCredentialBroker();
  // Onboarding preferences are private Local Plane Memory when a durable local
  // root exists. Public-cloud and isolated ephemeral modes retain no private
  // profile across process restarts.
  const onboardingProfileStore =
    localDir && !publicCloudOnly
      ? new MemoryBackedOnboardingProfileStore(
          new DrizzleMemoryStore(localDatabase.db),
          pilotUserId,
        )
      : new InMemoryOnboardingProfileStore();
  // P2 capability modules — now backed by DrizzleModuleStore in persistent mode
  // (ADR-023); `moduleStore` comes from modePorts (see above), same split every
  // other per-mode port already follows.

  // DealPilot: the first Module wired through the generic manifest intake seam
  // (shared capability intake contract) — sourcing quarantines
  // through the pipeline as `external:fetch`; commit is a separate human "Add" (capture ≠
  // commit, same pattern as Camera). BusinessBroker.net has no live connector yet (its
  // robots.txt blocks the paths a fetcher needs — see docs/wiki/known-issues.md), so only
  // BizBuySell is registered.
  const dealPilotStore = new LocalDealPilotStore(localPlane.state);
  // Public-cloud only (ADR-151, AP-083): serve DealPilot Deal/Source/Thesis
  // Records from the Cloud Plane (Supabase) so they load in the web app, while
  // captures + Source credentials stay refused (Local Plane). Desktop/persistent
  // mode keeps the all-Local store so the discovery pipeline's Records and its
  // captures stay co-located (no split-brain). The discovery closures below keep
  // using `dealPilotStore` directly; only `wiring.dealpilot.store` is composed.
  const dealPilotRuntimeStore: DealPilotRuntimeStore =
    publicCloudOnly && modePorts.dealPilotRecordStore
      ? cloudRecordsDealPilotStore(modePorts.dealPilotRecordStore)
      : dealPilotStore;
  const localOrganizationStore = new DrizzleOrganizationStore(localDatabase.db);
  const integrationStore = new DrizzleIntegrationStore(localDatabase.db);
  const credentialVaultRoot = effectiveLocalDir ?? localDir;
  if (credentialProvider === "encrypted-file" && !credentialVaultRoot) {
    throw new Error(
      "The encrypted-file credential vault requires a durable BRIDGE_LOCAL_DIR",
    );
  }
  const dealPilotCredentialVault =
    options.dealPilotCredentialVault ??
    (credentialProvider === "disabled"
      ? publicCloudCredentialVault()
      : credentialProvider === "encrypted-file"
      ? encryptedCredentialVaultFromEnv(
          join(credentialVaultRoot!, "credential-vault"),
        )
      : new KeyringSourceCredentialVault());
  if (!publicCloudOnly) {
    await reconcileCredentialOperations(
      dealPilotStore,
      dealPilotCredentialVault,
      PILOT_ORGANIZATION,
    );
  }
  const dealPilotCredentialAudit = dealPilotStore;
  const dealPilotCredentials = new SourceCredentialService(
    dealPilotCredentialVault,
    new HumanReauthentication(),
    dealPilotCredentialAudit,
  );
  const dealPilotBindings: DealPilotBindings = {
    relationshipAuthorized: false,
    tasksAuthorized: true,
  };
  const dealPilotIntegrationId = `${PILOT_ORGANIZATION}:google`;
  const dealPilotSourceConnector = createBizBuySellAlertConnector(
    createGmailFetchMessages(gateways, dealPilotIntegrationId, undefined, {
      stateStore: dealPilotStore,
    }),
  );
  const dealPilotDiscoveryLocks = new Map<string, Promise<SkillOutput>>();
  const validateDealPilotSourceDiscovery = async (
    organizationId: string,
    sourceId: string,
  ) => {
    const source = await dealPilotStore.get("source", organizationId, sourceId);
    if (!source || source.kind !== "source") {
      throw new Error("DealPilot Source Record not found");
    }
    const estimate = dealPilotSourceConnector.estimateCost({
      kind: "company",
      hints: { organizationId: source.organizationId, sourceId: source.id },
    });
    assertSourceDiscoveryAllowed(source, estimate);
    const hostname = new URL(source.link).hostname.toLowerCase();
    if (
      source.connectionType !== "email_alert" ||
      (hostname !== "bizbuysell.com" &&
        !hostname.endsWith(".bizbuysell.com"))
    ) {
      throw new Error(
        "This prototype supports Deal discovery only for an authorized BizBuySell email-alert Source",
      );
    }
    return { source, estimate };
  };
  skillRegistry.register({
    name: "dealpilot.source",
    async run(inputs, ctx) {
      const request = inputs as { organizationId?: unknown; sourceId?: unknown };
      if (typeof request.organizationId !== "string" || typeof request.sourceId !== "string") {
        throw new Error("DealPilot Source discovery requires organizationId and sourceId");
      }
      const lockKey = `${request.organizationId}:${request.sourceId}`;
      const active = dealPilotDiscoveryLocks.get(lockKey);
      if (active) return active;
      const operation = (async (): Promise<SkillOutput> => {
        const { source, estimate } =
          await validateDealPilotSourceDiscovery(
            request.organizationId as string,
            request.sourceId as string,
          );
        const discoveryStartedAt = ctx.clock.nowISO();
        const remaining = source.spendCap - source.spendToDate;
        const maxResults = Math.max(1, Math.floor(remaining / estimate));
        const query = {
          kind: "company" as const,
          hints: {
            organizationId: source.organizationId,
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
          await dealPilotStore.updateSource(source.id, source.organizationId, { health: "degraded" });
          throw error;
        }

        try {
          const actualSpend = batch.summary.attempted * estimate;
          let droppedForBudget = 0;
          const captures: QuarantinedCapture[] = [];
          let capturedSpend = 0;
          for (const envelope of batch.envelopes) {
            if (capturedSpend + envelope.costUnits > actualSpend) {
              droppedForBudget += 1;
              continue;
            }
            capturedSpend += envelope.costUnits;
            const captureId = ctx.ids.next();
            captures.push({
              ...envelope,
              captureId,
              moduleId: "dealpilot",
              trustOrigin: envelope.trustOrigin ?? "untrusted_external",
            });
          }
          if (!batch.summary.receipt) {
            throw new Error("Gmail connector did not return a durable acknowledgement receipt");
          }
          const settlement = await dealPilotStore.settleDiscoveryBatch({
            organizationId: source.organizationId,
            sourceId: source.id,
            receipt: batch.summary.receipt,
            captures,
            actualSpend,
            droppedForBudget,
            completedAt: discoveryStartedAt,
          });
          await dealPilotSourceConnector.acknowledge(query);
          if (settlement.status === "budget_exceeded") {
            throw new Error("Source connector exceeded its bounded fetch budget");
          }
          return {
            proposedOutput: {
              moduleId: "dealpilot",
              count: settlement.captureIds.length,
              captureIds: settlement.captureIds,
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
            diff: { quarantined: settlement.captureIds.length, droppedForBudget },
          };
        } catch (error) {
          await dealPilotSourceConnector.discard(query);
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
  // Idempotent bootstrap: the pilot organization/user are structural constants (not
  // migration seed data), but real DB writes FK-reference `organizations.id`/`users.id`
  // (e.g. `integration.connect` → `integrations.organization_id`, `organization.create` →
  // `organization_members.user_id`). Without this, any such write against a real/
  // persistent DB throws a raw Postgres FK violation (23503) the first time it runs,
  // because nothing ever inserts these rows. Safe to call every boot (no-op if present).
  await organizationStore.bootstrapPilotIdentities({
    organizationId: PILOT_ORGANIZATION,
    userId: pilotUserId,
    userEmail: pilotUserEmail,
  });
  await migrateLegacyPilotOrganization(organizationStore);
  if (url) {
    await localOrganizationStore.bootstrapPilotIdentities({
      organizationId: PILOT_ORGANIZATION,
      userId: pilotUserId,
      userEmail: pilotUserEmail,
    });
  }
  // Persistent governance rows reference the pilot organization and owner, so
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
  await modePorts.ensureCapabilityApprovalGovernance?.();
  // Refresh the persistent manifest registry before constructing the pipeline.
  // In-memory mode registers the same catalog synchronously in its port factory.
  await modePorts.ensureSkillManifestCatalog?.();

  // Helpdesk is now a nested Relationship sub-module, and Calendar is a View
  // kind rather than a Module. Preserve historical rows/data while removing
  // both retired standalone identities from installed navigation.
  await retireSupersededBuiltIns(moduleStore, PILOT_ORGANIZATION);

  // Built-in manifest content is immutable per version. New versions replace
  // the available installation while retaining prior rows as legacy evidence.
  await seedBuiltInModules(moduleStore, PILOT_ORGANIZATION);

  // AP-083 — populate the pilot Organization's Cloud-Plane demo data so the web
  // app's modules are not empty. Runs ONLY on the deployed public cloud (which
  // has a real Supabase DATABASE_URL), after the pilot Organization exists, so
  // tests and desktop/dev boots are unaffected. Idempotent (guards on an empty
  // surface) and best-effort (a failure logs and never blocks boot). Seeds only
  // governed Records — never Source credentials or raw capture (docs/dummy.md).
  if (publicCloudOnly && url) {
    try {
      await seedPilotDemoData(dealPilotRuntimeStore, modePorts.jobpilotStore);
    } catch (seedError) {
      console.warn("[wiring] pilot demo seed skipped:", seedError);
    }
  }

  // Signed Module manifests opt individual Automations into the executable
  // runtime with a stable Automation id. Inventory-only rows remain non-clickable.
  for (const pkg of BUILT_IN_MODULES) {
    const moduleAgents = new Map((pkg.manifest.module?.agents ?? []).map((agent) => [agent.id, agent]));
    for (const automation of pkg.manifest.module?.automations ?? []) {
      if (!automation.automationId) continue;
      const capability = pkg.manifest.capabilities.find((item) => item.id === automation.capabilityId);
      const permission = capability?.permissions[0];
      const agent = moduleAgents.get(automation.agentId);
      const automationId = resolveModuleAutomationRuntimeId(pkg.manifest.name, automation.automationId);
      const agentId = resolveModuleAgentRuntimeId(pkg.manifest.name, automation.agentId);
      if (!permission || !agent || !automationId || !agentId) continue;
      if (!agent.plane) throw new Error(`Module Automation ${automation.id} has no owning Agent Plane`);
      const manifest = skillManifests.forSkill(PILOT_ORGANIZATION, automation.procedure)[0];
      let goalTaskRef: { goalId: string; taskId: string } | undefined;
      if (manifest) {
        const goalType = manifest.goalTypes[0];
        const taskType = manifest.taskTypes[0];
        if (!goalType || !taskType) {
          throw new Error(`Governed Automation ${automation.id} has an incomplete Skill manifest`);
        }
        const seam = { nextId: () => uuidv7(), nowISO: () => new Date().toISOString() };
        const goal =
          (await goalTasks.listGoals(PILOT_ORGANIZATION)).find((row) => row.type === goalType) ??
          (await goalTasks.createGoal(
            {
              organizationId: PILOT_ORGANIZATION,
              type: goalType,
              title: `${automation.name} outcome`,
            },
            seam,
          ));
        const task =
          (await goalTasks.listTasksByGoal(PILOT_ORGANIZATION, goal.id)).find(
            (row) =>
              row.type === taskType &&
              row.assignedAgentId === agentId &&
              row.status !== "cancelled",
          ) ??
          (await goalTasks.createTask(
            {
              organizationId: PILOT_ORGANIZATION,
              goalId: goal.id,
              type: taskType,
              assignedAgentId: agentId,
            },
            seam,
          ));
        goalTaskRef = { goalId: goal.id, taskId: task.id };
      }
      await automationRegistry.save({
        id: automationId,
        name: automation.name,
        organizationId: PILOT_ORGANIZATION,
        agentId,
        agentPlane: agent.plane,
        // ADR-179: a Module's declared `schedule` now reaches the registry.
        // Install used to read `automation.procedure` and drop everything else,
        // so `trigger: "Scheduled"` in a manifest meant nothing at all.
        ...(automation.schedule ? { trigger: automation.schedule } : {}),
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

  // TASK-032 — flight-gated scheduled observation digest. Registered ONLY
  // while the learning observation flight is on: the Skill goes into the
  // registry, its Goal/Task pair is ensured, and the Automation lands in the
  // canonical registry with the Learning Agent as its sole actor. With the
  // flight off none of this exists — no Skill, no Automation row, nothing to
  // click or trigger. Idempotent: goal/task lookups reuse existing rows;
  // `automationRegistry.save` overwrites the same id with identical content.
  if (learningObservationEnabled) {
    skillRegistry.register(
      createObservationDigestSkill({
        memoryStore,
        pilotUserId,
        enabled: () => learningObservationEnabled,
      }),
    );
    const digestSeam = { nextId: () => uuidv7(), nowISO: () => new Date().toISOString() };
    const digestGoal =
      (await goalTasks.listGoals(PILOT_ORGANIZATION)).find((row) => row.type === LEARNING_OBSERVATION_GOAL_TYPE) ??
      (await goalTasks.createGoal(
        {
          organizationId: PILOT_ORGANIZATION,
          type: LEARNING_OBSERVATION_GOAL_TYPE,
          title: "Learning observation digest outcome",
        },
        digestSeam,
      ));
    const digestTask =
      (await goalTasks.listTasksByGoal(PILOT_ORGANIZATION, digestGoal.id)).find(
        (row) =>
          row.type === OBSERVATION_DIGEST_TASK_TYPE &&
          row.assignedAgentId === LEARNING_AGENT &&
          row.status !== "cancelled",
      ) ??
      (await goalTasks.createTask(
        {
          organizationId: PILOT_ORGANIZATION,
          goalId: digestGoal.id,
          type: OBSERVATION_DIGEST_TASK_TYPE,
          assignedAgentId: LEARNING_AGENT,
        },
        digestSeam,
      ));
    await automationRegistry.save({
      id: LEARNING_DIGEST_AUTOMATION_ID,
      name: "Learning observation digest",
      organizationId: PILOT_ORGANIZATION,
      agentId: LEARNING_AGENT,
      agentPlane: "local",
      // ADR-179: the digest's 15-minute cadence used to live in a hardcoded
      // `setInterval` in server.ts that named this automation id directly. It
      // now lives on the Automation, where it is data the scheduler reads —
      // so a second scheduled Automation needs no new timer.
      trigger: { kind: "schedule", everyMinutes: 15 },
      steps: [
        {
          skill: OBSERVATION_DIGEST_SKILL_ID,
          action: "write",
          resourceType: "signal",
          dataScope: "all",
          goalTaskRef: { goalId: digestGoal.id, taskId: digestTask.id },
        },
      ],
    });
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
    taintAudit,
  });

  // Google integration surface.
  const intake = new IntakeService({
    pipeline,
    bodies: localPlane.bodies,
    graph: {
      hasExternal: (organizationId, source, sourceRecordId) =>
        localPlane.graph.hasExternal(organizationId, source, sourceRecordId),
      findPeopleByEmail: (organizationId, email) =>
        localPlane.graph.findPeopleByEmail(organizationId, email),
    },
    pendingLedger: ledger,
    goalTasks,
  });
  const materializer = new IntakeMaterializer({ graph: localPlane.graph });
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
    identities: { organizationId: PILOT_ORGANIZATION, egressAgentId: EGRESS_AGENT, intakeAgentId: INTAKE_AGENT, userId: pilotUserId },
    selfEmails,
    goalTasks,
  });
  const googleOAuthStates = new GoogleOAuthStateStore(localPlane.state);

  // EVAL-3 eval history (ADR-168) and the VAR-1 tunable space (ADR-169) are both
  // Drizzle-backed in either mode now — no in-memory fake left on this path.
  const evalStore = modePorts.evalStore;
  const policyParams = modePorts.policyParams;

  // A1-R1/F2 — the join that lets the Agent Quality Vector score a capability from
  // REAL governed episodes instead of hand-written fixtures. Reads the append-only
  // ledger (attribution key: `LedgerEntry.skill`, migration 0037) and takes the
  // safety axis's violation evidence from capability_states. Both modes bind the
  // same adapter over whichever ledger the mode resolved, so a score computed in
  // development is computed the same way as one in production.
  //
  // Note the deliberate seam in `evidenceFor`: AQV is keyed by the SKILL id (what
  // the ledger records), while `capability_states` is keyed by the manifest's UUID
  // primary key. They are not the same string, so the manifest is resolved by name
  // — and a miss returns undefined (no evidence) rather than throwing, because a
  // capability can legitimately have run without ever being registered as a
  // Commons manifest.
  const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const aqvSource = new LedgerAqvSource(modeLedger, PILOT_ORGANIZATION, {
    async evidenceFor(capabilityId: string) {
      let manifestId: string | undefined;
      if (UUID_RE.test(capabilityId)) {
        manifestId = capabilityId;
      } else {
        const { items } = await capabilityStore.listManifests(PILOT_ORGANIZATION, {
          limit: 500,
          offset: 0,
        });
        const matches = items
          .filter((row) => row.name === capabilityId)
          .sort((a, b) => a.version.localeCompare(b.version));
        manifestId = matches.at(-1)?.id;
      }
      if (!manifestId) return undefined;
      const state = await capabilityStore.getState(manifestId);
      const violationCount = state?.evidence?.violationCount;
      return typeof violationCount === "number" ? { violationCount } : undefined;
    },
  });

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
    automationExecutor: new InProcessAutomationExecutor(pipeline, {
      registry: automationRegistry,
      recorder: automationRunRecorder,
    }),
    roles,
    agents,
    ephemeral,
    policies: effectivePolicyStore,
    ledger,
    taintAudit,
    relationMaterializations,
    events,
    persistent: Boolean(url || localDir),
    publicCloudOnly,
    moduleFilesBridgeRoot,
    localPlane,
    google,
    googleOAuth,
    googleOAuthStates,
    googleGatewayKind,
    googleManifest: GOOGLE_MANIFEST,
    pilotUserId,
    pilotUserEmail,
    learningObservationEnabled,
    vectorIndex,
    retrievalFusionEnabled,
    commonsArchetypesEnabled,
    ...(semanticEmbedder ? { semanticEmbedder } : {}),
    skillRegistry,
    dealpilot: {
      integrationId: dealPilotIntegrationId,
      store: dealPilotRuntimeStore,
      credentials: dealPilotCredentials,
      credentialVault: dealPilotCredentialVault,
      credentialAudit: dealPilotCredentialAudit,
      bindings: dealPilotBindings,
      async validateSourceDiscovery(organizationId, sourceId) {
        await validateDealPilotSourceDiscovery(organizationId, sourceId);
      },
    },
    integrationStore,
    automationRegistry,
    automationRunRecorder,
    organizationStore,
    graphStore,
    jobpilotStore,
    helpdeskStore,
    resourcesStore,
    capabilityStore,
    organizationDefinitionStore,
    moduleStore,
    capabilityBudgets,
    capabilityKillSwitch,
    credentialBroker,
    commonsRegistry,
    onboardingProfileStore,
    goalTasks,
    taskManager,
    skillManifests,
    childAgentRuns,
    researchRuns,
    chatStore,
    managedModel,
    cultureFetchStore,
    cultureSynthesisPointerStore,
    cultureLatestRunPointerStore,
    cultureFetchAbortControllers,
    memoryStore,
    evalStore,
    aqvSource,
    policyParams,
    models,
    searchProviders,
    webResearchContentGuard,
    geocodingProvider,
    ...(memory ? { memory } : {}),
    close: closeResources,
  };
  } catch (error) {
    try {
      await closeResources();
    } catch (cleanupError) {
      throw new AggregateError(
        [error, cleanupError],
        "Wiring initialization failed and one or more acquired resources could not be closed",
      );
    }
    throw error;
  }
}
