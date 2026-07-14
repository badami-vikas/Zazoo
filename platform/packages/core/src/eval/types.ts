import type { ExecutionSnapshot } from "../types.js";

export type EvalCaseOrigin = "seed" | "mined" | "red-team";

export interface EvalCase {
  id: string;
  input: unknown;
  reference?: unknown;
  labels?: Record<string, string>;
  rubric?: string;
  origin: EvalCaseOrigin;
  authored_by_capability?: string;
}

export interface EvalDataset {
  id: string;
  capability_type: string;
  version: string;
  cases: EvalCase[];
}

export interface AxisScores {
  success?: number;
  correction?: number;
  quality?: number;
  route_p?: number;
  route_r?: number;
  reliability?: number;
  safety?: number;
  efficiency?: number;
}

export interface Scorer {
  id: string;
  kind: "deterministic" | "judge";
  score(caseInput: EvalCase, produced: unknown, snapshot: ExecutionSnapshot): Promise<AxisScores>;
}

export interface EvalRun {
  id: string;
  capability_id: string;
  capability_version: string;
  dataset_id: string;
  perCase: Array<{ caseId: string; axes: AxisScores }>;
  aggregate: AxisScores;
  model_version?: string;
  started_at: string;
  finished_at: string;
}

export interface Comparison {
  id: string;
  baseline: EvalRun;
  candidate: EvalRun;
  deltas: AxisScores;
  verdict: "promote" | "reject" | "coexist" | "needs-human";
  significance: { n: number; ci95: Partial<Record<keyof AxisScores, [number, number]>> };
}
