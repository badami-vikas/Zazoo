/**
 * K10 E5 (TASK-043, ADR-176 mechanism 5): paraphrase-robust rejection
 * fingerprints with backoff-to-permanent.
 *
 * Exact-lineage suppression (what every suggestion lane has today) stops
 * the SAME pattern from being re-proposed — and stops nothing when the
 * content comes back reworded. This module stores a semantic fingerprint
 * of each rejected suggestion's content and suppresses NEW proposals whose
 * content lands too close to one:
 *
 *  - the embedder is a SEAM (`TextEmbedder`): with the LA5 semantic
 *    embedder (Ollama) present, "dislikes email" matches a rejected
 *    "prefers not to be emailed"; without it, the always-available lexical
 *    hashing embedder still catches reworded/reordered variants — the same
 *    graceful ladder retrieval fusion uses, and never a reason to skip the
 *    check entirely;
 *  - BACKOFF-TO-PERMANENT: the first rejection suppresses similar content
 *    for 30 days, a repeat strike for 90, a third forever. A rejection is
 *    respected immediately but only becomes permanent when the human keeps
 *    rejecting the same idea — one misclick never silences a topic for
 *    good;
 *  - fingerprints are Memory rows: inspectable and deletable like every
 *    other learned thing — deleting one IS the un-suppress affordance.
 */
import type { MemoryAuthScope, MemoryStore } from "../memory/memory-store.js";
import { cosineSimilarity, type TextEmbedder } from "./retrieval.js";

export const REJECTION_FINGERPRINT_KIND = "rejection_fingerprint";

/** Strike ladder: suppression window per strike count; past the end =
 * permanent. Tunable policy, not canon. */
export const REJECTION_BACKOFF_DAYS: readonly number[] = [30, 90];

/** Similarity at or above this suppresses. One threshold for both embedder
 * tiers: the lexical embedder only reaches it on genuinely overlapping
 * token sets, the semantic one on real paraphrases — both are "the human
 * already said no to this". */
export const REJECTION_SIMILARITY_THRESHOLD = 0.83;

export interface RejectionFingerprint {
  memoryId: string;
  text: string;
  embedderId: string;
  vector: number[];
  strikes: number;
  /** ISO until which similar content is suppressed; null = permanent. */
  suppressedUntil: string | null;
}

function parseFingerprint(memoryId: string, content: string): RejectionFingerprint | null {
  try {
    const parsed: unknown = JSON.parse(content);
    if (parsed === null || typeof parsed !== "object") return null;
    const row = parsed as Record<string, unknown>;
    const anchor = row["anchor"] as { kind?: unknown } | undefined;
    if (anchor?.kind !== REJECTION_FINGERPRINT_KIND) return null;
    if (typeof row["text"] !== "string" || !Array.isArray(row["vector"])) return null;
    return {
      memoryId,
      text: row["text"],
      embedderId: typeof row["embedderId"] === "string" ? row["embedderId"] : "unknown",
      vector: (row["vector"] as unknown[]).filter((value): value is number => typeof value === "number"),
      strikes: typeof row["strikes"] === "number" ? row["strikes"] : 1,
      suppressedUntil: typeof row["suppressedUntil"] === "string" ? row["suppressedUntil"] : null,
    };
  } catch {
    return null;
  }
}

export async function listRejectionFingerprints(
  store: MemoryStore,
  scope: MemoryAuthScope,
): Promise<RejectionFingerprint[]> {
  const rows = await store.retrieve(
    {
      type: "semantic",
      contentPathEquals: [{ path: "anchor.kind", equals: REJECTION_FINGERPRINT_KIND }],
    },
    scope,
  );
  const fingerprints: RejectionFingerprint[] = [];
  for (const row of rows) {
    const parsed = parseFingerprint(row.id, row.content);
    if (parsed) fingerprints.push(parsed);
  }
  return fingerprints;
}

function suppressedUntilFor(strikes: number, nowISO: string): string | null {
  const days = REJECTION_BACKOFF_DAYS[strikes - 1];
  if (days === undefined) return null; // past the ladder = permanent
  return new Date(new Date(nowISO).getTime() + days * 24 * 60 * 60 * 1000).toISOString();
}

export interface RecordRejectionOptions {
  organizationId: string;
  ownerUserId: string;
  /** The rejected suggestion's semantic content (e.g. "field: value"). */
  text: string;
  nowISO: string;
  nextId: () => string;
}

/**
 * Record one rejection. If an existing fingerprint is already similar, that
 * fingerprint is STRUCK (strike += 1, window escalates toward permanent)
 * instead of a duplicate being written; otherwise a fresh fingerprint
 * starts at strike 1 with the first backoff window.
 */
export async function recordRejectionFingerprint(
  store: MemoryStore,
  embedder: TextEmbedder,
  options: RecordRejectionOptions,
): Promise<RejectionFingerprint> {
  const scope: MemoryAuthScope = { organizationId: options.organizationId, userId: options.ownerUserId };
  const [vector] = await embedder.embed([options.text]);
  const existing = await listRejectionFingerprints(store, scope);
  const similar = existing
    .filter((fingerprint) => fingerprint.embedderId === embedder.id)
    .map((fingerprint) => ({ fingerprint, similarity: cosineSimilarity(vector!, fingerprint.vector) }))
    .filter((entry) => entry.similarity >= REJECTION_SIMILARITY_THRESHOLD)
    .sort((a, b) => b.similarity - a.similarity)[0];

  const strikes = similar ? similar.fingerprint.strikes + 1 : 1;
  const body = {
    anchor: { kind: REJECTION_FINGERPRINT_KIND },
    text: options.text,
    embedderId: embedder.id,
    vector,
    strikes,
    suppressedUntil: suppressedUntilFor(strikes, options.nowISO),
  };
  if (similar) {
    // Strike the existing lineage — supersede its head in place.
    const head = await store.get(similar.fingerprint.memoryId, scope);
    if (head) {
      const next = await store.casSupersede({
        organizationId: options.organizationId,
        ownerUserId: options.ownerUserId,
        lineageKey: head.subjectRecordId ?? similar.fingerprint.memoryId,
        expectedCurrentId: head.id,
        next: {
          id: options.nextId(),
          organizationId: options.organizationId,
          type: "semantic",
          subjectRecordId: head.subjectRecordId ?? null,
          scope: "private",
          content: JSON.stringify(body),
          sourceRefType: "feedback",
          sourceRefId: head.id,
          confidence: 1,
          trustOrigin: "user_content",
          plane: "local",
          createdBy: options.ownerUserId,
          ownerUserId: options.ownerUserId,
        },
      });
      if (next) return parseFingerprint(next.id, next.content)!;
    }
  }
  const lineageKey = options.nextId();
  const row = await store.casSupersede({
    organizationId: options.organizationId,
    ownerUserId: options.ownerUserId,
    lineageKey,
    expectedCurrentId: null,
    next: {
      id: options.nextId(),
      organizationId: options.organizationId,
      type: "semantic",
      subjectRecordId: lineageKey,
      scope: "private",
      content: JSON.stringify(body),
      sourceRefType: "feedback",
      sourceRefId: null,
      confidence: 1,
      trustOrigin: "user_content",
      plane: "local",
      createdBy: options.ownerUserId,
      ownerUserId: options.ownerUserId,
    },
  });
  if (!row) throw new Error("rejection fingerprint write raced — retry");
  return parseFingerprint(row.id, row.content)!;
}

export interface RejectionSuppressionVerdict {
  suppressed: boolean;
  similarity?: number;
  matchedText?: string;
  permanent?: boolean;
  fingerprintMemoryId?: string;
}

/** Check a CANDIDATE proposal's content against active rejection
 * fingerprints. Expired windows do not suppress (backoff respected);
 * permanent ones always do. */
export async function isSuppressedByRejections(
  store: MemoryStore,
  embedder: TextEmbedder,
  text: string,
  scope: MemoryAuthScope,
  nowISO: string,
): Promise<RejectionSuppressionVerdict> {
  const fingerprints = (await listRejectionFingerprints(store, scope)).filter(
    (fingerprint) =>
      fingerprint.embedderId === embedder.id &&
      (fingerprint.suppressedUntil === null || fingerprint.suppressedUntil > nowISO),
  );
  if (fingerprints.length === 0) return { suppressed: false };
  const [vector] = await embedder.embed([text]);
  let best: { fingerprint: RejectionFingerprint; similarity: number } | null = null;
  for (const fingerprint of fingerprints) {
    const similarity = cosineSimilarity(vector!, fingerprint.vector);
    if (similarity >= REJECTION_SIMILARITY_THRESHOLD && (best === null || similarity > best.similarity)) {
      best = { fingerprint, similarity };
    }
  }
  if (!best) return { suppressed: false };
  return {
    suppressed: true,
    similarity: best.similarity,
    matchedText: best.fingerprint.text,
    permanent: best.fingerprint.suppressedUntil === null,
    fingerprintMemoryId: best.fingerprint.memoryId,
  };
}
