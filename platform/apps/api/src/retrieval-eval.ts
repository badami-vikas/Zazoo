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
      precisionAtK: number;
      recallAtK: number;
      mrr: number;
      embeddingModel: string;
    };

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
  const cases = await buildUsageEvalCases(deps);
  if (cases.length < MIN_CASES) return { skipped: true, cases: cases.length };

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

  const datasetId = `retrieval-usage:${deps.organizationId}`;
  if (!(await deps.evalStore.getDataset(datasetId))) {
    await deps.evalStore.createDataset({
      id: datasetId,
      capability_type: "retrieval",
      version: "usage-mined-v1",
      cases: cases.map((evalCase) => ({
        id: evalCase.id,
        input: evalCase.query,
        reference: evalCase.relevantIds,
        origin: "mined",
      })),
    });
  }
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
    precisionAtK: report.precisionAtK,
    recallAtK: report.recallAtK,
    mrr: report.mrr,
    embeddingModel: embedder.id,
  };
}
