import type { CandidateProfile, FitResult, JobProfile } from "./types.js";

// Card-feed scoring v1 — deterministic + cheap rule score (docs/raw/jobpilot-architecture-
// requirement.md S3 `scoring.ScoringService`: "cheap-tier LLM, JSON schema output {score,
// green_flags[], red_flags[]}"). This function is the deterministic rule half — same reasoning
// as DealPilot's scoreThesisFit: don't spend LLM cost scoring cards a rule pass can already
// triage; a cheap-tier LLM narration pass is a later llm-package concern, not built here.
export function scoreJobFit(job: JobProfile, candidate: CandidateProfile): FitResult {
  const greenFlags: string[] = [];
  const redFlags: string[] = [];
  let points = 0;
  let possible = 0;

  possible += 1;
  const keywords = job.descriptionKeywords ?? [];
  const categoryHit = candidate.categories.find((c) => keywords.some((k) => k.toLowerCase() === c.toLowerCase()) || job.title?.toLowerCase().includes(c.toLowerCase()));
  if (categoryHit) {
    points += 1;
    greenFlags.push(`matches category: ${categoryHit}`);
  } else if (job.title) {
    redFlags.push(`title "${job.title}" does not match any target category`);
  }

  if (candidate.locations && candidate.locations.length > 0) {
    possible += 1;
    const locationHit = job.isRemote || (job.location && candidate.locations.some((l) => l.toLowerCase() === job.location?.toLowerCase()));
    if (locationHit) {
      points += 1;
      greenFlags.push(job.isRemote ? "remote" : `location match: ${job.location}`);
    } else if (job.location) {
      redFlags.push(`location "${job.location}" outside target locations`);
    }
  }

  if (candidate.minSalary != null) {
    possible += 1;
    if (job.salaryMax != null && job.salaryMax >= candidate.minSalary) {
      points += 1;
      greenFlags.push(`salary up to ${job.salaryMax} meets floor of ${candidate.minSalary}`);
    } else if (job.salaryMax != null) {
      redFlags.push(`salary cap ${job.salaryMax} below floor of ${candidate.minSalary}`);
    }
  }

  const score = possible === 0 ? 0 : points / possible;
  const flag = score >= 0.75 ? "green" : score >= 0.4 ? "yellow" : "red";
  return { score, flag, greenFlags, redFlags };
}
