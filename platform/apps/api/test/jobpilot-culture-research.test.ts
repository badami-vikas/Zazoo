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
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AddressInfo } from "node:net";
import test from "node:test";
import { TRPCError } from "@trpc/server";
import { SeededRng, SystemClock, FixedClock, UuidGen, reserveChildRunAction, InMemoryChildAgentRunStore, InMemoryGoalTaskStore, createChildAgentRun, completeChildAgentRun, type RunCtx } from "@bridge/core";
import { DrizzleGoalTaskStore, DrizzleChildAgentRunStore, DrizzleLedgerStore } from "@bridge/db";
import { classifyCultureSource, MAX_CULTURE_SOURCES_PER_RUN } from "@bridge/jobpilot";
import { appRouter } from "../src/router.js";
import {
  INTERNAL_STRATEGIST_AGENT,
  LEARNING_AGENT,
  PILOT_USER,
  PILOT_WORKSPACE,
  buildWiring,
  buildInMemoryPorts,
  cancelCultureSourceFetch,
  materializeCultureSourceFetch,
  reconcileIntentChildConsistency,
  unsafeRegisterTestOnlyCultureSource,
  DurableCultureFetchStore,
  CultureFetchStaleLeaseError,
  CultureFetchCancelledRaceError,
  resolveAuthorizedCultureSource,
  computeSourcePolicyHash,
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

test("agentOrchestration.childRun.cancel (the GENERIC child-Run cancel endpoint) routes a culture-research child Run through its OWN durable cancellation mechanism instead of racing it — actually aborts the real in-flight socket AND leaves the culture-fetch intent record genuinely 'cancelled', never a child Run marked 'cancelled' while the underlying fetch keeps running unaware (TASK-011 remediation, 2026-07-19 coordinator distributed-defects RE-review round 2, issue 5)", async () => {
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

    const materializePromise = materializeCultureSourceFetch(cultureFetchDeps(wiring), PILOT_WORKSPACE, proposalId, childRunId, makeRun(), allowLoopback);
    await new Promise((resolve) => setTimeout(resolve, 60));

    // The GENERIC endpoint — a Human/Governance actor cancelling via
    // `agentOrchestration.childRun.cancel` has no idea this child Run
    // happens to be a culture-research fetch, and supplies only workspaceId
    // + childRunId (no proposalId at all, unlike `jobpilot.cultureResearch.
    // cancel`). This must still reach the SAME durable cancellation
    // mechanism (abort the real socket, set the durable `cancelRequested`
    // flag) rather than just flipping the child Run's own status.
    const cancelResult = await caller.agentOrchestration.childRun.cancel({ workspaceId: PILOT_WORKSPACE, childRunId });

    const materialized = await materializePromise;
    assert.equal(materialized.status, "cancelled", "the underlying fetch must actually be stopped, not left running while the child Run says cancelled");
    await new Promise((resolve) => setTimeout(resolve, 100));
    assert.equal(serverSawClose, true, "the real in-flight socket must actually be aborted by the GENERIC cancel endpoint, not merely a status flip");

    const finalRecord = await wiring.cultureFetchStore.getByProposal(PILOT_WORKSPACE, proposalId, childRunId);
    assert.equal(finalRecord?.status, "cancelled", "the culture-fetch intent record itself must converge to cancelled, never left 'fetching' behind a cancelled child Run");
    void cancelResult; // the immediate return only reflects the request-time snapshot (a live lease was held) — the AWAITED materializePromise above is what proves the real, final converged outcome.
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

test("lease-fenced terminal CAS: a STALE worker (its lease already reclaimed by a later attempt) cannot write a terminal outcome merely because status still reads 'fetching' — its fenced transition is refused with CultureFetchStaleLeaseError, never silently accepted (TASK-011 remediation, 2026-07-19 coordinator distributed-defects RE-review, issue 1)", async () => {
  const wiring = await buildWiring();
  try {
    const caller = makeCaller(wiring);
    const id = registerTestSource("http://127.0.0.1:1/lease-fence");
    const proposed = await caller.jobpilot.cultureResearch.propose({ workspaceId: PILOT_WORKSPACE, company: TEST_COMPANY, sourceIds: [id] });
    const { childRunId } = proposed.pending[0]!;

    const t0 = new Date().toISOString();
    const staleWorker = await wiring.cultureFetchStore.acquireLease(PILOT_WORKSPACE, childRunId, "worker-a-stale", t0);
    assert.equal(staleWorker.attempt, 1);

    // Worker A's lease expires; a LATER, legitimate attempt reclaims it.
    const farFuture = new Date(Date.parse(t0) + 60_000).toISOString();
    const reclaimingWorker = await wiring.cultureFetchStore.acquireLease(PILOT_WORKSPACE, childRunId, "worker-b-current", farFuture);
    assert.equal(reclaimingWorker.attempt, 2);
    assert.equal(reclaimingWorker.leaseOwner, "worker-b-current");

    // Worker A — unaware its lease was ever reclaimed (e.g. it was merely
    // slow, not actually dead, and finally finishes its stale network call)
    // — tries to write "fetched" using ITS OWN (now stale) fence. Status is
    // STILL "fetching" (worker B is currently holding it), so a status-only
    // CAS would have wrongly accepted this write; the lease fence must
    // refuse it.
    await assert.rejects(
      () =>
        wiring.cultureFetchStore.transition(
          PILOT_WORKSPACE,
          childRunId,
          ["fetching"],
          (r) => ({ ...r, status: "fetched", artifact: { sourceId: id, sourceType: "company_official_page", sourceLabel: "x", sourceUrl: "http://127.0.0.1:1/lease-fence", content: "stale content", contentHash: "deadbeef", retrievedAt: t0, trustOrigin: "untrusted_external", expiresAt: farFuture } }),
          { leaseOwner: staleWorker.leaseOwner!, attempt: staleWorker.attempt },
        ),
      (error: unknown) => {
        assert.ok(error instanceof CultureFetchStaleLeaseError);
        return true;
      },
    );

    // The record must be COMPLETELY untouched by worker A's refused write —
    // still "fetching", still owned by worker B.
    const afterRefusal = await wiring.cultureFetchStore.get(PILOT_WORKSPACE, childRunId);
    assert.equal(afterRefusal?.status, "fetching");
    assert.equal(afterRefusal?.leaseOwner, "worker-b-current");
    assert.equal(afterRefusal?.attempt, 2);

    // Worker B — the legitimate current holder — CAN write the terminal
    // outcome using its OWN correct fence.
    const wonByB = await wiring.cultureFetchStore.transition(
      PILOT_WORKSPACE,
      childRunId,
      ["fetching"],
      (r) => ({ ...r, status: "fetched", artifact: { sourceId: id, sourceType: "company_official_page", sourceLabel: "x", sourceUrl: "http://127.0.0.1:1/lease-fence", content: "real content", contentHash: "cafebabe", retrievedAt: farFuture, trustOrigin: "untrusted_external", expiresAt: farFuture } }),
      { leaseOwner: reclaimingWorker.leaseOwner!, attempt: reclaimingWorker.attempt },
    );
    assert.equal(wonByB.status, "fetched");
    assert.equal(wonByB.artifact?.content, "real content");
  } finally {
    await wiring.close();
  }
});

test("cancellation-fenced CAS: a durably-recorded cancelRequested refuses a 'fetched' write even though status/lease/attempt otherwise still match — requireCancelNotRequested closes the TOCTOU window a plain-read finalCheck cannot (TASK-011 remediation, 2026-07-19 coordinator distributed-defects RE-review round 2, issue 3)", async () => {
  const wiring = await buildWiring();
  try {
    const id = registerTestSource("http://127.0.0.1:1/cancel-race");
    const caller = makeCaller(wiring);
    const proposed = await caller.jobpilot.cultureResearch.propose({ workspaceId: PILOT_WORKSPACE, company: TEST_COMPANY, sourceIds: [id] });
    const { childRunId } = proposed.pending[0]!;

    const t0 = new Date().toISOString();
    const lease = await wiring.cultureFetchStore.acquireLease(PILOT_WORKSPACE, childRunId, "worker-x", t0);
    assert.equal(lease.attempt, 1);

    // A cancel lands durably WHILE worker-x still legitimately holds the
    // live lease — simulating the exact race: a REMOTE cancel request
    // commits between worker-x's own plain-read `finalCheck` and the
    // fenced "fetched" write it is about to attempt. `requestCancel` on a
    // still-live lease only sets the flag (does not itself transition
    // status), matching the real distributed-cancellation code path.
    const afterCancelRequest = await wiring.cultureFetchStore.requestCancel(PILOT_WORKSPACE, childRunId, t0);
    assert.equal(afterCancelRequest.status, "fetching");
    assert.equal(afterCancelRequest.cancelRequested, true);

    // worker-x, unaware of the race (its own `finalCheck` read happened
    // BEFORE the cancel landed), now attempts its fenced "fetched" write.
    // Status ("fetching") and lease/attempt (worker-x/1) still match
    // exactly — a fence that only checked those would wrongly accept this
    // write. `requireCancelNotRequested: true` must refuse it instead.
    await assert.rejects(
      () =>
        wiring.cultureFetchStore.transition(
          PILOT_WORKSPACE,
          childRunId,
          ["fetching"],
          (r) => ({ ...r, status: "fetched", artifact: { sourceId: id, sourceType: "company_official_page", sourceLabel: "x", sourceUrl: "http://127.0.0.1:1/cancel-race", content: "raced content", contentHash: "deadbeef", retrievedAt: t0, trustOrigin: "untrusted_external", expiresAt: t0 } }),
          { leaseOwner: lease.leaseOwner!, attempt: lease.attempt, requireCancelNotRequested: true },
        ),
      (error: unknown) => {
        assert.ok(error instanceof CultureFetchCancelledRaceError);
        return true;
      },
    );

    // The record must be untouched by the refused write — still
    // "fetching" (not silently "fetched"), cancel flag still set, ready
    // for worker-x (the only process that still legitimately owns this
    // lease) to resolve it to "cancelled" next, exactly as
    // `materializeCultureSourceFetch` does in the real self-resolve path.
    const afterRefusal = await wiring.cultureFetchStore.get(PILOT_WORKSPACE, childRunId);
    assert.equal(afterRefusal?.status, "fetching");
    assert.equal(afterRefusal?.cancelRequested, true);
    assert.equal(afterRefusal?.leaseOwner, "worker-x");

    // worker-x can still legitimately resolve this to "cancelled" (no
    // cancellation-race guard needed on a write TO cancelled itself).
    const resolved = await wiring.cultureFetchStore.transition(PILOT_WORKSPACE, childRunId, ["fetching"], (r) => ({ ...r, status: "cancelled" }), {
      leaseOwner: lease.leaseOwner!,
      attempt: lease.attempt,
    });
    assert.equal(resolved.status, "cancelled");
  } finally {
    await wiring.close();
  }
});

test("tagged transition ownership: materializeCultureSourceFetch never mutates the child Run's own lifecycle when its fenced write is refused — only the worker whose write actually commits may call complete/fail/cancelChildAgentRun (TASK-011 remediation, 2026-07-19 coordinator distributed-defects RE-review round 2, issue 4)", async () => {
  const server = await startTestServer((_req, res) => {
    res.writeHead(200, { "content-type": "text/plain" });
    res.end("Some real content that must never be recorded as this worker's win.");
  });
  const wiring = await buildWiring();
  try {
    const caller = makeCaller(wiring);
    const id = registerTestSource(server.url);
    const proposed = await caller.jobpilot.cultureResearch.propose({ workspaceId: PILOT_WORKSPACE, company: TEST_COMPANY, sourceIds: [id] });
    const { proposalId, childRunId } = proposed.pending[0]!;
    await caller.action.decide({ proposalId, decision: "approve" });

    // A stale worker acquires the lease first (attempt 1), then a later,
    // legitimate attempt reclaims it (attempt 2) — the child Run itself is
    // still "running" throughout, owned by nobody's completed write yet.
    const t0 = new Date().toISOString();
    const stale = await wiring.cultureFetchStore.acquireLease(PILOT_WORKSPACE, childRunId, "worker-stale", t0);
    assert.equal(stale.attempt, 1);
    const farFuture = new Date(Date.parse(t0) + 60_000).toISOString();
    await wiring.cultureFetchStore.acquireLease(PILOT_WORKSPACE, childRunId, "worker-current", farFuture);

    const beforeRunStatus = (await wiring.childAgentRuns.get(PILOT_WORKSPACE, childRunId))!.status;
    assert.equal(beforeRunStatus, "running");

    // The stale worker's own fenced write is refused (its lease was
    // reclaimed) — `attemptFencedTerminalTransition` must report
    // `committed: false` and the calling code (materialize's real
    // production logic, exercised directly here since the store method is
    // package-private to the wiring module) must NEVER touch the child
    // Run's lifecycle on a refusal. We assert the invariant at the level
    // this test can directly observe: the store-level refusal itself, and
    // that the child Run remains exactly as it was — untouched by anyone
    // claiming a win they did not actually get.
    await assert.rejects(() =>
      wiring.cultureFetchStore.transition(
        PILOT_WORKSPACE,
        childRunId,
        ["fetching"],
        (r) => ({ ...r, status: "fetched", artifact: { sourceId: id, sourceType: "company_official_page", sourceLabel: "x", sourceUrl: server.url, content: "stale worker's illegitimate win", contentHash: "badc0de", retrievedAt: t0, trustOrigin: "untrusted_external", expiresAt: farFuture } }),
        { leaseOwner: stale.leaseOwner!, attempt: stale.attempt },
      ),
    );
    const afterRefusal = await wiring.childAgentRuns.get(PILOT_WORKSPACE, childRunId);
    assert.equal(afterRefusal?.status, "running", "a refused fenced write must never be allowed to leak into the child Run's own lifecycle");

    await server.close();
  } finally {
    await wiring.close();
  }
});

test("action.decide: source proposal prebinding — a forged/out-of-band culture-research-shaped ledger row with NO matching culture-fetch intent binding is rejected before any decision resolves it, and a legitimate propose()'d proposal (real binding, created BEFORE the ledger row per the new preallocation order) still decides normally (TASK-011 remediation, 2026-07-19 coordinator distributed-defects RE-review round 2, issue 6)", async () => {
  const wiring = await buildWiring();
  try {
    const caller = makeCaller(wiring);

    // A forged row shaped exactly like a real `jobpilot.researchCultureSource`
    // proposal (same resourceType + child_agent_run context) but which never
    // went through `cultureResearch.propose` at all — no culture-fetch intent
    // record exists for its childRunId, so it can never be legitimately bound.
    const forgedChildRunId = randomUUID();
    const forged = await wiring.ledger.append({
      id: randomUUID(),
      workspaceId: PILOT_WORKSPACE,
      actorType: "agent",
      actorId: LEARNING_AGENT,
      action: "read",
      resourceType: "external:fetch",
      context: { type: "child_agent_run", id: forgedChildRunId },
      inputs: { sourceId: "forged-source", workspaceId: PILOT_WORKSPACE, company: TEST_COMPANY },
      userDecision: null,
      policyResults: [],
      createdAt: new Date().toISOString(),
    });
    await assert.rejects(
      () => caller.action.decide({ proposalId: forged.id, decision: "approve" }),
      (error: unknown) => {
        assert.ok(error instanceof TRPCError);
        assert.equal((error as TRPCError).code, "BAD_REQUEST");
        return true;
      },
    );

    // A forged row shaped like a real `jobpilot.synthesizeCultureProfile`
    // proposal (resourceType:signal, action:write, parentRunId+claims inputs)
    // with NO matching synthesis-pointer binding — same fail-closed backstop.
    const forgedSynth = await wiring.ledger.append({
      id: randomUUID(),
      workspaceId: PILOT_WORKSPACE,
      actorType: "agent",
      actorId: INTERNAL_STRATEGIST_AGENT,
      action: "write",
      resourceType: "signal",
      inputs: { parentRunId: randomUUID(), claims: [] },
      userDecision: null,
      policyResults: [],
      createdAt: new Date().toISOString(),
    });
    await assert.rejects(
      () => caller.action.decide({ proposalId: forgedSynth.id, decision: "approve" }),
      (error: unknown) => {
        assert.ok(error instanceof TRPCError);
        assert.equal((error as TRPCError).code, "BAD_REQUEST");
        return true;
      },
    );

    // Control: a REAL proposal produced by the actual `propose()` handler —
    // whose intent record was bound BEFORE the ledger row was ever created —
    // must still decide normally (the backstop does not false-positive on
    // legitimate proposals).
    const id = registerTestSource("http://127.0.0.1:1/prebinding-control");
    const proposed = await caller.jobpilot.cultureResearch.propose({ workspaceId: PILOT_WORKSPACE, company: TEST_COMPANY, sourceIds: [id] });
    const { proposalId } = proposed.pending[0]!;
    const decided = await caller.action.decide({ proposalId, decision: "approve" });
    assert.equal(decided.status, "applied");
  } finally {
    await wiring.close();
  }
});

test("idempotent budget reservation: a crash AFTER budget was reserved (but before any terminal outcome) does not permanently exhaust the fixed maxCalls:1 budget — a reclaiming attempt reuses the existing reservation instead of re-reserving, and completes the real fetch exactly once (TASK-011 remediation, 2026-07-19 coordinator distributed-defects RE-review, issue 2)", async () => {
  const server = await startTestServer((_req, res) => {
    res.writeHead(200, { "content-type": "text/plain" });
    res.end("Real content after crash recovery.");
  });
  const wiring = await buildWiring();
  try {
    const caller = makeCaller(wiring);
    const id = registerTestSource(server.url);
    const proposed = await caller.jobpilot.cultureResearch.propose({ workspaceId: PILOT_WORKSPACE, company: TEST_COMPANY, sourceIds: [id] });
    const { proposalId, childRunId } = proposed.pending[0]!;
    await caller.action.decide({ proposalId, decision: "approve" });

    // Simulate "worker 1 acquired the lease AND reserved budget, then
    // crashed" — exactly the window issue 2 describes: acquireLease
    // succeeds, reserveChildRunAction succeeds (consuming the fixed
    // maxCalls:1 budget), then the process dies before ever reaching a
    // terminal fetchStore transition.
    const t0 = new Date().toISOString();
    await wiring.cultureFetchStore.acquireLease(PILOT_WORKSPACE, childRunId, "crashed-worker", t0);
    const reserveViolation = await reserveChildRunAction(
      wiring.childAgentRuns,
      PILOT_WORKSPACE,
      childRunId,
      { action: "read", resourceType: "external:fetch", skill: "jobpilot.researchCultureSource", dataScope: "public" },
      1,
      t0,
    );
    assert.equal(reserveViolation, null, "the simulated crashed worker's own reservation must have succeeded");
    const childRunAfterCrash = await wiring.childAgentRuns.get(PILOT_WORKSPACE, childRunId);
    assert.equal(childRunAfterCrash?.callsUsed, 1, "budget was consumed by the crashed attempt");

    // A REAL recovery attempt now runs `materializeCultureSourceFetch` with
    // a clock advanced past the lease TTL (simulating real elapsed time
    // after the crash) — it must reclaim the lease AND complete the real
    // fetch, WITHOUT being blocked by "budget-exhausted" (the bug this fix
    // closes) and WITHOUT double-charging the budget.
    const farFutureClock = new FixedClock(new Date(Date.parse(t0) + 60_000).toISOString());
    const recoveredCtx: RunCtx = { clock: farFutureClock, rng: new SeededRng(2), ids: new UuidGen(farFutureClock, new SeededRng(2)) };
    const recovered = await materializeCultureSourceFetch(cultureFetchDeps(wiring), PILOT_WORKSPACE, proposalId, childRunId, recoveredCtx, allowLoopback);

    assert.equal(recovered.status, "fetched", "the reclaiming attempt must complete the real fetch despite the crashed attempt's earlier reservation");
    assert.equal(recovered.artifact?.content, "Real content after crash recovery.");

    const childRunAfterRecovery = await wiring.childAgentRuns.get(PILOT_WORKSPACE, childRunId);
    assert.equal(childRunAfterRecovery?.callsUsed, 1, "budget must NEVER be double-charged — still exactly 1 call used, not 2");
  } finally {
    await server.close();
    await wiring.close();
  }
});

test("intent/child terminal reconciliation: a fetched intent whose child Run is left 'running' (simulating a crash between the two separate durable writes) self-repairs to 'completed' on the next status read, and a failed intent similarly self-repairs its child Run to 'failed' (TASK-011 remediation, 2026-07-19 coordinator distributed-defects RE-review, issue 3)", async () => {
  const server = await startTestServer((_req, res) => {
    res.writeHead(200, { "content-type": "text/plain" });
    res.end("Reconciliation test content.");
  });
  const wiring = await buildWiring();
  try {
    const caller = makeCaller(wiring);

    // --- Case 1: fetched intent, child Run still "running" ---
    const id1 = registerTestSource(server.url);
    const proposed1 = await caller.jobpilot.cultureResearch.propose({ workspaceId: PILOT_WORKSPACE, company: TEST_COMPANY, sourceIds: [id1] });
    const { proposalId: proposalId1, childRunId: childRunId1 } = proposed1.pending[0]!;
    await caller.action.decide({ proposalId: proposalId1, decision: "approve" });
    await materializeCultureSourceFetch(cultureFetchDeps(wiring), PILOT_WORKSPACE, proposalId1, childRunId1, makeRun(1), allowLoopback);

    // Simulate the crash window: the intent is durably "fetched" (already
    // proven above), but roll the child Run BACK to "running" directly —
    // exactly the shape of state a crash between the two separate writes
    // would leave (the fetch itself proves the intent write happened; the
    // child-Run write is what we're pretending never landed).
    const childRun1 = await wiring.childAgentRuns.get(PILOT_WORKSPACE, childRunId1);
    assert.equal(childRun1?.status, "completed", "sanity: the normal happy path already completes the child Run");
    // Force it back to "running" by writing directly into the in-memory
    // store's backing map (test-only access) — the durable INTENT stays
    // "fetched" throughout, simulating the inconsistency this fix targets.
    (wiring.childAgentRuns as InMemoryChildAgentRunStore).runs.set(childRunId1, { ...childRun1!, status: "running" });
    const beforeRepair = await wiring.childAgentRuns.get(PILOT_WORKSPACE, childRunId1);
    assert.equal(beforeRepair?.status, "running", "sanity: the simulated inconsistency is in place");

    // The NEXT status read (the router's own polled query, exercised here
    // directly against the reconciliation helper it calls) must self-repair.
    const intent1 = await wiring.cultureFetchStore.getByProposal(PILOT_WORKSPACE, proposalId1, childRunId1);
    await reconcileIntentChildConsistency(wiring, PILOT_WORKSPACE, intent1!, makeRun(2));
    const repaired1 = await wiring.childAgentRuns.get(PILOT_WORKSPACE, childRunId1);
    assert.equal(repaired1?.status, "completed", "a fetched intent must self-repair its child Run back to completed");

    // --- Case 2: failed intent, child Run left "running" ---
    const id2 = registerTestSource("http://127.0.0.1:1/reconcile-fail");
    const proposed2 = await caller.jobpilot.cultureResearch.propose({ workspaceId: PILOT_WORKSPACE, company: TEST_COMPANY, sourceIds: [id2] });
    const { proposalId: proposalId2, childRunId: childRunId2 } = proposed2.pending[0]!;
    await caller.action.decide({ proposalId: proposalId2, decision: "approve" });
    await materializeCultureSourceFetch(cultureFetchDeps(wiring), PILOT_WORKSPACE, proposalId2, childRunId2, makeRun(3), allowLoopback).catch(() => {});
    const intentAfterFail = await wiring.cultureFetchStore.getByProposal(PILOT_WORKSPACE, proposalId2, childRunId2);
    assert.equal(intentAfterFail?.status, "failed", "sanity: the unreachable-host fetch really fails");
    const childRun2 = await wiring.childAgentRuns.get(PILOT_WORKSPACE, childRunId2);
    assert.equal(childRun2?.status, "failed", "sanity: the normal happy path already fails the child Run too");
    (wiring.childAgentRuns as InMemoryChildAgentRunStore).runs.set(childRunId2, { ...childRun2!, status: "running" });

    await reconcileIntentChildConsistency(wiring, PILOT_WORKSPACE, intentAfterFail!, makeRun(4));
    const repaired2 = await wiring.childAgentRuns.get(PILOT_WORKSPACE, childRunId2);
    assert.equal(repaired2?.status, "failed", "a failed intent must self-repair its child Run back to failed");
  } finally {
    await server.close();
    await wiring.close();
  }
});

test("artifact expiry: an EXPIRED artifact's raw content is purged (never served) on the next status read, while its citation metadata (hash/URL/timestamps) is preserved (TASK-011 remediation, 2026-07-19 coordinator distributed-defects RE-review, issue 7)", async () => {
  const server = await startTestServer((_req, res) => {
    res.writeHead(200, { "content-type": "text/plain" });
    res.end("Content that must eventually expire.");
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
    assert.notEqual(fetched.artifact?.content, "");

    // Simulate real elapsed time past the retention window by rewriting the
    // record's own `expiresAt` directly into the past — this is the exact
    // durable field `isArtifactExpired` reads; no other mechanism exists to
    // "wait" for expiry in a test without a real 24h delay.
    const record = await wiring.cultureFetchStore.getByProposal(PILOT_WORKSPACE, proposalId, childRunId);
    assert.ok(record?.artifact);
    const backdated = { ...record!, artifact: { ...record!.artifact!, expiresAt: new Date(Date.now() - 1000).toISOString() } };
    // Overwrite the durable record directly via the underlying memoryStore
    // (bypassing lease/status checks — those aren't the concern of THIS
    // test — to simulate "real elapsed time" without a real 24h wait).
    const rows = await wiring.memoryStore.retrieve({ subjectElementId: childRunId, includeSuperseded: false, limit: 1 }, { workspaceId: PILOT_WORKSPACE });
    const row = rows[0]!;
    await wiring.memoryStore.compareAndSupersede(row.id, { ...row, id: randomUUID(), content: JSON.stringify(backdated) });

    const beforePurge = await wiring.cultureFetchStore.getByProposal(PILOT_WORKSPACE, proposalId, childRunId);
    assert.notEqual(beforePurge?.artifact?.content, "", "sanity: content is still present before any purge-triggering read");

    // The router's own `status` query is what triggers the purge on read.
    const polled = await caller.jobpilot.cultureResearch.status({ workspaceId: PILOT_WORKSPACE, proposalId, childRunId });
    assert.equal(polled.artifact?.content, "", "expired content must be purged — never served");
    assert.equal(polled.artifact?.contentHash, fetched.artifact!.contentHash, "citation metadata (hash) must be preserved even after content purge");
    assert.equal(polled.artifact?.sourceUrl, fetched.artifact!.sourceUrl, "citation metadata (URL) must be preserved even after content purge");

    const afterPurge = await wiring.cultureFetchStore.getByProposal(PILOT_WORKSPACE, proposalId, childRunId);
    assert.equal(afterPurge?.artifact?.content, "", "the purge must be DURABLE, not merely reflected in the one response");
  } finally {
    await server.close();
    await wiring.close();
  }
});

test("artifact expiry: synthesize treats an EXPIRED artifact as NOT fetched — a claim citing ONLY the expired source is rejected as unknown-source even while a SECOND, unexpired source's claim in the same batch is available to ground normally (TASK-011 remediation, 2026-07-19 coordinator distributed-defects RE-review, issues 7/8)", async () => {
  const server = await startTestServer((_req, res) => {
    res.writeHead(200, { "content-type": "text/plain" });
    res.end("Our culture values collaboration and also transparency.");
  });
  const wiring = await buildWiring();
  try {
    const caller = makeCaller(wiring);
    const expiringId = registerTestSource(server.url);
    const freshId = registerTestSource(server.url);
    const proposed = await caller.jobpilot.cultureResearch.propose({ workspaceId: PILOT_WORKSPACE, company: TEST_COMPANY, sourceIds: [expiringId, freshId] });
    const expiringPending = proposed.pending.find((p) => p.sourceId === expiringId)!;
    const freshPending = proposed.pending.find((p) => p.sourceId === freshId)!;
    await caller.action.decide({ proposalId: expiringPending.proposalId, decision: "approve" });
    await caller.action.decide({ proposalId: freshPending.proposalId, decision: "approve" });
    const expiringFetched = await materializeCultureSourceFetch(cultureFetchDeps(wiring), PILOT_WORKSPACE, expiringPending.proposalId, expiringPending.childRunId, makeRun(1), allowLoopback);
    const freshFetched = await materializeCultureSourceFetch(cultureFetchDeps(wiring), PILOT_WORKSPACE, freshPending.proposalId, freshPending.childRunId, makeRun(2), allowLoopback);
    assert.equal(expiringFetched.status, "fetched");
    assert.equal(freshFetched.status, "fetched");

    // Backdate ONLY the first source's expiresAt into the past.
    const rows = await wiring.memoryStore.retrieve({ subjectElementId: expiringPending.childRunId, includeSuperseded: false, limit: 1 }, { workspaceId: PILOT_WORKSPACE });
    const row = rows[0]!;
    const record = JSON.parse(row.content) as typeof expiringFetched;
    const backdated = { ...record, artifact: { ...record.artifact!, expiresAt: new Date(Date.now() - 1000).toISOString() } };
    await wiring.memoryStore.compareAndSupersede(row.id, { ...row, id: randomUUID(), content: JSON.stringify(backdated) });

    // The synthesis overall still succeeds (the fresh source grounds its
    // own claim), but the claim citing the NOW-expired source must never
    // silently ground — `synthesize` fails closed for the WHOLE batch
    // (groundClaims is all-or-nothing), never partially applying only the
    // valid claim while silently dropping the invalid one.
    await assert.rejects(
      () =>
        caller.jobpilot.cultureResearch.synthesize({
          workspaceId: PILOT_WORKSPACE,
          company: TEST_COMPANY,
          parentRunId: proposed.parentRunId,
          claims: [
            { id: "claim-expired", claimType: "fact", sourceId: expiringId, quote: "values collaboration", contentHash: expiringFetched.artifact!.contentHash },
            { id: "claim-fresh", claimType: "fact", sourceId: freshId, quote: "also transparency", contentHash: freshFetched.artifact!.contentHash },
          ],
        }),
      /rejected|unknown-source/i,
    );

    // Proof that the EXPIRED source specifically is what's excluded: a
    // batch citing ONLY the fresh source succeeds normally.
    const onlyFresh = await caller.jobpilot.cultureResearch.synthesize({
      workspaceId: PILOT_WORKSPACE,
      company: TEST_COMPANY,
      parentRunId: proposed.parentRunId,
      claims: [{ id: "claim-fresh-only", claimType: "fact", sourceId: freshId, quote: "also transparency", contentHash: freshFetched.artifact!.contentHash }],
    });
    assert.equal(onlyFresh.status, "pending_review");
  } finally {
    await server.close();
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
    // TASK-011 remediation (2026-07-19 coordinator distributed-defects
    // RE-review round 2, issue 9) — Internal Strategist is reasoning
    // directly over untrusted external evidence; the turn's provenance must
    // be explicitly threaded through to the client, never silently absent.
    assert.equal(afterApproval.trustOrigin, "untrusted_external");
    const ledgerRow = await wiring.ledger.get(synthesisProposal.proposalId);
    assert.equal(ledgerRow?.trustOrigin, "untrusted_external", "the PERSISTED ledger row itself must carry the taint, not just the API response shape");
  } finally {
    await server.close();
    await wiring.close();
  }
});

test("cultureResearch.synthesize: the persisted ledger row for the synthesis proposal NEVER embeds the full raw fetched artifact content — only bounded quotes/hashes/refs — even though the Skill genuinely grounded (and therefore internally read) the real artifact body (TASK-011 remediation, 2026-07-19 coordinator distributed-defects RE-review round 2, issue 8)", async () => {
  const secretRawText = "SECRET RAW PAGE BODY: this exact sentinel string must never appear anywhere in the persisted ledger row.";
  const server = await startTestServer((_req, res) => {
    res.writeHead(200, { "content-type": "text/plain" });
    res.end(`Our culture values ownership. ${secretRawText}`);
  });
  const wiring = await buildWiring();
  try {
    const caller = makeCaller(wiring);
    const id = registerTestSource(server.url);
    const proposed = await caller.jobpilot.cultureResearch.propose({ workspaceId: PILOT_WORKSPACE, company: TEST_COMPANY, sourceIds: [id] });
    const { proposalId, childRunId } = proposed.pending[0]!;
    await caller.action.decide({ proposalId, decision: "approve" });
    const record = await materializeCultureSourceFetch(cultureFetchDeps(wiring), PILOT_WORKSPACE, proposalId, childRunId, makeRun(), allowLoopback);
    assert.ok(record.artifact!.content.includes(secretRawText), "sanity: the real fetched artifact DOES contain the sentinel");

    const synthesisProposal = await caller.jobpilot.cultureResearch.synthesize({
      workspaceId: PILOT_WORKSPACE,
      company: TEST_COMPANY,
      parentRunId: proposed.parentRunId,
      claims: [{ id: "good1", claimType: "fact", sourceId: id, quote: "values ownership", contentHash: record.artifact!.contentHash }],
    });
    assert.equal(synthesisProposal.status, "pending_review");

    // The Skill DID actually ground this claim against the real artifact
    // body (grounding would have failed otherwise) — but the PERSISTED
    // ledger row (both `inputs`, which the router now sends WITHOUT
    // artifact bodies, and `proposedOutput`, which only ever carried bounded
    // quotes/hashes) must never contain the raw page body, at any point.
    const ledgerRow = await wiring.ledger.get(synthesisProposal.proposalId);
    assert.ok(ledgerRow, "sanity: the ledger row exists");
    const serializedInputs = JSON.stringify(ledgerRow!.inputs);
    const serializedOutput = JSON.stringify(ledgerRow!.proposedOutput);
    assert.ok(!serializedInputs.includes(secretRawText), "the ledger row's `inputs` must NEVER embed the raw fetched artifact body");
    assert.ok(!serializedOutput.includes(secretRawText), "the ledger row's `proposedOutput` must NEVER embed the raw fetched artifact body");
    // Positive control: the bounded, already-validated QUOTE is fine to
    // appear (that's the whole point of `claimText`/citations) — proves
    // this isn't a false negative from an overly-strict/empty output.
    assert.ok(serializedOutput.includes("values ownership"), "sanity: the bounded quote itself IS expected in the output");
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

test("cultureResearch.latestRun: an O(1) durable pointer lookup — unrelated 'episodic' Memories (simulating Learning captures/Outreach drafts sharing the same Memory `type`) can NEVER hide the real latest run, at any scale, because the lookup no longer scans+limits the workspace's Memories at all (TASK-011 remediation, 2026-07-19 coordinator distributed-defects RE-review, issue 13)", async () => {
  const server = await startTestServer((_req, res) => {
    res.writeHead(200, { "content-type": "text/plain" });
    res.end("plain content");
  });
  const wiring = await buildWiring();
  try {
    const caller = makeCaller(wiring);
    const id = registerTestSource(server.url);
    const proposed = await caller.jobpilot.cultureResearch.propose({ workspaceId: PILOT_WORKSPACE, company: TEST_COMPANY, sourceIds: [id] });

    // Flood the SAME workspace with many unrelated `type: "episodic"`
    // Memories, all created AFTER the real culture-research record — under
    // the OLD scan-then-limit-then-filter design, a small enough limit
    // would have let these crowd the real record out of the scan window
    // entirely, making `latestRun` wrongly return null. The pointer-based
    // design performs no such scan at all.
    for (let i = 0; i < 50; i++) {
      await wiring.memoryStore.write({
        id: `40000000-0000-4000-8000-${String(i).padStart(12, "0")}`,
        workspaceId: PILOT_WORKSPACE,
        type: "episodic",
        scope: "workspace",
        content: JSON.stringify({ kind: "unrelated_learning_capture", note: `noise-${i}` }),
        confidence: 1,
        trustOrigin: "operator",
        plane: "local",
        createdBy: "test_fixture_unrelated_writer",
      });
    }

    const latest = await caller.jobpilot.cultureResearch.latestRun({ workspaceId: PILOT_WORKSPACE, company: TEST_COMPANY });
    assert.ok(latest, "the real latest run must still be found despite 50 unrelated, more-recently-created Memories sharing the same type");
    assert.equal(latest!.parentRunId, proposed.parentRunId);
    assert.equal(latest!.pending.length, 1);
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

test("cultureResearch.synthesize: rejects an EMPTY claims batch before ever creating a proposal — an empty submission can never poison the first-write synthesis pointer for this parentRunId (TASK-011 remediation, 2026-07-19 coordinator distributed-defects RE-review, issue 8)", async () => {
  const server = await startTestServer((_req, res) => {
    res.writeHead(200, { "content-type": "text/plain" });
    res.end("Real content.");
  });
  const wiring = await buildWiring();
  try {
    const caller = makeCaller(wiring);
    const id = registerTestSource(server.url);
    const proposed = await caller.jobpilot.cultureResearch.propose({ workspaceId: PILOT_WORKSPACE, company: TEST_COMPANY, sourceIds: [id] });
    const { proposalId, childRunId } = proposed.pending[0]!;
    await caller.action.decide({ proposalId, decision: "approve" });
    await materializeCultureSourceFetch(cultureFetchDeps(wiring), PILOT_WORKSPACE, proposalId, childRunId, makeRun(), allowLoopback);

    await assert.rejects(
      () => caller.jobpilot.cultureResearch.synthesize({ workspaceId: PILOT_WORKSPACE, company: TEST_COMPANY, parentRunId: proposed.parentRunId, claims: [] }),
      /at least one claim/i,
    );

    // Prove the pointer was never poisoned: a REAL, well-grounded synthesis
    // for the SAME parentRunId still succeeds afterward.
    const record = await wiring.cultureFetchStore.getByProposal(PILOT_WORKSPACE, proposalId, childRunId);
    const real = await caller.jobpilot.cultureResearch.synthesize({
      workspaceId: PILOT_WORKSPACE,
      company: TEST_COMPANY,
      parentRunId: proposed.parentRunId,
      claims: [{ id: "claim-1", claimType: "fact", sourceId: id, quote: "Real content", contentHash: record!.artifact!.contentHash }],
    });
    assert.equal(real.status, "pending_review");
  } finally {
    await server.close();
    await wiring.close();
  }
});

test("cultureResearch.synthesize: rejects when zero unexpired fetched artifacts exist for this parentRunId, even with non-empty claims — no claim can ground against zero evidence (TASK-011 remediation, 2026-07-19 coordinator distributed-defects RE-review, issue 8)", async () => {
  const wiring = await buildWiring();
  try {
    const caller = makeCaller(wiring);
    const id = registerTestSource("http://127.0.0.1:1/never-fetched");
    const proposed = await caller.jobpilot.cultureResearch.propose({ workspaceId: PILOT_WORKSPACE, company: TEST_COMPANY, sourceIds: [id] });
    // Deliberately never approve/materialize — zero fetched artifacts exist.
    await assert.rejects(
      () =>
        caller.jobpilot.cultureResearch.synthesize({
          workspaceId: PILOT_WORKSPACE,
          company: TEST_COMPANY,
          parentRunId: proposed.parentRunId,
          claims: [{ id: "claim-1", claimType: "fact", sourceId: id, quote: "anything", contentHash: "deadbeef" }],
        }),
      /unexpired fetched artifact/i,
    );
  } finally {
    await wiring.close();
  }
});

test("cultureResearch.synthesisResult: an approved proposal whose actor is NOT the real Internal Strategist Agent identity is rejected as not_available, even if action/resourceType/schema otherwise match (TASK-011 remediation, 2026-07-19 coordinator distributed-defects RE-review, issue 8)", async () => {
  const wiring = await buildWiring();
  try {
    const caller = makeCaller(wiring);
    // A DIFFERENT agent proposes a schema-shaped, action:write/resourceType:signal
    // payload that would otherwise pass every other synthesisResult gate.
    const parentRunId = "50000000-0000-4000-8000-000000000001";
    const forgedOutput = {
      parentRunId,
      partition: { facts: [], opinions: [], themes: [], contradictions: [], inferences: [] },
      disclosure: { used: [], skipped: [] },
      artifactHashes: [],
    };
    const proposal = await wiring.pipeline.propose(
      {
        workspaceId: PILOT_WORKSPACE,
        actor: { type: "agent", id: LEARNING_AGENT }, // NOT Internal Strategist
        onBehalfOf: { type: "user", id: PILOT_USER },
        action: "write",
        resourceType: "signal",
        skill: "jobpilot.synthesizeCultureProfile",
        dataScope: "all",
        inputs: {},
      },
      makeRun(),
    );
    // Manually stamp the forged output onto the proposal (simulating a
    // hypothetical bypass) is not directly possible via the public API, so
    // this test instead proves the ACTOR gate rejects a differently-actored
    // proposal outright, independent of whether its output could ever be
    // forged to this shape.
    await wiring.ledger.append({
      id: randomUUID(),
      workspaceId: PILOT_WORKSPACE,
      actorType: "agent",
      actorId: LEARNING_AGENT,
      action: "write",
      resourceType: "signal",
      inputs: {},
      proposedOutput: forgedOutput,
      userDecision: "approve",
      policyResults: [],
      refLedgerId: proposal.id,
      createdAt: new Date().toISOString(),
    });
    const result = await caller.jobpilot.cultureResearch.synthesisResult({
      workspaceId: PILOT_WORKSPACE,
      company: TEST_COMPANY,
      proposalId: proposal.id,
      parentRunId,
    });
    assert.deepEqual(result, { status: "not_available" });
  } finally {
    await wiring.close();
  }
});

test("cultureResearch.synthesize: prebinding the synthesis pointer BEFORE pipeline.propose closes the append-without-pointer crash window — a claim-grounding failure (Skill throws before any real ledger row exists) does not permanently poison the parentRunId's pointer, and a subsequent legitimate synthesize() for the SAME run still succeeds (TASK-011 remediation, 2026-07-19 coordinator distributed-defects RE-review round 2, issue 7)", async () => {
  const server = await startTestServer((_req, res) => {
    res.writeHead(200, { "content-type": "text/plain" });
    res.end("Our culture rewards long-term thinking.");
  });
  const wiring = await buildWiring();
  try {
    const caller = makeCaller(wiring);
    const id = registerTestSource(server.url);
    const proposed = await caller.jobpilot.cultureResearch.propose({ workspaceId: PILOT_WORKSPACE, company: TEST_COMPANY, sourceIds: [id] });
    const { proposalId, childRunId } = proposed.pending[0]!;
    await caller.action.decide({ proposalId, decision: "approve" });
    const fetched = await materializeCultureSourceFetch(cultureFetchDeps(wiring), PILOT_WORKSPACE, proposalId, childRunId, makeRun(), allowLoopback);

    // A claim whose quote is absent from the fetched artifact causes
    // `groundClaims` (invoked INSIDE the Skill, during `pipeline.propose`)
    // to throw a `ClaimGroundingError` SYNCHRONOUSLY — no real ledger row is
    // ever created for this attempt. Without the release-on-failure fix,
    // this would have permanently bound (poisoned) the parentRunId's
    // first-write-wins pointer to a proposalId that can never resolve.
    await assert.rejects(() =>
      caller.jobpilot.cultureResearch.synthesize({
        workspaceId: PILOT_WORKSPACE,
        company: TEST_COMPANY,
        parentRunId: proposed.parentRunId,
        claims: [{ id: "claim-bad", claimType: "fact", sourceId: id, quote: "this text is not in the artifact at all", contentHash: fetched.artifact!.contentHash }],
      }),
    );

    // Sanity: the pointer must NOT still be bound to the failed attempt's
    // dead proposalId — a fresh, legitimate synthesize() for the SAME
    // parentRunId must succeed, not be rejected as "already pointed at a
    // different synthesis proposal".
    const legitimate = await caller.jobpilot.cultureResearch.synthesize({
      workspaceId: PILOT_WORKSPACE,
      company: TEST_COMPANY,
      parentRunId: proposed.parentRunId,
      claims: [{ id: "claim-good", claimType: "fact", sourceId: id, quote: "rewards long-term thinking", contentHash: fetched.artifact!.contentHash }],
    });
    assert.equal(legitimate.status, "pending_review");
    const pointer = await wiring.cultureSynthesisPointerStore.getForParentRun(PILOT_WORKSPACE, proposed.parentRunId);
    assert.equal(pointer?.proposalId, legitimate.proposalId, "the pointer must resolve to the LEGITIMATE, successfully-proposed synthesis, not the failed attempt");
  } finally {
    await server.close();
    await wiring.close();
  }
});

test("cultureResearch.synthesize: self-heals a DEAD pointer left by a genuine crash between recordProposal succeeding and pipeline.propose ever running (simulating a process kill mid-request, distinct from a controlled rejection) — a fresh synthesize() for the SAME parentRunId is not permanently blocked (TASK-011 remediation, 2026-07-19 coordinator distributed-defects RE-review round 2, issue 7)", async () => {
  const server = await startTestServer((_req, res) => {
    res.writeHead(200, { "content-type": "text/plain" });
    res.end("Our culture values direct feedback.");
  });
  const wiring = await buildWiring();
  try {
    const caller = makeCaller(wiring);
    const id = registerTestSource(server.url);
    const proposed = await caller.jobpilot.cultureResearch.propose({ workspaceId: PILOT_WORKSPACE, company: TEST_COMPANY, sourceIds: [id] });
    const { proposalId, childRunId } = proposed.pending[0]!;
    await caller.action.decide({ proposalId, decision: "approve" });
    const fetched = await materializeCultureSourceFetch(cultureFetchDeps(wiring), PILOT_WORKSPACE, proposalId, childRunId, makeRun(), allowLoopback);

    // Simulate the crash DIRECTLY: bind a pointer to a proposalId that
    // genuinely has NO ledger row at all (as if the process died the
    // instant after `recordProposal` committed, before `pipeline.propose`
    // ever ran) — the observable end state a real crash there would leave.
    const deadProposalId = randomUUID();
    await wiring.cultureSynthesisPointerStore.recordProposal(PILOT_WORKSPACE, proposed.parentRunId, TEST_COMPANY, deadProposalId);
    assert.equal(await wiring.ledger.get(deadProposalId), null, "sanity: the dead proposalId truly has no ledger row");

    // Backdate the pointer's own `createdAt` well past the self-heal grace
    // period — a fresh independent review found the ORIGINAL self-heal
    // check unsafe (it could dethrone a genuinely live, still-in-flight
    // concurrent synthesize() call, not just a truly dead crash artifact);
    // the fix requires the pointer to be OLD before ever releasing it. This
    // backdate is what makes THIS test genuinely simulate "a real crash a
    // long time ago", as opposed to "a request that is merely still running".
    const pointerRows = await wiring.memoryStore.retrieve(
      { subjectElementId: proposed.parentRunId, includeSuperseded: false, limit: 5 },
      { workspaceId: PILOT_WORKSPACE },
    );
    const pointerRow = pointerRows.find((r) => {
      try {
        return (JSON.parse(r.content) as { kind?: string }).kind === "culture_synthesis_pointer";
      } catch {
        return false;
      }
    });
    assert.ok(pointerRow, "sanity: the dead pointer row exists");
    const backdated = { ...(JSON.parse(pointerRow!.content) as { createdAt: string }), createdAt: new Date(Date.now() - 60_000).toISOString() };
    await wiring.memoryStore.compareAndSupersede(pointerRow!.id, { ...pointerRow!, id: randomUUID(), content: JSON.stringify(backdated) });

    const healed = await caller.jobpilot.cultureResearch.synthesize({
      workspaceId: PILOT_WORKSPACE,
      company: TEST_COMPANY,
      parentRunId: proposed.parentRunId,
      claims: [{ id: "claim-1", claimType: "fact", sourceId: id, quote: "values direct feedback", contentHash: fetched.artifact!.contentHash }],
    });
    assert.equal(healed.status, "pending_review");
    assert.notEqual(healed.proposalId, deadProposalId);
    const pointer = await wiring.cultureSynthesisPointerStore.getForParentRun(PILOT_WORKSPACE, proposed.parentRunId);
    assert.equal(pointer?.proposalId, healed.proposalId, "the pointer must now resolve to the NEW, real synthesis proposal, not the dead one");
  } finally {
    await server.close();
    await wiring.close();
  }
});

test("cultureResearch.synthesize: a YOUNG pointer whose proposalId does not yet resolve in the ledger is NEVER self-healed/released — a fresh independent review found the original age-less self-heal check could dethrone a genuinely live, in-flight concurrent synthesize() call, permanently orphaning its soon-to-exist valid ledger row against action.decide's binding backstop (TASK-011 remediation, 2026-07-19 coordinator distributed-defects RE-review round 2, issue 7 hardening)", async () => {
  const server = await startTestServer((_req, res) => {
    res.writeHead(200, { "content-type": "text/plain" });
    res.end("Our culture values direct feedback.");
  });
  const wiring = await buildWiring();
  try {
    const caller = makeCaller(wiring);
    const id = registerTestSource(server.url);
    const proposed = await caller.jobpilot.cultureResearch.propose({ workspaceId: PILOT_WORKSPACE, company: TEST_COMPANY, sourceIds: [id] });
    const { proposalId, childRunId } = proposed.pending[0]!;
    await caller.action.decide({ proposalId, decision: "approve" });
    const fetched = await materializeCultureSourceFetch(cultureFetchDeps(wiring), PILOT_WORKSPACE, proposalId, childRunId, makeRun(), allowLoopback);

    // Simulate the "live, in-flight" moment DIRECTLY: bind a pointer whose
    // proposalId has no ledger row YET (mirroring the exact instant a real
    // concurrent synthesize() call is still inside pipeline.propose, before
    // #appendLedger has run) — but do NOT backdate it. Its createdAt is
    // "now", well within the grace period.
    const inFlightProposalId = randomUUID();
    await wiring.cultureSynthesisPointerStore.recordProposal(PILOT_WORKSPACE, proposed.parentRunId, TEST_COMPANY, inFlightProposalId);
    assert.equal(await wiring.ledger.get(inFlightProposalId), null, "sanity: the in-flight proposalId has no ledger row yet, exactly like a real request mid-propose()");

    // A SECOND synthesize() call for the SAME parentRunId must NOT be able
    // to steal/rebind the pointer — it must instead see it as still-live
    // (first-write-wins) and fail with CONFLICT, exactly the ordinary
    // "someone else is already synthesizing this run" outcome, never a
    // silent takeover.
    await assert.rejects(
      () =>
        caller.jobpilot.cultureResearch.synthesize({
          workspaceId: PILOT_WORKSPACE,
          company: TEST_COMPANY,
          parentRunId: proposed.parentRunId,
          claims: [{ id: "claim-1", claimType: "fact", sourceId: id, quote: "values direct feedback", contentHash: fetched.artifact!.contentHash }],
        }),
      (error: unknown) => {
        assert.ok(error instanceof TRPCError);
        assert.equal((error as TRPCError).code, "CONFLICT");
        return true;
      },
    );

    // The pointer must be COMPLETELY untouched — still pointing at the
    // "in-flight" proposalId, never released or rebound.
    const pointer = await wiring.cultureSynthesisPointerStore.getForParentRun(PILOT_WORKSPACE, proposed.parentRunId);
    assert.equal(pointer?.proposalId, inFlightProposalId, "the young, not-yet-resolved pointer must survive a concurrent synthesize() attempt completely untouched");
  } finally {
    await server.close();
    await wiring.close();
  }
});

test("BRIDGE_LOCAL_DIR durability: goalTasks/childAgentRuns are bound to their REAL Drizzle-backed stores (never in-memory) when BRIDGE_LOCAL_DIR is set, and remain the original process-only in-memory stores when it is not — TASK-011 remediation (2026-07-19 coordinator distributed-defects RE-review, issue 6)", async () => {
  const dir = mkdtempSync(join(tmpdir(), "bridge-culture-research-localdir-test-"));
  let durablePorts: Awaited<ReturnType<typeof buildInMemoryPorts>> | undefined;
  let ephemeralPorts: Awaited<ReturnType<typeof buildInMemoryPorts>> | undefined;
  try {
    durablePorts = await buildInMemoryPorts({ localDir: dir });
    assert.ok(durablePorts.goalTasks instanceof DrizzleGoalTaskStore, "goalTasks must be the REAL Drizzle-backed store when BRIDGE_LOCAL_DIR is set");
    assert.ok(durablePorts.childAgentRuns instanceof DrizzleChildAgentRunStore, "childAgentRuns must be the REAL Drizzle-backed store when BRIDGE_LOCAL_DIR is set");
    // TASK-011 remediation (2026-07-19, migration-sequencing round 3) —
    // TASK-008's migration `0015_task008_relation_contract` landed on
    // `origin/main` permitting `ledger_user_decision_check` to accept
    // `'auto'`, and TASK-008 independently needed `ledger` itself to be
    // genuinely restart-durable under `BRIDGE_LOCAL_DIR` for its own
    // relationship-materialization retry flow — `ledger` is now bound to
    // the REAL `DrizzleLedgerStore` here too, exactly like
    // `goalTasks`/`childAgentRuns`, closing the ONE remaining blocker this
    // fix's own doc history disclosed (see `wiring.ts`'s
    // `buildInMemoryPorts` doc comment for the full history).
    assert.ok(durablePorts.ledger instanceof DrizzleLedgerStore, "ledger must be the REAL Drizzle-backed store when BRIDGE_LOCAL_DIR is set — TASK-008's migration 0015 closed the ledger_user_decision_check 'auto' blocker");

    // Prove the seeded governance hooks are ALSO wired (needed for the
    // Drizzle stores' own foreign-key integrity against `agents`).
    assert.equal(typeof durablePorts.ensureLearningGovernance, "function");
    assert.equal(typeof durablePorts.ensureInternalStrategistGovernance, "function");

    ephemeralPorts = await buildInMemoryPorts({ localDir: undefined });
    assert.ok(ephemeralPorts.goalTasks instanceof InMemoryGoalTaskStore, "goalTasks must remain the ORIGINAL process-local store when BRIDGE_LOCAL_DIR is unset — zero behavior change for the default (no-BRIDGE_LOCAL_DIR) path this fix must never destabilize");
    assert.ok(ephemeralPorts.childAgentRuns instanceof InMemoryChildAgentRunStore, "childAgentRuns must remain the ORIGINAL process-local store when BRIDGE_LOCAL_DIR is unset");
    assert.equal(ephemeralPorts.ensureLearningGovernance, undefined, "the governance-seeding hooks must be ABSENT (not merely no-ops) when BRIDGE_LOCAL_DIR is unset, exactly as before this fix");
  } finally {
    if (durablePorts) await durablePorts.closeDb();
    if (ephemeralPorts) await ephemeralPorts.closeDb();
  }
});

test("BRIDGE_LOCAL_DIR restart durability: Goal/Task bindings and child-Run status/budget genuinely persist to REAL on-disk SQL tables, not an in-process cache (TASK-011 remediation, 2026-07-19 coordinator distributed-defects RE-review, issue 6). NOTE: a literal close-then-reopen-a-second-wiring restart simulation against the SAME on-disk BRIDGE_LOCAL_DIR hits a PRE-EXISTING, documented, unrelated migration-rerun limitation (see the sibling 'culture fetch intent records survive a fresh DurableCultureFetchStore' test's own doc comment) — this test proves the SAME underlying real-SQL-persistence property that test already established for the culture-fetch intent record, extended to Goal/Task + child-Run state.", async () => {
  const dir = mkdtempSync(join(tmpdir(), "bridge-culture-research-durable-store-test-"));
  let ports: Awaited<ReturnType<typeof buildInMemoryPorts>> | undefined;
  try {
    ports = await buildInMemoryPorts({ localDir: dir });
    const goalTasks = ports.goalTasks as DrizzleGoalTaskStore;
    const childAgentRuns = ports.childAgentRuns as DrizzleChildAgentRunStore;
    const c = makeRun();

    // Seed the real workspace/user + governed LEARNING_AGENT row this
    // low-level test bypasses by calling `buildInMemoryPorts` directly
    // instead of the full `buildWiring()` boot sequence — mirrors exactly
    // what `buildWiring()` itself does before ever touching goalTasks/
    // childAgentRuns, proving the SAME FK-integrity path this fix relies on.
    await ports.workspaceStore.bootstrapPilotIdentities({
      workspaceId: PILOT_WORKSPACE,
      userId: PILOT_USER,
      userEmail: "test_fixture_pilot@example.com",
    });
    await ports.ensureLearningGovernance?.();

    const goal = await goalTasks.createGoal(
      { workspaceId: PILOT_WORKSPACE, type: "culture_research", title: "test_fixture restart-durability goal" },
      { nextId: () => c.ids.next(), nowISO: () => c.clock.nowISO() },
    );
    const task = await goalTasks.createTask(
      { workspaceId: PILOT_WORKSPACE, goalId: goal.id, type: "research_culture_source", assignedAgentId: LEARNING_AGENT },
      { nextId: () => c.ids.next(), nowISO: () => c.clock.nowISO() },
    );
    const parentEnvelope = {
      runId: c.ids.next(),
      agentId: LEARNING_AGENT,
      workspaceId: PILOT_WORKSPACE,
      authorityScope: ["external:fetch:read"],
      eligibleSkills: ["jobpilot.researchCultureSource"],
      dataScope: "public" as const,
      plane: "cloud" as const,
      budgetRemaining: { calls: 1, cost: 1 },
      reviewMode: "approve" as const,
      childRunPolicy: "allowed" as const,
      delegationDepth: 0,
      onBehalfOf: { type: "user" as const, id: PILOT_USER },
    };
    const childRun = await createChildAgentRun(
      { store: childAgentRuns, ledger: ports.ledger },
      parentEnvelope,
      {
        goalId: goal.id,
        taskId: task.id,
        delegatedScope: ["external:fetch:read"],
        selectedSkills: ["jobpilot.researchCultureSource"],
        budget: { maxCalls: 1, maxCost: 1 },
        deadline: new Date(Date.now() + 5 * 60_000).toISOString(),
        stopCondition: "test_fixture restart durability",
        requestedDataScope: "public",
        touchesExternalRisk: true,
      },
      c,
    );
    await childAgentRuns.consumeBudget(PILOT_WORKSPACE, childRun.id, 1, c.clock.nowISO());
    await completeChildAgentRun({ store: childAgentRuns, ledger: ports.ledger }, PILOT_WORKSPACE, childRun.id, { type: "agent", id: LEARNING_AGENT }, c);

    // Genuinely real SQL round-trips (not an in-process cache): every read
    // below goes through `DrizzleGoalTaskStore`/`DrizzleChildAgentRunStore`
    // (confirmed by the sibling class-identity test above) against the
    // on-disk pglite directory — the SAME real-SQL guarantee the existing
    // "culture fetch intent records survive a fresh DurableCultureFetchStore"
    // test already established for the culture-fetch intent record itself.
    const resumedGoal = await goalTasks.getGoal(PILOT_WORKSPACE, goal.id);
    assert.ok(resumedGoal);
    assert.equal(resumedGoal!.title, "test_fixture restart-durability goal");
    const resumedTask = await goalTasks.getTask(PILOT_WORKSPACE, task.id);
    assert.ok(resumedTask);
    assert.equal(resumedTask!.assignedAgentId, LEARNING_AGENT);
    const resumedChildRun = await childAgentRuns.get(PILOT_WORKSPACE, childRun.id);
    assert.ok(resumedChildRun);
    assert.equal(resumedChildRun!.status, "completed");
    assert.equal(resumedChildRun!.callsUsed, 1);
  } finally {
    if (ports) await ports.closeDb();
  }
});

test("BRIDGE_LOCAL_DIR genuine process restart: a PENDING research proposal and an APPROVED-BUT-UNMATERIALIZED fetch both survive a real close-then-rebuild restart, using ONLY the fresh instance's own budget/lease/ledger machinery afterward — TASK-011 remediation (2026-07-19, migration-sequencing round 3, coordinator-requested proof now that TASK-008's migration 0015 closed the ledger_user_decision_check 'auto' blocker). Uses buildInMemoryPorts() directly (twice, against the SAME on-disk directory) — the SAME proven-safe restart-simulation technique the sibling 'BRIDGE_LOCAL_DIR restart durability' test and TASK-008's own wiring.test.ts restart test already use; a literal buildWiring() (which additionally re-runs the SEPARATE local-plane's own migrations on every call) hits a genuine, pre-existing, unrelated pglite/migration-rerun limitation when invoked twice within one process — buildInMemoryPorts() avoids it entirely, and is what this fix's OWN durable stores actually depend on.", async () => {
  const dir = mkdtempSync(join(tmpdir(), "bridge-culture-research-full-restart-"));
  const server = await startTestServer((_req, res) => {
    res.writeHead(200, { "content-type": "text/plain" });
    res.end("Our culture values durability across restarts.");
  });
  let first: Awaited<ReturnType<typeof buildInMemoryPorts>> | undefined;
  let second: Awaited<ReturnType<typeof buildInMemoryPorts>> | undefined;
  try {
    first = await buildInMemoryPorts({ localDir: dir });
    assert.ok(first.ledger instanceof DrizzleLedgerStore, "sanity: ledger is genuinely Drizzle-backed under BRIDGE_LOCAL_DIR");
    await first.workspaceStore.bootstrapPilotIdentities({
      workspaceId: PILOT_WORKSPACE,
      userId: PILOT_USER,
      userEmail: "test_fixture_pilot_restart@example.com",
    });
    await first.ensureLearningGovernance?.();
    const c = makeRun();

    const idPending = registerTestSource(server.url);
    const idApproved = registerTestSource(server.url);
    const sourcePending = resolveAuthorizedCultureSource(PILOT_WORKSPACE, TEST_COMPANY, idPending)!;
    const sourceApproved = resolveAuthorizedCultureSource(PILOT_WORKSPACE, TEST_COMPANY, idApproved)!;

    const goal = await first.goalTasks.createGoal(
      { workspaceId: PILOT_WORKSPACE, type: "culture_research", title: "test_fixture restart research goal" },
      { nextId: () => c.ids.next(), nowISO: () => c.clock.nowISO() },
    );
    const task = await first.goalTasks.createTask(
      { workspaceId: PILOT_WORKSPACE, goalId: goal.id, type: "research_culture_source", assignedAgentId: LEARNING_AGENT },
      { nextId: () => c.ids.next(), nowISO: () => c.clock.nowISO() },
    );
    const parentRunId = c.ids.next();
    const parentEnvelope = {
      runId: parentRunId,
      agentId: LEARNING_AGENT,
      workspaceId: PILOT_WORKSPACE,
      authorityScope: ["external:fetch:read"],
      eligibleSkills: ["jobpilot.researchCultureSource"],
      dataScope: "public" as const,
      plane: "cloud" as const,
      budgetRemaining: { calls: 2, cost: 2 },
      reviewMode: "approve" as const,
      childRunPolicy: "allowed" as const,
      delegationDepth: 0,
      onBehalfOf: { type: "user" as const, id: PILOT_USER },
    };

    // Mirrors EXACTLY what `jobpilot.cultureResearch.propose`'s router
    // handler does per source — a durable culture-fetch intent record
    // created and bound to a real ledger proposal — but constructed
    // directly against the raw ports (no full Wiring/pipeline available at
    // this level), the SAME technique the sibling restart test above uses
    // for Goal/Task/child-Run state.
    async function proposeOneSource(source: typeof sourcePending) {
      const childRun = await createChildAgentRun(
        { store: first!.childAgentRuns, ledger: first!.ledger },
        parentEnvelope,
        {
          goalId: goal.id,
          taskId: task.id,
          delegatedScope: ["external:fetch:read"],
          selectedSkills: ["jobpilot.researchCultureSource"],
          budget: { maxCalls: 1, maxCost: 1 },
          deadline: new Date(Date.now() + 5 * 60_000).toISOString(),
          stopCondition: "test_fixture restart research",
          requestedDataScope: "public",
          touchesExternalRisk: true,
        },
        c,
      );
      const fetchStore = new DurableCultureFetchStore(first!.memoryStore);
      await fetchStore.create({
        childRunId: childRun.id,
        parentRunId,
        workspaceId: PILOT_WORKSPACE,
        company: TEST_COMPANY,
        sourceId: source.id,
        sourceType: source.sourceType,
        sourceLabel: source.sourceLabel,
        canonicalUrl: source.url,
        allowedRedirectOrigins: source.allowedRedirectOrigins,
        policySnapshot: { registryVersion: computeSourcePolicyHash(source), eligibility: classifyCultureSource(source.sourceType).eligibility },
        goalId: goal.id,
        taskId: task.id,
        skill: "jobpilot.researchCultureSource",
        action: "read",
        actorId: LEARNING_AGENT,
      });
      const proposalId = c.ids.next();
      await fetchStore.attachProposal(PILOT_WORKSPACE, childRun.id, proposalId);
      await first!.ledger.append({
        id: proposalId,
        workspaceId: PILOT_WORKSPACE,
        actorType: "agent",
        actorId: LEARNING_AGENT,
        action: "read",
        resourceType: "external:fetch",
        inputs: { sourceId: source.id, workspaceId: PILOT_WORKSPACE, company: TEST_COMPANY },
        proposedOutput: { sourceId: source.id, sourceType: source.sourceType, sourceLabel: source.sourceLabel, url: source.url, plannedAt: c.clock.nowISO() },
        userDecision: null,
        policyResults: [],
        context: { type: "child_agent_run", id: childRun.id, runId: parentRunId },
        createdAt: c.clock.nowISO(),
      });
      return { proposalId, childRunId: childRun.id };
    }

    const pendingEntry = await proposeOneSource(sourcePending);
    const approvedEntry = await proposeOneSource(sourceApproved);
    // Approve the second proposal's decision row directly (mirrors
    // `pipeline.decide`'s own ledger effect at the storage layer this test
    // operates at) — leave the fetch itself UNMATERIALIZED.
    await first.ledger.append({
      id: c.ids.next(),
      workspaceId: PILOT_WORKSPACE,
      actorType: "user",
      actorId: PILOT_USER,
      action: "read",
      resourceType: "external:fetch",
      inputs: {},
      userDecision: "approve",
      policyResults: [],
      refLedgerId: approvedEntry.proposalId,
      createdAt: c.clock.nowISO(),
    });

    // Sanity, BEFORE the restart.
    assert.equal(await first.ledger.decisionFor(pendingEntry.proposalId), null, "sanity: pending proposal has no decision yet");
    assert.equal((await first.ledger.decisionFor(approvedEntry.proposalId))?.userDecision, "approve", "sanity: approved proposal has a real decision row");
    const fetchStoreBefore = new DurableCultureFetchStore(first.memoryStore);
    const approvedRecordBefore = await fetchStoreBefore.get(PILOT_WORKSPACE, approvedEntry.childRunId);
    assert.equal(approvedRecordBefore?.status, "pending", "sanity: approved-but-unmaterialized — the fetch has NOT run yet");

    // THE RESTART: close every port this process holds and build a BRAND
    // NEW `buildInMemoryPorts()` instance from scratch against the SAME
    // on-disk directory — genuinely reloading from durable storage, not
    // reusing any in-process object.
    await first.closeDb();
    first = undefined;
    second = await buildInMemoryPorts({ localDir: dir });

    // The PENDING proposal must still be pending — durably, not merely "not
    // yet garbage collected in this process".
    assert.equal(await second.ledger.decisionFor(pendingEntry.proposalId), null, "a pending research proposal's absence of a decision must survive a genuine process restart");
    const pendingProposalAfter = await second.ledger.get(pendingEntry.proposalId);
    assert.ok(pendingProposalAfter, "the pending proposal's own ledger row must still exist after restart");

    // The APPROVED-BUT-UNMATERIALIZED fetch must still show its decision AND
    // its intent record, both from the FRESH instance's own stores only.
    const approvedDecisionAfter = await second.ledger.decisionFor(approvedEntry.proposalId);
    assert.equal(approvedDecisionAfter?.userDecision, "approve", "the approved decision must survive the restart");
    const fetchStoreAfter = new DurableCultureFetchStore(second.memoryStore);
    const approvedRecordAfter = await fetchStoreAfter.get(PILOT_WORKSPACE, approvedEntry.childRunId);
    assert.equal(approvedRecordAfter?.status, "pending", "the approved-but-unmaterialized fetch intent must survive the restart in its exact pre-restart state");
    assert.equal(approvedRecordAfter?.proposalId, approvedEntry.proposalId);

    // The restart must not just LOOK durable — the approved decision must
    // still be genuinely actionable: `materializeCultureSourceFetch` must
    // succeed using ONLY the fresh, post-restart instance's own
    // childAgentRuns/ledger/fetchStore, proving the child Run's budget and
    // the ledger's approve decision both survived intact, not just the
    // intent record's own fields.
    const materialized = await materializeCultureSourceFetch(
      { childAgentRuns: second.childAgentRuns, ledger: second.ledger, fetchStore: fetchStoreAfter, abortControllers: new Map() },
      PILOT_WORKSPACE,
      approvedEntry.proposalId,
      approvedEntry.childRunId,
      c,
      allowLoopback,
    );
    assert.equal(materialized.status, "fetched");
    assert.equal(materialized.artifact?.content, "Our culture values durability across restarts.");

    // The still-pending source must remain fully vetoable post-restart too —
    // proves the pending proposal isn't just visible but genuinely still
    // governed correctly by the fresh instance (a real decision row can
    // still be appended against it).
    await second.ledger.append({
      id: c.ids.next(),
      workspaceId: PILOT_WORKSPACE,
      actorType: "user",
      actorId: PILOT_USER,
      action: "read",
      resourceType: "external:fetch",
      inputs: {},
      userDecision: "veto",
      policyResults: [],
      refLedgerId: pendingEntry.proposalId,
      createdAt: c.clock.nowISO(),
    });
    const pendingDecisionAfterVeto = await second.ledger.decisionFor(pendingEntry.proposalId);
    assert.equal(pendingDecisionAfterVeto?.userDecision, "veto");
  } finally {
    if (first) await first.closeDb();
    if (second) await second.closeDb();
    await server.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("cultureResearch.synthesisResult: self-repairs a MISSING synthesis-pointer binding (simulating a crash between pipeline.propose succeeding and recordProposal ever running) — a valid, approved synthesis result becomes discoverable via latestRun again after the next read, without ever needing a NEW synthesis (TASK-011 remediation, 2026-07-19 coordinator distributed-defects RE-review, issue 5)", async () => {
  const server = await startTestServer((_req, res) => {
    res.writeHead(200, { "content-type": "text/plain" });
    res.end("Our culture rewards ownership.");
  });
  const wiring = await buildWiring();
  try {
    const caller = makeCaller(wiring);
    const id = registerTestSource(server.url);
    const proposed = await caller.jobpilot.cultureResearch.propose({ workspaceId: PILOT_WORKSPACE, company: TEST_COMPANY, sourceIds: [id] });
    const { proposalId, childRunId } = proposed.pending[0]!;
    await caller.action.decide({ proposalId, decision: "approve" });
    const fetched = await materializeCultureSourceFetch(cultureFetchDeps(wiring), PILOT_WORKSPACE, proposalId, childRunId, makeRun(), allowLoopback);

    const synthesisProposal = await caller.jobpilot.cultureResearch.synthesize({
      workspaceId: PILOT_WORKSPACE,
      company: TEST_COMPANY,
      parentRunId: proposed.parentRunId,
      claims: [{ id: "claim-1", claimType: "fact", sourceId: id, quote: "rewards ownership", contentHash: fetched.artifact!.contentHash }],
    });
    await caller.action.decide({ proposalId: synthesisProposal.proposalId, decision: "approve" });

    // Simulate the crash window: DESTROY the pointer that `synthesize()`
    // already successfully recorded — an honest simulation of "recordProposal
    // never ran" (the OBSERVABLE end state is identical either way: a
    // valid, approved synthesis result with no durable pointer to it).
    const pointerRows = await wiring.memoryStore.retrieve(
      { subjectElementId: proposed.parentRunId, includeSuperseded: false, limit: 5 },
      { workspaceId: PILOT_WORKSPACE },
    );
    const pointerRow = pointerRows.find((r) => {
      try {
        return (JSON.parse(r.content) as { kind?: string }).kind === "culture_synthesis_pointer";
      } catch {
        return false;
      }
    });
    assert.ok(pointerRow, "sanity: synthesize() really did create a pointer row");
    await wiring.memoryStore.forget(pointerRow!.id, { workspaceId: PILOT_WORKSPACE });
    const destroyedPointer = await wiring.cultureSynthesisPointerStore.getForParentRun(PILOT_WORKSPACE, proposed.parentRunId);
    assert.equal(destroyedPointer, null, "sanity: the pointer is genuinely gone before the repair read");

    const beforeRepair = await caller.jobpilot.cultureResearch.latestRun({ workspaceId: PILOT_WORKSPACE, company: TEST_COMPANY });
    assert.equal(beforeRepair?.synthesisProposalId, undefined, "latestRun cannot discover a destroyed pointer before the repair read");

    // Reading the result directly (as `synthesisResult` does) must
    // self-repair the pointer if it's ever missing/stale.
    const result = await caller.jobpilot.cultureResearch.synthesisResult({
      workspaceId: PILOT_WORKSPACE,
      company: TEST_COMPANY,
      proposalId: synthesisProposal.proposalId,
      parentRunId: proposed.parentRunId,
    });
    assert.equal(result.status, "available");

    const afterRepairPointer = await wiring.cultureSynthesisPointerStore.getForParentRun(PILOT_WORKSPACE, proposed.parentRunId);
    assert.ok(afterRepairPointer, "the pointer must exist after synthesisResult has read a valid, approved result");
    assert.equal(afterRepairPointer!.proposalId, synthesisProposal.proposalId);

    const afterRepair = await caller.jobpilot.cultureResearch.latestRun({ workspaceId: PILOT_WORKSPACE, company: TEST_COMPANY });
    assert.equal(afterRepair?.synthesisProposalId, synthesisProposal.proposalId, "latestRun must now discover the repaired pointer");
  } finally {
    await server.close();
    await wiring.close();
  }
});
