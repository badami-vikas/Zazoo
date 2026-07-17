import type { DealProfile, ThesisFitResult, ThesisProfile } from "./types.js";

// ThesisFit v1 — deterministic + cheap rule score (docs/raw/dealpilot-architecture-requirement.md
// S4: "rule score from the thesis profile ... small-model one-liner generated only for
// above-threshold deals"). This function is the rule half; the one-liner narration is a later
// llm-package concern, deliberately not built here — don't spend LLM cost narrating deals that
// fail the deterministic gate. v2 (learned re-ranking) is explicitly out of scope for Phase 3.
export function scoreThesisFit(profile: DealProfile, thesis: ThesisProfile): ThesisFitResult {
  const reasons: string[] = [];
  let points = 0;
  let possible = 0;

  possible += 1;
  if (profile.industry && thesis.industries.some((i) => i.toLowerCase() === profile.industry?.toLowerCase())) {
    points += 1;
    reasons.push(`industry match: ${profile.industry}`);
  } else if (profile.industry) {
    reasons.push(`industry mismatch: ${profile.industry} not in thesis`);
  }

  possible += 1;
  if (profile.geo && thesis.geo.some((g) => g.toLowerCase() === profile.geo?.toLowerCase())) {
    points += 1;
    reasons.push(`geo match: ${profile.geo}`);
  } else if (profile.geo) {
    reasons.push(`geo mismatch: ${profile.geo} not in thesis`);
  }

  if (thesis.sdeMin != null || thesis.sdeMax != null) {
    possible += 1;
    const inRange = profile.sde != null && (thesis.sdeMin == null || profile.sde >= thesis.sdeMin) && (thesis.sdeMax == null || profile.sde <= thesis.sdeMax);
    if (inRange) {
      points += 1;
      reasons.push(`SDE ${profile.sde} within thesis range`);
    } else if (profile.sde != null) {
      reasons.push(`SDE ${profile.sde} outside thesis range`);
    }
  }

  if (thesis.revenueMin != null || thesis.revenueMax != null) {
    possible += 1;
    const inRange =
      profile.revenue != null && (thesis.revenueMin == null || profile.revenue >= thesis.revenueMin) && (thesis.revenueMax == null || profile.revenue <= thesis.revenueMax);
    if (inRange) {
      points += 1;
      reasons.push(`revenue ${profile.revenue} within thesis range`);
    } else if (profile.revenue != null) {
      reasons.push(`revenue ${profile.revenue} outside thesis range`);
    }
  }

  const score = possible === 0 ? 0 : points / possible;
  const band = score >= 0.75 ? "strong_fit" : score >= 0.4 ? "needs_review" : "weak_fit";
  return { score, band, reasons };
}
