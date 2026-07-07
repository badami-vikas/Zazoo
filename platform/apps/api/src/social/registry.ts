/**
 * Provider registry — resolves a platform id to a live or fixture provider based
 * on whether its OAuth app credentials are present in the environment.
 *
 * Live REST clients are registered out-of-band (registerLiveProvider) so this
 * module stays dependency-free and the fixture seam is the default. LinkedIn has
 * no compliant read API; its live path is the consented Tools/recon extension,
 * registered the same way. Absent a registered live client + creds, every
 * provider resolves to its fixture so the pipeline always runs.
 */
import { makeFixtureProvider } from "./fixtures.js";
import type { SocialProvider, SocialProviderId } from "./provider.js";

interface ProviderMeta {
  /** Platform-declared OAuth scopes. */
  oauthScopes: string[];
  /** Env var names whose presence flips the provider to live. */
  credEnv: string[];
}

const META: Record<SocialProviderId, ProviderMeta> = {
  x: { oauthScopes: ["tweet.read", "tweet.write", "dm.read"], credEnv: ["X_CLIENT_ID", "X_CLIENT_SECRET"] },
  instagram: {
    oauthScopes: ["instagram_basic", "instagram_manage_messages"],
    credEnv: ["META_APP_ID", "META_APP_SECRET"],
  },
  facebook: {
    oauthScopes: ["pages_messaging", "pages_read_engagement"],
    credEnv: ["META_APP_ID", "META_APP_SECRET"],
  },
  // LinkedIn: no read API — live path is the consented recon extension bridge.
  linkedin: { oauthScopes: ["r_liteprofile"], credEnv: ["LINKEDIN_RECON_BRIDGE"] },
};

type LiveFactory = (env: Record<string, string | undefined>) => SocialProvider;
const liveFactories = new Map<SocialProviderId, LiveFactory>();

/** Register a live REST/capture client for a platform (wired when creds exist). */
export function registerLiveProvider(id: SocialProviderId, factory: LiveFactory): void {
  liveFactories.set(id, factory);
}

export function listProviderIds(): SocialProviderId[] {
  return Object.keys(META) as SocialProviderId[];
}

export function oauthScopesFor(id: SocialProviderId): string[] {
  return META[id].oauthScopes;
}

function hasCreds(meta: ProviderMeta, env: Record<string, string | undefined>): boolean {
  return meta.credEnv.length > 0 && meta.credEnv.every((k) => Boolean(env[k]));
}

/**
 * Resolve a provider: a registered live client when creds are present, else the fixture seam.
 * No fastify/logger instance is reachable from this pure module, so `console.warn` is the
 * loud-fallback primitive here (matches the ambient-logger-if-available, console.warn/error-if-not
 * convention established in wiring.ts/server.ts, e.g. `corsOriginConfig`'s warnings).
 */
export function resolveProvider(
  id: SocialProviderId,
  env: Record<string, string | undefined> = process.env,
): SocialProvider {
  const meta = META[id];
  const live = liveFactories.get(id);
  if (live && hasCreds(meta, env)) return live(env);
  if (!live) {
    console.warn(
      `[social/registry] "${id}": no live provider registered — sourcing nothing (no fake data served). ` +
        "Live integration for this platform has not been wired yet.",
    );
  } else {
    const missing = meta.credEnv.filter((k) => !env[k]);
    console.warn(
      `[social/registry] "${id}": live provider registered but missing credentials (${missing.join(", ")}) — ` +
        "sourcing nothing instead of fabricating data.",
    );
  }
  return makeFixtureProvider(id, meta.oauthScopes);
}
