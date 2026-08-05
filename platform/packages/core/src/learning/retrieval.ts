/**
 * Retrieval fusion v1 (LA5 slice, learning-agent-roadmap-2026-07 §LA5:
 * "graph traversal + semantic vector + structured filtering, fused; graph
 * stays source of truth").
 *
 * Pure, Module-agnostic machinery in the same light-egg spirit as
 * `observation.ts`: this file knows nothing about deals, people, or chat.
 * Callers run each retrieval LANE themselves (a MemoryStore query, a
 * `VectorIndex` search, a graph-store traversal), hand the ranked candidates
 * here, and get one fused ranking back — Reciprocal Rank Fusion (RRF), a
 * deterministic rank-based combiner: no model call, no weights to train,
 * same input → byte-identical output (replayable, like every other pure
 * kernel function).
 *
 * Invariants carried from the Learning Agent canon (docs/wiki/learning-agent.md):
 *  - graph stays source of truth: a `VectorIndex` stores REFS (entity ids)
 *    plus vectors only, never content — hydration always goes back through
 *    an authority-scoped store read, and the whole index is rebuildable from
 *    source rows at any time;
 *  - cross-plane leak = hard invariant: fusion FAILS CLOSED — a cloud-plane
 *    request drops every candidate not explicitly marked `plane: "cloud"`
 *    (missing/unknown plane counts as local);
 *  - retrieval evals baselined: `evaluateRetrieval` computes precision/recall/
 *    MRR over held-out query→evidence cases; the test suite pins baselines so
 *    regressions block ship from here on.
 */
import type { RetrievedMemorySnippet } from "../run-context.js";
import type { Plane, TrustOrigin } from "../types.js";

/** roadmap-v2 §RAG knowledge layers: personal (private to the user),
 * organization (shared across the Organization), external (governed research —
 * always quarantined `untrusted_external`). */
export type KnowledgeLayer = "personal" | "organization" | "external";

export type RetrievalLaneName = "structured" | "vector" | "graph";

/** One ranked candidate a lane produced. `id` identifies the underlying
 * entity (e.g. a Memory row id, a graph node id) — fusion dedupes on it. */
export interface RetrievalCandidate {
  id: string;
  /** Prompt-ready text (already hydrated by the caller through an
   * authority-scoped read — never raw machinery JSON). */
  text: string;
  /** Provenance label surfaced in prompt projections (e.g. `memory:<id>`). */
  source: string;
  layer: KnowledgeLayer;
  /** Residency of the underlying row. Fusion treats a MISSING plane as
   * local (fail closed) — callers should always set it explicitly. */
  plane?: Plane;
  /** Lane-native relevance in [0, 1] when the lane reports one. RRF ranks on
   * POSITION, not this value — it is carried through for display only. */
  score?: number;
  trustOrigin?: TrustOrigin;
}

/** One lane's ranked output, best candidate first. */
export interface RetrievalLaneResult {
  lane: RetrievalLaneName;
  candidates: RetrievalCandidate[];
}

export interface FusedCandidate extends RetrievalCandidate {
  /** Sum of RRF contributions across lanes — comparable only within one
   * fusion run; normalize before display. */
  fusedScore: number;
  /** Which lanes surfaced this candidate (agreement across lanes is the
   * signal RRF rewards). */
  lanes: RetrievalLaneName[];
}

export interface FuseRetrievalInput {
  lanes: RetrievalLaneResult[];
  /** Residency of the surface ASKING — the cross-plane gate. A "cloud"
   * requester only ever sees candidates explicitly marked `plane: "cloud"`. */
  requesterPlane: Plane;
  /** Max fused candidates returned. Default 8. */
  limit?: number;
  /** RRF smoothing constant. 60 is the literature-standard default
   * (Cormack et al.) — higher flattens rank differences. */
  rrfK?: number;
}

export interface FusionResult {
  candidates: FusedCandidate[];
  /** Count of candidates dropped by the cross-plane gate — surfaced so a
   * caller/test can prove the gate fired rather than silently passing. */
  suppressedCrossPlane: number;
}

/**
 * Reciprocal Rank Fusion: fused(d) = Σ over lanes 1/(k + rank_lane(d)),
 * rank starting at 1. Deterministic; ties break by candidate id so the
 * output is stable across runs and platforms.
 */
export function fuseRetrieval(input: FuseRetrievalInput): FusionResult {
  const limit = input.limit ?? 8;
  const k = input.rrfK ?? 60;
  const byId = new Map<string, FusedCandidate>();
  let suppressedCrossPlane = 0;

  for (const lane of input.lanes) {
    lane.candidates.forEach((candidate, index) => {
      // Cross-plane hard invariant: cloud requesters never see anything not
      // explicitly cloud-resident. Missing plane fails closed as local.
      if (input.requesterPlane === "cloud" && candidate.plane !== "cloud") {
        suppressedCrossPlane += 1;
        return;
      }
      const contribution = 1 / (k + index + 1);
      const existing = byId.get(candidate.id);
      if (existing) {
        existing.fusedScore += contribution;
        if (!existing.lanes.includes(lane.lane)) existing.lanes.push(lane.lane);
      } else {
        byId.set(candidate.id, { ...candidate, fusedScore: contribution, lanes: [lane.lane] });
      }
    });
  }

  const candidates = [...byId.values()]
    .sort((a, b) => (b.fusedScore - a.fusedScore) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
    .slice(0, limit);
  return { candidates, suppressedCrossPlane };
}

/** Project fused candidates into the run-context memory slot. Scores are
 * normalized to the top candidate so they land in (0, 1] as
 * `RetrievedMemorySnippet.score` expects. */
export function fusedToMemorySnippets(candidates: FusedCandidate[]): RetrievedMemorySnippet[] {
  const top = candidates[0]?.fusedScore ?? 0;
  return candidates.map((candidate) => ({
    source: candidate.source,
    text: candidate.text,
    ...(top > 0 ? { score: Math.min(1, candidate.fusedScore / top) } : {}),
    ...(candidate.trustOrigin ? { trustOrigin: candidate.trustOrigin } : {}),
  }));
}

// ---------------------------------------------------------------------------
// Vector lane port — TYPES + in-memory adapter only (zero-dep rule). The
// persistent adapter over the pgvector `embeddings` table lives in @bridge/db.
// ---------------------------------------------------------------------------

export interface VectorEntry {
  /** What kind of entity the vector indexes (e.g. "memory"). */
  entityType: string;
  entityId: string;
  /** Which embedding space the vector lives in. Vectors from different
   * models are NEVER compared — search filters on this. */
  embeddingModel: string;
  embedding: number[];
}

export interface VectorQuery {
  entityType: string;
  embeddingModel: string;
  embedding: number[];
  limit: number;
}

export interface VectorHit {
  entityId: string;
  /** Cosine similarity in [-1, 1] (higher = closer). */
  score: number;
}

/** A text-embedding seam for the vector lane. `id` names the embedding
 * SPACE (model identity) — it becomes the `embeddingModel` on every vector
 * written or searched with this embedder, so switching embedders switches
 * spaces and never compares incompatible vectors. Implementations: the
 * deterministic lexical `hashingEmbed` fallback (id `HASHING_EMBEDDER_ID`),
 * or a real model behind `ModelProvider.embed` (e.g. Ollama nomic-embed). */
export interface TextEmbedder {
  id: string;
  embed(texts: string[]): Promise<number[][]>;
}

/** The always-available lexical fallback as a `TextEmbedder`. */
export function hashingTextEmbedder(dim = 128): TextEmbedder {
  return {
    id: HASHING_EMBEDDER_ID,
    embed: async (texts) => texts.map((text) => hashingEmbed(text, dim)),
  };
}

/** The vector lane's storage seam. Deliberately stores REFS + vectors only —
 * no content, no text — so the graph/MemoryStore stays the single source of
 * truth and the index is rebuildable (`clear` + re-upsert) at any time. */
export interface VectorIndex {
  upsert(entries: VectorEntry[]): Promise<void>;
  search(query: VectorQuery): Promise<VectorHit[]>;
  /** Which of `entityIds` are already indexed for (entityType, model) —
   * the indexer's "what's missing" scan. */
  existingIds(entityType: string, embeddingModel: string, entityIds: string[]): Promise<Set<string>>;
  /** Drop every vector for (entityType, model) — the rebuild seam. */
  clear(entityType: string, embeddingModel: string): Promise<void>;
  /** Every embedding-model id with vectors stored for `entityType` — the
   * stale-space reclamation scan (spaces other than the active embedder's
   * are orphaned derived data, safe to clear and rebuild). */
  listModels(entityType: string): Promise<string[]>;
}

/** Cosine similarity; a shorter vector is zero-padded, so mixed lengths are
 * well-defined (and deterministic) rather than an error. */
export function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0;
  let normA = 0;
  let normB = 0;
  const length = Math.max(a.length, b.length);
  for (let i = 0; i < length; i += 1) {
    const x = a[i] ?? 0;
    const y = b[i] ?? 0;
    dot += x * y;
    normA += x * x;
    normB += y * y;
  }
  if (normA === 0 || normB === 0) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

export class InMemoryVectorIndex implements VectorIndex {
  readonly rows = new Map<string, VectorEntry>();

  #key(entityType: string, embeddingModel: string, entityId: string): string {
    return `${entityType}:${embeddingModel}:${entityId}`;
  }

  async upsert(entries: VectorEntry[]): Promise<void> {
    for (const entry of entries) {
      this.rows.set(this.#key(entry.entityType, entry.embeddingModel, entry.entityId), {
        ...entry,
        embedding: [...entry.embedding],
      });
    }
  }

  async search(query: VectorQuery): Promise<VectorHit[]> {
    const hits: VectorHit[] = [];
    for (const entry of this.rows.values()) {
      if (entry.entityType !== query.entityType || entry.embeddingModel !== query.embeddingModel) continue;
      hits.push({ entityId: entry.entityId, score: cosineSimilarity(query.embedding, entry.embedding) });
    }
    return hits
      .sort((a, b) => (b.score - a.score) || (a.entityId < b.entityId ? -1 : 1))
      .slice(0, query.limit);
  }

  async existingIds(entityType: string, embeddingModel: string, entityIds: string[]): Promise<Set<string>> {
    const found = new Set<string>();
    for (const id of entityIds) {
      if (this.rows.has(this.#key(entityType, embeddingModel, id))) found.add(id);
    }
    return found;
  }

  async clear(entityType: string, embeddingModel: string): Promise<void> {
    for (const key of [...this.rows.keys()]) {
      if (key.startsWith(`${entityType}:${embeddingModel}:`)) this.rows.delete(key);
    }
  }

  async listModels(entityType: string): Promise<string[]> {
    const models = new Set<string>();
    for (const entry of this.rows.values()) {
      if (entry.entityType === entityType) models.add(entry.embeddingModel);
    }
    return [...models].sort();
  }
}

// ---------------------------------------------------------------------------
// Deterministic lexical embedder — hashing bag-of-words. HONEST about what it
// is: lexical-overlap similarity, NOT semantic embedding. It exists so the
// eval harness and tests measure real (if simple) retrieval quality without a
// network or model, and so a deployment without an embed-capable local
// provider can still run the vector lane on token overlap. A real embedding
// model swaps in behind the same `VectorIndex` port under its own
// embeddingModel id (different spaces never mix).
// ---------------------------------------------------------------------------

export const HASHING_EMBEDDER_ID = "bridge-hashing-lexical-v1";

function fnv1a(token: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < token.length; i += 1) {
    hash ^= token.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash;
}

/** Embed text as an L2-normalized hashed bag-of-words vector. Tokens are
 * lowercased and naively singularized (trailing "s" stripped from tokens of
 * 4+ chars) so trivial plural/inflection mismatches ("prefers"/"prefer",
 * "deals"/"deal") land in the same bucket. */
export function hashingEmbed(text: string, dim = 128): number[] {
  const vector = new Array<number>(dim).fill(0);
  const tokens = text.toLowerCase().match(/[a-z0-9]{2,}/g) ?? [];
  for (const raw of tokens) {
    const token = raw.length >= 4 && raw.endsWith("s") ? raw.slice(0, -1) : raw;
    const bucket = fnv1a(token) % dim;
    vector[bucket] = (vector[bucket] ?? 0) + 1;
  }
  const norm = Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0));
  return norm === 0 ? vector : vector.map((value) => value / norm);
}

// ---------------------------------------------------------------------------
// Eval harness — LA5 exit criterion: "precision/recall measured and
// baselined; regressions block ship from here on". Pure math over
// query→evidence cases; the test suite owns the fixture set and pins the
// baseline thresholds.
// ---------------------------------------------------------------------------

export interface RetrievalEvalCase {
  id: string;
  query: string;
  /** Entity ids a correct retrieval must surface. */
  relevantIds: string[];
}

export interface RetrievalEvalCaseResult {
  caseId: string;
  precisionAtK: number;
  recallAtK: number;
  /** 1/rank of the first relevant hit, 0 when none retrieved. */
  reciprocalRank: number;
}

export interface RetrievalEvalReport {
  k: number;
  cases: RetrievalEvalCaseResult[];
  /** Macro-averages across cases. */
  precisionAtK: number;
  recallAtK: number;
  mrr: number;
}

/** Run every eval case through `retrieve` (the caller's full lane+fusion
 * pipeline returning ranked entity ids) and score it. Deterministic given a
 * deterministic `retrieve`. */
export async function evaluateRetrieval(
  cases: RetrievalEvalCase[],
  retrieve: (query: string, k: number) => Promise<string[]>,
  k = 5,
): Promise<RetrievalEvalReport> {
  const results: RetrievalEvalCaseResult[] = [];
  for (const evalCase of cases) {
    const retrieved = (await retrieve(evalCase.query, k)).slice(0, k);
    const relevant = new Set(evalCase.relevantIds);
    const hits = retrieved.filter((id) => relevant.has(id));
    const firstHitRank = retrieved.findIndex((id) => relevant.has(id));
    results.push({
      caseId: evalCase.id,
      precisionAtK: retrieved.length === 0 ? 0 : hits.length / retrieved.length,
      recallAtK: relevant.size === 0 ? 0 : hits.length / relevant.size,
      reciprocalRank: firstHitRank === -1 ? 0 : 1 / (firstHitRank + 1),
    });
  }
  const average = (values: number[]) =>
    values.length === 0 ? 0 : values.reduce((sum, value) => sum + value, 0) / values.length;
  return {
    k,
    cases: results,
    precisionAtK: average(results.map((r) => r.precisionAtK)),
    recallAtK: average(results.map((r) => r.recallAtK)),
    mrr: average(results.map((r) => r.reciprocalRank)),
  };
}
