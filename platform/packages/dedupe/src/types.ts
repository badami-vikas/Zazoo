// Shared match-governance contract — generalizes the recon match-tier decision (memory:
// recon-match-governance) so people-sourcing, company-sourcing, DealPilot S3, and JobPilot
// dedupe all resolve candidates the same way instead of five bespoke threshold sets.

export type MatchTier = "strong" | "moderate" | "flag" | "none";

export interface DedupeCandidate {
  id: string;
  keyId?: string; // exact business key (email, domain, LinkedIn URL) — if present and equal, always "strong"
  name: string;
  blockingKey?: string; // coarse pre-filter (e.g. normalized domain, last-name+company)
  [field: string]: unknown;
}

export interface MatchResult {
  candidateId: string;
  targetId: string;
  tier: MatchTier;
  score: number; // 0..1, trigram similarity on name when no exact key
  reason: string;
}

export interface MatchThresholds {
  strong: number; // >= this trigram score (with a corroborating point) => strong
  moderate: number; // >= this trigram score alone => moderate (pending review)
}

export const DEFAULT_THRESHOLDS: MatchThresholds = { strong: 0.92, moderate: 0.75 };

// Generic fuzzy-match acceptance floor for callers that need a single scalar cutoff rather than
// the strong/moderate tier pair above (e.g. JobPilot's AnswerBank: normalize -> exact -> fuzzy
// >=0.9 -> LLM fallback, architecture doc S3 `answers.AnswerBank`). Kept as its own export instead
// of overloading `DEFAULT_THRESHOLDS.moderate` — that pair is specifically about the
// strong/moderate/flag REVIEW-QUEUE tiering, a different decision from AnswerBank's binary
// accept-or-escalate-to-LLM cutoff.
export const FUZZY_MATCH_THRESHOLD = 0.9;
