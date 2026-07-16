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
  type ToolRegistry,
  type CapabilityStore,
  type AutoActivationBudgetStore,
  type KillSwitchPort,
  type CredentialBroker,
  type WorkspaceDefinitionStore,
  type PackageStore,
  type OnboardingProfileStore,
  type EvalStore,
  type PolicyParamStore,
} from "@bridge/core";
import { HttpCommonsClient, commonsUrlFromEnv } from "./commons-client.js";
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
  ensureLearningAgentGovernance,
  InMemoryCanonicalIdentityStore,
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
  type DealPilotStore,
} from "@bridge/dealpilot";
import { matchCompany } from "@bridge/company-sourcing";
import type { DedupeCandidate } from "@bridge/dedupe";
import { BUILT_IN_PACKAGES } from "./built-in-packages.js";

// Pilot identities (uuids) — structural constants the system needs to run (the
// workspace + its service agents + the signed-in pilot user). Not demo/dummy data.
// Exported: router.ts's `assertPilotWorkspace` uses it to explicitly REJECT any
// other workspaceId (interim single-tenant safety fix, All fixes.md Phase 3 item 11a
// — full multi-tenancy is out of scope for this pass).
export const PILOT_WORKSPACE = "b0000000-0000-4000-a000-000000000001";
const OUTREACH_AGENT = "b0000000-0000-4000-a000-0000000000d1";
export const LEARNING_AGENT = "b0000000-0000-4000-a000-0000000000d2";
export const LEARNING_ROLE = "b0000000-0000-4000-a000-0000000000f2";
const LEARNING_SIGNAL_PERMISSION = "b0000000-0000-4000-a000-0000000000c2";
const EGRESS_AGENT = "b0000000-0000-4000-a000-0000000000e1";
const INTAKE_AGENT = "b0000000-0000-4000-a000-0000000000e2";
// Exported: apps/api/test/blueprint.test.ts (ADR-023/ADR-024) needs a real
// seeded user id — workspace_definitions.created_by is a real FK to `users`,
// so an arbitrary placeholder caller id would violate that constraint.
export const PILOT_USER = "e0f0053b-fc44-476e-be27-1371e179e958";

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
  events: InMemoryEventBus;
  /** LOCAL-plane media store (bytea blobs). Pglite when LOCAL_MEDIA_DIR set, else in-memory. Never cloud. */
  localMedia: LocalMediaStore;
  /** True when bound to Postgres (DATABASE_URL set). */
  persistent: boolean;
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
const stageMutation: Skill = {
  name: "stageMutation",
  async run(inputs) {
    return { proposedOutput: inputs, diff: { to: inputs } };
  },
};

const stageLearningRecommendation: Skill = {
  name: "stageLearningRecommendation",
  async run(inputs) {
    return { proposedOutput: inputs, diff: { to: inputs } };
  },
};

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
  // Outreach Agent (existing pilot) — touchpoint:write + reads.
  agents.assumed.set(OUTREACH_AGENT, "role-outreach");
  agents.scope.set(OUTREACH_AGENT, ["touchpoint:write", "person:read", "initiative:read", "file:read"]);
  roles.roleGrants.set("role-outreach", [
    { resourceType: "touchpoint", resourceId: null, action: "write", effect: "allow" },
    { resourceType: "person", resourceId: null, action: "read", effect: "allow" },
  ]);

  agents.assumed.set(LEARNING_AGENT, "role-learning");
  agents.scope.set(LEARNING_AGENT, ["signal:write"]);
  roles.roleGrants.set("role-learning", [
    { resourceType: "signal", resourceId: null, action: "write", effect: "allow" },
  ]);

  // Egress agent (cloud) — SOURCES the internet (external:fetch read).
  agents.assumed.set(EGRESS_AGENT, "role-egress");
  agents.scope.set(EGRESS_AGENT, ["external:fetch:read"]);
  agents.tiers.set(EGRESS_AGENT, "public");
  roles.roleGrants.set("role-egress", [
    { resourceType: "external:fetch", resourceId: null, action: "read", effect: "allow" },
  ]);

  // Intake agent (local) — DRAFTS graph proposals.
  agents.assumed.set(INTAKE_AGENT, "role-intake");
  agents.scope.set(INTAKE_AGENT, ["touchpoint:write", "signal:write", "person:write"]);
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
  /** ModelProviders this mode registers (echo double in-memory; Ollama/Anthropic persistent). */
  modelProviders: ModelProvider[];
  memory?: Wiring["memory"];
  closeDb: () => Promise<void>;
  /** SEC-5 — persistent mode only. Asserts the connected Postgres role cannot
   *  bypass RLS (superuser / BYPASSRLS) in production; self-gates to a no-op
   *  outside prod. `buildWiring()` awaits this before the server serves traffic. */
  verifyRlsPosture?: () => Promise<void>;
  /** Persistent-mode boot provisioning + verification for the attributable Learning Agent grant. */
  ensureLearningGovernance?: () => Promise<void>;
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
  const ports = createDrizzlePorts(db);

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
    ensureLearningGovernance: () =>
      ensureLearningAgentGovernance(db, {
        workspaceId: PILOT_WORKSPACE,
        userId: PILOT_USER,
        agentId: LEARNING_AGENT,
        roleId: LEARNING_ROLE,
        permissionId: LEARNING_SIGNAL_PERMISSION,
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

  return {
    roles: mRoles,
    agents: mAgents,
    ephemeral: mEphemeral,
    policyStore: new InMemoryPolicyStore(policies),
    ledger: new InMemoryLedger(),
    // Registries start EMPTY — no demo rituals/tools. Real workflows are created via
    // ritual.create (validated ritual ⊆ agent) and persist here for the session.
    ritualRegistry: new InMemoryRitualRegistry(),
    toolRegistry: new InMemoryToolRegistry(),
    ritualRunRecorder: new InMemoryRitualRunRecorder(),
    canonical: new InMemoryCanonicalIdentityStore(),
    dealPilotCaptures: createInMemoryCaptureStore(),
    workspaceStore: new DrizzleWorkspaceStore(localDb),
    graphStore: new DrizzleGraphStore(localDb),
    jobpilotStore: new DrizzleJobPilotStore(localDb),
    helpdeskStore: new DrizzleHelpdeskStore(localDb),
    resourcesStore: new DrizzleResourcesStore(localDb),
    capabilityStore: new DrizzleCapabilityStore(localDb),
    workspaceDefinitionStore: new DrizzleWorkspaceDefinitionStore(localDb),
    // In-memory mode keeps packages in-memory (no persistent backing store needed
    // for zero-infra dev/test) — persistent mode uses the real DrizzlePackageStore.
    packageStore: new InMemoryPackageStore(),
    memoryStore: new DrizzleMemoryStore(localDb),
    // Echo double (local plane) — zero-infra mode makes no network calls, model
    // calls included; anything needing a real model runs in persistent mode.
    modelProviders: [new EchoModelProvider()],
    memory: { roles: mRoles, agents: mAgents, ephemeral: mEphemeral },
    closeDb: closeLocalDb,
  };
}

export async function buildWiring(): Promise<Wiring> {
  const events = new InMemoryEventBus();
  const skillRegistry = new InMemorySkillRegistry()
    .register(stageMutation)
    .register(stageCapture)
    .register(stageLearningRecommendation);
  const variance = new RecordingVarianceAdjuster();

  const url = process.env.DATABASE_URL;

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
  await modePorts.ensureLearningGovernance?.();
  const {
    roles,
    agents,
    ephemeral,
    policyStore,
    ledger,
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
  const dealPilotDiscoveryLocks = new Map<string, Promise<unknown>>();
  skillRegistry.register({
    name: "dealpilot.source",
    async run(inputs, ctx) {
      const request = inputs as { workspaceId?: unknown; sourceId?: unknown };
      if (typeof request.workspaceId !== "string" || typeof request.sourceId !== "string") {
        throw new Error("DealPilot Source discovery requires workspaceId and sourceId");
      }
      const lockKey = `${request.workspaceId}:${request.sourceId}`;
      const previous = dealPilotDiscoveryLocks.get(lockKey) ?? Promise.resolve();
      const operation = previous.catch(() => undefined).then(async () => {
        const source = await dealPilotStore.get("source", request.workspaceId as string, request.sourceId as string);
        if (!source || source.kind !== "source") throw new Error("DealPilot Source Record not found");
        const baseQuery = { kind: "company" as const, hints: { sourceId: source.id } };
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
          hints: { sourceId: source.id, maxResults: String(maxResults) },
        };
        let envelopes;
        try {
          envelopes = await dealPilotSourceConnector.fetch(query);
        } catch (error) {
          await dealPilotStore.updateSource(source.id, source.workspaceId, { health: "degraded" });
          throw error;
        }

        let actualSpend = 0;
        let droppedForBudget = 0;
        const captureIds: string[] = [];
        const sample: Record<string, unknown>[] = [];
        for (const envelope of envelopes) {
          if (actualSpend + envelope.costUnits > remaining) {
            droppedForBudget += 1;
            continue;
          }
          actualSpend += envelope.costUnits;
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
        if (actualSpend === 0) actualSpend = estimate;
        await dealPilotStore.updateSource(source.id, source.workspaceId, {
          lastCheckedAt: ctx.clock.nowISO(),
          spendToDate: source.spendToDate + actualSpend,
          ...(droppedForBudget > 0 ? { health: "paused" } : {}),
        });
        return {
          proposedOutput: {
            toolId: "dealpilot",
            count: captureIds.length,
            captureIds,
            sample,
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
      });
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
  const dealPilotMaterializer = new ToolIntakeMaterializer({
    captures: dealPilotCaptures,
    commit: async (capture) => {
      // Dedupe-on-commit: reuse `@bridge/company-sourcing`'s matchCompany (same helper
      // `processDealCandidate` uses) so two captures of the same company merge into one
      // candidate instead of piling up duplicate rows. A "strong" match merges facts into
      // the existing candidate; anything weaker commits as its own new candidate.
      const existingDeals = await dealPilotStore.list("deals", PILOT_WORKSPACE, { limit: 200, offset: 0 });
      const existingDealPilotCandidates: DedupeCandidate[] = existingDeals.items
        .filter((record) => record.kind === "deal")
        .map((record) => ({ id: record.id, name: record.company }));
      const candidateForMatch: DedupeCandidate = {
        id: capture.captureId,
        name: String(capture.payload.name ?? capture.captureId),
        domain: capture.payload.domain as string | undefined,
        industry: capture.payload.industry as string | undefined,
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
  });

  // Google integration surface.
  const intake = new IntakeService({ pipeline, bodies: localPlane.bodies, graph: localPlane.graph });
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
  });

  // EVAL-3 + VAR-1 substrate — in-memory both modes (no Drizzle binding yet).
  const evalStore = new InMemoryEvalStore();
  const policyParams = new InMemoryPolicyParamStore();

  // Universal Commons client — binds CommonsRegistry port to the local Commons
  // service (COMMONS_URL env, default http://localhost:4780). loopback HTTP is
  // permitted by assertCommonsUrlTls; a remote plaintext URL is rejected.
  // verifySignatures is ON by default (PKG-2 verify-on-install). The service may
  // not be running in dev; tRPC procedures handle fetch errors gracefully.
  const commonsRegistry: CommonsRegistry = new HttpCommonsClient(commonsUrlFromEnv());

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
    events,
    persistent: Boolean(url),
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
