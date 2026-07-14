import type { CapabilityOrigin, CapabilityState, RiskBand } from "../capability/types.js";

export type ApprovalBand = "minor" | "moderate" | "major";

export interface CapabilityHealthRecord {
  manifestId: string;
  state: CapabilityState;
  successRate: number;
  trustExpiresInDays?: number;
  dependencyChanged?: boolean;
  reValidated?: boolean;
}

export interface PendingProposalRecord {
  proposalId: string;
  risk: RiskBand;
  ageHours: number;
}

export interface ViolationPoint {
  at: string;
  violationCount: number;
}

export interface OrgHealthInput {
  capabilities: CapabilityHealthRecord[];
  pendingProposals: PendingProposalRecord[];
  violationSeries: ViolationPoint[];
}

export interface ApprovalLoad {
  total: number;
  byRisk: Record<RiskBand, number>;
  medianTimeToDecisionHours: number;
}

export interface OrgHealthRollup {
  autonomyPressure: { count: number; manifestIds: string[] };
  trustDebt: { count: number; manifestIds: string[] };
  approvalLoad: ApprovalLoad;
  violationTrend: { slope: number; label: "rising" | "flat" | "falling" };
}

const TREND_EPSILON = 1e-9;

export function classifyApprovalBand(input: { risk: RiskBand; origin: CapabilityOrigin; safetyTouch?: boolean }): ApprovalBand {
  if (input.risk === "operational" || input.risk === "external" || input.safetyTouch === true) {
    return "major";
  }

  if ((input.risk === "informational" || input.risk === "advisory") && (input.origin === "built_in" || input.origin === "template")) {
    return "minor";
  }

  return "moderate";
}

export function canGovernanceAutoApprove(band: ApprovalBand): boolean {
  return band === "minor";
}

export function rollupOrgHealth(input: OrgHealthInput): OrgHealthRollup {
  const autonomyPressureManifestIds = input.capabilities
    .filter((capability) => (capability.state === "active" || capability.state === "trusted") && capability.successRate < 0.85)
    .map((capability) => capability.manifestId);

  const trustDebtManifestIds = input.capabilities
    .filter(
      (capability) =>
        (capability.trustExpiresInDays !== undefined && capability.trustExpiresInDays <= 7) ||
        (capability.dependencyChanged === true && capability.reValidated !== true),
    )
    .map((capability) => capability.manifestId);

  const byRisk = emptyRiskCounts();
  for (const proposal of input.pendingProposals) {
    byRisk[proposal.risk] += 1;
  }

  const slope = violationSlope(input.violationSeries);

  return {
    autonomyPressure: {
      count: autonomyPressureManifestIds.length,
      manifestIds: autonomyPressureManifestIds,
    },
    trustDebt: {
      count: trustDebtManifestIds.length,
      manifestIds: trustDebtManifestIds,
    },
    approvalLoad: {
      total: input.pendingProposals.length,
      byRisk,
      medianTimeToDecisionHours: median(input.pendingProposals.map((proposal) => proposal.ageHours)),
    },
    violationTrend: {
      slope,
      label: trendLabel(slope),
    },
  };
}

function emptyRiskCounts(): Record<RiskBand, number> {
  return {
    informational: 0,
    advisory: 0,
    transformational: 0,
    operational: 0,
    external: 0,
  };
}

function median(values: number[]): number {
  if (values.length === 0) {
    return 0;
  }

  const sorted = [...values].sort((a, b) => a - b);
  const midpoint = Math.floor(sorted.length / 2);

  if (sorted.length % 2 === 1) {
    return sorted[midpoint] as number;
  }

  return ((sorted[midpoint - 1] as number) + (sorted[midpoint] as number)) / 2;
}

function violationSlope(series: ViolationPoint[]): number {
  const count = series.length;
  if (count < 2) {
    return 0;
  }

  const meanX = (count - 1) / 2;
  const meanY = series.reduce((sum, point) => sum + point.violationCount, 0) / count;
  let numerator = 0;
  let denominator = 0;

  for (let index = 0; index < count; index += 1) {
    const xDelta = index - meanX;
    numerator += xDelta * (series[index] as ViolationPoint).violationCount - xDelta * meanY;
    denominator += xDelta * xDelta;
  }

  return denominator === 0 ? 0 : numerator / denominator;
}

function trendLabel(slope: number): "rising" | "flat" | "falling" {
  if (slope > TREND_EPSILON) {
    return "rising";
  }

  if (slope < -TREND_EPSILON) {
    return "falling";
  }

  return "flat";
}
