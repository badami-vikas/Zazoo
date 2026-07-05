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
import { isAgentFloorDenied } from "./agent-floor.js";

/**
 * Seeded agent-floor DENY (SCHEMA.sql v2 SEED). Enforced here so no grant can
 * override it. Returns a deny reason if the agent action hits the floor, else null.
 *
 * The actual floor definition (which resources/actions/scopes it covers) lives in
 * `agent-floor.ts` as the single canonical source — this wraps it with the
 * Actor-typed signature and the deny-reason strings the pipeline expects.
 */
export function agentFloorDeny(
  actor: Actor,
  action: Action,
  resourceType: ResourceType,
): string | null {
  if (actor.type !== "agent") return null;
  if (!isAgentFloorDenied(action, resourceType)) return null;

  if (resourceType === "network_graph:full" && action === "read") {
    return "agent-floor: agents may not read the full network graph";
  }
  if (resourceType === "external:send") {
    return "agent-floor: agents may not send/share externally without human approval";
  }
  return `agent-floor: agents may not ${action} ${resourceType} (governance self-modification denied)`;
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

/** Result of the base agent-authorization check (Layer 1): capability_scope
 * ceiling ∩ the agent's assumed-role grants. `decision` is set when this layer
 * settles the outcome outright (explicit role deny); otherwise the caller
 * continues on to the ephemeral-grant layer using `base`/`inScope`/`roleEval`. */
interface AgentRoleScopeResult {
  decision: AuthorityDecision | null;
  inScope: boolean;
  roleEval: ReturnType<typeof grantsAllow>;
  base: boolean;
}

/**
 * Layer 1 — agent base authorization: role grants ∩ capability_scope.
 * Explicit deny on the assumed role wins immediately (returns a decision).
 */
async function evaluateAgentRoleScope(
  deps: AuthorityDeps,
  actor: Actor,
  action: Action,
  resourceType: ResourceType,
  resourceId: string | undefined,
): Promise<AgentRoleScopeResult> {
  const scopeTokens = new Set(await deps.agents.capabilityScope(actor.id));
  const inScope = scopePermits(scopeTokens, action, resourceType);

  const assumed = await deps.agents.assumedRole(actor.id);
  const roleGrants: GrantRule[] = assumed ? await deps.roles.grantsForRole(assumed) : [];
  const roleEval = grantsAllow(roleGrants, action, resourceType, resourceId);

  // Explicit deny in the role wins.
  if (roleEval.deny) {
    return {
      decision: { allowed: false, reason: "explicit deny on assumed role", basis: "deny", dataScope: "none" },
      inScope,
      roleEval,
      base: false,
    };
  }

  const base = inScope && roleEval.allow;
  return { decision: null, inScope, roleEval, base };
}

/** Result of the ephemeral-grant check (Layer 2): a ceiling-bypassing, expiring
 * grant for a run, unioned with the base (role-scope) authorization. */
interface EphemeralGrantResult {
  decision: AuthorityDecision | null;
  ephEval: ReturnType<typeof grantsAllow>;
  authorized: boolean;
  basis: AuthorityDecision["basis"];
}

/**
 * Layer 2 — active ephemeral grants ∪ base authorization. Explicit deny on an
 * ephemeral grant wins immediately. If neither base nor ephemeral authorizes
 * the action, returns the deny-by-default decision explaining which ceiling
 * was hit.
 */
async function evaluateEphemeralGrant(
  deps: AuthorityDeps,
  workspaceId: string,
  actor: Actor,
  action: Action,
  resourceType: ResourceType,
  resourceId: string | undefined,
  context: RunContext | undefined,
  base: boolean,
  inScope: boolean,
): Promise<EphemeralGrantResult> {
  const eph = await deps.ephemeral.activeGrants(workspaceId, actor, context, deps.nowISO);
  const ephEval = grantsAllow(eph, action, resourceType, resourceId);
  if (ephEval.deny) {
    return {
      decision: { allowed: false, reason: "explicit deny on ephemeral grant", basis: "deny", dataScope: "none" },
      ephEval,
      authorized: false,
      basis: "deny",
    };
  }

  const authorized = base || ephEval.allow;
  const basis: AuthorityDecision["basis"] = ephEval.allow && !base ? "ephemeral" : "role";

  if (!authorized) {
    const why = !inScope
      ? "outside agent capability_scope (ceiling)"
      : "no allow grant on assumed role or ephemeral grant";
    return {
      decision: { allowed: false, reason: why, basis: "default", dataScope: "none" },
      ephEval,
      authorized,
      basis,
    };
  }

  return { decision: null, ephEval, authorized, basis };
}

/**
 * Layer 3 — data-scope narrowing: requested ∩ agent ceiling ∩ granted scope
 * (the contributing grant set — role if base authorized it, else ephemeral).
 */
async function computeAgentDataScope(
  deps: AuthorityDeps,
  actor: Actor,
  requested: EffectiveDataScope,
  base: boolean,
  roleEval: ReturnType<typeof grantsAllow>,
  ephEval: ReturnType<typeof grantsAllow>,
): Promise<EffectiveDataScope> {
  const agentCeiling = await deps.agents.dataScope(actor.id);
  const grantedScope = base ? roleEval.scope : ephEval.scope;
  return intersectDataScope(intersectDataScope(requested, agentCeiling), grantedScope);
}

/** Result of the delegation check (Layer 4): does the principal an agent acts
 * on-behalf-of also have this authority? */
interface DelegationResult {
  decision: AuthorityDecision | null;
  effective: EffectiveDataScope;
  basis: AuthorityDecision["basis"];
}

/**
 * Layer 4 — delegation: when an agent acts on-behalf-of a principal, also
 * intersect the principal's authority (including their data scope). Denies
 * if the principal lacks an allow grant or is explicitly denied.
 */
async function evaluateDelegation(
  deps: AuthorityDeps,
  workspaceId: string,
  onBehalfOf: { type: "user" | "team"; id: string },
  action: Action,
  resourceType: ResourceType,
  resourceId: string | undefined,
  effective: EffectiveDataScope,
): Promise<DelegationResult> {
  const principalActor: Actor = { type: onBehalfOf.type, id: onBehalfOf.id };
  const pGrants = await principalGrants(deps, workspaceId, principalActor);
  const pEval = grantsAllow(pGrants, action, resourceType, resourceId);
  if (pEval.deny || !pEval.allow) {
    return {
      decision: {
        allowed: false,
        reason: "delegation denied: principal lacks this authority",
        basis: "principal",
        dataScope: "none",
      },
      effective: "none",
      basis: "principal",
    };
  }
  return { decision: null, effective: intersectDataScope(effective, pEval.scope), basis: "principal" };
}

/**
 * Resolve authority for an agent actor: base role/scope ∪ ephemeral grants,
 * data-scope narrowing, and delegation — Layers 1-4 above, in order.
 */
async function resolveAgentAuthority(
  args: ResolveArgs,
  deps: AuthorityDeps,
  requested: EffectiveDataScope,
): Promise<AuthorityDecision> {
  const { actor, action, resourceType, resourceId, workspaceId } = args;

  const roleScope = await evaluateAgentRoleScope(deps, actor, action, resourceType, resourceId);
  if (roleScope.decision) return roleScope.decision;
  const { inScope, roleEval, base } = roleScope;

  const ephResult = await evaluateEphemeralGrant(
    deps,
    workspaceId,
    actor,
    action,
    resourceType,
    resourceId,
    args.context,
    base,
    inScope,
  );
  if (ephResult.decision) return ephResult.decision;
  const { ephEval } = ephResult;
  let basis = ephResult.basis;

  let effective = await computeAgentDataScope(deps, actor, requested, base, roleEval, ephEval);

  if (args.onBehalfOf) {
    const delegation = await evaluateDelegation(
      deps,
      workspaceId,
      args.onBehalfOf,
      action,
      resourceType,
      resourceId,
      effective,
    );
    if (delegation.decision) return delegation.decision;
    effective = delegation.effective;
    basis = delegation.basis;
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
    return resolveAgentAuthority(args, deps, requested);
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
