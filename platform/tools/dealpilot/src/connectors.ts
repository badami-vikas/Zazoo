import type { SourceConnector, SourceQuery } from "@bridge/sourcing";
import { createApiClientConnector, createEmailAlertConnector } from "@bridge/sourcing";

// The two P0 connectors named in the plan (BizBuySell email-alerts, BusinessBroker.net) — proof
// implementations only, built on @bridge/sourcing's shared connector shapes, never a bespoke
// scraper. Real HTTP/parsing logic is injected so these stay swappable and testable without a
// live network call, same pattern as packages/sourcing's own proof connectors.

export function createBizBuySellAlertConnector(
  fetchMessages: (query: SourceQuery) => Promise<Array<{ subject: string; body: string }>>,
  parse: (message: { subject: string; body: string }) => Record<string, unknown> | null,
): SourceConnector {
  return createEmailAlertConnector({ id: "bizbuysell-alerts", fetchMessages, parse, costPerMessage: 0.5 });
}

export function createBusinessBrokerNetConnector(
  fetcher: (query: SourceQuery) => Promise<Array<Record<string, unknown>>>,
): SourceConnector {
  return createApiClientConnector({ id: "businessbroker-net", fetcher, costPerCall: 1, confidenceOf: () => 0.8 });
}
