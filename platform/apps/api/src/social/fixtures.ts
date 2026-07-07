/**
 * Unconfigured-provider seam. When a platform's OAuth app keys are absent (or no
 * live client has been registered for it), the registry falls back to one of
 * these so the read/write pipeline still runs end to end without live API
 * access — but it never fabricates data. sourceItems() returns an honest empty
 * result and publish() honestly reports failure (nothing can actually reach the
 * platform without a live client wired). Real-data-only policy, 2026-07-06 —
 * see CLAUDE.md: no seeded/demo content ships in a runtime fallback path.
 */
import type {
  DraftedAction,
  OutboundAction,
  PublishResult,
  SocialProvider,
  SocialProviderId,
} from "./provider.js";

/** A provider with no live backend wired: sources nothing (honest empty state),
 * drafts locally, and never actually publishes (no live client to send through). */
export function makeFixtureProvider(id: SocialProviderId, oauthScopes: string[]): SocialProvider {
  const published: DraftedAction[] = [];
  // Own counter, independent of `published.length` — previously draftId was derived
  // from published.length + 1, but only publish() ever mutates that array, so two
  // drafts created before any publish shared the same draftId.
  let draftCount = 0;
  return {
    id,
    mode: "fixture",
    oauthScopes,
    async sourceItems() {
      // No live provider is configured for this platform — there is nothing real
      // to source. Return an honest empty result rather than inventing posts/DMs.
      return [];
    },
    async draftAction(action: OutboundAction): Promise<DraftedAction> {
      draftCount += 1;
      return { ...action, provider: id, draftId: `unconfigured_${id}_draft_${draftCount}` };
    },
    async publish(action: DraftedAction): Promise<PublishResult> {
      // Recorded locally for audit, but never actually sent — no live client is
      // wired for this platform, so report failure honestly instead of a fake ok.
      published.push(action);
      return { ok: false };
    },
  };
}
