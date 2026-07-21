import {
  SEARCH_PROVIDER_RESULT_LIMITS,
  SearchProviderError,
  SearchProviderPolicyError,
  SearchProvidersUnavailableError,
  normalizeSearchRequest,
  type SearchProvider,
  type SearchProviderAttempt,
  type SearchProviderOutcome,
  type SearchProviderResult,
  type SearchProviderRouter,
  type SearchRequest,
} from "@bridge/core";
import { isSafePublicCitationUrl } from "./safe-http-client.js";

const DEFAULT_RIGHTS_MAX_AGE_MS = 90 * 24 * 60 * 60 * 1_000;

export interface FreeDirectSearchProviderRouterOptions {
  now?: () => number;
  rightsMaxAgeMs?: number;
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
      (!isSafePublicCitationUrl(value) ||
        new URL(value).protocol !== "https:")
    ) {
      throw new SearchProviderPolicyError(
        provider.id,
        "provider rights metadata must use a public HTTP(S) URL",
      );
    }
  }
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
    !Number.isFinite(Date.parse(result.provenance.searchedAt)) ||
    result.warnings.length > SEARCH_PROVIDER_RESULT_LIMITS.maxWarnings ||
    result.warnings.some(
      (warning) =>
        typeof warning !== "string" ||
        warning.length > SEARCH_PROVIDER_RESULT_LIMITS.maxWarningChars,
    ) ||
    result.citations.some((citation) => {
      return (
        citation.trustOrigin !== "untrusted_external" ||
        citation.url.length > SEARCH_PROVIDER_RESULT_LIMITS.maxUrlChars ||
        !isSafePublicCitationUrl(citation.url) ||
        (citation.title !== null &&
          citation.title.length >
            SEARCH_PROVIDER_RESULT_LIMITS.maxTitleChars) ||
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
  error: unknown,
): SearchProviderAttempt {
  if (error instanceof SearchProviderError) {
    return {
      providerId: provider.id,
      providerTier: provider.tier,
      providerAccess: provider.access,
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
    for (const provider of this.#providers.values()) {
      assertVerifiedProvider(
        provider,
        this.#now(),
        this.#rightsMaxAgeMs,
      );
      try {
        const result = await provider.search(bounded);
        assertProviderResult(provider, bounded, result);
        attempts.push({
          providerId: provider.id,
          providerTier: provider.tier,
          providerAccess: provider.access,
          status: "succeeded",
          detail: `provider ${provider.id} completed the bounded search`,
        });
        return { ...result, attempts };
      } catch (error) {
        attempts.push(failedAttempt(provider, error));
      }
    }
    throw new SearchProvidersUnavailableError(attempts);
  }
}
