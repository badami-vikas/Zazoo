/**
 * DrizzleVectorIndex — binds the core `VectorIndex` port (@bridge/core's
 * learning/retrieval.ts, LA5) to the central `embeddings` table (schema.ts
 * LAYER 3b). Stores REFS + vectors only, never content: hydration always goes
 * back through an authority-scoped store read, and the whole index is
 * rebuildable (`clear` + re-upsert) from source rows — the graph/MemoryStore
 * stays the single source of truth (learning-agent canon: "vectors index it,
 * never replace").
 *
 * The table's column is a fixed `vector(768)` (v1 dim, nomic-embed-text).
 * Embedders with a different native dimension (e.g. the deterministic
 * hashing lexical embedder at 128) are zero-padded up / truncated down to
 * 768 — cosine over zero-padded vectors equals cosine over the originals, so
 * ranking is unchanged. Vectors from different `embeddingModel` ids are
 * NEVER compared: every query filters on the model id.
 */
import { and, eq, inArray, sql } from "drizzle-orm";
import type { VectorEntry, VectorHit, VectorIndex, VectorQuery } from "@bridge/core";
import { embeddings } from "./schema.js";
import type { Database } from "./client.js";

/** The embeddings table's fixed dimension (schema.ts / migration 0004 hnsw index). */
export const EMBEDDING_TABLE_DIM = 768;

function toTableDim(embedding: number[]): number[] {
  if (embedding.length === EMBEDDING_TABLE_DIM) return embedding;
  if (embedding.length > EMBEDDING_TABLE_DIM) return embedding.slice(0, EMBEDDING_TABLE_DIM);
  return [...embedding, ...new Array<number>(EMBEDDING_TABLE_DIM - embedding.length).fill(0)];
}

function toVectorLiteral(embedding: number[]): string {
  return `[${toTableDim(embedding).join(",")}]`;
}

export class DrizzleVectorIndex implements VectorIndex {
  readonly #db: Database;

  constructor(db: Database) {
    this.#db = db;
  }

  async upsert(entries: VectorEntry[]): Promise<void> {
    for (const entry of entries) {
      await this.#db
        .insert(embeddings)
        .values({
          entityType: entry.entityType,
          entityId: entry.entityId,
          embeddingModel: entry.embeddingModel,
          embedding: toTableDim(entry.embedding),
        })
        .onConflictDoUpdate({
          target: [embeddings.entityType, embeddings.entityId, embeddings.embeddingModel],
          set: { embedding: toTableDim(entry.embedding) },
        });
    }
  }

  async search(query: VectorQuery): Promise<VectorHit[]> {
    const literal = toVectorLiteral(query.embedding);
    const rows = await this.#db
      .select({
        entityId: embeddings.entityId,
        score: sql<number>`1 - (${embeddings.embedding} <=> ${literal}::vector)`,
      })
      .from(embeddings)
      .where(
        and(
          eq(embeddings.entityType, query.entityType),
          eq(embeddings.embeddingModel, query.embeddingModel),
        ),
      )
      .orderBy(sql`${embeddings.embedding} <=> ${literal}::vector asc`, embeddings.entityId)
      .limit(Math.max(1, query.limit));
    return rows.map((row) => ({ entityId: row.entityId, score: Number(row.score) }));
  }

  async existingIds(entityType: string, embeddingModel: string, entityIds: string[]): Promise<Set<string>> {
    if (entityIds.length === 0) return new Set();
    const rows = await this.#db
      .select({ entityId: embeddings.entityId })
      .from(embeddings)
      .where(
        and(
          eq(embeddings.entityType, entityType),
          eq(embeddings.embeddingModel, embeddingModel),
          inArray(embeddings.entityId, entityIds),
        ),
      );
    return new Set(rows.map((row) => row.entityId));
  }

  async clear(entityType: string, embeddingModel: string): Promise<void> {
    await this.#db
      .delete(embeddings)
      .where(
        and(
          eq(embeddings.entityType, entityType),
          eq(embeddings.embeddingModel, embeddingModel),
        ),
      );
  }

  async listModels(entityType: string): Promise<string[]> {
    const rows = await this.#db
      .selectDistinct({ embeddingModel: embeddings.embeddingModel })
      .from(embeddings)
      .where(eq(embeddings.entityType, entityType))
      .orderBy(embeddings.embeddingModel);
    return rows.map((row) => row.embeddingModel);
  }
}
