import type { BudgetLedger, CaptureEnvelope, SourceConnector, SourceQuery } from "@bridge/sourcing";
import { runWaterfall } from "@bridge/sourcing";
import type { FactStore } from "@bridge/facts";
import type { DedupeCandidate } from "@bridge/dedupe";
import { matchCompany } from "@bridge/company-sourcing";
import type { ThesisProfile, DealProfile, ThesisFitResult } from "./types.js";
import { scoreThesisFit } from "./scoring.js";

// S1-S2 (sourcing) -> S3 (dedupe) -> S8 (living profile) -> S4 (ThesisFit triage), composed from
// shared packages per docs/raw/tool-standardization-plan.md section 7 — DealPilot supplies its
// OWN connectors (the P0 BizBuySell/BusinessBroker.net-shaped ones) but delegates matching to
// company-sourcing's `matchCompany` (compose, don't copy) rather than re-implementing dedupe.
export interface DealPipelineResult {
  envelopes: CaptureEnvelope[];
  dedupedAgainst: string | null; // existing deal id if this merged, else null (new deal)
  fit: ThesisFitResult;
}

export async function processDealCandidate(
  query: SourceQuery,
  connectors: SourceConnector[],
  ledger: BudgetLedger,
  facts: FactStore,
  candidateId: string,
  existingDeals: DedupeCandidate[],
  thesis: ThesisProfile,
): Promise<DealPipelineResult> {
  const result = await runWaterfall(query, connectors, ledger);

  for (const envelope of result.envelopes) {
    for (const [field, value] of Object.entries(envelope.payload)) {
      facts.append({ entityId: candidateId, field, value, provenance: "listing", confidence: envelope.confidence });
    }
  }

  const profile = facts.livingProfile(candidateId);
  const candidateForMatch: DedupeCandidate = {
    id: candidateId,
    name: String(profile.name?.value ?? candidateId),
    domain: profile.domain?.value as string | undefined,
    industry: profile.industry?.value as string | undefined,
  };
  const match = matchCompany(candidateForMatch, existingDeals);
  const dedupedAgainst = match.tier === "strong" ? match.targetId : null;

  // Built additively (not as an object literal with possibly-undefined values) because
  // exactOptionalPropertyTypes forbids assigning `undefined` to an optional field explicitly —
  // omitting the key entirely is the correct way to express "no fact recorded for this field".
  const dealProfile: DealProfile = {};
  if (profile.industry) dealProfile.industry = profile.industry.value as string;
  if (profile.geo) dealProfile.geo = profile.geo.value as string;
  if (profile.sde) dealProfile.sde = profile.sde.value as number;
  if (profile.revenue) dealProfile.revenue = profile.revenue.value as number;
  const fit = scoreThesisFit(dealProfile, thesis);

  return { envelopes: result.envelopes, dedupedAgainst, fit };
}
