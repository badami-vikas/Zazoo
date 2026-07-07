// Social integration catalog + governed-scope client for the Integration Permissions panel.
//
// Mirrors the platform `integration` tRPC router (platform/apps/api/src/router.ts) and the
// DrizzleIntegrationStore semantics (packages/db/src/integration-store.ts): view / grant /
// narrow scopes, with external:send + network_graph:full structurally NON-grantable (agent-floor
// DENY — always human-approved at run time).
//
// Two modes, same contract — exactly like data/api.ts:
//   • API_ENABLED (VITE_API_URL set) → the panel talks to the real governed store over tRPC.
//   • default OFF                    → an in-memory governed store, seeded with real (non-fake)
//                                      baseline grants, drives the panel so it is interactive offline.
import { API_ENABLED, apiListScopes, apiGrantScope, apiRevokeScope } from './api';

export type SocialProviderId = 'x' | 'instagram' | 'facebook' | 'linkedin';

/** A Bridge capability a user may grant or narrow for a provider (token grammar: resourceType + action). */
export interface GrantableScope {
  resourceType: string;
  action: string;
  label: string;
  desc: string;
}

export interface SocialProvider {
  id: SocialProviderId;
  label: string;
  /** Platform-declared OAuth scopes granted at connect time — mirror of registry META.oauthScopes. */
  oauthScopes: string[];
  /** Standing-allowable Bridge capabilities the user controls for this integration. */
  grantableScopes: GrantableScope[];
}

/** Active (non-revoked) standing grant — same shape the tRPC `integration.listScopes` returns. */
export interface ScopeGrant {
  id: string;
  resourceType: string;
  action: string;
  effect: string;
  /** ISO string when the grant expires, or null for a standing grant. */
  expiresAt: string | null;
}

/** Agent-floor DENY: never a standing grant, always human-approved at run time. */
export const ALWAYS_APPROVAL_SCOPES = ['external:send', 'network_graph:full'] as const;

/** The two egress scopes the panel surfaces as locked "always requires approval" rows. */
export const APPROVAL_ONLY_SCOPES: GrantableScope[] = [
  {
    resourceType: 'external:send',
    action: 'share',
    label: 'Publish or send on your behalf',
    desc: 'Posting, DMs, comments — outbound always goes through draft-then-approve. Never a standing grant.',
  },
  {
    resourceType: 'network_graph:full',
    action: 'read',
    label: 'Read your full network graph',
    desc: 'Whole-graph reads are agent-floor DENY. A request is approved per run, never standing.',
  },
];

// Base capabilities every social provider can be granted. Read sourcing + the touchpoints/signals
// the governed read pipeline files from activity. Egress is deliberately absent — see above.
const BASE_GRANTABLE: GrantableScope[] = [
  { resourceType: 'external:fetch', action: 'read', label: 'Fetch posts & messages', desc: 'Pull public activity and inbound messages into a local quarantine for review.' },
  { resourceType: 'person', action: 'read', label: 'Read connected people', desc: 'Match handles to people already in your graph (no new identities written).' },
  { resourceType: 'touchpoint', action: 'write', label: 'File touchpoints from activity', desc: 'Stage a Touchpoint per relevant interaction — pending your review.' },
  { resourceType: 'signal', action: 'write', label: 'Raise signals from activity', desc: 'Surface a Signal when activity suggests an action worth taking.' },
];

/** Mirror of platform/apps/api/src/social/registry.ts META.oauthScopes + the grantable grid. */
export const SOCIAL_PROVIDERS: Record<SocialProviderId, SocialProvider> = {
  x: { id: 'x', label: 'X / Twitter', oauthScopes: ['tweet.read', 'tweet.write', 'dm.read'], grantableScopes: BASE_GRANTABLE },
  instagram: { id: 'instagram', label: 'Instagram', oauthScopes: ['instagram_basic', 'instagram_manage_messages'], grantableScopes: BASE_GRANTABLE },
  facebook: { id: 'facebook', label: 'Facebook', oauthScopes: ['pages_messaging', 'pages_read_engagement'], grantableScopes: BASE_GRANTABLE },
  // LinkedIn: no compliant read API — its live path is the consented Tools/recon capture extension.
  linkedin: {
    id: 'linkedin',
    label: 'LinkedIn',
    oauthScopes: ['r_liteprofile'],
    grantableScopes: BASE_GRANTABLE.filter((s) => s.resourceType !== 'signal'),
  },
};

/** Prototype integration ids (IntelligencePage `integrationsData`) → social provider. */
export const INTEGRATION_TO_PROVIDER: Record<string, SocialProviderId> = {
  'INT-3001': 'linkedin',
  'INT-3006': 'x',
  'INT-3007': 'instagram',
  'INT-3008': 'facebook',
};

/** Resolve a prototype integration id (or a raw provider id) to its provider, or null if not social. */
export function socialProviderFor(integrationId: string): SocialProvider | null {
  const pid = INTEGRATION_TO_PROVIDER[integrationId] ?? (integrationId as SocialProviderId);
  return SOCIAL_PROVIDERS[pid] ?? null;
}

/** Raised when a caller tries to grant an agent-floor DENY scope as a standing allow. */
export class FloorScopeError extends Error {
  constructor(public readonly scope: string) {
    super(`"${scope}" is agent-floor DENY — it always requires approval and can never be a standing grant`);
    this.name = 'FloorScopeError';
  }
}

/** True for the FloorScopeError above OR the tRPC FORBIDDEN raised by the live store. */
export function isFloorScopeError(err: unknown): boolean {
  if (err instanceof FloorScopeError) return true;
  const msg = err instanceof Error ? err.message : String(err);
  return /agent-floor DENY/i.test(msg);
}

function isApprovalOnly(resourceType: string): boolean {
  return (ALWAYS_APPROVAL_SCOPES as readonly string[]).includes(resourceType);
}

// ── Offline governed store ────────────────────────────────────────────────────
// Faithful in-memory mirror of DrizzleIntegrationStore: grant / revoke + floor refusal.
// Module-scoped so edits persist across navigations within a session.
const offlineScopes = new Map<SocialProviderId, ScopeGrant[]>();
let offlineSeq = 7001;

function ensureSeed(id: SocialProviderId): ScopeGrant[] {
  if (!offlineScopes.has(id)) {
    offlineScopes.set(id, [
      { id: `perm_${id}_fetch`, resourceType: 'external:fetch', action: 'read', effect: 'allow', expiresAt: null },
      { id: `perm_${id}_touchpoint`, resourceType: 'touchpoint', action: 'write', effect: 'allow', expiresAt: null },
    ]);
  }
  return offlineScopes.get(id)!;
}

/** view / grant / narrow — the panel's only dependency. Live XOR offline, chosen by API_ENABLED. */
export interface ScopesClient {
  list(): Promise<ScopeGrant[]>;
  grant(resourceType: string, action: string): Promise<ScopeGrant>;
  revoke(permissionId: string): Promise<void>;
  /** True when backed by the live governed API; false for the offline mirror. */
  readonly live: boolean;
}

function offlineClient(id: SocialProviderId): ScopesClient {
  return {
    live: false,
    async list() {
      return ensureSeed(id).map((g) => ({ ...g }));
    },
    async grant(resourceType, action) {
      if (isApprovalOnly(resourceType)) throw new FloorScopeError(resourceType);
      const grant: ScopeGrant = { id: `perm_${offlineSeq++}`, resourceType, action, effect: 'allow', expiresAt: null };
      ensureSeed(id).push(grant);
      return { ...grant };
    },
    async revoke(permissionId) {
      const arr = ensureSeed(id);
      const i = arr.findIndex((g) => g.id === permissionId);
      if (i >= 0) arr.splice(i, 1);
    },
  };
}

function liveClient(integrationId: string): ScopesClient {
  return {
    live: true,
    async list() {
      return (await apiListScopes(integrationId)) ?? [];
    },
    async grant(resourceType, action) {
      if (isApprovalOnly(resourceType)) throw new FloorScopeError(resourceType);
      const r = await apiGrantScope({ integrationId, resourceType, action });
      if (!r) throw new Error('grant unavailable');
      return r;
    },
    async revoke(permissionId) {
      await apiRevokeScope(permissionId);
    },
  };
}

export function getScopesClient(provider: SocialProvider, integrationId: string): ScopesClient {
  return API_ENABLED ? liveClient(integrationId) : offlineClient(provider.id);
}
