/**
 * Retrieval eval over REAL usage (LA5 deliverable: "retrieval eval set
 * (held-out Q→evidence pairs from real usage) + scheduled eval automation").
 *
 * The eval set is MINED from the organization's own current prose Memory
 * rows — no fabricated corpus on a runtime surface. Each case is a
 * self-retrieval pair: the query is the row's own distinctive tokens, the
 * relevant answer is that row. That is deliberately modest and honestly
 * labeled (`origin: "mined"`): it measures whether the LIVE pipeline —
 * the same `fusedChatMemory` chat uses, active embedder, real index — can
 * find real rows, which is exactly the regression that matters when an
 * embedder, fusion weight, or adapter changes. Human-judged relevance
 * pairs can extend the same dataset later without changing this runner.
 *
 * Reports persist as `EvalRun`s in the platform eval store
 * (capability_id `platform.learning.retrieval-fusion`), with the
 * embedding-space id as capability_version so runs across embedder
 * switches stay comparable side by side. Fewer than MIN_CASES prose rows
 * skips honestly — an empty workspace produces no fake numbers.
 *
 * DATASET REFRESH POLICY (ADR-174): runs score a STORED dataset version so
 * consecutive runs compare like for like — a moving case set would make
 * every delta ambiguous (did retrieval change, or the questions?). Before
 * scoring, stored cases whose source Memory no longer exists are PRUNED
 * (a deleted row is corpus drift, not pipeline regression). The dataset
 * refreshes — a NEW immutable version minted from freshly mined cases —
 * only when (a) none exists yet, (b) pruning left fewer than MIN_CASES
 * live cases, or (c) the live stored set and the freshly mined set have
 * drifted apart (Jaccard overlap of case ids < 0.5). Old versions stay in
 * the store, so historical runs keep pointing at exactly what they scored.
 */
import {
  evaluateRetrieval,
  hashingTextEmbedder,
  isLearningObservationEntry,
  type EvalStore,
  type MemoryEntry,
  type MemoryStore,
  type RetrievalEvalCase,
  type TextEmbedder,
  type VectorIndex,
} from "@bridge/core";
import type { DrizzleGraphStore } from "@bridge/db";
import { fusedChatMemory } from "./retrieval-fusion.js";

export const RETRIEVAL_EVAL_CAPABILITY_ID = "platform.learning.retrieval-fusion";
const MIN_CASES = 3;
const MAX_CASES = 20;
const EVAL_K = 5;

function isEvalSourceRow(entry: MemoryEntry): boolean {
  return entry.plane === "local" && !isLearningObservationEntry(entry) && entry.content.trim().length >= 40;
}

/** Deterministic query for a row: its first distinctive tokens. */
export function usageQueryFor(content: string, maxTokens = 8): string {
  const tokens = content.toLowerCase().match(/[a-z0-9]{4,}/g) ?? [];
  return [...new Set(tokens)].slice(0, maxTokens).join(" ");
}

export async function buildUsageEvalCases(deps: {
  memoryStore: MemoryStore;
  organizationId: string;
  ownerUserId: string;
}): Promise<RetrievalEvalCase[]> {
  const rows = await deps.memoryStore.retrieve(
    { limit: 200 },
    { organizationId: deps.organizationId, userId: deps.ownerUserId },
  );
  return rows
    .filter(isEvalSourceRow)
    .slice(0, MAX_CASES)
    .map((row) => ({ id: row.id, query: usageQueryFor(row.content), relevantIds: [row.id] }))
    .filter((evalCase) => evalCase.query.length > 0);
}

export type UsageEvalResult =
  | { skipped: true; cases: number }
  | {
      skipped: false;
      cases: number;
      runId: string;
      datasetId: string;
      /** True when this pass minted a new dataset version (refresh policy fired). */
      datasetRefreshed: boolean;
      precisionAtK: number;
      recallAtK: number;
      mrr: number;
      embeddingModel: string;
    };

const DATASET_PREFIX = "retrieval-usage:";
/** Below this id-overlap between the live stored cases and freshly mined
 * cases, the workspace has moved on and comparisons would mislead. */
const REFRESH_JACCARD_THRESHOLD = 0.5;

function datasetVersionOf(id: string, organizationId: string): number | null {
  const base = `${DATASET_PREFIX}${organizationId}`;
  if (id === base) return 1; // pre-policy unversioned dataset = v1
  if (!id.startsWith(`${base}:v`)) return null;
  const version = Number(id.slice(`${base}:v`.length));
  return Number.isInteger(version) && version >= 1 ? version : null;
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 1;
  let intersection = 0;
  for (const value of a) if (b.has(value)) intersection += 1;
  return intersection / (a.size + b.size - intersection);
}

/** Rehydrate RetrievalEvalCases from a stored dataset's rows. */
function storedCasesOf(cases: Array<{ id: string; input: unknown; reference?: unknown }>): RetrievalEvalCase[] {
  return cases.flatMap((row) =>
    typeof row.input === "string" && Array.isArray(row.reference) && row.reference.every((v) => typeof v === "string")
      ? [{ id: row.id, query: row.input, relevantIds: row.reference }]
      : [],
  );
}

/** One scheduled eval pass: mine cases from real rows, run them through the
 * LIVE fused retrieval pipeline, persist the scored run. */
export async function runUsageRetrievalEval(deps: {
  memoryStore: MemoryStore;
  vectorIndex: VectorIndex;
  graphStore: Pick<DrizzleGraphStore, "listPeople" | "listTimeline">;
  evalStore: EvalStore;
  organizationId: string;
  ownerUserId: string;
  embedder?: TextEmbedder;
  nowISO: () => string;
}): Promise<UsageEvalResult> {
  const embedder = deps.embedder ?? hashingTextEmbedder();
  const mined = await buildUsageEvalCases(deps);
  if (mined.length < MIN_CASES) return { skipped: true, cases: mined.length };

  // Refresh policy (see module header): reuse the latest stored dataset
  // version when its live cases still describe this workspace; otherwise
  // mint the next immutable version from the freshly mined cases.
  const scope = { organizationId: deps.organizationId, userId: deps.ownerUserId };
  const { items: allDatasets } = await deps.evalStore.listDatasets({ limit: 200, offset: 0 });
  const latest = allDatasets
    .map((dataset) => ({ dataset, version: datasetVersionOf(dataset.id, deps.organizationId) }))
    .filter((entry): entry is { dataset: (typeof allDatasets)[number]; version: number } => entry.version !== null)
    .sort((a, b) => b.version - a.version)[0];

  const liveStored: RetrievalEvalCase[] = [];
  if (latest) {
    // Prune cases whose source row is gone — corpus drift, not regression.
    for (const storedCase of storedCasesOf(latest.dataset.cases)) {
      const row = await deps.memoryStore.get(storedCase.id, scope);
      if (row) liveStored.push(storedCase);
    }
  }
  const minedIds = new Set(mined.map((evalCase) => evalCase.id));
  const storedIds = new Set(liveStored.map((evalCase) => evalCase.id));
  const needsRefresh =
    !latest || liveStored.length < MIN_CASES || jaccard(minedIds, storedIds) < REFRESH_JACCARD_THRESHOLD;

  let datasetId: string;
  let cases: RetrievalEvalCase[];
  if (needsRefresh) {
    datasetId = `${DATASET_PREFIX}${deps.organizationId}:v${(latest?.version ?? 0) + 1}`;
    cases = mined;
    await deps.evalStore.createDataset({
      id: datasetId,
      capability_type: "retrieval",
      version: "usage-mined-v1",
      cases: mined.map((evalCase) => ({
        id: evalCase.id,
        input: evalCase.query,
        reference: evalCase.relevantIds,
        origin: "mined",
      })),
    });
  } else {
    datasetId = latest.dataset.id;
    cases = liveStored;
  }

  const startedAt = deps.nowISO();
  const retrieve = async (query: string, k: number): Promise<string[]> => {
    const { snippets } = await fusedChatMemory({
      memoryStore: deps.memoryStore,
      vectorIndex: deps.vectorIndex,
      graphStore: deps.graphStore,
      organizationId: deps.organizationId,
      ownerUserId: deps.ownerUserId,
      query,
      limit: k,
      embedder,
    });
    return snippets
      .map((snippet) => snippet.source)
      .filter((source) => source.startsWith("memory:"))
      .map((source) => source.slice("memory:".length));
  };
  const report = await evaluateRetrieval(cases, retrieve, EVAL_K);

  const run = await deps.evalStore.createRun({
    capability_id: RETRIEVAL_EVAL_CAPABILITY_ID,
    capability_version: embedder.id,
    dataset_id: datasetId,
    perCase: report.cases.map((caseResult) => ({
      caseId: caseResult.caseId,
      axes: {
        route_p: caseResult.precisionAtK,
        route_r: caseResult.recallAtK,
        success: caseResult.reciprocalRank,
      },
    })),
    aggregate: { route_p: report.precisionAtK, route_r: report.recallAtK, success: report.mrr },
    started_at: startedAt,
    finished_at: deps.nowISO(),
  });
  return {
    skipped: false,
    cases: cases.length,
    runId: run.id,
    datasetId,
    datasetRefreshed: needsRefresh,
    precisionAtK: report.precisionAtK,
    recallAtK: report.recallAtK,
    mrr: report.mrr,
    embeddingModel: embedder.id,
  };
}
