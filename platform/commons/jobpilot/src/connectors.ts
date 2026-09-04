import type { SourceConnector, SourceQuery } from "@bridge/sourcing";
import { createApiClientConnector } from "@bridge/sourcing";

// Tier-1 sourcing connectors named in the architecture doc S3 `providers.ats.*` — public JSON
// endpoints, zero auth. Proof implementations only, built on @bridge/sourcing's shared connector
// shape (same pattern as DealPilot's P0 connectors), never a bespoke scraper. Real HTTP fetching
// is injected so these stay swappable and testable without a live network call.

// All 3 Tier-1 ATS connectors are identical public-JSON, zero-auth, zero-cost, 0.95-confidence
// @bridge/sourcing api-client instantiations differing ONLY in `id` — there was never a real
// per-vendor difference (auth shape, base URL, parsing) to justify 3 copies, so one parameterized
// factory replaces the copy-paste. If a given ATS ever needs bespoke auth/parsing, give it its own
// factory again at that point — don't preemptively re-fork this for a difference that doesn't
// exist yet.
const ATS_CONNECTOR_COST_PER_CALL = 0; // public unauthenticated JSON endpoints — no billed cost
const ATS_CONNECTOR_CONFIDENCE = 0.95; // high, fixed confidence: structured first-party ATS feeds, not scraped/inferred

function createAtsConnector(id: string, fetcher: (query: SourceQuery) => Promise<Array<Record<string, unknown>>>): SourceConnector {
  return createApiClientConnector({ id, fetcher, costPerCall: ATS_CONNECTOR_COST_PER_CALL, confidenceOf: () => ATS_CONNECTOR_CONFIDENCE });
}

export function createGreenhouseConnector(fetcher: (query: SourceQuery) => Promise<Array<Record<string, unknown>>>): SourceConnector {
  return createAtsConnector("greenhouse", fetcher);
}

export function createAshbyConnector(fetcher: (query: SourceQuery) => Promise<Array<Record<string, unknown>>>): SourceConnector {
  return createAtsConnector("ashby", fetcher);
}

export function createLeverConnector(fetcher: (query: SourceQuery) => Promise<Array<Record<string, unknown>>>): SourceConnector {
  return createAtsConnector("lever", fetcher);
}
