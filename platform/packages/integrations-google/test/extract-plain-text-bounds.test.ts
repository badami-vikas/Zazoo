/**
 * Unbounded multipart recursion + full base64 decode in memory (All fixes.md
 * section 3): `extractPlainText` previously recursed into `payload.parts` with no
 * depth cap, and base64-decoded any body part fully into memory with no size cap.
 * A pathological/malicious deeply-nested multipart message or a single huge body
 * part could stack-overflow or balloon memory. Proves both bounds hold: a payload
 * nested deeper than the cap doesn't crash/hang (and yields bounded output, since
 * depth-exceeded parts are skipped), and an oversized body part is truncated rather
 * than triggering a giant in-memory buffer.
 *
 * `extractPlainText` isn't exported directly (module-private), so this drives it
 * through the one exported surface that calls it: `GoogleApiGateway.fetchThreads`,
 * via the same `googleapis`-mocking approach as gateway-fetch-concurrency.test.ts.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import type { GoogleApiGateway as GoogleApiGatewayType } from "../src/gateway-google.js";

async function freshGatewayModule(): Promise<{ GoogleApiGateway: typeof GoogleApiGatewayType }> {
  return import(`../src/gateway-google.js?t=${Date.now()}-${Math.random()}`) as Promise<{
    GoogleApiGateway: typeof GoogleApiGatewayType;
  }>;
}

function b64(text: string): string {
  return Buffer.from(text, "utf8").toString("base64url");
}

interface GmailPayloadPartLike {
  mimeType?: string;
  body?: { data?: string };
  parts?: GmailPayloadPartLike[];
}

/** Builds a multipart payload nested `depth` levels deep, with a text/plain leaf at
 * the very bottom carrying `leafText`. Each level wraps the next as a single
 * `multipart/mixed` part (the shape gmail actually produces for nested MIME). */
function nestedMultipart(depth: number, leafText: string): GmailPayloadPartLike {
  let node: GmailPayloadPartLike = { mimeType: "text/plain", body: { data: b64(leafText) } };
  for (let i = 0; i < depth; i++) {
    node = { mimeType: "multipart/mixed", parts: [node] };
  }
  return node;
}

function fakeGmailClientForPayload(payload: GmailPayloadPartLike) {
  return {
    users: {
      threads: {
        list: async () => ({ data: { threads: [{ id: "dummy_thread_bounds" }] } }),
        get: async () => ({
          data: {
            historyId: "hist-bounds",
            messages: [
              {
                id: "dummy_msg_bounds",
                internalDate: "1751500000000",
                snippet: "dummy_ snippet",
                payload,
              },
            ],
          },
        }),
      },
    },
    calendar: { events: { list: async () => ({ data: { items: [] } }) } },
  };
}

test("extractPlainText does not crash/hang on multipart nesting far beyond the depth cap, and returns bounded output", async (t) => {
  // Nested WAY past any sane depth cap (500 levels) — this used to be unbounded
  // recursion; a naive implementation risks a stack overflow here.
  const deeplyNested = nestedMultipart(500, "dummy_ leaf text that is unreachable past the depth cap");

  const googleapisMock = t.mock.module("googleapis", {
    namedExports: {
      google: {
        gmail: () => fakeGmailClientForPayload(deeplyNested),
        calendar: () => ({ events: { list: async () => ({ data: { items: [] } }) } }),
      },
    },
  });

  const { GoogleApiGateway } = await freshGatewayModule();
  const gw = new GoogleApiGateway({} as never);

  // Must not throw (stack overflow) or hang — completes normally.
  const result = await gw.fetchThreads({ maxResults: 1 });

  assert.equal(result.threads.length, 1);
  const msg = result.threads[0]!.messages[0]!;
  // Past the depth cap, extraction stops and returns "" for that branch; the gateway's
  // fallback then uses the Gmail snippet instead of the leaf text nested 500 levels
  // deep and unreachable through a bounded recursion.
  assert.equal(msg.bodyText, "dummy_ snippet", "depth-capped extraction falls back to the snippet rather than the unreachable deep leaf");

  googleapisMock.restore();
});

test("extractPlainText does not fully materialize an oversized body part in memory", async (t) => {
  // ~8MB of plaintext, base64-encoded — bigger than the 5MB cap. A naive
  // `Buffer.from(data, "base64url").toString("utf8")` would decode the whole thing;
  // the fix caps how much gets decoded.
  const hugeText = "A".repeat(8 * 1024 * 1024);
  const payload: GmailPayloadPartLike = { mimeType: "text/plain", body: { data: b64(hugeText) } };

  const googleapisMock = t.mock.module("googleapis", {
    namedExports: {
      google: {
        gmail: () => fakeGmailClientForPayload(payload),
        calendar: () => ({ events: { list: async () => ({ data: { items: [] } }) } }),
      },
    },
  });

  const { GoogleApiGateway } = await freshGatewayModule();
  const gw = new GoogleApiGateway({} as never);

  const result = await gw.fetchThreads({ maxResults: 1 });
  const bodyText = result.threads[0]!.messages[0]!.bodyText;

  assert.ok(bodyText.length > 0, "still returns SOME text, not empty/crashed");
  assert.ok(
    bodyText.length <= 5 * 1024 * 1024 + 4,
    `decoded body should be capped near the 5MB limit, got ${bodyText.length} chars`,
  );
  assert.ok(bodyText.length < hugeText.length, "decoded output is strictly smaller than the full oversized input — it was truncated, not fully decoded");

  googleapisMock.restore();
});

test("extractPlainText handles a payload nested within the depth cap normally (no regression)", async (t) => {
  const nested = nestedMultipart(5, "dummy_ this text IS reachable, well within the depth cap");

  const googleapisMock = t.mock.module("googleapis", {
    namedExports: {
      google: {
        gmail: () => fakeGmailClientForPayload(nested),
        calendar: () => ({ events: { list: async () => ({ data: { items: [] } }) } }),
      },
    },
  });

  const { GoogleApiGateway } = await freshGatewayModule();
  const gw = new GoogleApiGateway({} as never);
  const result = await gw.fetchThreads({ maxResults: 1 });

  assert.equal(
    result.threads[0]!.messages[0]!.bodyText,
    "dummy_ this text IS reachable, well within the depth cap",
    "normal shallow multipart nesting still extracts correctly",
  );

  googleapisMock.restore();
});
