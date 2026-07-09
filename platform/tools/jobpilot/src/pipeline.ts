import type { BudgetLedger, CaptureEnvelope, SourceConnector, SourceQuery } from "@bridge/sourcing";
import { runWaterfall } from "@bridge/sourcing";
import type { FactStore } from "@bridge/facts";
import type { DedupeCandidate } from "@bridge/dedupe";
import { matchOne } from "@bridge/dedupe";
import { matchCompany } from "@bridge/company-sourcing";
import type { CandidateProfile, FitResult, JobProfile } from "./types.js";
import { scoreJobFit } from "./scoring.js";

// Tier-1 sourcing -> JobFunnel-style dedup -> living profile -> card-feed scoring, composed from
// shared packages per docs/raw/tool-standardization-plan.md section 7 — JobPilot supplies its OWN
// connectors (the Greenhouse/Ashby/Lever-shaped ones) and its OWN job-posting keying (company +
// title + location is the job business key, per architecture doc S2.1 `jobs.key_id`), but
// delegates employer identity matching to company-sourcing's `matchCompany` (compose, don't copy)
// rather than re-implementing company dedup for the "already applied here" guard.
export interface JobPipelineResult {
  envelopes: CaptureEnvelope[];
  dedupedAgainst: string | null; // existing job id if this is a repost/duplicate, else null
  alreadyAppliedToCompany: string | null; // existing job id at the same employer, if any (S7 guard)
  fit: FitResult;
}

// Job-posting dedup key: company+title+location is the business key an exact-key hit should
// short-circuit to "strong" on, same role `domain` plays for company-sourcing's matchCompany —
// own logic (not copied), consuming @bridge/dedupe's shared matcher.
function jobKeyId(company?: string, title?: string, location?: string): string | undefined {
  if (!company || !title) return undefined;
  return [company, title, location ?? ""].join("|").toLowerCase();
}

export async function processJobCandidate(
  query: SourceQuery,
  connectors: SourceConnector[],
  ledger: BudgetLedger,
  facts: FactStore,
  jobId: string,
  existingJobs: DedupeCandidate[],
  candidate: CandidateProfile,
): Promise<JobPipelineResult> {
  const result = await runWaterfall(query, connectors, ledger);

  for (const envelope of result.envelopes) {
    for (const [field, value] of Object.entries(envelope.payload)) {
      facts.append({ entityId: jobId, field, value, provenance: "listing", confidence: envelope.confidence });
    }
  }

  const profile = facts.livingProfile(jobId);
  const company = profile.company?.value as string | undefined;
  const title = profile.title?.value as string | undefined;
  const location = profile.location?.value as string | undefined;

  // Built additively (not as an object literal with possibly-undefined values) because
  // exactOptionalPropertyTypes forbids assigning `undefined` to an optional field explicitly —
  // omitting the key entirely is the correct way to express "no key/blocking value yet".
  const candidateForMatch: DedupeCandidate = { id: jobId, name: title ?? jobId };
  const keyId = jobKeyId(company, title, location);
  if (keyId) candidateForMatch.keyId = keyId;
  if (company) candidateForMatch.blockingKey = company;
  const match = matchOne(candidateForMatch, existingJobs, []);
  const dedupedAgainst = match.tier === "strong" ? match.targetId : null;

  let alreadyAppliedToCompany: string | null = null;
  if (company) {
    const companyCandidate: DedupeCandidate = { id: jobId, name: company };
    const companyTargets = existingJobs
      .filter((j) => j.id !== dedupedAgainst)
      .map((j) => ({ id: j.id, name: String(j.blockingKey ?? j.name) }));
    const companyMatch = matchCompany(companyCandidate, companyTargets);
    if (companyMatch.tier === "strong") alreadyAppliedToCompany = companyMatch.targetId;
  }

  const jobProfile: JobProfile = {};
  if (company) jobProfile.company = company;
  if (title) jobProfile.title = title;
  if (location) jobProfile.location = location;
  if (profile.isRemote) jobProfile.isRemote = profile.isRemote.value as boolean;
  if (profile.salaryMin) jobProfile.salaryMin = profile.salaryMin.value as number;
  if (profile.salaryMax) jobProfile.salaryMax = profile.salaryMax.value as number;
  if (profile.descriptionKeywords) jobProfile.descriptionKeywords = profile.descriptionKeywords.value as string[];
  const fit = scoreJobFit(jobProfile, candidate);

  return { envelopes: result.envelopes, dedupedAgainst, alreadyAppliedToCompany, fit };
}
