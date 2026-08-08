// =====================================================================
// Task Manager planning intelligence (pure).
//
// The Task Manager plan's TM3 slice promised three Skills on the path where a
// Task enters the queue: task-reconciliation ("search same outcome/root-cause/
// exit-test first; attach or propose duplicate-merge"), queue-sequencing
// ("priority-aware order proposal; WIP-limit aware"), and impact-fit-analysis
// ("where it sits vs. existing work, proposed resequence"). Their Skill ids and
// Agent owners were registered, but no logic was ever bound behind them — so
// `draftTaskCreate` raised an impact_fit proposal whose entire finding was the
// boolean `requiresResequenceReview: true`. This module is that missing logic.
//
// Deterministic by construction — no model call — for the same reasons
// `suggestTaskParent` is (ADR-183) and promotion policy is (ADR-177): it runs
// on EVERY Task create, the reviewer must be shown the exact terms that
// produced a finding, and with no local model configured it has to degrade to
// "nothing found" rather than to a plausible guess. Model-backed decomposition
// and goal framing are a separate lane and deliberately NOT in the path that
// decides where a Task lands.
//
// Everything here PROPOSES. Nothing merges, attaches, or reorders on its own:
// the plan's not-covered list names auto-merge of suspected duplicates
// explicitly, and silent restructuring is forbidden (§1.4).
// =====================================================================

import { chatTaskMatchTerms, suggestTaskParent, type SuggestedTaskParent } from "./chat-task-planning.js";
import type { TaskRecord, TaskRecordStatus } from "./task-manager.js";

/** Statuses that take a Task out of the live queue. A closed Task is still
 * worth reporting as a possible duplicate (the work may simply have been done
 * already), but it never takes part in sequencing. */
const CLOSED_STATUSES: readonly TaskRecordStatus[] = ["done", "abandoned", "archived"];

export function taskIsOpen(status: TaskRecordStatus): boolean {
  return !CLOSED_STATUSES.includes(status);
}

/** Duplicate detection is a STRONGER claim than parent suggestion (which needs
 * 0.34 / 2 shared terms), so it demands a higher bar. Set deliberately high:
 * a false "this already exists" costs the user more than a missed one, because
 * it argues against work they just decided to do. */
const DUPLICATE_MIN_SCORE = 0.6;
const DUPLICATE_MIN_SHARED_TERMS = 3;
const MAX_DUPLICATE_FINDINGS = 5;

export interface TaskDuplicateFinding {
  taskId: string;
  title: string;
  path: string;
  status: TaskRecordStatus;
  /** Plain-language WHY, shown verbatim in the review card. */
  reason: string;
  /** 0..1, two decimals — share of the incoming Task's terms already covered. */
  score: number;
}

/** The comparable text of a Task: what it is called, what it is FOR, and how
 * we would know it was finished. The plan names exactly these three as the
 * reconciliation keys ("same outcome/root-cause/exit-test"). */
function taskMatchText(task: Pick<TaskRecord, "title" | "outcomes" | "exitTest">): string[] {
  return [
    task.title,
    ...task.outcomes.map((outcome) => `${outcome.title} ${outcome.measure} ${outcome.target}`),
    task.exitTest ?? "",
  ];
}

function quoteTerms(terms: readonly string[]): string {
  return terms.map((term) => `"${term}"`).join(", ");
}

export interface FindDuplicateTasksInput {
  title: string;
  outcomes?: readonly { title: string; measure: string; target: string }[];
  exitTest?: string | undefined;
  /** Never report the Task being created against itself. */
  excludeTaskId?: string | undefined;
  queue: readonly TaskRecord[];
}

/**
 * Reconciliation at intake: does the queue ALREADY contain this work?
 *
 * Returns findings only — attaching or merging is a Human decision made on the
 * proposal, never here. Closed Tasks are included in the search on purpose: the
 * most useful duplicate answer is often "you already finished this".
 */
export function findDuplicateTasks(input: FindDuplicateTasksInput): readonly TaskDuplicateFinding[] {
  const terms = chatTaskMatchTerms(
    input.title,
    ...(input.outcomes ?? []).map((outcome) => `${outcome.title} ${outcome.measure} ${outcome.target}`),
    input.exitTest,
  );
  if (terms.size === 0) return [];

  const findings: TaskDuplicateFinding[] = [];
  for (const candidate of input.queue) {
    if (candidate.id === input.excludeTaskId) continue;
    const candidateTerms = chatTaskMatchTerms(...taskMatchText(candidate));
    const shared = [...terms].filter((term) => candidateTerms.has(term)).sort();
    if (shared.length < DUPLICATE_MIN_SHARED_TERMS) continue;
    const score = Math.round((shared.length / terms.size) * 100) / 100;
    if (score < DUPLICATE_MIN_SCORE) continue;
    findings.push({
      taskId: candidate.id,
      title: candidate.title,
      path: candidate.path,
      status: candidate.status,
      reason: taskIsOpen(candidate.status)
        ? `Open Task ${candidate.path} shares ${quoteTerms(shared)}.`
        : `Already ${candidate.status} at ${candidate.path}, sharing ${quoteTerms(shared)}.`,
      score,
    });
  }
  findings.sort((a, b) =>
    b.score - a.score ||
    a.path.localeCompare(b.path) ||
    a.taskId.localeCompare(b.taskId),
  );
  return findings.slice(0, MAX_DUPLICATE_FINDINGS);
}

/** Numeric-aware dot-path compare, so "1.10" sorts AFTER "1.9" rather than
 * before it the way a plain string compare would. */
export function compareTaskPaths(a: string, b: string): number {
  const left = a.split(".");
  const right = b.split(".");
  for (let index = 0; index < Math.max(left.length, right.length); index += 1) {
    const l = Number(left[index] ?? -1);
    const r = Number(right[index] ?? -1);
    if (Number.isNaN(l) || Number.isNaN(r)) {
      const raw = (left[index] ?? "").localeCompare(right[index] ?? "");
      if (raw !== 0) return raw;
      continue;
    }
    if (l !== r) return l - r;
  }
  return 0;
}

/** "P0" ranks ahead of "P1". An unrecognized priority sorts last rather than
 * throwing — a queue must stay orderable even when someone types free text. */
function priorityRank(priority: string): number {
  const match = /^P(\d+)$/i.exec(priority.trim());
  return match ? Number(match[1]) : Number.MAX_SAFE_INTEGER;
}

export interface TaskSequencePosition {
  taskId: string;
  path: string;
  title: string;
  /** 1-based position in the proposed order. */
  position: number;
  reason: string;
}

export interface QueueSequenceProposal {
  /** True when the proposed order differs from the queue's current canonical
   * order — the only case worth showing a reviewer. */
  changed: boolean;
  proposed: readonly TaskSequencePosition[];
  reason: string;
}

export interface ProposeQueueSequenceInput {
  queue: readonly TaskRecord[];
  /** Work-in-progress limit; the plan's default posture is WIP-1 per actor. */
  wipLimit?: number;
}

/**
 * Priority- and status-aware ordering of the OPEN queue.
 *
 * Dependency awareness is deliberately absent: the plan specifies `depends_on`
 * / `blocked_by` Relations, and no such edge exists in the schema today, so a
 * "dependency-aware" claim here would be fiction. The `blocked` status IS
 * honored (blocked work sinks below ready work), and the honest gap is
 * recorded rather than papered over.
 */
export function proposeQueueSequence(input: ProposeQueueSequenceInput): QueueSequenceProposal {
  const open = input.queue.filter((task) => taskIsOpen(task.status));
  const current = [...open].sort((a, b) => compareTaskPaths(a.path, b.path));

  const rankOf = (task: TaskRecord): number => {
    if (task.status === "in_progress") return 0; // the hot head stays the head
    if (task.status === "blocked") return 3; // ready work outranks blocked work
    return 1;
  };

  const proposedOrder = [...open].sort((a, b) =>
    rankOf(a) - rankOf(b) ||
    priorityRank(a.priority) - priorityRank(b.priority) ||
    compareTaskPaths(a.path, b.path),
  );

  const proposed = proposedOrder.map((task, index) => ({
    taskId: task.id,
    path: task.path,
    title: task.title,
    position: index + 1,
    reason:
      task.status === "in_progress"
        ? "In progress — stays at the queue head."
        : task.status === "blocked"
          ? `Blocked — ranked below ready work (priority ${task.priority}).`
          : `Priority ${task.priority}, canonical path ${task.path}.`,
  }));

  const changed = proposedOrder.some((task, index) => current[index]?.id !== task.id);
  const wipLimit = input.wipLimit ?? 1;
  const inProgress = open.filter((task) => task.status === "in_progress").length;
  const wipNote =
    inProgress > wipLimit
      ? ` ${inProgress} Tasks are in progress against a WIP limit of ${wipLimit}.`
      : "";

  return {
    changed,
    proposed,
    reason: changed
      ? `Proposed order differs from the current queue order.${wipNote}`
      : `Current queue order already matches priority and status.${wipNote}`,
  };
}

export interface TaskImpactFitAnalysis {
  duplicates: readonly TaskDuplicateFinding[];
  /** Never "merge" — the strongest verdict this may reach is "a Human should
   * look at these before committing the new Task". */
  duplicateVerdict: "review_duplicates" | "no_duplicates_found";
  placement: {
    proposedParentTaskId: string | null;
    reason: string;
    alternatives: readonly SuggestedTaskParent[];
  };
  resequence: QueueSequenceProposal;
  /** Plain-language observations about the queue this Task is joining. */
  queueFindings: readonly string[];
}

export interface AnalyzeTaskImpactFitInput {
  taskId: string;
  title: string;
  outcomes?: readonly { title: string; measure: string; target: string }[];
  exitTest?: string | undefined;
  /** Set when the requester chose a parent explicitly; suppresses suggestion. */
  parentTaskId?: string | undefined;
  queue: readonly TaskRecord[];
  wipLimit?: number;
}

/**
 * The composite that fills the impact_fit proposal: is this already here, where
 * should it sit, and does admitting it change the order of what is already
 * queued? One analysis, three independently explainable findings.
 */
export function analyzeTaskImpactFit(input: AnalyzeTaskImpactFitInput): TaskImpactFitAnalysis {
  const duplicates = findDuplicateTasks({
    title: input.title,
    ...(input.outcomes ? { outcomes: input.outcomes } : {}),
    exitTest: input.exitTest,
    excludeTaskId: input.taskId,
    queue: input.queue,
  });

  let placement: TaskImpactFitAnalysis["placement"];
  if (input.parentTaskId) {
    const parent = input.queue.find((task) => task.id === input.parentTaskId);
    placement = {
      proposedParentTaskId: input.parentTaskId,
      reason: parent
        ? `Parent chosen by the requester: ${parent.path} ${parent.title}.`
        : "Parent chosen by the requester.",
      alternatives: [],
    };
  } else {
    const suggestion = suggestTaskParent({
      title: input.title,
      outcome: (input.outcomes ?? []).map((outcome) => outcome.title).join(" "),
      excludeTaskId: input.taskId,
      candidates: input.queue.map((task) => ({
        taskId: task.id,
        title: task.title,
        outcome: task.outcomes.map((outcome) => outcome.title).join(" "),
        status: task.status,
      })),
    });
    placement = {
      proposedParentTaskId: suggestion.suggestion?.taskId ?? null,
      reason: suggestion.suggestion
        ? suggestion.suggestion.reason
        : "No existing Task shares enough with this one to suggest a parent — proposed as a root.",
      alternatives: suggestion.candidates,
    };
  }

  const resequence = proposeQueueSequence({
    queue: input.queue,
    ...(input.wipLimit !== undefined ? { wipLimit: input.wipLimit } : {}),
  });

  const openCount = input.queue.filter((task) => taskIsOpen(task.status)).length;
  const inProgress = input.queue.filter((task) => task.status === "in_progress");
  const queueFindings: string[] = [`Joining a queue of ${openCount} open Task(s).`];
  if (inProgress.length > (input.wipLimit ?? 1)) {
    queueFindings.push(
      `${inProgress.length} Tasks are already in progress — finishing one before starting this is the cheaper path.`,
    );
  }
  if (duplicates.length > 0) {
    queueFindings.push(
      `${duplicates.length} possible duplicate(s) found — review before committing.`,
    );
  }

  return {
    duplicates,
    duplicateVerdict: duplicates.length > 0 ? "review_duplicates" : "no_duplicates_found",
    placement,
    resequence,
    queueFindings,
  };
}
