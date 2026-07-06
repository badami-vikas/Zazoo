/**
 * Agent-floor invariant — the SINGLE canonical definition of "what an agent may
 * never do", regardless of any grant. Three call sites need this shape:
 *
 *   1. `agentFloorDeny` (authority.ts)      — runtime DENY on (actor, action, resourceType)
 *   2. `isForbiddenAgentToken` (agent-scope.ts) — construction-time scope-token stripping
 *   3. `ALWAYS_APPROVAL_SCOPES` (@bridge/db integration-store.ts) — standing-grant refusal
 *
 * These previously maintained THREE independent lists that had drifted apart
 * (ALWAYS_APPROVAL_SCOPES was missing the governance-resource floor entirely — see
 * docs/raw/decisions-log.md). A floor must be at least as strict as the union of
 * everything ever enforced anywhere, so this module is that union, and the three
 * call sites now derive from it instead of re-declaring it.
 */
import type { Action, ResourceType } from "./types.js";

/** Governance resources an agent may never mutate (self-modification escape). */
export const AGENT_FLOOR_PROTECTED_RESOURCES: ReadonlySet<ResourceType> = new Set<ResourceType>([
  "policy",
  "policy_param",
  "skill",
  "agent",
  "role",
  "permission",
  "ledger",
  "delegation",
]);

/** Mutating actions the floor blocks on protected governance resources. */
export const AGENT_FLOOR_MUTATIONS: ReadonlySet<Action> = new Set<Action>([
  "write",
  "execute",
  "archive",
  // `approve` on the ledger is the act of resolving a proposal. Agents DRAFT, humans
  // APPROVE — an in-platform agent may never be the approver. (See pipeline.decide.)
  "approve",
]);

/**
 * Exact capability-scope tokens (`resourceType:action` or `resourceType:*`) that are
 * ALWAYS agent-floor DENY, independent of the protected-resource × mutation matrix
 * above: full-graph read and unsupervised external send. Never grantable as a
 * standing allow; always requires human approval at run time.
 */
export const AGENT_FLOOR_ALWAYS_DENIED_SCOPES: readonly string[] = [
  "external:send",
  "network_graph:full",
] as const;

/**
 * The full set of `resourceType:action` tokens the floor denies for the protected
 * governance resources, for EVERY action (not just the mutations above) — this is
 * the strictest of the three original lists (isForbiddenAgentToken blocked all
 * actions, e.g. `agent:read`, not only write/execute/archive/approve). Exposed so
 * scope-token checks can match on resource-prefix rather than enumerate.
 */
export function isAgentFloorProtectedResourceToken(token: string): boolean {
  const resource = token.split(":")[0];
  return AGENT_FLOOR_PROTECTED_RESOURCES.has(resource as ResourceType);
}

/** Tokens an agent may never hold — escalation / self-modification / god-mode.
 * This is the union of every scope-level floor ever enforced: the wildcard, the
 * always-denied exact scopes, and any token touching a protected governance
 * resource (all actions, not just mutations — read included). */
export function isForbiddenAgentToken(token: string): boolean {
  if (token === "*") return true; // god-mode wildcard
  if (AGENT_FLOOR_ALWAYS_DENIED_SCOPES.some((denied) => token.startsWith(denied))) return true;
  return isAgentFloorProtectedResourceToken(token);
}

/**
 * Pure predicate version of the runtime floor check: does (action, resourceType) hit
 * the agent floor? `agentFloorDeny` in authority.ts wraps this with the Actor-typed
 * signature + deny-reason strings the pipeline expects; this is the shared logic.
 */
export function isAgentFloorDenied(action: Action, resourceType: ResourceType): boolean {
  if (AGENT_FLOOR_PROTECTED_RESOURCES.has(resourceType) && AGENT_FLOOR_MUTATIONS.has(action)) {
    return true;
  }
  if (resourceType === "network_graph:full" && action === "read") return true;
  if (resourceType === "external:send") return true;
  return false;
}

/**
 * Scopes that can never be a standing allow — always human-approved at run time.
 * Equal to `AGENT_FLOOR_ALWAYS_DENIED_SCOPES` (the exact-scope half of the floor);
 * kept as a distinct export name for readability at the integration-store call site.
 */
export const ALWAYS_APPROVAL_SCOPES: readonly string[] = AGENT_FLOOR_ALWAYS_DENIED_SCOPES;
