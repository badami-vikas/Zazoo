/**
 * Speaker-extraction Automation runtime (TASK-070 follow-on, ADR-239) — the
 * ONLY place in this file that touches the network, via `guardedFetch`
 * (`@bridge/net-guard`). Everything it calls (`extractSpeakerCandidates`,
 * `resolveOpenAlexAuthor`, `matchOne`) is pure and lives in
 * `@bridge/events-extraction` / `@bridge/dedupe` — this module is the thin,
 * untested-by-design composition shell; the logic it composes is unit-tested
 * in those packages.
 *
 * fetch (guardedFetch) -> extract (parse.ts) -> resolve (OpenAlex) -> 3-tier
 * gate (@bridge/dedupe's matchOne, the SAME governed matcher
 * people-sourcing/company-sourcing/DealPilot/JobPilot use) -> draft rows.
 * Nothing here writes a Person or an edge — see `router.ts`'s
 * `events.extraction.decide`, which only runs on an explicit human approval.
 */
import { guardedFetch } from "@bridge/net-guard";
import { extractSpeakerCandidates, resolveOpenAlexAuthor, type SpeakerCandidate } from "@bridge/events-extraction";
import { matchOne, type DedupeCandidate, type MatchTier } from "@bridge/dedupe";
import type { InsertSpeakerDraftInput } from "@bridge/db";

export interface ExistingPersonForMatch {
  id: string;
  name: string;
}

export interface ResolvedSpeakerDraft {
  name: string;
  affiliation?: string;
  talkTitle?: string;
  openAlexId?: string;
  orcid?: string;
  tier: MatchTier;
  score: number;
  matchedPersonId?: string;
}

async function fetchJsonViaGuardedFetch(url: string): Promise<unknown> {
  const result = await guardedFetch(url, {
    headers: { accept: "application/json", "user-agent": "Bridge-EventsModule/0.1 (mailto:dev.bridge.ai@gmail.com)" },
  });
  if (result.status < 200 || result.status >= 300) {
    throw new Error(`OpenAlex request failed: HTTP ${result.status}`);
  }
  return JSON.parse(result.body.toString("utf8"));
}

/** Fetch the Event URL, extract speaker rows, and return them un-resolved/un-matched. */
export async function fetchAndExtractSpeakers(eventUrl: string): Promise<SpeakerCandidate[]> {
  const result = await guardedFetch(eventUrl, {
    headers: { accept: "text/html", "user-agent": "Bridge-EventsModule/0.1 (mailto:dev.bridge.ai@gmail.com)" },
  });
  if (result.status < 200 || result.status >= 300) {
    throw new Error(`Event URL fetch failed: HTTP ${result.status}`);
  }
  return extractSpeakerCandidates(result.body.toString("utf8"));
}

/**
 * Resolve identity (best-effort OpenAlex lookup) and run the 3-tier match
 * gate against the Module's existing People for every extracted candidate.
 * A resolution failure never drops the candidate — it stages a name-only
 * draft rather than silently discarding a real speaker.
 */
export async function resolveAndMatchSpeakers(
  candidates: SpeakerCandidate[],
  existingPeople: ExistingPersonForMatch[],
): Promise<ResolvedSpeakerDraft[]> {
  const targets: DedupeCandidate[] = existingPeople.map((person) => ({ id: person.id, name: person.name }));

  const out: ResolvedSpeakerDraft[] = [];
  for (const candidate of candidates) {
    const identity = await resolveOpenAlexAuthor(candidate.name, candidate.affiliation, fetchJsonViaGuardedFetch);
    const dedupeCandidate: DedupeCandidate = { id: candidate.name, name: identity?.displayName ?? candidate.name };
    const match = matchOne(dedupeCandidate, targets, ["affiliation"]);

    out.push({
      name: candidate.name,
      ...(candidate.affiliation ? { affiliation: candidate.affiliation } : {}),
      ...(candidate.talkTitle ? { talkTitle: candidate.talkTitle } : {}),
      ...(identity?.openAlexId ? { openAlexId: identity.openAlexId } : {}),
      ...(identity?.orcid ? { orcid: identity.orcid } : {}),
      tier: match.tier,
      score: match.score,
      ...(match.tier !== "none" && match.targetId ? { matchedPersonId: match.targetId } : {}),
    });
  }
  return out;
}

export function toInsertSpeakerDraftInputs(
  organizationId: string,
  eventId: string,
  runId: string,
  drafts: ResolvedSpeakerDraft[],
): InsertSpeakerDraftInput[] {
  return drafts.map((draft) => ({
    organizationId,
    eventId,
    runId,
    name: draft.name,
    ...(draft.affiliation ? { affiliation: draft.affiliation } : {}),
    ...(draft.talkTitle ? { talkTitle: draft.talkTitle } : {}),
    ...(draft.openAlexId ? { openAlexId: draft.openAlexId } : {}),
    ...(draft.orcid ? { orcid: draft.orcid } : {}),
    tier: draft.tier,
    score: draft.score,
    ...(draft.matchedPersonId ? { matchedPersonId: draft.matchedPersonId } : {}),
  }));
}

/**
 * Deterministic, templated LinkedIn connection-note draft (TASK-070
 * follow-on). No LLM call: no existing Skill in this repo drafts
 * personalized free text via a model, so there is no established LLM-drafting
 * seam to reuse — introducing one for a single short template would be new
 * machinery for a problem a plain string template already solves.
 */
export function draftOutreachNote(input: {
  speakerName: string;
  affiliation?: string;
  eventName: string;
  talkTitle?: string;
}): string {
  const first = input.speakerName.trim().split(/\s+/)[0] ?? input.speakerName;
  const affiliationClause = input.affiliation ? ` from ${input.affiliation}` : "";
  const talkClause = input.talkTitle ? ` — I enjoyed your talk "${input.talkTitle}"` : "";
  return (
    `Hi ${first}, I saw you${affiliationClause} at ${input.eventName}${talkClause}. ` +
    `Would love to connect and stay in touch.`
  );
}
