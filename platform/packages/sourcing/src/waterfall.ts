import type { BudgetLedger, CaptureEnvelope, SourceConnector, SourceQuery } from "./types.js";

export interface WaterfallResult {
  envelopes: CaptureEnvelope[];
  triedTiers: string[];
  stoppedReason: "satisfied" | "exhausted" | "budget_exhausted";
}

// Tiered cost waterfall: tries connectors cheapest-tier-first (order is the CALLER's
// responsibility — pass connectors already sorted free -> forms -> email -> browser_agent ->
// human), stopping at the first tier that returns a result at/above the confidence floor.
// Reserve -> execute -> settle around every call so a connector cannot spend budget it never
// reserved, and a failed/short call returns its unused reservation.
export async function runWaterfall(
  query: SourceQuery,
  connectors: SourceConnector[],
  ledger: BudgetLedger,
  confidenceFloor = 0.7,
): Promise<WaterfallResult> {
  const triedTiers: string[] = [];

  for (const connector of connectors) {
    const estimate = connector.estimateCost(query);
    if (!ledger.reserve(estimate)) {
      triedTiers.push(`${connector.id}(skipped:budget)`);
      continue;
    }

    triedTiers.push(connector.id);
    let envelopes: CaptureEnvelope[] = [];
    try {
      envelopes = await connector.fetch(query);
    } finally {
      const actual = envelopes.reduce((sum, e) => sum + e.costUnits, 0) || estimate;
      ledger.settle(estimate, actual);
    }

    const best = Math.max(0, ...envelopes.map((e) => e.confidence));
    if (best >= confidenceFloor) {
      return { envelopes, triedTiers, stoppedReason: "satisfied" };
    }
  }

  return { envelopes: [], triedTiers, stoppedReason: ledger.remaining() <= 0 ? "budget_exhausted" : "exhausted" };
}
