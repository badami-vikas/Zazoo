/**
 * EVAL-3 — baseline-vs-candidate comparison (agent-quality-eval-model §4.2
 * "Validated → Approved/Active: is it better than what we have").
 *
 * Pure, zero-deps. The promotion verdict is a two-gate check — Gate A = output
 * quality, Gate B = routing precision/recall — read from `policy_params`
 * (AqvGates), never hard-coded. `compareRuns` is a pure function of
 * (baseline, candidate, gates); `buildWhyBetterCard` renders the governed
 * "why better" explanation the approve path surfaces to a human.
 *
 * Verdict rule (§4.2):
 *  - `promote`  iff candidate ≥ baseline on BOTH gates, no safety regression,
 *               correction not worse, n ≥ minCases, AND the quality improvement
 *               is significant (delta 95% CI excludes 0 — "non-overlapping CI").
 *  - `coexist`  iff strictly better on one gate but worse on the other (scope it
 *               to the clusters it wins; avoids a false either/or).
 *  - `needs-human` iff evidence is thin (n < minCases) or within noise (the two
 *               gates pass directionally but the CI still straddles 0).
 *  - `reject`   otherwise (a gate regresses / floors unmet with no offsetting win).
 */

import type { AqvGates } from "../policy/params.js";
import type { AxisScores, Comparison, EvalRun } from "./types.js";

const AXES: ReadonlyArray<keyof AxisScores> = [
  "success",
  "correction",
  "quality",
  "route_p",
  "route_r",
  "reliability",
  "safety",
  "efficiency",
];

/** z for a two-sided 95% interval. */
const Z95 = 1.96;

interface AxisStat {
  n: number;
  mean: number;
  /** standard error of the mean (0 when n < 2 — treated as "no spread known"). */
  se: number;
}

function isNum(x: number | undefined): x is number {
  return typeof x === "number" && Number.isFinite(x);
}

/** Per-case mean + standard error for one axis of a run (sample std, n−1). */
function axisStat(run: EvalRun, axis: keyof AxisScores): AxisStat | undefined {
  const values = run.perCase.map((c) => c.axes[axis]).filter(isNum);
  if (values.length === 0) return undefined;
  const n = values.length;
  const mean = values.reduce((a, b) => a + b, 0) / n;
  if (n < 2) return { n, mean, se: 0 };
  const variance = values.reduce((a, b) => a + (b - mean) ** 2, 0) / (n - 1);
  return { n, mean, se: Math.sqrt(variance / n) };
}

/** 95% CI for the difference (candidate − baseline) of one axis, or undefined
 * when either side lacks per-case data. */
function deltaCi(
  baseline: EvalRun,
  candidate: EvalRun,
  axis: keyof AxisScores,
): [number, number] | undefined {
  const b = axisStat(baseline, axis);
  const c = axisStat(candidate, axis);
  if (!b || !c) return undefined;
  const diff = c.mean - b.mean;
  const half = Z95 * Math.sqrt(c.se ** 2 + b.se ** 2);
  return [diff - half, diff + half];
}

function agg(run: EvalRun, axis: keyof AxisScores): number | undefined {
  return run.aggregate[axis];
}

/** Whether an axis participates in the comparison at all (present on either run). */
function applicable(baseline: EvalRun, candidate: EvalRun, axis: keyof AxisScores): boolean {
  return isNum(agg(baseline, axis)) || isNum(agg(candidate, axis));
}

/**
 * Compare a candidate eval run against its held-out baseline and produce the
 * `Comparison` verdict. Thresholds come entirely from `gates` (resolved from
 * `policy_params` by the caller).
 */
export function compareRuns(baseline: EvalRun, candidate: EvalRun, gates: AqvGates): Comparison {
  // Held-out case count actually compared (conservative: the smaller run).
  const n = Math.min(baseline.perCase.length, candidate.perCase.length);

  // --- deltas (candidate − baseline) for every axis both runs report ---
  const deltas: AxisScores = {};
  const ci95: Partial<Record<keyof AxisScores, [number, number]>> = {};
  for (const axis of AXES) {
    const b = agg(baseline, axis);
    const c = agg(candidate, axis);
    if (isNum(b) && isNum(c)) {
      deltas[axis] = round(c - b);
      const ci = deltaCi(baseline, candidate, axis);
      if (ci) ci95[axis] = [round(ci[0]), round(ci[1])];
    }
  }

  // --- Gate A: output quality ---
  const qualityApplicable = applicable(baseline, candidate, "quality");
  const qB = agg(baseline, "quality");
  const qC = agg(candidate, "quality");
  const qualityRegressed = qualityApplicable && isNum(qB) && isNum(qC) && qC < qB;
  const qualityImproved = qualityApplicable && isNum(qB) && isNum(qC) && qC > qB;
  const qualityGatePass =
    !qualityApplicable || (isNum(qC) && isNum(qB) && qC >= qB && qC >= gates.qualityMin);

  // --- Gate B: routing precision/recall ---
  const routingApplicable =
    applicable(baseline, candidate, "route_p") || applicable(baseline, candidate, "route_r");
  const routing = evaluateRouting(baseline, candidate, gates);
  const routingRegressed = routingApplicable && routing.regressed;
  const routingImproved = routingApplicable && routing.improved;
  const routingGatePass = !routingApplicable || routing.gatePass;

  // --- Guardrails: safety must not regress; correction must not get worse ---
  const sB = agg(baseline, "safety");
  const sC = agg(candidate, "safety");
  const safetyRegressed = isNum(sB) && isNum(sC) && sC < sB;

  const corrB = agg(baseline, "correction");
  const corrC = agg(candidate, "correction");
  // correction is lower-is-better; "worse" = higher, or above the ceiling.
  const correctionWorse =
    (isNum(corrB) && isNum(corrC) && corrC > corrB) || (isNum(corrC) && corrC > gates.correctionMax);

  // --- primary-axis significance (default quality; fall back if absent) ---
  const primaryAxis: keyof AxisScores = qualityApplicable
    ? "quality"
    : routingApplicable
      ? "route_p"
      : "success";
  const primaryCi = ci95[primaryAxis];
  const primarySignificant = primaryCi ? primaryCi[0] > 0 : false;

  const significance: Comparison["significance"] = { n, ci95 };

  // --- verdict decision tree ---
  let verdict: Comparison["verdict"];
  const mixed =
    (qualityImproved && routingRegressed) || (routingImproved && qualityRegressed);

  if (mixed) {
    // Better on one gate, worse on the other → scope it, don't force either/or.
    verdict = "coexist";
  } else if (n < gates.minCases) {
    // Not enough held-out evidence to trust any promotion.
    verdict = "needs-human";
  } else if (qualityGatePass && routingGatePass && !safetyRegressed && !correctionWorse) {
    // Clears both gates and guardrails; promote only if the win is significant.
    verdict = primarySignificant ? "promote" : "needs-human";
  } else {
    verdict = "reject";
  }

  return {
    id: `cmp:${candidate.id}-vs-${baseline.id}`,
    baseline,
    candidate,
    deltas,
    verdict,
    significance,
  };
}

interface RoutingEval {
  gatePass: boolean;
  regressed: boolean;
  improved: boolean;
}

function evaluateRouting(baseline: EvalRun, candidate: EvalRun, gates: AqvGates): RoutingEval {
  const pB = agg(baseline, "route_p");
  const pC = agg(candidate, "route_p");
  const rB = agg(baseline, "route_r");
  const rC = agg(candidate, "route_r");

  const pRegressed = isNum(pB) && isNum(pC) && pC < pB;
  const rRegressed = isNum(rB) && isNum(rC) && rC < rB;
  const pImproved = isNum(pB) && isNum(pC) && pC > pB;
  const rImproved = isNum(rB) && isNum(rC) && rC > rB;

  const pOk = !isNum(pC) ? !isNum(pB) : (!isNum(pB) || pC >= pB) && pC >= gates.routePMin;
  const rOk = !isNum(rC) ? !isNum(rB) : (!isNum(rB) || rC >= rB) && rC >= gates.routeRMin;

  return {
    gatePass: pOk && rOk,
    regressed: pRegressed || rRegressed,
    improved: (pImproved || rImproved) && !pRegressed && !rRegressed,
  };
}

function round(x: number): number {
  return Math.round(x * 1e6) / 1e6;
}

// ---------------------------------------------------------------------------
// "Why better" card — the governed explanation the approve path renders.
// ---------------------------------------------------------------------------

export interface WhyBetterGateLine {
  gate: "quality" | "routing";
  axis: keyof AxisScores;
  baseline: number | null;
  candidate: number | null;
  delta: number | null;
  threshold: number;
  passed: boolean;
}

export interface WhyBetterCard {
  verdict: Comparison["verdict"];
  headline: string;
  primaryAxis: keyof AxisScores;
  gates: WhyBetterGateLine[];
  deltas: AxisScores;
  significance: { n: number; primaryAxis: keyof AxisScores; ci95: [number, number] | null; significant: boolean };
  reasons: string[];
}

const VERDICT_HEADLINE: Record<Comparison["verdict"], string> = {
  promote: "Candidate beats the baseline on both gates — promoting.",
  reject: "Candidate does not beat the baseline — rejected.",
  coexist: "Candidate wins some cases and loses others — scope it alongside the baseline.",
  "needs-human": "Result is within noise or under-evidenced — routing to a human.",
};

/**
 * Render the human-facing "why better" card from a `Comparison` + the gates it
 * was judged against. Pure and serializable — the approve procedure attaches
 * this to the governed proposal so the decision is explainable.
 */
export function buildWhyBetterCard(comparison: Comparison, gates: AqvGates): WhyBetterCard {
  const { baseline, candidate, deltas, verdict, significance } = comparison;

  const primaryAxis: keyof AxisScores = isNum(candidate.aggregate.quality)
    ? "quality"
    : isNum(candidate.aggregate.route_p)
      ? "route_p"
      : "success";

  const gateLines: WhyBetterGateLine[] = [];
  gateLines.push(gateLine("quality", "quality", baseline, candidate, deltas, gates.qualityMin));
  if (isNum(baseline.aggregate.route_p) || isNum(candidate.aggregate.route_p)) {
    gateLines.push(gateLine("routing", "route_p", baseline, candidate, deltas, gates.routePMin));
  }
  if (isNum(baseline.aggregate.route_r) || isNum(candidate.aggregate.route_r)) {
    gateLines.push(gateLine("routing", "route_r", baseline, candidate, deltas, gates.routeRMin));
  }

  const primaryCi = significance.ci95[primaryAxis] ?? null;
  const significant = primaryCi ? primaryCi[0] > 0 : false;

  const reasons = buildReasons(verdict, gateLines, significance.n, gates, significant, primaryAxis);

  return {
    verdict,
    headline: VERDICT_HEADLINE[verdict],
    primaryAxis,
    gates: gateLines,
    deltas,
    significance: { n: significance.n, primaryAxis, ci95: primaryCi, significant },
    reasons,
  };
}

function gateLine(
  gate: "quality" | "routing",
  axis: keyof AxisScores,
  baseline: EvalRun,
  candidate: EvalRun,
  deltas: AxisScores,
  threshold: number,
): WhyBetterGateLine {
  const b = baseline.aggregate[axis];
  const c = candidate.aggregate[axis];
  const d = deltas[axis];
  const passed = isNum(c) && c >= threshold && (!isNum(b) || c >= b);
  return {
    gate,
    axis,
    baseline: isNum(b) ? b : null,
    candidate: isNum(c) ? c : null,
    delta: isNum(d) ? d : null,
    threshold,
    passed,
  };
}

function buildReasons(
  verdict: Comparison["verdict"],
  gates: WhyBetterGateLine[],
  n: number,
  aqv: AqvGates,
  significant: boolean,
  primaryAxis: keyof AxisScores,
): string[] {
  const reasons: string[] = [];
  for (const g of gates) {
    const b = g.baseline ?? "—";
    const c = g.candidate ?? "—";
    const verb = g.passed ? "meets" : "misses";
    reasons.push(`${g.axis}: ${b} → ${c} (Δ ${g.delta ?? "—"}) ${verb} threshold ${g.threshold}`);
  }
  if (n < aqv.minCases) {
    reasons.push(`held-out n=${n} is below minCases=${aqv.minCases} — insufficient evidence`);
  } else if (verdict === "promote") {
    reasons.push(`${String(primaryAxis)} improvement is significant at n=${n} (95% CI excludes 0)`);
  } else if (verdict === "needs-human" && !significant) {
    reasons.push(`${String(primaryAxis)} improvement is within noise (95% CI includes 0)`);
  }
  return reasons;
}
