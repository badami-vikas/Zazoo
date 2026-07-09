import type { BudgetLedger, CaptureEnvelope, SourceConnector, SourceQuery } from "@bridge/sourcing";
import { runWaterfall } from "@bridge/sourcing";
import type { DedupeCandidate, MatchResult } from "@bridge/dedupe";
import { matchOne } from "@bridge/dedupe";
import type { FactStore } from "@bridge/facts";

// The `source.company` capability — same waterfall+facts pattern as people-sourcing, over
// company-shaped connectors (registry/firmographics APIs, listing-alert emails). The eventual
// home for recon's company paths, ETA investor extraction, and DealPilot's S1-S2 connectors
// (migration itself is Phase 2's remaining, larger unit — not done in this pass).
export async function sourceCompany(
  query: SourceQuery,
  connectors: SourceConnector[],
  ledger: BudgetLedger,
  facts: FactStore,
  entityId: string,
): Promise<CaptureEnvelope[]> {
  const result = await runWaterfall(query, connectors, ledger);
  for (const envelope of result.envelopes) {
    for (const [field, value] of Object.entries(envelope.payload)) {
      facts.append({ entityId, field, value, provenance: "public_record", confidence: envelope.confidence });
    }
  }
  return result.envelopes;
}

// The `match.company` capability. Domain is the company-shaped business key — the same role
// email plays for people — so an exact domain match is treated as `keyId` and short-circuits to
// "strong" regardless of name spelling ("Acme Inc" vs "Acme Corp" is still one company if the
// domain agrees). Below that, industry is a softer corroborating field for name-similarity tiers.
export function matchCompany(candidate: DedupeCandidate, targets: DedupeCandidate[]): MatchResult {
  const withDomainAsKey = (c: DedupeCandidate): DedupeCandidate => (c.domain ? { ...c, keyId: c.keyId ?? String(c.domain) } : c);
  return matchOne(withDomainAsKey(candidate), targets.map(withDomainAsKey), ["industry"]);
}
