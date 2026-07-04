import type { SourceConnector, SourceQuery } from "@bridge/sourcing";
import { createApiClientConnector } from "@bridge/sourcing";

// Tier-1 sourcing connectors named in the architecture doc S3 `providers.ats.*` — public JSON
// endpoints, zero auth. Proof implementations only, built on @bridge/sourcing's shared connector
// shape (same pattern as DealPilot's P0 connectors), never a bespoke scraper. Real HTTP fetching
// is injected so these stay swappable and testable without a live network call.

export function createGreenhouseConnector(fetcher: (query: SourceQuery) => Promise<Array<Record<string, unknown>>>): SourceConnector {
  return createApiClientConnector({ id: "greenhouse", fetcher, costPerCall: 0, confidenceOf: () => 0.95 });
}

export function createAshbyConnector(fetcher: (query: SourceQuery) => Promise<Array<Record<string, unknown>>>): SourceConnector {
  return createApiClientConnector({ id: "ashby", fetcher, costPerCall: 0, confidenceOf: () => 0.95 });
}

export function createLeverConnector(fetcher: (query: SourceQuery) => Promise<Array<Record<string, unknown>>>): SourceConnector {
  return createApiClientConnector({ id: "lever", fetcher, costPerCall: 0, confidenceOf: () => 0.95 });
}
