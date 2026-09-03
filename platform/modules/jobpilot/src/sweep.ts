import type { FetchedPosting } from "./fetchers.js";
import type { CandidateProfile, FitResult, JobProfile } from "./types.js";
import { scoreJobFit } from "./scoring.js";

// Turns a board's raw output into the handful of postings worth persisting.
//
// This is the step that makes the module usable rather than merely functional.
// A live probe on 2026-09-02 returned 3,818 open postings across 15 boards; a
// sweep that stored all of them would produce a tracker nobody can read, and
// re-storing them every few hours would be worse. So the sweep persists only
// what scores above `pass` against the candidate's own profile, using the SAME
// `scoreJobFit` the manual create path uses — one scoring rule, not a second
// "ingest filter" that could silently disagree with what the UI shows.

export interface SweepCandidateResult {
  posting: FetchedPosting;
  fit: FitResult;
}

export interface SweepResult {
  /** Everything the board returned, before filtering — the denominator that
   * tells "board is dead" apart from "board is irrelevant to this candidate". */
  fetched: number;
  /** Already-stored postings skipped this run. */
  duplicates: number;
  /** Scored `pass` and dropped. */
  rejected: number;
  /** Dropped as internships/contract/part-time before scoring. */
  notFullTime: number;
  keep: SweepCandidateResult[];
}

/**
 * Full-time only. The candidate is a second-year MBA recruiting for post-graduation
 * roles, so internships, co-ops and part-time listings are noise no matter how well
 * they score — a live sweep surfaced "Product Management Intern (Summer 2027)" as a
 * perfect 1.00 match, which is exactly the wrong answer confidently delivered.
 * Title-level because these feeds carry no employment-type field.
 */
const NON_FULL_TIME = /\b(intern|internship|co-?op|part[- ]time|contract(or)?|temporary|seasonal|apprentice|fellowship|working student|placement)\b/i;

export function isFullTime(title: string): boolean {
  return !NON_FULL_TIME.test(title);
}

export function postingToJobProfile(posting: FetchedPosting): JobProfile {
  const job: JobProfile = {};
  if (posting.company) job.company = posting.company;
  if (posting.title) job.title = posting.title;
  if (posting.location) job.location = posting.location;
  if (posting.isRemote !== undefined) job.isRemote = posting.isRemote;
  return job;
}

/**
 * Selects the postings a sweep should persist.
 *
 * `existingUrls` carries the repeat-sweep guard: a scheduled source re-reads the
 * same board every few hours, and without this every run would re-propose every
 * posting. Postings with no url cannot be deduped this way and are allowed
 * through — the database's unique constraint is the real backstop.
 */
export function selectPostings(
  postings: readonly FetchedPosting[],
  candidate: CandidateProfile,
  existingUrls: ReadonlySet<string>,
): SweepResult {
  const keep: SweepCandidateResult[] = [];
  const seenThisRun = new Set<string>();
  let duplicates = 0;
  let rejected = 0;
  let notFullTime = 0;

  for (const posting of postings) {
    const url = typeof posting.url === "string" ? posting.url : undefined;
    // Dedupe within the run too: a board can list the same role under several
    // locations, and those arrive as separate entries sharing one url.
    if (url && (existingUrls.has(url) || seenThisRun.has(url))) {
      duplicates += 1;
      continue;
    }
    if (!isFullTime(posting.title)) {
      notFullTime += 1;
      continue;
    }
    const fit = scoreJobFit(postingToJobProfile(posting), candidate);
    if (fit.flag === "pass") {
      rejected += 1;
      continue;
    }
    if (url) seenThisRun.add(url);
    keep.push({ posting, fit });
  }

  // Best fit first, so a capped sweep keeps the strongest matches rather than
  // whichever the board happened to list first.
  //
  // ponytail: scoreJobFit resolves to very few distinct values when the profile
  // carries only categories (no locations or salary floor), so most keepers tie
  // at 1.00 and this sort degenerates to catalog order — one large board can then
  // fill the whole top of the feed. Upgrade path is a finer signal (seniority,
  // recency from `updatedAt`, or per-company round-robin), not a bigger sort.
  keep.sort((a, b) => b.fit.score - a.fit.score);
  return { fetched: postings.length, duplicates, rejected, notFullTime, keep };
}
