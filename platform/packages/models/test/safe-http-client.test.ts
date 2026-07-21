import assert from "node:assert/strict";
import { test } from "node:test";

import {
  SafeHttpClient,
  SafeHttpError,
  createPinnedLookup,
  type RawHttpResponse,
  type SafeHttpTransport,
  type SafeTransportRequest,
} from "../src/safe-http-client.js";

const PUBLIC_ADDRESS = "93.184.216.34";
const publicResolver = async () =>
  [{ address: PUBLIC_ADDRESS, family: 4 as const }];

function jsonResponse(
  body: string,
  overrides: Partial<RawHttpResponse> = {},
): RawHttpResponse {
  return {
    status: 200,
    headers: { "content-type": "application/json" },
    body: new TextEncoder().encode(body),
    ...overrides,
  };
}

function recordingTransport(
  handler: (input: SafeTransportRequest) => RawHttpResponse | Promise<RawHttpResponse>,
): { transport: SafeHttpTransport; calls: SafeTransportRequest[] } {
  const calls: SafeTransportRequest[] = [];
  return {
    calls,
    transport: {
      async request(input) {
        calls.push(input);
        return handler(input);
      },
    },
  };
}

test("SafeHttpClient pins a public DNS answer and forces identity encoding", async () => {
  const recorded = recordingTransport(() => jsonResponse('{"ok":true}'));
  const client = new SafeHttpClient({
    resolver: publicResolver,
    transport: recorded.transport,
    allowedOrigins: ["https://example.com"],
  });

  test("pinned lookup honors Node all-address mode without re-resolving", async () => {
    const lookup = createPinnedLookup(PUBLIC_ADDRESS, 4);
    await new Promise<void>((resolve, reject) => {
      lookup("ignored.example", { all: true }, (error, addresses) => {
        if (error) {
          reject(error);
          return;
        }
        assert.deepEqual(addresses, [
          { address: PUBLIC_ADDRESS, family: 4 },
        ]);
        resolve();
      });
    });
  });

  const response = await client.request({
    url: "https://example.com/search",
    method: "POST",
    headers: { "content-type": "application/json" },
    body: "{}",
  });

  assert.equal(response.body, '{"ok":true}');
  assert.equal(recorded.calls[0]?.resolvedAddress, PUBLIC_ADDRESS);
  assert.equal(recorded.calls[0]?.headers["accept-encoding"], "identity");
  assert.equal(recorded.calls[0]?.headers["content-length"], "2");
});

test("SafeHttpClient blocks private, loopback, and mixed DNS answers before transport", async () => {
  for (const answers of [
    [{ address: "127.0.0.1", family: 4 as const }],
    [{ address: "169.254.169.254", family: 4 as const }],
    [
      { address: PUBLIC_ADDRESS, family: 4 as const },
      { address: "10.0.0.1", family: 4 as const },
    ],
    [{ address: "::1", family: 6 as const }],
    [{ address: PUBLIC_ADDRESS, family: 6 as const }],
  ]) {
    const recorded = recordingTransport(() => jsonResponse("{}"));
    const client = new SafeHttpClient({
      resolver: async () => answers,
      transport: recorded.transport,
      allowedOrigins: ["https://example.com"],
    });
    await assert.rejects(
      () =>
        client.request({
          url: "https://example.com/search",
          method: "GET",
        }),
      (error) =>
        error instanceof SafeHttpError && error.code === "blocked_address",
    );
    assert.equal(recorded.calls.length, 0);
  }
});

test("SafeHttpClient rejects local hostnames, credentials, plaintext, and unlisted origins", async () => {
  const recorded = recordingTransport(() => jsonResponse("{}"));
  const client = new SafeHttpClient({
    resolver: publicResolver,
    transport: recorded.transport,
    allowedOrigins: ["https://example.com"],
  });
  for (const url of [
    "https://localhost/search",
    "https://user:pass@example.com/search",
    "http://example.com/search",
    "https://other.example/search",
  ]) {
    await assert.rejects(
      () => client.request({ url, method: "GET" }),
      SafeHttpError,
    );
  }
  assert.equal(recorded.calls.length, 0);
});

test("SafeHttpClient blocks redirects by default and never follows cross-origin redirects", async () => {
  const defaultRedirect = recordingTransport(() =>
    jsonResponse("", {
      status: 302,
      headers: { location: "https://example.com/next" },
      body: new Uint8Array(),
    }),
  );
  const defaultClient = new SafeHttpClient({
    resolver: publicResolver,
    transport: defaultRedirect.transport,
    allowedOrigins: ["https://example.com"],
  });
  await assert.rejects(
    () =>
      defaultClient.request({
        url: "https://example.com/start",
        method: "GET",
        allowEmptyBody: true,
      }),
    (error) =>
      error instanceof SafeHttpError && error.code === "redirect_blocked",
  );

  const crossOrigin = recordingTransport(() =>
    jsonResponse("", {
      status: 302,
      headers: { location: "https://other.example/next" },
      body: new Uint8Array(),
    }),
  );
  const redirectClient = new SafeHttpClient({
    resolver: publicResolver,
    transport: crossOrigin.transport,
    allowedOrigins: ["https://example.com", "https://other.example"],
    maxRedirects: 1,
  });
  await assert.rejects(
    () =>
      redirectClient.request({
        url: "https://example.com/start",
        method: "GET",
        maxRedirects: 1,
        allowEmptyBody: true,
      }),
    (error) =>
      error instanceof SafeHttpError && error.code === "redirect_blocked",
  );
  assert.equal(crossOrigin.calls.length, 1);
});

test("SafeHttpClient re-resolves every explicitly allowed same-origin redirect", async () => {
  let resolutions = 0;
  const recorded = recordingTransport((input) =>
    input.url.pathname === "/start"
      ? {
          status: 302,
          headers: { location: "/next" },
          body: new Uint8Array(),
        }
      : jsonResponse('{"done":true}'),
  );
  const client = new SafeHttpClient({
    resolver: async () => {
      resolutions += 1;
      return [{ address: PUBLIC_ADDRESS, family: 4 }];
    },
    transport: recorded.transport,
    allowedOrigins: ["https://example.com"],
    maxRedirects: 1,
  });

  test("SafeHttpClient rejects an invalid redirect Location", async () => {
    const recorded = recordingTransport(() => ({
      status: 302,
      headers: { location: "http://[" },
      body: new Uint8Array(),
    }));
    const client = new SafeHttpClient({
      resolver: publicResolver,
      transport: recorded.transport,
      allowedOrigins: ["https://example.com"],
      maxRedirects: 1,
    });
    await assert.rejects(
      () =>
        client.request({
          url: "https://example.com/start",
          method: "GET",
          maxRedirects: 1,
        }),
      (error) =>
        error instanceof SafeHttpError && error.code === "redirect_blocked",
    );
  });
  const response = await client.request({
    url: "https://example.com/start",
    method: "GET",
    maxRedirects: 1,
  });
  assert.equal(response.body, '{"done":true}');
  assert.equal(resolutions, 2);
  assert.equal(recorded.calls.length, 2);
});

test("SafeHttpClient enforces response bytes, content type, encoding, and UTF-8", async () => {
  const cases: Array<{
    response: RawHttpResponse;
    code: SafeHttpError["code"];
    maxResponseBytes?: number;
  }> = [
    {
      response: jsonResponse("12345"),
      maxResponseBytes: 4,
      code: "response_too_large",
    },
    {
      response: jsonResponse("ok", {
        headers: { "content-type": "text/html" },
      }),
      code: "invalid_content_type",
    },
    {
      response: jsonResponse("ok", {
        headers: {
          "content-type": "application/json",
          "content-encoding": "gzip",
        },
      }),
      code: "invalid_encoding",
    },
    {
      response: jsonResponse("", {
        body: Uint8Array.from([0xc3, 0x28]),
      }),
      code: "invalid_encoding",
    },
  ];

  for (const item of cases) {
    const recorded = recordingTransport(() => item.response);
    const client = new SafeHttpClient({
      resolver: publicResolver,
      transport: recorded.transport,
      allowedOrigins: ["https://example.com"],
      maxResponseBytes: item.maxResponseBytes ?? 1024,
    });
    await assert.rejects(
      () =>
        client.request({
          url: "https://example.com/search",
          method: "GET",
          ...(item.maxResponseBytes
            ? { maxResponseBytes: item.maxResponseBytes }
            : {}),
        }),
      (error) => error instanceof SafeHttpError && error.code === item.code,
    );
  }
});

test("SafeHttpClient applies the timeout to DNS resolution", async () => {
  const client = new SafeHttpClient({
    resolver: () => new Promise(() => undefined),
    transport: recordingTransport(() => jsonResponse("{}")).transport,
    allowedOrigins: ["https://example.com"],
    timeoutMs: 20,
  });
  await assert.rejects(
    () =>
      client.request({
        url: "https://example.com/search",
        method: "GET",
        timeoutMs: 20,
      }),
    (error) => error instanceof SafeHttpError && error.code === "timeout",
  );
});
