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
