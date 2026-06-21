/**
 * dummy_ fixture providers — the credential seam. When a platform's OAuth app keys
 * are absent, the registry falls back to one of these so the whole read/write
 * pipeline is exercisable end to end without live API access. Every value is
 * dummy_-prefixed so it can never be mistaken for real sourced data.
 */
import type {
  DraftedAction,
  OutboundAction,
  PublishResult,
  SocialProvider,
  SocialProviderId,
  SourcedItem,
} from "./provider.js";

function fixtureItems(id: SocialProviderId): SourcedItem[] {
  return [
    {
      sourceId: `dummy_${id}_item_1`,
      kind: "post",
      occurredAt: "2026-06-01T12:00:00Z",
      text: `dummy_${id} post mentioning a known contact`,
      counterparty: { handle: `dummy_${id}_handle1`, name: "dummy_Jordan Rivera" },
      raw: { dummy_: true },
    },
    {
      sourceId: `dummy_${id}_item_2`,
      kind: "dm",
      occurredAt: "2026-06-02T09:30:00Z",
      text: `dummy_${id} direct message body (private, local-only)`,
      counterparty: { handle: `dummy_${id}_handle2` },
      raw: { dummy_: true },
    },
  ];
}

/** A provider that sources dummy_ items and records (never network-sends) publishes. */
export function makeFixtureProvider(id: SocialProviderId, oauthScopes: string[]): SocialProvider {
  const published: DraftedAction[] = [];
  return {
    id,
    mode: "fixture",
    oauthScopes,
    async sourceItems() {
      return fixtureItems(id);
    },
    async draftAction(action: OutboundAction): Promise<DraftedAction> {
      return { ...action, provider: id, draftId: `dummy_${id}_draft_${published.length + 1}` };
    },
    async publish(action: DraftedAction): Promise<PublishResult> {
      published.push(action);
      return { ok: true, externalId: `dummy_${id}_published_${published.length}` };
    },
  };
}
