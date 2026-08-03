/**
 * DealPilot → learning-loop binding (Deal Copilot requirements §3: the generic
 * baseline owns the observation machinery; the Module supplies ONLY a pure
 * attribute mapping). This file is that mapping: a Human's explicit triage
 * decision on a Deal becomes a generic observed-signal shape the kernel's
 * `recordSignal` (@bridge/core learning/observation) accepts.
 *
 * Deliberately structural (no @bridge/core import — this package does not
 * depend on core): the returned shape matches core's `ObservedSignal` exactly;
 * the API layer that owns both packages passes it through unchanged.
 */
import type { DealProfile } from "./types.js";

/** The explicit triage decisions that are learning signals (BRD §8.4: the
 * primary learning signal; platform red flags stay separate feedback). */
export type DealDecisionAction = "pursue" | "review" | "dismiss";

/** Structural twin of @bridge/core's `ObservedSignal`. */
export interface DealDecisionSignal {
  id: string;
  organizationId: string;
  ownerUserId: string;
  moduleId: "dealpilot";
  recordKind: "deal";
  recordId: string;
  action: DealDecisionAction;
  attributes: Record<string, string>;
  reason?: string;
  observedAt?: string;
}

/** Deterministic SDE bucket so pattern detection can group financially similar
 * deals without learning exact figures (generalizable facet, not raw data). */
export function sdeBand(sde: number | null | undefined): string | null {
  if (sde == null || !Number.isFinite(sde) || sde < 0) return null;
  if (sde < 250_000) return "sde_lt_250k";
  if (sde < 500_000) return "sde_250k_500k";
  if (sde < 1_000_000) return "sde_500k_1m";
  return "sde_gte_1m";
}

export interface DealDecisionInput {
  id: string;
  organizationId: string;
  ownerUserId: string;
  dealRecordId: string;
  action: DealDecisionAction;
  profile: DealProfile;
  /** Source the deal arrived from, when known — source quality is a tracked
   * learning dimension (BRD §12 sourcing_quality). */
  sourceId?: string;
  reason?: string;
  observedAt?: string;
}

/** Map one Human triage decision to a generic observed signal. Only
 * generalizable facets become attributes — never free-text notes, names, or
 * anything that would make a pattern personally identifying beyond the
 * owner's own private memory. */
export function dealDecisionSignal(input: DealDecisionInput): DealDecisionSignal {
  const attributes: Record<string, string> = {};
  if (input.profile.industry) attributes["industry"] = input.profile.industry.toLowerCase();
  if (input.profile.geo) attributes["geo"] = input.profile.geo.toLowerCase();
  const band = sdeBand(input.profile.sde);
  if (band) attributes["sde_band"] = band;
  if (input.sourceId) attributes["source"] = input.sourceId;
  return {
    id: input.id,
    organizationId: input.organizationId,
    ownerUserId: input.ownerUserId,
    moduleId: "dealpilot",
    recordKind: "deal",
    recordId: input.dealRecordId,
    action: input.action,
    attributes,
    ...(input.reason ? { reason: input.reason } : {}),
    ...(input.observedAt ? { observedAt: input.observedAt } : {}),
  };
}
