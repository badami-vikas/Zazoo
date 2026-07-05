/**
 * Layered, least-privilege agent capability — the model behind "gated permissions
 * in agent + workflow creation" (cf. Google's incremental OAuth scopes).
 *
 * An agent's authority is built from layers that can only NARROW, never escalate:
 *   1. capability scope tokens  (`resourceType:action`)
 *   2. an EGRESS TIER           (none | read-graph | draft-graph | source-internet)
 *   3. a data-tier ceiling      (all | public | private)  — applied elsewhere
 *
 * Two hard rails enforced HERE, at construction, so the API can never persist an
 * escalating agent:
 *   - `external:send` is NEVER grantable to an agent (human-only; agent-floor also
 *     denies it at runtime). There is no "send" tier.
 *   - governance resources (policy/skill/agent/role/permission/ledger/delegation) and
 *     the full-graph read and the `*` wildcard are stripped — an agent cannot be
 *     created with self-modification or god-mode capability.
 *
 * A Workflow/Ritual runs UNDER its agents' authority and may never EXCEED it:
 * `validateRitualWithinAgents` is the ritual ⊆ agent check.
 */
import type { Action, ResourceType } from "./types.js";
import { intersectDataScope, type DataScope } from "./data-scope.js";
import { isForbiddenAgentToken } from "./agent-floor.js";

export { isForbiddenAgentToken };

export type EgressTier = "none" | "read-graph" | "draft-graph" | "source-internet";

const READ_GRAPH = ["person:read", "community:read", "initiative:read", "touchpoint:read"];
const DRAFT_GRAPH = [...READ_GRAPH, "touchpoint:write", "signal:write"];
/** Only this tier reaches the internet — and only to SOURCE (external:fetch:read).
 * Sending (external:send) is never here: that is human-only, gated by approval. */
const SOURCE_INTERNET = [...DRAFT_GRAPH, "external:fetch:read"];

export function egressTierTokens(tier: EgressTier): string[] {
  switch (tier) {
    case "none":
      return [];
    case "read-graph":
      return [...READ_GRAPH];
    case "draft-graph":
      return [...DRAFT_GRAPH];
    case "source-internet":
      return [...SOURCE_INTERNET];
  }
}

export interface BuiltAgentCapability {
  /** The sanitized, deduped capability token set to persist. */
  scope: string[];
  /** Tokens removed because they are forbidden for agents (reported back to the UI). */
  dropped: string[];
}

/** Build an agent's capability token set from its chosen scope + egress tier, with
 * forbidden tokens stripped. Pure — safe to call at the API seam before persisting. */
export function buildAgentCapability(input: {
  capabilityScope?: string[];
  egressTier: EgressTier;
}): BuiltAgentCapability {
  const requested = [...(input.capabilityScope ?? []), ...egressTierTokens(input.egressTier)];
  const seen = new Set<string>();
  const scope: string[] = [];
  const dropped: string[] = [];
  for (const raw of requested) {
    const token = raw.trim();
    if (!token) continue;
    if (isForbiddenAgentToken(token)) {
      if (!dropped.includes(token)) dropped.push(token);
      continue;
    }
    if (seen.has(token)) continue;
    seen.add(token);
    scope.push(token);
  }
  return { scope, dropped };
}

function tokensFor(action: Action, resourceType: ResourceType): string[] {
  return [`${resourceType}:${action}`, `${resourceType}:*`, `*:${action}`, "*"];
}

/** Does a capability token set permit this (action, resourceType)? */
export function scopePermits(scope: Iterable<string>, action: Action, resourceType: ResourceType): boolean {
  const set = scope instanceof Set ? scope : new Set(scope);
  return tokensFor(action, resourceType).some((t) => set.has(t));
}

export interface AgentScopeView {
  id?: string;
  scope: string[];
  /** The agent's data-tier ceiling. Absent = 'all'. */
  dataScope?: DataScope;
}

export interface RitualStepView {
  skill?: string;
  action: Action;
  resourceType: ResourceType;
  dataScope?: DataScope;
}

export interface RitualScopeViolation {
  stepIndex: number;
  action: Action;
  resourceType: ResourceType;
  reason: "outside-agent-capability" | "exceeds-agent-data-tier";
}

/**
 * Ritual ⊆ agent: every step must be permitted by at least ONE assigned agent — both
 * the (action,resourceType) capability AND the data tier (step tier ∩ agent tier ≠
 * none). Returns the violations (empty = the ritual is within its agents' authority).
 */
export function validateRitualWithinAgents(
  steps: RitualStepView[],
  agents: AgentScopeView[],
): RitualScopeViolation[] {
  const violations: RitualScopeViolation[] = [];
  steps.forEach((step, stepIndex) => {
    const capableAgents = agents.filter((a) => scopePermits(a.scope, step.action, step.resourceType));
    if (capableAgents.length === 0) {
      violations.push({ stepIndex, action: step.action, resourceType: step.resourceType, reason: "outside-agent-capability" });
      return;
    }
    const stepTier = step.dataScope ?? "all";
    const tierOk = capableAgents.some((a) => intersectDataScope(stepTier, a.dataScope ?? "all") !== "none");
    if (!tierOk) {
      violations.push({ stepIndex, action: step.action, resourceType: step.resourceType, reason: "exceeds-agent-data-tier" });
    }
  });
  return violations;
}
