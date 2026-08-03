/**
 * Retrieval fusion wiring (LA5, TASK-032) — binds the pure core fusion
 * machinery (@bridge/core learning/retrieval.ts) to this app's stores:
 *
 *  - `indexMemoryEmbeddings` — the scheduled indexer: embeds prose Memory
 *    rows (never learning-machinery JSON) into the central `embeddings`
 *    table as REFS + vectors. Rebuildable at any time; the MemoryStore stays
 *    the single source of truth.
 *  - `fusedChatMemory` — the chat-time retriever: three lanes (structured
 *    recency, vector similarity, graph traversal) fused with RRF into
 *    run-context memory snippets.
 *
 * v1 embeds with the deterministic HASHING LEXICAL embedder (@bridge/core
 * `hashingEmbed`, id `bridge-hashing-lexical-v1`) — honest about being
 * token-overlap, not semantic. A real embedding model swaps in behind the
 * same `VectorIndex` port under its own embeddingModel id; the core eval
 * baseline (learning-retrieval.test.ts) is the gate that proves the lift.
 *
 * Authority + planes: vector hits are ids only — hydration goes through the
 * authority-scoped `memoryStore.get`, so a row the caller may not read never
 * surfaces. Graph lanes go through the graph store's own RLS/visibility
 * predicates. Fusion runs with the requester's plane and fails closed
 * cross-plane (core invariant); this module is only ever invoked from the
 * Local-Plane chat path.
 */
import {
  HASHING_EMBEDDER_ID,
  fuseRetrieval,
  fusedToMemorySnippets,
  hashingEmbed,
  isLearningObservationEntry,
  labelFromLegacyTrustOrigin,
  type MemoryEntry,
  type MemoryStore,
  type RetrievalCandidate,
  type RetrievalLaneResult,
  type RetrievedMemorySnippet,
  type TaintLabel,
  type VectorIndex,
} from "@bridge/core";
import type { DrizzleGraphStore } from "@bridge/db";

export const MEMORY_VECTOR_ENTITY_TYPE = "memory";

/** How many prose rows one indexer pass scans (newest first). */
const INDEXER_SCAN_LIMIT = 500;
const LANE_LIMIT = 8;
const MAX_SNIPPET_CHARS = 4_000;

function isIndexableProseRow(entry: MemoryEntry): boolean {
  return (
    entry.plane === "local" &&
    entry.content.trim().length > 0 &&
    !isLearningObservationEntry(entry)
  );
}

/** One indexer pass: embed every current prose Memory row not yet in the
 * vector index. Idempotent — already-indexed rows are skipped; a full
 * rebuild is `vectorIndex.clear(...)` followed by one pass. */
export async function indexMemoryEmbeddings(deps: {
  memoryStore: MemoryStore;
  vectorIndex: VectorIndex;
  organizationId: string;
  ownerUserId: string;
}): Promise<{ scanned: number; indexed: number }> {
  const scope = { organizationId: deps.organizationId, userId: deps.ownerUserId };
  const rows = await deps.memoryStore.retrieve({ limit: INDEXER_SCAN_LIMIT }, scope);
  const indexable = rows.filter(isIndexableProseRow);
  const existing = await deps.vectorIndex.existingIds(
    MEMORY_VECTOR_ENTITY_TYPE,
    HASHING_EMBEDDER_ID,
    indexable.map((row) => row.id),
  );
  const missing = indexable.filter((row) => !existing.has(row.id));
  if (missing.length > 0) {
    await deps.vectorIndex.upsert(
      missing.map((row) => ({
        entityType: MEMORY_VECTOR_ENTITY_TYPE,
        entityId: row.id,
        embeddingModel: HASHING_EMBEDDER_ID,
        embedding: hashingEmbed(row.content.slice(0, MAX_SNIPPET_CHARS)),
      })),
    );
  }
  return { scanned: indexable.length, indexed: missing.length };
}

function memoryCandidate(entry: MemoryEntry): RetrievalCandidate {
  return {
    id: entry.id,
    text: entry.content.slice(0, MAX_SNIPPET_CHARS),
    source: `memory:${entry.id}`,
    layer: "personal",
    plane: entry.plane,
    score: entry.confidence,
    ...(entry.trustOrigin ? { trustOrigin: entry.trustOrigin } : {}),
  };
}

export interface FusedChatMemory {
  snippets: RetrievedMemorySnippet[];
  /** Taint labels for every candidate that reached the snippets — joined
   * into the model request exactly like the pre-fusion memory slice. */
  taints: TaintLabel[];
}

/**
 * Chat-time retrieval: structured recency + vector similarity + graph
 * traversal, RRF-fused, projected as run-context memory snippets.
 * Local-Plane surfaces only (callers gate on plane before invoking).
 */
export async function fusedChatMemory(deps: {
  memoryStore: MemoryStore;
  vectorIndex: VectorIndex;
  graphStore: Pick<DrizzleGraphStore, "listPeople" | "listTimeline">;
  organizationId: string;
  ownerUserId: string;
  query: string;
  limit?: number;
}): Promise<FusedChatMemory> {
  const scope = { organizationId: deps.organizationId, userId: deps.ownerUserId };
  const limit = deps.limit ?? 5;
  const taintByCandidateId = new Map<string, TaintLabel>();

  // Lane 1 — structured recency: the newest current prose rows (the
  // pre-fusion behavior, now one lane of three).
  const recentRows = (await deps.memoryStore.retrieve({ limit: LANE_LIMIT }, scope))
    .filter(isIndexableProseRow);
  const structured: RetrievalLaneResult = {
    lane: "structured",
    candidates: recentRows.map(memoryCandidate),
  };
  for (const row of recentRows) {
    taintByCandidateId.set(
      row.id,
      row.taintLabel ?? labelFromLegacyTrustOrigin(row.trustOrigin, `memory:${row.id}`),
    );
  }

  // Lane 2 — vector similarity: ids from the index, HYDRATED through the
  // authority-scoped store read (refs only in the index — unreadable or
  // machinery rows drop out here).
  const vectorHits = await deps.vectorIndex.search({
    entityType: MEMORY_VECTOR_ENTITY_TYPE,
    embeddingModel: HASHING_EMBEDDER_ID,
    embedding: hashingEmbed(deps.query),
    limit: LANE_LIMIT,
  });
  const vectorCandidates: RetrievalCandidate[] = [];
  for (const hit of vectorHits) {
    const row = await deps.memoryStore.get(hit.entityId, scope);
    if (!row || !isIndexableProseRow(row)) continue;
    vectorCandidates.push({ ...memoryCandidate(row), score: Math.max(0, Math.min(1, hit.score)) });
    taintByCandidateId.set(
      row.id,
      row.taintLabel ?? labelFromLegacyTrustOrigin(row.trustOrigin, `memory:${row.id}`),
    );
  }
  const vector: RetrievalLaneResult = { lane: "vector", candidates: vectorCandidates };

  // Lane 3 — graph traversal: capitalized query tokens → Person node match
  // (visibility enforced inside the graph store) → one hop to that node's
  // timeline. Degrades to empty on any store error — retrieval lanes are
  // best-effort, the chat turn never fails because a lane did.
  const graphCandidates: RetrievalCandidate[] = [];
  try {
    const nameTokens = [...new Set(deps.query.match(/\b[A-Z][a-z]{2,}\b/g) ?? [])].slice(0, 3);
    const people = [];
    for (const token of nameTokens) {
      const page = await deps.graphStore.listPeople(deps.organizationId, deps.ownerUserId, {
        query: token,
        limit: 2,
        offset: 0,
      });
      people.push(...page.items);
    }
    for (const person of people.slice(0, 3)) {
      const label = person.displayName ?? "Unnamed person";
      const detail = [person.currentTitle, person.location].filter(Boolean).join(", ");
      graphCandidates.push({
        id: `person:${person.id}`,
        text: `Known person: ${label}${detail ? ` (${detail})` : ""}`,
        source: `person:${person.id}`,
        layer: "workspace",
        // plane deliberately ABSENT: graph residency varies by mode, and the
        // core gate fails closed (treats unlabeled as local) — conservative.
      });
      const timeline = await deps.graphStore.listTimeline(
        deps.organizationId,
        deps.ownerUserId,
        "person",
        person.id,
        { limit: 2 },
      );
      for (const item of timeline.items) {
        if (!item.summary) continue;
        graphCandidates.push({
          id: `timeline:${item.id}`,
          text: `${label}: ${item.summary.slice(0, MAX_SNIPPET_CHARS)}`,
          source: `timeline:${item.id}`,
          layer: "workspace",
        });
      }
    }
  } catch {
    graphCandidates.length = 0;
  }
  const graph: RetrievalLaneResult = { lane: "graph", candidates: graphCandidates };

  const fused = fuseRetrieval({
    lanes: [structured, vector, graph],
    requesterPlane: "local",
    limit,
  });
  const taints = fused.candidates.map(
    (candidate) =>
      taintByCandidateId.get(candidate.id) ??
      labelFromLegacyTrustOrigin("user_content", candidate.source),
  );
  return { snippets: fusedToMemorySnippets(fused.candidates), taints };
}
