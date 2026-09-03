import {
  SOURCE_CATALOG,
  fetcherFor,
  selectPostings,
  scoreJobFit,
  BoardFetchError,
  MBA_FULL_TIME_TARGETS,
  type CandidateProfile,
} from "@bridge/jobpilot";
import type { DrizzleJobPilotStore } from "@bridge/db";

/**
 * The source sweep, in ONE place.
 *
 * Both the manual "Run sweep now" button (`jobpilot.sources.run`) and the
 * scheduled Automation call this same function. That is the whole point of
 * extracting it: DealPilot's source intake established that a manual refresh and
 * its schedule must be the same Automation, and the fastest way to break that
 * promise is to let the button and the timer grow two copies of the logic that
 * quietly drift apart.
 */

export interface SweepSourceReport {
  sourceId: string;
  fetched: number;
  kept: number;
  error: string | null;
}

export interface JobPilotSweepReport {
  created: number;
  sources: SweepSourceReport[];
}

export class OnboardingIncompleteError extends Error {
  constructor() {
    super("Complete JobPilot onboarding before running a source sweep — no job functions selected.");
    this.name = "OnboardingIncompleteError";
  }
}

export async function runJobPilotSweep(
  store: DrizzleJobPilotStore,
  organizationId: string,
): Promise<JobPilotSweepReport> {
  const profile = await store.getCandidateProfile(organizationId);
  const categories = Array.isArray(profile?.selectedFunctions) ? (profile.selectedFunctions as string[]) : [];
  // Without a profile every posting scores identically and the sweep would
  // store whole boards indiscriminately. Refusing loudly beats filling the
  // tracker with 3,800 rows nobody asked for.
  if (categories.length === 0) throw new OnboardingIncompleteError();
  const candidate: CandidateProfile = { categories, skills: [] };

  const states = await store.listSourceStates(organizationId);
  const enabled = new Set(states.filter((row) => row.enabled).map((row) => row.sourceId));
  const existingUrls = await store.existingJobUrls(organizationId);

  const sources: SweepSourceReport[] = [];
  let created = 0;

  for (const source of SOURCE_CATALOG) {
    if (!enabled.has(source.id)) continue;

    // The curated source has no endpoint — it reads the hand-entered target
    // list, and is the ONLY source that carries application deadlines (ADR-265).
    if (source.kind === "curated") {
      let kept = 0;
      for (const target of MBA_FULL_TIME_TARGETS) {
        if (!target.applyUrl || existingUrls.has(target.applyUrl)) continue;
        const fit = scoreJobFit({ company: target.company, title: target.role }, candidate);
        const { application } = await store.createJob({
          organizationId,
          title: target.role,
          company: target.company,
          url: target.applyUrl,
          source: "curated",
          ...(target.deadline ? { deadline: target.deadline } : {}),
        });
        await store.updateApplication(application.id, { fitScore: fit.score, flag: fit.flag });
        existingUrls.add(target.applyUrl);
        kept += 1;
        created += 1;
      }
      await store.recordSourceRun(organizationId, source.id, { fetched: MBA_FULL_TIME_TARGETS.length, kept });
      sources.push({ sourceId: source.id, fetched: MBA_FULL_TIME_TARGETS.length, kept, error: null });
      continue;
    }

    const fetcher = fetcherFor(source);
    if (!fetcher) continue;
    try {
      const postings = await fetcher({ kind: "company", hints: {} });
      const swept = selectPostings(postings, candidate, existingUrls);
      for (const { posting, fit } of swept.keep) {
        const { application } = await store.createJob({
          organizationId,
          title: posting.title,
          company: posting.company,
          ...(posting.location ? { location: posting.location } : {}),
          ...(posting.url ? { url: posting.url } : {}),
          source: source.kind,
        });
        await store.updateApplication(application.id, { fitScore: fit.score, flag: fit.flag });
        if (posting.url) existingUrls.add(posting.url);
        created += 1;
      }
      await store.recordSourceRun(organizationId, source.id, { fetched: swept.fetched, kept: swept.keep.length });
      sources.push({ sourceId: source.id, fetched: swept.fetched, kept: swept.keep.length, error: null });
    } catch (err) {
      // One stale ATS slug must not abort the sweep. Board slugs cannot be
      // enumerated, so entries go stale as companies rename or migrate — a 404
      // here is expected drift, and letting it throw would mean one dead board
      // silently stops all sourcing.
      const message = err instanceof BoardFetchError ? err.message : String(err);
      await store.recordSourceRun(organizationId, source.id, { fetched: 0, kept: 0, error: message });
      sources.push({ sourceId: source.id, fetched: 0, kept: 0, error: message });
    }
  }

  return { created, sources };
}
