import { createHash } from "node:crypto";
import { isIP } from "node:net";

import {
  SEARCH_PROVIDER_HEALTH,
  SEARCH_PROVIDER_RESULT_LIMITS,
  SearchProviderError,
  SearchProviderPolicyError,
  SearchProvidersUnavailableError,
  normalizeSearchRequest,
  type SearchProvider,
  type SearchProviderAttempt,
  type SearchProviderHealth,
  type SearchProviderOutcome,
  type SearchProviderResult,
  type SearchProviderRouter,
  type SearchRequest,
} from "@bridge/core";
import { isBlockedHostname, isBlockedIp } from "@bridge/net-guard";

const DEFAULT_RIGHTS_MAX_AGE_MS = 90 * 24 * 60 * 60 * 1_000;
const SHA256_PATTERN = /^sha256:[a-f0-9]{64}$/;
const HEALTH_RANK: Readonly<Record<SearchProviderHealth, number>> = {
  healthy: 0,
  unknown: 1,
  degraded: 2,
  unavailable: 3,
};

export interface FreeDirectSearchProviderRouterOptions {
  now?: () => number;
  rightsMaxAgeMs?: number;
}

function routingHealth(provider: SearchProvider): SearchProviderHealth {
  const health = provider.health();
  if (!SEARCH_PROVIDER_HEALTH.includes(health)) {
    throw new SearchProviderPolicyError(
      provider.id,
      "SearchProvider returned an invalid health state",
    );
  }
  return health;
}

function isSafePublicUrl(value: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return false;
  }
  if (
    (parsed.protocol !== "https:" && parsed.protocol !== "http:") ||
    parsed.username.length > 0 ||
    parsed.password.length > 0 ||
    isBlockedHostname(parsed.hostname)
  ) {
    return false;
  }
  return isIP(parsed.hostname) === 0 || !isBlockedIp(parsed.hostname);
}

function assertVerifiedProvider(
  provider: SearchProvider,
  now: number,
  maxAgeMs: number,
): void {
  if (
    !/^[a-z0-9][a-z0-9-]{0,99}$/.test(provider.id) ||
    provider.tier !== 1 ||
    provider.access !== "free_direct" ||
    provider.plane !== "cloud"
  ) {
    throw new SearchProviderPolicyError(
      provider.id,
      "Phase 1 search permits only rights-verified Tier-1 free-direct providers",
    );
  }
  routingHealth(provider);
  const verifiedAt = Date.parse(provider.rights.verifiedAt);
  if (
    provider.rights.status !== "verified" ||
    provider.rights.allowedDataScope !== "public" ||
    !Number.isFinite(verifiedAt) ||
    verifiedAt > now ||
    now - verifiedAt > maxAgeMs
  ) {
    throw new SearchProviderPolicyError(
      provider.id,
      "provider rights verification is absent, invalid, or stale",
    );
  }
  for (const value of [
    provider.termsUrl,
    provider.privacyUrl,
    provider.rights.sourceUrl,
  ]) {
    if (
      value !== undefined &&
      (!isSafePublicUrl(value) || new URL(value).protocol !== "https:")
    ) {
      throw new SearchProviderPolicyError(
        provider.id,
        "provider rights metadata must use a public HTTPS URL",
      );
    }
  }
}

function citationHash(citation: SearchProviderResult["citations"][number]): string {
  return `sha256:${createHash("sha256")
    .update(
      JSON.stringify({
        url: citation.url,
        title: citation.title,
        excerpts: citation.excerpts,
      }),
    )
    .digest("hex")}`;
}

function sameRights(
  provider: SearchProvider,
  result: SearchProviderResult,
): boolean {
  const rights = result.provenance.rights;
  return (
    rights.status === provider.rights.status &&
    rights.verifiedAt === provider.rights.verifiedAt &&
    rights.sourceUrl === provider.rights.sourceUrl &&
    rights.allowedDataScope === provider.rights.allowedDataScope &&
    JSON.stringify(rights.restrictions) ===
      JSON.stringify(provider.rights.restrictions)
  );
}

function assertProviderResult(
  provider: SearchProvider,
  request: SearchRequest,
  result: SearchProviderResult,
): void {
  if (
    result.trustOrigin !== "untrusted_external" ||
    result.provenance.providerId !== provider.id ||
    result.provenance.providerTier !== provider.tier ||
    result.provenance.providerAccess !== provider.access ||
    result.provenance.termsUrl !== provider.termsUrl ||
    result.provenance.privacyUrl !== provider.privacyUrl ||
    result.provenance.providerRequestId.length === 0 ||
    result.provenance.providerRequestId.length >
      SEARCH_PROVIDER_RESULT_LIMITS.maxProviderRequestIdChars ||
    !/^[\x21-\x7e]+$/.test(result.provenance.providerRequestId) ||
    result.provenance.searchedAt !== request.requestedAt ||
    !Number.isInteger(result.provenance.responseBytes) ||
    result.provenance.responseBytes < 0 ||
    result.provenance.responseBytes > request.maxResponseBytes ||
    !SHA256_PATTERN.test(result.provenance.contentHash) ||
    !sameRights(provider, result) ||
    result.citations.length > request.maxResults
  ) {
    throw new SearchProviderError({
      providerId: provider.id,
      code: "invalid_response",
      message: "search provider returned invalid provenance or result bounds",
      retryable: false,
    });
  }
  if (
    result.warnings.length > SEARCH_PROVIDER_RESULT_LIMITS.maxWarnings ||
    result.warnings.some(
      (warning) =>
        typeof warning !== "string" ||
        warning.length > SEARCH_PROVIDER_RESULT_LIMITS.maxWarningChars,
    ) ||
    result.citations.some((citation) => {
      return (
        citation.trustOrigin !== "untrusted_external" ||
        citation.providerId !== provider.id ||
        citation.url.length > SEARCH_PROVIDER_RESULT_LIMITS.maxUrlChars ||
        !isSafePublicUrl(citation.url) ||
        !Number.isFinite(Date.parse(citation.retrievedAt)) ||
        !SHA256_PATTERN.test(citation.contentHash) ||
        citation.contentHash !== citationHash(citation) ||
        (citation.title !== null &&
          citation.title.length > SEARCH_PROVIDER_RESULT_LIMITS.maxTitleChars) ||
        (citation.publishedAt !== null &&
          !Number.isFinite(Date.parse(citation.publishedAt))) ||
        citation.excerpts.length >
          SEARCH_PROVIDER_RESULT_LIMITS.maxExcerptsPerCitation ||
        citation.excerpts.some(
          (excerpt) =>
            typeof excerpt !== "string" ||
            excerpt.length > SEARCH_PROVIDER_RESULT_LIMITS.maxExcerptChars,
        )
      );
    })
  ) {
    throw new SearchProviderError({
      providerId: provider.id,
      code: "invalid_response",
      message: "search provider returned invalid citation provenance",
      retryable: false,
    });
  }
}

function failedAttempt(
  provider: SearchProvider,
  health: SearchProviderHealth,
  error: unknown,
): SearchProviderAttempt {
  if (error instanceof SearchProviderError) {
    return {
      providerId: provider.id,
      providerTier: provider.tier,
      providerAccess: provider.access,
      providerHealth: health,
      status:
        error.code === "degraded" || error.code === "invalid_response"
          ? "degraded"
          : "unavailable",
      code: error.code,
      detail: `provider ${provider.id} failed with ${error.code}`,
    };
  }
  return {
    providerId: provider.id,
    providerTier: provider.tier,
    providerAccess: provider.access,
    providerHealth: health,
    status: "degraded",
    code: "invalid_response",
    detail: `provider ${provider.id} failed with an unclassified adapter error`,
  };
}

export class FreeDirectSearchProviderRouter implements SearchProviderRouter {
  readonly #providers: ReadonlyMap<string, SearchProvider>;
  readonly #now: () => number;
  readonly #rightsMaxAgeMs: number;

  constructor(
    providers: readonly SearchProvider[],
    options: FreeDirectSearchProviderRouterOptions = {},
  ) {
    this.#now = options.now ?? Date.now;
    this.#rightsMaxAgeMs =
      options.rightsMaxAgeMs ?? DEFAULT_RIGHTS_MAX_AGE_MS;
    if (
      !Number.isInteger(this.#rightsMaxAgeMs) ||
      this.#rightsMaxAgeMs <= 0
    ) {
      throw new SearchProviderPolicyError(
        "none",
        "provider rights verification window must be a positive integer",
      );
    }
    const now = this.#now();
    const byId = new Map<string, SearchProvider>();
    for (const provider of providers) {
      if (byId.has(provider.id)) {
        throw new SearchProviderPolicyError(
          provider.id,
          "duplicate SearchProvider id",
        );
      }
      assertVerifiedProvider(provider, now, this.#rightsMaxAgeMs);
      byId.set(provider.id, provider);
    }
    if (byId.size === 0) {
      throw new SearchProviderPolicyError(
        "none",
        "at least one eligible SearchProvider is required",
      );
    }
    this.#providers = byId;
  }

  providers(): ReadonlyMap<string, SearchProvider> {
    return this.#providers;
  }

  async search(request: SearchRequest): Promise<SearchProviderOutcome> {
    const bounded = normalizeSearchRequest(request);
    const attempts: SearchProviderAttempt[] = [];
    const candidates = [...this.#providers.values()]
      .map((provider) => ({
        provider,
        health: routingHealth(provider),
      }))
      .sort(
        (a, b) =>
          HEALTH_RANK[a.health] - HEALTH_RANK[b.health] ||
          a.provider.id.localeCompare(b.provider.id),
      )
      .slice(0, bounded.maxProviderAttempts);

    for (const { provider, health } of candidates) {
      if (bounded.signal?.aborted) {
        throw new SearchProviderError({
          providerId: provider.id,
          code: "cancelled",
          message: "search request was cancelled",
          retryable: false,
        });
      }
      assertVerifiedProvider(
        provider,
        this.#now(),
        this.#rightsMaxAgeMs,
      );
      if (health === "unavailable") {
        attempts.push({
          providerId: provider.id,
          providerTier: provider.tier,
          providerAccess: provider.access,
          providerHealth: health,
          status: "unavailable",
          code: "unavailable",
          detail: `provider ${provider.id} is unavailable`,
        });
        continue;
      }
      try {
        const result = await provider.search(bounded);
        assertProviderResult(provider, bounded, result);
        attempts.push({
          providerId: provider.id,
          providerTier: provider.tier,
          providerAccess: provider.access,
          providerHealth: health,
          status: "succeeded",
          detail: `provider ${provider.id} completed the bounded search`,
        });
        return { ...result, attempts };
      } catch (error) {
        if (
          error instanceof SearchProviderError &&
          error.code === "cancelled"
        ) {
          throw error;
        }
        attempts.push(failedAttempt(provider, health, error));
      }
    }
    throw new SearchProvidersUnavailableError(attempts);
  }
}
