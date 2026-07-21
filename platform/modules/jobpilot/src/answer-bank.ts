import { trigramSimilarity, FUZZY_MATCH_THRESHOLD } from "@bridge/dedupe";

// AnswerBank (architecture doc S3 `answers.AnswerBank`: "normalize -> exact -> fuzzy(rapidfuzz
// >=90) -> LLM(cheap) with profile context -> persist as source='llm'; unknown-and-risky -> raise
// NeedsHuman"). This is the deterministic normalize/exact/fuzzy half, reusing @bridge/dedupe's
// bigram-Dice similarity instead of adding a separate fuzzy-match dependency (compose, don't
// copy) — the LLM-fallback tier is a later llm-module concern, same deliberate omission as
// scoring.ts and evaluator.ts. The sensitive-question hard stop (SSN, payment details) is
// unconditional: those questions are NEVER auto-answered regardless of bank contents, per
// architecture doc S7 invariant 4 ("hard stop by construction"). The fuzzy acceptance floor
// itself is @bridge/dedupe's own FUZZY_MATCH_THRESHOLD (0.9) — imported, not re-declared, so the
// two modules can't silently drift apart on what "close enough" means.
export const FUZZY_THRESHOLD = FUZZY_MATCH_THRESHOLD;

const SENSITIVE_PATTERNS = [/social security/i, /\bssn\b/i, /national id/i, /bank account/i, /routing number/i, /credit card/i, /payment/i];

export type AnswerSource = "config" | "llm" | "human";

export interface AnswerRecord {
  questionNorm: string;
  questionRaw: string;
  answer: string;
  source: AnswerSource;
}

export class NeedsHuman extends Error {
  constructor(public readonly question: string, public readonly reason: "sensitive" | "unknown") {
    super(`needs human: ${reason} — "${question}"`);
  }
}

export function normalizeQuestion(question: string): string {
  return question.toLowerCase().trim().replace(/[^\w\s]/g, "").replace(/\s+/g, " ");
}

export function isSensitiveQuestion(question: string): boolean {
  return SENSITIVE_PATTERNS.some((p) => p.test(question));
}

export interface AnswerBank {
  record(input: AnswerRecord): void;
  resolve(question: string): AnswerRecord; // throws NeedsHuman if sensitive or no match found
  all(): AnswerRecord[];
}

export function createAnswerBank(seed: AnswerRecord[] = []): AnswerBank {
  const records = new Map<string, AnswerRecord>();
  for (const r of seed) records.set(r.questionNorm, r);

  function record(input: AnswerRecord): void {
    records.set(input.questionNorm, input);
  }

  function resolve(question: string): AnswerRecord {
    if (isSensitiveQuestion(question)) throw new NeedsHuman(question, "sensitive");

    const norm = normalizeQuestion(question);
    const exact = records.get(norm);
    if (exact) return exact;

    let best: AnswerRecord | null = null;
    let bestScore = 0;
    for (const candidate of records.values()) {
      const score = trigramSimilarity(norm, candidate.questionNorm);
      if (score > bestScore) {
        best = candidate;
        bestScore = score;
      }
    }
    if (best && bestScore >= FUZZY_THRESHOLD) return best;

    throw new NeedsHuman(question, "unknown");
  }

  function all(): AnswerRecord[] {
    return [...records.values()];
  }

  return { record, resolve, all };
}
