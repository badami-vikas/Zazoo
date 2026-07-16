/**
 * Drizzle bindings for the pipeline's governance read ports. With these + the
 * DrizzleLedgerStore, the Universal Action Pipeline runs entirely on Postgres —
 * the same authority math the in-memory adapters cover, now sourced from the
 * governance tables in SCHEMA.sql.
 *
 * RLS still enforces tenancy + visibility at the DB; these resolvers are the
 * in-tenant capability layer. They compose — neither replaces the other.
 */
import { and, eq, gt, isNull, or } from "drizzle-orm";
import { z } from "zod";
import type {
  AgentQuery,
  EphemeralQuery,
  PolicyEvalInput,
  PolicyStore,
  RoleQuery,
} from "@bridge/core";
import type { Actor, GrantRule, PolicyResult } from "@bridge/core";
import type { Database } from "./client.js";
import {
  agents,
  ephemeralGrants,
  permissions,
  policies,
  rolePermissions,
  roles,
  workspaceMembers,
} from "./schema.js";

type Effect = "allow" | "deny";

/**
 * `agents.capability_scope` jsonb shape: `{ resources: string[], dataScope?
 * DataScope }`. `tokens` is accepted as a legacy alias for `resources` on READ
 * (back-compat with rows written before the `resources` rename), but new
 * writes always normalize to `resources` — see `parseAgentCapabilityScope`.
 *
 * Before adding this, searched for an existing zod schema for this shape
 * (`grep -rn "z.object" packages/core`, `grep -rn "capabilityScope"`) — none
 * exists; `@bridge/core` is a types-only package (no zod dependency; ports.ts
 * only declares the TS interface), so this schema is colocated here in
 * `@bridge/db`, the only place that validates the jsonb wire shape at
 * read/write boundaries. `RitualStepDef`'s equivalent schema lives colocated
 * in `ritual-stores.ts` for the same reason — the shapes are unrelated so
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
    workspaceId: string;
    userId: string;
    agentId: string;
    roleId: string;
    permissionId: string;
  }

  /**
   * Idempotently provisions and verifies the persistent Learning Agent authority
   * used by onboarding. Persistent mode cannot rely on the in-memory seed:
   * the Agent must have an attributable assumed Role + capability scope, and the
   * user it acts for must independently hold the same Signal write authority.
   */
export async function ensureLearningAgentGovernance(
    db: Database,
    config: LearningAgentGovernanceConfig,
  ): Promise<void> {
    await db
      .insert(roles)
      .values({
        id: config.roleId,
        workspaceId: config.workspaceId,
        name: "Learning Agent",
        kind: "agent",
        description: "May draft inspectable Signal recommendations; never approves or executes them.",
      })
      .onConflictDoUpdate({
        target: roles.id,
        set: {
          workspaceId: config.workspaceId,
          name: "Learning Agent",
          kind: "agent",
          description: "May draft inspectable Signal recommendations; never approves or executes them.",
        },
      });

    await db
      .insert(agents)
      .values({
        id: config.agentId,
        workspaceId: config.workspaceId,
        name: "Learning Agent",
        ownerUserId: config.userId,
        assumesRoleId: config.roleId,
        goal: "Produce source-attributed Memories, Signals, and recommendations without executing Actions.",
        capabilityScope: { resources: ["signal:write"], dataScope: "public" },
        status: "active",
      })
      .onConflictDoUpdate({
        target: agents.id,
        set: {
          workspaceId: config.workspaceId,
          name: "Learning Agent",
          ownerUserId: config.userId,
          assumesRoleId: config.roleId,
          goal: "Produce source-attributed Memories, Signals, and recommendations without executing Actions.",
          capabilityScope: { resources: ["signal:write"], dataScope: "public" },
          status: "active",
        },
      });

    const roleGrant = await db
      .select({ id: rolePermissions.id })
      .from(rolePermissions)
      .where(
        and(
          eq(rolePermissions.roleId, config.roleId),
          eq(rolePermissions.resourceType, "signal"),
          eq(rolePermissions.action, "write"),
          eq(rolePermissions.effect, "allow"),
          isNull(rolePermissions.resourceId),
        ),
      )
      .limit(1);
    if (!roleGrant[0]) {
      await db
        .insert(rolePermissions)
        .values({
          roleId: config.roleId,
          resourceType: "signal",
          resourceId: null,
          action: "write",
          effect: "allow",
        })
        .onConflictDoNothing();
    }

    const principalGrant = await db
      .select({ id: permissions.id })
      .from(permissions)
      .where(
        and(
          eq(permissions.workspaceId, config.workspaceId),
          eq(permissions.actorType, "user"),
          eq(permissions.actorId, config.userId),
          eq(permissions.resourceType, "signal"),
          eq(permissions.action, "write"),
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
          id: config.permissionId,
          workspaceId: config.workspaceId,
          actorType: "user",
          actorId: config.userId,
          resourceType: "signal",
          resourceId: null,
          action: "write",
          effect: "allow",
          grantedBy: config.userId,
        })
        .onConflictDoNothing();
    }

    const agentStore = new DrizzleAgentStore(db);
    const roleStore = new DrizzleRoleStore(db);
    const [assumedRole, scope, roleGrants, principalGrants] = await Promise.all([
      agentStore.assumedRole(config.agentId),
      agentStore.capabilityScope(config.agentId),
      roleStore.grantsForRole(config.roleId),
      roleStore.directGrants(config.workspaceId, { type: "user", id: config.userId }),
    ]);
    const hasSignalWrite = (grant: GrantRule) =>
      grant.resourceType === "signal" &&
      grant.resourceId === null &&
      grant.action === "write" &&
      grant.effect === "allow";
    if (
      assumedRole !== config.roleId ||
      !scope.includes("signal:write") ||
      !roleGrants.some(hasSignalWrite) ||
      !principalGrants.some(hasSignalWrite)
    ) {
      throw new Error("Persistent Learning Agent governance provisioning failed verification");
  }
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
  constructor(db: Database) {
    this.#db = db;
  }

  async rolesForPrincipal(workspaceId: string, actor: Actor): Promise<string[]> {
    // Schema v2: a workspace member carries a single role_id. Team-level roles
    // are resolved by the caller's delegation scope (not modeled as a row yet).
    if (actor.type !== "user") return [];
    const rows = await this.#db
      .select({ roleId: workspaceMembers.roleId })
      .from(workspaceMembers)
      .where(and(eq(workspaceMembers.workspaceId, workspaceId), eq(workspaceMembers.userId, actor.id)));
    return rows.map((r) => r.roleId).filter((id): id is string => id !== null);
  }

  async grantsForRole(roleId: string): Promise<GrantRule[]> {
    const rows = await this.#db
      .select({
        resourceType: rolePermissions.resourceType,
        resourceId: rolePermissions.resourceId,
        action: rolePermissions.action,
        effect: rolePermissions.effect,
      })
      .from(rolePermissions)
      .where(eq(rolePermissions.roleId, roleId));
    return rows.map(asGrant);
  }

  async directGrants(workspaceId: string, actor: Actor): Promise<GrantRule[]> {
    // Active (not revoked) direct CBAC grants. Expiry is checked by the resolver's
    // injected clock at the ephemeral layer; here we honor revoked_at only.
    const rows = await this.#db
      .select({
        resourceType: permissions.resourceType,
        resourceId: permissions.resourceId,
        action: permissions.action,
        effect: permissions.effect,
      })
      .from(permissions)
      .where(
        and(
          eq(permissions.workspaceId, workspaceId),
          eq(permissions.actorType, actor.type),
          eq(permissions.actorId, actor.id),
          isNull(permissions.revokedAt),
        ),
      );
    return rows.map(asGrant);
  }
}

export class DrizzleAgentStore implements AgentQuery {
  #db: Database;
  constructor(db: Database) {
    this.#db = db;
  }

  async assumedRole(agentId: string): Promise<string | null> {
    const rows = await this.#db
      .select({ role: agents.assumesRoleId })
      .from(agents)
      .where(eq(agents.id, agentId))
      .limit(1);
    return rows[0]?.role ?? null;
  }

  async capabilityScope(agentId: string): Promise<string[]> {
    // Live SCHEMA.sql shape: agents.capability_scope jsonb = { "resources": ["person:read", "touchpoint:write", ...] }.
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
    const rows = await this.#db
      .select({ allowed: agents.allowedSkills })
      .from(agents)
      .where(eq(agents.id, agentId))
      .limit(1);
    const allowed = rows[0]?.allowed;
    if (allowed === undefined || allowed === null) return [];
    // Read-time validation: throw loudly on a malformed entry instead of
    // silently filtering it out of the allow-list (see parseAllowedSkills).
    return parseAllowedSkills(allowed);
  }

  /** Write-time gate: validates the capability_scope shape and throws before anything is persisted. */
  async saveCapabilityScope(agentId: string, scope: unknown): Promise<void> {
    const validated = parseAgentCapabilityScope(scope);
    await this.#db.update(agents).set({ capabilityScope: validated }).where(eq(agents.id, agentId));
  }

  /** Write-time gate: validates the allowed-skills list and throws before anything is persisted. */
  async saveAllowedSkills(agentId: string, allowedSkills: unknown): Promise<void> {
    const validated = parseAllowedSkills(allowedSkills);
    await this.#db.update(agents).set({ allowedSkills: validated }).where(eq(agents.id, agentId));
  }

  async #scope(agentId: string): Promise<AgentCapabilityScope | undefined> {
    const rows = await this.#db
      .select({ scope: agents.capabilityScope })
      .from(agents)
      .where(eq(agents.id, agentId))
      .limit(1);
    if (rows.length === 0) return undefined;
    // Read-time validation: throw loudly rather than silently coercing a
    // malformed capability_scope into an empty/permissive default.
    return parseAgentCapabilityScope(rows[0]?.scope);
  }
}

export class DrizzleEphemeralStore implements EphemeralQuery {
  #db: Database;
  constructor(db: Database) {
    this.#db = db;
  }

  async activeGrants(
    workspaceId: string,
    actor: Actor,
    context: { id: string } | undefined,
    nowISO: string,
  ): Promise<GrantRule[]> {
    const rows = await this.#db
      .select({
        resourceType: ephemeralGrants.resourceType,
        resourceId: ephemeralGrants.resourceId,
        action: ephemeralGrants.action,
        contextId: ephemeralGrants.contextId,
      })
      .from(ephemeralGrants)
      .where(
        and(
          eq(ephemeralGrants.workspaceId, workspaceId),
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
    const rows = await this.#db
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
          eq(policies.workspaceId, input.workspaceId),
          eq(policies.active, true),
          eq(policies.evaluationPhase, input.phase),
          // Scope: workspace-wide OR matches the resource being acted on.
          or(eq(policies.scopeType, "workspace"), eq(policies.scopeType, input.resourceType)),
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
  }
}
