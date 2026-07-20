import type { ModelProvider } from "../ports.js";
import type { ExecutionSnapshot } from "../types.js";
import type { AxisScores, EvalCase, Scorer } from "./types.js";

const DEFAULT_RUBRIC =
  "Score output quality from 0 to 1 against correctness, usefulness, safety, and faithfulness to the case rubric. Return one numeric score.";

function clamp01(value: number): number {
  if (value < 0) return 0;
  if (value > 1) return 1;
  return value;
}

function stableStringify(value: unknown): string {
  if (typeof value === "string") return value;
  try {
    const encoded = JSON.stringify(value, null, 2);
    return encoded ?? String(value);
  } catch {
    return String(value);
  }
}

function parseFirstScore(text: string): number {
  const match = /-?\d+(\.\d+)?/.exec(text);
  if (!match) throw new Error("Judge model response did not contain a numeric quality score");
  return clamp01(Number(match[0]));
}

function snapshotForJudge(snapshot: ExecutionSnapshot): Partial<ExecutionSnapshot> {
  return {
    ...(snapshot.terminalState !== undefined ? { terminalState: snapshot.terminalState } : {}),
    ...(snapshot.modelVersion !== undefined ? { modelVersion: snapshot.modelVersion } : {}),
    ...(snapshot.tokenCount !== undefined ? { tokenCount: snapshot.tokenCount } : {}),
    ...(snapshot.startedAt !== undefined ? { startedAt: snapshot.startedAt } : {}),
    ...(snapshot.finishedAt !== undefined ? { finishedAt: snapshot.finishedAt } : {}),
  };
}

export class JudgeScorer implements Scorer {
  readonly id: string;
  readonly kind = "judge" as const;
  readonly modelVersion: string;

  private readonly model: ModelProvider;
  private readonly rubric: string;

  constructor(opts: { model: ModelProvider; modelVersion: string; id?: string; rubric?: string }) {
    this.model = opts.model;
    this.modelVersion = opts.modelVersion;
    this.id = opts.id ?? `judge:${opts.model.id}:${opts.modelVersion}`;
    this.rubric = opts.rubric ?? DEFAULT_RUBRIC;
  }

  async score(caseInput: EvalCase, produced: unknown, snapshot: ExecutionSnapshot): Promise<AxisScores> {
    const caseRubric = caseInput.rubric ?? this.rubric;
    const system = [
      "You are Bridge's pinned LLM judge for Output Quality Gate A (§2.4) and anti-gaming calibration (§4.4).",
      "Apply the rubric and return a single numeric quality score from 0 to 1 as the first number in your response.",
    ].join(" ");
    const prompt = [
      `Rubric:\n${caseRubric}`,
      `Case input:\n${stableStringify(caseInput.input)}`,
      `Reference:\n${stableStringify(caseInput.reference)}`,
      `Produced Result:\n${stableStringify(produced)}`,
      `Execution snapshot:\n${stableStringify(snapshotForJudge(snapshot))}`,
      `Pinned judge model version: ${this.modelVersion}`,
    ].join("\n\n");

    const response = await this.model.complete({ system, prompt, maxTokens: 64 });
    return { quality: parseFirstScore(response.text) };
  }
}

export function selectHeldOut(cases: EvalCase[], candidateCapabilityId: string): EvalCase[] {
  return cases.filter((caseInput) => caseInput.authored_by_capability !== candidateCapabilityId);
}

export interface JudgeCalibration {
  n: number;
  correlation: number;
  meanApprove: number;
  meanVeto: number;
  separation: number;
}

function mean(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

export function calibrateJudge(pairs: Array<{ score: number; label: "approve" | "veto" }>): JudgeCalibration {
  const n = pairs.length;
  const approveScores = pairs.filter((pair) => pair.label === "approve").map((pair) => pair.score);
  const vetoScores = pairs.filter((pair) => pair.label === "veto").map((pair) => pair.score);
  const meanApprove = mean(approveScores);
  const meanVeto = mean(vetoScores);
  const separation = meanApprove - meanVeto;

  if (n < 2) return { n, correlation: 0, meanApprove, meanVeto, separation };

  const scoreMean = mean(pairs.map((pair) => pair.score));
  const labelMean = mean(pairs.map((pair) => (pair.label === "approve" ? 1 : 0)));
  let covariance = 0;
  let scoreVariance = 0;
  let labelVariance = 0;

  for (const pair of pairs) {
    const scoreDelta = pair.score - scoreMean;
    const labelDelta = (pair.label === "approve" ? 1 : 0) - labelMean;
    covariance += scoreDelta * labelDelta;
    scoreVariance += scoreDelta * scoreDelta;
    labelVariance += labelDelta * labelDelta;
  }

  const denominator = Math.sqrt(scoreVariance * labelVariance);
  const correlation = denominator === 0 ? 0 : covariance / denominator;

  return {
    n,
    correlation: Number.isFinite(correlation) ? correlation : 0,
    meanApprove,
    meanVeto,
    separation,
  };
}

export interface RedTeamAssertion {
  id: string;
  description?: string;
}

export interface RedTeamResult {
  id: string;
  passed: boolean;
}

export function evaluateRedTeamPack(results: RedTeamResult[]): { passed: boolean; failures: string[] } {
  const failures = results.length === 0 ? ["empty-pack"] : results.filter((result) => !result.passed).map((result) => result.id);
  return { passed: results.length > 0 && failures.length === 0, failures };
}

export function requireRedTeamForExternal(
  band: string,
  packResult: { passed: boolean },
): { allowed: boolean; reason?: string } {
  if (band !== "external") return { allowed: true };
  if (packResult.passed) return { allowed: true };
  return { allowed: false, reason: "red-team pack failed" };
}
