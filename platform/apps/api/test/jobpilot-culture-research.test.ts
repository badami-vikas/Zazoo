/**
 * jobpilot.cultureResearch (TASK-011, JP3B) — two-phase culture research with
 * durable, fail-closed fetch intents. Proves:
 *
 *  1. Only server-owned `sourceId`s are accepted; forged ids fail closed.
 *  2. `propose` is side-effect-free; non-permitted sources are skipped and no
 *     fetch happens during propose.
 *  3. `materialize` refuses unapproved/vetoed proposals.
 *  4. Approved fetches are SSRF-guarded, idempotent, and restart-durable.
 *  5. Missing or mismatched `(proposalId, childRunId)` pairs never reconstruct.
 *  6. Cancellation is CAS-safe: before-start, in-flight, and after-fetch cases
 *     all land in the correct final state.
 *  7. Synthesis grounds only against this exact parent run's fetched artifacts
 *     and exposes approved results via `synthesisResult`.
 *  8. Direct Human invocation of both governed Skills still fails closed.
 */
import assert from "node:assert/strict";
import * as http from "node:http";
import type { AddressInfo } from "node:net";
import test from "node:test";
import { TRPCError } from "@trpc/server";
import { SeededRng, SystemClock, UuidGen, type RunCtx } from "@bridge/core";
import { MAX_CULTURE_SOURCES_PER_RUN } from "@bridge/jobpilot";
import { appRouter } from "../src/router.js";
import {
  INTERNAL_STRATEGIST_AGENT,
  LEARNING_AGENT,
  PILOT_USER,
  PILOT_WORKSPACE,
  buildWiring,
  cancelCultureSourceFetch,
  materializeCultureSourceFetch,
  unsafeRegisterTestOnlyCultureSource,
  DurableCultureFetchStore,
  type Wiring,
} from "../src/wiring.js";

function makeRun(seed = 1): RunCtx {
  const clock = new SystemClock();
  const rng = new SeededRng(seed);
  return { clock, rng, ids: new UuidGen(clock, rng) };
}

function makeCaller(
  wiring: Wiring,
  identity: { type: "user" | "team"; id: string } = { type: "user", id: PILOT_USER },
) {
  return appRouter.createCaller({
    wiring,
    run: makeRun(),
    identity,
    authenticated: true,
    verifying: false,
  });
}

function cultureFetchDeps(wiring: Wiring) {
  return {
    childAgentRuns: wiring.childAgentRuns,
    ledger: wiring.ledger,
    fetchStore: wiring.cultureFetchStore,
    abortControllers: wiring.cultureFetchAbortControllers,
  };
}

/**
 * TASK-011 remediation (2026-07-19 coordinator distributed-defects review,
 * issues 2/3) — builds a `materializeCultureSourceFetch`/`cancelCultureSourceFetch`
 * deps object that simulates a GENUINELY DIFFERENT API instance: a fresh
 * `DurableCultureFetchStore` wrapping the SAME underlying `memoryStore` (so
 * durable state is truly shared, exactly as it would be across two processes
 * sharing one Postgres database), but its OWN EMPTY `abortControllers` Map —
 * this second "instance" has never seen this childRunId's in-flight fetch
 * and holds no process-local AbortController for it at all. Any test using
 * this MUST rely purely on the durable `cancelRequested` flag + poll loop to
 * prove cancellation is genuinely distributed, not merely in-process.
 */
function otherInstanceDeps(wiring: Wiring) {
  return {
    childAgentRuns: wiring.childAgentRuns,
    ledger: wiring.ledger,
    fetchStore: new DurableCultureFetchStore(wiring.memoryStore),
    abortControllers: new Map<string, AbortController>(),
  };
}

const TEST_COMPANY = "test_fixture Co";
const OTHER_COMPANY = "test_fixture Other Co";
const NONEXISTENT_PROPOSAL_ID = "00000000-0000-7000-8000-000000000001";
const NONEXISTENT_CHILD_RUN_ID = "00000000-0000-7000-8000-000000000002";

async function startTestServer(
  handler: http.RequestListener,
): Promise<{ url: string; port: number; close: () => Promise<void> }> {
  const server = http.createServer(handler);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as AddressInfo).port;
  return {
    url: `http://127.0.0.1:${port}/culture`,
    port,
    close: () => new Promise((resolve) => server.close(() => resolve())),
  };
}

let testSourceCounter = 0;
function registerTestSource(
  url: string,
  sourceType: "company_official_page" | "glassdoor" | "reddit" | "google_reviews" = "company_official_page",
  company: string = TEST_COMPANY,
) {
  testSourceCounter += 1;
  const id = `test-fixture-source-${testSourceCounter}`;
  unsafeRegisterTestOnlyCultureSource({
    id,
    workspaceId: PILOT_WORKSPACE,
    company,
    sourceType,
    sourceLabel: `test_fixture source ${testSourceCounter}`,
    url,
    allowedRedirectOrigins: [new URL(url).origin],
  });
  return id;
}

const allowLoopback = { isBlockedIp: (ip: string) => ip !== "127.0.0.1" };

test("cultureResearch.propose: an unknown source id is rejected with zero network access and no child Run", async () => {
  const wiring = await buildWiring();
  try {
    const caller = makeCaller(wiring);
    await assert.rejects(
      () => caller.jobpilot.cultureResearch.propose({ workspaceId: PILOT_WORKSPACE, company: TEST_COMPANY, sourceIds: ["not-a-real-id"] }),
      /unknown or unauthorized source id/,
    );
  } finally {
    await wiring.close();
  }
});

test("cultureResearch.propose: a real source id requested under the wrong company is rejected", async () => {
  const wiring = await buildWiring();
  try {
    const caller = makeCaller(wiring);
    await assert.rejects(
      () =>
        caller.jobpilot.cultureResearch.propose({
          workspaceId: PILOT_WORKSPACE,
          company: "A Totally Different Company",
          sourceIds: ["bcg-careers-interview-process"],
        }),
      /unknown or unauthorized source id/,
    );
  } finally {
    await wiring.close();
  }
});

test("cultureResearch.propose: requesting more than MAX_CULTURE_SOURCES_PER_RUN distinct ids is rejected", async () => {
  const wiring = await buildWiring();
  try {
    const caller = makeCaller(wiring);
    const ids = Array.from({ length: MAX_CULTURE_SOURCES_PER_RUN + 1 }, (_, i) => registerTestSource(`http://127.0.0.1:1/${i}`));
    await assert.rejects(
      () => caller.jobpilot.cultureResearch.propose({ workspaceId: PILOT_WORKSPACE, company: TEST_COMPANY, sourceIds: ids }),
      /at most \d+ sources/,
    );
  } finally {
    await wiring.close();
  }
});

test("cultureResearch.propose: duplicate ids are deduped and do not count twice against the cap", async () => {
  const wiring = await buildWiring();
  try {
    const caller = makeCaller(wiring);
    const id = registerTestSource("http://127.0.0.1:1/dup");
    const result = await caller.jobpilot.cultureResearch.propose({
      workspaceId: PILOT_WORKSPACE,
      company: TEST_COMPANY,
      sourceIds: [id, id, id],
    });
    assert.equal(typeof result.parentRunId, "string");
    assert.equal(result.pending.length, 1);
  } finally {
    await wiring.close();
  }
});

test("cultureResearch.propose: non-permitted source types are skipped and propose itself performs no fetch", async () => {
  const wiring = await buildWiring();
  try {
    const caller = makeCaller(wiring);
    const permittedId = registerTestSource("http://127.0.0.1:1/permitted", "company_official_page");
    const glassdoorId = registerTestSource("http://127.0.0.1:1/glassdoor", "glassdoor");
    const redditId = registerTestSource("http://127.0.0.1:1/reddit", "reddit");
    const googleId = registerTestSource("http://127.0.0.1:1/google", "google_reviews");

    const result = await caller.jobpilot.cultureResearch.propose({
      workspaceId: PILOT_WORKSPACE,
      company: TEST_COMPANY,
      sourceIds: [permittedId, glassdoorId, redditId, googleId],
    });
    assert.equal(result.pending.length, 1);
    assert.equal(result.pending[0]?.sourceId, permittedId);
    assert.equal(result.skipped.length, 3);
    assert.deepEqual(result.skipped.map((s) => s.sourceType).sort(), ["glassdoor", "google_reviews", "reddit"]);
    for (const skipped of result.skipped) assert.ok(skipped.reason.length > 0);

    const pending = result.pending[0]!;
    const status = await caller.jobpilot.cultureResearch.status({
      workspaceId: PILOT_WORKSPACE,
      proposalId: pending.proposalId,
      childRunId: pending.childRunId,
    });
    assert.equal(status.status, "pending");
    assert.equal(status.artifact, undefined);
  } finally {
    await wiring.close();
  }
});

test("cultureResearch.materialize: refuses to fetch an unapproved proposal", async () => {
  const wiring = await buildWiring();
  try {
    const caller = makeCaller(wiring);
    const id = registerTestSource("http://127.0.0.1:1/never-decided");
    const proposed = await caller.jobpilot.cultureResearch.propose({ workspaceId: PILOT_WORKSPACE, company: TEST_COMPANY, sourceIds: [id] });
    const { proposalId, childRunId } = proposed.pending[0]!;
    await assert.rejects(
      () => caller.jobpilot.cultureResearch.materialize({ workspaceId: PILOT_WORKSPACE, proposalId, childRunId }),
      /not in an approved state/,
    );
  } finally {
    await wiring.close();
  }
});

test("cultureResearch.materialize: refuses to fetch a vetoed proposal", async () => {
  const wiring = await buildWiring();
  try {
    const caller = makeCaller(wiring);
    const id = registerTestSource("http://127.0.0.1:1/vetoed");
    const proposed = await caller.jobpilot.cultureResearch.propose({ workspaceId: PILOT_WORKSPACE, company: TEST_COMPANY, sourceIds: [id] });
    const { proposalId, childRunId } = proposed.pending[0]!;
    await caller.action.decide({ proposalId, decision: "veto" });
    await assert.rejects(
      () => caller.jobpilot.cultureResearch.materialize({ workspaceId: PILOT_WORKSPACE, proposalId, childRunId }),
      /not in an approved state/,
    );
  } finally {
    await wiring.close();
  }
});

test("cultureResearch.materialize via the router still hits the real SSRF guard", async () => {
  const wiring = await buildWiring();
  try {
    const caller = makeCaller(wiring);
    const id = registerTestSource("http://127.0.0.1:1/blocked-by-real-guard");
    const proposed = await caller.jobpilot.cultureResearch.propose({ workspaceId: PILOT_WORKSPACE, company: TEST_COMPANY, sourceIds: [id] });
    const { proposalId, childRunId } = proposed.pending[0]!;
    await caller.action.decide({ proposalId, decision: "approve" });
    await assert.rejects(
      () => caller.jobpilot.cultureResearch.materialize({ workspaceId: PILOT_WORKSPACE, proposalId, childRunId }),
      /SSRF blocked/,
    );
  } finally {
    await wiring.close();
  }
});

test("materializeCultureSourceFetch: approved fetch succeeds exactly once and is idempotent on retry", async () => {
  let requestCount = 0;
  const server = await startTestServer((_req, res) => {
    requestCount += 1;
    res.writeHead(200, { "content-type": "text/plain" });
    res.end("Culture, Values, And Inclusion — test_fixture content.");
  });
  const wiring = await buildWiring();
  try {
    const caller = makeCaller(wiring);
    const id = registerTestSource(server.url);
    const proposed = await caller.jobpilot.cultureResearch.propose({ workspaceId: PILOT_WORKSPACE, company: TEST_COMPANY, sourceIds: [id] });
    const { proposalId, childRunId } = proposed.pending[0]!;
    await caller.action.decide({ proposalId, decision: "approve" });

    const record1 = await materializeCultureSourceFetch(cultureFetchDeps(wiring), PILOT_WORKSPACE, proposalId, childRunId, makeRun(), allowLoopback);
    assert.equal(record1.status, "fetched");
    assert.ok(record1.artifact?.content.includes("Culture, Values, And Inclusion"));
    assert.equal(typeof record1.artifact?.contentHash, "string");
    assert.equal(requestCount, 1);

    const record2 = await materializeCultureSourceFetch(cultureFetchDeps(wiring), PILOT_WORKSPACE, proposalId, childRunId, makeRun(), allowLoopback);
    assert.equal(record2.status, "fetched");
    assert.equal(record2.artifact?.contentHash, record1.artifact?.contentHash);
    assert.equal(requestCount, 1, "a second materialize call must not refetch");

    const childRun = await wiring.childAgentRuns.get(PILOT_WORKSPACE, childRunId);
    assert.equal(childRun?.status, "completed");
  } finally {
    await server.close();
    await wiring.close();
  }
});

test("culture fetch intent records survive a fresh DurableCultureFetchStore wrapping the SAME underlying memoryStore (proves persistence isn't an in-process cache — a genuine restart with a real Wiring rebuild against the same on-disk DB hits a pre-existing, unrelated migration-rerun limitation in buildInMemoryPorts, not anything this store introduces)", async () => {
  const wiring = await buildWiring();
  try {
    const caller = makeCaller(wiring);
    const id = registerTestSource("http://127.0.0.1:1/durable");
    const proposed = await caller.jobpilot.cultureResearch.propose({ workspaceId: PILOT_WORKSPACE, company: TEST_COMPANY, sourceIds: [id] });
    const { proposalId, childRunId } = proposed.pending[0]!;
    const original = await wiring.cultureFetchStore.getByProposal(PILOT_WORKSPACE, proposalId, childRunId);
    assert.ok(original, "first store instance should persist the durable intent record");

    // A SECOND, independent `DurableCultureFetchStore` instance wrapping the
    // SAME `memoryStore` port (not the same JS object as `wiring.cultureFetchStore`)
    // must see the identical record — this proves the record lives in the
    // durable `memoryStore` port itself, not in any in-process cache private
    // to the first store instance.
    const independentStore = new DurableCultureFetchStore(wiring.memoryStore);
    const reloaded = await independentStore.get(PILOT_WORKSPACE, childRunId);
    assert.deepEqual(reloaded, original);
  } finally {
    await wiring.close();
  }
});

test("materializeCultureSourceFetch fails closed on a syntactically valid but nonexistent intent record", async () => {
  const wiring = await buildWiring();
  try {
    await assert.rejects(
      () =>
        materializeCultureSourceFetch(
          cultureFetchDeps(wiring),
          PILOT_WORKSPACE,
          NONEXISTENT_PROPOSAL_ID,
          NONEXISTENT_CHILD_RUN_ID,
          makeRun(),
          allowLoopback,
        ),
      /unknown or mismatched culture-fetch intent/,
    );
  } finally {
    await wiring.close();
  }
});

test("cancelCultureSourceFetch fails closed on a syntactically valid but nonexistent intent record", async () => {
  const wiring = await buildWiring();
  try {
    await assert.rejects(
      () =>
        cancelCultureSourceFetch(
          cultureFetchDeps(wiring),
          PILOT_WORKSPACE,
          NONEXISTENT_PROPOSAL_ID,
          NONEXISTENT_CHILD_RUN_ID,
          { type: "user", id: PILOT_USER },
          makeRun(),
        ),
      /unknown or mismatched culture-fetch intent/,
    );
  } finally {
    await wiring.close();
  }
});

test("cancelCultureSourceFetch before any fetch guarantees materialize can never proceed afterward", async () => {
  let requestCount = 0;
  const server = await startTestServer((_req, res) => {
    requestCount += 1;
    res.end("should never be reached");
  });
  const wiring = await buildWiring();
  try {
    const caller = makeCaller(wiring);
    const id = registerTestSource(server.url);
    const proposed = await caller.jobpilot.cultureResearch.propose({ workspaceId: PILOT_WORKSPACE, company: TEST_COMPANY, sourceIds: [id] });
    const { proposalId, childRunId } = proposed.pending[0]!;
    await caller.action.decide({ proposalId, decision: "approve" });

    const cancelled = await cancelCultureSourceFetch(
      cultureFetchDeps(wiring),
      PILOT_WORKSPACE,
      proposalId,
      childRunId,
      { type: "user", id: PILOT_USER },
      makeRun(),
    );
    assert.equal(cancelled.status, "cancelled");

    const afterCancel = await materializeCultureSourceFetch(cultureFetchDeps(wiring), PILOT_WORKSPACE, proposalId, childRunId, makeRun(), allowLoopback);
    assert.equal(afterCancel.status, "cancelled");
    assert.equal(requestCount, 0);
    const childRun = await wiring.childAgentRuns.get(PILOT_WORKSPACE, childRunId);
    assert.equal(childRun?.status, "cancelled");
  } finally {
    await server.close();
    await wiring.close();
  }
});

test("cancelCultureSourceFetch aborts a real in-flight fetch and leaves the final record cancelled", async () => {
  let serverSawClose = false;
  const server = await startTestServer((req, res) => {
    res.writeHead(200, { "content-type": "text/plain" });
    res.write("partial");
    req.on("close", () => {
      serverSawClose = true;
    });
  });
  const wiring = await buildWiring();
  try {
    const caller = makeCaller(wiring);
    const id = registerTestSource(server.url);
    const proposed = await caller.jobpilot.cultureResearch.propose({ workspaceId: PILOT_WORKSPACE, company: TEST_COMPANY, sourceIds: [id] });
    const { proposalId, childRunId } = proposed.pending[0]!;
    await caller.action.decide({ proposalId, decision: "approve" });

    const materializePromise = materializeCultureSourceFetch(cultureFetchDeps(wiring), PILOT_WORKSPACE, proposalId, childRunId, makeRun(), allowLoopback);
    await new Promise((resolve) => setTimeout(resolve, 60));

    const cancelled = await cancelCultureSourceFetch(
      cultureFetchDeps(wiring),
      PILOT_WORKSPACE,
      proposalId,
      childRunId,
      { type: "user", id: PILOT_USER },
      makeRun(),
    );
    // TASK-011 remediation (2026-07-19 distributed-defects review) — a live
    // lease is held (materialize has been running 60ms); cancel can only
    // durably REQUEST cancellation, not force an immediate synchronous
    // "cancelled" outcome — the WORKER holding the lease (this process, via
    // its AbortController or its distributed-cancellation poll) is what
    // actually transitions the record, matching the guarantee that must
    // also hold when the lease is held by a genuinely different instance.
    assert.equal(cancelled.cancelRequested, true);

    const materialized = await materializePromise;
    assert.equal(materialized.status, "cancelled");
    await new Promise((resolve) => setTimeout(resolve, 100));
    assert.equal(serverSawClose, true, "the server should observe the aborted connection actually close");

    const finalRecord = await wiring.cultureFetchStore.getByProposal(PILOT_WORKSPACE, proposalId, childRunId);
    assert.equal(finalRecord?.status, "cancelled");
    const childRun = await wiring.childAgentRuns.get(PILOT_WORKSPACE, childRunId);
    assert.equal(childRun?.status, "cancelled");
  } finally {
    await server.close();
    await wiring.close();
  }
});

test("distributed cancellation: a SECOND, independent instance (own DurableCultureFetchStore wrapping the same memoryStore, own EMPTY abortControllers map — no in-process AbortController for this fetch at all) can still stop the fetch a FIRST instance is holding the live socket for (TASK-011 remediation, 2026-07-19 coordinator distributed-defects review, issue 2)", async () => {
  let serverSawClose = false;
  const server = await startTestServer((_req, res) => {
    res.writeHead(200, { "content-type": "text/plain" });
    res.write("partial");
    _req.on("close", () => {
      serverSawClose = true;
    });
  });
  const wiring = await buildWiring();
  try {
    const caller = makeCaller(wiring);
    const id = registerTestSource(server.url);
    const proposed = await caller.jobpilot.cultureResearch.propose({ workspaceId: PILOT_WORKSPACE, company: TEST_COMPANY, sourceIds: [id] });
    const { proposalId, childRunId } = proposed.pending[0]!;
    await caller.action.decide({ proposalId, decision: "approve" });

    // Instance A holds the live socket via ITS OWN deps/abortControllers map.
    const instanceADeps = cultureFetchDeps(wiring);
    const materializePromise = materializeCultureSourceFetch(instanceADeps, PILOT_WORKSPACE, proposalId, childRunId, makeRun(), allowLoopback);
    await new Promise((resolve) => setTimeout(resolve, 60));
    assert.ok(instanceADeps.abortControllers.has(childRunId), "instance A should have registered a live AbortController for this childRunId");

    // Instance B — a GENUINELY DIFFERENT deps object with its OWN, EMPTY
    // abortControllers Map — cancels. It has NO local AbortController to
    // abort; the ONLY mechanism available to it is the durable
    // `cancelRequested` flag, which instance A's poll loop must notice.
    const instanceBDeps = otherInstanceDeps(wiring);
    assert.equal(instanceBDeps.abortControllers.has(childRunId), false, "instance B must start with genuinely no knowledge of this fetch");
    const cancelled = await cancelCultureSourceFetch(instanceBDeps, PILOT_WORKSPACE, proposalId, childRunId, { type: "user", id: PILOT_USER }, makeRun());
    assert.equal(cancelled.cancelRequested, true);

    const materialized = await materializePromise;
    assert.equal(materialized.status, "cancelled");
    await new Promise((resolve) => setTimeout(resolve, 100));
    assert.equal(serverSawClose, true, "instance A's poll loop must have aborted its own live socket in response to instance B's durable flag");

    const finalRecord = await wiring.cultureFetchStore.getByProposal(PILOT_WORKSPACE, proposalId, childRunId);
    assert.equal(finalRecord?.status, "cancelled");
  } finally {
    await server.close();
    await wiring.close();
  }
});

test("lease/recovery: an orphaned 'fetching' lease (the process that acquired it crashed before reaching any terminal state) is reclaimable by a later attempt — never permanently stuck (TASK-011 remediation, 2026-07-19 coordinator distributed-defects review, issue 3)", async () => {
  const wiring = await buildWiring();
  try {
    const caller = makeCaller(wiring);
    const id = registerTestSource("http://127.0.0.1:1/lease-recovery");
    const proposed = await caller.jobpilot.cultureResearch.propose({ workspaceId: PILOT_WORKSPACE, company: TEST_COMPANY, sourceIds: [id] });
    const { childRunId } = proposed.pending[0]!;

    // Simulate instance A acquiring the lease and then crashing — it never
    // transitions the record to any terminal status, so `leaseOwner`/
    // `leaseExpiresAt` are left dangling exactly as a real crash would leave them.
    const nowA = new Date().toISOString();
    const leased = await wiring.cultureFetchStore.acquireLease(PILOT_WORKSPACE, childRunId, "instance-a-worker", nowA);
    assert.equal(leased.status, "fetching");
    assert.equal(leased.attempt, 1);

    // While the lease is still live (before its expiry), a second attempt
    // must be rejected — the fetch is legitimately in progress elsewhere.
    await assert.rejects(
      () => wiring.cultureFetchStore.acquireLease(PILOT_WORKSPACE, childRunId, "instance-b-worker", nowA),
      /held by a live lease/,
    );

    // A SECOND, independent store instance (simulating instance B, sharing
    // the same durable memoryStore) reclaims the SAME lease once it has
    // expired — passing a `nowISO` comfortably past the lease TTL, exactly
    // as a real clock advancing past a crashed worker's lease would.
    const independentStore = new DurableCultureFetchStore(wiring.memoryStore);
    const farFuture = new Date(Date.parse(nowA) + 10 * 60_000).toISOString();
    const reclaimed = await independentStore.acquireLease(PILOT_WORKSPACE, childRunId, "instance-b-worker", farFuture);
    assert.equal(reclaimed.status, "fetching");
    assert.equal(reclaimed.leaseOwner, "instance-b-worker");
    assert.equal(reclaimed.attempt, 2, "a reclaim increments attempt for audit/diagnostics");

    // The now-stale instance A can no longer act as if it still holds the lease.
    await assert.rejects(
      () => wiring.cultureFetchStore.acquireLease(PILOT_WORKSPACE, childRunId, "instance-a-worker", farFuture),
      /held by a live lease/,
    );
  } finally {
    await wiring.close();
  }
});

test("lease/recovery: requestCancel on an ORPHANED (expired) lease transitions directly to cancelled — a durable cancel request is never left waiting for a worker that crashed and will never come back", async () => {
  const wiring = await buildWiring();
  try {
    const caller = makeCaller(wiring);
    const id = registerTestSource("http://127.0.0.1:1/lease-recovery-cancel");
    const proposed = await caller.jobpilot.cultureResearch.propose({ workspaceId: PILOT_WORKSPACE, company: TEST_COMPANY, sourceIds: [id] });
    const { childRunId } = proposed.pending[0]!;

    const nowA = new Date().toISOString();
    await wiring.cultureFetchStore.acquireLease(PILOT_WORKSPACE, childRunId, "instance-a-worker", nowA);

    // Cancel is requested well AFTER the lease's TTL has elapsed — exactly
    // the state a real clock reaches once the crashed worker's lease has
    // expired. `requestCancel` must recognize the lease as orphaned (not
    // live) and transition straight to "cancelled" rather than merely
    // setting `cancelRequested` and waiting on a worker that will never poll.
    const farFuture = new Date(Date.parse(nowA) + 10 * 60_000).toISOString();
    const cancelled = await wiring.cultureFetchStore.requestCancel(PILOT_WORKSPACE, childRunId, farFuture);
    assert.equal(cancelled.status, "cancelled");
    assert.equal(cancelled.cancelRequested, true);
  } finally {
    await wiring.close();
  }
});

test("cancel landing during the reservation window (before the AbortController is registered) still guarantees the request never completes (TASK-011 remediation, 2026-07-18 fresh review) — deterministic reproduction via a delayed childAgentRuns.get", async () => {
  let serverGotFullRequest = false;
  const server = await startTestServer((_req, res) => {
    serverGotFullRequest = true;
    res.writeHead(200, { "content-type": "text/plain" });
    res.end("should never be fully received if cancel truly beats materialize");
  });
  const wiring = await buildWiring();
  try {
    const caller = makeCaller(wiring);
    const id = registerTestSource(server.url);
    const proposed = await caller.jobpilot.cultureResearch.propose({ workspaceId: PILOT_WORKSPACE, company: TEST_COMPANY, sourceIds: [id] });
    const { proposalId, childRunId } = proposed.pending[0]!;
    await caller.action.decide({ proposalId, decision: "approve" });

    // Widen the window between the "pending"->"fetching" CAS transition and
    // `reserveChildRunAction` resolving — `reserveChildRunAction` calls
    // `store.get(...)` first — by delaying ONLY that call for this run. This
    // deterministically reproduces the race the fix closes: previously the
    // AbortController was registered AFTER `reserveChildRunAction` resolved,
    // so a `cancelCultureSourceFetch` landing during this delay found
    // nothing to abort and the real fetch ran to completion regardless.
    // A real `Proxy` (not object spread, which only copies OWN properties
    // and silently drops a class's prototype methods like `consumeBudget`/
    // `updateStatus`/`create`/`listByParentRun`) so every OTHER method still
    // correctly delegates to the real store.
    const delayedChildAgentRuns: typeof wiring.childAgentRuns = new Proxy(wiring.childAgentRuns, {
      get(target, prop, receiver) {
        if (prop === "get") {
          return async (workspaceId: string, id: string) => {
            await new Promise((resolve) => setTimeout(resolve, 80));
            return target.get(workspaceId, id);
          };
        }
        // Bind every other forwarded method to the REAL target — a Proxy's
        // default receiver would otherwise be the proxy itself, which class
        // methods relying on private (`#`) fields cannot tolerate.
        const value = Reflect.get(target, prop, receiver);
        return typeof value === "function" ? value.bind(target) : value;
      },
    });

    const materializePromise = materializeCultureSourceFetch(
      { childAgentRuns: delayedChildAgentRuns, ledger: wiring.ledger, fetchStore: wiring.cultureFetchStore, abortControllers: wiring.cultureFetchAbortControllers },
      PILOT_WORKSPACE,
      proposalId,
      childRunId,
      makeRun(),
      allowLoopback,
    );
    // Fire cancel almost immediately — well within the artificially widened
    // `reserveChildRunAction` window, before the (fixed) code registers the
    // AbortController.
    await new Promise((resolve) => setTimeout(resolve, 10));
    const cancelled = await cancelCultureSourceFetch(
      cultureFetchDeps(wiring),
      PILOT_WORKSPACE,
      proposalId,
      childRunId,
      { type: "user", id: PILOT_USER },
      makeRun(),
    );
    // TASK-011 remediation (2026-07-19 distributed-defects review) — lease
    // acquisition happens BEFORE the delayed `reserveChildRunAction` call, so
    // by 10ms materialize already holds a LIVE lease; cancel can only
    // durably REQUEST cancellation, not force an immediate "cancelled"
    // outcome synchronously (see the analogous fix above).
    assert.equal(cancelled.cancelRequested, true);

    const materialized = await materializePromise;
    assert.equal(materialized.status, "cancelled");
    await new Promise((resolve) => setTimeout(resolve, 150));
    assert.equal(serverGotFullRequest, false, "the real network fetch must never complete once cancel has landed, even during the reservation window");

    const finalRecord = await wiring.cultureFetchStore.getByProposal(PILOT_WORKSPACE, proposalId, childRunId);
    assert.equal(finalRecord?.status, "cancelled");
  } finally {
    await server.close();
    await wiring.close();
  }
});

test("a cancel completing between materialize's reservation success and its pre-flight durable-status re-check still guarantees zero network calls (TASK-011 remediation, 2026-07-18 fifth review) — the AbortController map alone is not sufficient; the fresh durable-status read right before guardedFetch is the authoritative guard", async () => {
  let serverGotFullRequest = false;
  const server = await startTestServer((_req, res) => {
    serverGotFullRequest = true;
    res.writeHead(200, { "content-type": "text/plain" });
    res.end("should never be fully received");
  });
  const wiring = await buildWiring();
  try {
    const caller = makeCaller(wiring);
    const id = registerTestSource(server.url);
    const proposed = await caller.jobpilot.cultureResearch.propose({ workspaceId: PILOT_WORKSPACE, company: TEST_COMPANY, sourceIds: [id] });
    const { proposalId, childRunId } = proposed.pending[0]!;
    await caller.action.decide({ proposalId, decision: "approve" });

    // Delay ONLY `get()` on materialize's OWN fetchStore dependency — this
    // is exactly where the pre-flight re-check (right before `guardedFetch`
    // is ever called) reads the durable record. Reservation succeeds
    // quickly against the REAL (undelayed) childAgentRuns store, so
    // materialize reaches the pre-flight check with the child Run still
    // "running" — a genuinely different interleaving than the
    // reservation-window test above, which relies on the child Run itself
    // already being cancelled by the time reservation is checked. Here, a
    // real `cancelCultureSourceFetch` call (using the REAL, undelayed store)
    // completes its OWN durable transition ("fetching" -> "cancelled")
    // WHILE materialize's pre-flight `get()` is artificially delayed —
    // proving the pre-flight re-check (not `abortController.signal.aborted`,
    // which this scenario does NOT rely on) is what catches this. A real
    // `Proxy` (not object spread, which drops `DurableCultureFetchStore`'s
    // private `#memory`/`#mutex` fields entirely) with every OTHER forwarded
    // method explicitly bound to the real target — a Proxy's own methods
    // called with the proxy as `this` cannot access private class fields.
    const delayedFetchStore: typeof wiring.cultureFetchStore = new Proxy(wiring.cultureFetchStore, {
      get(target, prop, receiver) {
        if (prop === "get") {
          // The ONLY call that reaches this override is materialize's own
          // DIRECT `deps.fetchStore.get(...)` pre-flight check — `getByProposal`'s
          // internal `this.get(...)` call is bound to `target` and never
          // passes through this Proxy trap at all.
          return async (workspaceId: string, id: string) => {
            await new Promise((resolve) => setTimeout(resolve, 120));
            return target.get(workspaceId, id);
          };
        }
        const value = Reflect.get(target, prop, receiver);
        return typeof value === "function" ? value.bind(target) : value;
      },
    });

    const materializePromise = materializeCultureSourceFetch(
      { childAgentRuns: wiring.childAgentRuns, ledger: wiring.ledger, fetchStore: delayedFetchStore, abortControllers: wiring.cultureFetchAbortControllers },
      PILOT_WORKSPACE,
      proposalId,
      childRunId,
      makeRun(),
      allowLoopback,
    );
    // Give materialize enough time to complete its "pending"->"fetching"
    // transition, register its AbortController, and pass reservation
    // (all fast, real in-memory/local operations) before firing cancel —
    // landing cancel squarely inside the artificially widened pre-flight
    // `get()` delay above.
    await new Promise((resolve) => setTimeout(resolve, 40));
    const cancelled = await cancelCultureSourceFetch(
      cultureFetchDeps(wiring),
      PILOT_WORKSPACE,
      proposalId,
      childRunId,
      { type: "user", id: PILOT_USER },
      makeRun(),
    );
    // TASK-011 remediation (2026-07-19 distributed-defects review) — a live
    // lease is already held by 40ms; cancel can only durably REQUEST
    // cancellation here, not force an immediate synchronous "cancelled"
    // outcome (see the analogous fix in the earlier reservation-window test).
    assert.equal(cancelled.cancelRequested, true);

    const materialized = await materializePromise;
    assert.equal(materialized.status, "cancelled");
    await new Promise((resolve) => setTimeout(resolve, 100));
    assert.equal(serverGotFullRequest, false, "the pre-flight durable-status re-check must prevent the fetch from ever starting once a concurrent cancel has already committed");
  } finally {
    await server.close();
    await wiring.close();
  }
});

test("cancelCultureSourceFetch on an already fetched record is a no-op that preserves the artifact", async () => {
  let requestCount = 0;
  const server = await startTestServer((_req, res) => {
    requestCount += 1;
    res.writeHead(200, { "content-type": "text/plain" });
    res.end("Culture with stable artifact.");
  });
  const wiring = await buildWiring();
  try {
    const caller = makeCaller(wiring);
    const id = registerTestSource(server.url);
    const proposed = await caller.jobpilot.cultureResearch.propose({ workspaceId: PILOT_WORKSPACE, company: TEST_COMPANY, sourceIds: [id] });
    const { proposalId, childRunId } = proposed.pending[0]!;
    await caller.action.decide({ proposalId, decision: "approve" });

    const fetched = await materializeCultureSourceFetch(cultureFetchDeps(wiring), PILOT_WORKSPACE, proposalId, childRunId, makeRun(), allowLoopback);
    assert.equal(fetched.status, "fetched");
    const cancelled = await cancelCultureSourceFetch(
      cultureFetchDeps(wiring),
      PILOT_WORKSPACE,
      proposalId,
      childRunId,
      { type: "user", id: PILOT_USER },
      makeRun(),
    );

    assert.equal(cancelled.status, "fetched");
    assert.deepEqual(cancelled.artifact, fetched.artifact);
    assert.equal(requestCount, 1);
  } finally {
    await server.close();
    await wiring.close();
  }
});

test("materializeCultureSourceFetch rejects a mismatched proposalId/childRunId pair instead of reconstructing", async () => {
  const server = await startTestServer((_req, res) => {
    res.writeHead(200, { "content-type": "text/plain" });
    res.end("should never be fetched");
  });
  const wiring = await buildWiring();
  try {
    const caller = makeCaller(wiring);
    const idA = registerTestSource(server.url);
    const idB = registerTestSource(server.url);
    const proposed = await caller.jobpilot.cultureResearch.propose({ workspaceId: PILOT_WORKSPACE, company: TEST_COMPANY, sourceIds: [idA, idB] });
    const [a, b] = proposed.pending;
    await caller.action.decide({ proposalId: a!.proposalId, decision: "approve" });

    await assert.rejects(
      () => materializeCultureSourceFetch(cultureFetchDeps(wiring), PILOT_WORKSPACE, a!.proposalId, b!.childRunId, makeRun(), allowLoopback),
      /unknown or mismatched culture-fetch intent/,
    );
    const childRunB = await wiring.childAgentRuns.get(PILOT_WORKSPACE, b!.childRunId);
    assert.equal(childRunB?.callsUsed, 0, "the mismatched child Run's budget must be untouched");
  } finally {
    await server.close();
    await wiring.close();
  }
});

test("materializeCultureSourceFetch: the record-level cancellation re-check independently guards against a rolled-back child Run status", async () => {
  let requestCount = 0;
  const server = await startTestServer((_req, res) => {
    requestCount += 1;
    res.end("should never be reached");
  });
  const wiring = await buildWiring();
  try {
    const caller = makeCaller(wiring);
    const id = registerTestSource(server.url);
    const proposed = await caller.jobpilot.cultureResearch.propose({ workspaceId: PILOT_WORKSPACE, company: TEST_COMPANY, sourceIds: [id] });
    const { proposalId, childRunId } = proposed.pending[0]!;
    await caller.action.decide({ proposalId, decision: "approve" });

    await cancelCultureSourceFetch(
      cultureFetchDeps(wiring),
      PILOT_WORKSPACE,
      proposalId,
      childRunId,
      { type: "user", id: PILOT_USER },
      makeRun(),
    );

    await wiring.childAgentRuns.updateStatus(PILOT_WORKSPACE, childRunId, "cancelled", "running");
    assert.equal((await wiring.childAgentRuns.get(PILOT_WORKSPACE, childRunId))?.status, "running");
    assert.equal((await wiring.cultureFetchStore.getByProposal(PILOT_WORKSPACE, proposalId, childRunId))?.status, "cancelled");

    const result = await materializeCultureSourceFetch(cultureFetchDeps(wiring), PILOT_WORKSPACE, proposalId, childRunId, makeRun(), allowLoopback);
    assert.equal(result.status, "cancelled");
    assert.equal(requestCount, 0, "no fetch should ever have been attempted");
  } finally {
    await server.close();
    await wiring.close();
  }
});

test("cancelCultureSourceFetch rejects a mismatched proposalId/childRunId pair instead of reconstructing", async () => {
  let requestCount = 0;
  const server = await startTestServer((_req, res) => {
    requestCount += 1;
    res.end("should never be reached");
  });
  const wiring = await buildWiring();
  try {
    const caller = makeCaller(wiring);
    const idA = registerTestSource(server.url);
    const idB = registerTestSource(server.url);
    const proposed = await caller.jobpilot.cultureResearch.propose({ workspaceId: PILOT_WORKSPACE, company: TEST_COMPANY, sourceIds: [idA, idB] });
    const [a, b] = proposed.pending;

    await assert.rejects(
      () =>
        cancelCultureSourceFetch(
          cultureFetchDeps(wiring),
          PILOT_WORKSPACE,
          a!.proposalId,
          b!.childRunId,
          { type: "user", id: PILOT_USER },
          makeRun(),
        ),
      /unknown or mismatched culture-fetch intent/,
    );
    const childRunB = await wiring.childAgentRuns.get(PILOT_WORKSPACE, b!.childRunId);
    assert.equal(childRunB?.status, "running", "the unrelated child Run must remain untouched");
    assert.equal(requestCount, 0);
  } finally {
    await server.close();
    await wiring.close();
  }
});

test("materializeCultureSourceFetch rejects a non-text content-type response and fails the child Run closed", async () => {
  const server = await startTestServer((_req, res) => {
    res.writeHead(200, { "content-type": "application/octet-stream" });
    res.end(Buffer.from([0, 1, 2, 3]));
  });
  const wiring = await buildWiring();
  try {
    const caller = makeCaller(wiring);
    const id = registerTestSource(server.url);
    const proposed = await caller.jobpilot.cultureResearch.propose({ workspaceId: PILOT_WORKSPACE, company: TEST_COMPANY, sourceIds: [id] });
    const { proposalId, childRunId } = proposed.pending[0]!;
    await caller.action.decide({ proposalId, decision: "approve" });

    await assert.rejects(
      () => materializeCultureSourceFetch(cultureFetchDeps(wiring), PILOT_WORKSPACE, proposalId, childRunId, makeRun(), allowLoopback),
      /non-text content-type/,
    );
    const childRun = await wiring.childAgentRuns.get(PILOT_WORKSPACE, childRunId);
    assert.equal(childRun?.status, "failed");
    const record = await wiring.cultureFetchStore.getByProposal(PILOT_WORKSPACE, proposalId, childRunId);
    assert.equal(record?.status, "failed");
  } finally {
    await server.close();
    await wiring.close();
  }
});

test("cultureResearch.propose: extra client-supplied fields alongside a valid sourceId have no effect", async () => {
  const wiring = await buildWiring();
  try {
    const caller = makeCaller(wiring);
    const glassdoorId = registerTestSource("http://127.0.0.1:1/glassdoor-real", "glassdoor");
    const forged = {
      workspaceId: PILOT_WORKSPACE,
      company: TEST_COMPANY,
      sourceIds: [glassdoorId],
      url: "https://careers.bcg.com/official-looking-url",
      sourceType: "company_official_page",
      sourceLabel: "Definitely Not Glassdoor",
    };
    const result = await caller.jobpilot.cultureResearch.propose(forged as unknown as { workspaceId: string; company: string; sourceIds: string[] });
    assert.equal(result.pending.length, 0);
    assert.equal(result.skipped.length, 1);
    assert.equal(result.skipped[0]?.sourceType, "glassdoor");
  } finally {
    await wiring.close();
  }
});

test("action.propose: a Human directly invoking jobpilot.researchCultureSource fails closed even with a valid goalTaskRef", async () => {
  const wiring = await buildWiring();
  try {
    const caller = makeCaller(wiring);
    const goal = await caller.agentOrchestration.goal.create({ workspaceId: PILOT_WORKSPACE, type: "jobpilot.culture_research", title: "test_fixture goal" });
    const task = await caller.agentOrchestration.task.create({
      workspaceId: PILOT_WORKSPACE,
      goalId: goal.id,
      type: "research_culture_source",
      assignedAgentId: LEARNING_AGENT,
    });
    const proposal = await caller.action.propose({
      workspaceId: PILOT_WORKSPACE,
      actor: { type: "user", id: PILOT_USER, plane: "cloud" },
      action: "read",
      resourceType: "external:fetch",
      inputs: { sourceId: "bcg-careers-interview-process", workspaceId: PILOT_WORKSPACE, company: "Boston Consulting Group" },
      skill: "jobpilot.researchCultureSource",
      goalTaskRef: { goalId: goal.id, taskId: task.id },
    });
    assert.equal(proposal.status, "rejected");
    assert.match(proposal.rejectionReason ?? "", /may only be invoked by an eligible Agent Run/);
  } finally {
    await wiring.close();
  }
});

test("action.propose: a Human directly invoking jobpilot.synthesizeCultureProfile fails closed", async () => {
  const wiring = await buildWiring();
  try {
    const caller = makeCaller(wiring);
    const goal = await caller.agentOrchestration.goal.create({ workspaceId: PILOT_WORKSPACE, type: "jobpilot.culture_research", title: "test_fixture goal" });
    const task = await caller.agentOrchestration.task.create({
      workspaceId: PILOT_WORKSPACE,
      goalId: goal.id,
      type: "synthesize_culture_profile",
      assignedAgentId: INTERNAL_STRATEGIST_AGENT,
    });
    const proposal = await caller.action.propose({
      workspaceId: PILOT_WORKSPACE,
      actor: { type: "user", id: PILOT_USER },
      action: "write",
      resourceType: "signal",
      inputs: { parentRunId: "parent-run", claims: [], artifacts: [], skippedSources: [] },
      skill: "jobpilot.synthesizeCultureProfile",
      goalTaskRef: { goalId: goal.id, taskId: task.id },
    });
    assert.equal(proposal.status, "rejected");
    assert.match(proposal.rejectionReason ?? "", /may only be invoked by an eligible Agent Run/);
  } finally {
    await wiring.close();
  }
});

test("cultureResearch.synthesize: a claim whose quote is absent from the fetched artifact is rejected", async () => {
  const server = await startTestServer((_req, res) => {
    res.writeHead(200, { "content-type": "text/plain" });
    res.end("Our culture is built on trust and collaboration.");
  });
  const wiring = await buildWiring();
  try {
    const caller = makeCaller(wiring);
    const id = registerTestSource(server.url);
    const proposed = await caller.jobpilot.cultureResearch.propose({ workspaceId: PILOT_WORKSPACE, company: TEST_COMPANY, sourceIds: [id] });
    const { proposalId, childRunId } = proposed.pending[0]!;
    await caller.action.decide({ proposalId, decision: "approve" });
    const record = await materializeCultureSourceFetch(cultureFetchDeps(wiring), PILOT_WORKSPACE, proposalId, childRunId, makeRun(), allowLoopback);

    await assert.rejects(
      () =>
        caller.jobpilot.cultureResearch.synthesize({
          workspaceId: PILOT_WORKSPACE,
          company: TEST_COMPANY,
          parentRunId: proposed.parentRunId,
          claims: [{ id: "bad1", claimType: "fact", sourceId: id, quote: "we guarantee industry-leading pay", contentHash: record.artifact!.contentHash }],
        }),
      /quote-not-found-in-artifact|failed to ground|claim grounding/i,
    );
  } finally {
    await server.close();
    await wiring.close();
  }
});

test("cultureResearch.synthesize: a claim with a mutated content hash is rejected even though the quote is real", async () => {
  const server = await startTestServer((_req, res) => {
    res.writeHead(200, { "content-type": "text/plain" });
    res.end("Our culture is built on trust and collaboration.");
  });
  const wiring = await buildWiring();
  try {
    const caller = makeCaller(wiring);
    const id = registerTestSource(server.url);
    const proposed = await caller.jobpilot.cultureResearch.propose({ workspaceId: PILOT_WORKSPACE, company: TEST_COMPANY, sourceIds: [id] });
    const { proposalId, childRunId } = proposed.pending[0]!;
    await caller.action.decide({ proposalId, decision: "approve" });
    await materializeCultureSourceFetch(cultureFetchDeps(wiring), PILOT_WORKSPACE, proposalId, childRunId, makeRun(), allowLoopback);

    await assert.rejects(() =>
      caller.jobpilot.cultureResearch.synthesize({
        workspaceId: PILOT_WORKSPACE,
        company: TEST_COMPANY,
        parentRunId: proposed.parentRunId,
        claims: [{ id: "bad2", claimType: "fact", sourceId: id, quote: "built on trust", contentHash: "stale-forged-hash" }],
      }),
    );
  } finally {
    await server.close();
    await wiring.close();
  }
});

test("cultureResearch.synthesize: a well-grounded claim succeeds and the approved result is exposed via synthesisResult", async () => {
  const server = await startTestServer((_req, res) => {
    res.writeHead(200, { "content-type": "text/plain" });
    res.end("Our culture is built on trust and collaboration.");
  });
  const wiring = await buildWiring();
  try {
    const caller = makeCaller(wiring);
    const id = registerTestSource(server.url);
    const proposed = await caller.jobpilot.cultureResearch.propose({ workspaceId: PILOT_WORKSPACE, company: TEST_COMPANY, sourceIds: [id] });
    const { proposalId, childRunId } = proposed.pending[0]!;
    await caller.action.decide({ proposalId, decision: "approve" });
    const record = await materializeCultureSourceFetch(cultureFetchDeps(wiring), PILOT_WORKSPACE, proposalId, childRunId, makeRun(), allowLoopback);

    const synthesisProposal = await caller.jobpilot.cultureResearch.synthesize({
      workspaceId: PILOT_WORKSPACE,
      company: TEST_COMPANY,
      parentRunId: proposed.parentRunId,
      claims: [{ id: "good1", claimType: "fact", sourceId: id, quote: "built on trust and collaboration", contentHash: record.artifact!.contentHash }],
    });
    assert.equal(synthesisProposal.status, "pending_review");

    const beforeApproval = await caller.jobpilot.cultureResearch.synthesisResult({
      workspaceId: PILOT_WORKSPACE,
      company: TEST_COMPANY,
      parentRunId: proposed.parentRunId,
      proposalId: synthesisProposal.proposalId,
    });
    assert.deepEqual(beforeApproval, { status: "not_available" });

    const decided = await caller.action.decide({ proposalId: synthesisProposal.proposalId, decision: "approve" });
    assert.equal(decided.status, "applied");

    const afterApproval = await caller.jobpilot.cultureResearch.synthesisResult({
      workspaceId: PILOT_WORKSPACE,
      company: TEST_COMPANY,
      parentRunId: proposed.parentRunId,
      proposalId: synthesisProposal.proposalId,
    });
    assert.equal(afterApproval.status, "available");
    if (afterApproval.status !== "available") return;
    assert.equal(afterApproval.proposalId, synthesisProposal.proposalId);
    assert.equal(afterApproval.result.parentRunId, proposed.parentRunId);
    assert.deepEqual(afterApproval.result.artifactHashes, [{ sourceId: id, contentHash: record.artifact!.contentHash }]);
    assert.equal(afterApproval.result.partition.facts.length, 1);
    assert.equal(typeof afterApproval.approvedAt, "string");
  } finally {
    await server.close();
    await wiring.close();
  }
});

test("cultureResearch.latestRun: server-authoritative resume — returns null for a company with no research yet, then reflects propose() and synthesize() with no client-supplied pointer at all (TASK-011 remediation, 2026-07-19 coordinator distributed-defects review, issue 13)", async () => {
  const server = await startTestServer((_req, res) => {
    res.writeHead(200, { "content-type": "text/plain" });
    res.end("Our culture is built on trust and collaboration.");
  });
  const wiring = await buildWiring();
  try {
    const caller = makeCaller(wiring);

    // Nothing proposed yet — an honest null, never a fabricated/empty-shaped result.
    const before = await caller.jobpilot.cultureResearch.latestRun({ workspaceId: PILOT_WORKSPACE, company: TEST_COMPANY });
    assert.equal(before, null);

    const id = registerTestSource(server.url);
    const proposed = await caller.jobpilot.cultureResearch.propose({ workspaceId: PILOT_WORKSPACE, company: TEST_COMPANY, sourceIds: [id] });
    const { proposalId, childRunId } = proposed.pending[0]!;

    // A FRESH caller/query with NO local pointer discovers the pending source.
    const afterPropose = await caller.jobpilot.cultureResearch.latestRun({ workspaceId: PILOT_WORKSPACE, company: TEST_COMPANY });
    assert.ok(afterPropose);
    assert.equal(afterPropose!.parentRunId, proposed.parentRunId);
    assert.deepEqual(afterPropose!.pending, [{ proposalId, childRunId, sourceId: id, sourceType: "company_official_page", sourceLabel: `test_fixture source ${testSourceCounter}` }]);
    assert.equal("synthesisProposalId" in afterPropose!, false);

    await caller.action.decide({ proposalId, decision: "approve" });
    const record = await materializeCultureSourceFetch(cultureFetchDeps(wiring), PILOT_WORKSPACE, proposalId, childRunId, makeRun(), allowLoopback);
    const synthesisProposal = await caller.jobpilot.cultureResearch.synthesize({
      workspaceId: PILOT_WORKSPACE,
      company: TEST_COMPANY,
      parentRunId: proposed.parentRunId,
      claims: [{ id: "good1", claimType: "fact", sourceId: id, quote: "built on trust and collaboration", contentHash: record.artifact!.contentHash }],
    });

    // Once synthesize() has run, the pointer is discoverable server-side too.
    const afterSynthesize = await caller.jobpilot.cultureResearch.latestRun({ workspaceId: PILOT_WORKSPACE, company: TEST_COMPANY });
    assert.equal(afterSynthesize?.synthesisProposalId, synthesisProposal.proposalId);

    // A DIFFERENT company in the same workspace must never see this run.
    const otherCompany = await caller.jobpilot.cultureResearch.latestRun({ workspaceId: PILOT_WORKSPACE, company: OTHER_COMPANY });
    assert.equal(otherCompany, null);
  } finally {
    await server.close();
    await wiring.close();
  }
});

test("cultureResearch.latestRun: two research runs for the same company — the LATEST parent Run wins, never a stale earlier one", async () => {
  const server = await startTestServer((_req, res) => {
    res.writeHead(200, { "content-type": "text/plain" });
    res.end("plain content");
  });
  const wiring = await buildWiring();
  try {
    const caller = makeCaller(wiring);
    const id1 = registerTestSource(server.url);
    const first = await caller.jobpilot.cultureResearch.propose({ workspaceId: PILOT_WORKSPACE, company: TEST_COMPANY, sourceIds: [id1] });
    // A brief real delay so the two runs get distinguishable createdAt timestamps.
    await new Promise((resolve) => setTimeout(resolve, 5));
    const id2 = registerTestSource(server.url);
    const second = await caller.jobpilot.cultureResearch.propose({ workspaceId: PILOT_WORKSPACE, company: TEST_COMPANY, sourceIds: [id2] });

    const latest = await caller.jobpilot.cultureResearch.latestRun({ workspaceId: PILOT_WORKSPACE, company: TEST_COMPANY });
    assert.equal(latest?.parentRunId, second.parentRunId);
    assert.notEqual(latest?.parentRunId, first.parentRunId);
  } finally {
    await server.close();
    await wiring.close();
  }
});

test("DurableCultureFetchStore.create: two CONCURRENT calls for the SAME childRunId never fork a duplicate current row (TASK-011 remediation, 2026-07-19 coordinator distributed-defects RE-review — an independent reviewer found the original plain write() here could not detect a racing creator for the same key; now backed by MemoryStore.writeIfAbsent)", async () => {
  const wiring = await buildWiring();
  try {
    const childRunId = "30000000-0000-4000-8000-000000000001";
    const baseInput = {
      childRunId,
      parentRunId: "30000000-0000-4000-8000-000000000002",
      workspaceId: PILOT_WORKSPACE,
      company: TEST_COMPANY,
      sourceId: "test-fixture-race-source",
      sourceType: "company_official_page" as const,
      sourceLabel: "test_fixture race source",
      canonicalUrl: "http://127.0.0.1:1/race",
      allowedRedirectOrigins: ["http://127.0.0.1:1"],
      policySnapshot: { registryVersion: "v-a", eligibility: "permitted" as const },
      goalId: "goal-race",
      taskId: "task-race",
      skill: "jobpilot.researchCultureSource" as const,
      action: "read" as const,
      actorId: LEARNING_AGENT,
    };
    const [resultA, resultB] = await Promise.all([
      wiring.cultureFetchStore.create({ ...baseInput }),
      wiring.cultureFetchStore.create({ ...baseInput }),
    ]);
    assert.equal(resultA.createdAt, resultB.createdAt, "both calls must agree on the SAME winning record");

    const finalRecord = await wiring.cultureFetchStore.get(PILOT_WORKSPACE, childRunId);
    assert.ok(finalRecord);
    assert.equal(finalRecord!.createdAt, resultA.createdAt);
  } finally {
    await wiring.close();
  }
});

test("DurableCultureSynthesisPointerStore.recordProposal: two CONCURRENT calls for the SAME parentRunId with DIFFERENT proposalIds — exactly one wins the pointer, the other fails closed rather than silently overwriting (TASK-011 remediation, 2026-07-19 coordinator distributed-defects RE-review)", async () => {
  const wiring = await buildWiring();
  try {
    const parentRunId = "30000000-0000-4000-8000-000000000003";
    const proposalIdA = "30000000-0000-4000-8000-0000000000a1";
    const proposalIdB = "30000000-0000-4000-8000-0000000000b1";
    const [resultA, resultB] = await Promise.allSettled([
      wiring.cultureSynthesisPointerStore.recordProposal(PILOT_WORKSPACE, parentRunId, TEST_COMPANY, proposalIdA),
      wiring.cultureSynthesisPointerStore.recordProposal(PILOT_WORKSPACE, parentRunId, TEST_COMPANY, proposalIdB),
    ]);
    const outcomes = [resultA, resultB];
    const fulfilled = outcomes.filter((r) => r.status === "fulfilled");
    const rejected = outcomes.filter((r) => r.status === "rejected");
    assert.equal(fulfilled.length, 1, "exactly one of the two racing proposalIds must win the pointer");
    assert.equal(rejected.length, 1, "the loser must fail closed, never silently overwrite");
    assert.match((rejected[0] as PromiseRejectedResult).reason.message, /already pointed at a different synthesis proposal/);

    const pointer = await wiring.cultureSynthesisPointerStore.getForParentRun(PILOT_WORKSPACE, parentRunId);
    assert.ok(pointer);
    assert.ok(pointer!.proposalId === proposalIdA || pointer!.proposalId === proposalIdB);
  } finally {
    await wiring.close();
  }
});

test("cultureResearch.synthesize: a parentRunId from another company is rejected with BAD_REQUEST", async () => {
  const serverA = await startTestServer((_req, res) => {
    res.writeHead(200, { "content-type": "text/plain" });
    res.end("Company A culture: trust and collaboration.");
  });
  const serverB = await startTestServer((_req, res) => {
    res.writeHead(200, { "content-type": "text/plain" });
    res.end("Company B culture: speed and ownership.");
  });
  const wiring = await buildWiring();
  try {
    const caller = makeCaller(wiring);
    const idA = registerTestSource(serverA.url, "company_official_page", TEST_COMPANY);
    const idB = registerTestSource(serverB.url, "company_official_page", OTHER_COMPANY);

    const proposedA = await caller.jobpilot.cultureResearch.propose({ workspaceId: PILOT_WORKSPACE, company: TEST_COMPANY, sourceIds: [idA] });
    await caller.action.decide({ proposalId: proposedA.pending[0]!.proposalId, decision: "approve" });
    await materializeCultureSourceFetch(
      cultureFetchDeps(wiring),
      PILOT_WORKSPACE,
      proposedA.pending[0]!.proposalId,
      proposedA.pending[0]!.childRunId,
      makeRun(),
      allowLoopback,
    );

    const proposedB = await caller.jobpilot.cultureResearch.propose({ workspaceId: PILOT_WORKSPACE, company: OTHER_COMPANY, sourceIds: [idB] });
    await caller.action.decide({ proposalId: proposedB.pending[0]!.proposalId, decision: "approve" });
    await materializeCultureSourceFetch(
      cultureFetchDeps(wiring),
      PILOT_WORKSPACE,
      proposedB.pending[0]!.proposalId,
      proposedB.pending[0]!.childRunId,
      makeRun(),
      allowLoopback,
    );

    await assert.rejects(
      () =>
        caller.jobpilot.cultureResearch.synthesize({
          workspaceId: PILOT_WORKSPACE,
          company: TEST_COMPANY,
          parentRunId: proposedB.parentRunId,
          claims: [{ id: "wrong-parent", claimType: "fact", sourceId: idB, quote: "speed and ownership", contentHash: "unused" }],
        }),
      (error: unknown) => error instanceof TRPCError && error.code === "BAD_REQUEST" && /does not belong to company/.test(error.message),
    );
  } finally {
    await serverA.close();
    await serverB.close();
    await wiring.close();
  }
});

test("cultureResearch.synthesize: artifacts fetched for a different company are not pooled into this run", async () => {
  const serverA = await startTestServer((_req, res) => {
    res.writeHead(200, { "content-type": "text/plain" });
    res.end("Company A culture: trust and collaboration.");
  });
  const serverB = await startTestServer((_req, res) => {
    res.writeHead(200, { "content-type": "text/plain" });
    res.end("Company B culture: speed and ownership.");
  });
  const wiring = await buildWiring();
  try {
    const caller = makeCaller(wiring);
    const idA = registerTestSource(serverA.url, "company_official_page", TEST_COMPANY);
    const idB = registerTestSource(serverB.url, "company_official_page", OTHER_COMPANY);

    const proposedA = await caller.jobpilot.cultureResearch.propose({ workspaceId: PILOT_WORKSPACE, company: TEST_COMPANY, sourceIds: [idA] });
    await caller.action.decide({ proposalId: proposedA.pending[0]!.proposalId, decision: "approve" });
    await materializeCultureSourceFetch(
      cultureFetchDeps(wiring),
      PILOT_WORKSPACE,
      proposedA.pending[0]!.proposalId,
      proposedA.pending[0]!.childRunId,
      makeRun(),
      allowLoopback,
    );

    const proposedB = await caller.jobpilot.cultureResearch.propose({ workspaceId: PILOT_WORKSPACE, company: OTHER_COMPANY, sourceIds: [idB] });
    await caller.action.decide({ proposalId: proposedB.pending[0]!.proposalId, decision: "approve" });
    const recordB = await materializeCultureSourceFetch(
      cultureFetchDeps(wiring),
      PILOT_WORKSPACE,
      proposedB.pending[0]!.proposalId,
      proposedB.pending[0]!.childRunId,
      makeRun(),
      allowLoopback,
    );

    await assert.rejects(
      () =>
        caller.jobpilot.cultureResearch.synthesize({
          workspaceId: PILOT_WORKSPACE,
          company: TEST_COMPANY,
          parentRunId: proposedA.parentRunId,
          claims: [{ id: "cross-company", claimType: "fact", sourceId: idB, quote: "speed and ownership", contentHash: recordB.artifact!.contentHash }],
        }),
      /failed to ground|claim grounding/i,
    );
  } finally {
    await serverA.close();
    await serverB.close();
    await wiring.close();
  }
});
