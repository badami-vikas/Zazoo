import type { CaptureEnvelope, SourceConnector, SourceQuery } from "../types.js";

// Proof connector #2 — an email-alert parser, tier "email". Generalizes DealPilot's
// BizBuySell-alert-email pattern: a saved-search service pushes matches into the user's Gmail
// (via the ONE governed google integration, never a tool-owned inbox), and this connector parses
// already-fetched message bodies into CaptureEnvelopes. It does not call Gmail itself — messages
// are handed in, keeping this connector free of any integration/OAuth concern per the plan's
// "no tool-owned OAuth" rule.
export interface EmailAlertConfig {
  id: string;
  fetchMessages: (query: SourceQuery) => Promise<Array<{ subject: string; body: string }>>;
  parse: (message: { subject: string; body: string }) => Record<string, unknown> | null;
  costPerMessage?: number;
}

export function createEmailAlertConnector(config: EmailAlertConfig): SourceConnector {
  const costPerMessage = config.costPerMessage ?? 0.5;

  return {
    id: config.id,
    tier: "email",
    estimateCost: () => costPerMessage,
    async fetch(query: SourceQuery): Promise<CaptureEnvelope[]> {
      const messages = await config.fetchMessages(query);
      const envelopes: CaptureEnvelope[] = [];
      for (const message of messages) {
        const payload = config.parse(message);
        if (!payload) continue; // unparseable messages are silently skipped, not fabricated
        envelopes.push({
          sourceToolId: config.id,
          tier: "email",
          query,
          payload,
          confidence: 0.6, // email-alert bodies are looser-structured than an API; lower floor by design
          costUnits: costPerMessage,
          capturedAt: new Date().toISOString(),
        });
      }
      return envelopes;
    },
  };
}
