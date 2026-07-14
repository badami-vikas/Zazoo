import type { CaptureEnvelope, SourceConnector, SourceQuery } from "../types.js";

// Proof connector #1 — a typed API client, tier "free". Generalizes the "career-ops" pattern
// (a structured HTTP API with a query->results shape) that both people-sourcing (e.g. a company
// directory API) and company-sourcing (e.g. a registry/firmographics API) will instantiate.
// The fetcher is injected so this stays testable and framework-agnostic — no hardcoded vendor.
export interface ApiClientConfig {
  id: string;
  fetcher: (query: SourceQuery) => Promise<Array<Record<string, unknown>>>;
  costPerCall?: number;
  confidenceOf?: (row: Record<string, unknown>) => number;
}

export function createApiClientConnector(config: ApiClientConfig): SourceConnector {
  const costPerCall = config.costPerCall ?? 1;
  const confidenceOf = config.confidenceOf ?? (() => 0.85);

  return {
    id: config.id,
    tier: "free",
    estimateCost: () => costPerCall,
    async fetch(query: SourceQuery): Promise<CaptureEnvelope[]> {
      const rows = await config.fetcher(query);
      return rows.map((payload) => ({
        sourceToolId: config.id,
        tier: "free",
        query,
        payload,
        confidence: confidenceOf(payload),
        costUnits: costPerCall,
        capturedAt: new Date().toISOString(),
        trustOrigin: "untrusted_external", // PI-1: fetched from an external API — untrusted input
      }));
    },
  };
}
