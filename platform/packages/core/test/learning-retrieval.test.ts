/**
 * Retrieval fusion v1 (LA5 slice) — contract:
 * RRF fusion is deterministic and rewards cross-lane agreement; the
 * cross-plane gate fails closed (hard invariant); the vector index stores
 * refs only and is rebuildable; the eval harness measures precision/recall/
 * MRR and this suite PINS THE BASELINE — lowering retrieval quality below
 * these numbers fails the build (LA5 exit criterion: "regressions block
 * ship from here on").
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  HASHING_EMBEDDER_ID,
  InMemoryVectorIndex,
  cosineSimilarity,
  evaluateRetrieval,
  fuseRetrieval,
  fusedToMemorySnippets,
  hashingEmbed,
  type RetrievalCandidate,
  type RetrievalEvalCase,
  type RetrievalLaneResult,
} from "../src/learning/retrieval.js";

function candidate(id: string, overrides: Partial<RetrievalCandidate> = {}): RetrievalCandidate {
  return {
    id,
    text: `text for ${id}`,
    source: `memory:${id}`,
    layer: "personal",
    plane: "local",
    ...overrides,
  };
}

test("RRF fusion rewards cross-lane agreement and is deterministic", () => {
  const lanes: RetrievalLaneResult[] = [
    { lane: "structured", candidates: [candidate("a"), candidate("b"), candidate("c")] },
    { lane: "vector", candidates: [candidate("b"), candidate("d")] },
    { lane: "graph", candidates: [candidate("b"), candidate("a")] },
  ];
  const first = fuseRetrieval({ lanes, requesterPlane: "local" });
  // b appears in all three lanes → top; a in two lanes → second.
  assert.deepEqual(first.candidates.map((c) => c.id).slice(0, 2), ["b", "a"]);
  assert.deepEqual([...first.candidates.find((c) => c.id === "b")!.lanes].sort(), ["graph", "structured", "vector"]);
  assert.equal(first.suppressedByPlaneGate, 0);
  // Determinism: identical input → identical output.
  const second = fuseRetrieval({ lanes, requesterPlane: "local" });
  assert.deepEqual(second.candidates, first.candidates);
});

test("fusion ties break by id and limit bounds the result", () => {
  const lanes: RetrievalLaneResult[] = [
    { lane: "structured", candidates: [candidate("z")] },
    { lane: "vector", candidates: [candidate("m")] },
  ];
  const fused = fuseRetrieval({ lanes, requesterPlane: "local" });
  // Equal single-lane rank-1 contributions → id ascending.
  assert.deepEqual(fused.candidates.map((c) => c.id), ["m", "z"]);
  const limited = fuseRetrieval({ lanes, requesterPlane: "local", limit: 1 });
  assert.equal(limited.candidates.length, 1);
});

test("HARD INVARIANT: cloud requester never sees local-plane or unlabeled candidates", () => {
  const unlabeled: RetrievalCandidate = {
    id: "unlabeled-row",
    text: "text for unlabeled-row",
    source: "memory:unlabeled-row",
    layer: "personal",
    // plane deliberately ABSENT — must fail closed as local.
  };
  const lanes: RetrievalLaneResult[] = [
    {
      lane: "structured",
      candidates: [
        candidate("local-row", { plane: "local" }),
        unlabeled,
        candidate("cloud-row", { plane: "cloud" }),
      ],
    },
    { lane: "vector", candidates: [candidate("local-row", { plane: "local" })] },
  ];
  const fused = fuseRetrieval({ lanes, requesterPlane: "cloud" });
  assert.deepEqual(fused.candidates.map((c) => c.id), ["cloud-row"]);
  // The gate demonstrably fired — three drops (local twice + unlabeled once).
  assert.equal(fused.suppressedByPlaneGate, 3);
  // A local requester sees everything (cloud rows are not secret from local).
  const local = fuseRetrieval({ lanes, requesterPlane: "local" });
  assert.equal(local.candidates.length, 3);
  assert.equal(local.suppressedByPlaneGate, 0);
});

test("fused candidates project into memory snippets with normalized scores", () => {
  const lanes: RetrievalLaneResult[] = [
    { lane: "structured", candidates: [candidate("a", { trustOrigin: "user_content" }), candidate("b")] },
    { lane: "vector", candidates: [candidate("a")] },
  ];
  const fused = fuseRetrieval({ lanes, requesterPlane: "local" });
  const snippets = fusedToMemorySnippets(fused.candidates);
  assert.equal(snippets[0]!.source, "memory:a");
  assert.equal(snippets[0]!.score, 1);
  assert.equal(snippets[0]!.trustOrigin, "user_content");
  assert.ok(snippets[1]!.score! > 0 && snippets[1]!.score! < 1);
});

test("vector index: refs only, cosine ranking, model spaces never mix, rebuildable", async () => {
  const index = new InMemoryVectorIndex();
  const embed = (text: string) => hashingEmbed(text);
  await index.upsert([
    { entityType: "memory", entityId: "hvac", embeddingModel: HASHING_EMBEDDER_ID, embedding: embed("hvac service business in texas with strong technician team") },
    { entityType: "memory", entityId: "saas", embeddingModel: HASHING_EMBEDDER_ID, embedding: embed("b2b saas company with recurring subscription revenue") },
    { entityType: "memory", entityId: "other-model", embeddingModel: "someone-elses-space", embedding: embed("hvac hvac hvac") },
  ]);

  const hits = await index.search({
    entityType: "memory",
    embeddingModel: HASHING_EMBEDDER_ID,
    embedding: embed("looking at an hvac business in texas"),
    limit: 5,
  });
  // Lexical overlap ranks the hvac row first; the other-model row is
  // invisible even though its tokens match (different embedding space).
  assert.equal(hits[0]!.entityId, "hvac");
  assert.ok(!hits.some((h) => h.entityId === "other-model"));

  // existingIds answers the indexer's missing-scan.
  const existing = await index.existingIds("memory", HASHING_EMBEDDER_ID, ["hvac", "saas", "nope"]);
  assert.deepEqual([...existing].sort(), ["hvac", "saas"]);

  // listModels enumerates the spaces present — the reclamation scan.
  assert.deepEqual(await index.listModels("memory"), [HASHING_EMBEDDER_ID, "someone-elses-space"]);

  // Rebuild seam: clear drops exactly one (entityType, model) space.
  await index.clear("memory", HASHING_EMBEDDER_ID);
  assert.deepEqual(await index.existingIds("memory", HASHING_EMBEDDER_ID, ["hvac", "saas"]), new Set());
  assert.deepEqual(await index.existingIds("memory", "someone-elses-space", ["other-model"]), new Set(["other-model"]));
  assert.deepEqual(await index.listModels("memory"), ["someone-elses-space"]);
});

test("cosine similarity handles mixed lengths and zero vectors", () => {
  assert.equal(cosineSimilarity([1, 0], [1, 0]), 1);
  assert.equal(cosineSimilarity([1, 0], [0, 1]), 0);
  assert.equal(cosineSimilarity([1, 0, 0, 5], [1, 0]), cosineSimilarity([1, 0], [1, 0, 0, 5]));
  assert.equal(cosineSimilarity([], [1, 2]), 0);
});

// ---------------------------------------------------------------------------
// BASELINED EVAL — LA5 exit criterion. The corpus is a synthetic held-out
// fixture (real-usage pairs replace it as usage accrues); the thresholds
// below are the measured baseline. DO NOT lower them to make a change pass:
// a drop means the retrieval pipeline got worse.
// ---------------------------------------------------------------------------

const EVAL_CORPUS: Array<{ id: string; text: string }> = [
  { id: "m-hvac-1", text: "Dismissed an hvac deal in texas because the technician team was thin" },
  { id: "m-hvac-2", text: "Pursued an hvac services business in austin texas with strong recurring maintenance contracts" },
  { id: "m-saas-1", text: "Reviewed a b2b saas company with subscription revenue and low churn" },
  { id: "m-saas-2", text: "Dismissed a saas deal with high customer concentration in the subscription base" },
  { id: "m-rest-1", text: "Dismissed three restaurant deals due to food service margins" },
  { id: "m-rest-2", text: "Restaurant group in dallas with catering revenue was marked review" },
  { id: "m-geo-1", text: "Prefers deals located in texas over out of state opportunities" },
  { id: "m-fin-1", text: "Asked for seller discretionary earnings adjustments on every deal memo" },
  { id: "m-fin-2", text: "Wants sde multiples benchmarked against industry comps before review" },
  { id: "m-team-1", text: "Cares about management team depth staying on after close" },
];

const EVAL_CASES: RetrievalEvalCase[] = [
  { id: "q-hvac", query: "what did I decide about hvac businesses in texas", relevantIds: ["m-hvac-1", "m-hvac-2"] },
  { id: "q-saas", query: "saas subscription deals I have seen", relevantIds: ["m-saas-1", "m-saas-2"] },
  { id: "q-rest", query: "restaurant and food service history", relevantIds: ["m-rest-1", "m-rest-2"] },
  { id: "q-fin", query: "how do I want sde and earnings handled", relevantIds: ["m-fin-1", "m-fin-2"] },
  { id: "q-geo", query: "which locations do I prefer", relevantIds: ["m-geo-1"] },
];

test("retrieval eval baseline holds — regressions block ship (LA5 gate)", async () => {
  const index = new InMemoryVectorIndex();
  await index.upsert(
    EVAL_CORPUS.map((row) => ({
      entityType: "memory",
      entityId: row.id,
      embeddingModel: HASHING_EMBEDDER_ID,
      embedding: hashingEmbed(row.text),
    })),
  );
  const textById = new Map(EVAL_CORPUS.map((row) => [row.id, row.text]));

  const retrieve = async (query: string, k: number): Promise<string[]> => {
    const vectorHits = await index.search({
      entityType: "memory",
      embeddingModel: HASHING_EMBEDDER_ID,
      embedding: hashingEmbed(query),
      limit: k,
    });
    // Structured lane double: naive substring containment over the corpus —
    // stands in for the MemoryStore contentPathEquals/recency lane.
    const queryTokens = new Set(query.toLowerCase().match(/[a-z0-9]{3,}/g) ?? []);
    const structured = EVAL_CORPUS
      .map((row) => ({
        id: row.id,
        overlap: (row.text.toLowerCase().match(/[a-z0-9]{3,}/g) ?? []).filter((t) => queryTokens.has(t)).length,
      }))
      .filter((row) => row.overlap > 0)
      .sort((a, b) => (b.overlap - a.overlap) || (a.id < b.id ? -1 : 1))
      .slice(0, k);

    const fused = fuseRetrieval({
      requesterPlane: "local",
      limit: k,
      lanes: [
        {
          lane: "vector",
          candidates: vectorHits.map((hit) => ({
            id: hit.entityId,
            text: textById.get(hit.entityId) ?? "",
            source: `memory:${hit.entityId}`,
            layer: "personal" as const,
            plane: "local" as const,
          })),
        },
        {
          lane: "structured",
          candidates: structured.map((row) => ({
            id: row.id,
            text: textById.get(row.id) ?? "",
            source: `memory:${row.id}`,
            layer: "personal" as const,
            plane: "local" as const,
          })),
        },
      ],
    });
    return fused.candidates.map((c) => c.id);
  };

  const report = await evaluateRetrieval(EVAL_CASES, retrieve, 3);
  // BASELINE (measured 2026-08-03): recall@3 = 1.0, precision@3 = 0.6,
  // MRR = 0.8667 — q-geo's single relevant row lands at rank 3 (a genuinely
  // hard lexical case; a semantic embedding model should lift it, and this
  // gate will prove that improvement). Floors sit just under measured. DO
  // NOT lower them to make a change pass: a drop means retrieval got worse.
  assert.ok(report.recallAtK >= 0.99, `recall@3 regressed below baseline 1.0: ${report.recallAtK}`);
  assert.ok(report.mrr >= 0.85, `MRR regressed below baseline 0.8667: ${report.mrr}`);
  assert.ok(report.precisionAtK >= 0.55, `precision@3 regressed below baseline 0.6: ${report.precisionAtK}`);
});
