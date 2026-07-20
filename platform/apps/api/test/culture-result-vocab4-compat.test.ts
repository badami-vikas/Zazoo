import assert from "node:assert/strict";
import test from "node:test";
import { normalizeCultureSynthesisResult } from "../src/culture-result-vocab4-compat.js";

test("VOCAB4 projects immutable culture artifact hashes to Result hashes", () => {
  const legacy = {
    parentRunId: "run-1",
    artifactHashes: [{ sourceId: "source-1", contentHash: "hash-1" }],
    partition: {},
    disclosure: {},
  };
  assert.deepEqual(normalizeCultureSynthesisResult(legacy), {
    parentRunId: "run-1",
    resultHashes: [{ sourceId: "source-1", contentHash: "hash-1" }],
    partition: {},
    disclosure: {},
  });
  assert.deepEqual(legacy.artifactHashes, [
    { sourceId: "source-1", contentHash: "hash-1" },
  ]);
});

test("VOCAB4 leaves canonical culture Results unchanged", () => {
  const canonical = {
    resultHashes: [{ sourceId: "source-1", contentHash: "hash-1" }],
  };
  assert.equal(normalizeCultureSynthesisResult(canonical), canonical);
});
