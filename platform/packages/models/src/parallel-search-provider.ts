import { createHash } from "node:crypto";
import { isIP } from "node:net";
import { performance } from "node:perf_hooks";
import { TextDecoder } from "node:util";

import {
  SEARCH_PROVIDER_RESULT_LIMITS,
  SearchProviderError,
  normalizeSearchRequest,
  type SearchCitation,
  type SearchProvider,
  type SearchProviderResult,
  type SearchRequest,
} from "@bridge/core";
import {
  RequestTooLargeError,
  ResponseTooLargeError,
  SsrfBlockedError,
  guardedFetch,
  isBlockedHostname,
  isBlockedIp,
  type GuardedFetchOptions,
  type GuardedFetchResult,
} from "@bridge/net-guard";

export const PARALLEL_SEARCH_PROVIDER_ID = "parallel-search-mcp";
export const PARALLEL_SEARCH_MCP_URL = "https://search.parallel.ai/mcp";
export const PARALLEL_SEARCH_TERMS_URL = "https://parallel.ai/customer-terms";
export const PARALLEL_SEARCH_PRIVACY_URL = "https://parallel.ai/privacy-policy";
export const PARALLEL_SEARCH_RIGHTS_SOURCE_URL =
  "https://docs.parallel.ai/integrations/mcp/search-mcp";
export const PARALLEL_SEARCH_RIGHTS_VERIFIED_AT = "2026-07-18T00:00:00.000Z";

const MCP_PROTOCOL_VERSION = "2025-03-26";
const MAX_SSE_MESSAGES = 100;
const MAX_REQUEST_BYTES = 16 * 1024;
const PARALLEL_ORIGIN = new URL(PARALLEL_SEARCH_MCP_URL).origin;

export type SearchFetchPort = (
  url: string,
  options?: GuardedFetchOptions,
) => Promise<GuardedFetchResult>;

interface JsonRpcSuccess {
  jsonrpc: "2.0";
  id: string | number;
  result: unknown;
}

interface ParallelSearchPayload {
  search_id: string;
  results: unknown[];
  warnings?: unknown[];
}

interface SearchHttpResponse {
  status: number;
  headers: Readonly<Record<string, string>>;
  contentType: "application/json" | "text/event-stream" | null;
  body: string;
  bytes: number;
}

export interface ParallelSearchProviderOptions {
  fetch?: SearchFetchPort;
  nowMs?: () => number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function sha256(value: string): string {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function normalizePublishedAt(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null;
}

function invalidResponse(message: string): SearchProviderError {
  return new SearchProviderError({
    providerId: PARALLEL_SEARCH_PROVIDER_ID,
    code: "invalid_response",
    message,
    retryable: false,
  });
}

function parseJson(value: string, detail: string): unknown {
  try {
    return JSON.parse(value) as unknown;
  } catch {
    throw invalidResponse(detail);
  }
}

function parseSseMessages(body: string): unknown[] {
  const messages: unknown[] = [];
  let eventType: string | undefined;
  let dataLines: string[] = [];
  const flush = (): void => {
    if (dataLines.length === 0) {
      eventType = undefined;
      return;
    }
    if (eventType === undefined || eventType === "message") {
      if (messages.length >= MAX_SSE_MESSAGES) {
        throw invalidResponse(
          "Parallel Search MCP exceeded the bounded SSE message count",
        );
      }
      messages.push(
        parseJson(
          dataLines.join("\n"),
          "Parallel Search MCP returned invalid SSE JSON",
        ),
      );
    }
    eventType = undefined;
    dataLines = [];
  };

  for (const line of body.replace(/\r\n?/g, "\n").split("\n")) {
    if (line.length === 0) {
      flush();
      continue;
    }
    if (line.startsWith(":")) continue;
    const separator = line.indexOf(":");
    const field = separator === -1 ? line : line.slice(0, separator);
    const rawValue = separator === -1 ? "" : line.slice(separator + 1);
    const value = rawValue.startsWith(" ") ? rawValue.slice(1) : rawValue;
    if (field === "event") eventType = value;
    if (field === "data") dataLines.push(value);
  }
  flush();

  if (messages.length === 0) {
    throw invalidResponse(
      "Parallel Search MCP returned no JSON-RPC SSE messages",
    );
  }
  return messages;
}

function parseJsonRpc(
  response: SearchHttpResponse,
  expectedId: string,
): JsonRpcSuccess {
  const payloads =
    response.contentType === "text/event-stream"
      ? parseSseMessages(response.body)
      : [
          parseJson(
            response.body,
            "Parallel Search MCP returned invalid JSON",
          ),
        ];
  const matching = payloads.filter(
    (payload) => isRecord(payload) && payload.id === expectedId,
  );
  const parsed = matching[0];
  if (
    matching.length !== 1 ||
    !isRecord(parsed) ||
    parsed.jsonrpc !== "2.0" ||
    !("result" in parsed) ||
    ("error" in parsed && parsed.error !== undefined)
  ) {
    throw invalidResponse(
      "Parallel Search MCP returned an invalid JSON-RPC envelope",
    );
  }
  return parsed as unknown as JsonRpcSuccess;
}

function normalizedHeaders(
  headers: GuardedFetchResult["headers"],
): Record<string, string> {
  const output: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers)) {
    if (typeof value === "string") output[key.toLowerCase()] = value;
    else if (Array.isArray(value)) output[key.toLowerCase()] = value.join(", ");
  }
  return output;
}

function responseContentType(
  raw: string | undefined,
  allowEmptyBody: boolean,
): SearchHttpResponse["contentType"] {
  if (!raw) {
    if (allowEmptyBody) return null;
    throw invalidResponse("Parallel Search MCP omitted Content-Type");
  }
  const [mediaType, ...parameters] = raw
    .toLowerCase()
    .split(";")
    .map((part) => part.trim());
  if (mediaType !== "application/json" && mediaType !== "text/event-stream") {
    throw invalidResponse(
      `Parallel Search MCP returned unsupported Content-Type ${mediaType}`,
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
    throw invalidResponse(
      "Parallel Search MCP returned a non-UTF-8 Content-Type",
    );
  }
  return mediaType;
}

function decodeResponse(
  result: GuardedFetchResult,
  allowEmptyBody: boolean,
): SearchHttpResponse {
  const headers = normalizedHeaders(result.headers);
  const encoding = headers["content-encoding"]?.toLowerCase();
  if (encoding && encoding !== "identity") {
    throw invalidResponse(
      "Parallel Search MCP returned a compressed or unsupported encoding",
    );
  }
  const contentType = responseContentType(
    headers["content-type"],
    allowEmptyBody && result.body.byteLength === 0,
  );
  let body: string;
  try {
    body = new TextDecoder("utf-8", { fatal: true }).decode(result.body);
  } catch {
    throw invalidResponse("Parallel Search MCP returned invalid UTF-8");
  }
  if (!allowEmptyBody && body.length === 0) {
    throw invalidResponse("Parallel Search MCP returned an empty response");
  }
  return {
    status: result.status,
    headers,
    contentType,
    body,
    bytes: result.body.byteLength,
  };
}

function requireSuccessfulStatus(response: SearchHttpResponse): void {
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
    providerId: PARALLEL_SEARCH_PROVIDER_ID,
    code,
    message: `Parallel Search MCP returned HTTP ${response.status}`,
    retryable: code === "rate_limited" || code === "unavailable",
    status: response.status,
  });
}

function providerError(error: unknown, signal: AbortSignal | undefined): SearchProviderError {
  if (error instanceof SearchProviderError) return error;
  if (signal?.aborted) {
    return new SearchProviderError({
      providerId: PARALLEL_SEARCH_PROVIDER_ID,
      code: "cancelled",
      message: "Parallel Search MCP request was cancelled",
      retryable: false,
    });
  }
  if (error instanceof DOMException && error.name === "TimeoutError") {
    return new SearchProviderError({
      providerId: PARALLEL_SEARCH_PROVIDER_ID,
      code: "timeout",
      message: "Parallel Search MCP exceeded the bounded search deadline",
      retryable: true,
    });
  }
  if (
    error instanceof SsrfBlockedError ||
    error instanceof RequestTooLargeError
  ) {
    return new SearchProviderError({
      providerId: PARALLEL_SEARCH_PROVIDER_ID,
      code: "access_blocked",
      message: "Parallel Search MCP request was blocked by the network policy",
      retryable: false,
    });
  }
  if (error instanceof ResponseTooLargeError) {
    return new SearchProviderError({
      providerId: PARALLEL_SEARCH_PROVIDER_ID,
      code: "degraded",
      message: "Parallel Search MCP exceeded the response byte budget",
      retryable: true,
    });
  }
  return new SearchProviderError({
    providerId: PARALLEL_SEARCH_PROVIDER_ID,
    code: "unavailable",
    message: "Parallel Search MCP failed with an unclassified transport error",
    retryable: true,
  });
}

function parseSearchPayload(
  response: SearchHttpResponse,
  expectedId: string,
): ParallelSearchPayload {
  const envelope = parseJsonRpc(response, expectedId);
  if (!isRecord(envelope.result)) {
    throw invalidResponse("Parallel Search MCP result was not an object");
  }
  if (envelope.result.isError === true) {
    throw new SearchProviderError({
      providerId: PARALLEL_SEARCH_PROVIDER_ID,
      code: "degraded",
      message: "Parallel Search MCP reported an operation error",
      retryable: true,
    });
  }
  const content = envelope.result.content;
  if (!Array.isArray(content)) {
    throw invalidResponse("Parallel Search MCP omitted operation content");
  }
  const textBlocks = content.filter(
    (item): item is { type: "text"; text: string } =>
      isRecord(item) && item.type === "text" && typeof item.text === "string",
  );
  if (textBlocks.length !== 1) {
    throw invalidResponse(
      "Parallel Search MCP returned an unexpected content shape",
    );
  }
  const payload = parseJson(
    textBlocks[0]!.text,
    "Parallel Search MCP operation content was not valid JSON",
  );
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
    throw invalidResponse(
      "Parallel Search MCP returned an invalid search payload",
    );
  }
  return {
    search_id: payload.search_id,
    results: payload.results,
    ...(Array.isArray(payload.warnings) ? { warnings: payload.warnings } : {}),
  };
}

function isSafePublicCitationUrl(value: string): boolean {
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

function toCitation(
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
    providerId: PARALLEL_SEARCH_PROVIDER_ID,
    retrievedAt,
    contentHash: sha256(JSON.stringify({ url: value.url, title, excerpts })),
    trustOrigin: "untrusted_external",
  };
}

function safeWarnings(values: readonly unknown[] | undefined): string[] {
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

function rpcBody(
  id: string,
  method: string,
  params?: Record<string, unknown>,
): string {
  return JSON.stringify({
    jsonrpc: "2.0",
    id,
    method,
    ...(params ? { params } : {}),
  });
}

export class ParallelSearchProvider implements SearchProvider {
  readonly id = PARALLEL_SEARCH_PROVIDER_ID;
  readonly tier = 1 as const;
  readonly access = "free_direct" as const;
  readonly plane = "cloud" as const;
  readonly termsUrl = PARALLEL_SEARCH_TERMS_URL;
  readonly privacyUrl = PARALLEL_SEARCH_PRIVACY_URL;
  readonly rights = {
    status: "verified",
    verifiedAt: PARALLEL_SEARCH_RIGHTS_VERIFIED_AT,
    sourceUrl: PARALLEL_SEARCH_RIGHTS_SOURCE_URL,
    allowedDataScope: "public",
    restrictions: [
      "public-scope research only",
      "no cross-customer result cache or resale",
      "no training or benchmark publication from provider output",
      "private or personal data requires a separately approved DPA path",
    ],
  } as const;
  readonly #fetch: SearchFetchPort;
  readonly #nowMs: () => number;

  constructor(options: ParallelSearchProviderOptions = {}) {
    this.#fetch = options.fetch ?? guardedFetch;
    this.#nowMs = options.nowMs ?? (() => performance.now());
  }

  health() {
    return "unknown" as const;
  }

  async search(request: SearchRequest): Promise<SearchProviderResult> {
    const bounded = normalizeSearchRequest(request);
    const deadline = this.#nowMs() + bounded.timeoutMs;
    let responseBytes = 0;
    const remainingTimeout = (): number => {
      if (bounded.signal?.aborted) {
        throw new SearchProviderError({
          providerId: this.id,
          code: "cancelled",
          message: "Parallel Search MCP request was cancelled",
          retryable: false,
        });
      }
      const remaining = deadline - this.#nowMs();
      if (remaining <= 0) {
        throw new SearchProviderError({
          providerId: this.id,
          code: "timeout",
          message: "Parallel Search MCP exceeded the bounded search deadline",
          retryable: true,
        });
      }
      return Math.max(1, Math.floor(remaining));
    };
    const remainingBytes = (): number => {
      const remaining = bounded.maxResponseBytes - responseBytes;
      if (remaining < 1) {
        throw new SearchProviderError({
          providerId: this.id,
          code: "degraded",
          message: "Parallel Search MCP exhausted the response byte budget",
          retryable: true,
        });
      }
      return remaining;
    };
    const requestMcp = async (
      body: string,
      headers: Record<string, string>,
      allowEmptyBody = false,
    ): Promise<SearchHttpResponse> => {
      const result = await this.#fetch(PARALLEL_SEARCH_MCP_URL, {
        method: "POST",
        headers,
        body,
        maxRequestBytes: MAX_REQUEST_BYTES,
        maxBytes: remainingBytes(),
        timeoutMs: remainingTimeout(),
        maxRedirects: 0,
        allowedRedirectOrigins: [PARALLEL_ORIGIN],
        ...(bounded.signal ? { signal: bounded.signal } : {}),
      });
      const decoded = decodeResponse(result, allowEmptyBody);
      responseBytes += decoded.bytes;
      return decoded;
    };
    const commonHeaders = {
      accept: "application/json, text/event-stream",
      "accept-encoding": "identity",
      "content-type": "application/json",
      "user-agent": "Bridge/0.2 governed-web-research",
    };

    try {
      const initializeId = `${bounded.requestId}:initialize`;
      const initialized = await requestMcp(
        rpcBody(initializeId, "initialize", {
          protocolVersion: MCP_PROTOCOL_VERSION,
          capabilities: {},
          clientInfo: {
            name: "bridge-governed-web-research",
            version: "0.2.0",
          },
        }),
        commonHeaders,
      );
      requireSuccessfulStatus(initialized);
      const initializeEnvelope = parseJsonRpc(initialized, initializeId);
      if (
        !isRecord(initializeEnvelope.result) ||
        initializeEnvelope.result.protocolVersion !== MCP_PROTOCOL_VERSION
      ) {
        throw invalidResponse(
          "Parallel Search MCP negotiated an unexpected protocol version",
        );
      }
      const sessionId = initialized.headers["mcp-session-id"];
      if (
        !sessionId ||
        sessionId.length > 200 ||
        !/^[A-Za-z0-9._~-]+$/.test(sessionId)
      ) {
        throw invalidResponse(
          "Parallel Search MCP omitted a valid session id",
        );
      }
      if (
        initialized.headers["x-parallel-terms"] !== this.termsUrl ||
        initialized.headers["x-parallel-privacy"] !== this.privacyUrl
      ) {
        throw new SearchProviderError({
          providerId: this.id,
          code: "access_blocked",
          message:
            "Parallel Search MCP policy metadata changed; rights review required",
          retryable: false,
        });
      }

      const sessionHeaders = {
        ...commonHeaders,
        "mcp-session-id": sessionId,
      };
      const acknowledged = await requestMcp(
        JSON.stringify({
          jsonrpc: "2.0",
          method: "notifications/initialized",
        }),
        sessionHeaders,
        true,
      );
      requireSuccessfulStatus(acknowledged);
      if (acknowledged.status !== 202 || acknowledged.body.length !== 0) {
        throw invalidResponse(
          "Parallel Search MCP returned an invalid initialize acknowledgement",
        );
      }

      const searchId = `${bounded.requestId}:search`;
      const searched = await requestMcp(
        rpcBody(searchId, "tools/call", {
          name: "web_search",
          arguments: {
            objective: bounded.objective,
            search_queries: bounded.searchQueries,
          },
        }),
        sessionHeaders,
      );
      requireSuccessfulStatus(searched);
      const payload = parseSearchPayload(searched, searchId);
      const parsedCitations = payload.results.map((value) =>
        toCitation(value, bounded.requestedAt),
      );
      const dropped = parsedCitations.filter(
        (citation) => citation === null,
      ).length;
      const truncated = payload.results.some(
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
      const citations = parsedCitations
        .filter((citation): citation is SearchCitation => citation !== null)
        .slice(0, bounded.maxResults);
      if (payload.results.length > 0 && citations.length === 0) {
        throw new SearchProviderError({
          providerId: this.id,
          code: "degraded",
          message: "Parallel Search MCP returned no valid citations",
          retryable: true,
        });
      }
      const warnings = safeWarnings(payload.warnings);
      if (dropped > 0) {
        warnings.push(
          `${dropped} provider result(s) failed citation validation`,
        );
      }
      if (truncated) {
        warnings.push(
          "provider citation text was truncated to governed bounds",
        );
      }
      const contentHash = sha256(
        JSON.stringify({
          providerRequestId: payload.search_id,
          citations,
          warnings,
        }),
      );

      return {
        citations,
        warnings,
        provenance: {
          providerId: this.id,
          providerTier: this.tier,
          providerAccess: this.access,
          providerRequestId: payload.search_id,
          termsUrl: this.termsUrl,
          privacyUrl: this.privacyUrl,
          searchedAt: bounded.requestedAt,
          responseBytes,
          contentHash,
          rights: this.rights,
        },
        trustOrigin: "untrusted_external",
      };
    } catch (error) {
      throw providerError(error, bounded.signal);
    }
  }
}
