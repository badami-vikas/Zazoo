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

test("an empty workspace skips honestly and persists nothing", async () => {
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
    const dataset = await wiring.evalStore.getDataset(`retrieval-usage:${ORG}`);
    assert.ok(dataset);
    assert.ok(dataset.cases.every((evalCase) => evalCase.origin === "mined"));

    // A second pass appends another comparable run (same capability id).
    const again = await runUsageRetrievalEval(evalDeps(wiring));
    assert.equal(again.skipped, false);
    assert.equal(
      (await wiring.evalStore.listRuns(RETRIEVAL_EVAL_CAPABILITY_ID, { limit: 10, offset: 0 })).total,
      2,
    );
  } finally {
    await wiring.close();
  }
});
