import {
  SEARCH_PROVIDER_RESULT_LIMITS,
  SearchProviderError,
  normalizeSearchRequest,
  type SearchCitation,
  type SearchProvider,
  type SearchProviderResult,
  type SearchRequest,
} from "@bridge/core";
import { performance } from "node:perf_hooks";
import {
  SafeHttpClient,
  SafeHttpError,
  isSafePublicCitationUrl,
  type SafeHttpClientPort,
  type SafeHttpResponse,
} from "./safe-http-client.js";

export const PARALLEL_SEARCH_PROVIDER_ID = "parallel-search-mcp";
export const PARALLEL_SEARCH_MCP_URL = "https://search.parallel.ai/mcp";
export const PARALLEL_SEARCH_TERMS_URL =
  "https://parallel.ai/customer-terms";
export const PARALLEL_SEARCH_PRIVACY_URL =
  "https://parallel.ai/privacy-policy";
export const PARALLEL_SEARCH_RIGHTS_SOURCE_URL =
  "https://docs.parallel.ai/integrations/mcp/search-mcp";
export const PARALLEL_SEARCH_RIGHTS_VERIFIED_AT = "2026-07-18T00:00:00.000Z";

const MCP_PROTOCOL_VERSION = "2025-03-26";
const MAX_RESPONSE_BYTES = 256 * 1024;
const MAX_SSE_MESSAGES = 100;
const MCP_RESPONSE_CONTENT_TYPES = [
  "application/json",
  "text/event-stream",
] as const;

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

export interface ParallelSearchProviderOptions {
  http?: SafeHttpClientPort;
  nowMs?: () => number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseJson(value: string, detail: string): unknown {
  try {
    return JSON.parse(value) as unknown;
  } catch {
    throw new SearchProviderError({
      providerId: PARALLEL_SEARCH_PROVIDER_ID,
      code: "invalid_response",
      message: detail,
      retryable: false,
    });
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
        throw new SearchProviderError({
          providerId: PARALLEL_SEARCH_PROVIDER_ID,
          code: "invalid_response",
          message: "Parallel Search MCP exceeded the bounded SSE message count",
          retryable: false,
        });
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
    throw new SearchProviderError({
      providerId: PARALLEL_SEARCH_PROVIDER_ID,
      code: "invalid_response",
      message: "Parallel Search MCP returned no JSON-RPC SSE messages",
      retryable: false,
    });
  }
  return messages;
}

function parseJsonRpc(
  response: SafeHttpResponse,
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
    throw new SearchProviderError({
      providerId: PARALLEL_SEARCH_PROVIDER_ID,
      code: "invalid_response",
      message: "Parallel Search MCP returned an invalid JSON-RPC envelope",
      retryable: false,
    });
  }
  return parsed as unknown as JsonRpcSuccess;
}

function requireSuccessfulStatus(response: SafeHttpResponse): void {
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

function providerError(error: unknown): SearchProviderError {
  if (error instanceof SearchProviderError) return error;
  if (error instanceof SafeHttpError) {
    return new SearchProviderError({
      providerId: PARALLEL_SEARCH_PROVIDER_ID,
      code: error.code === "timeout" ? "timeout" : "unavailable",
      message: `Parallel Search MCP transport failed: ${error.code}`,
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
  response: SafeHttpResponse,
  expectedId: string,
): ParallelSearchPayload {
  const envelope = parseJsonRpc(response, expectedId);
  if (!isRecord(envelope.result)) {
    throw new SearchProviderError({
      providerId: PARALLEL_SEARCH_PROVIDER_ID,
      code: "invalid_response",
      message: "Parallel Search MCP result was not an object",
      retryable: false,
    });
  }
  if (envelope.result.isError === true) {
    throw new SearchProviderError({
      providerId: PARALLEL_SEARCH_PROVIDER_ID,
      code: "degraded",
      message: "Parallel Search MCP reported a tool error",
      retryable: true,
    });
  }
  const content = envelope.result.content;
  if (!Array.isArray(content)) {
    throw new SearchProviderError({
      providerId: PARALLEL_SEARCH_PROVIDER_ID,
      code: "invalid_response",
      message: "Parallel Search MCP omitted tool content",
      retryable: false,
    });
  }
  const textBlocks = content.filter(
    (item): item is { type: "text"; text: string } =>
      isRecord(item) && item.type === "text" && typeof item.text === "string",
  );
  if (textBlocks.length !== 1) {
    throw new SearchProviderError({
      providerId: PARALLEL_SEARCH_PROVIDER_ID,
      code: "invalid_response",
      message: "Parallel Search MCP returned an unexpected content shape",
      retryable: false,
    });
  }
  const payload = parseJson(
    textBlocks[0]!.text,
    "Parallel Search MCP tool content was not valid JSON",
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
    throw new SearchProviderError({
      providerId: PARALLEL_SEARCH_PROVIDER_ID,
      code: "invalid_response",
      message: "Parallel Search MCP returned an invalid search payload",
      retryable: false,
    });
  }
  return {
    search_id: payload.search_id,
    results: payload.results,
    ...(Array.isArray(payload.warnings) ? { warnings: payload.warnings } : {}),
  };
}

function toCitation(value: unknown): SearchCitation | null {
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
  return {
    url: value.url,
    title:
      typeof value.title === "string"
        ? value.title.slice(
            0,
            SEARCH_PROVIDER_RESULT_LIMITS.maxTitleChars,
          )
        : null,
    publishedAt:
      typeof value.publish_date === "string" &&
      Number.isFinite(Date.parse(value.publish_date))
        ? value.publish_date
        : null,
    excerpts: value.excerpts
      .slice(0, SEARCH_PROVIDER_RESULT_LIMITS.maxExcerptsPerCitation)
      .map((excerpt) =>
        excerpt.slice(0, SEARCH_PROVIDER_RESULT_LIMITS.maxExcerptChars),
      ),
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
  readonly #http: SafeHttpClientPort;
  readonly #nowMs: () => number;

  constructor(options: ParallelSearchProviderOptions = {}) {
    this.#nowMs = options.nowMs ?? (() => performance.now());
    this.#http =
      options.http ??
      new SafeHttpClient({
        allowedOrigins: [new URL(PARALLEL_SEARCH_MCP_URL).origin],
        allowedContentTypes: MCP_RESPONSE_CONTENT_TYPES,
        timeoutMs: 15_000,
        maxResponseBytes: MAX_RESPONSE_BYTES,
        maxRequestBytes: 16 * 1024,
        maxRedirects: 0,
      });
  }

  async search(request: SearchRequest): Promise<SearchProviderResult> {
    const bounded = normalizeSearchRequest(request);
    const deadline = this.#nowMs() + bounded.timeoutMs;
    const remainingTimeout = (): number => {
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
    const commonHeaders = {
      accept: "application/json, text/event-stream",
      "content-type": "application/json",
    };

    try {
      const initializeId = `${bounded.requestId}:initialize`;
      const initialized = await this.#http.request({
        url: PARALLEL_SEARCH_MCP_URL,
        method: "POST",
        headers: commonHeaders,
        body: rpcBody(initializeId, "initialize", {
          protocolVersion: MCP_PROTOCOL_VERSION,
          capabilities: {},
          clientInfo: {
            name: "bridge-governed-web-research",
            version: "0.1.0",
          },
        }),
        timeoutMs: remainingTimeout(),
        maxResponseBytes: MAX_RESPONSE_BYTES,
        maxRedirects: 0,
        allowedContentTypes: MCP_RESPONSE_CONTENT_TYPES,
      });
      requireSuccessfulStatus(initialized);
      const initializeEnvelope = parseJsonRpc(initialized, initializeId);
      if (
        !isRecord(initializeEnvelope.result) ||
        initializeEnvelope.result.protocolVersion !== MCP_PROTOCOL_VERSION
      ) {
        throw new SearchProviderError({
          providerId: this.id,
          code: "invalid_response",
          message: "Parallel Search MCP negotiated an unexpected protocol version",
          retryable: false,
        });
      }
      const sessionId = initialized.headers["mcp-session-id"];
      if (
        !sessionId ||
        sessionId.length > 200 ||
        !/^[A-Za-z0-9._~-]+$/.test(sessionId)
      ) {
        throw new SearchProviderError({
          providerId: this.id,
          code: "invalid_response",
          message: "Parallel Search MCP omitted a valid session id",
          retryable: false,
        });
      }
      if (
        initialized.headers["x-parallel-terms"] !== this.termsUrl ||
        initialized.headers["x-parallel-privacy"] !== this.privacyUrl
      ) {
        throw new SearchProviderError({
          providerId: this.id,
          code: "access_blocked",
          message: "Parallel Search MCP policy metadata changed; rights review required",
          retryable: false,
        });
      }

      const sessionHeaders = {
        ...commonHeaders,
        "mcp-session-id": sessionId,
      };
      const acknowledged = await this.#http.request({
        url: PARALLEL_SEARCH_MCP_URL,
        method: "POST",
        headers: sessionHeaders,
        body: JSON.stringify({
          jsonrpc: "2.0",
          method: "notifications/initialized",
        }),
        timeoutMs: remainingTimeout(),
        maxResponseBytes: 1_024,
        maxRedirects: 0,
        allowedContentTypes: MCP_RESPONSE_CONTENT_TYPES,
        allowEmptyBody: true,
      });
      requireSuccessfulStatus(acknowledged);
      if (acknowledged.status !== 202 || acknowledged.body.length !== 0) {
        throw new SearchProviderError({
          providerId: this.id,
          code: "invalid_response",
          message: "Parallel Search MCP returned an invalid initialize acknowledgement",
          retryable: false,
        });
      }

      const searchId = `${bounded.requestId}:search`;
      const searched = await this.#http.request({
        url: PARALLEL_SEARCH_MCP_URL,
        method: "POST",
        headers: sessionHeaders,
        body: rpcBody(searchId, "tools/call", {
          name: "web_search",
          arguments: {
            objective: bounded.objective,
            search_queries: bounded.searchQueries,
          },
        }),
        timeoutMs: remainingTimeout(),
        maxResponseBytes: MAX_RESPONSE_BYTES,
        maxRedirects: 0,
        allowedContentTypes: MCP_RESPONSE_CONTENT_TYPES,
      });
      requireSuccessfulStatus(searched);
      const payload = parseSearchPayload(searched, searchId);
      const parsedCitations = payload.results.map(toCitation);
      const dropped = parsedCitations.filter(
        (citation) => citation === null,
      ).length;
      const truncated = payload.results.some(
        (value) =>
          isRecord(value) &&
          ((typeof value.title === "string" &&
            value.title.length >
              SEARCH_PROVIDER_RESULT_LIMITS.maxTitleChars) ||
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
        warnings.push(`${dropped} provider result(s) failed citation validation`);
      }
      if (truncated) {
        warnings.push("provider citation text was truncated to governed bounds");
      }

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
        },
        trustOrigin: "untrusted_external",
      };
    } catch (error) {
      throw providerError(error);
    }
  }
}
