import type { BudgetLedger, CaptureEnvelope, SourceConnector, SourceQuery } from "@bridge/sourcing";
import { runWaterfall } from "@bridge/sourcing";
import type { DedupeCandidate, MatchResult } from "@bridge/dedupe";
import { matchOne } from "@bridge/dedupe";
import type { FactStore } from "@bridge/facts";

// The `source.people` capability declared in manifest.ts. Runs the shared waterfall over
// person-shaped connectors, then records every envelope as facts on the target's living
// profile — provenance-tagged, never overwritten in place. This is the ONE seam recon's
// per-source person search, hni's discovery lib, and JobPilot's ATS clients all funnel through
// once migrated (Phase 2 migration itself — moving recon's actual connectors — is a separate,
// larger unit tracked in docs/wiki/known-issues.md, not done in this pass).
export async function sourcePeople(
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

// The `match.people` capability — the locked recon 3-tier governance (strong/moderate/flag),
// generalized via @bridge/dedupe instead of recon's bespoke thresholds.
export function matchPerson(candidate: DedupeCandidate, targets: DedupeCandidate[]): MatchResult {
  return matchOne(candidate, targets, ["company", "title"]);
}
