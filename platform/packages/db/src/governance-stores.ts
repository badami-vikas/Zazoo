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
  workspaceMembers,
} from "./schema.js";

type Effect = "allow" | "deny";

/**
 * `agents.capability_scope` jsonb shape. `tokens` is a legacy alias for
 * `resources`; `dataScope` is optional (absent = "all"). This is the ONLY gate
 * this jsonb passes through in either direction — malformed data must never
 * be written (write time throws), and if a bad row is somehow already present
 * (pre-fix data, another process, a raw insert), reading it must throw rather
 * than silently filtering bad entries out or falling back to a default scope,
 * since either of those failure modes silently changes what an agent is
 * authorized to do.
 */
export const capabilityScopeSchema = z
  .object({
    resources: z.array(z.string().min(1)).optional(),
    tokens: z.array(z.string().min(1)).optional(),
    dataScope: z.enum(["all", "public", "private"]).optional(),
  })
  .strict();

export const allowedSkillsSchema = z.array(z.string().min(1));

/** Validate `agents.capability_scope` jsonb at read or write time. Throws on the first bad field. */
export function parseCapabilityScope(
  raw: unknown,
): { resources?: string[]; tokens?: string[]; dataScope?: "all" | "public" | "private" } {
  const result = capabilityScopeSchema.safeParse(raw ?? {});
  if (!result.success) {
    throw new Error(`Invalid agents.capability_scope jsonb: ${result.error.message}`);
  }
  return result.data;
}

/** Validate `agents.allowed_skills` at read or write time. Throws on the first bad entry. */
export function parseAllowedSkills(raw: unknown): string[] {
  const result = allowedSkillsSchema.safeParse(raw ?? []);
  if (!result.success) {
    throw new Error(`Invalid agents.allowed_skills: ${result.error.message}`);
  }
  return result.data;
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
    const scope = await this.#scope(agentId);
    const list = scope?.resources ?? scope?.tokens;
    return Array.isArray(list) ? list.filter((t): t is string => typeof t === "string") : [];
  }

  async dataScope(agentId: string): Promise<"all" | "public" | "private"> {
    const scope = await this.#scope(agentId);
    const ds = scope?.dataScope;
    return ds === "public" || ds === "private" ? ds : "all";
  }

  async allowedSkills(agentId: string): Promise<string[]> {
    const rows = await this.#db
      .select({ allowed: agents.allowedSkills })
      .from(agents)
      .where(eq(agents.id, agentId))
      .limit(1);
    const allowed = rows[0]?.allowed;
    return Array.isArray(allowed) ? allowed.filter((s): s is string => typeof s === "string") : [];
  }

  async #scope(agentId: string): Promise<{ resources?: unknown; tokens?: unknown; dataScope?: unknown } | undefined> {
    const rows = await this.#db
      .select({ scope: agents.capabilityScope })
      .from(agents)
      .where(eq(agents.id, agentId))
      .limit(1);
    return rows[0]?.scope as { resources?: unknown; tokens?: unknown; dataScope?: unknown } | undefined;
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
