// =====================================================================
// Chat -> Task node planning (pure).
//
// Two governed questions are answered here, with no I/O and no model call so
// the answer is reproducible and auditable:
//
//   1. Does this Chat turn belong to the Task node the thread ALREADY owns?
//      A thread mints one Task node; later turns append to it instead of
//      minting a sibling for every user input.
//   2. If a genuinely new node is minted, which existing Task is the most
//      plausible parent? The answer is only ever a SUGGESTION carried into the
//      Human-review proposal with the terms that produced it — never a silent
//      auto-parenting (AP-021: no fabricated capability, "explain before
//      automating").
// =====================================================================

import type { TaskRecordStatus } from "./task-manager.js";

/** A Chat turn that staged a governed Task proposal, plus the Human decision
 * on it. Callers project this from the ledger; the resolver stays pure. */
export interface ChatTaskAnchorCandidate {
  turnId: string;
  sequence: number;
  taskId: string;
  /** The Human approved it (`approve` or `edit`) — a vetoed or still-pending
   * proposal never owns the thread's node. */
  accepted: boolean;
}

export interface ChatThreadTaskAnchor {
  turnId: string;
  taskId: string;
}

/** The Task node a Chat thread already owns: the EARLIEST accepted Chat Task
 * proposal in it. Earliest (not latest) so the node is stable as the
 * conversation grows. */
export function resolveChatThreadTaskAnchor(
  candidates: readonly ChatTaskAnchorCandidate[],
): ChatThreadTaskAnchor | null {
  const accepted = candidates
    .filter((candidate) => candidate.accepted)
    .sort((a, b) => a.sequence - b.sequence || a.turnId.localeCompare(b.turnId));
  const first = accepted[0];
  return first ? { turnId: first.turnId, taskId: first.taskId } : null;
}

/** Statuses that close a Task node. A closed node is never appended to — the
 * follow-up becomes a new node (which may then be parented under the closed
 * one by thread lineage). */
const CLOSED_TASK_STATUSES: readonly TaskRecordStatus[] = [
  "done",
  "abandoned",
  "archived",
];

export function chatTaskNodeIsOpen(status: TaskRecordStatus): boolean {
  return !CLOSED_TASK_STATUSES.includes(status);
}

export interface ParentCandidateTask {
  taskId: string;
  title: string;
  outcome?: string;
  status: TaskRecordStatus;
}

export interface SuggestedTaskParent {
  taskId: string;
  title: string;
  /** Plain-language WHY, shown verbatim in the review card. */
  reason: string;
  /** 0..1, two decimals. 1 means thread lineage, not term overlap. */
  score: number;
}

/** Terms that carry no matching signal. Deliberately small and English-only —
 * an honest cheap matcher, not a pretend-NLP one. */
const MATCH_STOPWORDS: ReadonlySet<string> = new Set([
  "the", "and", "for", "with", "from", "that", "this", "into", "onto", "than",
  "then", "they", "them", "their", "there", "when", "what", "will", "would",
  "should", "could", "have", "has", "had", "about", "over", "under", "each",
  "any", "all", "our", "out", "get", "got", "new", "task", "tasks", "make",
  "made", "need", "needs", "want", "wants", "please", "can", "not", "you",
  "your", "his", "her", "its", "are", "was", "were", "been", "being", "but",
]);

export function chatTaskMatchTerms(...parts: readonly (string | undefined)[]): Set<string> {
  const terms = new Set<string>();
  for (const part of parts) {
    if (!part) continue;
    for (const raw of part.toLowerCase().split(/[^a-z0-9]+/)) {
      if (raw.length < 3 || MATCH_STOPWORDS.has(raw)) continue;
      terms.add(raw);
    }
  }
  return terms;
}

/** At least this share of the new node's terms must be covered, and at least
 * MIN_SHARED_TERMS of them, before a parent is worth suggesting at all. */
const MIN_OVERLAP_SCORE = 0.34;
const MIN_SHARED_TERMS = 2;
const MAX_SUGGESTED_CANDIDATES = 5;

function quoteTerms(terms: readonly string[]): string {
  return terms.map((term) => `"${term}"`).join(", ");
}

export interface SuggestTaskParentInput {
  title: string;
  outcome: string;
  candidates: readonly ParentCandidateTask[];
  /** The Task this same Chat thread already created, when it exists. Thread
   * lineage outranks term overlap. */
  lineageTaskId?: string | undefined;
  /** Never suggest the node being created as its own parent. */
  excludeTaskId?: string | undefined;
}

export interface SuggestTaskParentResult {
  suggestion: SuggestedTaskParent | null;
  /** Ranked alternatives (including the suggestion) the reviewer can switch
   * to without leaving the card. */
  candidates: readonly SuggestedTaskParent[];
}

/** Deterministic, explainable parent matching. No model call, so it degrades
 * to "no parent suggested" rather than to a guess. */
export function suggestTaskParent(input: SuggestTaskParentInput): SuggestTaskParentResult {
  const terms = chatTaskMatchTerms(input.title, input.outcome);
  const scored: SuggestedTaskParent[] = [];
  for (const candidate of input.candidates) {
    if (candidate.taskId === input.excludeTaskId) continue;
    // Thread lineage outranks term overlap, and applies even when the earlier
    // node is closed — a follow-up to finished work is still work under it.
    if (candidate.taskId === input.lineageTaskId) {
      scored.push({
        taskId: candidate.taskId,
        title: candidate.title,
        reason: "Created earlier in this same Chat thread.",
        score: 1,
      });
      continue;
    }
    if (!chatTaskNodeIsOpen(candidate.status)) continue;
    if (terms.size === 0) continue;
    const candidateTerms = chatTaskMatchTerms(candidate.title, candidate.outcome);
    const shared = [...terms].filter((term) => candidateTerms.has(term)).sort();
    if (shared.length < MIN_SHARED_TERMS) continue;
    const score = Math.round((shared.length / terms.size) * 100) / 100;
    if (score < MIN_OVERLAP_SCORE) continue;
    scored.push({
      taskId: candidate.taskId,
      title: candidate.title,
      reason: `Shares ${quoteTerms(shared)} with this Task.`,
      score,
    });
  }
  scored.sort((a, b) =>
    b.score - a.score ||
    a.title.localeCompare(b.title) ||
    a.taskId.localeCompare(b.taskId),
  );
  const candidates = scored.slice(0, MAX_SUGGESTED_CANDIDATES);
  return { suggestion: candidates[0] ?? null, candidates };
}

export type ChatTaskNodePlan =
  | { mode: "append"; taskId: string }
  | {
      mode: "create";
      parent: SuggestedTaskParent | null;
      parentCandidates: readonly SuggestedTaskParent[];
    };

export interface PlanChatTaskNodeInput {
  title: string;
  outcome: string;
  /** The node this thread already owns, with its current status. */
  anchor?: { taskId: string; status: TaskRecordStatus } | undefined;
  /** Open Tasks in the same Organization, parent candidates for a new node. */
  candidates: readonly ParentCandidateTask[];
  /** The id a new node would take, so it can never parent itself. */
  newTaskId?: string | undefined;
}

/** Decide whether this Chat turn continues the thread's Task node or mints a
 * new one, and (when new) which parent to SUGGEST. */
export function planChatTaskNode(input: PlanChatTaskNodeInput): ChatTaskNodePlan {
  if (input.anchor && chatTaskNodeIsOpen(input.anchor.status)) {
    return { mode: "append", taskId: input.anchor.taskId };
  }
  const matched = suggestTaskParent({
    title: input.title,
    outcome: input.outcome,
    candidates: input.candidates,
    ...(input.anchor ? { lineageTaskId: input.anchor.taskId } : {}),
    ...(input.newTaskId ? { excludeTaskId: input.newTaskId } : {}),
  });
  return {
    mode: "create",
    parent: matched.suggestion,
    parentCandidates: matched.candidates,
  };
}
