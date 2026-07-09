import { trigramSimilarity } from "./scoring.js";
import { DEFAULT_THRESHOLDS, type DedupeCandidate, type MatchResult, type MatchThresholds } from "./types.js";

// Matches a candidate against a target set. Exact keyId match always wins (strong, score 1).
// Otherwise: blocking keys narrow the comparison set (cheap pre-filter before O(n^2) scoring),
// then trigram name similarity classifies into the three governed tiers. A corroborating point
// (a second field — e.g. company, title — that also matches) upgrades "moderate" to "strong",
// mirroring the recon rule "name+1 point = auto, name-only = pending".
export function matchOne(
  candidate: DedupeCandidate,
  targets: DedupeCandidate[],
  corroboratingFields: string[] = [],
  thresholds: MatchThresholds = DEFAULT_THRESHOLDS,
): MatchResult {
  const pool = candidate.blockingKey ? targets.filter((t) => t.blockingKey === candidate.blockingKey) : targets;

  for (const target of pool) {
    if (candidate.keyId && target.keyId && candidate.keyId === target.keyId) {
      return { candidateId: candidate.id, targetId: target.id, tier: "strong", score: 1, reason: "exact key_id match" };
    }
  }

  if (pool.length === 0) {
    return { candidateId: candidate.id, targetId: "", tier: "none", score: 0, reason: "no candidates in blocking set" };
  }

  const scored = pool.map((target) => ({ target, score: trigramSimilarity(candidate.name, target.name) }));
  const topScore = Math.max(...scored.map((s) => s.score));
  const topMatches = scored.filter((s) => s.score === topScore);
  // Deterministic tie-break: first-seen (pool order) wins, never later-overwrites-earlier.
  // An exact tie between two *different* targets is inherently ambiguous — never let it
  // auto-merge as "strong" on the strength of array order alone; downgrade to "moderate"
  // so a human decides. (2026-07-04: previously `score < best.score` let a later equal-score
  // target silently overwrite an earlier one, so array order — not evidence — picked the
  // auto-merge target; see known-issues.md.)
  const winner = topMatches[0]!.target;
  const tied = topMatches.length > 1;

  const corroborated = corroboratingFields.some(
    (f) => candidate[f] != null && winner[f] != null && String(candidate[f]).toLowerCase() === String(winner[f]).toLowerCase(),
  );

  let tier: MatchResult["tier"] = "none";
  let reason = `trigram ${topScore.toFixed(2)}`;
  if (topScore >= thresholds.strong || (topScore >= thresholds.moderate && corroborated)) {
    tier = tied ? "moderate" : "strong";
    reason += tied
      ? ` tied with ${topMatches.length - 1} other candidate(s) at the same score — ambiguous, held for review`
      : corroborated
        ? " + corroborating field"
        : " >= strong threshold";
  } else if (topScore >= thresholds.moderate) {
    tier = "moderate";
    reason += " alone, no corroboration — pending review";
  } else if (topScore > 0) {
    tier = "flag";
    reason += " below moderate — flag only";
  }

  return { candidateId: candidate.id, targetId: winner.id, tier, score: topScore, reason };
}

export function matchAll(
  candidates: DedupeCandidate[],
  targets: DedupeCandidate[],
  corroboratingFields: string[] = [],
  thresholds: MatchThresholds = DEFAULT_THRESHOLDS,
): MatchResult[] {
  return candidates.map((c) => matchOne(c, targets, corroboratingFields, thresholds));
}
