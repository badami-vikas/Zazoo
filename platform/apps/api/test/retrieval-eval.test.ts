/**
 * Retrieval eval over real usage (LA5 "eval automation" deliverable) —
 * contract: cases are MINED from the organization's own prose Memories
 * (machinery rows never become cases); the runner scores the LIVE fused
 * pipeline and persists an EvalRun keyed by the active embedding space;
 * too few real rows skips honestly and persists nothing.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { SeededRng, SystemClock, UuidGen, type MemoryWrite } from "@bridge/core";
import { appRouter } from "../src/router.js";
import { indexMemoryEmbeddings } from "../src/retrieval-fusion.js";
import {
  RETRIEVAL_EVAL_CAPABILITY_ID,
  buildUsageEvalCases,
  runUsageRetrievalEval,
  usageQueryFor,
} from "../src/retrieval-eval.js";
import { buildWiring, PILOT_ORGANIZATION, PILOT_USER, type Wiring } from "../src/wiring.js";

const ORG = PILOT_ORGANIZATION;

function proseRow(id: string, content: string, createdAt: string): MemoryWrite {
  return {
    id,
    organizationId: ORG,
    type: "semantic",
    scope: "private",
    content,
    confidence: 0.8,
    trustOrigin: "user_content",
    plane: "local",
    createdBy: PILOT_USER,
    ownerUserId: PILOT_USER,
    createdAt,
  };
}

const CORPUS = [
  "The buyer strongly prefers hvac service businesses located in the texas hill country",
  "Quarterly seller discretionary earnings adjustments must appear on every deal memo before review",
  "Restaurant groups with catering revenue in dallas were consistently marked for review",
  "Subscription software companies with low churn deserve a faster diligence track",
  "Management team depth staying on after close matters more than headline multiples",
];

async function seedCorpus(wiring: Wiring) {
  for (let i = 0; i < CORPUS.length; i += 1) {
    await wiring.memoryStore.write(
      proseRow(`eeeeeeee-0000-4000-8000-00000000000${i}`, CORPUS[i]!, `2026-03-0${i + 1}T00:00:00.000Z`),
    );
  }
}

function evalDeps(wiring: Wiring) {
  return {
    memoryStore: wiring.memoryStore,
    vectorIndex: wiring.vectorIndex,
    graphStore: wiring.graphStore,
    evalStore: wiring.evalStore,
    organizationId: ORG,
    ownerUserId: PILOT_USER,
    nowISO: () => new SystemClock().nowISO(),
  };
}

test("usage queries are deterministic distinctive tokens", () => {
  const query = usageQueryFor("The buyer strongly prefers hvac hvac businesses in texas");
  assert.equal(query, "buyer strongly prefers hvac businesses texas");
  assert.equal(usageQueryFor(""), "");
});

test("an empty Organization skips honestly and persists nothing", async () => {
  const wiring = await buildWiring({ retrievalFusionEnabled: true });
  try {
    const result = await runUsageRetrievalEval(evalDeps(wiring));
    assert.equal(result.skipped, true);
    const runs = await wiring.evalStore.listRuns(RETRIEVAL_EVAL_CAPABILITY_ID, { limit: 10, offset: 0 });
    assert.equal(runs.total, 0);
  } finally {
    await wiring.close();
  }
});

test("mined cases come from prose rows only, the live pipeline scores them, and the run persists", async () => {
  const wiring = await buildWiring({ retrievalFusionEnabled: true, learningObservationEnabled: true });
  try {
    await seedCorpus(wiring);
    // Learning-machinery rows must never become eval cases.
    const clock = new SystemClock();
    const rng = new SeededRng(53);
    const caller = appRouter.createCaller({
      wiring,
      run: { clock, rng, ids: new UuidGen(clock, rng) },
      identity: { type: "user" as const, id: PILOT_USER },
      authenticated: true,
      verifying: false,
    });
    await caller.learning.recordDealDecision({
      organizationId: ORG,
      dealRecordId: "deal-eval-noise",
      action: "dismiss",
      profile: { industry: "restaurants" },
    });

    const cases = await buildUsageEvalCases(evalDeps(wiring));
    assert.equal(cases.length, CORPUS.length);

    await indexMemoryEmbeddings({
      memoryStore: wiring.memoryStore,
      vectorIndex: wiring.vectorIndex,
      organizationId: ORG,
      ownerUserId: PILOT_USER,
    });
    const result = await runUsageRetrievalEval(evalDeps(wiring));
    assert.equal(result.skipped, false);
    assert.ok(result.recallAtK >= 0.8, `self-retrieval recall regressed: ${result.recallAtK}`);
    assert.ok(result.mrr >= 0.6, `self-retrieval MRR regressed: ${result.mrr}`);

    const runs = await wiring.evalStore.listRuns(RETRIEVAL_EVAL_CAPABILITY_ID, { limit: 10, offset: 0 });
    assert.equal(runs.total, 1);
    assert.equal(runs.items[0]!.capability_version, "bridge-hashing-lexical-v1");
    assert.equal(runs.items[0]!.perCase.length, CORPUS.length);
    assert.equal(result.datasetRefreshed, true);
    assert.equal(result.datasetId, `retrieval-usage:${ORG}:v1`);
    const dataset = await wiring.evalStore.getDataset(`retrieval-usage:${ORG}:v1`);
    assert.ok(dataset);
    assert.ok(dataset.cases.every((evalCase) => evalCase.origin === "mined"));

    // REFRESH POLICY: a stable workspace REUSES the stored dataset version
    // (run-over-run comparability), no new dataset minted.
    const again = await runUsageRetrievalEval(evalDeps(wiring));
    assert.equal(again.skipped, false);
    assert.equal(again.datasetRefreshed, false);
    assert.equal(again.datasetId, `retrieval-usage:${ORG}:v1`);
    assert.equal(
      (await wiring.evalStore.listRuns(RETRIEVAL_EVAL_CAPABILITY_ID, { limit: 10, offset: 0 })).total,
      2,
    );
  } finally {
    await wiring.close();
  }
});

test("REFRESH POLICY: corpus drift mints the next dataset version; dead cases are pruned first", async () => {
  const wiring = await buildWiring({ retrievalFusionEnabled: true });
  try {
    await seedCorpus(wiring);
    const scope = { organizationId: ORG, userId: PILOT_USER };
    const first = await runUsageRetrievalEval(evalDeps(wiring));
    assert.equal(first.skipped, false);
    assert.equal(first.datasetId, `retrieval-usage:${ORG}:v1`);

    // Prune-only drift: forget ONE source row. Four of five stored cases
    // stay live and still overlap the mined set — no refresh, and the run
    // scores only the live cases (the deleted row is corpus drift, not a
    // pipeline regression).
    assert.equal(await wiring.memoryStore.forget("eeeeeeee-0000-4000-8000-000000000000", scope), true);
    const pruned = await runUsageRetrievalEval(evalDeps(wiring));
    assert.equal(pruned.skipped, false);
    assert.equal(pruned.datasetRefreshed, false);
    assert.equal(pruned.datasetId, `retrieval-usage:${ORG}:v1`);
    assert.equal(pruned.cases, CORPUS.length - 1);

    // Real drift: the workspace moves on — most old rows gone, new topics
    // written. Jaccard falls below the threshold and v2 is minted from the
    // freshly mined cases; v1 stays in the store for historical runs.
    for (let i = 1; i <= 3; i += 1) {
      assert.equal(await wiring.memoryStore.forget(`eeeeeeee-0000-4000-8000-00000000000${i}`, scope), true);
    }
    const NEW_TOPICS = [
      "Commercial landscaping contracts renew every spring across the metro region",
      "Fleet maintenance schedules should batch by vehicle class and mileage",
      "Vendor payment terms longer than sixty days require finance approval",
      "Warehouse safety walkthroughs happen on the first monday of the month",
    ];
    for (let i = 0; i < NEW_TOPICS.length; i += 1) {
      await wiring.memoryStore.write(
        proseRow(`ffffffff-0000-4000-8000-00000000000${i}`, NEW_TOPICS[i]!, `2026-04-0${i + 1}T00:00:00.000Z`),
      );
    }
    const drifted = await runUsageRetrievalEval(evalDeps(wiring));
    assert.equal(drifted.skipped, false);
    assert.equal(drifted.datasetRefreshed, true);
    assert.equal(drifted.datasetId, `retrieval-usage:${ORG}:v2`);
    assert.ok(await wiring.evalStore.getDataset(`retrieval-usage:${ORG}:v1`), "old version stays for history");
    assert.ok(await wiring.evalStore.getDataset(`retrieval-usage:${ORG}:v2`));
  } finally {
    await wiring.close();
  }
});

test("learning.retrieval surface: status always answers; evals are flight-gated and honestly labeled", async () => {
  const { TRPCError } = await import("@trpc/server");
  // Flight OFF: status reports disabled, evals fail closed.
  const offWiring = await buildWiring();
  try {
    const clock = new SystemClock();
    const rng = new SeededRng(59);
    const caller = appRouter.createCaller({
      wiring: offWiring,
      run: { clock, rng, ids: new UuidGen(clock, rng) },
      identity: { type: "user" as const, id: PILOT_USER },
      authenticated: true,
      verifying: false,
    });
    assert.deepEqual(await caller.learning.retrieval.status({ organizationId: ORG }), { enabled: false });
    await assert.rejects(
      () => caller.learning.retrieval.evals({ organizationId: ORG }),
      (error: unknown) => error instanceof TRPCError && error.code === "PRECONDITION_FAILED",
    );
  } finally {
    await offWiring.close();
  }

  // Flight ON: runs come back newest-first, each response carrying the
  // honest metric label — self-retrieval, never presented as relevance.
  const wiring = await buildWiring({ retrievalFusionEnabled: true });
  try {
    await seedCorpus(wiring);
    await runUsageRetrievalEval(evalDeps(wiring));
    await runUsageRetrievalEval(evalDeps(wiring));
    const clock = new SystemClock();
    const rng = new SeededRng(61);
    const caller = appRouter.createCaller({
      wiring,
      run: { clock, rng, ids: new UuidGen(clock, rng) },
      identity: { type: "user" as const, id: PILOT_USER },
      authenticated: true,
      verifying: false,
    });
    assert.deepEqual(await caller.learning.retrieval.status({ organizationId: ORG }), { enabled: true });
    const evals = await caller.learning.retrieval.evals({ organizationId: ORG });
    assert.equal(evals.metric, "self_retrieval");
    assert.match(evals.metricNote, /Not human-judged relevance/);
    assert.equal(evals.total, 2);
    assert.equal(evals.runs.length, 2);
    assert.equal(evals.runs[0]!.embeddingModel, "bridge-hashing-lexical-v1");
    assert.ok(evals.runs[0]!.recallAtK >= 0.8);
    assert.equal(evals.runs[0]!.cases, CORPUS.length);
  } finally {
    await wiring.close();
  }
});
