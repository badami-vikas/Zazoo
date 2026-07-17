// JobPilot-owned shapes only — sourcing/dedupe/facts/table primitives are imported from the
// shared packages, never redefined here (docs/raw/jobpilot-architecture-requirement.md S2/S3,
// re-based onto @bridge/facts + @bridge/dedupe + @bridge/tables per the standardization plan).

export interface CandidateProfile {
  categories: string[]; // editable category chips from onboarding (vision doc F2)
  skills: string[]; // extracted from master resume (vision doc F1)
  minSalary?: number;
  locations?: string[]; // empty/omitted = remote-friendly, no location filter
}

// The "living profile" fields JobPilot reads back from @bridge/facts.livingProfile(jobId) — a
// subset projection, not a parallel store. Mirrors architecture doc S2.1 `jobs` columns.
export interface JobProfile {
  company?: string;
  title?: string;
  location?: string;
  isRemote?: boolean;
  salaryMin?: number;
  salaryMax?: number;
  descriptionKeywords?: string[];
  [field: string]: unknown;
}

// AP-023 (2026-07-15) / docs/raw/ui-architecture-rules-2026-07.md §5d — Green/yellow
// feedback flags are removed platform-wide; "Red Flag" is the one reserved platform
// feedback primitive (docs/glossary.md). This is a domain FIT recommendation, not
// feedback — it gets an explicit label, never color-only semantics.
export type FitRecommendation = "pursue" | "review" | "pass";

export interface FitResult {
  score: number; // 0..1
  flag: FitRecommendation;
  strengths: string[];
  concerns: string[];
}

/**
 * TASK-010 review remediation item 9 — PENDING migration bridge. The
 * `applications.flag` DB column (schema.ts, plain `text`, no CHECK
 * constraint) persisted the pre-canon `"green"|"yellow"|"red"` values before
 * this rename; nothing has backfilled any already-persisted rows yet
 * (TASK-008 RM4 owns the next schema migration slot, `0015`, and hasn't
 * landed on `main` — fabricating a migration/snapshot ahead of it would
 * collide, so the real backfill + `CHECK (flag IN (...))` constraint is
 * DEFERRED to a migration `0016+` once RM4 lands; see
 * `outputs/2026-07-17-task010-review-remediation.md` for the exact
 * backfill SQL this will apply). This normalizer is the interim,
 * non-schema-changing safety net: any code path reading a PERSISTED `flag`
 * value back (rather than a freshly computed `scoreJobFit` result) should
 * call it so a pre-migration legacy row still round-trips as a valid
 * `FitRecommendation` instead of surfacing a raw `"green"`/`"yellow"`/`"red"`
 * string to a client.
 */
export function normalizeLegacyFitFlag(value: string | null | undefined): FitRecommendation | null {
  switch (value) {
    case "pursue":
    case "review":
    case "pass":
      return value;
    case "green":
      return "pursue";
    case "yellow":
      return "review";
    case "red":
      return "pass";
    default:
      return null;
  }
}

// Deterministic fabrication-guard verdict (architecture doc S4.2 stage 1) — the LLM-judge stage
// is deliberately not built here, same as scoring.ts: don't spend LLM cost judging materials
// that fail the cheap deterministic gate first.
export interface EvalVerdict {
  approved: boolean;
  blockingIssues: string[];
}

// Application pipeline state (architecture doc S2.1 `applications.status` state machine) — kept
// here as the shape the tracker table's `stage` column renders, not a re-implementation of the
// transition logic (that belongs to a future ritual/RitualExecutor pass, out of scope for this
// anchor).
export type ApplicationStage =
  | "queued"
  | "tailoring"
  | "evaluating"
  | "approved"
  | "awaiting_review"
  | "applying"
  | "parked"
  | "submitted"
  | "confirmed"
  | "rejected_by_user"
  | "failed"
  | "expired";
