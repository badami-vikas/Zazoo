import type { CapabilityStateRow, CapabilityStore } from "../capability/ports.js";
import type { ExecutionSnapshot } from "../types.js";
import type { AxisScores, Comparison, EvalDataset, EvalRun, Scorer } from "./types.js";

export interface EvalStore {
  createDataset(row: EvalDataset): Promise<EvalDataset>;
  getDataset(id: string): Promise<EvalDataset | null>;
  listDatasets(opts: { limit: number; offset: number }): Promise<{ items: EvalDataset[]; total: number }>;
  createRun(row: Omit<EvalRun, "id"> & { id?: string }): Promise<EvalRun>;
  getRun(id: string): Promise<EvalRun | null>;
  listRuns(capabilityId: string, opts: { limit: number; offset: number }): Promise<{ items: EvalRun[]; total: number }>;
  createComparison(row: Omit<Comparison, "id"> & { id?: string }): Promise<Comparison>;
  getComparison(id: string): Promise<Comparison | null>;
}

export class InMemoryEvalStore implements EvalStore {
  readonly datasets = new Map<string, EvalDataset>();
  readonly runs = new Map<string, EvalRun>();
  readonly comparisons = new Map<string, Comparison>();
  #runCounter = 0;
  #comparisonCounter = 0;

  async createDataset(row: EvalDataset): Promise<EvalDataset> {
    if (this.datasets.has(row.id)) throw new Error(`eval dataset: duplicate id ${row.id}`);
    this.datasets.set(row.id, row);
    return row;
  }

  async getDataset(id: string): Promise<EvalDataset | null> {
    return this.datasets.get(id) ?? null;
  }

  async listDatasets(opts: { limit: number; offset: number }): Promise<{ items: EvalDataset[]; total: number }> {
    const all = [...this.datasets.values()].sort((a, b) => a.id.localeCompare(b.id));
    return { items: all.slice(opts.offset, opts.offset + opts.limit), total: all.length };
  }

  async createRun(row: Omit<EvalRun, "id"> & { id?: string }): Promise<EvalRun> {
    const id = row.id ?? `evalrun_${++this.#runCounter}`;
    if (this.runs.has(id)) throw new Error(`eval run: duplicate id ${id}`);
    const full: EvalRun = { ...row, id };
    this.runs.set(id, full);
    return full;
  }

  async getRun(id: string): Promise<EvalRun | null> {
    return this.runs.get(id) ?? null;
  }

  async listRuns(capabilityId: string, opts: { limit: number; offset: number }): Promise<{ items: EvalRun[]; total: number }> {
    const all = [...this.runs.values()]
      .filter((run) => run.capability_id === capabilityId)
      .sort((a, b) => a.started_at.localeCompare(b.started_at));
    return { items: all.slice(opts.offset, opts.offset + opts.limit), total: all.length };
  }

  async createComparison(row: Omit<Comparison, "id"> & { id?: string }): Promise<Comparison> {
    const id = row.id ?? `evalcmp_${++this.#comparisonCounter}`;
    if (this.comparisons.has(id)) throw new Error(`eval comparison: duplicate id ${id}`);
    const full: Comparison = { ...row, id };
    this.comparisons.set(id, full);
    return full;
  }

  async getComparison(id: string): Promise<Comparison | null> {
    return this.comparisons.get(id) ?? null;
  }
}

export interface EvalProducedCase {
  caseId: string;
  produced: unknown;
  snapshot?: ExecutionSnapshot;
}

export interface RunDatasetInput {
  store: EvalStore;
  datasetId: string;
  capabilityId: string;
  capabilityVersion: string;
  scorers: Scorer[];
  produced: EvalProducedCase[];
  modelVersion?: string;
  startedAt: string;
  finishedAt: string;
}

export async function runEvalDataset(input: RunDatasetInput): Promise<EvalRun> {
  const dataset = await input.store.getDataset(input.datasetId);
  if (!dataset) throw new Error(`eval dataset: unknown id ${input.datasetId}`);
  const producedByCase = new Map(input.produced.map((item) => [item.caseId, item]));
  const perCase: EvalRun["perCase"] = [];

  for (const evalCase of dataset.cases) {
    const produced = producedByCase.get(evalCase.id);
    if (!produced) throw new Error(`eval run: missing produced output for case ${evalCase.id}`);
    const axes: AxisScores[] = [];
    for (const scorer of input.scorers) {
      axes.push(await scorer.score(evalCase, produced.produced, produced.snapshot ?? {}));
    }
    perCase.push({ caseId: evalCase.id, axes: mergeScores(axes) });
  }

  return input.store.createRun({
    capability_id: input.capabilityId,
    capability_version: input.capabilityVersion,
    dataset_id: input.datasetId,
    perCase,
    aggregate: aggregateScores(perCase.map((item) => item.axes)),
    ...(input.modelVersion ? { model_version: input.modelVersion } : {}),
    started_at: input.startedAt,
    finished_at: input.finishedAt,
  });
}

export async function writeEvalRunEvidence(store: CapabilityStore, manifestId: string, run: EvalRun): Promise<CapabilityStateRow> {
  const existing = await store.getState(manifestId);
  if (!existing) throw new Error(`capability state: unknown manifest id ${manifestId}`);
  const previousRuns = existing.evidence.evalRuns ?? [];
  const violationCount = run.aggregate.safety === 0 ? Math.max(existing.evidence.violationCount ?? 0, 1) : existing.evidence.violationCount;
  return store.upsertState({
    manifestId: existing.manifestId,
    organizationId: existing.organizationId,
    state: existing.state,
    ...(existing.trustedUntil !== undefined ? { trustedUntil: existing.trustedUntil } : {}),
    suspended: existing.suspended,
    ...(existing.suspendReason !== undefined ? { suspendReason: existing.suspendReason } : {}),
    evidence: {
      ...existing.evidence,
      ...(run.aggregate.success !== undefined ? { successRate: run.aggregate.success } : {}),
      ...(violationCount !== undefined ? { violationCount } : {}),
      evalRuns: [
        ...previousRuns,
        { runId: run.id, datasetId: run.dataset_id, aggregate: run.aggregate, recordedAt: run.finished_at },
      ],
    },
  });
}

function mergeScores(scores: AxisScores[]): AxisScores {
  return aggregateScores(scores);
}

function aggregateScores(scores: AxisScores[]): AxisScores {
  const keys: Array<keyof AxisScores> = ["success", "correction", "quality", "route_p", "route_r", "reliability", "safety", "efficiency"];
  const aggregate: AxisScores = {};
  for (const key of keys) {
    const values = scores.map((score) => score[key]).filter((value): value is number => typeof value === "number");
    if (values.length === 0) continue;
    aggregate[key] = key === "safety" ? Math.min(...values) : values.reduce((sum, value) => sum + value, 0) / values.length;
  }
  return aggregate;
}
