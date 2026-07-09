/**
 * SocialProvider — the single interface behind every platform (X, Instagram,
 * Facebook, LinkedIn). The read path SOURCES items; the write path DRAFTS, and
 * only after the gate approves does it PUBLISH (egress).
 *
 * Private content (post/DM bodies) rides as plain fields the orchestrator persists
 * to the LOCAL plane and never sends outward. Sourced items become People /
 * Touchpoints / Signals — never Leads/Contacts. (Memory has no resource type yet;
 * deferred per decisions.md, so the read contract targets person/touchpoint/signal.)
 */
import type { Action } from "@bridge/core";

export type SocialProviderId = "x" | "instagram" | "facebook" | "linkedin";
export type ProviderMode = "live" | "fixture";

/** An item pulled from a platform, before it enters the graph (quarantined locally). */
export interface SourcedItem {
  /** Stable id from the source platform — the dedup key. */
  sourceId: string;
  kind: "post" | "dm" | "comment" | "connection" | "event";
  /** When it happened (ISO). */
  occurredAt: string;
  /** Private body — stays on the local plane, never crosses the gate. */
  text: string;
  /** The counterparty, used for Person matching. */
  counterparty?: { handle?: string; name?: string };
  /** Raw payload retained locally for audit. */
  raw: unknown;
}

/** Graph resources a sourced item may propose (typed output contract). */
export type ProposedResource = "person" | "touchpoint" | "signal";

export interface OutboundAction {
  kind: "post" | "dm" | "comment";
  text: string;
  /** Recipient handle (for dm/comment). */
  to?: string;
}

export interface DraftedAction extends OutboundAction {
  provider: SocialProviderId;
  draftId: string;
}

export interface PublishResult {
  ok: boolean;
  externalId?: string;
}

export interface SocialProvider {
  readonly id: SocialProviderId;
  readonly mode: ProviderMode;
  /** Platform-declared OAuth scopes this provider connects with. */
  readonly oauthScopes: string[];
  /** Read path: pull recent items to source into the graph (through the gate). */
  sourceItems(opts?: { since?: string; limit?: number }): Promise<SourcedItem[]>;
  /** Write path: compose an outbound action as a DRAFT. Never sends. */
  draftAction(action: OutboundAction): Promise<DraftedAction>;
  /** Egress: execute an APPROVED action. Called only after the gate approves. */
  publish(action: DraftedAction): Promise<PublishResult>;
}

/** Sourcing internet data is `external:fetch`. */
export const SOURCE_RESOURCE = "external:fetch" as const;
/** Publishing is `external:send` — agent-floor DENY, always human-approved. */
export const PUBLISH_RESOURCE = "external:send" as const;
export const PUBLISH_ACTION: Action = "share";
