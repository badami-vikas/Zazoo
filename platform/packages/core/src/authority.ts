/**
 * Authority resolver — WHO may act. Deny-by-default, four layers:
 *
 *   (role grants ∩ capability_scope) ∪ active ephemeral grants − deny
 *
 * For an agent acting on-behalf-of a principal, also ∩ the principal's authority
 * (delegation). RLS handles tenancy + visibility at the DB; this resolver is the
 * in-tenant capability layer. They compose — neither replaces the other.
 *
 * Explicit deny ALWAYS wins. A non-removable, seeded agent-floor DENY closes the
 * self-modification escape: no agent may write/execute/archive governance tables,
 * read the full network graph, or send/share externally — and no grant overrides it.
 */
import type {
  Action,
  Actor,
  AuthorityDecision,
  GrantRule,
  ResourceType,
} from "./types.js";
import type { AgentQuery, EphemeralQuery, RoleQuery } from "./ports.js";
import type { RunContext } from "./types.js";
import {
  intersectDataScope,
  unionDataScope,
  type DataScope,
  type EffectiveDataScope,
} from "./data-scope.js";

/** Governance resources an agent may never mutate (self-modification escape). */
const AGENT_FLOOR_PROTECTED: ReadonlySet<ResourceType> = new Set<ResourceType>([
  "policy",
  "policy_param",
  "skill",
  "agent",
  "role",
  "permission",
  "ledger",
  "delegation",
]);

const AGENT_FLOOR_MUTATIONS: ReadonlySet<Action> = new Set<Action>([
  "write",
  "execute",
  "archive",
]);

/**
 * Seeded agent-floor DENY (SCHEMA.sql v2 SEED). Enforced here so no grant can
 * override it. Returns a deny reason if the agent action hits the floor, else null.
 */
export function agentFloorDeny(
  actor: Actor,
  action: Action,
  resourceType: ResourceType,
): string | null {
  if (actor.type !== "agent") return null;

  if (AGENT_FLOOR_PROTECTED.has(resourceType) && AGENT_FLOOR_MUTATIONS.has(action)) {
    return `agent-floor: agents may not ${action} ${resourceType} (governance self-modification denied)`;
  }
  if (resourceType === "network_graph:full" && action === "read") {
    return "agent-floor: agents may not read the full network graph";
  }
  if (resourceType === "external:send") {
    return "agent-floor: agents may not send/share externally without human approval";
  }
  return null;
}

/** Internet-egress resources — only reachable from the cloud/egress plane (the gate). */
const EGRESS_RESOURCES: ReadonlySet<ResourceType> = new Set<ResourceType>([
  "external:send",
  "external:fetch",
]);

/**
 * Local-first gate (Layer 0.5, structural — runs before grants).
 *
 *  - LOCAL plane may NOT reach the internet: any egress resource is denied. Local
 *    agents REQUEST data; a cloud agent SOURCES it. (default plane = local.)
 *  - CLOUD/egress plane may NOT read the private/local tier (enforced as a public
 *    ceiling on the effective data scope; see the clamp in resolveAuthority).
 *
 * Returns a deny reason if the local→egress rule is hit, else null.
 */
export function planeGate(actor: Actor, resourceType: ResourceType): string | null {
  const plane = actor.plane ?? "local";
  if (plane === "local" && EGRESS_RESOURCES.has(resourceType)) {
    return `local-first gate: local plane may not reach the internet (${resourceType}); route a sourcing request to a cloud agent`;
  }
  return null;
}

function tokensFor(action: Action, resourceType: ResourceType): string[] {
  // Capability scope tokens: exact, type-wildcard, action-wildcard, full wildcard.
  return [
    `${resourceType}:${action}`,
    `${resourceType}:*`,
    `*:${action}`,
    "*",
  ];
}

function scopePermits(scope: ReadonlySet<string>, action: Action, resourceType: ResourceType): boolean {
  return tokensFor(action, resourceType).some((t) => scope.has(t));
}

function grantMatches(
  g: GrantRule,
  action: Action,
  resourceType: ResourceType,
  resourceId: string | undefined,
): boolean {
  if (g.action !== action) return false;
  if (g.resourceType !== resourceType) return false;
  // null resourceId on the grant => type-wide; else must match the target.
  if (g.resourceId !== null && g.resourceId !== resourceId) return false;
  return true;
}

export interface ResolveArgs {
  workspaceId: string;
  actor: Actor;
  action: Action;
  resourceType: ResourceType;
  resourceId?: string;
  context?: RunContext;
  /** Present when an agent acts for a principal (delegation). */
  onBehalfOf?: { type: "user" | "team"; id: string };
  /** Data tier the request asks to touch (the access dropdown). Absent = 'all'. */
  requestedDataScope?: DataScope;
}

export interface AuthorityDeps {
  roles: RoleQuery;
  agents: AgentQuery;
  ephemeral: EphemeralQuery;
  nowISO: string;
}

/** Collect (allow/deny) grants for a principal (role grants ∪ direct grants). */
async function principalGrants(
  deps: AuthorityDeps,
  workspaceId: string,
  actor: Actor,
): Promise<GrantRule[]> {
  const roleIds = await deps.roles.rolesForPrincipal(workspaceId, actor);
  const fromRoles: GrantRule[] = [];
  for (const rid of roleIds) {
    fromRoles.push(...(await deps.roles.grantsForRole(rid)));
  }
  const direct = await deps.roles.directGrants(workspaceId, actor);
  return [...fromRoles, ...direct];
}

/** Does a flat grant set ALLOW this action (no deny present)? Plus the union of
 * data scopes across matching allow grants (a grant with no scope = 'all'). */
function grantsAllow(
  grants: GrantRule[],
  action: Action,
  resourceType: ResourceType,
  resourceId: string | undefined,
): { allow: boolean; deny: boolean; scope: DataScope } {
  let allow = false;
  let deny = false;
  const allowScopes: Array<DataScope | undefined> = [];
  for (const g of grants) {
    if (!grantMatches(g, action, resourceType, resourceId)) continue;
    if (g.effect === "deny") deny = true;
    else {
      allow = true;
      allowScopes.push(g.dataScope);
    }
  }
  return { allow, deny, scope: unionDataScope(allowScopes) };
}

/**
 * Resolve authority. Pure of wall-clock/RNG — `deps.nowISO` is injected.
 */
export async function resolveAuthority(
  args: ResolveArgs,
  deps: AuthorityDeps,
): Promise<AuthorityDecision> {
  const { actor, action, resourceType, resourceId, workspaceId } = args;
  let requested: EffectiveDataScope = args.requestedDataScope ?? "all";

  // Layer 0 — seeded agent-floor DENY. Non-removable, wins over everything.
  const floor = agentFloorDeny(actor, action, resourceType);
  if (floor) return { allowed: false, reason: floor, basis: "deny", dataScope: "none" };

  // Layer 0.5 — local-first gate. Local plane may not egress; cloud plane is
  // ceiling-clamped to public so it can never reach the private/local tier.
  const gate = planeGate(actor, resourceType);
  if (gate) return { allowed: false, reason: gate, basis: "deny", dataScope: "none" };
  if ((actor.plane ?? "local") === "cloud") {
    requested = intersectDataScope(requested, "public"); // cloud egress ceiling = public
  }

  if (actor.type === "agent") {
    // base = role grants ∩ capability_scope
    const scopeTokens = new Set(await deps.agents.capabilityScope(actor.id));
    const inScope = scopePermits(scopeTokens, action, resourceType);

    const assumed = await deps.agents.assumedRole(actor.id);
    const roleGrants: GrantRule[] = assumed ? await deps.roles.grantsForRole(assumed) : [];
    const roleEval = grantsAllow(roleGrants, action, resourceType, resourceId);

    // Explicit deny in the role wins.
    if (roleEval.deny) {
      return { allowed: false, reason: "explicit deny on assumed role", basis: "deny", dataScope: "none" };
    }

    const base = inScope && roleEval.allow;

    // ∪ active ephemeral grants (a ceiling-bypassing, expiring grant for a run)
    const eph = await deps.ephemeral.activeGrants(workspaceId, actor, args.context, deps.nowISO);
    const ephEval = grantsAllow(eph, action, resourceType, resourceId);
    if (ephEval.deny) {
      return { allowed: false, reason: "explicit deny on ephemeral grant", basis: "deny", dataScope: "none" };
    }

    const authorized = base || ephEval.allow;
    let basis: AuthorityDecision["basis"] = ephEval.allow && !base ? "ephemeral" : "role";

    if (!authorized) {
      const why = !inScope
        ? "outside agent capability_scope (ceiling)"
        : "no allow grant on assumed role or ephemeral grant";
      return { allowed: false, reason: why, basis: "default", dataScope: "none" };
    }

    // Data-scope: requested ∩ agent ceiling ∩ granted scope (the contributing grant set).
    const agentCeiling = await deps.agents.dataScope(actor.id);
    const grantedScope = base ? roleEval.scope : ephEval.scope;
    let effective = intersectDataScope(intersectDataScope(requested, agentCeiling), grantedScope);

    // Delegation: also ∩ the principal's authority (incl. their data scope).
    if (args.onBehalfOf) {
      const principalActor: Actor = { type: args.onBehalfOf.type, id: args.onBehalfOf.id };
      const pGrants = await principalGrants(deps, workspaceId, principalActor);
      const pEval = grantsAllow(pGrants, action, resourceType, resourceId);
      if (pEval.deny || !pEval.allow) {
        return {
          allowed: false,
          reason: "delegation denied: principal lacks this authority",
          basis: "principal",
          dataScope: "none",
        };
      }
      effective = intersectDataScope(effective, pEval.scope);
      basis = "principal";
    }

    if (effective === "none") {
      return {
        allowed: false,
        reason: `data-scope conflict: requested '${requested}' exceeds granted tier`,
        basis: "default",
        dataScope: "none",
      };
    }
    return { allowed: true, reason: `authorized via ${basis}`, basis, dataScope: effective };
  }

  // Human principal (user/team): role grants ∪ direct grants − deny. Ceiling = all.
  const grants = await principalGrants(deps, workspaceId, actor);
  const ev = grantsAllow(grants, action, resourceType, resourceId);
  if (ev.deny) return { allowed: false, reason: "explicit deny", basis: "deny", dataScope: "none" };
  if (!ev.allow) {
    return { allowed: false, reason: "deny-by-default: no matching allow grant", basis: "default", dataScope: "none" };
  }
  const effective = intersectDataScope(requested, ev.scope);
  if (effective === "none") {
    return {
      allowed: false,
      reason: `data-scope conflict: requested '${requested}' exceeds granted tier`,
      basis: "default",
      dataScope: "none",
    };
  }
  return { allowed: true, reason: "authorized via role/direct grant", basis: "role", dataScope: effective };
}
