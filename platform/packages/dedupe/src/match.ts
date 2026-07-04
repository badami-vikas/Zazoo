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

  let best: MatchResult = { candidateId: candidate.id, targetId: "", tier: "none", score: -1, reason: "no candidates in blocking set" };

  for (const target of pool) {
    if (candidate.keyId && target.keyId && candidate.keyId === target.keyId) {
      return { candidateId: candidate.id, targetId: target.id, tier: "strong", score: 1, reason: "exact key_id match" };
    }

    const score = trigramSimilarity(candidate.name, target.name);
    // Strictly-less-than: a 0-score candidate must still win over the "no candidate seen yet"
    // sentinel, otherwise the only entry in a blocking pool can be silently dropped (2026-07-04
    // regression caught by an actual test run, not just a green build).
    if (score < best.score) continue;

    const corroborated = corroboratingFields.some(
      (f) => candidate[f] != null && target[f] != null && String(candidate[f]).toLowerCase() === String(target[f]).toLowerCase(),
    );

    let tier: MatchResult["tier"] = "none";
    let reason = `trigram ${score.toFixed(2)}`;
    if (score >= thresholds.strong || (score >= thresholds.moderate && corroborated)) {
      tier = "strong";
      reason += corroborated ? " + corroborating field" : " >= strong threshold";
    } else if (score >= thresholds.moderate) {
      tier = "moderate";
      reason += " alone, no corroboration — pending review";
    } else if (score > 0) {
      tier = "flag";
      reason += " below moderate — flag only";
    }

    best = { candidateId: candidate.id, targetId: target.id, tier, score, reason };
  }

  if (best.score < 0) best.score = 0; // empty pool — no comparison happened, don't leak the sentinel
  return best;
}

export function matchAll(
  candidates: DedupeCandidate[],
  targets: DedupeCandidate[],
  corroboratingFields: string[] = [],
  thresholds: MatchThresholds = DEFAULT_THRESHOLDS,
): MatchResult[] {
  return candidates.map((c) => matchOne(c, targets, corroboratingFields, thresholds));
}
