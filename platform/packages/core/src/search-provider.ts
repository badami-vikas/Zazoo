import type { Plane } from "./types.js";

export const SEARCH_PROVIDER_LIMITS = {
  maxObjectiveChars: 500,
  maxQueries: 3,
  maxQueryChars: 160,
  maxResults: 10,
  minTimeoutMs: 1_000,
  maxTimeoutMs: 15_000,
  maxRequestIdChars: 100,
} as const;

export const SEARCH_PROVIDER_RESULT_LIMITS = {
  maxProviderRequestIdChars: 200,
  maxUrlChars: 2_048,
  maxTitleChars: 500,
  maxExcerptsPerCitation: 3,
  maxExcerptChars: 2_000,
  maxWarnings: 10,
  maxWarningChars: 500,
} as const;

export type SearchProviderTier = 1 | 2 | 3;
export type SearchProviderAccess =
  | "free_direct"
  | "free_credentialed"
  | "paid"
  | "self_hosted";

export interface SearchRequest {
  objective: string;
  searchQueries: readonly string[];
  maxResults: number;
  timeoutMs: number;
  requestId: string;
  requestedAt: string;
}

export interface SearchCitation {
  url: string;
  title: string | null;
  publishedAt: string | null;
  excerpts: readonly string[];
  trustOrigin: "untrusted_external";
}

export interface SearchProviderProvenance {
  providerId: string;
  providerTier: SearchProviderTier;
  providerAccess: SearchProviderAccess;
  providerRequestId: string;
  termsUrl: string;
  privacyUrl?: string;
  searchedAt: string;
}

export interface SearchProviderResult {
  citations: readonly SearchCitation[];
  warnings: readonly string[];
  provenance: SearchProviderProvenance;
  trustOrigin: "untrusted_external";
}

export interface SearchProviderRights {
  status: "verified";
  verifiedAt: string;
  sourceUrl: string;
  allowedDataScope: "public";
  restrictions: readonly string[];
}

export interface SearchProvider {
  id: string;
  tier: SearchProviderTier;
  access: SearchProviderAccess;
  plane: Extract<Plane, "cloud">;
  termsUrl: string;
  privacyUrl?: string;
  rights: SearchProviderRights;
  search(request: SearchRequest): Promise<SearchProviderResult>;
}

export type SearchProviderAttemptStatus =
  | "succeeded"
  | "unavailable"
  | "degraded";

export interface SearchProviderAttempt {
  providerId: string;
  providerTier: SearchProviderTier;
  providerAccess: SearchProviderAccess;
  status: SearchProviderAttemptStatus;
  code?: SearchProviderErrorCode;
  detail: string;
}

export interface SearchProviderOutcome extends SearchProviderResult {
  attempts: readonly SearchProviderAttempt[];
}

export interface SearchProviderRouter {
  providers(): ReadonlyMap<string, SearchProvider>;
  search(request: SearchRequest): Promise<SearchProviderOutcome>;
}

export type SearchProviderErrorCode =
  | "unavailable"
  | "timeout"
  | "rate_limited"
  | "degraded"
  | "invalid_response"
  | "access_blocked";

export class SearchRequestBoundsError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SearchRequestBoundsError";
  }
}

export class SearchProviderError extends Error {
  readonly providerId: string;
  readonly code: SearchProviderErrorCode;
  readonly retryable: boolean;
  readonly status: number | undefined;

  constructor(args: {
    providerId: string;
    code: SearchProviderErrorCode;
    message: string;
    retryable: boolean;
    status?: number;
  }) {
    super(args.message);
    this.name = "SearchProviderError";
    this.providerId = args.providerId;
    this.code = args.code;
    this.retryable = args.retryable;
    this.status = args.status;
  }
}

export class SearchProvidersUnavailableError extends Error {
  readonly attempts: readonly SearchProviderAttempt[];

  constructor(attempts: readonly SearchProviderAttempt[]) {
    super("all eligible SearchProviders were unavailable or degraded");
    this.name = "SearchProvidersUnavailableError";
    this.attempts = attempts;
  }
}

export class SearchProviderPolicyError extends Error {
  readonly providerId: string;

  constructor(providerId: string, message: string) {
    super(message);
    this.name = "SearchProviderPolicyError";
    this.providerId = providerId;
  }
}

export function normalizeSearchRequest(request: SearchRequest): SearchRequest {
  const objective = request.objective.trim();
  if (objective.length === 0 || objective.length > SEARCH_PROVIDER_LIMITS.maxObjectiveChars) {
    throw new SearchRequestBoundsError(
      `search objective must be 1-${SEARCH_PROVIDER_LIMITS.maxObjectiveChars} characters`,
    );
  }

  const searchQueries = [...new Set(request.searchQueries.map((query) => query.trim()))];
  if (
    searchQueries.length === 0 ||
    searchQueries.length > SEARCH_PROVIDER_LIMITS.maxQueries
  ) {
    throw new SearchRequestBoundsError(
      `search request must contain 1-${SEARCH_PROVIDER_LIMITS.maxQueries} distinct queries`,
    );
  }
  for (const query of searchQueries) {
    if (query.length === 0 || query.length > SEARCH_PROVIDER_LIMITS.maxQueryChars) {
      throw new SearchRequestBoundsError(
        `each search query must be 1-${SEARCH_PROVIDER_LIMITS.maxQueryChars} characters`,
      );
    }
  }

  if (
    !Number.isInteger(request.maxResults) ||
    request.maxResults < 1 ||
    request.maxResults > SEARCH_PROVIDER_LIMITS.maxResults
  ) {
    throw new SearchRequestBoundsError(
      `maxResults must be an integer from 1-${SEARCH_PROVIDER_LIMITS.maxResults}`,
    );
  }
  if (
    !Number.isInteger(request.timeoutMs) ||
    request.timeoutMs < SEARCH_PROVIDER_LIMITS.minTimeoutMs ||
    request.timeoutMs > SEARCH_PROVIDER_LIMITS.maxTimeoutMs
  ) {
    throw new SearchRequestBoundsError(
      `timeoutMs must be an integer from ${SEARCH_PROVIDER_LIMITS.minTimeoutMs}-${SEARCH_PROVIDER_LIMITS.maxTimeoutMs}`,
    );
  }

  const requestId = request.requestId.trim();
  if (
    requestId.length === 0 ||
    requestId.length > SEARCH_PROVIDER_LIMITS.maxRequestIdChars
  ) {
    throw new SearchRequestBoundsError(
      `requestId must be 1-${SEARCH_PROVIDER_LIMITS.maxRequestIdChars} characters`,
    );
  }
  if (!Number.isFinite(Date.parse(request.requestedAt))) {
    throw new SearchRequestBoundsError("requestedAt must be a valid timestamp");
  }

  return {
    objective,
    searchQueries,
    maxResults: request.maxResults,
    timeoutMs: request.timeoutMs,
    requestId,
    requestedAt: request.requestedAt,
  };
}
