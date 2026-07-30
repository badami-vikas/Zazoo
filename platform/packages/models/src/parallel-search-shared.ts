/**
 * Shared parsing, bounding, and provenance helpers for the Parallel Search
 * adapters.
 *
 * Two adapters talk to the same vendor over two different transports: the
 * anonymous MCP endpoint (`parallel-search-provider.ts`, Tier-1 free-direct)
 * and the credentialed REST endpoint (`parallel-search-api-provider.ts`,
 * Tier-2 free-credentialed). Both receive the SAME result payload shape, so
 * the citation validation, URL safety, taint labelling, truncation, and byte
 * accounting live here once. Duplicating them would let the two adapters
 * drift, and every one of these checks is load-bearing for the LA3 rights and
 * injection posture — a divergence would be a silent security regression, not
 * a cosmetic one.
 *
 * Everything here is parametrised by `providerId` so error attribution and
 * citation provenance stay accurate per adapter.
 */
import { createHash } from "node:crypto";
import { isIP } from "node:net";

import {
  SEARCH_PROVIDER_RESULT_LIMITS,
  SearchProviderError,
  hashTaintValue,
  labelAtSource,
  type SearchCitation,
} from "@bridge/core";
import {
  RequestTooLargeError,
  ResponseTooLargeError,
  SsrfBlockedError,
  isBlockedHostname,
  isBlockedIp,
  type GuardedFetchOptions,
  type GuardedFetchResult,
} from "@bridge/net-guard";

export type SearchFetchPort = (
  url: string,
  options?: GuardedFetchOptions,
) => Promise<GuardedFetchResult>;

export type SearchContentType =
  | "application/json"
  | "text/event-stream"
  | null;

export interface SearchHttpResponse {
  status: number;
  headers: Readonly<Record<string, string>>;
  contentType: SearchContentType;
  body: string;
  bytes: number;
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function sha256(value: string): string {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

export function normalizePublishedAt(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null;
}

export function invalidResponse(
  providerId: string,
  message: string,
): SearchProviderError {
  return new SearchProviderError({
    providerId,
    code: "invalid_response",
    message,
    retryable: false,
  });
}

export function parseJson(
  providerId: string,
  value: string,
  detail: string,
): unknown {
  try {
    return JSON.parse(value) as unknown;
  } catch {
    throw invalidResponse(providerId, detail);
  }
}

export function normalizedHeaders(
  headers: GuardedFetchResult["headers"],
): Record<string, string> {
  const output: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers)) {
    if (typeof value === "string") output[key.toLowerCase()] = value;
    else if (Array.isArray(value)) output[key.toLowerCase()] = value.join(", ");
  }
  return output;
}

export function responseContentType(
  providerId: string,
  label: string,
  raw: string | undefined,
  allowEmptyBody: boolean,
  allowed: readonly Exclude<SearchContentType, null>[],
): SearchContentType {
  if (!raw) {
    if (allowEmptyBody) return null;
    throw invalidResponse(providerId, `${label} omitted Content-Type`);
  }
  const [mediaType, ...parameters] = raw
    .toLowerCase()
    .split(";")
    .map((part) => part.trim());
  if (
    mediaType === undefined ||
    !allowed.includes(mediaType as Exclude<SearchContentType, null>)
  ) {
    throw invalidResponse(
      providerId,
      `${label} returned unsupported Content-Type ${mediaType}`,
    );
  }
  if (
    parameters.some(
      (parameter) =>
        parameter.length > 0 &&
        parameter !== "charset=utf-8" &&
        parameter !== 'charset="utf-8"',
    )
  ) {
    throw invalidResponse(providerId, `${label} returned a non-UTF-8 Content-Type`);
  }
  return mediaType as Exclude<SearchContentType, null>;
}

export function decodeResponse(
  providerId: string,
  label: string,
  result: GuardedFetchResult,
  allowEmptyBody: boolean,
  allowed: readonly Exclude<SearchContentType, null>[],
): SearchHttpResponse {
  const headers = normalizedHeaders(result.headers);
  const encoding = headers["content-encoding"]?.toLowerCase();
  if (encoding && encoding !== "identity") {
    throw invalidResponse(
      providerId,
      `${label} returned a compressed or unsupported encoding`,
    );
  }
  const contentType = responseContentType(
    providerId,
    label,
    headers["content-type"],
    allowEmptyBody && result.body.byteLength === 0,
    allowed,
  );
  let body: string;
  try {
    body = new TextDecoder("utf-8", { fatal: true }).decode(result.body);
  } catch {
    throw invalidResponse(providerId, `${label} returned invalid UTF-8`);
  }
  if (!allowEmptyBody && body.length === 0) {
    throw invalidResponse(providerId, `${label} returned an empty response`);
  }
  return {
    status: result.status,
    headers,
    contentType,
    body,
    bytes: result.body.byteLength,
  };
}

export function requireSuccessfulStatus(
  providerId: string,
  label: string,
  response: SearchHttpResponse,
): void {
  if (response.status >= 200 && response.status < 300) return;
  const code =
    response.status === 429
      ? "rate_limited"
      : response.status === 401 || response.status === 403
        ? "access_blocked"
        : response.status >= 500
          ? "unavailable"
          : "invalid_response";
  throw new SearchProviderError({
    providerId,
    code,
    message: `${label} returned HTTP ${response.status}`,
    retryable: code === "rate_limited" || code === "unavailable",
    status: response.status,
  });
}

export function providerError(
  providerId: string,
  label: string,
  error: unknown,
  signal: AbortSignal | undefined,
): SearchProviderError {
  if (error instanceof SearchProviderError) return error;
  if (signal?.aborted) {
    return new SearchProviderError({
      providerId,
      code: "cancelled",
      message: `${label} request was cancelled`,
      retryable: false,
    });
  }
  if (error instanceof DOMException && error.name === "TimeoutError") {
    return new SearchProviderError({
      providerId,
      code: "timeout",
      message: `${label} exceeded the bounded search deadline`,
      retryable: true,
    });
  }
  if (
    error instanceof SsrfBlockedError ||
    error instanceof RequestTooLargeError
  ) {
    return new SearchProviderError({
      providerId,
      code: "access_blocked",
      message: `${label} request was blocked by the network policy`,
      retryable: false,
    });
  }
  if (error instanceof ResponseTooLargeError) {
    return new SearchProviderError({
      providerId,
      code: "degraded",
      message: `${label} exceeded the response byte budget`,
      retryable: true,
    });
  }
  return new SearchProviderError({
    providerId,
    code: "unavailable",
    message: `${label} failed with an unclassified transport error`,
    retryable: true,
  });
}

export function isSafePublicCitationUrl(value: string): boolean {
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

/**
 * Validate one raw provider result into a bounded, hashed, taint-labelled
 * citation. Returns null (never throws) when the result fails validation, so
 * callers can count drops and continue rather than losing the whole page.
 */
export function toCitation(
  providerId: string,
  value: unknown,
  retrievedAt: string,
): SearchCitation | null {
  if (
    !isRecord(value) ||
    typeof value.url !== "string" ||
    value.url.length > SEARCH_PROVIDER_RESULT_LIMITS.maxUrlChars ||
    !isSafePublicCitationUrl(value.url) ||
    (value.title !== undefined &&
      value.title !== null &&
      typeof value.title !== "string") ||
    (value.publish_date !== undefined &&
      value.publish_date !== null &&
      typeof value.publish_date !== "string") ||
    !Array.isArray(value.excerpts) ||
    value.excerpts.some((excerpt) => typeof excerpt !== "string")
  ) {
    return null;
  }
  const title =
    typeof value.title === "string"
      ? value.title.slice(0, SEARCH_PROVIDER_RESULT_LIMITS.maxTitleChars)
      : null;
  const excerpts = value.excerpts
    .slice(0, SEARCH_PROVIDER_RESULT_LIMITS.maxExcerptsPerCitation)
    .map((excerpt) =>
      excerpt.slice(0, SEARCH_PROVIDER_RESULT_LIMITS.maxExcerptChars),
    );
  return {
    url: value.url,
    title,
    publishedAt: normalizePublishedAt(value.publish_date),
    excerpts,
    providerId,
    retrievedAt,
    contentHash: sha256(JSON.stringify({ url: value.url, title, excerpts })),
    trustOrigin: "untrusted_external",
    taintLabel: labelAtSource("web_search", {
      ref: value.url,
      valueHash: hashTaintValue({ title, excerpts }),
      sensitivity: "public",
      instructionRisk: "data",
    }),
  };
}

/** True when any raw result exceeded a governed bound and had to be trimmed. */
export function resultsWereTruncated(results: readonly unknown[]): boolean {
  return results.some(
    (value) =>
      isRecord(value) &&
      ((typeof value.title === "string" &&
        value.title.length > SEARCH_PROVIDER_RESULT_LIMITS.maxTitleChars) ||
        (Array.isArray(value.excerpts) &&
          (value.excerpts.length >
            SEARCH_PROVIDER_RESULT_LIMITS.maxExcerptsPerCitation ||
            value.excerpts.some(
              (excerpt) =>
                typeof excerpt === "string" &&
                excerpt.length >
                  SEARCH_PROVIDER_RESULT_LIMITS.maxExcerptChars,
            )))),
  );
}

export function safeWarnings(values: readonly unknown[] | undefined): string[] {
  return (values ?? [])
    .map((value) => {
      if (typeof value === "string") return value;
      return isRecord(value) && typeof value.message === "string"
        ? value.message
        : null;
    })
    .filter((value): value is string => value !== null)
    .slice(0, SEARCH_PROVIDER_RESULT_LIMITS.maxWarnings - 2)
    .map((value) =>
      value.slice(0, SEARCH_PROVIDER_RESULT_LIMITS.maxWarningChars),
    );
}

/**
 * Shared validation for the `{search_id, results, warnings}` payload both
 * transports return.
 */
export interface ParallelSearchPayload {
  search_id: string;
  results: unknown[];
  warnings?: unknown[];
}

export function assertSearchPayload(
  providerId: string,
  label: string,
  payload: unknown,
): ParallelSearchPayload {
  if (
    !isRecord(payload) ||
    typeof payload.search_id !== "string" ||
    payload.search_id.length === 0 ||
    payload.search_id.length >
      SEARCH_PROVIDER_RESULT_LIMITS.maxProviderRequestIdChars ||
    !/^[\x21-\x7e]+$/.test(payload.search_id) ||
    !Array.isArray(payload.results) ||
    (payload.warnings !== undefined &&
      payload.warnings !== null &&
      !Array.isArray(payload.warnings))
  ) {
    throw invalidResponse(providerId, `${label} returned an invalid search payload`);
  }
  return {
    search_id: payload.search_id,
    results: payload.results,
    ...(Array.isArray(payload.warnings) ? { warnings: payload.warnings } : {}),
  };
}
