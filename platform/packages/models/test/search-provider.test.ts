import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "node:test";

import {
  SearchProviderError,
  SearchProviderPolicyError,
  SearchProvidersUnavailableError,
  type SearchProvider,
  type SearchProviderHealth,
  type SearchProviderResult,
  type SearchRequest,
  hashTaintValue,
  labelAtSource,
  UNKNOWN_LABEL,
} from "@bridge/core";
import {
  ResponseTooLargeError,
  type GuardedFetchOptions,
  type GuardedFetchResult,
} from "@bridge/net-guard";
import {
  FreeDirectSearchProviderRouter,
  PARALLEL_SEARCH_PRIVACY_URL,
  PARALLEL_SEARCH_TERMS_URL,
  ParallelSearchProvider,
  type SearchFetchPort,
} from "../src/index.js";

const REQUEST: SearchRequest = {
  objective: "Find current public documentation",
  searchQueries: ["Bridge Living Software"],
  maxResults: 2,
  maxResponseBytes: 256 * 1024,
  maxProviderAttempts: 3,
  timeoutMs: 5_000,
  requestId: "request-1",
  requestedAt: "2026-07-18T00:00:00.000Z",
  taintLabel: labelAtSource("human_input", {
    ref: "request-1",
    valueHash: hashTaintValue("Find current public documentation"),
    sensitivity: "public",
    instructionRisk: "instruction_like",
  }),
};

function hash(value: string): string {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function result(provider: SearchProvider): SearchProviderResult {
  const citation = {
    url: "https://example.com/source",
    title: "Source",
    publishedAt: null,
    excerpts: ["evidence"],
    providerId: provider.id,
    retrievedAt: REQUEST.requestedAt,
    contentHash: hash(
      JSON.stringify({
        url: "https://example.com/source",
        title: "Source",
        excerpts: ["evidence"],
      }),
    ),
    trustOrigin: "untrusted_external" as const,
  };
  return {
    citations: [citation],
    warnings: [],
    provenance: {
      providerId: provider.id,
      providerTier: provider.tier,
      providerAccess: provider.access,
      providerRequestId: `${provider.id}-request`,
      termsUrl: provider.termsUrl,
      ...(provider.privacyUrl ? { privacyUrl: provider.privacyUrl } : {}),
      searchedAt: REQUEST.requestedAt,
      responseBytes: 100,
      contentHash: hash(JSON.stringify(citation)),
      rights: provider.rights,
    },
    trustOrigin: "untrusted_external",
  };
}

function provider(
  id: string,
  health: SearchProviderHealth,
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
    health: () => health,
    search,
  };
}

test("Parallel Search blocks unknown taint before network access", async () => {
  let calls = 0;
  const search = new ParallelSearchProvider({
    fetch: async () => {
      calls += 1;
      throw new Error("network must not be reached");
    },
  });
  await assert.rejects(
    () => search.search({ ...REQUEST, taintLabel: UNKNOWN_LABEL }),
    (error: unknown) =>
      error instanceof SearchProviderError &&
      error.code === "access_blocked",
  );
  assert.equal(calls, 0);
});

test("router selects deterministically by health then id and attributes failover", async () => {
  const called: string[] = [];
  const degraded = provider("a-degraded", "degraded", async () => {
    called.push("a-degraded");
    return result(degraded);
  });
  const unavailable = provider("b-unavailable", "healthy", async () => {
    called.push("b-unavailable");
    throw new SearchProviderError({
      providerId: "b-unavailable",
      code: "unavailable",
      message: "offline",
      retryable: true,
    });
  });
  const healthy = provider("c-healthy", "healthy", async () => {
    called.push("c-healthy");
    return result(healthy);
  });
  const router = new FreeDirectSearchProviderRouter(
    [degraded, healthy, unavailable],
    { now: () => Date.parse("2026-07-19T00:00:00.000Z") },
  );

  const outcome = await router.search(REQUEST);
  assert.deepEqual(called, ["b-unavailable", "c-healthy"]);
  assert.deepEqual(
    outcome.attempts.map((attempt) => [
      attempt.providerId,
      attempt.providerHealth,
      attempt.status,
    ]),
    [
      ["b-unavailable", "healthy", "unavailable"],
      ["c-healthy", "healthy", "succeeded"],
    ],
  );
  assert.equal(outcome.provenance.providerId, "c-healthy");
});

test("router honors the explicit provider-attempt budget and never reaches a later provider", async () => {
  let laterCalls = 0;
  const first = provider("first", "healthy", async () => {
    throw new SearchProviderError({
      providerId: "first",
      code: "degraded",
      message: "bad response",
      retryable: true,
    });
  });
  const later = provider("later", "unknown", async () => {
    laterCalls += 1;
    return result(later);
  });
  const router = new FreeDirectSearchProviderRouter([later, first], {
    now: () => Date.parse("2026-07-19T00:00:00.000Z"),
  });

  await assert.rejects(
    () => router.search({ ...REQUEST, maxProviderAttempts: 1 }),
    (error) => {
      assert.ok(error instanceof SearchProvidersUnavailableError);
      assert.deepEqual(
        error.attempts.map((attempt) => attempt.providerId),
        ["first"],
      );
      return true;
    },
  );
  assert.equal(laterCalls, 0);
});

test("router reports unavailable health without invoking the provider", async () => {
  let calls = 0;
  const offline = provider("offline", "unavailable", async () => {
    calls += 1;
    return result(offline);
  });
  const router = new FreeDirectSearchProviderRouter([offline], {
    now: () => Date.parse("2026-07-19T00:00:00.000Z"),
  });
  await assert.rejects(
    () => router.search(REQUEST),
    (error) => {
      assert.ok(error instanceof SearchProvidersUnavailableError);
      assert.equal(error.attempts[0]?.providerHealth, "unavailable");
      return true;
    },
  );
  assert.equal(calls, 0);
});

test("router validates bounds and cancellation before provider network access", async () => {
  let calls = 0;
  const bounded = provider("bounded", "healthy", async () => {
    calls += 1;
    return result(bounded);
  });
  const router = new FreeDirectSearchProviderRouter([bounded], {
    now: () => Date.parse("2026-07-19T00:00:00.000Z"),
  });
  await assert.rejects(
    () => router.search({ ...REQUEST, maxResponseBytes: 100 }),
    /maxResponseBytes/,
  );
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(
    () => router.search({ ...REQUEST, signal: controller.signal }),
    (error) =>
      error instanceof SearchProviderError && error.code === "cancelled",
  );
  assert.equal(calls, 0);
});

test("Phase 1 rejects paid, Tier-3, and stale-rights providers before search", () => {
  let calls = 0;
  const paid: SearchProvider = {
    ...provider("paid-provider", "healthy", async () => {
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

  const stale = provider("stale", "healthy", async () => result(stale));
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
  assert.equal(calls, 0);
});

function response(
  body: string,
  overrides: Partial<GuardedFetchResult> = {},
): GuardedFetchResult {
  return {
    finalUrl: "https://search.parallel.ai/mcp",
    status: 200,
    headers: { "content-type": "application/json" },
    body: Buffer.from(body),
    truncated: false,
    redirectCount: 0,
    hopOrigins: ["https://search.parallel.ai"],
    ...overrides,
  };
}

function parallelFetch(searchPayload: Record<string, unknown>): {
  fetch: SearchFetchPort;
  calls: Array<{ url: string; options?: GuardedFetchOptions }>;
} {
  const calls: Array<{ url: string; options?: GuardedFetchOptions }> = [];
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
      {
        headers: {
          "content-type": "application/json",
          "mcp-session-id": "session-1",
          "x-parallel-terms": PARALLEL_SEARCH_TERMS_URL,
          "x-parallel-privacy": PARALLEL_SEARCH_PRIVACY_URL,
        },
      },
    ),
    response("", { status: 202, headers: {}, body: Buffer.alloc(0) }),
    response(
      JSON.stringify({
        jsonrpc: "2.0",
        id: "request-1:search",
        result: {
          content: [
            { type: "text", text: JSON.stringify(searchPayload) },
          ],
          isError: false,
        },
      }),
    ),
  ];
  return {
    calls,
    fetch: async (url, options) => {
      calls.push({ url, ...(options ? { options } : {}) });
      const next = responses.shift();
      if (!next) throw new Error("test response queue exhausted");
      return next;
    },
  };
}

test("Parallel performs a bounded guarded MCP handshake and returns tainted hashed provenance", async () => {
  const fixture = parallelFetch({
    search_id: "parallel-request-1",
    results: [
      {
        url: "https://example.com/one",
        title: "One",
        publish_date: "2026-07-17",
        excerpts: ["first excerpt"],
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
    fetch: fixture.fetch,
    nowMs: () => 100,
  });

  const output = await provider.search(REQUEST);
  assert.equal(fixture.calls.length, 3);
  assert.equal(fixture.calls[0]?.url, "https://search.parallel.ai/mcp");
  assert.equal(fixture.calls[0]?.options?.method, "POST");
  assert.equal(fixture.calls[0]?.options?.maxRedirects, 0);
  assert.deepEqual(fixture.calls[0]?.options?.allowedRedirectOrigins, [
    "https://search.parallel.ai",
  ]);
  assert.equal(
    fixture.calls[1]?.options?.headers?.["mcp-session-id"],
    "session-1",
  );
  const searchEnvelope = JSON.parse(
    String(fixture.calls[2]?.options?.body ?? "{}"),
  );
  assert.deepEqual(searchEnvelope.params.arguments.search_queries, [
    "Bridge Living Software",
  ]);
  assert.equal(output.citations.length, 1);
  assert.equal(output.citations[0]?.providerId, "parallel-search-mcp");
  assert.equal(
    output.citations[0]?.publishedAt,
    "2026-07-17T00:00:00.000Z",
  );
  assert.match(output.citations[0]?.contentHash ?? "", /^sha256:/);
  assert.equal(output.provenance.rights.status, "verified");
  assert.match(output.provenance.contentHash, /^sha256:/);
  assert.equal(output.trustOrigin, "untrusted_external");
  assert.match(output.warnings[0] ?? "", /failed citation validation/);
});

test("Parallel accepts bounded SSE and rejects policy-header drift", async () => {
  const fixture = parallelFetch({
    search_id: "parallel-request-1",
    results: [],
    warnings: [{ message: "source coverage is limited" }],
  });
  const original = fixture.fetch;
  let call = 0;
  fixture.fetch = async (url, options) => {
    const result = await original(url, options);
    call += 1;
    if (call !== 3) return result;
    return {
      ...result,
      headers: { "content-type": "text/event-stream; charset=utf-8" },
      body: Buffer.from(`event: message\ndata: ${result.body.toString()}\n\n`),
    };
  };
  const provider = new ParallelSearchProvider({
    fetch: fixture.fetch,
    nowMs: () => 100,
  });
  const output = await provider.search(REQUEST);
  assert.deepEqual(output.warnings, ["source coverage is limited"]);

  const drift = parallelFetch({ search_id: "unused", results: [] });
  const driftOriginal = drift.fetch;
  let driftCall = 0;
  drift.fetch = async (url, options) => {
    const response = await driftOriginal(url, options);
    driftCall += 1;
    return driftCall === 1
      ? {
          ...response,
          headers: {
            ...response.headers,
            "x-parallel-terms": "https://parallel.ai/changed",
          },
        }
      : response;
  };
  await assert.rejects(
    () =>
      new ParallelSearchProvider({
        fetch: drift.fetch,
        nowMs: () => 100,
      }).search(REQUEST),
    (error) =>
      error instanceof SearchProviderError &&
      error.code === "access_blocked",
  );
  assert.equal(drift.calls.length, 1);
});

test("Parallel rejects compressed, invalid UTF-8, and over-budget responses", async () => {
  const cases: GuardedFetchResult[] = [
    response("{}", {
      headers: {
        "content-type": "application/json",
        "content-encoding": "gzip",
      },
    }),
    response("", {
      body: Buffer.from([0xc3, 0x28]),
    }),
  ];
  for (const invalid of cases) {
    const fetch: SearchFetchPort = async () => invalid;
    await assert.rejects(
      () =>
        new ParallelSearchProvider({ fetch, nowMs: () => 100 }).search(
          REQUEST,
        ),
      (error) =>
        error instanceof SearchProviderError &&
        error.code === "invalid_response",
    );
  }

  let observedMaxBytes = 0;
  const fetch: SearchFetchPort = async (_url, options) => {
    observedMaxBytes = options?.maxBytes ?? 0;
    throw new ResponseTooLargeError(observedMaxBytes);
  };
  await assert.rejects(
    () =>
      new ParallelSearchProvider({ fetch, nowMs: () => 100 }).search({
        ...REQUEST,
        maxResponseBytes: 2_048,
      }),
    (error) =>
      error instanceof SearchProviderError && error.code === "degraded",
  );
  assert.equal(observedMaxBytes, 2_048);
});
