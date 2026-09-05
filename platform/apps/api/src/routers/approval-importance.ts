import type { ActionRequest, Proposal } from "@bridge/core";

/**
 * How much a waiting approval matters, read from the proposal itself and
 * carried on the brief as data (ADR-247) so Home orders and labels without
 * re-deriving the rule. TASK-097.
 *
 * Tier: an external side effect (`external:*` resource, or `share`) outranks a
 * write, which outranks a read. Inside a tier, untrusted content outranks
 * trusted; inside that, the older proposal outranks the newer one.
 */
export type ApprovalTier = "external" | "write" | "read";

export interface ApprovalImportance {
  tier: ApprovalTier;
  untrusted: boolean;
  /** Lower sorts first: `tier × 2 + (untrusted ? 0 : 1)`. */
  rank: number;
}

const TIER_ORDER: Readonly<Record<ApprovalTier, number>> = { external: 0, write: 1, read: 2 };

export function approvalTier(request: Pick<ActionRequest, "action" | "resourceType">): ApprovalTier {
  if (request.resourceType.startsWith("external:") || request.action === "share") return "external";
  return request.action === "read" ? "read" : "write";
}

export function rankPendingProposal(entry: Pick<Proposal, "request" | "output">): ApprovalImportance {
  const tier = approvalTier(entry.request);
  const trust = entry.output?.taintLabel?.trust ?? entry.request.taintLabel?.trust;
  const untrusted = trust === "untrusted";
  return { tier, untrusted, rank: TIER_ORDER[tier] * 2 + (untrusted ? 0 : 1) };
}

export function compareApprovalImportance(
  a: { importance: ApprovalImportance; createdAt: string },
  b: { importance: ApprovalImportance; createdAt: string },
): number {
  return a.importance.rank - b.importance.rank || a.createdAt.localeCompare(b.createdAt);
}
