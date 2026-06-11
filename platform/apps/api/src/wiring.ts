/**
 * Composition root — assembles the Universal Action Pipeline from ports.
 *
 * Default build uses the in-memory adapters from @bridge/core, so the API runs
 * with no database. When `DATABASE_URL` is set, the ledger is swapped for the
 * Drizzle-backed `DrizzleLedgerStore` (@bridge/db) — the same append-only `ledger`
 * the prototype writes to. The remaining governance reads (roles, agents,
 * ephemeral grants, policies) keep their in-memory adapters in this slice; they
 * bind to Drizzle in the next pass.
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
import { createDb, createDrizzlePorts } from "@bridge/db";

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

export function buildWiring(): Wiring {
  const events = new InMemoryEventBus();
  const skills = new InMemorySkillRegistry().register(stageMutation);
  const variance = new RecordingVarianceAdjuster();

  const url = process.env.DATABASE_URL;

  let roles: RoleQuery;
  let agents: AgentQuery;
  let ephemeral: EphemeralQuery;
  let policyStore: PolicyStore;
  let ledger: LedgerStore;
  let ritualRegistry: RitualRegistry;
  let toolRegistry: ToolRegistry;
  let ritualRunRecorder: RitualRunRecorder;
  let close: () => Promise<void> = async () => {};
  let memory: Wiring["memory"];

  if (url) {
    // Persistent: the whole pipeline + ritual runtime run on Postgres. Policies and
    // rituals come from their tables (the in-code policyFns apply only to in-memory).
    const { db, close: closeDb } = createDb({ url });
    const ports = createDrizzlePorts(db);
    roles = ports.roles;
    agents = ports.agents;
    ephemeral = ports.ephemeral;
    policyStore = ports.policies;
    ledger = ports.ledger;
    ritualRegistry = ports.ritualRegistry;
    toolRegistry = ports.toolRegistry;
    ritualRunRecorder = ports.ritualRunRecorder;
    close = closeDb;
  } else {
    // Zero-infra dev build with in-memory adapters + the in-code policy set.
    const mRoles = new InMemoryRoleStore();
    const mAgents = new InMemoryAgentStore();
    const mEphemeral = new InMemoryEphemeralStore();

    // Dev seed mirroring the live pilot governance, so the prototype's Signal→propose loop works
    // against the zero-infra API exactly as it would against Postgres. The Outreach Agent assumes a
    // role granted touchpoint:write + person/initiative read, and its capability ceiling matches —
    // so a drafted Touchpoint passes authority and lands as pending_review (agents draft, humans approve).
    const OUTREACH_AGENT = "b0000000-0000-4000-a000-0000000000d1";
    mAgents.assumed.set(OUTREACH_AGENT, "role-outreach");
    mAgents.scope.set(OUTREACH_AGENT, ["touchpoint:write", "person:read", "initiative:read", "file:read"]);
    mRoles.roleGrants.set("role-outreach", [
      { resourceType: "touchpoint", resourceId: null, action: "write", effect: "allow" },
      { resourceType: "person", resourceId: null, action: "read", effect: "allow" },
    ]);
    // The principal (signed-in user) the agent acts on behalf of: on-behalf-of authority is also
    // intersected with the principal's own grants, so the user must hold these too.
    const DEMO_USER = "e0f0053b-fc44-476e-be27-1371e179e958";
    mRoles.direct.set(`user:${DEMO_USER}`, [
      { resourceType: "touchpoint", resourceId: null, action: "write", effect: "allow" },
      { resourceType: "person", resourceId: null, action: "read", effect: "allow" },
    ]);

    roles = mRoles;
    agents = mAgents;
    ephemeral = mEphemeral;
    policyStore = new InMemoryPolicyStore(policies);
    ledger = new InMemoryLedger();
    ritualRegistry = new InMemoryRitualRegistry().register({
      id: "reconnect-advisor",
      name: "Reconnect Advisor",
      workspaceId: "ws-1",
      // The per-step access dropdown: this step may only touch PUBLIC (canonical) data.
      steps: [
        {
          skill: "stageMutation",
          action: "write",
          resourceType: "person",
          inputs: { note: "reconnect draft" },
          dataScope: "public",
        },
      ],
    });
    toolRegistry = new InMemoryToolRegistry().register({
      id: "community-pulse",
      name: "Community Pulse",
      workspaceId: "ws-1",
      steps: [
        { skill: "stageMutation", action: "read", resourceType: "community", dataScope: "public" },
      ],
    });
    ritualRunRecorder = new InMemoryRitualRunRecorder();
    memory = { roles: mRoles, agents: mAgents, ephemeral: mEphemeral };
  }

  const pipeline = new UniversalActionPipeline({
    authority: { roles, agents, ephemeral, nowISO: "" },
    policies: policyStore,
    skills,
    ledger,
    events,
    variance,
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
    ...(memory ? { memory } : {}),
    close,
  };
}
