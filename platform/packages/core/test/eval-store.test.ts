import { test } from "node:test";
import assert from "node:assert/strict";

import {
  contractMatchScorer,
  InMemoryCapabilityStore,
  InMemoryEvalStore,
  replayDeterminismScorer,
  routeMatchScorer,
  runEvalDataset,
  writeEvalRunEvidence,
  type EvalDataset,
} from "../src/index.js";

test("routeMatchScorer: scores expected and unexpected routes", async () => {
  const evalCase = { id: "route_case", input: "sort this request", labels: { correct_route: "learning-agent" }, origin: "seed" as const };
  assert.deepEqual(await routeMatchScorer.score(evalCase, { route: "learning-agent" }, {}), { route_p: 1, route_r: 1 });
  assert.deepEqual(await routeMatchScorer.score(evalCase, { route: "organization-agent" }, {}), { route_p: 0, route_r: 0 });
});

test("contractMatchScorer: validates output shape against the reference contract", async () => {
  const evalCase = {
    id: "contract_case",
    input: "summarize memory",
    reference: { summary: "string", metadata: { confidence: "number" } },
    origin: "seed" as const,
  };

  assert.deepEqual(
    await contractMatchScorer.score(evalCase, { summary: "done", metadata: { confidence: 0.9 } }, {}),
    { quality: 1 },
  );
  assert.deepEqual(await contractMatchScorer.score(evalCase, { summary: "done", metadata: { confidence: "high" } }, {}), {
    quality: 0,
  });
});

test("replayDeterminismScorer: compares stable outputs across runs", async () => {
  const evalCase = { id: "replay_case", input: { prompt: "repeat" }, origin: "seed" as const };
  assert.deepEqual(await replayDeterminismScorer.score(evalCase, [{ a: 1, b: 2 }, { b: 2, a: 1 }], {}), { reliability: 1 });
  assert.deepEqual(await replayDeterminismScorer.score(evalCase, [{ a: 1 }, { a: 2 }], {}), { reliability: 0 });
});

test("runEvalDataset: deterministic scorers write an aggregate EvalRun to capability evidence", async () => {
  const evalStore = new InMemoryEvalStore();
  const capabilityStore = new InMemoryCapabilityStore();
  const dataset: EvalDataset = {
    id: "commons://routing/learning@1",
    capability_type: "agent",
    version: "1",
    cases: [
      {
        id: "case_success",
        input: { text: "organize the next Automation" },
        reference: { route: "string", answer: "string" },
        labels: { correct_route: "learning-agent" },
        origin: "seed",
      },
      {
        id: "case_miss",
        input: { text: "capture a signal" },
        reference: { route: "string", answer: "string" },
        labels: { correct_route: "learning-agent" },
        origin: "seed",
      },
    ],
  };
  await evalStore.createDataset(dataset);
  await capabilityStore.upsertState({
    manifestId: "capability_learning_agent",
    organizationId: "organization_quality",
    state: "active",
    suspended: false,
    evidence: { activeRunCount: 12, successRate: 0.7, violationCount: 0, ageDays: 20 },
  });

  const run = await runEvalDataset({
    store: evalStore,
    datasetId: dataset.id,
    capabilityId: "capability_learning_agent",
    capabilityVersion: "1.0.0",
    scorers: [routeMatchScorer, contractMatchScorer, replayDeterminismScorer],
    produced: [
      {
        caseId: "case_success",
        produced: [{ route: "learning-agent", answer: "ready" }, { answer: "ready", route: "learning-agent" }],
        snapshot: { terminalState: "completed" },
      },
      {
        caseId: "case_miss",
        produced: [{ route: "organization-agent" }, { route: "organization-agent" }],
        snapshot: { terminalState: "completed" },
      },
    ],
    modelVersion: "deterministic-only",
    startedAt: "2026-07-14T09:00:00.000Z",
    finishedAt: "2026-07-14T09:01:00.000Z",
  });

  assert.equal(run.aggregate.route_p, 0.5);
  assert.equal(run.aggregate.route_r, 0.5);
  assert.equal(run.aggregate.quality, 0.5);
  assert.equal(run.aggregate.reliability, 1);

  const state = await writeEvalRunEvidence(capabilityStore, "capability_learning_agent", run);
  assert.equal(state.evidence.successRate, 0.7);
  assert.equal(state.evidence.evalRuns?.length, 1);
  assert.deepEqual(state.evidence.evalRuns?.[0]?.aggregate, run.aggregate);
  assert.equal(state.evidence.evalRuns?.[0]?.runId, run.id);
});
