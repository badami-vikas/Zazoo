/**
 * Drizzle bindings for the pipeline's governance read ports. With these + the
 * DrizzleLedgerStore, the Universal Action Pipeline runs entirely on Postgres —
 * the same authority math the in-memory adapters cover, now sourced from the
 * governance tables in SCHEMA.sql.
 *
 * RLS still enforces tenancy + visibility at the DB; these resolvers are the
 * in-tenant capability layer. They compose — neither replaces the other.
 */
import { and, eq, gt, isNull, or, sql } from "drizzle-orm";
import { createHash } from "node:crypto";
import { z } from "zod";
import type {
  AgentQuery,
  EphemeralQuery,
  PolicyEvalInput,
  PolicyStore,
  RoleQuery,
} from "@bridge/core";
import type { Actor, DataScope, GrantRule, PolicyResult } from "@bridge/core";
import type { Database } from "./client.js";
import {
  withDefaultOrganization,
  withOrganizationContext,
  withOrganizationOnly,
} from "./organization-context.js";
import {
  agents,
  ephemeralGrants,
  permissions,
  policies,
  rolePermissions,
  roles,
  organizationMembers,
} from "./schema.js";

type Effect = "allow" | "deny";

function stableGovernanceId(value: string): string {
  const hex = createHash("sha256").update(value).digest("hex").slice(0, 32).split("");
  hex[12] = "4";
  hex[16] = "8";
  const compact = hex.join("");
  return `${compact.slice(0, 8)}-${compact.slice(8, 12)}-${compact.slice(12, 16)}-${compact.slice(16, 20)}-${compact.slice(20)}`;
}

/**
 * `agents.capability_scope` jsonb shape: `{ resources: string[], dataScope?
 * DataScope }`. `tokens` is accepted as a legacy alias for `resources` on READ
 * (back-compat with rows written before the `resources` rename), but new
 * writes always normalize to `resources` — see `parseAgentCapabilityScope`.
 *
 * Before adding this, searched for an existing zod schema for this shape
 * (`grep -rn "z.object" packages/core`, `grep -rn "capabilityScope"`) — none
 * exists; `@bridge/core` is a types-only module (no zod dependency; ports.ts
 * only declares the TS interface), so this schema is colocated here in
 * `@bridge/db`, the only place that validates the jsonb wire shape at
 * read/write boundaries. `AutomationStepDef`'s equivalent schema lives in
 * `automation-stores.ts` for the same reason — the shapes are unrelated so
 * there is nothing to share between the two files.
 */
const dataScopeSchema = z.enum(["all", "public", "private"]);

export const agentCapabilityScopeSchema = z
  .object({
    resources: z.array(z.string().min(1)).optional(),
    tokens: z.array(z.string().min(1)).optional(),
    dataScope: dataScopeSchema.optional(),
  })
  .strict();
export type AgentCapabilityScope = z.infer<typeof agentCapabilityScopeSchema>;

/**
 * Validate `agents.capability_scope` jsonb. Throws loudly on a malformed shape
 * — at write time this stops bad data from ever reaching the row; at read
 * time (a pre-existing bad row, another process, a raw insert) it surfaces
 * the corruption instead of the previous behavior (silently falling back to
 * an empty scope / 'all' data-scope, which is a governance hole: an agent
 * with a corrupted capability_scope would silently run as if unrestricted).
 */
export function parseAgentCapabilityScope(raw: unknown): AgentCapabilityScope {
  const result = agentCapabilityScopeSchema.safeParse(raw ?? {});
  if (!result.success) {
    throw new Error(`Invalid agents.capability_scope jsonb: ${result.error.message}`);
  }
  return result.data;
}

/** `agents.allowed_skills` shape: an array of non-empty skill name strings. */
export const allowedSkillsSchema = z.array(z.string().min(1));

/**
 * Validate `agents.allowed_skills`. Throws loudly on a malformed entry rather
 * than silently filtering non-string entries out of the allow-list (a
 * partially-dropped allow-list silently narrows what an agent may run, which
 * hides the corruption instead of surfacing it).
 */
export function parseAllowedSkills(raw: unknown): string[] {
  const result = allowedSkillsSchema.safeParse(raw ?? []);
  if (!result.success) {
    throw new Error(`Invalid agents.allowed_skills jsonb: ${result.error.message}`);
  }
  return result.data;
}

export interface LearningAgentGovernanceConfig {
  organizationId: string;
  userId: string;
  agentId: string;
  roleId: string;
  permissionId: string;
}

export type OutreachAgentGovernanceConfig = LearningAgentGovernanceConfig;
export type FoundationalAgentGovernanceConfig = LearningAgentGovernanceConfig;
export type InternalStrategistGovernanceConfig = FoundationalAgentGovernanceConfig;
export type RuntimeAgentGovernanceConfig = FoundationalAgentGovernanceConfig;
export interface PrincipalGovernanceConfig {
  organizationId: string;
  userId: string;
}
export type RelationshipUserGovernanceConfig = PrincipalGovernanceConfig;

interface PersistentAgentGovernanceConfig extends LearningAgentGovernanceConfig {
  name: string;
  description: string;
  goal: string;
  resourceType: GrantRule["resourceType"];
  action: GrantRule["action"];
  capabilityToken: string;
  additionalGrants?: readonly {
    resourceType: GrantRule["resourceType"];
    action: GrantRule["action"];
    capabilityToken: string;
  }[];
  allowedSkills?: readonly string[];
  dataScope?: DataScope;
}

async function ensurePersistentAgentGovernance(
  db: Database,
  config: PersistentAgentGovernanceConfig,
): Promise<void> {
  return withOrganizationContext(
    db,
    { organizationId: config.organizationId, userId: config.userId },
    async (db) => {
  const grants = [
    {
      resourceType: config.resourceType,
      action: config.action,
      capabilityToken: config.capabilityToken,
    },
    ...(config.additionalGrants ?? []),
  ];
  const capabilityTokens = grants.map((grant) => grant.capabilityToken);
  const dataScope = config.dataScope ?? "public";
  await db
    .insert(roles)
    .values({
      id: config.roleId,
      organizationId: config.organizationId,
      name: config.name,
      kind: "agent",
      description: config.description,
    })
    .onConflictDoUpdate({
      target: roles.id,
      set: {
        organizationId: config.organizationId,
        name: config.name,
        kind: "agent",
        description: config.description,
      },
    });

  await db
    .insert(agents)
    .values({
      id: config.agentId,
      organizationId: config.organizationId,
      name: config.name,
      ownerUserId: config.userId,
      assumesRoleId: config.roleId,
      goal: config.goal,
      allowedSkills: [...(config.allowedSkills ?? [])],
      capabilityScope: { resources: capabilityTokens, dataScope },
      status: "active",
    })
    .onConflictDoUpdate({
      target: agents.id,
      set: {
        organizationId: config.organizationId,
        name: config.name,
        ownerUserId: config.userId,
        assumesRoleId: config.roleId,
        goal: config.goal,
        allowedSkills: [...(config.allowedSkills ?? [])],
        capabilityScope: { resources: capabilityTokens, dataScope },
        status: "active",
      },
    });

  for (const [index, grant] of grants.entries()) {
    const roleGrant = await db
      .select({ id: rolePermissions.id })
      .from(rolePermissions)
      .where(
        and(
          eq(rolePermissions.roleId, config.roleId),
          eq(rolePermissions.resourceType, grant.resourceType),
          eq(rolePermissions.action, grant.action),
          eq(rolePermissions.effect, "allow"),
          isNull(rolePermissions.resourceId),
        ),
      )
      .limit(1);
    if (!roleGrant[0]) {
      await db
        .insert(rolePermissions)
        .values({
          id: stableGovernanceId(
            `role:${config.roleId}:${grant.resourceType}:${grant.action}`,
          ),
          roleId: config.roleId,
          resourceType: grant.resourceType,
          resourceId: null,
          action: grant.action,
          effect: "allow",
        })
        .onConflictDoNothing();
    }

    const principalGrant = await db
      .select({ id: permissions.id })
      .from(permissions)
      .where(
        and(
          eq(permissions.organizationId, config.organizationId),
          eq(permissions.actorType, "user"),
          eq(permissions.actorId, config.userId),
          eq(permissions.resourceType, grant.resourceType),
          eq(permissions.action, grant.action),
          eq(permissions.effect, "allow"),
          isNull(permissions.resourceId),
          isNull(permissions.revokedAt),
        ),
      )
      .limit(1);
    if (!principalGrant[0]) {
      await db
        .insert(permissions)
        .values({
          id:
            index === 0
              ? config.permissionId
              : stableGovernanceId(
                  `principal:${config.organizationId}:${config.userId}:${grant.resourceType}:${grant.action}`,
                ),
          organizationId: config.organizationId,
          actorType: "user",
          actorId: config.userId,
          resourceType: grant.resourceType,
          resourceId: null,
          action: grant.action,
          effect: "allow",
          grantedBy: config.userId,
        })
        .onConflictDoNothing();
    }
  }

  const agentStore = new DrizzleAgentStore(db);
  const roleStore = new DrizzleRoleStore(db);
  const [assumedRole, scope, roleGrants, principalGrants] = await Promise.all([
    agentStore.assumedRole(config.agentId),
    agentStore.capabilityScope(config.agentId),
    roleStore.grantsForRole(config.roleId),
    roleStore.directGrants(config.organizationId, { type: "user", id: config.userId }),
  ]);
  const hasGrant = (actual: GrantRule, expected: (typeof grants)[number]) =>
    actual.resourceType === expected.resourceType &&
    actual.resourceId === null &&
    actual.action === expected.action &&
    actual.effect === "allow";
  if (
    assumedRole !== config.roleId ||
    !capabilityTokens.every((token) => scope.includes(token)) ||
    !grants.every((expected) => roleGrants.some((actual) => hasGrant(actual, expected))) ||
    !grants.every((expected) => principalGrants.some((actual) => hasGrant(actual, expected)))
  ) {
    throw new Error(`Persistent ${config.name} governance provisioning failed verification`);
  }
    },
  );
}

/** Provision the Human permissions used by DealPilot's governed discovery and
 * quarantine-commit paths without widening any Agent role. */
export async function ensureDealPilotPrincipalGovernance(
  db: Database,
  config: PrincipalGovernanceConfig,
): Promise<void> {
  return withOrganizationContext(
    db,
    { organizationId: config.organizationId, userId: config.userId },
    async (db) => {
  const grants = [
    { resourceType: "module" as const, action: "read" as const },
    { resourceType: "module" as const, action: "write" as const },
  ];
  for (const grant of grants) {
    const existing = await db
      .select({ id: permissions.id })
      .from(permissions)
      .where(
        and(
          eq(permissions.organizationId, config.organizationId),
          eq(permissions.actorType, "user"),
          eq(permissions.actorId, config.userId),
          eq(permissions.resourceType, grant.resourceType),
          eq(permissions.action, grant.action),
          eq(permissions.effect, "allow"),
          isNull(permissions.resourceId),
          isNull(permissions.revokedAt),
        ),
      )
      .limit(1);
    if (!existing[0]) {
      const id = stableGovernanceId(
        `principal:${config.organizationId}:${config.userId}:${grant.resourceType}:${grant.action}`,
      );
      await db
        .insert(permissions)
        .values({
          id,
          organizationId: config.organizationId,
          actorType: "user",
          actorId: config.userId,
          resourceType: grant.resourceType,
          resourceId: null,
          action: grant.action,
          effect: "allow",
          grantedBy: config.userId,
        })
        .onConflictDoUpdate({
          target: permissions.id,
          set: {
            organizationId: config.organizationId,
            actorType: "user",
            actorId: config.userId,
            resourceType: grant.resourceType,
            resourceId: null,
            action: grant.action,
            effect: "allow",
            grantedBy: config.userId,
            revokedAt: null,
          },
        });
    }
  }

  const direct = await new DrizzleRoleStore(db).directGrants(
    config.organizationId,
    { type: "user", id: config.userId },
  );
  if (
    !grants.every((expected) =>
      direct.some(
        (actual) =>
          actual.resourceType === expected.resourceType &&
          actual.resourceId === null &&
          actual.action === expected.action &&
          actual.effect === "allow",
      ),
    )
  ) {
    throw new Error("Persistent DealPilot principal governance provisioning failed verification");
  }
    },
  );
}

/**
 * Provision the Human (pilot) principal's `capability:approve`/
 * `organization_definition:approve` authority in persistent mode — the real-DB
 * counterpart to `apps/api/src/wiring.ts`'s in-memory `seedGovernance()` pilot
 * direct-grant addition (docs/BUGS.md "capability.approve/
 * organization.blueprint.activate mutate even when the governed decision is
 * rejected", 2026-07-22 RESOLVED). `capability.approve` and
 * `organization.blueprint.activate` each propose an `action:"approve"` request
 * through the SAME governed pipeline every other approve uses — before this,
 * `resolveAuthority` denied every such proposal in persistent mode (no matching
 * grant row existed), so only the handlers' own hard-stop guard stood between
 * a denied decision and a silent mutation; that guard now closes the mutation
 * off correctly, but a legitimate human approval also needs somewhere to
 * succeed. Grants ONLY the Human principal — never an Agent role. The
 * agent-floor (`packages/core/src/agent-floor.ts`,
 * `AGENT_FLOOR_PROTECTED_RESOURCES`) already lists both `capability` and
 * `organization_definition` as protected resources with `approve` in
 * `AGENT_FLOOR_MUTATIONS`, so no Agent could ever hold this authority
 * regardless of what this function seeds.
 */
export async function ensureCapabilityApprovalPrincipalGovernance(
  db: Database,
  config: PrincipalGovernanceConfig,
): Promise<void> {
  return withOrganizationContext(
    db,
    { organizationId: config.organizationId, userId: config.userId },
    async (db) => {
  const grants = [
    { resourceType: "capability" as const, action: "approve" as const },
    { resourceType: "organization_definition" as const, action: "approve" as const },
  ];
  for (const grant of grants) {
    const existing = await db
      .select({ id: permissions.id })
      .from(permissions)
      .where(
        and(
          eq(permissions.organizationId, config.organizationId),
          eq(permissions.actorType, "user"),
          eq(permissions.actorId, config.userId),
          eq(permissions.resourceType, grant.resourceType),
          eq(permissions.action, grant.action),
          eq(permissions.effect, "allow"),
          isNull(permissions.resourceId),
          isNull(permissions.revokedAt),
        ),
      )
      .limit(1);
    if (!existing[0]) {
      const id = stableGovernanceId(
        `principal:${config.organizationId}:${config.userId}:${grant.resourceType}:${grant.action}`,
      );
      await db
        .insert(permissions)
        .values({
          id,
          organizationId: config.organizationId,
          actorType: "user",
          actorId: config.userId,
          resourceType: grant.resourceType,
          resourceId: null,
          action: grant.action,
          effect: "allow",
          grantedBy: config.userId,
        })
        .onConflictDoUpdate({
          target: permissions.id,
          set: {
            organizationId: config.organizationId,
            actorType: "user",
            actorId: config.userId,
            resourceType: grant.resourceType,
            resourceId: null,
            action: grant.action,
            effect: "allow",
            grantedBy: config.userId,
            revokedAt: null,
          },
        });
    }
  }

  const direct = await new DrizzleRoleStore(db).directGrants(
    config.organizationId,
    { type: "user", id: config.userId },
  );
  if (
    !grants.every((expected) =>
      direct.some(
        (actual) =>
          actual.resourceType === expected.resourceType &&
          actual.resourceId === null &&
          actual.action === expected.action &&
          actual.effect === "allow",
      ),
    )
  ) {
    throw new Error("Persistent capability-approval principal governance provisioning failed verification");
  }
    },
  );
}

/** Idempotently grants only the Human principal the governed Relationship surface. */
export async function ensureRelationshipUserGovernance(
  db: Database,
  config: RelationshipUserGovernanceConfig,
): Promise<void> {
  const grants = [
    { resourceType: "relation", action: "read" },
    { resourceType: "relation", action: "write" },
    { resourceType: "person", action: "read" },
    { resourceType: "person", action: "write" },
    { resourceType: "person", action: "archive" },
    { resourceType: "community", action: "read" },
    { resourceType: "community", action: "write" },
    { resourceType: "community", action: "archive" },
    { resourceType: "event", action: "read" },
    { resourceType: "event", action: "write" },
    { resourceType: "record", action: "read" },
    { resourceType: "record", action: "write" },
    { resourceType: "record", action: "archive" },
  ] as const;
  await withOrganizationContext(
    db,
    { organizationId: config.organizationId, userId: config.userId },
    async (tx) => {
    for (const grant of grants) {
      await tx
        .insert(permissions)
        .values({
          id: stableGovernanceId(
            `principal:${config.organizationId}:${config.userId}:${grant.resourceType}:${grant.action}`,
          ),
          organizationId: config.organizationId,
          actorType: "user",
          actorId: config.userId,
          resourceType: grant.resourceType,
          resourceId: null,
          action: grant.action,
          effect: "allow",
          grantedBy: config.userId,
        })
        .onConflictDoNothing();
    }
    const direct = await new DrizzleRoleStore(tx).directGrants(
      config.organizationId,
      { type: "user", id: config.userId },
    );
    for (const grant of grants) {
      if (
        !direct.some(
          (actual) =>
            actual.resourceType === grant.resourceType &&
            actual.resourceId === null &&
            actual.action === grant.action &&
            actual.effect === "allow",
        )
      ) {
        throw new Error(
          `Persistent Relationship ${grant.resourceType} ${grant.action} grant provisioning failed`,
        );
      }
    }
    },
  );
}

/**
 * Idempotently provisions and verifies the persistent Learning Agent authority
 * used by onboarding.
 */
export async function ensureLearningAgentGovernance(
  db: Database,
  config: LearningAgentGovernanceConfig,
): Promise<void> {
  return ensurePersistentAgentGovernance(db, {
    ...config,
    name: "Learning Agent",
    description: "May research rights-approved public sources and draft inspectable Signal recommendations; never approves or executes them.",
    goal: "Produce source-attributed public research, Memories, Signals, and recommendations without executing Actions.",
    resourceType: "signal",
    action: "write",
    capabilityToken: "signal:write",
    additionalGrants: [
      { resourceType: "event", action: "write", capabilityToken: "event:write" },
      { resourceType: "external:fetch", action: "read", capabilityToken: "external:fetch:read" },
    ],
    allowedSkills: [
      "stageLearningRecommendation",
      "stageStrategicRecommendation",
      "relationship.help-request.stage-offer",
      "stageCapture",
      "web-research",
      "jobpilot.researchCultureSource",
      "learning.proposePreferenceAdjustment",
    ],
    dataScope: "all",
  });
}

/** Provision the server-owned Outreach Agent used for relationship drafts. */
export async function ensureOutreachAgentGovernance(
  db: Database,
  config: OutreachAgentGovernanceConfig,
): Promise<void> {
  return ensurePersistentAgentGovernance(db, {
    ...config,
    name: "Outreach Agent",
    description: "May draft relationship Events; never approves or sends them.",
    goal: "Produce inspectable relationship Event drafts for Human review.",
    resourceType: "event",
    action: "write",
    capabilityToken: "event:write",
    allowedSkills: ["outreach.stageDraft"],
  });
}

export async function ensureEgressAgentGovernance(
  db: Database,
  config: RuntimeAgentGovernanceConfig,
): Promise<void> {
  return ensurePersistentAgentGovernance(db, {
    ...config,
    name: "Egress Agent",
    description: "May source approved public external data; never sends externally.",
    goal: "Fetch public source data through governed Integrations for review and intake.",
    resourceType: "external:fetch",
    action: "read",
    capabilityToken: "external:fetch:read",
    allowedSkills: [
      "dealpilot.source",
      "google.sourceGmail",
      "google.sourceCalendar",
      "google.listCalendarEvents",
    ],
    dataScope: "public",
  });
}

export async function ensureIntakeAgentGovernance(
  db: Database,
  config: RuntimeAgentGovernanceConfig,
): Promise<void> {
  return ensurePersistentAgentGovernance(db, {
    ...config,
    name: "Intake Agent",
    description: "May stage sourced evidence into governed local graph proposals.",
    goal: "Transform authorized source data into inspectable local proposals.",
    resourceType: "event",
    action: "write",
    capabilityToken: "event:write",
    additionalGrants: [
      { resourceType: "signal", action: "write", capabilityToken: "signal:write" },
      { resourceType: "person", action: "write", capabilityToken: "person:write" },
    ],
    allowedSkills: ["google.stage"],
    dataScope: "all",
  });
}

async function ensureSignalDraftAgentGovernance(
  db: Database,
  config: FoundationalAgentGovernanceConfig,
  details: { name: string; description: string; goal: string },
): Promise<void> {
  return ensurePersistentAgentGovernance(db, {
    ...config,
    ...details,
    resourceType: "signal",
    action: "write",
    capabilityToken: "signal:write",
  });
}

export async function ensureInternalStrategistGovernance(
  db: Database,
  config: InternalStrategistGovernanceConfig,
): Promise<void> {
  return ensurePersistentAgentGovernance(db, {
    ...config,
    name: "Internal Strategist",
    description: "May draft inspectable analytical-synthesis Signal recommendations; never approves or executes them.",
    goal: "Produce evidenced analytical synthesis and recommendations from cited Human/Learning data, without executing Actions.",
    resourceType: "signal",
    action: "write",
    capabilityToken: "signal:write",
    additionalGrants: [
      { resourceType: "record", action: "read", capabilityToken: "record:read" },
      { resourceType: "record", action: "write", capabilityToken: "record:write" },
    ],
    allowedSkills: [
      "stageStrategicRecommendation",
      "jobpilot.synthesizeCultureProfile",
      "task-manager.ledger-projection",
      "task-manager.create-task",
    ],
    dataScope: "all",
  });
}

export async function ensureGovernanceAgentGovernance(
  db: Database,
  config: FoundationalAgentGovernanceConfig,
): Promise<void> {
  return ensurePersistentAgentGovernance(db, {
    ...config,
    name: "Governance",
    description: "May draft inspectable risk-assessment Signals; never approves or executes them.",
    goal: "Explain policy, assess risk, and summarize audit findings without deciding authority.",
    resourceType: "signal",
    action: "write",
    capabilityToken: "signal:write",
    additionalGrants: [
      { resourceType: "record", action: "read", capabilityToken: "record:read" },
      { resourceType: "record", action: "archive", capabilityToken: "record:archive" },
    ],
    allowedSkills: ["task-manager.completed-bay-sweep"],
    dataScope: "all",
  });
}

export async function ensureCapabilityBuilderGovernance(
  db: Database,
  config: FoundationalAgentGovernanceConfig,
): Promise<void> {
  return ensureSignalDraftAgentGovernance(db, config, {
    name: "Capability Builder",
    description: "May draft inspectable capability-change Signals; never activates its own output.",
    goal: "Draft and test proposed capability changes without shipping or activation.",
  });
}

function asGrant(row: {
  resourceType: string;
  resourceId: string | null;
  action: string;
  effect: string;
}): GrantRule {
  return {
    resourceType: row.resourceType as GrantRule["resourceType"],
    resourceId: row.resourceId,
    action: row.action as GrantRule["action"],
    effect: (row.effect === "deny" ? "deny" : "allow") as Effect,
  };
}

export class DrizzleRoleStore implements RoleQuery {
  #db: Database;
  #defaultOrganizationId: string | undefined;
  constructor(db: Database, defaultOrganizationId?: string) {
    this.#db = db;
    this.#defaultOrganizationId = defaultOrganizationId;
  }

  async rolesForPrincipal(organizationId: string, actor: Actor): Promise<string[]> {
    // Schema v2: a organization member carries a single role_id. Team-level roles
    // are resolved by the caller's delegation scope (not modeled as a row yet).
    if (actor.type !== "user") return [];
    return withOrganizationOnly(this.#db, organizationId, async (db) => {
    const rows = await db
      .select({ roleId: organizationMembers.roleId })
      .from(organizationMembers)
      .where(and(eq(organizationMembers.organizationId, organizationId), eq(organizationMembers.userId, actor.id)));
    return rows.map((r) => r.roleId).filter((id): id is string => id !== null);
    });
  }

  async grantsForRole(roleId: string): Promise<GrantRule[]> {
    return withDefaultOrganization(this.#db, this.#defaultOrganizationId, async (db) => {
    const rows = await db
      .select({
        resourceType: rolePermissions.resourceType,
        resourceId: rolePermissions.resourceId,
        action: rolePermissions.action,
        effect: rolePermissions.effect,
      })
      .from(rolePermissions)
      .where(eq(rolePermissions.roleId, roleId));
    return rows.map(asGrant);
    });
  }

  async directGrants(organizationId: string, actor: Actor): Promise<GrantRule[]> {
    // Active (not revoked) direct CBAC grants. Expiry is checked by the resolver's
    // injected clock at the ephemeral layer; here we honor revoked_at only.
    return withOrganizationOnly(this.#db, organizationId, async (db) => {
    const rows = await db
      .select({
        resourceType: permissions.resourceType,
        resourceId: permissions.resourceId,
        action: permissions.action,
        effect: permissions.effect,
      })
      .from(permissions)
      .where(
        and(
          eq(permissions.organizationId, organizationId),
          eq(permissions.actorType, actor.type),
          eq(permissions.actorId, actor.id),
          isNull(permissions.revokedAt),
        ),
      );
    return rows.map(asGrant);
    });
  }
}

export class DrizzleAgentStore implements AgentQuery {
  #db: Database;
  #defaultOrganizationId: string | undefined;
  constructor(db: Database, defaultOrganizationId?: string) {
    this.#db = db;
    this.#defaultOrganizationId = defaultOrganizationId;
  }

  async organizationId(agentId: string): Promise<string | null> {
    return withDefaultOrganization(this.#db, this.#defaultOrganizationId, async (db) => {
    const rows = await db
      .select({ organizationId: agents.organizationId })
      .from(agents)
      .where(eq(agents.id, agentId))
      .limit(1);
    return rows[0]?.organizationId ?? null;
    });
  }

  async isActive(agentId: string): Promise<boolean> {
    return withDefaultOrganization(this.#db, this.#defaultOrganizationId, async (db) => {
    const rows = await db
      .select({ status: agents.status })
      .from(agents)
      .where(eq(agents.id, agentId))
      .limit(1);
    return rows[0]?.status === "active";
    });
  }

  async assumedRole(agentId: string): Promise<string | null> {
    return withDefaultOrganization(this.#db, this.#defaultOrganizationId, async (db) => {
    const rows = await db
      .select({ role: agents.assumesRoleId })
      .from(agents)
      .where(eq(agents.id, agentId))
      .limit(1);
    return rows[0]?.role ?? null;
    });
  }

  async capabilityScope(agentId: string): Promise<string[]> {
    // Live SCHEMA.sql shape: agents.capability_scope jsonb = { "resources": ["person:read", "event:write", ...] }.
    // `tokens` is accepted as a legacy alias. An optional `dataScope` may also ride here.
    // Read-time validation happens in #scope() — throw loudly on a malformed
    // row instead of silently falling back to an empty (or worse, permissive)
    // scope. See parseAgentCapabilityScope.
    const scope = await this.#scope(agentId);
    return scope?.resources ?? scope?.tokens ?? [];
  }

  async dataScope(agentId: string): Promise<"all" | "public" | "private"> {
    const scope = await this.#scope(agentId);
    return scope?.dataScope ?? "all";
  }

  async allowedSkills(agentId: string): Promise<string[]> {
    return withDefaultOrganization(this.#db, this.#defaultOrganizationId, async (db) => {
    const rows = await db
      .select({ allowed: agents.allowedSkills })
      .from(agents)
      .where(eq(agents.id, agentId))
      .limit(1);
    const allowed = rows[0]?.allowed;
    if (allowed === undefined || allowed === null) return [];
    // Read-time validation: throw loudly on a malformed entry instead of
    // silently filtering it out of the allow-list (see parseAllowedSkills).
    return parseAllowedSkills(allowed);
    });
  }

  /** Write-time gate: validates the capability_scope shape and throws before anything is persisted. */
  async saveCapabilityScope(agentId: string, scope: unknown): Promise<void> {
    const validated = parseAgentCapabilityScope(scope);
    await withDefaultOrganization(this.#db, this.#defaultOrganizationId, async (db) => {
      await db.update(agents).set({ capabilityScope: validated }).where(eq(agents.id, agentId));
    });
  }

  /** Write-time gate: validates the allowed-skills list and throws before anything is persisted. */
  async saveAllowedSkills(agentId: string, allowedSkills: unknown): Promise<void> {
    const validated = parseAllowedSkills(allowedSkills);
    await withDefaultOrganization(this.#db, this.#defaultOrganizationId, async (db) => {
      await db.update(agents).set({ allowedSkills: validated }).where(eq(agents.id, agentId));
    });
  }

  async #scope(agentId: string): Promise<AgentCapabilityScope | undefined> {
    return withDefaultOrganization(this.#db, this.#defaultOrganizationId, async (db) => {
    const rows = await db
      .select({ scope: agents.capabilityScope })
      .from(agents)
      .where(eq(agents.id, agentId))
      .limit(1);
    if (rows.length === 0) return undefined;
    // Read-time validation: throw loudly rather than silently coercing a
    // malformed capability_scope into an empty/permissive default.
    return parseAgentCapabilityScope(rows[0]?.scope);
    });
  }
}

export class DrizzleEphemeralStore implements EphemeralQuery {
  #db: Database;
  constructor(db: Database) {
    this.#db = db;
  }

  async activeGrants(
    organizationId: string,
    actor: Actor,
    context: { id: string } | undefined,
    nowISO: string,
  ): Promise<GrantRule[]> {
    return withOrganizationOnly(this.#db, organizationId, async (db) => {
    const rows = await db
      .select({
        resourceType: ephemeralGrants.resourceType,
        resourceId: ephemeralGrants.resourceId,
        action: ephemeralGrants.action,
        contextId: ephemeralGrants.contextId,
      })
      .from(ephemeralGrants)
      .where(
        and(
          eq(ephemeralGrants.organizationId, organizationId),
          eq(ephemeralGrants.actorType, actor.type),
          eq(ephemeralGrants.actorId, actor.id),
          isNull(ephemeralGrants.consumedAt),
          gt(ephemeralGrants.expiresAt, new Date(nowISO)),
        ),
      );
    return rows
      .filter((r) => !r.contextId || r.contextId === context?.id)
      .map((r) => ({
        resourceType: r.resourceType as GrantRule["resourceType"],
        resourceId: r.resourceId,
        action: r.action as GrantRule["action"],
        effect: "allow" as Effect, // ephemeral grants are allow-only by construction
      }));
    });
  }
}

/** A minimal, deterministic policy `rule` matcher. */
interface PolicyRule {
  /** Match when the action is in this list (or any if omitted). */
  actions?: string[];
  /** Match when the resourceType is in this list (or any if omitted). */
  resourceTypes?: string[];
}

function ruleMatches(rule: PolicyRule, input: PolicyEvalInput): boolean {
  if (rule.actions && !rule.actions.includes(input.action)) return false;
  if (rule.resourceTypes && !rule.resourceTypes.includes(input.resourceType)) return false;
  return true;
}

export class DrizzlePolicyStore implements PolicyStore {
  #db: Database;
  constructor(db: Database) {
    this.#db = db;
  }

  async evaluate(input: PolicyEvalInput): Promise<PolicyResult[]> {
    return withOrganizationOnly(this.#db, input.organizationId, async (db) => {
    const rows = await db
      .select({
        id: policies.id,
        scopeType: policies.scopeType,
        scopeId: policies.scopeId,
        rule: policies.rule,
        effect: policies.effect,
        priority: policies.priority,
      })
      .from(policies)
      .where(
        and(
          eq(policies.organizationId, input.organizationId),
          eq(policies.active, true),
          eq(policies.evaluationPhase, input.phase),
          // Scope: organization-wide OR matches the resource being acted on.
          or(eq(policies.scopeType, "organization"), eq(policies.scopeType, input.resourceType)),
        ),
      )
      .orderBy(policies.priority);

    const out: PolicyResult[] = [];
    for (const row of rows) {
      const rule = (row.rule ?? {}) as PolicyRule;
      if (!ruleMatches(rule, input)) continue;
      out.push({
        policyId: row.id,
        phase: input.phase,
        effect: row.effect as PolicyResult["effect"],
        reason: `policy ${row.id} (${row.scopeType})`,
      });
    }
    return out;
    });
  }
}
