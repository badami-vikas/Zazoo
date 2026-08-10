/**
 * Commitment detection + suggestion lifecycle (AI Harness K6, ADR-210 —
 * "commitment detection mined from real prose, materializing into the graph
 * substrate on acceptance").
 *
 * Invariants, each load-bearing:
 *
 *  - **Suggested-then-accepted.** Detection NEVER writes a Commitment. It
 *    writes a suggestion row (inspectable, deletable Memory on a CAS
 *    lineage, exactly like claim suggestions), and only an explicit Human
 *    acceptance — through the governed relationship-mutation pipeline at
 *    the call site — materializes anything. `acceptCommitmentSuggestion`
 *    has no handle to the graph store by construction.
 *  - **Deterministic and precision-biased.** The detector is pure pattern
 *    matching over the OWNER'S OWN first-person prose ("I'll…", "I will…",
 *    "I promise to…"). No model call; a missed commitment costs nothing
 *    (the user can always create one by hand on the Relationship surface),
 *    while a false positive spends the annoyance budget. Negated phrasings
 *    and questions are excluded.
 *  - **Annoyance-capped, deferred not dropped.** At most
 *    `MAX_COMMITMENT_SUGGESTIONS_PER_RUN` new suggestions per detection run,
 *    and none at all while `MAX_OUTSTANDING_COMMITMENT_SUGGESTIONS` are
 *    already awaiting review. Over-cap candidates are DEFERRED — no lineage
 *    row is written, so the same sentence can propose on a later run once
 *    the queue drains. A rejected suggestion, by contrast, holds its
 *    lineage forever: the same normalized sentence is never re-proposed
 *    (store-level guarantee, same as every other suggestion lineage).
 *  - **The prose stays data.** The suggestion quotes the user's own
 *    sentence back to them verbatim as `candidate.text`; it is rendered for
 *    a human decision, never projected into a model prompt by this module.
 */
import type { TaintLabel } from "../taint.js";
import type {
  MemoryAuthScope,
  MemoryEntry,
  MemoryStore,
} from "../memory/memory-store.js";

export const COMMITMENT_SUGGESTION_KIND = "commitment_suggestion";

/** Annoyance cap: new suggestions per detection run. */
export const MAX_COMMITMENT_SUGGESTIONS_PER_RUN = 2;
/** Annoyance cap: while this many are awaiting review, nothing new is proposed. */
export const MAX_OUTSTANDING_COMMITMENT_SUGGESTIONS = 5;

export interface CommitmentCandidate {
  /** The user's own sentence, verbatim — data, never instructions. */
  text: string;
  /** A capitalized name the sentence appears to address ("send Priya…"); a hint for the person picker, never an auto-link. */
  counterpartyHint: string | null;
  /** The raw due phrase as written ("by Friday"); null when none was stated. */
  dueHint: string | null;
  /** The due phrase resolved against the detection clock, ISO; null when none. */
  dueAt: string | null;
}

const WEEKDAYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"] as const;

/** Resolve a due phrase to end-of-working-day (17:00 LOCAL — the same
 * local-clock caveat K2's timeOfDay carries) on the resolved date. */
export function resolveDuePhrase(phrase: string, nowISO: string): string | null {
  const now = new Date(nowISO);
  if (Number.isNaN(now.getTime())) return null;
  const lower = phrase.trim().toLowerCase();
  const due = new Date(now);
  const isoMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(lower);
  if (isoMatch) {
    due.setFullYear(Number(isoMatch[1]), Number(isoMatch[2]) - 1, Number(isoMatch[3]));
  } else if (lower === "today" || lower === "tonight") {
    // due date is today
  } else if (lower === "tomorrow") {
    due.setDate(due.getDate() + 1);
  } else if (lower === "next week") {
    due.setDate(due.getDate() + 7);
  } else if (lower === "end of week" || lower === "end of the week") {
    due.setDate(due.getDate() + ((5 - due.getDay() + 7) % 7));
  } else if ((WEEKDAYS as readonly string[]).includes(lower)) {
    // The coming occurrence; "by Friday" said on a Friday means today.
    due.setDate(due.getDate() + ((WEEKDAYS.indexOf(lower as (typeof WEEKDAYS)[number]) - due.getDay() + 7) % 7));
  } else {
    return null;
  }
  due.setHours(17, 0, 0, 0);
  return due.toISOString();
}

// The preposition is optional: "I'll call Rahul tomorrow" commits as surely
// as "by tomorrow". The last temporal phrase in the sentence wins.
const DUE_PHRASE =
  /\b(?:(?:by|before|on)\s+)?(today|tonight|tomorrow|next week|end of (?:the )?week|sunday|monday|tuesday|wednesday|thursday|friday|saturday|\d{4}-\d{2}-\d{2})\b/gi;

const COMMITMENT_OPENER =
  /\b(?:i(?:'|’)ll|i\s+will|i\s+promise\s+to|i(?:'|’)m\s+going\s+to)\s+(\S.*)$/i;

const COUNTERPARTY =
  /\b(?:send|email|tell|call|ping|message|remind|share with|meet|get back to|follow up with)\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)\b/;

/** Detect first-person commitment sentences in one prose text. Pure:
 * `nowISO` is the only clock, so the same input always detects the same
 * candidates with the same resolved due dates. */
export function detectCommitmentCandidates(text: string, nowISO: string): CommitmentCandidate[] {
  const candidates: CommitmentCandidate[] = [];
  const sentences = text
    .split(/(?<=[.!?])\s+|\n+/)
    .map((sentence) => sentence.trim())
    .filter((sentence) => sentence.length > 0 && sentence.length <= 300);
  for (const sentence of sentences) {
    if (sentence.endsWith("?")) continue;
    const opener = COMMITMENT_OPENER.exec(sentence);
    if (!opener) continue;
    const remainder = opener[1]!;
    // Negations are not commitments; "I'll never…" is the opposite of one.
    if (/^(?:not|never|no\b)/i.test(remainder)) continue;
    if (remainder.trim().split(/\s+/).length < 2) continue;

    let dueHint: string | null = null;
    DUE_PHRASE.lastIndex = 0;
    for (let match = DUE_PHRASE.exec(sentence); match; match = DUE_PHRASE.exec(sentence)) {
      dueHint = match[1]!;
    }
    const counterparty = COUNTERPARTY.exec(sentence);
    const counterpartyHint =
      counterparty && !(WEEKDAYS as readonly string[]).includes(counterparty[1]!.toLowerCase())
        ? counterparty[1]!
        : null;
    candidates.push({
      text: sentence,
      counterpartyHint,
      dueHint,
      dueAt: dueHint ? resolveDuePhrase(dueHint, nowISO) : null,
    });
  }
  return candidates;
}

export type CommitmentSuggestionStatus = "proposed" | "accepted" | "rejected";

export interface CommitmentSuggestion {
  /** The Memory row id carrying the CURRENT state of this suggestion. */
  memoryId: string;
  status: CommitmentSuggestionStatus;
  candidate: CommitmentCandidate;
  /** Human-readable proposal shown for acceptance. */
  suggestedText: string;
}

/** Stable lineage key for one commitment sentence — at most one suggestion
 * lineage ever exists per normalized sentence, which is what makes "never
 * re-suggest a rejected commitment" a store-level guarantee. */
export function commitmentSuggestionLineageKey(text: string): string {
  return `learning:commitment:${text.trim().toLowerCase().replace(/\s+/g, " ")}`;
}

function parseContent(entry: MemoryEntry): Record<string, unknown> | null {
  try {
    const value = JSON.parse(entry.content) as unknown;
    return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

export function readCommitmentSuggestion(entry: MemoryEntry): CommitmentSuggestion | null {
  const content = parseContent(entry);
  if (!content) return null;
  const anchor = content["anchor"] as { kind?: unknown; status?: unknown } | undefined;
  if (anchor?.kind !== COMMITMENT_SUGGESTION_KIND) return null;
  const status = anchor.status;
  if (status !== "proposed" && status !== "accepted" && status !== "rejected") return null;
  const candidate = content["candidate"] as CommitmentCandidate | undefined;
  if (!candidate || typeof candidate.text !== "string") return null;
  return {
    memoryId: entry.id,
    status,
    candidate,
    suggestedText: typeof content["suggestedText"] === "string" ? (content["suggestedText"] as string) : "",
  };
}

export interface ProposeCommitmentSuggestionsOptions {
  organizationId: string;
  ownerUserId: string;
  candidates: CommitmentCandidate[];
  nextId: () => string;
  /** Maps a lineage key to the stored lineage id (uuid-typed columns need
   * a deterministic uuid; tests may pass identity). */
  lineageIdFor?: (key: string) => string;
  /** Taint of the source turn, carried onto the suggestion at source. */
  taintLabel?: TaintLabel;
}

export interface ProposeCommitmentSuggestionsResult {
  proposed: CommitmentSuggestion[];
  /** Candidates the annoyance cap pushed to a later run — no lineage was
   * written for them, so they remain proposable. */
  deferred: number;
}

export async function proposeCommitmentSuggestions(
  store: MemoryStore,
  options: ProposeCommitmentSuggestionsOptions,
): Promise<ProposeCommitmentSuggestionsResult> {
  const lineageIdFor = options.lineageIdFor ?? ((key: string) => key);
  const scope: MemoryAuthScope = {
    organizationId: options.organizationId,
    userId: options.ownerUserId,
  };
  const outstanding = (await listCommitmentSuggestions(store, scope, "proposed")).length;
  let budget = Math.max(
    0,
    Math.min(
      MAX_COMMITMENT_SUGGESTIONS_PER_RUN,
      MAX_OUTSTANDING_COMMITMENT_SUGGESTIONS - outstanding,
    ),
  );
  const proposed: CommitmentSuggestion[] = [];
  let deferred = 0;
  for (const candidate of options.candidates) {
    const lineageKey = lineageIdFor(commitmentSuggestionLineageKey(candidate.text));
    const current = await store.currentForLineage(
      options.organizationId,
      options.ownerUserId,
      lineageKey,
    );
    if (current) continue; // duplicate sentence — its lineage already decided or pending
    if (budget === 0) {
      deferred += 1;
      continue;
    }
    const suggestedText =
      `Track this commitment? “${candidate.text}”` +
      `${candidate.dueHint ? ` (due ${candidate.dueHint})` : ""} — accepting creates a ` +
      `Commitment you can inspect, complete, or archive at any time.`;
    const row = await store.casSupersede({
      organizationId: options.organizationId,
      ownerUserId: options.ownerUserId,
      lineageKey,
      expectedCurrentId: null,
      next: {
        id: options.nextId(),
        organizationId: options.organizationId,
        type: "semantic",
        subjectRecordId: lineageKey,
        scope: "private",
        content: JSON.stringify({
          anchor: { kind: COMMITMENT_SUGGESTION_KIND, status: "proposed" satisfies CommitmentSuggestionStatus },
          candidate,
          suggestedText,
        }),
        sourceRefType: "feedback",
        sourceRefId: null,
        confidence: 1,
        trustOrigin: "user_content",
        plane: "local",
        createdBy: options.ownerUserId,
        ownerUserId: options.ownerUserId,
        ...(options.taintLabel ? { taintLabel: options.taintLabel } : {}),
      },
    });
    if (row) {
      const parsed = readCommitmentSuggestion(row);
      if (parsed) {
        proposed.push(parsed);
        budget -= 1;
      }
    }
  }
  return { proposed, deferred };
}

export async function listCommitmentSuggestions(
  store: MemoryStore,
  scope: MemoryAuthScope,
  status?: CommitmentSuggestionStatus,
): Promise<CommitmentSuggestion[]> {
  const rows = await store.retrieve(
    {
      type: "semantic",
      contentPathEquals: [
        { path: "anchor.kind", equals: COMMITMENT_SUGGESTION_KIND },
        ...(status ? [{ path: "anchor.status", equals: status }] : []),
      ],
    },
    scope,
  );
  const suggestions: CommitmentSuggestion[] = [];
  for (const row of rows) {
    const parsed = readCommitmentSuggestion(row);
    if (parsed) suggestions.push(parsed);
  }
  return suggestions;
}

async function transitionCommitmentSuggestion(
  store: MemoryStore,
  scope: MemoryAuthScope,
  suggestionMemoryId: string,
  toStatus: CommitmentSuggestionStatus,
  actorUserId: string,
  nextId: () => string,
): Promise<CommitmentSuggestion> {
  const current = await store.get(suggestionMemoryId, scope);
  if (!current) throw new Error(`commitments: unknown or unauthorized suggestion ${suggestionMemoryId}`);
  const parsed = readCommitmentSuggestion(current);
  if (!parsed) throw new Error(`commitments: memory ${suggestionMemoryId} is not a commitment suggestion`);
  const head = await store.currentForLineage(
    current.organizationId,
    current.ownerUserId ?? actorUserId,
    current.subjectRecordId ?? "",
  );
  if (!head || head.id !== current.id) {
    throw new Error(`commitments: suggestion ${suggestionMemoryId} was superseded — re-read and retry`);
  }
  if (parsed.status !== "proposed") {
    throw new Error(`commitments: suggestion ${suggestionMemoryId} is already ${parsed.status}`);
  }
  const content = parseContent(current)!;
  const anchor = content["anchor"] as Record<string, unknown>;
  const next = await store.casSupersede({
    organizationId: current.organizationId,
    ownerUserId: current.ownerUserId ?? actorUserId,
    lineageKey: current.subjectRecordId ?? "",
    expectedCurrentId: current.id,
    next: {
      id: nextId(),
      organizationId: current.organizationId,
      type: "semantic",
      subjectRecordId: current.subjectRecordId ?? null,
      scope: "private",
      content: JSON.stringify({ ...content, anchor: { ...anchor, status: toStatus } }),
      sourceRefType: current.sourceRefType ?? null,
      sourceRefId: current.sourceRefId ?? null,
      confidence: current.confidence,
      trustOrigin: "user_content",
      plane: "local",
      createdBy: actorUserId,
      ownerUserId: current.ownerUserId ?? null,
    },
  });
  if (!next) throw new Error(`commitments: suggestion ${suggestionMemoryId} was concurrently modified — re-read and retry`);
  const nextParsed = readCommitmentSuggestion(next);
  if (!nextParsed) throw new Error(`commitments: suggestion ${suggestionMemoryId} became unreadable after transition`);
  return nextParsed;
}

/** Human accepts: the lineage moves to `accepted` and the candidate is
 * returned for the CALLER to materialize through the governed relationship
 * pipeline. This function never writes a Commitment — it has no handle to
 * the graph store. */
export async function acceptCommitmentSuggestion(
  store: MemoryStore,
  scope: MemoryAuthScope,
  suggestionMemoryId: string,
  actorUserId: string,
  nextId: () => string,
): Promise<{ suggestion: CommitmentSuggestion; candidate: CommitmentCandidate }> {
  const suggestion = await transitionCommitmentSuggestion(
    store, scope, suggestionMemoryId, "accepted", actorUserId, nextId,
  );
  return { suggestion, candidate: suggestion.candidate };
}

/** Human rejects: this sentence is never re-proposed. */
export async function rejectCommitmentSuggestion(
  store: MemoryStore,
  scope: MemoryAuthScope,
  suggestionMemoryId: string,
  actorUserId: string,
  nextId: () => string,
): Promise<CommitmentSuggestion> {
  return transitionCommitmentSuggestion(
    store, scope, suggestionMemoryId, "rejected", actorUserId, nextId,
  );
}
