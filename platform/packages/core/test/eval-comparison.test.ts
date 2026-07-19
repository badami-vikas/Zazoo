import assert from "node:assert/strict";
import test from "node:test";
import { buildWhyBetterCard, compareRuns } from "../src/eval/comparison.js";
import { DEFAULT_POLICY_PARAMS, mergePolicyParams, resolveGates } from "../src/policy/params.js";
import type { AxisScores, EvalRun } from "../src/eval/types.js";

const GATES = resolveGates(DEFAULT_POLICY_PARAMS);

/** Build an EvalRun from per-case axis rows; aggregate = per-axis mean. */
function makeRun(id: string, cases: AxisScores[]): EvalRun {
  const axes: Array<keyof AxisScores> = [
    "success",
    "correction",
    "quality",
    "route_p",
    "route_r",
    "reliability",
    "safety",
    "efficiency",
  ];
  const aggregate: AxisScores = {};
  for (const axis of axes) {
    const vals = cases.map((c) => c[axis]).filter((v): v is number => typeof v === "number");
    if (vals.length > 0) aggregate[axis] = vals.reduce((a, b) => a + b, 0) / vals.length;
  }
  return {
    id,
    capability_id: `cap-${id}`,
    capability_version: "1.0.0",
    dataset_id: "ds-holdout-1",
    perCase: cases.map((axes, i) => ({ caseId: `${id}-case-${i}`, axes })),
    aggregate,
    started_at: "2026-10-01T00:00:00.000Z",
    finished_at: "2026-10-01T00:05:00.000Z",
  };
}

/** n identical rows (zero variance ⇒ tight CI ⇒ any real mean-gap is significant). */
function flat(n: number, row: AxisScores): AxisScores[] {
  return Array.from({ length: n }, () => ({ ...row }));
}

test("EVAL-3: candidate beating baseline on BOTH gates promotes, with a why-better card", () => {
  const baseline = makeRun("base", flat(20, { quality: 0.7, route_p: 0.8, route_r: 0.78, safety: 1, correction: 0.15 }));
  const candidate = makeRun("cand", flat(20, { quality: 0.9, route_p: 0.9, route_r: 0.85, safety: 1, correction: 0.1 }));

  const cmp = compareRuns(baseline, candidate, GATES);
  assert.equal(cmp.verdict, "promote");
  assert.equal(cmp.significance.n, 20);
  assert.ok(cmp.deltas.quality && cmp.deltas.quality > 0);

  const card = buildWhyBetterCard(cmp, GATES);
  assert.equal(card.verdict, "promote");
  assert.match(card.headline, /promoting/i);
  assert.equal(card.primaryAxis, "quality");
  assert.ok(card.significance.significant);
  // every gate line must be a pass for a promotion
  assert.ok(card.gates.length >= 1);
  assert.ok(card.gates.every((g) => g.passed));
  assert.ok(card.reasons.some((r) => /significant/i.test(r)));
});

test("EVAL-3: a candidate that regresses on quality is rejected", () => {
  const baseline = makeRun("base", flat(20, { quality: 0.85, route_p: 0.85, route_r: 0.82, safety: 1, correction: 0.1 }));
  // quality drops below baseline AND below the floor; routing unchanged.
  const candidate = makeRun("cand", flat(20, { quality: 0.6, route_p: 0.85, route_r: 0.82, safety: 1, correction: 0.1 }));

  const cmp = compareRuns(baseline, candidate, GATES);
  assert.equal(cmp.verdict, "reject");
  assert.ok(cmp.deltas.quality && cmp.deltas.quality < 0);

  const card = buildWhyBetterCard(cmp, GATES);
  assert.equal(card.verdict, "reject");
  const qualityLine = card.gates.find((g) => g.axis === "quality");
  assert.ok(qualityLine && qualityLine.passed === false);
});

test("EVAL-3: better on quality but worse on routing ⇒ coexist (scope, don't force either/or)", () => {
  const baseline = makeRun("base", flat(20, { quality: 0.7, route_p: 0.85, route_r: 0.83, safety: 1, correction: 0.1 }));
  const candidate = makeRun("cand", flat(20, { quality: 0.92, route_p: 0.75, route_r: 0.83, safety: 1, correction: 0.1 }));

  const cmp = compareRuns(baseline, candidate, GATES);
  assert.equal(cmp.verdict, "coexist");
});

test("EVAL-3: gates pass but the improvement is within noise ⇒ needs-human", () => {
  // Alternating spread gives a wide delta CI that straddles 0 despite a small positive mean gap.
  const baseCases: AxisScores[] = Array.from({ length: 20 }, (_, i) => ({
    quality: i % 2 === 0 ? 0.8 : 0.9,
    route_p: 0.9,
    route_r: 0.9,
    safety: 1,
    correction: 0.1,
  }));
  const candCases: AxisScores[] = Array.from({ length: 20 }, (_, i) => ({
    quality: i % 2 === 0 ? 0.82 : 0.92,
    route_p: 0.9,
    route_r: 0.9,
    safety: 1,
    correction: 0.1,
  }));
  const cmp = compareRuns(makeRun("base", baseCases), makeRun("cand", candCases), GATES);
  assert.equal(cmp.verdict, "needs-human");
  const primaryCi = cmp.significance.ci95.quality;
  assert.ok(primaryCi && primaryCi[0] <= 0 && primaryCi[1] >= 0, "CI must straddle 0");
});

test("EVAL-3: thin held-out evidence (n < minCases) ⇒ needs-human even if clearly better", () => {
  const baseline = makeRun("base", flat(5, { quality: 0.7, route_p: 0.8, route_r: 0.78, safety: 1, correction: 0.1 }));
  const candidate = makeRun("cand", flat(5, { quality: 0.95, route_p: 0.95, route_r: 0.9, safety: 1, correction: 0.05 }));
  const cmp = compareRuns(baseline, candidate, GATES);
  assert.equal(cmp.verdict, "needs-human");
  assert.ok(buildWhyBetterCard(cmp, GATES).reasons.some((r) => /insufficient evidence/i.test(r)));
});

test("EVAL-3: thresholds come from policy_params, not hard-coded (a relaxed gate flips reject→promote)", () => {
  // Candidate quality .82 sits BELOW the default .85 floor → reject under defaults …
  const baseline = makeRun("base", flat(20, { quality: 0.7, route_p: 0.85, route_r: 0.83, safety: 1, correction: 0.1 }));
  const candidate = makeRun("cand", flat(20, { quality: 0.82, route_p: 0.88, route_r: 0.85, safety: 1, correction: 0.1 }));

  assert.equal(compareRuns(baseline, candidate, GATES).verdict, "reject");

  // … but a organization that lowered qualityMin to .80 promotes the same candidate.
  const relaxed = resolveGates(mergePolicyParams({ aqv: { gates: { qualityMin: 0.8 } } }));
  assert.equal(compareRuns(baseline, candidate, relaxed).verdict, "promote");
});

test("EVAL-3: a correction regression past correctionMax blocks promotion (guardrail)", () => {
  const baseline = makeRun("base", flat(20, { quality: 0.85, route_p: 0.88, route_r: 0.85, safety: 1, correction: 0.1 }));
  // quality + routing improve, but correction jumps above the .20 ceiling.
  const candidate = makeRun("cand", flat(20, { quality: 0.95, route_p: 0.92, route_r: 0.9, safety: 1, correction: 0.35 }));
  const cmp = compareRuns(baseline, candidate, GATES);
  assert.equal(cmp.verdict, "reject");
});

test("EVAL-3: a safety regression blocks promotion even with quality+routing gains", () => {
  const baseline = makeRun("base", flat(20, { quality: 0.8, route_p: 0.88, route_r: 0.85, safety: 1, correction: 0.1 }));
  const candidate = makeRun("cand", flat(20, { quality: 0.95, route_p: 0.92, route_r: 0.9, safety: 0.9, correction: 0.05 }));
  const cmp = compareRuns(baseline, candidate, GATES);
  assert.equal(cmp.verdict, "reject");
});
