import assert from "node:assert/strict";
import { test } from "node:test";

import {
  SearchProviderError,
  SearchProviderPolicyError,
  SearchProvidersUnavailableError,
  type SearchProvider,
  type SearchProviderResult,
  type SearchRequest,
} from "@bridge/core";
import {
  FreeDirectSearchProviderRouter,
  PARALLEL_SEARCH_PRIVACY_URL,
  PARALLEL_SEARCH_TERMS_URL,
  ParallelSearchProvider,
  type SafeHttpClientPort,
  type SafeHttpRequest,
  type SafeHttpResponse,
} from "../src/index.js";

const REQUEST: SearchRequest = {
  objective: "Find current public documentation",
  searchQueries: ["Bridge Living Software"],
  maxResults: 2,
  timeoutMs: 5_000,
  requestId: "request-1",
  requestedAt: "2026-07-18T00:00:00.000Z",
};

function result(provider: SearchProvider): SearchProviderResult {
  return {
    citations: [
      {
        url: "https://example.com/source",
        title: "Source",
        publishedAt: null,
        excerpts: ["evidence"],
        trustOrigin: "untrusted_external",
      },
    ],
    warnings: [],
    provenance: {
      providerId: provider.id,
      providerTier: provider.tier,
      providerAccess: provider.access,
      providerRequestId: `${provider.id}-request`,
      termsUrl: provider.termsUrl,
      ...(provider.privacyUrl ? { privacyUrl: provider.privacyUrl } : {}),
      searchedAt: REQUEST.requestedAt,
    },
    trustOrigin: "untrusted_external",
  };
}

function provider(
  id: string,
  search: SearchProvider["search"],
): SearchProvider {
  return {
    id,
    tier: 1,
    access: "free_direct",
    plane: "cloud",
    termsUrl: "https://example.com/terms",
    privacyUrl: "https://example.com/privacy",
    rights: {
      status: "verified",
      verifiedAt: "2026-07-18T00:00:00.000Z",
      sourceUrl: "https://example.com/access-docs",
      allowedDataScope: "public",
      restrictions: [],
    },
    search,
  };
}

test("SearchProvider router attributes unavailable and degraded failover attempts", async () => {
  const first = provider("first", async () => {
    throw new SearchProviderError({
      providerId: "first",
      code: "unavailable",
      message: "offline",
      retryable: true,
    });
  });
  const second = provider("second", async () => {
    throw new SearchProviderError({
      providerId: "second",
      code: "degraded",
      message: "invalid upstream result",
      retryable: true,
    });
  });
  const third = provider("third", async () => result(third));
  const router = new FreeDirectSearchProviderRouter(
    [first, second, third],
    { now: () => Date.parse("2026-07-19T00:00:00.000Z") },
  );

  const outcome = await router.search(REQUEST);
  assert.deepEqual(
    outcome.attempts.map((attempt) => [
      attempt.providerId,
      attempt.status,
      attempt.code,
    ]),
    [
      ["first", "unavailable", "unavailable"],
      ["second", "degraded", "degraded"],
      ["third", "succeeded", undefined],
    ],
  );
  assert.equal(outcome.provenance.providerId, "third");
});

test("SearchProvider router fails explicitly with attributable attempts when all providers fail", async () => {
  const unavailable = provider("unavailable", async () => {
    throw new SearchProviderError({
      providerId: "unavailable",
      code: "timeout",
      message: "timed out",
      retryable: true,
    });
  });
  const invalid = provider("invalid", async () => ({
    ...result(invalid),
    trustOrigin: "operator" as never,
  }));
  const router = new FreeDirectSearchProviderRouter(
    [unavailable, invalid],
    { now: () => Date.parse("2026-07-19T00:00:00.000Z") },
  );

  await assert.rejects(
    () => router.search(REQUEST),
    (error) => {
      assert.ok(error instanceof SearchProvidersUnavailableError);
      assert.deepEqual(
        error.attempts.map((attempt) => [
          attempt.providerId,
          attempt.status,
          attempt.code,
        ]),
        [
          ["unavailable", "unavailable", "timeout"],
          ["invalid", "degraded", "invalid_response"],
        ],
      );
      return true;
    },
  );
});

test("SearchProvider router validates request bounds before calling any provider", async () => {
  let calls = 0;
  const bounded = provider("bounded", async () => {
    calls += 1;
    return result(bounded);
  });
  const router = new FreeDirectSearchProviderRouter(
    [bounded],
    { now: () => Date.parse("2026-07-19T00:00:00.000Z") },
  );
  await assert.rejects(
    () =>
      router.search({
        ...REQUEST,
        searchQueries: ["a", "b", "c", "d"],
      }),
    /1-3/,
  );
  assert.equal(calls, 0);
});

test("Phase 1 rejects paid, Tier-3, and stale-rights providers before any search can run", () => {
  let calls = 0;
  const paid: SearchProvider = {
    ...provider("paid-provider", async () => {
      calls += 1;
      return result(paid);
    }),
    tier: 3,
    access: "paid",
  };
  assert.throws(
    () =>
      new FreeDirectSearchProviderRouter([paid], {
        now: () => Date.parse("2026-07-19T00:00:00.000Z"),
      }),
    SearchProviderPolicyError,
  );
  assert.equal(calls, 0);

  const stale = provider("stale", async () => result(stale));
  stale.rights = {
    ...stale.rights,
    verifiedAt: "2025-01-01T00:00:00.000Z",
  };
  assert.throws(
    () =>
      new FreeDirectSearchProviderRouter([stale], {
        now: () => Date.parse("2026-07-19T00:00:00.000Z"),
      }),
    /stale/,
  );
});

function response(
  body: string,
  overrides: Partial<SafeHttpResponse> = {},
): SafeHttpResponse {
  return {
    url: "https://search.parallel.ai/mcp",
    status: 200,
    headers: { "content-type": "application/json" },
    contentType: "application/json",
    body,
    ...overrides,
  };
}

function parallelHttp(
  searchPayload: Record<string, unknown>,
  initHeaders: Readonly<Record<string, string>> = {
    "content-type": "application/json",
    "mcp-session-id": "session-1",
    "x-parallel-terms": PARALLEL_SEARCH_TERMS_URL,
    "x-parallel-privacy": PARALLEL_SEARCH_PRIVACY_URL,
  },
): { http: SafeHttpClientPort; calls: SafeHttpRequest[] } {
  const calls: SafeHttpRequest[] = [];
  const responses = [
    response(
      JSON.stringify({
        jsonrpc: "2.0",
        id: "request-1:initialize",
        result: {
          protocolVersion: "2025-03-26",
          capabilities: {},
          serverInfo: { name: "Parallel", version: "1" },
        },
      }),
      { headers: initHeaders },
    ),
    response("", {
      status: 202,
      headers: {},
      contentType: null,
    }),
    response(
      JSON.stringify({
        jsonrpc: "2.0",
        id: "request-1:search",
        result: {
          content: [
            {
              type: "text",
              text: JSON.stringify(searchPayload),
            },
          ],
          isError: false,
        },
      }),
    ),
  ];
  return {
    calls,
    http: {
      async request(input) {
        calls.push(input);
        const next = responses.shift();
        if (!next) throw new Error("test fixture exhausted");
        return next;
      },
    },
  };
}

test("Parallel adapter performs the bounded MCP handshake and emits tainted citations with provenance", async () => {
  const fixture = parallelHttp({
    search_id: "parallel-request-1",
    results: [
      {
        url: "https://example.com/one",
        title: "One",
        publish_date: "2026-07-17T00:00:00.000Z",
        excerpts: ["first excerpt"],
      },
      {
        url: "http://example.org/two",
        title: "Two",
        publish_date: null,
        excerpts: ["second excerpt"],
      },
      {
        url: "http://127.0.0.1/private",
        title: "Blocked",
        publish_date: null,
        excerpts: ["must not pass"],
      },
    ],
    warnings: null,
  });
  const provider = new ParallelSearchProvider({
    http: fixture.http,
    nowMs: () => 100,
  });

  const output = await provider.search(REQUEST);
  assert.equal(fixture.calls.length, 3);
  assert.equal(
    fixture.calls[1]?.headers?.["mcp-session-id"],
    "session-1",
  );
  const searchEnvelope = JSON.parse(fixture.calls[2]?.body ?? "{}");
  assert.equal(searchEnvelope.params.name, "web_search");
  assert.deepEqual(searchEnvelope.params.arguments.search_queries, [
    "Bridge Living Software",
  ]);
  assert.equal("max_results" in searchEnvelope.params.arguments, false);
  assert.equal(output.trustOrigin, "untrusted_external");
  assert.equal(output.citations.length, 2);
  assert.ok(
    output.citations.every(
      (citation) => citation.trustOrigin === "untrusted_external",
    ),
  );
  assert.equal(output.provenance.providerRequestId, "parallel-request-1");
  assert.equal(output.provenance.termsUrl, PARALLEL_SEARCH_TERMS_URL);
  assert.equal(output.provenance.searchedAt, REQUEST.requestedAt);
  assert.match(output.warnings.at(-1) ?? "", /failed citation validation/);
});

test("Parallel adapter accepts bounded MCP SSE and selects its matching response", async () => {
  const calls: SafeHttpRequest[] = [];
  const headers = {
    "content-type": "text/event-stream",
    "mcp-session-id": "session-sse",
    "x-parallel-terms": PARALLEL_SEARCH_TERMS_URL,
    "x-parallel-privacy": PARALLEL_SEARCH_PRIVACY_URL,
  };
  const initialize = {
    jsonrpc: "2.0",
    id: "request-1:initialize",
    result: {
      protocolVersion: "2025-03-26",
      capabilities: {},
      serverInfo: { name: "Parallel", version: "1" },
    },
  };
  const notification = {
    jsonrpc: "2.0",
    method: "notifications/progress",
    params: { progress: 1 },
  };
  const searched = {
    jsonrpc: "2.0",
    id: "request-1:search",
    result: {
      content: [
        {
          type: "text",
          text: JSON.stringify({
            search_id: "parallel-sse-request",
            results: [
              {
                url: "https://example.com/sse",
                excerpts: ["bounded evidence"],
              },
            ],
            warnings: [
              {
                type: "provider_notice",
                message: "provider returned a bounded warning",
              },
            ],
          }),
        },
      ],
      isError: false,
    },
  };
  const responses = [
    response(`event: message\ndata: ${JSON.stringify(initialize)}\n\n`, {
      headers,
      contentType: "text/event-stream",
    }),
    response("", {
      status: 202,
      headers: {},
      contentType: null,
    }),
    response(
      `: keepalive\n\ndata: ${JSON.stringify(notification)}\n\nevent: message\ndata: ${JSON.stringify(searched)}\n\n`,
      { contentType: "text/event-stream" },
    ),
  ];
  const provider = new ParallelSearchProvider({
    http: {
      async request(input) {
        calls.push(input);
        const next = responses.shift();
        if (!next) throw new Error("test fixture exhausted");
        return next;
      },
    },
  });

  const output = await provider.search(REQUEST);

  assert.equal(output.provenance.providerRequestId, "parallel-sse-request");
  assert.equal(output.citations.length, 1);
  assert.equal(output.citations[0]?.title, null);
  assert.equal(output.citations[0]?.publishedAt, null);
  assert.deepEqual(output.warnings, ["provider returned a bounded warning"]);
  assert.deepEqual(calls[0]?.allowedContentTypes, [
    "application/json",
    "text/event-stream",
  ]);
  assert.deepEqual(calls[2]?.allowedContentTypes, [
    "application/json",
    "text/event-stream",
  ]);
});

test("Parallel adapter stops at a rights gate when provider policy headers change", async () => {
  const fixture = parallelHttp(
    { search_id: "unused", results: [] },
    {
      "content-type": "application/json",
      "mcp-session-id": "session-1",
      "x-parallel-terms": "https://parallel.ai/changed-terms",
      "x-parallel-privacy": PARALLEL_SEARCH_PRIVACY_URL,
    },
  );
  const provider = new ParallelSearchProvider({
    http: fixture.http,
    nowMs: () => 100,
  });
  await assert.rejects(
    () => provider.search(REQUEST),
    (error) =>
      error instanceof SearchProviderError && error.code === "access_blocked",
  );
  assert.equal(fixture.calls.length, 1);
});

test("Parallel adapter enforces one deadline across initialize, acknowledge, and search", async () => {
  const fixture = parallelHttp({ search_id: "unused", results: [] });
  const times = [0, 0, 5_001];
  const provider = new ParallelSearchProvider({
    http: fixture.http,
    nowMs: () => times.shift() ?? 5_001,
  });
  await assert.rejects(
    () => provider.search(REQUEST),
    (error) =>
      error instanceof SearchProviderError && error.code === "timeout",
  );
  assert.equal(fixture.calls.length, 1);
});
