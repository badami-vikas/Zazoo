import { performance } from "node:perf_hooks";

import {
  SEARCH_PROVIDER_RESULT_LIMITS,
  SearchProviderError,
  evaluateTaintSink,
  labelAtSource,
  normalizeSearchRequest,
  type SearchCitation,
  type SearchProvider,
  type SearchProviderResult,
  type SearchRequest,
} from "@bridge/core";
import { guardedFetch, type GuardedFetchResult } from "@bridge/net-guard";

import {
  assertSearchPayload,
  isRecord,
  resultsWereTruncated,
  safeWarnings,
  sha256,
  decodeResponse as sharedDecodeResponse,
  invalidResponse as sharedInvalidResponse,
  parseJson as sharedParseJson,
  providerError as sharedProviderError,
  requireSuccessfulStatus as sharedRequireSuccessfulStatus,
  toCitation as sharedToCitation,
  type ParallelSearchPayload,
  type SearchFetchPort,
  type SearchHttpResponse,
} from "./parallel-search-shared.js";

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

interface JsonRpcSuccess {
  jsonrpc: "2.0";
  id: string | number;
  result: unknown;
}

export interface ParallelSearchProviderOptions {
  fetch?: SearchFetchPort;
  nowMs?: () => number;
}

const LABEL = "Parallel Search MCP";

function invalidResponse(message: string): SearchProviderError {
  return sharedInvalidResponse(PARALLEL_SEARCH_PROVIDER_ID, message);
}

function parseJson(value: string, detail: string): unknown {
  return sharedParseJson(PARALLEL_SEARCH_PROVIDER_ID, value, detail);
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

function decodeResponse(
  result: GuardedFetchResult,
  allowEmptyBody: boolean,
): SearchHttpResponse {
  return sharedDecodeResponse(
    PARALLEL_SEARCH_PROVIDER_ID,
    LABEL,
    result,
    allowEmptyBody,
    ["application/json", "text/event-stream"],
  );
}

function requireSuccessfulStatus(response: SearchHttpResponse): void {
  sharedRequireSuccessfulStatus(PARALLEL_SEARCH_PROVIDER_ID, LABEL, response);
}

function providerError(
  error: unknown,
  signal: AbortSignal | undefined,
): SearchProviderError {
  return sharedProviderError(PARALLEL_SEARCH_PROVIDER_ID, LABEL, error, signal);
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
  return assertSearchPayload(PARALLEL_SEARCH_PROVIDER_ID, LABEL, payload);
}

function toCitation(
  value: unknown,
  retrievedAt: string,
): SearchCitation | null {
  return sharedToCitation(PARALLEL_SEARCH_PROVIDER_ID, value, retrievedAt);
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
    const sink = evaluateTaintSink("network_egress", [bounded.taintLabel]);
    if (sink.policy !== "allow") {
      throw new SearchProviderError({
        providerId: this.id,
        code: "access_blocked",
        message: `Parallel Search MCP taint sink denied: ${sink.reason}`,
        retryable: false,
      });
    }
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
      const truncated = resultsWereTruncated(payload.results);
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
        taintLabel: labelAtSource("mcp_result", {
          ref: payload.search_id,
          valueHash: contentHash,
          sensitivity: "public",
          instructionRisk: "data",
        }),
      };
    } catch (error) {
      throw providerError(error, bounded.signal);
    }
  }
}
