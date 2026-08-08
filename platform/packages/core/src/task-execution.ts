// =====================================================================
// Task Manager execution-and-review Skills (pure).
//
// The four TM3/TM4 Skills that are about work already IN the queue rather than
// work entering it: `evidence-verification` (does the evidence actually clear
// the exit test), `progress-synthesis` (what landed), `habit-scaffolding`
// (turn a standing goal into a recurring rhythm), and
// `proactive-opportunity-scan` (what the queue itself says is worth doing
// next). All four were registered Skill ids whose `run()` echoed its inputs.
//
// Deterministic, no model — for the same reason `task-planning.ts` is: these
// answer questions with checkable answers. Whether a Task carries evidence,
// what changed in the last seven days, whether a goal has a review cadence,
// and whether a parent's children are all done are facts about rows, not
// judgments. A model here would add a plausible narrator over data the
// reviewer can already read, and would go silent with no provider configured.
// The generative counterparts live in `task-playbooks.ts`.
//
// Everything PROPOSES. `verifyTaskEvidence` in particular never marks a Task
// verified: it reports whether a Human COULD, and names what is missing when
// they could not. `exit-test-authoring` and `evidence-verification` are
// deliberately separate Skills so authoring and checking never share one
// prompt context (plan §3.2) — that separation is why the checker here is
// deterministic even though the author is not.
// =====================================================================

import { compareTaskPaths, taskIsOpen } from "./task-planning.js";
import { isStalenessEligible } from "./task-manager.js";
import type { TaskRecord } from "./task-manager.js";

// ---------------------------------------------------------------------
// evidence-verification
// ---------------------------------------------------------------------

/**
 * A verification a Human could sign, with `verifiedBy` deliberately absent.
 *
 * `TaskVerification` requires `verifiedBy`, and the only honest value for it
 * is the identity of whoever accepts the proposal — not this Skill, and not
 * the Agent that invoked it. Filling it here would let an Agent's own name end
 * up on a verification record, which is exactly the self-approval the agent
 * floor exists to prevent.
 */
export interface ProposedTaskVerification {
  evidenceRefs: readonly string[];
  result: "passed";
  /** Restated so the approver signs against the test that was actually run,
   * not whatever the Task's exit test may say by the time they look. */
  exitTest: string;
}

export interface EvidenceVerificationReport {
  kind: "evidence_verification";
  taskId: string;
  verdict: "verifiable" | "blocked" | "already_verified";
  /** Plain-language reasons a Human cannot sign this off yet. Empty when the
   * verdict is `verifiable`. */
  blockers: readonly string[];
  evidenceRefs: readonly string[];
  proposedVerification?: ProposedTaskVerification;
}

export interface VerifyTaskEvidenceInput {
  task: Pick<TaskRecord, "id" | "title" | "status" | "isGoal" | "exitTest" | "evidenceRefs" | "verification">;
  /** Evidence offered by the caller on top of what the Task already carries —
   * de-duplicated, never replacing the Task's own refs. */
  additionalEvidenceRefs?: readonly string[] | undefined;
}

export function verifyTaskEvidence(input: VerifyTaskEvidenceInput): EvidenceVerificationReport {
  const { task } = input;
  const evidenceRefs = [
    ...new Set([...task.evidenceRefs, ...(input.additionalEvidenceRefs ?? [])].map((ref) => ref.trim()).filter(Boolean)),
  ].sort();

  if (task.verification) {
    return { kind: "evidence_verification", taskId: task.id, verdict: "already_verified", blockers: [], evidenceRefs };
  }

  const blockers: string[] = [];
  const exitTest = task.exitTest?.trim() ?? "";
  if (exitTest.length === 0) {
    // A goal is allowed to run on a review cadence instead of a terminal exit
    // test (plan §load-bearing rules), so "no exit test" is only a blocker for
    // ordinary Tasks — but a goal still cannot be VERIFIED without one, since
    // there would be nothing to verify against.
    blockers.push(
      task.isGoal
        ? "This is a goal with no exit test — goals may run on a review cadence, but there is nothing here to verify against."
        : "No exit test. There is no stated way to show this did not work, so nothing can be checked.",
    );
  }
  if (evidenceRefs.length === 0) {
    blockers.push("No evidence attached. A done Task with no evidence is a claim, not a result.");
  }

  if (blockers.length > 0) {
    return { kind: "evidence_verification", taskId: task.id, verdict: "blocked", blockers, evidenceRefs };
  }
  return {
    kind: "evidence_verification",
    taskId: task.id,
    verdict: "verifiable",
    blockers: [],
    evidenceRefs,
    // Note what this does NOT assert: that the evidence actually satisfies the
    // exit test. Nothing deterministic can read a linked artifact and judge
    // that. It asserts that a Human now has both halves in front of them.
    proposedVerification: { evidenceRefs, result: "passed", exitTest },
  };
}

// ---------------------------------------------------------------------
// progress-synthesis
// ---------------------------------------------------------------------

export interface ProgressEntry {
  taskId: string;
  path: string;
  title: string;
  /** The Task's own `updatedAt` — the timestamp the reader can go check. */
  at: string;
}

export interface ProgressSynthesis {
  kind: "progress_synthesis";
  window: { since: string; until: string };
  landed: readonly ProgressEntry[];
  started: readonly ProgressEntry[];
  blocked: readonly ProgressEntry[];
  /** Open and untouched for the whole window — the queue's quiet failure mode. */
  stalled: readonly ProgressEntry[];
  counts: { landed: number; started: number; blocked: number; stalled: number; open: number };
  /** What this brief is built from, stated so nobody reads more into it. */
  basis: string;
}

export interface SynthesizeProgressInput {
  tasks: readonly TaskRecord[];
  since: string;
  until: string;
}

/**
 * The "what just landed" brief: links, not prose (plan §3.2).
 *
 * Built from the Task rows' own `status` + `updatedAt`, NOT from the Event
 * stream. That is a real limitation and it is stated in `basis` rather than
 * hidden: a Task that moved to done and then had its title edited inside the
 * window reads as landing at the edit's timestamp, and a Task that landed and
 * was later reopened does not appear as landed at all. Reading the Event
 * stream would fix both and needs a store this pure Skill deliberately does
 * not reach into.
 */
export function synthesizeProgress(input: SynthesizeProgressInput): ProgressSynthesis {
  const since = Date.parse(input.since);
  const until = Date.parse(input.until);
  if (!Number.isFinite(since) || !Number.isFinite(until)) {
    throw new Error("task-manager: progress window bounds must be ISO-8601");
  }
  if (until < since) throw new Error("task-manager: progress window ends before it starts");

  const inWindow = (task: TaskRecord): boolean => {
    const at = Date.parse(task.updatedAt);
    return Number.isFinite(at) && at >= since && at <= until;
  };
  const entry = (task: TaskRecord): ProgressEntry => ({
    taskId: task.id,
    path: task.path,
    title: task.title,
    at: task.updatedAt,
  });
  const byPath = (a: ProgressEntry, b: ProgressEntry): number => compareTaskPaths(a.path, b.path);

  const landed = input.tasks.filter((task) => task.status === "done" && inWindow(task)).map(entry).sort(byPath);
  const started = input.tasks.filter((task) => task.status === "in_progress" && inWindow(task)).map(entry).sort(byPath);
  const blocked = input.tasks.filter((task) => task.status === "blocked" && inWindow(task)).map(entry).sort(byPath);
  // ONE definition of "this Task is supposed to be moving", shared with the
  // `stale_task` guard (ADR-201). Narrower than `taskIsOpen`: a `candidate` is
  // an option nobody committed to and a `parked` Task is a decision to not do
  // it now — both are SUPPOSED to sit untouched, and listing them as stalled
  // would train the reader to skip the section that matters.
  const stalled = input.tasks
    .filter((task) => isStalenessEligible(task.status) && !inWindow(task))
    .map(entry)
    .sort(byPath);
  const open = input.tasks.filter((task) => taskIsOpen(task.status)).length;

  return {
    kind: "progress_synthesis",
    window: { since: input.since, until: input.until },
    landed,
    started,
    blocked,
    stalled,
    counts: { landed: landed.length, started: started.length, blocked: blocked.length, stalled: stalled.length, open },
    basis:
      "Built from each Task's current status and updatedAt, not from the Event stream: a Task edited after it landed reads at the edit's time, and one that landed and was later reopened does not appear as landed.",
  };
}

// ---------------------------------------------------------------------
// habit-scaffolding
// ---------------------------------------------------------------------

export interface HabitProposal {
  /** A recurring review Task, or the cadence a Scheduled Automation would run
   * on. Both are proposals; neither is created here. */
  kind: "recurring_review";
  cadence: string;
  title: string;
  reason: string;
}

export interface HabitScaffolding {
  kind: "habit_scaffolding";
  taskId: string;
  proposals: readonly HabitProposal[];
  /** Present when nothing was proposed, saying why. */
  note?: string;
}

export interface ScaffoldHabitsInput {
  task: Pick<TaskRecord, "id" | "title" | "isGoal" | "outcomes" | "reviewCadence">;
}

/**
 * Turn a standing goal into a rhythm.
 *
 * Only ever proposes for a goal-flagged Task. An ordinary Task has a terminal
 * exit test and finishes; wrapping it in a recurring review would manufacture
 * work the user never asked for, so it returns a stated refusal instead of an
 * empty list.
 *
 * The cadence is derived, not invented: an explicit `reviewCadence` wins; a
 * goal carrying any leading indicator gets a weekly rhythm because a leading
 * indicator that is only read monthly cannot be acted on; a goal that is all
 * lagging gets a monthly one.
 */
export function scaffoldHabits(input: ScaffoldHabitsInput): HabitScaffolding {
  const { task } = input;
  if (!task.isGoal) {
    return {
      kind: "habit_scaffolding",
      taskId: task.id,
      proposals: [],
      note: "Not a goal. An ordinary Task finishes at its exit test, and a recurring review would invent work nobody asked for.",
    };
  }
  if (task.outcomes.length === 0) {
    return {
      kind: "habit_scaffolding",
      taskId: task.id,
      proposals: [],
      note: "This goal carries no outcomes yet, so a review would have nothing to check. Run goal-outcome-framing first.",
    };
  }

  const existing = task.reviewCadence?.trim();
  const hasLeading = task.outcomes.some((outcome) => outcome.indicatorKind === "leading");
  const cadence = existing && existing.length > 0 ? existing : hasLeading ? "weekly" : "monthly";
  const reason = existing
    ? `Uses the goal's own review cadence (${existing}).`
    : hasLeading
      ? "Carries a leading indicator, which is only useful if it is read often enough to act on — weekly."
      : "All outcomes are lagging indicators, which do not move week to week — monthly.";

  return {
    kind: "habit_scaffolding",
    taskId: task.id,
    proposals: [
      {
        kind: "recurring_review",
        cadence,
        title: `Review: ${task.title}`,
        reason,
      },
    ],
  };
}

// ---------------------------------------------------------------------
// proactive-opportunity-scan
// ---------------------------------------------------------------------

export type OpportunityKind =
  | "goal_without_children"
  | "goal_without_outcomes"
  | "parent_complete_but_open"
  | "blocked_with_no_ready_sibling"
  | "goal_never_reviewed";

export interface TaskOpportunity {
  kind: OpportunityKind;
  /** The Task this was derived FROM — every finding is traceable to a row. */
  taskId: string;
  path: string;
  title: string;
  /** The candidate Task this suggests, phrased as a title a Human can edit. */
  proposedTitle: string;
  reason: string;
}

export interface OpportunityScan {
  kind: "opportunity_scan";
  opportunities: readonly TaskOpportunity[];
  /** The boundary of what was actually examined. */
  scope: string;
}

const MAX_OPPORTUNITIES = 10;

/**
 * The proactive scan, over the QUEUE only.
 *
 * The plan describes this Skill as analyzing "cross-Module data (evidence,
 * Signals, stale/idle areas)". Signals and cross-Module evidence live in
 * stores a pure Skill does not reach, and inventing opportunities that claim
 * to come from them would be fabrication — so this scans the Task queue, every
 * finding names the row it came from, and `scope` states the boundary. Widening
 * it to real Signals means giving this Skill authorized cross-Module input the
 * way `task-planning.ts` takes the queue, not loosening what it may assume.
 */
export function scanForOpportunities(tasks: readonly TaskRecord[]): OpportunityScan {
  const opportunities: TaskOpportunity[] = [];
  const childrenOf = new Map<string, TaskRecord[]>();
  for (const task of tasks) {
    if (!task.parentTaskId) continue;
    childrenOf.set(task.parentTaskId, [...(childrenOf.get(task.parentTaskId) ?? []), task]);
  }

  for (const task of [...tasks].sort((a, b) => compareTaskPaths(a.path, b.path))) {
    const children = childrenOf.get(task.id) ?? [];
    const base = { taskId: task.id, path: task.path, title: task.title };

    if (task.isGoal && taskIsOpen(task.status)) {
      if (task.outcomes.length === 0) {
        opportunities.push({
          ...base,
          kind: "goal_without_outcomes",
          proposedTitle: `Frame outcomes for "${task.title}"`,
          reason: "A goal with no outcomes cannot be reviewed — there is nothing to check it against.",
        });
      } else if (children.length === 0) {
        opportunities.push({
          ...base,
          kind: "goal_without_children",
          proposedTitle: `Break "${task.title}" into its first steps`,
          reason: "A goal with outcomes but no Tasks beneath it has nowhere for work to start.",
        });
      }
      if (task.reviewCadence && !task.lastReviewedAt) {
        opportunities.push({
          ...base,
          kind: "goal_never_reviewed",
          proposedTitle: `Hold the first ${task.reviewCadence} review of "${task.title}"`,
          reason: `A ${task.reviewCadence} cadence is set but no review has happened yet.`,
        });
      }
    }

    if (children.length > 0 && taskIsOpen(task.status) && children.every((child) => !taskIsOpen(child.status))) {
      opportunities.push({
        ...base,
        kind: "parent_complete_but_open",
        proposedTitle: `Close out "${task.title}"`,
        reason: `All ${children.length} Task(s) beneath it are finished, but it is still ${task.status}.`,
      });
    }

    if (task.status === "blocked") {
      const siblings = task.parentTaskId ? (childrenOf.get(task.parentTaskId) ?? []) : [];
      const readySibling = siblings.some((sibling) => sibling.id !== task.id && sibling.status === "pending");
      if (!readySibling) {
        opportunities.push({
          ...base,
          kind: "blocked_with_no_ready_sibling",
          proposedTitle: `Unblock "${task.title}"`,
          reason: "It is blocked and no sibling is ready to pick up instead, so this branch has stalled entirely.",
        });
      }
    }
  }

  return {
    kind: "opportunity_scan",
    opportunities: opportunities.slice(0, MAX_OPPORTUNITIES),
    scope:
      "The Task queue only. Signals and cross-Module evidence are not read here; every finding names the Task row it came from.",
  };
}
