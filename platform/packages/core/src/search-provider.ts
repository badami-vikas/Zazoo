import type { Plane } from "./types.js";
import type { TaintLabel } from "./taint.js";

export const SEARCH_PROVIDER_LIMITS = {
  maxObjectiveChars: 500,
  maxQueries: 3,
  maxQueryChars: 160,
  maxResults: 10,
  minResponseBytes: 1_024,
  maxResponseBytes: 512 * 1_024,
  maxProviderAttempts: 3,
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
export const SEARCH_PROVIDER_HEALTH = [
  "healthy",
  "unknown",
  "degraded",
  "unavailable",
] as const;
export type SearchProviderHealth = (typeof SEARCH_PROVIDER_HEALTH)[number];
export type SearchProviderAccess =
  | "free_direct"
  | "free_credentialed"
  | "paid"
  | "self_hosted";

export interface SearchRequest {
  objective: string;
  searchQueries: readonly string[];
  maxResults: number;
  maxResponseBytes: number;
  maxProviderAttempts: number;
  timeoutMs: number;
  requestId: string;
  requestedAt: string;
  signal?: AbortSignal;
  taintLabel: TaintLabel;
}

export interface SearchCitation {
  url: string;
  title: string | null;
  publishedAt: string | null;
  excerpts: readonly string[];
  providerId: string;
  retrievedAt: string;
  contentHash: string;
  trustOrigin: "untrusted_external";
  taintLabel?: TaintLabel;
}

export interface SearchProviderProvenance {
  providerId: string;
  providerTier: SearchProviderTier;
  providerAccess: SearchProviderAccess;
  providerRequestId: string;
  termsUrl: string;
  privacyUrl?: string;
  searchedAt: string;
  responseBytes: number;
  contentHash: string;
  rights: SearchProviderRights;
}

export interface SearchProviderResult {
  citations: readonly SearchCitation[];
  warnings: readonly string[];
  provenance: SearchProviderProvenance;
  trustOrigin: "untrusted_external";
  taintLabel?: TaintLabel;
}

export interface SearchProviderRights {
  status: "verified";
  verifiedAt: string;
  sourceUrl: string;
  allowedDataScope: "public";
  restrictions: readonly string[];
}

/**
 * Which provider tiers and access modes a router may admit. The rights,
 * freshness, HTTPS-metadata, and plane checks are NOT part of this policy —
 * they are unconditional and apply to every admitted provider regardless of
 * tier. This governs only the commercial-access question the LA3 provider
 * survey left open: whether a deployment has cleared credentialed access in
 * addition to anonymous direct access.
 */
export interface SearchProviderAdmissionPolicy {
  readonly id: string;
  readonly allowedTiers: readonly SearchProviderTier[];
  readonly allowedAccess: readonly SearchProviderAccess[];
}

/**
 * Phase 1 (ADR-111/141, TASK-023): anonymous rights-verified direct access
 * only. No credential is ever presented, so there is no account to attribute,
 * bill, or leak. This remains the default for every deployment.
 */
export const FREE_DIRECT_SEARCH_ADMISSION: SearchProviderAdmissionPolicy = {
  id: "free-direct-only",
  allowedTiers: [1],
  allowedAccess: ["free_direct"],
};

/**
 * Phase 2: additionally admits Tier-2 providers whose free tier requires an
 * account credential. Still $0 — `paid` and `self_hosted` access stay out,
 * so this policy can never silently escalate into spend. Selecting it is a
 * deployment decision, not a caller decision.
 */
export const FREE_CREDENTIALED_SEARCH_ADMISSION: SearchProviderAdmissionPolicy =
  {
    id: "free-direct-and-credentialed",
    allowedTiers: [1, 2],
    allowedAccess: ["free_direct", "free_credentialed"],
  };

export function admitsProvider(
  policy: SearchProviderAdmissionPolicy,
  provider: Pick<SearchProvider, "tier" | "access">,
): boolean {
  return (
    policy.allowedTiers.includes(provider.tier) &&
    policy.allowedAccess.includes(provider.access)
  );
}

export interface SearchProvider {
  id: string;
  tier: SearchProviderTier;
  access: SearchProviderAccess;
  plane: Extract<Plane, "cloud">;
  termsUrl: string;
  privacyUrl?: string;
  rights: SearchProviderRights;
  health(): SearchProviderHealth;
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
  providerHealth: SearchProviderHealth;
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
  | "access_blocked"
  | "cancelled";

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
    !Number.isInteger(request.maxResponseBytes) ||
    request.maxResponseBytes < SEARCH_PROVIDER_LIMITS.minResponseBytes ||
    request.maxResponseBytes > SEARCH_PROVIDER_LIMITS.maxResponseBytes
  ) {
    throw new SearchRequestBoundsError(
      `maxResponseBytes must be an integer from ${SEARCH_PROVIDER_LIMITS.minResponseBytes}-${SEARCH_PROVIDER_LIMITS.maxResponseBytes}`,
    );
  }
  if (
    !Number.isInteger(request.maxProviderAttempts) ||
    request.maxProviderAttempts < 1 ||
    request.maxProviderAttempts > SEARCH_PROVIDER_LIMITS.maxProviderAttempts
  ) {
    throw new SearchRequestBoundsError(
      `maxProviderAttempts must be an integer from 1-${SEARCH_PROVIDER_LIMITS.maxProviderAttempts}`,
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
    maxResponseBytes: request.maxResponseBytes,
    maxProviderAttempts: request.maxProviderAttempts,
    timeoutMs: request.timeoutMs,
    requestId,
    requestedAt: request.requestedAt,
    taintLabel: request.taintLabel,
    ...(request.signal ? { signal: request.signal } : {}),
  };
}
