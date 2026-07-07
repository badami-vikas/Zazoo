/**
 * Unconfigured-platform seam. When a platform's OAuth app keys are absent, the
 * registry falls back to one of these so the read/write pipeline still has a
 * provider to call — but with NO live credentials there is no real data to source,
 * so the honest behavior is an empty read, not fabricated posts/DMs. Draft/publish
 * still work structurally (composing + recording locally) since those don't
 * require sourced data, only local id bookkeeping.
 */
import type {
  DraftedAction,
  OutboundAction,
  PublishResult,
  SocialProvider,
  SocialProviderId,
  SourcedItem,
} from "./provider.js";

/** A provider with no live credentials sources nothing — an honest empty result,
 * never fabricated posts/DMs standing in for real platform content. */
export function makeFixtureProvider(id: SocialProviderId, oauthScopes: string[]): SocialProvider {
  const published: DraftedAction[] = [];
  // Own counter, independent of `published.length` — previously draftId was derived from
  // published.length + 1, but only publish() ever mutates that array, so two drafts created
  // before any publish shared the same draftId (unconfigured_<id>_draft_1 twice).
  let draftCount = 0;
  return {
    id,
    mode: "fixture",
    oauthScopes,
    async sourceItems(): Promise<SourcedItem[]> {
      return [];
    },
    async draftAction(action: OutboundAction): Promise<DraftedAction> {
      draftCount += 1;
      return { ...action, provider: id, draftId: `unconfigured_${id}_draft_${draftCount}` };
    },
    async publish(action: DraftedAction): Promise<PublishResult> {
      published.push(action);
      return { ok: true, externalId: `unconfigured_${id}_published_${published.length}` };
    },
  };
}
