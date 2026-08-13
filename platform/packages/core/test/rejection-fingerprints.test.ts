/**
 * K10 E5 (TASK-043) — paraphrase-robust rejection fingerprints: a rejected
 * idea stays rejected when it comes back reworded; backoff escalates to
 * permanent only through REPEATED rejection; expired windows honestly stop
 * suppressing; fingerprints are deletable Memory (deleting un-suppresses).
 *
 * The corpus test runs over a deterministic embedder double whose vectors
 * place paraphrase pairs close and unrelated texts far — it proves the
 * MECHANISM (threshold, backoff, permanence, expiry), while the semantic
 * quality of a real embedder is the LA5 lane's own concern. The lexical
 * hashing embedder is additionally exercised on reword-by-reordering.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { InMemoryMemoryStore } from "../src/memory/memory-store.js";
import { hashingTextEmbedder } from "../src/learning/retrieval.js";
import {
  REJECTION_BACKOFF_DAYS,
  isSuppressedByRejections,
  listRejectionFingerprints,
  recordRejectionFingerprint,
} from "../src/learning/rejection-fingerprints.js";
import { cosineSimilarity } from "../src/learning/retrieval.js";
import type { TextEmbedder } from "../src/learning/retrieval.js";

const ORG = "org-e5";
const USER = "user-e5";
const SCOPE = { organizationId: ORG, userId: USER };
let n = 0;
const nextId = () => `fp-${++n}`;
const T0 = "2026-08-13T12:00:00.000Z";
const daysAfter = (days: number) =>
  new Date(new Date(T0).getTime() + days * 24 * 60 * 60 * 1000).toISOString();

/** Paraphrase corpus: each group's members must suppress each other; texts
 * from different groups must not. The double maps group members to nearby
 * unit vectors and strangers to orthogonal ones. */
const PARAPHRASE_CORPUS: string[][] = [
  [
    "contact preference: prefers not to be emailed",
    "contact preference: dislikes email, use chat instead",
    "communication: email is unwelcome",
  ],
  [
    "meeting rhythm: no meetings before 10am",
    "scheduling: keep mornings free of meetings",
  ],
  [
    "diet: vegetarian",
  ],
];

function corpusEmbedder(): TextEmbedder {
  const groupOf = new Map<string, number>();
  PARAPHRASE_CORPUS.forEach((group, index) => group.forEach((text) => groupOf.set(text, index)));
  return {
    id: "corpus-double",
    embed: async (texts) =>
      texts.map((text) => {
        const group = groupOf.get(text);
        const vector = new Array<number>(PARAPHRASE_CORPUS.length + 1).fill(0);
        if (group === undefined) {
          vector[PARAPHRASE_CORPUS.length] = 1; // stranger axis
        } else {
          vector[group] = 1;
          // Members of a group differ slightly so similarity is high, not 1.
          vector[PARAPHRASE_CORPUS.length] = 0.2 + 0.01 * (groupOf.get(text)! + text.length % 3);
        }
        return vector;
      }),
  };
}

test("E5 corpus: every paraphrase pair suppresses, no cross-group text does", async () => {
  const embedder = corpusEmbedder();
  for (const group of PARAPHRASE_CORPUS) {
    for (const rejected of group) {
      const store = new InMemoryMemoryStore();
      await recordRejectionFingerprint(store, embedder, {
        organizationId: ORG, ownerUserId: USER, text: rejected, nowISO: T0, nextId,
      });
      for (const candidate of group) {
        const verdict = await isSuppressedByRejections(store, embedder, candidate, SCOPE, daysAfter(1));
        assert.equal(verdict.suppressed, true, `"${candidate}" must match rejected "${rejected}"`);
      }
      for (const otherGroup of PARAPHRASE_CORPUS) {
        if (otherGroup === group) continue;
        for (const stranger of otherGroup) {
          const verdict = await isSuppressedByRejections(store, embedder, stranger, SCOPE, daysAfter(1));
          assert.equal(verdict.suppressed, false, `"${stranger}" must NOT match rejected "${rejected}"`);
        }
      }
    }
  }
});

test("E5 backoff-to-permanent: 30d, then 90d, then forever — and expiry honestly un-suppresses", async () => {
  const embedder = corpusEmbedder();
  const store = new InMemoryMemoryStore();
  const text = PARAPHRASE_CORPUS[0]![0]!;

  // Strike 1: suppressed inside 30 days, free after.
  await recordRejectionFingerprint(store, embedder, {
    organizationId: ORG, ownerUserId: USER, text, nowISO: T0, nextId,
  });
  assert.equal(REJECTION_BACKOFF_DAYS[0], 30);
  assert.equal((await isSuppressedByRejections(store, embedder, text, SCOPE, daysAfter(29))).suppressed, true);
  assert.equal((await isSuppressedByRejections(store, embedder, text, SCOPE, daysAfter(31))).suppressed, false);

  // Strike 2 (same idea rejected again): 90 days, ONE lineage struck, not a duplicate.
  await recordRejectionFingerprint(store, embedder, {
    organizationId: ORG, ownerUserId: USER, text: PARAPHRASE_CORPUS[0]![1]!, nowISO: T0, nextId,
  });
  const afterSecond = await listRejectionFingerprints(store, SCOPE);
  assert.equal(afterSecond.length, 1, "a similar re-rejection strikes the lineage, never duplicates it");
  assert.equal(afterSecond[0]!.strikes, 2);
  assert.equal((await isSuppressedByRejections(store, embedder, text, SCOPE, daysAfter(89))).suppressed, true);
  assert.equal((await isSuppressedByRejections(store, embedder, text, SCOPE, daysAfter(91))).suppressed, false);

  // Strike 3: permanent — a decade later it still suppresses, flagged so.
  await recordRejectionFingerprint(store, embedder, {
    organizationId: ORG, ownerUserId: USER, text, nowISO: T0, nextId,
  });
  const decadeLater = await isSuppressedByRejections(store, embedder, text, SCOPE, daysAfter(3650));
  assert.equal(decadeLater.suppressed, true);
  assert.equal(decadeLater.permanent, true);
  assert.equal((await listRejectionFingerprints(store, SCOPE))[0]!.strikes, 3);
});

test("E5 lexical tier: the always-available hashing embedder catches reworded token overlap", async () => {
  const embedder = hashingTextEmbedder();
  const store = new InMemoryMemoryStore();
  await recordRejectionFingerprint(store, embedder, {
    organizationId: ORG, ownerUserId: USER,
    text: "contact preference: never email Priya about invoices",
    nowISO: T0, nextId,
  });
  // Reordered wording, same tokens — the lexical tier must still catch it.
  const reworded = await isSuppressedByRejections(
    store, embedder, "contact preference: about invoices, never email Priya", SCOPE, daysAfter(1),
  );
  assert.equal(reworded.suppressed, true);
  // Genuinely different content stays proposable.
  const unrelated = await isSuppressedByRejections(
    store, embedder, "timezone: CET", SCOPE, daysAfter(1),
  );
  assert.equal(unrelated.suppressed, false);
});

test("E5 deletability: removing the fingerprint Memory IS the un-suppress affordance", async () => {
  const embedder = corpusEmbedder();
  const store = new InMemoryMemoryStore();
  const text = PARAPHRASE_CORPUS[1]![0]!;
  const fingerprint = await recordRejectionFingerprint(store, embedder, {
    organizationId: ORG, ownerUserId: USER, text, nowISO: T0, nextId,
  });
  assert.equal((await isSuppressedByRejections(store, embedder, text, SCOPE, daysAfter(1))).suppressed, true);
  await store.forget(fingerprint.memoryId, SCOPE);
  assert.equal((await isSuppressedByRejections(store, embedder, text, SCOPE, daysAfter(1))).suppressed, false);
});

test("E5 sanity: cosine bounds", () => {
  assert.equal(cosineSimilarity([1, 0], [1, 0]), 1);
  assert.equal(cosineSimilarity([1, 0], [0, 1]), 0);
  assert.equal(cosineSimilarity([], []), 0);
});
