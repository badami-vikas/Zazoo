import assert from "node:assert/strict";
import test from "node:test";
import {
  JudgeScorer,
  calibrateJudge,
  evaluateRedTeamPack,
  requireRedTeamForExternal,
  selectHeldOut,
} from "../src/eval/judge.js";
import type { ModelProvider } from "../src/ports.js";
import type { ExecutionSnapshot } from "../src/types.js";
import type { EvalCase } from "../src/eval/types.js";

function modelReturning(text: string): ModelProvider {
  return {
    id: "judge-local",
    plane: "local",
    tiers: ["reasoning"],
    complete: async (req) => ({
      text,
      model: "judge-local-v1",
      tier: req.tier,
      usage: { inputTokens: 8, outputTokens: 1, cacheCreationInputTokens: 0, cacheReadInputTokens: 0, source: "provider" },
    }),
  };
}

function caseInput(overrides: Partial<EvalCase> = {}): EvalCase {
  return {
    id: "case-1",
    input: { request: "draft a ritual summary" },
    origin: "seed",
    ...overrides,
  };
}

const snapshot: ExecutionSnapshot = {
  terminalState: "completed",
  modelVersion: "candidate-1",
  tokenCount: 42,
  startedAt: "2026-10-01T00:00:00.000Z",
  finishedAt: "2026-10-01T00:01:00.000Z",
};

test("JudgeScorer returns parsed quality and exposes identity", async () => {
  const scorer = new JudgeScorer({ model: modelReturning("0.82"), modelVersion: "judge-v1", id: "quality-judge" });

  assert.equal(scorer.id, "quality-judge");
  assert.equal(scorer.modelVersion, "judge-v1");
  assert.equal(scorer.kind, "judge");
  assert.deepEqual(await scorer.score(caseInput(), { answer: "ok" }, snapshot), { quality: 0.82 });
});

test("JudgeScorer default id includes model id and version", () => {
  const scorer = new JudgeScorer({ model: modelReturning("0.7"), modelVersion: "judge-v2" });
  assert.equal(scorer.id, "judge:judge-local:judge-v2");
});

test("JudgeScorer clamps scores above and below the quality range", async () => {
  const high = new JudgeScorer({ model: modelReturning("quality: 1.4"), modelVersion: "judge-v1" });
  const low = new JudgeScorer({ model: modelReturning("-0.3"), modelVersion: "judge-v1" });

  assert.deepEqual(await high.score(caseInput(), "artifact", snapshot), { quality: 1 });
  assert.deepEqual(await low.score(caseInput(), "artifact", snapshot), { quality: 0 });
});

test("JudgeScorer rejects model responses without a number", async () => {
  const scorer = new JudgeScorer({ model: modelReturning("no number here"), modelVersion: "judge-v1" });
  await assert.rejects(() => scorer.score(caseInput(), "artifact", snapshot), /numeric quality score/);
});

test("JudgeScorer propagates model failures", async () => {
  const failure = new Error("model unavailable");
  const model: ModelProvider = {
    id: "judge-local",
    plane: "local",
    tiers: ["reasoning"],
    complete: async () => {
      throw failure;
    },
  };
  const scorer = new JudgeScorer({ model, modelVersion: "judge-v1" });
  await assert.rejects(() => scorer.score(caseInput(), "artifact", snapshot), failure);
});

test("JudgeScorer prompt uses case rubric before constructor rubric", async () => {
  let seenPrompt = "";
  const model: ModelProvider = {
    id: "judge-local",
    plane: "local",
    tiers: ["reasoning"],
    complete: async (req) => {
      seenPrompt = req.prompt;
      assert.match(req.system ?? "", /0 to 1/);
      assert.equal(req.maxTokens, 64);
      assert.equal(req.tier, "reasoning");
      return {
        text: "0.5",
        model: "judge-local-v1",
        tier: req.tier,
        usage: { inputTokens: 8, outputTokens: 1, cacheCreationInputTokens: 0, cacheReadInputTokens: 0, source: "provider" },
      };
    },
  };
  const scorer = new JudgeScorer({ model, modelVersion: "judge-v1", rubric: "constructor rubric" });

  await scorer.score(caseInput({ rubric: "case rubric", reference: { expected: true } }), { answer: "ok" }, snapshot);

  assert.match(seenPrompt, /case rubric/);
  assert.doesNotMatch(seenPrompt, /constructor rubric/);
  assert.match(seenPrompt, /Pinned judge model version: judge-v1/);
});

test("JudgeScorer uses the constructor rubric and stringifies circular artifacts", async () => {
  let seenPrompt = "";
  const model: ModelProvider = {
    id: "judge-local",
    plane: "local",
    tiers: ["reasoning"],
    complete: async (req) => {
      seenPrompt = req.prompt;
      return {
        text: "0.6",
        model: "judge-local-v1",
        tier: req.tier,
        usage: { inputTokens: 8, outputTokens: 1, cacheCreationInputTokens: 0, cacheReadInputTokens: 0, source: "provider" },
      };
    },
  };
  const circular: Record<string, unknown> = { kind: "artifact" };
  circular.self = circular;
  const scorer = new JudgeScorer({ model, modelVersion: "judge-v1", rubric: "constructor rubric" });

  assert.deepEqual(await scorer.score(caseInput(), circular, {}), { quality: 0.6 });
  assert.match(seenPrompt, /constructor rubric/);
  assert.match(seenPrompt, /\[object Object\]/);
});

test("selectHeldOut filters candidate-authored cases and keeps others", () => {
  const cases: EvalCase[] = [
    caseInput({ id: "candidate", authored_by_capability: "cap-a" }),
    caseInput({ id: "other", authored_by_capability: "cap-b" }),
    caseInput({ id: "undefined-author" }),
  ];

  assert.deepEqual(selectHeldOut(cases, "cap-a").map((entry) => entry.id), ["other", "undefined-author"]);
});

test("calibrateJudge reports strong point-biserial correlation on separated labels", () => {
  const calibration = calibrateJudge([
    { score: 0.9, label: "approve" },
    { score: 0.85, label: "approve" },
    { score: 0.95, label: "approve" },
    { score: 0.2, label: "veto" },
    { score: 0.3, label: "veto" },
    { score: 0.1, label: "veto" },
  ]);

  assert.equal(calibration.n, 6);
  assert.ok(calibration.correlation > 0.8, `correlation was ${calibration.correlation}`);
  assert.ok(calibration.separation > 0);
  assert.ok(Math.abs(calibration.meanApprove - 0.9) < Number.EPSILON);
  assert.ok(Math.abs(calibration.meanVeto - 0.2) < Number.EPSILON);
});

test("calibrateJudge returns finite zero correlation for degenerate and empty sets", () => {
  const degenerate = calibrateJudge([
    { score: 0.5, label: "approve" },
    { score: 0.5, label: "veto" },
  ]);
  const empty = calibrateJudge([]);
  const one = calibrateJudge([{ score: 0.8, label: "approve" }]);

  assert.equal(degenerate.correlation, 0);
  assert.ok(Number.isFinite(degenerate.correlation));
  assert.equal(empty.n, 0);
  assert.equal(empty.correlation, 0);
  assert.equal(one.n, 1);
  assert.equal(one.correlation, 0);
  const onlyVeto = calibrateJudge([{ score: 0.2, label: "veto" }]);

  assert.equal(one.meanApprove, 0.8);
  assert.equal(one.meanVeto, 0);
  assert.equal(onlyVeto.meanApprove, 0);
  assert.equal(onlyVeto.meanVeto, 0.2);
});

test("red-team empty pack fails and blocks External band", () => {
  const result = evaluateRedTeamPack([]);

  assert.equal(result.passed, false);
  assert.deepEqual(result.failures, ["empty-pack"]);
  assert.deepEqual(requireRedTeamForExternal("external", result), { allowed: false, reason: "red-team pack failed" });
});

test("red-team all-pass pack allows External band", () => {
  const result = evaluateRedTeamPack([
    { id: "rt-1", passed: true },
    { id: "rt-2", passed: true },
  ]);

  assert.equal(result.passed, true);
  assert.deepEqual(result.failures, []);
  assert.deepEqual(requireRedTeamForExternal("external", result), { allowed: true });
});

test("red-team failing assertions are listed and non-external bands are always allowed", () => {
  const result = evaluateRedTeamPack([
    { id: "rt-pass", passed: true },
    { id: "rt-fail", passed: false },
  ]);

  assert.equal(result.passed, false);
  assert.deepEqual(result.failures, ["rt-fail"]);
  assert.deepEqual(requireRedTeamForExternal("external", result), { allowed: false, reason: "red-team pack failed" });
  assert.deepEqual(requireRedTeamForExternal("internal", result), { allowed: true });
});
