/**
 * Composition root — assembles the Universal Action Pipeline + the Google
 * integration from ports.
 *
 * Governance + ledger: in-memory adapters by default (zero infra); Drizzle/Supabase
 * when DATABASE_URL is set. The ledger MUST stay local for private proposals — in
 * this slice the integration runs against the in-memory (local) ledger, so Gmail/
 * Calendar bodies + derived entities never reach cloud canonical.
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
  InMemorySkillRegistry,
  InProcessRitualExecutor,
  RecordingVarianceAdjuster,
  UniversalActionPipeline,
  type AgentQuery,
  type EphemeralQuery,
  type LedgerStore,
  type PolicyFn,
  type PolicyStore,
  type RitualRegistry,
  type RitualRunRecorder,
  type RoleQuery,
  type Skill,
  type ToolRegistry,
} from "@bridge/core";
import { createDb, createDrizzlePorts, InMemoryCanonicalIdentityStore, type CanonicalIdentityStore } from "@bridge/db";
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

// Pilot identities (uuids) — structural constants the system needs to run (the
// workspace + its service agents + the signed-in pilot user). Not demo/dummy data.
const PILOT_WORKSPACE = "b0000000-0000-4000-a000-000000000001";
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

export async function buildWiring(): Promise<Wiring> {
  const events = new InMemoryEventBus();
  const skillRegistry = new InMemorySkillRegistry().register(stageMutation);
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

  let roles: RoleQuery;
  let agents: AgentQuery;
  let ephemeral: EphemeralQuery;
  let policyStore: PolicyStore;
  let ledger: LedgerStore;
  let ritualRegistry: RitualRegistry;
  let toolRegistry: ToolRegistry;
  let ritualRunRecorder: RitualRunRecorder;
  let canonical: CanonicalIdentityStore;
  let closeDb: () => Promise<void> = async () => {};
  let memory: Wiring["memory"];

  if (url) {
    const { db, close } = createDb({ url });
    const ports = createDrizzlePorts(db);
    roles = ports.roles;
    agents = ports.agents;
    ephemeral = ports.ephemeral;
    policyStore = ports.policies;
    ledger = ports.ledger;
    ritualRegistry = ports.ritualRegistry;
    toolRegistry = ports.toolRegistry;
    ritualRunRecorder = ports.ritualRunRecorder;
    // Canonical dual-write stays an in-memory fake unless explicitly bound (avoids
    // writing identity to Supabase without intent); the seam is identical.
    canonical = new InMemoryCanonicalIdentityStore();
    closeDb = close;
  } else {
    const mRoles = new InMemoryRoleStore();
    const mAgents = new InMemoryAgentStore();
    const mEphemeral = new InMemoryEphemeralStore();
    seedGovernance(mRoles, mAgents);

    roles = mRoles;
    agents = mAgents;
    ephemeral = mEphemeral;
    policyStore = new InMemoryPolicyStore(policies);
    ledger = new InMemoryLedger();
    // Registries start EMPTY — no demo rituals/tools. Real workflows are created via
    // ritual.create (validated ritual ⊆ agent) and persist here for the session.
    ritualRegistry = new InMemoryRitualRegistry();
    toolRegistry = new InMemoryToolRegistry();
    ritualRunRecorder = new InMemoryRitualRunRecorder();
    canonical = new InMemoryCanonicalIdentityStore();
    memory = { roles: mRoles, agents: mAgents, ephemeral: mEphemeral };
  }

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
    ritualRegistry,
    ...(memory ? { memory } : {}),
    close: async () => {
      await localPlane.close();
      await closeDb();
    },
  };
}
