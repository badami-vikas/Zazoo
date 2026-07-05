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
} from "@bridge/core";
import {
  createDb,
  createDrizzlePorts,
  createLocalDb,
  createLocalMediaStore,
  DrizzleCanonicalIdentityStore,
  DrizzleWorkspaceStore,
  InMemoryCanonicalIdentityStore,
  type CanonicalIdentityStore,
} from "@bridge/db";
import { createMemoryLocalPlane, createPgliteLocalPlane, type LocalPlane } from "@bridge/local";
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
import { createInMemoryCaptureStore, createToolSourceSkill, ToolIntakeMaterializer, type ToolCaptureStore } from "@bridge/tool-kit";
import { createFactStore, type FactStore } from "@bridge/facts";
import { createBizBuySellAlertConnector, createGmailFetchMessages, type ThesisProfile } from "@bridge/dealpilot";
import { matchCompany } from "@bridge/company-sourcing";
import type { DedupeCandidate } from "@bridge/dedupe";

// Pilot identities (uuids) — structural constants the system needs to run (the
// workspace + its service agents + the signed-in pilot user). Not demo/dummy data.
// Exported: router.ts's `assertPilotWorkspace` uses it to explicitly REJECT any
// other workspaceId (interim single-tenant safety fix, All fixes.md Phase 3 item 11a
// — full multi-tenancy is out of scope for this pass).
export const PILOT_WORKSPACE = "b0000000-0000-4000-a000-000000000001";
const OUTREACH_AGENT = "b0000000-0000-4000-a000-0000000000d1";
const EGRESS_AGENT = "b0000000-0000-4000-a000-0000000000e1";
const INTAKE_AGENT = "b0000000-0000-4000-a000-0000000000e2";
const PILOT_USER = "e0f0053b-fc44-476e-be27-1371e179e958";

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
  /** DealPilot's quarantine/commit surface (first tool on the generic intake seam). */
  dealpilot: {
    captures: ToolCaptureStore;
    facts: FactStore;
    materializer: ToolIntakeMaterializer;
    integrationId: string;
    candidateIds: string[];
    /** Current pilot thesis (in-memory, session-lifetime — no thesis-management UI yet). */
    thesis: ThesisProfile;
    setThesis(next: ThesisProfile): void;
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

const policies: PolicyFn[] = [
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
  memory?: Wiring["memory"];
  closeDb: () => Promise<void>;
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
    closeDb: close,
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
    memory: { roles: mRoles, agents: mAgents, ephemeral: mEphemeral },
    closeDb: closeLocalDb,
  };
}

export async function buildWiring(): Promise<Wiring> {
  const events = new InMemoryEventBus();
  const skillRegistry = new InMemorySkillRegistry().register(stageMutation).register(stageCapture);
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
    memory,
    closeDb,
  } = modePorts;

  // DealPilot: the first tool wired through the generic manifest intake seam
  // (@bridge/tool-kit createToolSourceSkill/ToolIntakeMaterializer) — sourcing quarantines
  // through the pipeline as `external:fetch`; commit is a separate human "Add" (capture ≠
  // commit, same pattern as Camera). BusinessBroker.net has no live connector yet (its
  // robots.txt blocks the paths a fetcher needs — see docs/wiki/known-issues.md), so only
  // BizBuySell is registered.
  const dealPilotFacts: FactStore = createFactStore();
  const dealPilotIntegrationId = `${PILOT_WORKSPACE}:google`;
  skillRegistry.register(
    createToolSourceSkill({
      toolId: "dealpilot",
      captures: dealPilotCaptures,
      connector: createBizBuySellAlertConnector(createGmailFetchMessages(gateways, dealPilotIntegrationId)),
    }),
  );
  const dealPilotCandidateIds: string[] = [];
  // Basic thesis storage (in-memory, session-lifetime — mirrors dealPilotCandidateIds).
  // Full thesis-management UI is a separate, larger future item; this is just get/set state
  // so `dealpilot.list`'s fit-scoring has something other than a hardcoded stand-in.
  let dealPilotThesis: ThesisProfile = { industries: [], geo: [] };
  const dealPilotMaterializer = new ToolIntakeMaterializer({
    captures: dealPilotCaptures,
    commit: async (capture) => {
      // Dedupe-on-commit: reuse `@bridge/company-sourcing`'s matchCompany (same helper
      // `processDealCandidate` uses) so two captures of the same company merge into one
      // candidate instead of piling up duplicate rows. A "strong" match merges facts into
      // the existing candidate; anything weaker commits as its own new candidate.
      const existingDeals: DedupeCandidate[] = dealPilotCandidateIds.map((id) => {
        const profile = dealPilotFacts.livingProfile(id);
        return {
          id,
          name: String(profile.name?.value ?? id),
          domain: profile.domain?.value as string | undefined,
          industry: profile.industry?.value as string | undefined,
        };
      });
      const candidateForMatch: DedupeCandidate = {
        id: capture.captureId,
        name: String(capture.payload.name ?? capture.captureId),
        domain: capture.payload.domain as string | undefined,
        industry: capture.payload.industry as string | undefined,
      };
      const match = matchCompany(candidateForMatch, existingDeals);
      const candidateId = match.tier === "strong" ? match.targetId : capture.captureId;

      for (const [field, value] of Object.entries(capture.payload)) {
        dealPilotFacts.append({ entityId: candidateId, field, value, provenance: "listing", confidence: capture.confidence });
      }
      if (candidateId === capture.captureId) dealPilotCandidateIds.push(candidateId);
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
    userEmail: process.env.BRIDGE_PILOT_USER_EMAIL ?? "dummy_pilot@bridge.local",
  });

  // LOCAL-plane media store (the priority track). bytea blobs live here, never cloud.
  // LOCAL_MEDIA_DIR set => persistent pglite on disk; unset => in-memory (zero-infra).
  const localMediaDir = process.env.LOCAL_MEDIA_DIR;
  const localMedia: LocalMediaStore = localMediaDir
    ? await createLocalMediaStore(localMediaDir)
    : new InMemoryMediaStore();

  const pipeline = new UniversalActionPipeline({
    authority: { roles, agents, ephemeral, nowISO: "" },
    policies: policyStore,
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
    policies: policyStore,
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
      candidateIds: dealPilotCandidateIds,
      get thesis() {
        return dealPilotThesis;
      },
      setThesis(next: ThesisProfile) {
        dealPilotThesis = next;
      },
    },
    ritualRegistry,
    workspaceStore,
    ...(memory ? { memory } : {}),
    close: async () => {
      await localPlane.close();
      await closeDb();
    },
  };
}
