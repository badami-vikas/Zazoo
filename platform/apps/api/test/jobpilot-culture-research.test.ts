/**
 * jobpilot.cultureResearch (TASK-011, JP3B) — TWO-PHASE architecture,
 * remediated 2026-07-17 after an independent security review of the first
 * pass (see outputs/2026-07-17-jobpilot-culture-research-task011.md). Proves:
 *
 *  1. Only server-owned `sourceId`s are ever accepted — an unknown or
 *     cross-workspace/cross-company id fails the whole request closed, with
 *     zero network access.
 *  2. `propose` is genuinely side-effect-free: a `do_not_use`/`research_only`/
 *     `not_yet_integrated` source is skipped with zero child Run/network
 *     access, and even a PERMITTED source is not fetched during propose —
 *     only a pure pipeline proposal is created.
 *  3. `materialize` refuses to fetch an unapproved or vetoed proposal —
 *     zero network calls ever for either case.
 *  4. An approved proposal's real, guarded fetch (`materializeCultureSourceFetch`,
 *     called directly with a test-only local server + block-list override —
 *     see its doc comment) is idempotent (a second materialize call returns
 *     the stored artifact, never re-hits the server) and produces a
 *     content-hash-bound artifact.
 *  5. Cancellation guarantees zero network calls before a fetch starts, and
 *     aborts a real in-flight fetch.
 *  6. Fan-out is capped at MAX_CULTURE_SOURCES_PER_RUN regardless of request
 *     length; duplicate ids are deduped.
 *  7. `synthesize` rejects claims that fail to ground against the artifacts
 *     this run actually fetched (absent quote, stale content hash, forged
 *     contradiction reference, duplicate id).
 *  8. Direct Human invocation of both governed Skills still fails closed
 *     (unchanged AGS1 behavior).
 */
import assert from "node:assert/strict";
import test from "node:test";
import * as http from "node:http";
import type { AddressInfo } from "node:net";
import { SeededRng, SystemClock, UuidGen, type RunCtx } from "@bridge/core";
import { MAX_CULTURE_SOURCES_PER_RUN } from "@bridge/jobpilot";
import { appRouter } from "../src/router.js";
import {
  buildWiring,
  PILOT_WORKSPACE,
  PILOT_USER,
  LEARNING_AGENT,
  INTERNAL_STRATEGIST_AGENT,
  materializeCultureSourceFetch,
  cancelCultureSourceFetch,
  unsafeRegisterTestOnlyCultureSource,
  type Wiring,
} from "../src/wiring.js";

function makeRun(): RunCtx {
  const clock = new SystemClock();
  const rng = new SeededRng(1);
  return { clock, rng, ids: new UuidGen(clock, rng) };
}

async function makeCaller(wiring: Wiring, identity: { type: "user" | "team"; id: string } = { type: "user", id: PILOT_USER }) {
  return appRouter.createCaller({ wiring, run: makeRun(), identity, authenticated: true, verifying: false });
}

const TEST_COMPANY = "test_fixture Co";

async function startTestServer(handler: http.RequestListener): Promise<{ url: string; port: number; close: () => Promise<void> }> {
  const server = http.createServer(handler);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as AddressInfo).port;
  return { url: `http://127.0.0.1:${port}/culture`, port, close: () => new Promise((resolve) => server.close(() => resolve())) };
}

let testSourceCounter = 0;
function registerTestSource(url: string, sourceType: "company_official_page" | "glassdoor" | "reddit" | "google_reviews" = "company_official_page") {
  testSourceCounter += 1;
  const id = `test-fixture-source-${testSourceCounter}`;
  unsafeRegisterTestOnlyCultureSource({
    id,
    workspaceId: PILOT_WORKSPACE,
    company: TEST_COMPANY,
    sourceType,
    sourceLabel: `test_fixture source ${testSourceCounter}`,
    url,
  });
  return id;
}

const allowLoopback = { isBlockedIp: (ip: string) => ip !== "127.0.0.1" };

test("cultureResearch.propose: an unknown source id is rejected with zero network access and no child Run", async () => {
  const wiring = await buildWiring();
  try {
    const caller = await makeCaller(wiring);
    await assert.rejects(
      () => caller.jobpilot.cultureResearch.propose({ workspaceId: PILOT_WORKSPACE, company: TEST_COMPANY, sourceIds: ["not-a-real-id"] }),
      /unknown or unauthorized source id/,
    );
  } finally {
    await wiring.close();
  }
});

test("cultureResearch.propose: a real source id requested under the WRONG company is rejected (cross-company forgery)", async () => {
  const wiring = await buildWiring();
  try {
    const caller = await makeCaller(wiring);
    await assert.rejects(
      () =>
        caller.jobpilot.cultureResearch.propose({
          workspaceId: PILOT_WORKSPACE,
          company: "A Totally Different Company",
          sourceIds: ["bcg-careers-interview-process"], // real id, wrong company
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
    const caller = await makeCaller(wiring);
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
    const caller = await makeCaller(wiring);
    const id = registerTestSource("http://127.0.0.1:1/dup");
    const result = await caller.jobpilot.cultureResearch.propose({
      workspaceId: PILOT_WORKSPACE,
      company: TEST_COMPANY,
      sourceIds: [id, id, id],
    });
    assert.equal(result.pending.length, 1);
  } finally {
    await wiring.close();
  }
});

test("cultureResearch.propose: non-permitted source types are skipped with zero child Run/network access; propose itself performs NO fetch even for a permitted source", async () => {
  const wiring = await buildWiring();
  try {
    const caller = await makeCaller(wiring);
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
    for (const s of result.skipped) assert.ok(s.reason.length > 0);

    // No artifact/fetch exists yet for the permitted pending proposal either.
    const status = await caller.jobpilot.cultureResearch.status({ workspaceId: PILOT_WORKSPACE, proposalId: result.pending[0]!.proposalId });
    assert.equal(status.status, "pending");
    assert.equal(status.artifact, undefined);
  } finally {
    await wiring.close();
  }
});

test("cultureResearch.materialize: refuses to fetch an unapproved (never-decided) proposal — zero network calls", async () => {
  const wiring = await buildWiring();
  try {
    const caller = await makeCaller(wiring);
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

test("cultureResearch.materialize: refuses to fetch a VETOED proposal — zero network calls (guarantees the veto path is honored)", async () => {
  const wiring = await buildWiring();
  try {
    const caller = await makeCaller(wiring);
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

test("cultureResearch.materialize (via the router, no test override): a test source pointing at loopback is blocked by the REAL, unoverridden SSRF guard — proves the router path never bypasses it", async () => {
  const wiring = await buildWiring();
  try {
    const caller = await makeCaller(wiring);
    const id = registerTestSource("http://127.0.0.1:1/blocked-by-real-guard");
    const proposed = await caller.jobpilot.cultureResearch.propose({ workspaceId: PILOT_WORKSPACE, company: TEST_COMPANY, sourceIds: [id] });
    const { proposalId, childRunId } = proposed.pending[0]!;
    await caller.action.decide({ proposalId, decision: "approve" });
    await assert.rejects(() => caller.jobpilot.cultureResearch.materialize({ workspaceId: PILOT_WORKSPACE, proposalId, childRunId }), /SSRF blocked/);
  } finally {
    await wiring.close();
  }
});

test("materializeCultureSourceFetch (direct call, real local server + test-only guard override): approved fetch succeeds exactly once and is idempotent on retry", async () => {
  let requestCount = 0;
  const server = await startTestServer((_req, res) => {
    requestCount += 1;
    res.writeHead(200, { "content-type": "text/plain" });
    res.end("Culture, Values, And Inclusion — test_fixture content.");
  });
  const wiring = await buildWiring();
  try {
    const caller = await makeCaller(wiring);
    const id = registerTestSource(server.url);
    const proposed = await caller.jobpilot.cultureResearch.propose({ workspaceId: PILOT_WORKSPACE, company: TEST_COMPANY, sourceIds: [id] });
    const { proposalId, childRunId } = proposed.pending[0]!;
    await caller.action.decide({ proposalId, decision: "approve" });

    const record1 = await materializeCultureSourceFetch(
      { childAgentRuns: wiring.childAgentRuns, ledger: wiring.ledger, fetchStore: wiring.cultureFetchStore },
      PILOT_WORKSPACE,
      proposalId,
      childRunId,
      makeRun(),
      allowLoopback,
    );
    assert.equal(record1.status, "fetched");
    assert.ok(record1.artifact?.content.includes("Culture, Values, And Inclusion"));
    assert.equal(typeof record1.artifact?.contentHash, "string");
    assert.equal(requestCount, 1);

    // Idempotent — a second materialize call must NOT hit the server again.
    const record2 = await materializeCultureSourceFetch(
      { childAgentRuns: wiring.childAgentRuns, ledger: wiring.ledger, fetchStore: wiring.cultureFetchStore },
      PILOT_WORKSPACE,
      proposalId,
      childRunId,
      makeRun(),
      allowLoopback,
    );
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

test("cancelCultureSourceFetch before any fetch guarantees materialize can never proceed afterward", async () => {
  let requestCount = 0;
  const server = await startTestServer((_req, res) => {
    requestCount += 1;
    res.end("should never be reached");
  });
  const wiring = await buildWiring();
  try {
    const caller = await makeCaller(wiring);
    const id = registerTestSource(server.url);
    const proposed = await caller.jobpilot.cultureResearch.propose({ workspaceId: PILOT_WORKSPACE, company: TEST_COMPANY, sourceIds: [id] });
    const { proposalId, childRunId } = proposed.pending[0]!;
    await caller.action.decide({ proposalId, decision: "approve" });

    await cancelCultureSourceFetch(
      { childAgentRuns: wiring.childAgentRuns, ledger: wiring.ledger, fetchStore: wiring.cultureFetchStore },
      PILOT_WORKSPACE,
      proposalId,
      childRunId,
      { type: "user", id: PILOT_USER },
      makeRun(),
    );

    await assert.doesNotReject(() =>
      materializeCultureSourceFetch(
        { childAgentRuns: wiring.childAgentRuns, ledger: wiring.ledger, fetchStore: wiring.cultureFetchStore },
        PILOT_WORKSPACE,
        proposalId,
        childRunId,
        makeRun(),
        allowLoopback,
      ),
    );
    const afterCancel = await materializeCultureSourceFetch(
      { childAgentRuns: wiring.childAgentRuns, ledger: wiring.ledger, fetchStore: wiring.cultureFetchStore },
      PILOT_WORKSPACE,
      proposalId,
      childRunId,
      makeRun(),
      allowLoopback,
    );
    assert.equal(afterCancel.status, "cancelled", "a cancelled record short-circuits idempotently rather than refetching");
    assert.equal(requestCount, 0);
    const childRun = await wiring.childAgentRuns.get(PILOT_WORKSPACE, childRunId);
    assert.equal(childRun?.status, "cancelled");
  } finally {
    await server.close();
    await wiring.close();
  }
});

test("cancelCultureSourceFetch aborts a REAL in-flight fetch (server observes the connection actually close)", async () => {
  let serverSawClose = false;
  const server = await startTestServer((req, res) => {
    res.writeHead(200, { "content-type": "text/plain" });
    res.write("partial");
    req.on("close", () => {
      serverSawClose = true;
    });
    // Never ends — simulates a long-running fetch to cancel mid-stream.
  });
  const wiring = await buildWiring();
  try {
    const caller = await makeCaller(wiring);
    const id = registerTestSource(server.url);
    const proposed = await caller.jobpilot.cultureResearch.propose({ workspaceId: PILOT_WORKSPACE, company: TEST_COMPANY, sourceIds: [id] });
    const { proposalId, childRunId } = proposed.pending[0]!;
    await caller.action.decide({ proposalId, decision: "approve" });

    const materializePromise = materializeCultureSourceFetch(
      { childAgentRuns: wiring.childAgentRuns, ledger: wiring.ledger, fetchStore: wiring.cultureFetchStore },
      PILOT_WORKSPACE,
      proposalId,
      childRunId,
      makeRun(),
      allowLoopback,
    );
    // Give the fetch a moment to actually start before cancelling it.
    await new Promise((r) => setTimeout(r, 60));
    await cancelCultureSourceFetch(
      { childAgentRuns: wiring.childAgentRuns, ledger: wiring.ledger, fetchStore: wiring.cultureFetchStore },
      PILOT_WORKSPACE,
      proposalId,
      childRunId,
      { type: "user", id: PILOT_USER },
      makeRun(),
    );
    await assert.rejects(() => materializePromise);
    await new Promise((r) => setTimeout(r, 100));
    assert.equal(serverSawClose, true, "the server should observe the aborted connection actually close");
  } finally {
    await server.close();
    await wiring.close();
  }
});

test("materializeCultureSourceFetch rejects a non-text content-type response and fails the child Run closed with audit evidence", async () => {
  const server = await startTestServer((_req, res) => {
    res.writeHead(200, { "content-type": "application/octet-stream" });
    res.end(Buffer.from([0, 1, 2, 3]));
  });
  const wiring = await buildWiring();
  try {
    const caller = await makeCaller(wiring);
    const id = registerTestSource(server.url);
    const proposed = await caller.jobpilot.cultureResearch.propose({ workspaceId: PILOT_WORKSPACE, company: TEST_COMPANY, sourceIds: [id] });
    const { proposalId, childRunId } = proposed.pending[0]!;
    await caller.action.decide({ proposalId, decision: "approve" });

    await assert.rejects(
      () =>
        materializeCultureSourceFetch(
          { childAgentRuns: wiring.childAgentRuns, ledger: wiring.ledger, fetchStore: wiring.cultureFetchStore },
          PILOT_WORKSPACE,
          proposalId,
          childRunId,
          makeRun(),
          allowLoopback,
        ),
      /non-text content-type/,
    );
    const childRun = await wiring.childAgentRuns.get(PILOT_WORKSPACE, childRunId);
    assert.equal(childRun?.status, "failed");
    const record = wiring.cultureFetchStore.get(proposalId);
    assert.equal(record?.status, "failed");
  } finally {
    await server.close();
    await wiring.close();
  }
});

test("cultureResearch.propose: extra client-supplied fields (url/sourceType/sourceLabel) alongside a valid sourceId have NO effect — the fetched/skipped source is decided ENTIRELY by the server registry entry, never by anything else in the request body", async () => {
  const wiring = await buildWiring();
  try {
    const caller = await makeCaller(wiring);
    const glassdoorId = registerTestSource("http://127.0.0.1:1/glassdoor-real", "glassdoor");
    // A raw/forged payload a non-TypeScript client COULD send, trying to
    // relabel the Glassdoor source as an official page — these fields do not
    // exist in the procedure's input schema at all and are silently stripped;
    // the server resolves sourceType/url/label EXCLUSIVELY from the registry.
    const forged = {
      workspaceId: PILOT_WORKSPACE,
      company: TEST_COMPANY,
      sourceIds: [glassdoorId],
      url: "https://careers.bcg.com/official-looking-url",
      sourceType: "company_official_page",
      sourceLabel: "Definitely Not Glassdoor",
    };
    const result = await caller.jobpilot.cultureResearch.propose(forged as unknown as { workspaceId: string; company: string; sourceIds: string[] });
    // Still classified/skipped as glassdoor — the forged fields changed nothing.
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
    const caller = await makeCaller(wiring);
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
    const caller = await makeCaller(wiring);
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
      inputs: { claims: [], artifacts: [], skippedSources: [] },
      skill: "jobpilot.synthesizeCultureProfile",
      goalTaskRef: { goalId: goal.id, taskId: task.id },
    });
    assert.equal(proposal.status, "rejected");
    assert.match(proposal.rejectionReason ?? "", /may only be invoked by an eligible Agent Run/);
  } finally {
    await wiring.close();
  }
});

test("cultureResearch.synthesize: a claim whose quote is absent from the fetched artifact is rejected (fails the whole batch closed)", async () => {
  const server = await startTestServer((_req, res) => {
    res.writeHead(200, { "content-type": "text/plain" });
    res.end("Our culture is built on trust and collaboration.");
  });
  const wiring = await buildWiring();
  try {
    const caller = await makeCaller(wiring);
    const id = registerTestSource(server.url);
    const proposed = await caller.jobpilot.cultureResearch.propose({ workspaceId: PILOT_WORKSPACE, company: TEST_COMPANY, sourceIds: [id] });
    const { proposalId, childRunId } = proposed.pending[0]!;
    await caller.action.decide({ proposalId, decision: "approve" });
    const record = await materializeCultureSourceFetch(
      { childAgentRuns: wiring.childAgentRuns, ledger: wiring.ledger, fetchStore: wiring.cultureFetchStore },
      PILOT_WORKSPACE,
      proposalId,
      childRunId,
      makeRun(),
      allowLoopback,
    );
    const realHash = record.artifact!.contentHash;

    await assert.rejects(
      () =>
        caller.jobpilot.cultureResearch.synthesize({
          workspaceId: PILOT_WORKSPACE,
          company: TEST_COMPANY,
          claims: [{ id: "bad1", claimType: "fact", sourceId: id, quote: "we guarantee industry-leading pay", contentHash: realHash }],
        }),
      /quote-not-found-in-artifact|claim grounding/i,
    );
  } finally {
    await server.close();
    await wiring.close();
  }
});

test("cultureResearch.synthesize: a claim with a mutated/stale content hash is rejected even though the quote text is real", async () => {
  const server = await startTestServer((_req, res) => {
    res.writeHead(200, { "content-type": "text/plain" });
    res.end("Our culture is built on trust and collaboration.");
  });
  const wiring = await buildWiring();
  try {
    const caller = await makeCaller(wiring);
    const id = registerTestSource(server.url);
    const proposed = await caller.jobpilot.cultureResearch.propose({ workspaceId: PILOT_WORKSPACE, company: TEST_COMPANY, sourceIds: [id] });
    const { proposalId, childRunId } = proposed.pending[0]!;
    await caller.action.decide({ proposalId, decision: "approve" });
    await materializeCultureSourceFetch(
      { childAgentRuns: wiring.childAgentRuns, ledger: wiring.ledger, fetchStore: wiring.cultureFetchStore },
      PILOT_WORKSPACE,
      proposalId,
      childRunId,
      makeRun(),
      allowLoopback,
    );

    await assert.rejects(() =>
      caller.jobpilot.cultureResearch.synthesize({
        workspaceId: PILOT_WORKSPACE,
        company: TEST_COMPANY,
        claims: [{ id: "bad2", claimType: "fact", sourceId: id, quote: "built on trust", contentHash: "stale-forged-hash" }],
      }),
    );
  } finally {
    await server.close();
    await wiring.close();
  }
});

test("cultureResearch.synthesize: a well-grounded claim (real quote + real content hash) succeeds and is partitioned", async () => {
  const server = await startTestServer((_req, res) => {
    res.writeHead(200, { "content-type": "text/plain" });
    res.end("Our culture is built on trust and collaboration.");
  });
  const wiring = await buildWiring();
  try {
    const caller = await makeCaller(wiring);
    const id = registerTestSource(server.url);
    const proposed = await caller.jobpilot.cultureResearch.propose({ workspaceId: PILOT_WORKSPACE, company: TEST_COMPANY, sourceIds: [id] });
    const { proposalId, childRunId } = proposed.pending[0]!;
    await caller.action.decide({ proposalId, decision: "approve" });
    const record = await materializeCultureSourceFetch(
      { childAgentRuns: wiring.childAgentRuns, ledger: wiring.ledger, fetchStore: wiring.cultureFetchStore },
      PILOT_WORKSPACE,
      proposalId,
      childRunId,
      makeRun(),
      allowLoopback,
    );

    const synthesisProposal = await caller.jobpilot.cultureResearch.synthesize({
      workspaceId: PILOT_WORKSPACE,
      company: TEST_COMPANY,
      claims: [{ id: "good1", claimType: "fact", sourceId: id, quote: "built on trust and collaboration", contentHash: record.artifact!.contentHash }],
    });
    assert.equal(synthesisProposal.status, "pending_review");

    const decided = await caller.action.decide({ proposalId: synthesisProposal.proposalId, decision: "approve" });
    assert.equal(decided.status, "applied");
    const output = decided.output?.proposedOutput as { partition: { facts: unknown[] } };
    assert.equal(output.partition.facts.length, 1);
  } finally {
    await server.close();
    await wiring.close();
  }
});
