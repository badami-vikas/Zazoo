/**
 * Parallel Search REST adapter — LA3 Phase 2, Tier-2 `free_credentialed`.
 *
 * Phase 1 (ADR-111/141, TASK-023) wired only the ANONYMOUS Parallel Search MCP
 * endpoint: no account, no credential, no attribution. That is still the
 * default and still the first provider tried. This adapter is the deliberate
 * second rung of the ladder the LA3 provider survey laid out: same vendor,
 * same already-reviewed terms, but authenticated against the REST Search API
 * so the research lane keeps working when the anonymous endpoint rate-limits.
 *
 * Deliberately narrow:
 * - The API key is held by this adapter and NEVER leaves it. It is not logged,
 *   not hashed into provenance, not surfaced in errors, and not stored in the
 *   result. Provenance records that a credentialed provider was used, never
 *   which credential.
 * - `access` is `free_credentialed`, not `paid`. The router's admission policy
 *   refuses `paid` and `self_hosted` outright, so enabling this adapter can
 *   never silently become spend.
 * - Rights metadata mirrors the Phase-1 adapter's vendor review, with the
 *   credentialed-access restrictions added. Rights expire on the router's
 *   90-day clock exactly as Phase 1 does.
 */
import { performance } from "node:perf_hooks";

import {
  SearchProviderError,
  evaluateTaintSink,
  labelAtSource,
  normalizeSearchRequest,
  type SearchCitation,
  type SearchProvider,
  type SearchProviderResult,
  type SearchRequest,
} from "@bridge/core";
import { guardedFetch } from "@bridge/net-guard";

import {
  assertSearchPayload,
  decodeResponse,
  parseJson,
  providerError,
  requireSuccessfulStatus,
  resultsWereTruncated,
  safeWarnings,
  sha256,
  toCitation,
  type SearchFetchPort,
} from "./parallel-search-shared.js";

export const PARALLEL_SEARCH_API_PROVIDER_ID = "parallel-search-api";
export const PARALLEL_SEARCH_API_URL = "https://api.parallel.ai/v1beta/search";
export const PARALLEL_SEARCH_API_TERMS_URL = "https://parallel.ai/customer-terms";
export const PARALLEL_SEARCH_API_PRIVACY_URL = "https://parallel.ai/privacy-policy";
export const PARALLEL_SEARCH_API_RIGHTS_SOURCE_URL =
  "https://docs.parallel.ai/search-api/search-quickstart";
export const PARALLEL_SEARCH_API_RIGHTS_VERIFIED_AT = "2026-07-29T00:00:00.000Z";

const PARALLEL_API_ORIGIN = new URL(PARALLEL_SEARCH_API_URL).origin;
const MAX_REQUEST_BYTES = 16 * 1024;
const LABEL = "Parallel Search API";

export interface ParallelSearchApiProviderOptions {
  /**
   * The account API key. Required — this adapter has no anonymous mode; if a
   * deployment has no key it should simply not register this provider.
   */
  apiKey: string;
  fetch?: SearchFetchPort;
  nowMs?: () => number;
}

export class ParallelSearchApiProvider implements SearchProvider {
  readonly id = PARALLEL_SEARCH_API_PROVIDER_ID;
  readonly tier = 2 as const;
  readonly access = "free_credentialed" as const;
  readonly plane = "cloud" as const;
  readonly termsUrl = PARALLEL_SEARCH_API_TERMS_URL;
  readonly privacyUrl = PARALLEL_SEARCH_API_PRIVACY_URL;
  readonly rights = {
    status: "verified",
    verifiedAt: PARALLEL_SEARCH_API_RIGHTS_VERIFIED_AT,
    sourceUrl: PARALLEL_SEARCH_API_RIGHTS_SOURCE_URL,
    allowedDataScope: "public",
    restrictions: [
      "public-scope research only",
      "no cross-customer result cache or resale",
      "no training or benchmark publication from provider output",
      "private or personal data requires a separately approved DPA path",
      "credentialed access is attributable to a Bridge-held account; the key is never disclosed to a capability, a Skill, a prompt, or provenance",
      "free-tier quota only — any move to paid volume requires a fresh cost/ROI approval",
    ],
  } as const;

  readonly #apiKey: string;
  readonly #fetch: SearchFetchPort;
  readonly #nowMs: () => number;

  constructor(options: ParallelSearchApiProviderOptions) {
    const apiKey = options.apiKey.trim();
    if (apiKey.length === 0) {
      throw new SearchProviderError({
        providerId: PARALLEL_SEARCH_API_PROVIDER_ID,
        code: "access_blocked",
        message:
          "Parallel Search API provider requires an API key; register it only when a key is configured",
        retryable: false,
      });
    }
    this.#apiKey = apiKey;
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
        message: `${LABEL} taint sink denied: ${sink.reason}`,
        retryable: false,
      });
    }

    const deadline = this.#nowMs() + bounded.timeoutMs;
    const remainingTimeout = (): number => {
      if (bounded.signal?.aborted) {
        throw new SearchProviderError({
          providerId: this.id,
          code: "cancelled",
          message: `${LABEL} request was cancelled`,
          retryable: false,
        });
      }
      const remaining = deadline - this.#nowMs();
      if (remaining <= 0) {
        throw new SearchProviderError({
          providerId: this.id,
          code: "timeout",
          message: `${LABEL} exceeded the bounded search deadline`,
          retryable: true,
        });
      }
      return Math.max(1, Math.floor(remaining));
    };

    try {
      const result = await this.#fetch(PARALLEL_SEARCH_API_URL, {
        method: "POST",
        headers: {
          accept: "application/json",
          "accept-encoding": "identity",
          "content-type": "application/json",
          "x-api-key": this.#apiKey,
          "user-agent": "Bridge/0.2 governed-web-research",
        },
        body: JSON.stringify({
          objective: bounded.objective,
          search_queries: bounded.searchQueries,
          mode: "one-shot",
          max_results: bounded.maxResults,
        }),
        maxRequestBytes: MAX_REQUEST_BYTES,
        maxBytes: bounded.maxResponseBytes,
        timeoutMs: remainingTimeout(),
        maxRedirects: 0,
        allowedRedirectOrigins: [PARALLEL_API_ORIGIN],
        ...(bounded.signal ? { signal: bounded.signal } : {}),
      });

      const response = decodeResponse(this.id, LABEL, result, false, [
        "application/json",
      ]);
      requireSuccessfulStatus(this.id, LABEL, response);
      const payload = assertSearchPayload(
        this.id,
        LABEL,
        parseJson(this.id, response.body, `${LABEL} returned invalid JSON`),
      );

      const parsedCitations = payload.results.map((value) =>
        toCitation(this.id, value, bounded.requestedAt),
      );
      const dropped = parsedCitations.filter(
        (citation) => citation === null,
      ).length;
      const citations = parsedCitations
        .filter((citation): citation is SearchCitation => citation !== null)
        .slice(0, bounded.maxResults);
      if (payload.results.length > 0 && citations.length === 0) {
        throw new SearchProviderError({
          providerId: this.id,
          code: "degraded",
          message: `${LABEL} returned no valid citations`,
          retryable: true,
        });
      }

      const warnings = safeWarnings(payload.warnings);
      if (dropped > 0) {
        warnings.push(`${dropped} provider result(s) failed citation validation`);
      }
      if (resultsWereTruncated(payload.results)) {
        warnings.push("provider citation text was truncated to governed bounds");
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
          responseBytes: response.bytes,
          contentHash,
          rights: this.rights,
        },
        trustOrigin: "untrusted_external",
        taintLabel: labelAtSource("web_search", {
          ref: payload.search_id,
          valueHash: contentHash,
          sensitivity: "public",
          instructionRisk: "data",
        }),
      };
    } catch (error) {
      throw providerError(this.id, LABEL, error, bounded.signal);
    }
  }
}
