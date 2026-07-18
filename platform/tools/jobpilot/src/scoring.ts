import type { CandidateProfile, FitResult, JobProfile } from "./types.js";

// Card-feed scoring v1 — deterministic + cheap rule score (docs/raw/jobpilot-architecture-
// requirement.md S3 `scoring.ScoringService`: "cheap-tier LLM, JSON schema output {score,
// green_flags[], red_flags[]}"). This function is the deterministic rule half — same reasoning
// as DealPilot's scoreThesisFit: don't spend LLM cost scoring cards a rule pass can already
// triage; a cheap-tier LLM narration pass is a later llm-package concern, not built here.
//
// AP-023 (2026-07-15) — the architecture doc's "green_flags/red_flags" naming predates the
// platform Red Flag primitive (docs/glossary.md); renamed to `strengths`/`concerns` here to
// remove that vocabulary collision and match the label `JobPilotApplicationDetail.tsx` already
// renders (`fit.strengths`/`fit.concerns`) — same evidence-reason arrays, new names only.
export function scoreJobFit(job: JobProfile, candidate: CandidateProfile): FitResult {
  const strengths: string[] = [];
  const concerns: string[] = [];
  let points = 0;
  let possible = 0;

  possible += 1;
  const keywords = job.descriptionKeywords ?? [];
  const categoryHit = candidate.categories.find((c) => keywords.some((k) => k.toLowerCase() === c.toLowerCase()) || job.title?.toLowerCase().includes(c.toLowerCase()));
  if (categoryHit) {
    points += 1;
    strengths.push(`matches category: ${categoryHit}`);
  } else if (job.title) {
    concerns.push(`title "${job.title}" does not match any target category`);
  }

  if (candidate.locations && candidate.locations.length > 0) {
    possible += 1;
    const locationHit = job.isRemote || (job.location && candidate.locations.some((l) => l.toLowerCase() === job.location?.toLowerCase()));
    if (locationHit) {
      points += 1;
      strengths.push(job.isRemote ? "remote" : `location match: ${job.location}`);
    } else if (job.location) {
      concerns.push(`location "${job.location}" outside target locations`);
    }
  }

  if (candidate.minSalary != null) {
    possible += 1;
    if (job.salaryMax != null && job.salaryMax >= candidate.minSalary) {
      points += 1;
      strengths.push(`salary up to ${job.salaryMax} meets floor of ${candidate.minSalary}`);
    } else if (job.salaryMax != null) {
      concerns.push(`salary cap ${job.salaryMax} below floor of ${candidate.minSalary}`);
    }
  }

  const score = possible === 0 ? 0 : points / possible;
  // AP-023 — explicit domain labels, never color-only semantics (§5d).
  const flag = score >= 0.75 ? "pursue" : score >= 0.4 ? "review" : "pass";
  return { score, flag, strengths, concerns };
}
