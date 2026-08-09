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
 * Both entry points resolve the active embedder through
 * `withReachableEmbedder`, so a configured-but-unreachable embedding model
 * degrades the whole deployment to the lexical space rather than leaving the
 * vector lane dead — and degrades it on BOTH sides, which is what keeps the
 * indexer and the query in one space.
 *
 * Authority + planes: vector hits are ids only — hydration goes through the
 * authority-scoped `memoryStore.get`, so a row the caller may not read never
 * surfaces. Graph lanes go through the graph store's own RLS/visibility
 * predicates. Fusion runs with the requester's plane and fails closed
 * cross-plane (core invariant); this module is only ever invoked from the
 * Local-Plane chat path.
 */
import {
  fuseRetrieval,
  fusedToMemorySnippets,
  HASHING_EMBEDDER_ID,
  hashingTextEmbedder,
  isLearningObservationEntry,
  labelFromLegacyTrustOrigin,
  type MemoryEntry,
  type MemoryStore,
  type RetrievalCandidate,
  type RetrievalLaneResult,
  type RetrievedMemorySnippet,
  type TaintLabel,
  type TextEmbedder,
  type VectorIndex,
} from "@bridge/core";
import type { DrizzleGraphStore, DrizzleClaimStore } from "@bridge/db";

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

/**
 * Run `use` with the configured embedder; if that embedder cannot answer, run
 * it again with the deterministic lexical one and report the pass DEGRADED.
 *
 * Reachability is a RUNTIME fact, not a boot fact. A configured embedder is
 * an adapter object holding a base URL — constructing one proves nothing about
 * a daemon listening on the other end, and the daemon can appear or vanish
 * long after boot. Deciding once at startup would freeze exactly the value
 * that has to survive the daemon's whole lifetime (the frozen-value defect
 * class of ADR-205/209/211), so the question is asked at each point of use,
 * answered by the attempt itself — no separate probe, no extra round trip.
 *
 * The WHOLE embedder swaps, id included: `id` names the embedding space, and a
 * vector must never be written or searched under a space id that did not
 * produce it. Falling back per-call while keeping the configured id would put
 * lexical vectors in the semantic space — the one thing this seam forbids.
 *
 * The lexical embedder failing is a different animal: it is pure in-process
 * computation with nothing to be "down", so it surfaces rather than being
 * masked by a retry of itself.
 */
async function withReachableEmbedder<T>(
  preferred: TextEmbedder,
  use: (embedder: TextEmbedder) => Promise<T>,
): Promise<{ result: T; embedder: TextEmbedder; degraded: boolean }> {
  try {
    return { result: await use(preferred), embedder: preferred, degraded: false };
  } catch (err) {
    if (preferred.id === HASHING_EMBEDDER_ID) {
      throw new Error(
        `the lexical embedder (${HASHING_EMBEDDER_ID}) failed: pure computation cannot be down, so this is a defect rather than an outage`,
        { cause: err },
      );
    }
    const fallback = hashingTextEmbedder();
    return { result: await use(fallback), embedder: fallback, degraded: true };
  }
}

/** Embed and store every not-yet-indexed row in ONE embedding space. */
async function indexIntoSpace(
  vectorIndex: VectorIndex,
  embedder: TextEmbedder,
  indexable: MemoryEntry[],
): Promise<number> {
  const existing = await vectorIndex.existingIds(
    MEMORY_VECTOR_ENTITY_TYPE,
    embedder.id,
    indexable.map((row) => row.id),
  );
  const missing = indexable.filter((row) => !existing.has(row.id));
  if (missing.length === 0) return 0;
  const embeddings = await embedder.embed(missing.map((row) => row.content.slice(0, MAX_SNIPPET_CHARS)));
  if (embeddings.length !== missing.length) {
    throw new Error(`embedder ${embedder.id} returned ${embeddings.length} vectors for ${missing.length} texts`);
  }
  await vectorIndex.upsert(
    missing.map((row, index) => ({
      entityType: MEMORY_VECTOR_ENTITY_TYPE,
      entityId: row.id,
      embeddingModel: embedder.id,
      embedding: embeddings[index]!,
    })),
  );
  return missing.length;
}

/** One indexer pass: embed every current prose Memory row not yet in the
 * vector index. Idempotent — already-indexed rows are skipped; a full
 * rebuild is `vectorIndex.clear(...)` followed by one pass. The active
 * embedder names the space: a SEMANTIC embedder (wiring's
 * `semanticEmbedder`, e.g. Ollama nomic-embed) when configured AND reachable
 * this pass, else the deterministic lexical fallback. Switching embedders
 * switches spaces — the indexer backfills the new space; stale spaces are
 * reclaimed with `vectorIndex.clear(oldId)`, though never on a degraded pass.
 * `degraded` reports that the configured embedder could not answer and the
 * pass completed in the fallback space instead; callers should surface it. */
export async function indexMemoryEmbeddings(deps: {
  memoryStore: MemoryStore;
  vectorIndex: VectorIndex;
  organizationId: string;
  ownerUserId: string;
  embedder?: TextEmbedder;
}): Promise<{
  scanned: number;
  indexed: number;
  embeddingModel: string;
  reclaimedModels: string[];
  degraded: boolean;
}> {
  const preferred = deps.embedder ?? hashingTextEmbedder();
  const scope = { organizationId: deps.organizationId, userId: deps.ownerUserId };
  const rows = await deps.memoryStore.retrieve({ limit: INDEXER_SCAN_LIMIT }, scope);
  const indexable = rows.filter(isIndexableProseRow);
  const { result: indexed, embedder, degraded } = await withReachableEmbedder(
    preferred,
    (active) => indexIntoSpace(deps.vectorIndex, active, indexable),
  );
  // Stale-space reclamation (ADR-172 follow-up): vectors in any space other
  // than the ACTIVE embedder's are orphaned derived data — nothing queries
  // them (search always filters on the active id) and the source rows can
  // re-embed at any time. Clearing here keeps the index one-space-per-type
  // without a separate maintenance job. Runs AFTER the active space is
  // backfilled, so an embedder switch never has a moment with no usable
  // space.
  //
  // Skipped entirely on a DEGRADED pass: "the configured embedder did not
  // answer this minute" is not evidence that its space is superseded, and a
  // recovery would find the index it needs already deleted. An outage must
  // cost re-embedding at worst, never the good index.
  const reclaimedModels: string[] = [];
  if (!degraded) {
    for (const model of await deps.vectorIndex.listModels(MEMORY_VECTOR_ENTITY_TYPE)) {
      if (model === embedder.id) continue;
      await deps.vectorIndex.clear(MEMORY_VECTOR_ENTITY_TYPE, model);
      reclaimedModels.push(model);
    }
  }
  return { scanned: indexable.length, indexed, embeddingModel: embedder.id, reclaimedModels, degraded };
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
  /** K3 (TASK-047): accepted knowledge claims join the GRAPH lane — they ARE
   * the graph region's distilled layer, and reusing the lane keeps the closed
   * three-lane union honest. Absent (flight off / not wired) = no claims. */
  claimStore?: Pick<DrizzleClaimStore, "listEntities" | "liveClaims">;
  organizationId: string;
  ownerUserId: string;
  query: string;
  limit?: number;
  /** Must be the SAME embedder the indexer runs with — query and stored
   * vectors only meet inside one embedding space. */
  embedder?: TextEmbedder;
}): Promise<FusedChatMemory> {
  const embedder = deps.embedder ?? hashingTextEmbedder();
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
  //
  // The query falls back by the SAME rule the indexer uses, which is what
  // keeps the two sides in one space: when the configured model is
  // unreachable the indexer writes the lexical space, so the query has to
  // search the lexical space to find anything. Falling back only on one side
  // would leave a permanently empty lane. If even that fails, the lane goes
  // empty — the chat turn never fails because a lane did.
  let vectorHits: Awaited<ReturnType<VectorIndex["search"]>> = [];
  try {
    vectorHits = (
      await withReachableEmbedder(embedder, async (active) => {
        const [queryEmbedding] = await active.embed([deps.query]);
        if (!queryEmbedding) return [];
        return deps.vectorIndex.search({
          entityType: MEMORY_VECTOR_ENTITY_TYPE,
          embeddingModel: active.id,
          embedding: queryEmbedding,
          limit: LANE_LIMIT,
        });
      })
    ).result;
  } catch {
    vectorHits = [];
  }
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
        layer: "organization",
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
          layer: "organization",
        });
      }
    }
  } catch {
    graphCandidates.length = 0;
  }
  // K3: live claims as graph-lane candidates. What the user sees in the
  // Second Brain is exactly what can reach the model here — one substrate,
  // two projections. Same best-effort posture as the rest of the lane.
  if (deps.claimStore) {
    try {
      const [entities, claims] = await Promise.all([
        deps.claimStore.listEntities(deps.organizationId, deps.ownerUserId),
        deps.claimStore.liveClaims(deps.organizationId, deps.ownerUserId),
      ]);
      const entityNames = new Map(entities.map((entity) => [entity.id, entity.name]));
      for (const claim of claims.slice(0, LANE_LIMIT)) {
        const candidateId = `claim:${claim.id}`;
        graphCandidates.push({
          id: candidateId,
          text: `Accepted claim — ${entityNames.get(claim.entityId) ?? "Unknown entity"}: ${claim.field} is ${claim.value}.`,
          source: candidateId,
          layer: "personal",
          plane: "local",
          trustOrigin: "user_content",
        });
        if (claim.taintLabel) taintByCandidateId.set(candidateId, claim.taintLabel);
      }
    } catch {
      // claims lane degrades to empty — the chat turn never fails because a lane did
    }
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
