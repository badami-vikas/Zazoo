/**
 * N+1 sequential Gmail fetches (All fixes.md section 3): `GoogleApiGateway.fetchThreads`
 * previously did `threads.list` then a SEQUENTIAL `threads.get(format:"full")` per
 * thread — one round-trip at a time, no retry/backoff at all. This proves:
 *
 *   1. Per-thread fetches now run CONCURRENTLY (bounded), not one at a time — total
 *      wall time for N threads is far less than N * per-request latency, and more
 *      than one `threads.get` is observably in flight at once.
 *   2. A transient failure on one thread (fails once, succeeds on retry) does not
 *      abort the whole sync — the withRetry helper recovers it and every other
 *      thread's data still comes back.
 *   3. A thread that fails EVERY attempt is skipped (logged), not fatal to the sync.
 *
 * Uses `node:test`'s `mock.module` (Node >= 22) to intercept the `googleapis` import
 * that `gateway-google.ts` uses, so this drives the REAL `GoogleApiGateway` class
 * end-to-end with zero network/credentials.
 */
import { test, mock } from "node:test";
import assert from "node:assert/strict";
import type { GoogleApiGateway as GoogleApiGatewayType } from "../src/gateway-google.js";

interface FakeThreadsGetCall {
  id: string;
  startedAt: number;
  endedAt: number;
}

/** Re-imports gateway-google.ts with a cache-busting query so each test picks up ITS
 * OWN `t.mock.module("googleapis", ...)` rather than a previous test's cached mock
 * (the dynamic import is otherwise memoized by specifier). Typed explicitly since a
 * templated specifier loses static type inference. */
async function freshGatewayModule(): Promise<{ GoogleApiGateway: typeof GoogleApiGatewayType }> {
  return import(`../src/gateway-google.js?t=${Date.now()}-${Math.random()}`) as Promise<{
    GoogleApiGateway: typeof GoogleApiGatewayType;
  }>;
}

function b64(text: string): string {
  return Buffer.from(text, "utf8").toString("base64url");
}

function buildFakeGmailClient(opts: {
  threadIds: string[];
  getDelayMs: number;
  failOnceIds?: Set<string>;
  alwaysFailIds?: Set<string>;
  calls: FakeThreadsGetCall[];
  inFlight: { current: number; max: number };
}) {
  const attemptCounts = new Map<string, number>();
  return {
    users: {
      threads: {
        list: async () => ({ data: { threads: opts.threadIds.map((id) => ({ id })) } }),
        get: async ({ id }: { id: string }) => {
          opts.inFlight.current += 1;
          opts.inFlight.max = Math.max(opts.inFlight.max, opts.inFlight.current);
          const startedAt = Date.now();
          try {
            const attempt = (attemptCounts.get(id) ?? 0) + 1;
            attemptCounts.set(id, attempt);

            await new Promise((resolve) => setTimeout(resolve, opts.getDelayMs));

            if (opts.alwaysFailIds?.has(id)) {
              throw new Error(`dummy_ permanent failure fetching thread ${id}`);
            }
            if (opts.failOnceIds?.has(id) && attempt === 1) {
              throw new Error(`dummy_ transient failure fetching thread ${id} (attempt ${attempt})`);
            }

            opts.calls.push({ id, startedAt, endedAt: Date.now() });
            return {
              data: {
                historyId: `hist-${id}`,
                messages: [
                  {
                    id: `${id}-msg-1`,
                    internalDate: "1751500000000",
                    snippet: `dummy_ snippet for ${id}`,
                    payload: {
                      headers: [
                        { name: "From", value: "dummy_sender@example.com" },
                        { name: "Subject", value: `dummy_ subject ${id}` },
                        { name: "Date", value: "2026-07-05T00:00:00.000Z" },
                      ],
                      mimeType: "text/plain",
                      body: { data: b64(`dummy_ body ${id}`) },
                    },
                  },
                ],
              },
            };
          } finally {
            opts.inFlight.current -= 1;
          }
        },
      },
    },
    calendar: { events: { list: async () => ({ data: { items: [] } }) } },
  };
}

test("fetchThreads runs per-thread fetches CONCURRENTLY (bounded), tolerating a transient per-thread failure via retry", async (t) => {
  const threadIds = Array.from({ length: 12 }, (_, i) => `dummy_thread_${i}`);
  const calls: FakeThreadsGetCall[] = [];
  const inFlight = { current: 0, max: 0 };
  const failOnceIds = new Set([threadIds[3]!]);
  const fakeGmailClient = buildFakeGmailClient({ threadIds, getDelayMs: 40, failOnceIds, calls, inFlight });

  const googleapisMock = t.mock.module("googleapis", {
    namedExports: {
      google: {
        gmail: () => fakeGmailClient,
        calendar: () => ({ events: { list: async () => ({ data: { items: [] } }) } }),
      },
    },
  });

  const { GoogleApiGateway } = await freshGatewayModule();
  const gw = new GoogleApiGateway({} as never);

  const result = await gw.fetchThreads({ maxResults: threadIds.length });

  // All 12 threads came back (the one transient failure recovered via retry).
  assert.equal(result.threads.length, 12, "every thread — including the one that failed once — is present after retry");
  assert.deepEqual(
    result.threads.map((th) => th.threadId).sort(),
    [...threadIds].sort(),
  );

  // Concurrency proof: more than one `threads.get` call was in flight at the SAME
  // instant (counted from the fake client's own bookkeeping, not wall-clock timing —
  // deliberately load-independent so this doesn't flake under CI/parallel-test-suite
  // CPU contention, unlike an elapsed-time budget would). A sequential
  // one-at-a-time implementation can never have more than 1 in flight; bounded
  // concurrency (cap 15, all 12 threads fit in one batch) should overlap nearly all
  // of them.
  assert.ok(inFlight.max > 1, `expected overlapping in-flight requests (proof of concurrency), max observed was ${inFlight.max}`);
  assert.ok(
    inFlight.max >= 10,
    `expected most/all of the 12 threads' fetches to overlap (concurrency cap is 15), max observed was ${inFlight.max}`,
  );

  googleapisMock.restore();
});

test("fetchThreads skips a thread that fails every retry attempt instead of aborting the whole sync", async (t) => {
  const threadIds = ["dummy_thread_ok_1", "dummy_thread_bad", "dummy_thread_ok_2"];
  const calls: FakeThreadsGetCall[] = [];
  const inFlight = { current: 0, max: 0 };
  const alwaysFailIds = new Set(["dummy_thread_bad"]);
  const fakeGmailClient = buildFakeGmailClient({ threadIds, getDelayMs: 5, alwaysFailIds, calls, inFlight });

  const googleapisMock = t.mock.module("googleapis", {
    namedExports: {
      google: {
        gmail: () => fakeGmailClient,
        calendar: () => ({ events: { list: async () => ({ data: { items: [] } }) } }),
      },
    },
  });

  const { GoogleApiGateway } = await freshGatewayModule();
  const gw = new GoogleApiGateway({} as never);

  const result = await gw.fetchThreads({ maxResults: threadIds.length });

  assert.equal(result.threads.length, 2, "the permanently-failing thread is skipped; the other two still come back");
  assert.deepEqual(
    result.threads.map((th) => th.threadId).sort(),
    ["dummy_thread_ok_1", "dummy_thread_ok_2"],
  );

  googleapisMock.restore();
});
