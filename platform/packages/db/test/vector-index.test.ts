/**
 * DrizzleVectorIndex (LA5) against a real pglite-backed Postgres with the
 * pgvector extension + hnsw index from migration 0004. Proves:
 *  - upsert is idempotent on (entity_type, entity_id, embedding_model);
 *  - cosine search ranks by similarity and never crosses embedding-model
 *    spaces (different models = different spaces, hard rule);
 *  - sub-768-dim embedders are zero-padded without changing ranking;
 *  - the index is rebuildable: clear() empties exactly one (type, model)
 *    space (graph/MemoryStore stays source of truth).
 */
import assert from "node:assert/strict";
import test from "node:test";
import { HASHING_EMBEDDER_ID, hashingEmbed } from "@bridge/core";
import { createLocalDb, DrizzleVectorIndex } from "../src/index.js";

const ID_A = "aaaaaaaa-0000-4000-8000-000000000001";
const ID_B = "bbbbbbbb-0000-4000-8000-000000000002";
const ID_C = "cccccccc-0000-4000-8000-000000000003";

test("DrizzleVectorIndex: upsert, cosine search, model isolation, rebuild", async () => {
  const { db, close } = await createLocalDb();
  try {
    const index = new DrizzleVectorIndex(db);

    await index.upsert([
      { entityType: "memory", entityId: ID_A, embeddingModel: HASHING_EMBEDDER_ID, embedding: hashingEmbed("hvac service business in texas") },
      { entityType: "memory", entityId: ID_B, embeddingModel: HASHING_EMBEDDER_ID, embedding: hashingEmbed("b2b saas subscription revenue company") },
      { entityType: "memory", entityId: ID_C, embeddingModel: "other-space", embedding: hashingEmbed("hvac hvac hvac texas") },
    ]);

    // Cosine ranking: the hvac row wins for an hvac query; the other-space
    // row never appears despite maximal token overlap.
    const hits = await index.search({
      entityType: "memory",
      embeddingModel: HASHING_EMBEDDER_ID,
      embedding: hashingEmbed("looking at an hvac business in texas"),
      limit: 5,
    });
    assert.equal(hits[0]!.entityId, ID_A);
    assert.ok(hits[0]!.score > hits[1]!.score);
    assert.ok(!hits.some((hit) => hit.entityId === ID_C));

    // Idempotent upsert: replacing A's vector re-points it, adds no row.
    await index.upsert([
      { entityType: "memory", entityId: ID_A, embeddingModel: HASHING_EMBEDDER_ID, embedding: hashingEmbed("quarterly tax filing paperwork deadline") },
    ]);
    const after = await index.search({
      entityType: "memory",
      embeddingModel: HASHING_EMBEDDER_ID,
      embedding: hashingEmbed("tax filing deadline"),
      limit: 5,
    });
    assert.equal(after.length, 2);
    // A now matches its NEW text strongly — only possible if the row was
    // updated in place rather than duplicated or left stale.
    assert.equal(after[0]!.entityId, ID_A);
    assert.ok(after[0]!.score > 0.5);

    // existingIds answers the indexer's missing-scan.
    assert.deepEqual(
      await index.existingIds("memory", HASHING_EMBEDDER_ID, [ID_A, ID_B, ID_C]),
      new Set([ID_A, ID_B]),
    );
    assert.deepEqual(await index.existingIds("memory", HASHING_EMBEDDER_ID, []), new Set());

    // listModels enumerates spaces per entity type (reclamation scan).
    assert.deepEqual(await index.listModels("memory"), [HASHING_EMBEDDER_ID, "other-space"].sort());

    // Rebuild seam: clear drops one (type, model) space only.
    await index.clear("memory", HASHING_EMBEDDER_ID);
    assert.deepEqual(await index.existingIds("memory", HASHING_EMBEDDER_ID, [ID_A, ID_B]), new Set());
    assert.deepEqual(await index.existingIds("memory", "other-space", [ID_C]), new Set([ID_C]));
    assert.deepEqual(await index.listModels("memory"), ["other-space"]);
  } finally {
    await close();
  }
});
